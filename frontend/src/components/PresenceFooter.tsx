import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { OracleMode, HINTS } from '../types';
import { TimeState } from '../App';

interface PresenceFooterProps {
  mode: OracleMode;
  time: TimeState;
  dateStr: string;
  onWake: () => void;
}

export const PresenceFooter: React.FC<PresenceFooterProps> = ({ mode, time, dateStr, onWake }) => {
  if (mode === 'initializing') {
    return null;
  }

  const isDormant = mode === 'dormant';

  return (
    <footer className="footer">
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
              {time.hours}:{time.minutes}:{time.seconds}
            </span>
          </motion.div>
        )}
      </div>

      {/* Date Anchor */}
      <div className={`date ${isDormant ? 'date-ambient' : ''}`} id="date">
        {dateStr}
      </div>

      {/* Tactile Interaction Capsule with Smooth Cross-Fade */}
      <AnimatePresence mode="wait">
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
        ) : (
          <motion.div
            key="hint-active"
            className="hint"
            id="hint"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          >
            {HINTS[mode]}
          </motion.div>
        )}
      </AnimatePresence>
    </footer>
  );
};
