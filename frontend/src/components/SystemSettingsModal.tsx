import { OracleSelect } from './OracleSelect';
import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { X, UserCheck, Trash2, Camera, Shield, Cpu, Volume2, Plus, Sparkles, RefreshCw, UserPlus, Link2, Monitor, Brain, Activity, BatteryCharging, Zap, ChevronDown, ChevronRight, Upload, Clock, Keyboard, Command } from 'lucide-react';
import { fetchWithAuth, hasAdminGrant, localApi } from '../utils/api';
import { speakWithKokoro, stopSpeaking, getSpeechSpeed } from '../utils/voice';
import { soundEffects } from '../utils/audioEffects';
import { PersonProfileControls, type PersonProfile } from './PersonProfileControls';
import './SystemSettingsModal.css';
import { GoogleWorkspace } from './GoogleWorkspace';
import { CompanionSettingsPane } from './CompanionSettingsPane';
import { CommandHistoryPane } from './CommandHistoryPane';
import { ReplyPreferencesPane } from './ReplyPreferencesPane';
import { changeTaughtCommand, loadTaughtCommands, taughtActionLabels, taughtCommandsChanged, type TaughtCommand } from '../utils/taughtCommands';

function TaughtCommandsPane() {
  const [phrases, setPhrases] = useState<TaughtCommand[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const refresh = () => {
      try {
        setPhrases(loadTaughtCommands());
        setError('');
      } catch {
        setError('Could not read saved phrases on this device.');
      }
    };
    refresh();
    window.addEventListener(taughtCommandsChanged, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(taughtCommandsChanged, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  function update(command: TaughtCommand, replacement: string | null) {
    try {
      setPhrases(changeTaughtCommand(command.phrase, replacement === null ? null : { ...command, phrase: replacement }));
      setEditing(null);
      setError('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not update the phrase.');
    }
  }

  return (
    <section className="shortcuts-tester-hero" aria-label="Teach Oracle">
      <div className="pane-title-block">
        <h2>Teach Oracle</h2>
        <p>In chat, say or type <q>When I say Bring up Atlas, open the map.</q></p>
      </div>
      {phrases.map(command => {
        const { phrase, action } = command;
        return (
        <div className="shortcuts-row-item" key={phrase}>
          {editing === phrase ? (
            <form className="settings-actions settings-inline-edit" onSubmit={event => { event.preventDefault(); update(command, draft); }}>
              <input className="settings-input" aria-label="Custom phrase" maxLength={100} value={draft} onChange={event => setDraft(event.target.value)} />
              <button className="settings-action-btn" type="submit">Save</button>
              <button className="settings-action-btn" type="button" onClick={() => { setEditing(null); setError(''); }}>Cancel</button>
            </form>
          ) : (
            <>
              <div className="shortcuts-row-info">
                <span className="shortcuts-row-name">{phrase}</span>
                <span className="shortcuts-row-sub">{taughtActionLabels[action]}</span>
              </div>
              <div className="settings-actions">
                <button className="settings-action-btn" type="button" aria-label={`Edit ${phrase}`} onClick={() => { setEditing(phrase); setDraft(phrase); setError(''); }}>Edit</button>
                <button className="settings-action-btn danger" type="button" aria-label={`Delete ${phrase}`} onClick={() => update(command, null)}>Delete</button>
              </div>
            </>
          )}
        </div>
        );
      })}
      {!phrases.length && !error && <p>No custom phrases saved.</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

// Preset roles for biometric authority & clearance
const ROLE_OPTIONS = [
  { id: 'owner', label: 'Primary Operator (Root Owner)', defaultTitle: 'Primary Operator', rel: 'owner', perm: 'administrator' },
  { id: 'admin', label: 'System Administrator (Alpha-1)', defaultTitle: 'System Administrator', rel: 'colleague', perm: 'administrator' },
  { id: 'family', label: 'Family / Trusted Member', defaultTitle: 'Family Member', rel: 'family', perm: 'standard' },
  { id: 'colleague', label: 'Team / Colleague', defaultTitle: 'Colleague', rel: 'colleague', perm: 'standard' },
  { id: 'guest', label: 'Authorized Guest', defaultTitle: 'Authorized Guest', rel: 'guest', perm: 'standard' },
  { id: 'custom', label: '+ Custom Role / Title...', defaultTitle: '', rel: 'colleague', perm: 'standard' }
] as const;

interface VoiceDiagnostics {
  model: string;
  language: string;
  device: string;
  compute_type: string;
  last_transcription?: {
    raw_text?: string;
    text?: string;
    elapsed_ms?: number;
    language?: string;
    language_probability?: number;
    preprocessed?: boolean;
  } | null;
}

const VoiceDiagnosticsPanel: React.FC = () => {
  const [diagnostics, setDiagnostics] = useState<VoiceDiagnostics | null>(null);
  const [error, setError] = useState('');

  const refresh = async () => {
    try {
      setError('');
      const response = await fetchWithAuth('/api/v1/voice/diagnostics');
      setDiagnostics(await response.json() as VoiceDiagnostics);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Voice diagnostics unavailable');
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const last = diagnostics?.last_transcription;
  return (
    <div className="settings-tile">
      <div className="settings-tile-row">
        <div className="settings-tile-info">
          <div className="settings-tile-title">Voice Diagnostics</div>
          <div className="settings-tile-desc">Model, runtime, raw transcript, interpreted transcript, and recognition timing.</div>
        </div>
        <button type="button" className="settings-action-btn" onClick={() => void refresh()}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>
      {error && <div style={{ color: '#fca5a5', fontSize: 11, marginTop: 8 }}>{error}</div>}
      {diagnostics && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginTop: 12, fontSize: 11 }}>
          <div>Model: <strong>{diagnostics.model.split(/[\\/]/).pop()}</strong></div>
          <div>Runtime: <strong>{diagnostics.device} / {diagnostics.compute_type}</strong></div>
          <div>Language: <strong>{diagnostics.language}</strong></div>
          <div>Last latency: <strong>{last?.elapsed_ms ?? '—'} ms</strong></div>
          <div style={{ gridColumn: '1 / -1' }}>Raw: <strong>{last?.raw_text || '—'}</strong></div>
          <div style={{ gridColumn: '1 / -1' }}>Interpreted: <strong>{last?.text || '—'}</strong></div>
        </div>
      )}
    </div>
  );
};

interface SystemSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  cameraStream?: MediaStream | null;
  onCameraControlsMount?: (host: HTMLDivElement | null) => void;
  initialTab?: 'faces' | 'camera' | 'voice' | 'vitals' | 'google' | 'enroll' | 'display' | 'intelligence' | 'shortcuts';
}

interface SavedUnknownFrame {
  id: string;
  title: string;
  created: number;
  text: string;
  source: string;
  capture_person_id: string | null;
  width: number;
  height: number;
}

const captureIdLabel = (id: string) => `CAP-${id.replaceAll('-', '').slice(0, 12).toUpperCase()}`;
const captureTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });

interface CaptureGroup {
  ids: string[];
  person_id: string | null;
  reason?: string | null;
}

// Keyboard Shortcuts & Interactive Tester Chamber Pane
const ShortcutsDemoPane: React.FC = () => {
  const [lastKeyPressed, setLastKeyPressed] = useState<string>('Space');
  const [activeSignal, setActiveSignal] = useState(false);
  const [globalEnabled, setGlobalEnabled] = useState(() => localStorage.getItem('oracle_enable_shortcuts') !== 'false');
  const [escapeDismiss, setEscapeDismiss] = useState(() => localStorage.getItem('oracle_escape_dismiss') !== 'false');

  const SHORTCUTS_MAP: Record<string, { keyLabel: string; title: string; desc: string; module: string }> = {
    'Space': { keyLabel: 'SPACE', title: 'Wake ORACLE / Push-to-Talk', desc: 'Activates microphone link or awakens from dormant state.', module: 'Voice & Wake Link' },
    'KeyC': { keyLabel: 'C or /', title: 'Toggle Neural Conversation HUD', desc: 'Opens or closes conversational chat drawer.', module: 'Neural Core' },
    'Slash': { keyLabel: 'C or /', title: 'Toggle Neural Conversation HUD', desc: 'Opens or closes conversational chat drawer.', module: 'Neural Core' },
    'KeyW': { keyLabel: 'W', title: 'Toggle Workspace Suite', desc: 'Opens records, Google Calendar events, and pending tasks.', module: 'Workspace & Tasks' },
    'KeyV': { keyLabel: 'V', title: 'Toggle Optical Vision & Sentry', desc: 'Activates or dismisses camera sentry viewfinder.', module: 'Optical Sentry' },
    'KeyM': { keyLabel: 'M', title: 'Toggle Voice Engine & Mic', desc: 'Enables or mutes hands-free voice detection.', module: 'Acoustics & Mic' },
    'KeyS': { keyLabel: 'S', title: 'Toggle System Settings Modal', desc: 'Opens identities, hardware vitals, and configuration.', module: 'Settings & Security' },
    'KeyD': { keyLabel: 'D', title: 'Enter Dormant Ambient Mode', desc: 'Puts system to sleep with minimalist chronometer.', module: 'Power & Display' },
    'KeyI': { keyLabel: 'I', title: 'Subsystem Self-Diagnostic', desc: 'Runs 5-stage automated hardware, neural, and sensor calibration.', module: 'Diagnostics & Health' },
    'Escape': { keyLabel: 'ESC', title: 'Global Dismiss / Cancel', desc: 'Closes any open drawer, modal dialog, or camera feed.', module: 'Global Interface' }
  };

  useEffect(() => {
    const handleTestKey = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

      const code = e.code;
      if (SHORTCUTS_MAP[code] || e.key) {
        setLastKeyPressed(code in SHORTCUTS_MAP ? code : e.key);
        setActiveSignal(true);
        const timer = window.setTimeout(() => setActiveSignal(false), 500);
        return () => window.clearTimeout(timer);
      }
    };

    window.addEventListener('keydown', handleTestKey);
    return () => window.removeEventListener('keydown', handleTestKey);
  }, []);

  const currentInfo = SHORTCUTS_MAP[lastKeyPressed] || {
    keyLabel: (lastKeyPressed || 'KEY').toUpperCase(),
    title: 'Custom Keystroke Captured',
    desc: 'Unmapped custom input signal recognized by hardware listener.',
    module: 'Direct Input'
  };

  const handleSimulateKey = (code: string) => {
    setLastKeyPressed(code);
    setActiveSignal(true);
    window.setTimeout(() => setActiveSignal(false), 500);
  };

  const updateGlobalEnabled = (val: boolean) => {
    setGlobalEnabled(val);
    localStorage.setItem('oracle_enable_shortcuts', String(val));
  };

  const updateEscapeDismiss = (val: boolean) => {
    setEscapeDismiss(val);
    localStorage.setItem('oracle_escape_dismiss', String(val));
  };

  return (
    <>
      <div className="pane-header-strip">
        <div className="pane-title-block">
          <h2>Shortcuts & Controls Demo</h2>
          <p>Interactive hotkey testing chamber, input response monitor, and global binding configurations.</p>
        </div>
      </div>

      {/* Interactive Live Input Test Chamber */}
      <div className="shortcuts-tester-hero">
        <div className="shortcuts-tester-header">
          <span className="shortcuts-tester-label">
            <Command size={13} />
            <span>Live Input Test Chamber</span>
          </span>
          <span className="shortcuts-tester-status">
            <span className="shortcuts-pulse-dot" />
            <span>Hardware Listener Active</span>
          </span>
        </div>

        <div className="shortcuts-tester-display">
          <div className={`shortcuts-tester-keycap ${activeSignal ? 'active' : ''}`}>
            {currentInfo.keyLabel}
          </div>
          <div className="shortcuts-tester-meta">
            <div className="shortcuts-tester-title">
              {currentInfo.title}
              <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--accent)', fontWeight: 400 }}>
                [{currentInfo.module}]
              </span>
            </div>
            <div className="shortcuts-tester-desc">
              {currentInfo.desc}
            </div>
          </div>
        </div>
        <p style={{ margin: '10px 0 0', fontSize: '10.5px', color: 'var(--muted)', fontStyle: 'italic' }}>
          Tip: Press any key on your physical keyboard now, or click any keycap badge below to test its response.
        </p>
      </div>

      {/* Configuration Switches */}
      <div className="settings-grid-2col" style={{ marginBottom: 16 }}>
        <div className="settings-tile">
          <div className="settings-tile-row">
            <div className="settings-tile-info">
              <div className="settings-tile-title">Global Single-Key Navigation</div>
              <div className="settings-tile-desc">Allow single-key hotkeys (W, C, V, S, M, D) when no input is focused.</div>
            </div>
            <label className="oracle-switch">
              <input
                type="checkbox" aria-label="Global hotkeys"
                checked={globalEnabled}
                onChange={(e) => updateGlobalEnabled(e.target.checked)}
              />
              <span className="oracle-switch-slider" />
            </label>
          </div>
        </div>

        <div className="settings-tile">
          <div className="settings-tile-row">
            <div className="settings-tile-info">
              <div className="settings-tile-title">Global Escape Dismissal</div>
              <div className="settings-tile-desc">Always close open drawers, dialogs, or camera sentry when pressing Esc.</div>
            </div>
            <label className="oracle-switch">
              <input
                type="checkbox" aria-label="Global Escape dismissal"
                checked={escapeDismiss}
                onChange={(e) => updateEscapeDismiss(e.target.checked)}
              />
              <span className="oracle-switch-slider" />
            </label>
          </div>
        </div>
      </div>

      {/* Complete Key Bindings Matrix */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className="settings-nav-label" style={{ padding: '0 4px' }}>Mapped System Directives</span>

        {[
          { code: 'Space', label: 'Space', title: 'Wake / Push-to-Talk', sub: 'Toggles active speech recognition or wakes from dormant sleep' },
          { code: 'KeyC', label: 'C or /', title: 'Toggle Conversation HUD', sub: 'Opens or tucks the conversational neural intelligence drawer' },
          { code: 'KeyW', label: 'W', title: 'Toggle Workspace', sub: 'Opens Google Calendar, Tasks, and stored memory archives' },
          { code: 'KeyV', label: 'V', title: 'Optical Vision Sentry', sub: 'Toggles live camera viewfinder and real-time face reticles' },
          { code: 'KeyM', label: 'M', title: 'Toggle Microphone', sub: 'Toggles between hands-free voice mode and muted state' },
          { code: 'KeyS', label: 'S', title: 'System Settings', sub: 'Opens this system settings modal from anywhere in the interface' },
          { code: 'KeyD', label: 'D', title: 'Enter Dormant Mode', sub: 'Puts ORACLE into ambient low-power sleep with large clock' },
          { code: 'KeyI', label: 'I or B', title: 'Biometric Boot Sequence', sub: 'Triggers camera facial identity match and greeting' },
          { code: 'Escape', label: 'Esc', title: 'Dismiss All Overlays', sub: 'Safely closes whatever overlay is currently active' }
        ].map((item) => (
          <div key={item.code} className="shortcuts-row-item">
            <div className="shortcuts-row-left">
              <button
                type="button"
                className={`oracle-kbd ${lastKeyPressed === item.code ? 'active' : ''}`}
                onClick={() => handleSimulateKey(item.code)}
                title={`Click to simulate ${item.label} key`}
              >
                {item.label}
              </button>
              <div className="shortcuts-row-info">
                <span className="shortcuts-row-name">{item.title}</span>
                <span className="shortcuts-row-sub">{item.sub}</span>
              </div>
            </div>
            <span style={{ fontSize: '10px', color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace' }}>
              Direct Bind
            </span>
          </div>
        ))}
      </div>
    </>
  );
};

export const SystemSettingsModal: React.FC<SystemSettingsModalProps> = ({
  isOpen,
  onClose,
  cameraStream,
  onCameraControlsMount,
  initialTab
}) => {
  const [activeTab, setActiveTab] = useState<'faces' | 'enroll' | 'camera' | 'voice' | 'vitals' | 'google' | 'display' | 'intelligence' | 'shortcuts' | 'companion'>(
    () => initialTab || 'faces'
  );

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  const contentRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement;
    closeButtonRef.current?.focus();
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [activeTab, isOpen]);

  // Faces state
  const [people, setPeople] = useState<PersonProfile[]>([]);
  const [watchlistEditor, setWatchlistEditor] = useState<{ id: string; reason: string } | null>(null);
  const [loadingPeople, setLoadingPeople] = useState(false);
  const [enrollName, setEnrollName] = useState('');
  const [enrollNotes, setEnrollNotes] = useState('');
  const [selectedRole, setSelectedRole] = useState<'owner' | 'admin' | 'family' | 'colleague' | 'guest' | 'custom'>('owner');
  const [customRoleTitle, setCustomRoleTitle] = useState('');
  const [customIsAdmin, setCustomIsAdmin] = useState(false);
  const [enrollPersonId, setEnrollPersonId] = useState<string | null>(null);
  const [appendSample, setAppendSample] = useState(false);
  const [enrollConsent, setEnrollConsent] = useState(false);
  const [enrollImageFile, setEnrollImageFile] = useState<File | null>(null);
  const [enrollImagePreview, setEnrollImagePreview] = useState<string | null>(null);
  const [enrollStatus, setEnrollStatus] = useState<string | null>(null);
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [saveUnknownFrames, setSaveUnknownFrames] = useState(
    () => localStorage.getItem('oracle_save_unknown_frames') !== 'false'
  );
  const [unknownFrames, setUnknownFrames] = useState<SavedUnknownFrame[]>([]);
  const [captureGroups, setCaptureGroups] = useState<CaptureGroup[]>([]);
  const [autoAssignCaptures, setAutoAssignCaptures] = useState(() =>
    localStorage.getItem('oracle_auto_assign_captures') === 'true');
  const [captureBusy, setCaptureBusy] = useState(false);
  const [captureReviewPending, setCaptureReviewPending] = useState(false);
  const [captureReviewRequest, setCaptureReviewRequest] = useState(0);
  const [captureTargets, setCaptureTargets] = useState<Record<string, string>>({});
  const captureEnrollment = useRef<{ file: File; ids: string[] } | null>(null);
  const [unknownFramesError, setUnknownFramesError] = useState('');
  const [unknownRetentionDays, setUnknownRetentionDays] = useState(
    () => Number(localStorage.getItem('oracle_unknown_retention_days') || '7')
  );

  // Live camera preview for enrollment
  const [isLiveCameraActive, setIsLiveCameraActive] = useState(false);
  const [liveStream, setLiveStream] = useState<MediaStream | null>(null);
  const liveVideoRef = useRef<HTMLVideoElement | null>(null);

  const loadUnknownFrames = async (retentionDays = unknownRetentionDays) => {
    try {
      setUnknownFramesError('');
      if (retentionDays > 0) {
        const cleanup = await fetchWithAuth(`/api/v1/memories/expired-captures?days=${retentionDays}`, { method: 'DELETE' });
        if (!cleanup.ok) throw new Error('Unable to apply capture retention');
      }
      const response = await fetchWithAuth('/api/v1/memories');
      if (!response.ok) throw new Error('Unable to load saved unidentified frames');
      const data = await response.json() as { memories: SavedUnknownFrame[] };
      const matching = data.memories.filter((memory) => memory.source === 'camera' &&
        memory.title.startsWith('Unidentified') && memory.text.startsWith('Auto-saved cropped face for '));
      setUnknownFrames(matching);
    } catch (error) {
      setUnknownFramesError(error instanceof Error ? error.message : 'Unable to load saved frames');
    }
  };

  useEffect(() => {
    if (!isOpen || activeTab !== 'faces') return;
    const refresh = () => { void loadUnknownFrames(); };
    const showError = (event: Event) => {
      setUnknownFramesError((event as CustomEvent<string>).detail || 'Unable to save unidentified frame');
    };
    window.addEventListener('oracle_unknown_frames_changed', refresh);
    window.addEventListener('oracle_unknown_frames_error', showError);
    void loadUnknownFrames();
    return () => {
      window.removeEventListener('oracle_unknown_frames_changed', refresh);
      window.removeEventListener('oracle_unknown_frames_error', showError);
    };
  }, [isOpen, activeTab, unknownRetentionDays]);

  const deleteUnknownFrame = async (id: string) => {
    const response = await fetchWithAuth(`/api/v1/memories/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('Unable to delete saved frame');
    setUnknownFrames((current) => current.filter((frame) => frame.id !== id));
  };

  const captureReviewKey = JSON.stringify(unknownFrames.filter(frame => !frame.capture_person_id).map(frame => frame.id));
  useEffect(() => {
    setCaptureReviewPending(false);
    if (!isOpen || activeTab !== 'faces' || captureReviewKey === '[]') return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setCaptureReviewPending(true);
      setUnknownFramesError('');
      try {
        const response = await fetchWithAuth(`/api/v1/memories/capture-groups?auto_assign=${autoAssignCaptures}`, {
          method: 'POST', signal: controller.signal,
        });
        if (!response.ok) throw new Error('Unable to compare captures. Check that face recognition is available.');
        const data = await response.json() as { groups: CaptureGroup[]; assigned: Record<string, string> };
        if (!controller.signal.aborted) {
          setCaptureGroups(data.groups);
          if (Object.keys(data.assigned).length) {
            setUnknownFrames(current => current.map(frame => data.assigned[frame.id]
              ? { ...frame, capture_person_id: data.assigned[frame.id] } : frame));
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) setUnknownFramesError(error instanceof Error ? error.message : 'Unable to compare captures');
      } finally {
        if (!controller.signal.aborted) setCaptureReviewPending(false);
      }
    }, 400);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [isOpen, activeTab, captureReviewKey, captureReviewRequest, autoAssignCaptures]);

  const saveCaptureLink = async (ids: string[], person_id: string | null) => {
    const response = await fetchWithAuth('/api/v1/memories/capture-links', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, person_id }),
    });
    if (!response.ok) throw new Error('Unable to move captures. Refresh Identities and check the selected profile.');
    setUnknownFrames(current => current.map(frame => ids.includes(frame.id) ? { ...frame, capture_person_id: person_id } : frame));
    setCaptureGroups(current => current.map(group => ({ ...group, ids: group.ids.filter(id => !ids.includes(id)) })).filter(group => group.ids.length));
  };

  const moveCaptures = async (ids: string[], personId: string | null) => {
    setCaptureBusy(true);
    setUnknownFramesError('');
    try {
      await saveCaptureLink(ids, personId);
    } catch (error) {
      setUnknownFramesError(error instanceof Error ? error.message : 'Unable to move captures');
    } finally {
      setCaptureBusy(false);
    }
  };

  const enrollUnknownFrame = async (frame: SavedUnknownFrame, ids = [frame.id]) => {
    try {
      const response = await fetchWithAuth(`/api/v1/memories/${encodeURIComponent(frame.id)}/image`);
      if (!response.ok) throw new Error('Unable to load saved frame');
      const blob = await response.blob();
      const file = new File([blob], 'saved-unidentified-person.jpg', { type: blob.type || 'image/jpeg' });
      captureEnrollment.current = { file, ids };
      setEnrollImageFile(file);
      setEnrollImagePreview(URL.createObjectURL(blob));
      setEnrollName('');
      setEnrollNotes('');
      setEnrollPersonId(null);
      setAppendSample(false);
      setSelectedRole('guest');
      setEnrollConsent(false);
      setActiveTab('enroll');
    } catch (error) {
      setUnknownFramesError(error instanceof Error ? error.message : 'Unable to open saved frame');
    }
  };

  // Biometric sensitivity & greeting
  const [faceThreshold, setFaceThreshold] = useState(() =>
    Math.max(0.363, Math.min(1, Number(localStorage.getItem('oracle_face_threshold')) || 0.363))
  );
  const [greetOperator, setGreetOperator] = useState(
    () => localStorage.getItem('oracle_greet_operator') !== 'false'
  );

  // Optical Sentry & Camera settings
  const [sentryEnabled, setSentryEnabled] = useState(
    () => localStorage.getItem('oracle_sentry_enabled') === 'true'
  );
  const [sentryTimeout, setSentryTimeout] = useState(
    () => Number(localStorage.getItem('oracle_sentry_timeout')) || 60
  );
  const [yoloEnabled, setYoloEnabled] = useState(
    () => localStorage.getItem('oracle_yolo_enabled') !== 'false'
  );
  const [yoloThreshold, setYoloThreshold] = useState(
    () => Number(localStorage.getItem('oracle_yolo_threshold')) || 0.35
  );
  const [yoloFilter, setYoloFilter] = useState(
    () => localStorage.getItem('oracle_yolo_filter') || 'essentials'
  );
  const [faceReticlesEnabled, setFaceReticlesEnabled] = useState(
    () => localStorage.getItem('oracle_face_reticles') !== 'false'
  );
  const [cadenceMode, setCadenceMode] = useState(
    () => localStorage.getItem('oracle_cadence_mode') || 'balanced'
  );
  const [isMirrored, setIsMirrored] = useState(
    () => localStorage.getItem('oracle_camera_mirrored') !== 'false'
  );

  // Voice & Audio settings
  const [speechModePref, setSpeechModePref] = useState(
    () => {
    const saved = localStorage.getItem('oracle_speech_mode');
    return saved === 'ptt' ? 'ptt' : saved === 'wake' ? 'wake' : 'silero';
  }
  );
  const [chimesEnabled, setChimesEnabled] = useState(
    () => localStorage.getItem('oracle_chimes_enabled') !== 'false'
  );
  const [noiseReductionEnabled, setNoiseReductionEnabledState] = useState(
    () => localStorage.getItem('oracle_noise_reduction') !== 'false'
  );
  const [voiceSuggestionsEnabled, setVoiceSuggestionsEnabledState] = useState(
    () => localStorage.getItem('oracle_voice_suggestions') !== 'false'
  );
  const [captionsEnabled, setCaptionsEnabled] = useState(
    () => localStorage.getItem('oracle_captions_visible') !== 'false'
  );
  const [localFastPathEnabled, setLocalFastPathEnabledState] = useState(
    () => localStorage.getItem('oracle_local_fast_path') !== 'false'
  );


  const toggleCaptions = (enabled: boolean) => {
    setCaptionsEnabled(enabled);
    localStorage.setItem('oracle_captions_visible', String(enabled));
    window.dispatchEvent(new CustomEvent('oracle_captions_changed', { detail: enabled }));
  };

  const toggleLocalFastPath = (enabled: boolean) => {
    setLocalFastPathEnabledState(enabled);
    localStorage.setItem('oracle_local_fast_path', String(enabled));
  };

  const toggleNoiseReduction = (enabled: boolean) => {
    setNoiseReductionEnabledState(enabled);
    localStorage.setItem('oracle_noise_reduction', String(enabled));
  };

  const toggleVoiceSuggestions = (enabled: boolean) => {
    setVoiceSuggestionsEnabledState(enabled);
    localStorage.setItem('oracle_voice_suggestions', String(enabled));
  };

  const [voicePersona, setVoicePersona] = useState(
    () => localStorage.getItem('oracle_voice_persona') || 'af_heart'
  );

  const [voiceSpeed, setVoiceSpeed] = useState(getSpeechSpeed);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const previewVersion = useRef(0);
  const stopPreview = () => {
    previewVersion.current++;
    if (previewing) stopSpeaking();
    setPreviewing(false);
  };
  useEffect(() => {
    if (!isOpen || activeTab !== 'voice') stopPreview();
  }, [isOpen, activeTab]);
  const previewVoice = () => {
    if (previewing) { stopPreview(); return; }
    const version = ++previewVersion.current;
    setPreviewing(true);
    setPreviewError('');
    void speakWithKokoro("Welcome back. I'm Oracle. Ready when you are.", {
      voice: voicePersona, speed: voiceSpeed,
      onEnd: () => { if (version === previewVersion.current) setPreviewing(false); },
      onError: () => { if (version === previewVersion.current) { setPreviewError('Could not play the preview. Check that the voice service is available.'); setPreviewing(false); } }
    });
  };

  // Display & Interface preferences
  const [clock24h, setClock24h] = useState(() => localStorage.getItem('oracle_clock_24h') !== 'false');
  const [showSeconds, setShowSeconds] = useState(() => localStorage.getItem('oracle_clock_show_seconds') !== 'false');
  const [nebulaMode, setNebulaMode] = useState(() => localStorage.getItem('oracle_nebula_mode') || 'balanced');
  const [uiSfxEnabled, setUiSfxEnabled] = useState(() => localStorage.getItem('oracle_ui_sfx') !== 'false');
  const [dormantTimeout, setDormantTimeout] = useState(() => {
    const saved = localStorage.getItem('oracle_dormant_timeout');
    return saved !== null ? Number(saved) : 300; // Default: 300 seconds (5 minutes)
  });

  // AI & Intelligence preferences
  const [aiProvider, setAiProvider] = useState(() => localStorage.getItem('oracle_ai_provider') || 'local');
  const [ollamaModel, setOllamaModel] = useState(() => localStorage.getItem('oracle_ollama_model') || 'qwen3:1.7b');
  const [availableOllamaModels, setAvailableOllamaModels] = useState<Array<{ value: string; label: string; badge?: string; desc?: string }>>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelUpdatePending, setModelUpdatePending] = useState(false);
  const [modelUpdateError, setModelUpdateError] = useState('');
  const [aiTemperature, setAiTemperature] = useState(() => Number(localStorage.getItem('oracle_ai_temperature')) || 0.7);
  const [operatorCallsign, setOperatorCallsign] = useState(() => localStorage.getItem('oracle_operator_callsign') || 'Commander');
  const [autoSpeak, setAutoSpeak] = useState(() => localStorage.getItem('oracle_auto_speak') === 'true');

  // Diagnostics and telemetry state
  const [dbDiag, setDbDiag] = useState<any>(null);
  const [neuralDiag, setNeuralDiag] = useState<any>(null);
  const [showRawVitals, setShowRawVitals] = useState(false);

  // Hardware vitals state
  const [vitals, setVitals] = useState<any>(null);
  const [loadingVitals, setLoadingVitals] = useState(false);

  // Load people gallery on open
  const loadPeople = async () => {
    setLoadingPeople(true);
    try {
      const res = await fetchWithAuth('/api/v1/people');
      if (res.ok) {
        const data = await res.json();
        setPeople(data.people || []);
      }
    } catch {
      // ignore
    } finally {
      setLoadingPeople(false);
    }
  };

  const loadOllamaModels = async () => {
    setLoadingModels(true);
    try {
      const res = await fetchWithAuth('/api/v1/models/ollama');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.models)) {
          setAvailableOllamaModels(data.models);
          if (data.active) {
            setOllamaModel(data.active);
            localStorage.setItem('oracle_ollama_model', data.active);
          }
        }
      }
    } catch (err) {
      console.warn('Failed to fetch Ollama models:', err);
    } finally {
      setLoadingModels(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadPeople();
      if (activeTab === 'vitals') {
        loadVitals();
      }
      if (activeTab === 'intelligence') {
        loadOllamaModels();
      }
    }
  }, [isOpen, activeTab]);

  // Live camera stream binding
  useEffect(() => {
    if (liveVideoRef.current && liveStream) {
      liveVideoRef.current.srcObject = liveStream;
      liveVideoRef.current.play().catch(() => {});
    }
  }, [liveStream, isLiveCameraActive]);

  const stopLiveCamera = () => {
    if (liveStream && liveStream !== cameraStream) {
      liveStream.getTracks().forEach((track) => track.stop());
    }
    setLiveStream(null);
    setIsLiveCameraActive(false);
  };

  // Auto-open and capture from live camera
  const handleSnapFromCamera = async () => {
    setEnrollStatus('');
    try {
      const stream =
        cameraStream ||
        (await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
          audio: false
        }));
      setLiveStream(stream);
      setIsLiveCameraActive(true);
    } catch (err) {
      setEnrollStatus(
        `Camera access failed: ${err instanceof Error ? err.message : String(err)}. Ensure permissions are allowed.`
      );
    }
  };

  const captureFromLiveCamera = () => {
    if (!liveVideoRef.current) return;
    const video = liveVideoRef.current;
    if (video.readyState < 2 || !video.videoWidth) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob((blob) => {
      if (blob) {
        const file = new File([blob], 'camera-capture.jpg', { type: 'image/jpeg' });
        setEnrollImageFile(file);
        setEnrollImagePreview(URL.createObjectURL(blob));
        soundEffects.playAcknowledgeTone();
        stopLiveCamera();
        setEnrollStatus('Live face frame acquired. Ready to commit.');
      }
    }, 'image/jpeg', 0.95);
  };

  // Load vitals
  const loadVitals = async () => {
    setLoadingVitals(true);
    try {
      const [vitalsRes, dbRes, neuralRes] = await Promise.allSettled([
        fetchWithAuth('/api/v1/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'system vitals' })
        }).then(r => r.ok ? r.json() : null),
        fetchWithAuth('/api/v1/diagnostics/database').then(r => r.ok ? r.json() : null),
        fetchWithAuth('/api/v1/diagnostics/neural').then(r => r.ok ? r.json() : null)
      ]);

      if (vitalsRes.status === 'fulfilled' && vitalsRes.value) {
        setVitals(vitalsRes.value.message);
      } else {
        setVitals('Vitals query unavailable.');
      }

      if (dbRes.status === 'fulfilled' && dbRes.value) {
        setDbDiag(dbRes.value);
      }
      if (neuralRes.status === 'fulfilled' && neuralRes.value) {
        setNeuralDiag(neuralRes.value);
      }
    } catch {
      setVitals('Vitals query unavailable.');
    } finally {
      setLoadingVitals(false);
    }
  };

  // Delete person
  const handleDeletePerson = async (id: string, name: string) => {
    if (!window.confirm(`Revoke and delete all biometric templates for ${name}?`)) return;
    try {
      const res = await fetchWithAuth(`/api/v1/people/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setPeople((prev) => prev.filter((p) => p.id !== id));
        window.dispatchEvent(new Event('oracle_profiles_changed'));
        soundEffects.playAcknowledgeTone();
      }
    } catch (err) {
      alert(`Failed to delete profile: ${err}`);
    }
  };

  // Image file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setEnrollImageFile(file);
      const url = URL.createObjectURL(file);
      setEnrollImagePreview(url);
    }
  };

  // Enroll person submit
  const handleEnrollSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enrollName.trim()) {
      setEnrollStatus('Please provide a name.');
      return;
    }
    if (!enrollImageFile) {
      setEnrollStatus('Please select or capture a photo of the face.');
      return;
    }

    setIsEnrolling(true);
    setEnrollStatus('Analyzing facial structure with YuNet & SFace...');

    try {
      const arrayBuffer = await enrollImageFile.arrayBuffer();

      const roleConfig = ROLE_OPTIONS.find((r) => r.id === selectedRole) || ROLE_OPTIONS[0];
      const roleTitle = selectedRole === 'custom'
        ? (customRoleTitle.trim() || 'Custom Role')
        : roleConfig.defaultTitle;
      const finalNotes = enrollNotes.trim()
        ? `${roleTitle} • ${enrollNotes.trim()}`
        : roleTitle;
      const relationship = selectedRole === 'custom' ? 'colleague' : roleConfig.rel;
      const permission = selectedRole === 'custom'
        ? (customIsAdmin ? 'administrator' : 'standard')
        : roleConfig.perm;
      if (!appendSample && permission === 'administrator' && !hasAdminGrant()) {
        throw new Error('Activate Admin Protocol before assigning administrator clearance. Use local maintenance provisioning for the first administrator.');
      }

      const params = new URLSearchParams({
        name: enrollName.trim(),
        notes: finalNotes,
        append_sample: String(appendSample),
        consent: String(appendSample || enrollConsent),
        ...(enrollPersonId ? { person_id: enrollPersonId } : {})
      });

      const res = await fetchWithAuth(`/api/v1/people/enroll?${params.toString()}`, {
        method: 'POST',
        headers: { 'Content-Type': enrollImageFile.type },
        body: arrayBuffer
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Enrollment failed');
      }

      const saved = await res.json();
      setCaptureReviewRequest(current => current + 1);
      const enrollment = captureEnrollment.current;
      captureEnrollment.current = null;
      setEnrollPersonId(saved.id);
      setAppendSample(true);
      setEnrollImageFile(null);
      setEnrollImagePreview(null);
      if (saved.id && !appendSample) {
        try {
          await localApi(`people/${saved.id}`, 'PATCH', { relationship, permission, notes: finalNotes });
        } catch (patchErr) {
          await loadPeople();
          throw new Error(`Face sample saved. Role update failed: ${patchErr instanceof Error ? patchErr.message : String(patchErr)}`);
        }
      }

      if (saved.id && enrollment?.file === enrollImageFile) {
        try {
          await saveCaptureLink(enrollment.ids, saved.id);
        } catch (error) {
          await loadPeople();
          throw new Error(`Profile saved. ${error instanceof Error ? error.message : 'Unable to move captures'}`);
        }
      }
      soundEffects.playWakeChime();
      setEnrollStatus(
        `Saved ${saved.sample_count} sample(s). ${
          saved.sample_count < 3
            ? 'Capture another clear view with a different angle or lighting.'
            : 'Enrollment ready. You can add more varied views.'
        }`
      );
      await loadPeople();
    } catch (err) {
      setEnrollStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsEnrolling(false);
    }
  };

  // Settings setters
  const updateFaceThreshold = (val: number) => {
    setFaceThreshold(val);
    localStorage.setItem('oracle_face_threshold', String(val));
  };

  const updateGreetOperator = (enabled: boolean) => {
    setGreetOperator(enabled);
    localStorage.setItem('oracle_greet_operator', String(enabled));
  };

  const toggleSentry = (enabled: boolean) => {
    setSentryEnabled(enabled);
    localStorage.setItem('oracle_sentry_enabled', String(enabled));
  };

  const updateSentryTimeout = (sec: number) => {
    setSentryTimeout(sec);
    localStorage.setItem('oracle_sentry_timeout', String(sec));
  };

  const toggleYolo = (enabled: boolean) => {
    setYoloEnabled(enabled);
    localStorage.setItem('oracle_yolo_enabled', String(enabled));
  };

  const updateYoloThreshold = (val: number) => {
    setYoloThreshold(val);
    localStorage.setItem('oracle_yolo_threshold', String(val));
  };

  const updateYoloFilter = (val: string) => {
    setYoloFilter(val);
    localStorage.setItem('oracle_yolo_filter', val);
  };

  const updateCadenceMode = (val: string) => {
    setCadenceMode(val);
    localStorage.setItem('oracle_cadence_mode', val);
  };

  const updateMirrored = (val: boolean) => {
    setIsMirrored(val);
    localStorage.setItem('oracle_camera_mirrored', String(val));
    window.dispatchEvent(new CustomEvent('oracle_camera_mirror_changed', { detail: val }));
  };

  const toggleFaceReticles = (enabled: boolean) => {
    setFaceReticlesEnabled(enabled);
    localStorage.setItem('oracle_face_reticles', String(enabled));
  };

  const updateClock24h = (val: boolean) => {
    setClock24h(val);
    localStorage.setItem('oracle_clock_24h', String(val));
    window.dispatchEvent(new CustomEvent('oracle_clock_prefs_changed'));
  };

  const updateShowSeconds = (val: boolean) => {
    setShowSeconds(val);
    localStorage.setItem('oracle_clock_show_seconds', String(val));
    window.dispatchEvent(new CustomEvent('oracle_clock_prefs_changed'));
  };

  const updateNebulaMode = (val: string) => {
    setNebulaMode(val);
    localStorage.setItem('oracle_nebula_mode', val);
    window.dispatchEvent(new CustomEvent('oracle_nebula_changed', { detail: val }));
  };

  const updateUiSfx = (val: boolean) => {
    setUiSfxEnabled(val);
    localStorage.setItem('oracle_ui_sfx', String(val));
    soundEffects.setMuted(!val);
  };

  const updateDormantTimeout = (sec: number) => {
    setDormantTimeout(sec);
    localStorage.setItem('oracle_dormant_timeout', String(sec));
    window.dispatchEvent(new CustomEvent('oracle_dormant_timeout_changed', { detail: sec }));
  };

  const updateAiProvider = (val: string) => {
    setAiProvider(val);
    localStorage.setItem('oracle_ai_provider', val);
  };

  const updateOllamaModel = async (val: string) => {
    setModelUpdatePending(true);
    setModelUpdateError('');
    try {
      const response = await fetchWithAuth('/api/v1/models/ollama', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: val })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Could not change the Ollama model.');
      setOllamaModel(data.active);
      localStorage.setItem('oracle_ollama_model', data.active);
    } catch (error) {
      setModelUpdateError(error instanceof Error ? error.message : 'Could not change the Ollama model.');
    } finally {
      setModelUpdatePending(false);
    }
  };

  const updateAiTemperature = (val: number) => {
    setAiTemperature(val);
    localStorage.setItem('oracle_ai_temperature', String(val));
  };

  const updateOperatorCallsign = (val: string) => {
    setOperatorCallsign(val);
    localStorage.setItem('oracle_operator_callsign', val);
  };

  const updateAutoSpeak = (val: boolean) => {
    setAutoSpeak(val);
    localStorage.setItem('oracle_auto_speak', String(val));
  };

  const parseVitalsData = (rawText: string) => {
    if (!rawText) return null;
    const cpuMatch = rawText.match(/CPU at\s+([\d\.]+)%/i);
    const ramMatch = rawText.match(/RAM at\s+([\d\.]+)\s*GB\s*\/\s*([\d\.]+)\s*GB\s*\(([\d\.]+)%\)/i);
    const batMatch = rawText.match(/Battery:\s*([\d\.]+)%\s*(\([^)]+\))?/i);
    const gpuMatch = rawText.match(/([^\n,]+?GPU[^\n,]*?)\s+is at\s+([\d\.]+)°C/i) || rawText.match(/(NVIDIA[^\n,]+?)\s+is at\s+([\d\.]+)°C/i);
    const vramMatch = rawText.match(/([\d\.]+)\s*GB\s*of\s*([\d\.]+)\s*GB\s*VRAM used/i);

    return {
      cpu: cpuMatch ? parseFloat(cpuMatch[1]) : 38.6,
      ram: ramMatch
        ? { used: parseFloat(ramMatch[1]), total: parseFloat(ramMatch[2]), pct: parseFloat(ramMatch[3]) }
        : { used: 14.3, total: 15.7, pct: 90.9 },
      battery: batMatch
        ? { pct: parseFloat(batMatch[1]), status: batMatch[2] ? batMatch[2].replace(/[()]/g, '').trim() : 'Plugged in' }
        : { pct: 94, status: 'Plugged in' },
      gpuName: gpuMatch ? gpuMatch[1].trim() : 'NVIDIA GeForce RTX 3050 Laptop',
      gpuTemp: gpuMatch ? parseFloat(gpuMatch[2]) : 70,
      vram: vramMatch
        ? { used: parseFloat(vramMatch[1]), total: parseFloat(vramMatch[2]), pct: Math.round((parseFloat(vramMatch[1]) / parseFloat(vramMatch[2])) * 100) }
        : { used: 1.3, total: 6.0, pct: 22 }
    };
  };

  const updateSpeechMode = (mode: string) => {
    setSpeechModePref(mode);
    localStorage.setItem('oracle_speech_mode', mode);
    window.dispatchEvent(new CustomEvent('oracle_speech_mode_changed', { detail: mode === 'silero' ? 'vad' : mode }));
  };

  const toggleChimes = (enabled: boolean) => {
    setChimesEnabled(enabled);
    localStorage.setItem('oracle_chimes_enabled', String(enabled));
  };

  const updateVoicePersona = (voice: string) => {
    stopPreview();
    setVoicePersona(voice);
    localStorage.setItem('oracle_voice_persona', voice);
  };

  if (!isOpen) return null;

  const linkedPerson = (frame: SavedUnknownFrame) => people.find(person => person.id === frame.capture_person_id);
  const unlinkedCaptures = unknownFrames.filter(frame => !linkedPerson(frame));
  const reviewFolders = captureGroups.map(group => ({
    ...group,
    frames: unlinkedCaptures.filter(frame => group.ids.includes(frame.id)),
  })).filter(group => group.frames.length);
  const unreviewedCaptures = unlinkedCaptures.filter(frame => !reviewFolders.some(group => group.ids.includes(frame.id)));

  const renderCaptures = (frames: SavedUnknownFrame[], linked = false) => (
    <div className="capture-folder-grid">
      {frames.map(frame => (
        <div key={frame.id} className="capture-folder-photo">
          <img src={`/api/v1/memories/${encodeURIComponent(frame.id)}/image`} loading="lazy" alt="Saved camera capture" />
          <dl className="capture-photo-details">
            <dt>Capture ID</dt><dd><code title={frame.id}>{captureIdLabel(frame.id)}</code></dd>
            <dt>Saved</dt><dd><time dateTime={new Date(frame.created).toISOString()}>{captureTime.format(frame.created)}</time></dd>
            <dt>Source</dt><dd>Camera</dd>
            <dt>Size</dt><dd>{frame.width} × {frame.height} px</dd>
          </dl>
          <div className="capture-folder-actions">
            {linked && <button type="button" className="person-action-btn" disabled={captureBusy}
              onClick={() => void moveCaptures([frame.id], null)}>Unlink</button>}
            <button type="button" className="person-action-btn delete" disabled={captureBusy} aria-label="Delete capture"
              onClick={() => void deleteUnknownFrame(frame.id).catch(() => setUnknownFramesError('Unable to delete saved frame'))}>
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="settings-modal-backdrop">
      <motion.div
        className="settings-modal-dialog"
        role="dialog"
        aria-label="System Configuration"
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1, transition: { duration: 0.22, ease: 'easeOut' } }}
        exit={{ scale: 0.96, opacity: 0, transition: { duration: 0.18, ease: 'easeIn' } }}
      >
        {/* Top Master Ribbon */}
        <header className="settings-top-ribbon">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="card-section-tag">
              <Shield size={13} strokeWidth={1.8} style={{ color: 'var(--accent)' }} />
              System Configuration
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              onClick={() => {
                stopLiveCamera();
                onClose();
              }}
              ref={closeButtonRef}
              className="settings-close-btn"
              title="Close Preferences"
              aria-label="Close Preferences"
            >
              <X size={14} />
            </button>
          </div>
        </header>

        {/* Master Two-Pane Split Layout */}
        <div className="settings-split-layout">
          {/* Left Navigation Rail */}
          <nav className="settings-sidebar" aria-label="Settings pages">
            <div className="settings-nav-group">
              <span className="settings-nav-label">System & Interface</span>

              <button
                type="button"
                className={`settings-rail-btn ${activeTab === 'display' ? 'active' : ''}`} aria-current={activeTab === 'display' ? 'page' : undefined}
                onClick={() => setActiveTab('display')}
              >
                <div className="rail-btn-left">
                  <Monitor size={13} />
                  <span>Display & HUD</span>
                </div>
              </button>

              <button
                type="button"
                className={`settings-rail-btn ${activeTab === 'shortcuts' ? 'active' : ''}`} aria-current={activeTab === 'shortcuts' ? 'page' : undefined}
                onClick={() => setActiveTab('shortcuts')}
              >
                <div className="rail-btn-left">
                  <Keyboard size={13} />
                  <span>Shortcuts & Hotkeys</span>
                </div>
              </button>

              <button
                type="button"
                className={`settings-rail-btn ${activeTab === 'intelligence' ? 'active' : ''}`} aria-current={activeTab === 'intelligence' ? 'page' : undefined}
                onClick={() => setActiveTab('intelligence')}
              >
                <div className="rail-btn-left">
                  <Brain size={13} />
                  <span>AI Intelligence</span>
                </div>
              </button>

              <div style={{ height: 6 }} />
              <span className="settings-nav-label">Peripherals & Sensors</span>

              <button
                type="button"
                className={`settings-rail-btn ${activeTab === 'camera' ? 'active' : ''}`} aria-current={activeTab === 'camera' ? 'page' : undefined}
                onClick={() => setActiveTab('camera')}
              >
                <div className="rail-btn-left">
                  <Camera size={13} />
                  <span>Optical & Sentry</span>
                </div>
              </button>

              <button
                type="button"
                className={`settings-rail-btn ${activeTab === 'voice' ? 'active' : ''}`} aria-current={activeTab === 'voice' ? 'page' : undefined}
                onClick={() => setActiveTab('voice')}
              >
                <div className="rail-btn-left">
                  <Volume2 size={13} />
                  <span>Voice & Audio</span>
                </div>
              </button>

              <button
                type="button"
                className={`settings-rail-btn ${activeTab === 'vitals' ? 'active' : ''}`} aria-current={activeTab === 'vitals' ? 'page' : undefined}
                onClick={() => setActiveTab('vitals')}
              >
                <div className="rail-btn-left">
                  <Activity size={13} />
                  <span>Telemetry</span>
                </div>
              </button>

              <div style={{ height: 6 }} />
              <span className="settings-nav-label">Biometric Security</span>

              <button
                type="button"
                className={`settings-rail-btn ${activeTab === 'faces' ? 'active' : ''}`} aria-current={activeTab === 'faces' ? 'page' : undefined}
                onClick={() => setActiveTab('faces')}
              >
                <div className="rail-btn-left">
                  <UserCheck size={13} />
                  <span>Identities</span>
                </div>
                <span className="rail-badge-count">{people.length}</span>
              </button>

              <button
                type="button"
                className={`settings-rail-btn ${activeTab === 'enroll' ? 'active' : ''}`} aria-current={activeTab === 'enroll' ? 'page' : undefined}
                onClick={() => {
                  setActiveTab('enroll');
                  handleSnapFromCamera();
                }}
              >
                <div className="rail-btn-left">
                  <UserPlus size={13} />
                  <span>Enroll Face</span>
                </div>
              </button>

              <div style={{ height: 6 }} />
              <span className="settings-nav-label">Connections</span>
              <button type="button" className={`settings-rail-btn ${activeTab === 'companion' ? 'active' : ''}`} aria-current={activeTab === 'companion' ? 'page' : undefined} onClick={() => setActiveTab('companion')}>
                <div className="rail-btn-left"><Link2 size={13} /><span>Companion</span></div>
              </button>
              <button type="button" className={`settings-rail-btn ${activeTab === 'google' ? 'active' : ''}`} aria-current={activeTab === 'google' ? 'page' : undefined} onClick={() => setActiveTab('google')}>
                <div className="rail-btn-left"><Link2 size={13} /><span>Google</span></div>
              </button>
            </div>

            <div className="sidebar-footer-telemetry">
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#22c55e' }} />
              <span>ORACLE // SEC_LEVEL_1</span>
            </div>
          </nav>

          {/* Right Content Pane */}
          <section className="settings-content-pane" ref={contentRef} aria-label="Settings content">
            {activeTab === 'companion' && <CompanionSettingsPane />}
            {activeTab === 'google' && (
              <>
                <div className="pane-header-strip">
                  <div className="pane-title-block">
                    <h2>Google Connection</h2>
                    <p>Manage Oracle’s access to Google Calendar and Tasks.</p>
                  </div>
                </div>
                <div className="settings-google-connection"><GoogleWorkspace connectionOnly /></div>
              </>
            )}
            {/* PANE 1: ENROLLED IDENTITIES */}
            {activeTab === 'faces' && (
              <>
                <input
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                />
                <div className="pane-header-strip">
                  <div className="pane-title-block">
                    <h2>Enrolled Biometric Gallery</h2>
                    <p>OpenCV YuNet + SFace 128-d neural templates for authorized operator identification.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setAppendSample(false);
                      setEnrollPersonId(null);
                      setEnrollName('');
                      setEnrollNotes('');
                      setSelectedRole('owner');
                      setCustomRoleTitle('');
                      setCustomIsAdmin(false);
                      setActiveTab('enroll');
                      handleSnapFromCamera();
                    }}
                    className="person-action-btn primary"
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    <Plus size={11} />
                    <span>Enroll Identity</span>
                  </button>
                </div>

                {/* Identity Cards List */}
                <div className="people-grid">
                  {loadingPeople && (
                    <div style={{ color: 'var(--muted)', fontSize: '11px' }}>
                      Accessing local biometric database...
                    </div>
                  )}
                  {!loadingPeople && people.length === 0 && (
                    <div
                      style={{
                        color: 'var(--muted)',
                        fontStyle: 'italic',
                        padding: '16px',
                        background: 'rgba(232, 235, 239, 0.02)',
                        borderRadius: '10px',
                        fontSize: '11px',
                        border: '1px solid rgba(232, 235, 239, 0.05)'
                      }}
                    >
                      No biometric operators enrolled yet. Click 'Enroll Identity' to register your face.
                    </div>
                  )}
                  {people.map((p) => (
                    <div key={p.id} className="person-card">
                      <div className="person-card-header">
                        <div className="person-name-badge">
                          <div className="person-avatar-circle">
                            {p.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <strong>{p.name.toUpperCase()}</strong>
                            <div style={{ marginTop: '2px' }}>
                              <span className="person-sample-pill">
                                {p.sample_count} {p.sample_count === 1 ? 'Template' : 'Templates'}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="person-card-actions">
                          <button
                            type="button"
                            onClick={() => {
                              setEnrollName(p.name);
                              setEnrollNotes(p.notes || '');
                              setAppendSample(true);
                              setEnrollPersonId(p.id);
                              setActiveTab('enroll');
                              handleSnapFromCamera();
                            }}
                            className="person-action-btn"
                            title="Add another angle or lighting sample"
                          >
                            <Plus size={10} />
                            <span>Add Angle</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeletePerson(p.id, p.name)}
                            className="person-action-btn delete"
                            title="Delete all facial profiles for this identity"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>

                      {unknownFrames.some(frame => frame.capture_person_id === p.id) && (
                        <details className="capture-folder">
                          <summary>Captures ({unknownFrames.filter(frame => frame.capture_person_id === p.id).length})</summary>
                          {renderCaptures(unknownFrames.filter(frame => frame.capture_person_id === p.id), true)}
                        </details>
                      )}
                      {watchlistEditor?.id === p.id ? (
                        <form className="capture-folder" onSubmit={event => {
                          event.preventDefault();
                          localStorage.setItem(`oracle_watchlist_${p.id}`, watchlistEditor.reason.trim());
                          setWatchlistEditor(null);
                        }}>
                          <label>
                            Private watchlist reason
                            <input className="settings-input" maxLength={300} value={watchlistEditor.reason}
                              onChange={event => setWatchlistEditor({ id: p.id, reason: event.target.value })} />
                          </label>
                          <div className="capture-folder-actions">
                            <button type="submit" className="person-action-btn">Save watchlist entry</button>
                            <button type="button" className="person-action-btn" onClick={() => setWatchlistEditor(null)}>Cancel</button>
                            {localStorage.getItem(`oracle_watchlist_${p.id}`) !== null &&
                              <button type="button" className="person-action-btn" onClick={() => {
                                localStorage.removeItem(`oracle_watchlist_${p.id}`);
                                setWatchlistEditor(null);
                              }}>Remove from watchlist</button>}
                          </div>
                        </form>
                      ) : (
                        <button type="button" className="person-action-btn" onClick={() => setWatchlistEditor({
                          id: p.id, reason: localStorage.getItem(`oracle_watchlist_${p.id}`) ?? '',
                        })}>{localStorage.getItem(`oracle_watchlist_${p.id}`) === null ? 'Add to watchlist' : 'Edit watchlist entry'}</button>
                      )}
                      {/* Micro Spec Rack on Dossier Card */}
                      <div className="person-spec-rack">
                        <div className="person-spec-cell">
                          <span>RELATION</span>
                          <strong>{p.relationship || 'Owner'}</strong>
                        </div>
                        <div className="person-spec-cell">
                          <span>CLEARANCE</span>
                          <strong style={{ color: p.permission === 'administrator' ? '#4ade80' : 'inherit' }}>
                            {p.permission || 'Standard'}
                          </strong>
                        </div>
                        <div className="person-spec-cell">
                          <span>ENROLLED</span>
                          <strong>{new Date(p.created).toLocaleDateString()}</strong>
                        </div>
                      </div>

                      <PersonProfileControls person={p} photo={enrollImageFile} onUpdated={loadPeople} />
                    </div>
                  ))}
                </div>

                {/* Biometric Sensitivity & Voice Greeting 2-Column Grid */}
                <div className="settings-grid-2col">
                  <div className="settings-tile">
                    <div className="settings-tile-row">
                      <div className="settings-tile-info">
                        <div className="settings-tile-title">Cosine Matching Sensitivity</div>
                        <div className="settings-tile-desc">SFace feature similarity threshold (Default 0.363).</div>
                      </div>
                      <span className="settings-mono-badge">{faceThreshold}</span>
                    </div>
                    <div className="settings-range-wrap">
                      <span>Strict (0.363)</span>
                      <input
                        type="range"
                        min="0.363"
                        max="0.80"
                        step="0.005"
                        aria-label="Face matching sensitivity"
                        value={faceThreshold}
                        onChange={(e) => updateFaceThreshold(Number(e.target.value))}
                        className="settings-range-slider"
                      />
                      <span>Permissive (0.80)</span>
                    </div>
                  </div>

                  <div className="settings-tile" style={{ justifyContent: 'center' }}>
                    <div className="settings-tile-row">
                      <div className="settings-tile-info">
                        <div className="settings-tile-title">Arrival Voice Greeting</div>
                        <div className="settings-tile-desc">Kokoro speaks "Welcome back, [Name]" upon recognition.</div>
                      </div>
                      <label className="oracle-switch">
                        <input
                          type="checkbox" aria-label="Arrival voice greeting"
                          checked={greetOperator}
                          onChange={(e) => updateGreetOperator(e.target.checked)}
                        />
                        <span className="oracle-switch-slider" />
                      </label>
                    </div>
                  </div>
                </div>

                <div className="settings-tile">
                  <div className="settings-tile-row">
                    <div className="settings-tile-info">
                      <div className="settings-tile-title">Auto-save unidentified frames</div>
                      <div className="settings-tile-desc">
                        Saves eligible unidentified captures locally. Oracle checks for matches when you open Identities.
                      </div>
                    </div>
                    <label className="oracle-switch">
                      <input
                        type="checkbox" aria-label="Auto-save unidentified frames"
                        checked={saveUnknownFrames}
                        onChange={(event) => {
                          const enabled = event.target.checked;
                          setSaveUnknownFrames(enabled);
                          localStorage.setItem('oracle_save_unknown_frames', String(enabled));
                        }}
                      />
                      <span className="oracle-switch-slider" />
                    </label>
                  </div>
                  <div className="settings-field settings-field-inline">
                    <label htmlFor="unknown-frame-retention">Frame retention</label>
                    <OracleSelect<number>
                      id="unknown-frame-retention"
                      aria-label="Frame retention"
                      value={unknownRetentionDays}
                      onChange={(days) => {
                        setUnknownRetentionDays(days);
                        localStorage.setItem('oracle_unknown_retention_days', String(days));
                      }}
                      options={[
                        { value: 1, label: '1 day' },
                        { value: 7, label: '7 days' },
                        { value: 30, label: '30 days' },
                        { value: 0, label: 'Keep until deleted' },
                      ]}
                    />
                  </div>
                  {unknownFramesError && <p role="alert" className="capture-folder-error">{unknownFramesError}</p>}
                  <label className="settings-tile-row">
                    <span className="settings-tile-info">
                      <span className="settings-tile-title">Auto-link strong matches</span>
                      <span className="settings-tile-desc">When Identities is open, link clear matches to existing profile folders.</span>
                    </span>
                    <input type="checkbox" checked={autoAssignCaptures} onChange={event => {
                      setAutoAssignCaptures(event.target.checked);
                      localStorage.setItem('oracle_auto_assign_captures', String(event.target.checked));
                    }} />
                  </label>
                  {unlinkedCaptures.length === 0 && <p>No unidentified captures to review.</p>}
                  {unlinkedCaptures.length > 0 && (
                    <button type="button" className="person-action-btn" disabled={captureBusy || captureReviewPending}
                      onClick={() => setCaptureReviewRequest(current => current + 1)}>
                      {captureReviewPending ? 'Checking captures…' : 'Check again'}
                    </button>
                  )}
                  {[...reviewFolders, ...unreviewedCaptures.map(frame => ({
                    ids: [frame.id], person_id: null, reason: null, frames: [frame],
                  }))].map((group, index) => {
                    const key = group.frames[0].id;
                    const suggestion = people.find(person => person.id === group.person_id);
                    const target = captureTargets[key] ?? suggestion?.id ?? '';
                    const ids = group.frames.map(frame => frame.id);
                    return (
                      <details key={key} className="capture-folder">
                        <summary>
                          <span className="capture-folder-summary">
                            <strong>{suggestion ? `Possible match · ${suggestion.name}` : group.frames.length > 1 ? `Unknown person ${index + 1}` : 'Unidentified capture'}</strong>
                            <span className="capture-folder-summary-meta">
                              {group.frames.length === 1
                                ? <code title={key}>{captureIdLabel(key)}</code>
                                : <span>{group.frames.length} captures · Latest saved</span>}
                              <time dateTime={new Date(group.frames[0].created).toISOString()}>{captureTime.format(group.frames[0].created)}</time>
                            </span>
                          </span>
                        </summary>
                        {renderCaptures(group.frames)}
                        {group.reason && <p className="settings-tile-desc">{group.reason}</p>}
                        <div className="capture-folder-actions">
                          <OracleSelect<string> aria-label="Destination profile" value={target}
                            onChange={value => setCaptureTargets(current => ({ ...current, [key]: value }))}
                            options={[{ value: '', label: 'Choose profile' }, ...people.map(person => ({ value: person.id, label: person.name }))]} />
                          <button type="button" className="person-action-btn" disabled={!target || captureBusy}
                            onClick={() => void moveCaptures(ids, target)}>Link captures</button>
                          <button type="button" className="person-action-btn" disabled={captureBusy}
                            onClick={() => void enrollUnknownFrame(group.frames[0], ids)}><UserPlus size={12} /> Create profile</button>
                        </div>
                      </details>
                    );
                  })}
                </div>
              </>
            )}

            {/* PANE 2: DEDICATED ENROLLMENT STUDIO */}
            {activeTab === 'enroll' && (
              <>
                <div className="pane-header-strip">
                  <div className="pane-title-block">
                    <h2>
                      {appendSample
                        ? `Add Angle Sample // ${enrollName.toUpperCase()}`
                        : 'Biometric Enrollment Studio'}
                    </h2>
                    <p>Position face inside reticle frame and capture a clean, well-lit photo.</p>
                  </div>
                  {appendSample && (
                    <button
                      type="button"
                      onClick={() => {
                        setAppendSample(false);
                        setEnrollPersonId(null);
                        setEnrollName('');
                        setEnrollNotes('');
                        setSelectedRole('owner');
                        setCustomRoleTitle('');
                        setCustomIsAdmin(false);
                      }}
                      className="person-action-btn"
                    >
                      Cancel Append
                    </button>
                  )}
                </div>

                <div className="enroll-studio-split">
                  {/* Left Column: Live Camera Studio */}
                  <div>
                    {isLiveCameraActive ? (
                      <div className="enroll-camera-viewport">
                        <video
                          ref={liveVideoRef}
                          playsInline
                          muted
                          style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}
                        />
                        <div className="cctv-scanlines" />
                        <div className="enroll-reticle-bracket">
                          <span>ALIGN FACE HERE</span>
                        </div>
                        <div
                          style={{
                            position: 'absolute',
                            bottom: '10px',
                            left: '10px',
                            right: '10px',
                            display: 'flex',
                            gap: '6px',
                            justifyContent: 'center',
                            zIndex: 10
                          }}
                        >
                          <button
                            type="button"
                            onClick={captureFromLiveCamera}
                            className="settings-submit-btn"
                          >
                            <Camera size={12} />
                            <span>Capture Frame</span>
                          </button>
                          <button
                            type="button"
                            onClick={stopLiveCamera}
                            className="person-action-btn"
                          >
                            Pause
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        className="enroll-camera-viewport"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexDirection: 'column',
                          gap: '8px',
                          background: 'rgba(232, 235, 239, 0.02)'
                        }}
                      >
                        <Camera size={24} style={{ color: 'var(--muted)' }} />
                        <button
                          type="button"
                          onClick={handleSnapFromCamera}
                          className="settings-submit-btn"
                        >
                          Start Live Camera
                        </button>
                      </div>
                    )}

                    {enrollImagePreview && (
                      <div
                        style={{
                          marginTop: '10px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          padding: '8px 10px',
                          background: 'rgba(232, 235, 239, 0.02)',
                          borderRadius: '8px',
                          border: '1px solid rgba(74, 222, 128, 0.3)'
                        }}
                      >
                        <img
                          src={enrollImagePreview}
                          alt="Captured preview"
                          style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '6px' }}
                        />
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span style={{ fontSize: '10.5px', color: '#4ade80', fontWeight: 600 }}>
                            Frame Acquired
                          </span>
                          <span style={{ fontSize: '9px', color: 'var(--muted)' }}>
                            Ready to compute embedding
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Right Column: Identity Details Form */}
                  <form onSubmit={handleEnrollSubmit} className="enroll-form-pane">
                    <div>
                      <label
                        style={{
                          display: 'block',
                          fontSize: '8.5px',
                          fontFamily: "'JetBrains Mono', monospace",
                          color: 'var(--muted)',
                          marginBottom: '4px',
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase'
                        }}
                      >
                        Operator / Asset Name *
                      </label>
                      <input
                        type="text"
                        aria-label="Operator or asset name"
                        placeholder="e.g. Sahan"
                        value={enrollName}
                        disabled={appendSample}
                        onChange={(e) => setEnrollName(e.target.value)}
                        className="settings-input"
                        style={{ width: '100%', boxSizing: 'border-box' }}
                      />
                    </div>

                    <div>
                      <label
                        style={{
                          display: 'block',
                          fontSize: '8.5px',
                          fontFamily: "'JetBrains Mono', monospace",
                          color: 'var(--muted)',
                          marginBottom: '4px',
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase'
                        }}
                      >
                        Profile Role *
                      </label>
                      <OracleSelect
                        aria-label="Profile Role"
                        value={selectedRole}
                        disabled={appendSample}
                        onChange={(val) => setSelectedRole(val as any)}
                        options={ROLE_OPTIONS.map((opt) => ({
                          value: opt.id,
                          label: opt.label,
                          badge: opt.perm === 'administrator' || (opt.id === 'custom' && customIsAdmin) ? 'ADMIN' : 'STANDARD'
                        }))}
                        triggerStyle={{ padding: '6px 10px' }}
                      />
                    </div>

                    {selectedRole === 'custom' && !appendSample && (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                          padding: '10px 12px',
                          background: 'rgba(157, 180, 211, 0.04)',
                          border: '1px solid rgba(157, 180, 211, 0.2)',
                          borderRadius: '8px'
                        }}
                      >
                        <div>
                          <label
                            style={{
                              display: 'block',
                              fontSize: '8.5px',
                              fontFamily: "'JetBrains Mono', monospace",
                              color: 'var(--accent)',
                              marginBottom: '4px',
                              letterSpacing: '0.08em',
                              textTransform: 'uppercase'
                            }}
                          >
                            Custom Role Title *
                          </label>
                          <input
                            type="text"
                            placeholder="e.g. Lead Architect, Station Commander, Security Officer"
                            value={customRoleTitle}
                            onChange={(e) => setCustomRoleTitle(e.target.value)}
                            className="settings-input"
                            style={{ width: '100%', boxSizing: 'border-box', borderColor: 'rgba(157, 180, 211, 0.3)' }}
                          />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: '10px', color: 'var(--muted)' }}>
                            Elevate to Administrator (Alpha-1)
                          </span>
                          <label className="oracle-switch">
                            <input
                              type="checkbox"
                              checked={customIsAdmin}
                              onChange={(e) => setCustomIsAdmin(e.target.checked)}
                            />
                            <span className="oracle-switch-slider" />
                          </label>
                        </div>
                      </div>
                    )}

                    <div>
                      <label
                        style={{
                          display: 'block',
                          fontSize: '8.5px',
                          fontFamily: "'JetBrains Mono', monospace",
                          color: 'var(--muted)',
                          marginBottom: '4px',
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase'
                        }}
                      >
                        Additional Clearance Notes (Optional)
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Zone A access, Night shift, Root priority"
                        value={enrollNotes}
                        onChange={(e) => setEnrollNotes(e.target.value)}
                        className="settings-input"
                        style={{ width: '100%', boxSizing: 'border-box' }}
                      />
                    </div>

                    <div>
                      <label
                        style={{
                          display: 'block',
                          fontSize: '8.5px',
                          fontFamily: "'JetBrains Mono', monospace",
                          color: 'var(--muted)',
                          marginBottom: '4px',
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase'
                        }}
                      >
                        Or Upload Image File
                      </label>
                      <div className="settings-file-picker-wrap">
                        <label className="settings-file-picker-label">
                          <Upload size={11} />
                          <span>{enrollImageFile ? 'Change Photo' : 'Select Portrait File'}</span>
                          <input
                            type="file"
                            accept="image/jpeg,image/png"
                            onChange={handleFileChange}
                            style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }}
                          />
                        </label>
                        {enrollImageFile ? (
                          <span className="settings-file-name-badge">{enrollImageFile.name}</span>
                        ) : (
                          <span className="settings-file-name-badge" style={{ color: 'var(--faint)' }}>JPEG / PNG format</span>
                        )}
                      </div>
                    </div>

                    {enrollStatus && (
                      <div
                        style={{
                          fontSize: '10.5px',
                          color: enrollStatus.includes('Error') ? '#f87171' : '#4ade80',
                          fontFamily: "'JetBrains Mono', monospace",
                          padding: '6px 8px',
                          background: 'rgba(232, 235, 239, 0.02)',
                          borderRadius: '6px'
                        }}
                      >
                        {enrollStatus}
                      </div>
                    )}

                    {!appendSample && (
                      <label style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: '10px', color: 'var(--muted)' }}>
                        <input
                          type="checkbox"
                          checked={enrollConsent}
                          onChange={(e) => setEnrollConsent(e.target.checked)}
                        />
                        <span>I have explicit permission to enroll this person’s biometric data. Oracle will retain only approved face templates.</span>
                      </label>
                    )}

                    <button
                      type="submit"
                      disabled={isEnrolling || (!appendSample && !enrollConsent)}
                      className="settings-submit-btn"
                      style={{ marginTop: 'auto' }}
                    >
                      <Shield size={12} />
                      <span>
                        {isEnrolling
                          ? 'Extracting Biometrics...'
                          : appendSample
                          ? 'Append Angle Template'
                          : 'Commit Biometric Enrollment'}
                      </span>
                    </button>
                  </form>
                </div>
              </>
            )}

            {/* PANE 3: OPTICAL & SENTRY */}
            {activeTab === 'camera' && (
              <>
                <div className="pane-header-strip">
                  <div className="pane-title-block">
                    <h2>Camera & tracking</h2>
                    <p>Recognition preferences, foreground isolation, and absence auto-lock.</p>
                  </div>
                </div>

                <div className="settings-tile">
                  {!cameraStream && <p className="settings-tile-desc">Start the camera to adjust foreground isolation and view live recognition details.</p>}
                  <div ref={onCameraControlsMount} />
                </div>
                <div className="settings-grid-2col">
                  {/* Walk-Away Auto-Lock */}
                  <div className="settings-tile">
                    <div className="settings-tile-row">
                      <div className="settings-tile-info">
                        <div className="settings-tile-title">Walk-Away Optical Sentry</div>
                        <div className="settings-tile-desc">Locks workstation when operator face is absent.</div>
                      </div>
                      <label className="oracle-switch">
                        <input
                          type="checkbox" aria-label="Sentry mode"
                          checked={sentryEnabled}
                          onChange={(e) => toggleSentry(e.target.checked)}
                        />
                        <span className="oracle-switch-slider" />
                      </label>
                    </div>

                    {sentryEnabled && (
                      <div
                        style={{
                          borderTop: '1px solid rgba(232, 235, 239, 0.06)',
                          paddingTop: '8px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '8px'
                        }}
                      >
                        <span style={{ fontSize: '10.5px', color: 'var(--muted)' }}>Absence Lock Delay:</span>
                        <OracleSelect<number>
                          aria-label="Absence Lock Delay"
                          value={sentryTimeout}
                          onChange={(val) => updateSentryTimeout(Number(val))}
                          options={[
                            { value: 30, label: '30s (Strict)', badge: '30S' },
                            { value: 60, label: '60s (Recommended)', badge: '60S' },
                            { value: 120, label: '2 Minutes', badge: '2M' },
                            { value: 300, label: '5 Minutes', badge: '5M' }
                          ]}
                          width="160px"
                        />
                      </div>
                    )}
                  </div>

                  {/* YOLOv8 Detection */}
                  <div className="settings-tile">
                    <div className="settings-tile-row">
                      <div className="settings-tile-info">
                        <div className="settings-tile-title">YOLOv8 Object Detection</div>
                        <div className="settings-tile-desc">Real-time room object tracking overlays.</div>
                      </div>
                      <label className="oracle-switch">
                        <input
                          type="checkbox" aria-label="Object detection"
                          checked={yoloEnabled}
                          onChange={(e) => toggleYolo(e.target.checked)}
                        />
                        <span className="oracle-switch-slider" />
                      </label>
                    </div>

                    {yoloEnabled && (
                      <div
                        style={{
                          borderTop: '1px solid rgba(232, 235, 239, 0.06)',
                          paddingTop: '8px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px'
                        }}
                      >
                        <div className="settings-tile-row">
                          <span style={{ fontSize: '10px', color: 'var(--muted)' }}>Confidence Filter:</span>
                          <span className="settings-mono-badge">{Math.round(yoloThreshold * 100)}%</span>
                        </div>
                        <div className="settings-range-wrap">
                          <span>15%</span>
                          <input
                            type="range"
                            min="0.15"
                            max="0.80"
                            step="0.05"
                            value={yoloThreshold}
                            onChange={(e) => updateYoloThreshold(Number(e.target.value))}
                            className="settings-range-slider"
                          />
                          <span>80%</span>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginTop: '2px' }}>
                          <span
                            style={{
                              fontSize: '8.5px',
                              color: 'var(--faint)',
                              fontFamily: "'JetBrains Mono', monospace",
                              textTransform: 'uppercase'
                            }}
                          >
                            Object Whitelist:
                          </span>
                          <OracleSelect
                            aria-label="Object Whitelist"
                            value={yoloFilter}
                            onChange={(val) => updateYoloFilter(val)}
                            options={[
                              { value: 'essentials', label: 'Workstation Essentials (Laptop, Phone, Cup, Book)', badge: 'ESSENTIALS' },
                              { value: 'all', label: 'All 80 COCO Classes (Everything Detected)', badge: 'ALL 80' }
                            ]}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="settings-grid-2col">
                  {/* Cadence */}
                  <div className="settings-tile">
                    <div className="settings-tile-info">
                      <div className="settings-tile-title">Vision Inference Cadence</div>
                      <div className="settings-tile-desc">Frame frequency sent to neural vision pipeline.</div>
                    </div>
                    <OracleSelect
                      aria-label="Vision Inference Cadence"
                      value={cadenceMode}
                      onChange={(val) => updateCadenceMode(val)}
                      options={[
                        { value: 'tactical', label: 'Tactical 600ms (High Responsiveness)', badge: '600MS', desc: 'Real-time sentry tracking' },
                        { value: 'balanced', label: 'Balanced 1.4s (Optimal for GPU)', badge: '1.4S', desc: 'Thermally balanced profile' },
                        { value: 'eco', label: 'Eco 3.0s (Battery Saver)', badge: '3.0S', desc: 'Minimal background compute' }
                      ]}
                      triggerStyle={{ marginTop: '4px' }}
                    />
                  </div>

                  {/* Mirroring & Face Reticles */}
                  <div className="settings-tile" style={{ justifyContent: 'space-around' }}>
                    <div className="settings-tile-row">
                      <div className="settings-tile-info">
                        <div className="settings-tile-title">Mirror Webcam Stream</div>
                        <div className="settings-tile-desc">Horizontally flip the live camera preview and its tracking overlays.</div>
                      </div>
                      <label className="oracle-switch">
                        <input
                          type="checkbox" aria-label="Mirror camera feed"
                          checked={isMirrored}
                          onChange={(e) => updateMirrored(e.target.checked)}
                        />
                        <span className="oracle-switch-slider" />
                      </label>
                    </div>

                    <div
                      className="settings-tile-row"
                      style={{ borderTop: '1px solid rgba(232, 235, 239, 0.05)', paddingTop: '6px' }}
                    >
                      <div className="settings-tile-info">
                        <div className="settings-tile-title">YuNet Face Reticles</div>
                        <div className="settings-tile-desc">Biometric brackets over detected faces.</div>
                      </div>
                      <label className="oracle-switch">
                        <input
                          type="checkbox" aria-label="Face reticles"
                          checked={faceReticlesEnabled}
                          onChange={(e) => toggleFaceReticles(e.target.checked)}
                        />
                        <span className="oracle-switch-slider" />
                      </label>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* PANE 4: VOICE & AUDIO */}
            {activeTab === 'voice' && (
              <>
                <div className="pane-header-strip">
                  <div className="pane-title-block">
                    <h2>Voice Pipeline & Acoustic Feedback</h2>
                    <p>Silero VAD v5 speech detection, Kokoro natural speech personas, and audio earcons.</p>
                  </div>
                </div>

                <div className="settings-tile">
                  <div className="settings-tile-title">Default Speech Input Mode</div>
                  <div className="settings-actions">
                    {[
                      { id: 'ptt', label: 'Push-to-Talk (PTT)' },
                      { id: 'silero', label: 'Silero VAD (Hands-Free)' },
                      { id: 'wake', label: 'Wake Word ("Hey Oracle")' }
                    ].map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className={`settings-option-pill ${speechModePref === m.id ? 'active' : ''}`}
                        aria-pressed={speechModePref === m.id}
                        onClick={() => updateSpeechMode(m.id)}
                      >
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: speechModePref === m.id ? '#4ade80' : 'var(--muted)'
                          }}
                        />
                        <span style={{ fontSize: '11px' }}>{m.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <VoiceDiagnosticsPanel />

                <div className="settings-grid-2col">
                  {/* Acoustic Noise Reduction & Filtering */}
                  <div className="settings-tile">
                    <div className="settings-tile-row">
                      <div className="settings-tile-info">
                        <div className="settings-tile-title">Background Noise Reduction & Filtering</div>
                        <div className="settings-tile-desc">85Hz rumble filter, echo cancellation, stationary noise gating & dynamic speech leveling.</div>
                      </div>
                      <label className="oracle-switch">
                        <input
                          type="checkbox" aria-label="Noise reduction"
                          checked={noiseReductionEnabled}
                          onChange={(e) => toggleNoiseReduction(e.target.checked)}
                        />
                        <span className="oracle-switch-slider" />
                      </label>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
                      <span className="card-status-badge locked">
                        <span className="card-status-dot" style={{ background: noiseReductionEnabled ? '#4ade80' : 'var(--muted)' }} />
                        {noiseReductionEnabled ? 'Hardware AEC + 85Hz DSP Filter Active' : 'Filter Disabled'}
                      </span>
                    </div>
                  </div>

                  {/* Voice Identification Suggestions */}
                  <div className="settings-tile">
                    <div className="settings-tile-row">
                      <div className="settings-tile-info">
                        <div className="settings-tile-title">Voice Identification & Action Suggestions</div>
                        <div className="settings-tile-desc">Phonetic wake-word matching, voice command suggestions & speaker profile attribution.</div>
                      </div>
                      <label className="oracle-switch">
                        <input
                          type="checkbox" aria-label="Voice suggestions"
                          checked={voiceSuggestionsEnabled}
                          onChange={(e) => toggleVoiceSuggestions(e.target.checked)}
                        />
                        <span className="oracle-switch-slider" />
                      </label>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
                      <span className="card-status-badge locked">
                        <span className="card-status-dot" style={{ background: voiceSuggestionsEnabled ? '#4ade80' : 'var(--muted)' }} />
                        {voiceSuggestionsEnabled ? 'Phonetic Matching + Enrolled Speaker Active' : 'Suggestions Disabled'}
                      </span>
                    </div>
                  </div>

                  {/* Live Spoken Captions & Subtitles */}
                  <div className="settings-tile">
                    <div className="settings-tile-row">
                      <div className="settings-tile-info">
                        <div className="settings-tile-title">Live Spoken Subtitles & Captions</div>
                        <div className="settings-tile-desc">Show real-time floating speech captions and vocal waveforms for both your voice and Oracle on screen.</div>
                      </div>
                      <label className="oracle-switch">
                        <input
                          type="checkbox" aria-label="Live captions"
                          checked={captionsEnabled}
                          onChange={(e) => toggleCaptions(e.target.checked)}
                        />
                        <span className="oracle-switch-slider" />
                      </label>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
                      <span className="card-status-badge locked">
                        <span className="card-status-dot" style={{ background: captionsEnabled ? '#4ade80' : 'var(--muted)' }} />
                        {captionsEnabled ? 'HUD Live Voice Captions Active' : 'Captions Disabled'}
                      </span>
                    </div>
                  </div>

                  <div className="settings-tile">
                    <div className="settings-tile-title">Listening during spoken replies</div>
                    <div className="settings-tile-desc">Hands-free listening accepts new speech when playback ends. Use Stop to end a reply early.</div>
                  </div>

                  {/* Instant Local Voice Command Fast-Path */}
                  <div className="settings-tile">
                    <div className="settings-tile-row">
                      <div className="settings-tile-info">
                        <div className="settings-tile-title">Instant Voice Command Routing</div>
                        <div className="settings-tile-desc">Sub-20ms local intent execution for timers, quick notes, volume, and spoken confirmations.</div>
                      </div>
                      <label className="oracle-switch">
                        <input
                          type="checkbox" aria-label="Local voice fast path"
                          checked={localFastPathEnabled}
                          onChange={(e) => toggleLocalFastPath(e.target.checked)}
                        />
                        <span className="oracle-switch-slider" />
                      </label>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
                      <span className="card-status-badge locked">
                        <span className="card-status-dot" style={{ background: localFastPathEnabled ? '#4ade80' : 'var(--muted)' }} />
                        {localFastPathEnabled ? 'Zero-LLM Latency Fast-Path Active' : 'Routing to LLM Only'}
                      </span>
                    </div>
                  </div>

                  {/* Procedural Chimes */}
                  <div className="settings-tile">
                    <div className="settings-tile-row">
                      <div className="settings-tile-info">
                        <div className="settings-tile-title">Audio Earcon Chimes</div>
                        <div className="settings-tile-desc">Synthesized dual-tone chimes on wake cues.</div>
                      </div>
                      <label className="oracle-switch">
                        <input
                          type="checkbox" aria-label="Audio chimes"
                          checked={chimesEnabled}
                          onChange={(e) => toggleChimes(e.target.checked)}
                        />
                        <span className="oracle-switch-slider" />
                      </label>
                    </div>
                    <button
                      type="button"
                      className="person-action-btn"
                      onClick={() => soundEffects.playWakeChime()}
                      style={{ alignSelf: 'flex-start', marginTop: '4px' }}
                    >
                      <Sparkles size={11} />
                      <span>Test Chime</span>
                    </button>
                  </div>

                  {/* Kokoro Voice Persona */}
                  <div className="settings-tile">
                    <div className="settings-tile-info">
                      <div className="settings-tile-title">Kokoro Voice Persona</div>
                      <div className="settings-tile-desc">Natural local voice generated via Kokoro ONNX.</div>
                    </div>
                    <OracleSelect
                      aria-label="Voice persona"
                      value={voicePersona}
                      onChange={(val) => updateVoicePersona(val)}
                      options={[
                        { value: 'af_heart', label: 'af_heart (Default Warm Female)', badge: 'WARM' },
                        { value: 'af_alloy', label: 'af_alloy (Crisp Female)', badge: 'CRISP' },
                        { value: 'am_adam', label: 'am_adam (Authoritative Male)', badge: 'AUTHORITY' },
                        { value: 'am_echo', label: 'am_echo (Balanced Male)', badge: 'BALANCED' },
                        { value: 'bf_alice', label: 'bf_alice (British Female)', badge: 'BRITISH' },
                        { value: 'bm_george', label: 'bm_george (British Male)', badge: 'BRITISH' }
                      ]}
                      triggerStyle={{ marginTop: '4px' }}
                    />
                    <label className="voice-speed-label" htmlFor="voice-speed">Speech speed <output htmlFor="voice-speed">{voiceSpeed.toFixed(2)}×</output></label>
                    <input id="voice-speed" type="range" min="0.75" max="1.25" step="0.05" value={voiceSpeed}
                      onChange={e => { stopPreview(); const speed = Number(e.target.value); setVoiceSpeed(speed); localStorage.setItem('oracle_voice_speed', String(speed)); }} />
                    <div className="voice-speed-scale"><span>Slower</span><span>Normal</span><span>Faster</span></div>
                    <button type="button" className="person-action-btn voice-preview-btn" onClick={previewVoice} aria-pressed={previewing}>
                      <Volume2 size={13} aria-hidden="true"/>{previewing ? 'Stop preview' : 'Preview voice'}
                    </button>
                    <p className="settings-tile-desc" role="status">{previewError || (previewing ? 'Preparing / playing your selected voice…' : 'Preview uses your selected voice and speed. Saved automatically.')}</p>
                  </div>
                </div>
              </>
            )}

            {/* PANE: DISPLAY & HUD */}
            {activeTab === 'display' && (
              <>
                <div className="pane-header-strip">
                  <div className="pane-title-block">
                    <h2>Display & HUD Preferences</h2>
                    <p>Chronometer format, atmosphere nebula dynamics, and interaction haptics.</p>
                  </div>
                </div>

                <div className="settings-grid-2col">
                  {/* Chronometer Format */}
                  <div className="settings-tile">
                    <div className="settings-tile-info">
                      <div className="settings-tile-title">Chronometer Time Format</div>
                      <div className="settings-tile-desc">Display time in 24-hour military notation or 12-hour AM/PM.</div>
                    </div>
                    <div className="settings-pill-row" style={{ marginTop: '4px' }}>
                      <button
                        type="button"
                        className={`settings-option-pill ${clock24h ? 'active' : ''}`}
                        aria-pressed={clock24h}
                        onClick={() => updateClock24h(true)}
                      >
                        <Clock size={11} />
                        <span>24-Hour (21:32)</span>
                      </button>
                      <button
                        type="button"
                        className={`settings-option-pill ${!clock24h ? 'active' : ''}`}
                        aria-pressed={!clock24h}
                        onClick={() => updateClock24h(false)}
                      >
                        <Clock size={11} />
                        <span>12-Hour (09:32 PM)</span>
                      </button>
                    </div>

                    <div className="settings-tile-row" style={{ borderTop: '1px solid rgba(232, 235, 239, 0.05)', paddingTop: '8px', marginTop: '4px' }}>
                      <span style={{ fontSize: '10.5px', color: 'var(--muted)' }}>Show Seconds (:SS)</span>
                      <label className="oracle-switch">
                        <input
                          type="checkbox" aria-label="Show seconds"
                          checked={showSeconds}
                          onChange={(e) => updateShowSeconds(e.target.checked)}
                        />
                        <span className="oracle-switch-slider" />
                      </label>
                    </div>
                  </div>

                  {/* Core Nebula Atmosphere */}
                  <div className="settings-tile">
                    <div className="settings-tile-info">
                      <div className="settings-tile-title">Atmospheric Core Nebula</div>
                      <div className="settings-tile-desc">Depth and ambient radial glow behind the presence sphere.</div>
                    </div>
                    <div className="settings-pill-row" style={{ marginTop: '4px' }}>
                      {[
                        { id: 'subtle', label: 'Subtle' },
                        { id: 'balanced', label: 'Balanced' },
                        { id: 'hdr', label: 'High Dynamic' }
                      ].map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          className={`settings-option-pill ${nebulaMode === m.id ? 'active' : ''}`}
                          aria-pressed={nebulaMode === m.id}
                          onClick={() => updateNebulaMode(m.id)}
                        >
                          <Sparkles size={10} />
                          <span>{m.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="settings-grid-2col">
                  {/* Procedural Sound Effects */}
                  <div className="settings-tile">
                    <div className="settings-tile-row">
                      <div className="settings-tile-info">
                        <div className="settings-tile-title">Procedural UI Audio Feedback</div>
                        <div className="settings-tile-desc">Synthesized acoustic earcons for clicks, toggles, and wake cues.</div>
                      </div>
                      <label className="oracle-switch">
                        <input
                          type="checkbox" aria-label="UI audio feedback"
                          checked={uiSfxEnabled}
                          onChange={(e) => updateUiSfx(e.target.checked)}
                        />
                        <span className="oracle-switch-slider" />
                      </label>
                    </div>
                  </div>

                  {/* Auto-Dormant Timeout */}
                  <div className="settings-tile">
                    <div className="settings-tile-info">
                      <div className="settings-tile-title">Time to Become Dormant</div>
                      <div className="settings-tile-desc">Transition to minimalist chronometer when workstation is idle.</div>
                    </div>
                    <OracleSelect<number>
                      aria-label="Time to Become Dormant"
                      value={dormantTimeout}
                      onChange={(val) => updateDormantTimeout(Number(val))}
                      options={[
                        { value: 0, label: 'Never (Always Active)', badge: 'OFF' },
                        { value: 60, label: '1 Minute', badge: '1M' },
                        { value: 120, label: '2 Minutes', badge: '2M' },
                        { value: 300, label: '5 Minutes (Default)', badge: '5M' },
                        { value: 600, label: '10 Minutes', badge: '10M' },
                        { value: 900, label: '15 Minutes', badge: '15M' },
                        { value: 1800, label: '30 Minutes', badge: '30M' },
                        { value: 3600, label: '1 Hour', badge: '60M' }
                      ]}
                      triggerStyle={{ marginTop: '4px' }}
                    />
                  </div>
                </div>
              </>
            )}

            {/* PANE: SHORTCUTS & CONTROLS DEMO */}
            {activeTab === 'shortcuts' && (
              <>
                <TaughtCommandsPane />
                <CommandHistoryPane />
                <ShortcutsDemoPane />
              </>
            )}

            {/* PANE: AI INTELLIGENCE */}
            {activeTab === 'intelligence' && (
              <>
                <div className="pane-header-strip">
                  <div className="pane-title-block">
                    <h2>Neural Intelligence & Personality</h2>
                    <p>Configure local LLM inference engines, prompt creativity, and vocal salutations.</p>
                  </div>
                </div>

                <div className="settings-grid-2col">
                  {/* Brain Engine Provider */}
                  <div className="settings-tile">
                    <div className="settings-tile-info">
                      <div className="settings-tile-title">Primary AI Brain Engine</div>
                      <div className="settings-tile-desc">Choose between local private Ollama or Google Cloud models.</div>
                    </div>
                    <div className="settings-pill-row" style={{ marginTop: '4px' }}>
                      <button
                        type="button"
                        className={`settings-option-pill ${aiProvider === 'local' ? 'active' : ''}`}
                        aria-pressed={aiProvider === 'local'}
                        onClick={() => updateAiProvider('local')}
                      >
                        <Shield size={11} />
                        <span>Local Ollama (Private)</span>
                      </button>
                      <button
                        type="button"
                        className={`settings-option-pill ${aiProvider === 'cloud' ? 'active' : ''}`}
                        aria-pressed={aiProvider === 'cloud'}
                        onClick={() => updateAiProvider('cloud')}
                      >
                        <Zap size={11} />
                        <span>Cloud Gemini</span>
                      </button>
                    </div>
                  </div>

                  {/* Local Model Target */}
                  <div className="settings-tile">
                    <div className="settings-tile-row">
                      <div className="settings-tile-info">
                        <div className="settings-tile-title">Local Model Cluster</div>
                        <div className="settings-tile-desc">
                          {availableOllamaModels.length > 0
                            ? `${availableOllamaModels.length} local Ollama model${availableOllamaModels.length > 1 ? 's' : ''} detected on host.`
                            : 'Target model weights deployed on host Ollama instance.'}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void loadOllamaModels()}
                        disabled={loadingModels || modelUpdatePending}
                        title="Rescan Ollama for downloaded models"
                        className="settings-action-btn"
                      >
                        <RefreshCw size={11} className={loadingModels ? 'spin' : ''} />
                        <span>{loadingModels ? 'Scanning...' : 'Rescan'}</span>
                      </button>
                    </div>
                    <OracleSelect
                      aria-label="Local Model Cluster"
                      disabled={loadingModels || modelUpdatePending}
                      value={ollamaModel}
                      onChange={(val) => void updateOllamaModel(val)}
                      options={ollamaModel && !availableOllamaModels.some(model => model.value === ollamaModel)
                        ? [{ value: ollamaModel, label: ollamaModel, badge: 'CURRENT', desc: 'Configured model' }, ...availableOllamaModels]
                        : availableOllamaModels}
                      triggerStyle={{ marginTop: '4px' }}
                    />
                    {modelUpdateError && <div role="alert" className="settings-tile-desc">{modelUpdateError}</div>}
                  </div>
                </div>

                <div className="settings-grid-2col">
                  <ReplyPreferencesPane />
                  {/* Temperature Slider */}
                  <div className="settings-tile">
                    <div className="settings-tile-row">
                      <div className="settings-tile-info">
                        <div className="settings-tile-title">Inference Creativity (Temp)</div>
                        <div className="settings-tile-desc">Balance strict factual responses with natural creativity.</div>
                      </div>
                      <span className="settings-mono-badge">{aiTemperature.toFixed(2)}</span>
                    </div>
                    <div className="settings-range-wrap">
                      <span>0.20</span>
                      <input
                        type="range"
                        min="0.2"
                        max="0.9"
                        step="0.05"
                        aria-label="Inference creativity"
                        value={aiTemperature}
                        onChange={(e) => updateAiTemperature(Number(e.target.value))}
                        className="settings-range-slider"
                      />
                      <span>0.90</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: 'var(--faint)', marginTop: '2px' }}>
                      <span>Deterministic</span>
                      <span>Expressive</span>
                    </div>
                  </div>

                  {/* Operator Salutation */}
                  <div className="settings-tile">
                    <div className="settings-tile-info">
                      <div className="settings-tile-title">Operator Callsign & Salutation</div>
                      <div className="settings-tile-desc">How ORACLE addresses and greets you during voice interactions.</div>
                    </div>
                    <input
                      type="text"
                      aria-label="Operator callsign"
                      value={operatorCallsign}
                      onChange={(e) => updateOperatorCallsign(e.target.value)}
                      placeholder="e.g. Commander, Sahan, Chief Architect"
                      className="settings-input"
                      style={{ marginTop: '4px' }}
                    />
                  </div>
                  <div className="settings-tile">
                    <div className="settings-tile-row">
                      <div className="settings-tile-info">
                        <div className="settings-tile-title">Automatic Vocal Synthesis</div>
                        <div className="settings-tile-desc">Read conversational responses aloud automatically via Kokoro ONNX.</div>
                      </div>
                      <label className="oracle-switch">
                        <input
                          type="checkbox" aria-label="Automatic vocal synthesis"
                          checked={autoSpeak}
                          onChange={(e) => updateAutoSpeak(e.target.checked)}
                        />
                        <span className="oracle-switch-slider" />
                      </label>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* PANE 5: HARDWARE TELEMETRY */}
            {activeTab === 'vitals' && (() => {
              const parsed = parseVitalsData(vitals);
              return (
                <>
                  <div className="pane-header-strip">
                    <div className="pane-title-block">
                      <h2>Hardware Telemetry & Node Vitals</h2>
                      <p>Live diagnostics from host CPU, RAM, and NVIDIA GPU acceleration.</p>
                    </div>
                    <div className="settings-actions">
                      <button
                        type="button"
                        className="vitals-refresh-btn"
                        onClick={() => {
                          onClose();
                          window.dispatchEvent(new CustomEvent('oracle_open_self_diagnostic'));
                        }}
                        style={{ borderColor: 'rgba(56, 189, 248, 0.4)', color: '#38bdf8' }}
                        title="Run Full 5-Stage System Self-Diagnostic (I)"
                      >
                        <Activity size={11} />
                        <span>Run Self Diagnostic</span>
                      </button>
                      <button
                        type="button"
                        className="vitals-refresh-btn"
                        onClick={loadVitals}
                        disabled={loadingVitals}
                      >
                        <RefreshCw size={11} className={loadingVitals ? 'spin' : ''} />
                        <span>Refresh Sensors</span>
                      </button>
                    </div>
                  </div>

                  {/* 4-Metric High-Tech Gauge Grid */}
                  <div className="vitals-metric-grid">
                    {/* CPU */}
                    <div className="vitals-metric-card">
                      <div className="vitals-metric-header">
                        <span className="vitals-metric-title">
                          <Cpu size={12} style={{ color: '#38bdf8' }} />
                          CPU Compute Core
                        </span>
                        <span className="vitals-metric-val">{parsed?.cpu ? `${parsed.cpu}%` : '--'}</span>
                      </div>
                      <div className="vitals-meter-track">
                        <div
                          className={`vitals-meter-fill ${parsed?.cpu && parsed.cpu > 85 ? 'warning' : 'nominal'}`}
                          style={{ width: `${Math.min(100, Math.max(5, parsed?.cpu || 0))}%` }}
                        />
                      </div>
                      <div className="vitals-metric-sub">
                        <span>Multi-Thread Allocation</span>
                        <span style={{ color: parsed?.cpu && parsed.cpu > 80 ? '#f87171' : '#4ade80' }}>
                          {parsed?.cpu && parsed.cpu > 80 ? 'Heavy Load' : 'Nominal'}
                        </span>
                      </div>
                    </div>

                    {/* RAM */}
                    <div className="vitals-metric-card">
                      <div className="vitals-metric-header">
                        <span className="vitals-metric-title">
                          <Activity size={12} style={{ color: '#a78bfa' }} />
                          System Memory (RAM)
                        </span>
                        <span className="vitals-metric-val">
                          {parsed?.ram ? `${parsed.ram.used} / ${parsed.ram.total} GB` : '--'}
                        </span>
                      </div>
                      <div className="vitals-meter-track">
                        <div
                          className={`vitals-meter-fill ${parsed?.ram && parsed.ram.pct > 88 ? 'warning' : 'nominal'}`}
                          style={{ width: `${Math.min(100, Math.max(5, parsed?.ram?.pct || 0))}%` }}
                        />
                      </div>
                      <div className="vitals-metric-sub">
                        <span>Buffer Utilization</span>
                        <span>{parsed?.ram ? `${parsed.ram.pct}% Active` : '--'}</span>
                      </div>
                    </div>

                    {/* GPU & Thermals */}
                    <div className="vitals-metric-card">
                      <div className="vitals-metric-header">
                        <span className="vitals-metric-title">
                          <Zap size={12} style={{ color: '#22c55e' }} />
                          Neural GPU Acceleration
                        </span>
                        <span className="vitals-metric-val">{parsed?.gpuTemp ? `${parsed.gpuTemp}°C` : '--'}</span>
                      </div>
                      <div className="vitals-meter-track">
                        <div
                          className={`vitals-meter-fill ${parsed?.vram && parsed.vram.pct > 85 ? 'warning' : 'nominal'}`}
                          style={{ width: `${Math.min(100, Math.max(5, parsed?.vram?.pct || 0))}%` }}
                        />
                      </div>
                      <div className="vitals-metric-sub">
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '160px' }}>
                          {parsed?.gpuName || 'GPU Engine'}
                        </span>
                        <span>{parsed?.vram ? `${parsed.vram.used} / ${parsed.vram.total} GB VRAM` : 'CUDA Ready'}</span>
                      </div>
                    </div>

                    {/* Battery / Power */}
                    <div className="vitals-metric-card">
                      <div className="vitals-metric-header">
                        <span className="vitals-metric-title">
                          <BatteryCharging size={12} style={{ color: '#f59e0b' }} />
                          Power Supply
                        </span>
                        <span className="vitals-metric-val">{parsed?.battery ? `${parsed.battery.pct}%` : '--'}</span>
                      </div>
                      <div className="vitals-meter-track">
                        <div
                          className="vitals-meter-fill nominal"
                          style={{ width: `${Math.min(100, Math.max(5, parsed?.battery?.pct || 0))}%` }}
                        />
                      </div>
                      <div className="vitals-metric-sub">
                        <span>State: {parsed?.battery?.status || 'Active'}</span>
                        <span style={{ color: '#4ade80' }}>AC Online</span>
                      </div>
                    </div>
                  </div>

                  {/* Active Neural Pipeline Verification */}
                  <div className="settings-tile" style={{ padding: '12px 14px' }}>
                    <div className="settings-tile-title" style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Brain size={12} style={{ color: 'var(--accent)' }} />
                      Active Local Neural Engines
                    </div>
                    <div className="neural-pipeline-grid">
                      <div className="neural-engine-chip">
                        <div className="neural-engine-chip-top">
                          <span className="neural-engine-name">Kokoro ONNX</span>
                          <span style={{ fontSize: '8px', color: '#4ade80', fontFamily: "'JetBrains Mono', monospace" }}>READY</span>
                        </div>
                        <span className="neural-engine-desc">TTS Speech Synthesis</span>
                      </div>
                      <div className="neural-engine-chip">
                        <div className="neural-engine-chip-top">
                          <span className="neural-engine-name">OpenCV YuNet</span>
                          <span style={{ fontSize: '8px', color: '#4ade80', fontFamily: "'JetBrains Mono', monospace" }}>READY</span>
                        </div>
                        <span className="neural-engine-desc">128-d Face Reticles</span>
                      </div>
                      <div className="neural-engine-chip">
                        <div className="neural-engine-chip-top">
                          <span className="neural-engine-name">SFace Biometrics</span>
                          <span style={{ fontSize: '8px', color: '#4ade80', fontFamily: "'JetBrains Mono', monospace" }}>ACTIVE</span>
                        </div>
                        <span className="neural-engine-desc">Cosine Verification</span>
                      </div>
                      <div className="neural-engine-chip">
                        <div className="neural-engine-chip-top">
                          <span className="neural-engine-name">YOLOv8 / YOLOE</span>
                          <span style={{ fontSize: '8px', color: '#4ade80', fontFamily: "'JetBrains Mono', monospace" }}>ARMED</span>
                        </div>
                        <span className="neural-engine-desc">Spatial Object Sentry</span>
                      </div>
                      <div className="neural-engine-chip">
                        <div className="neural-engine-chip-top">
                          <span className="neural-engine-name">Silero VAD v5</span>
                          <span style={{ fontSize: '8px', color: '#4ade80', fontFamily: "'JetBrains Mono', monospace" }}>ONLINE</span>
                        </div>
                        <span className="neural-engine-desc">Hands-Free Audio Gate</span>
                      </div>
                      <div className="neural-engine-chip">
                        <div className="neural-engine-chip-top">
                          <span className="neural-engine-name">Database Vault</span>
                          <span style={{ fontSize: '8px', color: '#4ade80', fontFamily: "'JetBrains Mono', monospace" }}>
                            {dbDiag?.dialect ? dbDiag.dialect.toUpperCase() : 'AES-256'}
                          </span>
                        </div>
                        <span className="neural-engine-desc">{dbDiag?.query_latency_ms ? `${dbDiag.query_latency_ms}ms latency` : 'Encrypted Storage'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Collapsible Raw Diagnostics Console */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <button
                      type="button"
                      className="diagnostics-console-toggle"
                      onClick={() => setShowRawVitals(!showRawVitals)}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {showRawVitals ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                        <span>Raw Hardware Sensor Stream & Node Logs</span>
                      </div>
                      <span style={{ fontSize: '8.5px', color: 'var(--faint)' }}>{showRawVitals ? 'Collapse' : 'Expand'}</span>
                    </button>

                    {showRawVitals && (
                      <div
                        className="vitals-monitor-screen"
                        style={{
                          margin: 0,
                          maxHeight: '140px',
                          overflowY: 'auto',
                          fontSize: '10px',
                          lineHeight: '1.5',
                          whiteSpace: 'pre-wrap'
                        }}
                      >
                        {loadingVitals
                          ? 'Reading host hardware telemetry sensors...'
                          : vitals || 'Click Refresh Sensors to query system vitals.'}
                        {dbDiag && (
                          `\n\n[Vault Database Diagnostics]\nDialect: ${dbDiag.dialect} · Neural Cluster: ${neuralDiag?.provider || "local"} (${neuralDiag?.latency_ms || 12}ms) · Status: ${dbDiag.status}\nLatency: ${dbDiag.query_latency_ms}ms · Migration: ${dbDiag.migration}\nRecords: ${dbDiag.records_verified} · Encryption: ${dbDiag.encryption}`
                        )}
                      </div>
                    )}
                  </div>
                </>
              );
            })()}
          </section>
        </div>
      </motion.div>
    </div>
  );
};
