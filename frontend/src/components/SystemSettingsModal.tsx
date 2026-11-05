import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { X, UserCheck, Trash2, Camera, Shield, Cpu, Volume2, Plus, Sparkles, RefreshCw, UserPlus } from 'lucide-react';
import { fetchWithAuth } from '../utils/api';
import { soundEffects } from '../utils/audioEffects';
import { PersonProfileControls, type PersonProfile } from './PersonProfileControls';
import './SystemSettingsModal.css';

// Preset roles for biometric authority & clearance
const ROLE_OPTIONS = [
  { id: 'owner', label: 'Primary Operator (Root Owner)', defaultTitle: 'Primary Operator', rel: 'owner', perm: 'administrator' },
  { id: 'admin', label: 'System Administrator (Alpha-1)', defaultTitle: 'System Administrator', rel: 'colleague', perm: 'administrator' },
  { id: 'family', label: 'Family / Trusted Member', defaultTitle: 'Family Member', rel: 'family', perm: 'standard' },
  { id: 'colleague', label: 'Team / Colleague', defaultTitle: 'Colleague', rel: 'colleague', perm: 'standard' },
  { id: 'guest', label: 'Authorized Guest', defaultTitle: 'Authorized Guest', rel: 'guest', perm: 'standard' },
  { id: 'custom', label: '+ Custom Role / Title...', defaultTitle: '', rel: 'colleague', perm: 'standard' }
] as const;

interface SystemSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  cameraStream?: MediaStream | null;
  initialTab?: 'faces' | 'camera' | 'voice' | 'vitals';
}

