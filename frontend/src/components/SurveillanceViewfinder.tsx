import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { X, Camera, UserCheck, MoreHorizontal, ShieldCheck, SlidersHorizontal, ChevronDown, Target } from 'lucide-react';
import './SurveillanceViewfinder.css';
import { ObjectRecognitionPanel } from './ObjectRecognitionPanel';
import { soundEffects } from '../utils/audioEffects';
import { fetchWithAuth } from '../utils/api';
import { FaceConfirmation, type FaceObservation } from '../utils/faceTracking';
import { combineSubjects, choosePrimary, type CameraDetection as DetectedObject } from '../utils/personFocus';

// Preset roles for biometric authority & clearance
const ROLE_OPTIONS = [
  { id: 'owner', label: 'Primary Operator (Root Owner)', defaultTitle: 'Primary Operator', rel: 'owner', perm: 'administrator' },
  { id: 'admin', label: 'System Administrator (Alpha-1)', defaultTitle: 'System Administrator', rel: 'colleague', perm: 'administrator' },
  { id: 'family', label: 'Family / Trusted Member', defaultTitle: 'Family Member', rel: 'family', perm: 'standard' },
  { id: 'colleague', label: 'Team / Colleague', defaultTitle: 'Colleague', rel: 'colleague', perm: 'standard' },
  { id: 'guest', label: 'Authorized Guest', defaultTitle: 'Authorized Guest', rel: 'guest', perm: 'standard' },
  { id: 'custom', label: '+ Custom Role / Title...', defaultTitle: '', rel: 'colleague', perm: 'standard' }
] as const;

interface SurveillanceViewfinderProps {
  stream: MediaStream | null;
  isLocked?: boolean;
  onLockComplete?: () => void;
  onClose?: () => void;
  onSnapshot?: (blob: Blob) => void;
  onCameraChange?: (deviceId: string) => Promise<void>;
}

