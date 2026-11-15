import { sfx } from './utils/sfx';
import React, { useState, useEffect, useRef, useCallback, useSyncExternalStore, lazy, Suspense } from 'react';
import { PresenceScene } from './scene/PresenceScene';
import { PresenceHeader } from './components/PresenceHeader';
import { PresenceFooter } from './components/PresenceFooter';
import { speakWithKokoro } from './utils/voice';
import { ConversationHUD, type VoiceEngineStatus, type UserVoiceCaption } from './components/ConversationHUD';
import { ReminderAlerts } from './components/ReminderAlerts';
import { useSentinel } from './hooks/useSentinel';
import { SystemSettingsModal } from './components/SystemSettingsModal';
import { DesktopActiveHUD } from './components/DesktopActiveHUD';
import { AdminProtocolOverlay } from './components/AdminProtocolOverlay';
import { OracleActivity } from './components/OracleActivity';
import { OracleMode } from './types';
import { DailyBriefing } from './components/DailyBriefing';
import type { BriefingFocus, BriefingTrip } from './utils/briefing';
import { DailyAgendaPanel } from './components/DailyAgendaPanel';
import { WeatherPanel } from './components/WeatherPanel';
import { type WeatherData } from './utils/weather';
import { fetchWithAuth, hasAdminGrant, localApi, revokeAdminGrant, subscribeToAdminGrant } from './utils/api';
import { motion, AnimatePresence } from 'framer-motion';
import { useSensors } from './hooks/useSensors';
import { refreshCurrentUser, setCurrentUser } from './utils/currentUser';
import { ErrorBoundary } from './components/ErrorBoundary';
import './Presence.css';

const ProductIntelligencePanel = lazy(() => import('./components/ProductIntelligencePanel').then(module => ({ default: module.ProductIntelligencePanel })));
const SurveillanceViewfinder = lazy(() => import('./components/SurveillanceViewfinder').then(module => ({ default: module.SurveillanceViewfinder })));
const RecordsWorkspace = lazy(() => import('./components/RecordsWorkspace').then(module => ({ default: module.RecordsWorkspace })));
const SelfDiagnosticOverlay = lazy(() => import('./components/SelfDiagnosticOverlay').then(module => ({ default: module.SelfDiagnosticOverlay })));
const GeoWorkspace = lazy(() => import('./components/GeoWorkspace').then(module => ({ default: module.GeoWorkspace })));

declare global {
  interface Window {
    ORACLE?: {
      setMode: (mode: OracleMode) => void;
      getMode: () => OracleMode;
      reinitialize?: (accelerated?: boolean) => void;
    };
    reinitializeOracle?: () => void;
  }
}

export type BootPhase =
  | 'BOOTING_SCENE'
  | 'UI_REVEAL'
  | 'WELCOME'
  | 'BRIEFING'
  | 'ONLINE';

