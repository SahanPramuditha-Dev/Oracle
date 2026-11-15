import { 
  Layers, 
  X, 
  FileText, 
  Clock3, 
  Image as ImageIcon, 
  Globe, 
  RefreshCw, 
  Search, 
  Plus, 
  Trash2, 
  Edit3, 
  Bell, 
  Play, 
  Calendar,
  Sparkles,
  Inbox,
  Shield,
  ShieldCheck,
  Camera,
  EyeOff,
  Lock,
  Activity,
  Terminal,
  Compass,
  Wifi,
  Sun,
  Moon
} from 'lucide-react';
import { 
  getStoredProtocols, 
  executeProtocol, 
  deleteProtocol, 
  resetAllProtocols, 
  ProtocolDefinition 
} from '../utils/protocols';
import { ProtocolEditorModal } from './ProtocolEditorModal';
import { useCurrentUser } from '../utils/currentUser';
import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { fetchWithAuth, localApi } from '../utils/api';
import { GoogleWorkspace } from './GoogleWorkspace';
import './RecordsWorkspace.css';

type Note = { id: string; title: string; text: string; updated: number };
type Task = { id: string; title: string; due: number; state: 'pending' | 'alert'; kind: 'timer' | 'reminder' };
type Memory = Note & { created: number; source: string };

function SavedImage({ id }: { id: string }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const owned = { url: '' };
    void fetchWithAuth(`/api/v1/memories/${id}/image`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Saved image unavailable.');
        const blob = await response.blob();
        if (!controller.signal.aborted) {
          owned.url = URL.createObjectURL(blob);
          setUrl(owned.url);
        }
      })
      .catch(err => {
        if (!controller.signal.aborted) setError(String(err));
      });
    return () => {
      controller.abort();
      if (owned.url) URL.revokeObjectURL(owned.url);
    };
  }, [id]);

  return url ? (
    <div className="saved-memory-wrap">
      <img className="saved-memory-image" src={url} alt="Saved image memory" />
    </div>
  ) : (
    <p role="status" className="workspace-status-text">{error || 'Accessing encrypted image payload…'}</p>
  );
}

export interface RecordsWorkspaceProps {
  onClose: () => void;
  onActivateAdminProtocol?: () => void;
  isAdmin?: boolean;
  overdueSource?: 'local' | 'google';
}

