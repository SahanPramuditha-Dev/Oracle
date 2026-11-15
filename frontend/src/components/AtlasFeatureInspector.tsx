import { useMemo, useState } from 'react';
import type { Feature, FeatureCollection, LineString, MultiLineString, MultiPolygon, Polygon, Position } from 'geojson';
import booleanIntersects from '@turf/boolean-intersects';
import buffer from '@turf/buffer';
import pointToLineDistance from '@turf/point-to-line-distance';

export interface AtlasLayer {
  id: string;
  name: string;
  data: FeatureCollection;
  visible: boolean;
  buildings: boolean;
}

export interface FeatureKey {
  layerId: string;
  index: number;
}

export interface SpatialFilter {
  field: string;
  value: string;
  area: string;
  corridor: number;
}

export const emptySpatialFilter: SpatialFilter = { field: '', value: '', area: '', corridor: 0 };
export type AtlasArea = Feature<Polygon | MultiPolygon>;
export type CorridorLine = LineString | MultiLineString;

const corridorCache = new WeakMap<CorridorLine, { width: number; area?: AtlasArea }>();

export function getAtlasCorridor(line: CorridorLine, width: number): AtlasArea | undefined {
  const cached = corridorCache.get(line);
  if (cached?.width === width) return cached.area;
  const area = buffer(line, width, { units: 'meters' });
  corridorCache.set(line, { width, area });
  return area;
}

function pointDistance(point: Position, route: CorridorLine) {
  if (route.type === 'LineString') return pointToLineDistance(point, route, { units: 'meters' });
  return route.coordinates.reduce((nearest, coordinates) =>
    Math.min(nearest, pointToLineDistance(point, { type: 'LineString', coordinates }, { units: 'meters' })), Infinity);
}

function attribute(value: unknown): string {
  return value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
}

export function filterAtlasFeatures(layer: AtlasLayer, filter: SpatialFilter, area?: AtlasArea, route?: CorridorLine) {
  const search = filter.value.trim().toLocaleLowerCase();
  return layer.data.features.flatMap((feature, index) => {
    const values = filter.field ? [feature.properties?.[filter.field]] : Object.values(feature.properties || {});
    if (search && !values.some(value => attribute(value).toLocaleLowerCase().includes(search))) return [];
    if (filter.area && (!area || !feature.geometry || !booleanIntersects(feature.geometry, area))) return [];
    if (filter.corridor > 0) {
      if (!route || !feature.geometry) return [];
      if (feature.geometry.type === 'Point') {
        if (pointDistance(feature.geometry.coordinates, route) > filter.corridor) return [];
      } else {
        const corridor = getAtlasCorridor(route, filter.corridor);
        if (!corridor || !booleanIntersects(feature.geometry, corridor)) return [];
      }
    }
    return [{ feature, index }];
  });
}

function csvCell(value: unknown) {
  const text = attribute(value);
  const safe = /^[\s]*[=+\-@]|^[\t\r\n]/.test(text) && typeof value !== 'number' ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}

interface Props {
  layer: AtlasLayer;
  filter: SpatialFilter;
  onFilter: (filter: SpatialFilter) => void;
  selection: FeatureKey | null;
  onSelect: (index: number) => void;
  areas: { id: string; label: string; feature: AtlasArea }[];
  route?: CorridorLine;
  onUseLine: (line: CorridorLine) => void;
  estimateDetours?: (points: Position[]) => Promise<(number | null)[]>;
  exportGeoJSON: (data: FeatureCollection, name: string) => void;
  exportCsv: (text: string, name: string) => void;
}

