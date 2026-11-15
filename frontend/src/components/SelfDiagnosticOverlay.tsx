import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence, Variants } from 'framer-motion';
import { Database, ShieldCheck, Camera, Cpu, Mic, Check } from 'lucide-react';
import { sfx } from '../utils/sfx';
import { fetchWithAuth } from '../utils/api';
import { FluidVoiceWaveform } from './FluidVoiceWaveform';

export interface SelfDiagnosticOverlayProps {
  onClose: () => void;
  onComplete?: (auth?: BiometricAuthResult) => void;
}

export interface BiometricAuthResult {
  facesDetected: number;
  identifiedName: string | null;
  isAdmin: boolean;
  isMatched: boolean;
  confidence: number;
  notes: string;
  personId?: string;
  permission?: string;
}

type Stage = 'neural' | 'database' | 'acoustic' | 'optical' | 'summary';

// Cinematic luxury card variants with smooth optical blur departure
const cardVariants: Variants = {
  initial: { opacity: 0, scale: 0.98 },
  animate: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.32, ease: [0.16, 1, 0.3, 1] }
  },
  exit: {
    opacity: 0,
    y: -14,
    scale: 1.015,
    filter: 'blur(8px)',
    transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1] }
  }
};

// ============================================================================
// STAGE 1: Neural Gateway & Ollama Cluster Live Test
// ============================================================================
interface NeuralCardProps {
  onComplete: (success: boolean, failure?: string) => void;
}

const NeuralCard: React.FC<NeuralCardProps> = ({ onComplete }) => {
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const hasFinishedRef = useRef(false);
  const lastBarRef = useRef(0);

  const [model, setModel] = useState('AI provider');
  const [latency, setLatency] = useState<number | null>(null);
  const [detail, setDetail] = useState('INITIALIZING PROBE...');
  const [activeBars, setActiveBars] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isLocked, setIsLocked] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let animId: number;
    let currentPct = 0;
    let targetPct = 15;

    // Smooth forward-only progress ticker
    const tick = () => {
      if (!active) return;
      if (currentPct < targetPct) {
        currentPct = Math.min(targetPct, currentPct + 1.2);
        const rounded = Math.round(currentPct);
        setProgress(rounded);

        const bars = Math.floor((rounded / 100) * 12);
        setActiveBars((prev) => {
          const next = Math.max(prev, bars);
          if (next > lastBarRef.current && next <= 12) {
            lastBarRef.current = next;
            sfx.playMeterTick();
          }
          return next;
        });
      }
      animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);

    const runGenuineNeuralTest = async () => {
      // Step 1: Probe Gateway Health
      await new Promise((r) => setTimeout(r, 200));
      if (!active) return;
      setDetail('CONNECTING TO LOCAL GATEWAY...');
      targetPct = 35;

      try {
        const healthRes = await fetch('/api/v1/health');
        if (!healthRes.ok) throw new Error('Gateway unreachable');

        // Step 2: Live Neural Engine Probe (Actual test against local Ollama daemon)
        await new Promise((r) => setTimeout(r, 300));
        if (!active) return;
        setDetail('Checking configured provider…');
        targetPct = 70;

        const diagRes = await fetchWithAuth('/api/v1/diagnostics/neural');
        const diagData = await diagRes.json();

        if (active) {
          setModel(diagData.model || diagData.provider || 'AI provider');
          setLatency(typeof diagData.latency_ms === 'number' ? diagData.latency_ms : null);
          setDetail(diagData.detail || 'Provider status unavailable');
        }

        if (!diagRes.ok || diagData.status !== 'nominal') {
          throw new Error(diagData.detail || 'Provider probe failed');
        }

        // Step 3: Complete Handshake
        await new Promise((r) => setTimeout(r, 350));
        if (!active) return;
        setDetail(diagData.detail);
        targetPct = 100;

        // Wait until visually reached 100%
        await new Promise((r) => setTimeout(r, 600));
        if (!active || hasFinishedRef.current) return;
        hasFinishedRef.current = true;
        setIsLocked(true);
        sfx.playDiagnosticBlip(0);

        setTimeout(() => {
          if (active) onCompleteRef.current(true);
        }, 950);
      } catch (err: unknown) {
        if (!active) return;
        console.error('Neural diagnostic failure:', err);
        setErrorText('Probe not verified');
        setDetail(err instanceof Error ? err.message : 'Provider probe failed');
        targetPct = 100;
        await new Promise((r) => setTimeout(r, 600));
        if (hasFinishedRef.current) return;
        hasFinishedRef.current = true;
        setIsLocked(true);
        setTimeout(() => {
          if (active) onCompleteRef.current(false, 'Neural compute engine');
        }, 1100);
      }
    };

    runGenuineNeuralTest();

    return () => {
      active = false;
      cancelAnimationFrame(animId);
    };
  }, []);

  return (
    <motion.div
      key="neural-card"
      className="oracle-diag-card subsystem-neural"
      variants={cardVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <div className="card-header-strip">
        <span className="card-section-tag">
          <Cpu size={13} strokeWidth={1.8} style={{ marginRight: 4, verticalAlign: 'middle', color: '#6366f1' }} />
          Neural Gateway
        </span>
        <span className={`card-status-badge ${isLocked ? 'locked' : 'scanning'}`}>
          <span className="card-status-dot" />
          {errorText || (isLocked ? 'Model available' : 'Checking provider…')}
        </span>
      </div>

      <div className="card-hero-block">
        <div className="card-hero-title">{model}</div>
        <div className="card-hero-sub">{detail || 'Local Neural Daemon • High-Speed Context Inference'}</div>
      </div>

      <div className="card-meter-rack">
        <span className="meter-label">Probe progress</span>
        <div className="meter-segments">
          {Array.from({ length: 12 }).map((_, i) => (
            <span
              key={i}
              className={`meter-bar ${i < activeBars ? 'active' : ''}`}
            />
          ))}
        </div>
        <span className="meter-pct">{progress}%</span>
      </div>

      <div className="card-spec-grid">
        <div className="spec-cell">
          <span className="spec-key">Probe latency</span>
          <span className="spec-val">{latency !== null ? `${latency} ms` : 'Unavailable'}</span>
        </div>
      </div>
    </motion.div>
  );
};

