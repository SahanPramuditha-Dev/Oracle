import { useEffect, useEffectEvent, useRef, useState, type RefObject } from 'react';
import { fetchWithAuth } from '../utils/api';
import { speakWithKokoro } from '../utils/voice';

interface ProductRecord {
  id: string;
  name: string;
  brand?: string | null;
  variant?: string | null;
  capacity?: string | null;
  barcode?: string | null;
}

interface ProductResult {
  object_type?: string | null;
  object_confidence?: number;
  brand?: { name?: string | null; status?: string; confidence?: number };
  product?: { name?: string | null; variant?: string | null; model?: string | null; barcode?: string | null };
  product_status?: string;
  attributes?: {
    category?: string;
    packaging?: string;
    capacity?: string;
    specifications?: string;
    visible_text?: string[];
    visual_summary?: string;
    visual_error?: string;
  };
  evidence?: Array<{ kind: string; value: string; confidence: number; source?: string; bounds?: [number, number, number, number] | null; angle?: number }>;
  knowledge?: { source_type?: string; source_url?: string };
  candidates?: Array<{ record: ProductRecord }>;
  needs_more_evidence?: boolean;
  latency_ms?: number;
}

interface ProductIntelligencePanelProps {
  video?: RefObject<HTMLVideoElement | null>;
  stream: MediaStream | null;
  autoIdentify?: boolean;
  target?: { id: number; box: number[]; label?: string };
  frameWidth?: number;
  frameHeight?: number;
  sidebarOpen?: boolean;
  onShowDetails?: () => void;
  onHideDetails?: () => void;
  onScanGuidance?: (message: string) => void;
}

