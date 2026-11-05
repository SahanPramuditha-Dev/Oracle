path = 'frontend/src/components/ConversationHUD.tsx'
with open(path, 'r', encoding='utf-8') as f:
    c = f.read()

# 1. Initialize speechMode from localStorage
old_speech_state = "  const [speechMode, setSpeechMode] = useState<SpeechMode>('ptt');"
new_speech_state = """  const [speechMode, setSpeechMode] = useState<SpeechMode>(() => {
    const saved = localStorage.getItem('oracle_speech_mode');
    return (saved === 'vad' || saved === 'wake' || saved === 'silero')
      ? (saved === 'silero' ? 'vad' : (saved as SpeechMode))
      : 'ptt';
  });

  // Dynamically sync speechMode when changed in Settings or via ambient pill
  useEffect(() => {
    const handleModeChange = (e: Event) => {
      const custom = e as CustomEvent<SpeechMode>;
      if (custom.detail && (custom.detail === 'ptt' || custom.detail === 'vad' || custom.detail === 'wake')) {
        setSpeechMode(custom.detail);
        if (custom.detail !== 'ptt') {
          setIsVoiceEnabled(true);
        }
      }
    };
    window.addEventListener('oracle_speech_mode_changed', handleModeChange);
    return () => window.removeEventListener('oracle_speech_mode_changed', handleModeChange);
  }, []);"""

assert old_speech_state in c, "old_speech_state not found"
c = c.replace(old_speech_state, new_speech_state, 1)

# 2. Replace segmented buttons with clean mode tag in hud-blade-subbar
old_subbar_segment = """                <div className="hud-blade-segmented">
                  <button
                    type="button"
                    className={`hud-blade-segment-btn ${speechMode === 'ptt' ? 'active' : ''}`}
                    onClick={() => { soundEffects.playActivateTone(); setSpeechMode('ptt'); }}
                    title="Push to Talk: Hold/Click to record"
                  >
                    PTT
                  </button>

                  <button
                    type="button"
                    className={`hud-blade-segment-btn ${speechMode === 'vad' ? 'active' : ''}`}
                    onClick={() => { soundEffects.playActivateTone(); setSpeechMode('vad'); setIsVoiceEnabled(true); }}
                    title="Silero VAD: Automatic hands-free speech detection"
                  >
                    <Zap size={10} />
                    <span>VAD</span>
                  </button>

                  <button
                    type="button"
                    className={`hud-blade-segment-btn ${speechMode === 'wake' ? 'active' : ''}`}
                    onClick={() => { soundEffects.playActivateTone(); setSpeechMode('wake'); setIsVoiceEnabled(true); }}
                    title="Wake-Word: Activates when 'Hey Oracle' is spoken"
                  >
                    <Ear size={10} />
                    <span>WAKE</span>
                  </button>
                </div>"""

new_subbar_tag = """                <div
                  className="hud-blade-mode-tag"
                  onClick={() => window.dispatchEvent(new CustomEvent('oracle_open_settings', { detail: 'voice' }))}
                  title="Speech Mode configured in System Settings (Click to configure)"
                  role="button"
                  tabIndex={0}
                >
                  <span className="mode-tag-icon">
                    {speechMode === 'wake' ? (
                      <Ear size={11} color="#fbbf24" />
                    ) : speechMode === 'vad' ? (
                      <Zap size={11} color="#4ade80" />
                    ) : (
                      <MicOff size={11} color="var(--muted)" />
                    )}
                  </span>
                  <span className="mode-tag-label">
                    {speechMode === 'wake'
                      ? 'WAKE-WORD // "HEY ORACLE"'
                      : speechMode === 'vad'
                      ? 'CONTINUOUS VAD'
                      : 'PUSH-TO-TALK'}
                  </span>
                </div>"""

assert old_subbar_segment in c, "old_subbar_segment not found"
c = c.replace(old_subbar_segment, new_subbar_tag, 1)

with open(path, 'w', encoding='utf-8') as f:
    f.write(c)

print("Successfully updated ConversationHUD.tsx")