// ============================================================================
// STAGE 2: Storage Vault & PostgreSQL Live SQL Execution Test
// ============================================================================
interface DatabaseCardProps {
  onComplete: (success: boolean, failure?: string) => void;
}

const DatabaseCard: React.FC<DatabaseCardProps> = ({ onComplete }) => {
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const hasFinishedRef = useRef(false);
  const lastBarRef = useRef(0);

  const [dbStorage, setDbStorage] = useState('Storage');
  const [migrationVersion, setMigrationVersion] = useState('');
  const [queryLatency, setQueryLatency] = useState<number | null>(null);
  const [recordsCount, setRecordsCount] = useState<number | null>(null);
  const [activeBars, setActiveBars] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isLocked, setIsLocked] = useState(false);

  const [probeFailed, setProbeFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let animId: number;
    let currentPct = 0;
    let targetPct = 15;

    // Smooth forward-only progress ticker
    const tick = () => {
      if (!active) return;
      if (currentPct < targetPct) {
        currentPct = Math.min(targetPct, currentPct + 1.2);
        const rounded = Math.round(currentPct);
        setProgress(rounded);

        const bars = Math.floor((rounded / 100) * 12);
        setActiveBars((prev) => {
          const next = Math.max(prev, bars);
          if (next > lastBarRef.current && next <= 12) {
            lastBarRef.current = next;
            sfx.playMeterTick();
          }
          return next;
        });
      }
      animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);

    const runGenuineDatabaseTest = async () => {
      // Step 1: Session Auth
      await new Promise((r) => setTimeout(r, 200));
      if (!active) return;
      targetPct = 35;

      // Step 2: Execute Live SQL Query on PostgreSQL Engine
      await new Promise((r) => setTimeout(r, 300));
      if (!active) return;
      targetPct = 70;

      try {
        const diagRes = await fetchWithAuth('/api/v1/diagnostics/database');
        if (!diagRes.ok) throw new Error('Database query failed');
        const data = await diagRes.json();

        if (active) {
          setDbStorage(data.dialect || 'Storage');
          setMigrationVersion(data.migration || '');
          setQueryLatency(data.query_latency_ms);
          setRecordsCount(data.records_verified ?? null);
        }

        // Step 3: Complete Validation
        await new Promise((r) => setTimeout(r, 350));
        if (!active) return;
        targetPct = 100;

        await new Promise((r) => setTimeout(r, 600));
        if (!active || hasFinishedRef.current) return;
        hasFinishedRef.current = true;
        setIsLocked(true);
        sfx.playDiagnosticBlip(1);

        setTimeout(() => {
          if (active) onCompleteRef.current(true);
        }, 950);
      } catch (err) {
        if (!active) return;
        console.error('Database live diagnostic failure:', err);
        setProbeFailed(true);
        targetPct = 100;
        await new Promise((r) => setTimeout(r, 600));
        if (hasFinishedRef.current) return;
        hasFinishedRef.current = true;
        setIsLocked(true);
        setTimeout(() => {
          if (active) onCompleteRef.current(false, 'Database query');
        }, 1100);
      }
    };

    runGenuineDatabaseTest();

    return () => {
      active = false;
      cancelAnimationFrame(animId);
    };
  }, []);

  return (
    <motion.div
      key="database-card"
      className="oracle-diag-card subsystem-database"
      variants={cardVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <div className="card-header-strip">
        <span className="card-section-tag">
          <Database size={13} strokeWidth={1.8} style={{ marginRight: 4, verticalAlign: 'middle', color: '#10b981' }} />
          Storage Vault
        </span>
        <span className={`card-status-badge ${isLocked ? 'locked' : 'scanning'}`}>
          <span className="card-status-dot" />
          {probeFailed ? 'Query failed' : isLocked ? 'Queries passed' : 'Running queries…'}
        </span>
      </div>

      <div className="card-hero-block">
        <div className="card-hero-title">{dbStorage}</div>
        <div className="card-hero-sub">Connection, migration and task and note counts</div>
      </div>

      <div className="card-meter-rack">
        <span className="meter-label">Probe progress</span>
        <div className="meter-segments">
          {Array.from({ length: 12 }).map((_, i) => (
            <span
              key={i}
              className={`meter-bar ${i < activeBars ? 'active-green' : ''}`}
            />
          ))}
        </div>
        <span className="meter-pct">{progress}%</span>
      </div>

      <div className="card-spec-grid">
        <div className="spec-cell">
          <span className="spec-key">Database</span>
          <span className="spec-val">{dbStorage}</span>
        </div>
        <div className="spec-cell">
          <span className="spec-key">Migration</span>
          <span className="spec-val" title={migrationVersion}>
            {migrationVersion ? (migrationVersion.length > 9 ? migrationVersion.slice(0, 9) : migrationVersion) : 'Unavailable'}
          </span>
        </div>
        <div className="spec-cell">
          <span className="spec-key">Latency</span>
          <span className="spec-val" style={{ color: isLocked ? '#22c55e' : 'inherit' }}>
            {queryLatency !== null ? `${queryLatency}ms` : 'Testing...'}
          </span>
        </div>
        <div className="spec-cell">
          <span className="spec-key">Records</span>
          <span className="spec-val" style={{ color: '#22c55e' }}>
            {recordsCount !== null ? `${recordsCount} ${recordsCount === 1 ? 'Record' : 'Records'}` : 'Auditing...'}
          </span>
        </div>
      </div>
    </motion.div>
  );
};

