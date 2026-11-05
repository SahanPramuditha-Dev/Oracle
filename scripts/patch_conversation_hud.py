hud_path = 'frontend/src/components/ConversationHUD.tsx'
with open(hud_path, 'r', encoding='utf-8') as f:
    c = f.read()

# 1. Export SpeechMode and VoiceEngineStatus, add currentMode
old_props = '''type SpeechMode = 'ptt' | 'vad' | 'wake';

interface ConversationHUDProps {
  isOpen: boolean;
  onClose: () => void;
  setMode: (mode: OracleMode) => void;
  initialImage?: Blob | null;
  onClearInitialImage?: () => void;
  onOpenRecords?: () => void;
  voiceRequest?: number;
  onVoiceStatus?: (active:boolean)=>void;
}'''

new_props = '''export type SpeechMode = 'ptt' | 'vad' | 'wake';

export interface VoiceEngineStatus {
  active: boolean;
  mode: SpeechMode;
  isListening: boolean;
  vadStatus: string;
}

interface ConversationHUDProps {
  isOpen: boolean;
  onClose: () => void;
  setMode: (mode: OracleMode) => void;
  currentMode?: OracleMode;
  initialImage?: Blob | null;
  onClearInitialImage?: () => void;
  onOpenRecords?: () => void;
  voiceRequest?: number;
  onVoiceStatus?: (status: VoiceEngineStatus) => void;
}'''

assert old_props in c, 'old_props not matched'
c = c.replace(old_props, new_props, 1)

# 2. Add currentMode to component props
old_comp = '''export const ConversationHUD: React.FC<ConversationHUDProps> = ({
  isOpen,
  onClose,
  setMode,
  initialImage,
  onClearInitialImage,
  onOpenRecords,
  voiceRequest=0,
  onVoiceStatus
}) => {'''

new_comp = '''export const ConversationHUD: React.FC<ConversationHUDProps> = ({
  isOpen,
  onClose,
  setMode,
  currentMode,
  initialImage,
  onClearInitialImage,
  onOpenRecords,
  voiceRequest = 0,
  onVoiceStatus
}) => {'''

assert old_comp in c, 'old_comp not matched'
c = c.replace(old_comp, new_comp, 1)

# 3. Default isVoiceEnabled to true
old_voice = 'const [isVoiceEnabled, setIsVoiceEnabled] = useState(false);'
new_voice = 'const [isVoiceEnabled, setIsVoiceEnabled] = useState(true);'
assert old_voice in c, 'old_voice not matched'
c = c.replace(old_voice, new_voice, 1)

# 4. Stop logic: don't destroy VAD on !isOpen if speechMode is active
old_stop = '''  const stop = useCallback((resetMode=true) => {
    generation.current++; pttVersion.current++; pending.current?.abort(); pending.current=null;
    isGeneratingRef.current=false; setIsGenerating(false); setIsListening(false);
    pttRecorderRef.current?.cancel(); void vadDetectorRef.current?.destroy(); stopSpeaking(); if(resetMode)setMode('ready');
    if(actionRef.current && !decision.current){const target=actionRef.current;actionRef.current=null;setAction(null);void localApi(`actions/${target.id}`,'DELETE').catch(error=>setVadStatus(String(error)));}
  },[setMode]);
  useEffect(()=>{
    if(!isOpen) stop(false);
    return ()=>{ generation.current++;pttVersion.current++;pending.current?.abort();pttRecorderRef.current?.cancel();void vadDetectorRef.current?.destroy();stopSpeaking(); };
  },[isOpen,stop]);'''

new_stop = '''  const stop = useCallback((resetMode=true) => {
    generation.current++; pttVersion.current++; pending.current?.abort(); pending.current=null;
    isGeneratingRef.current=false; setIsGenerating(false); setIsListening(false);
    pttRecorderRef.current?.cancel();
    if (speechModeRef.current === 'ptt') {
      void vadDetectorRef.current?.destroy();
    }
    stopSpeaking();
    if(resetMode)setMode('ready');
    if(actionRef.current && !decision.current){const target=actionRef.current;actionRef.current=null;setAction(null);void localApi(`actions/${target.id}`,'DELETE').catch(error=>setVadStatus(String(error)));}
  },[setMode]);
  useEffect(()=>{
    if(!isOpen && speechMode === 'ptt') stop(false);
  },[isOpen,speechMode,stop]);
  useEffect(()=>{
    return ()=>{ generation.current++;pttVersion.current++;pending.current?.abort();pttRecorderRef.current?.cancel();void vadDetectorRef.current?.destroy();stopSpeaking(); };
  },[]);'''

