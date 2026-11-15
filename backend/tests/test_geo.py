import pytest
import json
from collections import OrderedDict
from httpx import AsyncClient, ASGITransport, MockTransport, ReadTimeout, Response
from sqlalchemy.engine import URL
from app.geo import _GEOCODE_CACHE
from app.main import create_app
from app.records import Records

@pytest.mark.anyio
@pytest.mark.parametrize("status", [200, 503])
async def test_geo_search_dynamic(monkeypatch, status):
    def respond(request):
        assert request.url.params["q"] == "Atlas test location"
        return Response(status, json=[])

    monkeypatch.setattr("app.geo.httpx.AsyncClient", lambda **_: AsyncClient(transport=MockTransport(respond)))
    key = "atlas test location_None_None_5_en_False"
    monkeypatch.delitem(_GEOCODE_CACHE, key, raising=False)
    app = create_app(token='test-token')
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url='http://test') as client:
        resp = await client.get('/api/v1/geo/search', params={"q": "Atlas test location"},
                                headers={'Authorization': 'Bearer test-token'})
        assert resp.status_code == status
        if status == 200:
            assert resp.json() == {"results": []}
            _GEOCODE_CACHE.pop(key, None)


@pytest.mark.anyio
async def test_atlas_search_language_and_locality(monkeypatch):
    def respond(request):
        assert request.url.params["q"] == "யாழ்ப்பாணம்"
        assert request.url.params["countrycodes"] == "lk"
        assert request.url.params["accept-language"] == "ta,en,si"
        return Response(200, json=[{
            "name": "யாழ்ப்பாணம்", "display_name": "Jaffna, Sri Lanka", "place_id": 1,
            "lat": "9.66", "lon": "80.02",
            "address": {"city": "Jaffna", "state_district": "Jaffna District"},
            "namedetails": {"name:en": "Jaffna", "name:ta": "யாழ்ப்பாணம்"}
        }])

    monkeypatch.setattr("app.geo.httpx.AsyncClient", lambda **_: AsyncClient(transport=MockTransport(respond)))
    app = create_app(token="test-token")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        result = await client.get("/api/v1/geo/search", params={"q": "யாழ்ப்பாணம்", "language": "ta", "sri_lanka": True},
                                  headers={"Authorization": "Bearer test-token"})
        assert result.status_code == 200
        place = result.json()["results"][0]
        assert place["aliases"] == ["Jaffna"]
        assert place["locality"] == "Jaffna, Jaffna District"
    _GEOCODE_CACHE.pop("யாழ்ப்பாணம்_None_None_5_ta_True", None)

@pytest.mark.anyio
@pytest.mark.parametrize(("mode", "profile"), [("driving", "driving"), ("walking", "foot"), ("cycling", "bike")])
@pytest.mark.parametrize("provider_available", [True, False])
async def test_geo_route_calculation(monkeypatch, provider_available, mode, profile):
    geometry = {"type": "LineString", "coordinates": [[-0.1278, 51.5074], [-0.1419, 51.5155]]}

    def respond(request):
        assert request.url.host == "routing.test"
        assert request.url.path.startswith(f"/route/v1/{profile}/")
        if not provider_available:
            return Response(503)
        return Response(200, json={"code": "Ok", "routes": [
            {"distance": 1600, "duration": 300, "geometry": geometry}
        ]})

    monkeypatch.setenv(f"ORACLE_OSRM_{mode.upper()}_URL", "https://routing.test")
    monkeypatch.setattr("app.geo.httpx.AsyncClient", lambda **_: AsyncClient(transport=MockTransport(respond)))
    app = create_app(token='test-token')
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url='http://test') as client:
        resp = await client.get(
            f'/api/v1/geo/route?start_lat=51.5074&start_lon=-0.1278&end_lat=51.5155&end_lon=-0.1419&mode={mode}',
            headers={'Authorization': 'Bearer test-token'}
        )
        assert resp.status_code == 200
        data = resp.json()
        if provider_available:
            assert data['status'] == 'success'
            assert data['distance_meters'] == 1600
            assert data['geometry'] == geometry
        else:
            assert data == {'status': 'unavailable', 'reason': 'provider_error'}


@pytest.mark.anyio
@pytest.mark.parametrize("reason", ["provider_timeout", "no_route"])
async def test_atlas_route_failure_reason(monkeypatch, reason):
    def respond(request):
        if reason == "provider_timeout":
            raise ReadTimeout("Timed out", request=request)
        return Response(400, json={"code": "NoRoute"})

    monkeypatch.setenv("ORACLE_OSRM_DRIVING_URL", "https://routing.test")
    monkeypatch.setattr("app.geo.httpx.AsyncClient", lambda **_: AsyncClient(transport=MockTransport(respond)))
    app = create_app(token="test-token")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/v1/geo/route?start_lat=1&start_lon=1&end_lat=2&end_lon=2",
                                    headers={"Authorization": "Bearer test-token"})
        assert response.json() == {"status": "unavailable", "reason": reason}


