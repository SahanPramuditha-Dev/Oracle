import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, Mic, X, Check, Lock, AlertCircle } from 'lucide-react';
import { sfx } from '../utils/sfx';
import { acceptAdminGrant, fetchWithAuth, localApi, readJson } from '../utils/api';
import { FluidVoiceWaveform } from './FluidVoiceWaveform';
import { speakWithKokoro } from '../utils/voice';
import './AdminProtocolOverlay.css';

export interface AdminProtocolOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (admin: { id: string; name: string; permission: 'administrator' }) => void;
}

type AuthStep = 'face' | 'voice' | 'success';
type VerifiedAdmin = NonNullable<Parameters<NonNullable<AdminProtocolOverlayProps['onSuccess']>>[0]>;

export const AdminProtocolOverlay: React.FC<AdminProtocolOverlayProps> = ({
  isOpen,
  onClose,
  onSuccess
}) => {
  const [currentStep, setCurrentStep] = useState<AuthStep>('face');

  // Face factor state
  const [faceVerified, setFaceVerified] = useState(false);
  const [adminName, setAdminName] = useState<string | null>(null);
  const [attemptError, setAttemptError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Voice factor state
  const [voiceVerified, setVoiceVerified] = useState(false);
  const [voiceVolume, setVoiceVolume] = useState(0);
  const [voiceStatus, setVoiceStatus] = useState<'idle' | 'recording' | 'analyzing' | 'verified' | 'failed'>('idle');
  const [voiceRecording, setVoiceRecording] = useState(false);
  const [spokenText, setSpokenText] = useState<string>('');
  const [voiceFeedback, setVoiceFeedback] = useState<string | null>(null);
  const [microphoneReady, setMicrophoneReady] = useState(false);
  const [microphoneError, setMicrophoneError] = useState<string | null>(null);
  const [challengePhrase, setChallengePhrase] = useState('');

  // Overall state
  const [protocolUnlocked, setProtocolUnlocked] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef<{ id?: string; controller: AbortController; completed: boolean } | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const cancelAttempt = useCallback(() => {
    const attempt = attemptRef.current;
    if (!attempt) return;
    attemptRef.current = null;
    attempt.controller.abort();
    if (attempt.id && !attempt.completed) {
      void localApi(`admin/attempts/${attempt.id}`, 'DELETE').catch(() => {});
    }
  }, []);

  const close = useCallback(() => {
    cancelAttempt();
    onCloseRef.current();
  }, [cancelAttempt]);

  // Reset states on open
  useEffect(() => {
    if (isOpen) {
      setCurrentStep('face');
      setFaceVerified(false);
      setAdminName(null);
      setAttemptError(null);
      setAccessDenied(false);
      setCameraError(null);
      setChallengePhrase('');
      setVoiceVerified(false);
      setVoiceRecording(false);
      setVoiceStatus('idle');
      setSpokenText('');
      setVoiceFeedback(null);
      setMicrophoneReady(false);
      setMicrophoneError(null);
      setProtocolUnlocked(false);
      const attempt: NonNullable<typeof attemptRef.current> = { controller: new AbortController(), completed: false };
      attemptRef.current = attempt;
      void localApi<{ id: string }>('admin/attempts', 'POST').then(({ id }) => {
        if (attemptRef.current === attempt) attempt.id = id;
        else void localApi(`admin/attempts/${id}`, 'DELETE').catch(() => {});
      }).catch(error => {
        if (attemptRef.current === attempt) setAttemptError(error.message);
      });
    }
    return cancelAttempt;
  }, [isOpen, cancelAttempt]);

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener('oracle_cancel_admin_attempt', cancelAttempt);
    return () => window.removeEventListener('oracle_cancel_admin_attempt', cancelAttempt);
  }, [isOpen, cancelAttempt]);

  // 1. Microphone Audio Stream & Level Analyzer
  useEffect(() => {
    if (!isOpen || currentStep !== 'voice') return;
    let active = true;
    let animId: number;

    navigator.mediaDevices?.getUserMedia?.({ audio: true })
      .then((stream) => {
        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        audioStreamRef.current = stream;
        setMicrophoneReady(true);
        setMicrophoneError(null);
        try {
          const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
          audioContextRef.current = ctx;
          const src = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          src.connect(analyser);
          analyserRef.current = analyser;

          const buffer = new Float32Array(analyser.fftSize);

          const checkAudio = () => {
            if (!active) return;
            analyser.getFloatTimeDomainData(buffer);
            let sum = 0;
            for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
            const rms = Math.sqrt(sum / buffer.length);
            setVoiceVolume(Math.min(1, rms * 5));
            animId = requestAnimationFrame(checkAudio);
          };
          animId = requestAnimationFrame(checkAudio);
        } catch (e) {
          console.warn('Audio analyser error:', e);
        }
      })
      .catch((e) => {
        console.warn('Microphone permission not granted:', e);
        setMicrophoneReady(false);
        setMicrophoneError('Microphone permission is blocked. Allow microphone access for 127.0.0.1, then try again.');
      });

    return () => {
      active = false;
      cancelAnimationFrame(animId);
      if (recordingTimeoutRef.current) clearTimeout(recordingTimeoutRef.current);
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.onstop = null;
        recorder.stop();
      }
      mediaRecorderRef.current = null;
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach((t) => t.stop());
        audioStreamRef.current = null;
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, [isOpen, currentStep]);

  // 2. Camera Stream (Active during Face step)
  useEffect(() => {
    if (!isOpen || currentStep !== 'face') return;
    let active = true;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera access is unavailable in this browser context.');
      return;
    }

    navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }
    })
      .then((s) => {
        if (!active) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.play().catch(() => {});
        }
      })
      .catch((e) => {
        console.warn('Camera stream error:', e);
        if (active) setCameraError('Camera unavailable. Check browser camera permissions and reopen Admin Protocol.');
      });

    return () => {
      active = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, [isOpen, currentStep]);

  // 3. Face Recognition Loop
  useEffect(() => {
    if (!isOpen || currentStep !== 'face' || faceVerified || attemptError) return;
    let inFlight = false;

    const interval = setInterval(async () => {
      const attempt = attemptRef.current;
      if (inFlight || !videoRef.current || !attempt?.id) return;
      const video = videoRef.current;
      if (video.readyState < 2 || video.videoWidth === 0) return;

      inFlight = true;
      if (!canvasRef.current) canvasRef.current = document.createElement('canvas');
      const c = canvasRef.current;
      const vW = video.videoWidth || 640;
      const vH = video.videoHeight || 480;
      c.width = 360;
      c.height = Math.round((360 / vW) * vH);
      const ctx = c.getContext('2d');
      if (!ctx) { inFlight = false; return; }
      ctx.drawImage(video, 0, 0, c.width, c.height);

      c.toBlob(async (blob) => {
        if (!blob || attemptRef.current !== attempt) { inFlight = false; return; }
        try {
          const res = await fetchWithAuth(`/api/v1/admin/attempts/${attempt.id}/face`, {
            method: 'POST',
            signal: attempt.controller.signal,
            headers: { 'Content-Type': 'image/jpeg' },
            body: blob
          });

          const data = await readJson<{ verified: boolean; name?: string; phrase?: string }>(res);
          if (attemptRef.current === attempt && data.verified && data.phrase) {
            setFaceVerified(true);
            setAdminName(data.name ?? null);
            setChallengePhrase(data.phrase);
            sfx.playDiagnosticBlip(2);
          }
        } catch (error) {
          if (attemptRef.current === attempt) setAttemptError(String(error));
        } finally {
          inFlight = false;
        }
      }, 'image/jpeg', 0.85);
    }, 320);

    return () => {
      clearInterval(interval);
    };
  }, [isOpen, currentStep, faceVerified, attemptError]);

  // 4. Reliable Sequential Transition: Face Verified -> Voice Step
  useEffect(() => {
    if (faceVerified && currentStep === 'face') {
      const timer = setTimeout(() => {
        setCurrentStep('voice');
      }, 700);
      return () => clearTimeout(timer);
    }
  }, [faceVerified, currentStep]);

  // 5. Voice Recording & Real Speaker Biometric Verification
  const handleStartRecording = useCallback(async () => {
    const attempt = attemptRef.current;
    if (!attempt?.id || voiceRecording || voiceStatus !== 'idle') return;
    setVoiceFeedback(null);

    if (!audioStreamRef.current) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (attemptRef.current !== attempt) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        audioStreamRef.current = stream;
        setMicrophoneReady(true);
        setMicrophoneError(null);
      } catch {
        setMicrophoneReady(false);
        setMicrophoneError('Microphone permission is blocked. Allow microphone access for 127.0.0.1, then try again.');
        setVoiceFeedback('Microphone permission is required for administrator verification');
        return;
      }
    }

    try {
      recordedChunksRef.current = [];
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', 'audio/mp4']
        .find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(audioStreamRef.current, mime ? { mimeType: mime } : undefined);

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        if (attemptRef.current !== attempt) return;
        setVoiceRecording(false);
        setVoiceStatus('analyzing');
        const audioBlob = new Blob(recordedChunksRef.current, { type: mime || 'audio/webm' });

        if (audioBlob.size >= 500) {
          try {
            const res = await fetchWithAuth(`/api/v1/admin/attempts/${attempt.id}/voice`, {
              method: 'POST',
              signal: attempt.controller.signal,
              headers: { 'Content-Type': audioBlob.type || 'audio/webm' },
              body: audioBlob
            });

            const data = await readJson<
              { verified: true; grant: string; expires_in_seconds: number; admin: VerifiedAdmin } |
              { verified: false; reason: string }
            >(res);
            if (attemptRef.current !== attempt) return;
            if (data.verified) {
              attempt.completed = true;
              acceptAdminGrant(data.grant, data.expires_in_seconds);
              setSpokenText(challengePhrase);
              setVoiceVerified(true);
              setVoiceStatus('verified');
              setProtocolUnlocked(true);
              setCurrentStep('success');
              onSuccess?.(data.admin);
              speakWithKokoro('Access granted. Administrator verified.', { allowBargeIn: true });
            } else {
              setAccessDenied(true);
              setVoiceStatus('failed');
              setVoiceFeedback(data.reason);
            }
          } catch (error) {
            if (attemptRef.current !== attempt) return;
            setVoiceStatus('failed');
            setVoiceFeedback(`${String(error)} Reopen Admin Protocol to retry.`);
          }
        } else {
          setVoiceStatus('idle');
          setVoiceFeedback('Sample too short; speak clearly closer to microphone');
        }
      };

      recorder.start(100);
      mediaRecorderRef.current = recorder;
      setVoiceRecording(true);
      setVoiceStatus('recording');
      sfx.playDiagnosticBlip(1);

      recordingTimeoutRef.current = setTimeout(() => {
        if (recorder.state === 'recording') {
          recorder.stop();
        }
      }, 6000);
    } catch (e) {
      console.warn('Failed to start MediaRecorder:', e);
      setVoiceStatus('idle');
      setVoiceFeedback('Unable to access the microphone; no access was granted');
    }
  }, [voiceRecording, voiceStatus, challengePhrase, onSuccess]);

  const handleStopRecording = useCallback(() => {
    if (recordingTimeoutRef.current) {
      clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  useEffect(() => {
    if (!isOpen || !protocolUnlocked) return;
    const timer = window.setTimeout(() => {
      close();
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [isOpen, protocolUnlocked, close]);

  // Escape key handler
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [close]);

  if (!isOpen) return null;

  return (
    <div className="admin-auth-backdrop">
      <motion.div
        className={`admin-clean-card ${protocolUnlocked ? 'unlocked' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="oracle-admin-verification-title"
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Top Header */}
        <header className="clean-card-header">
          <div className="clean-header-title-wrap">
            <div className={`clean-lock-badge ${protocolUnlocked ? 'verified' : ''}`}>
              {protocolUnlocked ? (
                <ShieldCheck size={15} strokeWidth={2.2} />
              ) : (
                <Lock size={14} strokeWidth={2.2} />
              )}
            </div>
            <div id="oracle-admin-verification-title" className="clean-header-title">Administrator Verification</div>
          </div>

          <button
            type="button"
            className="clean-close-btn"
            onClick={close}
            title="Close (Esc)"
            aria-label="Close modal"
          >
            <X size={15} />
          </button>
        </header>

        {/* Dynamic Step Body */}
        <div className="clean-card-body">
          {attemptError && <p role="alert" className="text-amber">{attemptError}</p>}
          <AnimatePresence mode="wait">
            {/* STEP 1: PURE FACE CHECK */}
            {currentStep === 'face' && (
              <motion.div
                key="step-face"
                className="clean-step-pane"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18 }}
              >
                {/* Clean Camera Viewport with subtle breathing ring */}
                <div className={`clean-camera-viewport ${faceVerified ? 'verified' : ''}`}>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="clean-video-element"
                  />

                  {/* Translucent Silhouette placeholder before face is seen */}
                  {!faceVerified && (
                    <div className="clean-camera-guide">
                      <div className="clean-guide-oval" />
                    </div>
                  )}

                  {/* Clean Bottom Overlay Pill */}
                  <div className={`clean-id-overlay ${faceVerified ? 'verified' : 'scanning'}`}>
                    {faceVerified ? (
                      <>
                        <Check size={12} strokeWidth={2.5} />
                        <span>{adminName || 'Administrator'} identified</span>
                      </>
                    ) : cameraError ? (
                      <span role="alert">{cameraError}</span>
                    ) : (
                      <span>Looking for administrator face...</span>
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {/* STEP 2: VOICE PASSWORD */}
            {currentStep === 'voice' && (
              <motion.div
                key="step-voice"
                className="clean-step-pane"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18 }}
              >
                {/* Focused Teleprompter & Waveform Box */}
                <div className={`clean-voice-box ${voiceVerified ? 'verified' : voiceRecording ? 'recording' : ''}`}>
                  <div className="clean-voice-tag">State Passphrase to Confirm</div>

                  <div className={`clean-passphrase ${voiceRecording ? 'recording' : voiceVerified ? 'verified' : ''}`}>
                    "{challengePhrase}"
                  </div>

                  <div className="clean-waveform-wrap">
                    <FluidVoiceWaveform
                      isCalibrated={voiceVerified}
                      className={(voiceVolume > 0.04 || voiceRecording) ? 'active-audio' : ''}
                    />
                  </div>

                  <div className="clean-voice-status">
                    {voiceVerified ? (
                      <span className="text-emerald">✓ Voiceprint confirmed: "{spokenText || challengePhrase}"</span>
                    ) : voiceRecording ? (
                      <span className="text-sky">● Listening... speak now</span>
                    ) : accessDenied ? (
                      <div className="admin-access-denied" role="alert">
                        <strong>Access denied</strong>
                        <span>{voiceFeedback}</span>
                      </div>
                    ) : voiceFeedback ? (
                      <span className="text-amber" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                        <AlertCircle size={11} />
                        <span>{voiceFeedback}</span>
                      </span>
                    ) : microphoneError ? (
                      <span className="text-amber">{microphoneError}</span>
                    ) : (
                      <span>{microphoneReady ? 'Microphone ready • State phrase' : 'Click Record Phrase to enable microphone'}</span>
                    )}
                  </div>

                </div>

                {/* Voice Actions */}
                <div className="clean-voice-actions">
                  <button
                    type="button"
                    className={`clean-action-btn ${voiceRecording ? 'is-recording' : ''}`}
                    disabled={!voiceRecording && voiceStatus !== 'idle'}
                    onClick={voiceRecording ? handleStopRecording : handleStartRecording}
                  >
                    <Mic size={13} />
                    <span>{voiceRecording ? 'Finish Speaking' : 'Record Phrase'}</span>
                  </button>

                </div>
              </motion.div>
            )}

            {/* STEP 3: ACCESS GRANTED */}
            {currentStep === 'success' && (
              <motion.div
                key="step-success"
                className="clean-step-pane clean-success-pane"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.18 }}
              >
                <div className="clean-success-icon">
                  <ShieldCheck size={32} className="text-emerald" strokeWidth={2.2} />
                </div>
                <div className="clean-success-title">Identity Verified</div>
                <div className="clean-success-desc">
                  Welcome, <strong>{adminName || 'Administrator'}</strong>
                </div>
                <div className="clean-success-desc">Closing automatically…</div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Minimal Footer */}
        <footer className="clean-card-footer">
          <button
            type="button"
            className="clean-cancel-btn"
            onClick={close}
          >
            Cancel
          </button>

        </footer>
      </motion.div>
    </div>
  );
};
