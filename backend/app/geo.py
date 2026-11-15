from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import re
import unicodedata
from collections import OrderedDict
from contextlib import asynccontextmanager
from time import monotonic
from datetime import datetime, timezone
from itertools import permutations
from typing import Any, Literal
from urllib.parse import urlencode
from uuid import uuid4

import httpx
import zxingcpp
from dotenv import dotenv_values
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import delete, insert, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from starlette.concurrency import run_in_threadpool

from .tls import verified_tls
from .database import ROOT, atlas_locations
from .records import Records

logger = logging.getLogger('oracle.geo')

_GEOCODE_CACHE: OrderedDict[str, tuple[float, Any]] = OrderedDict()
_GEOCODE_CACHE_LIMIT = 256


def _place_name_key(value: str) -> str:
    """Fold punctuation and Latin accents while retaining Sinhala and Tamil vowel signs."""
    parts = []
    latin_letter = False
    for char in unicodedata.normalize("NFD", value.casefold()):
        if unicodedata.category(char).startswith("M"):
            if not latin_letter:
                parts.append(char)
            continue
        latin_letter = unicodedata.name(char, "").startswith("LATIN ")
        parts.append(char if char.isalnum() else " ")
    return " ".join("".join(parts).split())
_GEOCODE_CACHE_TTL = 900


def _cached_geocode(key):
    entry = _GEOCODE_CACHE.get(key)
    if entry is None:
        return None
    expires_at, value = entry
    if expires_at <= monotonic():
        del _GEOCODE_CACHE[key]
        return None
    _GEOCODE_CACHE.move_to_end(key)
    return value


def _cache_geocode(key, value):
    _GEOCODE_CACHE[key] = (monotonic() + _GEOCODE_CACHE_TTL, value)
    _GEOCODE_CACHE.move_to_end(key)
    if len(_GEOCODE_CACHE) > _GEOCODE_CACHE_LIMIT:
        _GEOCODE_CACHE.popitem(last=False)


class TripSharePoint(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)

    def maps_coordinates(self) -> str:
        return f"{self.lat:.6f},{self.lon:.6f}"


class TripShareRequest(BaseModel):
    origin: TripSharePoint | None = None
    destination: TripSharePoint
    stops: list[TripSharePoint] = Field(default_factory=list, max_length=8)
    mode: Literal["driving", "walking", "cycling"]

    def maps_url(self) -> str:
        params = {
            "api": "1",
            "destination": self.destination.maps_coordinates(),
            "travelmode": "bicycling" if self.mode == "cycling" else self.mode,
        }
        if self.origin is not None:
            params["origin"] = self.origin.maps_coordinates()
        if self.stops:
            params["waypoints"] = "|".join(stop.maps_coordinates() for stop in self.stops)
        return "https://www.google.com/maps/dir/?" + urlencode(params)


