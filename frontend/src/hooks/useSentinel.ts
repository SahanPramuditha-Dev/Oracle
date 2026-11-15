import { useEffect, useState } from 'react';

export function useSentinel(active: boolean, camera: string, microphone: string, administrator: boolean) {
  const [permissions, setPermissions] = useState({ camera: 'Unknown', microphone: 'Unknown' });
  const [events, setEvents] = useState<string[]>([]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const cleanups: (() => void)[] = [];
    setPermissions({ camera: 'Unknown', microphone: 'Unknown' });
    for (const name of ['camera', 'microphone'] as const) {
      void navigator.permissions?.query({ name: name as PermissionName }).then(status => {
        if (cancelled) return;
        const update = () => setPermissions(previous => ({ ...previous, [name]: status.state }));
        update();
        status.addEventListener('change', update);
        cleanups.push(() => status.removeEventListener('change', update));
      }).catch(() => {});
    }
    return () => {
      cancelled = true;
      cleanups.forEach(cleanup => cleanup());
    };
  }, [active]);

  useEffect(() => {
    if (!active) {
      setEvents([]);
      return;
    }
    const snapshot = `Camera ${camera} (permission ${permissions.camera}) · Microphone ${microphone} (permission ${permissions.microphone}) · Admin clearance ${administrator ? 'active' : 'inactive'}`;
    setEvents(previous => previous[0] === snapshot ? previous : [snapshot, ...previous].slice(0, 8));
  }, [active, camera, microphone, permissions, administrator]);

  return events;
}
