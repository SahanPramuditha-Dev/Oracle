app_path = 'frontend/src/App.tsx'
with open(app_path, 'r', encoding='utf-8') as f:
    c = f.read()

# 1. Update ConversationHUD import
old_import = "import { ConversationHUD } from './components/ConversationHUD';"
new_import = "import { ConversationHUD, type VoiceEngineStatus } from './components/ConversationHUD';"
assert old_import in c, 'old_import not matched'
c = c.replace(old_import, new_import, 1)

# 2. Update state: voiceActive -> voiceEngine
old_state = "const [voiceActive,setVoiceActive] = useState(false);"
new_state = """const [voiceEngine, setVoiceEngine] = useState<VoiceEngineStatus>({
    active: false,
    mode: 'ptt',
    isListening: false,
    vadStatus: 'Standby'
  });"""
assert old_state in c, 'old_state not matched'
c = c.replace(old_state, new_state, 1)

# 3. Update PresenceHeader sensors mic
old_header_mic = "sensors={{...sensors,mic:{state:voiceActive?'blue':'gray',label:'Microphone',detail:voiceActive?'Capturing speech locally':'Off'},toggleMic:async()=>{setIsChatOpen(true);setVoiceRequest(n=>n+1);}}}"
new_header_mic = """sensors={{
            ...sensors,
            mic: {
              state: voiceEngine.isListening ? 'blue' : voiceEngine.active ? 'blue' : 'gray',
              label: 'Microphone',
              detail: voiceEngine.active
                ? (voiceEngine.mode === 'wake' ? 'Listening for "Hey Oracle"' : 'Continuous Conversation Active')
                : 'Off (Push-to-Talk)'
            },
            toggleMic: async () => {
              if (voiceEngine.active) {
                setVoiceRequest(n => n + 1);
              } else {
                setIsChatOpen(true);
                setVoiceRequest(n => n + 1);
              }
            }
          }}"""
assert old_header_mic in c, 'old_header_mic not matched'
c = c.replace(old_header_mic, new_header_mic, 1)

# 4. Update ConversationHUD call to pass currentMode and onVoiceStatus
old_hud_call = """      {/* Conversational Neural Interface & Command HUD */}
      <ConversationHUD
        isOpen={isChatOpen && mode!=='dormant' && mode!=='initializing' && !recordsOpen}
        onClose={() => setIsChatOpen(false)}
        setMode={setMode}
        initialImage={pendingSnapshot}
        onClearInitialImage={() => setPendingSnapshot(null)}
        onOpenRecords={()=>{setIsChatOpen(false);setRecordsOpen(true);}}
        voiceRequest={voiceRequest}
        onVoiceStatus={setVoiceActive}
      />"""

new_hud_call = """      {/* Ambient Hands-Free Voice Mode Dock (persistent background listening) */}
      {!isChatOpen && voiceEngine.active && mode !== 'dormant' && mode !== 'initializing' && !recordsOpen && (
        <div
          className={`ambient-voice-pill ${voiceEngine.isListening ? 'speaking-active' : ''}`}
          onClick={() => setIsChatOpen(true)}
          role="button"
          tabIndex={0}
          title="Voice Engine Active — Click to open Chat Drawer"
        >
          <div className="ambient-voice-indicator">
            <span className="ambient-voice-pulse" />
            <span className="ambient-voice-dot" />
          </div>
          <div className="ambient-voice-info">
            <span className="ambient-voice-title">
              {voiceEngine.mode === 'wake' ? 'VOICE LINK // "HEY ORACLE"' : 'CONVERSATION MODE // ACTIVE'}
            </span>
            <span className="ambient-voice-subtitle">
              {voiceEngine.isListening
                ? 'Speech Detected — Listening...'
                : voiceEngine.vadStatus || 'Armed & Ready'}
            </span>
          </div>
          <button
            type="button"
            className="ambient-voice-mute-btn"
            onClick={(e) => {
              e.stopPropagation();
              setVoiceRequest((n) => n + 1);
            }}
            title="Mute Voice & Return to Push-to-Talk"
          >
            MUTE
          </button>
        </div>
      )}

      {/* Conversational Neural Interface & Command HUD */}
      <ConversationHUD
        isOpen={isChatOpen && mode!=='dormant' && mode!=='initializing' && !recordsOpen}
        currentMode={mode}
        onClose={() => setIsChatOpen(false)}
        setMode={setMode}
        initialImage={pendingSnapshot}
        onClearInitialImage={() => setPendingSnapshot(null)}
        onOpenRecords={()=>{setIsChatOpen(false);setRecordsOpen(true);}}
        voiceRequest={voiceRequest}
        onVoiceStatus={setVoiceEngine}
      />"""

assert old_hud_call in c, 'old_hud_call not matched'
c = c.replace(old_hud_call, new_hud_call, 1)

with open(app_path, 'w', encoding='utf-8') as f:
    f.write(c)

print('Successfully patched App.tsx')
