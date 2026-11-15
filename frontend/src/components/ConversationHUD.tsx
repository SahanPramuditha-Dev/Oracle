import { briefingFocus } from '../utils/briefing';
import { parseAtlasSpatialCommand } from '../utils/atlasSpatialCommands';
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
import { fetchWithAuth, hasAdminGrant, readJson, localApi } from '../utils/api';
import { getStoredProtocols, executeProtocol } from '../utils/protocols';
import { CaptureReader } from './CaptureReader';
import { ResearchTools } from './ResearchTools';
import { soundEffects } from '../utils/audioEffects';
import {
  speakWithKokoro,
  stopSpeaking,
  isSpeakingActive,
  LocalSpeechRecorder,
  SileroVoiceDetector,
  transcribeAudioBlob
} from '../utils/voice';
import { commandEvents, interpretVoiceIntent, normalizeVoiceCommand } from '../utils/voiceIntent';
import { changeTaughtCommand, findTaughtCommand, isPetLaunchCommand, parseTeachingRequest, taughtActionLabels, type TaughtCommand } from '../utils/taughtCommands';
import { recordCommandAttempt, updateCommandOutcome } from '../utils/commandHistory';
import { readReplyPreferences } from '../utils/replyPreferences';
import { readChatStream, recordResponseTime } from '../utils/chatStream';

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
  privacyActive?: boolean;
  onWake?: () => void;
  onInputLevel?: (level: number) => void;
  onVoiceError?: (message: string) => void;
  setUserCaption: React.Dispatch<React.SetStateAction<UserVoiceCaption | null>>;
  setOracleCaption: React.Dispatch<React.SetStateAction<string | null>>;
  onVoiceStatus?: (status: VoiceEngineStatus) => void;
}

export interface UserVoiceCaption {
  text: string;
  state: 'listening' | 'transcribing' | 'complete' | 'error';
}