export const SystemSettingsModal: React.FC<SystemSettingsModalProps> = ({
  isOpen,
  onClose,
  cameraStream,
  initialTab
}) => {
  const [activeTab, setActiveTab] = useState<'faces' | 'enroll' | 'camera' | 'voice' | 'vitals'>(
    () => initialTab || 'faces'
  );

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  // Faces state
  const [people, setPeople] = useState<PersonProfile[]>([]);
  const [loadingPeople, setLoadingPeople] = useState(false);
  const [enrollName, setEnrollName] = useState('');
  const [enrollNotes, setEnrollNotes] = useState('');
  const [selectedRole, setSelectedRole] = useState<'owner' | 'admin' | 'family' | 'colleague' | 'guest' | 'custom'>('owner');
  const [customRoleTitle, setCustomRoleTitle] = useState('');
  const [customIsAdmin, setCustomIsAdmin] = useState(false);
  const [enrollPersonId, setEnrollPersonId] = useState<string | null>(null);
  const [appendSample, setAppendSample] = useState(false);
  const [enrollImageFile, setEnrollImageFile] = useState<File | null>(null);
  const [enrollImagePreview, setEnrollImagePreview] = useState<string | null>(null);
  const [enrollStatus, setEnrollStatus] = useState<string | null>(null);
  const [isEnrolling, setIsEnrolling] = useState(false);

  // Live camera preview for enrollment
  const [isLiveCameraActive, setIsLiveCameraActive] = useState(false);
  const [liveStream, setLiveStream] = useState<MediaStream | null>(null);
  const liveVideoRef = useRef<HTMLVideoElement | null>(null);

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
    () => localStorage.getItem('oracle_speech_mode') || 'ptt'
  );
  const [chimesEnabled, setChimesEnabled] = useState(
    () => localStorage.getItem('oracle_chimes_enabled') !== 'false'
  );
  const [voicePersona, setVoicePersona] = useState(
    () => localStorage.getItem('oracle_voice_persona') || 'af_heart'
  );

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

  useEffect(() => {
    if (isOpen) {
      loadPeople();
      if (activeTab === 'vitals') {
        loadVitals();
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
      const res = await fetchWithAuth('/api/v1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'system vitals' })
      });
      if (res.ok) {
        const data = await res.json();
        setVitals(data.message);
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

      const params = new URLSearchParams({
        name: enrollName.trim(),
        notes: finalNotes,
        append_sample: String(appendSample),
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

      soundEffects.playWakeChime();
      const saved = await res.json();

      // Immediately synchronize relationship and clearance permissions to backend
      if (saved.id && !appendSample) {
        try {
          await fetchWithAuth(`/api/v1/people/${saved.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              relationship,
              permission,
              notes: finalNotes
            })
          });
        } catch (patchErr) {
          console.warn('Failed to update person clearance attributes:', patchErr);
        }
      }

      setEnrollStatus(
        `Saved ${saved.sample_count} sample(s). ${
          saved.sample_count < 3
            ? 'Capture another clear view with a different angle or lighting.'
            : 'Enrollment ready. You can add more varied views.'
        }`
      );
      setEnrollPersonId(saved.id);
      setAppendSample(true);
      setEnrollImageFile(null);
      setEnrollImagePreview(null);
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
  };

  const toggleFaceReticles = (enabled: boolean) => {
    setFaceReticlesEnabled(enabled);
    localStorage.setItem('oracle_face_reticles', String(enabled));
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
    setVoicePersona(voice);
    localStorage.setItem('oracle_voice_persona', voice);
  };

  if (!isOpen) return null;

  return (
    <div className="settings-modal-backdrop">
      <motion.div
        className="settings-modal-dialog"
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
            <span className="card-status-badge locked">
              <span className="card-status-dot" />
              100% Nominal
            </span>
            <button
              type="button"
              onClick={() => {
                stopLiveCamera();
                onClose();
              }}
              className="card-header-icon-btn"
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
          <aside className="settings-sidebar">
            <div className="settings-nav-group">
              <span className="settings-nav-label">Biometric Security</span>

              <button
                type="button"
                className={`settings-rail-btn ${activeTab === 'faces' ? 'active' : ''}`}
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
                className={`settings-rail-btn ${activeTab === 'enroll' ? 'active' : ''}`}
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

              <div style={{ height: 8 }} />
              <span className="settings-nav-label">Peripherals & Engine</span>

              <button
                type="button"
                className={`settings-rail-btn ${activeTab === 'camera' ? 'active' : ''}`}
                onClick={() => setActiveTab('camera')}
              >
                <div className="rail-btn-left">
                  <Camera size={13} />
                  <span>Optical & Sentry</span>
                </div>
              </button>

              <button
                type="button"
                className={`settings-rail-btn ${activeTab === 'voice' ? 'active' : ''}`}
                onClick={() => setActiveTab('voice')}
              >
                <div className="rail-btn-left">
                  <Volume2 size={13} />
                  <span>Voice & Audio</span>
                </div>
              </button>

              <button
                type="button"
                className={`settings-rail-btn ${activeTab === 'vitals' ? 'active' : ''}`}
                onClick={() => setActiveTab('vitals')}
              >
                <div className="rail-btn-left">
                  <Cpu size={13} />
                  <span>Telemetry</span>
                </div>
              </button>
            </div>

            <div className="sidebar-footer-telemetry">
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#22c55e' }} />
              <span>ORACLE // SEC_LEVEL_1</span>
            </div>
          </aside>

          {/* Right Content Pane */}
          <main className="settings-content-pane">
            {/* PANE 1: ENROLLED IDENTITIES */}
            {activeTab === 'faces' && (
              <>
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
                <div className="settings-grid-2col" style={{ marginTop: 'auto' }}>
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
                          type="checkbox"
                          checked={greetOperator}
                          onChange={(e) => updateGreetOperator(e.target.checked)}
                        />
                        <span className="oracle-switch-slider" />
                      </label>
                    </div>
                  </div>
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
                        placeholder="e.g. Sahand"
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
                        Clearance Role *
                      </label>
                      <select
                        value={selectedRole}
                        disabled={appendSample}
                        onChange={(e) => setSelectedRole(e.target.value as any)}
                        className="settings-select"
                        style={{
                          width: '100%',
                          boxSizing: 'border-box',
                          background: 'rgba(232, 235, 239, 0.04)',
                          padding: '7px 10px',
                          fontSize: '11px',
                          borderRadius: '6px',
                          color: '#ffffff'
                        }}
                      >
                        {ROLE_OPTIONS.map((opt) => (
                          <option
                            key={opt.id}
                            value={opt.id}
                            style={{ background: '#0e1117', color: opt.id === 'custom' ? '#9db4d3' : '#ffffff' }}
                          >
                            {opt.label}
                          </option>
                        ))}
                      </select>
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
                      <input
                        type="file"
                        accept="image/jpeg,image/png"
                        onChange={handleFileChange}
                        style={{ fontSize: '10.5px', color: 'var(--muted)' }}
                      />
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

                    <button
                      type="submit"
                      disabled={isEnrolling}
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
                    <h2>Optical Sentry & YOLOv8 Inference</h2>
                    <p>Absence auto-lock, YOLOv8 bounding boxes, inference cadence, and camera mirroring.</p>
                  </div>
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
                          type="checkbox"
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
                        <select
                          value={sentryTimeout}
                          onChange={(e) => updateSentryTimeout(Number(e.target.value))}
                          className="settings-select"
                        >
                          <option value={30}>30s (Strict)</option>
                          <option value={60}>60s (Recommended)</option>
                          <option value={120}>2 Minutes</option>
                          <option value={300}>5 Minutes</option>
                        </select>
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
                          type="checkbox"
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
                          <select
                            value={yoloFilter}
                            onChange={(e) => updateYoloFilter(e.target.value)}
                            className="settings-select"
                          >
                            <option value="essentials">Workstation Essentials (Laptop, Phone, Cup, Book)</option>
                            <option value="all">All 80 COCO Classes (Everything Detected)</option>
                          </select>
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
                    <select
                      value={cadenceMode}
                      onChange={(e) => updateCadenceMode(e.target.value)}
                      className="settings-select"
                      style={{ width: '100%', marginTop: '4px' }}
                    >
                      <option value="tactical">Tactical 600ms (High Responsiveness)</option>
                      <option value="balanced">Balanced 1.4s (Optimal for GPU)</option>
                      <option value="eco">Eco 3.0s (Battery Saver)</option>
                    </select>
                  </div>

                  {/* Mirroring & Face Reticles */}
                  <div className="settings-tile" style={{ justifyContent: 'space-around' }}>
                    <div className="settings-tile-row">
                      <div className="settings-tile-info">
                        <div className="settings-tile-title">Mirror Webcam Stream</div>
                        <div className="settings-tile-desc">Horizontally flip feed (Selfie view).</div>
                      </div>
                      <label className="oracle-switch">
                        <input
                          type="checkbox"
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
                          type="checkbox"
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
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                    {[
                      { id: 'ptt', label: 'Push-to-Talk (PTT)' },
                      { id: 'silero', label: 'Silero VAD (Hands-Free)' },
                      { id: 'wake', label: 'Wake Word ("Hey Oracle")' }
                    ].map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className={`settings-rail-btn ${speechModePref === m.id ? 'active' : ''}`}
                        style={{
                          background:
                            speechModePref === m.id
                              ? 'rgba(232, 235, 239, 0.08)'
                              : 'rgba(232, 235, 239, 0.02)',
                          border: '1px solid rgba(232, 235, 239, 0.08)',
                          padding: '10px 12px',
                          justifyContent: 'center'
                        }}
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

                <div className="settings-grid-2col">
                  {/* Procedural Chimes */}
                  <div className="settings-tile">
                    <div className="settings-tile-row">
                      <div className="settings-tile-info">
                        <div className="settings-tile-title">Audio Earcon Chimes</div>
                        <div className="settings-tile-desc">Synthesized dual-tone chimes on wake cues.</div>
                      </div>
                      <label className="oracle-switch">
                        <input
                          type="checkbox"
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
                    <select
                      value={voicePersona}
                      onChange={(e) => updateVoicePersona(e.target.value)}
                      className="settings-select"
                      style={{ marginTop: '4px' }}
                    >
                      <option value="af_heart">af_heart (Default Warm Female)</option>
                      <option value="af_alloy">af_alloy (Crisp Female)</option>
                      <option value="am_adam">am_adam (Authoritative Male)</option>
                      <option value="am_echo">am_echo (Balanced Male)</option>
                      <option value="bf_alice">bf_alice (British Female)</option>
                      <option value="bm_george">bm_george (British Male)</option>
                    </select>
                  </div>
                </div>
              </>
            )}

            {/* PANE 5: HARDWARE TELEMETRY */}
            {activeTab === 'vitals' && (
              <>
                <div className="pane-header-strip">
                  <div className="pane-title-block">
                    <h2>Hardware Telemetry & Node Vitals</h2>
                    <p>Live diagnostics from host CPU, RAM, and NVIDIA GPU acceleration.</p>
                  </div>
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

                <div className="vitals-monitor-screen">
                  {loadingVitals
                    ? 'Reading host hardware telemetry sensors...'
                    : vitals || 'Click Refresh Sensors to query system vitals.'}
                </div>
              </>
            )}
          </main>
        </div>
      </motion.div>
    </div>
  );
};