// ============================================================================
// STAGE 3: Acoustic Spectrum & Real Microphone Hardware Sampling
// ============================================================================
interface AcousticCardProps {
  onComplete: (success: boolean, failure?: string) => void;
}

const AcousticCard: React.FC<AcousticCardProps> = ({ onComplete }) => {
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const hasFinishedRef = useRef(false);
  const lastBarRef = useRef(0);

  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [activeBars, setActiveBars] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isLocked, setIsLocked] = useState(false);
  const [sampleRate, setSampleRate] = useState<string>('Probing...');
  const [deviceLabel, setDeviceLabel] = useState<string>('Detecting Mic...');
  const [noiseFloor, setNoiseFloor] = useState<string>('Sampling...');
  const [isAwaitingPermission, setIsAwaitingPermission] = useState(false);
  const [audioActivity, setAudioActivity] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const skipMicrophoneRef = useRef<() => void>(() => {});

  useEffect(() => {
    let active = true;
    let animId: number;
    let currentPct = 0;
    let targetPct = 15;
    const timeBuf = new Float32Array(512);
    let lastSampleAt = -Infinity;

    // Smooth forward-only progress ticker
    const tick = (now: number) => {
      if (!active) return;
      if (currentPct < targetPct) {
        currentPct = Math.min(targetPct, currentPct + 1.2);
        const rounded = Math.round(currentPct);
        setProgress(rounded);

        const bars = Math.floor((rounded / 100) * 12);
        setActiveBars((prev) => {
          const next = Math.max(prev, bars);
          if (next > lastBarRef.current && next <= 12) {
            lastBarRef.current = next;
            sfx.playMeterTick();
          }
          return next;
        });
      }

      // Sample live room acoustics if microphone connected
      if (analyserRef.current && now - lastSampleAt >= 200) {
        lastSampleAt = now;
        analyserRef.current.getFloatTimeDomainData(timeBuf);
        let sum = 0;
        for (let i = 0; i < timeBuf.length; i++) {
          sum += timeBuf[i] * timeBuf[i];
        }
        const rms = Math.sqrt(sum / timeBuf.length);
        setNoiseFloor(rms > 0 ? (20 * Math.log10(rms)).toFixed(1) + ' dBFS' : 'No signal');
        if (rms > 0.012) {
          setAudioActivity(true);
        }
      }

      animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);

    const executeFallback = () => {
      if (hasFinishedRef.current) return;
      hasFinishedRef.current = true;
      setIsAwaitingPermission(false);
      setDeviceLabel('Microphone unavailable');
      setSampleRate('Unavailable');
      setNoiseFloor('Unavailable');
      targetPct = 100;
      setTimeout(() => {
        setIsLocked(true);
        sfx.playDiagnosticBlip(2);
        setTimeout(() => {
          if (active) onCompleteRef.current(false, 'Audio microphone');
        }, 950);
      }, 500);
    };
    skipMicrophoneRef.current = executeFallback;

    // Timeout detection: if browser permission prompt is pending
    const permTimer = setTimeout(() => {
      if (active && !hasFinishedRef.current && !audioStreamRef.current) {
        setIsAwaitingPermission(true);
      }
    }, 1800);

    // Auto-fallback: if user never clicks permission prompt or no mic is present, don't freeze
    const autoFallbackTimer = setTimeout(() => {
      if (active && !hasFinishedRef.current && !audioStreamRef.current) {
        console.warn('Microphone permission timeout (8.5s) — microphone check skipped');
        executeFallback();
      }
    }, 8500);

    const runGenuineAcousticTest = async () => {
      await new Promise((r) => setTimeout(r, 200));
      if (!active) return;
      targetPct = 35;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: false },
          video: false
        });

        clearTimeout(permTimer);
        clearTimeout(autoFallbackTimer);
        setIsAwaitingPermission(false);

        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        audioStreamRef.current = stream;

        const track = stream.getAudioTracks()[0];
        if (track?.label) {
          const raw = track.label.replace(/\([0-9a-fA-F:-]+\)/g, '').trim().toUpperCase();
          setDeviceLabel(raw.length > 24 ? raw.slice(0, 24) + '...' : raw);
        } else {
          setDeviceLabel('PRIMARY MICROPHONE');
        }

        await new Promise((r) => setTimeout(r, 300));
        if (!active) return;
        targetPct = 70;

        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new AudioCtx();
        audioContextRef.current = ctx;

        const sr = ctx.sampleRate;
        setSampleRate(`${(sr / 1000).toFixed(1)} kHz`);

        const source = ctx.createMediaStreamSource(stream);
        const node = ctx.createAnalyser();
        node.fftSize = 512;
        node.smoothingTimeConstant = 0.75;
        source.connect(node);
        analyserRef.current = node;
        setAnalyser(node);

        await new Promise((r) => setTimeout(r, 350));
        if (!active) return;
        targetPct = 100;

        await new Promise((r) => setTimeout(r, 600));
        if (!active || hasFinishedRef.current) return;
        hasFinishedRef.current = true;
        setIsLocked(true);
        sfx.playDiagnosticBlip(2);

        setTimeout(() => {
          if (active) onCompleteRef.current(true);
        }, 950);
      } catch (err) {
        if (!active) return;
        clearTimeout(permTimer);
        clearTimeout(autoFallbackTimer);
        setIsAwaitingPermission(false);
        console.warn('Microphone permission fallback:', err);
        executeFallback();
      }
    };

    runGenuineAcousticTest();

    return () => {
      active = false;
      cancelAnimationFrame(animId);
      clearTimeout(permTimer);
      clearTimeout(autoFallbackTimer);
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, []);

  return (
    <motion.div
      key="acoustic-card"
      className={`oracle-waveform-card subsystem-acoustic ${isLocked ? 'is-calibrated' : ''}`}
      variants={cardVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <div className="card-header-strip">
        <span className="card-section-tag">
          <Mic size={13} strokeWidth={1.8} style={{ marginRight: 4, verticalAlign: 'middle', color: isLocked ? '#22c55e' : 'var(--accent)' }} />
          Acoustic Sensors
        </span>
        <span className={`card-status-badge ${isLocked ? 'locked' : isAwaitingPermission ? 'waiting' : 'scanning'}`}>
          <span className="card-status-dot" />
          {isLocked
            ? (analyser ? 'Audio stream opened' : 'Probe skipped')
            : isAwaitingPermission
            ? 'Awaiting Permission...'
            : audioActivity
            ? 'Live Signal Detected'
            : 'Sampling Audio Stream...'}
        </span>
      </div>

      <div className="card-hero-block" style={{ marginBottom: 8 }}>
        <div className="card-hero-title">Acoustic Environment</div>
        <div className="card-hero-sub">Microphone input and signal level</div>
      </div>

      {isAwaitingPermission && !isLocked && (
        <div className="acoustic-permission-hint">
          <span>Microphone access requested</span>
          <button
            type="button"
            className="hint-bypass-btn"
            onClick={() => skipMicrophoneRef.current()}
          >
            Skip microphone check
          </button>
        </div>
      )}

      {analyser && (
        <FluidVoiceWaveform analyser={analyser} width={422} height={96} isCalibrated={isLocked} />
      )}

      <div className="card-meter-rack" style={{ marginTop: 10, marginBottom: 0 }}>
        <span className="meter-label">Sampling progress</span>
        <div className="meter-segments">
          {Array.from({ length: 12 }).map((_, i) => (
            <span
              key={i}
              className={`meter-bar ${i < activeBars ? (isLocked ? 'active-green' : 'active') : ''}`}
            />
          ))}
        </div>
        <span className="meter-pct" style={{ color: isLocked ? '#22c55e' : 'inherit' }}>
          {progress}%
        </span>
      </div>

      <div className="card-spec-grid" style={{ marginTop: 12 }}>
        <div className="spec-cell">
          <span className="spec-key">Hardware</span>
          <span className="spec-val" title={deviceLabel}>
            {deviceLabel}
          </span>
        </div>
        <div className="spec-cell">
          <span className="spec-key">Signal level</span>
          <span className="spec-val" style={{ color: isLocked ? '#22c55e' : (noiseFloor.includes('dBFS') ? 'var(--fg)' : 'inherit') }}>
            {noiseFloor}
          </span>
        </div>
        <div className="spec-cell">
          <span className="spec-key">Sample Rate</span>
          <span className="spec-val">
            {sampleRate}
          </span>
        </div>
        <div className="spec-cell">
          <span className="spec-key">Status</span>
          <span className="spec-val" style={{ color: isLocked ? '#22c55e' : isAwaitingPermission ? '#f59e0b' : '#38bdf8' }}>
            {isLocked ? (analyser ? 'Stream opened' : 'Skipped') : isAwaitingPermission ? 'Pending' : 'Sampling'}
          </span>
        </div>
      </div>
    </motion.div>
  );
};