class GeoCommandRequest(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    current_lat: float | None = Field(default=None, ge=-90, le=90)
    current_lon: float | None = Field(default=None, ge=-180, le=180)


class ParkingSaveRequest(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    floor_level: str | None = Field(default=None, max_length=80)
    landmark_note: str | None = Field(default=None, max_length=500)
    photo: str | None = Field(default=None, max_length=400_023,
                              pattern=r"^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$")


class PlaceSaveRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    display_name: str | None = None
    category: str | None = "custom"


class BufferRequest(BaseModel):
    lat: float
    lon: float
    radius_km: float = Field(default=3.0, gt=0, le=500.0)
    steps: int = Field(default=64, ge=16, le=128)


class MeasureRequest(BaseModel):
    coordinates: list[list[float]] = Field(min_length=2)  # [[lon, lat], ...]
    is_closed_polygon: bool = False


class IsochroneRequest(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    minutes: int = Field(default=15, ge=1, le=120)
    mode: Literal["driving", "walking", "cycling"] = "driving"


def geodesic_circle_polygon(center_lat: float, center_lon: float, radius_km: float, steps: int = 64) -> list[list[float]]:
    """Calculates an exact geodesic circular polygon on WGS84 sphere."""
    r_km = 6371.0088
    d_over_r = radius_km / r_km
    lat_r = math.radians(center_lat)
    lon_r = math.radians(center_lon)
    coords: list[list[float]] = []

    for i in range(steps + 1):
        bearing = 2 * math.pi * (i % steps) / steps
        sin_lat2 = math.sin(lat_r) * math.cos(d_over_r) + math.cos(lat_r) * math.sin(d_over_r) * math.cos(bearing)
        lat2_r = math.asin(max(-1.0, min(1.0, sin_lat2)))
        y = math.sin(bearing) * math.sin(d_over_r) * math.cos(lat_r)
        x = math.cos(d_over_r) - math.sin(lat_r) * math.sin(lat2_r)
        lon2_r = lon_r + math.atan2(y, x)
        lon2_deg = (math.degrees(lon2_r) + 540) % 360 - 180
        lat2_deg = math.degrees(lat2_r)
        coords.append([round(lon2_deg, 6), round(lat2_deg, 6)])

    return coords


def geodesic_polygon_area_sqm(coords: list[list[float]]) -> float:
    """Computes exact spherical polygon area in square meters using Gauss spherical excess."""
    if len(coords) < 3:
        return 0.0
    r_meters = 6371008.8
    total = 0.0
    pts = coords[:-1] if coords[0] == coords[-1] and len(coords) > 3 else coords
    m = len(pts)
    if m < 3:
        return 0.0

    for i in range(m):
        p1 = pts[i]
        p2 = pts[(i + 1) % m]
        lon1 = math.radians(p1[0])
        lat1 = math.radians(p1[1])
        lon2 = math.radians(p2[0])
        lat2 = math.radians(p2[1])
        total += (lon2 - lon1) * (2 + math.sin(lat1) + math.sin(lat2))

    area = abs(total * (r_meters**2) / 2.0)
    return round(area, 2)


def geodesic_line_length_meters(coords: list[list[float]]) -> float:
    """Computes total length of a polyline across Earth sphere in meters."""
    total_km = 0.0
    for i in range(len(coords) - 1):
        p1 = coords[i]
        p2 = coords[i + 1]
        total_km += haversine_distance_km(p1[1], p1[0], p2[1], p2[0])
    return round(total_km * 1000.0, 2)


def generate_isochrone_polygon(
    center_lat: float, 
    center_lon: float, 
    minutes: int, 
    mode: Literal["driving", "walking", "cycling"] = "driving"
) -> list[list[float]]:
    """Generates a realistic travel-time reachability isochrone envelope."""
    speeds_kmh = {
        "walking": 4.8,
        "cycling": 15.0,
        "driving": 36.0
    }
    speed = speeds_kmh.get(mode, 36.0)
    base_radius_km = (speed * (minutes / 60.0))
    # Attenuate for network tortuosity (effective road network distance vs straight line)
    effective_radius_km = base_radius_km * 0.78

    steps = 36
    r_km = 6371.0088
    lat_r = math.radians(center_lat)
    lon_r = math.radians(center_lon)
    coords: list[list[float]] = []

    for i in range(steps + 1):
        idx = i % steps
        bearing = 2 * math.pi * idx / steps
        # Synthetic road network directional fluctuation (pseudo-arterial spokes)
        fluctuation = 0.88 + 0.16 * math.sin(bearing * 4 + 0.3) + 0.07 * math.cos(bearing * 2)
        r_step = effective_radius_km * fluctuation
        d_over_r = r_step / r_km

        sin_lat2 = math.sin(lat_r) * math.cos(d_over_r) + math.cos(lat_r) * math.sin(d_over_r) * math.cos(bearing)
        lat2_r = math.asin(max(-1.0, min(1.0, sin_lat2)))
        y = math.sin(bearing) * math.sin(d_over_r) * math.cos(lat_r)
        x = math.cos(d_over_r) - math.sin(lat_r) * math.sin(lat2_r)
        lon2_r = lon_r + math.atan2(y, x)
        lon2_deg = (math.degrees(lon2_r) + 540) % 360 - 180
        lat2_deg = math.degrees(lat2_r)
        coords.append([round(lon2_deg, 6), round(lat2_deg, 6)])

    return coords


def haversine_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Computes great-circle distance between two points in km."""
    r = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2)**2 + 
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2)**2)
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1 - a)))


def geo_router(records: Records | None = None) -> APIRouter:
    config = dotenv_values(ROOT / "backend/.env")
    tls_context = verified_tls(system_trust=True)
    shared_client: httpx.AsyncClient | None = None

    @asynccontextmanager
    async def lifespan(_app):
        nonlocal shared_client
        async with httpx.AsyncClient(verify=tls_context) as client:
            shared_client = client
            try:
                yield
            finally:
                shared_client = None

    @asynccontextmanager
    async def provider_client():
        if shared_client is not None:
            yield shared_client
        else:
            async with httpx.AsyncClient(verify=tls_context) as client:
                yield client

    router = APIRouter(prefix="/api/v1/geo", tags=["geo"], lifespan=lifespan)

    @router.post("/trip-share")
    def share_trip(trip: TripShareRequest):
        url = trip.maps_url()
        barcode = zxingcpp.create_barcode(url, zxingcpp.BarcodeFormat.QRCode)
        return {"url": url, "svg": zxingcpp.write_barcode_to_svg(barcode)}

    @router.post("/place-share")
    def share_place(place: TripSharePoint):
        url = "https://www.google.com/maps/search/?" + urlencode({
            "api": 1, "query": f"{place.lat},{place.lon}",
        })
        barcode = zxingcpp.create_barcode(url, zxingcpp.BarcodeFormat.QRCode)
        return {"url": url, "svg": zxingcpp.write_barcode_to_svg(barcode)}

    modes = {"driving": "driving", "walking": "foot", "cycling": "bike"}

    def setting(name):
        return os.getenv(name, config.get(name))

    def routing_url(mode):
        return setting(f"ORACLE_OSRM_{mode.upper()}_URL") or (
            "https://router.project-osrm.org" if mode == "driving" else None
        )

    nominatim_url = (setting("ORACLE_NOMINATIM_URL") or "https://nominatim.openstreetmap.org").rstrip("/")

    @router.get("/providers")
    async def providers(check: bool = False):
        probes = {
            mode: (f"{base.rstrip('/')}/nearest/v1/{profile}/79.8612,6.9271" if (base := routing_url(mode)) else None)
            for mode, profile in modes.items()
        }
        probes["place_search"] = f"{nominatim_url}/status?format=json"
        for name, variable in (("reachability", "ORACLE_VALHALLA_URL"), ("traffic_routing", "ORACLE_VALHALLA_TRAFFIC_URL")):
            base = setting(variable)
            probes[name] = f"{base.rstrip('/')}/status" if base else None

        async def probe(client, name, url):
            if not url:
                return name, "not_configured"
            try:
                response = await client.get(url, timeout=4.0, headers={"User-Agent": "ORACLE-Atlas/1.0"})
                if response.is_success or (name in modes and response.status_code == 400
                                           and response.json().get("code") == "NoSegment"):
                    return name, "reachable"
            except httpx.TimeoutException:
                return name, "timeout"
            except (httpx.HTTPError, ValueError):
                pass
            return name, "unavailable"

        if not check:
            return {
                "providers": {name: "configured" if url else "not_configured" for name, url in probes.items()},
                "checked_at": None,
            }
        async with provider_client() as client:
            results = await asyncio.gather(*(probe(client, name, url) for name, url in probes.items()))
        return {"providers": dict(results), "checked_at": datetime.now(timezone.utc).isoformat()}

    @router.get("/search")
    async def search_places(
        q: str = Query(min_length=1, max_length=150),
        lat: float | None = None,
        lon: float | None = None,
        limit: int = Query(default=5, ge=1, le=10),
        language: Literal["en", "si", "ta"] = "en",
        sri_lanka: bool = False,
    ):
        """Dynamic place search querying OpenStreetMap / Nominatim with optional proximity bias."""
        clean_q = unicodedata.normalize("NFC", q.strip()).casefold()
        if not clean_q:
            return {"results": []}
        query_key = _place_name_key(clean_q)
        query_words = set(query_key.split())
        has_origin = lat is not None and lon is not None and -90 <= lat <= 90 and -180 <= lon <= 180
        cache_key = f"{clean_q}_{lat}_{lon}_{limit}_{language}_{sri_lanka}"
        if (cached := _cached_geocode(cache_key)) is not None:
            return {"results": cached}

        url = f"{nominatim_url}/search"
        headers = {
            "User-Agent": "ORACLE-JARVIS-Presence-Assistant/1.0 (spatial-intelligence)"
        }
        params: dict[str, Any] = {
            "q": q.strip(),
            "format": "json",
            "limit": min(limit * 2, 20),
            "addressdetails": 1,
            "namedetails": 1,
            "accept-language": ",".join(dict.fromkeys([language, "en", "si", "ta"])),
        }
        if sri_lanka:
            params["countrycodes"] = "lk"

        # If user coordinates are provided, bias the search around the user's location (within ~50km box)
        if has_origin:
            delta = 0.5  # ~50km
            params["viewbox"] = f"{lon - delta},{lat + delta},{lon + delta},{lat - delta}"
            params["bounded"] = 0  # Prefer within viewbox, but don't strictly exclude

        try:
            async with provider_client() as client:
                resp = await client.get(url, params=params, headers=headers, timeout=4.0)
                if resp.status_code == 200:
                    data = resp.json()
                    if not data and query_key and query_key.isascii() and query_key != clean_q:
                        fallback = await client.get(url, params={**params, "q": query_key}, headers=headers, timeout=4.0)
                        fallback.raise_for_status()
                        data = fallback.json()
                    results = []
                    for item in data:
                        address = item.get("address", {})
                        names = item.get("namedetails", {})
                        name = item.get("name") or item.get("display_name", "").split(",")[0]
                        aliases = list(dict.fromkeys(
                            alias.strip()
                            for key in ("name:en", "name:si", "name:ta", "name:si-Latn", "name:ta-Latn",
                                        "int_name", "alt_name", "alt_name:en", "alt_name:si", "alt_name:ta",
                                        "alt_name:si-Latn", "alt_name:ta-Latn", "loc_name")
                            for alias in (names.get(key) or "").split(";")
                            if alias.strip() and alias.strip() != name
                        ))
                        locality = next((address[key] for key in
                            ("city", "town", "village", "hamlet", "suburb", "municipality")
                            if address.get(key)), None)
                        district = address.get("state_district") or address.get("county") or address.get("state")
                        results.append({
                            "place_id": str(item.get("place_id")),
                            "name": name,
                            "aliases": aliases,
                            "locality": ", ".join(dict.fromkeys(part for part in (locality, district) if part)),
                            "display_name": item.get("display_name", ""),
                            "lat": float(item.get("lat")),
                            "lon": float(item.get("lon")),
                            "category": item.get("type", "place")
                        })
                    def rank(place):
                        names = [unicodedata.normalize("NFC", value).casefold()
                                 for value in [place["name"], *place["aliases"]]]
                        match = 3
                        if clean_q in names:
                            match = 0
                        elif query_key and any(query_key == _place_name_key(name) for name in names):
                            match = 1
                        elif query_words:
                            context = _place_name_key(" ".join([*names, place["display_name"], place["locality"]]))
                            if query_words.issubset(context.split()):
                                match = 2
                        distance = haversine_distance_km(lat, lon, place["lat"], place["lon"]) if has_origin and match <= 1 else 0
                        return match, distance

                    results = sorted(results, key=rank)[:limit]
                    _cache_geocode(cache_key, results)
                    return {"results": results}
        except Exception as e:
            logger.warning(f"Nominatim geocoding failed: {e}")

        raise HTTPException(503, "Place search is unavailable")

    @router.get("/nearby")
    async def get_nearby_places(
        lat: float,
        lon: float,
        category: Literal["hospital", "fuel", "pharmacy", "food", "atm"] = "hospital",
        limit: int = Query(default=5, ge=1, le=10)
    ):
        """Dynamic nearby POI discovery around the user's real location using Nominatim."""
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise HTTPException(422, "Invalid nearby search coordinates")
        cache_key = f"nearby_{category}_{lat}_{lon}_{limit}"
        if (cached := _cached_geocode(cache_key)) is not None:
            return {"results": cached}

        # Define search term for category
        category_queries = {
            "hospital": "hospital",
            "fuel": "fuel station",
            "pharmacy": "pharmacy",
            "food": "restaurant",
            "atm": "atm"
        }
        search_query = category_queries.get(category, category)

        url = f"{nominatim_url}/search"
        headers = {
            "User-Agent": "ORACLE-JARVIS-Presence-Assistant/1.0 (spatial-intelligence)"
        }
        params = {
            "amenity": search_query,
            "format": "json",
            "limit": 30,
            "bounded": 1,
            "addressdetails": 1
        }

        try:
            async with provider_client() as client:
                results = {}
                for delta in (0.05, 0.25):
                    viewbox = f"{max(-180, lon - delta)},{min(90, lat + delta)},{min(180, lon + delta)},{max(-90, lat - delta)}"
                    resp = await client.get(url, params={**params, "viewbox": viewbox}, headers=headers, timeout=4.0)
                    if not resp.is_success and results:
                        break
                    resp.raise_for_status()
                    data = resp.json()
                    for item in data:
                        item_lat = float(item.get("lat"))
                        item_lon = float(item.get("lon"))
                        dist = haversine_distance_km(lat, lon, item_lat, item_lon)
                        place_id = str(item["place_id"])
                        results[place_id] = {
                            "place_id": place_id,
                            "name": item.get("name") or item.get("display_name", "").split(",")[0],
                            "display_name": item.get("display_name", ""),
                            "lat": item_lat,
                            "lon": item_lon,
                            "category": category,
                            "distance_km": dist
                        }
                    if len(results) >= limit:
                        break
                ranked = sorted(results.values(), key=lambda place: place["distance_km"])[:limit]
                for place in ranked:
                    place["distance_km"] = round(place["distance_km"], 2)
                _cache_geocode(cache_key, ranked)
                return {"results": ranked}
        except Exception as e:
            logger.warning(f"Nearby search for {category} failed: {e}")

        raise HTTPException(503, "Nearby search is unavailable")

    @router.get("/route")
    async def get_route(
        start_lat: float = Query(ge=-90, le=90),
        start_lon: float = Query(ge=-180, le=180),
        end_lat: float = Query(ge=-90, le=90),
        end_lon: float = Query(ge=-180, le=180),
        mode: Literal["driving", "walking", "cycling"] = "driving",
        stop: list[str] = Query(default=[], max_length=8),
        optimize: bool = False,
        traffic: bool = False,
        arrive_by: str | None = None,
    ):
        """Build a mode-specific OSRM route or a time-dependent Valhalla driving route."""
        osrm_profile = modes[mode]
        base_url = routing_url(mode)
        traffic_url = setting("ORACLE_VALHALLA_TRAFFIC_URL") if traffic and mode == "driving" else None
        if traffic and not traffic_url:
            return {"status": "unavailable", "reason": "provider_not_configured"}
        if not base_url:
            return {"status": "unavailable", "reason": "provider_not_configured"}
        date_time = {"type": 0}
        if arrive_by:
            try:
                arrival = datetime.strptime(arrive_by, "%Y-%m-%dT%H:%M")
            except ValueError:
                raise HTTPException(422, "Invalid local arrival time") from None
            date_time = {"type": 2, "value": arrival.isoformat(timespec="minutes")}
        coordinates = [(start_lon, start_lat)]
        for point in stop:
            try:
                lon, lat = map(float, point.split(","))
            except ValueError:
                raise HTTPException(422, "Invalid route stop") from None
            if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                raise HTTPException(422, "Invalid route stop")
            coordinates.append((lon, lat))
        coordinates.append((end_lon, end_lat))
        def path_for(points):
            return ";".join(f"{lon},{lat}" for lon, lat in points)

        root = base_url.rstrip("/")
        optimization = None
        try:
            async with provider_client() as client:
                if optimize and len(stop) > 1:
                    matrix = await client.get(f"{root}/table/v1/{osrm_profile}/{path_for(coordinates)}", timeout=4.5)
                    matrix.raise_for_status()
                    durations = matrix.json()["durations"]
                    last = len(coordinates) - 1

                    def duration(order):
                        route = (0, *order, last)
                        return sum(durations[a][b] if durations[a][b] is not None else math.inf
                                   for a, b in zip(route, route[1:]))

                    original = tuple(range(1, last))
                    ordered = min(permutations(original), key=duration)
                    before, after = duration(original), duration(ordered)
                    if not math.isfinite(after):
                        return {"status": "unavailable", "reason": "no_route"}
                    coordinates = [coordinates[index] for index in (0, *ordered, last)]
                    optimization = {
                        "order": [index - 1 for index in ordered],
                        "original_seconds": before if math.isfinite(before) else None,
                        "optimized_seconds": after,
                    }
                if traffic_url:
                    request = {
                        "locations": [{"lon": lon, "lat": lat, "type": "break"} for lon, lat in coordinates],
                        "costing": "auto", "format": "osrm", "shape_format": "geojson",
                        "date_time": date_time,
                        "costing_options": {"auto": {"exclude_closures": True}},
                    }
                    resp = await client.post(f"{traffic_url.rstrip('/')}/route", json=request, timeout=4.5)
                else:
                    resp = await client.get(f"{root}/route/v1/{osrm_profile}/{path_for(coordinates)}",
                                            params={"overview": "full", "geometries": "geojson", "steps": "true",
                                                    "alternatives": "true" if not stop else "false"}, timeout=4.5)
                if resp.status_code in (200, 400, 404):
                    data = resp.json()
                    if data.get("code") in {"NoRoute", "NoSegment"} or data.get("error_code") in {170, 171, 442}:
                        return {"status": "unavailable", "reason": "no_route"}
                    if resp.is_success and data.get("code") == "Ok" and data.get("routes"):
                        primary = data["routes"][0]
                        alternatives = data["routes"][1:] if len(data["routes"]) > 1 else []
                        return {
                            "status": "success",
                            "source": "valhalla_time_dependent" if traffic_url else "osrm",
                            "calculated_at": datetime.now(timezone.utc).isoformat(),
                            "distance_meters": primary.get("distance", 0),
                            "duration_seconds": primary.get("duration", 0),
                            "geometry": primary.get("geometry"),
                            "legs": primary.get("legs", []),
                            "optimization": optimization,
                            "alternatives": [
                                {
                                    "distance_meters": alt.get("distance", 0),
                                    "duration_seconds": alt.get("duration", 0),
                                    "geometry": alt.get("geometry"),
                                    "legs": alt.get("legs", []),
                                }
                                for alt in alternatives
                            ]
                        }
        except httpx.TimeoutException:
            return {"status": "unavailable", "reason": "provider_timeout"}
        except (httpx.HTTPError, ValueError, TypeError, KeyError, IndexError) as exc:
            logger.warning("Route calculation failed: %s", type(exc).__name__)

        return {"status": "unavailable", "reason": "provider_error"}

    def storage() -> Records:
        if records is None:
            raise HTTPException(503, "Atlas storage is unavailable")
        return records

    def read_parking():
        with storage().connect() as db:
            return db.scalar(select(atlas_locations.c.data).where(atlas_locations.c.id == "parking"))

    def write_parking(parking):
        with storage().connect(write=True) as db:
            factory = pg_insert if db.dialect.name == "postgresql" else sqlite_insert
            statement = factory(atlas_locations).values(id="parking", data=parking)
            db.execute(statement.on_conflict_do_update(index_elements=["id"], set_={"data": parking}))

    def read_places():
        with storage().connect() as db:
            return sorted(
                db.scalars(select(atlas_locations.c.data).where(atlas_locations.c.id != "parking")).all(),
                key=lambda place: (place["created_at"], place["id"]),
            )

    def remove_location(location_id):
        with storage().connect(write=True) as db:
            db.execute(delete(atlas_locations).where(atlas_locations.c.id == location_id))

    @router.get("/parking")
    async def get_saved_parking():
        parking = await run_in_threadpool(read_parking)
        return {"saved": parking is not None, "parking": parking}

    @router.post("/parking")
    async def save_parking_spot(req: ParkingSaveRequest):
        parking = {
            "lat": req.lat,
            "lon": req.lon,
            "floor_level": req.floor_level or "Street Level",
            "landmark_note": req.landmark_note or "Vehicle location marked",
            "saved_at": Records.now(),
        }
        if req.photo:
            parking["photo"] = req.photo
        await run_in_threadpool(write_parking, parking)
        return {"saved": True, "parking": parking}

    @router.delete("/parking")
    async def delete_parking_spot():
        await run_in_threadpool(remove_location, "parking")
        return {"saved": False}

    @router.get("/places")
    async def get_saved_places():
        return {"places": await run_in_threadpool(read_places)}

    @router.post("/places")
    def add_saved_place(req: PlaceSaveRequest):
        place = {
            "id": str(uuid4()),
            "name": req.name,
            "lat": req.lat,
            "lon": req.lon,
            "display_name": req.display_name or req.name,
            "category": req.category or "custom",
            "created_at": Records.now(),
        }
        with storage().connect(write=True) as db:
            db.execute(insert(atlas_locations).values(id=place["id"], data=place))
        return {"status": "saved", "place": place}

    @router.delete("/places/{place_id}")
    async def delete_saved_place(place_id: str):
        if place_id == "parking":
            raise HTTPException(404, "Place not found")
        await run_in_threadpool(remove_location, place_id)
        return {"status": "deleted", "places": await run_in_threadpool(read_places)}

    @router.get("/reverse")
    async def reverse_geocode(lat: float, lon: float):
        """Dynamic reverse geocoding returning formatted place address and metadata."""
        cache_key = f"rev_{round(lat, 5)}_{round(lon, 5)}"
        if (cached := _cached_geocode(cache_key)) is not None:
            return cached

        url = f"{nominatim_url}/reverse"
        headers = {
            "User-Agent": "ORACLE-JARVIS-Presence-Assistant/1.0 (spatial-intelligence)"
        }
        params = {
            "lat": lat,
            "lon": lon,
            "format": "json",
            "addressdetails": 1
        }
        try:
            async with provider_client() as client:
                resp = await client.get(url, params=params, headers=headers, timeout=4.0)
                if resp.status_code == 200:
                    data = resp.json()
                    res = {
                        "display_name": data.get("display_name", f"{lat:.4f}, {lon:.4f}"),
                        "name": data.get("name") or data.get("display_name", "").split(",")[0],
                        "lat": lat,
                        "lon": lon,
                        "address": data.get("address", {}),
                        "crs": "EPSG:4326",
                        "attribution": "© OpenStreetMap contributors"
                    }
                    _cache_geocode(cache_key, res)
                    return res
        except Exception as e:
            logger.warning(f"Reverse geocode failed: {e}")

        return {
            "display_name": f"Coordinates ({lat:.4f}°, {lon:.4f}°)",
            "name": f"Pin ({lat:.4f}, {lon:.4f})",
            "lat": lat,
            "lon": lon,
            "address": {},
            "crs": "EPSG:4326",
            "attribution": "WGS84 Calculated"
        }

    @router.post("/buffer")
    async def calculate_buffer(req: BufferRequest):
        """Computes true geodesic circular buffer polygon, area, and bounding envelope."""
        ring = geodesic_circle_polygon(req.lat, req.lon, req.radius_km, req.steps)
        area_sqm = geodesic_polygon_area_sqm(ring)
        area_ha = round(area_sqm / 10000.0, 2)
        area_sqkm = round(area_sqm / 1000000.0, 2)

        lons = [p[0] for p in ring]
        lats = [p[1] for p in ring]
        bbox = [min(lons), min(lats), max(lons), max(lats)]

        geojson = {
            "type": "Feature",
            "properties": {
                "name": f"{req.radius_km} km Geodesic Buffer",
                "center": [req.lon, req.lat],
                "radius_km": req.radius_km,
                "radius_meters": req.radius_km * 1000.0,
                "area_sqm": area_sqm,
                "area_ha": area_ha,
                "area_sqkm": area_sqkm,
                "crs": "EPSG:4326",
                "method": "geodesic spherical calculation"
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [ring]
            }
        }
        return {
            "status": "success",
            "feature": geojson,
            "radius_km": req.radius_km,
            "area_sqm": area_sqm,
            "area_ha": area_ha,
            "area_sqkm": area_sqkm,
            "bbox": bbox,
            "crs": "EPSG:4326"
        }

    @router.post("/measure")
    async def calculate_measurements(req: MeasureRequest):
        """Computes geodesic path distance and polygon area with true Earth curvature."""
        dist_m = geodesic_line_length_meters(req.coordinates)
        dist_km = round(dist_m / 1000.0, 3)

        area_sqm = 0.0
        area_ha = 0.0
        if req.is_closed_polygon and len(req.coordinates) >= 3:
            coords = list(req.coordinates)
            if coords[0] != coords[-1]:
                coords.append(coords[0])
            area_sqm = geodesic_polygon_area_sqm(coords)
            area_ha = round(area_sqm / 10000.0, 2)

        return {
            "distance_meters": dist_m,
            "distance_km": dist_km,
            "area_sqm": area_sqm,
            "area_ha": area_ha,
            "point_count": len(req.coordinates),
            "crs": "EPSG:4326",
            "method": "geodesic haversine and spherical excess"
        }

    @router.post("/isochrone")
    async def calculate_isochrone(req: IsochroneRequest):
        """Computes travel-time reachability area isochrone polygon."""
        provider = os.getenv("ORACLE_VALHALLA_URL", config.get("ORACLE_VALHALLA_URL"))
        source = "approximate"
        if provider:
            costing = {"driving": "auto", "walking": "pedestrian", "cycling": "bicycle"}[req.mode]
            query = {"locations": [{"lat": req.lat, "lon": req.lon}], "costing": costing,
                     "contours": [{"time": req.minutes}], "polygons": True}
            try:
                async with provider_client() as client:
                    response = await client.get(f"{provider.rstrip('/')}/isochrone", params={"json": json.dumps(query)}, timeout=6.0)
                    response.raise_for_status()
                geometry = response.json()["features"][0]["geometry"]
                if geometry["type"] not in {"Polygon", "MultiPolygon"}:
                    raise ValueError("Expected polygon reachability")
                source = "road_network"
            except (httpx.HTTPError, IndexError, KeyError, TypeError, ValueError) as exc:
                logger.warning("Valhalla reachability unavailable: %s", exc)
        if source == "approximate":
            polygon = generate_isochrone_polygon(req.lat, req.lon, req.minutes, req.mode)
            geometry = {"type": "Polygon", "coordinates": [polygon]}
        polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
        area_sqm = sum(geodesic_polygon_area_sqm(outer) - sum(map(geodesic_polygon_area_sqm, holes))
                       for outer, *holes in polygons)
        area_sqkm = round(area_sqm / 1000000.0, 2)

        geojson = {
            "type": "Feature",
            "properties": {
                "name": f"{req.minutes}-min {req.mode.capitalize()} Reachability Area",
                "center": [req.lon, req.lat],
                "minutes": req.minutes,
                "mode": req.mode,
                "source": source,
                "area_sqkm": area_sqkm,
                "crs": "EPSG:4326"
            },
            "geometry": geometry
        }
        return {
            "status": "success",
            "feature": geojson,
            "minutes": req.minutes,
            "mode": req.mode,
            "source": source,
            "area_sqkm": area_sqkm
        }

    @router.post("/command")
    async def process_geo_command(req: GeoCommandRequest):
        """Dynamic natural language geospatial intent and navigation processor."""
        text = req.text.strip().lower()
        start_lat = req.current_lat
        start_lon = req.current_lon

        if start_lat is None or start_lon is None:
            return {
                "intent": "LOCATION_REQUIRED",
                "spoken_response": "I need your current location to calculate navigation. Please enable location access.",
                "action": "request_location"
            }

        # 1. Intent: Parking Query
        if re.search(r"\b(?:parked|parking|where did i park|where is my car)\b", text):
            parking = await run_in_threadpool(read_parking)
            if parking:
                dist = haversine_distance_km(start_lat, start_lon, parking["lat"], parking["lon"])
                route = await get_route(start_lat, start_lon, parking["lat"], parking["lon"], mode="walking", stop=[])
                note = parking.get("floor_level", "")
                return {
                    "intent": "PARKING_RETURN",
                    "destination": {
                        "name": f"Parked Vehicle ({note})",
                        "lat": parking["lat"],
                        "lon": parking["lon"]
                    },
                    "route": route,
                    "spoken_response": (
                        f"Your vehicle is parked at {note}, {round(dist, 2)} kilometers away in a straight line. "
                        + ("Walking route ready." if route["status"] == "success" else "A walking route is unavailable.")
                    ),
                    "action": "open_map"
                }
            else:
                return {
                    "intent": "NO_PARKING_SAVED",
                    "spoken_response": "You haven't saved a parking location yet. You can click 'Save Parking' to mark your current spot.",
                    "action": "open_map"
                }

        # 2. Intent: Nearby Amenities (Hospital / Fuel / Food / Pharmacy)
        amenity_type = None
        if re.search(r'\b(hospitals?|medical|doctor|er|emergency|clinic)\b', text):
            amenity_type = "hospital"
        elif re.search(r'\b(fuel|gas|petrol|charging)\b', text):
            amenity_type = "fuel"
        elif re.search(r'\b(pharmacy|pharmacies|chemist|medicine)\b', text):
            amenity_type = "pharmacy"
        elif re.search(r'\b(food|restaurant|cafe|coffee|dining)\b', text):
            amenity_type = "food"
        elif re.search(r'\batms?\b', text):
            amenity_type = "atm"

        if amenity_type:
            nearby = await get_nearby_places(start_lat, start_lon, category=amenity_type, limit=8)
            results = nearby.get("results", [])
            if results:
                target = results[0]
                route = await get_route(start_lat, start_lon, target["lat"], target["lon"], stop=[])
                return {
                    "intent": f"NEARBY_{amenity_type.upper()}",
                    "destination": target,
                    "route": route,
                    "spoken_response": (
                        f"Nearby {amenity_type}: {target['name']}, {target['distance_km']} km away in a straight line. "
                        + ("Route ready." if route["status"] == "success" else "A route is unavailable.")
                    ),
                    "action": "open_map"
                }
            else:
                return {
                    "intent": f"NEARBY_{amenity_type.upper()}_NOT_FOUND",
                    "spoken_response": f"Searching for nearby {amenity_type}s in your vicinity. Opening map view.",
                    "action": "open_map"
                }

        # 3. Intent: GIS Geodesic Buffer Analysis
        if "buffer" in text or "radius" in text:
            match = re.search(r'(\d+(?:\.\d+)?)\s*(km|kilometer|kilometers|m|meter|meters|mile|miles)?', text)
            rad_km = 3.0
            if match:
                val = float(match.group(1))
                unit = (match.group(2) or "km").lower()
                if "mile" in unit:
                    rad_km = val * 1.60934
                elif "m" in unit and "km" not in unit:
                    rad_km = val / 1000.0
                else:
                    rad_km = val
            rad_km = max(0.1, min(100.0, rad_km))
            buf = await calculate_buffer(BufferRequest(lat=start_lat, lon=start_lon, radius_km=rad_km))
            return {
                "intent": "GIS_BUFFER",
                "buffer": buf,
                "spoken_response": f"Generated a {rad_km} kilometer geodesic buffer around your current position. Enclosed area is approximately {buf['area_ha']} hectares.",
                "action": "open_map"
            }

        # 4. Intent: Travel-Time Isochrone Reachability
        if "isochrone" in text or "reachab" in text or ("reach" in text and any(w in text for w in ["minute", "min", "hour"])):
            mins_match = re.search(r'(\d+)\s*(?:min|minute|minutes)', text)
            minutes = max(1, min(120, int(mins_match.group(1)))) if mins_match else 15
            mode = "cycling" if any(w in text for w in ["cycle", "cycling", "bike", "bicycle"]) else "walking" if any(w in text for w in ["walk", "walking", "foot"]) else "driving"
            iso = await calculate_isochrone(IsochroneRequest(lat=start_lat, lon=start_lon, minutes=minutes, mode=mode))
            description = "Approximate" if iso["source"] == "approximate" else "Road-network"
            return {
                "intent": "GIS_ISOCHRONE",
                "isochrone": iso,
                "spoken_response": f"{description} {minutes}-minute {mode} reachability area. Reachable surface covers {iso['area_sqkm']} square kilometers.",
                "action": "open_map"
            }

        # 5. Intent: General Destination (e.g., "navigate to...", "route to...", "take me to...")
        # Detect travel mode if specified
        mode = "cycling" if any(w in text for w in ["cycle", "cycling", "bike", "bicycle"]) else "walking" if any(w in text for w in ["walk", "walking", "foot"]) else "driving"

        # Extract target query by removing conversational prefixes
        query = re.sub(r'^(oracle|hey oracle|please|can you|show me|navigate to|route to|fastest route to|directions to|how to go to|where is|drive to|walk to|cycle to)\s+', '', text, flags=re.IGNORECASE).strip()
        if not query:
            query = text

        search_res = await search_places(q=query, lat=start_lat, lon=start_lon, limit=1)
        results = search_res.get("results", [])

        if results:
            target = results[0]
            route = await get_route(start_lat, start_lon, target["lat"], target["lon"], mode=mode, stop=[])
            summary = f"Found {target['name']}. A {mode} route is unavailable."
            if route["status"] == "success":
                summary = (f"Course plotted for {target['name']}. Distance is {route['distance_meters'] / 1000:.1f} km. "
                           f"Estimated travel time is {round(route['duration_seconds'] / 60)} minutes.")

            return {
                "intent": "ROUTE_PLAN",
                "destination": target,
                "route": route,
                "mode": mode,
                "spoken_response": summary,
                "action": "open_map"
            }

        return {
            "intent": "UNKNOWN_LOCATION",
            "spoken_response": f"I couldn't resolve the location for '{query}'. Please check the destination name.",
            "action": "open_map"
        }

    return router
