/**
 * ORACLE Weather Service
 * Real-time environmental telemetry with automatic GPS/IP geolocation
 * and user-configurable city search.
 */

export interface WeatherData {
  city: string;
  country?: string;
  latitude: number;
  longitude: number;
  temperature: number;
  feels_like: number;
  humidity: number;
  precipitation: number;
  condition: string;
  weather_code: number;
  timestamp: string;
}

let cachedWeather: WeatherData | null = null;
let lastFetchTime = 0;

const condMap: Record<number, string> = {
  0: 'Clear Sky',
  1: 'Mainly Clear',
  2: 'Partly Cloudy',
  3: 'Overcast',
  45: 'Foggy',
  48: 'Rime Fog',
  51: 'Light Drizzle',
  53: 'Moderate Drizzle',
  55: 'Dense Drizzle',
  61: 'Slight Rain',
  63: 'Moderate Rain',
  65: 'Heavy Rain',
  71: 'Slight Snow',
  73: 'Moderate Snow',
  75: 'Heavy Snow',
  80: 'Rain Showers',
  81: 'Moderate Showers',
  82: 'Violent Showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm w/ Hail',
  99: 'Severe Storm'
};

async function detectCoordinates(): Promise<{ lat: number; lon: number; city: string; country?: string }> {
  // 1. Check user manual override in localStorage
  const savedCity = localStorage.getItem('oracle_weather_city');
  const savedLat = localStorage.getItem('oracle_weather_lat');
  const savedLon = localStorage.getItem('oracle_weather_lon');
  if (savedLat && savedLon) {
    const lat = parseFloat(savedLat);
    const lon = parseFloat(savedLon);
    if (!isNaN(lat) && !isNaN(lon)) {
      return { lat, lon, city: savedCity || 'Local Station' };
    }
  }

  // 2. Try HTML5 Browser Geolocation (with fast timeout)
  if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          timeout: 3500,
          maximumAge: 300000,
          enableHighAccuracy: false
        });
      });
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      let city = 'Local Station';
      let country = '';

      // Reverse geocode to get city name
      try {
        const rev = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`, { signal: AbortSignal.timeout(3000) });
        if (rev.ok) {
          const revData = await rev.json();
          city = revData.city || revData.locality || revData.principalSubdivision || 'Local Station';
          country = revData.countryName || '';
        }
      } catch {
        // ignore reverse geocode error
      }

      return { lat, lon, city, country };
    } catch {
      // Browser geolocation denied or timed out; proceed to IP fallback
    }
  }

  // 3. Auto IP Geolocation Fallback
  try {
    const ipRes = await fetch('https://ipwho.is/', { signal: AbortSignal.timeout(3500) });
    if (ipRes.ok) {
      const ipData = await ipRes.json();
      if (ipData.success !== false && ipData.latitude && ipData.longitude) {
        return {
          lat: ipData.latitude,
          lon: ipData.longitude,
          city: ipData.city || ipData.region || 'Local Station',
          country: ipData.country || ''
        };
      }
    }
  } catch {
    // try secondary IP service
  }

  try {
    const ipRes2 = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(3500) });
    if (ipRes2.ok) {
      const ipData2 = await ipRes2.json();
      if (ipData2.latitude && ipData2.longitude) {
        return {
          lat: ipData2.latitude,
          lon: ipData2.longitude,
          city: ipData2.city || ipData2.region || 'Local Station',
          country: ipData2.country_name || ''
        };
      }
    }
  } catch {
    // fallback
  }

  // Safe fallback coordinates
  return { lat: 6.6858, lon: 80.4036, city: 'Local Station' };
}

export async function fetchCurrentWeather(forceRefresh = false): Promise<WeatherData> {
  const now = Date.now();
  if (!forceRefresh && cachedWeather && now - lastFetchTime < 300000) {
    return cachedWeather;
  }

  const loc = await detectCoordinates();

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code`;
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error('Weather fetch failed');
  const raw = await res.json();
  const curr = raw.current || {};
  const code = curr.weather_code || 0;

  const data: WeatherData = {
    city: loc.city,
    country: loc.country,
    latitude: loc.lat,
    longitude: loc.lon,
    temperature: Math.round(curr.temperature_2m ?? 26),
    feels_like: Math.round(curr.apparent_temperature ?? 27),
    humidity: Math.round(curr.relative_humidity_2m ?? 55),
    precipitation: curr.precipitation ?? 0,
    weather_code: code,
    condition: condMap[code] || 'Clear',
    timestamp: new Date().toISOString()
  };

  cachedWeather = data;
  lastFetchTime = now;
  return data;
}

export async function searchAndSetCity(query: string): Promise<WeatherData> {
  const q = query.trim();
  if (!q) throw new Error('Enter a valid city name');

  const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`;
  const res = await fetch(geoUrl, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error('City lookup failed');
  const geoData = await res.json();
  const result = geoData.results?.[0];
  if (!result) throw new Error(`No location found for "${q}"`);

  const lat = result.latitude;
  const lon = result.longitude;
  const city = result.name;

  localStorage.setItem('oracle_weather_city', city);
  localStorage.setItem('oracle_weather_lat', String(lat));
  localStorage.setItem('oracle_weather_lon', String(lon));

  return fetchCurrentWeather(true);
}

export async function resetToAutoLocation(): Promise<WeatherData> {
  localStorage.removeItem('oracle_weather_city');
  localStorage.removeItem('oracle_weather_lat');
  localStorage.removeItem('oracle_weather_lon');
  return fetchCurrentWeather(true);
}