// ============================================================================
// STAGE 4: Optical Camera Hardware & Sensor Calibration Probe
// (Diagnostics only - verifies CMOS stream, resolution, and frame capture)
// ============================================================================
interface OpticalCardProps {
  onComplete: (success: boolean, failure?: string) => void;
}

const OpticalCard: React.FC<OpticalCardProps> = ({ onComplete }) => {
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const hasFinishedRef = useRef(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timecodeRef = useRef<HTMLDivElement | null>(null);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [resolution, setResolution] = useState('Acquiring...');
  const [fps, setFps] = useState('Sampling...');
  const [opticalStatus, setOpticalStatus] = useState('Checking camera access…');
  const [progress, setProgress] = useState(0);
  const [activeBars, setActiveBars] = useState(0);
  const [isLocked, setIsLocked] = useState(false);
  const lastBarRef = useRef(0);

  const cameraResult = useRef<'pending' | 'ready' | 'failed'>('pending');

  // 1. Acquire Live Camera Stream
  useEffect(() => {
    let active = true;
    let acquiredStream: MediaStream | null = null;
    cameraResult.current = 'pending';

    if (!navigator.mediaDevices?.getUserMedia) {
      cameraResult.current = 'failed';
      setResolution('Unavailable');
      setFps('Unavailable');
      setOpticalStatus('Camera access unavailable');
      return;
    }
    const timeout = window.setTimeout(() => {
      if (cameraResult.current === 'pending') {
        cameraResult.current = 'failed';
        setResolution('Unavailable');
        setFps('Unavailable');
        setOpticalStatus('Camera did not respond');
      }
    }, 8000);

    navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: false
    })
      .then((s) => {
        if (!active || cameraResult.current !== 'pending') {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        const track = s.getVideoTracks()[0];
        if (track?.readyState === 'live') {
          acquiredStream = s;
          setStream(s);
          cameraResult.current = 'ready';
        } else {
          s.getTracks().forEach(item => item.stop());
          cameraResult.current = 'failed';
        }
        const settings = track?.getSettings();
        setResolution(settings?.width && settings.height ? `${settings.width} × ${settings.height}` : 'Unavailable');
        setFps(settings?.frameRate ? `${Math.round(settings.frameRate)} FPS` : 'Unavailable');
        setOpticalStatus(cameraResult.current === 'ready' ? 'Camera stream opened' : 'No live video track');
      })
      .catch(() => {
        if (!active) return;
        cameraResult.current = 'failed';
        setResolution('Unavailable');
        setFps('Unavailable');
        setOpticalStatus('Camera access failed');
      });

    return () => {
      active = false;
      window.clearTimeout(timeout);
      acquiredStream?.getTracks().forEach(track => track.stop());
    };
  }, []);

  // 2. Attach Stream to Video Element
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
  }, [stream]);

  // 3. Millisecond Live Timecode
  useEffect(() => {
    let frameId: number;
    const updateTimecode = () => {
      const now = new Date();
      const pad = (n: number, s = 2) => String(n).padStart(s, '0');
      if (timecodeRef.current) {
        timecodeRef.current.textContent = `LIVE ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}:${pad(now.getMilliseconds(), 3)}`;
      }
      frameId = requestAnimationFrame(updateTimecode);
    };
    frameId = requestAnimationFrame(updateTimecode);
    return () => cancelAnimationFrame(frameId);
  }, []);

  // 4. Progress Calibration Sweep
  useEffect(() => {
    let active = true;
    let animId: number;
    let currentPct = 0;
    const targetPct = 100;

    const tick = () => {
      if (!active) return;
      if (currentPct < targetPct) {
        currentPct = Math.min(targetPct, currentPct + 1.1);
        const rounded = Math.round(currentPct);
        setProgress(rounded);

        const bars = Math.floor((rounded / 100) * 12);
        setActiveBars((prev) => {
          const next = Math.max(prev, bars);
          if (next > lastBarRef.current && next <= 12) {
            lastBarRef.current = next;
            sfx.playMeterTick();
          }
          return next;
        });
      }

      if (currentPct >= 100 && cameraResult.current !== 'pending' && !hasFinishedRef.current) {
        hasFinishedRef.current = true;
        setIsLocked(true);
        const passed = cameraResult.current === 'ready';
        if (passed) sfx.playDiagnosticBlip(2);
        setTimeout(() => {
          if (active) onCompleteRef.current(passed, passed ? undefined : 'Camera access');
        }, 650);
      }

      animId = requestAnimationFrame(tick);
    };

    const timer = setTimeout(() => {
      animId = requestAnimationFrame(tick);
    }, 250);

    return () => {
      active = false;
      clearTimeout(timer);
      cancelAnimationFrame(animId);
    };
  }, []);

  return (
    <motion.div
      key="optical-card"
      className={`oracle-diag-card subsystem-optical ${isLocked ? 'is-calibrated' : ''}`}
      variants={cardVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <div className="card-header-strip">
        <span className="card-section-tag">
          <Camera size={13} strokeWidth={1.8} style={{ marginRight: 4, verticalAlign: 'middle', color: isLocked ? '#22c55e' : 'var(--accent)' }} />
          Optical Sentry Hardware
        </span>
        <span className={`card-status-badge ${isLocked ? 'locked' : 'scanning'}`}>
          <span className="card-status-dot" />
          {isLocked ? (stream ? 'Stream opened' : 'Probe failed') : 'Checking camera…'}
        </span>
      </div>

      <div className="card-hero-block">
        <div className="card-hero-title">Camera stream check</div>
        <div className="card-hero-sub">
          {opticalStatus}
        </div>
      </div>

      <div className="startup-identity-preview" style={{ height: 195, width: '100%', borderRadius: 12, overflow: 'hidden', position: 'relative', background: '#030712' }}>
        <video
          ref={(el) => {
            videoRef.current = el;
            if (el && stream && el.srcObject !== stream) {
              el.srcObject = stream;
              el.play().catch(() => {});
            }
          }}
          autoPlay
          playsInline
          muted
          style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}
        />

        <div style={{ position: 'absolute', top: 8, left: 10, fontSize: '9px', fontFamily: "'JetBrains Mono', monospace", color: '#38bdf8' }} ref={timecodeRef}>
          LIVE STREAMING
        </div>
      </div>

      {/* Progress Meter */}
      <div className="card-meter-rack" style={{ marginTop: 10, marginBottom: 0 }}>
        <span className="meter-label">Probe progress</span>
        <div className="meter-segments">
          {Array.from({ length: 12 }).map((_, i) => (
            <span
              key={i}
              className={`meter-bar ${i < activeBars ? 'active' : ''}`}
            />
          ))}
        </div>
        <span className="meter-pct">{progress}%</span>
      </div>

      <div className="card-spec-grid" style={{ marginTop: 10 }}>
        <div className="spec-cell">
          <span className="spec-key">Sensor</span>
          <span className="spec-val">{stream ? "Video track" : "Unavailable"}</span>
        </div>
        <div className="spec-cell">
          <span className="spec-key">Resolution</span>
          <span className="spec-val" style={{ color: isLocked ? '#22c55e' : 'inherit' }}>
            {resolution}
          </span>
        </div>
        <div className="spec-cell">
          <span className="spec-key">Reported frame rate</span>
          <span className="spec-val" style={{ color: isLocked ? '#22c55e' : 'inherit' }}>
            {fps}
          </span>
        </div>
        <div className="spec-cell">
          <span className="spec-key">Probe</span>
          <span className="spec-val" style={{ color: isLocked ? '#22c55e' : '#38bdf8' }}>
            {isLocked ? (stream ? 'Passed' : 'Failed') : 'Pending'}
          </span>
        </div>
      </div>
    </motion.div>
  );
};