export function ProductIntelligencePanel({ video, stream, autoIdentify = false, target, frameWidth = 0, frameHeight = 0, sidebarOpen, onShowDetails, onHideDetails, onScanGuidance }: ProductIntelligencePanelProps) {
  const [result, setResult] = useState<ProductResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [guidance, setGuidance] = useState('');
  const [detectedType, setDetectedType] = useState<string>();
  const [preview, setPreview] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [firstAngle, setFirstAngle] = useState<Blob | null>(null);
  const [firstAngleUrl, setFirstAngleUrl] = useState('');
  const [pinned, setPinned] = useState(false);
  const evidenceDisclosure = useRef<HTMLDetailsElement>(null);
  const lastShown = useRef<{ identity: string; track?: number } | null>(null);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<ProductRecord[]>([]);
  const [matchSource, setMatchSource] = useState('');
  const [draft, setDraft] = useState<ProductRecord | null>(null);
  const [saved, setSaved] = useState<ProductRecord[]>(() => {
    try { return JSON.parse(localStorage.getItem('oracle_saved_products') || '[]'); }
    catch { return []; }
  });
  const uploadInput = useRef<HTMLInputElement | null>(null);
  const [filename, setFilename] = useState('');
  const [notice, setNotice] = useState('');
  const request = useRef<AbortController | null>(null);

  const automaticRequest = useRef<AbortController | null>(null);
  const liveRequest = useRef<AbortController | null>(null);

  const captureBounds = (source: HTMLVideoElement): [number, number, number, number] => {
    const { videoWidth: width, videoHeight: height } = source;
    if (!target || !frameWidth || !frameHeight) {
      const left = Math.floor(width * .15);
      const top = Math.floor(height * .12);
      return [left, top, width - left * 2, height - top * 2];
    }
    const [x, y, w, h] = target.box;
    const left = Math.max(0, Math.floor((x - w * .12) * width / frameWidth));
    const top = Math.max(0, Math.floor((y - h * .12) * height / frameHeight));
    const right = Math.min(width, Math.ceil((x + w * 1.12) * width / frameWidth));
    const bottom = Math.min(height, Math.ceil((y + h * 1.12) * height / frameHeight));
    return right > left && bottom > top ? [left, top, right - left, bottom - top] : [0, 0, width, height];
  };
  const sampleBounds = useEffectEvent(captureBounds);

  const inspect = async (upload?: File, automatic = false, alternateAngle = false) => {
    const source = video?.current;
    if (request.current) return;
    if (!upload && (!stream || !source || source.readyState < 2 || !source.videoWidth)) {
      setError('The camera is not ready. Try again or upload a photo.');
      return;
    }
    if (!automatic && !upload) setFilename('');
    const controller = new AbortController();
    request.current = controller;
    if (!upload) liveRequest.current = controller;
    if (automatic) automaticRequest.current = controller;
    setBusy(true);
    setError('');
    if (!automatic) {
      setDraft(null);
      setMatches([]);
    }
    setNotice('');
    const timeout = window.setTimeout(() => {
      controller.abort('Product inspection timed out');
    }, 30000);
    try {
      let snapshot: Blob | null | undefined = upload;
      if (!snapshot && source) {
        const canvas = document.createElement('canvas');
        const [x, y, width, height] = captureBounds(source);
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d')?.drawImage(source, x, y, width, height, 0, 0, width, height);
        snapshot = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      }
      if (!snapshot) throw new Error('Could not capture the camera frame.');
      if (!['image/jpeg', 'image/png'].includes(snapshot.type) || snapshot.size > 6_000_000) {
        throw new Error('Choose a JPEG or PNG photo up to 6 MB.');
      }
      if (controller.signal.aborted) return;
      const previousAngle = alternateAngle ? (firstAngle || preview) : null;
      let body: Blob | FormData = snapshot;
      if (previousAngle) {
        const angles = new FormData();
        angles.append('first', previousAngle);
        angles.append('current', snapshot);
        body = angles;
      }
      const response = await fetchWithAuth('/api/v1/vision/products/inspect', {
        method: 'POST',
        headers: {
          ...(previousAngle ? {} : { 'Content-Type': snapshot.type }),
          'X-Oracle-Product-Mode': automatic ? 'auto' : 'angle'
        },
        body,
        signal: controller.signal
      });
      const contentType = response.headers.get('content-type') || '';
      const raw = await response.text();
      let data: ProductResult & { detail?: string } = {};
      if (raw && contentType.includes('application/json')) {
        try {
          data = JSON.parse(raw) as ProductResult & { detail?: string };
        } catch {
          throw new Error('The inspection service returned invalid JSON.');
        }
      }
      if (!response.ok) {
        throw new Error(data.detail || (raw.slice(0, 160) || `Product inspection failed (${response.status}).`));
      }
      if (!contentType.includes('application/json') || !data.product_status) {
        throw new Error('The inspection service returned an unexpected response.');
      }
      if (!controller.signal.aborted) {
        if (automatic) {
          setFilename('');
          setMatches([]);
        }
        setPreview(snapshot);
        setFirstAngle(previousAngle);
        setDetectedType(upload ? undefined : target?.label);
        setResult(data);
        const evidenceText = data.evidence?.filter(item => item.kind === 'barcode' || (item.kind === 'ocr' && item.confidence >= .65))
          .map(item => item.value.trim().toLowerCase()).sort() ?? [];
        const identity = data.product?.barcode || data.product?.name || data.brand?.name || evidenceText.join('|');
        const sameResult = identity === lastShown.current?.identity ||
          (target && target.id === lastShown.current?.track);
        if (!automatic || (identity && !sameResult)) {
          onShowDetails?.();
        }
        if (identity) lastShown.current = { identity, track: upload ? undefined : target?.id };
      }
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : 'Product inspection failed.');
      } else if (controller.signal.reason === 'Product inspection timed out') {
        setError('Product inspection timed out. Move the object closer and try again.');
      }
    } finally {
      window.clearTimeout(timeout);
      if (automaticRequest.current === controller) automaticRequest.current = null;
      if (liveRequest.current === controller) liveRequest.current = null;
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  };

  const scanAutomatically = useEffectEvent(() => {
    if (request.current || draft || pinned) return false;
    void inspect(undefined, true);
    return true;
  });

  useEffect(() => {
    if (!autoIdentify || !stream || !video || pinned) return;
    const thumbnail = document.createElement('canvas');
    thumbnail.width = 32;
    thumbnail.height = 24;
    const context = thumbnail.getContext('2d', { willReadFrequently: true });
    if (!context) return;

    let previous: Uint8ClampedArray | undefined;
    let lastScanned: Uint8ClampedArray | undefined;
    let steadySamples = 0;
    let nextScan = 0;
    const difference = (first: Uint8ClampedArray, second: Uint8ClampedArray) => {
      let total = 0;
      for (let index = 0; index < first.length; index += 4) {
        total += Math.abs(first[index] - second[index]);
        total += Math.abs(first[index + 1] - second[index + 1]);
        total += Math.abs(first[index + 2] - second[index + 2]);
      }
      return total / (thumbnail.width * thumbnail.height * 3);
    };
    const sample = () => {
      const source = video.current;
      if (document.hidden || !source || source.srcObject !== stream || source.readyState < 2 || !source.videoWidth) {
        previous = undefined;
        steadySamples = 0;
        return;
      }
      const [x, y, width, height] = sampleBounds(source);
      if (Math.min(width, height) < 100) {
        setGuidance('Move the item closer.');
        steadySamples = 0;
        return;
      }
      context.drawImage(source, x, y, width, height, 0, 0, thumbnail.width, thumbnail.height);
      const frame = context.getImageData(0, 0, thumbnail.width, thumbnail.height).data;
      steadySamples = previous && difference(frame, previous) < 4 ? steadySamples + 1 : 0;
      previous = frame;
      let edgeStrength = 0;
      let darkPixels = 0;
      let brightPixels = 0;
      const row = thumbnail.width * 4;
      for (let index = 0; index < frame.length; index += 4) {
        const light = (frame[index] + frame[index + 1] + frame[index + 2]) / 3;
        if (light < 28) darkPixels++;
        if (light > 248) brightPixels++;
        if (index % row !== 0) edgeStrength += Math.abs(frame[index + 1] - frame[index - 3]);
        if (index >= row) edgeStrength += Math.abs(frame[index + 1] - frame[index - row + 1]);
      }
      const pixels = frame.length / 4;
      if (edgeStrength / pixels < 6) {
        setGuidance(darkPixels > pixels * .7 ? 'Add more light.'
          : brightPixels > pixels * .7 ? 'Tilt the item to reduce glare.'
          : 'Turn the label toward the camera.');
        return;
      }
      setGuidance('');
      const now = performance.now();
      if (steadySamples < 2 || now < nextScan || (lastScanned && difference(frame, lastScanned) < 4)) return;
      if (scanAutomatically()) {
        lastScanned = frame;
        nextScan = now + 4000;
      }
    };
    let timer: number | undefined;
    const updateVisibility = () => {
      window.clearInterval(timer);
      previous = undefined;
      steadySamples = 0;
      if (document.hidden) automaticRequest.current?.abort();
      else timer = window.setInterval(sample, 500);
    };
    updateVisibility();
    document.addEventListener('visibilitychange', updateVisibility);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', updateVisibility);
      automaticRequest.current?.abort();
    };
  }, [autoIdentify, stream, video, target?.id, pinned]);

  useEffect(() => () => {
    request.current?.abort();
  }, []);
  useEffect(() => () => { liveRequest.current?.abort(); }, [stream]);
  useEffect(() => () => { automaticRequest.current?.abort(); }, [target?.id]);

  useEffect(() => {
    if (!preview) return;
    const url = URL.createObjectURL(preview);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [preview]);
  useEffect(() => {
    if (!firstAngle) { setFirstAngleUrl(''); return; }
    const url = URL.createObjectURL(firstAngle);
    setFirstAngleUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [firstAngle]);

  const barcode = result?.product?.barcode;
  const correction = barcode && result?.product_status !== 'conflicting' ?
    saved.find(record => record.barcode?.padStart(14, '0') === barcode.padStart(14, '0')) : undefined;
  const brand = correction?.brand || result?.brand?.name;
  const product = correction?.name || result?.product?.name;
  const verified = result?.product_status === 'verified';
  const variant = correction ? correction.variant : verified ? result?.product?.variant : null;
  const size = correction ? correction.capacity : verified ? result?.attributes?.capacity : null;
  const labelLines = result?.evidence
    ?.filter(item => item.kind === 'ocr' && item.confidence >= .65)
    .filter((item, index, lines) => lines.findIndex(line => line.value.toLowerCase() === item.value.toLowerCase()) === index)
    .slice(0, 4) ?? [];
  const barcodeMatch = Boolean(barcode && result?.evidence?.some(item =>
    item.kind === 'barcode' && item.value.padStart(14, '0') === barcode.padStart(14, '0')));
  const matchLabel = correction ? 'Saved by you' : result?.product_status === 'conflicting' ? 'Conflicting evidence'
    : product ? (result?.product_status === 'verified' ? (barcodeMatch ? 'Barcode match' : 'Verified match') : 'Possible match')
    : brand ? 'Brand only' : barcode ? 'Barcode only' : labelLines.length ? 'Read from label' : 'No product match';
  const scanGuidance = !autoIdentify || pinned || busy ? '' : guidance ||
    (result?.needs_more_evidence && !barcode && result.product_status !== 'conflicting' ? 'Show the barcode.' : '');
  useEffect(() => { onScanGuidance?.(scanGuidance); }, [onScanGuidance, scanGuidance]);

  const runCameraCommand = useEffectEvent((event: Event) => {
    const action = (event as CustomEvent<string>).detail;
    if (action === 'scan') { if (!pinned) void inspect(); }
    else if (action === 'pin') {
      if (result) { request.current?.abort(); setPinned(true); onShowDetails?.(); }
      else speakWithKokoro('Scan a product first.', { allowBargeIn: true });
    } else if (action === 'unpin') setPinned(false);
    else if (action === 'evidence') {
      onShowDetails?.();
      if (evidenceDisclosure.current) evidenceDisclosure.current.open = true;
    } else if (action === 'read-label' || action === 'read-size') {
      const answer = action === 'read-size'
        ? (size ? `The size is ${size}.` : 'The scan has no confirmed size.')
        : (labelLines.map(item => item.value).join('. ') || 'The scan has no readable label text.');
      speakWithKokoro(answer, { allowBargeIn: true });
    } else return;
    event.preventDefault();
  });
  const isSidebar = sidebarOpen !== undefined;
  useEffect(() => {
    if (!isSidebar) return;
    const listener = (event: Event) => runCameraCommand(event);
    window.addEventListener('oracle_camera_command', listener);
    return () => window.removeEventListener('oracle_camera_command', listener);
  }, [isSidebar]);

  async function lookup(online = false) {
    if (request.current || (!online && !query.trim())) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    setNotice('');
    setMatches([]);
    try {
      const response = await fetchWithAuth('/api/v1/vision/products/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(online ? { barcode, online: true } : { terms: [query.trim()] }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('Catalog search failed. Try again.');
      const data = await response.json();
      setMatches(data.results.slice(0, 3));
      setMatchSource(data.source === 'open_food_facts' ? 'Open Food Facts' : 'Local catalog');
      if (!data.results.length) setNotice('No catalog matches found.');
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Catalog search failed.');
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }

  function updateSaved(next: ProductRecord[]) {
    try {
      localStorage.setItem('oracle_saved_products', JSON.stringify(next));
      setSaved(next);
      setError('');
      return true;
    } catch {
      setError('Could not update saved products on this browser.');
      return false;
    }
  }

  return (
    <section className="camera-object-panel product-scanner" aria-label={isSidebar ? 'Product details' : 'Identify product'}
      id={isSidebar ? 'camera-product-details' : undefined} hidden={sidebarOpen === false}>
      <div className="camera-object-heading">
        <strong>{isSidebar ? 'Product details' : 'Identify product'}</strong>
        {onHideDetails && <button type="button" className="camera-footer-btn" onClick={onHideDetails}>Hide product details</button>}
      </div>
      <p>{target?.label ? `Scanning area · ${target.label}` : 'Center the front label or barcode in the camera.'}</p>
      <div className="product-scanner-actions">
        {stream && !isSidebar && <button type="button" className="camera-footer-btn primary" disabled={busy || pinned} onClick={() => void inspect()}>
          {result || error ? 'Scan again' : 'Scan product'}
        </button>}
        {result && isSidebar && <button type="button" className="camera-footer-btn" aria-pressed={pinned} disabled={busy}
          onClick={() => setPinned(value => !value)}>{pinned ? 'Unpin result' : 'Pin result'}</button>}
        {stream && result && preview && <button type="button" className="camera-footer-btn" disabled={busy || pinned}
          onClick={() => void inspect(undefined, false, true)}>Add another angle</button>}
        <button type="button" className={`camera-footer-btn${stream ? '' : ' primary'}`} disabled={busy || pinned} onClick={() => uploadInput.current?.click()}>
          Upload photo
        </button>
        <input ref={uploadInput} hidden aria-label="Upload photo" type="file" accept="image/jpeg,image/png" disabled={busy} onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) {
            setFilename(file.name);
            void inspect(file);
          }
        }} />
      </div>
      {filename && <span className="product-upload-filename">{filename}</span>}
      <p role="status">{busy ? (result ? 'Last scan · reading new evidence…' : 'Reading label or checking the catalog…')
        : error || notice || (result ? (pinned ? `Pinned · ${matchLabel}` : matchLabel) : 'Waiting for a scan')}</p>
      {!isSidebar && scanGuidance && <p>{scanGuidance}</p>}
      <div className="product-scanner-result">
        {result && <div>
          {product && <strong>{product}</strong>}
          {(detectedType || result.object_type) && <div>Object · {detectedType || result.object_type}</div>}
          {brand && <div>Brand · {brand}</div>}
          {!product && !brand && labelLines.length > 0 && (
            <div aria-label="Text read from label">
              {labelLines.map(item => <div key={item.value}>{item.value}</div>)}
            </div>
          )}
          {variant && <div>Variant · {variant}</div>}
          {size && <div>Size · {size}</div>}
          {barcode && <div>Barcode · {barcode}</div>}
          {result.knowledge?.source_type === 'local_catalog' && <div>Source · Local catalog</div>}
          {result.needs_more_evidence && <p>
            {result.product_status === 'conflicting' ? 'Scan one item at a time and check that its label and barcode agree.'
              : 'Try a closer photo of the front label or barcode.'}
          </p>}
          {!product && !brand && result.attributes?.visual_summary && <p>Visual hint · {result.attributes.visual_summary}</p>}
          <details ref={evidenceDisclosure}>
            <summary>Scan evidence</summary>
            {[firstAngleUrl, previewUrl].map((url, index) => url && (
              <figure className="product-evidence-image" key={url}>
                <img src={url} alt={firstAngleUrl ? `Product scan, angle ${index + 1}` : 'Captured product for inspection'} />
                {result.evidence?.filter(item => item.bounds && (item.angle ?? 0) === (firstAngleUrl ? index : 0))
                  .map((item, evidenceIndex) => {
                    const [left, top, width, height] = item.bounds!;
                    return <span key={evidenceIndex} title={item.value} aria-hidden="true" className="product-evidence-box"
                      style={{ left: `${left * 100}%`, top: `${top * 100}%`, width: `${width * 100}%`, height: `${height * 100}%` }} />;
                  })}
              </figure>
            ))}
            {result.knowledge?.source_type === 'local_catalog' && (
              <p>{barcodeMatch ? 'Barcode matched the local catalog.' : 'Product matched the local catalog.'}</p>
            )}
            {result.attributes?.visual_error && <p>Visual hint unavailable · {result.attributes.visual_error}</p>}
            <ul>{result.evidence?.map((item, index) => <li key={index}>
              {item.kind === 'ocr' ? 'Text read from label'
                : item.kind === 'barcode' ? 'Barcode read from image'
                : item.kind === 'vlm' ? `Visual hint${item.source ? ` (${item.source})` : ''}`
                : item.kind === 'object_detection' ? 'Object detected'
                : item.kind === 'catalog' ? 'Catalog evidence'
                : item.kind === 'logo' ? 'Logo detected' : 'Scan evidence'} · {item.value}
            </li>)}</ul>
          </details>
          {result.candidates?.filter(candidate => !product || candidate.record.name !== product).slice(0, 3)
            .map(({ record }) => <button key={record.id} type="button" disabled={busy} onClick={() => setDraft(record)}>
              {record.brand} {record.name} {record.variant} {record.capacity}
            </button>)}
          <button type="button" disabled={busy} onClick={() => setDraft({
            id: '', name: product || '', brand, variant: result.product?.variant,
            capacity: size, barcode,
          })}>{product ? 'Correct or save product' : 'Enter product manually'}</button>
          {barcode && !product && <div>
            <button type="button" disabled={busy} onClick={() => void lookup(true)}>
              Look up barcode online
            </button>
            <p>Shares the barcode with Open Food Facts.</p>
          </div>}
        </div>}
      </div>
      <details className="product-catalog-search">
        <summary>Search catalog</summary>
        <form className="product-scanner-actions" onSubmit={(event) => { event.preventDefault(); void lookup(); }}>
          <label>Search local catalog <input value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <button type="submit" className="camera-footer-btn" disabled={busy || !query.trim()}>Search</button>
        </form>
      </details>
      {matches.length > 0 && <div>Source · {matchSource}
        <ul>{matches.map((record) => <li key={record.id}><button type="button" onClick={() => setDraft(record)}>
          {record.brand} {record.name} {record.variant} {record.capacity}
        </button></li>)}</ul>
      </div>}
      {draft && <form className="product-scanner-actions" onSubmit={(event) => {
        event.preventDefault();
        const name = draft.name.trim();
        if (!name) return;
        const id = draft.barcode?.padStart(14, '0') || JSON.stringify([draft.brand, name, draft.variant, draft.capacity]
          .map((value) => (value || '').trim().toLowerCase()));
        if (updateSaved([...saved.filter((record) => record.id !== id), { ...draft, name, id }])) {
          setDraft(null);
          setNotice('Product saved on this browser.');
        }
      }}>
        <label>Product <input required maxLength={300} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>Brand <input maxLength={200} value={draft.brand || ''} onChange={(event) => setDraft({ ...draft, brand: event.target.value })} /></label>
        <label>Variant <input maxLength={300} value={draft.variant || ''} onChange={(event) => setDraft({ ...draft, variant: event.target.value })} /></label>
        <label>Size <input maxLength={100} value={draft.capacity || ''} onChange={(event) => setDraft({ ...draft, capacity: event.target.value })} /></label>
        <button type="submit" disabled={busy}>Save product</button>
        <button type="button" onClick={() => setDraft(null)}>Cancel</button>
      </form>}
      {saved.length > 0 && <details>
        <summary>Saved products ({saved.length})</summary>
        <ul>{saved.map((record) => <li key={record.id}>
          {record.brand} {record.name} {record.variant} {record.capacity}{' '}
          <button type="button" aria-label={`Delete ${record.name}`} onClick={() => updateSaved(saved.filter((item) => item.id !== record.id))}>Delete</button>
        </li>)}</ul>
      </details>}
    </section>
  );
}
