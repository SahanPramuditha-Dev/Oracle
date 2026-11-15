import { useEffect, useRef, type RefObject } from 'react';
import { ChevronRight, MicOff } from 'lucide-react';
import type { OracleMode } from '../types';
import { readPlaybackEnergy } from '../utils/voice';

interface OracleActivityProps {
  mode: OracleMode;
  micActive: boolean;
  inputLevel: RefObject<number>;
  onOpen: () => void;
}

export function OracleActivity({ mode, micActive, inputLevel, onOpen }: OracleActivityProps) {
  const meter = useRef<HTMLSpanElement>(null);
  const live = mode === 'listening' || mode === 'speaking';
  const micOff = mode === 'ready' && !micActive;
  const status = {
    initializing: 'Starting…',
    dormant: 'Asleep',
    ready: micOff ? 'Mic off' : 'Ready',
    listening: 'Listening',
    transcribing: 'Transcribing…',
    thinking: 'Working…',
    speaking: 'Speaking',
  }[mode];

  useEffect(() => {
    const element = meter.current;
    if (!live || !element) return;

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const timer = window.setInterval(() => {
      const level = motion.matches ? 0 : mode === 'speaking' ? readPlaybackEnergy() : inputLevel.current;
      element.style.setProperty('--oracle-level', String(level));
    }, 80);
    return () => {
      window.clearInterval(timer);
      element.style.removeProperty('--oracle-level');
    };
  }, [mode, live, inputLevel]);

  return (
    <button type="button" className="geo-oracle-activity" data-mode={mode} onClick={onOpen} aria-label="Open Oracle conversation">
      <span className="geo-oracle-meter" ref={meter} aria-hidden="true">
        {live ? [0.5, 0.8, 1, 0.7, 0.45].map((weight) => (
          <i key={weight} style={{ height: `calc(3px + var(--oracle-level, 0) * ${weight * 15}px)` }} />
        )) : micOff ? <MicOff size={15} /> : <i />}
      </span>
      <span className="geo-oracle-activity-text">
        <span>Oracle Activity</span>
        <span role="status">{status}</span>
      </span>
      <ChevronRight size={13} aria-hidden="true" />
    </button>
  );
}
