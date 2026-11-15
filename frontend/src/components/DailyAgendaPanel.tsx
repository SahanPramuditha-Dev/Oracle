import React, { useState, useEffect } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Calendar, Check, CheckSquare, Clock } from 'lucide-react';
import { localApi } from '../utils/api';
import { PresenceCard } from './PresenceCard';
import './DailyAgendaPanel.css';

export interface CalendarEventItem {
  id?: string;
  summary?: string;
  title?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  status?: string;
  location?: string;
}

export interface TaskRecordItem {
  id: string;
  title: string;
  status?: string;
  due?: string;
  created_at?: string;
  source?: 'google' | 'local';
}

interface DailyAgendaPanelProps {
  onOpenWorkspace?: () => void;
  onOpenOverdue?: (source: 'local' | 'google') => void;
  onClose?: () => void;
  pinned?: boolean;
  onTogglePin?: () => void;
}

export const DailyAgendaPanel: React.FC<DailyAgendaPanelProps> = ({ onOpenWorkspace, onOpenOverdue, onClose, pinned, onTogglePin }) => {
  const reduceMotion = useReducedMotion();
  const [events, setEvents] = useState<CalendarEventItem[]>([]);
  const [tasks, setTasks] = useState<TaskRecordItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [calendarState, setCalendarState] = useState<'ready' | 'disconnected' | 'unavailable'>('unavailable');
  const [tasksUnavailable, setTasksUnavailable] = useState(false);
  const [overdue, setOverdue] = useState({ google: false, local: false });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    let request = 0;

    const loadData = async () => {
      const currentRequest = ++request;
      try {
        const [localTasksRes, status] = await Promise.all([
          localApi<{ tasks?: Array<{ id: string; title?: string; due?: number; state?: string }> }>('tasks').catch(() => null),
          localApi<{ connected?: boolean }>('google/status').catch(() => null),
        ]);
        const [eventResponse, taskResponse] = status?.connected
          ? await Promise.all([
            localApi<{ events?: CalendarEventItem[] }>('google/events?calendar_id=primary').catch(() => null),
            localApi<{ tasks?: Array<{ id: string; title?: string; due?: string; status?: string }> }>('google/tasks?tasklist_id=@default').catch(() => null),
          ])
          : [null, null];

        if (active && currentRequest === request) {
          setCalendarState(eventResponse ? 'ready' : status?.connected === false ? 'disconnected' : 'unavailable');
          setTasksUnavailable(!localTasksRes || status?.connected === undefined || (status.connected && !taskResponse));
          const now = new Date();
          const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          const dateKey = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');

          setEvents((eventResponse?.events ?? []).filter((event) => {
            if (event.status === 'cancelled') return false;
            if (event.end?.date) return event.end.date > dateKey;
            if (event.end?.dateTime) return Date.parse(event.end.dateTime) > now.getTime();
            if (event.start?.date) return event.start.date >= dateKey;
            return Date.parse(event.start?.dateTime ?? '') >= now.getTime();
          }).slice(0, 3));

          setOverdue({
            google: (taskResponse?.tasks ?? []).some(t => Boolean(t.title && t.status !== 'completed' && t.due && t.due.slice(0, 10) < dateKey)),
            local: (localTasksRes?.tasks ?? []).some(t => Boolean(t.title && t.state !== 'completed' && t.due && t.due < today.getTime())),
          });
          const pendingList: TaskRecordItem[] = [];

          // Google Tasks due dates are date-only, even when encoded as timestamps.
          if (Array.isArray(taskResponse?.tasks)) {
            for (const t of taskResponse.tasks) {
              if (t.title && t.status !== 'completed' && (!t.due || t.due.slice(0, 10) >= dateKey)) {
                pendingList.push({
                  id: `google-${t.id}`,
                  title: t.title,
                  status: 'Pending',
                  due: t.due ? t.due.slice(0, 10) : undefined,
                  source: 'google'
                });
              }
            }
          }

          // Local Tasks / Reminders (state !== 'completed')
          if (Array.isArray(localTasksRes?.tasks)) {
            for (const t of localTasksRes.tasks) {
              if (t.title && t.state !== 'completed' && (!t.due || t.due >= today.getTime())) {
                pendingList.push({
                  id: `local-${t.id}`,
                  title: t.title,
                  status: t.state || 'Pending',
                  due: t.due ? new Date(t.due).toLocaleDateString([], { month: 'short', day: 'numeric' }) : undefined,
                  source: 'local'
                });
              }
            }
          }

          setTasks(pendingList);
        }
      } catch {
        // Silently preserve empty states
      } finally {
        if (active && currentRequest === request) setLoading(false);
      }
    };

    void loadData();

    const handleGoogleUpdate = () => { void loadData(); };
    const refresh = window.setInterval(loadData, 60_000);
    window.addEventListener('focus', handleGoogleUpdate);
    window.addEventListener('oracle_google_records_changed', handleGoogleUpdate);
    return () => {
      active = false;
      window.clearInterval(refresh);
      window.removeEventListener('focus', handleGoogleUpdate);
      window.removeEventListener('oracle_google_records_changed', handleGoogleUpdate);
    };
  }, [retry]);

  const eventProximity = (event: CalendarEventItem) => {
    const start = Date.parse(event.start?.dateTime ?? '');
    if (!Number.isFinite(start)) return 'Next event';
    const minutes = Math.ceil((start - Date.now()) / 60_000);
    if (minutes <= 0) return 'In progress';
    return minutes < 60 ? `In ${minutes} min` : 'Next event';
  };

  const formatEventTime = (ev: CalendarEventItem) => {
    if (!ev.start?.dateTime) {
      if (ev.start?.date) {
        const d = new Date(ev.start.date + 'T00:00:00');
        const now = new Date();
        const todayStr = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const targetStr = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        const diffDays = Math.round((targetStr - todayStr) / (1000 * 60 * 60 * 24));
        if (diffDays === 0) return 'Today';
        if (diffDays === 1) return 'Tomorrow';
        return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
      }
      return 'Today';
    }
    try {
      const d = new Date(ev.start.dateTime);
      const isToday = d.toDateString() === new Date().toDateString();
      const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return isToday ? timeStr : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${timeStr}`;
    } catch {
      return 'Today';
    }
  };

  const nextEvent = events[0];
  const caughtUp = !loading && calendarState === 'ready' && !tasksUnavailable
    && !events.length && !tasks.length && !overdue.local && !overdue.google;

  return (
    <PresenceCard title="Today's Priorities" icon={<Calendar size={14} />}
      pinned={pinned} onTogglePin={onTogglePin} onClose={onClose}
      updateKey={loading ? undefined : JSON.stringify([calendarState, tasksUnavailable, overdue, nextEvent, tasks.slice(0, 2), tasks.length])}
      action={onOpenWorkspace && <button type="button" onClick={onOpenWorkspace}>View all</button>}
    >
      {caughtUp ? (
        <div className="agenda-caught-up">
          <Check size={14} aria-hidden="true" />
          <span>You're all caught up</span>
        </div>
      ) : (
        <div className="agenda-sections">
          {/* Upcoming Events Section */}
          <div className="agenda-section">
            <div className="agenda-section-title">
              <Clock size={10} strokeWidth={2} />
              Upcoming Events
            </div>

            {nextEvent ? (
              <div className="agenda-item-card agenda-next-event">
                <span className="agenda-next-label">{eventProximity(nextEvent)}</span>
                <div className="agenda-item-row">
                  <span className="agenda-item-title" title={nextEvent.summary || nextEvent.title || 'Event'}>
                    {nextEvent.summary || nextEvent.title || 'Calendar event'}
                  </span>
                  <span className="agenda-item-time">{formatEventTime(nextEvent)}</span>
                </div>
                {nextEvent.location && <span className="agenda-item-meta" title={nextEvent.location}>{nextEvent.location}</span>}
              </div>
            ) : (
              <div className="agenda-empty-state">
                {loading ? 'Checking schedule…' : {
                  ready: 'No upcoming events.',
                  disconnected: 'Google Calendar is disconnected.',
                  unavailable: 'Calendar unavailable.',
                }[calendarState]}
                {!loading && calendarState === 'unavailable' && (
                  <button type="button" className="agenda-status-action" onClick={() => {
                    setLoading(true);
                    setRetry(value => value + 1);
                  }}>Retry</button>
                )}
              </div>
            )}
          </div>

          {/* Pending Tasks Section */}
          <div className="agenda-section">
            <div className="agenda-section-title">
              <CheckSquare size={10} strokeWidth={2} />
              Pending Tasks ({tasks.length})
            </div>

            {tasks.length > 0 ? (
              <AnimatePresence initial={false}>
                {tasks.slice(0, 2).map((task) => (
                  <motion.div key={task.id} className="agenda-item-card"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    exit={{ opacity: 0, height: reduceMotion ? undefined : 0, paddingBlock: reduceMotion ? undefined : 0 }}
                    transition={{ duration: 0.18 }}>
                    <div className="agenda-item-row">
                      <span className="agenda-item-title" title={task.title}>
                        {task.title}
                      </span>
                      <span className="agenda-item-time">
                        {task.due ? `Due ${task.due}` : 'Pending'}
                      </span>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            ) : (
              <div className="agenda-empty-state">
                {loading ? 'Retrieving records…' : tasksUnavailable ? 'Some tasks are unavailable.' : 'No pending tasks.'}
              </div>
            )}
            {tasks.length > 0 && tasksUnavailable && <div className="agenda-item-meta">Some tasks are unavailable.</div>}
            {onOpenOverdue && (['local', 'google'] as const).filter(source => overdue[source]).map(source => (
              <button key={source} type="button" className="agenda-status-action" onClick={() => onOpenOverdue(source)}>
                {source === 'google' ? 'Overdue Google tasks' : 'Overdue local tasks'}
              </button>
            ))}
          </div>
        </div>
      )}
    </PresenceCard>
  );
};
