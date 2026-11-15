import { OracleSelect } from './OracleSelect';
import { useEffect, useRef, useState, useCallback } from 'react';
import { fetchWithAuth } from '../utils/api';
import { Sliders, ChevronDown, ShieldCheck, Trash2, Check, AlertCircle, Mic, Square, Volume2 } from 'lucide-react';
import { sfx } from '../utils/sfx';

export interface VoiceSampleItem {
  id: string;
  passphrase: string;
  duration_ms: number;
  created: number;
  quality?: any;
}

export interface PersonProfile {
  id: string;
  name: string;
  notes: string;
  created: number;
  relationship: string;
  permission: string;
  enrollment_state: string;
  sample_count: number;
  sample_ids: string[];
  voice_sample_count?: number;
  voice_sample_ids?: string[];
  voice_samples?: VoiceSampleItem[];
}

interface Verification {
  verified: boolean;
  verification_state: string;
  reason?: string;
  cosine_score: number | null;
  expires_at: number | null;
}

export function PersonProfileControls({
  person,
  photo,
  onUpdated
}: {
  person: PersonProfile;
  photo: File | null;
  onUpdated: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState(person.name);
  const [notes, setNotes] = useState(person.notes);
  const [relationship, setRelationship] = useState(person.relationship);
  const [permission, setPermission] = useState(person.permission);
  const [enrollment, setEnrollment] = useState(person.enrollment_state);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [verification, setVerification] = useState<Verification | null>(null);
  const request = useRef<AbortController | null>(null);

  // Voice recording state
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [recordedVoiceBlob, setRecordedVoiceBlob] = useState<Blob | null>(null);
  const [voiceRecordStatus, setVoiceRecordStatus] = useState<string>('');
  const voiceMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const voiceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const challengePhrase = 'Authorize Oracle System';

  useEffect(() => {
    setVerification(null);
    request.current?.abort();
    setBusy(false);
    setStatus('');
    setRecordedVoiceBlob(null);
    setIsRecordingVoice(false);
    setVoiceRecordStatus('');
  }, [photo, person.id]);

  useEffect(() => {
    setName(person.name);
    setNotes(person.notes);
    setRelationship(person.relationship);
    setPermission(person.permission);
    setEnrollment(person.enrollment_state);
    setVerification(null);
  }, [person.name, person.notes, person.relationship, person.permission, person.enrollment_state]);

  useEffect(() => () => request.current?.abort(), []);

  // Clean up any ongoing audio recording when component unmounts
  useEffect(() => {
    return () => {
      if (voiceTimeoutRef.current) clearTimeout(voiceTimeoutRef.current);
      if (voiceStreamRef.current) {
        voiceStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  useEffect(() => {
    if (!verification?.expires_at) return;
    const timer = setTimeout(
      () => setVerification((v) => (v ? { ...v, verified: false, verification_state: 'expired' } : null)),
      Math.max(0, verification.expires_at - Date.now())
    );
    return () => clearTimeout(timer);
  }, [verification]);

  async function mutate(path: string, method: string, body?: object) {
    setBusy(true);
    setStatus('Saving…');
    setVerification(null);
    try {
      const r = await fetchWithAuth(path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || 'Update failed');
      window.dispatchEvent(new Event('oracle_profiles_changed'));
      setStatus('Saved successfully');
      onUpdated();
      setTimeout(() => setStatus(''), 3000);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!photo) {
      setStatus('Choose or capture a face photo in the form below first.');
      return;
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setStatus('Checking selected identity…');
    setVerification(null);
    try {
      const r = await fetchWithAuth(`/api/v1/people/verify?person_id=${encodeURIComponent(person.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': photo.type },
        body: photo,
        signal: controller.signal
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || 'Verification failed');
      if (!controller.signal.aborted) {
        setVerification(data);
        setStatus('');
      }
    } catch (e) {
      if (!controller.signal.aborted) setStatus(e instanceof Error ? e.message : 'Verification failed');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  // Voice recording & enrollment handlers
  const handleStartVoiceRecording = useCallback(async () => {
    try {
      setVoiceRecordStatus('Accessing microphone...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceStreamRef.current = stream;
      voiceChunksRef.current = [];

      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', 'audio/mp4']
        .find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          voiceChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        setIsRecordingVoice(false);
        const blob = new Blob(voiceChunksRef.current, { type: mime || 'audio/webm' });
        if (blob.size >= 800) {
          setRecordedVoiceBlob(blob);
          setVoiceRecordStatus('Sample ready for enrollment');
          sfx.playDiagnosticBlip(2);
        } else {
          setVoiceRecordStatus('Recording too short; hold and speak phrase');
        }
        if (voiceStreamRef.current) {
          voiceStreamRef.current.getTracks().forEach((t) => t.stop());
          voiceStreamRef.current = null;
        }
      };

      recorder.start(100);
      voiceMediaRecorderRef.current = recorder;
      setIsRecordingVoice(true);
      setVoiceRecordStatus('Listening... say "Authorize Oracle System"');
      sfx.playDiagnosticBlip(1);

      // Auto-stop after 3.8 seconds
      voiceTimeoutRef.current = setTimeout(() => {
        if (recorder.state === 'recording') {
          recorder.stop();
        }
      }, 3800);
    } catch (err) {
      console.error('Failed to start voice recording:', err);
      setVoiceRecordStatus('Microphone permission denied');
    }
  }, []);

  const handleStopVoiceRecording = useCallback(() => {
    if (voiceTimeoutRef.current) {
      clearTimeout(voiceTimeoutRef.current);
      voiceTimeoutRef.current = null;
    }
    if (voiceMediaRecorderRef.current && voiceMediaRecorderRef.current.state === 'recording') {
      voiceMediaRecorderRef.current.stop();
    }
  }, []);

  const handleUploadVoiceSample = useCallback(async () => {
    if (!recordedVoiceBlob) return;
    setBusy(true);
    setVoiceRecordStatus('Extracting acoustic voiceprint...');
    try {
      const res = await fetchWithAuth(
        `/api/v1/people/${encodeURIComponent(person.id)}/voice/enroll?passphrase=${encodeURIComponent(challengePhrase)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': recordedVoiceBlob.type || 'audio/webm' },
          body: recordedVoiceBlob
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Voice enrollment failed');
      }
      setRecordedVoiceBlob(null);
      setVoiceRecordStatus('Voiceprint enrolled successfully');
      sfx.playDiagnosticBlip(3);
      onUpdated();
      setTimeout(() => setVoiceRecordStatus(''), 3500);
    } catch (err: any) {
      setVoiceRecordStatus(err.message || 'Enrollment failed');
    } finally {
      setBusy(false);
    }
  }, [recordedVoiceBlob, person.id, challengePhrase, onUpdated]);

  const handleDeleteVoiceSample = useCallback(async (sampleId: string) => {
    if (!window.confirm('Delete this acoustic voice sample?')) return;
    setBusy(true);
    try {
      const res = await fetchWithAuth(
        `/api/v1/people/${encodeURIComponent(person.id)}/voice/samples/${encodeURIComponent(sampleId)}`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Failed to delete sample');
      }
      sfx.playDiagnosticBlip(1);
      onUpdated();
    } catch (err: any) {
      setStatus(err.message || 'Failed to delete sample');
    } finally {
      setBusy(false);
    }
  }, [person.id, onUpdated]);

  const voiceSampleList = person.voice_samples || [];
  const voiceCount = person.voice_sample_count ?? voiceSampleList.length;

  return (
    <div className="profile-controls-wrap">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`profile-drawer-toggle ${isOpen ? 'active' : ''}`}
        aria-expanded={isOpen}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Sliders size={11} />
          <span>Edit profile / verify face & voice</span>
          <span style={{ fontSize: "9.5px", opacity: 0.65, fontFamily: "'JetBrains Mono', monospace" }}>
            ({person.relationship} · {person.permission} · {voiceCount} voice · {person.sample_count} face)
          </span>
        </div>
        <ChevronDown
          size={12}
          style={{
            transform: isOpen ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
          }}
        />
      </button>

      {isOpen && (
        <div className="profile-drawer-content">
          <div className="profile-id-tag">
            <span>ID: {person.id}</span>
            <span>STATE: {person.enrollment_state.replaceAll('_', ' ').toUpperCase()}</span>
          </div>

          <div className="profile-fields-grid">
            <label className="profile-field">
              <span>Display Name</span>
              <input
                aria-label={`Name for ${person.id}`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
                className="settings-input"
              />
            </label>

            <label className="profile-field">
              <span>Clearance Notes</span>
              <input
                aria-label={`Notes for ${person.id}`}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={2000}
                placeholder="Optional notes"
                className="settings-input"
              />
            </label>

            <label className="profile-field">
              <span>Relationship</span>
              <OracleSelect
                aria-label={`Relationship for ${person.id}`}
                value={relationship}
                onChange={(val) => setRelationship(val)}
                options={['owner', 'family', 'friend', 'colleague', 'guest'].map((v) => ({
                  value: v,
                  label: v.toUpperCase()
                }))}
              />
            </label>

            <label className="profile-field">
              <span>Permission Tier</span>
              <OracleSelect
                aria-label={`Permission for ${person.id}`}
                value={permission}
                onChange={(val) => setPermission(val)}
                options={['standard', 'administrator', 'disabled'].map((v) => ({
                  value: v,
                  label: v.toUpperCase()
                }))}
              />
            </label>

            <label className="profile-field" style={{ gridColumn: 'span 2' }}>
              <span>Enrollment Lifecycle</span>
              <OracleSelect
                aria-label={`Enrollment for ${person.id}`}
                value={enrollment}
                onChange={(val) => setEnrollment(val)}
                options={['incomplete', 'active', 'needs_new_samples', 'revoked'].map((v) => ({
                  value: v,
                  label: v.replaceAll('_', ' ').toUpperCase()
                }))}
              />
            </label>
          </div>

          <div className="profile-drawer-actions">
            <button
              disabled={busy}
              type="button"
              onClick={() =>
                mutate(`/api/v1/people/${person.id}`, 'PATCH', {
                  name,
                  notes,
                  relationship,
                  permission,
                  enrollment_state: enrollment
                })
              }
              className="person-action-btn primary"
            >
              <Check size={11} />
              <span>Save profile</span>
            </button>

            <button
              disabled={busy}
              type="button"
              onClick={verify}
              className="person-action-btn"
            >
              <ShieldCheck size={11} />
              <span>Verify selected photo</span>
            </button>
          </div>

          {verification && (
            <div
              className={`profile-verification-banner ${
                verification.verified ? 'success' : 'warning'
              }`}
            >
              {verification.verified ? (
                <Check size={12} style={{ color: '#4ade80' }} />
              ) : (
                <AlertCircle size={12} style={{ color: '#f59e0b' }} />
              )}
              <span>
                {verification.verification_state === 'expired'
                  ? 'Verification token expired.'
                  : verification.verified
                  ? `Face match verified for 30 seconds. ${
                      typeof verification.cosine_score === 'number'
                        ? `Cosine similarity: ${(verification.cosine_score * 100).toFixed(1)}%`
                        : ''
                    }`
                  : `${verification.reason || verification.verification_state}.`}
              </span>
              <div style={{ marginTop: 4, fontSize: "9.5px", color: "var(--muted)" }}>
                A face match does not approve access. Liveness and voice factor verification are required for administration.
              </div>
            </div>
          )}

          {status && <div className="profile-status-message">{status}</div>}

          {/* ==================== VOICEPRINT BIOMETRICS STUDIO ==================== */}
          <div className="profile-samples-rack" style={{ marginTop: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span className="profile-samples-head" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <Mic size={11} style={{ color: 'var(--accent)' }} />
                <span>Acoustic Voiceprint Samples ({voiceCount}/3 enrolled)</span>
              </span>
              <span style={{ fontSize: '9px', color: voiceCount >= 1 ? '#4ade80' : 'var(--muted)', fontFamily: "'JetBrains Mono', monospace" }}>
                {voiceCount >= 3 ? '✓ Complete' : voiceCount >= 1 ? 'Active (Add more for accuracy)' : 'None enrolled'}
              </span>
            </div>

            {/* Guided Voice Recording Control */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                padding: '10px 12px',
                background: 'rgba(157, 180, 211, 0.04)',
                border: '1px solid rgba(157, 180, 211, 0.15)',
                borderRadius: '8px',
                marginBottom: '8px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: '10.5px', color: 'var(--foreground)', fontWeight: 500 }}>
                    Enroll Voice Password
                  </span>
                  <span style={{ fontSize: '9px', color: 'var(--muted)' }}>
                    Challenge phrase: <strong style={{ color: 'var(--accent)' }}>"{challengePhrase}"</strong>
                  </span>
                </div>

                <div style={{ display: 'flex', gap: '6px' }}>
                  {isRecordingVoice ? (
                    <button
                      type="button"
                      onClick={handleStopVoiceRecording}
                      className="person-action-btn primary"
                      style={{ background: '#ef4444', borderColor: '#ef4444' }}
                    >
                      <Square size={10} />
                      <span>Stop</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleStartVoiceRecording}
                      className="person-action-btn"
                    >
                      <Mic size={10} />
                      <span>{recordedVoiceBlob ? 'Re-Record' : 'Record Phrase'}</span>
                    </button>
                  )}

                  {recordedVoiceBlob && !isRecordingVoice && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleUploadVoiceSample}
                      className="person-action-btn primary"
                    >
                      <Check size={10} />
                      <span>Commit Sample</span>
                    </button>
                  )}
                </div>
              </div>

              {voiceRecordStatus && (
                <div
                  style={{
                    fontSize: '9.5px',
                    fontFamily: "'JetBrains Mono', monospace",
                    color: voiceRecordStatus.includes('failed') || voiceRecordStatus.includes('denied') || voiceRecordStatus.includes('short')
                      ? '#f87171'
                      : voiceRecordStatus.includes('Listening')
                      ? '#38bdf8'
                      : '#4ade80',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <Volume2 size={10} />
                  <span>{voiceRecordStatus}</span>
                </div>
              )}
            </div>

            {/* List of enrolled voiceprints */}
            {voiceSampleList.length > 0 && (
              <div className="profile-samples-list">
                {voiceSampleList.map((sample, i) => (
                  <div key={sample.id} className="profile-sample-item">
                    <span>
                      Voiceprint #{i + 1} ({sample.duration_ms ? `${(sample.duration_ms / 1000).toFixed(1)}s` : 'Enrolled'})
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleDeleteVoiceSample(sample.id)}
                      className="profile-sample-delete"
                      title="Delete voice sample"
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ==================== FACE SAMPLE RACK ==================== */}
          {person.sample_ids.length > 0 && (
            <div className="profile-samples-rack" style={{ marginTop: '10px' }}>
              <span className="profile-samples-head">
                Enrolled Optical Face Samples ({person.sample_count})
              </span>
              <div className="profile-samples-list">
                {person.sample_ids.map((id, i) => (
                  <div key={id} className="profile-sample-item">
                    <span>Angle #{i + 1}</span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm('Delete this face sample?')) {
                          void mutate(`/api/v1/people/${person.id}/samples/${id}`, 'DELETE');
                        }
                      }}
                      className="profile-sample-delete"
                      title="Delete sample"
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