assert old_stop in c, 'old_stop not matched'
c = c.replace(old_stop, new_stop, 1)

# 5. Silero VAD lifecycle: remove !isOpen from condition and deps, add currentMode check
old_vad = '''  // Silero VAD lifecycle setup
  useEffect(() => {
    if (!isOpen || speechMode === 'ptt') {
      if (vadDetectorRef.current) {
        vadDetectorRef.current.destroy().catch(() => {});
        vadDetectorRef.current = null;
      }
      setVadStatus('Standby');
      return;
    }'''

new_vad = '''  // Silero VAD lifecycle setup (persistent in background across chat open/close)
  useEffect(() => {
    if (speechMode === 'ptt' || currentMode === 'dormant') {
      if (vadDetectorRef.current) {
        vadDetectorRef.current.destroy().catch(() => {});
        vadDetectorRef.current = null;
      }
      setVadStatus('Standby');
      return;
    }'''

assert old_vad in c, 'old_vad not matched'
c = c.replace(old_vad, new_vad, 1)

# And the deps of vad lifecycle
old_vad_cleanup = '''    return () => {
      active = false;
      detector.destroy().catch(() => {});
      vadDetectorRef.current = null;
    };
  }, [isOpen, speechMode, setMode, speakText]);'''

new_vad_cleanup = '''    return () => {
      active = false;
      detector.destroy().catch(() => {});
      if (vadDetectorRef.current === detector) {
        vadDetectorRef.current = null;
      }
    };
  }, [speechMode, currentMode, setMode, speakText, handleSend]);'''

assert old_vad_cleanup in c, 'old_vad_cleanup not matched'
c = c.replace(old_vad_cleanup, new_vad_cleanup, 1)

# 6. voiceRequest and onVoiceStatus effects
old_voice_effects = '''  const lastVoiceRequest = useRef(0);
  useEffect(()=>{if(isOpen && voiceRequest!==lastVoiceRequest.current){lastVoiceRequest.current=voiceRequest;toggleRecording();}},[isOpen,voiceRequest]);
  useEffect(()=>{onVoiceStatus?.(isOpen && isListening);return()=>onVoiceStatus?.(false);},[isOpen,isListening,onVoiceStatus]);'''

new_voice_effects = '''  const lastVoiceRequest = useRef(0);
  useEffect(() => {
    if (voiceRequest !== lastVoiceRequest.current) {
      lastVoiceRequest.current = voiceRequest;
      if (speechMode !== 'ptt') {
        setSpeechMode('ptt');
        setVadStatus('Standby');
      } else if (isOpen) {
        toggleRecording();
      }
    }
  }, [isOpen, voiceRequest, speechMode]);
  useEffect(() => {
    onVoiceStatus?.({
      active: speechMode !== 'ptt',
      mode: speechMode,
      isListening,
      vadStatus
    });
  }, [speechMode, isListening, vadStatus, onVoiceStatus]);'''

assert old_voice_effects in c, 'old_voice_effects not matched'
c = c.replace(old_voice_effects, new_voice_effects, 1)

# 7. Make sure speech mode buttons activate voice output
old_btn_vad = "onClick={() => { soundEffects.playActivateTone(); setSpeechMode('vad'); }}"
new_btn_vad = "onClick={() => { soundEffects.playActivateTone(); setSpeechMode('vad'); setIsVoiceEnabled(true); }}"
if old_btn_vad in c:
    c = c.replace(old_btn_vad, new_btn_vad, 1)

old_btn_wake = "onClick={() => { soundEffects.playActivateTone(); setSpeechMode('wake'); }}"
new_btn_wake = "onClick={() => { soundEffects.playActivateTone(); setSpeechMode('wake'); setIsVoiceEnabled(true); }}"
if old_btn_wake in c:
    c = c.replace(old_btn_wake, new_btn_wake, 1)

with open(hud_path, 'w', encoding='utf-8') as f:
    f.write(c)

print('Successfully patched ConversationHUD.tsx')