export function extractWakePrompt(text: string): { matched: boolean; cleanPrompt: string } {
  const match = /^\s*hey[\s,]+oracle\b[\s,.!?:-]*/i.exec(text);
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
  privacyActive = false,
  onWake,
  onVoiceStatus,
  onInputLevel,
  setUserCaption,
  setOracleCaption,
  onVoiceError
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const captionTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(captionTimer.current), []);
  const [input, setInput] = useState('');
  const [researchOpen,setResearchOpen]=useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [vadReady, setVadReady] = useState(false);
  const [isVadActive, setIsVadActive] = useState(false);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(true);
  const speechQueueVersion = useRef(0);
  const [speechMode, setSpeechMode] = useState<SpeechMode>(() => {
    const saved = localStorage.getItem('oracle_speech_mode');
    if (saved === 'ptt') return 'ptt';
    if (saved === 'wake') return 'wake';
    return 'vad';
  });

  const wakeFollowupUntil = useRef(0);
  const voiceGeneration = useRef(0);
  const automaticTranscription = useRef<AbortController | null>(null);
  const partialTranscription = useRef<AbortController | null>(null);
  const cancelAutomaticSpeech = useCallback(() => {
    voiceGeneration.current++;
    wakeFollowupUntil.current = 0;
    automaticTranscription.current?.abort();
    automaticTranscription.current = null;
    partialTranscription.current?.abort();
    partialTranscription.current = null;
    setUserCaption(null);
  }, []);

  // Dynamically sync speechMode when changed in Settings or via ambient pill
  useEffect(() => {
    const handleModeChange = (e: Event) => {
      const custom = e as CustomEvent<SpeechMode>;
      if (custom.detail && (custom.detail === 'ptt' || custom.detail === 'vad' || custom.detail === 'wake')) {
        pttVersion.current++;
        cancelAutomaticSpeech();
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
  }, [cancelAutomaticSpeech, setMode]);
  const [speechProb, setSpeechProb] = useState(0);
  const [vadStatus, setVadStatus] = useState<string>('Standby');
  const [attachedImage, setAttachedImage] = useState<{ blob: Blob; url: string; source:'camera'|'file' } | null>(null);
  const attachments = useRef(new Set<string>());
  const draftImageUrl = useRef<string | null>(null);
  const discardDraftImage = useCallback(() => {
    const url = draftImageUrl.current;
    if (url) {
      URL.revokeObjectURL(url);
      attachments.current.delete(url);
    }
    draftImageUrl.current = null;
    setAttachedImage(null);
  }, []);

    const [activeTimer, setActiveTimer] = useState<{ expiresAt: number; label: string } | null>(null);

  const [timerRemaining, setTimerRemaining] = useState(0);

  const [connection, setConnection] = useState('Checking gateway');
  const [action, setAction] = useState<{id:string;name:string;expires:number;historyId?:string}|null>(null);
  const draftTranscript = useRef<string | undefined>(undefined);
  const [teachingPhrase, setTeachingPhrase] = useState<TaughtCommand | null>(null);
  const [teachingStatus, setTeachingStatus] = useState('');
  const [deciding, setDeciding] = useState(false);
  const actionRef = useRef<typeof action>(null);
  const decision = useRef(false);
  const pending = useRef<AbortController|null>(null);
  const generation = useRef(0);
  const pttVersion = useRef(0);
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    if (!isOpen || !action) return;
    const update = () => setClock(Date.now());
    update();
    const tick = setInterval(update, 1000);
    return () => clearInterval(tick);
  }, [isOpen, action]);
  useEffect(() => {
    if (action && clock >= action.expires) updateCommandOutcome(action.historyId, 'Launch confirmation expired');
  }, [action, clock]);
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
    cancelAutomaticSpeech();
    setTeachingPhrase(null);
    setTeachingStatus('');
    pttRecorderRef.current?.cancel();
    if (speechModeRef.current === 'ptt') {
      void vadDetectorRef.current?.destroy();
    }
    speechQueueVersion.current++;
    stopSpeaking();
    window.clearTimeout(captionTimer.current);
    setOracleCaption(null);
    if(resetMode)setMode('ready');
    draftTranscript.current = undefined;
    if(actionRef.current && !decision.current){const target=actionRef.current;actionRef.current=null;setAction(null);updateCommandOutcome(target.historyId, 'Confirmation dismissed');void localApi(`actions/${target.id}`,'DELETE').catch(error=>setVadStatus(String(error)));}
  },[cancelAutomaticSpeech,setMode]);
  useEffect(() => {
    const interrupt = () => stop(false);
    window.addEventListener('oracle_lockdown_started', interrupt);
    window.addEventListener('oracle_hibernate_started', interrupt);
    window.addEventListener('oracle_privacy_started', interrupt);
    return () => {
      window.removeEventListener('oracle_lockdown_started', interrupt);
      window.removeEventListener('oracle_hibernate_started', interrupt);
      window.removeEventListener('oracle_privacy_started', interrupt);
    };
  }, [stop]);
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
      updateCommandOutcome(target.historyId, confirm ? 'Launch request accepted by Windows' : 'Launch cancelled');
      setMessages(items=>[...items,{id:crypto.randomUUID(),role:'model',text:data.message||'Launch request cancelled.',timestamp:new Date().toLocaleTimeString(),processing:'local'}]);
    } catch(error){updateCommandOutcome(target.historyId, confirm ? 'Launch confirmation failed' : 'Cancellation failed');setMessages(items=>[...items,{id:crypto.randomUUID(),role:'model',text:String(error),error:true,timestamp:new Date().toLocaleTimeString()}]);}
    finally {actionRef.current=null;setAction(null);decision.current=false;setDeciding(false);}
  }
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const pttRecorderRef = useRef<LocalSpeechRecorder | null>(null);
  const vadDetectorRef = useRef<SileroVoiceDetector | null>(null);
  const speechModeRef = useRef<SpeechMode>('vad');
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
      discardDraftImage();
      const url = URL.createObjectURL(initialImage);
      draftImageUrl.current = url;
      attachments.current.add(url);
      setAttachedImage({ blob: initialImage, url, source:'camera' });
      setInput('Describe what you see in this snapshot.');
      onClearInitialImage?.();
    }
  }, [discardDraftImage, initialImage, onClearInitialImage]);

  // Auto-focus input when drawer opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 120);
    }
  }, [isOpen]);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: isGenerating ? 'instant' : 'smooth' });
  }, [messages, isGenerating]);

  // Voice playback with acoustic feedback prevention
  const speakText = useCallback(
    (text: string, onStart?: () => void, onEnd?: () => void) => {
      if (!isVoiceEnabled) return;

      let started = false;
      speakWithKokoro(text, {
        onStart: () => {
          started = true;
          window.clearTimeout(captionTimer.current);
          setUserCaption(null);
          setOracleCaption(text.replace(/[*#`_~]/g, '').trim().slice(0, 1800));
          setMode('speaking');
          onStart?.();
        },
        onEnd: () => {
          setMode(isGeneratingRef.current ? 'thinking' : 'ready');
          if (started) {
            captionTimer.current = window.setTimeout(() => setOracleCaption(null), 900);
          }
          onEnd?.();
        },
        onError: (error) => {
          setVadStatus(String(error));
          onVoiceError?.('Voice playback unavailable');
        }
      });
    },
    [isVoiceEnabled, onVoiceError, setMode]
  );

  // External timer event hook (custom protocol action)
  useEffect(() => {
    const handleSetTimer = (e: Event) => {
      const custom = e as CustomEvent<{ duration: number; label: string }>;
      if (Number.isFinite(custom.detail?.duration) && custom.detail.duration > 0) {
        setTimerRemaining(Math.ceil(custom.detail.duration));
        setActiveTimer({
          expiresAt: Date.now() + custom.detail.duration * 1000,
          label: custom.detail.label || 'Focus Timer'
        });
      }
    };
    window.addEventListener('oracle_set_timer', handleSetTimer);
    return () => window.removeEventListener('oracle_set_timer', handleSetTimer);
  }, []);

  // Timer countdown hook
  useEffect(() => {
    if (!activeTimer) return;
    const completion = window.setTimeout(() => {
      setActiveTimer(null);
      soundEffects.playWakeChime();
      speakText('Your timer for ' + activeTimer.label + ' is complete.');
    }, Math.max(0, activeTimer.expiresAt - Date.now()));
    return () => window.clearTimeout(completion);
  }, [activeTimer, speakText]);

  useEffect(() => {
    if (!isOpen || !activeTimer) return;
    const update = () => setTimerRemaining(Math.max(0, Math.ceil((activeTimer.expiresAt - Date.now()) / 1000)));
    update();
    const tick = window.setInterval(update, 1000);
    return () => window.clearInterval(tick);
  }, [isOpen, activeTimer]);

  // Send message (Chat or Vision Q&A)
  const handleSend = useCallback(
    async (queryText?: string, voiceTranscript?: string) => {
      const textToSend = (queryText ?? input).trim();
      if (document.body.classList.contains('oracle-privacy-mode')) return;
      const transcript = voiceTranscript ?? (queryText === undefined ? draftTranscript.current : undefined);
      if (queryText === undefined) draftTranscript.current = undefined;
      const systemCommand = normalizeVoiceCommand(textToSend);
      // Local actions return before the chat request's state cleanup.
      if (voiceTranscript !== undefined && !isGeneratingRef.current) setMode('ready');
      if (/^(?:(?:initiate|activate|enter|start) (?:the )?)?(?:protocol hibernate|hibernate protocol|hibernate(?: system)?|low activity)$/.test(systemCommand)) {
        setInput('');
        executeProtocol('hibernate', hasAdminGrant());
        return;
      }
      const sensorProtocol = /^(?:(activate|open|start|engage|initiate|stop|close|exit|deactivate) (?:the )?)?(?:protocol )?(sentry|sentinel)(?: protocol| mode)?$/.exec(systemCommand);
      if (sensorProtocol) {
        const [, verb, protocol] = sensorProtocol;
        setInput('');
        if (/^(stop|close|exit|deactivate)$/.test(verb ?? '')) {
          window.dispatchEvent(new Event(`oracle_deactivate_${protocol}_protocol`));
        } else {
          executeProtocol(protocol, hasAdminGrant());
        }
        return;
      }
      if (/^(?:(?:activate|engage|initiate|start|run|enter|enable) (?:the )?)?(?:protocol ghost|ghost protocol|ghost(?: mode)?|privacy mode)$/.test(systemCommand)) {
        setInput('');
        executeProtocol('ghost');
        return;
      }
      if (/^(?:(?:activate|activated|select|selected|engage|initiate|start|run|open|trigger) )?(?:the )?(?:protocol lockdown|lockdown protocol|lockdown|emergency restriction)$/.test(systemCommand)) {
        setInput('');
        executeProtocol('lockdown');
        return;
      }
      if (actionRef.current && textToSend) {
        const lower = systemCommand;
        if (['confirm', 'yes', 'confirm launch', 'do it', 'proceed'].includes(lower)) {
          setInput('');
          void decide(true);
          return;
        }
        if (['cancel', 'no', 'cancel launch', 'abort', 'don t', 'stop'].includes(lower)) {
          setInput('');
          void decide(false);
          return;
        }
      }
      const cameraCommand = /^(?:(?:hey |okay |ok )?oracle )?(?:please )?(expand camera|collapse camera|show product details|hide product details|pin this result|unpin result|read the label|what size is this|show scan evidence)$/.exec(systemCommand)?.[1];
      if (cameraCommand) {
        const actions: Record<string, string> = {
          'expand camera': 'expand', 'collapse camera': 'collapse',
          'show product details': 'show', 'hide product details': 'hide',
          'pin this result': 'pin', 'unpin result': 'unpin',
          'read the label': 'read-label', 'what size is this': 'read-size',
          'show scan evidence': 'evidence',
        };
        const action = actions[cameraCommand];
        const handled = !window.dispatchEvent(new CustomEvent('oracle_camera_command', { cancelable: true, detail: action }));
        if (handled) {
          setInput('');
          return;
        }
        if (action !== 'read-label' && action !== 'read-size') {
          setInput('');
          speakWithKokoro('Open the camera first.', { allowBargeIn: true });
          return;
        }
      }
      const adminCommand = systemCommand;
      if (/^(?:(?:activate|activated|select|selected|engage|initiate|start|run|open|trigger) )?(?:the )?(?:protocol admin|admin protocol|admin)$/.test(adminCommand)) {
        setInput('');
        window.dispatchEvent(new CustomEvent('oracle_open_admin_protocol'));
        return;
      }
      if (/^(?:deactivate|close|exit|relinquish|disable|lock) (?:the )?(?:protocol admin|admin protocol|admin|system)$/.test(adminCommand)) {
        setInput('');
        window.dispatchEvent(new CustomEvent('oracle_lock_admin'));
        return;
      }
      // Built-in destinations take priority over customizable protocol aliases.
      const voiceIntent = interpretVoiceIntent(textToSend);
      if (voiceIntent.name !== 'unknown') {
        setInput('');
        setMode('ready');
        onWake?.();
        window.dispatchEvent(new CustomEvent(commandEvents[voiceIntent.name]));
        const label = voiceIntent.name === 'open_settings' ? 'Open Settings' : taughtActionLabels[voiceIntent.name];
        recordCommandAttempt(transcript, textToSend, label, 'Action requested');
        return;
      }
      if (voiceIntent.requiresClarification) {
        const message = 'Which destination did you mean? Try saying “open map”.';
        setVadStatus(message);
        if (transcript && isVoiceEnabled) speakText(message);
        recordCommandAttempt(transcript, textToSend, 'Ambiguous command', 'Asked for a destination');
        setInput(textToSend);
        setMode('ready');
        return;
      }
      const focus = !attachedImage && briefingFocus(textToSend);
      if (focus && !privacyActive) {
        setInput('');
        window.dispatchEvent(new CustomEvent('oracle_brief_me', { detail: focus }));
        return;
      }
      if (parseAtlasSpatialCommand(textToSend) || /^(?:(?:(?:hey|ok|okay) )?oracle[, ]+)?(?:please )?(?:route (?:from|to) .+|navigate to .+|show me .+ on (?:the )?map|(?:find|show)(?: me)? (?:the )?(?:nearest|nearby) (?:hospitals?|pharmacy|pharmacies|fuel|food|atms?)|where did i park)[?.!]*$/i.test(textToSend)) {
        setInput('');
        window.dispatchEvent(new CustomEvent('oracle_atlas_command', { detail: textToSend }));
        return;
      }
      if (/^(?:please\s+)?(?:open|show|launch|view)?\s*(?:the\s+)?(?:workspace|records)$/i.test(systemCommand)) {
        setInput('');
        onOpenRecords?.();
        return;
      }
      if (/^(?:please\s+)?(?:run|start|open|launch|execute|perform|begin)?\s*(?:a\s+)?(?:system\s+)?(?:self\s*diagnostic|diagnostics)$/i.test(systemCommand)) {
        setInput('');
        window.dispatchEvent(new CustomEvent('oracle_open_self_diagnostic'));
        return;
      }

      if (!attachedImage && !isPetLaunchCommand(textToSend)) {
        const allProtocols = getStoredProtocols();

        // Check dynamic protocols (built-in + customized + user created) with strict command matching
        const matches = allProtocols.filter(p =>
          Array.isArray(p?.voicePhrases) && p.voicePhrases.some(phrase => {
            const clean = typeof phrase === 'string' ? normalizeVoiceCommand(phrase) : '';
            if (!clean) return false;
            if (systemCommand === clean) return true;
            if (clean.includes(' ')) return false;
            // For single keyword phrases (e.g. "focus", "admin"), only match deliberate action commands
            const commandPatterns = [
              `activate ${clean}`, `activate protocol ${clean}`, `protocol ${clean}`, `${clean} protocol`,
              `start ${clean}`, `start protocol ${clean}`, `run ${clean}`, `run protocol ${clean}`,
              `open ${clean}`, `open protocol ${clean}`, `launch ${clean}`, `trigger ${clean}`
            ];
            return commandPatterns.some(cmd => systemCommand === cmd);
          })
        );
        if (matches.length > 1) {
          const message = 'More than one protocol uses that phrase. Use a unique phrase.';
          setInput(textToSend);
          setVadStatus(message);
          recordCommandAttempt(transcript, textToSend, 'Conflicting protocol phrases', 'Asked for a unique phrase');
          if (transcript && isVoiceEnabled) speakText(message);
          return;
        }
        if (matches.length === 1) {
          setInput('');
          executeProtocol(matches[0].id, hasAdminGrant());
          return;
        }
      }

      if ((!textToSend && !attachedImage) || isGeneratingRef.current || decision.current || actionRef.current) return;
      const taught = attachedImage ? undefined : findTaughtCommand(textToSend);
      if (!attachedImage) {
        const phrase = parseTeachingRequest(textToSend);
        if (phrase !== undefined) {
          setTeachingPhrase(phrase || null);
          setTeachingStatus(phrase ? '' : 'Try: When I say “Bring up Atlas,” open the map. You can teach actions for Atlas, Camera, or Oracle Pet.');
          setInput('');
          setMode('ready');
          onWake?.();
          return;
        }
        if (taught && taught.action !== 'launch_pet') {
          setInput('');
          setMode('ready');
          window.dispatchEvent(new CustomEvent(commandEvents[taught.action]));
          recordCommandAttempt(transcript, textToSend, taughtActionLabels[taught.action], 'Action requested via taught phrase');
          return;
        }
      }
      isGeneratingRef.current = true;
      const request = ++generation.current;
      const controller = new AbortController(); pending.current = controller;
      const speechVersion = ++speechQueueVersion.current;
      stopSpeaking();
      window.clearTimeout(captionTimer.current);
      setOracleCaption(null);
      const startedAt = performance.now();
      const replyId = crypto.randomUUID();
      let firstText = false;
      let firstAudio = false;
      let spokenThrough = 0;
      let playing = false;
      const voiceQueue: string[] = [];
      const markAudio = () => {
        if (firstAudio) return;
        firstAudio = true;
        recordResponseTime('request to first audio', startedAt);
      };
      const playNext = () => {
        if (playing || request !== generation.current || controller.signal.aborted ||
            speechVersion !== speechQueueVersion.current) return;
        const next = voiceQueue.shift();
        if (!next) return;
        playing = true;
        speakText(next, markAudio, () => {
          playing = false;
          playNext();
        });
      };
      const queueSpeech = (text: string, complete = false) => {
        if (!isVoiceEnabled || speechVersion !== speechQueueVersion.current) return;
        const unspoken = text.slice(spokenThrough);
        const boundary = /[.!?]+["”')\]]?\s+/.exec(unspoken);
        const length = complete ? unspoken.length : boundary ? boundary.index! + boundary[0].length : 0;
        if (!length) return;
        spokenThrough += length;
        const chunk = unspoken.slice(0, length).trim();
        if (chunk) voiceQueue.push(chunk);
        playNext();
      };

      const currentImage = attachedImage;
      const petRequest = !currentImage && (taught?.action === 'launch_pet' || isPetLaunchCommand(textToSend));
      const historyId = petRequest
        ? recordCommandAttempt(transcript, textToSend, taughtActionLabels.launch_pet, 'Requested launch confirmation')
        : !currentImage && /^(?:open|close|launch|start|show|hide|turn on|turn off)\b/.test(systemCommand)
          ? recordCommandAttempt(transcript, textToSend, 'No local command match', 'Sent to chat gateway')
          : undefined;
      draftImageUrl.current = null;
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
      window.dispatchEvent(new CustomEvent('oracle_thinking_started'));

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
          const preferences = readReplyPreferences();
          if (transcript && !preferences.length) preferences.length = 'brief';
          const previousQuestion = messages.slice().reverse().find(item => item.role === 'user' && !item.error)?.text;
          const isDepartureFollowUp = /^when should i leave[?.!]*$/i.test(textToSend)
            && /my next (?:meeting|calendar event)[?.!]*$/i.test(previousQuestion ?? '');
          const needsLocation = isDepartureFollowUp || /^(?:(?:(?:hey|okay|ok) )?oracle[, ]+)?(?:please |(?:can|could) you tell me |tell me )?(?:how far am i from |when should i leave for my next meeting[?.!]*$)/i.test(textToSend);
          const routeOrigin = needsLocation && navigator.geolocation
            ? await new Promise<[number, number] | undefined>(resolve => {
                navigator.geolocation.getCurrentPosition(
                  ({ coords }) => resolve([coords.latitude, coords.longitude]),
                  () => resolve(undefined),
                  { timeout: 4000, maximumAge: 60000 },
                );
              })
            : undefined;
          const res = await fetchWithAuth('/api/v1/chat?stream=true', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              text: taught?.action === 'launch_pet' ? 'launch Oracle Pet' : textToSend,
              message: taught?.action === 'launch_pet' ? 'launch Oracle Pet' : textToSend,
              history: messages.filter(item=>!item.error).slice(-10).map(item=>({role:item.role,text:item.text.slice(0,1200)})),
              reply_preferences: Object.keys(preferences).length ? preferences : undefined,
              weather_city: localStorage.getItem('oracle_weather_city')?.trim().slice(0, 100) || undefined,
              route_origin: routeOrigin,
            })
          });

          const streamed = res.ok && res.headers.get('content-type')?.includes('application/x-ndjson');
          const data = streamed ? await readChatStream(res, delta => {
            if (!delta || request !== generation.current || controller.signal.aborted) return;
            replyText += delta;
            const text = replyText;
            if (!firstText) {
              firstText = true;
              recordResponseTime('request to first text', startedAt);
              setMessages(prev => [...prev, {
                id: replyId, role: 'model', text, timestamp: userMsg.timestamp, processing: 'local'
              }]);
            } else {
              setMessages(prev => prev.map(item => item.id === replyId ? { ...item, text } : item));
            }
            queueSpeech(text);
          }, controller.signal) : await readJson<any>(res);
          if (streamed) queueSpeech(replyText, true);
          else replyText = data.message || data.reply || 'No response generated.';
          modelName = data.model || ''; processing = data.processing || ''; proposed = data.action;
          if (request !== generation.current || controller.signal.aborted) {
            updateCommandOutcome(historyId, 'Request interrupted');
            if (proposed) void localApi(`actions/${proposed.id}`, 'DELETE').catch(() => {});
            return;
          }
          if (Number.isFinite(data.timer?.duration) && data.timer.duration > 0) {
            setTimerRemaining(Math.ceil(data.timer.duration));
            setActiveTimer({
              expiresAt: Date.now() + data.timer.duration * 1000,
              label: data.timer.label
            });
          }
          if (data.action_trigger === 'open_desktop_hud' || data.action === 'open_desktop_hud') {
            window.dispatchEvent(new CustomEvent('oracle_open_desktop_hud'));
          } else if (data.action_trigger === 'open_admin_protocol') {
            window.dispatchEvent(new CustomEvent('oracle_open_admin_protocol'));
          } else if (data.action_trigger === 'open_self_diagnostic') {
            window.dispatchEvent(new CustomEvent('oracle_open_self_diagnostic'));
          } else if (data.action_trigger === 'lock_admin') {
            window.dispatchEvent(new CustomEvent('oracle_lock_admin'));
          } else if (data.action_trigger === 'activate_sentry') {
            executeProtocol('sentry', hasAdminGrant());
            return;
          } else if (data.action_trigger === 'activate_sentinel') {
            executeProtocol('sentinel', hasAdminGrant());
            return;
          } else if (data.action_trigger === 'activate_ghost') {
            executeProtocol('ghost');
            return;
          } else if (data.action_trigger === 'activate_focus') {
            window.dispatchEvent(new CustomEvent('oracle_activate_focus_protocol'));
          } else if (data.action_trigger === 'activate_atlas') {
            window.dispatchEvent(new CustomEvent('oracle_activate_atlas_protocol'));
          } else if (data.action_trigger === 'activate_watchtower') {
            window.dispatchEvent(new CustomEvent('oracle_activate_watchtower_protocol'));
          } else if (data.action_trigger === 'activate_briefing') {
            window.dispatchEvent(new CustomEvent('oracle_activate_briefing_protocol'));
          } else if (data.action_trigger === 'activate_hibernate') {
            executeProtocol('hibernate', hasAdminGrant());
            return;
          } else if (data.action_trigger === 'activate_lockdown') {
            executeProtocol('lockdown');
            return;
          }
        }

        if (request !== generation.current || controller.signal.aborted) { updateCommandOutcome(historyId, 'Request interrupted');if(proposed) void localApi(`actions/${proposed.id}`,'DELETE').catch(()=>{}); return; }
        if(proposed) {
          const next={id:proposed.id,name:proposed.name,expires:Date.now()+proposed.expires_in_seconds*1000,historyId};
          updateCommandOutcome(historyId, 'Waiting for launch confirmation');
          actionRef.current=next;setAction(next);
        } else {
          updateCommandOutcome(historyId, petRequest ? 'Gateway did not offer a launch confirmation' : 'Gateway responded');
        }
        const modelMsg: Message = {
          id: replyId,
          role: 'model',
          text: replyText,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          model: modelName,
          processing
        };

        recordResponseTime('request to full reply', startedAt);
        if (firstText) {
          setMessages(prev => prev.map(item => item.id === replyId ? modelMsg : item));
        } else {
          recordResponseTime('request to first text', startedAt);
          setMessages(prev => [...prev, modelMsg]);
          if (speechVersion === speechQueueVersion.current) speakText(replyText, markAudio);
        }
      } catch (err) {
        updateCommandOutcome(historyId, controller.signal.aborted ? 'Request interrupted' : 'Gateway request failed');
        if (request !== generation.current || controller.signal.aborted) return;
        if (speechVersion === speechQueueVersion.current) {
          speechQueueVersion.current++;
          stopSpeaking();
        }
        const errMsg: Message = {
          id: String(Date.now() + 2),
          role: 'model',
          text: `Processing error: ${err instanceof Error ? err.message : 'Unknown gateway fault'}.`,
          error: true,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          model: 'system-fallback'
        };
        setMessages(prev => [...prev.filter(item => item.id !== replyId), errMsg]);
        setMode('ready');
      } finally {
        if(request===generation.current) {
          pending.current=null;
          isGeneratingRef.current=false;
          setIsGenerating(false);
          window.dispatchEvent(new CustomEvent('oracle_thinking_ended'));
          if (!isSpeakingActive()) setMode('ready');
        }
      }
    },
    [attachedImage, input, isVoiceEnabled, messages, onWake, privacyActive, setMode, speakText]
  );

  const voiceHandlers = useRef({handleSend, speakText, onWake});
  voiceHandlers.current = {handleSend, speakText, onWake};
  const voiceSuspended = privacyActive || currentMode === 'dormant' || currentMode === 'initializing';

  // Silero VAD lifecycle setup (persistent in background across chat open/close)
  useEffect(() => {
    setVadReady(false);
    setIsListening(false);
    setIsVadActive(false);
    if (speechMode === 'ptt' || voiceSuspended) {
      if (vadDetectorRef.current) {
        vadDetectorRef.current.destroy().catch(() => {});
        vadDetectorRef.current = null;
      }
      setVadStatus('Standby');
      return;
    }

    wakeFollowupUntil.current = 0;
    let active = true;
    let transcribing = false;
    let utterance = 0;
    let acceptingSpeech = false;
    let partialPending = false;
    let partialRequest: AbortController | null = null;
    let utteranceGeneration = voiceGeneration.current;
    const detector = new SileroVoiceDetector({
      onInputLevel,
      onSpeechStart: () => {
        utterance++;
        utteranceGeneration = voiceGeneration.current;
        acceptingSpeech = active && !isGeneratingRef.current && !transcribing && !isSpeakingActive();
        if (!acceptingSpeech) return;
        speechQueueVersion.current++;
        stopSpeaking();
        setOracleCaption(null);
        setIsListening(true);
        setMode('listening');
        setVadStatus('Speech Detected');
        setUserCaption({ text: '', state: 'listening' });
      },
      onSpeechProgress: async (chunk: Blob) => {
        if (!acceptingSpeech || partialPending || isSpeakingActive() || utteranceGeneration !== voiceGeneration.current) return;
        const currentUtterance = utterance;
        partialPending = true;
        const request = new AbortController();
        partialRequest = request;
        partialTranscription.current = request;
        try {
          const partial = await transcribeAudioBlob(chunk, request.signal, speechMode === 'wake', true);
          if (active && acceptingSpeech && !request.signal.aborted && utteranceGeneration === voiceGeneration.current && currentUtterance === utterance && partial.trim()) {
            setUserCaption({ text: partial.trim(), state: 'listening' });
          }
        } catch { /* ignore partial errors */ } finally {
          partialPending = false;
          partialRequest = null;
          if (partialTranscription.current === request) partialTranscription.current = null;
        }
      },
      onSpeechProb: (prob) => {
        if (active) setSpeechProb(prob);
      },
      onVADMisfire: () => {
        if (!acceptingSpeech) return;
        acceptingSpeech = false;
        partialRequest?.abort();
        if (!active || utteranceGeneration !== voiceGeneration.current) return;
        setIsListening(false);
        setMode('ready');
        setVadStatus(speechModeRef.current === 'wake' ? 'Standby ("Hey Oracle")' : 'Listening');
        setUserCaption(null);
      },
      onSpeechEnd: async (wavBlob: Blob) => {
        const transcriptionStarted = performance.now();
        const accepted = acceptingSpeech;
        acceptingSpeech = false;
        partialRequest?.abort();
        if (!accepted || !active || utteranceGeneration !== voiceGeneration.current) return;
        setIsListening(false);
        if (isGeneratingRef.current || transcribing || isSpeakingActive()) {
          setUserCaption(null);
          return;
        }
        const request = new AbortController();
        automaticTranscription.current = request;
        transcribing = true;
        setVadStatus('Transcribing...');
        setMode('transcribing');
        setUserCaption(prev => prev ? { ...prev, state: 'transcribing' } : { text: '', state: 'transcribing' });

        try {
          const rawText = await transcribeAudioBlob(wavBlob, request.signal, speechMode === 'wake');
          if (!active || request.signal.aborted) return;
          recordResponseTime('voice endpoint to transcript', transcriptionStarted);
          if (!rawText.trim()) {
            setUserCaption(null);
            setMode('ready');
            setVadStatus(speechModeRef.current === 'wake' ? 'Standby ("Hey Oracle")' : 'Listening');
            return;
          }

          const showFinalCaption = () => {
            const caption = { text: rawText.trim(), state: 'complete' as const };
            setUserCaption(caption);
            setTimeout(() => setUserCaption(current => current === caption ? null : current), 6000);
          };
          if (speechModeRef.current === 'wake') {
            const { matched, cleanPrompt } = extractWakePrompt(rawText);
            if (!matched && Date.now() >= wakeFollowupUntil.current) {
              // Silently ignore ambient room chatter
              setUserCaption(null);
              setMode('ready');
              setVadStatus('Standby ("Hey Oracle")');
              return;
            }

            wakeFollowupUntil.current = 0;
            showFinalCaption();
            voiceHandlers.current.onWake?.();
            if (matched) soundEffects.playWakeChime();
            setVadStatus('Wake Triggered!');
            if (!cleanPrompt) {
              // User said just the wake word
              wakeFollowupUntil.current = Date.now() + 15000;
              setMode('ready');
              voiceHandlers.current.speakText("I'm listening. How can I help you?");
              setVadStatus('Listening');
              return;
            }

            await voiceHandlers.current.handleSend(cleanPrompt, rawText.trim());
          } else {
            // Continuous VAD mode
            soundEffects.playAcknowledgeTone();
            setVadStatus('Processing...');
            showFinalCaption();
            await voiceHandlers.current.handleSend(rawText, rawText.trim());
          }
        } catch (err) {
          if (!active || request.signal.aborted) return;
          setUserCaption(null);
          console.warn('VAD transcription error:', err);
          setMode('ready');
          setVadStatus('Could not transcribe speech. Try again.');
        } finally {
          if (automaticTranscription.current === request) automaticTranscription.current = null;
          transcribing = false;
        }
      },
      onError: (err) => {
        if (!active) return;
        setVadReady(false);
        setIsListening(false);
        console.warn('Silero VAD error:', err);
        setVadStatus('VAD Error');
        onVoiceError?.('Voice input unavailable');
        setMode('ready');
      }
    });

    vadDetectorRef.current = detector;
    setVadStatus(speechMode === 'wake' ? 'Initializing Wake Word...' : 'Initializing Silero VAD...');

    detector.start()
      .then((started) => {
        if (active && started) {
          setVadReady(true);
          setIsVadActive(true);
          setVadStatus(speechMode === 'wake' ? 'Standby ("Hey Oracle")' : 'Listening for Voice...');
        } else if (active && !started) {
          setVadReady(false);
          setIsVadActive(false);
          setVadStatus('Standby');
        }
      })
      .catch((err) => {
        if (active) {
          setVadReady(false);
          setIsVadActive(false);
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
      acceptingSpeech = false;
      partialRequest?.abort();
      automaticTranscription.current?.abort();
      detector.destroy().catch(() => {});
      if (vadDetectorRef.current === detector) {
        vadDetectorRef.current = null;
      }
    };
  }, [speechMode, voiceSuspended, setMode, onInputLevel, onVoiceError]);

  // Start Push-to-Talk manual recording
  const startRecording = async () => {
    const version=++pttVersion.current;
    try {
      speechQueueVersion.current++;
      stopSpeaking();
      setOracleCaption(null);
      const started = await pttRecorderRef.current?.start(text => {
        if (version === pttVersion.current && text.trim()) {
          setUserCaption({ text: text.trim(), state: 'listening' });
        }
      }, onInputLevel, (limit) => {
        if (version !== pttVersion.current) return;
        if (limit === 'duration') {
          void stopRecordingAndSend(true);
        } else {
          setIsListening(false);
          setUserCaption(null);
          setVadStatus('Recording exceeded the size limit. Try a shorter recording.');
          setMode('ready');
        }
      });
      if(version!==pttVersion.current || !started)return;
      setIsListening(true);
      setMode('listening');
      setUserCaption({ text: '', state: 'listening' });
    } catch (err) {
      if(version!==pttVersion.current)return;
      setVadStatus(String(err));
      onVoiceError?.('Microphone unavailable');
      setIsListening(false);
      setMode('ready');
    }
  };

  // Stop Push-to-Talk and transcribe offline
  const stopRecordingAndSend = async (reachedLimit = false) => {
    if (!isListening && !reachedLimit) return;
    setIsListening(false);
    setMode('transcribing');
    setUserCaption(prev => ({ text: prev?.text ?? '', state: 'transcribing' }));

    const version=pttVersion.current;
    const transcriptionStarted = performance.now();
    try {
      const transcribedText = await pttRecorderRef.current?.stopAndTranscribe();
      if(version!==pttVersion.current)return;
      recordResponseTime('push-to-talk release to transcript', transcriptionStarted);
      if (transcribedText && transcribedText.trim()) {
        if(version===pttVersion.current){
          const caption = { text: transcribedText.trim(), state: 'complete' as const };
          setUserCaption(caption);
          setTimeout(() => setUserCaption(current => current === caption ? null : current), 6000);
          if (!isOpen) onWake?.();
          const text = transcribedText.trim();
          if (!attachedImage && !isGeneratingRef.current && !actionRef.current && !decision.current) {
            draftTranscript.current = undefined;
            await voiceHandlers.current.handleSend(text, text);
          } else {
            draftTranscript.current = text;
            setInput(text);
            setMode('ready');
          }
        }
      } else {
        setUserCaption(null);
        setVadStatus('No clear speech detected.');
        setMode('ready');
      }
    } catch (err) {
      if(version!==pttVersion.current)return;
      setUserCaption(null);
      setVadStatus(String(err));
      setMode('ready');
    }
  };

  const toggleRecording = async () => {
    if (privacyActive || document.body.classList.contains('oracle-privacy-mode')) return;
    if (speechMode !== 'ptt') {
      if (vadDetectorRef.current) {
        if (isVadActive) {
          cancelAutomaticSpeech();
          await vadDetectorRef.current.pause().catch(() => {});
          if (!isGeneratingRef.current) setMode('ready');
          setIsVadActive(false);
          setVadStatus('Muted (Press M to resume)');
          setIsListening(false);
        } else {
          await vadDetectorRef.current.resume().catch(() => {});
          const running = vadDetectorRef.current.isActive();
          setIsVadActive(running);
          setVadReady(running);
          setVadStatus(running ? (speechMode === 'wake' ? 'Standby ("Hey Oracle")' : 'Listening for Voice...') : 'Microphone off');
        }
      } else {
        setSpeechMode('vad');
      }
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
        toggleRecording();
      } else if (!voiceSuspended) {
        toggleRecording();
      }
    }
  }, [isOpen, voiceRequest, speechMode]);
  useEffect(() => {
    const isEngineActive = !voiceSuspended && (speechMode === 'ptt' ? isListening : (vadReady && isVadActive));
    onVoiceStatus?.({
      active: isEngineActive,
      mode: speechMode,
      isListening: !voiceSuspended && isListening,
      vadStatus: (!isEngineActive && vadStatus === 'Listening for Voice...') ? 'Microphone off' : vadStatus
    });
  }, [speechMode, isListening, vadReady, isVadActive, voiceSuspended, vadStatus, onVoiceStatus]);

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
      discardDraftImage();
      const url = URL.createObjectURL(file);
      draftImageUrl.current = url;
      attachments.current.add(url);
      setAttachedImage({ blob: file, url, source:'file' });
      if (!input.trim()) {
        setInput('What do you see in this picture?');
      }
    }
    e.target.value = '';
  };

  return (
    <>
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
                      ⏱️ {Math.floor(timerRemaining / 60)}:
                      {String(timerRemaining % 60).padStart(2, '0')}
                      <X size={10} style={{ marginLeft: '3px' }} />
                    </button>
                  )}

                  <button
                    type="button"
                    className="hud-blade-icon-btn"
                    onClick={() => {
                      if (isVoiceEnabled) {
                        speechQueueVersion.current++;
                        stopSpeaking();
                        window.clearTimeout(captionTimer.current);
                        setOracleCaption(null);
                        if (currentMode === 'speaking') setMode('ready');
                      }
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
                onClick={() => {
                  if (!hasAdminGrant()) {
                    speakWithKokoro('Access restricted. Administrator protocol clearance required.', { allowBargeIn: true });
                    return;
                  }
                  onOpenRecords?.();
                }}
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
                  discardDraftImage();
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

            {(teachingPhrase !== null || teachingStatus) && (
              <section className="record-action hud-blade-action-banner" aria-label="Teach Oracle">
                {teachingPhrase !== null && (
                  <>
                    <p>{taughtActionLabels[teachingPhrase.action]} when you say “{teachingPhrase.phrase}”?</p>
                    <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                      <button type="button" onClick={() => {
                        try {
                          changeTaughtCommand(null, teachingPhrase);
                          setTeachingPhrase(null);
                          setTeachingStatus('Phrase saved. Manage it in Settings → Shortcuts.');
                        } catch (error) {
                          setTeachingStatus(error instanceof Error ? error.message : 'Could not save the phrase.');
                        }
                      }}>Save phrase</button>
                      <button type="button" onClick={() => { setTeachingPhrase(null); setTeachingStatus(''); }}>Cancel</button>
                    </div>
                  </>
                )}
                {teachingStatus && <p role="status">{teachingStatus}</p>}
              </section>
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
                      onClick={() => {
                        if (!hasAdminGrant()) {
                          speakWithKokoro('Access restricted. Administrator protocol clearance required.', { allowBargeIn: true });
                          return;
                        }
                        onOpenRecords?.();
                      }}
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
                  <div key={m.id} className={`hud-blade-message ${m.role}`} style={{ contentVisibility: 'auto', containIntrinsicBlockSize: 'auto 100px' }}>
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
                          loading="lazy"
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

              {isGenerating && messages.at(-1)?.role === 'user' && (
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
                <CaptureReader key={attachedImage.url} image={attachedImage.blob} source={attachedImage.source} />
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
                    onClick={discardDraftImage}
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
                  onChange={event => {
                    if (!event.target.value.trim()) draftTranscript.current = undefined;
                    setInput(event.target.value);
                  }}
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

  </>
  );
};