@pytest.mark.anyio
async def test_atlas_time_dependent_route_and_provider_probe(monkeypatch):
    geometry = {"type": "LineString", "coordinates": [[79.8, 6.9], [79.9, 7.0]]}

    def respond(request):
        if request.method == "GET":
            return Response(200, json={"version": "test"})
        assert request.url.host == "traffic.test" and request.url.path == "/route"
        body = json.loads(request.content)
        assert body["date_time"] == {"type": 2, "value": "2026-12-20T09:00"}
        assert body["shape_format"] == "geojson"
        assert body["costing_options"]["auto"]["exclude_closures"] is True
        return Response(200, json={"code": "Ok", "routes": [{"distance": 1000, "duration": 600, "geometry": geometry}]})

    monkeypatch.setenv("ORACLE_VALHALLA_TRAFFIC_URL", "https://traffic.test")
    monkeypatch.setattr("app.geo.httpx.AsyncClient", lambda **_: AsyncClient(transport=MockTransport(respond)))
    app = create_app(token="test-token")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test",
                           headers={"Authorization": "Bearer test-token"}) as client:
        configuration = (await client.get("/api/v1/geo/providers")).json()
        assert configuration["providers"]["traffic_routing"] == "configured"
        status = (await client.get("/api/v1/geo/providers?check=true")).json()
        assert status["providers"]["traffic_routing"] == "reachable"
        assert status["checked_at"]
        result = (await client.get("/api/v1/geo/route", params={
            "start_lat": 6.9, "start_lon": 79.8, "end_lat": 7.0, "end_lon": 79.9,
            "traffic": True, "arrive_by": "2026-12-20T09:00"
        })).json()
        assert result["status"] == "success"
        assert result["source"] == "valhalla_time_dependent"
        assert result["geometry"] == geometry

@pytest.mark.anyio
async def test_geo_parking_dynamic_flow(tmp_path):
    url = URL.create("sqlite", database=str(tmp_path / "records.sqlite3"))
    records = Records(url)
    app = create_app(token='test-token', records=records)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url='http://test') as client:
        # Save a dynamic parking location
        save_resp = await client.post(
            '/api/v1/geo/parking',
            headers={'Authorization': 'Bearer test-token'},
            json={'lat': 40.7128, 'lon': -74.0060, 'floor_level': '3rd Floor', 'landmark_note': 'Near elevator'}
        )
        assert save_resp.status_code == 200
        assert save_resp.json()['saved'] is True
        assert save_resp.json()["parking"]["saved_at"] > 0

    records.engine.dispose()
    restarted = Records(url)
    app = create_app(token='test-token', records=restarted)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url='http://test') as client:

        # Retrieve saved parking
        get_resp = await client.get('/api/v1/geo/parking', headers={'Authorization': 'Bearer test-token'})
        assert get_resp.status_code == 200
        data = get_resp.json()
        assert data['saved'] is True
        assert data['parking']['floor_level'] == '3rd Floor'

        # Query parking via natural language command
        cmd_resp = await client.post(
            '/api/v1/geo/command',
            headers={'Authorization': 'Bearer test-token'},
            json={'text': 'where did I park my car', 'current_lat': 40.7100, 'current_lon': -74.0050}
        )
        assert cmd_resp.status_code == 200
        cmd_data = cmd_resp.json()
        assert cmd_data['intent'] == 'PARKING_RETURN'
        assert '3rd floor' in cmd_data['spoken_response'].lower()
        headers = {"Authorization": "Bearer test-token"}
        assert (await client.delete('/api/v1/geo/parking', headers=headers)).json() == {"saved": False}
        assert (await client.get('/api/v1/geo/parking', headers=headers)).json() == {"saved": False, "parking": None}
    restarted.engine.dispose()


