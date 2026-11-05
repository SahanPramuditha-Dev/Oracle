import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Send,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Sparkles,
  X,
  Terminal,
  CornerDownLeft,
  Image as ImageIcon,
  Zap,
  Ear,
  Trash2
} from 'lucide-react';
import { OracleMode } from '../types';
import { fetchWithAuth, readJson, localApi } from '../utils/api';
import { CaptureReader } from './CaptureReader';
import { ResearchTools } from './ResearchTools';
import { soundEffects } from '../utils/audioEffects';
import {
  speakWithKokoro,
  stopSpeaking,
  LocalSpeechRecorder,
  SileroVoiceDetector,
  transcribeAudioBlob
} from '../utils/voice';

interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: string;
  model?: string;
  processing?: string;
  imageUrl?: string;
  error?: boolean;
}

export type SpeechMode = 'ptt' | 'vad' | 'wake';

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
  onWake?: () => void;
  onVoiceStatus?: (status: VoiceEngineStatus) => void;
}

export function extractWakePrompt(text: string): { matched: boolean; cleanPrompt: string } {
  const match = /\b(?:(?:hey|hi|ok|okay)[\s,]+)?oracle\b[\s,.!?:-]*/i.exec(text);
  if (!match) return {matched: false, cleanPrompt: text};
  return {matched: true, cleanPrompt: text.slice(match.index + match[0].length).trim()};
}

