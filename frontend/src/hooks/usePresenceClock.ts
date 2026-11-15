import { useEffect, useState } from 'react';

const clockFormat = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const dateFormat = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short',
});

export function usePresenceClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let interval: number | undefined;
    const sync = () => {
      window.clearInterval(interval);
      if (document.hidden) return;
      setNow(new Date());
      interval = window.setInterval(() => setNow(new Date()), 1000);
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);
  return { time: clockFormat.format(now), dateStr: dateFormat.format(now).toUpperCase() };
}
