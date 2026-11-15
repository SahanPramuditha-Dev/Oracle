import React, { useState, useEffect, useRef } from 'react';
import { useCurrentUser } from '../utils/currentUser';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { OracleMode, MODE_NAMES } from '../types';
import { usePresenceClock } from '../hooks/usePresenceClock';
import { SensorIndicators } from './SensorIndicators';
import { Shield, ShieldCheck, PanelsTopLeft, LayoutGrid, Navigation, ScanLine, Check, ChevronDown, Sliders, Moon, MessageSquare } from 'lucide-react';
import { SensorsTelemetry } from '../hooks/useSensors';

export interface VoiceEngineHeaderInfo {
  active: boolean;
  isListening: boolean;
  mode: string;
  vadStatus: string;
}

interface PresenceHeaderProps {
  mode: OracleMode;
  sensors: SensorsTelemetry;
  voiceEngine?: VoiceEngineHeaderInfo;
  onMuteVoice?: () => void;
  onSleep: (e: React.MouseEvent) => void;
  onOpenChat?: () => void;
  onOpenRecords?: () => void;
  isWorkspaceOpen?: boolean;
  onOpenSettings?: () => void;
  onOpenProducts?: () => void;
  onOpenMaps?: () => void;
  isMapOpen?: boolean;
  onOpenAdminProtocol?: () => void;
  onSignOutAdmin?: () => void;
  lockdownStatus?: string | null;
  sentinelEvents?: string[];
  onStopSentinel?: () => void;
  isAdmin?: boolean;
}

