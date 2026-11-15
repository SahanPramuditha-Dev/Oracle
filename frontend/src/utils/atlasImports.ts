import type { Feature, FeatureCollection, Geometry, Position } from 'geojson';

const geoTypes = new Set(['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection']);

function validGeometry(geometry: Geometry, depth = 0): boolean {
  if (!geometry || depth > 16) return false;
  const point = (value: unknown): value is Position =>
    Array.isArray(value) && value.length >= 2 && value.every(Number.isFinite) &&
    Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;
  const line = (value: unknown): value is Position[] => Array.isArray(value) && value.length >= 2 && value.every(point);
  const ring = (value: unknown): value is Position[] => {
    if (!line(value) || value.length < 4) return false;
    const last = value[value.length - 1];
    return value[0][0] === last[0] && value[0][1] === last[1];
  };
  const list = (value: unknown, check: (entry: unknown) => boolean) =>
    Array.isArray(value) && value.length > 0 && value.every(check);
  const polygon = (value: unknown) => list(value, ring);
  switch (geometry.type) {
    case 'Point': return point(geometry.coordinates);
    case 'MultiPoint': return list(geometry.coordinates, point);
    case 'LineString': return line(geometry.coordinates);
    case 'MultiLineString': return list(geometry.coordinates, line);
    case 'Polygon': return polygon(geometry.coordinates);
    case 'MultiPolygon': return list(geometry.coordinates, polygon);
    case 'GeometryCollection': return list(geometry.geometries, value => validGeometry(value as Geometry, depth + 1));
    default: return false;
  }
}

export function normalizeGeoJSON(value: unknown): FeatureCollection {
  if (!value || typeof value !== 'object' || !('type' in value)) throw new Error('Expected GeoJSON');
  const features = value.type === 'FeatureCollection' ? (value as FeatureCollection).features
    : value.type === 'Feature' ? [value as Feature]
    : geoTypes.has(String(value.type)) ? [{ type: 'Feature' as const, geometry: value as Geometry, properties: {} }] : [];
  if (!Array.isArray(features) || !features.length || features.length > 25000 || features.some(feature =>
    feature?.type !== 'Feature' || (feature.geometry !== null && !validGeometry(feature.geometry)) ||
    (feature.properties != null && (typeof feature.properties !== 'object' || Array.isArray(feature.properties))))) {
    throw new Error('Expected up to 25,000 features with valid WGS84 geometry and attributes');
  }
  return { type: 'FeatureCollection', features };
}

function rowsFromCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const character = text[i];
    if (quoted) {
      if (character === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"' && !field) quoted = true;
    else if (character === ',') { row.push(field); field = ''; }
    else if (character === '\r' || character === '\n') {
      row.push(field);
      if (row.some(cell => cell.trim())) rows.push(row);
      row = [];
      field = '';
      if (character === '\r' && text[i + 1] === '\n') i += 1;
    } else field += character;
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted field');
  row.push(field);
  if (row.some(cell => cell.trim())) rows.push(row);
  return rows;
}

export function parseAtlasCsv(text: string) {
  const [headers, ...rows] = rowsFromCsv(text.replace(/^\uFEFF/, ''));
  if (!headers || headers.length < 2 || !rows.length) throw new Error('CSV needs headers and at least one data row');
  const fields = headers.map(field => field.trim());
  if (fields.some(field => !field) || new Set(fields).size !== fields.length) throw new Error('CSV headers must be non-empty and unique');
  return { fields, rows };
}

export function atlasCsvFeatures(data: ReturnType<typeof parseAtlasCsv>, longitude: string, latitude: string) {
  const lonIndex = data.fields.indexOf(longitude);
  const latIndex = data.fields.indexOf(latitude);
  if (lonIndex < 0 || latIndex < 0 || lonIndex === latIndex) throw new Error('Choose separate longitude and latitude columns');
  const features = data.rows.map((row, index): Feature => {
    const lon = row[lonIndex]?.trim();
    const lat = row[latIndex]?.trim();
    if (!lon || !lat || !Number.isFinite(Number(lon)) || !Number.isFinite(Number(lat)) ||
        Math.abs(Number(lon)) > 180 || Math.abs(Number(lat)) > 90) throw new Error(`Invalid coordinates in data row ${index + 1}`);
    return {
      type: 'Feature', geometry: { type: 'Point', coordinates: [Number(lon), Number(lat)] },
      properties: Object.fromEntries(data.fields.map((field, column) => [field, row[column] ?? '']))
    };
  });
  return normalizeGeoJSON({ type: 'FeatureCollection', features });
}

export function parseAtlasXml(text: string, format: 'kml' | 'gpx'): FeatureCollection {
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  if (xml.querySelector('parsererror') || xml.documentElement.localName.toLowerCase() !== format) throw new Error(`Invalid ${format.toUpperCase()} file`);
  const elements = (root: Document | Element, name: string) => [...root.getElementsByTagNameNS('*', name)];
  const children = (root: Element, name: string) => [...root.children].filter(element => element.localName === name);
  const nameOf = (element: Element) => children(element, 'name')[0]?.textContent?.trim() || '';
  const kmlCoordinates = (element: Element) =>
    (elements(element, 'coordinates')[0]?.textContent?.trim() || '').split(/\s+/).filter(Boolean).map(tuple => tuple.split(',').map(Number));
  const gpxCoordinates = (element: Element): Position => {
    const lon = element.getAttribute('lon');
    const lat = element.getAttribute('lat');
    return [lon?.trim() ? Number(lon) : NaN, lat?.trim() ? Number(lat) : NaN];
  };
  const features: Feature[] = [];
  const add = (name: string, geometry: Geometry) => features.push({ type: 'Feature', geometry, properties: { name } });
  if (format === 'kml') {
    for (const placemark of elements(xml, 'Placemark')) {
      for (const point of elements(placemark, 'Point')) add(nameOf(placemark), { type: 'Point', coordinates: kmlCoordinates(point)[0] || [] });
      for (const line of elements(placemark, 'LineString')) add(nameOf(placemark), { type: 'LineString', coordinates: kmlCoordinates(line) });
      for (const polygon of elements(placemark, 'Polygon')) {
        const rings = [...children(polygon, 'outerBoundaryIs'), ...children(polygon, 'innerBoundaryIs')];
        add(nameOf(placemark), { type: 'Polygon', coordinates: rings.map(kmlCoordinates) });
      }
    }
  } else {
    for (const point of elements(xml, 'wpt')) add(nameOf(point), { type: 'Point', coordinates: gpxCoordinates(point) });
    for (const route of elements(xml, 'rte')) add(nameOf(route), { type: 'LineString', coordinates: elements(route, 'rtept').map(gpxCoordinates) });
    for (const track of elements(xml, 'trk')) add(nameOf(track), {
      type: 'MultiLineString', coordinates: children(track, 'trkseg').map(segment => elements(segment, 'trkpt').map(gpxCoordinates))
    });
  }
  return normalizeGeoJSON({ type: 'FeatureCollection', features });
}
