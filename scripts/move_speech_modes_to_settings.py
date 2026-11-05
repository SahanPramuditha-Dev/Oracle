import re

# 1. Update SystemSettingsModal.tsx
with open('frontend/src/components/SystemSettingsModal.tsx', 'r', encoding='utf-8') as f:
    modal_code = f.read()

# Update props interface
old_modal_props = """interface SystemSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  cameraStream?: MediaStream | null;
}"""

new_modal_props = """interface SystemSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  cameraStream?: MediaStream | null;
  initialTab?: 'faces' | 'camera' | 'voice' | 'vitals';
  onSpeechModeChange?: (mode: 'ptt' | 'vad' | 'wake') => void;
}"""

assert old_modal_props in modal_code, "old_modal_props not matched"
modal_code = modal_code.replace(old_modal_props, new_modal_props, 1)

# Update component signature and initialTab hook
old_modal_sig = "export const SystemSettingsModal: React.FC<SystemSettingsModalProps> = ({ isOpen, onClose, cameraStream }) => {"
new_modal_sig = """export const SystemSettingsModal: React.FC<SystemSettingsModalProps> = ({
  isOpen,
  onClose,
  cameraStream,
  initialTab = 'faces',
  onSpeechModeChange
}) => {
  const [activeTab, setActiveTab] = useState<'faces' | 'camera' | 'voice' | 'vitals'>(initialTab);

  useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);"""

# Notice line 16 has: const [activeTab, setActiveTab] = useState<'faces' | 'camera' | 'voice' | 'vitals'>('faces');
old_tab_line = "  const [activeTab, setActiveTab] = useState<'faces' | 'camera' | 'voice' | 'vitals'>('faces');"
modal_code = modal_code.replace(old_modal_sig + "\n" + old_tab_line, new_modal_sig, 1)

# Normalize speechModePref state initialization
old_speech_state = "  const [speechModePref, setSpeechModePref] = useState(() => localStorage.getItem('oracle_speech_mode') || 'ptt');"
new_speech_state = """  const [speechModePref, setSpeechModePref] = useState<'ptt' | 'vad' | 'wake'>(() => {
    const saved = localStorage.getItem('oracle_speech_mode');
    return (saved === 'vad' || saved === 'wake' || saved === 'silero')
      ? (saved === 'silero' ? 'vad' : (saved as 'ptt' | 'vad' | 'wake'))
      : 'ptt';
  });"""
assert old_speech_state in modal_code, "old_speech_state not matched"
modal_code = modal_code.replace(old_speech_state, new_speech_state, 1)

# Update updateSpeechMode function to emit custom event and callback
old_update_fn = """  const updateSpeechMode = (mode: string) => {
    setSpeechModePref(mode);
    localStorage.setItem('oracle_speech_mode', mode);
  };"""

new_update_fn = """  const updateSpeechMode = (mode: 'ptt' | 'vad' | 'wake') => {
    setSpeechModePref(mode);
    localStorage.setItem('oracle_speech_mode', mode);
    soundEffects.playActivateTone();
    window.dispatchEvent(new CustomEvent('oracle_speech_mode_changed', { detail: mode }));
    onSpeechModeChange?.(mode);
  };"""
assert old_update_fn in modal_code, "old_update_fn not matched"
modal_code = modal_code.replace(old_update_fn, new_update_fn, 1)

# Update Tab 3 Speech Mode UI section in SystemSettingsModal.tsx
old_mode_section = """              {/* Speech Mode Selector */}
              <div className="settings-tile">
                <div className="settings-tile-title">Default Speech Input Mode</div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {[
                    { id: 'ptt', label: 'Push-to-Talk (PTT)' },
                    { id: 'silero', label: 'Silero VAD (Hands-Free)' },
                    { id: 'wake', label: 'Wake Word ("Hey Oracle")' }
                  ].map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className={`settings-nav-btn ${speechModePref === m.id ? 'active' : ''}`}
                      style={{ background: speechModePref === m.id ? 'rgba(232, 235, 239, 0.08)' : 'rgba(232, 235, 239, 0.03)', border: '1px solid rgba(232, 235, 239, 0.08)' }}
                      onClick={() => updateSpeechMode(m.id)}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>"""

new_mode_section = """              {/* Speech Mode Selector Cards */}
              <div className="settings-tile" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div className="settings-tile-title">Speech Interaction Mode</div>
                <div className="settings-tile-desc">
                  Select how ORACLE listens to and engages with your voice across the system. This global setting applies everywhere.
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '10px', marginTop: '4px' }}>
                  {[
                    {
                      id: 'ptt' as const,
                      title: 'Push-to-Talk (PTT)',
                      badge: 'Manual Click',
                      desc: 'Hold or click the mic button to record via Faster-Whisper. Zero background listening. Ideal for privacy.'
                    },
                    {
                      id: 'vad' as const,
                      title: 'Continuous Conversation',
                      badge: 'Silero VAD v5',
                      desc: 'Neural voice activity detection. Speak anytime naturally hands-free. Persists across the entire app.'
                    },
                    {
                      id: 'wake' as const,
                      title: 'Wake Word ("Hey Oracle")',
                      badge: 'Background Link',
                      desc: 'Passively monitors for "Hey Oracle" wake phrase. Awakens and processes directives hands-free.'
                    }
                  ].map((m) => {
                    const isSelected = speechModePref === m.id;
                    return (
                      <div
                        key={m.id}
                        role="button"
                        tabIndex={0}
                        className={`settings-mode-card ${isSelected ? 'active' : ''}`}
                        onClick={() => updateSpeechMode(m.id)}
                        style={{
                          padding: '12px 14px',
                          borderRadius: '8px',
                          background: isSelected ? 'rgba(56, 189, 248, 0.08)' : 'rgba(232, 235, 239, 0.02)',
                          border: isSelected ? '1px solid rgba(56, 189, 248, 0.45)' : '1px solid rgba(232, 235, 239, 0.06)',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{
                            fontFamily: 'JetBrains Mono, monospace',
                            fontSize: '11px',
                            fontWeight: 700,
                            color: isSelected ? '#38bdf8' : 'var(--fg)',
                            letterSpacing: '0.04em'
                          }}>
                            {m.title}
                          </span>
                          <span style={{
                            fontFamily: 'JetBrains Mono, monospace',
                            fontSize: '8.5px',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: isSelected ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255, 255, 255, 0.04)',
                            color: isSelected ? '#38bdf8' : 'var(--muted)',
                            letterSpacing: '0.05em'
                          }}>
                            {m.badge}
                          </span>
                        </div>
                        <div style={{
                          fontFamily: 'Inter, sans-serif',
                          fontSize: '11px',
                          lineHeight: '1.4',
                          color: isSelected ? 'rgba(232, 235, 239, 0.85)' : 'var(--muted)'
                        }}>
                          {m.desc}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>"""

assert old_mode_section in modal_code, "old_mode_section not matched"
modal_code = modal_code.replace(old_mode_section, new_mode_section, 1)

with open('frontend/src/components/SystemSettingsModal.tsx', 'w', encoding='utf-8') as f:
    f.write(modal_code)

print("Updated SystemSettingsModal.tsx")
