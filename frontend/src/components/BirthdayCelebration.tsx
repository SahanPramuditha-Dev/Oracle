import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useCurrentUser } from '../utils/currentUser';

interface BirthdayCelebrationProps {
  isOpen: boolean;
  onClose: () => void;
}

const CONFETTI = Array.from({ length: 42 }, (_, index) => ({
  id: index,
  left: `${(index * 37) % 100}%`,
  delay: `${(index % 9) * 0.18}s`,
  duration: `${4.8 + (index % 5) * 0.45}s`,
  color: ['#38bdf8', '#a78bfa', '#f9a8d4', '#facc15', '#4ade80'][index % 5],
  rotation: `${(index * 47) % 360}deg`,
}));

const SPARKLES = Array.from({ length: 12 }, (_, index) => ({
  id: index,
  left: `${8 + ((index * 29) % 84)}%`,
  top: `${10 + ((index * 41) % 70)}%`,
  delay: `${(index % 6) * 0.4}s`,
}));

const FIREWORKS = Array.from({ length: 8 }, (_, index) => ({
  id: index,
  left: `${14 + ((index * 31) % 72)}%`,
  top: `${12 + ((index * 23) % 38)}%`,
  delay: `${index * 0.28}s`,
  color: ['#38bdf8', '#f472b6', '#facc15', '#a78bfa'][index % 4],
}));

const TITLE = 'Happy Birthday';

export const BirthdayCelebration: React.FC<BirthdayCelebrationProps> = ({ isOpen, onClose }) => {
  const currentUser = useCurrentUser();
  const [candlesBlown, setCandlesBlown] = React.useState(false);
  const [confettiBurst, setConfettiBurst] = React.useState(0);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) {
      setCandlesBlown(false);
      setConfettiBurst(0);
    }
  }, [isOpen]);

  const triggerConfetti = () => setConfettiBurst((burst) => burst + 1);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.section
          className="birthday-celebration"
          role="dialog"
          aria-modal="true"
          aria-labelledby="birthday-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35 }}
        >
          <div key={confettiBurst} className={`birthday-confetti ${confettiBurst ? 'birthday-confetti-burst' : ''}`} aria-hidden="true">
            {CONFETTI.map((piece) => (
              <span
                key={piece.id}
                className="birthday-confetti-piece"
                style={{
                  left: piece.left,
                  animationDelay: piece.delay,
                  animationDuration: piece.duration,
                  backgroundColor: piece.color,
                  transform: `rotate(${piece.rotation})`,
                }}
              />
            ))}
          </div>
          <div className="birthday-sparkles" aria-hidden="true">
            {SPARKLES.map((sparkle) => (
              <span
                key={sparkle.id}
                className="birthday-sparkle"
                style={{ left: sparkle.left, top: sparkle.top, animationDelay: sparkle.delay }}
              />
            ))}
          </div>
          <div className={`birthday-fireworks ${candlesBlown ? 'birthday-fireworks-active' : ''}`} aria-hidden="true">
            {FIREWORKS.map((firework) => (
              <span
                key={firework.id}
                className="birthday-firework"
                style={{
                  left: firework.left,
                  top: firework.top,
                  animationDelay: firework.delay,
                  '--firework-color': firework.color,
                } as React.CSSProperties}
              />
            ))}
          </div>

          <div className="birthday-orbit birthday-orbit-one" aria-hidden="true" />
          <div className="birthday-orbit birthday-orbit-two" aria-hidden="true" />
          <div className="birthday-balloon birthday-balloon-pink" aria-hidden="true" />
          <div className="birthday-balloon birthday-balloon-blue" aria-hidden="true" />

          <motion.div
            className="birthday-card"
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ delay: 0.12, duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          >
            <button type="button" className="birthday-close" onClick={onClose} aria-label="Close birthday celebration">
              <X size={16} />
            </button>
            <motion.div
              className="birthday-cake-scene"
              aria-label="Animated birthday cake with glowing candles"
              animate={{ y: [0, -5, 0], rotate: [0, -0.5, 0.5, 0] }}
              transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
            >
              <span className="birthday-lightning birthday-lightning-left">✦</span>
              <span className="birthday-lightning birthday-lightning-right">ϟ</span>
              <div className="birthday-cake-glow" />
              <div className="birthday-candles">
                <span className={`birthday-candle birthday-candle-pink ${candlesBlown ? 'birthday-candle-out' : ''}`}><i /></span>
                <span className={`birthday-candle birthday-candle-blue ${candlesBlown ? 'birthday-candle-out' : ''}`}><i /></span>
                <span className={`birthday-candle birthday-candle-gold ${candlesBlown ? 'birthday-candle-out' : ''}`}><i /></span>
              </div>
              {candlesBlown && <span className="birthday-smoke birthday-smoke-one" />}
              {candlesBlown && <span className="birthday-smoke birthday-smoke-two" />}
              {candlesBlown && <span className="birthday-smoke birthday-smoke-three" />}
              <div className="birthday-cake">
                <div className="birthday-frosting birthday-frosting-top" />
                <div className="birthday-cake-layer birthday-cake-layer-top" />
                <div className="birthday-frosting birthday-frosting-middle" />
                <div className="birthday-cake-layer birthday-cake-layer-bottom" />
              </div>
              <div className="birthday-cake-plate" />
            </motion.div>
            <p className="birthday-kicker">ORACLE PERSONAL MOMENT</p>
            <h1 id="birthday-title" aria-label={TITLE}>
              {TITLE.split('').map((letter, index) => (
                <span key={`${letter}-${index}`} style={{ '--letter-index': index } as React.CSSProperties}>
                  {letter === ' ' ? '\u00a0' : letter}
                </span>
              ))}
            </h1>
            <div className="birthday-name">{currentUser?.name || 'Sahan'}</div>
            <p className="birthday-message">{candlesBlown ? 'Wish sent. May this next chapter be bright, bold, and entirely yours.' : 'Today is yours. Make a wish, enjoy the moment, and let the next chapter glow.'}</p>
            <span className="birthday-wish-hint">✦ Close your eyes and make a wish ✦</span>
            <div className="birthday-controls">
              <button type="button" className="birthday-blow-button birthday-primary-control" onClick={() => setCandlesBlown(true)} disabled={candlesBlown}>
                {candlesBlown ? 'Wish released' : '🎂 Blow the candles'}
              </button>
              <button type="button" className="birthday-secondary-control" onClick={triggerConfetti}>
                🎉 Confetti
              </button>
              <button type="button" className="birthday-secondary-control" onClick={onClose}>
                Return to ORACLE
              </button>
            </div>
            <span className="birthday-shortcut">Press ESC to close · Make a wish, then blow out the candles</span>
          </motion.div>
        </motion.section>
      )}
    </AnimatePresence>
  );
};
