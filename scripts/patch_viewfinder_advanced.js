const fs = require('fs');
let code = fs.readFileSync('frontend/src/components/SurveillanceViewfinder.tsx', 'utf8');

// 1. Add mirror state and greeting ref
const greetingState = `  // Advanced Camera & Recognition settings
  const [isMirrored, setIsMirrored] = useState(() => localStorage.getItem('oracle_camera_mirrored') !== 'false');
  const lastGreetedUserRef = useRef<{ name: string; time: number } | null>(null);

  const toggleMirror = () => {
    setIsMirrored((prev) => {
      const next = !prev;
      localStorage.setItem('oracle_camera_mirrored', String(next));
      return next;
    });
  };`;

code = code.replace(
  '  // Sentry Auto-Lock Tracking',
  greetingState + '\n\n  // Sentry Auto-Lock Tracking'
);

// 2. Update face identification call with threshold and greeting
const oldIdentBlock = `      // 1. Face Identification (YuNet + SFace)
      try {
        const res = await fetchWithAuth('/api/v1/people/identify', {
          method: 'POST',
          headers: { 'Content-Type': 'image/jpeg' },
          body: blob, signal:controller.signal
        });
        if (res.ok) {
          const data = await res.json();
          if(!controller.signal.aborted)setPeople(data.identified || []);
        } else if(!controller.signal.aborted){setReadError(\`Vision request failed (\${res.status}).\`);setObjects([]);}
      } catch {
        if(!controller.signal.aborted)setReadError('Vision connection unavailable.');
        // ignore transient errors
      }`;

const newIdentBlock = `      // 1. Face Identification (YuNet + SFace)
      try {
        const faceThreshold = Number(localStorage.getItem('oracle_face_threshold')) || 0.363;
        const res = await fetchWithAuth(\`/api/v1/people/identify?threshold=\${faceThreshold}\`, {
          method: 'POST',
          headers: { 'Content-Type': 'image/jpeg' },
          body: blob, signal:controller.signal
        });
        if (res.ok) {
          const data = await res.json();
          const identified = data.identified || [];
          if(!controller.signal.aborted) setPeople(identified);

          // Operator voice greeting on arrival
          const greetEnabled = localStorage.getItem('oracle_greet_operator') !== 'false';
          const matched = identified.find((p: any) => p.matched);
          if (greetEnabled && matched && !controller.signal.aborted) {
            const now = Date.now();
            const last = lastGreetedUserRef.current;
            if (!last || last.name !== matched.name || now - last.time > 15 * 60 * 1000) {
              lastGreetedUserRef.current = { name: matched.name, time: now };
              soundEffects.playWakeChime();
              fetchWithAuth('/api/v1/voice/speak', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  text: \`Identity confirmed. Welcome back, \${matched.name}. All systems operational.\`
                })
              }).then(async (r) => {
                if (r.ok) {
                  const b = await r.blob();
                  const audio = new Audio(URL.createObjectURL(b));
                  audio.play().catch(() => {});
                }
              }).catch(() => {});
            }
          }
        } else if(!controller.signal.aborted){setReadError(\`Vision request failed (\${res.status}).\`);setObjects([]);}
      } catch {
        if(!controller.signal.aborted)setReadError('Vision connection unavailable.');
        // ignore transient errors
      }`;

code = code.replace(oldIdentBlock.replace(/\r\n/g, '\n'), newIdentBlock);
if (!code.includes('lastGreetedUserRef.current')) {
  code = code.replace(oldIdentBlock, newIdentBlock);
}

// 3. Update YOLOv8 object detection with threshold and class filtering
const oldYoloBlock = `      // 2. Object Detection (YOLOv8n ONNX)
      try {
        const res = await fetchWithAuth('/api/v1/vision/detect', {
          method: 'POST',
          headers: { 'Content-Type': 'image/jpeg' },
          body: blob, signal:controller.signal
        });
        if (res.ok) {
          const data = await res.json();
          const rawList = data.detections || [];
          const normalized: DetectedObject[] = rawList.filter((d:any)=>typeof (d.class||d.class_name)==='string' && Number.isFinite(d.confidence) && Array.isArray(d.box) && d.box.length===4 && d.box.every(Number.isFinite));
          const filtered = normalized.filter((d) => (d.class || d.class_name) !== 'person');
          if(!controller.signal.aborted){setObjects(filtered.slice(0,5));setReadError('');}
        } else if(!controller.signal.aborted){setReadError(\`Vision request failed (\${res.status}).\`);setObjects([]);}
      } catch {
        if(!controller.signal.aborted)setReadError('Vision connection unavailable.');
        // ignore transient errors
      }`;

