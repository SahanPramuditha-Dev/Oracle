import React from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import type { UserVoiceCaption } from './ConversationHUD';
import { OracleMode, HINTS } from '../types';
import { usePresenceClock } from '../hooks/usePresenceClock';

interface PresenceFooterProps {
  mode: OracleMode;
  onWake: () => void;
  hideHint?: boolean;
  speechMode?: string;
  userCaption?: UserVoiceCaption | null;
  oracleCaption?: string | null;
  oracleSpeaking?: boolean;
  voiceError?: string;
}

export const PresenceFooter: React.FC<PresenceFooterProps> = ({ mode, onWake, hideHint = false, speechMode, userCaption, oracleCaption, oracleSpeaking, voiceError }) => {
  const { time, dateStr } = usePresenceClock();
  const reduceMotion = useReducedMotion();
  if (mode === 'initializing') {
    return null;
  }

  const isDormant = mode === 'dormant';

  return (
    <footer className="footer" data-awake={!isDormant}>
      {/* Ambient Large Clock in Dormant Mode - Silky Quintic Morph Transition */}
      <div className="footer-clock-anchor">
        {isDormant && (
          <motion.div
            layoutId="oracle-clock-chronometer"
            className="clock-ambient"
            transition={{
              duration: 0.85,
              ease: [0.16, 1, 0.3, 1]
            }}
            aria-label="Current time"
          >
            <span className="clock-ambient-digits">
              {time}
            </span>
          </motion.div>
        )}
      </div>

      {/* Date & System Telemetry Anchor */}
      {isDormant ? (
        <div className="date date-ambient" id="date">
          {dateStr}
        </div>
      ) : (
        <div className="presence-footer-slot">
          <AnimatePresence initial={false} mode="wait">
            {oracleCaption || userCaption ? (
              <motion.div
                key="caption"
                className="hud-live-captions-container"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: reduceMotion ? 0.08 : 0.16 } }}
                exit={{ opacity: 0, transition: { duration: reduceMotion ? 0.08 : 0.14 } }}
              >
                {oracleCaption ? (
                  <div className="oracle-speech-caption" data-playing={oracleSpeaking}>
                    <div className="oracle-speech-caption-heading">
                      <span className="oracle-voice-wave" aria-hidden="true">
                        <span /><span /><span /><span />
                      </span>
                      <span className="oracle-speech-caption-label">Oracle</span>
                      {oracleSpeaking && <span>Speaking</span>}
                    </div>
                    <p>{oracleCaption}</p>
                  </div>
                ) : userCaption && (
                  <div className="user-speech-caption" data-state={userCaption.state}>
                    {!userCaption.text && (userCaption.state === 'listening' || userCaption.state === 'transcribing') ? (
                      <div className="voice-caption-status">
                        {userCaption.state === 'transcribing' ? 'Transcribing…' : 'Listening…'}
                      </div>
                    ) : (
                      <div className="user-speech-caption-heading">
                        <span className="caption-voice-wave" aria-hidden="true">
                          <span style={{ height: '8px' }} />
                          <span style={{ height: '14px' }} />
                          <span style={{ height: '10px' }} />
                          <span style={{ height: '16px' }} />
                        </span>
                        <span className="user-speech-caption-label">You</span>
                      </div>
                    )}
                    {userCaption.text && <p>{userCaption.text}</p>}
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="date"
                className="telemetry-date-dock"
                role="status"
                aria-label="System telemetry and date"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: reduceMotion ? 0.08 : 0.16 } }}
                exit={{ opacity: 0, transition: { duration: 0 } }}
              >
                <span className="telemetry-date-capsule" id="date">{dateStr}</span>
                <span className="telemetry-dock-divider" aria-hidden="true">·</span>
                <span className="telemetry-pill-status">
                  <span className="telemetry-status-pulse" aria-hidden="true" />
                  <span>ONLINE</span>
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Tactile Interaction Capsule with Smooth Cross-Fade */}
      <AnimatePresence mode="wait">
        {!hideHint && (
          <>
            {isDormant ? (
              <motion.button
                key="hint-dormant"
                type="button"
                className="hint-capsule"
                onClick={onWake}
                aria-label="Awaken ORACLE"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              >
                <span className="hint-kbd-icon">␣</span>
                <span className="hint-label">Space or click to awaken</span>
              </motion.button>
            ) : voiceError ? (
              <motion.div
                key="voice-error"
                className="hint hint-active-pill voice-error-hint"
                role="status"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
              >
                {voiceError}
              </motion.div>
            ) : HINTS[mode] ? (
              <motion.div
                key={`hint-${mode}`}
                className={`hint hint-active-pill ${mode === 'thinking' ? 'hint-thinking' : mode === 'speaking' ? 'hint-speaking' : ''}`}
                id="hint"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              >
                {mode === 'thinking' ? (
                  <>
                    <span className="hint-thinking-spark" aria-hidden="true" />
                    <span>Processing</span>
                  </>
                ) : mode === 'listening' && speechMode === 'ptt' ? 'Listening · Press M or click mic to finish & send' : HINTS[mode]}
              </motion.div>
            ) : null}
          </>
        )}
      </AnimatePresence>
    </footer>
  );
};