@pytest.mark.anyio
async def test_geo_place_ids_survive_delete_and_restart(tmp_path):
    url = URL.create("sqlite", database=str(tmp_path / "records.sqlite3"))
    records = Records(url)
    app = create_app(token="test-token", records=records)
    headers = {"Authorization": "Bearer test-token"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test", headers=headers) as client:
        places = []
        for name in ["First", "Second", "Third"]:
            response = await client.post("/api/v1/geo/places", json={"name": name, "lat": 6.9, "lon": 79.8})
            assert response.status_code == 200
            places.append(response.json()["place"])
            if name == "Second":
                await client.delete(f"/api/v1/geo/places/{places[0]['id']}")
        assert len({place["id"] for place in places}) == 3
    records.engine.dispose()
    restarted = Records(url)
    app = create_app(token="test-token", records=restarted)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test", headers=headers) as client:
        assert (await client.get("/api/v1/geo/places")).json()["places"] == places[1:]
    restarted.engine.dispose()


@pytest.mark.anyio
async def test_geo_optimized_stop_order(monkeypatch):
    def respond(request):
        if "/table/" in request.url.path:
            assert request.url.path.endswith("1.0,1.0;2.0,2.0;3.0,3.0;4.0,4.0")
            return Response(200, json={"durations": [[0, 20, 1, 50], [20, 0, 20, 1],
                                                     [1, 1, 0, 20], [50, 1, 20, 0]]})
        assert request.url.path.endswith("1.0,1.0;3.0,3.0;2.0,2.0;4.0,4.0")
        assert request.url.params["alternatives"] == "false"
        return Response(200, json={"code": "Ok", "routes": [{"duration": 3}]})

    monkeypatch.setenv("ORACLE_OSRM_DRIVING_URL", "https://routing.test")
    monkeypatch.setattr("app.geo.httpx.AsyncClient", lambda **_: AsyncClient(transport=MockTransport(respond)))
    app = create_app(token="test-token")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get(
            "/api/v1/geo/route?start_lat=1&start_lon=1&end_lat=4&end_lon=4&stop=2,2&stop=3,3&optimize=true",
            headers={"Authorization": "Bearer test-token"},
        )
        assert response.json()["optimization"] == {"order": [1, 0], "original_seconds": 60, "optimized_seconds": 3}


@pytest.mark.anyio
@pytest.mark.parametrize("provider_available", [True, False])
async def test_geo_reachability_reports_provenance(monkeypatch, provider_available):
    geometry = {"type": "Polygon", "coordinates": [[[79.8, 6.9], [79.9, 6.9], [79.9, 7], [79.8, 6.9]]]}

    def respond(request):
        assert request.url.path == "/isochrone"
        assert '"costing": "pedestrian"' in request.url.params["json"]
        if not provider_available:
            return Response(503)
        return Response(200, json={"features": [{"geometry": geometry}]})

    monkeypatch.setenv("ORACLE_VALHALLA_URL", "https://reachability.test")
    monkeypatch.setattr("app.geo.httpx.AsyncClient", lambda **_: AsyncClient(transport=MockTransport(respond)))
    app = create_app(token="test-token")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/v1/geo/isochrone",
                                     json={"lat": 6.9, "lon": 79.8, "minutes": 15, "mode": "walking"},
                                     headers={"Authorization": "Bearer test-token"})
        assert response.status_code == 200
        result = response.json()
        assert result["source"] == ("road_network" if provider_available else "approximate")
        assert result["feature"]["properties"]["source"] == result["source"]
        if provider_available:
            assert result["feature"]["geometry"] == geometry

@pytest.mark.anyio
async def test_geo_gis_buffer_calculation():
    app = create_app(token='test-token')
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url='http://test') as client:
        resp = await client.post(
            '/api/v1/geo/buffer',
            headers={'Authorization': 'Bearer test-token'},
            json={'lat': 6.9271, 'lon': 79.8612, 'radius_km': 3.0}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data['status'] == 'success'
        assert data['radius_km'] == 3.0
        assert data['area_ha'] > 2700.0  # π * 3^2 km² = ~28.27 km² = ~2827 ha
        assert data['feature']['geometry']['type'] == 'Polygon'
        assert len(data['feature']['geometry']['coordinates'][0]) == 65  # 64 steps + 1 closure

@pytest.mark.anyio
async def test_geo_measure_calculation():
    app = create_app(token='test-token')
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url='http://test') as client:
        # Measure triangle
        coords = [
            [79.860, 6.920],
            [79.870, 6.920],
            [79.870, 6.930],
            [79.860, 6.920]
        ]
        resp = await client.post(
            '/api/v1/geo/measure',
            headers={'Authorization': 'Bearer test-token'},
            json={'coordinates': coords, 'is_closed_polygon': True}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data['distance_meters'] > 2000
        assert data['area_sqm'] > 100000

@pytest.mark.anyio
async def test_geo_command_gis_buffer():
    app = create_app(token='test-token')
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url='http://test') as client:
        resp = await client.post(
            '/api/v1/geo/command',
            headers={'Authorization': 'Bearer test-token'},
            json={'text': 'create 5 km buffer around here', 'current_lat': 6.9271, 'current_lon': 79.8612}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data['intent'] == 'GIS_BUFFER'
        assert '5.0 kilometer' in data['spoken_response']
        assert data['buffer']['radius_km'] == 5.0

@pytest.mark.anyio
async def test_nearby_expands_area_and_ranks_before_limiting(monkeypatch):
    requests = []

    def respond(request):
        assert request.url.params["amenity"] == "hospital"
        assert request.url.params["bounded"] == "1"
        assert request.url.params["limit"] == "30"
        requests.append(request.url.params["viewbox"])
        farther = {"place_id": 1, "name": "Farther", "lat": "6.94", "lon": "79.88"}
        nearer = {"place_id": 2, "name": "Nearer", "lat": "6.921", "lon": "79.861"}
        return Response(200, json=[farther] if len(requests) == 1 else [farther, nearer])

    monkeypatch.setattr("app.geo.httpx.AsyncClient", lambda **_: AsyncClient(transport=MockTransport(respond)))
    monkeypatch.setattr("app.geo._GEOCODE_CACHE", OrderedDict())
    app = create_app(token="test-token")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get(
            "/api/v1/geo/nearby",
            params={"lat": 6.92, "lon": 79.86, "category": "hospital", "limit": 2},
            headers={"Authorization": "Bearer test-token"},
        )

    assert response.status_code == 200
    assert [place["name"] for place in response.json()["results"]] == ["Nearer", "Farther"]
    assert len(requests) == 2 and requests[0] != requests[1]
