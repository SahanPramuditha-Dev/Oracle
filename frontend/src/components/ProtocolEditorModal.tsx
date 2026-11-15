import { useState, useEffect } from 'react';
import { X, Save, Trash2, RotateCcw, Plus, Sparkles, Shield, Mic, Sliders, Volume2 } from 'lucide-react';
import { ProtocolDefinition, ProtocolAction, ProtocolActionType, saveProtocol, deleteProtocol } from '../utils/protocols';

interface ProtocolEditorModalProps {
  isOpen: boolean;
  protocol?: ProtocolDefinition | null;
  onClose: () => void;
  onSaved?: () => void;
}

export function ProtocolEditorModal({ isOpen, protocol, onClose, onSaved }: ProtocolEditorModalProps) {
  const isEditing = Boolean(protocol);
  const isBuiltin = protocol && !protocol.isCustom;

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [badge, setBadge] = useState('');
  const [clearance, setClearance] = useState('All Operators');
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [voicePhrasesInput, setVoicePhrasesInput] = useState('');
  const [standardMode, setStandardMode] = useState('Full access');
  const [adminMode, setAdminMode] = useState('Full access');
  const [requiresAdmin, setRequiresAdmin] = useState(false);
  const [spokenResponse, setSpokenResponse] = useState('');
  
  // Custom action builder
  const [actionType, setActionType] = useState<ProtocolActionType>('speak');
  const [actionPayload, setActionPayload] = useState('');
  const [actions, setActions] = useState<ProtocolAction[]>([]);

  useEffect(() => {
    if (protocol) {
      setName(protocol.name);
      setCode(protocol.code);
      setBadge(protocol.badge);
      setClearance(protocol.clearance);
      setSummary(protocol.summary);
      setDescription(protocol.description);
      setVoicePhrasesInput(protocol.voicePhrases.join(', '));
      setStandardMode(protocol.standardMode);
      setAdminMode(protocol.adminMode);
      setRequiresAdmin(protocol.requiresAdmin);
      setSpokenResponse(protocol.spokenResponse || '');
      setActions(protocol.actions || []);
    } else {
      // New custom protocol defaults
      const randId = Math.floor(10 + Math.random() * 90);
      setName('Protocol Custom');
      setCode(`PROTO-CUST-${randId}`);
      setBadge('CUSTOM PROTOCOL');
      setClearance('All Operators');
      setSummary('Custom user-defined operational protocol');
      setDescription('Custom automated routine tailored for workstation workflow.');
      setVoicePhrasesInput(`activate custom ${randId}, protocol custom ${randId}`);
      setStandardMode('Full access');
      setAdminMode('Full access');
      setRequiresAdmin(false);
      setSpokenResponse(`Custom protocol ${randId} activated.`);
      setActions([]);
    }
  }, [protocol, isOpen]);

  if (!isOpen) return null;

  const handleAddAction = () => {
    if (!actionType) return;
    const newAction: ProtocolAction = {
      id: String(Date.now()),
      type: actionType,
      payload: actionPayload,
      label: `${actionType}: ${actionPayload || 'default'}`
    };
    setActions(prev => [...prev, newAction]);
    setActionPayload('');
  };

  const handleRemoveAction = (id: string) => {
    setActions(prev => prev.filter(a => a.id !== id));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const phrases = voicePhrasesInput
      .split(',')
      .map(p => p.trim().toLowerCase())
      .filter(Boolean);

    const updatedProtocol: ProtocolDefinition = {
      id: protocol ? protocol.id : `custom-${Date.now()}`,
      name: name.trim() || 'Protocol Custom',
      code: code.trim() || 'PROTO-CUST',
      badge: badge.trim() || 'CUSTOM',
      clearance: clearance.trim() || 'All Operators',
      summary: summary.trim() || 'Custom workflow',
      description: description.trim(),
      voicePhrases: phrases.length ? phrases : [name.toLowerCase()],
      standardMode: standardMode.trim(),
      adminMode: adminMode.trim(),
      requiresAdmin,
      status: 'ready',
      isCustom: protocol ? protocol.isCustom : true,
      actions,
      spokenResponse: spokenResponse.trim()
    };

    saveProtocol(updatedProtocol);
    onSaved?.();
    onClose();
  };

  const handleResetToDefault = () => {
    if (protocol) {
      deleteProtocol(protocol.id);
      onSaved?.();
      onClose();
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 960,
        backgroundColor: 'rgba(2, 4, 8, 0.85)',
        backdropFilter: 'blur(16px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        animation: 'fadeIn 0.2s ease-out'
      }}
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '680px',
          maxHeight: '90vh',
          overflowY: 'auto',
          backgroundColor: '#0c1017',
          border: '1px solid rgba(56, 189, 248, 0.35)',
          borderRadius: '12px',
          boxShadow: '0 25px 60px rgba(0, 0, 0, 0.8), 0 0 40px rgba(56, 189, 248, 0.1)',
          display: 'flex',
          flexDirection: 'column',
          color: '#e2e8f0',
          fontFamily: "'Inter', sans-serif"
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(15, 23, 42, 0.6)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Sliders size={18} color="#38bdf8" />
            <div>
              <div style={{ fontSize: '13px', fontWeight: 700, letterSpacing: '0.06em', color: '#38bdf8' }}>
                {isEditing ? `CUSTOMIZE PROTOCOL // ${protocol?.code}` : 'AUTHOR NEW SYSTEM PROTOCOL'}
              </div>
              <div style={{ fontSize: '11px', color: 'rgba(226, 232, 240, 0.55)' }}>
                Configure voice commands, automation chains, and clearance boundaries
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'rgba(255, 255, 255, 0.5)',
              cursor: 'pointer',
              padding: '6px'
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Row 1: Name & Code */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#94a3b8', marginBottom: '6px' }}>
                Protocol Name
              </label>
              <input
                required
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Protocol NIGHTOWL"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: 'rgba(15, 23, 42, 0.8)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  borderRadius: '6px',
                  color: '#fff',
                  fontSize: '12px'
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#94a3b8', marginBottom: '6px' }}>
                Protocol Code
              </label>
              <input
                required
                value={code}
                onChange={e => setCode(e.target.value)}
                placeholder="PROTO-CUST-01"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: 'rgba(15, 23, 42, 0.8)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  borderRadius: '6px',
                  color: '#38bdf8',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '12px'
                }}
              />
            </div>
          </div>

          {/* Row 2: Badge & Clearance */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#94a3b8', marginBottom: '6px' }}>
                Badge Label
              </label>
              <input
                value={badge}
                onChange={e => setBadge(e.target.value)}
                placeholder="e.g. TACTICAL STEALTH"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: 'rgba(15, 23, 42, 0.8)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  borderRadius: '6px',
                  color: '#fff',
                  fontSize: '12px'
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#94a3b8', marginBottom: '6px' }}>
                Clearance Requirement
              </label>
              <select
                value={requiresAdmin ? 'admin' : 'operator'}
                onChange={e => {
                  const isAdmin = e.target.value === 'admin';
                  setRequiresAdmin(isAdmin);
                  setClearance(isAdmin ? 'Administrator Level 5' : 'All Operators');
                }}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: 'rgba(15, 23, 42, 0.8)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  borderRadius: '6px',
                  color: '#fff',
                  fontSize: '12px'
                }}
              >
                <option value="operator">All Operators (Standard Clearance)</option>
                <option value="admin">Administrator Level 5 (Biometric Verification Required)</option>
              </select>
            </div>
          </div>

          {/* Row 3: Voice Phrases */}
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 600, color: '#94a3b8', marginBottom: '6px' }}>
              <Mic size={12} color="#38bdf8" /> Spoken Voice Trigger Phrases (Comma separated)
            </label>
            <input
              required
              value={voicePhrasesInput}
              onChange={e => setVoicePhrasesInput(e.target.value)}
              placeholder="e.g. activate nightowl, nightowl protocol, engage stealth"
              style={{
                width: '100%',
                padding: '8px 12px',
                backgroundColor: 'rgba(15, 23, 42, 0.8)',
                border: '1px solid rgba(56, 189, 248, 0.25)',
                borderRadius: '6px',
                color: '#fff',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '12px'
              }}
            />
            <span style={{ fontSize: '10px', color: 'rgba(255, 255, 255, 0.4)', marginTop: '4px', display: 'block' }}>
              Speaking any of these phrases to ORACLE will automatically trigger this protocol.
            </span>
          </div>

          {/* Row 4: Summary & Description */}
          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#94a3b8', marginBottom: '6px' }}>
              Summary & Purpose
            </label>
            <input
              value={summary}
              onChange={e => setSummary(e.target.value)}
              placeholder="Brief summary of protocol functionality"
              style={{
                width: '100%',
                padding: '8px 12px',
                backgroundColor: 'rgba(15, 23, 42, 0.8)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: '6px',
                color: '#fff',
                fontSize: '12px',
                marginBottom: '8px'
              }}
            />
            <textarea
              rows={2}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Detailed description of what this protocol executes..."
              style={{
                width: '100%',
                padding: '8px 12px',
                backgroundColor: 'rgba(15, 23, 42, 0.8)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: '6px',
                color: '#fff',
                fontSize: '12px',
                resize: 'none'
              }}
            />
          </div>

          {/* Row 5: Permissions Matrix Customization */}
          <div
            style={{
              padding: '12px',
              backgroundColor: 'rgba(15, 23, 42, 0.5)',
              borderRadius: '8px',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 700, color: '#38bdf8' }}>
              <Shield size={12} /> PERMISSIONS MATRIX CONFIGURATION
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '10px', color: 'rgba(255, 255, 255, 0.6)', display: 'block', marginBottom: '4px' }}>
                  Standard Mode Behavior:
                </label>
                <input
                  value={standardMode}
                  onChange={e => setStandardMode(e.target.value)}
                  placeholder="e.g. Basic maps, view status"
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    backgroundColor: 'rgba(10, 14, 23, 0.8)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '4px',
                    color: '#e2e8f0',
                    fontSize: '11px'
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: '10px', color: '#38bdf8', display: 'block', marginBottom: '4px' }}>
                  Administrator Level 5 Mode Behavior:
                </label>
                <input
                  value={adminMode}
                  onChange={e => setAdminMode(e.target.value)}
                  placeholder="e.g. Privileged override, full audit"
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    backgroundColor: 'rgba(10, 14, 23, 0.8)',
                    border: '1px solid rgba(56, 189, 248, 0.2)',
                    borderRadius: '4px',
                    color: '#bae6fd',
                    fontSize: '11px'
                  }}
                />
              </div>
            </div>
          </div>

          {/* Row 6: Spoken Kokoro Voice Feedback */}
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 600, color: '#94a3b8', marginBottom: '6px' }}>
              <Volume2 size={12} color="#4ade80" /> Spoken Kokoro Speech Announcement (Optional)
            </label>
            <input
              value={spokenResponse}
              onChange={e => setSpokenResponse(e.target.value)}
              placeholder="e.g. Nightowl protocol engaged. Display dimmed, audio muted."
              style={{
                width: '100%',
                padding: '8px 12px',
                backgroundColor: 'rgba(15, 23, 42, 0.8)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: '6px',
                color: '#fff',
                fontSize: '12px'
              }}
            />
          </div>

          {/* Row 7: Custom Action Sequence Builder */}
          <div
            style={{
              padding: '12px',
              backgroundColor: 'rgba(15, 23, 42, 0.5)',
              borderRadius: '8px',
              border: '1px solid rgba(255, 255, 255, 0.05)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 700, color: '#4ade80', marginBottom: '8px' }}>
              <Sparkles size={12} /> AUTOMATION ACTION SEQUENCE
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 2fr auto', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
              <select
                value={actionType}
                onChange={e => setActionType(e.target.value as ProtocolActionType)}
                style={{
                  padding: '7px 10px',
                  backgroundColor: 'rgba(10, 14, 23, 0.8)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '4px',
                  color: '#fff',
                  fontSize: '11px'
                }}
              >
                <option value="timer">Start Focus Timer (Minutes)</option>
                <option value="privacy">Enable Ghost Mode</option>
                <option value="volume">Set System Volume (%)</option>
                <option value="map">Launch Spatial Atlas Map</option>
                <option value="desktop_hud">Open Desktop Active HUD</option>
                <option value="sentry">Engage Optical Sentry Camera</option>
                <option value="dormant">Set Low-Power Dormant</option>
                <option value="diagnostic">Launch Diagnostics Probe</option>
                <option value="launch_app">Launch Application</option>
                <option value="speak">Voice Synthesis Speech</option>
              </select>

              <input
                value={actionPayload}
                onChange={e => setActionPayload(e.target.value)}
                placeholder={
                  actionType === 'timer'
                    ? 'Duration in minutes (e.g. 30)'
                    : actionType === 'volume'
                    ? 'Volume level 0-100 (e.g. 20)'
                    : actionType === 'launch_app'
                    ? 'App name or path (e.g. code)'
                    : 'Optional payload / argument'
                }
                style={{
                  padding: '7px 10px',
                  backgroundColor: 'rgba(10, 14, 23, 0.8)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '4px',
                  color: '#fff',
                  fontSize: '11px'
                }}
              />

              <button
                type="button"
                onClick={handleAddAction}
                style={{
                  padding: '7px 12px',
                  backgroundColor: 'rgba(56, 189, 248, 0.15)',
                  border: '1px solid #38bdf8',
                  borderRadius: '4px',
                  color: '#38bdf8',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <Plus size={12} /> Add
              </button>
            </div>

            {/* Configured Actions List */}
            {actions.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
                {actions.map((act, idx) => (
                  <div
                    key={act.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px 10px',
                      backgroundColor: 'rgba(0, 0, 0, 0.4)',
                      borderRadius: '4px',
                      border: '1px solid rgba(255, 255, 255, 0.05)',
                      fontSize: '11px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ color: '#38bdf8', fontFamily: "'JetBrains Mono', monospace" }}>#{idx + 1}</span>
                      <span style={{ color: '#fff' }}>{act.type.toUpperCase()}</span>
                      {act.payload && (
                        <span style={{ color: 'rgba(255, 255, 255, 0.5)', fontFamily: "'JetBrains Mono', monospace" }}>
                          ({act.payload})
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveAction(act.id)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#f87171',
                        cursor: 'pointer',
                        padding: '2px 4px'
                      }}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: '10px', color: 'rgba(255, 255, 255, 0.4)', fontStyle: 'italic' }}>
                No custom automation steps added yet. Add steps above to trigger them automatically when activated.
              </div>
            )}
          </div>

          {/* Actions Footer */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: '10px',
              paddingTop: '16px',
              borderTop: '1px solid rgba(255, 255, 255, 0.08)'
            }}
          >
            <div>
              {isBuiltin && (
                <button
                  type="button"
                  onClick={handleResetToDefault}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 14px',
                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                    border: '1px solid rgba(245, 158, 11, 0.4)',
                    borderRadius: '6px',
                    color: '#fbbf24',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  <RotateCcw size={12} /> Reset to Default
                </button>
              )}
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: '8px 16px',
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '6px',
                  color: 'rgba(255, 255, 255, 0.7)',
                  fontSize: '11px',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>

              <button
                type="submit"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 18px',
                  backgroundColor: 'rgba(56, 189, 248, 0.2)',
                  border: '1px solid #38bdf8',
                  borderRadius: '6px',
                  color: '#38bdf8',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: '0 0 15px rgba(56, 189, 248, 0.2)'
                }}
              >
                <Save size={13} /> Save Protocol
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
