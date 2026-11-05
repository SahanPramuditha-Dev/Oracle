import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import { PresenceScene } from './scene/PresenceScene';
import { PresenceHeader } from './components/PresenceHeader';
import { PresenceFooter } from './components/PresenceFooter';
import { InitializationOverlay, type BiometricAuthResult } from './components/InitializationOverlay';
import { speakWithKokoro } from './utils/voice';
import { ConversationHUD, type VoiceEngineStatus } from './components/ConversationHUD';
import { SurveillanceViewfinder } from './components/SurveillanceViewfinder';
import { RecordsWorkspace } from './components/RecordsWorkspace';
import { ReminderAlerts } from './components/ReminderAlerts';
import { SystemSettingsModal } from './components/SystemSettingsModal';
import { OracleMode } from './types';
import { useSensors } from './hooks/useSensors';
import './Presence.css';
import { setCurrentUser, refreshCurrentUser } from './utils/currentUser';

declare global {
  interface Window {
    ORACLE?: {
      setMode: (mode: OracleMode) => void;
      getMode: () => OracleMode;
    };
  }
}

export interface TimeState {
  hours: string;
  minutes: string;
  seconds: string;
}

export const App: React.FC = () => {
  const [mode, setModeState] = useState<OracleMode>('initializing');
  const [time, setTime] = useState<TimeState>({ hours: '00', minutes: '00', seconds: '00' });
  const [dateStr, setDateStr] = useState('');
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
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
  }, []);
  const [voiceRequest,setVoiceRequest] = useState(0);
  const [voiceEngine, setVoiceEngine] = useState<VoiceEngineStatus>({
    active: false,
    mode: 'ptt',
    isListening: false,
    vadStatus: 'Standby'
  });
  const [pendingSnapshot, setPendingSnapshot] = useState<Blob | null>(null);

  const sensors = useSensors(mode);
  useEffect(() => {
    const refresh = () => { void refreshCurrentUser(); };
    const poll = setInterval(refresh, 5000);
    window.addEventListener('oracle_profiles_changed', refresh);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(poll); window.removeEventListener('oracle_profiles_changed', refresh); window.removeEventListener('focus', refresh); };
  }, []);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<PresenceScene | null>(null);

  // Precision Timekeeper (updates every second for seconds counter)
  useEffect(() => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const updateTime = () => {
      const now = new Date();
      setTime({
        hours: pad(now.getHours()),
        minutes: pad(now.getMinutes()),
        seconds: pad(now.getSeconds())
      });
      setDateStr(
        now.toLocaleDateString('en-GB', {
          weekday: 'short',
          day: 'numeric',
          month: 'short'
        }).toUpperCase()
      );
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const setMode = useCallback((next: OracleMode) => {
    setModeState(next);
    if (sceneRef.current) {
      sceneRef.current.setMode(next);
    }
  }, []);

  const completeBoot = useCallback((auth?: BiometricAuthResult) => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      localStorage.setItem('oracle_last_boot_date', today);
    } catch (e) {
      // ignore
    }
    setMode('ready');

    // Speak vocal greeting once home screen is shown
    if (auth) {
      const hour = new Date().getHours();
      const salutation = hour < 12 ? 'Good morning, sir' : hour < 17 ? 'Good afternoon, sir' : 'Good evening, sir';

      let spokenText = `${salutation}. Biometric identity verified with Administrative privileges. All systems are 100% operational. Standing by.`;
      if (auth.facesDetected === 0) {
        spokenText = `${salutation}. Warning: No operator detected. Standing by.`;
      } else if (auth.isMatched && !auth.isAdmin) {
        spokenText = `${salutation}. Operator ${auth.identifiedName || 'User'} identified. Standing by.`;
      } else if (!auth.isMatched) {
        spokenText = `${salutation}. Warning: Biometric identity not verified. Administrative privileges restricted. Standing by.`;
      }

      // 450ms delay allows home screen HUD and sphere awakening sequence to become visible first
      setTimeout(() => {
        speakWithKokoro(spokenText, {
          voice: 'af_heart',
          speed: 1.0
        });
      }, 450);
    }
  }, [setMode]);

  const toggle = useCallback(() => {
    if (mode === 'initializing') {
      completeBoot();
      return;
    }
    setMode(mode === 'dormant' ? 'ready' : 'dormant');
  }, [mode, setMode, completeBoot]);

  // Mount Three.js Scene
  useEffect(() => {
    if (!canvasRef.current) return;
    const scene = new PresenceScene(canvasRef.current);
    sceneRef.current = scene;
    scene.setMode(mode);
    scene.start();

    // Expose programmatic API to host application
    window.ORACLE = {
      setMode: (m: OracleMode) => setMode(m),
      getMode: () => scene.state.mode
    };

    return () => {
      scene.stop();
      delete window.ORACLE;
    };
  }, [setMode]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if(event.key==='Escape'){setIsChatOpen(false);setRecordsOpen(false);setIsSettingsOpen(false);return;}
      if (
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes((document.activeElement as HTMLElement)?.tagName)
      ) {
        return;
      }

      if (event.code === 'Space') {
        event.preventDefault();
        toggle();
      }

      if(event.code==='KeyM'){setVoiceRequest(n=>n+1);}
      if (event.code === 'KeyD') {
        setMode('dormant');
      }

      // Toggle Conversation HUD with C or Slash
      if (event.code === 'KeyC' || event.code === 'Slash') {
        event.preventDefault();
        setIsChatOpen((prev) => !prev);
      }

      if (event.code === 'Escape' && isChatOpen) {
        setIsChatOpen(false);
      }

      // Toggle Settings with S
      if (event.code === 'KeyS') {
        event.preventDefault();
        setIsSettingsOpen((prev) => !prev);
      }

      // Re-trigger initialization test on demand with I or B
      if (event.code === 'KeyI' || event.code === 'KeyB') {
        setMode('initializing');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggle, setMode, isChatOpen]);

  const handleSleepClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMode('dormant');
  };

  const displayMode = mode === 'listening' && !voiceEngine.active ? 'ready' : mode;
  const isDormant = mode === 'dormant';
  const isActive = mode !== 'dormant' && mode !== 'ready';

  return (
    <>
      {/* 3D WebGL Canvas */}
      <canvas
        id="scene"
        ref={canvasRef}
        onClick={toggle}
        aria-label="ORACLE geometric sphere and a subtle three-dimensional particle environment"
      />

      {/* Atmospheric overlays with core nebula and deep vignette */}
      <div className="atmosphere" />
      <div className="core-halo" />
      <div className="vignette" />

      {/* Initialization Sequence HUD Overlay */}
      <AnimatePresence mode="wait">
        {mode === 'initializing' && (
        <InitializationOverlay
          onComplete={auth => {
            setCurrentUser(auth?.isMatched && auth.personId ? {id: auth.personId, name: auth.identifiedName || 'Registered user', permission: auth.permission === 'administrator' ? 'administrator' : 'standard'} : null);
            void refreshCurrentUser();
            completeBoot();
          }}
          key="init-overlay"
          onSkip={completeBoot}
        />
      )}

      </AnimatePresence>

      {/* Structured Interface Overlay */}
      <div
        id="ui"
        className={`interface ${isDormant ? 'dormant' : ''} ${isActive ? 'active' : ''} ${mode === 'initializing' ? 'initializing' : ''}`}
      >
        <PresenceHeader
          mode={displayMode}
          time={time}
          sensors={{
            ...sensors,
            mic: {
              state: voiceEngine.isListening ? 'green' : voiceEngine.active ? 'blue' : 'gray',
              label: 'Microphone',
              detail: voiceEngine.active
                ? (voiceEngine.mode === 'ptt' ? 'Recording (Push-to-Talk)' : voiceEngine.mode === 'wake' ? 'Listening for "Hey Oracle"' : 'Continuous Conversation Active')
                : voiceEngine.vadStatus === 'Standby' ? 'Microphone off' : voiceEngine.vadStatus
            },
            toggleMic: async () => {
              setVoiceRequest(n => n + 1);
            }
          }}
          voiceEngine={{
            active: voiceEngine.active && !isChatOpen && mode !== 'dormant',
            isListening: voiceEngine.isListening,
            mode: voiceEngine.mode,
            vadStatus: voiceEngine.vadStatus
          }}
          onMuteVoice={() => {
            localStorage.setItem('oracle_speech_mode', 'ptt');
            window.dispatchEvent(new CustomEvent('oracle_speech_mode_changed', { detail: 'ptt' }));
            setVoiceRequest((n) => n + 1);
          }}
          onOpenRecords={()=>{setIsChatOpen(false);setRecordsOpen(true);}}
          onSleep={handleSleepClick}
          onInitialize={() => setMode('initializing')}
          onOpenChat={() => setIsChatOpen(true)}
          onOpenSettings={() => setIsSettingsOpen(true)}
        />
        <PresenceFooter
          mode={displayMode}
          time={time}
          dateStr={dateStr}
          onWake={toggle}
        />
      </div>

      {/* Real-time Optical Vision & Person Identification Viewfinder */}
      {sensors.cameraStream && mode !== 'initializing' && (
        <div
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            zIndex: 850,
            width: '460px',
            maxWidth: 'calc(100vw - 48px)'
          }}
        >
          <SurveillanceViewfinder
            stream={sensors.cameraStream}
            onCameraChange={sensors.selectCamera}
            onClose={sensors.stopCamera}
            onSnapshot={(blob) => {
              sensors.stopCamera();
              setPendingSnapshot(blob);
              setIsChatOpen(true);
            }}
          />
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
        onWake={() => setIsChatOpen(true)}
        voiceRequest={voiceRequest}
        onVoiceStatus={setVoiceEngine}
      />
      {recordsOpen && mode!=='dormant' && <RecordsWorkspace onClose={()=>setRecordsOpen(false)}/>}
      <SystemSettingsModal
        isOpen={isSettingsOpen && mode!=='dormant'}
        onClose={() => setIsSettingsOpen(false)}
        cameraStream={sensors.cameraStream}
        initialTab={settingsTab}
      />
      {mode!=='dormant' && mode!=='initializing' && <ReminderAlerts/>}
    </>
  );
};