export function RecordsWorkspace({ onClose, onActivateAdminProtocol, isAdmin, overdueSource }: RecordsWorkspaceProps) {
  const currentUser = useCurrentUser();
  const isUserAdmin = isAdmin ?? currentUser?.permission === 'administrator';
  const [tab, setTab] = useState<'notes' | 'tasks' | 'memories' | 'google' | 'protocols'>(overdueSource === 'local' ? 'tasks' : overdueSource === 'google' ? 'google' : 'notes');
  const [protocols, setProtocols] = useState<ProtocolDefinition[]>(() => getStoredProtocols());
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingProtocol, setEditingProtocol] = useState<ProtocolDefinition | null>(null);

  useEffect(() => {
    const handleProtocolsChanged = () => {
      setProtocols(getStoredProtocols());
    };
    window.addEventListener('oracle_protocols_changed', handleProtocolsChanged);
    return () => window.removeEventListener('oracle_protocols_changed', handleProtocolsChanged);
  }, []);
  const [notes, setNotes] = useState<Note[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [overdueOnly, setOverdueOnly] = useState(Boolean(overdueSource));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const visibleTasks = overdueOnly && overdueSource === 'local' ? tasks.filter(task => task.due < today.getTime()) : tasks;
  const [memories, setMemories] = useState<Memory[]>([]);
  const [query, setQuery] = useState('');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<{ id: string; kind: 'notes' | 'memories' } | null>(null);
  const [seconds, setSeconds] = useState('60');
  const [when, setWhen] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [shown, setShown] = useState<string | null>(null);
  const loading = useRef<AbortController | null>(null);

  const reload = useCallback(() => setRefresh(n => n + 1), []);

  // Keyboard accessibility: Escape closes modal
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (tab === 'google' || tab === 'protocols') return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const path = tab === 'tasks' ? 'tasks' : `${tab}?q=${encodeURIComponent(query)}`;
      loading.current = controller;
      void localApi<any>(path, 'GET', undefined, controller.signal)
        .then(data => {
          if (controller.signal.aborted) return;
          if (tab === 'notes') setNotes(data.notes || []);
          if (tab === 'tasks') setTasks(data.tasks || []);
          if (tab === 'memories') setMemories(data.memories || []);
        })
        .catch(err => {
          if (!controller.signal.aborted) setStatus(String(err));
        })
        .finally(() => {
          if (loading.current === controller) loading.current = null;
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [tab, query, refresh]);

  useEffect(() => {
    const tick = setInterval(() => {
      if (!document.hidden && !loading.current) reload();
    }, 5000);
    return () => clearInterval(tick);
  }, [reload]);

  async function mutate(path: string, method: string, body?: unknown) {
    setBusy(true);
    setStatus('');
    try {
      await localApi(path, method, body);
      reload();
      setStatus('Saved.');
      return true;
    } catch (err) {
      setStatus(String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function switchTab(next: typeof tab) {
    setTab(next);
    setQuery('');
    setTitle('');
    setText('');
    setEditing(null);
    setShown(null);
    setStatus('');
  }

  return (
    <div 
      className="records-modal-backdrop"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        className="records-modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Records workspace"
        initial={{ scale: 0.96, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0, transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] } }}
        exit={{ scale: 0.96, opacity: 0, y: 8, transition: { duration: 0.16, ease: 'easeIn' } }}
      >
        {/* Master Top Ribbon Header */}
        <header className="workspace-top-ribbon">
          <div className="workspace-ribbon-left">
            <span className="workspace-section-tag">
              <Layers size={13} strokeWidth={2} className="workspace-tag-icon" />
              Workspace // Vault
            </span>
            <span className="workspace-ribbon-badge">Local Records</span>
          </div>

          <div className="workspace-ribbon-right">
            <span className="workspace-status-badge">
              <span className="workspace-status-dot" />
              Daemon Armed
            </span>

            <button
              className="workspace-icon-btn"
              onClick={reload}
              disabled={busy}
              title="Refresh repository records"
              aria-label="Refresh records"
            >
              <RefreshCw size={13} className={busy ? 'animate-spin' : ''} />
            </button>

            <button
              className="workspace-icon-btn workspace-close"
              onClick={onClose}
              title="Close workspace"
              aria-label="Close workspace"
            >
              <X size={14} />
            </button>
          </div>
        </header>

        {/* Category Navigation Ribbon */}
        <nav className="workspace-nav-bar" aria-label="Record categories">
          {(['notes', 'tasks', 'memories', 'google', 'protocols'] as const).map(name => {
            const count = name === 'notes' ? notes.length : name === 'tasks' ? tasks.length : name === 'memories' ? memories.length : null;
            return (
              <button
                className={`workspace-tab-btn ${tab === name ? 'active' : ''}`}
                aria-pressed={tab === name}
                key={name}
                onClick={() => switchTab(name)}
              >
                {name === 'notes' ? (
                  <FileText size={12} strokeWidth={1.8} aria-hidden="true" />
                ) : name === 'tasks' ? (
                  <Clock3 size={12} strokeWidth={1.8} aria-hidden="true" />
                ) : name === 'memories' ? (
                  <ImageIcon size={12} strokeWidth={1.8} aria-hidden="true" />
                ) : name === 'google' ? (
                  <Globe size={12} strokeWidth={1.8} aria-hidden="true" />
                ) : (
                  <Shield size={12} strokeWidth={1.8} aria-hidden="true" />
                )}
                <span>
                  {name === 'tasks'
                    ? 'Reminders & timers'
                    : name === 'notes'
                    ? 'Notes'
                    : name === 'google'
                    ? 'Google'
                    : name === 'protocols'
                    ? 'Protocols'
                    : 'Memories'}
                </span>
                {name === 'protocols' ? (
                  <span
                    className="workspace-tab-badge"
                    style={{
                      background: isUserAdmin ? 'rgba(34, 197, 94, 0.25)' : 'rgba(239, 68, 68, 0.25)',
                      color: isUserAdmin ? '#4ade80' : '#f87171',
                      fontWeight: 700
                    }}
                  >
                    {isUserAdmin ? 'LVL 5' : 'AUTH'}
                  </span>
                ) : count !== null && count > 0 && (
                  <span className="workspace-tab-badge">{count}</span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Master Body Content Area */}
        <div className="workspace-body-pane" aria-busy={busy}>
          {/* Sub-toolbar notice strip (only for notes, tasks, memories) */}
          {tab !== 'google' && tab !== 'protocols' && (
            <div className="workspace-toolbar-strip">
              <p className="workspace-daemon-notice">
                <span className="workspace-daemon-dot" />
                Keep ORACLE open for reminder alerts.
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {status && <p className="workspace-status-text" role="status">{status}</p>}
                <button
                  className="workspace-btn micro secondary"
                  onClick={reload}
                  disabled={busy}
                >
                  <RefreshCw size={11} className={busy ? 'animate-spin' : ''} aria-hidden="true" />
                  Refresh records
                </button>
              </div>
            </div>
          )}

          {/* Google Workspace Sub-suite */}
          {tab === 'google' && <GoogleWorkspace initialOverdueOnly={overdueSource === 'google'} />}

          {/* Search bar for Notes & Memories */}
          {tab !== 'tasks' && tab !== 'google' && tab !== 'protocols' && (
            <div className="workspace-search-wrap">
              <Search size={13} className="workspace-search-icon" aria-hidden="true" />
              <input
                type="search"
                maxLength={200}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={`Search ${tab} in vault…`}
                aria-label={`Search ${tab}`}
                className="workspace-search-input"
              />
            </div>
          )}

          {/* Note Editor Form (for Notes or Editing Memories) */}
          {(tab === 'notes' || editing?.kind === 'memories') && (
            <form
              className="workspace-card"
              onSubmit={async e => {
                e.preventDefault();
                if (busy) return;
                const path = editing ? `${editing.kind}/${editing.id}` : 'notes';
                const method = editing ? 'PUT' : 'POST';
                if (await mutate(path, method, { title, text })) {
                  setTitle('');
                  setText('');
                  setEditing(null);
                }
              }}
            >
              <div className="workspace-card-header">
                <div className="workspace-card-header-left">
                  {editing ? <Edit3 size={11} /> : <Plus size={11} />}
                  <span>{editing ? 'Update Record Entry' : 'New Knowledge Record'}</span>
                </div>
                {editing && (
                  <span className="workspace-badge alert">Editing Mode</span>
                )}
              </div>

              <label className="workspace-field">
                <span>Record title</span>
                <input
                  required
                  maxLength={200}
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Record designation / title…"
                  className="workspace-input"
                  aria-label="Record title"
                />
              </label>

              <label className="workspace-field" htmlFor="record-text">
                <span>Record text</span>
                <textarea
                  id="record-text"
                  required
                  maxLength={12000}
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder="Encrypted content, memo payload, or thoughts…"
                  className="workspace-textarea"
                  aria-label="Record text"
                />
              </label>

              <div className="workspace-btn-row">
                <button className="workspace-btn primary" disabled={busy}>
                  <Sparkles size={11} />
                  {editing ? 'Update record' : 'Save note'}
                </button>
                {editing && (
                  <button
                    type="button"
                    className="workspace-btn secondary"
                    onClick={() => {
                      setEditing(null);
                      setTitle('');
                      setText('');
                    }}
                  >
                    Cancel edit
                  </button>
                )}
              </div>
            </form>
          )}

          {/* Notes Stream */}
          {tab === 'notes' && (
            <div className="workspace-records-stream">
              {notes.length ? (
                notes.map(note => (
                  <article className="workspace-item-card" key={note.id}>
                    <div className="workspace-item-head">
                      <h3 className="workspace-item-title">{note.title}</h3>
                      <time className="workspace-item-time">
                        {new Date(note.updated).toLocaleString()}
                      </time>
                    </div>
                    <p className="workspace-item-body">{note.text}</p>
                    <div className="workspace-item-footer">
                      <div className="workspace-btn-row">
                        <button
                          className="workspace-btn micro secondary"
                          disabled={busy}
                          onClick={() => {
                            setEditing({ id: note.id, kind: 'notes' });
                            setTitle(note.title);
                            setText(note.text);
                          }}
                        >
                          <Edit3 size={10} /> Edit note
                        </button>
                        <button
                          className="workspace-btn micro danger"
                          disabled={busy}
                          onClick={() => void mutate(`notes/${note.id}`, 'DELETE')}
                        >
                          <Trash2 size={10} /> Delete note
                        </button>
                      </div>
                    </div>
                  </article>
                ))
              ) : (
                <div className="workspace-empty-state">
                  <Inbox size={20} style={{ color: 'var(--faint)' }} />
                  <p className="workspace-empty-title">No Matching Records</p>
                  <p className="workspace-empty-desc">
                    {query ? 'No records match your search filter.' : 'Your vault is clear. Create a new note above to persist data locally.'}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Tasks & Timers Tab */}
          {tab === 'tasks' && (
            <>
              <div className="workspace-grid-2col">
                {/* Rapid Timer Card */}
                <form
                  className="workspace-card"
                  onSubmit={async e => {
                    e.preventDefault();
                    if (busy) return;
                    const duration = Number(seconds) * 1000;
                    await mutate('tasks', 'POST', {
                      title: 'Timer',
                      kind: 'timer',
                      duration_ms: duration,
                      due: Date.now() + duration
                    });
                  }}
                >
                  <div className="workspace-card-header">
                    <div className="workspace-card-header-left">
                      <Clock3 size={11} />
                      <span>Rapid Chrono Timer</span>
                    </div>
                  </div>

                  <label className="workspace-field">
                    <span>Timer seconds</span>
                    <input
                      type="number"
                      required
                      min="1"
                      max="86400"
                      value={seconds}
                      onChange={e => setSeconds(e.target.value)}
                      className="workspace-input"
                      aria-label="Timer seconds"
                    />
                  </label>

                  <div className="workspace-chip-group">
                    {[
                      { label: '30s', val: '30' },
                      { label: '1m', val: '60' },
                      { label: '5m', val: '300' },
                      { label: '15m', val: '900' },
                      { label: '30m', val: '1800' }
                    ].map(preset => (
                      <button
                        type="button"
                        key={preset.label}
                        className="workspace-time-chip"
                        onClick={() => setSeconds(preset.val)}
                      >
                        +{preset.label}
                      </button>
                    ))}
                  </div>

                  <button className="workspace-btn primary" disabled={busy}>
                    <Play size={11} /> Start timer
                  </button>
                </form>

                {/* Scheduled Reminder Card */}
                <form
                  className="workspace-card"
                  onSubmit={async e => {
                    e.preventDefault();
                    if (busy) return;
                    if (
                      await mutate('tasks', 'POST', {
                        title,
                        kind: 'reminder',
                        due: new Date(when).getTime()
                      })
                    ) {
                      setTitle('');
                      setWhen('');
                    }
                  }}
                >
                  <div className="workspace-card-header">
                    <div className="workspace-card-header-left">
                      <Bell size={11} />
                      <span>Scheduled Chrono Reminder</span>
                    </div>
                  </div>

                  <label className="workspace-field">
                    <span>Reminder title</span>
                    <input
                      required
                      maxLength={200}
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                      placeholder="Meeting, check-in, cadence…"
                      className="workspace-input"
                      aria-label="Reminder title"
                    />
                  </label>

                  <label className="workspace-field">
                    <span>Remind at</span>
                    <input
                      type="datetime-local"
                      required
                      value={when}
                      onChange={e => setWhen(e.target.value)}
                      className="workspace-input"
                      aria-label="Remind at"
                    />
                  </label>

                  <button className="workspace-btn primary" disabled={busy}>
                    <Calendar size={11} /> Save reminder
                  </button>
                </form>
              </div>

              {/* Tasks Stream */}
              <div className="workspace-records-stream">
                {overdueOnly && overdueSource === 'local' && (
                  <button type="button" className="workspace-btn secondary" onClick={() => setOverdueOnly(false)}>Overdue only · Show all</button>
                )}
                {visibleTasks.length ? (
                  visibleTasks.map(task => (
                    <article className="workspace-item-card" key={task.id}>
                      <div className="workspace-item-head">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span className={`workspace-badge ${task.state === 'alert' ? 'alert' : 'pending'}`}>
                            {task.state === 'alert' ? 'Alert Due' : 'Scheduled'}
                          </span>
                          <h3 className="workspace-item-title">{task.title}</h3>
                        </div>
                        <time className="workspace-item-time">
                          {new Date(task.due).toLocaleString()}
                        </time>
                      </div>

                      <p className="workspace-item-body">
                        {task.state === 'alert' ? 'Due' : 'Scheduled'} · {new Date(task.due).toLocaleString()}
                      </p>

                      <div className="workspace-item-footer">
                        <div className="workspace-btn-row">
                          <button
                            className={`workspace-btn micro ${task.state === 'alert' ? 'danger' : 'secondary'}`}
                            disabled={busy}
                            onClick={() => void mutate(`tasks/${task.id}`, 'DELETE')}
                          >
                            {task.state === 'alert' ? 'Dismiss' : 'Cancel task'}
                          </button>
                          <button
                            className="workspace-btn micro secondary"
                            disabled={busy}
                            onClick={() => void mutate(`tasks/${task.id}/snooze`, 'POST', { minutes: 5 })}
                          >
                            Snooze 5 minutes
                          </button>
                        </div>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="workspace-empty-state">
                    <Clock3 size={20} style={{ color: 'var(--faint)' }} />
                    <p className="workspace-empty-title">{overdueOnly && overdueSource === 'local' ? 'No overdue tasks' : 'No Timers or Reminders'}</p>
                    <p className="workspace-empty-desc">
                      Queue timers or schedule date-based alerts above. ORACLE notifies you when due.
                    </p>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Memories Tab */}
          {tab === 'memories' && (
            <div className="workspace-records-stream">
              {memories.length ? (
                memories.map(item => (
                  <article className="workspace-item-card" key={item.id}>
                    <div className="workspace-item-head">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className="workspace-badge tag">{item.source || 'CAMERA'}</span>
                        <h3 className="workspace-item-title">{item.title}</h3>
                      </div>
                      <time className="workspace-item-time">
                        {new Date(item.created).toLocaleString()}
                      </time>
                    </div>

                    <p className="workspace-item-body">{item.text}</p>

                    <div className="workspace-item-footer">
                      <div className="workspace-btn-row">
                        <button
                          className="workspace-btn micro secondary"
                          onClick={() => setShown(shown === item.id ? null : item.id)}
                        >
                          <ImageIcon size={10} />
                          {shown === item.id ? 'Hide image' : 'View image'}
                        </button>
                        <button
                          className="workspace-btn micro secondary"
                          disabled={busy}
                          onClick={() => {
                            setEditing({ id: item.id, kind: 'memories' });
                            setTitle(item.title);
                            setText(item.text);
                          }}
                        >
                          <Edit3 size={10} /> Edit memory
                        </button>
                        <button
                          className="workspace-btn micro danger"
                          disabled={busy}
                          onClick={() => void mutate(`memories/${item.id}`, 'DELETE')}
                        >
                          <Trash2 size={10} /> Delete memory
                        </button>
                      </div>
                    </div>

                    {shown === item.id && <SavedImage id={item.id} />}
                  </article>
                ))
              ) : (
                <div className="workspace-empty-state">
                  <ImageIcon size={20} style={{ color: 'var(--faint)' }} />
                  <p className="workspace-empty-title">No Stored Memories</p>
                  <p className="workspace-empty-desc">
                    Capture text or documents via the optical camera viewfinder to store memories here.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Protocols Hub Tab */}
          {tab === 'protocols' && (
            <div className="workspace-records-stream" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Clearance Status Header Banner */}
              <div
                className="workspace-card"
                style={{
                  padding: '16px 20px',
                  borderColor: isUserAdmin ? 'rgba(34, 197, 94, 0.4)' : 'rgba(239, 68, 68, 0.35)',
                  background: isUserAdmin ? 'rgba(34, 197, 94, 0.05)' : 'rgba(239, 68, 68, 0.05)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {isUserAdmin ? (
                      <ShieldCheck size={28} color="#4ade80" />
                    ) : (
                      <Shield size={28} color="#f87171" />
                    )}
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: isUserAdmin ? '#4ade80' : '#f87171', letterSpacing: '0.04em' }}>
                        {isUserAdmin ? 'ADMINISTRATOR LEVEL 5 // FULL CLEARANCE ACTIVE' : 'RESTRICTED OPERATOR // ELEVATION REQUIRED'}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: 2 }}>
                        {isUserAdmin
                          ? 'All features unlocked: Tactical Map, Subsystem Diagnostics, Face Profiles, System Settings & Desktop Control.'
                          : 'Select Protocol Admin to open the optical camera and identify the operator in front to unlock all features.'}
                      </div>
                    </div>
                  </div>

                  <div>
                    <button
                      type="button"
                      className="workspace-btn"
                      onClick={() => {
                        if (onActivateAdminProtocol) {
                          onActivateAdminProtocol();
                        } else {
                          window.dispatchEvent(new CustomEvent('oracle_activate_admin_protocol'));
                        }
                      }}
                      style={{
                        background: isUserAdmin ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                        borderColor: isUserAdmin ? '#22c55e' : '#ef4444',
                        color: isUserAdmin ? '#4ade80' : '#f87171',
                        fontWeight: 600,
                        padding: '8px 16px',
                        fontSize: '11px',
                        cursor: 'pointer'
                      }}
                    >
                      <Camera size={13} style={{ marginRight: 6 }} />
                      {isUserAdmin ? 'Re-verify Admin Protocol' : 'Select Protocol Admin'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Protocols Management Toolbar */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--muted)', letterSpacing: '0.05em' }}>
                  SYSTEM PROTOCOLS CATALOG ({protocols.length} PROTOCOLS AVAILABLE)
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    className="workspace-btn micro"
                    onClick={() => {
                      setEditingProtocol(null);
                      setIsEditorOpen(true);
                    }}
                    style={{
                      background: 'rgba(56, 189, 248, 0.15)',
                      borderColor: '#38bdf8',
                      color: '#38bdf8',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    <Plus size={11} style={{ marginRight: 4 }} /> Create Custom Protocol
                  </button>
                  <button
                    type="button"
                    className="workspace-btn micro secondary"
                    onClick={() => resetAllProtocols()}
                    title="Reset all modified or custom protocols to factory defaults"
                    style={{ cursor: 'pointer' }}
                  >
                    <RefreshCw size={10} style={{ marginRight: 4 }} /> Reset Defaults
                  </button>
                </div>
              </div>

              {/* Protocols Catalog */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px' }}>
                {protocols.map((proto) => {
                  const isAdminProto = proto.id === 'admin';
                  const isSpecialColor = isAdminProto ? (isUserAdmin ? '#4ade80' : '#f87171') : undefined;
                  const borderStyle = isAdminProto
                    ? (isUserAdmin ? '1px solid rgba(34, 197, 94, 0.35)' : '1px solid rgba(239, 68, 68, 0.35)')
                    : '1px solid var(--border-subtle)';

                  return (
                    <article
                      key={proto.id}
                      className="workspace-item-card"
                      style={{
                        border: borderStyle,
                        background: 'rgba(10, 14, 23, 0.85)'
                      }}
                    >
                      <div className="workspace-item-head">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span
                            className="workspace-badge tag"
                            style={{
                              color: isSpecialColor,
                              borderColor: isAdminProto ? (isUserAdmin ? '#22c55e' : '#ef4444') : undefined
                            }}
                          >
                            {proto.code}
                          </span>
                          <h3 className="workspace-item-title" style={{ color: isSpecialColor }}>
                            {proto.name} · {proto.summary}
                          </h3>
                        </div>
                        <span
                          className="workspace-badge"
                          style={{
                            color: isAdminProto ? (isUserAdmin ? '#4ade80' : '#f59e0b') : '#9db4d3'
                          }}
                        >
                          {isAdminProto ? (isUserAdmin ? 'UNLOCKED' : 'ACTION REQUIRED') : proto.badge}
                        </span>
                      </div>

                      <p className="workspace-item-body">{proto.description}</p>

                      {/* Permissions Matrix Breakdown */}
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr',
                          gap: '8px',
                          margin: '10px 0',
                          padding: '8px 12px',
                          background: 'rgba(255, 255, 255, 0.02)',
                          borderRadius: '6px',
                          border: '1px solid rgba(255, 255, 255, 0.05)',
                          fontSize: '11px'
                        }}
                      >
                        <div>
                          <span style={{ color: 'var(--muted)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Standard Mode:
                          </span>
                          <div style={{ color: 'var(--fg)', marginTop: 2 }}>{proto.standardMode}</div>
                        </div>
                        <div>
                          <span style={{ color: '#38bdf8', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Admin Mode:
                          </span>
                          <div style={{ color: '#bae6fd', marginTop: 2 }}>{proto.adminMode}</div>
                        </div>
                      </div>

                      <div className="workspace-item-footer" style={{ marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                        <div style={{ fontSize: '10px', color: 'var(--muted)', fontFamily: "'JetBrains Mono', monospace" }}>
                          VOICE PHRASES: {proto.voicePhrases.map(p => `"${p}"`).join(' · ')}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {!isAdminProto && proto.id !== 'lockdown' && <button
                            type="button"
                            className="workspace-btn micro secondary"
                            onClick={() => {
                              setEditingProtocol(proto);
                              setIsEditorOpen(true);
                            }}
                            title="Edit and customize this protocol"
                            style={{ cursor: 'pointer' }}
                          >
                            <Edit3 size={11} style={{ marginRight: 4 }} /> Customize
                          </button>}

                          {proto.isCustom && (
                            <button
                              type="button"
                              className="workspace-btn micro danger"
                              onClick={() => deleteProtocol(proto.id)}
                              title="Delete custom protocol"
                              style={{ cursor: 'pointer' }}
                            >
                              <Trash2 size={11} />
                            </button>
                          )}

                          <button
                            type="button"
                            className={`workspace-btn micro ${isAdminProto ? '' : proto.id === 'lockdown' ? 'danger' : 'secondary'}`}
                            onClick={() => {
                              if (isAdminProto) {
                                if (onActivateAdminProtocol) {
                                  onActivateAdminProtocol();
                                } else {
                                  executeProtocol('admin', isUserAdmin);
                                }
                              } else {
                                executeProtocol(proto.id, isUserAdmin);
                              }
                            }}
                            style={isAdminProto ? {
                              background: isUserAdmin ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                              borderColor: isUserAdmin ? '#22c55e' : '#ef4444',
                              color: isUserAdmin ? '#4ade80' : '#f87171',
                              fontWeight: 600,
                              cursor: 'pointer'
                            } : undefined}
                          >
                            {isAdminProto && <Camera size={11} style={{ marginRight: 5 }} />}
                            {proto.id === 'sentinel' && <ShieldCheck size={11} style={{ marginRight: 5 }} />}
                            {proto.id === 'ghost' && <EyeOff size={11} style={{ marginRight: 5 }} />}
                            {proto.id === 'focus' && <Sparkles size={11} style={{ marginRight: 5 }} />}
                            {proto.id === 'diagnostic' && <Activity size={11} style={{ marginRight: 5 }} />}
                            {proto.id === 'command' && <Terminal size={11} style={{ marginRight: 5 }} />}
                            {proto.id === 'atlas' && <Compass size={11} style={{ marginRight: 5 }} />}
                            {proto.id === 'watchtower' && <Wifi size={11} style={{ marginRight: 5 }} />}
                            {proto.id === 'briefing' && <Sun size={11} style={{ marginRight: 5 }} />}
                            {proto.id === 'hibernate' && <Moon size={11} style={{ marginRight: 5 }} />}
                            {proto.id === 'lockdown' && <Lock size={11} style={{ marginRight: 5 }} />}
                            {isAdminProto
                              ? (isUserAdmin ? 'Select Protocol Admin (Re-verify)' : 'Select Protocol Admin (Scan Camera)')
                              : `Select ${proto.name}`}
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <ProtocolEditorModal
          isOpen={isEditorOpen}
          protocol={editingProtocol}
          onClose={() => {
            setIsEditorOpen(false);
            setEditingProtocol(null);
          }}
          onSaved={() => {
            setProtocols(getStoredProtocols());
          }}
        />
      </motion.div>
    </div>
  );
}
