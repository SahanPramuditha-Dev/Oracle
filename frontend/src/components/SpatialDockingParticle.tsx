import React, { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

interface SpatialDockingParticleProps {
  target: 'chat' | 'mic' | 'camera';
  onDocked: () => void;
}

export const SpatialDockingParticle: React.FC<SpatialDockingParticleProps> = ({
  target,
  onDocked
}) => {
  const dockedFiredRef = useRef(false);
  const onDockedRef = useRef(onDocked);
  onDockedRef.current = onDocked;

  const handleDock = () => {
    if (!dockedFiredRef.current) {
      dockedFiredRef.current = true;
      onDockedRef.current();
    }
  };

  // Safe timeout fallback ensures it ALWAYS docks even if Framer Motion skips callback
  useEffect(() => {
    const timer = setTimeout(handleDock, 750);
    return () => clearTimeout(timer);
  }, []);

  // Target offsets from top-right capsule: ~30px top, ~140px right
  const targetX = target === 'mic' ? 'calc(100vw - 195px)' : target === 'camera' ? 'calc(100vw - 165px)' : 'calc(100vw - 135px)';
  const targetY = '30px';

  return (
    <motion.div
      className="spatial-flight-trail"
      initial={{
        left: '50vw',
        top: '50vh',
        scale: 1.5,
        opacity: 1
      }}
      animate={{
        left: targetX,
        top: targetY,
        scale: 0.45,
        opacity: 0.95
      }}
      transition={{
        duration: 0.72,
        ease: [0.16, 1, 0.3, 1] // Quintic gliding ease
      }}
      onAnimationComplete={handleDock}
    >
      <div className="docking-core-spark" />
      <div className="docking-halo-corona" />
    </motion.div>
  );
};
