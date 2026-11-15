import { useEffect, useRef, useState, useMemo } from 'react';
import type { LineString } from 'geojson';
import { buildRouteTrack, type RoutePoint } from '../utils/atlasNavigation';

function sampleRoute(route: LineString) {
  const points = route.coordinates as RoutePoint[];
  const lengths = points.slice(1).map((point, index) => buildRouteTrack([points[index], point]).total);
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (!total) throw new Error('Route has no measurable length');
  const count = Math.min(75, Math.max(2, Math.ceil(total / 100) + 1));
  let segment = 0;
  let offset = 0;
  return Array.from({ length: count }, (_, index) => {
    const distance = (total * index) / (count - 1);
    while (segment < lengths.length - 1 && (lengths[segment] === 0 || offset + lengths[segment] < distance)) {
      offset += lengths[segment++];
    }
    const start = points[segment];
    const end = points[segment + 1];
    const fraction = lengths[segment] ? Math.min(1, (distance - offset) / lengths[segment]) : 0;
    const lonDelta = ((end[0] - start[0] + 540) % 360) - 180;
    return {
      distance,
      lon: ((start[0] + lonDelta * fraction + 540) % 360) - 180,
      lat: start[1] + (end[1] - start[1]) * fraction
    };
  });
}

export interface ElevationPoint {
  distance: number;
  metres: number;
  lon: number;
  lat: number;
  grade: number;
}

export interface ElevationProfile {
  points: ElevationPoint[];
  ascent: number;
  steepest: { grade: number; distance: number };
}

export function getGradeColor(grade: number): string {
  if (grade >= 7) return '#ef4444'; // Steep ascent (Red)
  if (grade >= 3) return '#f59e0b'; // Moderate climb (Amber)
  if (grade <= -3) return '#06b6d4'; // Descent (Cyan)
  return '#10b981'; // Flat/cruising (Emerald)
}

async function loadProfile(route: LineString, signal: AbortSignal): Promise<ElevationProfile> {
  const samples = sampleRoute(route);
  const params = new URLSearchParams({
    latitude: samples.map(point => point.lat.toFixed(6)).join(','),
    longitude: samples.map(point => point.lon.toFixed(6)).join(',')
  });
  const response = await fetch(`https://api.open-meteo.com/v1/elevation?${params}`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(8000)])
  });
  if (!response.ok) throw new Error('Elevation provider unavailable');
  const data = await response.json();
  if (!Array.isArray(data.elevation) || data.elevation.length !== samples.length || !data.elevation.every(Number.isFinite)) {
    throw new Error('Incomplete elevation data');
  }
  const rawPoints: ElevationPoint[] = samples.map((point, index) => ({
    distance: point.distance,
    metres: Math.round(data.elevation[index] as number),
    lon: point.lon,
    lat: point.lat,
    grade: 0
  }));
  let ascent = 0;
  let steepest = { grade: 0, distance: 0 };
  for (let i = 1; i < rawPoints.length; i++) {
    const prev = rawPoints[i - 1];
    const curr = rawPoints[i];
    const rise = curr.metres - prev.metres;
    ascent += Math.max(0, rise);
    const dDist = curr.distance - prev.distance;
    const grade = dDist > 0 ? (100 * rise) / dDist : 0;
    curr.grade = Math.round(grade * 10) / 10;
    if (i === 1) prev.grade = curr.grade;
    if (Math.abs(curr.grade) > Math.abs(steepest.grade)) {
      steepest = { grade: curr.grade, distance: prev.distance };
    }
  }
  return { points: rawPoints, ascent, steepest };
}

export interface AtlasElevationProps {
  routes: { geometry: LineString; duration_seconds: number }[];
  selected: number;
  onHoverPoint?: (point: ElevationPoint | null) => void;
  onProfileLoaded?: (profile: ElevationProfile | null) => void;
  onToggleSlopeHeatmap?: (active: boolean) => void;
  slopeHeatmapActive?: boolean;
}

