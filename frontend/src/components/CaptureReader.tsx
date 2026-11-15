import { useEffect, useRef, useState } from 'react';
import {
  Scan,
  X,
  ShieldCheck,
  Crop,
  FileText,
  Bookmark,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Camera,
  Upload,
  Square
} from 'lucide-react';
import { fetchWithAuth, localApi, readJson } from '../utils/api';

interface CaptureReaderProps {
  image: Blob;
  source: 'camera' | 'file';
  onClose?: () => void;
  onActionPrompt?: (prompt: string) => void;
}

export function CaptureReader({
  image,
  source,
  onClose,
  onActionPrompt
}: CaptureReaderProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0, width: 100, height: 100 });
  const [showCrop, setShowCrop] = useState(false);
  const [text, setText] = useState('');
  const [original, setOriginal] = useState('');
  const [title, setTitle] = useState('');
  const [qr, setQr] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [operation, setOperation] = useState<'read' | 'save' | null>(null);
  const busy = operation !== null;
  const validCrop = crop.width >= 1 && crop.height >= 1 && crop.x + crop.width <= 100 && crop.y + crop.height <= 100;
  const controller = useRef<AbortController | null>(null);
  const [preview, setPreview] = useState('');

  useEffect(() => {
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => {
      URL.revokeObjectURL(url);
      controller.current?.abort();
    };
  }, [image]);

  async function read() {
    const request = new AbortController();
    controller.current = request;
    setOperation('read');
    setStatus('Analyzing visual frame with local OCR…');
    try {
      const params = new URLSearchParams(
        Object.entries(crop).map(([k, v]) => [k, String(v)])
      );
      const data = await readJson<{ text: string; qr: string[]; truncated?: boolean }>(
        await fetchWithAuth(`/api/v1/images/read?${params}`, {
          method: 'POST',
          headers: { 'Content-Type': image.type || 'image/jpeg' },
          body: image,
          signal: request.signal
        })
      );
      if (!request.signal.aborted) {
        setText(data.text);
        setOriginal(data.text);
        setQr(data.qr);
        setStatus(
          data.truncated ? 'Text was shortened. Crop a smaller area to read the rest.' : data.text || data.qr.length
            ? 'Analysis complete. Review extracted data below.'
            : 'No text or QR decoded. Adjust crop or lighting.'
        );
      }
    } catch (error) {
      if (!request.signal.aborted) setStatus(String(error));
    } finally {
      if (controller.current === request) {
        controller.current = null;
        setOperation(null);
      }
    }
  }

  async function save(memory: boolean) {
    const request = new AbortController();
    controller.current = request;
    setOperation('save');
    try {
      if (memory) {
        const form = new FormData();
        form.append('image', image, 'image');
        form.append('title', title);
        form.append('text', text);
        form.append('ocr_text', original);
        form.append('source', source);
        await readJson(
          await fetchWithAuth('/api/v1/memories', {
            method: 'POST',
            body: form,
            signal: request.signal
          })
        );
      } else {
        await localApi('notes', 'POST', { title, text }, request.signal);
      }
      if (!request.signal.aborted) {
        setStatus(
          memory ? '✓ Visual memory archived.' : '✓ Note saved locally.'
        );
      }
    } catch (error) {
      if (!request.signal.aborted) setStatus(String(error));
    } finally {
      if (controller.current === request) {
        controller.current = null;
        setOperation(null);
      }
    }
  }

  function handleCancelRequest() {
    controller.current?.abort();
    controller.current = null;
    setOperation(null);
    setStatus('Analysis cancelled.');
  }

  return (
    <section className="capture-reader" aria-label="Visual Analysis & OCR">
      {/* Top Meta Bar */}
      <div className="capture-reader-header">
        <div className="capture-header-tags">
          <span className="capture-badge">
            <ShieldCheck size={11} className="capture-badge-icon" />
            <span>Local & Private</span>
          </span>
          <span className="capture-source-tag">
            {source === 'camera' ? (
              <>
                <Camera size={11} /> Snapshot
              </>
            ) : (
              <>
                <Upload size={11} /> Uploaded File
              </>
            )}
          </span>
        </div>
        {onClose && (
          <button
            type="button"
            className="capture-dismiss-btn"
            onClick={onClose}
            title="Discard image"
            aria-label="Discard image"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* Visual Frame with Crop Overlay */}
      <div className="crop-preview-container">
        <div className="crop-preview">
          <img src={preview} alt="Staged snapshot for analysis" />
          <div
            className="crop-selection-rect"
            style={{
              left: `${crop.x}%`,
              top: `${crop.y}%`,
              width: `${crop.width}%`,
              height: `${crop.height}%`
            }}
          />
        </div>
      </div>

      {/* Action Control Strip */}
      <div className="capture-actions-bar">
        <button
          type="button"
          disabled={busy || !validCrop || !preview}
          onClick={() => void read()}
          className="capture-action-btn primary"
        >
          <Scan size={12} />
          <span>{operation === 'read' ? 'Reading…' : 'Read Text & QR'}</span>
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={() => setShowCrop((prev) => !prev)}
          className={`capture-action-btn ${showCrop ? 'active' : ''}`}
          title="Toggle Crop Coordinates"
        >
          <Crop size={12} />
          <span>Crop</span>
          {showCrop ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </button>

        {onActionPrompt && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => onActionPrompt('Describe what you see in this snapshot.')}
              className="capture-action-btn"
              title="Ask Oracle to describe scene"
            >
              <Sparkles size={12} />
              <span>Describe</span>
            </button>
          </>
        )}

        {operation === 'read' && (
          <button
            type="button"
            onClick={handleCancelRequest}
            className="capture-action-btn danger"
            title="Stop processing"
          >
            <Square size={11} />
            <span>Stop</span>
          </button>
        )}
      </div>

      {/* Collapsible Crop Settings */}
      {showCrop && (
        <fieldset disabled={busy} className="capture-crop-panel">
          <legend>Crop Region Coordinates (%)</legend>
          <div className="crop-inputs">
            {(['x', 'y', 'width', 'height'] as const).map((key) => (
              <label key={key}>
                <span>{key.toUpperCase()}</span>
                <input
                  aria-label={`Crop ${key}`}
                  type="number"
                  min={key === 'x' || key === 'y' ? 0 : 1}
                  max={100}
                  value={crop[key]}
                  onChange={(e) => {
                    const minimum = key === 'x' || key === 'y' ? 0 : 1;
                    setCrop({ ...crop, [key]: Math.min(100, Math.max(minimum, Number(e.target.value))) });
                    setStatus('');
                    setText('');
                    setOriginal('');
                    setQr([]);
                  }}
                />
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {!validCrop && <p role="status">Reduce the crop size or offset to keep it inside the image.</p>}

      {/* Status Notice */}
      {status && (
        <div className="capture-status-notice" role="status">
          <span className="capture-status-dot" />
          <span>{status}</span>
        </div>
      )}

      {/* QR Codes Discovered */}
      {qr.length > 0 && (
        <div className="capture-qr-results">
          <span className="capture-section-label">Decoded Barcodes / QR</span>
          {qr.map((payload, index) => (
            <pre className="qr-preview" key={index}>
              {payload}
            </pre>
          ))}
        </div>
      )}

      {/* Text Editing & Memory Archival (Shown when extracted or titled) */}
      {preview && (
        <div className="capture-edit-section">
          <label className="capture-field-group">
            <span className="capture-field-label">Reference Title</span>
            <input
              type="text"
              className="capture-input"
              placeholder="e.g. Serial tag, Receipt, Component specs"
              value={title}
              disabled={busy}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>

          <label className="capture-field-group" htmlFor="image-description">
            <span className="capture-field-label">Text or image description</span>
            <textarea
              id="image-description"
              className="capture-textarea"
              placeholder="Text decoded from image..."
              value={text}
              disabled={busy}
              maxLength={12000}
              onChange={(e) => setText(e.target.value)}
            />
          </label>

          <div className="record-buttons">
            <button
              type="button"
              disabled={busy || !title.trim() || !text.trim()}
              onClick={() => void save(false)}
              className="capture-save-btn"
            >
              <FileText size={12} />
              <span>Save as Note</span>
            </button>
            <button
              type="button"
              disabled={busy || !title.trim() || !text.trim()}
              onClick={() => void save(true)}
              className="capture-save-btn primary"
            >
              <Bookmark size={12} />
              <span>Archive Memory</span>
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
