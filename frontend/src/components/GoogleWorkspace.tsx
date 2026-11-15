import { OracleSelect } from './OracleSelect';
import { useEffect, useMemo, useRef, useState } from 'react';
import { localApi } from '../utils/api';
import { Globe, Calendar, CheckSquare, Link2, Unlink, RefreshCw, ChevronLeft, ChevronRight, CalendarDays, X } from 'lucide-react';

type Status = {
  configured: boolean;
  connected: boolean;
  signed_in?: boolean;
  account?: { email: string } | null;
  offline_access: boolean;
  project_id?: string;
  redirect_uri: string;
  notice?: string;
  privacy_url?: string | null;
};

type CalendarType = { id: string; summary: string; accessRole: string };
type List = { id: string; title: string };
type Event = { id: string; summary: string; start?: { dateTime?: string; date?: string } };
type Task = { id: string; title: string; status: string; due?: string };
type Reminder = { id: string; title: string; due: number; kind: string };

function localTime(value: number) {
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function formatYMD(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function GoogleWorkspace({ connectionOnly = false, initialOverdueOnly = false }: { connectionOnly?: boolean; initialOverdueOnly?: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState('Checking Google connection…');
  const [busy, setBusy] = useState(false);
  const [calendars, setCalendars] = useState<CalendarType[]>([]);
  const [lists, setLists] = useState<List[]>([]);
  const [calendar, setCalendar] = useState('primary');
  const [list, setList] = useState('@default');
  const [events, setEvents] = useState<Event[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [minutes, setMinutes] = useState('10');
  const [taskTitle, setTaskTitle] = useState('');
  const [date, setDate] = useState('');
  const operation = useRef(crypto.randomUUID().replaceAll('-', ''));
  const active = useRef(true);
  const flight = useRef(false);
  const pending = useRef(new AbortController());
  const signIn = useRef<AbortController | null>(null);
  const popupRef = useRef<Window | null>(null);
  const signInState = useRef<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  const eventPath = `google/events?calendar_id=${encodeURIComponent(calendar)}`;
  const tasksPath = `google/tasks?tasklist_id=${encodeURIComponent(list)}`;

  const calendarDays = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();

    const firstDayOfMonth = new Date(year, month, 1);
    const startingDayOfWeek = firstDayOfMonth.getDay();

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const todayStr = formatYMD(new Date());

    const eventCounts: Record<string, number> = {};
    for (const ev of events) {
      const d = ev.start?.dateTime ? ev.start.dateTime.slice(0, 10) : ev.start?.date;
      if (d) eventCounts[d] = (eventCounts[d] || 0) + 1;
    }

    const taskCounts: Record<string, number> = {};
    for (const t of tasks) {
      const d = t.due ? t.due.slice(0, 10) : null;
      if (d) taskCounts[d] = (taskCounts[d] || 0) + 1;
    }

    const days: Array<{
      dateStr: string;
      dayNum: number;
      isCurrentMonth: boolean;
      isToday: boolean;
      eventsCount: number;
      tasksCount: number;
    }> = [];

    for (let i = startingDayOfWeek - 1; i >= 0; i--) {
      const dNum = daysInPrevMonth - i;
      const prevDate = new Date(year, month - 1, dNum);
      const dStr = formatYMD(prevDate);
      days.push({
        dateStr: dStr,
        dayNum: dNum,
        isCurrentMonth: false,
        isToday: dStr === todayStr,
        eventsCount: eventCounts[dStr] || 0,
        tasksCount: taskCounts[dStr] || 0
      });
    }

    for (let i = 1; i <= daysInMonth; i++) {
      const curDate = new Date(year, month, i);
      const dStr = formatYMD(curDate);
      days.push({
        dateStr: dStr,
        dayNum: i,
        isCurrentMonth: true,
        isToday: dStr === todayStr,
        eventsCount: eventCounts[dStr] || 0,
        tasksCount: taskCounts[dStr] || 0
      });
    }

    const totalSlots = days.length <= 35 ? 35 : 42;
    const remaining = totalSlots - days.length;
    for (let i = 1; i <= remaining; i++) {
      const nextDate = new Date(year, month + 1, i);
      const dStr = formatYMD(nextDate);
      days.push({
        dateStr: dStr,
        dayNum: i,
        isCurrentMonth: false,
        isToday: dStr === todayStr,
        eventsCount: eventCounts[dStr] || 0,
        tasksCount: taskCounts[dStr] || 0
      });
    }

    return days;
  }, [calendarMonth, events, tasks]);

  const displayedEvents = useMemo(() => {
    if (!selectedDate) return events;
    return events.filter(e => (e.start?.dateTime ? e.start.dateTime.slice(0, 10) === selectedDate : e.start?.date === selectedDate));
  }, [events, selectedDate]);

  const [overdueOnly, setOverdueOnly] = useState(initialOverdueOnly);
  const displayedTasks = useMemo(() => {
    const now = new Date();
    const today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
    return tasks.filter(task => {
      const due = task.due?.slice(0, 10);
      if (overdueOnly) return due && due < today && task.status !== 'completed';
      return !selectedDate || due === selectedDate;
    });
  }, [tasks, selectedDate, overdueOnly]);

  const handleSelectDay = (dStr: string) => {
    if (selectedDate === dStr) {
      setSelectedDate(null);
    } else {
      setSelectedDate(dStr);
      setStart(`${dStr}T09:00`);
      setEnd(`${dStr}T10:00`);
      setDate(dStr);
    }
  };

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      pending.current.abort();
      signIn.current?.abort();
      popupRef.current?.close();
    };
  }, []);

  async function run(action: () => Promise<void>) {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setMessage('Working…');
    try {
      await action();
    } catch (error) {
      if (active.current) setMessage(String(error));
    } finally {
      flight.current = false;
      if (active.current) setBusy(false);
    }
  }

  const notifyGoogleRecordsChanged = () => {
    window.dispatchEvent(new Event('oracle_google_records_changed'));
  };

  async function load() {
    const state = await localApi<Status>('google/status', 'GET', undefined, pending.current.signal);
    if (!active.current) return;
    setStatus(state);
    if (!state.connected) {
      setEvents([]);
      setTasks([]);
      setCalendars([]);
      setLists([]);
      notifyGoogleRecordsChanged();
      setMessage(state.notice || (state.configured ? 'Ready to connect.' : 'Google OAuth setup required.'));
      return;
    }
    if (connectionOnly) {
      setMessage('Google connected. Manage calendars and tasks in Workspace → Google.');
      return;
    }
    const [c, l, r] = await Promise.all([
      localApi<{ calendars: CalendarType[]; more: boolean }>('google/calendars', 'GET', undefined, pending.current.signal).catch(() => ({ calendars: [], more: false })),
      localApi<{ tasklists: List[]; more: boolean }>('google/tasklists', 'GET', undefined, pending.current.signal).catch(() => ({ tasklists: [], more: false })),
      localApi<{ tasks: Reminder[] }>('tasks', 'GET', undefined, pending.current.signal).catch(() => ({ tasks: [] }))
    ]);
    if (!active.current) return;
    setCalendars(c.calendars || []);
    setLists(l.tasklists || []);
    setReminders((r.tasks || []).filter(item => item.kind === 'reminder'));

    // Automatically fetch events and tasks upon loading
    try {
      const [e, t] = await Promise.all([
        localApi<{ events: Event[]; more: boolean }>(eventPath, 'GET', undefined, pending.current.signal),
        localApi<{ tasks: Task[]; more: boolean }>(tasksPath, 'GET', undefined, pending.current.signal)
      ]);
      if (active.current) {
        setEvents(e.events || []);
        setTasks(t.tasks || []);
        notifyGoogleRecordsChanged();
        setMessage(`Google connected. Events and tasks loaded.${e.more || t.more ? ' More items are available in Google.' : ''}`);
      }
    } catch {
      if (active.current) {
        setMessage(`Google connected. Click "Load Google events & tasks" to refresh.`);
      }
    }
  }

  const initialSelection = useRef(true);
  useEffect(() => {
    if (initialSelection.current) {
      initialSelection.current = false;
      return;
    }
    if (status?.connected && !connectionOnly) {
      void run(refreshItems);
    }
  }, [calendar, list]);

  useEffect(() => {
    void run(load);
  }, []);

  async function refreshItems() {
    const [e, t] = await Promise.all([
      localApi<{ events: Event[]; more: boolean }>(eventPath, 'GET', undefined, pending.current.signal),
      localApi<{ tasks: Task[]; more: boolean }>(tasksPath, 'GET', undefined, pending.current.signal)
    ]);
    if (!active.current) return;
    setEvents(e.events || []);
    setTasks(t.tasks || []);
    notifyGoogleRecordsChanged();
    setMessage(`Refreshed Google events and tasks.${e.more || t.more ? ' Showing the first 100 results; more items are available in Google.' : ''}`);
  }

  async function finishSignIn(popup: Window, controller: AbortController) {
    const deadline = Date.now() + 600000;
    while (active.current && !controller.signal.aborted && Date.now() < deadline) {
      const state = await localApi<Status>('google/status', 'GET', undefined, controller.signal);
      if (state.signed_in && state.connected) {
        popup.close();
        await load().catch(() => {});
        if (!connectionOnly) await refreshItems().catch(() => {});
        if (active.current) setMessage(`Signed in as ${state.account?.email || 'your Google account'}. Calendar and Tasks are connected.`);
        return;
      }
      await new Promise<void>(resolve => {
        const done = () => {
          clearTimeout(timer);
          controller.signal.removeEventListener('abort', done);
          resolve();
        };
        const timer = setTimeout(done, 1500);
        controller.signal.addEventListener('abort', done, { once: true });
      });
    }
    if (active.current) setMessage(controller.signal.aborted ? 'Google sign-in cancelled.' : 'Google sign-in expired. Please try again.');
  }

  return (
    <section className="google-workspace" aria-label="Google Calendar and Tasks">
      {/* 0. Disconnected Setup View */}
      {!status?.connected && (
        <div className="workspace-card">
          <div className="workspace-card-header">
            <div className="workspace-card-header-left">
              <Globe size={12} />
              <span>Google Calendar & Tasks</span>
            </div>
            <span className="workspace-badge tag">Disconnected</span>
          </div>

          <p>Project: {status?.project_id || 'not configured'}. Google data is read on request. Nothing is synchronized automatically.</p>
          <p>
            Google sign-in confirms your account email and enables the Calendar/Tasks permissions you approve. Identity and tokens are stored encrypted for this Windows user. Google records from this connector are not sent to AI models or used for advertising. Disconnect removes the stored connection; it does not delete Google events or tasks.{' '}
            {status?.privacy_url && (
              <a href={status.privacy_url} target="_blank" rel="noopener noreferrer">
                Read the privacy policy
              </a>
            )}
          </p>

          <p role="status" className="workspace-status-text">{message}</p>

          <div className="workspace-btn-row">
            <button className="workspace-btn secondary" disabled={busy} onClick={() => void run(load)}>
              <RefreshCw size={11} className={busy ? 'animate-spin' : ''} />
              Refresh Google connection
            </button>

            {!status?.signed_in && (
              <button
                className="workspace-btn primary"
                disabled={busy || !status?.configured}
                onClick={() => {
                  const popup = window.open('about:blank', 'oracle-google-connect', 'popup,width=560,height=720');
                  if (popup) popup.opener = null;
                  if (!popup) {
                    setMessage('Allow popups for ORACLE, then sign in again.');
                    return;
                  }
                  popupRef.current = popup;
                  signInState.current = null;
                  const controller = new AbortController();
                  signIn.current = controller;
                  setSigningIn(true);
                  void run(async () => {
                    try {
                      const data = await localApi<{ url: string }>('google/connect', 'POST', undefined, controller.signal);
                      signInState.current = new URL(data.url).searchParams.get('state');
                      popup.location.href = data.url;
                      setMessage('Choose your Google account and approve Calendar and Tasks access. This view will update automatically.');
                      await finishSignIn(popup, controller);
                    } catch (error) {
                      if (controller.signal.aborted) {
                        if (active.current) setMessage('Google sign-in cancelled.');
                      } else throw error;
                    } finally {
                      popup.close();
                      popupRef.current = null;
                      signIn.current = null;
                      if (active.current) setSigningIn(false);
                    }
                  });
                }}
              >
                <Link2 size={11} />
                Sign in with Google
              </button>
            )}

            {signingIn && (
              <button
                className="workspace-btn danger"
                onClick={() => {
                  signIn.current?.abort();
                  popupRef.current?.close();
                  void localApi('google/cancel-sign-in', 'POST', { state: signInState.current }).catch(() => {
                    if (active.current) setMessage('Sign-in closed locally. Start a new sign-in to replace the old request.');
                  });
                }}
              >
                Cancel Google sign-in
              </button>
            )}
          </div>

          {!status?.configured && (
            <p>
              Enable Calendar API and Tasks API in this project, then place the web OAuth client file in backend/google-client.json. Authorized redirect:{' '}
              {status?.redirect_uri || 'http://127.0.0.1:8000/api/v1/google/callback'}. A Firebase login token or Gemini key cannot replace this offline-access setup.
            </p>
          )}
        </div>
      )}

      {/* Settings Modal (Connection Only) Mode */}
      {status?.connected && connectionOnly && (
        <div className="workspace-card">
          <div className="workspace-card-header">
            <div className="workspace-card-header-left">
              <Globe size={12} />
              <span>Google Calendar & Tasks</span>
            </div>
            <span className="workspace-badge pending">Connected</span>
          </div>
          <p>Project: {status.project_id || 'oracle-5ac86'}. Offline access stored securely for this Windows user.</p>
          {status.account && <p>Signed in with Google: <strong>{status.account.email}</strong></p>}
          <p role="status" className="workspace-status-text">{message}</p>
          <div className="workspace-btn-row">
            <button className="workspace-btn micro secondary" disabled={busy} onClick={() => void run(load)}>
              <RefreshCw size={11} className={busy ? 'animate-spin' : ''} /> Refresh Google connection
            </button>
            <button
              className="workspace-btn micro danger"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const data = await localApi<{ notice: string }>('google/disconnect', 'POST');
                  await load();
                  setMessage(data.notice);
                })
              }
            >
              <Unlink size={11} /> Disconnect Google
            </button>
          </div>
        </div>
      )}

      {/* Full Workspace Mode (When Connected) */}
      {status?.connected && !connectionOnly && (
        <>
          {/* 1. Unified Compact Control Toolbar */}
          <div className="workspace-card" style={{ padding: '10px 14px', marginBottom: 10 }}>
            <div className="workspace-card-header" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div className="workspace-card-header-left" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Globe size={12} />
                <span style={{ fontWeight: 600, fontSize: '11px', letterSpacing: '0.04em' }}>GOOGLE CALENDAR & TASKS</span>
                <span className="workspace-badge pending" style={{ fontSize: '9px', padding: '1px 6px' }}>Connected</span>
                {status.account && (
                  <span style={{ fontSize: '10.5px', color: '#9db4d3', fontFamily: "'JetBrains Mono', monospace" }}>
                    · {status.account.email}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  className="workspace-btn micro secondary"
                  disabled={busy}
                  onClick={() => void run(refreshItems)}
                  title="Refresh all Google events and tasks"
                >
                  <RefreshCw size={10} className={busy ? 'animate-spin' : ''} />
                  Load Google events & tasks
                </button>
                <button
                  className="workspace-btn micro danger"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const data = await localApi<{ notice: string }>('google/disconnect', 'POST');
                      await load();
                      setMessage(data.notice);
                    })
                  }
                  title="Disconnect Google account"
                >
                  <Unlink size={10} />
                  Disconnect Google
                </button>
              </div>
            </div>

            {/* Inline Selectors Row */}
            <div className="workspace-grid-2col" style={{ gap: 10 }}>
              <label style={{ margin: 0 }}>
                <span>Google calendar</span>
                <OracleSelect
                  aria-label="Google calendar"
                  value={calendar}
                  disabled={busy}
                  onChange={(val) => {
                    setCalendar(val);
                    setEvents([]);
                    operation.current = crypto.randomUUID().replaceAll('-', '');
                  }}
                  options={[
                    { value: 'primary', label: 'Primary calendar', badge: 'PRIMARY' },
                    ...calendars.map((item) => ({
                      value: item.id,
                      label: `${item.summary} (${item.accessRole})`,
                      badge: item.accessRole.toUpperCase()
                    }))
                  ]}
                  triggerStyle={{ height: 28, minHeight: 28, fontSize: '11px' }}
                />
              </label>

              <label style={{ margin: 0 }}>
                <span>Google task list</span>
                <OracleSelect
                  aria-label="Google task list"
                  value={list}
                  disabled={busy}
                  onChange={(val) => {
                    setList(val);
                    setTasks([]);
                  }}
                  options={[
                    { value: '@default', label: 'Default task list', badge: 'DEFAULT' },
                    ...lists.map((item) => ({
                      value: item.id,
                      label: item.title
                    }))
                  ]}
                  triggerStyle={{ height: 28, minHeight: 28, fontSize: '11px' }}
                />
              </label>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
              <p role="status" className="workspace-status-text" style={{ margin: 0, fontSize: '10px', color: 'rgba(232, 235, 239, 0.6)' }}>
                {message}
              </p>
              <span style={{ color: 'rgba(232, 235, 239, 0.35)', fontSize: '9px', fontFamily: "'JetBrains Mono', monospace" }}>
                PROJECT: {status?.project_id || 'oracle-5ac86'}
              </span>
            </div>
          </div>

          {/* 2. Hero 2-Column Section: Calendar Matrix & Agenda Stream */}
          <div className="workspace-grid-2col" style={{ gap: 10, marginBottom: 10 }}>
            {/* Column 1: Monthly Calendar Matrix */}
            <div className="workspace-card" style={{ margin: 0, display: 'flex', flexDirection: 'column' }}>
              <div className="workspace-card-header" style={{ marginBottom: 6 }}>
                <div className="workspace-card-header-left">
                  <CalendarDays size={12} />
                  <h4>Activity Matrix</h4>
                </div>
                <div className="workspace-calendar-header-nav">
                  <button
                    type="button"
                    className="workspace-btn micro secondary"
                    onClick={() => setCalendarMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
                    title="Previous month"
                    aria-label="Previous month"
                  >
                    <ChevronLeft size={11} />
                  </button>
                  <span className="workspace-calendar-month-title" style={{ fontSize: '11px', fontWeight: 600 }}>
                    {calendarMonth.toLocaleDateString([], { month: 'short', year: 'numeric' })}
                  </span>
                  <button
                    type="button"
                    className="workspace-btn micro secondary"
                    onClick={() => setCalendarMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
                    title="Next month"
                    aria-label="Next month"
                  >
                    <ChevronRight size={11} />
                  </button>
                  <button
                    type="button"
                    className="workspace-btn micro secondary"
                    onClick={() => {
                      setCalendarMonth(new Date());
                      setSelectedDate(formatYMD(new Date()));
                    }}
                    title="Jump to today"
                  >
                    Today
                  </button>
                </div>
              </div>

              <div className="workspace-calendar-grid">
                {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
                  <div key={d} className="workspace-calendar-day-header">{d}</div>
                ))}
                {calendarDays.map(cell => (
                  <div
                    key={cell.dateStr}
                    className={`workspace-calendar-cell ${cell.isCurrentMonth ? '' : 'other-month'} ${cell.isToday ? 'today' : ''} ${selectedDate === cell.dateStr ? 'selected' : ''}`}
                    onClick={() => handleSelectDay(cell.dateStr)}
                    title={`${cell.dateStr}: ${cell.eventsCount} event(s), ${cell.tasksCount} task(s)`}
                  >
                    <span className="workspace-calendar-day-num">{cell.dayNum}</span>
                    <div className="workspace-calendar-dots">
                      {cell.eventsCount > 0 && <span className="workspace-calendar-dot event" title={`${cell.eventsCount} event(s)`} />}
                      {cell.tasksCount > 0 && <span className="workspace-calendar-dot task" title={`${cell.tasksCount} task(s)`} />}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, fontSize: '9px' }}>
                <div className="workspace-calendar-legend">
                  <span className="workspace-calendar-legend-item">
                    <span className="workspace-calendar-dot event" /> Events
                  </span>
                  <span className="workspace-calendar-legend-item">
                    <span className="workspace-calendar-dot task" /> Tasks
                  </span>
                </div>
                {selectedDate ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ color: '#38bdf8', fontFamily: "'JetBrains Mono', monospace" }}>{selectedDate}</span>
                    <button
                      type="button"
                      className="workspace-btn micro secondary"
                      onClick={() => setSelectedDate(null)}
                      style={{ height: 18, fontSize: '8.5px', padding: '0 4px' }}
                    >
                      <X size={9} /> Reset
                    </button>
                  </div>
                ) : (
                  <span style={{ color: 'rgba(232, 235, 239, 0.35)' }}>Click day to focus</span>
                )}
              </div>
            </div>

            {/* Column 2: Upcoming Agenda & Stream */}
            <div className="workspace-card" style={{ margin: 0, display: 'flex', flexDirection: 'column' }}>
              <div className="workspace-card-header" style={{ marginBottom: 6 }}>
                <div className="workspace-card-header-left">
                  <Calendar size={12} />
                  <h4>Upcoming Agenda {selectedDate ? `(${selectedDate})` : ''}</h4>
                </div>
                <span className="workspace-badge tag" style={{ fontSize: '9px' }}>
                  {displayedEvents.length} events · {displayedTasks.length} tasks
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minHeight: 0 }}>
                {/* Events List */}
                <div style={{ flex: 1, minHeight: 0 }}>
                  <div style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.06em', color: '#38bdf8', textTransform: 'uppercase', marginBottom: 3 }}>
                    Events ({displayedEvents.length})
                  </div>
                  <div className="workspace-records-stream" style={{ maxHeight: '95px', overflowY: 'auto' }}>
                    {displayedEvents.length ? (
                      displayedEvents.map(item => (
                        <article className="workspace-item-card" key={item.id} style={{ padding: '5px 8px', margin: '0 0 3px 0' }}>
                          <div className="workspace-item-head">
                            <strong className="workspace-item-title" style={{ fontSize: '11px' }}>{item.summary || 'Untitled event'}</strong>
                            <span className="workspace-item-time" style={{ fontSize: '9px' }}>
                              {item.start?.dateTime ? new Date(item.start.dateTime).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : item.start?.date}
                            </span>
                          </div>
                        </article>
                      ))
                    ) : (
                      <p style={{ fontSize: '10px', color: 'rgba(232, 235, 239, 0.4)', margin: '2px 0' }}>
                        {selectedDate ? `No events on ${selectedDate}.` : 'No upcoming events.'}
                      </p>
                    )}
                  </div>
                </div>

                {/* Tasks List */}
                <div style={{ flex: 1, minHeight: 0, borderTop: '1px solid rgba(255, 255, 255, 0.06)', paddingTop: 5 }}>
                  <div style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.06em', color: '#22c55e', textTransform: 'uppercase', marginBottom: 3 }}>
                    {overdueOnly ? 'Overdue tasks' : 'Tasks'} ({displayedTasks.length})
                  </div>
                  {overdueOnly && (
                    <button type="button" className="workspace-btn micro secondary" onClick={() => setOverdueOnly(false)}>Show all tasks</button>
                  )}
                  <div className="workspace-records-stream" style={{ maxHeight: '95px', overflowY: 'auto' }}>
                    {displayedTasks.length ? (
                      displayedTasks.map(item => (
                        <article className="workspace-item-card" key={item.id} style={{ padding: '5px 8px', margin: '0 0 3px 0' }}>
                          <div className="workspace-item-head">
                            <strong className="workspace-item-title" style={{ fontSize: '11px' }}>{item.title || 'Untitled task'}</strong>
                            <span className="workspace-item-time" style={{ fontSize: '9px' }}>
                              <span style={{ color: item.status === 'completed' ? '#94a3b8' : '#22c55e', marginRight: 4 }}>
                                {item.status === 'completed' ? 'Completed' : 'Pending'}
                              </span>
                              {item.due ? `· due ${item.due.slice(0, 10)}` : ''}
                            </span>
                          </div>
                          <div className="workspace-btn-row" style={{ marginTop: 3 }}>
                            <button
                              className="workspace-btn micro secondary"
                              disabled={busy}
                              style={{ height: 20, fontSize: '9px', padding: '0 6px' }}
                              onClick={() =>
                                void run(async () => {
                                  await localApi(
                                    `google/tasks/${encodeURIComponent(item.id)}?tasklist_id=${encodeURIComponent(list)}`,
                                    'PATCH',
                                    { completed: item.status !== 'completed' }
                                  );
                                  await refreshItems();
                                })
                              }
                            >
                              {item.status === 'completed' ? 'Reopen Google task' : 'Complete Google task'}
                            </button>
                          </div>
                        </article>
                      ))
                    ) : (
                      <p style={{ fontSize: '10px', color: 'rgba(232, 235, 239, 0.4)', margin: '2px 0' }}>
                        {selectedDate ? `No tasks due on ${selectedDate}.` : 'No tasks in this list.'}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 3. Compact Creation Forms 2-Column Grid */}
          <div className="workspace-grid-2col" style={{ gap: 10 }}>
            {/* Event Form */}
            <div className="workspace-card" style={{ margin: 0 }}>
              <div className="workspace-card-header" style={{ marginBottom: 6 }}>
                <div className="workspace-card-header-left">
                  <Calendar size={12} />
                  <h4>Calendar event or timed reminder</h4>
                </div>
              </div>

              {reminders.length > 0 && (
                <label style={{ marginBottom: 4 }}>
                  <span>Prefill from local reminder</span>
                  <OracleSelect
                    aria-label="Prefill from a local reminder"
                    value=""
                    disabled={busy}
                    placeholder="Choose reminder..."
                    onChange={(val) => {
                      const item = reminders.find((r) => r.id === val);
                      if (item) {
                        setTitle(item.title);
                        setStart(localTime(item.due));
                        setEnd(localTime(item.due + 15 * 60000));
                        setMinutes('0');
                        operation.current = crypto.randomUUID().replaceAll('-', '');
                      }
                    }}
                    options={[
                      { value: '', label: 'None (enter new details)' },
                      ...reminders.map((item) => ({
                        value: item.id,
                        label: item.title,
                        desc: new Date(item.due).toLocaleString()
                      }))
                    ]}
                    triggerStyle={{ height: 26, minHeight: 26, fontSize: '10.5px' }}
                  />
                </label>
              )}

              <form
                onSubmit={e => {
                  e.preventDefault();
                  void run(async () => {
                    const data = await localApi<{ notice: string }>(eventPath, 'POST', {
                      title,
                      start: new Date(start).toISOString(),
                      end: new Date(end).toISOString(),
                      reminder_minutes: Number(minutes),
                      operation_id: operation.current
                    });
                    if (!active.current) return;
                    operation.current = crypto.randomUUID().replaceAll('-', '');
                    setTitle('');
                    setStart('');
                    setEnd('');
                    await refreshItems();
                    setMessage(data.notice);
                  });
                }}
              >
                <label>
                  <span>Google event title</span>
                  <input
                    required
                    maxLength={200}
                    disabled={busy}
                    placeholder="Event title..."
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                  />
                </label>

                <div className="workspace-grid-2col" style={{ gap: 6 }}>
                  <label>
                    <span>Event starts</span>
                    <input
                      type="datetime-local"
                      required
                      disabled={busy}
                      value={start}
                      onChange={e => setStart(e.target.value)}
                    />
                  </label>

                  <label>
                    <span>Event ends</span>
                    <input
                      type="datetime-local"
                      required
                      disabled={busy}
                      value={end}
                      onChange={e => setEnd(e.target.value)}
                    />
                  </label>
                </div>

                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginTop: 2 }}>
                  <label style={{ flex: 1 }}>
                    <span>Notify mins before</span>
                    <input
                      type="number"
                      min="0"
                      max="40320"
                      required
                      disabled={busy}
                      value={minutes}
                      onChange={e => setMinutes(e.target.value)}
                    />
                  </label>

                  <button className="workspace-btn primary" disabled={busy} style={{ flex: 2, height: 28, minHeight: 28 }}>
                    Create in Google Calendar
                  </button>
                </div>
              </form>
            </div>

            {/* Task Form */}
            <div className="workspace-card" style={{ margin: 0 }}>
              <div className="workspace-card-header" style={{ marginBottom: 6 }}>
                <div className="workspace-card-header-left">
                  <CheckSquare size={12} />
                  <h4>Create Google task</h4>
                </div>
              </div>

              <form
                onSubmit={e => {
                  e.preventDefault();
                  void run(async () => {
                    const data = await localApi<{ notice: string }>(tasksPath, 'POST', {
                      title: taskTitle,
                      due_date: date || null
                    });
                    if (!active.current) return;
                    setTaskTitle('');
                    setDate('');
                    await refreshItems();
                    setMessage(data.notice);
                  });
                }}
              >
                <label>
                  <span>Google task title</span>
                  <input
                    required
                    maxLength={200}
                    disabled={busy}
                    placeholder="Task title..."
                    value={taskTitle}
                    onChange={e => setTaskTitle(e.target.value)}
                  />
                </label>

                <label>
                  <span>Google task due date</span>
                  <input
                    type="date"
                    disabled={busy}
                    value={date}
                    onChange={e => setDate(e.target.value)}
                  />
                </label>

                <button className="workspace-btn primary" disabled={busy} style={{ width: '100%', height: 28, minHeight: 28, marginTop: 4 }}>
                  Create Google task
                </button>
              </form>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
