import { useEffect, useState } from 'react';

export interface AtlasReminder {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radius: number;
}

const storageKey = 'oracle_atlas_reminders';

export function useAtlasReminders(onArrival: (name: string, radius: number, reminder: AtlasReminder) => void) {
  const [reminders, setReminders] = useState<AtlasReminder[]>(() => {
    try {
      const data = JSON.parse(localStorage.getItem(storageKey) || '[]');
      return Array.isArray(data) ? data.filter(item => typeof item?.id === 'string' &&
        typeof item.name === 'string' && Number.isFinite(item.lat) &&
        Number.isFinite(item.lon) && Number.isFinite(item.radius) && item.radius > 0) : [];
    } catch {
      return [];
    }
  });
  const [monitoring, setMonitoring] = useState(false);
  const [error, setError] = useState('');

  const save = (next: AtlasReminder[]) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setReminders(next);
      setError('');
    } catch {
      setError('Could not save location reminders on this device.');
    }
  };

  useEffect(() => {
    if (!monitoring || !reminders.length) return;
    if (!navigator.geolocation) {
      setError('Device location is unavailable.');
      setMonitoring(false);
      return;
    }
    const wasInside = new Map<string, boolean>();
    const radians = Math.PI / 180;
    const watch = navigator.geolocation.watchPosition(({ coords }) => {
      setError('');
      for (const reminder of reminders) {
        const deltaLat = (coords.latitude - reminder.lat) * radians;
        const deltaLon = (coords.longitude - reminder.lon) * radians;
        const chord = Math.sin(deltaLat / 2) ** 2 + Math.sin(deltaLon / 2) ** 2 *
          Math.cos(coords.latitude * radians) * Math.cos(reminder.lat * radians);
        const distance = 12742000 * Math.asin(Math.sqrt(Math.min(1, chord)));
        const effectiveRadius = reminder.radius + Math.min(coords.accuracy || 0, 50);
        if (distance <= effectiveRadius) {
          if (wasInside.get(reminder.id) !== true) {
            onArrival(reminder.name, reminder.radius, reminder);
          }
          wasInside.set(reminder.id, true);
        } else if (distance > effectiveRadius + 20) {
          wasInside.set(reminder.id, false);
        }
      }
    }, failure => {
      setError(failure.code === 1 ? 'Location permission was denied.' : 'Waiting for a device location fix.');
      if (failure.code === 1) setMonitoring(false);
    }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 });
    return () => navigator.geolocation.clearWatch(watch);
  }, [monitoring, reminders, onArrival]);

  return { reminders, save, monitoring, setMonitoring, error };
}
