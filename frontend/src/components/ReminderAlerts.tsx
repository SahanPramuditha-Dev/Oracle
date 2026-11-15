import { useEffect, useRef, useState } from 'react';
import { Bell, Clock, RotateCcw, Check, AlertCircle } from 'lucide-react';
import { localApi } from '../utils/api';

type Task = { id: string; title: string; due: number; state: string };

export function ReminderAlerts() {
  const [items, setItems] = useState<Task[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = useRef<() => void>(() => {});

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let reading = false;
    let refreshRequested = false;

    const load = async () => {
      if (document.hidden || reading || controller.signal.aborted) return;
      reading = true;
      try {
        const data = await localApi<{ tasks: Task[] }>('tasks?due_only=true', 'GET', undefined, controller.signal);
        if (!controller.signal.aborted) {
          setItems(previous => previous.length === data.tasks.length &&
            previous.every((item, index) => item.id === data.tasks[index].id &&
              item.title === data.tasks[index].title && item.due === data.tasks[index].due)
            ? previous : data.tasks);
          setError('');
        }
      } catch (err) {
        if (!controller.signal.aborted) setError(String(err));
      } finally {
        reading = false;
        if (!controller.signal.aborted) {
          clearTimeout(timer);
          if (!document.hidden) {
            timer = setTimeout(() => void load(), refreshRequested ? 0 : 5000);
            refreshRequested = false;
          }
        }
      }
    };

    refresh.current = () => {
      if (reading) refreshRequested = true;
      else void load();
    };
    void load();

    const visible = () => {
      if (document.hidden) clearTimeout(timer);
      else void load();
    };
    document.addEventListener('visibilitychange', visible);

    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);

  if (!items.length && !error) return null;
  const first = items[0];

  async function change(snooze: boolean) {
    if (!first) return;
    setBusy(true);
    try {
      await localApi(
        `tasks/${first.id}${snooze ? '/snooze' : ''}`,
        snooze ? 'POST' : 'DELETE',
        snooze ? { minutes: 5 } : undefined
      );
      refresh.current();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="reminder-alert" role="alert">
      {first && (
        <>
          <div className="reminder-alert-header">
            <div className="reminder-alert-header-left">
              <div className="reminder-alert-icon-box">
                <Bell size={13} />
              </div>
              <div className="reminder-alert-meta">
                <span className="reminder-alert-tag">Reminder</span>
                <h4 className="reminder-alert-title">{first.title}</h4>
              </div>
            </div>
            <div className="reminder-alert-header-right">
              {items.length > 1 ? (
                <span className="reminder-alert-badge">+{items.length - 1}</span>
              ) : (
                <span className="reminder-alert-status-dot" title="Active Alert" />
              )}
            </div>
          </div>

          <div className="reminder-alert-time">
            <Clock size={12} className="reminder-alert-time-icon" />
            <span>Due {new Date(first.due).toLocaleString()}</span>
          </div>

          <div className="reminder-alert-buttons">
            <button
              type="button"
              className="reminder-alert-btn reminder-alert-btn-dismiss"
              disabled={busy}
              onClick={() => void change(false)}
            >
              <Check size={13} />
              <span>Dismiss</span>
            </button>
            <button
              type="button"
              className="reminder-alert-btn reminder-alert-btn-snooze"
              disabled={busy}
              onClick={() => void change(true)}
            >
              <RotateCcw size={12} />
              <span>Snooze 5m</span>
            </button>
          </div>
        </>
      )}

      {error && (
        <div className="reminder-alert-error">
          <AlertCircle size={12} />
          <span>{error}</span>
        </div>
      )}
    </aside>
  );
}