export const PresenceHeader: React.FC<PresenceHeaderProps> = ({
  mode,
  sensors,
  voiceEngine: _voiceEngine,
  onMuteVoice: _onMuteVoice,
  onSleep,
  onOpenChat,
  onOpenRecords,
  isWorkspaceOpen,
  onOpenSettings,
  onOpenProducts,
  onOpenMaps,
  isMapOpen,
  onOpenAdminProtocol,
  onSignOutAdmin,
  lockdownStatus,
  sentinelEvents,
  onStopSentinel,
  isAdmin,
}) => {
  const { time } = usePresenceClock();
  const currentUser = useCurrentUser();
  const isDormant = mode === 'dormant';
  const isInitializing = mode === 'initializing';
  const isUserAdmin = isAdmin ?? currentUser?.permission === 'administrator';
  const [openPanel, setOpenPanel] = useState<'applications' | 'status' | 'settings' | null>(null);
  const panelTrigger = useRef<HTMLButtonElement>(null);
  const applicationsPanel = useRef<HTMLDivElement>(null);
  const focusFirstApplication = useRef(false);
  const isApplicationsOpen = openPanel === 'applications';
  const statusTrigger = useRef<HTMLButtonElement>(null);
  const sentinelVisible = sentinelEvents !== undefined;
  useEffect(() => {
    if (sentinelVisible && statusTrigger.current) {
      panelTrigger.current = statusTrigger.current;
      setOpenPanel('status');
    }
  }, [sentinelVisible]);
  const reduceMotion = useReducedMotion();

  const togglePanel = (panel: NonNullable<typeof openPanel>, event: React.MouseEvent<HTMLButtonElement>) => {
    panelTrigger.current = event.currentTarget;
    focusFirstApplication.current = panel === 'applications' && !isApplicationsOpen && event.detail === 0;
    setOpenPanel(openPanel === panel ? null : panel);
  };

  useEffect(() => {
    if (!isApplicationsOpen || !focusFirstApplication.current) return;
    focusFirstApplication.current = false;
    applicationsPanel.current?.querySelector('button')?.focus();
  }, [isApplicationsOpen]);

  useEffect(() => {
    if (!openPanel) return;
    const closeOutside = (event: PointerEvent) => {
      if (!panelTrigger.current?.parentElement?.contains(event.target as Node)) setOpenPanel(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      setOpenPanel(null);
      panelTrigger.current?.focus();
    };
    document.addEventListener('pointerdown', closeOutside);
    window.addEventListener('keydown', closeOnEscape, true);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [openPanel]);

  useEffect(() => {
    if (isDormant || isInitializing) setOpenPanel(null);
  }, [isDormant, isInitializing]);

  const openChat = () => {
    sensors.pingChat();
    onOpenChat?.();
  };

  const clearance = isUserAdmin
    ? `${currentUser?.name || 'Administrator'} · Admin Level 5`
    : currentUser ? `${currentUser.name} · Standard` : 'Normal Operator · Restricted';

  return (
    <header className="header">
      <div className="brand" aria-label="ORACLE">
        <svg className="brand-symbol" viewBox="0 0 24 24" aria-hidden="true" fill="none">
          <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth="1.1" opacity="0.85" />
          <ellipse
            cx="12"
            cy="12"
            rx="10.7"
            ry="3.5"
            transform="rotate(-34 12 12)"
            stroke="currentColor"
            strokeWidth="0.85"
            opacity="0.55"
          />
          <circle cx="18.85" cy="7.15" r="1.45" fill="currentColor" />
        </svg>
        <div>
          <div className="brand-name">ORACLE</div>
          <span className="brand-sub">INTELLIGENT PRESENCE</span>
        </div>
      </div>

      {/* Clock dock for the shared transition between the header and footer. */}
      {!isInitializing && (
        <div className="header-dock">
          {!isDormant && (
            <motion.div
              layoutId="oracle-clock-chronometer"
              className="clock-docked"
              transition={{
                duration: 0.85,
                ease: [0.16, 1, 0.3, 1]
              }}
              aria-label="Current time"
            >
              <span className="clock-docked-main">
                {time}
              </span>
            </motion.div>
          )}
        </div>
      )}

      {/* Sensory Telemetry Indicators - Hidden during initialization */}
      {!isInitializing && (
        <div className="header-right">
          {/* Direct Workspace Action Button */}
          {onOpenRecords && (
            <button
              type="button"
              className={`hud-chip workspace-header-chip ${isWorkspaceOpen ? 'active' : ''}`}
              onClick={onOpenRecords}
              title="Open Workspace (W)"
              aria-label="Workspace"
            >
              <PanelsTopLeft size={15} aria-hidden="true" />
              <span className="header-nav-label">Workspace</span>
            </button>
          )}

          <div className="header-workspace-dropdown-wrap">
            <button
              type="button"
              className="hud-chip workspace-header-chip"
              onClick={(event) => togglePanel('applications', event)}
              aria-expanded={isApplicationsOpen}
              aria-controls={isApplicationsOpen ? 'presence-applications' : undefined}
              title="Open applications"
              aria-label="Applications Menu"
            >
              <LayoutGrid size={15} aria-hidden="true" />
              <span className="header-nav-label">Applications</span>
              <ChevronDown
                aria-hidden="true"
                size={10}
                strokeWidth={2}
                style={{
                  marginLeft: 4,
                  transform: isApplicationsOpen ? 'rotate(180deg)' : 'none',
                  transition: reduceMotion ? 'none' : 'transform 0.2s ease',
                  opacity: 0.75
                }}
              />
            </button>

            <AnimatePresence>
              {isApplicationsOpen && (
                <motion.div
                  ref={applicationsPanel}
                  id="presence-applications"
                  className="applications-dropdown-menu applications-launcher"
                  initial={{ opacity: 0, y: reduceMotion ? 0 : -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: reduceMotion ? 0 : -4 }}
                  transition={{ duration: reduceMotion ? 0 : 0.16, ease: [0.16, 1, 0.3, 1] }}
                >
                  {onOpenProducts && (
                    <button type="button" className="applications-dropdown-item"
                      onClick={() => { setOpenPanel(null); onOpenProducts(); }}>
                      <ScanLine size={16} aria-hidden="true" />
                      <span>Identify product</span>
                    </button>
                  )}
                  {onOpenMaps && (
                    <button
                      type="button"
                      onClick={() => { setOpenPanel(null); onOpenMaps(); }}
                      className="applications-dropdown-item"
                      aria-pressed={Boolean(isMapOpen)}
                    >
                      <Navigation size={16} aria-hidden="true" />
                      <span>Atlas Map</span>
                      {isMapOpen && <Check size={14} className="applications-active-mark" aria-hidden="true" />}
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <SensorIndicators sensors={sensors} isDormant={isDormant} onOpenChat={openChat} />

          <div className="header-toolbar-panel">
            <button
              type="button"
              className="hud-chip header-status-chip"
              ref={statusTrigger}
              aria-expanded={openPanel === 'status'}
              aria-controls={openPanel === 'status' ? 'presence-status' : undefined}
              onClick={(event) => togglePanel('status', event)}
            >
              <span className="status-led" aria-hidden="true" />
              <span id="status-label">{MODE_NAMES[mode]}</span>
              {isAdmin === true && <span title="Admin Protocol is active">Admin active</span>}
              <ChevronDown size={11} aria-hidden="true" />
            </button>
            {openPanel === 'status' && (
              <div className="applications-dropdown-menu" id="presence-status">
                <div className="applications-dropdown-header">{clearance}</div>
                {lockdownStatus && <p role="status">{lockdownStatus}</p>}
                {sentinelEvents && (
                  <details open>
                    <summary>Sentinel activity</summary>
                    <ul>
                      {sentinelEvents.map((event, index) => <li key={index}>{event}</li>)}
                    </ul>
                    <button type="button" className="applications-dropdown-item" onClick={onStopSentinel}>Stop Sentinel</button>
                  </details>
                )}
                <dl className="header-service-list">
                  {[sensors.mic, sensors.camera, sensors.chat].map(({ label, detail }) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{detail}</dd>
                    </div>
                  ))}
                </dl>
                {onOpenAdminProtocol && (
                  <button type="button" className="applications-dropdown-item"
                    onClick={() => { setOpenPanel(null); onOpenAdminProtocol(); }}>
                    {isUserAdmin ? <ShieldCheck size={15} /> : <Shield size={15} />}
                    {isUserAdmin ? 'Re-verify administrator clearance' : 'Activate Admin Protocol'}
                  </button>
                )}
                {isUserAdmin && onSignOutAdmin && (
                  <button type="button" className="applications-dropdown-item"
                    onClick={() => { setOpenPanel(null); onSignOutAdmin(); }}>
                    <Shield size={15} />
                    End administrator clearance
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="header-toolbar-panel">
            <button
              type="button"
              className="hud-chip header-settings-chip"
              aria-label="Settings"
              title="Settings"
              aria-expanded={openPanel === 'settings'}
              aria-controls={openPanel === 'settings' ? 'presence-settings' : undefined}
              onClick={(event) => togglePanel('settings', event)}
            >
              <Sliders size={15} aria-hidden="true" />
            </button>
            {openPanel === 'settings' && (
              <div className="applications-dropdown-menu" id="presence-settings">
                {onOpenSettings && (
                  <button type="button" className="applications-dropdown-item"
                    aria-label="Open System Settings & Biometrics"
                    onClick={() => { setOpenPanel(null); onOpenSettings(); }}>
                    <Sliders size={15} aria-hidden="true" />
                    System settings
                  </button>
                )}
                {onOpenChat && (
                  <button type="button" className="applications-dropdown-item header-chat-overflow"
                    onClick={() => { setOpenPanel(null); openChat(); }}>
                    <MessageSquare size={15} aria-hidden="true" />
                    Open chat
                  </button>
                )}
                <button type="button" id="sleep" className="applications-dropdown-item"
                  title="Enter dormant mode (D)"
                  onClick={(event) => { setOpenPanel(null); onSleep(event); }}>
                  <Moon size={15} aria-hidden="true" />
                  Enter dormant mode
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
};