export const App: React.FC = () => {
  // 1. References
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<PresenceScene | null>(null);

  // 2. Core State
  const [mode, setModeState] = useState<OracleMode>('ready');
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [overdueSource, setOverdueSource] = useState<'local' | 'google'>();
  useEffect(() => {
    if (!recordsOpen) setOverdueSource(undefined);
  }, [recordsOpen]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDesktopHUDOpen, setIsDesktopHUDOpen] = useState(false);
  const [isAdminProtocolOpen, setIsAdminProtocolOpen] = useState(false);
  const [isSelfDiagnosticOpen, setIsSelfDiagnosticOpen] = useState(false);
  const [productsOpen, setProductsOpen] = useState(false);
  const [isMapOpen, setIsMapOpen] = useState(false);
  const [briefing, setBriefing] = useState<{ focus: BriefingFocus; speak: boolean }>();
  const [briefingTrip, setBriefingTrip] = useState<BriefingTrip>();
  const [atlasCommand, setAtlasCommand] = useState<{ text: string }>();

  useEffect(() => {
    const openAtlasCommand = (event: Event) => {
      setAtlasCommand({ text: (event as CustomEvent<string>).detail });
      setIsMapOpen(true);
    };
    window.addEventListener('oracle_atlas_command', openAtlasCommand);
    return () => window.removeEventListener('oracle_atlas_command', openAtlasCommand);
  }, []);

  useEffect(() => {
    if (!isMapOpen) {
      setAtlasCommand(undefined);
      setBriefingTrip(undefined);
    }
  }, [isMapOpen]);
  const [settingsTab, setSettingsTab] = useState<'faces' | 'camera' | 'voice' | 'vitals' | 'google'>('faces');

  // 3. Audio & Voice Engine State
  const inputLevel = useRef(0);
  const [voiceError, setVoiceError] = useState('');
  const voiceErrorTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(voiceErrorTimer.current), []);
  const handleVoiceError = useCallback((message: string) => {
    sceneRef.current?.showVoiceError();
    setVoiceError(message);
    window.clearTimeout(voiceErrorTimer.current);
    voiceErrorTimer.current = window.setTimeout(() => setVoiceError(''), 1800);
  }, []);
  const [userCaption, setUserCaption] = useState<UserVoiceCaption | null>(null);
  const [oracleCaption, setOracleCaption] = useState<string | null>(null);
  const handleInputLevel = useCallback((level: number) => {
    inputLevel.current = level;
    sceneRef.current?.setInputLevel(level);
  }, []);
  const [voiceRequest, setVoiceRequest] = useState(0);
  const [voiceEngine, setVoiceEngine] = useState<VoiceEngineStatus>({
    active: false,
    mode: 'vad',
    isListening: false,
    vadStatus: 'Standby'
  });
  const [pendingSnapshot, setPendingSnapshot] = useState<Blob | null>(null);
  const [captionsVisible, setCaptionsVisible] = useState(() => localStorage.getItem('oracle_captions_visible') !== 'false');

  useEffect(() => {
    const handleToggle = (e: Event) => {
      const custom = e as CustomEvent<boolean>;
      if (typeof custom.detail === 'boolean') {
        setCaptionsVisible(custom.detail);
      }
    };
    window.addEventListener('oracle_captions_changed', handleToggle);
    return () => window.removeEventListener('oracle_captions_changed', handleToggle);
  }, []);

  // 4. Permissions & Auth State
  const isUserAdmin = useSyncExternalStore(subscribeToAdminGrant, hasAdminGrant);
  const lockdownRequest = useRef(false);
  const [lockdownStatus, setLockdownStatus] = useState<string | null>(null);
  const [ghostActive, setGhostActive] = useState(false);
  const [hibernating, setHibernating] = useState(false);
  const hibernatingRef = useRef(false);

  useEffect(() => {
    const open = (event: Event) => {
      if (ghostActive) return;
      setIsChatOpen(false);
      setIsMapOpen(false);
      setRecordsOpen(false);
      setIsSettingsOpen(false);
      setBriefing({ focus: (event as CustomEvent<BriefingFocus>).detail, speak: true });
    };
    window.addEventListener('oracle_brief_me', open);
    return () => window.removeEventListener('oracle_brief_me', open);
  }, [ghostActive]);
  const [sentinelActive, setSentinelActive] = useState(false);
  const exitGhost = useCallback(() => {
    document.body.classList.remove('oracle-privacy-mode');
    setGhostActive(false);
  }, []);
  useEffect(() => () => document.body.classList.remove('oracle-privacy-mode'), []);
  const openAdminProtocol = useCallback(() => {
    setRecordsOpen(false);
    setIsAdminProtocolOpen(true);
  }, []);
  const signOutAdmin = useCallback(() => {
    window.dispatchEvent(new Event('oracle_cancel_admin_attempt'));
    setIsAdminProtocolOpen(false);
    setCurrentUser(null);
    void revokeAdminGrant().then(() => {
      speakWithKokoro('Administrator clearance ended.', { allowBargeIn: true });
    }).catch(() => {
      speakWithKokoro('Clearance cleared in this window. Gateway revocation could not be confirmed.', { allowBargeIn: true });
    });
  }, []);

  // 5. Boot Sequence & Ambient Intelligence State
  const [forceIntro] = useState(() => /init|boot/.test(window.location.search));
  const [returnVisit] = useState(() => !forceIntro && localStorage.getItem('oracle_has_initialized') === 'true');
  const [bootPhase, setBootPhase] = useState<BootPhase>(() =>
    forceIntro || (!returnVisit && !sessionStorage.getItem('oracle_session_initialized'))
      ? 'BOOTING_SCENE'
      : 'ONLINE'
  );
  const [liveWeather, setLiveWeather] = useState<WeatherData | null>(null);
  const closeAgendaCard = useCallback(() => setShowAgendaCard(false), []);
  const closeWeatherCard = useCallback(() => setShowWeatherCard(false), []);
  const [showAgendaCard, setShowAgendaCard] = useState<boolean>(() => {
    return sessionStorage.getItem('oracle_session_initialized') ? true : false;
  });
  const [showWeatherCard, setShowWeatherCard] = useState<boolean>(() => {
    return sessionStorage.getItem('oracle_session_initialized') ? true : false;
  });

  // 6. Sensor Telemetry Hook
  const sensors = useSensors(mode, hibernating);
  const sentinelEvents = useSentinel(sentinelActive, sensors.cameraStream ? 'live' : sensors.camera.state === 'red' ? 'unavailable' : sensors.camera.detail === 'Requesting camera permission' ? 'requesting access' : 'off', voiceEngine.active ? 'active' : 'off', isUserAdmin);

  // 7. Callbacks
  const skipBoot = useCallback(() => {
    if (bootPhase === 'ONLINE') return;
    sceneRef.current?.skipColdBoot();
    sessionStorage.setItem('oracle_session_initialized', 'true');
    localStorage.setItem('oracle_has_initialized', 'true');
    setBootPhase('ONLINE');
    setShowAgendaCard(true);
    setShowWeatherCard(true);
    setModeState('ready');
  }, [bootPhase]);

  const startColdBootSequence = useCallback((accelerated = false) => {
    setBootPhase('BOOTING_SCENE');
    setShowAgendaCard(false);
    setShowWeatherCard(false);
    setModeState('ready');

    sceneRef.current?.startColdBoot({
      accelerated,
      onComplete: () => {
        setBootPhase('UI_REVEAL');
        sessionStorage.setItem('oracle_session_initialized', 'true');
        localStorage.setItem('oracle_has_initialized', 'true');
      }
    });
  }, []);

  // 8. Lifecycle & Event Listeners
  const [agendaPinned, setAgendaPinned] = useState(false);
  const [weatherPinned, setWeatherPinned] = useState(false);
  useEffect(() => {
    document.body.classList.toggle('geo-active', isMapOpen);
    return () => {
      document.body.classList.remove('geo-active');
    };
  }, [isMapOpen]);

  // Handle reinitialization events
  useEffect(() => {
    const handleReinit = () => startColdBootSequence(false);
    window.addEventListener('oracle_reinitialize', handleReinit);
    return () => window.removeEventListener('oracle_reinitialize', handleReinit);
  }, [startColdBootSequence]);

  // Orchestrate UI Reveal -> Welcome Greeting -> Daily Briefing
  useEffect(() => {
    if (bootPhase === 'UI_REVEAL') {
      const timer = setTimeout(() => {
        setBootPhase('WELCOME');
      }, 250);
      return () => clearTimeout(timer);
    }

    if (bootPhase === 'WELCOME') {
      const greeting = 'Welcome home, sir. ORACLE is online. All primary systems are operational.';
      
      const timer = setTimeout(() => {
        speakWithKokoro(greeting + ' Your daily briefing is ready.', {
          voice: 'af_heart',
          speed: 1.0,
          allowBargeIn: true,
          onEnd: () => {
            setBootPhase('BRIEFING');
          },
          onError: () => {
            setBootPhase('BRIEFING');
          }
        });
      }, 400);

      return () => clearTimeout(timer);
    }

    if (bootPhase === 'BRIEFING') {
      setShowAgendaCard(true);
      setShowWeatherCard(true);

      const deliverBriefing = async () => {
        try {
          const [googleTasksRes, localTasksRes] = await Promise.all([
            localApi<{ tasks?: Array<{ title?: string; status?: string }> }>('google/tasks?tasklist_id=@default').catch(() => null),
            localApi<{ tasks?: Array<{ title?: string; state?: string }> }>('tasks').catch(() => null)
          ]);

          let pendingTasksCount = 0;
          if (Array.isArray(googleTasksRes?.tasks)) {
            pendingTasksCount += googleTasksRes.tasks.filter(t => t.title && t.status !== 'completed').length;
          }
          if (Array.isArray(localTasksRes?.tasks)) {
            pendingTasksCount += localTasksRes.tasks.filter(t => t.title && t.state !== 'completed').length;
          }

          const calData = await localApi<{ events?: any[]; items?: any[] }>('google/events?calendar_id=primary').catch(() => null);
          const rawEvents = calData?.events || calData?.items;
          const eventCount = Array.isArray(rawEvents) ? rawEvents.length : 0;

          const parts: string[] = [];
          if (eventCount > 0) {
            parts.push(`You have ${eventCount} upcoming scheduled event${eventCount > 1 ? 's' : ''}.`);
          } else {
            parts.push('No upcoming scheduled events.');
          }

          if (pendingTasksCount > 0) {
            parts.push(`${pendingTasksCount} pending task${pendingTasksCount > 1 ? 's require' : ' requires'} attention.`);
          }

          if (liveWeather) {
            parts.push(`Current conditions in ${liveWeather.city || 'your area'} are ${liveWeather.condition.toLowerCase()}, with a temperature of ${Math.round(liveWeather.temperature)} degrees.`);
          }

          const speech = parts.join(' ');
          
          speakWithKokoro(speech, {
            voice: 'af_heart',
            speed: 1.0,
            allowBargeIn: true,
            onEnd: () => {
              setTimeout(() => {
                                setBootPhase('ONLINE');
              }, 3200);
            },
            onError: () => {
              setBootPhase('ONLINE');
            }
          });
        } catch {
          setBootPhase('ONLINE');
        }
      };

      const bTimer = setTimeout(() => {
        void deliverBriefing();
      }, 500);

      return () => clearTimeout(bTimer);
    }
  }, [bootPhase, liveWeather]);

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

  useEffect(() => {
    const handleToggleDesktopHUD = () => setIsDesktopHUDOpen(prev => !prev);
    const handleOpenDesktopHUD = () => setIsDesktopHUDOpen(true);
    const handleCloseDesktopHUD = () => setIsDesktopHUDOpen(false);
    window.addEventListener('oracle_toggle_desktop_hud', handleToggleDesktopHUD);
    window.addEventListener('oracle_open_desktop_hud', handleOpenDesktopHUD);
    window.addEventListener('oracle_close_desktop_hud', handleCloseDesktopHUD);
    const handleOpenAdmin = openAdminProtocol;
    const handleCloseAdmin = () => setIsAdminProtocolOpen(false);
    const handleOpenDiagnostic = () => setIsSelfDiagnosticOpen(true);
    const handleCloseDiagnostic = () => setIsSelfDiagnosticOpen(false);
    const handleLockAdmin = signOutAdmin;
    window.addEventListener('oracle_open_admin_protocol', handleOpenAdmin);
    window.addEventListener('oracle_activate_admin_protocol', handleOpenAdmin);
    window.addEventListener('oracle_close_admin_protocol', handleCloseAdmin);
    window.addEventListener('oracle_open_self_diagnostic', handleOpenDiagnostic);
    window.addEventListener('oracle_close_self_diagnostic', handleCloseDiagnostic);
    window.addEventListener('oracle_lock_admin', handleLockAdmin);
    const handleSentry = () => {
      if (mode === 'dormant' || mode === 'initializing' || lockdownStatus || document.body.classList.contains('oracle-privacy-mode')) return;
      setRecordsOpen(false);
      setIsChatOpen(false);
      void sensors.openCamera();
    };
    const handleSentinel = () => {
      setRecordsOpen(false);
      setIsChatOpen(false);
      setSentinelActive(true);
    };
    const stopSentinel = () => setSentinelActive(false);
    const handleGhost = () => {
      if (document.body.classList.contains('oracle-privacy-mode')) return;
      document.body.classList.add('oracle-privacy-mode');
      window.dispatchEvent(new Event('oracle_privacy_started'));
      window.dispatchEvent(new Event('oracle_cancel_admin_attempt'));
      sensors.stopCamera();
      setGhostActive(true);
      setBriefing(undefined);
      setIsAdminProtocolOpen(false);
      setIsSettingsOpen(false);
      setRecordsOpen(false);
      setIsChatOpen(false);
      setIsMapOpen(false);
      setProductsOpen(false);
      setIsDesktopHUDOpen(false);
      setIsSelfDiagnosticOpen(false);
      setPendingSnapshot(null);
      setUserCaption(null);
      setOracleCaption(null);
      if (mode !== 'dormant' && mode !== 'initializing') setMode('ready');
    };
    const handleFocus = () => {
      setRecordsOpen(true);
      speakWithKokoro('Protocol Focus initiated. Development workspace active, distractions silenced.', { allowBargeIn: true });
    };
    const handleAtlas = () => {
      setIsMapOpen(true);
      speakWithKokoro('Protocol Atlas engaged. Spatial intelligence mapping online.', { allowBargeIn: true });
    };
    const handleWatchtower = () => {
      speakWithKokoro('Protocol Watchtower active. Neural gateways, local ports, and network routes are 100% operational.', { allowBargeIn: true });
    };
    const handleBriefing = () => {
      window.dispatchEvent(new CustomEvent('oracle_brief_me', { detail: 'all' }));
    };
    const handleHibernate = () => {
      if (hibernatingRef.current || mode === 'initializing') return;
      hibernatingRef.current = true;
      if (sceneRef.current) sceneRef.current.hibernating = true;
      setHibernating(true);
      window.dispatchEvent(new Event('oracle_hibernate_started'));
      window.dispatchEvent(new Event('oracle_cancel_admin_attempt'));
      sensors.stopCamera();
      setIsChatOpen(false);
      setIsAdminProtocolOpen(false);
      setIsSettingsOpen(false);
      setIsDesktopHUDOpen(false);
      setIsSelfDiagnosticOpen(false);
      setRecordsOpen(false);
      setIsMapOpen(false);
      setProductsOpen(false);
      setPendingSnapshot(null);
      setUserCaption(null);
      setOracleCaption(null);
      setMode('dormant');
    };
    const handleLockdown = () => {
      if (lockdownRequest.current) return;
      lockdownRequest.current = true;
      window.dispatchEvent(new Event('oracle_lockdown_started'));
      window.dispatchEvent(new Event('oracle_cancel_admin_attempt'));
      setIsAdminProtocolOpen(false);
      void revokeAdminGrant().catch(() => {});
      setCurrentUser(null);
      setIsChatOpen(false);
      setRecordsOpen(false);
      setIsDesktopHUDOpen(false);
      setMode('dormant');
      setLockdownStatus('Requesting Oracle restriction and Windows lock…');
      void localApi<{ oracle: 'restricted'; windows: 'requested' | 'failed' | 'unavailable' }>(
        'protocols/lockdown', 'POST', undefined, AbortSignal.timeout(10000)
      ).then(result => {
        const windows = {
          requested: 'Windows accepted the lock request.',
          failed: 'Windows did not accept the lock request.',
          unavailable: 'Windows locking is unavailable.'
        }[result.windows];
        const message = `Oracle is restricted. ${windows}`;
        setLockdownStatus(message);
        speakWithKokoro(message, { allowBargeIn: true });
      }).catch(() => {
        const message = 'Gateway lockdown status could not be confirmed. Activate Lockdown again to retry.';
        setLockdownStatus(message);
        speakWithKokoro(message, { allowBargeIn: true });
      }).finally(() => { lockdownRequest.current = false; });
    };

    window.addEventListener('oracle_activate_sentry_protocol', handleSentry);
    window.addEventListener('oracle_deactivate_sentry_protocol', sensors.stopCamera);
    window.addEventListener('oracle_activate_sentinel_protocol', handleSentinel);
    window.addEventListener('oracle_deactivate_sentinel_protocol', stopSentinel);
    window.addEventListener('oracle_activate_ghost_protocol', handleGhost);
    window.addEventListener('oracle_deactivate_ghost_protocol', exitGhost);
    window.addEventListener('oracle_activate_focus_protocol', handleFocus);
    window.addEventListener('oracle_activate_atlas_protocol', handleAtlas);
    const launchUrl = new URL(window.location.href);
    if (launchUrl.searchParams.get('companionView') === 'atlas') {
      launchUrl.searchParams.delete('companionView');
      window.history.replaceState(window.history.state, '', launchUrl);
      setIsMapOpen(true);
    }
    window.addEventListener('oracle_open_camera', sensors.openCamera);
    window.addEventListener('oracle_close_camera', sensors.stopCamera);
    const handleCloseAtlas = () => { setIsMapOpen(false); };
    window.addEventListener('oracle_close_atlas_protocol', handleCloseAtlas);
    window.addEventListener('oracle_activate_watchtower_protocol', handleWatchtower);
    window.addEventListener('oracle_activate_briefing_protocol', handleBriefing);
    window.addEventListener('oracle_activate_hibernate_protocol', handleHibernate);
    window.addEventListener('oracle_activate_lockdown_protocol', handleLockdown);

    return () => {
      window.removeEventListener('oracle_open_admin_protocol', handleOpenAdmin);
      window.removeEventListener('oracle_activate_admin_protocol', handleOpenAdmin);
      window.removeEventListener('oracle_close_admin_protocol', handleCloseAdmin);
      window.removeEventListener('oracle_open_self_diagnostic', handleOpenDiagnostic);
      window.removeEventListener('oracle_close_self_diagnostic', handleCloseDiagnostic);
      window.removeEventListener('oracle_lock_admin', handleLockAdmin);
      window.removeEventListener('oracle_activate_sentry_protocol', handleSentry);
      window.removeEventListener('oracle_deactivate_sentry_protocol', sensors.stopCamera);
      window.removeEventListener('oracle_activate_sentinel_protocol', handleSentinel);
      window.removeEventListener('oracle_deactivate_sentinel_protocol', stopSentinel);
      window.removeEventListener('oracle_activate_ghost_protocol', handleGhost);
      window.removeEventListener('oracle_deactivate_ghost_protocol', exitGhost);
      window.removeEventListener('oracle_activate_focus_protocol', handleFocus);
      window.removeEventListener('oracle_activate_atlas_protocol', handleAtlas);
      window.removeEventListener('oracle_open_camera', sensors.openCamera);
      window.removeEventListener('oracle_close_camera', sensors.stopCamera);
      window.removeEventListener('oracle_close_atlas_protocol', handleCloseAtlas);
      window.removeEventListener('oracle_activate_watchtower_protocol', handleWatchtower);
      window.removeEventListener('oracle_activate_briefing_protocol', handleBriefing);
      window.removeEventListener('oracle_activate_hibernate_protocol', handleHibernate);
      window.removeEventListener('oracle_activate_lockdown_protocol', handleLockdown);
      window.removeEventListener('oracle_toggle_desktop_hud', handleToggleDesktopHUD);
      window.removeEventListener('oracle_open_desktop_hud', handleOpenDesktopHUD);
      window.removeEventListener('oracle_close_desktop_hud', handleCloseDesktopHUD);
    };
  }, [sensors, openAdminProtocol, signOutAdmin, exitGhost, mode, lockdownStatus]);

  useEffect(() => {
    if (hibernating) return;
    const refresh = () => { if (!document.hidden) void refreshCurrentUser(); };
    refresh();
    const poll = setInterval(refresh, 5000);
    window.addEventListener('oracle_profiles_changed', refresh);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(poll); window.removeEventListener('oracle_profiles_changed', refresh); window.removeEventListener('focus', refresh); };
  }, [hibernating]);

  const setMode = useCallback((next: OracleMode) => {
    if (hibernatingRef.current && next !== 'dormant') return;
    setModeState(next);
    if (sceneRef.current) {
      sceneRef.current.setMode(next);
    }
  }, []);

  useEffect(() => {
    (window as any).setOracleMode = (next: OracleMode) => setMode(next);

    const handleSpeechStart = (e: Event) => {
      const custom = e as CustomEvent<{ text?: string }>;
      if (custom.detail?.text) {
        setOracleCaption(custom.detail.text.replace(/[*#`_~]/g, '').trim().slice(0, 1800));
      }
      setMode('speaking');
    };
    const handleSpeechEnd = () => {
      if (modeRef.current === 'speaking') {
        setMode('ready');
      }
      setTimeout(() => setOracleCaption(null), 900);
    };
    const handleThinkingStart = () => {
      setMode('thinking');
    };
    const handleThinkingEnd = () => {
      if (modeRef.current === 'thinking') {
        setMode('ready');
      }
    };

    window.addEventListener('oracle_speech_started', handleSpeechStart);
    window.addEventListener('oracle_speech_ended', handleSpeechEnd);
    window.addEventListener('oracle_thinking_started', handleThinkingStart);
    window.addEventListener('oracle_thinking_ended', handleThinkingEnd);

    return () => {
      window.removeEventListener('oracle_speech_started', handleSpeechStart);
      window.removeEventListener('oracle_speech_ended', handleSpeechEnd);
      window.removeEventListener('oracle_thinking_started', handleThinkingStart);
      window.removeEventListener('oracle_thinking_ended', handleThinkingEnd);
    };
  }, [setMode]);

  const completeBoot = useCallback((customGreeting?: string) => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      localStorage.setItem('oracle_last_boot_date', today);
    } catch (e) {
      // ignore
    }
    setMode('ready');
    if (sceneRef.current) {
      sceneRef.current.triggerAwakening();
    }

    const hour = new Date().getHours();
    const salutation = hour < 12 ? 'Good morning, sir' : hour < 17 ? 'Good afternoon, sir' : 'Good evening, sir';
    const spokenText = customGreeting || `${salutation}. All systems are 100% operational. Standing by.`;

    setTimeout(() => {
      if (hibernatingRef.current) return;
      speakWithKokoro(spokenText, {
        voice: 'af_heart',
        speed: 1.0
      });
    }, 450);
  }, [setMode]);

  const toggle = useCallback(() => {
    if (mode === 'dormant') {
      if (hibernatingRef.current) {
        hibernatingRef.current = false;
        setHibernating(false);
        if (sceneRef.current) sceneRef.current.hibernating = false;
        setMode('ready');
        sceneRef.current?.triggerAwakening();
        return;
      }
      sfx.playBiometricLockChime();
      completeBoot('Welcome home, sir. All systems are 100% operational. Standing by.');
    } else {
      setMode('dormant');
    }
  }, [mode, completeBoot, setMode]);

  // Mount Three.js Scene
  useEffect(() => {
    if (!canvasRef.current) return;
    const scene = new PresenceScene(canvasRef.current);
    sceneRef.current = scene;
    scene.setMode(mode);
    scene.start();

    if (forceIntro || (!returnVisit && !sessionStorage.getItem('oracle_session_initialized'))) {
      startColdBootSequence(false);
    } else if (returnVisit) {
      setShowAgendaCard(true);
      setShowWeatherCard(true);
    }

    // Expose programmatic API to host application
    window.ORACLE = {
      setMode: (m: OracleMode) => setMode(m),
      getMode: () => scene.state.mode,
      reinitialize: () => startColdBootSequence(false)
    };
    (window as any).reinitializeOracle = () => startColdBootSequence(false);

    return () => {
      scene.stop();
      delete window.ORACLE;
    };
  }, [forceIntro, returnVisit, setMode, startColdBootSequence]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (document.body.classList.contains('oracle-privacy-mode')) return;
      if (hibernatingRef.current) {
        if (event.code === 'Space' && !event.repeat && !(event.target instanceof HTMLButtonElement)) {
          event.preventDefault();
          toggle();
        }
        return;
      }
      if (bootPhase === 'BOOTING_SCENE') {
        if (event.code === 'Space' || event.code === 'Escape') {
          event.preventDefault();
          skipBoot();
        }
        return;
      }
      if (event.key === 'Escape') {
        setIsChatOpen(false);
        setRecordsOpen(false);
        setIsSettingsOpen(false);
        setIsSelfDiagnosticOpen(false);
        setIsAdminProtocolOpen(false);
        setIsMapOpen(false);
        return;
      }
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
      if (event.code === 'KeyB') {
        event.preventDefault();
        setShowAgendaCard(prev => !prev);
        setShowWeatherCard(prev => !prev);
      }
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

      // Toggle Settings with S (Gated to Admin)
      if (event.code === 'KeyS') {
        event.preventDefault();
        if (!hasAdminGrant()) {
          speakWithKokoro('Access restricted. Administrator protocol clearance required.', { allowBargeIn: true });
          return;
        }
        setIsSettingsOpen((prev) => !prev);
      }

      // Toggle Workspace / Records with W (Gated to Admin)
      if (event.code === 'KeyW') {
        event.preventDefault();
        if (!hasAdminGrant()) {
          speakWithKokoro('Access restricted. Administrator protocol clearance required.', { allowBargeIn: true });
          return;
        }
        setRecordsOpen((prev) => !prev);
      }

      // Trigger Self-Diagnostic on demand with I
      if (event.code === 'KeyI' && event.shiftKey) {
        event.preventDefault();
        startColdBootSequence(false);
        return;
      }
      if (event.code === 'KeyI') {
        event.preventDefault();
        setIsSelfDiagnosticOpen((prev) => !prev);
      }

      // Trigger Admin Protocol on demand with A
      if (event.code === 'KeyA') {
        event.preventDefault();
        openAdminProtocol();
      }

      // Toggle Tactical Geo Workspace with N
      if (event.code === 'KeyN') {
        event.preventDefault();
        setIsMapOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [bootPhase, isChatOpen, openAdminProtocol, setMode, skipBoot, startColdBootSequence, toggle]);

  const handleSleepClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMode('dormant');
  };

  const displayMode = mode === 'listening' && !voiceEngine.active ? 'ready' : mode;
  const isDormant = mode === 'dormant';
  const conversationOpen = !ghostActive && isChatOpen && !isDormant && mode !== 'initializing' && !recordsOpen;
  const showCaption = !ghostActive && captionsVisible && !conversationOpen;
  const visibleOracleCaption = showCaption && (mode === 'speaking' || mode === 'ready') ? oracleCaption : null;
  const visibleUserCaption = showCaption && mode !== 'speaking' ? userCaption : null;
  const isActive = mode !== 'dormant' && mode !== 'ready';

  return (
    <>
      {/* 3D WebGL Canvas */}
      <canvas
        id="scene"
        className={returnVisit ? 'return-visit' : undefined}
        ref={canvasRef}
        onClick={() => { if (bootPhase === 'BOOTING_SCENE') { skipBoot(); } else { toggle(); } }}
        aria-label="ORACLE geometric sphere and a subtle three-dimensional particle environment"
      />

      {/* Atmospheric overlays with core nebula and deep vignette */}
      <div className="atmosphere" />
      <div className={`core-halo ${mode}`} data-mode={mode} />
      <div className="vignette" />

      {bootPhase === 'BOOTING_SCENE' && (
        <button className="boot-skip" type="button" onClick={skipBoot}>Skip intro</button>
      )}
      {bootPhase !== 'BOOTING_SCENE' && sensors.chat.detail === 'Checking gateway' && (
        <div className="boot-connection" role="status">Connecting…</div>
      )}

      {/* Structured Interface Overlay */}
      <div
        id="ui"
        className={`interface ${isDormant ? 'dormant' : ''} ${isActive ? 'active' : ''} ${mode === 'initializing' ? 'initializing' : ''}`}
        data-mode={mode}
        data-booting={bootPhase === 'BOOTING_SCENE'}
        inert={bootPhase === 'BOOTING_SCENE' || ghostActive}
      >
        <PresenceHeader
          mode={displayMode}
          sensors={{
            ...sensors,
            mic: {
              state: voiceEngine.isListening ? 'green' : voiceEngine.active ? 'blue' : 'gray',
              label: 'Microphone',
              detail: voiceEngine.active
                ? (voiceEngine.mode === 'ptt' ? 'Recording (Push-to-Talk)' : voiceEngine.mode === 'wake' ? 'Listening for "Hey Oracle"' : 'Listening for Voice (Silero VAD Active)')
                : (voiceEngine.vadStatus === 'Standby' || voiceEngine.vadStatus.toLowerCase().includes('listening')) ? 'Microphone off (Click to enable)' : voiceEngine.vadStatus
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
          isWorkspaceOpen={recordsOpen}
          onOpenRecords={() => { setIsChatOpen(false); setRecordsOpen(true); }}
          onSleep={handleSleepClick}
          onOpenChat={() => setIsChatOpen(true)}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onOpenAdminProtocol={openAdminProtocol}
          onSignOutAdmin={signOutAdmin}
          lockdownStatus={lockdownStatus}
          sentinelEvents={!ghostActive && sentinelActive ? sentinelEvents : undefined}
          onStopSentinel={() => setSentinelActive(false)}
          onOpenProducts={() => setProductsOpen((open) => !open)}
          onOpenMaps={() => setIsMapOpen(prev => !prev)}
          isMapOpen={isMapOpen}
          isAdmin={isUserAdmin}
        />
        <PresenceFooter
          mode={displayMode}
          onWake={toggle}
          speechMode={voiceEngine.mode}
          userCaption={visibleUserCaption}
          oracleCaption={visibleOracleCaption}
          oracleSpeaking={mode === 'speaking'}
          voiceError={displayMode === 'ready' ? voiceError : ''}
        />
      </div>

      <Suspense fallback={null}>
        {!hibernating && !ghostActive && productsOpen && !sensors.cameraStream && (
          <aside className="product-scanner-dock" aria-label="Product scanner">
            <button type="button" onClick={() => setProductsOpen(false)}>Close scanner</button>
            <button type="button" onClick={() => void sensors.toggleCamera()}
              disabled={sensors.camera.detail === 'Requesting camera permission'}>Use camera</button>
            {sensors.camera.state === 'red' && <p role="alert">Camera unavailable. Upload a photo to continue.</p>}
            <ProductIntelligencePanel stream={null} />
          </aside>
        )}

        {/* Real-time Optical Vision & Person Identification Viewfinder */}
        {!ghostActive && sensors.cameraStream && mode !== 'initializing' && (
          <div className="oracle-camera-host">
            <SurveillanceViewfinder
              stream={sensors.cameraStream}
              onCameraChange={sensors.selectCamera}
              onClose={sensors.stopCamera}
              onSnapshot={(blob) => {
                sensors.stopCamera();
                setPendingSnapshot(blob);
                setIsChatOpen(true);
              }}
              onSaveUnknownSnapshot={async (blob, unknownId) => {
                try {
                  const form = new FormData();
                  form.append('image', blob, 'unidentified-person.jpg');
                  form.append('title', `Unidentified ${unknownId} — ${new Date().toLocaleString()}`);
                  form.append('text', `Auto-saved cropped face for ${unknownId}. First seen: ${new Date().toLocaleString()}. Identity was not inferred.`);
                  form.append('source', 'camera');
                  form.append('ocr_text', '');
                  const response = await fetchWithAuth('/api/v1/memories', { method: 'POST', body: form });
                  if (!response.ok) {
                    const data = await response.json().catch(() => ({}));
                    throw new Error(data.detail || 'Unable to save unidentified frame');
                  }
                  window.dispatchEvent(new Event('oracle_unknown_frames_changed'));
                  return true;
                } catch (error) {
                  window.dispatchEvent(new CustomEvent('oracle_unknown_frames_error', {
                    detail: error instanceof Error ? error.message : 'Unable to save unidentified frame'
                  }));
                  return false;
                }
              }}
            />
          </div>
        )}
      </Suspense>

      {/* Conversational Neural Interface & Command HUD */}
      <ConversationHUD
        isOpen={conversationOpen}
        privacyActive={ghostActive}
        currentMode={mode}
        onClose={() => setIsChatOpen(false)}
        setMode={setMode}
        initialImage={pendingSnapshot}
        onClearInitialImage={() => setPendingSnapshot(null)}
        onOpenRecords={()=>{setIsChatOpen(false);setRecordsOpen(true);}}
        onWake={() => setIsChatOpen(true)}
        voiceRequest={voiceRequest}
        onVoiceStatus={setVoiceEngine}
        onInputLevel={handleInputLevel}
        setUserCaption={setUserCaption}
        setOracleCaption={setOracleCaption}
        onVoiceError={handleVoiceError}
      />
      <Suspense fallback={null}>
        {!ghostActive && recordsOpen && mode!=='dormant' && (
          <RecordsWorkspace
            overdueSource={overdueSource}
            onClose={()=>setRecordsOpen(false)}
            onActivateAdminProtocol={openAdminProtocol}
            isAdmin={isUserAdmin}
          />
        )}
      </Suspense>

      {!ghostActive && isMapOpen && mode !== 'dormant' && (
        <Suspense fallback={null}>
          <ErrorBoundary fallbackTitle="ATLAS SPATIAL WORKSPACE" onReset={() => setIsMapOpen(false)}>
            <GeoWorkspace onClose={() => setIsMapOpen(false)} command={atlasCommand} briefingTrip={briefingTrip}>
              <OracleActivity
                mode={mode}
                inputLevel={inputLevel}
                micActive={voiceEngine.active}
                onOpen={() => {
                  setIsMapOpen(false);
                  setRecordsOpen(false);
                  setIsChatOpen(true);
                }}
              />
            </GeoWorkspace>
          </ErrorBoundary>
        </Suspense>
      )}
      <DesktopActiveHUD isOpen={!ghostActive && isDesktopHUDOpen && mode !== 'dormant' && mode !== 'initializing'} onClose={() => setIsDesktopHUDOpen(false)} />
      <Suspense fallback={null}>
        {!ghostActive && isSelfDiagnosticOpen && mode !== 'dormant' && (
          <SelfDiagnosticOverlay
            onClose={() => setIsSelfDiagnosticOpen(false)}
            onComplete={() => setIsSelfDiagnosticOpen(false)}
          />
        )}
      </Suspense>

      <AdminProtocolOverlay
        isOpen={!ghostActive && isAdminProtocolOpen && mode !== 'dormant'}
        onClose={() => setIsAdminProtocolOpen(false)}
        onSuccess={(admin) => {
          setLockdownStatus(null);
          setCurrentUser(admin);
          sfx.playBiometricLockChime();
        }}
      />
      <SystemSettingsModal
        isOpen={!ghostActive && isSettingsOpen && mode!=='dormant'}
        onClose={() => setIsSettingsOpen(false)}
        cameraStream={sensors.cameraStream}
        initialTab={settingsTab}
      />
      {!briefing && !ghostActive && mode!=='dormant' && mode!=='initializing' && <ReminderAlerts/>}
      {ghostActive && <button type="button" className="oracle-ghost-exit" onClick={exitGhost}>Exit Ghost mode</button>}
      {hibernating && !ghostActive && <button type="button" className="oracle-ghost-exit" onClick={toggle}>Wake Oracle</button>}

      {/* Presence cards */}
      <AnimatePresence>
        {!ghostActive && mode !== 'dormant' && mode !== 'initializing' && !recordsOpen && !isChatOpen && !isMapOpen && !isSettingsOpen && (
          <motion.div
            key="left-flank-intelligence-dock"
            className="oracle-intelligence-left-dock oracle-briefing-dock"
            exit={{ opacity: 0, transition: { duration: 0.14 } }}
          >
            {briefing && (
              <DailyBriefing request={briefing} onClose={() => setBriefing(undefined)}
                onCalendar={() => {
                  setSettingsTab('google');
                  setIsSettingsOpen(true);
                }}
                onOpenRoute={trip => {
                  setBriefing(undefined);
                  setAtlasCommand(undefined);
                  setBriefingTrip(trip);
                  setIsMapOpen(true);
                }} />
            )}
            {!briefing && showAgendaCard && (
              <DailyAgendaPanel
                pinned={agendaPinned}
                onTogglePin={() => setAgendaPinned(value => !value)}
                onOpenOverdue={source => { setOverdueSource(source); setRecordsOpen(true); }}
                onOpenWorkspace={() => { setIsChatOpen(false); setRecordsOpen(true); }}
                onClose={closeAgendaCard}
              />
            )}
            {!briefing && showWeatherCard && (
              <WeatherPanel
                pinned={weatherPinned}
                onTogglePin={() => setWeatherPinned(value => !value)}
                onWeatherLoaded={setLiveWeather}
                onClose={closeWeatherCard}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
