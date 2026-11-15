import React, { useState, useEffect, useRef } from 'react';
import { CloudSun, Droplets, Compass, CloudRain, Sun, Cloud, X, MapPin, Check, LocateFixed } from 'lucide-react';
import { fetchCurrentWeather, searchAndSetCity, resetToAutoLocation, type WeatherData } from '../utils/weather';
import { PresenceCard } from './PresenceCard';
import './WeatherPanel.css';

interface WeatherPanelProps {
  onWeatherLoaded?: (data: WeatherData) => void;
  onClose?: () => void;
  pinned?: boolean;
  onTogglePin?: () => void;
}

export const WeatherPanel: React.FC<WeatherPanelProps> = ({ onWeatherLoaded, onClose, pinned, onTogglePin }) => {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [cityInput, setCityInput] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [refreshFailed, setRefreshFailed] = useState(false);
  const cityButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  const locationBusy = useRef(false);
  const locationVersion = useRef(0);

  useEffect(() => {
    let active = true;
    let refreshing = false;

    const refresh = async () => {
      if (document.hidden || locationBusy.current || refreshing) return;
      refreshing = true;
      const version = locationVersion.current;
      try {
        const data = await fetchCurrentWeather();
        if (!active || version !== locationVersion.current) return;
        setWeather(data);
        setRefreshFailed(false);
        onWeatherLoaded?.(data);
      } catch {
        if (active && version === locationVersion.current) setRefreshFailed(true);
      } finally {
        refreshing = false;
        if (active && version === locationVersion.current) setLoading(false);
      }
    };

    void refresh();
    const refreshVisible = () => { void refresh(); };
    const interval = window.setInterval(refreshVisible, 60_000);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [onWeatherLoaded]);

  useEffect(() => {
    if (wasEditing.current && !isEditing) cityButton.current?.focus();
    wasEditing.current = isEditing;
  }, [isEditing]);

  const handleSearchSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!cityInput.trim()) {
      setIsEditing(false);
      return;
    }
    if (locationBusy.current) return;
    locationBusy.current = true;
    locationVersion.current += 1;
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await searchAndSetCity(cityInput);
      setWeather(data);
      setRefreshFailed(false);
      onWeatherLoaded?.(data);
      setIsEditing(false);
      setCityInput('');
    } catch (err: any) {
      setErrorMsg(err?.message || 'City not found');
    } finally {
      locationBusy.current = false;
      setLoading(false);
    }
  };

  const handleResetLocation = async () => {
    if (locationBusy.current) return;
    locationBusy.current = true;
    locationVersion.current += 1;
    setLoading(true);
    setErrorMsg(null);
    setIsEditing(false);
    try {
      const data = await resetToAutoLocation();
      setWeather(data);
      setRefreshFailed(false);
      onWeatherLoaded?.(data);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Auto-detection failed');
    } finally {
      locationBusy.current = false;
      setLoading(false);
    }
  };

  const getWeatherIcon = (code?: number) => {
    if (code === undefined) return <CloudSun size={20} color="#cfe2f7" />;
    if (code === 0 || code === 1) return <Sun size={20} color="#f59e0b" />;
    if (code === 2) return <CloudSun size={20} color="#cfe2f7" />;
    if (code >= 51 && code <= 82) return <CloudRain size={20} color="#9db4d3" />;
    return <Cloud size={20} color="#9db4d3" />;
  };

  const updateKey = weather && JSON.stringify([
    weather.temperature, weather.weather_code, weather.feels_like, weather.humidity, weather.precipitation,
  ]);

  return (
    <PresenceCard title="Local Conditions" icon={<Compass size={14} />}
      pinned={pinned} onTogglePin={onTogglePin} onClose={onClose}
      holdOpen={isEditing || loading} delay={0.07} updateKey={updateKey ?? undefined}
    >
      {weather ? (
        <>
          <div className="weather-main-row">
            <div className="weather-temp-block">
              <span key={weather.temperature} className="weather-temp-digits presence-value-change">{weather.temperature}</span>
              <span className="weather-temp-unit">°C</span>
            </div>

            <div className="weather-cond-badge">
              <div key={weather.weather_code} className="weather-condition presence-value-change">
                {getWeatherIcon(weather.weather_code)}
                <span className="weather-condition-text">{weather.condition}</span>
              </div>
              <span key={weather.feels_like} className="weather-feels-like presence-value-change">
                Feels like {weather.feels_like}°C
              </span>
            </div>
          </div>

          <div className="weather-metrics-grid">
            <div className="weather-metric-cell">
              <span className="metric-key">Humidity</span>
              <span key={weather.humidity} className="metric-val presence-value-change">
                <Droplets size={12} />
                {weather.humidity}%
              </span>
            </div>
            <div className="weather-metric-cell">
              <span className="metric-key">Precipitation</span>
              <span key={weather.precipitation} className="metric-val presence-value-change">
                <CloudRain size={12} />
                {weather.precipitation} mm
              </span>
            </div>
          </div>
        </>
      ) : (
        <div className="weather-status" role="status">
          {loading ? 'Checking local conditions…' : 'Weather unavailable.'}
        </div>
      )}
      <div className="weather-footer">
        {isEditing ? (
          <form onSubmit={handleSearchSubmit} className="weather-location-controls">
            <input
              type="text"
              autoFocus
              placeholder="City name"
              aria-label="City name"
              value={cityInput}
              onChange={(e) => setCityInput(e.target.value)}
              className="weather-city-input"
            />
            <button
              type="submit"
              className="weather-btn-icon"
              title="Apply city"
            >
              <Check size={11} color="#4ade80" />
            </button>
            <button
              type="button"
              className="weather-btn-icon"
              onClick={() => { setIsEditing(false); setErrorMsg(null); }}
              title="Cancel"
            >
              <X size={11} color="#94a3b8" />
            </button>
          </form>
        ) : (
          <div className="weather-location-controls">
            <button
              type="button"
              className="weather-city-badge-btn"
              ref={cityButton}
              onClick={() => { setIsEditing(true); setCityInput(weather?.city || ''); }}
              title="Change city"
            >
              <MapPin size={9} style={{ opacity: 0.7 }} />
              <span>{weather?.city?.toUpperCase() || 'LOCAL STATION'}</span>
            </button>
            <button
              type="button"
              className="weather-btn-icon"
              onClick={handleResetLocation}
              title="Use automatic location"
            >
              <LocateFixed size={11} color="#60a5fa" />
            </button>
          </div>
        )}
        {weather && (
          <div className="weather-update-footer">
            {refreshFailed ? 'Refresh failed · Last reading ' : 'Updated '}
            <time dateTime={weather.timestamp}>
              {new Date(weather.timestamp).toLocaleString([], { hour: 'numeric', minute: '2-digit' })}
            </time>
          </div>
        )}
      </div>
      {errorMsg && <div className="weather-error" role="alert">{errorMsg}</div>}
    </PresenceCard>
  );
};
