import React from 'react';
import { motion } from 'framer-motion';
import { Volume2, VolumeX } from 'lucide-react';

interface VoiceSubtitleProps {
  style?: React.CSSProperties;
  text: string;
  isAudioBlocked?: boolean;
  onEnableAudio?: () => void;
}

export const VoiceSubtitle: React.FC<VoiceSubtitleProps> = ({
  text,
  isAudioBlocked,
  onEnableAudio,
  style: customStyle
}) => {
  if (!text && !isAudioBlocked) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.98 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      style={{
        ...customStyle,
        position: 'fixed',
        bottom: '84px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 80,
        display: 'inline-flex',
        alignItems: 'center',
        gap: '10px',
        padding: '8px 18px',
        background: 'rgba(14, 18, 24, 0.85)',
        border: '1px solid rgba(157, 180, 211, 0.22)',
        borderRadius: '9999px',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
        color: '#e8ebef',
        fontFamily: "'Inter', sans-serif",
        fontSize: '12px',
        letterSpacing: '0.02em',
        pointerEvents: isAudioBlocked ? 'auto' : 'none',
        maxWidth: 'calc(100vw - 80px)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis'
      }}
    >
      {isAudioBlocked ? (
        <button
          type="button"
          onClick={onEnableAudio}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#38bdf8',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 'inherit'
          }}
        >
          <VolumeX size={14} color="#f59e0b" />
          <span>Click to enable voice greeting</span>
        </button>
      ) : (
        <>
          <Volume2 size={13} color="#38bdf8" style={{ flexShrink: 0 }} />
          <span>{text}</span>
        </>
      )}
    </motion.div>
  );
};
