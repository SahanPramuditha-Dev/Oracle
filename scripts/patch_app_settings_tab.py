app_path = 'frontend/src/App.tsx'
with open(app_path, 'r', encoding='utf-8') as f:
    c = f.read()

# 1. Add settingsTab state and event listener
old_state = "  const [isSettingsOpen, setIsSettingsOpen] = useState(false);"
new_state = """  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'faces' | 'camera' | 'voice' | 'vitals'>('faces');

  useEffect(() => {
    const handleOpenSettings = (e: Event) => {
      const custom = e as CustomEvent<'faces' | 'camera' | 'voice' | 'vitals'>;
      if (custom.detail) {
        setSettingsTab(custom.detail);
      }
      setIsSettingsOpen(true);
    };
    window.addEventListener('oracle_open_settings', handleOpenSettings);
    return () => window.removeEventListener('oracle_open_settings', handleOpenSettings);
  }, []);"""

assert old_state in c, "old_state not found"
c = c.replace(old_state, new_state, 1)

# 2. Update mute button in ambient pill
old_mute = """          <button
            type="button"
            className="ambient-voice-mute-btn"
            onClick={(e) => {
              e.stopPropagation();
              setVoiceRequest((n) => n + 1);
            }}
            title="Mute Voice & Return to Push-to-Talk"
          >
            MUTE
          </button>"""

new_mute = """          <button
            type="button"
            className="ambient-voice-mute-btn"
            onClick={(e) => {
              e.stopPropagation();
              localStorage.setItem('oracle_speech_mode', 'ptt');
              window.dispatchEvent(new CustomEvent('oracle_speech_mode_changed', { detail: 'ptt' }));
              setVoiceRequest((n) => n + 1);
            }}
            title="Mute Voice & Return to Push-to-Talk"
          >
            MUTE
          </button>"""

assert old_mute in c, "old_mute not found"
c = c.replace(old_mute, new_mute, 1)

# 3. Update SystemSettingsModal call to pass initialTab
old_modal_call = """      <SystemSettingsModal
        isOpen={isSettingsOpen && mode!=='dormant'}
        onClose={() => setIsSettingsOpen(false)}
        cameraStream={sensors.cameraStream}
      />"""

new_modal_call = """      <SystemSettingsModal
        isOpen={isSettingsOpen && mode!=='dormant'}
        onClose={() => setIsSettingsOpen(false)}
        cameraStream={sensors.cameraStream}
        initialTab={settingsTab}
      />"""

assert old_modal_call in c, "old_modal_call not found"
c = c.replace(old_modal_call, new_modal_call, 1)

with open(app_path, 'w', encoding='utf-8') as f:
    f.write(c)

print("Successfully updated App.tsx")
