import { useEffect, useRef, useState } from 'react';
import { fetchWithAuth } from '../utils/api';
import { Sliders, ChevronDown, ShieldCheck, Trash2, Check, AlertCircle } from 'lucide-react';

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

  useEffect(() => {
    setVerification(null);
    request.current?.abort();
    setBusy(false);
    setStatus('');
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
          <span>Edit Profile & Verify Biometrics</span>
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
              <select
                aria-label={`Relationship for ${person.id}`}
                value={relationship}
                onChange={(e) => setRelationship(e.target.value)}
                className="settings-select"
              >
                {['owner', 'family', 'friend', 'colleague', 'guest'].map((v) => (
                  <option key={v} value={v}>
                    {v.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>

            <label className="profile-field">
              <span>Permission Tier</span>
              <select
                aria-label={`Permission for ${person.id}`}
                value={permission}
                onChange={(e) => setPermission(e.target.value)}
                className="settings-select"
              >
                {['standard', 'administrator', 'disabled'].map((v) => (
                  <option key={v} value={v}>
                    {v.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>

            <label className="profile-field" style={{ gridColumn: 'span 2' }}>
              <span>Enrollment Lifecycle</span>
              <select
                aria-label={`Enrollment for ${person.id}`}
                value={enrollment}
                onChange={(e) => setEnrollment(e.target.value)}
                className="settings-select"
              >
                {['incomplete', 'active', 'needs_new_samples', 'revoked'].map((v) => (
                  <option key={v} value={v}>
                    {v.replaceAll('_', ' ').toUpperCase()}
                  </option>
                ))}
              </select>
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
              <span>Save Changes</span>
            </button>

            <button
              disabled={busy}
              type="button"
              onClick={verify}
              className="person-action-btn"
            >
              <ShieldCheck size={11} />
              <span>Verify Selected Photo</span>
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
                  ? `Face match verified (30s window). ${
                      typeof verification.cosine_score === 'number'
                        ? `Cosine similarity: ${(verification.cosine_score * 100).toFixed(1)}%`
                        : ''
                    }`
                  : `${verification.reason || verification.verification_state}.`}
              </span>
            </div>
          )}

          {status && <div className="profile-status-message">{status}</div>}

          {/* Sample Management Sub-rack */}
          {person.sample_ids.length > 0 && (
            <div className="profile-samples-rack">
              <span className="profile-samples-head">
                Enrolled Angle Samples ({person.sample_count})
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
