import { AtlasPlaceShare, AtlasTripShare } from './AtlasTripShare';
import type { BriefingTrip } from '../utils/briefing';
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Map, Marker, LngLatBounds, setWorkerUrl, type StyleSpecification, type GeoJSONSource, type MapMouseEvent } from 'maplibre-gl';
import buffer from '@turf/buffer';
import pointToLineDistance from '@turf/point-to-line-distance';
import type { FeatureCollection, Geometry, LineString, Position } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreglWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

// Direct MapLibre to use the bundled worker script rather than an invalid dev dependency URL
setWorkerUrl(maplibreglWorker);

import { 
  Search, 
  X, 
  Crosshair, 
  Volume2, 
  VolumeX,
  Car, 
  Footprints, 
  Bike,
  Building2, 
  Layers, 
  Map as MapIcon,
  Box,
  Sidebar,
  ArrowUpDown,
  Clock,
  Calendar,
  SlidersHorizontal,
  Compass,
  ParkingCircle, 
  Check, 
  ChevronDown, 
  ChevronUp,
  CircleDot,
  Upload,
  Download,
  Navigation,
  MapPin,
  Plus,
  Minus,
  CloudRain,
  Coffee,
  Zap,
  Fuel,
  Hospital,
  Plane,
  Play,
  Pause,
  FastForward,
  Sun,
  Bookmark,
  Keyboard,
  Radio,
  BellRing
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';
import { useAtlasReminders } from '../utils/atlasReminders';
import { buildRouteTrack, type RoutePoint } from '../utils/atlasNavigation';
import { speakWithKokoro } from '../utils/voice';
import { sfx } from '../utils/sfx';
import { AtlasFeatureInspector, emptySpatialFilter, filterAtlasFeatures, getAtlasCorridor, type AtlasArea, type AtlasLayer, type CorridorLine, type FeatureKey, type SpatialFilter } from './AtlasFeatureInspector';
import { atlasCsvFeatures, normalizeGeoJSON, parseAtlasCsv, parseAtlasXml } from '../utils/atlasImports';
import { AtlasElevation, type ElevationPoint, type ElevationProfile, getGradeColor } from './AtlasElevation';
import { parseAtlasSpatialCommand } from '../utils/atlasSpatialCommands';
import './GeoWorkspace.css';

const QUICK_SEARCH_CATEGORIES = [
  { label: 'Parking', query: 'parking', icon: ParkingCircle },
  { label: 'Coffee', query: 'coffee shop', icon: Coffee },
  { label: 'EV Charge', query: 'ev charging', icon: Zap },
  { label: 'Fuel', query: 'gas station', icon: Fuel },
  { label: 'Medical', query: 'hospital pharmacy', icon: Hospital },
] as const;

const terrainTiles = import.meta.env.VITE_ATLAS_TERRAIN_TILES as string | undefined;
const cyclingTiles = import.meta.env.VITE_ATLAS_CYCLING_TILES as string | undefined;
const cyclingAttribution = import.meta.env.VITE_ATLAS_CYCLING_ATTRIBUTION as string | undefined;
const trafficTiles = import.meta.env.VITE_ATLAS_TRAFFIC_TILES as string | undefined;
const localBasemapTiles = import.meta.env.VITE_ATLAS_LOCAL_BASEMAP_TILES as string | undefined;
const localBasemapAttribution = import.meta.env.VITE_ATLAS_LOCAL_BASEMAP_ATTRIBUTION as string | undefined;
const terrainAttribution = import.meta.env.VITE_ATLAS_TERRAIN_ATTRIBUTION as string | undefined;
const trafficAttribution = import.meta.env.VITE_ATLAS_TRAFFIC_ATTRIBUTION as string | undefined;
const radarTiles = (import.meta.env.VITE_ATLAS_RADAR_TILES as string | undefined) || 'https://tilecache.rainviewer.com/v2/radar/nowcast_latest/256/{z}/{x}/{y}/2/1_1.png';
const radarAttribution = (import.meta.env.VITE_ATLAS_RADAR_ATTRIBUTION as string | undefined) || 'RainViewer';

function calculatePathBearing(start: [number, number], end: [number, number]): number {
  const startLat = (start[1] * Math.PI) / 180;
  const startLon = (start[0] * Math.PI) / 180;
  const endLat = (end[1] * Math.PI) / 180;
  const endLon = (end[0] * Math.PI) / 180;
  const y = Math.sin(endLon - startLon) * Math.cos(endLat);
  const x = Math.cos(startLat) * Math.sin(endLat) - Math.sin(startLat) * Math.cos(endLat) * Math.cos(endLon - startLon);
  const b = (Math.atan2(y, x) * 180) / Math.PI;
  return (b + 360) % 360;
}

function computeSolarPosition(date: Date = new Date()): { azimuth: number; altitude: number } {
  const hours = date.getHours() + date.getMinutes() / 60;
  const azimuth = ((hours / 24) * 360 + 90) % 360;
  const altitude = Math.max(0, Math.sin(((hours - 6) / 12) * Math.PI) * 68);
  return { azimuth, altitude };
}

interface SpatialBookmark {
  id: string;
  name: string;
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
}

const bookmarksStorageKey = 'oracle_atlas_bookmarks_v1';

function geometryPositions(geometry: Geometry | null): Position[] {
  if (!geometry) return [];
  if (geometry.type === 'GeometryCollection') return geometry.geometries.flatMap(geometryPositions);
  const flatten = (positions: unknown): Position[] => {
    if (!Array.isArray(positions)) return [];
    if (positions.length >= 2 && positions.slice(0, 2).every(Number.isFinite)) return [positions];
    return positions.flatMap(flatten);
  };
  return flatten(geometry.coordinates);
}

interface GeoWorkspaceProps {
  onClose: () => void;
  children?: React.ReactNode;
  onVoiceTrigger?: () => void;
  command?: { text: string };
  briefingTrip?: BriefingTrip;
}

interface DestinationItem {
  name: string;
  display_name: string;
  lat: number;
  lon: number;
  category?: string;
  distance_km?: number;
  calendarTrip?: CalendarTrip;
  locality?: string;
  aliases?: string[];
  bearing?: string;
  nearbyOrigin?: RoutePoint;
  nearbyOriginName?: string;
}

type TravelMode = 'driving' | 'walking' | 'cycling';
type NearbyEstimate = { seconds: number; metres: number };
const travelModeLabels = { driving: 'drive', walking: 'walk', cycling: 'cycle' } as const;

interface SavedTrip {
  id: string;
  name: string;
  origin: DestinationItem | null;
  destination: DestinationItem;
  stops: DestinationItem[];
  mode: TravelMode;
  optimize: boolean;
  arrivalBuffer: number;
  traffic?: boolean;
}

interface CompletedTrip {
  id: string;
  destination: string;
  mode: TravelMode;
  completedAt: number;
}

const historyStorageKey = 'oracle_atlas_history_v1';
const historyOptInKey = 'oracle_atlas_history_enabled';
const tripStorageKey = 'oracle_atlas_trips_v1';

function readSavedTrips(): SavedTrip[] {
  try {
    const entries: unknown = JSON.parse(localStorage.getItem(tripStorageKey) || '[]');
    if (!Array.isArray(entries)) return [];
    const isPlace = (place: DestinationItem | null) => !!place && typeof place.name === 'string' &&
      typeof place.display_name === 'string' && Number.isFinite(place.lat) && Math.abs(place.lat) <= 90 &&
      Number.isFinite(place.lon) && Math.abs(place.lon) <= 180;
    return entries.filter((trip: SavedTrip) => trip && typeof trip.id === 'string' &&
      typeof trip.name === 'string' && (trip.origin === null || isPlace(trip.origin)) &&
      isPlace(trip.destination) && Array.isArray(trip.stops) && trip.stops.length <= 8 &&
      trip.stops.every(isPlace) && ['driving', 'walking', 'cycling'].includes(trip.mode) &&
      Number.isFinite(trip.arrivalBuffer) && trip.arrivalBuffer >= 0 && trip.arrivalBuffer <= 120);
  } catch {
    return [];
  }
}

interface RouteStep {
  name?: string;
  maneuver: {
    instruction?: string;
    type?: string;
    modifier?: string;
    location?: RoutePoint;
  };
}

function routeFailureMessage(reason?: string) {
  switch (reason) {
    case 'provider_not_configured': return 'No routing provider is configured for this travel mode.';
    case 'provider_timeout': return 'The routing provider timed out. Try again in a moment.';
    case 'provider_error': return 'The routing provider is unavailable. Check provider settings or try again.';
    default: return 'No road-network route available for this travel mode.';
  }
}

function routeStepLabel({ maneuver, name }: RouteStep) {
  if (maneuver.instruction) return maneuver.instruction;
  if (maneuver.type === 'arrive') return 'Arrive at destination';
  const action = maneuver.type === 'depart' ? 'Depart' : maneuver.type || 'Continue';
  const label = [action, maneuver.type === 'depart' ? undefined : maneuver.modifier]
    .filter(Boolean).join(' ');
  return `${label[0].toUpperCase()}${label.slice(1)}${name ? ` · ${name}` : ''}`;
}

interface CalendarTrip {
  id: string;
  summary?: string;
  location: string;
  start: { dateTime: string; timeZone?: string };
  status?: string;
}

interface RouteAlternative {
  distance_meters: number;
  duration_seconds: number;
  legs?: { steps?: RouteStep[] }[];
  geometry: any;
}

type ProviderState = 'not_configured' | 'configured' | 'reachable' | 'timeout' | 'unavailable';

const providerLabels: Record<string, string> = {
  driving: 'Driving', walking: 'Walking', cycling: 'Cycling', place_search: 'Place search',
  reachability: 'Road-network reachability', traffic_routing: 'Time-dependent driving'
};

const providerStateLabels: Record<ProviderState, string> = {
  not_configured: 'Setup required', configured: 'Configured', reachable: 'Reachable',
  timeout: 'Timed out', unavailable: 'Unavailable'
};

function eventArrivalLocal(event: CalendarTrip, bufferMinutes: number) {
  const stamp = Date.parse(event.start.dateTime) - bufferMinutes * 60000;
  const zone = event.start.timeZone;
  if (zone) {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
      }).formatToParts(stamp);
      const value = (key: string) => parts.find(part => part.type === key)?.value;
      return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}`;
    } catch {
      // Use the event's explicit offset if the time-zone name is unavailable.
    }
  }
  const offset = /([+-])(\d{2}):(\d{2})$/.exec(event.start.dateTime);
  const offsetMinutes = offset ? (offset[1] === '-' ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3])) : 0;
  return new Date(stamp + offsetMinutes * 60000).toISOString().slice(0, 16);
}

interface ActiveRouteData {
  origin: string;
  originCoordinates: RoutePoint;
  destination: DestinationItem;
  distance_km: number;
  duration_min: number;
  steps: RouteStep[];
  stops: DestinationItem[];
  geometry?: any;
  options: RouteAlternative[];
  optimization?: { order: number[]; original_seconds: number | null; optimized_seconds: number };
  selected: number;
  mode: TravelMode;
  source?: string;
  calculatedAt?: string;
}

interface ParkingSpot {
  lat: number;
  lon: number;
  floor_level?: string;
  landmark_note?: string;
  saved_at?: number;
  photo?: string;
}

interface SavedBookmark {
  id: string;
  name: string;
  lat: number;
  lon: number;
  category?: string;
}

interface BufferData {
  radius_km: number;
  area_ha: number;
  area_sqkm: number;
  feature: any;
  center: [number, number];
}

interface IsochroneData {
  source: 'road_network' | 'approximate';
  minutes: number;
  mode: string;
  area_sqkm: number;
  feature: any;
}

interface MeasurementState {
  points: [number, number][]; // [lon, lat]
  distance_km: number;
  area_ha: number;
  isPolygon: boolean;
}

type BasemapType = 'dark' | 'streets' | 'satellite' | 'local';
type BladeTab = 'nav' | 'gis' | 'layers';


// Tactical Distance & Geodesic Bearing Calculation
function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function calculateBearing(startLat: number, startLon: number, destLat: number, destLon: number): { deg: number; compass: string } {
  const startLatRad = (startLat * Math.PI) / 180;
  const startLonRad = (startLon * Math.PI) / 180;
  const destLatRad = (destLat * Math.PI) / 180;
  const destLonRad = (destLon * Math.PI) / 180;

  const dLon = destLonRad - startLonRad;
  const y = Math.sin(dLon) * Math.cos(destLatRad);
  const x = Math.cos(startLatRad) * Math.sin(destLatRad) - Math.sin(startLatRad) * Math.cos(destLatRad) * Math.cos(dLon);
  let brng = (Math.atan2(y, x) * 180) / Math.PI;
  brng = (brng + 360) % 360;

  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(brng / 22.5) % 16;
  return { deg: Math.round(brng), compass: directions[index] };
}

// 1. Tactical Cyber Dark Basemap (ESRI World Dark Gray Base + Reference: 100% free, zero watermarks)
const DARK_TACTICAL_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    'esri-dark-base': {
      type: 'raster',
      tiles: ['https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 16,
      attribution: '&copy; Esri, HERE, Garmin'
    },
    'esri-dark-ref': {
      type: 'raster',
      tiles: ['https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 16
    }
  },
  layers: [
    { id: 'esri-dark-base-layer', type: 'raster', source: 'esri-dark-base', minzoom: 0, maxzoom: 20 },
    { id: 'esri-dark-ref-layer', type: 'raster', source: 'esri-dark-ref', minzoom: 0, maxzoom: 20 }
  ]
};

// 3. Hybrid: Satellite Imagery with High-Contrast Road & Boundary Overlays
const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    'hybrid-sat-tiles': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: '&copy; Esri, Maxar, Earthstar Geographics'
    },
    'hybrid-roads-tiles': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256
    },
    'hybrid-places-tiles': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256
    }
  },
  layers: [
    { id: 'hybrid-sat-layer', type: 'raster', source: 'hybrid-sat-tiles', minzoom: 0, maxzoom: 19 },
    { id: 'hybrid-roads-layer', type: 'raster', layout: { visibility: 'none' }, source: 'hybrid-roads-tiles', minzoom: 0, maxzoom: 19 },
    { id: 'hybrid-places-layer', type: 'raster', layout: { visibility: 'none' }, source: 'hybrid-places-tiles', minzoom: 0, maxzoom: 19 }
  ]
};

// 5. Day Navigation Streets
const STREETS_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    'streets-tiles': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: '&copy; Esri, DeLorme, TomTom'
    }
  },
  layers: [
    { id: 'streets-layer', type: 'raster', source: 'streets-tiles', minzoom: 0, maxzoom: 19 }
  ]
};

const BASEMAP_OPTIONS = {
  dark: { label: 'Dark', description: 'Track routes and pins on a muted map', preview: 'dark' },
  streets: { label: 'Street', description: 'Find roads and addresses', preview: 'streets' },
  satellite: { label: 'Satellite', description: 'See buildings and land cover', preview: 'satellite' },
  local: { label: 'Local', description: 'Use your configured tile source' },
} satisfies Record<BasemapType, { label: string; description: string; preview?: string }>;

const PRIMARY_BASEMAPS = ['streets', 'satellite', 'dark'] as const;
const MORE_BASEMAPS = ['local'] as const;
const SATELLITE_LABEL_LAYERS = ['hybrid-roads-layer', 'hybrid-places-layer'];

export const GeoWorkspace: React.FC<GeoWorkspaceProps> = ({ onClose, children, onVoiceTrigger: _onVoiceTrigger, command, briefingTrip }) => {
  const [manualOrigin, setManualOrigin] = useState<{ name?: string; lat: number; lon: number } | null>(null);
  const manualOriginRef = useRef(manualOrigin);
  const routeRequestId = useRef(0);
  const searchRequestId = useRef(0);
  const searchRequest = useRef<AbortController | null>(null);
  const routeRequest = useRef<AbortController | null>(null);
  const weatherRequest = useRef<AbortController | null>(null);
  const pinLookup = useRef<AbortController | null>(null);
  const pickStart = useRef(false);
  const [pickingStart, setPickingStart] = useState(false);
  const routeSelection = useRef<(index: number) => void>(() => {});
  const viewport = useRef<{ center: RoutePoint; zoom: number; pitch: number; bearing: number } | null>(null);
  useEffect(() => () => {
    searchRequest.current?.abort();
    routeRequest.current?.abort();
    weatherRequest.current?.abort();
    pinLookup.current?.abort();
  }, []);
  const [contextSource, setContextSource] = useState<'auto' | 'device' | 'pin' | 'map'>('auto');
  const [mapCenter, setMapCenter] = useState<RoutePoint>([79.8612, 6.9271]);
  const [deviceHeading, setDeviceHeading] = useState<number | null>(null);
  const [contextClock, setContextClock] = useState(Date.now);
  const gpsFixTime = useRef(0);
  const [contextOpen, setContextOpen] = useState(false);
  const [nearbyDirection, setNearbyDirection] = useState('');
  const [nearbyStatus, setNearbyStatus] = useState('');
  const [lastNearbySearch, setLastNearbySearch] = useState<{
    category: 'hospital' | 'fuel' | 'food' | 'pharmacy' | 'atm';
    center: RoutePoint;
  } | null>(null);
  const [walkingEstimates, setWalkingEstimates] = useState<Record<string, string>>({});
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (gpsFixTime.current) setContextClock(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);
  const [recordTripHistory, setRecordTripHistory] = useState(() => {
    try { return localStorage.getItem(historyOptInKey) === 'true'; } catch { return false; }
  });
  const recordHistoryRef = useRef(recordTripHistory);
  recordHistoryRef.current = recordTripHistory;
  const [tripHistory, setTripHistory] = useState<CompletedTrip[]>(() => {
    try {
      const data = JSON.parse(localStorage.getItem(historyStorageKey) || '[]');
      return Array.isArray(data) ? data.filter(item => typeof item?.id === 'string' &&
        typeof item.destination === 'string' && Number.isFinite(item.completedAt) &&
        ['driving', 'walking', 'cycling'].includes(item.mode)).slice(0, 100) : [];
    } catch { return []; }
  });
  const tripHistoryRef = useRef(tripHistory);
  tripHistoryRef.current = tripHistory;
  const saveTripHistory = useCallback((entries: CompletedTrip[]) => {
    try {
      if (entries.length) localStorage.setItem(historyStorageKey, JSON.stringify(entries));
      else localStorage.removeItem(historyStorageKey);
      setTripHistory(entries);
    } catch {
      setNavigationStatus('Could not update trip history in this browser.');
    }
  }, []);
  const [navigating, setNavigating] = useState(false);
  const [spokenNavigation, setSpokenNavigation] = useState(true);
  const spokenNavigationRef = useRef(spokenNavigation);
  spokenNavigationRef.current = spokenNavigation;
  const [navigationStatus, setNavigationStatus] = useState('');
  const lastReroute = useRef(0);
  const [tripDestination, setTripDestination] = useState<DestinationItem | null>(null);
  const [searchLanguage, setSearchLanguage] = useState<'en' | 'si' | 'ta'>('en');
  const [sriLankaOnly, setSriLankaOnly] = useState(false);
  const [useTrafficRouting, setUseTrafficRouting] = useState(false);
  const [providerInfo, setProviderInfo] = useState<{ providers: Record<string, ProviderState>; checked_at?: string } | null>(null);
  const [checkingProviders, setCheckingProviders] = useState(false);
  const [tripName, setTripName] = useState('');
  const [editingTripId, setEditingTripId] = useState<string | null>(null);
  const [savedTrips, setSavedTrips] = useState(readSavedTrips);
  const [placeField, setPlaceField] = useState<'origin' | 'destination' | 'stop'>('destination');
  const draggingStop = useRef<number | null>(null);
  const routeCalculator = useRef<(destination: DestinationItem, mode?: TravelMode, origin?: RoutePoint, remainingStops?: DestinationItem[]) => Promise<void>>(async () => {});
  const [searchResults, setSearchResults] = useState<DestinationItem[]>([]);
  const [comparison, setComparison] = useState<{
    results: DestinationItem[];
    direction: string;
    mode: TravelMode;
    traffic: boolean;
    estimates: InstanceType<typeof globalThis.Map<DestinationItem, NearbyEstimate>> | null;
  } | null>(null);
  const comparisonRequest = useRef<AbortController | null>(null);
  const [optimizeStops, setOptimizeStops] = useState(false);
  const [sharedRoute, setSharedRoute] = useState<ActiveRouteData | null>(null);
  const [routeWeather, setRouteWeather] = useState<{ geometry: unknown; text: string } | null>(null);
  const [arrivalNotice, setArrivalNotice] = useState('');
  const notifyArrival = useCallback((name: string, radius?: number) => {
    const notice = `Approaching target objective: ${name}${radius ? ` within ${radius} meters` : ''}. Geofence breached.`;
    setArrivalNotice(notice);
    try {
      sfx.playTargetAcquired();
    } catch {
      // Audio suppressed
    }
    speakWithKokoro(notice);
  }, []);
  const locationReminders = useAtlasReminders(notifyArrival);
  const [reminderRadius, setReminderRadius] = useState(150);
  const [stops, setStops] = useState<DestinationItem[]>([]);
  const [calendarTrips, setCalendarTrips] = useState<CalendarTrip[]>([]);
  const [arrivalBuffer, setArrivalBuffer] = useState(10);
  const handledCommand = useRef<typeof command>(undefined);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const userMarkerRef = useRef<Marker | null>(null);
  const destMarkerRef = useRef<Marker | null>(null);
  const pinMarkerRef = useRef<Marker | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Core navigation state
  const [currentCoords, setCurrentCoords] = useState<[number, number] | null>(null); // [lon, lat]
  const currentCoordsRef = useRef<[number, number] | null>(null);
  useEffect(() => {
    currentCoordsRef.current = currentCoords;
  }, [currentCoords]);
  const [cursorCoords, setCursorCoords] = useState<[number, number] | null>(null);
  const [zoomLevel, setZoomLevel] = useState(13);
  const cancelLocationRequest = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelLocationRequest.current?.(), []);
  const [gpsUnavailable, setGpsUnavailable] = useState(false);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeRoute, setActiveRoute] = useState<ActiveRouteData | null>(null);
  const [transitMode, setTransitMode] = useState<'driving' | 'walking' | 'cycling'>('driving');
  const transitModeRef = useRef(transitMode);

  // Elevation Profile & Slope Scrubbing State
  const [elevationScrubPoint, setElevationScrubPoint] = useState<ElevationPoint | null>(null);
  const [elevationProfile, setElevationProfile] = useState<ElevationProfile | null>(null);
  const [showSlopeHeatmap, setShowSlopeHeatmap] = useState(false);
  
  // HUD UI and Layout state
  const [activeTab, setActiveTab] = useState<BladeTab>('nav');
  const [is3D, setIs3D] = useState(false);
  const [basemap, setBasemap] = useState<BasemapType>(localBasemapTiles ? 'local' : 'dark');
  const [showSatelliteLabels, setShowSatelliteLabels] = useState(false);
  const [isBasemapMenuOpen, setIsBasemapMenuOpen] = useState(false);
  const [overlaysOpen, setOverlaysOpen] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const drawerToggle = useRef<HTMLButtonElement>(null);
  const destinationSearch = useRef<HTMLInputElement>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isRouting, setIsRouting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Standby');
  const [showSteps, setShowSteps] = useState(false);
  const [_showInspector, setShowInspector] = useState(false);

  // Bookmarks & Parking
  const [parkingFloor, setParkingFloor] = useState('');
  const [parkingNote, setParkingNote] = useState('');
  const [parkingPhoto, setParkingPhoto] = useState<string | null>(null);
  const [loadingParkingPhoto, setLoadingParkingPhoto] = useState(false);
  const [savedParking, setSavedParking] = useState<ParkingSpot | null>(null);
  const [parkingSavedNotice, setParkingSavedNotice] = useState(false);
  const [savedPlaces, setSavedPlaces] = useState<SavedBookmark[]>([]);
  const [savedDataUnavailable, setSavedDataUnavailable] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    try {
      const data = JSON.parse(localStorage.getItem('oracle_atlas_recent') || '[]');
      return Array.isArray(data) ? data.filter(value => typeof value === 'string').slice(0, 5) : [];
    } catch { return []; }
  });

  // GIS Tool States
  const [bufferRadius, setBufferRadius] = useState<number>(3.0);
  const [activeBuffer, setActiveBuffer] = useState<BufferData | null>(null);
  const [isochroneMinutes, setIsochroneMinutes] = useState<number>(15);
  const [activeIsochrone, setActiveIsochrone] = useState<IsochroneData | null>(null);
  
  // Measurement Tool State
  const [measureMode, setMeasureMode] = useState<boolean>(false);
  const [measurePolygon, setMeasurePolygon] = useState<boolean>(false);
  const [measurement, setMeasurement] = useState<MeasurementState>({ points: [], distance_km: 0, area_ha: 0, isPolygon: false });

  // Custom GeoJSON Layer
  const [importedLayers, setImportedLayers] = useState<AtlasLayer[]>([]);
  const [savedSpatialAreas, setSavedSpatialAreas] = useState<{ id: string; label: string; feature: AtlasArea }[]>([]);
  const [savedCorridor, setSavedCorridor] = useState<CorridorLine>();
  const [pendingCsv, setPendingCsv] = useState<{ name: string; data: ReturnType<typeof parseAtlasCsv> } | null>(null);
  const [csvLongitude, setCsvLongitude] = useState('');
  const [csvLatitude, setCsvLatitude] = useState('');
  const [inspectedLayerId, setInspectedLayerId] = useState<string | null>(null);
  const [selectedFeature, setSelectedFeature] = useState<FeatureKey | null>(null);
  const [spatialFilters, setSpatialFilters] = useState<Record<string, SpatialFilter>>({});
  const inspectedLayer = importedLayers.find(layer => layer.id === inspectedLayerId);
  const inspectFeature = (layerId: string, index: number) => {
    setInspectedLayerId(layerId);
    setSelectedFeature({ layerId, index });
    setActiveTab('layers');
    setIsDrawerOpen(true);
  };

  const [showTerrain, setShowTerrain] = useState(false);
  const [showTraffic, setShowTraffic] = useState(false);
  const [showCycling, setShowCycling] = useState(false);
  const [showRadar, setShowRadar] = useState(false);
  const [mapBearing, setMapBearing] = useState(0);
  const [mapPitch, setMapPitch] = useState(0);
  const [isFlyThroughActive, setIsFlyThroughActive] = useState(false);
  const [flyThroughPaused, setFlyThroughPaused] = useState(false);
  const [flyThroughSpeed, setFlyThroughSpeed] = useState<1 | 2 | 4>(1);
  const [flyThroughProgress, setFlyThroughProgress] = useState(0);
  const [flyThroughManeuver, setFlyThroughManeuver] = useState('');
  const flyThroughRef = useRef<{
    rafId: number;
    coords: [number, number][];
    progressIndex: number;
    previousView: { center: [number, number]; zoom: number; pitch: number; bearing: number } | null;
  }>({
    rafId: 0,
    coords: [],
    progressIndex: 0,
    previousView: null
  });

  const [showSunlight, setShowSunlight] = useState(false);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [bookmarks, setBookmarks] = useState<SpatialBookmark[]>(() => {
    try {
      const data = JSON.parse(localStorage.getItem(bookmarksStorageKey) || '[]');
      return Array.isArray(data) ? data : [];
    } catch { return []; }
  });

  const saveBookmark = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const center = map.getCenter().wrap().toArray() as [number, number];
    const zoom = Math.round(map.getZoom() * 10) / 10;
    const pitch = Math.round(map.getPitch());
    const bearing = Math.round(map.getBearing());
    const name = window.prompt('Name this spatial viewpoint bookmark:', `Vantage Point ${bookmarks.length + 1}`)?.trim();
    if (!name) return;
    const newBm: SpatialBookmark = { id: crypto.randomUUID(), name, center, zoom, pitch, bearing };
    const updated = [...bookmarks, newBm];
    setBookmarks(updated);
    try { localStorage.setItem(bookmarksStorageKey, JSON.stringify(updated)); } catch {}
    setStatusMessage(`Saved viewpoint "${name}".`);
  }, [bookmarks]);

  const flyToBookmark = useCallback((bm: SpatialBookmark) => {
    mapRef.current?.flyTo({
      center: bm.center,
      zoom: bm.zoom,
      pitch: bm.pitch,
      bearing: bm.bearing,
      duration: 1200
    });
    setBookmarksOpen(false);
    setStatusMessage(`Navigated to viewpoint "${bm.name}".`);
  }, []);

  const deleteBookmark = useCallback((id: string) => {
    const updated = bookmarks.filter(b => b.id !== id);
    setBookmarks(updated);
    try { localStorage.setItem(bookmarksStorageKey, JSON.stringify(updated)); } catch {}
  }, [bookmarks]);

  const [showKeybindings, setShowKeybindings] = useState(false);

  // Dropped Target Pin
  const [targetPin, setTargetPin] = useState<{ lat: number; lon: number; name?: string; display_name?: string } | null>(null);

  // Layer Visibility and Opacity
  const [layerVisibility, _setLayerVisibility] = useState({
    route: true,
    buffer: true,
    isochrone: true,
    measure: true,
    custom: true
  });
  const bufferOpacity = 0.35;

  // Helper: Geodesic Haversine Distance in km
  const calcHaversineKm = (lon1: number, lat1: number, lon2: number, lat2: number) => {
    const r = 6371.0;
    const dlat = ((lat2 - lat1) * Math.PI) / 180.0;
    const dlon = ((lon2 - lon1) * Math.PI) / 180.0;
    const a =
      Math.sin(dlat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dlon / 2) ** 2;
    return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  };

  // Helper: Spherical Polygon Area in Hectares
  const calcPolygonAreaHa = (points: [number, number][]) => {
    if (points.length < 3) return 0;
    const rMeters = 6371008.8;
    let total = 0;
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const p1 = points[i];
      const p2 = points[(i + 1) % n];
      const lon1 = (p1[0] * Math.PI) / 180;
      const lat1 = (p1[1] * Math.PI) / 180;
      const lon2 = (p2[0] * Math.PI) / 180;
      const lat2 = (p2[1] * Math.PI) / 180;
      total += (lon2 - lon1) * (2 + Math.sin(lat1) + Math.sin(lat2));
    }
    const areaSqm = Math.abs((total * rMeters ** 2) / 2.0);
    return Math.round((areaSqm / 10000.0) * 100) / 100;
  };

  // Helper: Geodesic Circle Polygon for Beacons
  const createGeoCircle = (lon: number, lat: number, radiusMeters: number, points = 48): [number, number][] => {
    const coords: [number, number][] = [];
    const distanceRadians = radiusMeters / 6371000;
    const centerLatRadians = (lat * Math.PI) / 180;
    const centerLonRadians = (lon * Math.PI) / 180;

    for (let i = 0; i <= points; i++) {
      const angle = (i * 2 * Math.PI) / points;
      const pointLatRadians = Math.asin(
        Math.sin(centerLatRadians) * Math.cos(distanceRadians) +
        Math.cos(centerLatRadians) * Math.sin(distanceRadians) * Math.cos(angle)
      );
      const pointLonRadians = centerLonRadians + Math.atan2(
        Math.sin(angle) * Math.sin(distanceRadians) * Math.cos(centerLatRadians),
        Math.cos(distanceRadians) - Math.sin(centerLatRadians) * Math.sin(pointLatRadians)
      );
      coords.push([(pointLonRadians * 180) / Math.PI, (pointLatRadians * 180) / Math.PI]);
    }
    return coords;
  };

  const updateUserMarker = useCallback((coords: [number, number]) => {
    if (!mapRef.current) return;
    if (userMarkerRef.current) {
      userMarkerRef.current.setLngLat(coords);
    } else {
      const el = document.createElement('div');
      el.className = 'geo-user-marker';
      el.innerHTML = '<span class="atlas-gps-heading"></span><span class="atlas-gps-dot"></span>';
      userMarkerRef.current = new Marker({ element: el, anchor: 'center' })
        .setLngLat(coords)
        .addTo(mapRef.current);
    }
  }, []);


  // Synchronize tactical laser tether line between user and dropped pin
  useEffect(() => {
    if (!mapRef.current) return;
    const source = mapRef.current.getSource('pin-tether') as GeoJSONSource | undefined;
    if (!source) return;

    if (currentCoords && targetPin) {
      source.setData({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [currentCoords, [targetPin.lon, targetPin.lat]]
        }
      });
    } else {
      source.setData({
        type: 'FeatureCollection',
        features: []
      });
    }
  }, [currentCoords, targetPin]);

  // Synchronize user marker with live coordinates
  useEffect(() => {
    if (currentCoords && mapRef.current) {
      updateUserMarker(currentCoords);
    }
  }, [currentCoords, updateUserMarker]);

  const requestDeviceLocation = useCallback((flyImmediately = false) => {
    cancelLocationRequest.current?.();
    setGpsUnavailable(false);
    const geolocation = navigator.geolocation;
    const reportFailure = (message: string) => {
      setGpsUnavailable(true);
      setStatusMessage(message);
    };
    if (!geolocation) {
      reportFailure('Device location is unavailable. Select a map pin and choose Set as Start.');
      return;
    }

    setStatusMessage('Checking device location…');
    let bestAccuracy = Infinity;
    let active = true;
    const stop = () => {
      active = false;
      window.clearTimeout(deadline);
      geolocation.clearWatch(watch);
      cancelLocationRequest.current = null;
    };
    const watch = geolocation.watchPosition(({ coords, timestamp }) => {
      if (!active || !Number.isFinite(coords.accuracy) || coords.accuracy <= 0 ||
          coords.accuracy >= bestAccuracy || Date.now() - timestamp > 15000 ||
          timestamp < gpsFixTime.current) return;
      bestAccuracy = coords.accuracy;
      const point: RoutePoint = [coords.longitude, coords.latitude];
      gpsFixTime.current = timestamp;
      setContextClock(Date.now());
      setDeviceHeading(coords.heading != null && Number.isFinite(coords.heading) &&
        (coords.speed || 0) > 1 && coords.accuracy <= 40 ? coords.heading : null);
      currentCoordsRef.current = point;
      setCurrentCoords(point);
      setGpsAccuracy(coords.accuracy);
      updateUserMarker(point);
      if (flyImmediately) {
        const precise = coords.accuracy <= 40;
        const zoom = precise ? 15 : Math.max(2, Math.min(12, 15 - Math.log2(coords.accuracy / 100)));
        mapRef.current?.flyTo({ center: point, zoom, pitch: precise ? mapRef.current.getPitch() : 0, duration: 1200 });
      }
      if (coords.accuracy <= 40) {
        stop();
        setStatusMessage('');
      } else {
        setStatusMessage('Approximate location. Checking for a better fix…');
      }
    }, error => {
      if (!active || error.code !== 1) return;
      stop();
      reportFailure('Location permission is blocked. Allow location access or select a map pin as your start.');
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 });
    const deadline = window.setTimeout(() => {
      stop();
      if (bestAccuracy < Infinity || Date.now() - gpsFixTime.current <= 15000) {
        setStatusMessage('');
      } else {
        reportFailure('Unable to get a fresh location. Try again or select a map pin as your start.');
      }
    }, 15000);
    cancelLocationRequest.current = stop;
  }, [updateUserMarker]);

  const recenterOnUser = useCallback(() => {
    requestDeviceLocation(true);
  }, [requestDeviceLocation]);

  // Fetch saved parking & saved places
  const refreshUserData = useCallback(async () => {
    try {
      const [pResp, bResp] = await Promise.all([
        fetchWithAuth('/api/v1/geo/parking'),
        fetchWithAuth('/api/v1/geo/places')
      ]);
      setSavedDataUnavailable(!pResp.ok || !bResp.ok);
      if (pResp.ok) {
        const data = await pResp.json();
        setSavedParking(data.saved ? data.parking : null);
      }
      if (bResp.ok) {
        const bData = await bResp.json();
        setSavedPlaces(bData.places || []);
      }
    } catch {
      setSavedDataUnavailable(true);
    }
  }, []);

  useEffect(() => {
    void refreshUserData();
  }, [refreshUserData]);

  useEffect(() => {
    requestDeviceLocation(true);
  }, [requestDeviceLocation]);

  // Setup GIS layers on map load or style change
  const setupTacticalLayers = useCallback((map: Map) => {
    // 1. Tactical Route Source & Layers
    if (!map.getSource('tactical-route')) {
      map.addSource('tactical-route', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      map.addLayer({
        id: 'route-alternatives',
        type: 'line',
        source: 'tactical-route',
        filter: ['==', ['get', 'selected'], false],
        paint: { 'line-color': '#90a7bd', 'line-width': 3, 'line-opacity': 0.7 }
      });
      map.addLayer({
        id: 'route-glow',
        type: 'line',
        source: 'tactical-route',
        filter: ['==', ['get', 'selected'], true],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#0284c7',
          'line-width': 10,
          'line-opacity': 0.65,
          'line-blur': 3
        }
      });
      map.addLayer({
        id: 'route-core',
        type: 'line',
        source: 'tactical-route',
        filter: ['==', ['get', 'selected'], true],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#38bdf8',
          'line-width': 4.5,
          'line-opacity': 1
        }
      });
    }

    // 2. Geodesic Buffer Source & Layers
    if (!map.getSource('gis-buffer')) {
      map.addSource('gis-buffer', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      map.addLayer({
        id: 'buffer-fill',
        type: 'fill',
        source: 'gis-buffer',
        paint: {
          'fill-color': '#9db4d3',
          'fill-opacity': bufferOpacity
        }
      });
      map.addLayer({
        id: 'buffer-line',
        type: 'line',
        source: 'gis-buffer',
        paint: {
          'line-color': '#9db4d3',
          'line-width': 1.5,
          'line-dasharray': [3, 2]
        }
      });
    }

    // 3. Reachability Isochrone Source & Layers
    if (!map.getSource('gis-isochrone')) {
      map.addSource('gis-isochrone', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      map.addLayer({
        id: 'isochrone-fill',
        type: 'fill',
        source: 'gis-isochrone',
        paint: {
          'fill-color': '#38bdf8',
          'fill-opacity': 0.22
        }
      });
      map.addLayer({
        id: 'isochrone-line',
        type: 'line',
        source: 'gis-isochrone',
        paint: {
          'line-color': '#38bdf8',
          'line-width': 2
        }
      });
    }

    // 4. Interactive Measurement Source & Layers
    if (!map.getSource('gis-measure')) {
      map.addSource('gis-measure', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      map.addLayer({
        id: 'measure-fill',
        type: 'fill',
        source: 'gis-measure',
        paint: {
          'fill-color': '#f59e0b',
          'fill-opacity': 0.25
        }
      });
      map.addLayer({
        id: 'measure-line',
        type: 'line',
        source: 'gis-measure',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#f59e0b',
          'line-width': 2.5,
          'line-dasharray': [2, 1]
        }
      });
      map.addLayer({
        id: 'measure-points',
        type: 'circle',
        source: 'gis-measure',
        filter: ['==', '$type', 'Point'],
        paint: {
          'circle-radius': 5,
          'circle-color': '#f59e0b',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5
        }
      });
    }


    if (!map.getSource('device-location-accuracy')) {
      map.addSource('device-location-accuracy', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      map.addLayer({
        id: 'device-location-accuracy-fill',
        type: 'fill',
        source: 'device-location-accuracy',
        paint: { 'fill-color': '#38bdf8' }
      }, 'measure-fill');
      map.addLayer({
        id: 'device-location-accuracy-outline',
        type: 'line',
        source: 'device-location-accuracy',
        paint: { 'line-color': '#38bdf8', 'line-width': 1.5 }
      }, 'measure-fill');
    }

    // 6. Tactical Pin-to-User Bearing & Range Laser Line
    if (!map.getSource('pin-tether')) {
      map.addSource('pin-tether', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      map.addLayer({
        id: 'pin-tether-glow',
        type: 'line',
        source: 'pin-tether',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#9db4d3',
          'line-width': 3,
          'line-opacity': 0.25,
          'line-blur': 2
        }
      });
      map.addLayer({
        id: 'pin-tether-core',
        type: 'line',
        source: 'pin-tether',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#ffffff',
          'line-width': 1.5,
          'line-opacity': 0.9,
          'line-dasharray': [2, 2]
        }
      });
    }

    // 5. Custom Imported GeoJSON Source & Layers
    if (!map.getSource('custom-geojson')) {
      map.addSource('custom-geojson', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      map.addLayer({
        id: 'custom-fill',
        type: 'fill',
        source: 'custom-geojson',
        filter: ['==', '$type', 'Polygon'],
        paint: {
          'fill-color': ['case', ['boolean', ['get', 'atlasSelected'], false], '#ffbd61', '#34d399'],
          'fill-opacity': 0.28
        }
      });
      map.addLayer({
        id: 'custom-line',
        type: 'line',
        source: 'custom-geojson',
        filter: ['any', ['==', '$type', 'LineString'], ['==', '$type', 'Polygon']],
        paint: {
          'line-color': ['case', ['boolean', ['get', 'atlasSelected'], false], '#ffbd61', '#34d399'],
          'line-width': 2
        }
      });
      map.addLayer({
        id: 'custom-points',
        type: 'circle',
        source: 'custom-geojson',
        filter: ['==', '$type', 'Point'],
        paint: {
          'circle-radius': 6,
          'circle-color': ['case', ['boolean', ['get', 'atlasSelected'], false], '#ffbd61', '#34d399'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2
        }
      });
    }

    // 7. Tactical Geofence Beacons (Pulsing Radar Rings & Objectives)
    if (!map.getSource('atlas-geofence-beacons')) {
      map.addSource('atlas-geofence-beacons', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      map.addLayer({
        id: 'atlas-geofence-fill',
        type: 'fill',
        source: 'atlas-geofence-beacons',
        filter: ['==', '$type', 'Polygon'],
        paint: {
          'fill-color': '#9db4d3',
          'fill-opacity': 0.12
        }
      });
      map.addLayer({
        id: 'atlas-geofence-line',
        type: 'line',
        source: 'atlas-geofence-beacons',
        filter: ['==', '$type', 'Polygon'],
        paint: {
          'line-color': '#9db4d3',
          'line-width': 1.5,
          'line-dasharray': [2, 2]
        }
      });
      map.addLayer({
        id: 'atlas-geofence-center-glow',
        type: 'circle',
        source: 'atlas-geofence-beacons',
        filter: ['==', '$type', 'Point'],
        paint: {
          'circle-radius': 10,
          'circle-color': '#9db4d3',
          'circle-opacity': 0.2,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#cfe2f7'
        }
      });
      map.addLayer({
        id: 'atlas-geofence-center-dot',
        type: 'circle',
        source: 'atlas-geofence-beacons',
        filter: ['==', '$type', 'Point'],
        paint: {
          'circle-radius': 4,
          'circle-color': '#ffffff',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#9db4d3'
        }
      });
      map.addLayer({
        id: 'atlas-geofence-labels',
        type: 'symbol',
        source: 'atlas-geofence-beacons',
        filter: ['==', '$type', 'Point'],
        layout: {
          'text-field': ['concat', '🎯 ', ['get', 'name'], ' (', ['to-string', ['get', 'radius']], 'm)'],
          'text-size': 11,
          'text-offset': [0, 1.4],
          'text-anchor': 'top'
        },
        paint: {
          'text-color': '#e8ebef',
          'text-halo-color': '#020408',
          'text-halo-width': 2
        }
      });
    }

    // 8. 3D Elevation Scrubbing Drone Target
    if (!map.getSource('atlas-elevation-drone')) {
      map.addSource('atlas-elevation-drone', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      map.addLayer({
        id: 'atlas-elevation-drone-glow',
        type: 'circle',
        source: 'atlas-elevation-drone',
        paint: {
          'circle-radius': 12,
          'circle-color': '#9db4d3',
          'circle-opacity': 0.25,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#cfe2f7'
        }
      });
      map.addLayer({
        id: 'atlas-elevation-drone-core',
        type: 'circle',
        source: 'atlas-elevation-drone',
        paint: {
          'circle-radius': 5,
          'circle-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#9db4d3'
        }
      });
      map.addLayer({
        id: 'atlas-elevation-drone-label',
        type: 'symbol',
        source: 'atlas-elevation-drone',
        layout: {
          'text-field': ['concat', ['to-string', ['get', 'metres']], 'm • ', ['get', 'slopeText']],
          'text-size': 11,
          'text-offset': [0, -1.8],
          'text-anchor': 'bottom'
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#020408',
          'text-halo-width': 2.5
        }
      });
    }

    // 9. Route Incline / Slope Heatmap Layers
    if (!map.getSource('atlas-route-slope-heatmap')) {
      map.addSource('atlas-route-slope-heatmap', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      map.addLayer({
        id: 'route-slope-glow',
        type: 'line',
        source: 'atlas-route-slope-heatmap',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 8,
          'line-opacity': 0.65,
          'line-blur': 2
        }
      });
      map.addLayer({
        id: 'route-slope-core',
        type: 'line',
        source: 'atlas-route-slope-heatmap',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 4.5
        }
      });
    }
  }, [bufferOpacity]);

  // Initialize MapLibre GL Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    const stylesMap: Record<BasemapType, StyleSpecification | string> = {
      dark: DARK_TACTICAL_STYLE,
      satellite: SATELLITE_STYLE,
      streets: STREETS_STYLE,
      local: {
        version: 8,
        sources: localBasemapTiles ? {
          'local-tiles': { type: 'raster', tiles: [localBasemapTiles], tileSize: 256, attribution: localBasemapAttribution }
        } : {},
        layers: localBasemapTiles ? [{ id: 'local-basemap', type: 'raster', source: 'local-tiles' }] : []
      }
    };

    const map = new Map({
      container: mapContainerRef.current,
      style: stylesMap[basemap],
      center: viewport.current?.center ?? currentCoordsRef.current ?? [79.8612, 6.9271],
      zoom: viewport.current?.zoom ?? 3,
      pitch: viewport.current?.pitch ?? 0,
      bearing: viewport.current?.bearing ?? 0,
      attributionControl: { compact: true }
    });

    mapRef.current = map;
    pinMarkerRef.current?.addTo(map);
    destMarkerRef.current?.addTo(map);

    map.on('load', () => {
      if (currentCoordsRef.current) {
        updateUserMarker(currentCoordsRef.current);
      }
      setupTacticalLayers(map);
      const pin = pinMarkerRef.current?.getLngLat();
      const device = currentCoordsRef.current;
      const tether = map.getSource('pin-tether') as GeoJSONSource | undefined;
      if (pin && device) tether?.setData({
        type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [device, pin.toArray()] }
      });
    });

    // Update telemetry at most four times per second while moving the pointer.
    let lastPointerUpdate = -Infinity;
    map.on('mousemove', (e: MapMouseEvent) => {
      const now = performance.now();
      if (now - lastPointerUpdate < 250) return;
      lastPointerUpdate = now;
      setCursorCoords([e.lngLat.lng, e.lngLat.lat]);
    });

    map.on('moveend', () => setMapCenter(map.getCenter().wrap().toArray()));
    map.on('zoomend', () => {
      setZoomLevel(Math.round(map.getZoom() * 10) / 10);
    });
    map.on('rotate', () => setMapBearing(Math.round(map.getBearing())));
    map.on('pitch', () => {
      const p = Math.round(map.getPitch());
      setMapPitch(p);
      setIs3D(p > 20);
    });
    map.on('rotateend', () => setMapBearing(Math.round(map.getBearing())));
    map.on('pitchend', () => {
      const p = Math.round(map.getPitch());
      setMapPitch(p);
      setIs3D(p > 20);
    });

    // Map Click Handler for Measurement or Dropping Pins
    map.on('click', async (e: MapMouseEvent) => {
      const clickCoords: [number, number] = [e.lngLat.lng, e.lngLat.lat];

      if (pickStart.current) {
        confirmMapStart(clickCoords);
        return;
      }

      // If Measurement tool is active, append point
      if (measureModeRef.current) {
        setMeasurement((prev) => {
          const newPts: [number, number][] = [...prev.points, clickCoords];
          let distKm = 0;
          for (let i = 0; i < newPts.length - 1; i++) {
            distKm += calcHaversineKm(newPts[i][0], newPts[i][1], newPts[i + 1][0], newPts[i + 1][1]);
          }
          let areaHa = 0;
          if (measurePolygonRef.current && newPts.length >= 3) {
            areaHa = calcPolygonAreaHa(newPts);
          }
          return {
            points: newPts,
            distance_km: Math.round(distKm * 1000) / 1000,
            area_ha: areaHa,
            isPolygon: measurePolygonRef.current
          };
        });
        return;
      }

      const featureLayers = ['custom-points', 'custom-line', 'custom-fill', 'atlas-buildings'].filter(id => map.getLayer(id));
      if (featureLayers.length) {
        const rendered = map.queryRenderedFeatures(e.point, { layers: featureLayers })[0];
        if (rendered?.properties.atlasLayerId && Number.isInteger(rendered.properties.atlasIndex)) {
          inspectFeature(rendered.properties.atlasLayerId, rendered.properties.atlasIndex);
          return;
        }
      }

      const routeLayers = ['route-core', 'route-alternatives'].filter(id => map.getLayer(id));
      if (routeLayers.length) {
        const { x, y } = e.point;
        const hit = map.queryRenderedFeatures([[x - 5, y - 5], [x + 5, y + 5]], { layers: routeLayers })[0];
        if (hit) {
          routeSelection.current(Number(hit.properties.routeIndex));
          return;
        }
      }

      // Normal map click: Drop upright 3D tactical target pin with Draggable HUD
      const liveCoords = currentCoordsRef.current;
      let distKm = liveCoords ? calculateDistanceKm(liveCoords[1], liveCoords[0], clickCoords[1], clickCoords[0]) : 0;
      let bearing = liveCoords ? calculateBearing(liveCoords[1], liveCoords[0], clickCoords[1], clickCoords[0]) : null;

      const updatePinContent = (el: HTMLElement, name: string, d: number, b: { deg: number; compass: string } | null, coords: [number, number]) => {
        el.className = 'geo-target-pin-3d';
        el.innerHTML = `
          <div class="geo-pin-floating-actions">
            <span class="geo-pin-hud-name"></span>
            <button type="button" class="geo-mini-btn primary" id="pin-btn-route">Directions</button>
            <details class="atlas-pin-menu">
              <summary aria-label="More pin actions">⋯</summary>
              <div class="atlas-pin-menu-items">
                ${b ? `<span class="geo-pin-hud-meta">${d.toFixed(2)} km · ${b.deg}° ${b.compass}</span>` : ''}
                <button type="button" class="geo-mini-btn" id="pin-btn-buffer">5 km buffer</button>
                <button type="button" class="geo-mini-btn" id="pin-btn-copy">Copy coordinates</button>
                <button type="button" class="geo-mini-btn" id="pin-btn-dismiss">Dismiss pin</button>
              </div>
            </details>
          </div>
          <span class="atlas-map-pin" aria-hidden="true"><span></span></span>
        `;

        const nameLabel = el.querySelector('.geo-pin-hud-name');
        if (nameLabel) nameLabel.textContent = name.length > 20 ? name.slice(0, 18) + '…' : name;

        const actions = el.querySelector('.geo-pin-floating-actions');
        actions?.addEventListener('mousedown', event => event.stopPropagation());
        actions?.addEventListener('touchstart', event => event.stopPropagation());
        actions?.addEventListener('click', event => event.stopPropagation());

        // Wire up quick-action buttons directly on the floating pin
        const btnRoute = el.querySelector('#pin-btn-route');
        btnRoute?.addEventListener('click', (ev) => {
          ev.stopPropagation();
          void routeCalculator.current({ name: nameLabel?.textContent || name, display_name: '', lat: coords[1], lon: coords[0] });
        });

        const btnBuffer = el.querySelector('#pin-btn-buffer');
        btnBuffer?.addEventListener('click', (ev) => {
          ev.stopPropagation();
          void handleGenerateBuffer(5, coords);
        });

        const btnCopy = el.querySelector('#pin-btn-copy');
        btnCopy?.addEventListener('click', (ev) => {
          ev.stopPropagation();
          navigator.clipboard.writeText(`${coords[1].toFixed(5)}, ${coords[0].toFixed(5)}`);
          setStatusMessage(`Copied coordinates (${coords[1].toFixed(4)}°, ${coords[0].toFixed(4)}°) to clipboard`);
        });

        const btnDismiss = el.querySelector('#pin-btn-dismiss');
        btnDismiss?.addEventListener('click', (ev) => {
          ev.stopPropagation();
          pinLookup.current?.abort();
          setTargetPin(null);
          if (pinMarkerRef.current) {
            pinMarkerRef.current.remove();
            pinMarkerRef.current = null;
          }
          const tetherSource = mapRef.current?.getSource('pin-tether') as GeoJSONSource | undefined;
          if (tetherSource) {
            tetherSource.setData({ type: 'FeatureCollection', features: [] });
          }
        });
      };

      if (pinMarkerRef.current) {
        pinMarkerRef.current.setLngLat(clickCoords);
        const el = pinMarkerRef.current.getElement();
        updatePinContent(el, 'Selected Point', distKm, bearing, clickCoords);
      } else {
        const el = document.createElement('div');
        updatePinContent(el, 'Selected Point', distKm, bearing, clickCoords);

        const marker = new Marker({ element: el, anchor: 'bottom', draggable: true })
          .setLngLat(clickCoords)
          .addTo(map);

        // Drag events for interactive micro-adjustments
        marker.on('drag', () => {
          const lngLat = marker.getLngLat();
          const live = currentCoordsRef.current;
          const source = mapRef.current?.getSource('pin-tether') as GeoJSONSource | undefined;
          if (source && live) {
            source.setData({
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'LineString',
                coordinates: [live, [lngLat.lng, lngLat.lat]]
              }
            });
          }
        });

        marker.on('dragend', async () => {
          const lngLat = marker.getLngLat();
          const ptCoords: [number, number] = [lngLat.lng, lngLat.lat];
          const live = currentCoordsRef.current;
          const newDist = live ? calculateDistanceKm(live[1], live[0], lngLat.lat, lngLat.lng) : 0;
          const newBearing = live ? calculateBearing(live[1], live[0], lngLat.lat, lngLat.lng) : null;
          updatePinContent(marker.getElement(), 'Resolving...', newDist, newBearing, ptCoords);
          setTargetPin({ lat: lngLat.lat, lon: lngLat.lng, name: 'Map pin' });
          pinLookup.current?.abort();
          const lookup = new AbortController();
          pinLookup.current = lookup;
          try {
            const rev = await fetchWithAuth(`/api/v1/geo/reverse?lat=${lngLat.lat}&lon=${lngLat.lng}`, { signal: lookup.signal });
            if (rev.ok) {
              const rData = await rev.json();
              if (lookup.signal.aborted) return;
              const pName = rData.name || rData.display_name?.split(',')[0] || `Point (${lngLat.lat.toFixed(4)}°, ${lngLat.lng.toFixed(4)}°)`;
              updatePinContent(marker.getElement(), pName, newDist, newBearing, ptCoords);
              setTargetPin({ lat: lngLat.lat, lon: lngLat.lng, name: pName, display_name: rData.display_name });
            }
          } catch {
            if (lookup.signal.aborted) return;
            updatePinContent(marker.getElement(), `${lngLat.lat.toFixed(4)}°, ${lngLat.lng.toFixed(4)}°`, newDist, newBearing, ptCoords);
          }
        });

        pinMarkerRef.current = marker;
      }

      // Update tether line immediately on map click
      const tetherSource = map.getSource('pin-tether') as GeoJSONSource | undefined;
      if (tetherSource && liveCoords) {
        tetherSource.setData({
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [liveCoords, clickCoords]
          }
        });
      }

      setTargetPin({ lat: e.lngLat.lat, lon: e.lngLat.lng, name: 'Map pin' });
      setActiveTab('nav');
      setIsDrawerOpen(true);
      pinLookup.current?.abort();
      const lookup = new AbortController();
      pinLookup.current = lookup;
      try {
        const revResp = await fetchWithAuth(`/api/v1/geo/reverse?lat=${e.lngLat.lat}&lon=${e.lngLat.lng}`, { signal: lookup.signal });
        if (revResp.ok) {
          const revData = await revResp.json();
          if (lookup.signal.aborted) return;
          const pName = revData.name || 'Selected Position';
          setTargetPin({
            lat: e.lngLat.lat,
            lon: e.lngLat.lng,
            name: pName,
            display_name: revData.display_name
          });
          if (pinMarkerRef.current) {
            const el = pinMarkerRef.current.getElement();
            const badgeName = el.querySelector('.geo-pin-hud-name');
            if (badgeName) badgeName.textContent = pName;
          }
        }
      } catch {
        if (lookup.signal.aborted) return;
        setTargetPin({
          lat: e.lngLat.lat,
          lon: e.lngLat.lng,
          name: `Pin (${e.lngLat.lat.toFixed(4)}°, ${e.lngLat.lng.toFixed(4)}°)`
        });
      }
    });

    return () => {
      if (userMarkerRef.current) {
        userMarkerRef.current.remove();
        userMarkerRef.current = null;
      }
      destMarkerRef.current?.remove();
      pinMarkerRef.current?.remove();
      viewport.current = { center: map.getCenter().toArray(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
      map.remove();
      mapRef.current = null;
    };
  }, [basemap]);

  // Keep ref up to date for map click event handlers
  const measureModeRef = useRef(measureMode);
  measureModeRef.current = measureMode;
  const measurePolygonRef = useRef(measurePolygon);
  measurePolygonRef.current = measurePolygon;

  // Toggle 3D Camera Pitch
  const toggle3D = () => {
    if (!mapRef.current) return;
    const next = !is3D;
    setIs3D(next);
    mapRef.current.easeTo({
      pitch: next ? 52 : 0,
      bearing: next ? 25 : 0,
      duration: 1000
    });
  };

  // Recenter GPS
  // Clear active route and destination marker
  const clearRoute = () => {
    setNavigating(false);
    routeRequest.current?.abort();
    weatherRequest.current?.abort();
    routeRequestId.current += 1;
    setIsRouting(false);
    setActiveRoute(null);
    setRouteWeather(null);
    if (destMarkerRef.current) {
      destMarkerRef.current.remove();
      destMarkerRef.current = null;
    }
    const routeSource = mapRef.current?.getSource('tactical-route') as GeoJSONSource | undefined;
    if (routeSource) {
      routeSource.setData({
        type: 'FeatureCollection',
        features: []
      });
    }
    setStatusMessage('Course cleared.');
  };

  const handleRecenter = () => {
    if (fixAge !== null && fixAge > 15 && currentCoordsRef.current) {
      const map = mapRef.current;
      map?.flyTo({ center: currentCoordsRef.current, zoom: Math.min(map.getZoom(), 12), pitch: 0, duration: 600 });
    }
    recenterOnUser();
  };

  // Plot and draw route to destination with alternatives
  const calculateAndRenderRoute = async (dest: DestinationItem, modeOverride?: TravelMode, navigationOrigin?: RoutePoint, remainingStops?: DestinationItem[], allowEstimatedStart = false) => {
    if (!navigationOrigin) {
      setTripDestination(dest);
      setIsDrawerOpen(true);
      setActiveTab('nav');
    }
    if (!mapRef.current) return;
    const mode = modeOverride || transitModeRef.current;
    const manual = navigationOrigin ? null : manualOriginRef.current;
    const origin = navigationOrigin || (manual ? [manual.lon, manual.lat] as const : currentCoordsRef.current);
    if (!navigationOrigin) clearRoute();
    routeRequest.current?.abort();
    const requestId = ++routeRequestId.current;
    const age = Date.now() - gpsFixTime.current;
    const estimatedStart = !navigationOrigin && !manual &&
      (age > 15000 || gpsUnavailable || gpsAccuracy === null || gpsAccuracy > 40);
    if (estimatedStart && (!allowEstimatedStart || age > 300000)) {
      setStatusMessage(origin && age <= 300000
        ? 'Preview from the estimated location or choose another start.'
        : 'Search for a starting point or pick one on the map.');
      return;
    }
    if (!origin) {
      setStatusMessage('Enable location or choose a map pin and select Set as Start.');
      return;
    }
    transitModeRef.current = mode;
    setTransitMode(mode);
    const request = new AbortController();
    routeRequest.current = request;
    const requestedStops = remainingStops ?? stops;
    const stopParams = new URLSearchParams();
    for (const stop of requestedStops) stopParams.append('stop', `${stop.lon},${stop.lat}`);
    if (!navigationOrigin && optimizeStops && requestedStops.length > 1) stopParams.set('optimize', 'true');
    if (useTrafficRouting && mode === 'driving') {
      stopParams.set('traffic', 'true');
      if (!navigationOrigin && dest.calendarTrip && Date.parse(dest.calendarTrip.start.dateTime) - arrivalBuffer * 60000 > Date.now()) {
        stopParams.set('arrive_by', eventArrivalLocal(dest.calendarTrip, arrivalBuffer));
      }
    }
    const stopQuery = stopParams.size ? `&${stopParams}` : '';
    setIsRouting(true);
    setStatusMessage(`Plotting ${mode} course for ${dest.name}...`);

    try {
      const [startLon, startLat] = origin;
      const resp = await fetchWithAuth(
        `/api/v1/geo/route?start_lat=${startLat}&start_lon=${startLon}&end_lat=${dest.lat}&end_lon=${dest.lon}&mode=${mode}${stopQuery}`, { signal: AbortSignal.any([request.signal, AbortSignal.timeout(20000)]) }
      );
      if (!resp.ok) throw new Error('Routing calculation failed');
      const data = await resp.json();
      if (request.signal.aborted || requestId !== routeRequestId.current || !mapRef.current) return;
      if (data.status !== 'success' || !data.geometry) {
        if (navigationOrigin) setNavigationStatus('Rerouting failed. Atlas will retry if you stay off route.');
        setStatusMessage(routeFailureMessage(data.reason));
        return;
      }

      const distKm = Math.round((data.distance_meters / 1000) * 10) / 10;
      const durMin = Math.round(data.duration_seconds / 60);
      const steps = (data.legs || []).flatMap((leg: { steps?: RouteStep[] }) => leg.steps || []);

      setActiveRoute({
        originCoordinates: [startLon, startLat],
        origin: manual ? manual.name || 'Selected map pin' : estimatedStart ? 'Estimated device location' : 'Device location',
        destination: dest,
        distance_km: distKm,
        duration_min: durMin,
        steps,
        stops: data.optimization ? data.optimization.order.map((index: number) => requestedStops[index]) : requestedStops,
        geometry: data.geometry,
        options: [data, ...(data.alternatives || []).filter((route: RouteAlternative) => route.geometry)],
        selected: 0,
        optimization: data.optimization,
        source: data.source,
        calculatedAt: data.calculated_at,
        mode
      });

      // Add or update destination beacon marker (Upright 3D Destination Tower)
      if (destMarkerRef.current) {
        destMarkerRef.current.setLngLat([dest.lon, dest.lat]);
      } else {
        const el = document.createElement('div');
        el.className = 'geo-target-pin-3d dest';
        el.innerHTML = '<span class="atlas-map-pin" aria-hidden="true"><span>⚑</span></span>';
        destMarkerRef.current = new Marker({ element: el, anchor: 'bottom' })
          .setLngLat([dest.lon, dest.lat])
          .addTo(mapRef.current);
      }

      // Fit map bounds
      const bounds = new LngLatBounds();
      bounds.extend([startLon, startLat]);
      for (const point of data.geometry.coordinates as [number, number][]) bounds.extend(point);
      bounds.extend([dest.lon, dest.lat]);
      if (!navigationOrigin) mapRef.current.fitBounds(bounds, { padding: 110, duration: 1400 });

      setStatusMessage(`Course locked: ${dest.name} (${distKm} km · ${durMin} min)`);
      setShowInspector(true);
    } catch (e) {
      if (request.signal.aborted) return;
      console.error(e);
      if (requestId === routeRequestId.current) {
        if (navigationOrigin) setNavigationStatus('Rerouting failed. Atlas will retry if you stay off route.');
        setStatusMessage('Routing is unavailable. Try again in a moment.');
      }
    } finally {
      if (requestId === routeRequestId.current) setIsRouting(false);
    }
  };

  routeCalculator.current = calculateAndRenderRoute;

  const setTripOrigin = (place: typeof manualOrigin) => {
    manualOriginRef.current = place;
    setManualOrigin(place);
    setContextSource('auto');
    searchRequest.current?.abort();
    searchRequestId.current += 1;
    setIsSearching(false);
    setSearchResults(previous => previous.filter(result => !result.nearbyOrigin));
    setNearbyStatus('');
    clearRoute();
  };

  const changeStartSelection = (enabled: boolean) => {
    pickStart.current = enabled;
    setPickingStart(enabled);
    setStatusMessage('');
  };

  const confirmMapStart = ([lon, lat]: RoutePoint) => {
    changeStartSelection(false);
    setTripOrigin({ name: 'Selected map start', lon, lat });
  };

  const assignTripPlace = (place: DestinationItem, field = placeField) => {
    if (field === 'origin') setTripOrigin(place);
    if (field === 'destination') {
      setTripDestination(place);
      clearRoute();
    }
    if (field === 'stop' && stops.length < 8) {
      setStops([...stops, place]);
      clearRoute();
    }
    setSearchResults([]);
    setStatusMessage(field === 'origin' ? `Route start set to ${place.name}.` : `${place.name} added to trip.`);
  };

  const moveTripStop = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= stops.length || to >= stops.length) return;
    const ordered = [...stops];
    const [stop] = ordered.splice(from, 1);
    ordered.splice(to, 0, stop);
    setStops(ordered);
    clearRoute();
  };

  const storeTrips = (trips: SavedTrip[]) => {
    try {
      localStorage.setItem(tripStorageKey, JSON.stringify(trips));
      setSavedTrips(trips);
      return true;
    } catch {
      setStatusMessage('Could not save trips in this browser.');
      return false;
    }
  };

  const saveTrip = () => {
    if (!tripDestination || !tripName.trim()) return;
    const cleanPlace = ({ name, display_name, lat, lon }: DestinationItem): DestinationItem => ({ name, display_name, lat, lon });
    const trip: SavedTrip = {
      id: editingTripId || crypto.randomUUID(),
      name: tripName.trim(),
      origin: manualOrigin ? { ...manualOrigin, name: manualOrigin.name || 'Map pin', display_name: '' } : null,
      destination: cleanPlace(tripDestination),
      stops: stops.map(cleanPlace),
      mode: transitMode,
      optimize: optimizeStops,
      arrivalBuffer,
      traffic: useTrafficRouting
    };
    const trips = savedTrips.some(item => item.id === trip.id)
      ? savedTrips.map(item => item.id === trip.id ? trip : item)
      : [...savedTrips, trip];
    if (storeTrips(trips)) {
      setEditingTripId(trip.id);
      setStatusMessage(`Saved trip: ${trip.name}.`);
    }
  };

  const loadTrip = (trip: SavedTrip) => {
    setTripOrigin(trip.origin);
    setTripDestination(trip.destination);
    setStops(trip.stops);
    setOptimizeStops(trip.optimize);
    setArrivalBuffer(trip.arrivalBuffer);
    setUseTrafficRouting(Boolean(trip.traffic));
    setTransitMode(trip.mode);
    transitModeRef.current = trip.mode;
    setSearchResults([]);
    setEditingTripId(trip.id);
    setTripName(trip.name);
    setStatusMessage(`Loaded ${trip.name}. Preview route for updated directions.`);
  };

  const fixAge = gpsFixTime.current ? Math.max(0, Math.floor((contextClock - gpsFixTime.current) / 1000)) : null;
  const gpsLocked = fixAge !== null && fixAge <= 15 && !gpsUnavailable &&
    gpsAccuracy !== null && gpsAccuracy <= 40;
  const locationStatus = gpsUnavailable ? 'UNAVAILABLE' : fixAge === null ? 'ACQUIRING'
    : fixAge > 15 ? 'LAST KNOWN' : gpsLocked ? 'PRECISE' : 'APPROXIMATE';
  useEffect(() => {
    const element = userMarkerRef.current?.getElement();
    if (!element) return;
    element.dataset.fix = gpsLocked ? 'current' : gpsUnavailable || (fixAge ?? 0) > 15 ? 'stale' : 'approximate';
    element.title = gpsLocked ? 'Your location' : element.dataset.fix === 'stale' ? 'Last known location' : 'Approximate location';
    const heading = element.querySelector<HTMLElement>('.atlas-gps-heading');
    if (heading) {
      heading.hidden = !gpsLocked || deviceHeading === null;
      heading.style.setProperty('--atlas-heading', (deviceHeading ?? 0) + 'deg');
    }
  }, [basemap, currentCoords, gpsLocked, gpsUnavailable, fixAge, deviceHeading]);
  const nearbySource = contextSource === 'auto'
    ? manualOrigin ? 'start' : targetPin ? 'pin' : gpsLocked ? 'device' : 'map'
    : contextSource;
  const nearbySourceLabel = {
    start: manualOrigin?.name || 'Trip start',
    pin: targetPin?.name || 'Selected pin',
    device: 'Device location',
    map: 'Map center'
  }[nearbySource];
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const area = currentCoords && gpsAccuracy !== null && !gpsLocked
      ? buffer({ type: 'Point', coordinates: currentCoords }, gpsAccuracy, { units: 'meters', steps: 32 })
      : undefined;
    const render = () => {
      const source = map.getSource('device-location-accuracy') as GeoJSONSource | undefined;
      source?.setData(area ?? { type: 'FeatureCollection', features: [] });
      if (source) {
        map.setPaintProperty('device-location-accuracy-fill', 'fill-opacity', gpsUnavailable ? 0.04 : 0.09);
        map.setPaintProperty('device-location-accuracy-outline', 'line-opacity', gpsUnavailable ? 0.16 : 0.35);
      }
    };
    render();
    map.on('load', render);
    return () => { map.off('load', render); };
  }, [basemap, currentCoords, gpsAccuracy, gpsLocked, gpsUnavailable]);

  const accuracyLabel = gpsAccuracy === null ? '' : gpsAccuracy >= 1000
    ? `±${Math.ceil(gpsAccuracy / 100) / 10} km` : `±${Math.ceil(gpsAccuracy)} m`;

  useEffect(() => {
    setComparison(null);
    return () => comparisonRequest.current?.abort();
  }, [searchResults, nearbyDirection, transitMode, useTrafficRouting]);

  const fetchNearbyRoute = async (place: DestinationItem, mode: TravelMode, signal: AbortSignal, traffic = false) => {
    if (!place.nearbyOrigin) throw new Error('Choose a nearby result first.');
    const [lon, lat] = place.nearbyOrigin;
    const query = new URLSearchParams({
      start_lat: String(lat), start_lon: String(lon),
      end_lat: String(place.lat), end_lon: String(place.lon), mode
    });
    if (traffic && mode === 'driving') query.set('traffic', 'true');
    const response = await fetchWithAuth(`/api/v1/geo/route?${query}`, { signal });
    if (!response.ok) throw new Error('Routing unavailable');
    return response.json();
  };

  const estimateWalking = async (place: DestinationItem) => {
    if (!place.nearbyOrigin) return;
    const [lon, lat] = place.nearbyOrigin;
    const key = `${lon},${lat}:${place.lon},${place.lat}`;
    setWalkingEstimates(previous => ({ ...previous, [key]: 'Checking walking route…' }));
    try {
      const route = await fetchNearbyRoute(place, 'walking', AbortSignal.timeout(12000));
      setWalkingEstimates(previous => ({ ...previous, [key]: route.status === 'success'
        ? `${Math.max(1, Math.round(route.duration_seconds / 60))} min walking` : routeFailureMessage(route.reason) }));
    } catch {
      setWalkingEstimates(previous => ({ ...previous, [key]: 'Walking estimate unavailable.' }));
    }
  };

  const handleNearbySearch = async (category: 'hospital' | 'fuel' | 'food' | 'pharmacy' | 'atm', announce = false, searchMapCenter = false) => {
    setContextOpen(true);
    setActiveTab('nav');
    setIsDrawerOpen(true);
    searchRequest.current?.abort();
    const requestId = ++searchRequestId.current;
    setSearchResults([]);
    setNearbyDirection('');
    setStatusMessage('');
    const source = searchMapCenter ? 'map' : nearbySource;
    const label = searchMapCenter ? 'Map center' : nearbySourceLabel;
    const center = mapRef.current?.getCenter().wrap().toArray() ?? mapCenter;
    const location: RoutePoint | null = source === 'start' && manualOrigin ? [manualOrigin.lon, manualOrigin.lat]
      : source === 'pin' ? targetPin ? [targetPin.lon, targetPin.lat] : null
      : source === 'device' ? currentCoords : center;
    if (!location || (source === 'device' && (!gpsLocked || Date.now() - gpsFixTime.current > 15000))) {
      setIsSearching(false);
      setNearbyStatus('Choose a map pin or map center, or refresh your device location.');
      return;
    }
    const request = new AbortController();
    if (searchMapCenter) setContextSource('map');
    setLastNearbySearch({ category, center });
    searchRequest.current = request;
    setIsSearching(true);
    setNearbyStatus(`Searching near ${label}…`);

    try {
      const [lon, lat] = location;
      const resp = await fetchWithAuth(`/api/v1/geo/nearby?lat=${lat}&lon=${lon}&category=${category}&limit=8`, {
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(12000)])
      });
      if (!resp.ok) throw new Error(resp.status === 503 ? 'The place provider is unavailable. Try again shortly.' : 'Nearby search could not reach the local map service.');
      const data = await resp.json();
      if (request.signal.aborted || requestId !== searchRequestId.current) return;
      const places = ((data.results || []) as DestinationItem[]).map(place => ({
        ...place,
        nearbyOrigin: location,
        nearbyOriginName: label,
        bearing: ['N','NE','E','SE','S','SW','W','NW'][Math.round(calculateBearing(lat, lon, place.lat, place.lon).deg / 45) % 8]
      }));
      setSearchResults(places);
      if (announce) {
        const summary = places.slice(0, 3).map(place =>
          `${place.name}, ${place.bearing}${place.distance_km == null ? '' : `, ${place.distance_km.toFixed(1)} kilometers straight-line`}`).join('. ');
        speakWithKokoro(summary || 'No nearby places were returned.');
      }
      if (places.length) {
        setNearbyStatus(`${places.length} found near ${label}.`);
      } else {
        setNearbyStatus(`No matches near ${label}. Try another search area.`);
      }
    } catch (e) {
      if (request.signal.aborted) return;
      console.error(e);
      if (requestId === searchRequestId.current) setNearbyStatus(e instanceof Error && e.name === 'TimeoutError'
        ? 'Nearby search timed out. Try again.'
        : e instanceof Error ? e.message : 'Nearby search is unavailable. Try again.');
    } finally {
      if (requestId === searchRequestId.current) setIsSearching(false);
    }
  };

  // Parking Save / Recall
  const handleParkingAction = async (replace = false) => {
    if (savedParking && !replace) {
      await calculateAndRenderRoute({
        name: `Parked Vehicle (${savedParking.floor_level || 'Saved Spot'})`,
        display_name: savedParking.landmark_note || 'Saved parking coordinates',
        lat: savedParking.lat,
        lon: savedParking.lon
      });
    } else {
      const parkingLocation = targetPin ? [targetPin.lon, targetPin.lat]
        : gpsLocked && Date.now() - gpsFixTime.current <= 15000 ? currentCoords : null;
      if (!parkingLocation) {
        setStatusMessage('Refresh your location or select a pin before saving parking.');
        return;
      }
      try {
        const [lon, lat] = parkingLocation;
        const resp = await fetchWithAuth('/api/v1/geo/parking', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lat,
            lon,
            floor_level: parkingFloor.trim() || undefined,
            landmark_note: parkingNote.trim() || undefined,
            photo: parkingPhoto
          })
        });
        if (!resp.ok) throw new Error('Parking save failed');
        const data = await resp.json();
        setSavedParking(data.parking);
        setParkingFloor('');
        setParkingNote('');
        setParkingPhoto(null);
        setParkingSavedNotice(true);
        setTimeout(() => setParkingSavedNotice(false), 4000);
        setStatusMessage('Vehicle parking coordinates locked.');
      } catch (e) {
        console.error(e);
        setStatusMessage('Failed to store parking coordinates.');
      }
    }
  };

  const prepareParkingPhoto = async (file: File) => {
    setLoadingParkingPhoto(true);
    try {
      if (file.size > 12 * 1024 * 1024) throw new Error('Image too large');
      const image = await createImageBitmap(file);
      try {
        const scale = Math.min(1, 960 / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Image conversion unavailable');
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const photo = canvas.toDataURL('image/jpeg', 0.7);
        if (photo.length > 400023) throw new Error('Image is too detailed');
        setParkingPhoto(photo);
      } finally {
        image.close();
      }
    } catch {
      setStatusMessage('Could not use this photo. Choose a smaller JPEG, PNG, or WebP image.');
    } finally {
      setLoadingParkingPhoto(false);
    }
  };

  const clearParking = async () => {
    try {
      const response = await fetchWithAuth('/api/v1/geo/parking', { method: 'DELETE' });
      if (!response.ok) throw new Error('Parking clear failed');
      setSavedParking(null);
      setStatusMessage('Saved parking cleared.');
    } catch {
      setStatusMessage('Could not clear saved parking.');
    }
  };

  // Bookmark Save
  const handleSavePlace = async (place: { name?: string; lat: number; lon: number; display_name?: string }) => {
    const name = place.name?.trim().slice(0, 100) || 'Pinned Location';
    try {
      const resp = await fetchWithAuth('/api/v1/geo/places', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          lat: place.lat,
          lon: place.lon,
          display_name: place.display_name || name
        })
      });
      if (!resp.ok) throw new Error('Save place failed');
      const data = await resp.json();
      setSavedPlaces(previous => [...previous, data.place]);
      setStatusMessage(`Saved place "${data.place.name}".`);
    } catch (e) {
      console.error(e);
      setStatusMessage('Could not save this place. Try again.');
    }
  };

  // Delete Bookmark
  const handleDeletePlace = async (id: string) => {
    try {
      const resp = await fetchWithAuth(`/api/v1/geo/places/${id}`, { method: 'DELETE' });
      if (resp.ok) {
        setSavedPlaces((prev) => prev.filter((p) => p.id !== id));
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Handle Search Input submit
  const findPlaces = async (query: string, signal?: AbortSignal): Promise<DestinationItem[]> => {
    const manual = manualOriginRef.current;
    const location = manual ? [manual.lon, manual.lat] : currentCoordsRef.current;
    const bias = location ? `&lat=${location[1]}&lon=${location[0]}` : '';
    const response = await fetchWithAuth(`/api/v1/geo/search?q=${encodeURIComponent(query)}&limit=5&language=${searchLanguage}&sri_lanka=${sriLankaOnly}${bias}`, { signal });
    if (!response.ok) throw new Error('Place search failed');
    return (await response.json()).results;
  };

  const searchDestinations = async (query: string, event: CalendarTrip | null = null) => {
    if (!query.trim()) return;
    setNearbyStatus('');
    searchRequest.current?.abort();
    const request = new AbortController();
    searchRequest.current = request;
    const requestId = ++searchRequestId.current;
    setIsSearching(true);
    setSearchResults([]);
    setStatusMessage(`Searching "${query}"...`);
    try {
      const places = await findPlaces(query.trim(), request.signal);
      if (request.signal.aborted || requestId !== searchRequestId.current) return;
      setSearchResults(event ? places.map(place => ({ ...place, calendarTrip: event })) : places);
      if (places.length && !event) {
        const recent = [query.trim(), ...recentSearches.filter(item => item !== query.trim())].slice(0, 5);
        setRecentSearches(recent);
        try { localStorage.setItem('oracle_atlas_recent', JSON.stringify(recent)); } catch { /* Session history remains available. */ }
      }
      setStatusMessage(places.length ? 'Choose a destination.' : `No locations found matching "${query}".`);
    } catch {
      if (!request.signal.aborted && requestId === searchRequestId.current) setStatusMessage('Place search is unavailable. Try again in a moment.');
    } finally {
      if (requestId === searchRequestId.current) setIsSearching(false);
    }
  };

  const loadProviders = async (check: boolean) => {
    setCheckingProviders(true);
    try {
      const response = await fetchWithAuth(`/api/v1/geo/providers?check=${check}`);
      if (!response.ok) throw new Error('Provider status unavailable');
      setProviderInfo(await response.json());
    } catch {
      setStatusMessage('Atlas could not load provider status.');
    } finally {
      setCheckingProviders(false);
    }
  };

  useEffect(() => {
    void loadProviders(false);
  }, []);

  const providerMissing = (mode: TravelMode | 'traffic_routing') => providerInfo?.providers?.[mode] === 'not_configured';
  const missingRouteProvider = providerMissing(transitMode) || (transitMode === 'driving' && useTrafficRouting && providerMissing('traffic_routing'));

  const loadCalendarTrips = async () => {
    try {
      const response = await fetchWithAuth('/api/v1/google/events?days=7');
      if (!response.ok) throw new Error('Calendar unavailable');
      const data = await response.json();
      const trips = (data.events as CalendarTrip[]).filter(event =>
        event.location?.trim() && event.status !== 'cancelled' && Date.parse(event.start?.dateTime) > Date.now()
      );
      setCalendarTrips(trips);
      setStatusMessage(trips.length ? 'Choose a calendar event.' : 'No upcoming timed events with a location.');
    } catch {
      setStatusMessage('Calendar unavailable. Check your Google Calendar connection.');
    }
  };

  useEffect(() => {
    if (!briefingTrip) return;
    setIsDrawerOpen(true);
    setActiveTab('nav');
    setTripOrigin(briefingTrip.origin);
    setTripDestination(briefingTrip.destination);
    setStops([]);
    setArrivalBuffer(briefingTrip.arrivalBuffer);
    setTransitMode(briefingTrip.mode);
    transitModeRef.current = briefingTrip.mode;
    setStatusMessage('Trip loaded from Daily Briefing. Preview route for updated directions.');
  }, [briefingTrip]);

  useEffect(() => {
    if (!command || handledCommand.current === command) return;
    handledCommand.current = command;
    setIsDrawerOpen(true);
    setActiveTab('nav');
    const text = command.text.replace(/^(?:(?:(?:hey|ok|okay) )?oracle[, ]+)?(?:please )?/i, '').trim();
    const trip = /^route from (.+?) to (.+?)[?.!]*$/i.exec(text);
    const spatialCommand = parseAtlasSpatialCommand(text);
    const nearby = /^(?:find|show)(?: me)? (?:the )?(?:nearest|nearby) (hospitals?|pharmacy|pharmacies|fuel|food|atms?)[?.!]*$/i.exec(text);
    if (trip) {
      void findPlaces(trip[1]).then(origins => {
        if (origins.length !== 1) {
          setSearchResults(origins);
          setStatusMessage(origins.length
            ? 'Choose Set as Start on a matching origin, then search for your destination.'
            : 'Start location could not be found.');
          setSearchQuery(trip[2]);
          return;
        }
        manualOriginRef.current = origins[0];
        setManualOrigin(origins[0]);
        setSearchQuery(trip[2]);
        void searchDestinations(trip[2]);
      }).catch(() => setStatusMessage('Could not look up the starting point.'));
    } else if (nearby) {
      const category = nearby[1].toLowerCase();
      void handleNearbySearch((category === 'pharmacies' ? 'pharmacy' : category.replace(/s$/, '')) as
        'hospital' | 'pharmacy' | 'fuel' | 'food' | 'atm', true);
    } else if (spatialCommand?.kind === 'context') {
      setContextOpen(true);
      setStatusMessage('Choose a nearby place category to search around your selected location.');
    } else if (spatialCommand?.kind === 'direction') {
      setContextOpen(true);
      setNearbyDirection(spatialCommand.bearing);
      const nearbyPlaces = searchResults.filter(place => place.bearing);
      const matches = nearbyPlaces.filter(place => place.bearing === spatialCommand.bearing);
      const summary = matches.length ? matches.slice(0, 5).map(place => place.name).join(', ')
        : nearbyPlaces.length ? 'No returned places match that direction.' : 'Search for a nearby category first.';
      setStatusMessage(summary);
      speakWithKokoro(summary);
    } else if (spatialCommand?.kind === 'area') {
      setActiveTab('layers');
      const term = spatialCommand.term.replace(/s$/, '');
      const namedLayer = importedLayers.find(layer => layer.name.toLowerCase().includes(term));
      const layer = namedLayer || inspectedLayer;
      const area = spatialAreas.find(item => item.id === spatialCommand.area)?.feature;
      if (!area || !layer) {
        setStatusMessage('Create the requested area and open an imported layer first.');
        return;
      }
      if ((spatialCommand.minutes && spatialCommand.minutes !== Number(area.properties?.minutes)) ||
          (spatialCommand.mode && spatialCommand.mode !== area.properties?.mode)) {
        setStatusMessage('The available reachability area uses a different time or travel mode.');
        return;
      }
      const filter = { ...emptySpatialFilter, value: namedLayer ? '' : term, area: spatialCommand.area };
      const count = filterAtlasFeatures(layer, filter, area).length;
      setInspectedLayerId(layer.id);
      setSpatialFilters(previous => ({ ...previous, [layer.id]: filter }));
      setStatusMessage(`${count} matching features intersect the area in ${layer.name}.`);
      speakWithKokoro(`${count} matching features in ${layer.name}.`);
    } else if (/^where did i park[?.!]*$/i.test(text)) {
      void fetchWithAuth('/api/v1/geo/parking').then(async response => {
        if (!response.ok) throw new Error('Parking unavailable');
        const data = await response.json();
        setSavedParking(data.parking);
        setStatusMessage(data.saved ? 'Saved parking is shown in the map drawer.' : 'No parking spot is saved.');
      }).catch(() => setStatusMessage('Parking storage is unavailable.'));
    } else if (/^when should i leave[?.!]*$/i.test(text)) {
      void loadCalendarTrips();
    } else {
      const query = text.replace(/^(?:show me|navigate to|route to)\s+/i, '').replace(/[?.!]+$/, '').replace(/ on (?:the )?map$/i, '');
      setSearchQuery(query);
      void searchDestinations(query);
    }
  }, [command]);

  const selectRoute = (index: number) => {
    const option = activeRoute?.options[index];
    if (!activeRoute || !option || navigating) return;
    setActiveTab('nav');
    setIsDrawerOpen(true);
    if (index === activeRoute.selected) return;
    weatherRequest.current?.abort();
    setRouteWeather(null);
    setNavigating(false);
    setActiveRoute({
      ...activeRoute,
      selected: index,
      geometry: option.geometry,
      distance_km: Math.round(option.distance_meters / 100) / 10,
      duration_min: Math.round(option.duration_seconds / 60),
      steps: (option.legs || []).flatMap(leg => leg.steps || [])
    });
  };
  routeSelection.current = selectRoute;

  useEffect(() => {
    if (!navigating || !activeRoute) return;
    if (!navigator.geolocation) {
      setNavigationStatus('Device location is unavailable.');
      return;
    }

    const track = buildRouteTrack(activeRoute.geometry.coordinates);
    let progress = 0;
    let offRouteFixes = 0;
    let lastSpoken = -1;
    let maneuverProgress = 0;
    let finished = false;
    let rerouting = false;
    let completedStops = 0;
    let lastFix = Date.now();
    let signalWeak = false;
    let stopProgress = 0;
    const stopArrivals = activeRoute.stops.map((stop, index) => {
      const location = activeRoute.options[activeRoute.selected].legs?.[index]?.steps?.at(-1)?.maneuver?.location
        ?? [stop.lon, stop.lat] as RoutePoint;
      stopProgress = Math.max(stopProgress, track.project(location, stopProgress).progress);
      return { location, progress: stopProgress };
    });
    const staleTimer = window.setInterval(() => {
      if (!finished && !rerouting && !signalWeak && Date.now() - lastFix > 15000) {
        signalWeak = true;
        offRouteFixes = 0;
        setNavigationStatus('GPS signal weak. Guidance paused until a fresh fix is available.');
      }
    }, 1000);
    const maneuvers = activeRoute.steps.flatMap((step, index) => {
      if (!step.maneuver.location || step.maneuver.type === 'depart') return [];
      const match = track.project(step.maneuver.location, maneuverProgress - 5);
      maneuverProgress = Math.max(maneuverProgress, match.progress);
      return [{ step, index, progress: maneuverProgress }];
    });

    const watch = navigator.geolocation.watchPosition(position => {
      if (finished || rerouting) return;
      const { coords, timestamp } = position;
      if (!Number.isFinite(coords.accuracy) || coords.accuracy <= 0 || coords.accuracy > 40 || Date.now() - timestamp > 15000 || timestamp < gpsFixTime.current) {
        signalWeak = true;
        setNavigationStatus('GPS signal weak. Guidance paused until accuracy is within 40 m.');
        offRouteFixes = 0;
        return;
      }
      if (signalWeak) lastSpoken = -1;
      signalWeak = false;
      lastFix = timestamp;
      const point: RoutePoint = [coords.longitude, coords.latitude];
      currentCoordsRef.current = point;
      gpsFixTime.current = timestamp;
      setContextClock(Date.now());
      setDeviceHeading(coords.heading != null && Number.isFinite(coords.heading) && (coords.speed || 0) > 1 ? coords.heading : null);
      setCurrentCoords(point);
      setGpsUnavailable(false);
      setGpsAccuracy(coords.accuracy);
      updateUserMarker(point);
      const match = track.project(point, progress - 80);
      if (match.distance > 60 + coords.accuracy) {
        offRouteFixes += 1;
        setNavigationStatus('Off route. Checking your position…');
        if (offRouteFixes >= 3 && Date.now() - lastReroute.current > 30000) {
          rerouting = true;
          offRouteFixes = 0;
          lastReroute.current = Date.now();
          setNavigationStatus('Updating the route from your current position…');
          void routeCalculator.current(activeRoute.destination, activeRoute.mode, point, activeRoute.stops.slice(completedStops))
            .finally(() => { rerouting = false; });
        }
        return;
      }
      offRouteFixes = 0;
      progress = Math.max(progress, match.progress);
      const arrivalRadius = Math.max(25, coords.accuracy);
      while (completedStops < stopArrivals.length) {
        const nextStop = stopArrivals[completedStops];
        const nearStop = buildRouteTrack([point, nextStop.location]).total <= arrivalRadius;
        if (progress < nextStop.progress + arrivalRadius && !(nearStop && progress >= nextStop.progress - arrivalRadius)) break;
        completedStops += 1;
      }
      const remaining = Math.max(0, track.total - progress);
      if (completedStops === stopArrivals.length && remaining <= 20 && match.distance <= 25) {
        finished = true;
        setNavigationStatus('Arrived at your destination.');
        if (recordHistoryRef.current) {
          saveTripHistory([{
            id: crypto.randomUUID(), destination: activeRoute.destination.name,
            mode: activeRoute.mode, completedAt: Date.now()
          }, ...tripHistoryRef.current].slice(0, 100));
        }
        if (spokenNavigationRef.current) speakWithKokoro('Arrived at your destination.');
        navigator.geolocation.clearWatch(watch);
        window.clearInterval(staleTimer);
        return;
      }

      const next = maneuvers.find(item => item.progress >= progress - 8);
      const distance = next ? Math.max(0, Math.round(next.progress - progress)) : 0;
      const instruction = next ? routeStepLabel(next.step) : 'Continue on the route';
      setNavigationStatus(`${instruction}${next ? ` in ${distance} m` : ''} · ${(remaining / 1000).toFixed(1)} km remaining`);
      if (next && distance <= 120 && next.index !== lastSpoken && spokenNavigationRef.current) {
        lastSpoken = next.index;
        speakWithKokoro(`${instruction} in ${distance} meters.`);
      }
    }, failure => {
      signalWeak = true;
      offRouteFixes = 0;
      setNavigationStatus(failure.code === 1 ? 'Location permission is required for navigation.' : 'GPS signal weak. Guidance paused until a fresh fix is available.');
    }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 12000 });

    return () => {
      window.clearInterval(staleTimer);
      navigator.geolocation.clearWatch(watch);
    };
  }, [navigating, activeRoute, updateUserMarker, saveTripHistory]);

  const drawRoutes = (map: Map, route: ActiveRouteData | null) => {
    const source = map.getSource('tactical-route') as GeoJSONSource | undefined;
    source?.setData({
      type: 'FeatureCollection',
      features: route ? route.options.map((option, index) => ({
        type: 'Feature',
        geometry: option.geometry,
        properties: { selected: index === route.selected, routeIndex: index }
      })) : []
    });
  };

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const render = () => drawRoutes(map, activeRoute);
    const markers: Marker[] = [];
    if (activeRoute) {
      if (activeRoute.origin !== 'Device location' && activeRoute.origin !== 'Estimated device location') {
        const element = document.createElement('div');
        element.className = 'atlas-route-start';
        element.title = activeRoute.origin;
        markers.push(new Marker({ element }).setLngLat(activeRoute.originCoordinates).addTo(map));
      }
      activeRoute.stops.forEach((stop, index) => {
        const element = document.createElement('div');
        element.className = 'atlas-route-stop';
        element.title = stop.name;
        element.textContent = String(index + 1);
        markers.push(new Marker({ element }).setLngLat([stop.lon, stop.lat]).addTo(map));
      });
    }
    render();
    map.on('load', render);
    return () => {
      map.off('load', render);
      markers.forEach(marker => marker.remove());
    };
  }, [activeRoute, basemap]);

  // 3D Route Fly-Through Animation Controller
  const stopFlyThrough = useCallback(() => {
    cancelAnimationFrame(flyThroughRef.current.rafId);
    setIsFlyThroughActive(false);
    setFlyThroughPaused(false);
    setFlyThroughProgress(0);
    setFlyThroughManeuver('');
    const prev = flyThroughRef.current.previousView;
    if (prev && mapRef.current) {
      mapRef.current.flyTo({
        center: prev.center,
        zoom: prev.zoom,
        pitch: prev.pitch,
        bearing: prev.bearing,
        duration: 1200
      });
    }
  }, []);

  const startFlyThrough = useCallback(() => {
    if (!mapRef.current || !activeRoute?.geometry?.coordinates?.length) return;
    const coords = activeRoute.geometry.coordinates as [number, number][];
    if (coords.length < 2) return;

    const map = mapRef.current;
    flyThroughRef.current.previousView = {
      center: map.getCenter().wrap().toArray() as [number, number],
      zoom: map.getZoom(),
      pitch: map.getPitch(),
      bearing: map.getBearing()
    };
    flyThroughRef.current.coords = coords;
    flyThroughRef.current.progressIndex = 0;

    setIsFlyThroughActive(true);
    setFlyThroughPaused(false);
    setIsDrawerOpen(false);

    const startBearing = calculatePathBearing(coords[0], coords[1]);
    map.flyTo({
      center: coords[0],
      zoom: 16.5,
      pitch: 58,
      bearing: startBearing,
      duration: 1000
    });
  }, [activeRoute]);

  useEffect(() => {
    if (!isFlyThroughActive || flyThroughPaused) return;
    const map = mapRef.current;
    if (!map) return;
    const coords = flyThroughRef.current.coords;
    if (!coords || coords.length < 2) return;

    let lastTime = performance.now();
    const animate = (time: number) => {
      const delta = Math.min((time - lastTime) / 1000, 0.1);
      lastTime = time;

      const step = 14 * flyThroughSpeed * delta;
      flyThroughRef.current.progressIndex += step;

      const idx = Math.floor(flyThroughRef.current.progressIndex);
      if (idx >= coords.length - 1) {
        setFlyThroughProgress(100);
        setFlyThroughManeuver('Arrived at destination');
        setTimeout(() => stopFlyThrough(), 1500);
        return;
      }

      const fraction = flyThroughRef.current.progressIndex - idx;
      const curr = coords[idx];
      const next = coords[idx + 1];
      const interpLon = curr[0] + (next[0] - curr[0]) * fraction;
      const interpLat = curr[1] + (next[1] - curr[1]) * fraction;
      const lookAheadIdx = Math.min(idx + 3, coords.length - 1);
      const targetBearing = calculatePathBearing([interpLon, interpLat], coords[lookAheadIdx]);

      map.jumpTo({
        center: [interpLon, interpLat],
        bearing: targetBearing,
        pitch: 58,
        zoom: 16.5
      });

      const pct = Math.min(100, Math.round((idx / (coords.length - 1)) * 100));
      setFlyThroughProgress(pct);

      if (activeRoute?.steps?.length) {
        const nextManeuver = activeRoute.steps.find((s) => s.maneuver?.instruction)?.maneuver?.instruction || '';
        setFlyThroughManeuver(nextManeuver);
      }

      flyThroughRef.current.rafId = requestAnimationFrame(animate);
    };

    flyThroughRef.current.rafId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(flyThroughRef.current.rafId);
  }, [isFlyThroughActive, flyThroughPaused, flyThroughSpeed, stopFlyThrough, activeRoute]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        return;
      }

      if (e.key === '?' || (e.key === '/' && !e.shiftKey)) {
        e.preventDefault();
        setShowKeybindings(prev => !prev);
        return;
      }

      if (e.key === 'Escape') {
        if (showKeybindings) {
          setShowKeybindings(false);
          return;
        }
        if (isFlyThroughActive) {
          stopFlyThrough();
          return;
        }
        if (bookmarksOpen) {
          setBookmarksOpen(false);
          return;
        }
        if (isDrawerOpen) {
          setIsDrawerOpen(false);
          return;
        }
        onClose();
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        handleRecenter();
        return;
      }

      if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        destinationSearch.current?.focus();
        return;
      }

      if (e.key === '3') {
        e.preventDefault();
        toggle3D();
        return;
      }

      if (e.key.toLowerCase() === 'r') {
        e.preventDefault();
        mapRef.current?.easeTo({ bearing: 0, duration: 600 });
        return;
      }

      if (e.key.toLowerCase() === 'p') {
        e.preventDefault();
        const next = mapPitch < 20 ? 45 : mapPitch < 55 ? 60 : 0;
        mapRef.current?.easeTo({ pitch: next, duration: 600 });
        return;
      }

      if (e.key.toLowerCase() === 'm') {
        e.preventDefault();
        setMeasureMode(prev => !prev);
        return;
      }

      if (e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setBookmarksOpen(prev => !prev);
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showKeybindings, isFlyThroughActive, bookmarksOpen, isDrawerOpen, onClose, handleRecenter, toggle3D, stopFlyThrough, mapPitch]);

  // GIS Tool: Calculate Geodesic Buffer
  const handleGenerateBuffer = async (radiusKm: number, pinCoords?: [number, number]) => {
    const center = pinCoords ?? (targetPin ? [targetPin.lon, targetPin.lat] : currentCoords);
    if (!center) {
      setStatusMessage('Select a pin or activate GPS for buffer center.');
      return;
    }
    setStatusMessage(`Computing ${radiusKm} km geodesic buffer...`);
    try {
      const resp = await fetchWithAuth('/api/v1/geo/buffer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: center[1],
          lon: center[0],
          radius_km: radiusKm,
          steps: 64
        })
      });
      if (!resp.ok) throw new Error('Buffer calculation failed');
      const data = await resp.json();
      setActiveBuffer({
        radius_km: data.radius_km,
        area_ha: data.area_ha,
        area_sqkm: data.area_sqkm,
        feature: data.feature,
        center: [center[0], center[1]]
      });

      // Render on map
      if (mapRef.current) {
        const bufSource = mapRef.current.getSource('gis-buffer') as GeoJSONSource;
        if (bufSource) {
          bufSource.setData(data.feature);
        }
        if (data.bbox) {
          mapRef.current.fitBounds(data.bbox as [number, number, number, number], { padding: 90, duration: 1200 });
        }
      }
      setStatusMessage(`Geodesic buffer active: ${radiusKm} km (${data.area_ha} ha)`);
      setShowInspector(true);
    } catch (err) {
      console.error(err);
      setStatusMessage('Failed to compute geodesic buffer.');
    }
  };

  // GIS Tool: Calculate Travel-Time Isochrone
  const handleGenerateIsochrone = async (mins: number) => {
    const center = targetPin ? [targetPin.lon, targetPin.lat] : currentCoords;
    if (!center) {
      setStatusMessage('Select location for isochrone.');
      return;
    }
    setStatusMessage(`Calculating ${mins}-min ${transitMode} reachability...`);
    try {
      const resp = await fetchWithAuth('/api/v1/geo/isochrone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: center[1],
          lon: center[0],
          minutes: mins,
          mode: transitMode
        })
      });
      if (!resp.ok) throw new Error('Isochrone calculation failed');
      const data = await resp.json();
      setActiveIsochrone({
        source: data.source,
        minutes: data.minutes,
        mode: data.mode,
        area_sqkm: data.area_sqkm,
        feature: data.feature
      });

      if (mapRef.current) {
        const isoSource = mapRef.current.getSource('gis-isochrone') as GeoJSONSource;
        if (isoSource) {
          isoSource.setData(data.feature);
        }
      }
      setStatusMessage(`${data.source === 'road_network' ? 'Road-network' : 'Approximate'} reachability: ${mins} min (${data.area_sqkm} km²)`);
      setShowInspector(true);
    } catch (err) {
      console.error(err);
      setStatusMessage('Isochrone calculation failed.');
    }
  };

  // GIS Tool: Render Measurement Polyline / Polygon
  useEffect(() => {
    if (!mapRef.current) return;
    const measureSource = mapRef.current.getSource('gis-measure') as GeoJSONSource;
    if (!measureSource) return;

    if (measurement.points.length === 0) {
      measureSource.setData({ type: 'FeatureCollection', features: [] });
      return;
    }

    const features: any[] = [];
    // Points
    measurement.points.forEach((pt) => {
      features.push({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Point', coordinates: pt }
      });
    });

    if (measurement.points.length >= 2) {
      if (measurement.isPolygon && measurement.points.length >= 3) {
        features.push({
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [[...measurement.points, measurement.points[0]]]
          }
        });
      } else {
        features.push({
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: measurement.points
          }
        });
      }
    }

    measureSource.setData({ type: 'FeatureCollection', features });
  }, [measurement]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || basemap !== 'satellite') return;

    const updateLabels = () => {
      for (const layer of SATELLITE_LABEL_LAYERS) {
        if (map.getLayer(layer)) {
          map.setLayoutProperty(layer, 'visibility', showSatelliteLabels ? 'visible' : 'none');
        }
      }
    };

    updateLabels();
    map.on('load', updateLabels);
    return () => { map.off('load', updateLabels); };
  }, [basemap, showSatelliteLabels]);

  // Layer Visibility Updates
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    try {
      if (!map.isStyleLoaded()) return;
      if (map.getLayer('route-core')) {
        map.setLayoutProperty('route-core', 'visibility', layerVisibility.route ? 'visible' : 'none');
        map.setLayoutProperty('route-glow', 'visibility', layerVisibility.route ? 'visible' : 'none');
      }
      if (map.getLayer('buffer-fill')) {
        map.setLayoutProperty('buffer-fill', 'visibility', layerVisibility.buffer ? 'visible' : 'none');
        map.setLayoutProperty('buffer-line', 'visibility', layerVisibility.buffer ? 'visible' : 'none');
      }
      if (map.getLayer('isochrone-fill')) {
        map.setLayoutProperty('isochrone-fill', 'visibility', layerVisibility.isochrone ? 'visible' : 'none');
        map.setLayoutProperty('isochrone-line', 'visibility', layerVisibility.isochrone ? 'visible' : 'none');
      }
      if (map.getLayer('measure-line')) {
        map.setLayoutProperty('measure-line', 'visibility', layerVisibility.measure ? 'visible' : 'none');
        map.setLayoutProperty('measure-fill', 'visibility', layerVisibility.measure ? 'visible' : 'none');
        map.setLayoutProperty('measure-points', 'visibility', layerVisibility.measure ? 'visible' : 'none');
      }
      if (map.getLayer('custom-fill')) {
        map.setLayoutProperty('custom-fill', 'visibility', layerVisibility.custom ? 'visible' : 'none');
        map.setLayoutProperty('custom-line', 'visibility', layerVisibility.custom ? 'visible' : 'none');
        map.setLayoutProperty('custom-points', 'visibility', layerVisibility.custom ? 'visible' : 'none');
      }
    } catch {
      // Style loading in progress
    }
  }, [layerVisibility]);

  const nearbyCandidates = searchResults.filter(place => !place.bearing || !nearbyDirection || place.bearing === nearbyDirection);
  const currentComparison = comparison?.results === searchResults && comparison.direction === nearbyDirection &&
    comparison.mode === transitMode && comparison.traffic === useTrafficRouting ? comparison : null;
  const estimates = currentComparison?.estimates;
  const nearbyMatches = estimates?.size ? [...nearbyCandidates].sort((a, b) =>
    (estimates.get(a)?.seconds ?? Infinity) - (estimates.get(b)?.seconds ?? Infinity)) : nearbyCandidates;

  const compareNearbyTravelTimes = async () => {
    comparisonRequest.current?.abort();
    const request = new AbortController();
    comparisonRequest.current = request;
    const snapshot = { results: searchResults, direction: nearbyDirection, mode: transitMode, traffic: useTrafficRouting };
    setComparison({ ...snapshot, estimates: null });
    const candidates = nearbyCandidates.filter(place => place.nearbyOrigin).slice(0, 3);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(12000)]);
    const responses = await Promise.allSettled(candidates.map(place => fetchNearbyRoute(place, transitMode, signal, useTrafficRouting)));
    if (request.signal.aborted) return;

    const ranked = new globalThis.Map<DestinationItem, NearbyEstimate>();
    responses.forEach((response, index) => {
      if (response.status !== 'fulfilled') return;
      const route = response.value;
      if (route?.status === 'success' && Number.isFinite(route.duration_seconds) && route.duration_seconds >= 0 &&
          Number.isFinite(route.distance_meters) && route.distance_meters >= 0) {
        ranked.set(candidates[index], { seconds: route.duration_seconds, metres: route.distance_meters });
      }
    });
    setComparison({ ...snapshot, estimates: ranked });
  };

  const spatialAreas = useMemo(() => {
    const areas = savedSpatialAreas.filter(area => (area.id !== 'buffer' || !activeBuffer) &&
      (area.id !== 'reachability' || !activeIsochrone));
    if (activeBuffer) areas.push({ id: 'buffer', label: 'Active buffer', feature: activeBuffer.feature });
    if (activeIsochrone) areas.push({ id: 'reachability', label: 'Active reachability area', feature: activeIsochrone.feature });
    if (measurement.isPolygon && measurement.points.length >= 3) {
      areas.push({
        id: 'measurement', label: 'Measured polygon',
        feature: { type: 'Feature', properties: {}, geometry: {
          type: 'Polygon', coordinates: [[...measurement.points, measurement.points[0]]]
        } }
      });
    }
    for (const layer of importedLayers) {
      layer.data.features.forEach((feature, index) => {
        if (feature.geometry?.type === 'Polygon' || feature.geometry?.type === 'MultiPolygon') {
          areas.push({ id: `${layer.id}:${index}`, label: `${layer.name} · ${feature.properties?.name || index + 1}`, feature: feature as AtlasArea });
        }
      });
    }
    return areas;
  }, [savedSpatialAreas, activeBuffer, activeIsochrone, measurement, importedLayers]);

  const routeLine = activeRoute?.geometry?.type === 'LineString' ? activeRoute.geometry as LineString : undefined;
  const corridorRoute = savedCorridor || routeLine;

  const estimateCorridorDetours = activeRoute && routeLine && !savedCorridor && stops.length === 0 && activeRoute.source !== 'valhalla_time_dependent'
    ? async (points: Position[]) => {
      const start = routeLine.coordinates[0];
      const end = routeLine.coordinates.at(-1);
      if (!start || !end) throw new Error('Route endpoints unavailable');
      const duration = async (stop?: Position) => {
        const params = new URLSearchParams({
          start_lon: String(start[0]), start_lat: String(start[1]),
          end_lon: String(end[0]), end_lat: String(end[1]), mode: activeRoute.mode
        });
        if (stop) params.set('stop', `${stop[0]},${stop[1]}`);
        const response = await fetchWithAuth(`/api/v1/geo/route?${params}`);
        if (!response.ok) return null;
        const result = await response.json();
        return result.status === 'success' && Number.isFinite(result.duration_seconds) ? Number(result.duration_seconds) : null;
      };
      const baseline = await duration();
      if (baseline === null) throw new Error('Baseline route unavailable');
      const estimates: (number | null)[] = [];
      for (const point of points) {
        const via = await duration(point);
        estimates.push(via === null ? null : Math.max(0, via - baseline));
      }
      return estimates;
    } : undefined;

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const applyLayers = () => {
      const source = map.getSource('custom-geojson') as GeoJSONSource | undefined;
      if (!source) return;
      if (!map.getSource('atlas-project-reference')) {
        map.addSource('atlas-project-reference', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({
          id: 'atlas-project-area', source: 'atlas-project-reference', type: 'fill',
          filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': '#7bbcff', 'fill-opacity': 0.16 }
        }, 'custom-fill');
        map.addLayer({
          id: 'atlas-project-outline', source: 'atlas-project-reference', type: 'line',
          paint: { 'line-color': '#7bbcff', 'line-width': 2, 'line-dasharray': [2, 2] }
        }, 'custom-fill');
      }
      const width = inspectedLayerId ? spatialFilters[inspectedLayerId]?.corridor : 0;
      const corridor = width && corridorRoute ? getAtlasCorridor(corridorRoute, width) : undefined;
      (map.getSource('atlas-project-reference') as GeoJSONSource).setData({
        type: 'FeatureCollection',
        features: [
          ...savedSpatialAreas.filter(area => (area.id !== 'buffer' || !activeBuffer) &&
            (area.id !== 'reachability' || !activeIsochrone)).map(area => area.feature),
          ...(savedCorridor ? [{ type: 'Feature' as const, properties: {}, geometry: savedCorridor }] : []),
          ...(corridor ? [corridor] : [])
        ]
      });
      const features = importedLayers.filter(layer => layer.visible).flatMap(layer => {
        const filter = spatialFilters[layer.id] || emptySpatialFilter;
        const area = spatialAreas.find(item => item.id === filter.area)?.feature;
        return filterAtlasFeatures(layer, filter, area, corridorRoute).map(({ feature, index }) => ({
          ...feature,
          properties: { ...feature.properties, atlasLayerId: layer.id, atlasIndex: index, atlasBuilding: layer.buildings,
            atlasSelected: selectedFeature?.layerId === layer.id && selectedFeature.index === index }
        }));
      });
      source.setData({ type: 'FeatureCollection', features });
      if (!map.getLayer('atlas-buildings')) {
        map.addLayer({
          id: 'atlas-buildings', source: 'custom-geojson', type: 'fill-extrusion',
          filter: ['==', ['get', 'atlasBuilding'], true],
          paint: {
            'fill-extrusion-color': '#5a8faa',
            'fill-extrusion-height': ['max', 0, ['to-number', ['get', 'height'], 0]],
            'fill-extrusion-opacity': 0.7
          }
        });
      }
    };
    applyLayers();
    map.on('load', applyLayers);
    return () => { map.off('load', applyLayers); };
  }, [basemap, importedLayers, spatialFilters, selectedFeature, activeBuffer,
    activeIsochrone, corridorRoute, inspectedLayerId, savedCorridor, savedSpatialAreas, spatialAreas]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const applyOverlays = () => {
      if (!map.getLayer('route-alternatives')) return;
      if (terrainTiles && showTerrain && !map.getSource('atlas-terrain')) {
        map.addSource('atlas-terrain', { type: 'raster-dem', tiles: [terrainTiles], tileSize: 256, attribution: terrainAttribution });
      }
      if (map.getSource('atlas-terrain')) map.setTerrain(showTerrain ? { source: 'atlas-terrain' } : null);
      for (const { id, tiles, visible, attribution } of [
        { id: 'atlas-traffic', tiles: trafficTiles, visible: showTraffic, attribution: trafficAttribution },
        { id: 'atlas-cycling', tiles: cyclingTiles, visible: showCycling, attribution: cyclingAttribution },
        { id: 'atlas-radar', tiles: radarTiles, visible: showRadar, attribution: radarAttribution }
      ]) {
        if (tiles && visible && !map.getSource(id)) {
          map.addSource(id, { type: 'raster', tiles: [tiles], tileSize: 256, attribution });
          map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': 0.72 } }, 'route-alternatives');
        }
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
      }
    };
    applyOverlays();
    map.on('load', applyOverlays);
    return () => { map.off('load', applyOverlays); };
  }, [basemap, showTerrain, showTraffic, showCycling, showRadar]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const applyLight = () => {
      try {
        if (!map.isStyleLoaded()) return;
        if (showSunlight) {
          const { azimuth, altitude } = computeSolarPosition();
          map.setLight({
            anchor: 'map',
            color: altitude > 10 ? '#fff8eb' : '#ffd5a0',
            intensity: altitude > 0 ? Math.max(0.25, (altitude / 68) * 0.75) : 0.15,
            position: [1.5, azimuth, Math.max(10, 90 - altitude)]
          });
          if (map.getPitch() < 15) {
            map.easeTo({ pitch: 45, duration: 800 });
          }
        } else {
          map.setLight({
            anchor: 'viewport',
            color: '#ffffff',
            intensity: 0.5,
            position: [1.15, 210, 30]
          });
        }
      } catch {
        // Guard against styling race conditions
      }
    };
    if (map.isStyleLoaded()) {
      applyLight();
    }
    map.on('load', applyLight);
    map.on('styledata', applyLight);
    return () => {
      map.off('load', applyLight);
      map.off('styledata', applyLight);
    };
  }, [showSunlight]);

  // Synchronize Geofence Beacons to MapLibre GeoJSON layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const syncBeacons = () => {
      const source = map.getSource('atlas-geofence-beacons') as GeoJSONSource | undefined;
      if (!source) return;

      if (!locationReminders.reminders.length) {
        source.setData({ type: 'FeatureCollection', features: [] });
        return;
      }

      const features: GeoJSON.Feature[] = [];
      for (const beacon of locationReminders.reminders) {
        const circleCoords = createGeoCircle(beacon.lon, beacon.lat, beacon.radius);
        features.push({
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [circleCoords]
          },
          properties: {
            id: beacon.id,
            name: beacon.name,
            radius: beacon.radius,
            kind: 'boundary'
          }
        });
        features.push({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [beacon.lon, beacon.lat]
          },
          properties: {
            id: beacon.id,
            name: beacon.name,
            radius: beacon.radius,
            kind: 'center'
          }
        });
      }

      source.setData({
        type: 'FeatureCollection',
        features
      });
    };

    syncBeacons();
    map.on('load', syncBeacons);
    return () => { map.off('load', syncBeacons); };
  }, [locationReminders.reminders, basemap]);

  // Animated radar breathing effect for active geofence beacons
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !locationReminders.monitoring || !locationReminders.reminders.length) return;

    let animId: number;
    const animateBeacons = () => {
      try {
        if (!map.isStyleLoaded()) {
          animId = requestAnimationFrame(animateBeacons);
          return;
        }
        const now = performance.now();
        if (map.getLayer('atlas-geofence-line')) {
          const lineOpacity = 0.5 + 0.4 * Math.sin(now / 350);
          map.setPaintProperty('atlas-geofence-line', 'line-opacity', Math.max(0.2, Math.min(1, lineOpacity)));
        }
        if (map.getLayer('atlas-geofence-center-glow')) {
          const radius = 10 + 4 * Math.sin(now / 350);
          const glowOpacity = 0.22 + 0.15 * Math.cos(now / 350);
          map.setPaintProperty('atlas-geofence-center-glow', 'circle-radius', Math.max(6, radius));
          map.setPaintProperty('atlas-geofence-center-glow', 'circle-opacity', Math.max(0.1, glowOpacity));
        }
        if (map.getLayer('atlas-geofence-fill')) {
          const fillOpacity = 0.14 + 0.08 * Math.sin(now / 450);
          map.setPaintProperty('atlas-geofence-fill', 'fill-opacity', Math.max(0.06, fillOpacity));
        }
      } catch {
        // Suppress during style reload
      }
      animId = requestAnimationFrame(animateBeacons);
    };

    animId = requestAnimationFrame(animateBeacons);
    return () => cancelAnimationFrame(animId);
  }, [locationReminders.monitoring, locationReminders.reminders.length]);

  // Secondary proximity verification with currentCoords (handles desktop GPS, simulations, navigation)
  const wasInsideProximityRef = useRef<Record<string, boolean>>({});
  useEffect(() => {
    if (!locationReminders.monitoring || !locationReminders.reminders.length || !currentCoords) return;
    const [uLon, uLat] = currentCoords;
    for (const reminder of locationReminders.reminders) {
      const distMeters = calcHaversineKm(uLon, uLat, reminder.lon, reminder.lat) * 1000;
      if (distMeters <= reminder.radius) {
        if (wasInsideProximityRef.current[reminder.id] !== true) {
          notifyArrival(reminder.name, reminder.radius);
        }
        wasInsideProximityRef.current[reminder.id] = true;
      } else if (distMeters > reminder.radius + 25) {
        wasInsideProximityRef.current[reminder.id] = false;
      }
    }
  }, [currentCoords, locationReminders.monitoring, locationReminders.reminders, notifyArrival]);

  // Synchronize Elevation Scrub Drone on Map
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const droneSource = map.getSource('atlas-elevation-drone') as GeoJSONSource | undefined;
    if (!droneSource) return;

    if (!elevationScrubPoint) {
      droneSource.setData({ type: 'FeatureCollection', features: [] });
      return;
    }

    droneSource.setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [elevationScrubPoint.lon, elevationScrubPoint.lat]
        },
        properties: {
          metres: elevationScrubPoint.metres,
          slopeText: `${elevationScrubPoint.grade > 0 ? '+' : ''}${elevationScrubPoint.grade.toFixed(1)}%`
        }
      }]
    });
  }, [elevationScrubPoint]);

  // Synchronize Route Slope / Incline Heatmap on Map
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const heatmapSource = map.getSource('atlas-route-slope-heatmap') as GeoJSONSource | undefined;
    if (!heatmapSource) return;

    if (!showSlopeHeatmap || !elevationProfile || elevationProfile.points.length < 2) {
      heatmapSource.setData({ type: 'FeatureCollection', features: [] });
      return;
    }

    const features: GeoJSON.Feature[] = [];
    const pts = elevationProfile.points;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];
      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [[prev.lon, prev.lat], [curr.lon, curr.lat]]
        },
        properties: {
          grade: curr.grade,
          color: getGradeColor(curr.grade)
        }
      });
    }

    heatmapSource.setData({
      type: 'FeatureCollection',
      features
    });
  }, [showSlopeHeatmap, elevationProfile]);

  const layerBounds = (data: FeatureCollection) => {
    const bounds = new LngLatBounds();
    for (const feature of data.features) {
      const coordinates = geometryPositions(feature.geometry);
      if (feature.geometry && !coordinates.length) throw new Error('Feature has no usable coordinates');
      for (const [lon, lat] of coordinates) {
        if (lon < -180 || lon > 180 || lat < -90 || lat > 90) throw new Error('Use longitude and latitude in WGS84');
        bounds.extend([lon, lat]);
      }
    }
    if (bounds.isEmpty()) throw new Error('Layer contains no usable coordinates');
    return bounds;
  };

  const addAtlasLayer = (data: FeatureCollection, name: string) => {
    const bounds = layerBounds(data);
    const id = crypto.randomUUID();
    setImportedLayers(previous => [...previous, { id, name, visible: true, buildings: false, data }]);
    setInspectedLayerId(id);
    setSelectedFeature(null);
    mapRef.current?.fitBounds(bounds, { maxZoom: 17, padding: 90, duration: 1000 });
    setStatusMessage(`Imported layer "${name}"`);
  };

  const restoreAtlasProject = (raw: unknown) => {
    const project = raw as { format?: string; layers?: AtlasLayer[]; filters?: Record<string, SpatialFilter>; measurement?: MeasurementState;
      areas?: { id: string; label: string; feature: AtlasArea }[];
      corridor?: CorridorLine;
      view?: { center: number[]; zoom: number; bearing: number; pitch: number } };
    if (!project || project.format !== 'oracle-atlas-project-v1' || !Array.isArray(project.layers)) throw new Error('Invalid Atlas project');
    const ids = new Set<string>();
    const layers = project.layers.map(layer => {
      if (!layer || typeof layer.id !== 'string' || ids.has(layer.id) || typeof layer.name !== 'string') throw new Error('Invalid project layer');
      if (!/^[a-z0-9-]{1,80}$/i.test(layer.id)) throw new Error('Invalid project layer identifier');
      ids.add(layer.id);
      const data = normalizeGeoJSON(layer.data);
      layerBounds(data);
      return { id: layer.id, name: layer.name, visible: layer.visible === true, buildings: layer.buildings === true, data };
    });
    const filters = Object.fromEntries(layers.flatMap(layer => {
      const filter = project.filters && Object.hasOwn(project.filters, layer.id) ? project.filters[layer.id] : undefined;
      return filter && typeof filter.field === 'string' && typeof filter.value === 'string' &&
        typeof filter.area === 'string' && Number.isFinite(filter.corridor) && filter.corridor >= 0 && filter.corridor <= 50000
        ? [[layer.id, filter]] : [];
    }));
    const measure = project.measurement;
    const validPoint = (point: unknown): point is [number, number] =>
      Array.isArray(point) && point.length === 2 && point.every(Number.isFinite) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90;
    const view = project.view;
    if (view && (!validPoint(view.center) || ![view.zoom, view.bearing, view.pitch].every(Number.isFinite) ||
      view.zoom < 0 || view.zoom > 24 || view.pitch < 0 || view.pitch > 85)) throw new Error('Invalid project map view');
    if (measure && (!Array.isArray(measure.points) || !measure.points.every(validPoint) ||
      !Number.isFinite(measure.distance_km) || !Number.isFinite(measure.area_ha) || typeof measure.isPolygon !== 'boolean')) {
      throw new Error('Invalid project measurement');
    }
    const areas = (project.areas || []).map(area => {
      if (!area || !['buffer', 'reachability'].includes(area.id) || typeof area.label !== 'string') throw new Error('Invalid project area');
      const data = normalizeGeoJSON(area.feature);
      if (!['Polygon', 'MultiPolygon'].includes(data.features[0].geometry?.type)) throw new Error('Project area needs polygon geometry');
      return { id: area.id, label: area.label, feature: data.features[0] as AtlasArea };
    });
    if (new Set(areas.map(area => area.id)).size !== areas.length) throw new Error('Duplicate project area');
    if (project.corridor) {
      const data = normalizeGeoJSON(project.corridor);
      if (!['LineString', 'MultiLineString'].includes(data.features[0].geometry?.type)) throw new Error('Invalid project route corridor');
    }
    clearRoute();
    setActiveBuffer(null);
    setActiveIsochrone(null);
    setSavedSpatialAreas(areas);
    setSavedCorridor(project.corridor);
    setImportedLayers(layers);
    setSpatialFilters(filters);
    setInspectedLayerId(layers[0]?.id || null);
    setSelectedFeature(null);
    setMeasurement(measure || { points: [], distance_km: 0, area_ha: 0, isPolygon: false });
    if (view && validPoint(view.center)) {
      mapRef.current?.jumpTo({ ...view, center: view.center });
      setIs3D(view.pitch > 0);
    }
    setStatusMessage('Atlas project loaded.');
  };

  const saveAtlasProject = () => {
    const map = mapRef.current;
    if (!map) return;
    const center = map.getCenter().wrap().toArray();
    const project = {
      format: 'oracle-atlas-project-v1', layers: importedLayers, filters: spatialFilters, measurement,
      areas: spatialAreas.filter(area => area.id === 'buffer' || area.id === 'reachability'), corridor: corridorRoute,
      view: { center, zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() }
    };
    const file = new Blob([JSON.stringify(project)], { type: 'application/json' });
    if (file.size > 25 * 1024 * 1024) {
      setStatusMessage('This project exceeds 25 MB. Export layers separately or remove some before saving.');
      return;
    }
    downloadBlob(file, 'atlas-project.json');
  };

  const handleImportGeoJSON = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      setStatusMessage('Choose a file smaller than 25 MB.');
      return;
    }
    try {
      const text = await file.text();
      const extension = file.name.split('.').pop()?.toLowerCase();
      const name = file.name.replace(/\.[^/.]+$/, '');
      if (extension === 'csv') {
        const data = parseAtlasCsv(text);
        setPendingCsv({ name, data });
        setCsvLongitude(data.fields.find(field => /^(lon|lng|longitude)$/i.test(field)) || '');
        setCsvLatitude(data.fields.find(field => /^(lat|latitude)$/i.test(field)) || '');
        return;
      }
      if (extension === 'gpx' || extension === 'kml') {
        addAtlasLayer(parseAtlasXml(text, extension), name);
        return;
      }
      const parsed = JSON.parse(text);
      if (parsed?.format === 'oracle-atlas-project-v1') {
          if ((importedLayers.length || measurement.points.length || activeBuffer || activeIsochrone || activeRoute) &&
              !window.confirm('Opening this project replaces the current GIS workspace and clears the active route. Open it?')) return;
        restoreAtlasProject(parsed);
        return;
      }
      addAtlasLayer(normalizeGeoJSON(parsed), name);
    } catch (error) {
      setStatusMessage(`Import failed: ${error instanceof Error ? error.message : 'invalid file'}`);
    }
  };

  const downloadLayer = (layer: AtlasLayer) => {
    downloadGeoJSON(layer.data, `${layer.name || 'oracle_layer'}.geojson`);
  };

  const downloadGeoJSON = (data: unknown, filename: string) => {
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/geo+json' }), filename);
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatusMessage(`Exported ${filename}`);
  };

  // Handle GeoJSON Export
  const handleExportGeoJSON = () => {
    let exportData: any = null;
    let filename = 'oracle_spatial_export.geojson';

    if (activeBuffer) {
      exportData = activeBuffer.feature;
      filename = `oracle_buffer_${activeBuffer.radius_km}km.geojson`;
    } else if (activeIsochrone) {
      exportData = activeIsochrone.feature;
      filename = `oracle_reachability_${activeIsochrone.minutes}min.geojson`;
    } else if (activeRoute?.geometry) {
      exportData = {
        type: 'Feature',
        properties: {
          name: `Route to ${activeRoute.destination.name}`,
          distance_km: activeRoute.distance_km,
          duration_min: activeRoute.duration_min,
          crs: 'EPSG:4326',
          timestamp: new Date().toISOString()
        },
        geometry: activeRoute.geometry
      };
      filename = `oracle_route_${activeRoute.destination.name.replace(/\s+/g, '_')}.geojson`;
    } else if (importedLayers.some(layer => layer.visible)) {
      exportData = { type: 'FeatureCollection', features: importedLayers.filter(layer => layer.visible).flatMap(layer => layer.data.features) };
      filename = 'oracle_visible_layers.geojson';
    } else if (measurement.points.length >= 2) {
      exportData = {
        type: 'Feature',
        properties: {
          name: 'Geodesic Measurement',
          distance_km: measurement.distance_km,
          area_ha: measurement.area_ha,
          crs: 'EPSG:4326'
        },
        geometry: measurement.isPolygon && measurement.points.length >= 3
          ? { type: 'Polygon', coordinates: [[...measurement.points, measurement.points[0]]] }
          : { type: 'LineString', coordinates: measurement.points }
      };
      filename = 'oracle_measurement.geojson';
    }

    if (!exportData) {
      setStatusMessage('No active spatial data to export.');
      return;
    }

    downloadGeoJSON(exportData, filename);
  };

  // Speak navigation / analysis briefing via Kokoro neural voice
  const departureTime = (route: ActiveRouteData) => {
    const event = route.destination.calendarTrip;
    const durationSeconds = route.options[route.selected].duration_seconds;
    return event ? new Date(Date.parse(event.start.dateTime) - durationSeconds * 1000 - arrivalBuffer * 60000) : null;
  };

  const loadRouteWeather = async (route: ActiveRouteData) => {
    weatherRequest.current?.abort();
    const request = new AbortController();
    weatherRequest.current = request;
    const points = route.geometry.coordinates as [number, number][];
    const samples = [points[0], points[Math.floor(points.length / 2)], points[points.length - 1]];
    const duration = route.options[route.selected].duration_seconds * 1000;
    const departure = departureTime(route)?.getTime();
    const now = Date.now();
    const useForecast = departure !== undefined && departure > now;
    const tripTimes = useForecast ? [departure, departure + duration / 2, departure + duration] : [];
    const days = tripTimes.length ? Math.ceil((tripTimes[2] - now) / 86400000) + 1 : 1;
    if (days > 16) {
      setRouteWeather({ geometry: route.geometry, text: 'The trip is beyond the available weather forecast window.' });
      return;
    }
    setRouteWeather({ geometry: route.geometry, text: 'Checking weather at three points along the route…' });
    try {
      const query = new URLSearchParams({
        latitude: samples.map(point => point[1]).join(','),
        longitude: samples.map(point => point[0]).join(','),
        timezone: 'GMT',
        timeformat: 'unixtime',
        forecast_days: String(days),
        [useForecast ? 'hourly' : 'current']: 'temperature_2m,precipitation'
      });
      const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query}`, {
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(6000)])
      });
      if (!response.ok) throw new Error('Weather unavailable');
      const weather: {
        current?: { time: number; temperature_2m: number; precipitation: number };
        hourly?: { time: number[]; temperature_2m: number[]; precipitation: number[] };
      }[] = await response.json();
      if (request.signal.aborted) return;
      if (!Array.isArray(weather) || weather.length !== samples.length) throw new Error('Incomplete weather data');
      const conditions = weather.map(({ current, hourly }, index) => {
        const hour = useForecast && hourly ? hourly.time.indexOf(Math.floor(tripTimes[index] / 3600000) * 3600) : -1;
        const temperature = hour >= 0 ? hourly?.temperature_2m[hour] : current?.temperature_2m;
        const rain = hour >= 0 ? hourly?.precipitation[hour] : current?.precipitation;
        if (temperature == null || rain == null) throw new Error('Weather sample unavailable');
        const label = ['Start', 'Mid-route', 'Destination'][index];
        return `${label} ${temperature}°C, ${rain} mm precipitation`;
      });
      const label = useForecast ? 'Hourly forecast for the estimated travel window' : 'Current conditions';
      setRouteWeather({ geometry: route.geometry, text: `${conditions.join(' · ')}. ${label} · checked ${new Date().toLocaleTimeString()} (Open-Meteo).` });
    } catch {
      if (!request.signal.aborted) setRouteWeather({ geometry: route.geometry, text: 'Route weather is unavailable.' });
    }
  };

  const speakBriefing = () => {
    if (activeRoute) {
      const hrs = Math.floor(activeRoute.duration_min / 60);
      const mins = activeRoute.duration_min % 60;
      const timeStr = hrs > 0 ? `${hrs} hour and ${mins} minutes` : `${mins} minutes`;
      const speech = `Course plotted for ${activeRoute.destination.name}. Distance is ${activeRoute.distance_km} kilometers via ${activeRoute.mode}. Estimated travel time is ${timeStr}.${departureTime(activeRoute) ? ` Leave by ${departureTime(activeRoute)?.toLocaleTimeString()} for your calendar event.` : ''}`;
      speakWithKokoro(speech);
    } else if (activeBuffer) {
      const speech = `Active geodesic buffer has radius of ${activeBuffer.radius_km} kilometers and spans ${activeBuffer.area_ha} hectares across WGS84 datum.`;
      speakWithKokoro(speech);
    } else if (measurement.points.length >= 2) {
      const speech = measurement.isPolygon
        ? `Measured polygon area is ${measurement.area_ha} hectares with perimeter of ${measurement.distance_km} kilometers.`
        : `Measured linear distance is ${measurement.distance_km} kilometers across ${measurement.points.length} points.`;
      speakWithKokoro(speech);
    }
  };

  const renderPlaceCard = (place: DestinationItem, dismiss?: () => void) => (
    <article className="geo-target-pin-card atlas-place-card">
      <div className="geo-pin-header">
        <MapPin size={12} />
        <span className="geo-pin-title">{place.name}</span>
      </div>
      <div className="geo-pin-desc">{place.locality || place.display_name || `${place.lat.toFixed(5)}°, ${place.lon.toFixed(5)}°`}</div>
      {place.bearing && <div className="geo-pin-desc">
        {place.bearing} · {place.distance_km?.toFixed(2)} km straight-line
        {place.nearbyOrigin && walkingEstimates[`${place.nearbyOrigin.join(',')}:${place.lon},${place.lat}`] &&
          ` · ${walkingEstimates[`${place.nearbyOrigin.join(',')}:${place.lon},${place.lat}`]}`}
        {!estimates?.has(place) && <button type="button" className="geo-mini-btn" onClick={() => estimateWalking(place)}>Check Walking Time</button>}
      </div>}
      {estimates?.has(place) && <div className="geo-pin-desc">
        {Math.max(1, Math.round((estimates.get(place)?.seconds ?? 0) / 60))} min {travelModeLabels[transitMode]}
        {' · '}{((estimates.get(place)?.metres ?? 0) / 1000).toFixed(1)} km by route
      </div>}
      {activeRoute?.geometry?.type === 'LineString' && (() => {
        try {
          const dist = pointToLineDistance([place.lon, place.lat], activeRoute.geometry, { units: 'kilometers' });
          if (dist <= 3.0) {
            return (
              <div className="geo-corridor-detour-badge">
                <Zap size={10} className="cyan" />
                <span>Along Route • ~{dist.toFixed(1)} km detour</span>
              </div>
            );
          }
        } catch { /* ignore */ }
        return null;
      })()}
      <div className="geo-pin-actions">
        <button type="button" className="geo-mini-btn primary" onClick={() => {
          if (placeField === 'origin' && !dismiss && !place.nearbyOrigin) {
            assignTripPlace(place, 'origin');
            setPlaceField('destination');
            return;
          }
          if (place.nearbyOrigin) {
            const [lon, lat] = place.nearbyOrigin;
            setTripOrigin({ lon, lat, name: place.nearbyOriginName || 'Nearby search area' });
          }
          void calculateAndRenderRoute(place);
        }}>{place.nearbyOrigin ? 'Directions from search area' : placeField === 'origin' && !dismiss ? 'Use as starting point' : 'Directions'}</button>
        {activeRoute && !stops.some(s => s.lat === place.lat && s.lon === place.lon) && stops.length < 8 && (
          <button
            type="button"
            className="geo-mini-btn"
            onClick={() => {
              assignTripPlace(place, 'stop');
              setStatusMessage(`Added ${place.name} as a stop.`);
            }}
          >
            + Add Stop
          </button>
        )}
        {(() => {
          const isBeacon = locationReminders.reminders.some(r => Math.abs(r.lat - place.lat) < 0.0001 && Math.abs(r.lon - place.lon) < 0.0001);
          return (
            <button
              type="button"
              className={`geo-mini-btn ${isBeacon ? 'active' : ''}`}
              title={isBeacon ? 'Geofence beacon active' : `Deploy a ${reminderRadius}m proximity alert beacon`}
              onClick={() => {
                if (isBeacon) {
                  locationReminders.save(locationReminders.reminders.filter(r => !(Math.abs(r.lat - place.lat) < 0.0001 && Math.abs(r.lon - place.lon) < 0.0001)));
                  setStatusMessage(`Deactivated beacon for ${place.name}.`);
                } else {
                  locationReminders.save([...locationReminders.reminders, {
                    id: crypto.randomUUID(),
                    name: place.name || 'Objective',
                    lat: place.lat,
                    lon: place.lon,
                    radius: reminderRadius
                  }]);
                  if (!locationReminders.monitoring) {
                    locationReminders.setMonitoring(true);
                  }
                  setStatusMessage(`Deployed ${reminderRadius}m Geofence Beacon for ${place.name}.`);
                  try { sfx.playDiagnosticBlip(2); } catch {}
                }
              }}
            >
              <Radio size={11} className={isBeacon ? 'cyan' : ''} />
              <span>{isBeacon ? 'Beacon Active' : `+ Beacon (${reminderRadius}m)`}</span>
            </button>
          );
        })()}
        <details className="atlas-place-actions">
          <summary>More actions</summary>
          <div className="geo-pin-actions">
            <button type="button" className="geo-mini-btn" onClick={() => handleSavePlace(place)}>Save</button>
            <button type="button" className="geo-mini-btn" onClick={() => assignTripPlace(place, 'origin')}>Set as start</button>
            <button type="button" className="geo-mini-btn" disabled={stops.length >= 8}
              onClick={() => assignTripPlace(place, 'stop')}>Add stop</button>
            <button type="button" className="geo-mini-btn" onClick={() => assignTripPlace(place, 'destination')}>Set as destination</button>
            {dismiss && <button type="button" className="geo-mini-btn" onClick={dismiss}>Dismiss</button>}
          </div>
          <AtlasPlaceShare key={`${place.lat},${place.lon}`} place={place} />
        </details>
      </div>
      {(place.locality && place.display_name && place.locality !== place.display_name || !!place.aliases?.length) &&
        <details className="geo-pin-desc">
          <summary>Place details</summary>
          {place.locality && place.display_name !== place.locality && <div>{place.display_name}</div>}
          {!!place.aliases?.length && <div>Also known as {place.aliases.join(' · ')}</div>}
        </details>}
    </article>
  );

  const atlasStatus = statusMessage === 'Standby' || statusMessage.startsWith('Recentered') || statusMessage.startsWith('Acquiring') ||
    (activeTab === 'nav' && !navigating && statusMessage === 'Approximate location. Checking for a better fix…')
    ? '' : statusMessage;

  return (
    <div
      className="geo-workspace-container"
      role="dialog"
      aria-label="Tactical Spatial Intelligence"
      data-drawer-open={isDrawerOpen ? 'true' : 'false'}
      data-menu-open={isBasemapMenuOpen || overlaysOpen ? 'true' : 'false'}
    >
      {/* Base Map Viewport */}
      <div ref={mapContainerRef} className={`geo-map-viewport ${basemap === "dark" ? "dark-tactical" : ""}${pickingStart ? ' atlas-picking-start' : ''}`} />
      {pickingStart && <div className="atlas-start-crosshair" aria-hidden="true"><Crosshair size={32} /></div>}

      {/* Atmospheric Scrim — Protects PresenceHeader readability */}
      <div className="geo-top-scrim" />
      <div className="geo-vignette" />
      <div className="geo-tactical-grid" />

      {/* Hidden File Input for GeoJSON Import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".geojson,.json,.kml,.gpx,.csv"
        style={{ display: 'none' }}
        onChange={handleImportGeoJSON}
      />

      {/* ================================================================= */}
      {/* 1. CELESTIAL FLOATING COMMAND CAPSULE (Top Center HUD)             */}
      {/* ================================================================= */}
      {navigating && activeRoute ? (
        <div className="geo-floating-capsule geo-capsule-navigating" role="toolbar" aria-label="Tactical Navigation Guidance">
          <div className="geo-capsule-nav-badge">
            <Navigation size={13} className="geo-nav-arrow-icon" />
            <span>GUIDANCE</span>
          </div>

          <div className="geo-capsule-nav-instruction" title={navigationStatus}>
            <span className="geo-nav-main-text">{navigationStatus || `En route to ${activeRoute.destination.name}`}</span>
            <span className="geo-nav-sub-text">
              {activeRoute.destination.name} • {(activeRoute.distance_km).toFixed(1)} km • {activeRoute.duration_min} min
            </span>
          </div>

          <div className="geo-capsule-divider" />

          {/* Voice Speak toggle */}
          <button
            type="button"
            className={`geo-capsule-btn ${spokenNavigation ? 'active' : ''}`}
            onClick={() => setSpokenNavigation(!spokenNavigation)}
            title={spokenNavigation ? 'Mute Maneuver Voice' : 'Enable Maneuver Voice'}
            aria-label="Toggle voice guidance"
          >
            {spokenNavigation ? <Volume2 size={12} /> : <VolumeX size={12} />}
            <span>{spokenNavigation ? 'Voice' : 'Mute'}</span>
          </button>

          {/* Recenter GPS */}
          <button
            type="button"
            className="geo-capsule-btn"
            onClick={handleRecenter}
            title="Recenter on current GPS position"
            aria-label="Locate me"
          >
            <Crosshair size={12} />
            <span>Recenter</span>
          </button>

          {/* Toggle Drawer */}
          <button
            type="button"
            className={`geo-capsule-btn ${isDrawerOpen ? 'active' : ''}`}
            onClick={() => setIsDrawerOpen(open => !open)}
            aria-expanded={isDrawerOpen}
            title="Toggle turn-by-turn details panel"
          >
            <Navigation size={12} />
            <span>Panel</span>
          </button>

          {/* Stop Navigation */}
          <button
            type="button"
            className="geo-capsule-btn close"
            onClick={() => {
              routeRequest.current?.abort();
              setIsRouting(false);
              setNavigating(false);
            }}
            title="End navigation session"
            aria-label="End Navigation"
          >
            <X size={13} strokeWidth={2.2} />
          </button>
        </div>
      ) : (
        <div className="geo-floating-capsule" role="toolbar" aria-label="Tactical Navigation Bar">
        {/* Search Input Field */}
        <form className="geo-capsule-search-form" onSubmit={(e) => { e.preventDefault(); void searchDestinations(searchQuery); setIsDrawerOpen(true); setActiveTab('nav'); }}>
          <Search className="geo-capsule-search-icon" size={13} />
          <input
            type="text"
            className="geo-capsule-search-input"
            ref={destinationSearch}
            aria-label="Search places"
            placeholder={placeField === 'origin' ? 'Search for a starting point…' : 'Search places…'}
            value={searchQuery}
            onChange={(e) => {
              if (isSearching) {
                searchRequest.current?.abort();
                searchRequestId.current += 1;
                setIsSearching(false);
                setStatusMessage('');
              }
              setSearchQuery(e.target.value);
            }}
            onFocus={() => setIsDrawerOpen(true)}
          />
          {searchQuery && (
            <button
              type="button"
              className="geo-capsule-clear-btn"
              onClick={() => {
                searchRequest.current?.abort();
                searchRequestId.current += 1;
                setIsSearching(false);
                setSearchResults([]);
                setSearchQuery('');
              }}
              title="Clear search"
            >
              <X size={11} />
            </button>
          )}
        </form>

        <div className="geo-capsule-divider" />

        {/* Transit Mode Selector */}
        <div className="geo-capsule-mode-group">
          <button
            type="button"
            className={`geo-capsule-mode-btn ${transitMode === 'driving' ? 'active' : ''}`}
            disabled={isRouting || navigating || providerMissing('driving')}
            onClick={() => {
              transitModeRef.current = 'driving';
              setTransitMode('driving');
              if (activeRoute) calculateAndRenderRoute(activeRoute.destination, 'driving');
            }}
            title={providerMissing('driving') ? 'Routing provider needs setup' : 'Driving route'}
          >
            <Car size={12} />
            <span>Drive</span>
          </button>
          <button
            type="button"
            className={`geo-capsule-mode-btn ${transitMode === 'cycling' ? 'active' : ''}`}
            disabled={isRouting || navigating || providerMissing('cycling')}
            onClick={() => {
              transitModeRef.current = 'cycling';
              setTransitMode('cycling');
              if (activeRoute) calculateAndRenderRoute(activeRoute.destination, 'cycling');
            }}
            title={providerMissing('cycling') ? 'Routing provider needs setup' : 'Cycling route'}
            aria-label="Cycling route"
          >
            <Bike size={12} />
            <span>Cycle</span>
          </button>
          <button
            type="button"
            className={`geo-capsule-mode-btn ${transitMode === 'walking' ? 'active' : ''}`}
            disabled={isRouting || navigating || providerMissing('walking')}
            onClick={() => {
              transitModeRef.current = 'walking';
              setTransitMode('walking');
              if (activeRoute) calculateAndRenderRoute(activeRoute.destination, 'walking');
            }}
            title={providerMissing('walking') ? 'Routing provider needs setup' : 'Walking route'}
            aria-label="Walking route"
          >
            <Footprints size={12} />
            <span>Walk</span>
          </button>
        </div>

        <div className="geo-capsule-divider" />

        {/* Basemap Switcher Dropdown Trigger */}
        <div className="geo-capsule-relative-wrap">
          <button
            type="button"
            className={`geo-capsule-btn basemap-trigger ${isBasemapMenuOpen ? 'active' : ''}`}
            onClick={() => { setIsBasemapMenuOpen(!isBasemapMenuOpen); setOverlaysOpen(false); }}
            aria-label={`Basemap: ${BASEMAP_OPTIONS[basemap].label}`}
            aria-expanded={isBasemapMenuOpen}
            title="Switch basemap"
          >
            <MapIcon size={12} />
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '10px' }}>
              {BASEMAP_OPTIONS[basemap].label}
            </span>
            <ChevronDown size={10} style={{ transform: isBasemapMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
          </button>

          {/* Basemap Flyout Menu */}
          {isBasemapMenuOpen && (
            <div className="geo-basemap-flyout">
              {PRIMARY_BASEMAPS.map((key) => {
                const { label, description, preview } = BASEMAP_OPTIONS[key];
                return (
                  <button key={key} type="button"
                    className={`geo-flyout-item geo-basemap-card ${basemap === key ? 'active' : ''}`}
                    aria-pressed={basemap === key}
                    onClick={() => { setBasemap(key); setIsBasemapMenuOpen(false); }}
                  >
                    <img src={`${import.meta.env.BASE_URL}atlas/${preview}.jpg`} alt="" />
                    <strong>{label}</strong>
                    <span>{description}</span>
                  </button>
                );
              })}
              {basemap === 'satellite' && (
                <label className="geo-basemap-labels">
                  <input type="checkbox" checked={showSatelliteLabels}
                    onChange={(event) => setShowSatelliteLabels(event.target.checked)} />
                  Show labels and roads
                </label>
              )}
              {localBasemapTiles && <details className="geo-basemap-more">
                <summary>More maps</summary>
                {MORE_BASEMAPS.filter((key) => key !== 'local' || localBasemapTiles).map((key) => (
                  <button key={key} type="button"
                    className={`geo-flyout-item geo-basemap-card ${basemap === key ? 'active' : ''}`}
                    aria-pressed={basemap === key}
                    onClick={() => { setBasemap(key); setIsBasemapMenuOpen(false); }}
                  >
                    <strong>{BASEMAP_OPTIONS[key].label}</strong>
                    <span>{BASEMAP_OPTIONS[key].description}</span>
                  </button>
                ))}
              </details>}
            </div>
          )}
        </div>

        <div className="geo-capsule-relative-wrap">
          <button type="button" className={`geo-capsule-btn ${overlaysOpen ? 'active' : ''}`}
            aria-expanded={overlaysOpen} onClick={() => { setOverlaysOpen(!overlaysOpen); setIsBasemapMenuOpen(false); }}>
            <Layers size={12} /><span>Overlays</span>
          </button>
          {overlaysOpen && <div className="geo-basemap-flyout" aria-label="Map overlays">
            {[
              { label: 'Traffic', description: 'Road congestion', configured: trafficTiles, enabled: showTraffic, toggle: setShowTraffic },
              { label: 'Terrain', description: '3D elevation', configured: terrainTiles, enabled: showTerrain, toggle: setShowTerrain },
              { label: 'Cycling', description: 'Cycleways and bike routes', configured: cyclingTiles, enabled: showCycling, toggle: setShowCycling },
              { label: 'Radar', description: 'Precipitation Doppler', configured: radarTiles, enabled: showRadar, toggle: setShowRadar },
              { label: 'Sunlight', description: 'Real-time solar shadows', configured: true, enabled: showSunlight, toggle: setShowSunlight }
            ].map(({ label, description, configured, enabled, toggle }) => (
              <button key={label} type="button" className="geo-flyout-item geo-basemap-card"
                disabled={!configured} aria-pressed={enabled} onClick={() => toggle(!enabled)}>
                <span aria-hidden="true" className={`atlas-overlay-preview ${label.toLowerCase()}`}>
                  {label === 'Cycling' ? <Bike size={16} /> : label === 'Terrain' ? <Building2 size={16} /> : label === 'Radar' ? <CloudRain size={16} /> : label === 'Sunlight' ? <Sun size={16} /> : <Car size={16} />}
                </span>
                <strong>{label}</strong>
                <span>{configured ? description : 'Provider setup required'}</span>
              </button>
            ))}
          </div>}
        </div>

        <div className="geo-capsule-divider" />

        {/* 3D Perspective Toggle */}
        <button
          type="button"
          className={`geo-capsule-btn ${is3D ? 'active' : ''}`}
          onClick={toggle3D}
          title="Toggle 3D Oblique Camera"
        >
          <Box size={12} />
          <span>3D</span>
        </button>

        {/* Recenter GPS */}
        <button
          type="button"
          className="geo-capsule-btn"
          onClick={handleRecenter}
          aria-label="Locate me"
          title="Refresh and center on device location"
        >
          <Crosshair size={12} />
          <span>Locate me</span>
        </button>
        {/* Toggle Discovery Drawer / POIs */}
        <button
          type="button"
          className={`geo-capsule-btn ${isDrawerOpen ? 'active' : ''}`}
          ref={drawerToggle}
          onClick={() => setIsDrawerOpen(open => !open)}
          aria-expanded={isDrawerOpen}
          aria-controls="atlas-panel"
          title="Toggle Atlas Intelligence Panel"
        >
          <Sidebar size={12} />
          <span>Panel</span>
        </button>

        {/* Close Button */}
        <button
          type="button"
          className="geo-capsule-btn close"
          onClick={onClose}
          title="Close Tactical Map (Escape)"
          aria-label="Close"
        >
          <X size={13} strokeWidth={2.2} />
        </button>
      </div>
      )}

      {/* Quick-Search Category Chips Bar */}
      {!navigating && !isBasemapMenuOpen && !overlaysOpen && (
        <div className="geo-quick-chips-bar" role="toolbar" aria-label="Quick Category Search">
          {QUICK_SEARCH_CATEGORIES.map(({ label, query, icon: Icon }) => (
            <button
              key={label}
              type="button"
              className="geo-quick-chip"
              onClick={() => {
                setSearchQuery(query);
                void searchDestinations(query);
                setIsDrawerOpen(true);
                setActiveTab('nav');
              }}
              title={`Search nearby ${label}`}
            >
              <Icon size={11} className="geo-quick-chip-icon" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}

      {/* ================================================================= */}
      {/* 2. CONTEXTUAL FLOATING DRAWER (Left HUD Card - Appears on demand) */}
      {/* ================================================================= */}
      {isDrawerOpen && (
        <aside id="atlas-panel" className="geo-floating-drawer">
          <header className="atlas-drawer-header">
            <div className="atlas-drawer-title-group">
              <div className="atlas-drawer-brand-icon">
                <Compass size={14} />
              </div>
              <div className="atlas-drawer-title-meta">
                <h2>Atlas Recon</h2>
                <div className="atlas-drawer-badge">
                  <span className={`geo-status-indicator ${activeRoute ? 'active' : 'ready'}`} />
                  <span>{activeRoute ? (navigating ? 'NAVIGATION ACTIVE' : 'ROUTE STAGED') : 'READY'}</span>
                </div>
              </div>
            </div>
            <button
              type="button"
              className="geo-drawer-close-btn"
              onClick={() => { setIsDrawerOpen(false); drawerToggle.current?.focus(); }}
              aria-label="Minimize Atlas panel"
              title="Close panel (Escape)"
            >
              <X size={13} />
            </button>
          </header>
          {/* Tab Switcher: NAV | GIS | DATA */}
          <div className="geo-blade-tabs-row" role="group" aria-label="Atlas sections">
            <button
              type="button"
              className={`geo-tab-pill ${activeTab === 'nav' ? 'active' : ''}`}
              aria-pressed={activeTab === 'nav'}
              onClick={() => setActiveTab('nav')}
            >
              <Navigation size={11} />
              <span>Navigate</span>
            </button>
            <button
              type="button"
              className={`geo-tab-pill ${activeTab === 'gis' ? 'active' : ''}`}
              aria-pressed={activeTab === 'gis'}
              onClick={() => setActiveTab('gis')}
            >
              <CircleDot size={11} />
              <span>GIS tools</span>
            </button>
            <button
              type="button"
              className={`geo-tab-pill ${activeTab === 'layers' ? 'active' : ''}`}
              aria-pressed={activeTab === 'layers'}
              onClick={() => setActiveTab('layers')}
            >
              <Layers size={11} />
              <span>Data</span>
            </button>
          </div>

          <div className="atlas-drawer-content">
          {atlasStatus && <p className="atlas-status" role="status">{atlasStatus}</p>}
          {activeTab === 'nav' && savedDataUnavailable && <div className="geo-pin-actions">
            <span className="geo-pin-desc">Some saved places or parking could not load.</span>
            <button type="button" className="geo-mini-btn" onClick={refreshUserData}>Retry</button>
          </div>}

          {/* TAB 1: NAVIGATION & SEARCH */}
          {activeTab === 'nav' && (
            <>
              {navigating && (
                <div className="geo-target-pin-card geo-navigation-guide">
                  <div className="geo-section-title">LIVE NAVIGATION</div>
                  <div className="geo-pin-desc" role="status">{navigationStatus}</div>
                  <div className="geo-pin-actions">
                    <button type="button" className="geo-mini-btn" onClick={() => {
                      routeRequest.current?.abort();
                      setIsRouting(false);
                      setNavigating(false);
                    }}>Stop Navigation</button>
                    <label className="geo-pin-desc">
                      <input type="checkbox" checked={spokenNavigation} onChange={event => setSpokenNavigation(event.target.checked)} /> Speak maneuvers
                    </label>
                  </div>
                </div>
              )}
              {/* Active Route Telemetry & Turn-by-Turn */}
              {activeRoute && (
                <div className="geo-route-section">
                  <div className="geo-route-header-box">
                    <div>
                      <div className="geo-route-dest-name">{activeRoute.destination.name}</div>
                      <div className="geo-route-dest-address">{activeRoute.destination.display_name}</div>
                      <div className="geo-route-dest-address">From {activeRoute.origin}</div>
                    </div>
                    <button
                      type="button"
                      className="geo-voice-btn"
                      onClick={speakBriefing}
                      title="Speak Navigation Briefing (Kokoro TTS)"
                    >
                      <Volume2 size={13} />
                    </button>
                  </div>

                  <div className="geo-route-metrics-bar">
                    <div className="geo-metric-block">
                      <span className="geo-metric-label">DISTANCE</span>
                      <span className="geo-metric-val cyan">{activeRoute.distance_km} km</span>
                    </div>
                    <div className="geo-metric-divider" />
                    <div className="geo-metric-block">
                      <span className="geo-metric-label">TRAVEL TIME</span>
                      <span className="geo-metric-val">
                        {Math.floor(activeRoute.duration_min / 60) > 0 ? `${Math.floor(activeRoute.duration_min / 60)}h ` : ''}
                        {activeRoute.duration_min % 60}m
                      </span>
                    </div>
                    <div className="geo-metric-divider" />
                    <div className="geo-metric-block">
                      <span className="geo-metric-label">TRANSIT</span>
                      <span className="geo-metric-val">{activeRoute.mode.toUpperCase()}</span>
                    </div>
                  </div>

                  {/* Multi-Modal Comparison & Mode Switcher */}
                  <div className="geo-multimodal-matrix" role="group" aria-label="Compare Transit Modes">
                    <button
                      type="button"
                      className={`geo-mode-pill ${activeRoute.mode === 'driving' ? 'active' : ''}`}
                      disabled={isRouting || navigating || providerMissing('driving')}
                      onClick={() => {
                        transitModeRef.current = 'driving';
                        setTransitMode('driving');
                        void calculateAndRenderRoute(activeRoute.destination, 'driving');
                      }}
                      title="Switch to driving route"
                    >
                      <Car size={11} />
                      <div className="geo-mode-meta">
                        <span className="geo-mode-name">Drive</span>
                        <span className="geo-mode-stat">
                          {activeRoute.mode === 'driving' ? `${activeRoute.duration_min}m` : `~${Math.max(1, Math.round(activeRoute.distance_km / 45 * 60))}m`}
                          {' • '}~{(activeRoute.distance_km * 0.14).toFixed(1)}kg CO₂
                        </span>
                      </div>
                    </button>

                    <button
                      type="button"
                      className={`geo-mode-pill ${activeRoute.mode === 'cycling' ? 'active' : ''}`}
                      disabled={isRouting || navigating || providerMissing('cycling')}
                      onClick={() => {
                        transitModeRef.current = 'cycling';
                        setTransitMode('cycling');
                        void calculateAndRenderRoute(activeRoute.destination, 'cycling');
                      }}
                      title="Switch to cycling route"
                    >
                      <Bike size={11} />
                      <div className="geo-mode-meta">
                        <span className="geo-mode-name">Cycle</span>
                        <span className="geo-mode-stat">
                          {activeRoute.mode === 'cycling' ? `${activeRoute.duration_min}m` : `~${Math.max(1, Math.round(activeRoute.distance_km / 16 * 60))}m`}
                          {' • '}~{Math.round(activeRoute.distance_km * 28)} kcal
                        </span>
                      </div>
                    </button>

                    <button
                      type="button"
                      className={`geo-mode-pill ${activeRoute.mode === 'walking' ? 'active' : ''}`}
                      disabled={isRouting || navigating || providerMissing('walking')}
                      onClick={() => {
                        transitModeRef.current = 'walking';
                        setTransitMode('walking');
                        void calculateAndRenderRoute(activeRoute.destination, 'walking');
                      }}
                      title="Switch to walking route"
                    >
                      <Footprints size={11} />
                      <div className="geo-mode-meta">
                        <span className="geo-mode-name">Walk</span>
                        <span className="geo-mode-stat">
                          {activeRoute.mode === 'walking' ? `${activeRoute.duration_min}m` : `~${Math.max(1, Math.round(activeRoute.distance_km / 4.8 * 60))}m`}
                          {' • '}~{Math.round(activeRoute.distance_km * 52)} kcal
                        </span>
                      </div>
                    </button>
                  </div>

                  {activeRoute.calculatedAt && <div className="geo-pin-desc">
                    {activeRoute.source === 'valhalla_time_dependent' ? 'Time-dependent Valhalla estimate · traffic and closures where available' : 'OSRM estimate'}
                    {' · '}{new Date(activeRoute.calculatedAt).toLocaleTimeString()}
                  </div>}
                  {activeRoute.destination.calendarTrip && (
                    <div className="geo-pin-desc">
                      Leave by {departureTime(activeRoute)?.toLocaleString()} for {activeRoute.destination.calendarTrip.summary || 'your event'}.
                    </div>
                  )}
                  {activeRoute.optimization && (
                    <div className="geo-pin-desc">
                      Optimized order: {activeRoute.optimization.order.map(index => stops[index]?.name).join(' → ')}.
                      {' '}Road-network estimates: {activeRoute.optimization.original_seconds === null ? 'original order unavailable' : `${Math.round(activeRoute.optimization.original_seconds / 60)} min originally`}
                      {' → '}{Math.round(activeRoute.optimization.optimized_seconds / 60)} min optimized.
                    </div>
                  )}
                  <button type="button" className="geo-mini-btn" onClick={() => loadRouteWeather(activeRoute)}>Check Route Weather</button>
                  <button type="button" className="geo-mini-btn" aria-expanded={sharedRoute === activeRoute}
                    onClick={() => setSharedRoute(sharedRoute === activeRoute ? null : activeRoute)}>Send trip to phone</button>
                  {sharedRoute === activeRoute && <AtlasTripShare route={activeRoute} />}

                  {routeWeather?.geometry === activeRoute.geometry && <div className="geo-pin-desc">{routeWeather?.text}</div>}
                  {activeRoute.options.length > 1 && (
                    <div className="geo-pin-actions" aria-label="Route alternatives">
                      {activeRoute.options.map((option, index) => {
                        const difference = Math.round(option.duration_seconds / 60) - Math.round(activeRoute.options[0].duration_seconds / 60);
                        return (
                          <button key={index} type="button" className="geo-mini-btn" aria-pressed={index === activeRoute.selected} disabled={navigating} onClick={() => selectRoute(index)}>
                            {index === 0 ? 'Primary' : `Route ${index + 1}`} · {(option.distance_meters / 1000).toFixed(1)} km · {Math.round(option.duration_seconds / 60)} min
                            {index > 0 && ` (${difference > 0 ? '+' : ''}${difference} min)`}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {!navigating && <button type="button" className="geo-mini-btn primary" disabled={!gpsLocked} onClick={() => {
                    setNavigationStatus('Waiting for device location…');
                    lastReroute.current = 0;
                    setNavigating(true);
                  }}>Start Navigation</button>}
                  {!navigating && activeRoute?.geometry?.coordinates?.length > 1 && (
                    <button
                      type="button"
                      className={`geo-mini-btn ${isFlyThroughActive ? 'active' : ''}`}
                      onClick={isFlyThroughActive ? stopFlyThrough : startFlyThrough}
                      title="Simulate 3D camera fly-through along the calculated route"
                    >
                      <Plane size={12} />
                      <span>{isFlyThroughActive ? 'Stop Flight' : 'Fly-Through 3D'}</span>
                    </button>
                  )}
                  {!navigating && !gpsLocked && <p className="geo-pin-desc">Live navigation needs a fresh, accurate device location.</p>}
                  {!navigating && (
                    <AtlasElevation
                      key={routeRequestId.current}
                      routes={activeRoute.options}
                      selected={activeRoute.selected}
                      onHoverPoint={setElevationScrubPoint}
                      onProfileLoaded={setElevationProfile}
                      onToggleSlopeHeatmap={setShowSlopeHeatmap}
                      slopeHeatmapActive={showSlopeHeatmap}
                    />
                  )}
                  {/* Route Steps Toggle */}
                  <button
                    type="button"
                    className="geo-steps-toggle"
                    onClick={() => setShowSteps(!showSteps)}
                  >
                    <span>Maneuver Directions ({activeRoute.steps.length} steps)</span>
                    {showSteps ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </button>

                  {/* Turn-by-turn guidance accordion */}
                  {showSteps && (
                    <div className="geo-steps-container">
                      {activeRoute.steps.map((st, idx) => (
                        <div key={idx} className="geo-step-row">
                          <span className="geo-step-idx">{idx + 1}</span>
                          <span className="geo-step-text">{routeStepLabel(st)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Cancel Route Action */}
                  <button
                    type="button"
                    className="geo-cancel-route-btn"
                    onClick={() => clearRoute()}
                  >
                    <X size={12} />
                    <span>Clear Course</span>
                  </button>
                </div>
              )}
              {!navigating && <>
              <div className="geo-trip-planner">
                {/* Waypoint Routing Card with Visual Connector Track & Swap Button */}
                <div className="atlas-waypoints-card">
                  <div className="atlas-waypoint-track" aria-hidden="true">
                    <span className="atlas-waypoint-dot origin" />
                    <span className="atlas-waypoint-line" />
                    <span className="atlas-waypoint-dot destination" />
                  </div>

                  <div className="atlas-waypoint-fields">
                    {/* Origin Field */}
                    <div className="atlas-waypoint-row origin">
                      <div className="atlas-waypoint-meta">
                        <span className="atlas-waypoint-label">START POINT</span>
                        <details className="atlas-origin-picker">
                          <summary className="atlas-waypoint-summary">
                            <strong className="atlas-waypoint-val">
                              {manualOrigin ? manualOrigin.name || 'Map pin' : gpsLocked ? 'Current Device Location'
                                : locationStatus === 'LAST KNOWN' ? 'Last known location' : locationStatus === 'APPROXIMATE' ? 'Approximate Location' : 'Choose a starting point'}
                            </strong>
                            <ChevronDown size={12} className="atlas-chevron" />
                          </summary>
                          <div className="geo-pin-actions atlas-origin-actions">
                            <button type="button" className="geo-mini-btn" onClick={() => { changeStartSelection(false); setTripOrigin(null); handleRecenter(); }}>
                              <Crosshair size={11} /> Update device location
                            </button>
                            <button type="button" className="geo-mini-btn" onClick={() => {
                              changeStartSelection(false);
                              setPlaceField('origin');
                              destinationSearch.current?.focus();
                            }}>
                              <Search size={11} /> Search starting point
                            </button>
                            <button type="button" className="geo-mini-btn" aria-pressed={pickingStart} onClick={() => changeStartSelection(!pickingStart)}>
                              <MapPin size={11} /> {pickingStart ? 'Cancel map pick' : 'Pick on map'}
                            </button>
                            {targetPin && !pickingStart && (!manualOrigin || manualOrigin.lat !== targetPin.lat || manualOrigin.lon !== targetPin.lon) && (
                              <button type="button" className="geo-mini-btn primary" onClick={() => {
                                setTripOrigin(targetPin);
                                setStatusMessage('Route start set to the selected pin.');
                              }}>Use selected pin</button>
                            )}
                          </div>
                        </details>
                      </div>
                    </div>

                    {/* Destination Field */}
                    <div className="atlas-waypoint-row destination">
                      <div className="atlas-waypoint-meta">
                        <span className="atlas-waypoint-label">DESTINATION</span>
                        <button
                          type="button"
                          className="atlas-destination-link"
                          onClick={() => {
                            setPlaceField('destination');
                            destinationSearch.current?.focus();
                          }}
                        >
                          <strong className={`atlas-waypoint-val ${tripDestination ? 'active' : 'placeholder'}`}>
                            {tripDestination?.name || 'Search or select destination...'}
                          </strong>
                          <Search size={12} className="atlas-dest-search-icon" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Waypoint Swap Button */}
                  <button
                    type="button"
                    className="atlas-waypoint-swap-btn"
                    title="Swap Start and Destination"
                    disabled={!tripDestination || (!manualOrigin && !currentCoords)}
                    onClick={() => {
                      if (!tripDestination) return;
                      const previousOrigin = manualOrigin || (currentCoords && { name: 'Device location', lat: currentCoords[1], lon: currentCoords[0] });
                      if (!previousOrigin) return;
                      setTripOrigin(tripDestination);
                      setTripDestination({ ...previousOrigin, name: previousOrigin.name || 'Map pin', display_name: '' });
                      setStops([...stops].reverse());
                      try { sfx.playDiagnosticBlip(1); } catch {}
                    }}
                    aria-label="Swap Start and Destination"
                  >
                    <ArrowUpDown size={13} />
                  </button>
                </div>

              {!!stops.length && (
                <div className="geo-target-pin-card">
                  <div className="geo-section-title">TRIP STOPS</div>
                  {stops.length > 1 && <label className="geo-pin-desc">
                    <input type="checkbox" checked={optimizeStops} onChange={event => {
                      setOptimizeStops(event.target.checked);
                      clearRoute();
                    }} /> Optimize stop order when routing
                  </label>}
                  {stops.map((stop, index) => (
                    <div key={index} className="geo-pin-actions" draggable onDragStart={event => {
                      draggingStop.current = index;
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', String(index));
                    }} onDragEnd={() => { draggingStop.current = null; }} onDragOver={event => {
                      if (draggingStop.current !== null) event.preventDefault();
                    }} onDrop={event => {
                      event.preventDefault();
                      if (draggingStop.current !== null) moveTripStop(draggingStop.current, index);
                      draggingStop.current = null;
                    }}>
                      <span>{index + 1}. {stop.name}</span>
                      <button type="button" className="geo-mini-btn" aria-label={`Move ${stop.name} earlier`} disabled={index === 0} onClick={() => moveTripStop(index, index - 1)}>↑</button>
                      <button type="button" className="geo-mini-btn" aria-label={`Move ${stop.name} later`} disabled={index === stops.length - 1}
                        onClick={() => moveTripStop(index, index + 1)}>↓</button>
                      <button type="button" className="geo-mini-btn" onClick={() => {
                        setStops(stops.filter((_, position) => position !== index));
                        clearRoute();
                      }}>Remove</button>
                    </div>
                  ))}
                </div>
              )}

                {/* Segmented Transit Mode Selector */}
                <div className="atlas-mode-selector" role="group" aria-label="Travel mode">
                  {([
                    { mode: 'driving', label: 'Drive', Icon: Car },
                    { mode: 'cycling', label: 'Cycle', Icon: Bike },
                    { mode: 'walking', label: 'Walk', Icon: Footprints }
                  ] as const).map(({ mode, label, Icon }) => (
                    <button
                      key={mode}
                      type="button"
                      className={`atlas-mode-btn ${transitMode === mode ? 'active' : ''}`}
                      aria-pressed={transitMode === mode}
                      disabled={providerMissing(mode)}
                      title={providerMissing(mode) ? 'Routing provider needs setup' : `${label} routing`}
                      onClick={() => {
                        if (transitMode === mode) return;
                        transitModeRef.current = mode;
                        setTransitMode(mode);
                        clearRoute();
                      }}
                    >
                      <Icon size={13} />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>

                {/* Isochrone Reachability Ribbon */}
                <div className="atlas-reachability-ribbon">
                  <div className="atlas-reachability-title">
                    <Clock size={11} />
                    <span>REACHABILITY CONTOURS</span>
                  </div>
                  <div className="atlas-reachability-chips">
                    {[10, 20, 30].map(mins => (
                      <button
                        key={mins}
                        type="button"
                        className={`atlas-reachability-chip ${activeIsochrone?.minutes === mins ? 'active' : ''}`}
                        onClick={() => handleGenerateIsochrone(mins)}
                        title={`Calculate ${mins}-minute ${transitMode} travel reachability`}
                      >
                        {mins}m
                      </button>
                    ))}
                    {activeIsochrone && (
                      <button
                        type="button"
                        className="atlas-reachability-chip clear"
                        onClick={() => {
                          setActiveIsochrone(null);
                          if (mapRef.current?.getSource('gis-isochrone')) {
                            (mapRef.current.getSource('gis-isochrone') as GeoJSONSource).setData({ type: 'FeatureCollection', features: [] });
                          }
                        }}
                        title="Clear reachability polygon"
                      >
                        <X size={10} /> Clear
                      </button>
                    )}
                  </div>
                </div>

                <details className="atlas-collapsible-card">
                  <summary className="atlas-collapsible-summary">
                    <div className="atlas-summary-title">
                      <SlidersHorizontal size={13} />
                      <span>Route Preferences & Traffic</span>
                    </div>
                    <ChevronDown size={13} className="atlas-chevron" />
                  </summary>
                  <div className="atlas-collapsible-body">
                    <div className="geo-pin-actions">
                      <button type="button" className="geo-mini-btn" onClick={() => setTripOrigin(null)}>Use Device Location</button>
                    </div>
                    <label className="geo-pin-desc">Assign a place to
                      <select value={placeField} onChange={event => setPlaceField(event.target.value as typeof placeField)}>
                        <option value="origin">From</option>
                        <option value="stop">Stop</option>
                        <option value="destination">To</option>
                      </select>
                    </label>
                    {!!savedPlaces.length && (
                      <label className="geo-pin-desc">Choose a saved place
                        <select value="" onChange={event => {
                          const place = savedPlaces.find(item => item.id === event.target.value);
                          if (place) assignTripPlace({ ...place, display_name: place.name });
                        }}>
                          <option value="">Saved places</option>
                          {savedPlaces.map(place => <option key={place.id} value={place.id}>{place.name}</option>)}
                        </select>
                      </label>
                    )}
                    {transitMode === 'driving' && (
                      <label className="geo-pin-desc">
                        <input type="checkbox" checked={useTrafficRouting} disabled={providerMissing('traffic_routing') && !useTrafficRouting} onChange={event => {
                          setUseTrafficRouting(event.target.checked);
                          clearRoute();
                        }} /> Use time-dependent driving{providerMissing('traffic_routing') && ' (setup required)'}
                      </label>
                    )}
                    <label className="geo-pin-desc">Arrive early (min)
                      <input type="number" min={0} max={120} value={arrivalBuffer} onChange={event => {
                        setArrivalBuffer(Math.min(120, Math.max(0, Number(event.target.value))));
                        weatherRequest.current?.abort();
                        setRouteWeather(null);
                        if (activeRoute?.source === 'valhalla_time_dependent' && activeRoute.destination.calendarTrip) {
                          clearRoute();
                          setStatusMessage('Preview again to update the time-dependent estimate.');
                        }
                      }} />
                    </label>
                  </div>
                </details>

                {missingRouteProvider && <button type="button" className="geo-mini-btn" onClick={() => setActiveTab('layers')}>View routing provider setup</button>}
                {pickingStart && (
                  <div className="atlas-start-picking-box">
                    <p className="atlas-status" role="status">Click your starting point on the map, or move it under the crosshair.</p>
                    <div className="geo-pin-actions">
                      <button type="button" className="geo-mini-btn primary atlas-preview-route" onClick={() => {
                        const center = mapRef.current?.getCenter().wrap().toArray();
                        if (center) confirmMapStart(center);
                      }}>Use map center as start</button>
                      <button type="button" className="geo-mini-btn" onClick={() => changeStartSelection(false)}>Cancel</button>
                    </div>
                  </div>
                )}
                {tripDestination && !pickingStart && !manualOrigin && !gpsLocked && (
                  <div className="atlas-destination-actions-row">
                    {currentCoords && fixAge !== null && fixAge <= 300 && (
                      <button type="button"
                        className="geo-mini-btn primary atlas-preview-route" disabled={isRouting || missingRouteProvider}
                        onClick={() => void calculateAndRenderRoute(tripDestination, undefined, undefined, undefined, true)}>
                        {isRouting ? 'Finding route…' : 'Preview from approximate location'}
                      </button>
                    )}
                    <div className="geo-pin-actions">
                      <button type="button" className="geo-mini-btn" onClick={() => {
                        setPlaceField('origin');
                        destinationSearch.current?.focus();
                      }}>Search start point</button>
                      <button type="button" className="geo-mini-btn" onClick={() => changeStartSelection(true)}>Pick start on map</button>
                    </div>
                  </div>
                )}
                {tripDestination && !pickingStart && (manualOrigin || gpsLocked) && (
                  <button type="button" className="geo-mini-btn primary atlas-preview-route" disabled={isRouting || missingRouteProvider}
                    onClick={() => {
                      if (tripDestination) void calculateAndRenderRoute(tripDestination);
                    }}>
                    <Navigation size={13} />
                    <span>{isRouting ? 'Calculating Course…' : 'Calculate Course'}</span>
                  </button>
                )}
              </div>

              <details className="atlas-collapsible-card" open={contextOpen} onToggle={event => setContextOpen(event.currentTarget.open)}>
                <summary className="atlas-collapsible-summary">
                  <div className="atlas-summary-title">
                    <Crosshair size={13} />
                    <span>Nearby Search & Sentry</span>
                  </div>
                  <ChevronDown size={13} className="atlas-chevron" />
                </summary>
                <div className="atlas-collapsible-body">
                  <label className="geo-pin-desc">Search near
                    <select value={contextSource} onChange={event => {
                      setContextSource(event.target.value as typeof contextSource);
                      searchRequest.current?.abort();
                      searchRequestId.current += 1;
                      setIsSearching(false);
                      setSearchResults(previous => previous.filter(place => !place.bearing));
                      setNearbyStatus('');
                    }}><option value="auto">Automatic</option><option value="device">Device location</option><option value="pin">Selected pin</option><option value="map">Map center</option></select>
                  </label>
                  <p className="geo-pin-desc">Search area: {nearbySourceLabel}</p>
                  {lastNearbySearch && calculateDistanceKm(
                    lastNearbySearch.center[1], lastNearbySearch.center[0], mapCenter[1], mapCenter[0]
                  ) >= 0.25 && (
                    <button type="button" className="geo-mini-btn primary"
                      onClick={() => void handleNearbySearch(lastNearbySearch.category, false, true)}>Search this area</button>
                  )}
                  <label className="geo-pin-desc">Direction
                    <select value={nearbyDirection} onChange={event => setNearbyDirection(event.target.value)}>
                      <option value="">Any direction</option>{['N','NE','E','SE','S','SW','W','NW'].map(direction => <option key={direction}>{direction}</option>)}
                    </select>
                  </label>
                  <div className="geo-pin-actions">
                    {(['hospital', 'pharmacy', 'fuel', 'food', 'atm'] as const).map(category =>
                      <button type="button" className="geo-mini-btn" key={category} onClick={() => handleNearbySearch(category)}>
                        {{ hospital: 'Hospitals', fuel: 'Fuel', food: 'Food', pharmacy: 'Pharmacies', atm: 'ATMs' }[category]}
                      </button>)}
                  </div>
                  {nearbyStatus && <p className="atlas-status" role="status">{nearbyStatus}</p>}
                </div>
              </details>

              {!!searchResults.length && (
                <div className="geo-target-pin-card">
                  <div className="geo-section-title">Place matches</div>
                  {!nearbyMatches.length && <div className="geo-pin-desc">No returned places match this direction.</div>}
                  {nearbyCandidates.filter(place => place.nearbyOrigin).length >= 2 && <>
                    <button type="button" className="geo-mini-btn" disabled={missingRouteProvider || currentComparison?.estimates === null}
                      onClick={compareNearbyTravelTimes}>
                      {currentComparison?.estimates === null ? 'Comparing travel times…' : 'Compare travel times'}
                    </button>
                    {estimates && <p className="geo-pin-desc" role="status">
                      {estimates.size ? `Travel times available for ${estimates.size} of the first ${Math.min(3, nearbyCandidates.length)} places.`
                        : 'Travel times unavailable. Results are shown by straight-line distance.'}
                    </p>}
                  </>}
                  {nearbyMatches.some(place => place.bearing) && <button type="button" className="geo-mini-btn" onClick={() => {
                    addAtlasLayer({
                      type: 'FeatureCollection',
                      features: nearbyMatches.filter(place => place.bearing).map(place => ({
                        type: 'Feature', geometry: { type: 'Point', coordinates: [place.lon, place.lat] },
                        properties: { name: place.name, category: place.category, address: place.display_name, source: 'OpenStreetMap' }
                      }))
                    }, 'Nearby places');
                    setActiveTab('layers');
                  }}>Add Nearby Matches as Layer</button>}
                  {nearbyMatches.map((place, index) => (
                    <div key={`${place.lat},${place.lon},${index}`}>
                      {renderPlaceCard(place)}
                    </div>
                  ))}
                </div>
              )}

              <details className="atlas-collapsible-card">
                <summary className="atlas-collapsible-summary">
                  <div className="atlas-summary-title">
                    <Bookmark size={13} />
                    <span>Saved Trips & Itineraries</span>
                  </div>
                  <ChevronDown size={13} className="atlas-chevron" />
                </summary>
                <div className="atlas-collapsible-body">
                  <details className="atlas-collapsible-subcard">
                    <summary className="atlas-collapsible-summary"><span>Saved trips ({savedTrips.length})</span><ChevronDown size={11} className="atlas-chevron" /></summary>
                    <div className="atlas-collapsible-body">
                      <label className="geo-pin-desc">Trip name <input maxLength={100} value={tripName} onChange={event => setTripName(event.target.value)} /></label>
                      <div className="geo-pin-actions">
                        <button type="button" className="geo-mini-btn" disabled={!tripDestination || !tripName.trim()} onClick={saveTrip}>{editingTripId ? 'Update Trip' : 'Save Trip'}</button>
                        {editingTripId && <button type="button" className="geo-mini-btn" onClick={() => { setEditingTripId(null); setTripName(''); }}>Save as New</button>}
                      </div>
                      {savedTrips.map(trip => (
                        <div key={trip.id} className="geo-pin-actions">
                          <button type="button" className="geo-mini-btn" onClick={() => loadTrip(trip)}>Open {trip.name}</button>
                          <button type="button" className="geo-mini-btn" aria-label={`Delete trip ${trip.name}`} onClick={() => {
                            if (storeTrips(savedTrips.filter(item => item.id !== trip.id)) && editingTripId === trip.id) {
                              setEditingTripId(null);
                              setTripName('');
                            }
                          }}>Delete</button>
                        </div>
                      ))}
                    </div>
                  </details>
                  <details className="atlas-collapsible-subcard">
                    <summary className="atlas-collapsible-summary"><span>Trip history ({tripHistory.length})</span><ChevronDown size={11} className="atlas-chevron" /></summary>
                    <div className="atlas-collapsible-body">
                      <label className="geo-pin-desc">
                        <input type="checkbox" checked={recordTripHistory} onChange={event => {
                          const enabled = event.target.checked;
                          try {
                            localStorage.setItem(historyOptInKey, String(enabled));
                            setRecordTripHistory(enabled);
                          } catch { setStatusMessage('Could not update history preferences in this browser.'); }
                        }} /> Save completed navigation summaries on this device
                      </label>
                      {!!tripHistory.length && <button type="button" className="geo-mini-btn" onClick={() => saveTripHistory([])}>Clear Trip History</button>}
                      {tripHistory.map(trip => (
                        <div key={trip.id} className="geo-pin-actions">
                          <span>{trip.destination} · {trip.mode} · {new Date(trip.completedAt).toLocaleString()}</span>
                          <button type="button" className="geo-mini-btn" aria-label={`Delete completed trip to ${trip.destination}`}
                            onClick={() => saveTripHistory(tripHistory.filter(item => item.id !== trip.id))}>Delete</button>
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              </details>

              <details className="atlas-collapsible-card">
                <summary className="atlas-collapsible-summary">
                  <div className="atlas-summary-title">
                    <Search size={13} />
                    <span>Search Localization & Scope</span>
                  </div>
                  <ChevronDown size={13} className="atlas-chevron" />
                </summary>
                <div className="atlas-collapsible-body">
                  <label className="geo-pin-desc">Preferred place names
                    <select value={searchLanguage} onChange={event => setSearchLanguage(event.target.value as typeof searchLanguage)}>
                      <option value="en">English</option><option value="si">සිංහල</option><option value="ta">தமிழ்</option>
                    </select>
                  </label>
                  <label className="geo-pin-desc">
                    <input type="checkbox" checked={sriLankaOnly} onChange={event => setSriLankaOnly(event.target.checked)} /> Sri Lanka only
                  </label>
                </div>
              </details>

              {!searchResults.length && !activeRoute && !!recentSearches.length && (
                <div className="geo-target-pin-card">
                  <div className="geo-section-title">RECENT SEARCHES</div>
                  <div className="geo-pin-actions">
                    {recentSearches.map(query => <button key={query} type="button" className="geo-mini-btn" onClick={() => {
                      setSearchQuery(query);
                      void searchDestinations(query);
                    }}>{query}</button>)}
                    <button type="button" className="geo-mini-btn" onClick={() => {
                      setRecentSearches([]);
                      try { localStorage.removeItem('oracle_atlas_recent'); } catch { /* History cleared for this session. */ }
                    }}>Clear Searches</button>
                  </div>
                </div>
              )}

              <div className="atlas-calendar-card">
                <div className="atlas-calendar-header">
                  <div className="atlas-summary-title">
                    <Calendar size={13} />
                    <span>Calendar Synchronized Trips</span>
                  </div>
                  <button type="button" className="geo-mini-btn" onClick={loadCalendarTrips}>
                    Sync Events
                  </button>
                </div>
                {calendarTrips.map(event => (
                  <button key={event.id} type="button" className="atlas-calendar-item-btn" onClick={() => {
                    clearRoute();
                    setSearchQuery(event.location);
                    void searchDestinations(event.location, event);
                  }}>
                    <strong>{event.summary || event.location}</strong>
                    <span>{new Date(event.start.dateTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </button>
                ))}
              </div>
              <div className="geo-target-pin-card geo-geofence-card">
                <div className="geo-geofence-header">
                  <div className="geo-geofence-title-group">
                    <Radio size={13} />
                    <span className="geo-section-title">PROXIMITY & ARRIVAL ALERTS</span>
                  </div>
                  <div className="geo-geofence-status-pill">
                    <span className={`geo-status-indicator ${locationReminders.monitoring ? 'active' : ''}`} />
                    <span>{locationReminders.monitoring ? 'MONITORING' : 'STANDBY'}</span>
                  </div>
                </div>

                <div className="geo-pin-desc">
                  Play subtle chime and Kokoro voice notification when arriving within designated radius.
                </div>

                {/* Radius Presets */}
                <div className="geo-geofence-radius-row">
                  <span className="geo-geofence-label">Radius:</span>
                  {[150, 300, 500, 1000].map(r => (
                    <button
                      key={r}
                      type="button"
                      className={`geo-geofence-preset-btn ${reminderRadius === r ? 'active' : ''}`}
                      onClick={() => setReminderRadius(r)}
                    >
                      {r >= 1000 ? `${r / 1000}km` : `${r}m`}
                    </button>
                  ))}
                  <input
                    type="number"
                    min={50}
                    max={5000}
                    value={reminderRadius}
                    onChange={e => setReminderRadius(Number(e.target.value))}
                    className="geo-geofence-input"
                    title="Custom radius in meters"
                  />
                </div>

                {/* Target Pin action */}
                {targetPin && (
                  <div className="geo-pin-actions">
                    <button
                      type="button"
                      className="geo-mini-btn primary"
                      disabled={reminderRadius < 50 || reminderRadius > 5000}
                      onClick={() => {
                        locationReminders.save([...locationReminders.reminders, {
                          id: crypto.randomUUID(),
                          name: targetPin.name || 'Pinned Target',
                          lat: targetPin.lat,
                          lon: targetPin.lon,
                          radius: reminderRadius
                        }]);
                        if (!locationReminders.monitoring) locationReminders.setMonitoring(true);
                        try { sfx.playDiagnosticBlip(1); } catch {}
                        setStatusMessage(`Deployed ${reminderRadius}m beacon on pin.`);
                      }}
                    >
                      <Plus size={11} /> Deploy Beacon at Pin ({reminderRadius}m)
                    </button>
                  </div>
                )}

                {/* Monitoring toggle */}
                <div className="geo-pin-actions">
                  <button
                    type="button"
                    className={`geo-mini-btn ${locationReminders.monitoring ? 'active' : ''}`}
                    aria-pressed={locationReminders.monitoring}
                    onClick={() => {
                      const next = !locationReminders.monitoring;
                      locationReminders.setMonitoring(next);
                      try { sfx.playDiagnosticBlip(next ? 3 : 0); } catch {}
                    }}
                  >
                    <Radio size={11} />
                    {locationReminders.monitoring ? 'Pause Monitoring' : 'Enable Arrival Alerts'}
                  </button>
                </div>

                {/* Active Beacons List */}
                {locationReminders.reminders.map(reminder => (
                  <div key={reminder.id} className="geo-beacon-item">
                    <div className="geo-beacon-info">
                      <div className="geo-beacon-name-row">
                        <span className="geo-beacon-icon-dot" />
                        <strong>{reminder.name}</strong>
                      </div>
                      <span className="geo-beacon-badge">{reminder.radius}m perimeter</span>
                    </div>
                    <div className="geo-beacon-actions">
                      <button
                        type="button"
                        className="geo-mini-btn"
                        title="Fly camera to this beacon"
                        onClick={() => {
                          mapRef.current?.flyTo({ center: [reminder.lon, reminder.lat], zoom: 16, pitch: 48, duration: 1200 });
                        }}
                      >
                        <Crosshair size={11} />
                      </button>
                      <button
                        type="button"
                        className="geo-mini-btn"
                        title="Test audio alert & Kokoro speech"
                        onClick={() => notifyArrival(reminder.name, reminder.radius)}
                      >
                        <Volume2 size={11} />
                      </button>
                      <button
                        type="button"
                        className="geo-mini-btn"
                        title="Delete beacon"
                        onClick={() => locationReminders.save(locationReminders.reminders.filter(item => item.id !== reminder.id))}
                      >
                        <X size={11} />
                      </button>
                    </div>
                  </div>
                ))}

                {(locationReminders.error || arrivalNotice) && (
                  <div className={`geo-geofence-alert ${arrivalNotice ? 'arrival' : 'error'}`} role="status">
                    <BellRing size={12} />
                    <span>{locationReminders.error || arrivalNotice}</span>
                  </div>
                )}
              </div>
              {targetPin && renderPlaceCard({
                ...targetPin, name: targetPin.name || 'Map pin', display_name: targetPin.display_name || ''
              }, () => {
                pinLookup.current?.abort();
                setTargetPin(null);
                pinMarkerRef.current?.remove();
                pinMarkerRef.current = null;
                const tether = mapRef.current?.getSource('pin-tether') as GeoJSONSource | undefined;
                tether?.setData({ type: 'FeatureCollection', features: [] });
              })}

              </>}
              {!activeRoute && (
                <div className="geo-categories-stack">
                  <button
                    type="button"
                    className="geo-cat-btn"
                    disabled={loadingParkingPhoto}
                    onClick={() => handleParkingAction()}
                  >
                    <ParkingCircle size={13} />
                    <span>{savedParking ? 'Directions to parking' : targetPin ? 'Save selected pin as parking' : 'Save current parking spot'}</span>
                  </button>
                </div>
              )}

                            {/* Saved Places List */}
              {savedPlaces.length > 0 && (
                <div className="geo-categories-stack" style={{ marginTop: 8 }}>
                  <div className="geo-section-title">SAVED BOOKMARKS ({savedPlaces.length})</div>
                  {savedPlaces.map((pl) => (
                    <div key={pl.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: '6px 10px', background: 'rgba(232, 235, 239, 0.025)', borderRadius: 8 }}>
                      <span style={{ fontSize: '11px', color: '#cbd5e1' }}>{pl.name}</span>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button type="button" className="geo-mini-btn primary" onClick={() => calculateAndRenderRoute({ name: pl.name, display_name: pl.name, lat: pl.lat, lon: pl.lon }, transitMode)}>Route</button>
                        <button type="button" className="geo-mini-btn dismiss" onClick={() => handleDeletePlace(pl.id)}>✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <details className="geo-target-pin-card">
                <summary>Parking floor, notes and photo</summary>
                <label className="geo-pin-desc">Floor or level <input value={parkingFloor} maxLength={80} onChange={event => setParkingFloor(event.target.value)} /></label>
                <label className="geo-pin-desc">Landmark note <input value={parkingNote} maxLength={500} onChange={event => setParkingNote(event.target.value)} /></label>
                <label className="geo-pin-desc">Parking photo <input type="file" accept="image/jpeg,image/png,image/webp" disabled={loadingParkingPhoto} onChange={event => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void prepareParkingPhoto(file);
                }} /></label>
                {parkingPhoto && <button type="button" className="geo-mini-btn" onClick={() => setParkingPhoto(null)}>Remove Pending Photo</button>}
                <div className="geo-pin-desc">These details are attached when you save or replace your parking spot.</div>
              </details>
              {/* Parking Notification & Recovery */}
              {parkingSavedNotice && (
                <div className="geo-notice-pill">
                  <Check size={12} color="#34d399" />
                  <span>Parking position saved.</span>
                </div>
              )}

              {savedParking && !activeRoute && (
                <div className="geo-parking-card">
                  <div className="geo-parking-header">
                    <ParkingCircle size={13} />
                    <span>SAVED VEHICLE</span>
                  </div>
                  <div className="geo-parking-meta">
                    GPS: {savedParking.lat.toFixed(4)}°, {savedParking.lon.toFixed(4)}°
                    {savedParking.saved_at && ` · Saved ${new Date(savedParking.saved_at).toLocaleString()}`}
                  </div>
                  <div className="geo-pin-desc">{savedParking.floor_level} · {savedParking.landmark_note}</div>
                  {savedParking.photo?.startsWith('data:image/jpeg;base64,') && <img className="geo-parking-photo" src={savedParking.photo} alt="Saved parking reference" />}
                  <div className="geo-parking-actions">
                    <button
                      type="button"
                      className="geo-mini-btn primary"
                      onClick={() => calculateAndRenderRoute({
                        name: 'My Parked Vehicle',
                        display_name: 'Saved Parking Spot',
                        lat: savedParking.lat,
                        lon: savedParking.lon
                      }, 'walking')}
                    >
                      Route on Foot
                    </button>
                    <button
                      type="button"
                      className="geo-mini-btn"
                      onClick={clearParking}
                    >
                      Clear
                    </button>
                    <button type="button" className="geo-mini-btn" disabled={loadingParkingPhoto} onClick={() => handleParkingAction(true)}>
                      {targetPin ? 'Replace with selected pin' : 'Replace with current location'}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* TAB 2: GEODATA & SPATIAL TOOLS */}
          {activeTab === 'gis' && (
            <div className="geo-gis-tab-content">
              <details className="geo-target-pin-card">
                <summary>Map measurements</summary>
                <div className="geo-pin-desc">Zoom level {zoomLevel}</div>
                {cursorCoords && <div className="geo-pin-desc">Cursor: {cursorCoords[1].toFixed(4)}, {cursorCoords[0].toFixed(4)}</div>}
              </details>
              {/* Geodesic Buffer Analysis */}
              <div className="geo-gis-block">
                <div className="geo-section-title">GEODESIC BUFFER (KM)</div>
                <div className="geo-gis-slider-row">
                  <input
                    type="range"
                    min="0.5"
                    max="20"
                    step="0.5"
                    value={bufferRadius}
                    onChange={(e) => setBufferRadius(parseFloat(e.target.value))}
                    className="geo-gis-slider"
                  />
                  <span className="geo-slider-val mono">{bufferRadius} km</span>
                </div>
                <div className="geo-gis-actions-row">
                  <button
                    type="button"
                    className="geo-action-btn primary"
                    onClick={() => handleGenerateBuffer(bufferRadius)}
                  >
                    Plot Buffer
                  </button>
                  {activeBuffer && (
                    <button
                      type="button"
                      className="geo-action-btn"
                      onClick={() => {
                        setActiveBuffer(null);
                        if (mapRef.current?.getSource('buffer-source')) {
                          (mapRef.current.getSource('buffer-source') as GeoJSONSource).setData({ type: 'FeatureCollection', features: [] });
                        }
                      }}
                    >
                      Clear
                    </button>
                  )}
                </div>
                {activeBuffer && (
                  <div className="geo-gis-result-box">
                    <div className="geo-res-row">
                      <span>Area (Hectares):</span>
                      <span className="mono cyan">{activeBuffer.area_ha.toLocaleString()} ha</span>
                    </div>
                    <div className="geo-res-row">
                      <span>Area (km²):</span>
                      <span className="mono">{activeBuffer.area_sqkm.toLocaleString()} km²</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Isochrone Reachability */}
              <div className="geo-gis-block">
                <div className="geo-section-title">TRAVEL REACHABILITY</div>
                {activeIsochrone && <div className="geo-pin-desc">{activeIsochrone.source === 'road_network'
                  ? 'Road-network reachability'
                  : 'Approximate reachability based on assumed speed'} · {activeIsochrone.area_sqkm} km²</div>}
                <div className="geo-gis-slider-row">
                  <input
                    type="range"
                    min="5"
                    max="60"
                    step="5"
                    value={isochroneMinutes}
                    onChange={(e) => setIsochroneMinutes(parseInt(e.target.value, 10))}
                    className="geo-gis-slider"
                  />
                  <span className="geo-slider-val mono">{isochroneMinutes} min</span>
                </div>
                <div className="geo-gis-actions-row">
                  <button
                    type="button"
                    className="geo-action-btn primary"
                    onClick={() => handleGenerateIsochrone(isochroneMinutes)}
                  >
                    Compute Isochrone
                  </button>
                  {activeIsochrone && (
                    <button
                      type="button"
                      className="geo-action-btn"
                      onClick={() => {
                        setActiveIsochrone(null);
                        if (mapRef.current?.getSource('gis-isochrone')) {
                          (mapRef.current.getSource('gis-isochrone') as GeoJSONSource).setData({ type: 'FeatureCollection', features: [] });
                        }
                      }}
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {/* Linear / Polygon Measurement Tool */}
              <div className="geo-gis-block">
                <div className="geo-section-title">MEASUREMENT TOOL</div>
                <div className="geo-measurement-toggles">
                  <button
                    type="button"
                    className={`geo-mini-btn ${measureMode && !measurePolygon ? 'active' : ''}`}
                    onClick={() => {
                      setMeasureMode(true);
                      setMeasurePolygon(false);
                      setMeasurement({ points: [], distance_km: 0, area_ha: 0, isPolygon: false });
                    }}
                  >
                    Distance
                  </button>
                  <button
                    type="button"
                    className={`geo-mini-btn ${measureMode && measurePolygon ? 'active' : ''}`}
                    onClick={() => {
                      setMeasureMode(true);
                      setMeasurePolygon(true);
                      setMeasurement({ points: [], distance_km: 0, area_ha: 0, isPolygon: true });
                    }}
                  >
                    Polygon Area
                  </button>
                  {measureMode && (
                    <button
                      type="button"
                      className="geo-mini-btn dismiss"
                      onClick={() => {
                        setMeasureMode(false);
                        setMeasurement({ points: [], distance_km: 0, area_ha: 0, isPolygon: false });
                        if (mapRef.current?.getSource('measure-source')) {
                          (mapRef.current.getSource('measure-source') as GeoJSONSource).setData({ type: 'FeatureCollection', features: [] });
                        }
                      }}
                    >
                      Cancel
                    </button>
                  )}
                </div>
                {measureMode && (
                  <div className="geo-measure-readout">
                    <div className="geo-measure-hint">Click on map to place measurement points.</div>
                    <div className="geo-res-row">
                      <span>Points:</span>
                      <span className="mono">{measurement.points.length}</span>
                    </div>
                    <div className="geo-res-row">
                      <span>Distance:</span>
                      <span className="mono cyan">{measurement.distance_km} km</span>
                    </div>
                    {measurement.isPolygon && (
                      <div className="geo-res-row">
                        <span>Area:</span>
                        <span className="mono cyan">{measurement.area_ha} ha</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: DATA LAYERS & PROVENANCE */}
          {activeTab === 'layers' && (
            <div className="geo-layers-tab-content">
              <details className="geo-target-pin-card">
                <summary>Location details</summary>
                <div className="geo-pin-desc">Status: {locationStatus.toLowerCase()}</div>
                {accuracyLabel && <div className="geo-pin-desc">Reported accuracy: {accuracyLabel}</div>}
                {fixAge !== null && <div className="geo-pin-desc">Last fix: {fixAge}s ago</div>}
                {currentCoords && <div className="geo-pin-desc">Coordinates: {currentCoords[1].toFixed(5)}, {currentCoords[0].toFixed(5)}</div>}
                {deviceHeading !== null && fixAge !== null && fixAge < 30 && <div className="geo-pin-desc">Heading: {Math.round(deviceHeading)}°</div>}
              </details>
              {/* Custom GeoJSON Upload */}
              <div className="geo-gis-block">
                <div className="geo-section-title">CUSTOM GEOJSON OVERLAY</div>
                <button
                  type="button"
                  className="geo-action-btn primary"
                  style={{ width: '100%' }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={12} />
                  <span>Import Layer or Project</span>
                </button>
                <button type="button" className="geo-mini-btn" onClick={saveAtlasProject}>Save GIS Project</button>
                {pendingCsv && <div className="geo-target-pin-card">
                  <div className="geo-pin-title">CSV coordinates · {pendingCsv.name}</div>
                  <label>Longitude <select value={csvLongitude} onChange={event => setCsvLongitude(event.target.value)}>
                    <option value="">Choose column</option>{pendingCsv.data.fields.map(field => <option key={field}>{field}</option>)}
                  </select></label>
                  <label>Latitude <select value={csvLatitude} onChange={event => setCsvLatitude(event.target.value)}>
                    <option value="">Choose column</option>{pendingCsv.data.fields.map(field => <option key={field}>{field}</option>)}
                  </select></label>
                  <button type="button" className="geo-mini-btn" disabled={!csvLongitude || !csvLatitude || csvLongitude === csvLatitude} onClick={() => {
                    try {
                      addAtlasLayer(atlasCsvFeatures(pendingCsv.data, csvLongitude, csvLatitude), pendingCsv.name);
                      setPendingCsv(null);
                    } catch (error) { setStatusMessage(error instanceof Error ? error.message : 'CSV import failed'); }
                  }}>Import CSV Points</button>
                  <button type="button" className="geo-mini-btn" onClick={() => setPendingCsv(null)}>Cancel</button>
                </div>}
                {importedLayers.map(layer => (
                  <div key={layer.id} className="geo-target-pin-card">
                    <div className="geo-pin-title">{layer.name}</div>
                    <label className="geo-pin-desc"><input type="checkbox" checked={layer.visible} onChange={event => {
                      const visible = event.target.checked;
                      setImportedLayers(previous => previous.map(item => item.id === layer.id ? { ...item, visible } : item));
                    }} /> Visible</label>
                    <label className="geo-pin-desc"><input type="checkbox" checked={layer.buildings} onChange={event => {
                      const buildings = event.target.checked;
                      setImportedLayers(previous => previous.map(item => item.id === layer.id ? { ...item, buildings } : item));
                      if (buildings && !is3D) toggle3D();
                    }} /> Extrude polygon heights (metres)</label>
                    <div className="geo-pin-actions">
                      <button type="button" className="geo-mini-btn" onClick={() => {
                        setInspectedLayerId(layer.id);
                        setSelectedFeature(null);
                      }}>Inspect</button>
                      <button type="button" className="geo-mini-btn" onClick={() => downloadLayer(layer)}>Export</button>
                      <button type="button" className="geo-mini-btn" onClick={() => setImportedLayers(previous =>
                        previous.filter(item => item.id !== layer.id)
                      )}>Remove</button>
                    </div>
                  </div>
                ))}
                {savedCorridor && <button type="button" className="geo-mini-btn" onClick={() => setSavedCorridor(undefined)}>
                  {routeLine ? 'Use Active Route for Corridor' : 'Clear Corridor Reference'}
                </button>}
                {inspectedLayer && <AtlasFeatureInspector key={inspectedLayer.id} layer={inspectedLayer}
                  filter={spatialFilters[inspectedLayer.id] || emptySpatialFilter}
                  onFilter={filter => setSpatialFilters(previous => ({ ...previous, [inspectedLayer.id]: filter }))}
                  selection={selectedFeature}
                  onSelect={index => {
                    inspectFeature(inspectedLayer.id, index);
                    const bounds = new LngLatBounds();
                    geometryPositions(inspectedLayer.data.features[index].geometry).forEach(([lon, lat]) => bounds.extend([lon, lat]));
                    if (!bounds.isEmpty()) mapRef.current?.fitBounds(bounds, { maxZoom: 17, padding: 90 });
                  }}
                  areas={spatialAreas} route={corridorRoute} estimateDetours={estimateCorridorDetours}
                  onUseLine={line => {
                    setSavedCorridor(line);
                    setStatusMessage('Corridor reference set. Enter a width in the feature inspector.');
                  }}
                  exportGeoJSON={downloadGeoJSON} exportCsv={(csv, filename) => downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename)}
                />}
              </div>

              <div className="geo-gis-block">
                <div className="geo-section-title">PROVIDER STATUS</div>
                <div className="geo-pin-actions">
                  <button type="button" className="geo-mini-btn" disabled={checkingProviders} onClick={() => loadProviders(false)}>Show Setup</button>
                  <button type="button" className="geo-mini-btn" disabled={checkingProviders} onClick={() => loadProviders(true)}>Check Connections</button>
                </div>
                {checkingProviders && <div className="geo-pin-desc" role="status">Checking providers…</div>}
                {providerInfo && Object.entries(providerInfo.providers).map(([name, state]) => (
                  <div key={name} className="geo-prov-item">
                    <span className="key">{providerLabels[name] || name}</span>
                    <span className="val">{providerStateLabels[state]}</span>
                  </div>
                ))}
                {providerInfo?.checked_at && <div className="geo-pin-desc">Checked {new Date(providerInfo.checked_at).toLocaleTimeString()}</div>}
              </div>
              {/* Data Provenance & CRS Specifications */}
              <div className="geo-gis-block">
                <div className="geo-section-title">PROVENANCE & COMPLIANCE</div>
                <div className="geo-prov-item">
                  <span className="key">CRS:</span>
                  <span className="val mono">WGS84 (EPSG:4326)</span>
                </div>
                <div className="geo-prov-item">
                  <span className="key">Routing Engine:</span>
                  <span className="val">OSRM / OpenStreetMap</span>
                </div>
                <div className="geo-prov-item">
                  <span className="key">Basemap Tiles:</span>
                  <span className="val">Esri CDN & OpenStreetMap</span>
                </div>
                <button
                  type="button"
                  className="geo-action-btn"
                  style={{ width: '100%', marginTop: '8px' }}
                  onClick={handleExportGeoJSON}
                >
                  <Download size={12} />
                  <span>Export Active Features (GeoJSON)</span>
                </button>
              </div>
            </div>
          )}
          </div>
        </aside>
      )}

      {!isDrawerOpen && (navigating ? navigationStatus : atlasStatus) && (
        <p className="atlas-status atlas-status-floating" role="status">{navigating ? navigationStatus : atlasStatus}</p>
      )}

      {/* 4. TACTICAL COMPASS & FLIGHT TELEMETRY HUD (Bottom-Right) */}
      <div className="geo-tactical-hud-corner" aria-label="Spatial Orientation & Telemetry Controls">
        <div className="geo-hud-telemetry-badge" title="Map coordinates and zoom level">
          <Crosshair size={11} className="geo-hud-icon cyan" />
          <span className="geo-hud-coord">
            {cursorCoords 
              ? `${cursorCoords[1].toFixed(4)}°, ${cursorCoords[0].toFixed(4)}°` 
              : mapCenter 
                ? `${mapCenter[1].toFixed(4)}°, ${mapCenter[0].toFixed(4)}°` 
                : '---'}
          </span>
          <span className="geo-hud-zoom">Z {zoomLevel.toFixed(1)}</span>
        </div>

        <div className="geo-hud-controls-stack">
          {/* Compass Rose Dial */}
          <button
            type="button"
            className="geo-compass-dial-btn"
            onClick={() => mapRef.current?.easeTo({ bearing: 0, duration: 600 })}
            title={`Bearing: ${((360 - (mapBearing % 360)) % 360).toFixed(0)}°. Click to reset to True North`}
            aria-label="Reset bearing to North"
          >
            <div
              className="geo-compass-needle"
              style={{ transform: `rotate(${-mapBearing}deg)` }}
            >
              <div className="geo-needle-north" />
              <div className="geo-needle-south" />
            </div>
            <span className="geo-compass-label">
              {Math.abs(mapBearing % 360) < 5 ? 'N' : `${((360 - (mapBearing % 360)) % 360).toFixed(0)}°`}
            </span>
          </button>

          {/* Pitch Camera Angle Dial */}
          <button
            type="button"
            className={`geo-pitch-dial-btn ${mapPitch > 10 ? 'active' : ''}`}
            onClick={() => {
              const next = mapPitch < 20 ? 45 : mapPitch < 55 ? 60 : 0;
              mapRef.current?.easeTo({ pitch: next, duration: 600 });
            }}
            title={`Pitch: ${Math.round(mapPitch)}°. Click to cycle camera tilt (0° / 45° / 60°)`}
            aria-label="Cycle camera pitch"
          >
            <span className="geo-pitch-text">{Math.round(mapPitch)}°</span>
            <span className="geo-pitch-sub">TILT</span>
          </button>

          {/* Spatial Bookmarks / Vantage Points */}
          <div className="geo-relative-wrap">
            <button
              type="button"
              className={`geo-pitch-dial-btn ${bookmarksOpen ? 'active' : ''}`}
              onClick={() => setBookmarksOpen(!bookmarksOpen)}
              title="Spatial Bookmarks / Saved Camera Views"
              aria-label="View spatial bookmarks"
            >
              <Bookmark size={13} />
              <span className="geo-pitch-sub">VIEWS</span>
            </button>

            {bookmarksOpen && (
              <div className="geo-bookmarks-flyout" role="dialog" aria-label="Saved Vantage Points">
                <div className="geo-flyout-header">
                  <span>SAVED VIEWPOINTS ({bookmarks.length})</span>
                  <button type="button" className="geo-mini-btn primary" onClick={saveBookmark}>+ Save View</button>
                </div>
                {!bookmarks.length && (
                  <div className="geo-pin-desc">No viewpoints saved yet. Click "+ Save View" to bookmark this camera angle.</div>
                )}
                {bookmarks.map(bm => (
                  <div key={bm.id} className="geo-bookmark-item">
                    <button type="button" className="geo-bookmark-label-btn" onClick={() => flyToBookmark(bm)}>
                      <strong>{bm.name}</strong>
                      <span>Z{bm.zoom} • {bm.pitch}° • {bm.bearing}°</span>
                    </button>
                    <button type="button" className="geo-bookmark-del-btn" onClick={() => deleteBookmark(bm.id)} title="Delete viewpoint">
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Zoom In / Out Steppers */}
          <div className="geo-zoom-stepper">
            <button
              type="button"
              className="geo-zoom-btn"
              onClick={() => mapRef.current?.zoomIn({ duration: 300 })}
              title="Zoom In (+)"
              aria-label="Zoom in"
            >
              <Plus size={13} />
            </button>
            <div className="geo-zoom-divider" />
            <button
              type="button"
              className="geo-zoom-btn"
              onClick={() => mapRef.current?.zoomOut({ duration: 300 })}
              title="Zoom Out (-)"
              aria-label="Zoom out"
            >
              <Minus size={13} />
            </button>
          </div>

          {/* Keyboard Shortcuts Trigger */}
          <button
            type="button"
            className={`geo-pitch-dial-btn ${showKeybindings ? 'active' : ''}`}
            onClick={() => setShowKeybindings(!showKeybindings)}
            title="Tactical Keyboard Shortcuts (?)"
            aria-label="View keyboard shortcuts"
          >
            <Keyboard size={13} />
            <span className="geo-pitch-sub">KEYS</span>
          </button>
        </div>
      </div>

      {/* 5. CINEMATIC 3D ROUTE FLY-THROUGH HUD */}
      {isFlyThroughActive && (
        <div className="geo-flythrough-hud" role="region" aria-label="3D Flight Simulation">
          <div className="geo-flythrough-pill">
            <div className="geo-flythrough-badge">
              <Plane size={13} className="geo-fly-icon" />
              <span>3D RECON</span>
            </div>

            <button
              type="button"
              className="geo-fly-btn"
              onClick={() => setFlyThroughPaused(!flyThroughPaused)}
              title={flyThroughPaused ? 'Resume Playback' : 'Pause Playback'}
            >
              {flyThroughPaused ? <Play size={12} /> : <Pause size={12} />}
            </button>

            <button
              type="button"
              className="geo-fly-btn speed"
              onClick={() => setFlyThroughSpeed(s => s === 1 ? 2 : s === 2 ? 4 : 1)}
              title="Cycle playback speed (1x / 2x / 4x)"
            >
              <FastForward size={11} />
              <span>{flyThroughSpeed}x</span>
            </button>

            <div className="geo-fly-progress-track">
              <div
                className="geo-fly-progress-bar"
                style={{ width: `${flyThroughProgress}%` }}
              />
            </div>
            <span className="geo-fly-pct">{flyThroughProgress}%</span>

            {flyThroughManeuver && (
              <span className="geo-fly-maneuver" title={flyThroughManeuver}>
                {flyThroughManeuver}
              </span>
            )}

            <button
              type="button"
              className="geo-fly-btn close"
              onClick={stopFlyThrough}
              title="Exit 3D Flight Preview"
            >
              <X size={12} />
            </button>
          </div>
        </div>
      )}

      {/* 6. TACTICAL KEYBINDINGS OVERLAY */}
      {showKeybindings && (
        <div className="geo-modal-backdrop" onClick={() => setShowKeybindings(false)}>
          <div className="geo-shortcuts-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label="Tactical Keyboard Controls">
            <div className="geo-shortcuts-header">
              <div className="geo-shortcuts-title">
                <Keyboard size={14} className="cyan" />
                <span>TACTICAL KEYBOARD CONTROLS</span>
              </div>
              <button type="button" className="geo-capsule-btn close" onClick={() => setShowKeybindings(false)}>
                <X size={12} />
              </button>
            </div>
            <div className="geo-shortcuts-grid">
              <div className="geo-shortcut-row"><kbd>Space</kbd><span>Recenter on GPS</span></div>
              <div className="geo-shortcut-row"><kbd>F</kbd><span>Focus Search Bar</span></div>
              <div className="geo-shortcut-row"><kbd>3</kbd><span>Toggle 3D Perspective</span></div>
              <div className="geo-shortcut-row"><kbd>R</kbd><span>Reset Heading to True North</span></div>
              <div className="geo-shortcut-row"><kbd>P</kbd><span>Cycle Camera Tilt (0° / 45° / 60°)</span></div>
              <div className="geo-shortcut-row"><kbd>M</kbd><span>Toggle GIS Measurement Tool</span></div>
              <div className="geo-shortcut-row"><kbd>B</kbd><span>Toggle Spatial Bookmarks</span></div>
              <div className="geo-shortcut-row"><kbd>?</kbd><span>Toggle Keyboard Shortcut Sheet</span></div>
              <div className="geo-shortcut-row"><kbd>Esc</kbd><span>Close Panel / Exit Mode</span></div>
            </div>
          </div>
        </div>
      )}

      {children}
    </div>
  );
};
