import { localApi } from './api';

export type BriefingFocus = 'all' | 'event' | 'departure';
export type TripMode = 'driving' | 'walking' | 'cycling';
export type BriefingPlace = { name: string; display_name: string; lat: number; lon: number };
export type BriefingEvent = {
  id: string;
  summary?: string;
  location: string;
  start: { dateTime: string; timeZone?: string };
  status?: string;
};
export type BriefingTrip = {
  origin: BriefingPlace;
  destination: BriefingPlace & { calendarTrip: BriefingEvent };
  mode: TripMode;
  arrivalBuffer: number;
};
export type BriefingTask = { id: string; title: string; due: number };

export function briefingFocus(text: string): BriefingFocus | undefined {
  const command = text.toLowerCase().replace(/[’']/g, '').replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ').trim().replace(/^(?:(?:hey|ok|okay) )?oracle /, '').replace(/^please /, '');
  if (command === 'brief me' || command === 'daily briefing') return 'all';
  if (command === 'whats next today' || command === 'what is next today') return 'event';
  if (command === 'when should i leave') return 'departure';
}

export function briefingGet<T>(path: string, signal: AbortSignal, timeout = 10000) {
  return localApi<T>(path, 'GET', undefined, AbortSignal.any([signal, AbortSignal.timeout(timeout)]));
}

export async function briefingPlaces(query: string, signal: AbortSignal) {
  const data = await briefingGet<{ results: BriefingPlace[] }>(
    'geo/search?limit=5&q=' + encodeURIComponent(query.trim().slice(0, 150)), signal
  );
  return data.results;
}

export function physicalLocation(event: BriefingEvent | undefined) {
  const location = event?.location?.trim() ?? '';
  return /^(?:https?:\/\/|www\.|online\b|virtual\b|zoom$|google meet$|microsoft teams$|remote$)/i.test(location)
    ? '' : location;
}

export async function briefingRoute(trip: BriefingTrip, signal: AbortSignal) {
  const { origin, destination, mode, arrivalBuffer } = trip;
  const params = new URLSearchParams({
    start_lat: String(origin.lat), start_lon: String(origin.lon),
    end_lat: String(destination.lat), end_lon: String(destination.lon), mode,
  });
  const route = await briefingGet<{
    status: string;
    duration_seconds: number;
    geometry?: { coordinates: [number, number][] };
  }>('geo/route?' + params, signal, 20000);
  if (route.status !== 'success' || !Number.isFinite(route.duration_seconds) || route.duration_seconds < 0) {
    throw new Error('Route unavailable');
  }
  return {
    minutes: Math.ceil(route.duration_seconds / 60),
    departure: Date.parse(destination.calendarTrip.start.dateTime) - route.duration_seconds * 1000 - arrivalBuffer * 60000,
    duration: route.duration_seconds * 1000,
    points: route.geometry?.coordinates ?? [],
  };
}

export async function briefingWeather(route: Awaited<ReturnType<typeof briefingRoute>>, signal: AbortSignal) {
  if (!route.points.length || route.departure <= Date.now()) return '';
  const points = [route.points[0], route.points[Math.floor(route.points.length / 2)], route.points.at(-1)!];
  const hour = (index: number) => Math.floor((route.departure + index * route.duration / 2) / 3600000) * 3600;
  const params = new URLSearchParams({
    latitude: points.map(point => point[1]).join(','),
    longitude: points.map(point => point[0]).join(','),
    timezone: 'GMT', timeformat: 'unixtime', forecast_days: '3', hourly: 'precipitation',
  });
  const response = await fetch('https://api.open-meteo.com/v1/forecast?' + params, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]),
  });
  if (!response.ok) throw new Error('Forecast unavailable');
  const forecasts: { hourly?: { time: number[]; precipitation: (number | null)[] } }[] = await response.json();
  const samples = forecasts.map(({ hourly }, index) => hourly?.precipitation[hourly.time.indexOf(hour(index))]);
  if (samples.length !== points.length || samples.some(value => value == null)) return '';
  return samples.some(value => (value ?? 0) > 0)
    ? 'Rain is forecast along the route.'
    : 'No rain is forecast at the sampled points along the route.';
}