export const ConversationHUD: React.FC<ConversationHUDProps> = ({
  isOpen,
  onClose,
  setMode,
  currentMode,
  initialImage,
  onClearInitialImage,
  onOpenRecords,
  voiceRequest = 0,
  onWake,
  onVoiceStatus
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [researchOpen,setResearchOpen]=useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [vadReady, setVadReady] = useState(false);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(true);
  const [speechMode, setSpeechMode] = useState<SpeechMode>(() => {
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
        pttVersion.current++;
        pttRecorderRef.current?.cancel();
        setIsListening(false);
        setMode('ready');
        setSpeechMode(custom.detail);
        if (custom.detail !== 'ptt') {
          setIsVoiceEnabled(true);
        }
      }
    };
    window.addEventListener('oracle_speech_mode_changed', handleModeChange);
    return () => window.removeEventListener('oracle_speech_mode_changed', handleModeChange);
  }, [setMode]);
  const [speechProb, setSpeechProb] = useState(0);
  const [vadStatus, setVadStatus] = useState<string>('Standby');
  const [attachedImage, setAttachedImage] = useState<{ blob: Blob; url: string; source:'camera'|'file' } | null>(null);

    const [activeTimer, setActiveTimer] = useState<{ remaining: number; total: number; label: string } | null>(null);

  const [connection, setConnection] = useState('Checking gateway');
  const [action, setAction] = useState<{id:string;name:string;expires:number}|null>(null);
  const [deciding, setDeciding] = useState(false);
  const actionRef = useRef<typeof action>(null);
  const decision = useRef(false);
  const pending = useRef<AbortController|null>(null);
  const generation = useRef(0);
  const pttVersion = useRef(0);
  const attachments = useRef(new Set<string>());
  const [clock, setClock] = useState(Date.now());
  useEffect(() => { const tick = setInterval(()=>setClock(Date.now()),1000); return ()=>clearInterval(tick); }, []);
  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    localApi<{model:{available:boolean;provider:string;name:string;processing:string}}>('capabilities','GET',undefined,controller.signal)
      .then(data=>setConnection(data.model.available ? `${data.model.provider} · ${data.model.name} · ${data.model.processing}` : 'Gateway connected · model unavailable'))
      .catch(error=>{if(!controller.signal.aborted)setConnection(String(error));});
    return ()=>controller.abort();
  }, [isOpen]);
  const stop = useCallback((resetMode=true) => {
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
    if((currentMode === 'dormant' || currentMode === 'initializing') && speechMode === 'ptt') stop(false);
  },[currentMode,speechMode,stop]);
  useEffect(()=>{
    return ()=>{ generation.current++;pttVersion.current++;pending.current?.abort();pttRecorderRef.current?.cancel();void vadDetectorRef.current?.destroy();stopSpeaking(); };
  },[]);
  useEffect(()=>()=>{for(const url of attachments.current)URL.revokeObjectURL(url);},[]);
  async function decide(confirm:boolean) {
    const target=actionRef.current;if(!target||decision.current)return;
    decision.current=true;setDeciding(true);
    try {
      const data=await localApi<{message?:string}>(`actions/${target.id}${confirm?'/confirm':''}`,confirm?'POST':'DELETE');
      setMessages(items=>[...items,{id:crypto.randomUUID(),role:'model',text:data.message||'Launch request cancelled.',timestamp:new Date().toLocaleTimeString(),processing:'local'}]);
    } catch(error){setMessages(items=>[...items,{id:crypto.randomUUID(),role:'model',text:String(error),error:true,timestamp:new Date().toLocaleTimeString()}]);}
    finally {actionRef.current=null;setAction(null);decision.current=false;setDeciding(false);}
  }
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const pttRecorderRef = useRef<LocalSpeechRecorder | null>(null);
  const vadDetectorRef = useRef<SileroVoiceDetector | null>(null);
  const speechModeRef = useRef<SpeechMode>('ptt');
  speechModeRef.current = speechMode;

  const isGeneratingRef = useRef(false);
  isGeneratingRef.current = isGenerating;

  // Initialize PTT Recorder
  useEffect(() => {
    pttRecorderRef.current = new LocalSpeechRecorder();
    return () => {
      pttRecorderRef.current?.cancel();
    };
  }, []);

  // Handle incoming snapshot from camera HUD
  useEffect(() => {
    if (initialImage) {
      const url = URL.createObjectURL(initialImage);
      attachments.current.add(url);
      setAttachedImage({ blob: initialImage, url, source:'camera' });
      setInput('Describe what you see in this snapshot.');
      onClearInitialImage?.();
    }
  }, [initialImage, onClearInitialImage]);

  // Auto-focus input when drawer opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 120);
    }
  }, [isOpen]);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isGenerating]);

  // Voice playback with acoustic feedback prevention
  const speakText = useCallback(
    (text: string) => {
      if (!isVoiceEnabled) return;

      // Pause VAD while speaking to prevent hearing oneself
      if (vadDetectorRef.current?.isActive()) {
        vadDetectorRef.current.pause().catch(() => {});
      }

      speakWithKokoro(text, {
        onStart: () => setMode('speaking'),
        onEnd: () => {
          setMode('ready');
          // Resume VAD after speech concludes
          if (speechModeRef.current !== 'ptt' && vadDetectorRef.current) {
            setTimeout(() => {
              vadDetectorRef.current?.resume().catch(() => {});
            }, 300);
          }
        },
        onError: (error) => {
          setVadStatus(String(error));
          setMode('ready');
          if (speechModeRef.current !== 'ptt' && vadDetectorRef.current) {
            vadDetectorRef.current.resume().catch(() => {});
          }
        }
      });
    },
    [isVoiceEnabled, setMode]
  );

  // Timer countdown hook
  useEffect(() => {
    if (!activeTimer) return;
    if (activeTimer.remaining <= 0) {
      soundEffects.playWakeChime();
      speakText('Your timer for ' + activeTimer.label + ' is complete.');
      setActiveTimer(null);
      return;
    }

    const interval = setInterval(() => {
      setActiveTimer((prev) => {
        if (!prev) return null;
        if (prev.remaining <= 1) {
          soundEffects.playWakeChime();
          speakText('Your timer for ' + activeTimer.label + ' is complete.');
          return null;
        }
        return { ...prev, remaining: prev.remaining - 1 };
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [activeTimer, speakText]);

  // Send message (Chat or Vision Q&A)
  const handleSend = useCallback(
    async (queryText?: string) => {
      const textToSend = (queryText || input).trim();
      if (actionRef.current && textToSend) {
        const lower = textToSend.toLowerCase().replace(/[^a-z]/g, '');
        if (['confirm', 'yes', 'confirmlaunch', 'doit', 'proceed', 'open', 'launch'].includes(lower)) {
          setInput('');
          void decide(true);
          return;
        }
        if (['cancel', 'no', 'cancellanunch', 'abort', 'dont', 'stop'].includes(lower)) {
          setInput('');
          void decide(false);
          return;
        }
      }
      if ((!textToSend && !attachedImage) || isGeneratingRef.current || decision.current || actionRef.current) return;
      isGeneratingRef.current = true;
      const request = ++generation.current;
      const controller = new AbortController(); pending.current = controller;

      const currentImage = attachedImage;
      setInput('');
      setAttachedImage(null);

      const userMsg: Message = {
        id: String(Date.now()),
        role: 'user',
        text: textToSend || 'Analyzing visual input...',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        imageUrl: currentImage?.url
      };

      setMessages((prev) => [...prev, userMsg]);
      setIsGenerating(true);
      setMode('thinking');

      try {
        let replyText = '';
        let modelName = '';
        let processing = '';
        let proposed: {id:string;name:string;expires_in_seconds:number}|undefined;

        if (currentImage) {
          // Visual Q&A path (Moondream VLM)
          modelName = ''; 
          const res = await fetchWithAuth(
            `/api/v1/vision/ask?prompt=${encodeURIComponent(textToSend || 'Describe this image in detail.')}`,
            {
              method: 'POST',
              headers: { 'Content-Type': currentImage.blob.type || 'image/jpeg' },
              signal: controller.signal,
              body: currentImage.blob
            }
          );

          const data = await readJson<any>(res);
          replyText = data.answer || 'No visual description returned.';
          modelName = data.model || ''; processing = data.processing || 'local';
        } else {
          // Natural Chat reasoning path (Qwen 2.5 via Ollama)
          const res = await fetchWithAuth('/api/v1/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              text: textToSend,
              message: textToSend,
              history: messages.filter(item=>!item.error).slice(-10).map(item=>({role:item.role,text:item.text.slice(0,1200)}))
            })
          });

          const data = await readJson<any>(res);
          replyText = data.message || data.reply || 'No response generated.';
          modelName = data.model || ''; processing = data.processing || ''; proposed = data.action;
          if (data.timer) {
            setActiveTimer({
              remaining: data.timer.duration,
              total: data.timer.duration,
              label: data.timer.label
            });
          }
        }

        if (request !== generation.current || controller.signal.aborted) { if(proposed) void localApi(`actions/${proposed.id}`,'DELETE').catch(()=>{}); return; }
        if(proposed) {const next={id:proposed.id,name:proposed.name,expires:Date.now()+proposed.expires_in_seconds*1000};actionRef.current=next;setAction(next);}
        const modelMsg: Message = {
          id: String(Date.now() + 1),
          role: 'model',
          text: replyText,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          model: modelName,
          processing
        };

        setMessages((prev) => [...prev, modelMsg]);
        speakText(replyText);
      } catch (err) {
        if (request !== generation.current || controller.signal.aborted) return;
        const errMsg: Message = {
          id: String(Date.now() + 2),
          role: 'model',
          text: `Processing error: ${err instanceof Error ? err.message : 'Unknown gateway fault'}.`,
          error: true,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          model: 'system-fallback'
        };
        setMessages((prev) => [...prev, errMsg]);
        setMode('ready');
      } finally {
        if(request===generation.current) { pending.current=null; isGeneratingRef.current=false; setIsGenerating(false); setMode('ready'); }
      }
    },
    [attachedImage, input, messages, setMode, speakText]
  );

  const voiceHandlers = useRef({handleSend, speakText, onWake});
  voiceHandlers.current = {handleSend, speakText, onWake};
  const voiceSuspended = currentMode === 'dormant' || currentMode === 'initializing';
  const wakeFollowupUntil = useRef(0);

  // Silero VAD lifecycle setup (persistent in background across chat open/close)
  useEffect(() => {
    setVadReady(false);
    setIsListening(false);
    if (speechMode === 'ptt' || voiceSuspended) {
      if (vadDetectorRef.current) {
        vadDetectorRef.current.destroy().catch(() => {});
        vadDetectorRef.current = null;
      }
      setVadStatus('Standby');
      return;
    }

    let active = true;
    let transcribing = false;
    const detector = new SileroVoiceDetector({
      onSpeechStart: () => {
        if (!active || isGeneratingRef.current || transcribing) return;
        setIsListening(true);
        setMode('listening');
        setVadStatus('Speech Detected');
      },
      onSpeechProb: (prob) => {
        if (active) setSpeechProb(prob);
      },
      onVADMisfire: () => {
        if (!active) return;
        setIsListening(false);
        setMode('ready');
        setVadStatus(speechModeRef.current === 'wake' ? 'Standby ("Hey Oracle")' : 'Listening');
      },
      onSpeechEnd: async (wavBlob: Blob) => {
        if (!active || isGeneratingRef.current || transcribing) return;
        transcribing = true;
        setIsListening(false);
        soundEffects.playAcknowledgeTone();
        setVadStatus('Transcribing...');
        setMode('thinking');

        try {
          const rawText = await transcribeAudioBlob(wavBlob);
          if(!active)return;
          if (!rawText.trim()) {
            setMode('ready');
            setVadStatus(speechModeRef.current === 'wake' ? 'Standby ("Hey Oracle")' : 'Listening');
            return;
          }

          if (speechModeRef.current === 'wake') {
            const { matched, cleanPrompt } = extractWakePrompt(rawText);
            if (!matched && Date.now() >= wakeFollowupUntil.current) {
              // Silently ignore ambient room chatter
              setMode('ready');
              setVadStatus('Standby ("Hey Oracle")');
              return;
            }

            wakeFollowupUntil.current = 0;
            voiceHandlers.current.onWake?.();
            // Wake word matched!
            soundEffects.playWakeChime();
            setVadStatus('Wake Triggered!');
            if (!cleanPrompt) {
              // User said just the wake word
              wakeFollowupUntil.current = Date.now() + 15000;
              setMode('ready');
              voiceHandlers.current.speakText("I'm listening. How can I help you?");
              setVadStatus('Listening');
              return;
            }

            await voiceHandlers.current.handleSend(cleanPrompt);
          } else {
            // Continuous VAD mode
            setVadStatus('Processing...');
            await voiceHandlers.current.handleSend(rawText);
          }
        } catch (err) {
          console.warn('VAD transcription error:', err);
          setMode('ready');
          setVadStatus('Could not transcribe speech. Try again.');
        } finally { transcribing = false; }
      },
      onError: (err) => {
        if (!active) return;
        setVadReady(false);
        setIsListening(false);
        console.warn('Silero VAD error:', err);
        setVadStatus('VAD Error');
        setMode('ready');
      }
    });

    vadDetectorRef.current = detector;
    setVadStatus(speechMode === 'wake' ? 'Initializing Wake Word...' : 'Initializing Silero VAD...');

    detector.start()
      .then(() => {
        if (active) {
          setVadReady(true);
          setVadStatus(speechMode === 'wake' ? 'Standby ("Hey Oracle")' : 'Listening for Voice...');
        }
      })
      .catch((err) => {
        if (active) {
          setVadReady(false);
          setIsListening(false);
          console.warn('Failed to start Silero VAD:', err);
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('Permission') || msg.includes('NotAllowed') || msg.includes('denied')) {
            setVadStatus('Mic permission blocked (Allow in browser)');
          } else {
            setVadStatus(`Mic error: ${msg.slice(0, 30)}`);
          }
        }
      });

    return () => {
      active = false;
      detector.destroy().catch(() => {});
      if (vadDetectorRef.current === detector) {
        vadDetectorRef.current = null;
      }
    };
  }, [speechMode, voiceSuspended, setMode]);

  // Start Push-to-Talk manual recording
  const startRecording = async () => {
    const version=++pttVersion.current;
    try {
      stopSpeaking();
      const started = await pttRecorderRef.current?.start();
      if(version!==pttVersion.current || !started)return;
      setIsListening(true);
      setMode('listening');
    } catch (err) {
      if(version!==pttVersion.current)return;
      setVadStatus(String(err));
      setIsListening(false);
      setMode('ready');
    }
  };

  // Stop Push-to-Talk and transcribe offline
  const stopRecordingAndSend = async () => {
    if (!isListening) return;
    setIsListening(false);
    setMode('thinking');

    const version=pttVersion.current;
    try {
      const transcribedText = await pttRecorderRef.current?.stopAndTranscribe();
      if(version!==pttVersion.current)return;
      if (transcribedText && transcribedText.trim()) {
        if(version===pttVersion.current){
          if (isOpen) { setInput(transcribedText.trim()); setMode('ready'); }
          else { await handleSend(transcribedText.trim()); }
        }
      } else {
        setMode('ready');
      }
    } catch (err) {
      if(version!==pttVersion.current)return;
      setVadStatus(String(err));
      setMode('ready');
    }
  };

  const toggleRecording = () => {
    if (speechMode !== 'ptt') {
      // Toggle back to PTT
      setSpeechMode('ptt');
      return;
    }
    if (isListening) {
      stopRecordingAndSend();
    } else {
      startRecording();
    }
  };
  const lastVoiceRequest = useRef(0);
  useEffect(() => {
    if (voiceRequest !== lastVoiceRequest.current) {
      lastVoiceRequest.current = voiceRequest;
      if (speechMode !== 'ptt') {
        setSpeechMode('ptt');
        setVadStatus('Standby');
      } else if (!voiceSuspended) {
        toggleRecording();
      }
    }
  }, [isOpen, voiceRequest, speechMode]);
  useEffect(() => {
    onVoiceStatus?.({
      active: !voiceSuspended && (speechMode === 'ptt' ? isListening : vadReady),
      mode: speechMode,
      isListening: !voiceSuspended && isListening,
      vadStatus
    });
  }, [speechMode, isListening, vadReady, voiceSuspended, vadStatus, onVoiceStatus]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if(file.size>6*1024*1024){setVadStatus('Choose an image up to 6 MiB.');return;}
      const url = URL.createObjectURL(file);
      attachments.current.add(url);
      setAttachedImage({ blob: file, url, source:'file' });
      if (!input.trim()) {
        setInput('What do you see in this picture?');
      }
    }
    e.target.value = '';
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="hud-blade-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.aside
            className="hud-blade-drawer"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 280 }}
            aria-label="Oracle Tactical Link HUD"
          >
            {/* HUD Header */}
            <div className="hud-blade-header">
              <div className="hud-blade-topbar">
                <div className="hud-blade-brand">
                  <span className={`hud-blade-status-led ${isGenerating ? 'generating' : isListening ? 'listening' : 'ready'}`} />
                  <Terminal size={14} className="hud-blade-terminal-icon" />
                  <span>ORACLE // LINK</span>
                </div>

                <div className="hud-blade-actions">
                  {activeTimer && (
                    <button
                      type="button"
                      className="hud-blade-timer-chip"
                      onClick={() => {
                        setActiveTimer(null);
                        speakText('Timer cancelled.');
                      }}
                      title="Click to cancel timer"
                    >
                      ⏱️ {Math.floor(activeTimer.remaining / 60)}:
                      {String(activeTimer.remaining % 60).padStart(2, '0')}
                      <X size={10} style={{ marginLeft: '3px' }} />
                    </button>
                  )}

                  <button
                    type="button"
                    className="hud-blade-icon-btn"
                    onClick={() => {
                      if (isVoiceEnabled) stopSpeaking();
                      setIsVoiceEnabled((prev) => !prev);
                    }}
                    title={isVoiceEnabled ? 'Voice output active (Kokoro)' : 'Voice output muted'}
                  >
                    {isVoiceEnabled ? <Volume2 size={14} /> : <VolumeX size={14} style={{ opacity: 0.5 }} />}
                  </button>

                  <button
                    type="button"
                    className="hud-blade-icon-btn"
                    onClick={onClose}
                    aria-label="Close conversation HUD"
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>

              {/* Header Sub-bar: Modes & Telemetry */}
              <div className="hud-blade-subbar">
                <div
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
                </div>

                <div className="hud-blade-telemetry-badge" title={`${vadStatus} · ${connection}`}>
                  {isListening && speechProb > 0 ? (
                    <span style={{ color: '#f87171' }}>LISTENING ({Math.round(speechProb * 100)}%)</span>
                  ) : isGenerating ? (
                    <span style={{ color: 'var(--accent)' }}>COMPUTING...</span>
                  ) : (
                    <span>{connection.split('·')[1]?.trim() || connection}</span>
                  )}
                </div>
              </div>
            </div>

            {/* Tactical Directives Toolbar */}
            <div className="hud-blade-toolbar">
              <button
                type="button"
                className="hud-blade-tool-btn"
                onClick={onOpenRecords}
                title="Open Notes, reminders & records"
              >
                <span>Workspace</span>
              </button>

              <button
                type="button"
                className={`hud-blade-tool-btn ${researchOpen ? 'active' : ''}`}
                aria-expanded={researchOpen}
                onClick={() => setResearchOpen((v) => !v)}
                title="Search Wikipedia & analyze documents"
              >
                <span>Research</span>
              </button>

              <button
                type="button"
                className="hud-blade-tool-btn"
                onClick={() => stop()}
                title="Halt active speech & model generation"
              >
                <span>Stop</span>
              </button>

              <button
                type="button"
                className="hud-blade-tool-btn"
                onClick={() => {
                  stop();
                  setMessages([]);
                  for (const url of attachments.current) URL.revokeObjectURL(url);
                  attachments.current.clear();
                  setAttachedImage(null);
                  if (actionRef.current) void decide(false);
                }}
                title="Reset conversation thread"
              >
                <span>Clear</span>
              </button>
            </div>

            {/* Embedded Research Tools drawer if opened */}
            {researchOpen && isOpen && (
              <div className="hud-blade-research-tray">
                <ResearchTools />
              </div>
            )}

            {/* Application Launch Confirmation Banner */}
            {action && (
              <section className="record-action hud-blade-action-banner" aria-label="Confirm application launch">
                <p>Open {action.name}? {clock >= action.expires ? 'Request expired.' : `${Math.max(0, Math.ceil((action.expires - clock) / 1000))} seconds remaining.`}</p>
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <button disabled={deciding || clock >= action.expires} onClick={() => void decide(true)}>Confirm launch</button>
                  <button disabled={deciding} onClick={() => void decide(false)}>Cancel</button>
                </div>
              </section>
            )}

            {/* Conversation Thread */}
            <div className="hud-blade-thread">
              {messages.length === 0 ? (
                <div className="hud-blade-empty">
                  <div className="hud-blade-empty-icon">
                    <Sparkles size={18} />
                  </div>
                  <div className="hud-blade-empty-title">NEURAL LINK ACTIVE</div>
                  <div className="hud-blade-empty-desc">
                    Engage via voice telemetry, attach visual feeds, or transmit a directive below.
                  </div>

                  <div className="hud-blade-starters">
                    <button
                      type="button"
                      className="hud-blade-starter-btn"
                      onClick={() => handleSend('System Briefing')}
                    >
                      <Terminal size={12} style={{ color: 'var(--accent)' }} />
                      <span>System Briefing</span>
                    </button>

                    <button
                      type="button"
                      className="hud-blade-starter-btn"
                      onClick={onOpenRecords}
                    >
                      <Sparkles size={12} style={{ color: 'var(--accent)' }} />
                      <span>Access Notes & Memories</span>
                    </button>

                    <button
                      type="button"
                      className="hud-blade-starter-btn"
                      onClick={() => {
                        setInput('open ');
                        inputRef.current?.focus();
                      }}
                    >
                      <CornerDownLeft size={12} style={{ color: 'var(--accent)' }} />
                      <span>Launch Application</span>
                    </button>
                  </div>
                </div>
              ) : (
                messages.map((m) => (
                  <div key={m.id} className={`hud-blade-message ${m.role}`}>
                    <div className="hud-blade-msg-header">
                      <span className="hud-blade-msg-author">{m.role === 'user' ? 'USER' : 'ORACLE'}</span>
                      {m.model && <span className="hud-blade-msg-badge">{m.model}</span>}
                      <span className="hud-blade-msg-time">{m.timestamp}</span>
                    </div>

                    {m.imageUrl && (
                      <div style={{ margin: '6px 0' }}>
                        <img
                          src={m.imageUrl}
                          alt="Attached visual input"
                          style={{
                            maxWidth: '100%',
                            maxHeight: '160px',
                            borderRadius: '6px',
                            border: '1px solid rgba(157, 180, 211, 0.25)'
                          }}
                        />
                      </div>
                    )}

                    <div className="hud-blade-msg-body">{m.text}</div>

                    {m.role === 'model' && (
                      <button
                        type="button"
                        className="msg-speak-btn"
                        onClick={() => speakText(m.text)}
                        title="Read aloud with Kokoro natural voice"
                      >
                        <Volume2 size={12} />
                      </button>
                    )}
                  </div>
                ))
              )}

              {isGenerating && (
                <div className="hud-blade-message model generating">
                  <div className="hud-blade-msg-header">
                    <span className="hud-blade-msg-author">ORACLE</span>
                    <span className="msg-badge-pulse">COMPUTING</span>
                  </div>
                  <div className="msg-typing-indicator">
                    <span className="dot" />
                    <span className="dot" />
                    <span className="dot" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* OCR / Image Reader when image attached */}
            {attachedImage && (
              <div style={{ padding: '0 18px', maxHeight: '35vh', overflow: 'auto' }}>
                <CaptureReader image={attachedImage.blob} source={attachedImage.source} />
              </div>
            )}

            {/* Command Input Bar */}
            <div className="hud-blade-input-container">
              {/* Image Attachment Preview Bar */}
              {attachedImage && (
                <div className="hud-blade-attachment-bar">
                  <img
                    src={attachedImage.url}
                    alt="Attachment preview"
                    style={{ width: '32px', height: '32px', objectFit: 'cover', borderRadius: '4px' }}
                  />
                  <span style={{ flex: 1, fontSize: '11px', color: 'var(--accent)' }}>
                    Moondream visual feed ready
                  </span>
                  <button
                    type="button"
                    onClick={() => setAttachedImage(null)}
                    style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: '4px' }}
                    title="Remove image"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )}

              <div className="hud-blade-input-bar">
                {/* Hidden File Input for Image Upload */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg"
                  style={{ display: 'none' }}
                  onChange={handleImageFileChange}
                />
                <button
                  type="button"
                  className="hud-blade-icon-btn"
                  onClick={() => fileInputRef.current?.click()}
                  title="Attach photo for Moondream visual analysis"
                >
                  <ImageIcon size={15} />
                </button>

                {/* Speech Button */}
                <button
                  type="button"
                  className={`hud-blade-icon-btn ${isListening ? 'active' : ''}`}
                  onClick={toggleRecording}
                  title={
                    speechMode === 'ptt'
                      ? isListening
                        ? 'Click to stop & transcribe'
                        : 'Push-to-talk (Faster-Whisper)'
                      : `Active in ${speechMode.toUpperCase()} mode. Click to switch to PTT.`
                  }
                >
                  {isListening ? (
                    <Mic size={15} color="#f87171" />
                  ) : speechMode === 'ptt' ? (
                    <MicOff size={15} />
                  ) : (
                    <Zap size={15} color={speechMode === 'wake' ? '#fbbf24' : '#4ade80'} />
                  )}
                </button>

                <input
                  ref={inputRef}
                  type="text"
                  className="hud-blade-input"
                  aria-label="Message ORACLE"
                  maxLength={4000}
                  placeholder={
                    isListening
                      ? speechMode === 'wake'
                        ? 'Listening... say "Hey Oracle <command>"'
                        : 'Speech detected... Speak naturally'
                      : speechMode === 'wake'
                      ? 'Say "Hey Oracle" to activate'
                      : speechMode === 'vad'
                      ? 'Silero VAD armed: Speak anytime'
                      : attachedImage
                      ? 'Ask Moondream about this image...'
                      : 'Transmit command or query...'
                  }
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={isGenerating}
                />

                <button
                  type="button"
                  className="hud-blade-send-btn"
                  onClick={() => handleSend()}
                  disabled={(!input.trim() && !attachedImage) || isGenerating}
                  aria-label="Send message"
                >
                  <Send size={13} />
                </button>
              </div>

              <div className="hud-blade-telemetry-foot">
                <span>{vadStatus}</span>
                <span>{connection}</span>
              </div>
            </div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
