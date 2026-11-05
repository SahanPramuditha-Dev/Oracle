import React from 'react';
import { useCurrentUser } from '../utils/currentUser';
import { motion } from 'framer-motion';
import { OracleMode, MODE_NAMES } from '../types';
import { TimeState } from '../App';
import { SensorIndicators } from './SensorIndicators';
import { MicOff } from 'lucide-react';

export interface VoiceEngineHeaderInfo {
  active: boolean;
  isListening: boolean;
  mode: string;
  vadStatus: string;
}
import { SensorsTelemetry } from '../hooks/useSensors';

interface PresenceHeaderProps {
  mode: OracleMode;
  time: TimeState;
  sensors: SensorsTelemetry;
  voiceEngine?: VoiceEngineHeaderInfo;
  onMuteVoice?: () => void;
  onSleep: (e: React.MouseEvent) => void;
  onInitialize?: () => void;
  onOpenChat?: () => void;
  onOpenRecords?: () => void;
  onOpenSettings?: () => void;
}

export const PresenceHeader: React.FC<PresenceHeaderProps> = ({ mode, time, sensors, voiceEngine, onMuteVoice, onSleep, onInitialize, onOpenChat, onOpenRecords, onOpenSettings }) => {
  const currentUser = useCurrentUser();
  const isDormant = mode === 'dormant';
  const isInitializing = mode === 'initializing';

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

      {/* Docked Clock in Header (50% Center) with Silky Quintic Morph Transition - Hidden during initialization */}
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
                {time.hours}:{time.minutes}:{time.seconds}
              </span>
            </motion.div>
          )}
        </div>
      )}

      {/* Sensory Telemetry Indicators - Hidden during initialization */}
      {!isInitializing && (
        <div className="header-right">
          <span className="hud-chip" aria-label="Current user">{currentUser ? `${currentUser.name} · ${currentUser.permission === 'administrator' ? 'Administrator' : 'Standard user'}` : 'No user identified'}</span>
          <button className="hud-chip" onClick={onOpenRecords}>Workspace</button>

          {/* Hands-Free Voice Status Dock */}
          {voiceEngine?.active && (
            <div
              className={`voice-dock-chip ${voiceEngine.isListening ? 'listening' : ''}`}
              onClick={onOpenChat}
              role="button"
              tabIndex={0}
              title="Voice Engine Active — Click to open Chat Drawer"
            >
              <div className="voice-dock-bars">
                <span className="v-bar v-bar-1" />
                <span className="v-bar v-bar-2" />
                <span className="v-bar v-bar-3" />
              </div>
              <span className="voice-dock-label">
                {voiceEngine.isListening ? 'LISTENING' : voiceEngine.mode === 'wake' ? 'VOICE LINK' : 'CONVERSATION'}
              </span>
              <button
                type="button"
                className="voice-dock-mute"
                onClick={(e) => {
                  e.stopPropagation();
                  onMuteVoice?.();
                }}
                title="Mute Hands-Free Voice Engine (Return to Push-to-Talk)"
                aria-label="Mute Voice"
              >
                <MicOff size={11} strokeWidth={2} />
              </button>
            </div>
          )}

          <SensorIndicators sensors={sensors} isDormant={isDormant} onOpenChat={onOpenChat} onOpenSettings={onOpenSettings} />

          <div
            className="status"
            onClick={onInitialize}
            title="Click to trigger system initialization (or press I)"
            style={{ cursor: 'pointer' }}
            role="button"
            tabIndex={0}
          >
            <span className="status-led" aria-hidden="true" />
            <span id="status-label">{MODE_NAMES[mode]}</span>
            <button
              className="sleep-btn"
              id="sleep"
              aria-label="Enter dormant mode"
              title="Enter dormant mode (D)"
              onClick={onSleep}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </header>
  );
};