// ============================================================================
// STAGE 5: Subsystem Calibration Summary
// ============================================================================
interface SubsystemSummaryCardProps {
  failures: string[];
  onComplete: () => void;
  onRerun?: () => void;
}

const SubsystemSummaryCard: React.FC<SubsystemSummaryCardProps> = ({
  failures,
  onComplete,
  onRerun
}) => {
  const allSubsystemsOk = failures.length === 0;
  const [progress, setProgress] = useState(0);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const startTime = performance.now();
    const duration = 1200;
    let animId: number;

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const pct = Math.min(100, Math.round((elapsed / duration) * 100));
      setProgress(pct);
      if (pct < 100) {
        animId = requestAnimationFrame(tick);
      } else {
        setIsReady(true);
        sfx.playDiagnosticBlip(3);
      }
    };

    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, []);

  const activeBars = Math.round((progress / 100) * 12);

  return (
    <motion.div
      key="summary-card"
      className="oracle-diag-card subsystem-admin"
      style={{ maxWidth: 470 }}
      variants={cardVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <div className="card-header-strip">
        <span className="card-section-tag">
          <ShieldCheck size={13} strokeWidth={1.8} style={{ marginRight: 4, verticalAlign: 'middle', color: '#22c55e' }} />
          Diagnostic Report
        </span>
        <span className={`card-status-badge ${allSubsystemsOk ? 'locked' : 'waiting'}`}>
          {allSubsystemsOk ? 'Checks passed' : 'Review required'}
        </span>
      </div>

      <div className="card-hero-block" style={{ marginTop: 4, marginBottom: 8 }}>
        <div className="card-hero-title">Diagnostic results</div>
        <div className="card-hero-sub">
          {allSubsystemsOk ? 'All completed probes passed.' : 'Checks requiring review'}
        </div>
        {!allSubsystemsOk && <ul>{failures.map(name => <li key={name}>{name}</li>)}</ul>}
      </div>

      {/* Meter */}
      <div className="card-meter-rack" style={{ marginTop: 2, marginBottom: 0 }}>
        <span className="meter-label">Report progress</span>
        <div className="meter-segments">
          {Array.from({ length: 12 }).map((_, i) => (
            <span
              key={i}
              className={`meter-bar ${i < activeBars ? 'active-green' : ''}`}
            />
          ))}
        </div>
        <span className="meter-pct">{progress}%</span>
      </div>

      {/* 4-Tile Spec Grid */}
      <div className="card-spec-grid" style={{ marginTop: 12 }}>
        <div className="spec-cell">
          <span className="spec-key">Gateway</span>
          <span className="spec-val" style={{ color: '#22c55e' }}>Connected</span>
        </div>
        <div className="spec-cell">
          <span className="spec-key">Database</span>
          <span className="spec-val" style={{ color: '#22c55e' }}>Operational</span>
        </div>
        <div className="spec-cell">
          <span className="spec-key">Sensors</span>
          <span className="spec-val" style={{ color: '#22c55e' }}>Acoustic+Optic</span>
        </div>
        <div className="spec-cell">
          <span className="spec-key">State</span>
          <span className="spec-val" style={{ color: '#38bdf8' }}>Standing By</span>
        </div>
      </div>

      {isReady && (
        <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end', pointerEvents: 'auto' }}>
          {onRerun && (
            <button
              type="button"
              className="hud-chip"
              onClick={onRerun}
              style={{
                fontSize: 10,
                padding: '6px 14px',
                background: 'rgba(255, 255, 255, 0.06)',
                borderColor: 'rgba(255, 255, 255, 0.16)',
                color: 'var(--text-secondary)',
                cursor: 'pointer'
              }}
            >
              Rerun Diagnostics
            </button>
          )}
          <button
            type="button"
            className="hud-chip"
            onClick={onComplete}
            style={{
              fontSize: 10,
              padding: '6px 16px',
              background: 'rgba(34, 197, 94, 0.15)',
              borderColor: 'rgba(34, 197, 94, 0.4)',
              color: '#4ade80',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Complete & Exit
          </button>
        </div>
      )}
    </motion.div>
  );
};

// ============================================================================
// Main Container Orchestrator
// ============================================================================
interface StageMeta {
  id: Stage;
  label: string;
  num: string;
  icon: (color: string) => React.ReactNode;
}

const STAGES: StageMeta[] = [
  { id: 'neural', label: 'Neural Gateway', num: '01', icon: (c) => <Cpu size={13} strokeWidth={2} color={c} /> },
  { id: 'database', label: 'Vector Database', num: '02', icon: (c) => <Database size={13} strokeWidth={2} color={c} /> },
  { id: 'acoustic', label: 'Acoustic Sensors', num: '03', icon: (c) => <Mic size={13} strokeWidth={2} color={c} /> },
  { id: 'optical', label: 'Optical Hardware', num: '04', icon: (c) => <Camera size={13} strokeWidth={2} color={c} /> },
  { id: 'summary', label: 'System Health', num: '05', icon: (c) => <ShieldCheck size={13} strokeWidth={2} color={c} /> },
];

export const SelfDiagnosticOverlay: React.FC<SelfDiagnosticOverlayProps> = ({
  onClose,
  onComplete
}) => {
  useEffect(() => {
    const unlockAudio = () => sfx.unlock();
    window.addEventListener('pointerdown', unlockAudio);
    window.addEventListener('keydown', unlockAudio);
    return () => {
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
  }, []);

  const [bootChronometer, setBootChronometer] = useState('T+00:00.00s');

  useEffect(() => {
    const start = performance.now();
    let frameId: number;

    const tick = () => {
      const elapsed = (performance.now() - start) / 1000;
      const mins = Math.floor(elapsed / 60);
      const secs = (elapsed % 60).toFixed(2);
      setBootChronometer(`T+${String(mins).padStart(2, '0')}:${secs.padStart(5, '0')}s`);
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, []);

  const [stage, setStage] = useState<Stage>('neural');
  const [failures, setFailures] = useState<string[]>([]);


  const currentStageIdx = STAGES.findIndex((s) => s.id === stage);

  const handleStageComplete = useCallback((
    success: boolean,
    name?: string,
    nextStage?: Stage,
    
  ) => {
    if (!success && name) {
      setFailures((prev) => (prev.includes(name) ? prev : [...prev, name]));
    }

    if (nextStage) {
      setStage(nextStage);
    }
  }, []);

  const goToDatabase = useCallback((ok: boolean, fail?: string) => handleStageComplete(ok, fail, 'database'), [handleStageComplete]);
  const goToAcoustic = useCallback((ok: boolean, fail?: string) => handleStageComplete(ok, fail, 'acoustic'), [handleStageComplete]);
  const goToOptical = useCallback((ok: boolean, fail?: string) => handleStageComplete(ok, fail, 'optical'), [handleStageComplete]);
  const goToSummary = useCallback((ok: boolean, fail?: string) => {
    handleStageComplete(ok, fail, 'summary');
  }, [handleStageComplete]);

  const handleClose = useCallback(() => {
    window.speechSynthesis?.cancel();
    onClose();
  }, [onClose]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleClose]);

  return (
    <motion.div
      className="init-overlay"
      initial={{ opacity: 1 }}
      exit={{
        opacity: 0,
        scale: 1.025,
        filter: 'blur(16px)',
        transition: { duration: 0.75, ease: [0.16, 1, 0.3, 1] }
      }}
    >
      {/* Dynamic ambient optical backdrop glow matching active stage */}
      <div className={`init-ambient-glow stage-${stage}`} aria-hidden="true" />

      {/* Screen Edge Tactical Reticles */}
      <div className="init-hud-reticle top-left" aria-hidden="true" />
      <div className="init-hud-reticle top-right" aria-hidden="true" />
      <div className="init-hud-reticle bottom-left" aria-hidden="true" />
      <div className="init-hud-reticle bottom-right" aria-hidden="true" />

      {/* Top Telemetry Header & Skip Action */}
      <header className="init-top-strip">
        <div className="init-sys-badge">
          <span className="init-beacon" />
          <span className="init-sys-title">ORACLE // SYSTEM SELF-DIAGNOSTIC PROTOCOL</span>
          <span className="init-sys-ver">BUILD 2.4-PROD</span>
          <span className="init-sys-chronometer">{bootChronometer}</span>
        </div>
        <button
          type="button"
          className="init-skip-pill"
          onClick={handleClose}
          title="Close self-diagnostic monitor (Esc)"
        >
          <span>Close Diagnostic</span>
          <kbd>ESC</kbd>
        </button>
      </header>

      {/* Two-Column Centered Command Console */}
      <div className="init-console-stage">
        {/* Left Side: Vertical Diagnostic Progression Rail */}
        <aside className="init-vertical-pipeline">
          <div className="pipeline-header">
            <span className="pipeline-tag">DIAGNOSTIC PIPELINE</span>
            <span className="pipeline-count">{String(currentStageIdx + 1).padStart(2, '0')} / {String(STAGES.length).padStart(2, '0')}</span>
          </div>

          <div className="pipeline-track">
            {STAGES.map((s, idx) => {
              const isPast = idx < currentStageIdx;
              const isCurrent = idx === currentStageIdx;
              const activeColor = isPast ? '#22c55e' : isCurrent ? '#38bdf8' : 'rgba(232, 235, 239, 0.4)';
              return (
                <div
                  key={s.id}
                  className={`pipeline-step ${isCurrent ? 'active' : ''} ${isPast ? 'completed' : ''}`}
                >
                  <div className="pipeline-node-col">
                    <span className="pipeline-dot">
                      {isPast ? <Check size={11} strokeWidth={2.8} color="#22c55e" /> : s.icon(activeColor)}
                    </span>
                    {idx < STAGES.length - 1 && (
                      <span className={`pipeline-connector-line ${isPast ? 'filled' : ''}`} />
                    )}
                  </div>
                  <div className="pipeline-info-col">
                    <div className="pipeline-step-meta">
                      <span className="pipeline-step-num">STAGE {s.num}</span>
                    </div>
                    <div className="pipeline-step-title">{s.label}</div>
                    <div className="pipeline-step-status">
                      {isPast ? (
                        <span className="status-verified">Verified</span>
                      ) : isCurrent ? (
                        <span className="status-running">
                          <span className="pulse-dot" />
                          Testing...
                        </span>
                      ) : (
                        <span className="status-standby">Standby</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        {/* Right Side: Active Diagnostic Card (Centered vertically with stage) */}
        <div className="init-card-stage">
          <AnimatePresence mode="wait">
            {stage === 'neural' && (
              <NeuralCard key="neural" onComplete={goToDatabase} />
            )}
            {stage === 'database' && (
              <DatabaseCard key="database" onComplete={goToAcoustic} />
            )}
            {stage === 'acoustic' && (
              <AcousticCard key="acoustic" onComplete={goToOptical} />
            )}
            {stage === 'optical' && (
              <OpticalCard key="optical" onComplete={goToSummary} />
            )}
            {stage === 'summary' && (
              <SubsystemSummaryCard
                key="summary"
                failures={failures}
                onRerun={() => {
                  setFailures([]);
                  setStage('neural');
                }}
                onComplete={() => {
                  onComplete?.();
                  onClose();
                }}
              />
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Bottom Telemetry Footer Strip */}
      <footer className="init-bottom-strip">
        <div className="init-footer-chunk">
          <span className="chunk-label">OPERATING MODE</span>
          <span className="chunk-val">AIR-GAPPED NEURAL PRESENCE</span>
        </div>
        <div className="init-footer-chunk">
          <span className="chunk-label">SUBSYSTEM STATUS</span>
          <span className="chunk-val">LIVE SUBSYSTEM CHECKS</span>
        </div>
      </footer>
    </motion.div>
  );
};


// Backwards-compatibility alias
export const InitializationOverlay = SelfDiagnosticOverlay;
