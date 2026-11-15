import { useEffect, useRef, useState, type FormEvent } from 'react';
import { briefingGet, briefingPlaces, briefingRoute, briefingWeather, physicalLocation,
  type BriefingEvent, type BriefingFocus, type BriefingPlace, type BriefingTask,
  type BriefingTrip, type TripMode } from '../utils/briefing';
import { speakWithKokoro } from '../utils/voice';
import './DailyBriefing.css';

type Request = { focus: BriefingFocus; speak: boolean };
const time = (value: string | number) => new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function DailyBriefing({ request, onClose, onOpenRoute, onCalendar }: {
  request: Request;
  onClose: () => void;
  onOpenRoute: (trip: BriefingTrip) => void;
  onCalendar: () => void;
}) {
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [calendarError, setCalendarError] = useState(false);
  const [taskError, setTaskError] = useState(false);
  const [event, setEvent] = useState<BriefingEvent>();
  const [tasks, setTasks] = useState<BriefingTask[]>([]);
  const [saved, setSaved] = useState<BriefingPlace[]>([]);
  const [destinations, setDestinations] = useState<BriefingPlace[]>([]);
  const [destination, setDestination] = useState<BriefingPlace>();
  const [checkingDevice, setCheckingDevice] = useState(false);
  const [origin, setOrigin] = useState<BriefingPlace>();
  const [originQuery, setOriginQuery] = useState('');
  const [origins, setOrigins] = useState<BriefingPlace[]>([]);
  const [startStatus, setStartStatus] = useState('');
  const [mode, setMode] = useState<TripMode>('driving');
  const [arrivalBuffer, setBuffer] = useState(10);
  const [route, setRoute] = useState<Awaited<ReturnType<typeof briefingRoute>>>();
  const [routeError, setRouteError] = useState(false);
  const [weather, setWeather] = useState('');
  const startRequest = useRef<AbortController | null>(null);
  const spoken = useRef<Request | null>(null);
  const location = physicalLocation(event);

  useEffect(() => () => startRequest.current?.abort(), []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setLoading(true);
    setEvent(undefined);
    setDestination(undefined);
    setDestinations([]);
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
    void Promise.allSettled([
      briefingGet<{ events: BriefingEvent[] }>('google/events?days=1', signal),
      briefingGet<{ tasks: BriefingTask[] }>('tasks', signal),
      briefingGet<{ places: BriefingPlace[] }>('geo/places', signal),
    ]).then(async ([calendar, reminders, places]) => {
      if (signal.aborted) return;
      setCalendarError(calendar.status === 'rejected');
      setTaskError(reminders.status === 'rejected');
      setTasks(reminders.status === 'fulfilled'
        ? reminders.value.tasks.filter(task => task.due < tomorrow).sort((a, b) => a.due - b.due) : []);
      setSaved(places.status === 'fulfilled' ? places.value.places : []);
      const next = calendar.status === 'fulfilled' ? calendar.value.events
        .filter(item => {
          const start = Date.parse(item.start?.dateTime);
          return item.status !== 'cancelled' && start >= now.getTime() && start < tomorrow;
        })
        .sort((a, b) => Date.parse(a.start.dateTime) - Date.parse(b.start.dateTime))[0] : undefined;
      setEvent(next);
      const address = physicalLocation(next);
      if (address) {
        const matches = await briefingPlaces(address, signal).catch(() => []);
        if (signal.aborted) return;
        setDestinations(matches);
        if (matches.length === 1) {
          setCheckingDevice(Boolean(navigator.geolocation && navigator.permissions));
          setDestination(matches[0]);
        }
      }
      setLoading(false);
    });
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    setRoute(undefined);
    setWeather('');
    setRouteError(false);
    if (!event || !origin || !destination) return;
    const controller = new AbortController();
    const { signal } = controller;
    void briefingRoute({ origin, destination: { ...destination, calendarTrip: event }, mode, arrivalBuffer }, signal)
      .then(result => {
        if (signal.aborted) return;
        setRoute(result);
        void briefingWeather(result, signal).then(note => {
          if (!signal.aborted) setWeather(note);
        }).catch(() => {});
      }).catch(() => {
        if (!signal.aborted) setRouteError(true);
      });
    return () => controller.abort();
  }, [event, origin, destination, mode, arrivalBuffer]);

  function selectOrigin(place: BriefingPlace) {
    startRequest.current?.abort();
    setCheckingDevice(false);
    setOrigin(place);
    setOrigins([]);
    setStartStatus('');
  }

  useEffect(() => {
    if (origin || !destination || !navigator.geolocation || !navigator.permissions) {
      setCheckingDevice(false);
      return;
    }
    let cancelled = false;
    setCheckingDevice(true);
    const finish = () => { if (!cancelled) setCheckingDevice(false); };
    void navigator.permissions.query({ name: 'geolocation' }).then(permission => {
      if (cancelled || permission.state !== 'granted') return finish();
      navigator.geolocation.getCurrentPosition(position => {
        finish();
        if (cancelled || position.coords.accuracy > 40 || Date.now() - position.timestamp > 15000) return;
        setOrigin(previous => previous ?? {
          name: 'Device location', display_name: 'Device location',
          lat: position.coords.latitude, lon: position.coords.longitude,
        });
      }, finish, { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 });
    }).catch(finish);
    return () => { cancelled = true; };
  }, [destination, origin, revision]);

  function locate() {
    startRequest.current?.abort();
    const controller = new AbortController();
    startRequest.current = controller;
    setStartStatus('Checking device location…');
    const unavailable = () => {
      if (!controller.signal.aborted) setStartStatus('Device location is unavailable or too approximate. Choose a saved place or search for a start.');
    };
    if (!navigator.geolocation) return unavailable();
    navigator.geolocation.getCurrentPosition(position => {
      if (controller.signal.aborted) return;
      if (position.coords.accuracy > 40 || Date.now() - position.timestamp > 15000) return unavailable();
      selectOrigin({ name: 'Device location', display_name: 'Device location',
        lat: position.coords.latitude, lon: position.coords.longitude });
    }, unavailable, { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 });
  }

  async function findStart(form: FormEvent) {
    form.preventDefault();
    if (!originQuery.trim()) return;
    startRequest.current?.abort();
    const controller = new AbortController();
    startRequest.current = controller;
    setOrigins([]);
    setStartStatus('Searching for a start…');
    try {
      const matches = await briefingPlaces(originQuery, controller.signal);
      if (controller.signal.aborted) return;
      setOrigins(matches);
      setStartStatus(matches.length ? 'Choose a starting point.' : 'No matching starting points.');
    } catch {
      if (!controller.signal.aborted) setStartStatus('Starting-point search is unavailable.');
    }
  }

  const eventText = calendarError ? 'Calendar unavailable.'
    : event ? `${event.summary || 'Your next event'} is at ${time(event.start.dateTime)}${location ? ` at ${location}` : ''}.`
      : 'No upcoming timed events today.';
  const lateMinutes = route ? Math.ceil((Date.now() - route.departure) / 60000) : 0;
  const departureText = route
    ? `${lateMinutes > 0 ? `You are ${lateMinutes} min past the suggested departure time of ${time(route.departure)}.`
      : `Leave by ${time(route.departure)}.`} Estimated travel is ${route.minutes} min with a ${arrivalBuffer} min arrival buffer.`
    : routeError ? 'Travel estimate unavailable.'
      : !location ? 'No departure estimate is available.'
        : !destination ? (destinations.length ? 'Choose the calendar destination.' : 'No map match for the calendar location.')
          : !origin ? 'Choose a starting point to estimate departure.' : 'Calculating departure…';
  const taskText = taskError ? 'Reminders unavailable.' : tasks.length
    ? `${tasks.length} reminder${tasks.length === 1 ? '' : 's'} due today or overdue.`
    : 'No reminders due today or overdue.';
  const speech = (request.focus === 'departure'
    ? [departureText, eventText, taskText] : [eventText, departureText, taskText])
    .filter(part => part !== 'Calculating departure…' && (location || request.focus === 'departure' || part !== departureText))
    .concat(weather || []).join(' ');
  useEffect(() => {
    if (loading || checkingDevice || !request.speak || spoken.current === request || (origin && destination && !route && !routeError)) return;
    spoken.current = request;
    speakWithKokoro(speech, { allowBargeIn: true });
  }, [request, loading, checkingDevice, speech, origin, destination, route, routeError]);

  return (
    <section className="oracle-briefing" aria-label="Daily briefing">
      <header><h2>Daily briefing</h2><button type="button" onClick={onClose}>Close</button></header>
      {loading ? <p role="status">Preparing your briefing…</p> : <>
        <div className="oracle-briefing-summary" aria-live="polite">
          {request.focus === 'departure' && <p>{departureText}</p>}
          <p>{eventText}</p>
          {calendarError && <button type="button" onClick={onCalendar}>Calendar settings</button>}
          {location && request.focus !== 'departure' && <p>{departureText}</p>}
          {weather && <p>{weather}</p>}
          <p>{taskText}</p>
          {tasks.length > 0 && <ul>{tasks.slice(0, 3).map(task => (
            <li key={task.id}>{task.title} · {task.due < Date.now() ? 'Overdue' : time(task.due)}</li>
          ))}{tasks.length > 3 && <li>+{tasks.length - 3} more</li>}</ul>}
        </div>
        {location && destinations.length > 1 && <div aria-label="Calendar destinations">
          {destinations.map((place, index) => <button key={index} type="button" aria-pressed={destination === place}
            onClick={() => setDestination(place)}>{place.display_name}</button>)}
        </div>}
        {destination && <>
          <p>Start: {origin?.name ?? 'Choose a starting point'}</p>
          <div className="oracle-briefing-actions">
            <button type="button" onClick={locate}>Use device location</button>
            {saved.length > 0 && <label>Saved start <select value="" onChange={e => selectOrigin(saved[Number(e.target.value)])}>
              <option value="" disabled>Choose a place</option>
              {saved.map((place, index) => <option value={index} key={index}>{place.name}</option>)}
            </select></label>}
          </div>
          <form onSubmit={findStart} className="oracle-briefing-actions">
            <input aria-label="Search for a starting point" placeholder="Search for a start" value={originQuery}
              onChange={e => setOriginQuery(e.target.value)} />
            <button type="submit">Search</button>
          </form>
          {startStatus && <p role="status">{startStatus}</p>}
          {origins.map((place, index) => <button key={index} type="button" onClick={() => selectOrigin(place)}>{place.display_name}</button>)}
          <div className="oracle-briefing-actions">
            <label>Travel mode <select value={mode} onChange={e => setMode(e.target.value as TripMode)}>
              <option value="driving">Driving</option><option value="walking">Walking</option><option value="cycling">Cycling</option>
            </select></label>
            <label>Arrival buffer (min) <input type="number" min={0} max={120} value={arrivalBuffer}
              onChange={e => setBuffer(Math.min(120, Math.max(0, Number(e.target.value))))} /></label>
          </div>
        </>}
        <footer className="oracle-briefing-actions">
          <button type="button" onClick={() => {
            if (origin?.name === 'Device location') setOrigin(undefined);
            setRevision(value => value + 1);
          }}>Refresh</button>
          <button type="button" onClick={() => speakWithKokoro(speech, { allowBargeIn: true })}>Read aloud</button>
          {event && origin && destination && <button type="button" onClick={() => onOpenRoute({
            origin, destination: { ...destination, calendarTrip: event }, mode, arrivalBuffer,
          })}>Open route in Atlas</button>}
        </footer>
      </>}
    </section>
  );
}
