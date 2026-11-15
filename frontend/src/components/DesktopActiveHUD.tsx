import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Minus, Square, Minimize2, X, RefreshCw, Monitor, Check } from 'lucide-react';
import { localApi } from '../utils/api';
import { sfx } from '../utils/sfx';
import './DesktopActiveHUD.css';

export interface DesktopWindowItem {
  hwnd: number;
  title: string;
  process: string;
  app_name: string;
  pid: number;
  memory_mb: number;
  is_active: boolean;
  is_minimized: boolean;
  is_maximized: boolean;
  rect: { x: number; y: number; w: number; h: number };
}

interface DesktopActiveHUDProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DesktopActiveHUD: React.FC<DesktopActiveHUDProps> = ({ isOpen, onClose }) => {
  const [windows, setWindows] = useState<DesktopWindowItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Default positioning: docked smoothly on the right side of the screen
  const [position, setPosition] = useState<{ x: number; y: number }>({
    x: Math.max(20, typeof window !== 'undefined' ? window.innerWidth - 470 : 800),
    y: 88
  });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; startX: number; startY: number }>({
    mouseX: 0, mouseY: 0, startX: 0, startY: 0
  });

  const fetchWindows = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    try {
      const data = await localApi<{ windows: DesktopWindowItem[]; active: any }>('desktop/windows');
      if (data && Array.isArray(data.windows)) {
        setWindows(data.windows);
      }
    } catch (err) {
      console.warn('Failed to fetch desktop windows:', err);
    } finally {
      if (!isSilent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void fetchWindows();
      sfx.playTelemetryCardSweep();
      const interval = setInterval(() => {
        void fetchWindows(true);
      }, 4000);
      return () => clearInterval(interval);
    }
  }, [isOpen, fetchWindows]);

  const handleFocus = async (hwnd: number, appName: string) => {
    sfx.playDiagnosticBlip(2);
    try {
      await localApi('desktop/windows/focus', 'POST', { hwnd });
      setActionNotice(`Focused ${appName}`);
      setTimeout(() => setActionNotice(null), 2500);
      void fetchWindows(true);
    } catch (err: any) {
      setActionNotice(`Focus error: ${err.message || 'Failed'}`);
      setTimeout(() => setActionNotice(null), 2500);
    }
  };

  const handleTile = async (hwnd: number, side: 'left' | 'right', appName: string) => {
    sfx.playDiagnosticBlip(1);
    try {
      await localApi('desktop/windows/tile', 'POST', { hwnd, side });
      setActionNotice(`Snapped ${appName} to ${side.toUpperCase()}`);
      setTimeout(() => setActionNotice(null), 2500);
      void fetchWindows(true);
    } catch (err: any) {
      setActionNotice(`Tile error: ${err.message || 'Failed'}`);
      setTimeout(() => setActionNotice(null), 2500);
    }
  };

  const handleWindowState = async (hwnd: number, state: 'minimize' | 'maximize' | 'close', appName: string) => {
    sfx.playPneumaticLock();
    try {
      await localApi('desktop/windows/state', 'POST', { hwnd, state });
      setActionNotice(`${state.toUpperCase()} sent to ${appName}`);
      setTimeout(() => setActionNotice(null), 2500);
      void fetchWindows(true);
    } catch (err: any) {
      setActionNotice(`Action error: ${err.message || 'Failed'}`);
      setTimeout(() => setActionNotice(null), 2500);
    }
  };

  // Drag handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (isMaximized) return;
    isDraggingRef.current = true;
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      startX: position.x,
      startY: position.y
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - dragStartRef.current.mouseX;
    const dy = e.clientY - dragStartRef.current.mouseY;
    const nextX = Math.max(16, Math.min(window.innerWidth - 320, dragStartRef.current.startX + dx));
    const nextY = Math.max(50, Math.min(window.innerHeight - 200, dragStartRef.current.startY + dy));
    setPosition({ x: nextX, y: nextY });
  }, []);

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  }, [handleMouseMove]);

  if (!isOpen) return null;

  // Minimized Floating Pill View
  if (isMinimized) {
    return (
      <div
        className="oracle-desktop-dock-pill"
        onClick={() => {
          sfx.playBiometricLockChime();
          setIsMinimized(false);
        }}
        title="Click to restore Desktop Active HUD"
      >
        <span className="dock-pill-indicator" />
        <Monitor size={13} strokeWidth={2} />
        <span>DESKTOP // {windows.length} APPS ACTIVE</span>
      </div>
    );
  }

  // Segmented progress blocks
  const totalBlocks = 16;
  const activeCount = windows.length;
  const activeBlocks = Math.min(totalBlocks, Math.max(3, Math.round((activeCount / 8) * totalBlocks)));
  const totalRamMb = windows.reduce((acc, w) => acc + (w.memory_mb || 0), 0);

  return (
    <div
      className="oracle-desktop-hud"
      style={{
        left: isMaximized ? '32px' : `${position.x}px`,
        top: isMaximized ? '84px' : `${position.y}px`,
        width: isMaximized ? 'calc(100vw - 64px)' : '440px',
        maxWidth: isMaximized ? '960px' : '440px',
        height: isMaximized ? 'calc(100vh - 140px)' : 'auto'
      }}
    >
      {/* Top Header & Drag Handle */}
      <div className="hud-header" onMouseDown={handleMouseDown}>
        <div className="hud-header-left">
          <span className="hud-category-tag">APPLICATIONS //</span>
          <span className="hud-counter-pill">{String(windows.length).padStart(2, '0')} ACTIVE</span>
        </div>

        <div className="hud-header-actions" onMouseDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="hud-icon-btn"
            onClick={() => {
              sfx.playMeterTick();
              void fetchWindows();
            }}
            title="Refresh open windows"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            className="hud-icon-btn"
            onClick={() => {
              sfx.playPneumaticLock();
              setIsMinimized(true);
            }}
            title="Minimize to dock pill"
          >
            <Minus size={12} />
          </button>
          <button
            type="button"
            className="hud-icon-btn"
            onClick={() => {
              sfx.playDiagnosticBlip(0);
              setIsMaximized(!isMaximized);
            }}
            title={isMaximized ? 'Restore standard view' : 'Maximize window'}
          >
            {isMaximized ? <Minimize2 size={12} /> : <Square size={12} />}
          </button>
          <button
            type="button"
            className="hud-icon-btn close"
            onClick={() => {
              sfx.playStasisHum();
              onClose();
            }}
            title="Close"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Hologram Banner (State of Desktop) */}
      <div className="hud-title-banner">
        <div className="hud-banner-top">
          <div className="hud-main-title">STATE OF DESKTOP</div>
        </div>
        <div className="hud-sub-title">ACTIVE WORKSPACE TELEMETRY</div>

        {/* Progress Block Segments */}
        <div className="hud-progress-block-track">
          {Array.from({ length: totalBlocks }).map((_, i) => (
            <div
              key={i}
              className={`hud-block-seg ${i < activeBlocks ? (i < 4 ? 'active' : 'semi') : ''}`}
            />
          ))}
        </div>

        <div className="hud-banner-meta">
          <span># {windows.length} APPS</span>
          <span># {Math.round(totalRamMb)} MB RAM</span>
          <span className="accent">0x8468 · {((totalRamMb / 16384) * 100).toFixed(1)}%</span>
        </div>
      </div>

      {/* Action Notification Toast */}
      {actionNotice && (
        <div
          style={{
            padding: '7px 18px',
            background: 'rgba(157, 180, 211, 0.08)',
            borderBottom: '1px solid rgba(157, 180, 211, 0.18)',
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            color: 'var(--accent)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          <Check size={12} />
          <span>{actionNotice}</span>
        </div>
      )}

      {/* Body: Open Window List */}
      <div className="hud-body">
        {windows.length === 0 ? (
          <div
            style={{
              padding: '28px 0',
              textAlign: 'center',
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--muted)'
            }}
          >
            {loading ? 'SCANNING DESKTOP THREADS...' : 'NO ACTIVE APPLICATION WINDOWS DETECTED'}
          </div>
        ) : (
          windows.map((win) => (
            <div
              key={win.hwnd}
              className={`hud-app-item ${win.is_active ? 'active-window' : ''}`}
            >
              <div className="hud-app-topline">
                <div className="hud-app-badge">
                  <span className="hud-app-name">{win.app_name}</span>
                  {win.is_active && <span className="hud-active-tag">ACTIVE</span>}
                </div>
                <span className="hud-app-mem">PID {win.pid} · {win.memory_mb} MB</span>
              </div>

              <div className="hud-app-title" title={win.title}>
                {win.title}
              </div>

              <div className="hud-app-actions">
                <button
                  type="button"
                  className="hud-action-btn primary"
                  onClick={() => handleFocus(win.hwnd, win.app_name)}
                  title="Bring window to front"
                >
                  Focus
                </button>
                <button
                  type="button"
                  className="hud-action-btn"
                  onClick={() => handleTile(win.hwnd, 'left', win.app_name)}
                  title="Snap to left half"
                >
                  Tile L
                </button>
                <button
                  type="button"
                  className="hud-action-btn"
                  onClick={() => handleTile(win.hwnd, 'right', win.app_name)}
                  title="Snap to right half"
                >
                  Tile R
                </button>
                <button
                  type="button"
                  className="hud-action-btn"
                  onClick={() => handleWindowState(win.hwnd, 'minimize', win.app_name)}
                  title="Minimize window"
                >
                  Min
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="hud-footer">
        <span className="hud-footer-stat">
          SYS // <strong>RUNNING</strong>
        </span>
        <span className="hud-footer-stat">
          TOTAL CONSUMPTION: <strong>{(totalRamMb / 1024).toFixed(2)} GB</strong>
        </span>
      </div>
    </div>
  );
};