export const SurveillanceViewfinder: React.FC<SurveillanceViewfinderProps> = ({
  stream,
  isLocked = false,
  onLockComplete,
  onClose,
  onSnapshot,
  onCameraChange
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const foregroundCanvas = useRef<HTMLCanvasElement | null>(null);
  const tracks = useRef<DetectedObject[]>([]);
  const [primaryKey, setPrimaryKey] = useState<string | null>(null);
  const [objectDetection, setObjectDetection] = useState(() => localStorage.getItem('oracle_yolo_enabled') !== 'false' && localStorage.getItem('oracle_show_all_objects') !== 'false');
  const nextTrackId = useRef(1);
  const [foregroundMode, setForegroundMode] = useState<'off' | 'people' | 'selected'>('off');
  const [selectedTrack, setSelectedTrack] = useState<number | null>(null);
  const foregroundModeRef = useRef(foregroundMode);
  foregroundModeRef.current = foregroundMode;
  const prevThumbnailRef = useRef<Uint8Array | null>(null);
  const lastAnalyzedTimeRef = useRef<number>(0);
  const motionCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const faceConfirmation = useRef(new FaceConfirmation());
  const lastFaceRead = useRef(0);
  const [people, setPeople] = useState<FaceObservation[]>([]);
  const [objects, setObjects] = useState<DetectedObject[]>([]);
  const processing = useRef(false);
  const activeRequest = useRef<AbortController | null>(null);
  const [canCapture, setCanCapture] = useState(false);
  const [readError, setReadError] = useState('');
  const [, setIsProcessing] = useState(false);
  const [lastLatency, setLastLatency] = useState<number | null>(null);

  // In-Viewfinder 1-Click Face Enrollment state
  const [isEnrollingFace, setIsEnrollingFace] = useState(false);
  const [enrollName, setEnrollName] = useState('');
  const [enrollNotes, setEnrollNotes] = useState('');
  const [selectedRole, setSelectedRole] = useState<'owner' | 'admin' | 'family' | 'colleague' | 'guest' | 'custom'>('owner');
  const [customRoleTitle, setCustomRoleTitle] = useState('');
  const [customIsAdmin, setCustomIsAdmin] = useState(false);
  const [enrollPreviewUrl, setEnrollPreviewUrl] = useState<string | null>(null);
  const [enrollBlob, setEnrollBlob] = useState<Blob | null>(null);
  const [submittingEnroll, setSubmittingEnroll] = useState(false);
  const [enrollMsg, setEnrollMsg] = useState('');

  // Read visual overlays settings
  const [faceTracking, setFaceTracking] = useState(() => localStorage.getItem('oracle_face_reticles') !== 'false');
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [switchingCamera, setSwitchingCamera] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [faceReadState, setFaceReadState] = useState<'checking' | 'ready' | 'error'>('checking');

  // Advanced Camera & Recognition settings (Always in mirror view)
  const isMirrored = true;
  const [showDetails, setShowDetails] = useState(false);

  // Sentry Auto-Lock Tracking
  const lastRecognizedRef = useRef<number>(Date.now());
  const sentryLockedRef = useRef<boolean>(false);

  // Sentry Auto-Lock watchdog loop
  useEffect(() => {
    const sentryEnabled = localStorage.getItem('oracle_sentry_enabled') === 'true';
    if (!sentryEnabled || !stream) return;

    const timeoutSec = Number(localStorage.getItem('oracle_sentry_timeout')) || 60;
    const timeoutMs = timeoutSec * 1000;

    const interval = setInterval(() => {
      const hasRecognizedFace = people.some((p) => p.matched && p.relationship === 'owner' && Date.now() - lastFaceRead.current < 7000);
      if (hasRecognizedFace) {
        lastRecognizedRef.current = Date.now();
        sentryLockedRef.current = false;
      } else {
        const elapsed = Date.now() - lastRecognizedRef.current;
        if (elapsed > timeoutMs && !sentryLockedRef.current) {
          sentryLockedRef.current = true;
          console.warn('Optical Sentry: Operator absence detected. Securing workstation.');
          soundEffects.playAcknowledgeTone();
          fetchWithAuth('/api/v1/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: 'lock workstation' })
          }).catch(() => {});
        }
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [stream, people]);

  // Attach live video stream
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
  }, [stream]);

  useEffect(() => {
    let active = true;
    let revision = 0;
    const refresh = async () => {
      const current = ++revision;
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (active && current === revision) setCameras(devices.filter(device => device.kind === 'videoinput'));
      } catch { if (active) setCameraError('Unable to list cameras. Check camera permissions.'); }
    };
    void refresh();
    navigator.mediaDevices?.addEventListener('devicechange', refresh);
    return () => { active = false; navigator.mediaDevices?.removeEventListener('devicechange', refresh); };
  }, [stream]);

  const changeCamera = async (deviceId: string) => {
    if (!onCameraChange || switchingCamera) return;
    setSwitchingCamera(true);
    setCameraError('');
    try { await onCameraChange(deviceId); }
    catch { setCameraError('Unable to open that camera. Check its connection and permissions, then try again.'); }
    finally { setSwitchingCamera(false); }
  };

  // Periodic optical recognition loop (People Identification + YOLOv8 Detection)
  const processFrame = useCallback(async () => {
    if (!videoRef.current || !stream || processing.current || (!faceTracking && !objectDetection)) return;
    const video = videoRef.current;
    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return;

    // Motion Gate: check 64x48 thumbnail for significant scene changes
    if (!motionCanvasRef.current) {
      motionCanvasRef.current = document.createElement('canvas');
      motionCanvasRef.current.width = 64;
      motionCanvasRef.current.height = 48;
    }
    const mCanvas = motionCanvasRef.current;
    const mCtx = mCanvas.getContext('2d', { willReadFrequently: true });
    let hasMotion = true;
    if (mCtx) {
      mCtx.drawImage(video, 0, 0, 64, 48);
      const imgData = mCtx.getImageData(0, 0, 64, 48).data;
      if (prevThumbnailRef.current) {
        let diff = 0;
        const total = imgData.length;
        for (let i = 0; i < total; i += 4) {
          diff += Math.abs(imgData[i] - prevThumbnailRef.current[i]);
        }
        const avgDiff = diff / (total / 4);
        const timeSinceLast = performance.now() - lastAnalyzedTimeRef.current;
        if (avgDiff < 3.0 && timeSinceLast < 800) {
          hasMotion = false;
        }
      }
      prevThumbnailRef.current = new Uint8Array(imgData);
    }

    if (!hasMotion) return;
    lastAnalyzedTimeRef.current = performance.now();

    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
    }
    const canvas = canvasRef.current;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    canvas.width = vw;
    canvas.height = vh;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, vw, vh);

    processing.current = true;
    setIsProcessing(true);
    const controller = new AbortController();
    activeRequest.current = controller;
    const t0 = performance.now();

    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
      if (!blob) return;

      // 1. Face Identification (YuNet + SFace)
      if (faceTracking) try {
        const configuredThreshold = Number(localStorage.getItem('oracle_face_threshold'));
        const threshold = Number.isFinite(configuredThreshold) ? Math.min(1, Math.max(0.363, configuredThreshold)) : 0.363;
        const res = await fetchWithAuth(`/api/v1/people/identify?threshold=${threshold}`, {
          method: 'POST',
          headers: { 'Content-Type': 'image/jpeg' },
          body: blob,
          signal: controller.signal
        });
        if (res.ok) {
          const data = await res.json();
          if (!controller.signal.aborted) {
            setFaceReadState('ready');
            lastFaceRead.current = Date.now();
            const rawFaces: FaceObservation[] = (data.identified || []).filter((p: FaceObservation) => Array.isArray(p.box) && p.box.length === 4 && p.box.every(Number.isFinite));
            const nextFaces = faceConfirmation.current.update(rawFaces, lastFaceRead.current);
            setPeople(nextFaces);
          }
        } else if (!controller.signal.aborted) {
          faceConfirmation.current.reset();
          setPeople([]);
          setFaceReadState('error');
        }
      } catch {
        if (!controller.signal.aborted) {
          faceConfirmation.current.reset();
          setPeople([]);
          setFaceReadState('error');
        }
      }

      // 2. Object Detection (YOLOv8n ONNX)
      if (objectDetection) try {
        const res = await fetchWithAuth(`/api/v1/vision/detect?segment=${foregroundModeRef.current !== 'off'}&confidence=0.25`, {
          method: 'POST',
          headers: { 'Content-Type': 'image/jpeg' },
          body: blob,
          signal: controller.signal
        });
        if (res.ok) {
          const data = await res.json();
          const rawList = data.detections || [];
          const normalized: DetectedObject[] = rawList.filter((d: any) => typeof (d.class || d.class_name) === 'string' && Number.isFinite(d.confidence) && Array.isArray(d.box) && d.box.length === 4 && d.box.every(Number.isFinite));
          const available = new Set(tracks.current);
          const tracked = normalized.map((d) => {
            let match: DetectedObject | undefined;
            let best = 0.25;
            for (const previous of available) {
              if (previous.class !== d.class) continue;
              const [x, y, w, h] = d.box;
              const [px, py, pw, ph] = previous.box;
              const intersection = Math.max(0, Math.min(x + w, px + pw) - Math.max(x, px)) * Math.max(0, Math.min(y + h, py + ph) - Math.max(y, py));
              const iou = intersection / (w * h + pw * ph - intersection);
              if (iou > best) { best = iou; match = previous; }
            }
            if (match) available.delete(match);
            const box = match && !d.mask ? d.box.map((v, i) => Math.round(v * 0.8 + match!.box[i] * 0.2)) as DetectedObject['box'] : d.box;
            return { ...d, box, trackId: match?.trackId ?? nextTrackId.current++ };
          });
          if (!controller.signal.aborted) {
            tracks.current = tracked;
            setObjects(tracked);
            setReadError('');
          }
        } else if (!controller.signal.aborted) {
          setReadError(`Vision request failed (${res.status}).`);
          tracks.current = [];
          setObjects([]);
        }
      } catch {
        if (!controller.signal.aborted) {
          setReadError('Vision connection unavailable.');
          tracks.current = [];
          setObjects([]);
        }
      }

      if (!controller.signal.aborted) {
        setLastLatency(Math.round(performance.now() - t0));
      }
    } catch {
      // ignore
    } finally {
      if (activeRequest.current === controller) processing.current = false;
      if (!controller.signal.aborted) {
        setIsProcessing(false);
      }
    }
  }, [stream, faceTracking, objectDetection]);

  useEffect(() => {
    faceConfirmation.current.reset();
    lastFaceRead.current = 0;
    setFaceReadState('checking');
    setCanCapture(false);
    setReadError('');
    setIsProcessing(false);
    tracks.current = [];
    setObjects([]);
    setPeople([]);
    setSelectedTrack(null);
    prevThumbnailRef.current = null;
    lastAnalyzedTimeRef.current = 0;
  }, [stream]);

  useEffect(() => {
    lastAnalyzedTimeRef.current = 0;
  }, [foregroundMode]);

  useEffect(() => {
    const canvas = foregroundCanvas.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const subjects = objects.filter((o) => o.mask && (foregroundMode === 'people' ? o.class === 'person' : foregroundMode === 'selected' && o.trackId === selectedTrack));
    if (!subjects.length || foregroundMode === 'off') return;
    let cancelled = false;
    Promise.all(subjects.map(async (o) => {
      const img = new Image();
      img.src = o.mask!;
      await img.decode();
      return { o, img };
    })).then((images) => {
      if (cancelled) return;
      ctx.fillStyle = 'rgba(0,0,0,0.72)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'destination-out';
      for (const { o, img } of images) ctx.drawImage(img, ...o.box);
      ctx.globalCompositeOperation = 'source-over';
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [objects, foregroundMode, selectedTrack, stream]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (lastFaceRead.current && Date.now() - lastFaceRead.current >= 7000) {
        setPeople([]);
        setFaceReadState('checking');
        faceConfirmation.current.reset();
        lastFaceRead.current = 0;
      }
    }, 500);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    faceConfirmation.current.reset();
    lastFaceRead.current = 0;
    setPeople([]);
    setFaceReadState('checking');
    prevThumbnailRef.current = null;
    lastAnalyzedTimeRef.current = 0;
  }, [faceTracking]);

  useEffect(() => {
    tracks.current = [];
    setObjects([]);
    lastAnalyzedTimeRef.current = 0;
    setReadError('');
  }, [objectDetection]);

  // Start 1-Click Face Enrollment
  const startEnrollment = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    if (video.readyState < 2 || !video.videoWidth) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob((blob) => {
      if (blob) {
        setEnrollBlob(blob);
        setEnrollPreviewUrl(URL.createObjectURL(blob));
        setIsEnrollingFace(true);
        setEnrollMsg('');
      }
    }, 'image/jpeg', 0.95);
  };

  // Submit enrollment
  const submitEnrollment = async () => {
    if (!enrollName.trim()) {
      setEnrollMsg('Enter a name.');
      return;
    }
    if (!enrollBlob) {
      setEnrollMsg('Missing face image.');
      return;
    }

    setSubmittingEnroll(true);
    setEnrollMsg('Analyzing face & committing SFace embedding...');
    try {
      const roleConfig = ROLE_OPTIONS.find((r) => r.id === selectedRole) || ROLE_OPTIONS[0];
      const roleTitle = selectedRole === 'custom'
        ? (customRoleTitle.trim() || 'Custom Role')
        : roleConfig.defaultTitle;
      const finalNotes = enrollNotes.trim()
        ? `${roleTitle} • ${enrollNotes.trim()}`
        : roleTitle;
      const relationship = selectedRole === 'custom' ? 'colleague' : roleConfig.rel;
      const permission = selectedRole === 'custom'
        ? (customIsAdmin ? 'administrator' : 'standard')
        : roleConfig.perm;

      const params = new URLSearchParams({
        name: enrollName.trim(),
        notes: finalNotes
      });
      const res = await fetchWithAuth(`/api/v1/people/enroll?${params.toString()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg' },
        body: enrollBlob
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Enrollment failed');
      }

      soundEffects.playWakeChime();
      const saved = await res.json();

      if (saved.id) {
        try {
          await fetchWithAuth(`/api/v1/people/${saved.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              relationship,
              permission,
              notes: finalNotes
            })
          });
        } catch (patchErr) {
          console.warn('Failed to update person clearance attributes:', patchErr);
        }
      }

      setEnrollMsg('Asset registered successfully!');
      setTimeout(() => {
        setIsEnrollingFace(false);
        setEnrollPreviewUrl(null);
        setEnrollBlob(null);
        setEnrollName('');
        setEnrollNotes('');
        setSelectedRole('owner');
        setCustomRoleTitle('');
        setCustomIsAdmin(false);
        processFrame();
      }, 700);
    } catch (err) {
      setEnrollMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSubmittingEnroll(false);
    }
  };

  // Run recognition loop every 1.5 seconds while stream is active
  useEffect(() => {
    if (!stream) return;
    const interval = setInterval(processFrame, 500);
    return () => {
      clearInterval(interval);
      activeRequest.current?.abort();
      processing.current = false;
    };
  }, [stream, processFrame]);

  // Guaranteed lock handoff for boot sequence
  const onLockCompleteRef = useRef(onLockComplete);
  onLockCompleteRef.current = onLockComplete;
  const lockFiredRef = useRef(false);

  useEffect(() => {
    if (isLocked && !lockFiredRef.current) {
      lockFiredRef.current = true;
      const timer = setTimeout(() => {
        onLockCompleteRef.current?.();
      }, 700);
      return () => clearTimeout(timer);
    }
  }, [isLocked]);

  // Take current freeze frame and hand off to parent
  const handleSnap = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    if (video.readyState < 2 || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 2000 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (blob && onSnapshot) {
        onSnapshot(blob);
      }
    }, 'image/jpeg', 0.9);
  };

  const subjects = combineSubjects(objects, people);
  const effectivePrimaryKey = choosePrimary(subjects, primaryKey);
  const primarySubject = subjects.find((subject) => subject.key === effectivePrimaryKey);
  const primaryFace = primarySubject?.face;





  useEffect(() => {
    setPrimaryKey((current) => choosePrimary(combineSubjects(objects, people), current));
  }, [objects, people]);

  const vw = videoRef.current?.videoWidth || 640;
  const vh = videoRef.current?.videoHeight || 480;

  return (
    <motion.div
      className="oracle-diag-card oracle-camera-card"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1, transition: { duration: 0.25, ease: 'easeOut' } }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.2, ease: 'easeIn' } }}
    >
      {/* 1. Header Strip matching Homepage Diagnostic Cards */}
      <div className="card-header-strip">
        <span className="card-section-tag">
          <Camera size={13} strokeWidth={1.8} style={{ color: 'var(--accent)' }} />
          Camera
        </span>
        <div className="card-header-actions">
          <span className="card-status-badge">
            <span className="card-status-dot" style={{ background: readError ? '#ef4444' : canCapture ? '#22c55e' : '#94a3b8' }} />
            {readError ? 'Error' : canCapture ? 'Live' : 'Connecting…'}
          </span>
          <button type="button" className="card-header-icon-btn" aria-label="Camera settings" aria-expanded={showDetails} aria-controls="camera-settings" onClick={() => setShowDetails(!showDetails)}>
            <MoreHorizontal size={18} />
          </button>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="card-header-icon-btn"
              title="Close Camera Feed"
              aria-label="Close Camera Feed"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* 3. Inset Framed Viewport */}
      <div className="camera-viewport-frame" style={{ aspectRatio: `${vw} / ${vh}` }}>
        <video
          ref={videoRef}
          onLoadedData={() => setCanCapture(true)}
          playsInline
          muted
          className="cctv-video-stream"
          style={{ transform: isMirrored ? 'scaleX(-1)' : 'none' }}
        />
        <canvas
          ref={foregroundCanvas}
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            transform: isMirrored ? 'scaleX(-1)' : 'none'
          }}
        />
        {/* Reticles & Bounding Boxes (Person of Interest Machine HUD) */}
        {faceTracking && subjects.filter(subject => subject.face).map((subject) => {
          const outlineBox = subject.face?.box;
          if (!outlineBox) return null;
          const [x, y, w, h] = outlineBox;
          const isFace = true;
          const padX = isFace ? w * 0.16 : 0;
          const padY = isFace ? h * 0.20 : 0;
          const framedX = Math.max(0, x - padX);
          const framedY = Math.max(0, y - padY * 1.15);
          const framedW = Math.min(vw - framedX, w + padX * 2);
          const framedH = Math.min(vh - framedY, h + padY * 2.2);
          const left = isMirrored ? vw - framedX - framedW : framedX;

          const subjectIsMatched = !!subject.face?.matched;
          const reticleColor = subjectIsMatched ? '#4ade80' : subject.key === effectivePrimaryKey ? '#38bdf8' : 'rgba(157, 180, 211, 0.65)';

          return (
            <div
              key={subject.key}
              data-subject={subject.key}
              aria-hidden="true"
              className="poi-target-container"
              style={{
                left: `${(left / vw) * 100}%`,
                top: `${(framedY / vh) * 100}%`,
                width: `${(framedW / vw) * 100}%`,
                height: `${(framedH / vh) * 100}%`
              }}
            >
              {/* Minimalist Floating Name Badge */}
              <div
                className="live-detection-name-badge"
                style={{
                  top: framedY / vh > 0.12 ? '-28px' : '4px',
                  left: left > vw / 2 ? 'auto' : '0',
                  right: left > vw / 2 ? '0' : 'auto',
                  maxWidth: `calc(${(left > vw / 2 ? (left + framedW) / vw : (vw - left) / vw) * 100}cqw - 8px)`,
                  borderColor: reticleColor,
                  color: reticleColor,
                  boxShadow: `0 0 14px ${reticleColor}33`
                }}
              >
                <span className="live-name-dot" style={{ background: reticleColor }} />
                <span className="live-name-text">
                  {subjectIsMatched
                    ? subject.face?.name
                    : subject.face
                    ? (subject.face.recognition_state === 'confirming' ? 'Identifying…' : 'Unidentified')
                    : '• SUBJECT'}
                </span>
              </div>
            </div>
          );
        })}

        {objectDetection && objects.filter((obj) => (obj.class || obj.class_name) !== 'person').map((obj) => {
          const [x, y, w, h] = obj.box;
          const left = isMirrored ? vw - x - w : x;
          const label = String(obj.class || obj.class_name || 'Object').toUpperCase();
          const conf = Math.round((obj.confidence || 0) * 100);
          return (
            <div
              key={`object-${obj.trackId}`}
              className="camera-object-outline"
              aria-hidden="true"
              style={{ left: `${left / vw * 100}%`, top: `${y / vh * 100}%`, width: `${w / vw * 100}%`, height: `${h / vh * 100}%` }}
            >
              <div className="object-label-pill">
                <span className="object-label-dot" />
                <span className="object-label-text">{label}</span>
                {conf > 0 && <span className="object-label-conf">{conf}%</span>}
              </div>
            </div>
          );
        })}

        {/* In-Viewfinder Face Enrollment Overlay */}
        {isEnrollingFace && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(10, 13, 18, 0.88)',
              zIndex: 50,
              display: 'flex',
              flexDirection: 'column',
              padding: '16px',
              justifyContent: 'center',
              alignItems: 'center',
              backdropFilter: 'blur(20px)'
            }}
          >
            <div
              style={{
                width: '100%',
                maxWidth: '280px',
                background: 'rgba(15, 18, 24, 0.95)',
                border: '1px solid rgba(232, 235, 239, 0.08)',
                borderRadius: '12px',
                boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(232, 235, 239, 0.04)',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '10.5px', fontWeight: 600, color: 'var(--accent)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  Enroll Face Biometrics
                </span>
                <button
                  onClick={() => setIsEnrollingFace(false)}
                  style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
                >
                  <X size={14} />
                </button>
              </div>

              {enrollPreviewUrl && (
                <img
                  src={enrollPreviewUrl}
                  alt="Captured face"
                  style={{ width: '64px', height: '64px', objectFit: 'cover', borderRadius: '8px', alignSelf: 'center', border: '1px solid rgba(232, 235, 239, 0.1)' }}
                />
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <label style={{ fontSize: '8px', fontFamily: "'JetBrains Mono', monospace", color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Operator Name *
                </label>
                <input
                  type="text"
                  placeholder="e.g. Sahan"
                  value={enrollName}
                  autoFocus
                  onChange={(e) => setEnrollName(e.target.value)}
                  style={{
                    background: 'rgba(232, 235, 239, 0.04)',
                    border: '1px solid rgba(232, 235, 239, 0.08)',
                    borderRadius: '6px',
                    padding: '6px 10px',
                    color: '#ffffff',
                    fontSize: '11px',
                    fontFamily: 'Inter, sans-serif',
                    outline: 'none'
                  }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <label style={{ fontSize: '8px', fontFamily: "'JetBrains Mono', monospace", color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Clearance Role *
                </label>
                <select
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value as any)}
                  style={{
                    background: 'rgba(232, 235, 239, 0.04)',
                    border: '1px solid rgba(232, 235, 239, 0.08)',
                    borderRadius: '6px',
                    padding: '6px 8px',
                    color: '#ffffff',
                    fontSize: '10.5px',
                    fontFamily: 'Inter, sans-serif',
                    outline: 'none',
                    cursor: 'pointer'
                  }}
                >
                  {ROLE_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id} style={{ background: '#0e1117', color: opt.id === 'custom' ? '#9db4d3' : '#ffffff' }}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {selectedRole === 'custom' && (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    padding: '8px',
                    background: 'rgba(157, 180, 211, 0.04)',
                    border: '1px solid rgba(157, 180, 211, 0.2)',
                    borderRadius: '6px'
                  }}
                >
                  <label style={{ fontSize: '8px', fontFamily: "'JetBrains Mono', monospace", color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Custom Role Title *
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Lead Architect, Security Officer"
                    value={customRoleTitle}
                    onChange={(e) => setCustomRoleTitle(e.target.value)}
                    style={{
                      background: 'rgba(232, 235, 239, 0.04)',
                      border: '1px solid rgba(157, 180, 211, 0.3)',
                      borderRadius: '5px',
                      padding: '5px 8px',
                      color: '#ffffff',
                      fontSize: '10.5px',
                      fontFamily: 'Inter, sans-serif',
                      outline: 'none'
                    }}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '2px' }}>
                    <span style={{ fontSize: '9px', color: 'var(--muted)' }}>Alpha-1 Admin</span>
                    <input
                      type="checkbox"
                      checked={customIsAdmin}
                      onChange={(e) => setCustomIsAdmin(e.target.checked)}
                      style={{ cursor: 'pointer', accentColor: '#4ade80' }}
                    />
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <label style={{ fontSize: '8px', fontFamily: "'JetBrains Mono', monospace", color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Clearance Notes (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Zone A access"
                  value={enrollNotes}
                  onChange={(e) => setEnrollNotes(e.target.value)}
                  style={{
                    background: 'rgba(232, 235, 239, 0.04)',
                    border: '1px solid rgba(232, 235, 239, 0.08)',
                    borderRadius: '6px',
                    padding: '6px 10px',
                    color: '#ffffff',
                    fontSize: '11px',
                    fontFamily: 'Inter, sans-serif',
                    outline: 'none'
                  }}
                />
              </div>

              {enrollMsg && (
                <span style={{ fontSize: '10px', color: enrollMsg.includes('Error') ? '#f87171' : '#4ade80' }}>
                  {enrollMsg}
                </span>
              )}

              <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                <button
                  type="button"
                  onClick={submitEnrollment}
                  disabled={submittingEnroll}
                  className="oracle-btn oracle-btn-primary"
                  style={{ flex: 1 }}
                >
                  <ShieldCheck size={13} strokeWidth={2} />
                  <span>{submittingEnroll ? 'SAVING...' : 'COMMIT BIOMETRICS'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsEnrollingFace(false)}
                  className="oracle-btn oracle-btn-secondary"
                >
                  CANCEL
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {faceTracking && faceReadState === 'error' && (
        <div className="camera-error-message" role="status">Face recognition unavailable</div>
      )}

      {showDetails && <div id="camera-settings" className="camera-settings">
        <div className="camera-settings-heading">Camera settings</div>
        {onCameraChange && <label className="camera-device-select">
          <span>Camera source</span>
          <select aria-label="Select camera" value={stream?.getVideoTracks()[0]?.getSettings().deviceId || ''} disabled={switchingCamera || cameras.length === 0} onChange={event => void changeCamera(event.target.value)}>
            <option value="" disabled>Select a camera</option>
            {cameras.map((camera, index) => <option key={camera.deviceId} value={camera.deviceId}>{camera.label || `Camera ${index + 1}`}</option>)}
          </select>
        </label>}
        {switchingCamera && <p role="status" className="camera-settings-meta">Switching camera…</p>}
        {cameraError && <p role="alert" className="camera-error-message">{cameraError}</p>}
        <label className="camera-tracking-toggle">
          <input type="checkbox" checked={faceTracking} onChange={event => {setFaceTracking(event.target.checked); localStorage.setItem('oracle_face_reticles', String(event.target.checked));}} />
          <span>Face detection</span>
        </label>

        <label className="camera-tracking-toggle">
          <input type="checkbox" checked={objectDetection} onChange={event => {
            setObjectDetection(event.target.checked);
            localStorage.setItem('oracle_yolo_enabled', String(event.target.checked));
            localStorage.setItem('oracle_show_all_objects', String(event.target.checked));
            if (!event.target.checked) setForegroundMode('off');
          }} />
          <span>Object detection</span>
        </label>

        <details className="camera-advanced-settings">
          <summary>Advanced settings</summary>
        {lastLatency !== null && <p className="camera-settings-meta">Processing latency: {lastLatency} ms</p>}
      {/* 5. Clean Standardized Secondary Toolbar */}
      <div className="camera-toolbar-row">


        <div className="oracle-select-capsule">
          <SlidersHorizontal size={11} strokeWidth={1.8} style={{ color: 'var(--accent)' }} />
          <span className="select-label">Foreground</span>
          <select
            aria-label="Foreground"
            value={foregroundMode}
            disabled={!objectDetection}
            onChange={(e) => setForegroundMode(e.target.value as typeof foregroundMode)}
          >
            <option value="off">Off</option>
            <option value="people">People</option>
            <option value="selected">Selected</option>
          </select>
          <ChevronDown size={10} className="select-chevron" />
        </div>

        {foregroundMode === 'selected' && (
          <div className="oracle-select-capsule">
            <span className="select-label">Subject</span>
            <select
              aria-label="Subject"
              value={selectedTrack ?? ''}
              onChange={(e) => setSelectedTrack(Number(e.target.value))}
            >
              <option value="" disabled>Choose object</option>
              {objects.map((o) => {
                const face = subjects.find((s) => s.body?.trackId === o.trackId)?.face;
                return (
                  <option key={o.trackId} value={o.trackId}>
                    {face?.matched ? face.name : o.class === 'person' ? 'Unrecognized person' : `${o.class} #${o.trackId}`}
                  </option>
                );
              })}
            </select>
            <ChevronDown size={10} className="select-chevron" />
          </div>
        )}

        {subjects.length > 1 && (
          <div className="oracle-select-capsule">
            <Target size={11} strokeWidth={1.8} style={{ color: 'var(--accent)' }} />
            <span className="select-label">Focus</span>
            <select
              aria-label="Focus person"
              value={effectivePrimaryKey || ''}
              onChange={(e) => setPrimaryKey(e.target.value)}
            >
              {subjects.map((subject, i) => (
                <option key={subject.key} value={subject.key}>
                  {subject.face?.matched ? subject.face.name : `Person ${i + 1}`}
                </option>
              ))}
            </select>
            <ChevronDown size={10} className="select-chevron" />
          </div>
        )}


      </div>

      {foregroundMode !== 'off' && <span role="status" className="camera-focus-reason">{objects.some(o=>o.mask && (foregroundMode==='people'?o.class==='person':o.trackId===selectedTrack))?'Foreground isolated':'Waiting for subject'}</span>}

      {/* 6. Expandable Diagnostics (includes Object Recognition) */}
      {showDetails && (
        <motion.div
          className="camera-details-drawer"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2 }}
        >
          {primaryFace && (
            <div className="camera-biometric-details">
              <div className="detail-row">
                <span>Recognition</span>
                <strong>{primaryFace.recognition_state.replaceAll('_', ' ').toUpperCase()}</strong>
              </div>
              <div className="detail-row">
                <span>Similarity</span>
                <strong>{typeof primaryFace.cosine_score === 'number' ? primaryFace.cosine_score.toFixed(3) : 'N/A'}</strong>
              </div>
              {primaryFace.relationship && (
                <div className="detail-row">
                  <span>Relationship</span>
                  <strong>{primaryFace.relationship.toUpperCase()}</strong>
                </div>
              )}
              {primaryFace.notes && (
                <div className="detail-row">
                  <span>Notes</span>
                  <strong>{primaryFace.notes}</strong>
                </div>
              )}
            </div>
          )}
        </motion.div>
      )}

      {objectDetection && <ObjectRecognitionPanel video={videoRef} stream={stream} paused={isEnrollingFace} showControls={showDetails} />}
        </details>
      <button type="button" onClick={startEnrollment} disabled={!canCapture} className="camera-footer-btn">
        <UserCheck size={16} /><span>Enroll face</span>
      </button>
      </div>}

      {/* 7. Footer Action Strip */}
      <div className="camera-card-footer">
        <div className="camera-footer-actions">
          {onSnapshot && (
            <button
              type="button"
              onClick={handleSnap}
              disabled={!canCapture}
              className="camera-footer-btn primary"
              title="Capture the current frame and ask about it"
            >
              <Camera size={13} strokeWidth={1.8} />
              <span>Capture &amp; ask</span>
            </button>
          )}

        </div>
      </div>
    </motion.div>
  );
};