export function AtlasFeatureInspector({ layer, filter, onFilter, selection, onSelect, areas, route, onUseLine, estimateDetours, exportGeoJSON, exportCsv }: Props) {
  const [page, setPage] = useState(0);
  const [detourLimit, setDetourLimit] = useState(5);
  const [detours, setDetours] = useState<{ route: CorridorLine; filter: SpatialFilter; index: number; seconds: number }[]>([]);
  const [detourMessage, setDetourMessage] = useState('');
  const [checkingDetours, setCheckingDetours] = useState(false);
  const fields = useMemo(() => [...new Set(layer.data.features.flatMap(feature =>
    Object.keys(feature.properties || {})))].sort(), [layer.data]);
  const area = areas.find(item => item.id === filter.area)?.feature;
  const matches = useMemo(() => filterAtlasFeatures(layer, filter, area, route), [layer, filter, area, route]);
  const lastPage = Math.max(0, Math.ceil(matches.length / 25) - 1);
  const visiblePage = Math.min(page, lastPage);
  const selected = selection?.layerId === layer.id ? layer.data.features[selection.index] : undefined;
  const update = (change: Partial<SpatialFilter>) => { onFilter({ ...filter, ...change }); setPage(0); };
  return (
    <section className="geo-target-pin-card geo-feature-inspector" aria-label="Feature inspector">
      <div className="geo-section-title">FEATURE INSPECTOR · {layer.name}</div>
      <label>Attribute <select value={filter.field} onChange={event => update({ field: event.target.value })}>
        <option value="">Any field</option>
        {fields.map(field => <option key={field}>{field}</option>)}
      </select></label>
      <label>Contains <input value={filter.value} onChange={event => update({ value: event.target.value })} /></label>
      <label>Intersects area <select value={filter.area} onChange={event => update({ area: event.target.value })}>
        <option value="">Any area</option>
        {filter.area && !area && <option value={filter.area}>Area unavailable</option>}
        {areas.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select></label>
      <label>Corridor width from line (m)
        <input type="number" min={0} max={50000} step={50} disabled={!route && !filter.corridor} value={filter.corridor}
          onChange={event => update({ corridor: Math.max(0, Math.min(50000, Number(event.target.value) || 0)) })} />
      </label>
      <div className="geo-pin-desc" role="status">{matches.length} of {layer.data.features.length} features · Boundary contact counts as an intersection.</div>
      {route && estimateDetours && filter.corridor > 0 && !!matches.length && <div>
        <label>Maximum detour (minutes)
          <input type="number" min={0} max={120} value={detourLimit}
            onChange={event => setDetourLimit(Math.min(120, Math.max(0, Number(event.target.value) || 0)))} />
        </label>
        <button type="button" className="geo-mini-btn" disabled={checkingDetours} onClick={async () => {
          const candidates = matches.flatMap(({ feature, index }) => feature.geometry?.type === 'Point'
            ? [{ index, point: feature.geometry.coordinates, distance: pointDistance(feature.geometry.coordinates, route) }] : [])
            .sort((a, b) => a.distance - b.distance).slice(0, 3);
          setCheckingDetours(true);
          setDetourMessage('Checking the closest three points with the routing provider…');
          setDetours([]);
          try {
            const estimates = await estimateDetours(candidates.map(item => item.point));
            setDetours(estimates.flatMap((seconds, index) => seconds === null ? [] : [{
              route, filter, index: candidates[index].index, seconds
            }]).sort((a, b) => a.seconds - b.seconds));
            const checked = estimates.filter(value => value !== null).length;
            setDetourMessage(checked ? `Estimated ${checked} of ${candidates.length} candidate detours.` : 'No detour estimates available.');
          } catch { setDetourMessage('Detour routing is unavailable.'); }
          finally { setCheckingDetours(false); }
        }}>Check Detours</button>
        {detourMessage && <div role="status">{detourMessage}</div>}
        {detours.filter(item => item.route === route && item.filter === filter && item.seconds <= detourLimit * 60).map(item =>
          <button key={item.index} type="button" className="geo-mini-btn" onClick={() => onSelect(item.index)}>
            {attribute(layer.data.features[item.index].properties?.name) || `Feature ${item.index + 1}`} · +{(item.seconds / 60).toFixed(1)} min
          </button>)}
      </div>}
      <div className="geo-pin-actions">
        <button type="button" className="geo-mini-btn" onClick={() => update(emptySpatialFilter)}>Reset Filters</button>
        <button type="button" className="geo-mini-btn" disabled={!matches.length} onClick={() =>
          exportGeoJSON({ type: 'FeatureCollection', features: matches.map(item => item.feature) }, layer.name + '-matches.geojson')}>Export Matches as GeoJSON</button>
        <button type="button" className="geo-mini-btn" disabled={!matches.length} onClick={() => {
          const lines = [['_geometry_type', '_longitude', '_latitude', ...fields].map(csvCell).join(',')];
          for (const { feature } of matches) {
            const point = feature.geometry?.type === 'Point' ? feature.geometry.coordinates : [];
            lines.push([feature.geometry?.type, point[0], point[1], ...fields.map(field => feature.properties?.[field])].map(csvCell).join(','));
          }
          exportCsv(lines.join('\r\n'), layer.name + '-matches.csv');
        }}>Export Matches as CSV</button>
      </div>
      {!!matches.length && <div className="geo-feature-table">
        <table>
          <thead><tr><th>Feature</th><th>Geometry</th>{fields.slice(0, 3).map(field => <th key={field}>{field}</th>)}</tr></thead>
          <tbody>{matches.slice(visiblePage * 25, (visiblePage + 1) * 25).map(({ feature, index }) => (
            <tr key={index}>
              <td><button type="button" className="geo-mini-btn" aria-pressed={selection?.layerId === layer.id && selection.index === index}
                onClick={() => onSelect(index)}>{attribute(feature.properties?.name) || String(feature.id ?? index + 1)}</button></td>
              <td>{feature.geometry?.type || 'None'}</td>
              {fields.slice(0, 3).map(field => <td key={field}>{attribute(feature.properties?.[field])}</td>)}
            </tr>
          ))}</tbody>
        </table>
      </div>}
      {lastPage > 0 && <div className="geo-pin-actions">
        <button type="button" className="geo-mini-btn" disabled={visiblePage === 0} onClick={() => setPage(visiblePage - 1)}>Previous</button>
        <span>{visiblePage + 1} / {lastPage + 1}</span>
        <button type="button" className="geo-mini-btn" disabled={visiblePage === lastPage} onClick={() => setPage(visiblePage + 1)}>Next</button>
      </div>}
      {(selected?.geometry?.type === 'LineString' || selected?.geometry?.type === 'MultiLineString') &&
        <button type="button" className="geo-mini-btn" onClick={() => onUseLine(selected.geometry as CorridorLine)}>Use Line for Corridor</button>}
      {selected && <dl className="geo-feature-attributes">
        {Object.entries(selected.properties || {}).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{attribute(value) || '—'}</dd></div>)}
      </dl>}
    </section>
  );
}