const newYoloBlock = `      // 2. Object Detection (YOLOv8n ONNX) with threshold & whitelist
      try {
        const yoloThreshold = Number(localStorage.getItem('oracle_yolo_threshold')) || 0.35;
        const yoloFilter = localStorage.getItem('oracle_yolo_filter') || 'essentials';
        const res = await fetchWithAuth(\`/api/v1/vision/detect?confidence=\${yoloThreshold}\`, {
          method: 'POST',
          headers: { 'Content-Type': 'image/jpeg' },
          body: blob, signal:controller.signal
        });
        if (res.ok) {
          const data = await res.json();
          const rawList = data.detections || [];
          const normalized: DetectedObject[] = rawList.filter((d:any)=>typeof (d.class||d.class_name)==='string' && Number.isFinite(d.confidence) && Array.isArray(d.box) && d.box.length===4 && d.box.every(Number.isFinite));
          const essentials = new Set(['laptop', 'cell phone', 'bottle', 'cup', 'mouse', 'keyboard', 'book', 'backpack', 'clock']);
          const filtered = normalized.filter((d) => {
            const name = (d.class || d.class_name || '').toLowerCase();
            if (name === 'person') return false;
            if (yoloFilter === 'essentials') return essentials.has(name);
            return true;
          });
          if(!controller.signal.aborted){setObjects(filtered.slice(0,6));setReadError('');}
        } else if(!controller.signal.aborted){setReadError(\`Vision request failed (\${res.status}).\`);setObjects([]);}
      } catch {
        if(!controller.signal.aborted)setReadError('Vision connection unavailable.');
        // ignore transient errors
      }`;

code = code.replace(oldYoloBlock.replace(/\r\n/g, '\n'), newYoloBlock);
if (!code.includes('oracle_yolo_threshold')) {
  code = code.replace(oldYoloBlock, newYoloBlock);
}

// 4. Update Interval cadence
const oldInterval = `  // Run recognition loop every 1.5 seconds while stream is active
  useEffect(() => {
    if (!stream) return;
    const interval = setInterval(processFrame, 1400);
    return () => {clearInterval(interval);activeRequest.current?.abort();processing.current=false;};
  }, [stream, processFrame]);`;

const newInterval = `  // Run recognition loop with configurable cadence
  useEffect(() => {
    if (!stream) return;
    const cadenceMode = localStorage.getItem('oracle_cadence_mode') || 'balanced';
    const intervalMs = cadenceMode === 'tactical' ? 600 : cadenceMode === 'eco' ? 3000 : 1400;
    const interval = setInterval(processFrame, intervalMs);
    return () => {clearInterval(interval);activeRequest.current?.abort();processing.current=false;};
  }, [stream, processFrame]);`;

code = code.replace(oldInterval.replace(/\r\n/g, '\n'), newInterval);
if (!code.includes('oracle_cadence_mode')) {
  code = code.replace(oldInterval, newInterval);
}

// 5. Update mirroring on video and boxes
code = code.replace(
  'const boxX = ((vw - (box[0] + box[2])) / vw) * 100;',
  'const boxX = isMirrored ? ((vw - (box[0] + box[2])) / vw) * 100 : (box[0] / vw) * 100;'
);
// For objects too
code = code.replace(
  'const boxX = ((vw - (box[0] + box[2])) / vw) * 100;',
  'const boxX = isMirrored ? ((vw - (box[0] + box[2])) / vw) * 100 : (box[0] / vw) * 100;'
);

code = code.replace(
  'playsInline muted className="cctv-video-stream" />',
  'playsInline muted className="cctv-video-stream" style={{ transform: isMirrored ? "scaleX(-1)" : "none" }} />'
);

// 6. Add Mirror button in CCTV header ribbon
const mirrorBtn = `          <button
            onClick={toggleMirror}
            style={{
              background: 'rgba(56, 189, 248, 0.1)',
              border: '1px solid rgba(56, 189, 248, 0.3)',
              color: '#38bdf8',
              borderRadius: '3px',
              padding: '1px 5px',
              fontSize: '8px',
              cursor: 'pointer',
              fontWeight: 700
            }}
            title="Toggle camera mirroring (flip horizontal)"
          >
            {isMirrored ? 'MIRROR: ON' : 'MIRROR: OFF'}
          </button>`;

code = code.replace(
  '<div ref={timecodeRef} className="cctv-timecode">REC 00:00:00:000</div>',
  mirrorBtn + '\n          <div ref={timecodeRef} className="cctv-timecode">REC 00:00:00:000</div>'
);

fs.writeFileSync('frontend/src/components/SurveillanceViewfinder.tsx', code, 'utf8');
console.log('SurveillanceViewfinder advanced settings patched successfully!');
