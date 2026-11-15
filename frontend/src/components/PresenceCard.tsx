import { useEffect, useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Pin, X } from 'lucide-react';
import './PresenceCard.css';

interface PresenceCardProps {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  pinned?: boolean;
  onTogglePin?: () => void;
  onClose?: () => void;
  holdOpen?: boolean;
  delay?: number;
  updateKey?: string;
}

export function PresenceCard({
  title, icon, children, action, pinned, onTogglePin, onClose,
  holdOpen, delay = 0, updateKey,
}: PresenceCardProps) {
  const reduceMotion = useReducedMotion();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!onClose || pinned || holdOpen || hovered || focused) return;
    const timer = window.setTimeout(onClose, 45_000);
    return () => window.clearTimeout(timer);
  }, [onClose, pinned, holdOpen, hovered, focused]);

  return (
    <motion.aside
      className="presence-card"
      aria-label={title}
      initial={{ opacity: 0, y: reduceMotion ? 0 : 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: reduceMotion ? 0 : delay, ease: 'easeOut' }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      {updateKey && <span key={updateKey} className="presence-card-signal" aria-hidden="true" />}
      <header className="presence-card-header">
        <h2>{icon}{title}</h2>
        <div className="presence-card-actions">
          {action}
          {onTogglePin && (
            <button type="button" className="presence-card-icon" aria-label="Keep card open"
              aria-pressed={Boolean(pinned)} title={pinned ? 'Unpin card' : 'Pin card'} onClick={onTogglePin}>
              <Pin size={14} />
            </button>
          )}
          {onClose && (
            <button type="button" className="presence-card-icon" onClick={onClose}
              title="Dismiss panel" aria-label="Dismiss panel">
              <X size={14} />
            </button>
          )}
        </div>
      </header>
      {children}
    </motion.aside>
  );
}