export function AtlasElevation({
  routes,
  selected,
  onHoverPoint,
  onProfileLoaded,
  onToggleSlopeHeatmap,
  slopeHeatmapActive
}: AtlasElevationProps) {
  const [profiles, setProfiles] = useState<Record<number, ElevationProfile>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const pending = useRef<AbortController | null>(null);

  useEffect(() => () => pending.current?.abort(), []);

  const profile = profiles[selected];

  useEffect(() => {
    if (profile) {
      onProfileLoaded?.(profile);
    }
  }, [profile, onProfileLoaded]);

  const load = async (all: boolean) => {
    pending.current?.abort();
    const request = new AbortController();
    pending.current = request;
    setBusy(true);
    setError('');
    const indexes = all ? routes.map((_, index) => index) : [selected];
    try {
      for (const index of indexes) {
        if (profiles[index]) continue;
        const result = await loadProfile(routes[index].geometry, request.signal);
        if (request.signal.aborted) return;
        setProfiles(previous => ({ ...previous, [index]: result }));
      }
    } catch {
      if (!request.signal.aborted) setError('Elevation data could not be loaded for every requested route.');
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  };

  const minimum = profile ? Math.min(...profile.points.map(point => point.metres)) : 0;
  const maximum = profile ? Math.max(...profile.points.map(point => point.metres)) : 0;
  const total = profile?.points.at(-1)?.distance || 1;
  const range = Math.max(1, maximum - minimum);

  const getSvgX = (dist: number) => 5 + (290 * dist) / total;
  const getSvgY = (metres: number) => 72 - (62 * (metres - minimum)) / range;

  // Slope-colored segments
  const segments = useMemo(() => {
    if (!profile || profile.points.length < 2) return [];
    const segs: { x1: number; y1: number; x2: number; y2: number; color: string }[] = [];
    for (let i = 1; i < profile.points.length; i++) {
      const prev = profile.points[i - 1];
      const curr = profile.points[i];
      segs.push({
        x1: getSvgX(prev.distance),
        y1: getSvgY(prev.metres),
        x2: getSvgX(curr.distance),
        y2: getSvgY(curr.metres),
        color: getGradeColor(curr.grade)
      });
    }
    return segs;
  }, [profile, minimum, maximum, total]);

  // Area under curve
  const polygonPoints = useMemo(() => {
    if (!profile || !profile.points.length) return '';
    const pts = profile.points.map(p => `${getSvgX(p.distance).toFixed(1)},${getSvgY(p.metres).toFixed(1)}`);
    return `5,74 ${pts.join(' ')} 295,74`;
  }, [profile, minimum, maximum, total]);

  const handlePointer = (clientX: number) => {
    if (!svgRef.current || !profile || !profile.points.length) return;
    const rect = svgRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const targetDistance = total * ratio;

    let closestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < profile.points.length; i++) {
      const diff = Math.abs(profile.points[i].distance - targetDistance);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = i;
      }
    }
    setHoverIndex(closestIdx);
    onHoverPoint?.(profile.points[closestIdx]);
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    handlePointer(e.clientX);
  };

  const handleTouchMove = (e: React.TouchEvent<SVGSVGElement>) => {
    if (e.touches[0]) handlePointer(e.touches[0].clientX);
  };

  const handleMouseLeave = () => {
    setHoverIndex(null);
    onHoverPoint?.(null);
  };

  const hoverPoint = hoverIndex !== null && profile ? profile.points[hoverIndex] : null;
  const hoverX = hoverPoint ? getSvgX(hoverPoint.distance) : 0;
  const hoverY = hoverPoint ? getSvgY(hoverPoint.metres) : 0;

  return (
    <details className="geo-target-pin-card atlas-elevation-card">
      <summary className="atlas-elevation-summary">
        <span>Terrain & Elevation Profile</span>
        {profile && <span className="atlas-elevation-gain-badge">+{Math.round(profile.ascent)}m ascent</span>}
      </summary>

      <div className="geo-pin-actions">
        <button type="button" className="geo-mini-btn" disabled={busy} onClick={() => load(false)}>
          {profile ? 'Refresh Terrain' : 'Load Elevation Profile'}
        </button>
        {routes.length > 1 && (
          <button type="button" className="geo-mini-btn" disabled={busy} onClick={() => load(true)}>
            Compare Climbs
          </button>
        )}
        {profile && onToggleSlopeHeatmap && (
          <button
            type="button"
            className={`geo-mini-btn ${slopeHeatmapActive ? 'active' : ''}`}
            onClick={() => onToggleSlopeHeatmap(!slopeHeatmapActive)}
            title="Color-code 3D route on map by slope steepness"
          >
            <span>{slopeHeatmapActive ? '🗺️ Slope Heatmap: ON' : '🗺️ Slope Heatmap'}</span>
          </button>
        )}
      </div>

      {busy && <div role="status" className="geo-pin-desc">Sampling terrain altitudes via Copernicus DEM…</div>}
      {error && <div role="status" className="geo-geofence-alert error">{error}</div>}

      {profile && (
        <>
          <div
            className="atlas-elevation-chart-container"
            onMouseLeave={handleMouseLeave}
          >
            <svg
              ref={svgRef}
              viewBox="0 0 300 80"
              width="100%"
              role="img"
              aria-label="Route elevation versus distance"
              className="atlas-elevation-svg"
              onMouseMove={handleMouseMove}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleMouseLeave}
            >
              <defs>
                <linearGradient id="elevationGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#9db4d3" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#9db4d3" stopOpacity="0.02" />
                </linearGradient>
              </defs>

              {/* Area gradient under profile */}
              <polygon points={polygonPoints} fill="url(#elevationGrad)" />

              {/* Slope-colored line segments */}
              {segments.map((seg, idx) => (
                <line
                  key={idx}
                  x1={seg.x1}
                  y1={seg.y1}
                  x2={seg.x2}
                  y2={seg.y2}
                  stroke={seg.color}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
              ))}

              {/* Interactive Scrubbing Crosshair & Drone Node */}
              {hoverPoint && (
                <>
                  <line
                    x1={hoverX}
                    y1={4}
                    x2={hoverX}
                    y2={74}
                    stroke="#9db4d3"
                    strokeWidth="1"
                    strokeDasharray="2,2"
                  />
                  <circle
                    cx={hoverX}
                    cy={hoverY}
                    r="4.5"
                    fill="#ffffff"
                    stroke="#9db4d3"
                    strokeWidth="2"
                  />
                </>
              )}
            </svg>

            {/* Hover Floating HUD Tooltip */}
            {hoverPoint && (
              <div
                className="atlas-elevation-tooltip"
                style={{
                  left: `${Math.max(12, Math.min(88, (hoverX / 300) * 100))}%`
                }}
              >
                <span className="tooltip-alt">{hoverPoint.metres}m</span>
                <span className="tooltip-dist">{(hoverPoint.distance / 1000).toFixed(1)}km</span>
                <span className="tooltip-grade" style={{ color: getGradeColor(hoverPoint.grade) }}>
                  {hoverPoint.grade > 0 ? '+' : ''}{hoverPoint.grade.toFixed(1)}%
                </span>
              </div>
            )}
          </div>

          {/* Incline Legend */}
          <div className="atlas-elevation-legend">
            <span className="legend-chip flat">🟢 &lt;3% Flat</span>
            <span className="legend-chip moderate">🟠 3–7% Incline</span>
            <span className="legend-chip steep">🔴 &gt;7% Steep</span>
            <span className="legend-chip descent">🔵 &lt;-3% Down</span>
          </div>

          <div className="geo-pin-desc">
            {Math.round(minimum)}–{Math.round(maximum)}m elevation · {Math.round(profile.ascent)}m ascent
          </div>
          <div className="geo-pin-desc">
            Steepest section: <strong style={{ color: getGradeColor(profile.steepest.grade) }}>{profile.steepest.grade.toFixed(1)}%</strong> near {(profile.steepest.distance / 1000).toFixed(2)} km.
          </div>
        </>
      )}

      {Object.keys(profiles).length > 1 &&
        Object.entries(profiles).map(([key, value]) => (
          <div className="geo-pin-desc" key={key}>
            {Number(key) === 0 ? 'Primary' : `Route ${Number(key) + 1}`} · {Math.round(routes[Number(key)].duration_seconds / 60)} min · {Math.round(value.ascent)} m ascent
          </div>
        ))}

      <div className="geo-pin-desc">
        Terrain telemetry powered by Open-Meteo & Copernicus DEM.
      </div>
    </details>
  );
}
