import React, { useState, useEffect, useEffectEvent, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { createPortal } from 'react-dom';
import { Shield, ShieldCheck, Heart, Users, UserRound, Flag } from 'lucide-react';
import { X, Camera, SlidersHorizontal, ChevronDown, Target, QrCode, ExternalLink, Copy, Check, FileText, Maximize2, Minimize2, ScanLine } from 'lucide-react';
import './SurveillanceViewfinder.css';
import { soundEffects } from '../utils/audioEffects';
import { speakWithKokoro } from '../utils/voice';
import { fetchWithAuth } from '../utils/api';
import { setCurrentUser } from '../utils/currentUser';
import { FaceConfirmation, type FaceObservation } from '../utils/faceTracking';
import { ObjectConfirmation, type ObjectObservation } from '../utils/objectTracking';
import { combineSubjects, choosePrimary, type CameraDetection as DetectedObject } from '../utils/personFocus';
import { ProductIntelligencePanel } from './ProductIntelligencePanel';
import { UnknownItemTracking, trackingWidth, trackingHeight } from '../utils/unknownItemTracking';

function cameraProfileRole(face: FaceObservation) {
  switch (face.relationship) {
    case 'owner': return 'Primary Operator';
    case 'family': return 'Family Member';
    case 'friend': return 'Friend';
    case 'guest': return 'Authorized Guest';
    case 'colleague': {
      // Enrollment stores the role title before the optional notes separator.
      const title = face.notes?.split(' • ', 1)[0]?.trim();
      return title || (face.permission === 'administrator' ? 'System Administrator' : 'Colleague');
    }
    default: return 'Recognized profile';
  }
}

interface SurveillanceViewfinderProps {
  stream: MediaStream | null;
  advancedSettingsHost?: HTMLDivElement | null;
  isLocked?: boolean;
  onLockComplete?: () => void;
  onClose?: () => void;
  onSnapshot?: (blob: Blob) => void;
  onSaveUnknownSnapshot?: (blob: Blob, unknownId: string) => Promise<boolean>;
  onCameraChange?: (deviceId: string) => Promise<void>;
}

export const SurveillanceViewfinder: React.FC<SurveillanceViewfinderProps> = ({
  stream,
  advancedSettingsHost,
  isLocked = false,
  onLockComplete,
  onClose,
  onSnapshot,
  onSaveUnknownSnapshot,
  onCameraChange
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [identityReview, setIdentityReview] = useState<{ face: FaceObservation; seen: number; reason: string | null } | null>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const detailsButton = useRef<HTMLButtonElement>(null);
  const collapse = useCallback(() => {
    setExpanded(false);
    expandButton.current?.focus();
  }, []);
  const hideDetails = () => {
    setDetailsOpen(false);
    detailsButton.current?.focus();
  };
  useEffect(() => {
    const command = (event: Event) => {
      const action = (event as CustomEvent<string>).detail;
      if (action === 'expand') { setExpanded(true); setDetailsOpen(true); }
      else if (action === 'collapse') { if (expanded) collapse(); }
      else if (action === 'show') setDetailsOpen(true);
      else if (action === 'hide') hideDetails();
      else return;
      event.preventDefault();
    };
    const escape = (event: KeyboardEvent) => {
      if (!expanded || event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      collapse();
    };
    window.addEventListener('oracle_camera_command', command);
    window.addEventListener('keydown', escape, true);
    return () => {
      window.removeEventListener('oracle_camera_command', command);
      window.removeEventListener('keydown', escape, true);
    };
  }, [collapse, expanded]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastObjectFrame = useRef<number | null>(null);
  const foregroundCanvas = useRef<HTMLCanvasElement | null>(null);
  const tracks = useRef<DetectedObject[]>([]);
  const lastObjectRead = useRef(0);
  const objectConfirmation = useRef(new ObjectConfirmation<DetectedObject & ObjectObservation>(0.35, 3000, 2));
  const [primaryKey, setPrimaryKey] = useState<string | null>(null);
  const [objectDetection, setObjectDetection] = useState(() => localStorage.getItem('oracle_yolo_enabled') !== 'false' && localStorage.getItem('oracle_show_all_objects') !== 'false');
  const nextTrackId = useRef(1);
  const [foregroundMode, setForegroundMode] = useState<'off' | 'people' | 'selected'>('off');
  const [selectedTrack, setSelectedTrack] = useState<number | null>(null);
  const foregroundModeRef = useRef(foregroundMode);
  foregroundModeRef.current = foregroundMode;
  const prevThumbnailRef = useRef<Uint8ClampedArray | null>(null);
  const lastAnalyzedTimeRef = useRef<number>(0);
  const motionCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const faceConfirmation = useRef(new FaceConfirmation());
  const lastFaceRead = useRef(0);
  const lastGreetedPerson = useRef<string | null>(null);
  const lastGreetedTime = useRef(0);
  const [people, setPeople] = useState<FaceObservation[]>([]);
  useEffect(() => {
    const held = people.filter(face => face.held);
    if (!held.length) return;
    const expiry = Math.min(...held.map(face => (face.lastSeen ?? 0) + 450));
    const timer = window.setTimeout(() => {
      setPeople(current => current.filter(face => !face.held || (face.lastSeen ?? 0) + 450 > Date.now()));
    }, Math.max(0, expiry - Date.now()));
    return () => window.clearTimeout(timer);
  }, [people]);
  const lastUnknownAutoSave = useRef(0);
  const savedUnknownTracks = useRef(new Set<number>());
  const [objects, setObjects] = useState<DetectedObject[]>([]);
  const rawFaceBoxesRef = useRef<[number, number, number, number][]>([]);
  const rawFaceTimeRef = useRef(0);
  const processing = useRef(false);
  const activeRequest = useRef<AbortController | null>(null);
  const [canCapture, setCanCapture] = useState(false);
  const [frameSize, setFrameSize] = useState({ width: 640, height: 480 });
  const [snapshotPending, setSnapshotPending] = useState(false);
  const syncFrameSize = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    const { videoWidth, videoHeight } = event.currentTarget;
    if (videoWidth && videoHeight) setFrameSize({ width: videoWidth, height: videoHeight });
  };
  const [lastLatency, setLastLatency] = useState<number | null>(null);

  // Read visual overlays settings
  const [faceTracking, setFaceTracking] = useState(() => localStorage.getItem('oracle_face_reticles') !== 'false');
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [switchingCamera, setSwitchingCamera] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [faceReadState, setFaceReadState] = useState<'checking' | 'ready' | 'error'>('checking');

  // Live QR Code Detection & Action State
  interface DetectedQR {
    payload: string;
    is_url: boolean;
    url?: string | null;
    box?: [number, number, number, number] | null;
    lastSeen: number;
  }
  const [detectedQR, setDetectedQR] = useState<DetectedQR | null>(null);
  const [qrBannerDismissed, setQrBannerDismissed] = useState<string | null>(null);
  const [qrCopied, setQrCopied] = useState(false);
  const [qrSaved, setQrSaved] = useState(false);
  const [qrSaving, setQrSaving] = useState(false);
  const [qrDetection, setQrDetection] = useState(() => localStorage.getItem('oracle_qr_detection') !== 'false');
  const qrScanningBusy = useRef(false);
  const lastQrCheckTime = useRef(0);

  // Advanced Camera & Recognition settings
  const [isMirrored, setIsMirrored] = useState(
    () => localStorage.getItem('oracle_camera_mirrored') !== 'false'
  );
  const [autoIdentifyProducts, setAutoIdentifyProducts] = useState(true);
  const [productTrack, setProductTrack] = useState<number | null>(null);
  const [scanGuidance, setScanGuidance] = useState('');
  const [showCameraControls, setShowCameraControls] = useState(false);

  useEffect(() => {
    const handleMirrorChange = (event: Event) => {
      const detail = (event as CustomEvent<boolean>).detail;
      if (typeof detail === 'boolean') setIsMirrored(detail);
    };
    window.addEventListener('oracle_camera_mirror_changed', handleMirrorChange);
    return () => window.removeEventListener('oracle_camera_mirror_changed', handleMirrorChange);
  }, []);

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
      const hasRecognizedFace = people.some((p) => !p.held && p.matched && p.relationship === 'owner' && Date.now() - lastFaceRead.current < 7000);
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

  // Face localization runs independently so object inference cannot delay it.
  useEffect(() => {
    if (!stream || !faceTracking) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | null = null;
    const canvas = document.createElement('canvas');
    const readFace = async () => {
      const started = performance.now();
      const video = videoRef.current;
      if (video && video.readyState >= 2 && video.videoWidth && video.videoHeight) {
        controller = new AbortController();
        const timeout = setTimeout(() => controller?.abort(), 2000);
        try {
          if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
          if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
          canvas.getContext('2d')?.drawImage(video, 0, 0);
          const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
          if (blob && !stopped && !controller.signal.aborted) {
            // 1. Face Identification (YuNet + SFace)
            try {
              const configuredThreshold = Number(localStorage.getItem('oracle_face_threshold'));
              const threshold = Number.isFinite(configuredThreshold) ? Math.min(1, Math.max(0.363, configuredThreshold)) : 0.363;
              const res = await fetchWithAuth(`/api/v1/people/identify?threshold=${threshold}&public_figures=true`, {
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
                  rawFaceBoxesRef.current = rawFaces.map(f => f.box);
                  rawFaceTimeRef.current = Date.now();
                  const nextFaces = faceConfirmation.current.update(rawFaces, lastFaceRead.current);
                  setPeople(nextFaces);

                  // Arrival Voice Greeting upon recognized operator
                  const matchedFace = nextFaces.find(f => !f.held && f.matched && f.name && f.recognition_state === 'confirmed');
                  if (matchedFace) {
                    if (matchedFace.id && matchedFace.name) {
                      setCurrentUser({
                        id: matchedFace.id,
                        name: matchedFace.name,
                        permission: matchedFace.permission === 'administrator' ? 'administrator' : 'standard'
                      });
                    }
                    const greetEnabled = localStorage.getItem('oracle_greet_operator') !== 'false';
                    const now = Date.now();
                    const personKey = matchedFace.id || matchedFace.name;
                    if (greetEnabled && (lastGreetedPerson.current !== personKey || now - lastGreetedTime.current > 300000)) {
                      lastGreetedPerson.current = personKey;
                      lastGreetedTime.current = now;
                      void speakWithKokoro(`Welcome back, ${matchedFace.name}.`, { allowBargeIn: false });
                    }
                  }
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
          }
        } catch {
          if (!stopped) {
            faceConfirmation.current.reset();
            setPeople([]);
            setFaceReadState('error');
          }
        } finally {
          clearTimeout(timeout);
          if (!stopped && controller.signal.aborted) {
            faceConfirmation.current.reset();
            setPeople([]);
            setFaceReadState('checking');
          }
        }
      }
      if (!stopped) timer = setTimeout(() => void readFace(), Math.max(0, 120 - (performance.now() - started)));
    };
    void readFace();
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
  }, [stream, faceTracking]);

  // Continuous live QR code detection loop (hardware native BarcodeDetector with backend fallback)
  useEffect(() => {
    setDetectedQR(null);
    if (!stream || !qrDetection) return;
    const request = new AbortController();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const fallbackCanvas = document.createElement('canvas');
    let lastFallback = -Infinity;

    const scanQr = async () => {
      const now = performance.now();
      const video = videoRef.current;
      if (!document.hidden && video && video.readyState >= 2 && video.videoWidth && video.videoHeight && !qrScanningBusy.current) {
        if (now - lastQrCheckTime.current > 350) {
          lastQrCheckTime.current = now;
          qrScanningBusy.current = true;
          try {
            let found = false;

            // 1. Try browser-native BarcodeDetector if available
            if ('BarcodeDetector' in window) {
              try {
                const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
                const barcodes = await detector.detect(video);
                if (stopped) return;
                if (barcodes && barcodes.length > 0) {
                  const bc = barcodes[0];
                  const rawVal = String(bc.rawValue || '').trim();
                  if (rawVal) {
                    found = true;
                    const isUrl = /^(https?:\/\/|www\.)/i.test(rawVal);
                    const url = /^https?:\/\//i.test(rawVal) ? rawVal : (isUrl ? `https://${rawVal}` : null);
                    const box: [number, number, number, number] = bc.boundingBox
                      ? [bc.boundingBox.x, bc.boundingBox.y, bc.boundingBox.width, bc.boundingBox.height]
                      : [video.videoWidth * 0.25, video.videoHeight * 0.25, video.videoWidth * 0.5, video.videoHeight * 0.5];
                    setDetectedQR({
                      payload: rawVal,
                      is_url: isUrl,
                      url,
                      box,
                      lastSeen: Date.now()
                    });
                  }
                }
              } catch {
                // native BarcodeDetector failed; proceed to backend check
              }
            }

            // 2. Fallback to /api/v1/images/qr (which handles both normal and mirrored webcams)
            if (!found && !stopped && now - lastFallback >= 1000) {
              lastFallback = now;
              const canvas = fallbackCanvas;
              const scale = Math.min(1, 480 / Math.max(video.videoWidth, video.videoHeight));
              const width = Math.round(video.videoWidth * scale);
              const height = Math.round(video.videoHeight * scale);
              if (canvas.width !== width) canvas.width = width;
              if (canvas.height !== height) canvas.height = height;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
                if (blob && !stopped) {
                  const res = await fetchWithAuth('/api/v1/images/qr', {
                    method: 'POST',
                    headers: { 'Content-Type': 'image/jpeg' },
                    body: blob,
                    signal: request.signal
                  });
                  if (res.ok) {
                    const data = await res.json();
                    if (data.found && data.results?.length > 0 && !stopped) {
                      const item = data.results[0];
                      const unscale = 1 / scale;
                      const box: [number, number, number, number] | null = item.box
                        ? [item.box[0] * unscale, item.box[1] * unscale, item.box[2] * unscale, item.box[3] * unscale]
                        : null;
                      setDetectedQR({
                        payload: item.payload,
                        is_url: item.is_url,
                        url: item.url,
                        box,
                        lastSeen: Date.now()
                      });
                      found = true;
                    }
                  }
                }
              }
            }

            if (!found && !stopped) {
              setDetectedQR(prev => (prev && Date.now() - prev.lastSeen > 2500 ? null : prev));
            }
          } catch {
            // ignore network/scan errors
          } finally {
            qrScanningBusy.current = false;
          }
        }
      }
      if (!stopped) {
        timer = setTimeout(() => void scanQr(), 300);
      }
    };

    scanQr();
    return () => {
      stopped = true;
      request.abort();
      clearTimeout(timer);
    };
  }, [stream, qrDetection]);

  // Periodic object detection loop
  const processFrame = useCallback(async () => {
    if (document.hidden || !videoRef.current || !stream || processing.current || !objectDetection) return;
    const video = videoRef.current;
    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return;

    // Keep a slow refresh for paused or static streams so tracks can still confirm and expire.
    if (lastObjectFrame.current === video.currentTime && performance.now() - lastAnalyzedTimeRef.current < 800) return;
    lastObjectFrame.current = video.currentTime;

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
        if (avgDiff < 3.0 && timeSinceLast < 300) {
          hasMotion = false;
        }
      }
      prevThumbnailRef.current = imgData;
    }

    if (!hasMotion) return;
    lastAnalyzedTimeRef.current = performance.now();

    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
    }
    const canvas = canvasRef.current;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (canvas.width !== vw) canvas.width = vw;
    if (canvas.height !== vh) canvas.height = vh;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, vw, vh);

    processing.current = true;
    const controller = new AbortController();
    activeRequest.current = controller;
    const t0 = performance.now();

    try {
      // Preserve thin object edges; JPEG compression can erase small tools.
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob || controller.signal.aborted) return;

      // 2. Object Detection (YOLOv8n ONNX)
      if (objectDetection) try {
        const res = await fetchWithAuth(`/api/v1/vision/detect?segment=${foregroundModeRef.current !== 'off'}&confidence=0.35`, {
          method: 'POST',
          headers: { 'Content-Type': 'image/png' },
          body: blob,
          signal: controller.signal
        });
        if (res.ok) {
          const data = await res.json();
          const rawList = data.detections || [];
          const normalized: DetectedObject[] = rawList.filter((d: any) => typeof (d.class || d.class_name) === 'string' && Number.isFinite(d.confidence) && Array.isArray(d.box) && d.box.length === 4 && d.box.every(Number.isFinite));
          if (controller.signal.aborted) return;
          const confirmed = objectConfirmation.current.update(normalized.map(d => ({ ...d, class: d.class || d.class_name! })), performance.now()).filter(d => d.confirmed);
          const available = new Set(tracks.current);
          const tracked = confirmed.map((d) => {
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
            lastObjectRead.current = performance.now();
            tracks.current = tracked;
            setObjects(tracked);
          }
        } else if (res.status !== 429 && !controller.signal.aborted) {
          objectConfirmation.current.reset();
          tracks.current = [];
          setObjects([]);
        }
      } catch {
        if (!controller.signal.aborted) {
          objectConfirmation.current.reset();
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
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        processing.current = false;
      }
    }
  }, [stream, objectDetection]);

  useEffect(() => {
    faceConfirmation.current.reset();
    lastFaceRead.current = 0;
    setFaceReadState('checking');
    setCanCapture(false);
    setSnapshotPending(false);
    tracks.current = [];
    objectConfirmation.current.reset();
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
      if (lastObjectRead.current && performance.now() - lastObjectRead.current > 1500) {
        tracks.current = [];
        setObjects([]);
        objectConfirmation.current.reset();
        lastObjectRead.current = 0;
      }
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
    objectConfirmation.current.reset();
    setObjects([]);
    lastAnalyzedTimeRef.current = 0;
  }, [objectDetection]);

  // Object inference has its own cadence, independent of face tracking.
  useEffect(() => {
    if (!stream || !objectDetection) return;
    lastObjectFrame.current = null;
    let interval: number | undefined;
    const updateVisibility = () => {
      window.clearInterval(interval);
      if (document.hidden) activeRequest.current?.abort();
      else interval = window.setInterval(processFrame, 200);
    };
    updateVisibility();
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', updateVisibility);
      activeRequest.current?.abort();
      processing.current = false;
    };
  }, [stream, objectDetection, processFrame]);

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
    if (!videoRef.current || snapshotPending) return;
    const video = videoRef.current;
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 2000 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    setSnapshotPending(true);
    canvas.toBlob((blob) => {
      if (videoRef.current !== video || video.srcObject !== stream) return;
      setSnapshotPending(false);
      if (blob) onSnapshot?.(blob);
      else setCameraError('Could not capture this frame. Try again.');
    }, 'image/jpeg', 0.9);
  };

  const handleSaveUnknown = (unknown: FaceObservation) => {
    const trackId = unknown.trackId;
    if (!onSaveUnknownSnapshot || trackId === undefined) return;
    if (!videoRef.current) return;
    const video = videoRef.current;
    if (video.readyState < 2 || !video.videoWidth) return;
    const [x, y, w, h] = unknown.box;
    const paddingX = Math.round(w * 0.65);
    const paddingY = Math.round(h * 0.8);
    const cropX = Math.max(0, Math.round(x - paddingX));
    const cropY = Math.max(0, Math.round(y - paddingY));
    const cropRight = Math.min(video.videoWidth, Math.round(x + w + paddingX));
    const cropBottom = Math.min(video.videoHeight, Math.round(y + h + paddingY));
    const cropWidth = Math.max(1, cropRight - cropX);
    const cropHeight = Math.max(1, cropBottom - cropY);
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1200 / Math.max(cropWidth, cropHeight));
    canvas.width = Math.round(cropWidth * scale);
    canvas.height = Math.round(cropHeight * scale);
    canvas.getContext('2d')?.drawImage(video, cropX, cropY, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(async (blob) => {
      if (!blob || videoRef.current !== video || video.srcObject !== stream) return;
      if (await onSaveUnknownSnapshot(blob, `unknown-${trackId}`)) savedUnknownTracks.current.add(trackId);
    }, 'image/jpeg', 0.9);
  };

  useEffect(() => {
    const unknown = people.find(person => person.recognition_state === 'unknown' && !person.public_figure &&
      person.trackId !== undefined && !savedUnknownTracks.current.has(person.trackId));
    if (
      localStorage.getItem('oracle_save_unknown_frames') === 'false' ||
      !onSaveUnknownSnapshot ||
      !unknown ||
      Date.now() - lastUnknownAutoSave.current < 30000
    ) return;
    lastUnknownAutoSave.current = Date.now();
    handleSaveUnknown(unknown);
  }, [people, onSaveUnknownSnapshot]);

  const handleCopyQR = async () => {
    if (!detectedQR) return;
    try {
      await navigator.clipboard.writeText(detectedQR.payload);
      setQrCopied(true);
      setTimeout(() => setQrCopied(false), 2000);
    } catch {}
  };

  const handleVisitQR = () => {
    if (!detectedQR?.url) return;
    window.open(detectedQR.url, '_blank', 'noopener,noreferrer');
  };

  const handleSaveQR = async () => {
    if (!detectedQR || qrSaving) return;
    setQrSaving(true);
    try {
      const title = detectedQR.is_url
        ? `QR Link: ${detectedQR.url?.replace(/^https?:\/\//i, '').slice(0, 40)}`
        : `QR Code: ${detectedQR.payload.slice(0, 30)}`;
      const res = await fetchWithAuth('/api/v1/records/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          text: detectedQR.payload
        })
      });
      if (res.ok) {
        setQrSaved(true);
        setTimeout(() => setQrSaved(false), 3000);
      }
    } catch {
    } finally {
      setQrSaving(false);
    }
  };

  const subjects = combineSubjects(objects, people);
  const effectivePrimaryKey = choosePrimary(subjects, primaryKey);
  const primarySubject = subjects.find((subject) => subject.key === effectivePrimaryKey);
  const { width: vw, height: vh } = frameSize;
  const labelHeight = vw * .075;
  const labelWidth = vw * .34;
  const labelGap = vw * .012;
  const faceSubjects = subjects.filter(subject => subject.face).map(subject => {
    const [x, y, w, h] = subject.face!.box;
    const width = Math.min(vw, x + w * 1.24) - Math.max(0, x - w * .24);
    const top = Math.max(0, y - h * .299);
    const left = Math.max(0, x - w * .24);
    return { subject, left: isMirrored ? vw - left - width : left, top, width,
      height: Math.min(vh, y + h * 1.273) - top };
  });
  const occupiedLabels: { left: number; top: number; width: number; height: number }[] = [];
  const primaryFace = primarySubject?.face;





  useEffect(() => {
    setPrimaryKey((current) => choosePrimary(combineSubjects(objects, people), current));
  }, [objects, people]);

  const [unknownItem, setUnknownItem] = useState<(DetectedObject & { trackId: number }) | null>(null);
  const trackingExclusions = useEffectEvent(() => {
    const exclusions: [number, number, number, number][] = [];

    // 1. Confirmed / tracked people faces - padded to cover entire head, hair, glasses, ears, and neck
    for (const p of people) {
      if (Array.isArray(p.box) && p.box.length === 4) {
        const [x, y, w, h] = p.box;
        const padX = w * 0.35;
        const padYTop = h * 0.45;
        const padYBottom = h * 0.35;
        const ex = Math.max(0, x - padX);
        const ey = Math.max(0, y - padYTop);
        const ew = Math.min(vw - ex, w + padX * 2);
        const eh = Math.min(vh - ey, h + padYTop + padYBottom);
        exclusions.push([ex / vw * trackingWidth, ey / vh * trackingHeight, ew / vw * trackingWidth, eh / vh * trackingHeight]);
      }
    }

    // 2. Raw unconfirmed face detections (from YuNet identify calls before multi-frame confirmation)
    if (Date.now() - rawFaceTimeRef.current < 2500) {
      for (const [x, y, w, h] of rawFaceBoxesRef.current) {
        const padX = w * 0.35;
        const padYTop = h * 0.45;
        const padYBottom = h * 0.35;
        const ex = Math.max(0, x - padX);
        const ey = Math.max(0, y - padYTop);
        const ew = Math.min(vw - ex, w + padX * 2);
        const eh = Math.min(vh - ey, h + padYTop + padYBottom);
        exclusions.push([ex / vw * trackingWidth, ey / vh * trackingHeight, ew / vw * trackingWidth, eh / vh * trackingHeight]);
      }
    }

    // 3. Detected objects (e.g. person bodies from YOLO, existing products)
    for (const obj of objects) {
      if (Array.isArray(obj.box) && obj.box.length === 4) {
        const [x, y, w, h] = obj.box;
        exclusions.push([x / vw * trackingWidth, y / vh * trackingHeight, w / vw * trackingWidth, h / vh * trackingHeight]);
      }
    }

    return exclusions;
  });

  // Reactive safeguard: immediately clear unknownItem if any face overlaps with it
  useEffect(() => {
    if (!unknownItem) return;
    const [ux, uy, uw, uh] = unknownItem.box;
    const allFaces = [
      ...people.map(p => p.box),
      ...(Date.now() - rawFaceTimeRef.current < 2500 ? rawFaceBoxesRef.current : [])
    ];
    for (const [fx, fy, fw, fh] of allFaces) {
      const ix = Math.max(0, Math.min(ux + uw, fx + fw * 1.35) - Math.max(ux, fx - fw * 0.35));
      const iy = Math.max(0, Math.min(uy + uh, fy + fh * 1.35) - Math.max(uy, fy - fh * 0.45));
      const inter = ix * iy;
      if (inter > 0 && inter / (uw * uh) > 0.12) {
        setUnknownItem(null);
        break;
      }
    }
  }, [people, unknownItem]);

  useEffect(() => {
    setUnknownItem(null);
    if (!stream || !objectDetection) return;
    const canvas = document.createElement('canvas');
    canvas.width = trackingWidth;
    canvas.height = trackingHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return;
    let tracker = new UnknownItemTracking();
    let trackId = 0;
    let visible = false;
    let lastTime = -1;
    const streamStartTime = Date.now();
    const reset = () => {
      tracker = new UnknownItemTracking();
      visible = false;
      lastTime = -1;
      setUnknownItem(null);
    };
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (document.hidden || !video || video.srcObject !== stream || video.readyState < 2 ||
          video.currentTime === lastTime) return;
      if (Date.now() - streamStartTime < 600) return;
      lastTime = video.currentTime;

      // Fast local FaceDetector check (zero-latency browser API if supported)
      if ('FaceDetector' in window && Date.now() - rawFaceTimeRef.current > 400) {
        try {
          const detector = new (window as any).FaceDetector({ fastMode: true, maxDetectedFaces: 3 });
          detector.detect(video).then((detected: any[]) => {
            if (detected && detected.length > 0) {
              rawFaceBoxesRef.current = detected.map((f: any) => [
                f.boundingBox.x,
                f.boundingBox.y,
                f.boundingBox.width,
                f.boundingBox.height
              ]);
              rawFaceTimeRef.current = Date.now();
            }
          }).catch(() => {});
        } catch {
          // ignore
        }
      }

      context.drawImage(video, 0, 0, trackingWidth, trackingHeight);
      const pixels = context.getImageData(0, 0, trackingWidth, trackingHeight).data;
      const image = new Uint8ClampedArray(trackingWidth * trackingHeight);
      for (let index = 0; index < image.length; index++) {
        const offset = index * 4;
        image[index] = .299 * pixels[offset] + .587 * pixels[offset + 1] + .114 * pixels[offset + 2];
      }
      const box = tracker.update(image, trackingExclusions());
      if (!box) {
        visible = false;
        setUnknownItem(null);
        return;
      }
      if (!visible) trackId--;
      visible = true;
      const [x, y, w, h] = box;
      setUnknownItem({ trackId, class: 'Unidentified item', confidence: 0,
        box: [x / trackingWidth * vw, y / trackingHeight * vh, w / trackingWidth * vw, h / trackingHeight * vh] });
    }, 125);
    document.addEventListener('visibilitychange', reset);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', reset);
    };
  }, [stream, objectDetection, vw, vh]);
  const productTargets = objectDetection ? objects.filter(
    (obj): obj is DetectedObject & { trackId: number } =>
      obj.trackId !== undefined && (obj.class || obj.class_name) !== 'person'
  ) : [];
  const centeredTargets = productTargets.filter(({ box: [x, y, w, h] }) =>
    Math.abs((x + w / 2) / vw - .5) < .22 && Math.abs((y + h / 2) / vh - .5) < .25);
  const distanceFromCenter = ({ box: [x, y, w, h] }: DetectedObject) =>
    Math.hypot((x + w / 2) / vw - .5, (y + h / 2) / vh - .5);
  const trackingTargets = unknownItem && objectDetection ? [...productTargets, unknownItem] : productTargets;
  const selectedProduct = trackingTargets.find(obj => obj.trackId === productTrack);
  const productTarget = selectedProduct ?? unknownItem ??
    centeredTargets.sort((a, b) => distanceFromCenter(a) - distanceFromCenter(b))[0];
  const activeProductId = productTarget?.trackId;

  useEffect(() => { setProductTrack(null); }, [stream]);

  return (
    <>
    <div className={`oracle-camera-workspace${expanded ? ' is-expanded' : ''}`}>
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
          <button ref={detailsButton} type="button" className="card-header-icon-btn" aria-label="Product details"
            aria-expanded={detailsOpen} aria-controls="camera-product-details" onClick={() => setDetailsOpen(open => !open)}>
            <FileText size={14} />
          </button>
          <button ref={expandButton} type="button" className="card-header-icon-btn"
            aria-label={expanded ? 'Collapse camera' : 'Expand camera'} aria-pressed={expanded}
            onClick={() => { if (expanded) collapse(); else { setExpanded(true); setDetailsOpen(true); } }}>
            {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button type="button" className="card-header-icon-btn" aria-label="Camera settings" aria-expanded={showCameraControls} aria-controls="camera-settings" onClick={() => setShowCameraControls(open => !open)}>
            <SlidersHorizontal size={14} />
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
          onLoadedData={event => {
            syncFrameSize(event);
            setCanCapture(true);
          }}
          onResize={syncFrameSize}
          onEmptied={() => setCanCapture(false)}
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
        {faceTracking && faceSubjects.map(({ subject, left, top: framedY, width: framedW, height: framedH }) => {
          const centered = Math.max(0, Math.min(vw - labelWidth, left + (framedW - labelWidth) / 2));
          const middle = Math.max(0, Math.min(vh - labelHeight, framedY + (framedH - labelHeight) / 2));
          const position = [
            [centered, framedY - labelHeight - labelGap],
            [centered, framedY + framedH + labelGap],
            [left + framedW + labelGap, middle],
            [left - labelWidth - labelGap, middle],
          ].map(([left, top]) => ({ left, top, width: labelWidth, height: labelHeight }))
            .find(label => label.left >= 0 && label.top >= 0 &&
              label.left + label.width <= vw && label.top + label.height <= vh &&
              ![...faceSubjects, ...occupiedLabels].some(box =>
                label.left < box.left + box.width && label.left + label.width > box.left &&
                label.top < box.top + box.height && label.top + label.height > box.top));
          if (position) occupiedLabels.push(position);

          const subjectIsMatched = !!subject.face?.matched;
          const face = subject.face!;
          const confirming = face.recognition_state === 'confirming';
          const watched = subjectIsMatched && !face.held && face.id && localStorage.getItem(`oracle_watchlist_${face.id}`) !== null;
          let reticleColor = confirming ? '#91b7df' : '#a7b4c4';
          let RoleIcon = null;
          if (watched) {
            reticleColor = '#fbbf24';
            RoleIcon = Flag;
          } else if (subjectIsMatched) {
            if (face.relationship === 'owner') {
              reticleColor = '#4ade80';
              RoleIcon = face.permission === 'administrator' ? ShieldCheck : UserRound;
            } else if (face.permission === 'administrator') {
              reticleColor = '#5eead4';
              RoleIcon = Shield;
            } else if (face.relationship === 'family' || face.relationship === 'friend') {
              reticleColor = '#c4b5fd';
              RoleIcon = Heart;
            } else if (face.relationship === 'guest') {
              reticleColor = '#cbd5e1';
              RoleIcon = UserRound;
            } else {
              reticleColor = '#93b5da';
              RoleIcon = cameraProfileRole(face) === 'Colleague' ? Users : UserRound;
            }
          }

          return (
            <div
              key={`face-${subject.face!.trackId}`}
              data-subject={subject.key}
              aria-hidden={subjectIsMatched && position ? undefined : true}
              className={`poi-target-container${confirming ? ' camera-face-confirming' : ''}`}
              style={{
                '--camera-face-accent': subjectIsMatched ? reticleColor : 'transparent',
                left: `${(left / vw) * 100}%`,
                top: `${(framedY / vh) * 100}%`,
                width: `${(framedW / vw) * 100}%`,
                height: `${(framedH / vh) * 100}%`
              } as React.CSSProperties}
            >
              {/* Minimalist Floating Name Badge */}
              {position && <div
                className="live-detection-name-badge camera-positioned-label"
                title={subjectIsMatched ? `${cameraProfileRole(face)} · ${face.permission === 'administrator' ? 'Administrator' : 'Standard'}` : undefined}
                style={{
                  top: `${(position.top - framedY) / vw * 100}cqw`,
                  left: `${(position.left - left) / vw * 100}cqw`,
                  borderColor: reticleColor,
                  color: reticleColor,
                  boxShadow: `0 0 14px ${reticleColor}33`
                }}
              >
                {RoleIcon
                  ? <RoleIcon size={11} aria-hidden="true" />
                  : <span className="live-name-dot" style={{ background: reticleColor }} />}
                <span className="live-name-text">
                  {subjectIsMatched ? <button type="button" className="camera-watchlist-button"
                    onClick={() => setIdentityReview({ face, seen: face.lastSeen ?? lastFaceRead.current,
                      reason: watched ? localStorage.getItem(`oracle_watchlist_${face.id}`) : null })}>
                    {watched ? 'Review match' : face.name}
                  </button>
                    : subject.face
                    ? (subject.face.public_figure
                      ? `Likely public figure · ${subject.face.public_figure.name}`
                      : subject.face.recognition_state === 'confirming'
                      ? 'Identifying…'
                      : subject.face.recognition_state === 'uncertain' && subject.face.possible_match
                      ? `Possible match · ${subject.face.possible_match}`
                      : 'Unidentified')
                    : '• SUBJECT'}
                </span>
              </div>}
            </div>
          );
        })}

        {/* Real-time QR Code Bounding Reticle */}
        {detectedQR?.box && (
          <div
            className="camera-qr-reticle"
            style={{
              left: `${((isMirrored ? vw - detectedQR.box[0] - detectedQR.box[2] : detectedQR.box[0]) / vw) * 100}%`,
              top: `${(detectedQR.box[1] / vh) * 100}%`,
              width: `${(detectedQR.box[2] / vw) * 100}%`,
              height: `${(detectedQR.box[3] / vh) * 100}%`
            }}
          >
            <div className="camera-qr-corner tl" />
            <div className="camera-qr-corner tr" />
            <div className="camera-qr-corner bl" />
            <div className="camera-qr-corner br" />
            <div className="camera-qr-reticle-pill">
              <QrCode size={10} />
              <span>QR DETECTED</span>
            </div>
          </div>
        )}

        {trackingTargets.map((obj) => {
          const [x, y, w, h] = obj.box;
          const left = isMirrored ? vw - x - w : x;
          const label = String(obj.class || obj.class_name || 'Object').toUpperCase();
          const conf = Math.round((obj.confidence || 0) * 100);
          return (
            <button
              key={`object-${obj.trackId}`}
              type="button"
              className="camera-object-outline"
              aria-label={`Select ${label.toLowerCase()} for scanning`}
              aria-pressed={activeProductId === obj.trackId}
              onClick={() => setProductTrack(obj.trackId)}
              style={{ left: `${left / vw * 100}%`, top: `${y / vh * 100}%`, width: `${w / vw * 100}%`, height: `${h / vh * 100}%` }}
            >
              <span className="object-label-pill">
                <span className="object-label-dot" />
                <span className="object-label-text">{obj.trackId < 0 ? 'Tracking item'
                  : activeProductId === obj.trackId ? `${label} · SCAN TARGET` : label}</span>
                {conf > 0 && <span className="object-label-conf">{conf}%</span>}
              </span>
            </button>
          );
        })}

      </div>

      {/* Floating QR Code Interactive Action Banner */}
      {detectedQR && qrBannerDismissed !== detectedQR.payload && (
        <div className="camera-qr-banner">
          <div className="camera-qr-banner-header">
            <div className="camera-qr-banner-tag">
              <QrCode size={13} className="camera-qr-icon-pulse" />
              <span>QR Code Detected</span>
            </div>
            <button
              type="button"
              className="camera-qr-dismiss"
              onClick={() => setQrBannerDismissed(detectedQR.payload)}
              title="Dismiss QR Notification"
              aria-label="Dismiss QR Notification"
            >
              <X size={12} />
            </button>
          </div>
          <div className="camera-qr-banner-payload" title={detectedQR.payload}>
            {detectedQR.payload}
          </div>
          <div className="camera-qr-banner-actions">
            {detectedQR.is_url && detectedQR.url && (
              <button
                type="button"
                className="camera-qr-btn primary"
                onClick={handleVisitQR}
                title="Open link in a new tab"
              >
                <ExternalLink size={12} />
                <span>Visit Link ↗</span>
              </button>
            )}
            <button
              type="button"
              className="camera-qr-btn secondary"
              onClick={handleCopyQR}
              title="Copy to clipboard"
            >
              {qrCopied ? <Check size={12} style={{ color: '#4ade80' }} /> : <Copy size={12} />}
              <span>{qrCopied ? 'Copied' : 'Copy'}</span>
            </button>
            <button
              type="button"
              className="camera-qr-btn secondary"
              onClick={handleSaveQR}
              disabled={qrSaving || qrSaved}
              title="Save to durable notes"
            >
              {qrSaved ? <Check size={12} style={{ color: '#4ade80' }} /> : <FileText size={12} />}
              <span>{qrSaved ? 'Saved to Notes' : qrSaving ? 'Saving…' : 'Save as Note'}</span>
            </button>
          </div>
        </div>
      )}

      {faceTracking && faceReadState === 'error' && (
        <div className="camera-error-message" role="status">Face recognition unavailable</div>
      )}

      {cameraError && <p role="alert" className="camera-error-message">{cameraError}</p>}

      {showCameraControls && <div id="camera-settings" className="camera-settings">
        <label className="camera-tracking-toggle">
          <input type="checkbox" checked={autoIdentifyProducts} onChange={event => setAutoIdentifyProducts(event.target.checked)} />
          <span>Auto-identify products</span>
        </label>
        {onCameraChange && <label className="camera-device-select">
          <span>Camera source</span>
          <select aria-label="Select camera" value={stream?.getVideoTracks()[0]?.getSettings().deviceId || ''} disabled={switchingCamera || cameras.length === 0} onChange={event => void changeCamera(event.target.value)}>
            <option value="" disabled>Select a camera</option>
            {cameras.map((camera, index) => <option key={camera.deviceId} value={camera.deviceId}>{camera.label || `Camera ${index + 1}`}</option>)}
          </select>
        </label>}
        {switchingCamera && <p role="status" className="camera-settings-meta">Switching camera…</p>}
        <label className="camera-tracking-toggle">
          <input type="checkbox" checked={faceTracking} onChange={event => {setFaceTracking(event.target.checked); localStorage.setItem('oracle_face_reticles', String(event.target.checked));}} />
          <span>Person tracking</span>
        </label>

        <label className="camera-tracking-toggle">
          <input
            type="checkbox"
            checked={qrDetection}
            onChange={event => {
              setQrDetection(event.target.checked);
              localStorage.setItem('oracle_qr_detection', String(event.target.checked));
              if (!event.target.checked) setDetectedQR(null);
            }}
          />
          <span>QR &amp; Barcode scanning</span>
        </label>

        <label className="camera-tracking-toggle">
          <input type="checkbox" checked={objectDetection} onChange={event => {
            setObjectDetection(event.target.checked);
            localStorage.setItem('oracle_yolo_enabled', String(event.target.checked));
            localStorage.setItem('oracle_show_all_objects', String(event.target.checked));
            if (!event.target.checked) setForegroundMode('off');
          }} />
          <span>Object tracking</span>
        </label>

      </div>}

      {/* 7. Footer Action Strip */}
      {scanGuidance && <p className="camera-settings-meta" role="status">{scanGuidance}</p>}
      <div className="camera-card-footer">
        <div className="camera-footer-actions">
          {!autoIdentifyProducts && <button type="button" className="camera-footer-btn primary" disabled={!canCapture}
            onClick={() => {
              setDetailsOpen(true);
              window.dispatchEvent(new CustomEvent('oracle_camera_command', { detail: 'scan' }));
            }}>
            <ScanLine size={13} strokeWidth={1.8} />
            <span>Scan product</span>
          </button>}
          {onSnapshot && (
            <button
              type="button"
              onClick={handleSnap}
              disabled={!canCapture || snapshotPending}
              className="camera-footer-btn primary"
              title="Capture a frame to read text, scan QR, or ask Oracle"
            >
              <Camera size={13} strokeWidth={1.8} />
              <span>{snapshotPending ? 'Capturing...' : 'Capture & ask'}</span>
            </button>
          )}

        </div>
      </div>
    </motion.div>
    <ProductIntelligencePanel video={videoRef} stream={stream} autoIdentify={autoIdentifyProducts}
      sidebarOpen={detailsOpen} onShowDetails={() => setDetailsOpen(true)} onHideDetails={hideDetails}
      onScanGuidance={setScanGuidance}
      target={productTarget && { id: productTarget.trackId, box: productTarget.box, label: productTarget.class || productTarget.class_name }}
      frameWidth={vw} frameHeight={vh} />
    </div>
    {identityReview && <section className="camera-watchlist-review" aria-label="Camera identity details">
      <button type="button" className="person-action-btn" onClick={() => setIdentityReview(null)}>Close details</button>
      <strong>{identityReview.reason !== null && 'Possible watchlist match · '}{identityReview.face.name}</strong>
      <span>{cameraProfileRole(identityReview.face)} · {identityReview.face.permission === 'administrator' ? 'Administrator' : 'Standard'}</span>
      <span>Last seen <time dateTime={new Date(identityReview.seen).toISOString()}>{new Date(identityReview.seen).toLocaleString()}</time></span>
      {identityReview.reason && <p>{identityReview.reason}</p>}
    </section>}
    {advancedSettingsHost && createPortal(<div className="camera-advanced-controls">
<h3>Live camera controls</h3>
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
      {(
        <motion.div
          className="camera-details-drawer"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2 }}
        >
          {primaryFace && (
            <div className="camera-biometric-details">
              {primaryFace.matched && !primaryFace.held && primaryFace.id && localStorage.getItem(`oracle_watchlist_${primaryFace.id}`) !== null && (
                <div className="detail-row">
                  <span>Possible watchlist match</span>
                  <strong>{primaryFace.name}</strong>
                </div>
              )}
              {primaryFace.public_figure && (
                <div className="detail-row">
                  <span>Likely public figure</span>
                  <a href={primaryFace.public_figure.source} target="_blank" rel="noreferrer">{primaryFace.public_figure.name}</a>
                </div>
              )}
              <div className="detail-row">
                <span>Recognition</span>
                <strong>{primaryFace.recognition_state.replaceAll('_', ' ').toUpperCase()}</strong>
              </div>
              <div className="detail-row">
                <span>Similarity</span>
                <strong>{typeof primaryFace.cosine_score === 'number' ? primaryFace.cosine_score.toFixed(3) : 'N/A'}</strong>
              </div>
              {primaryFace.matched && primaryFace.relationship && (
                <div className="detail-row">
                  <span>Profile role</span>
                  <strong>{cameraProfileRole(primaryFace)}</strong>
                </div>
              )}
              {primaryFace.matched && primaryFace.permission && (
                <div className="detail-row">
                  <span>Profile clearance</span>
                  <strong>{primaryFace.permission === 'administrator' ? 'Administrator' :
                    primaryFace.permission === 'disabled' ? 'Disabled' : 'Standard'}</strong>
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

</div>, advancedSettingsHost)}
    </>
  );
};
