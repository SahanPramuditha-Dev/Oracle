import React, { useEffect, useRef } from 'react';

interface FluidVoiceWaveformProps {
  analyser?: AnalyserNode | null;
  width?: number;
  height?: number;
  className?: string;
  isCalibrated?: boolean;
}

interface WaveLayer {
  color: string;
  speed: number;
  freq: number;
  baseAmp: number;
  phaseOffset: number;
}

const LAYERS: WaveLayer[] = [
  // Layer 1: Deep Synaptic Indigo (broad foundation)
  { color: 'rgba(99, 102, 241, 0.42)', speed: 1.8, freq: 0.016, baseAmp: 18, phaseOffset: 0 },
  // Layer 2: Electric Cerulean (mid harmonic)
  { color: 'rgba(14, 165, 233, 0.55)', speed: 2.5, freq: 0.024, baseAmp: 24, phaseOffset: 1.4 },
  // Layer 3: Neon Quantum Cyan (high energy crest)
  { color: 'rgba(56, 189, 248, 0.72)', speed: 3.2, freq: 0.032, baseAmp: 30, phaseOffset: 2.8 },
  // Layer 4: Luminous Core Hairline (spark filament)
  { color: 'rgba(224, 242, 254, 0.92)', speed: 2.9, freq: 0.028, baseAmp: 8, phaseOffset: 0.8 }
];

export const FluidVoiceWaveform: React.FC<FluidVoiceWaveformProps> = ({
  analyser,
  width = 540,
  height = 130,
  className = '',
  isCalibrated = false
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let time = 0;

    // Buffer for real-time audio frequencies
    const dataArray = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;

    const render = () => {
      time += 0.018;

      // Extract real audio amplitude if microphone is streaming
      let audioVolume = 0;
      if (analyser && dataArray) {
        analyser.getByteFrequencyData(dataArray);
        // Average voice frequency spectrum (bins 4 to 64)
        let sum = 0;
        const binCount = Math.min(64, dataArray.length);
        for (let i = 4; i < binCount; i++) {
          sum += dataArray[i];
        }
        audioVolume = sum / (binCount - 4) / 255; // 0.0 to 1.0
      }

      // Smooth idle breathing ripple + dynamic voice swelling
      const dynamicMultiplier = 0.25 + audioVolume * 1.85;

      const w = width;
      const h = height;
      const centerY = h / 2;

      ctx.clearRect(0, 0, w, h);

      // Additive screen blending for optical glowing ribbon effect
      ctx.globalCompositeOperation = 'screen';

      // Draw each harmonic wave ribbon
      LAYERS.forEach((layer, idx) => {
        ctx.beginPath();

        const step = 4;
        const totalPoints = Math.floor(w / step);
        const topPoints: [number, number][] = [];
        const bottomPoints: [number, number][] = [];

        for (let i = 0; i <= totalPoints; i++) {
          const x = i * step;

          // Gaussian Bell-Curve Envelope tapering smoothly to zero on left & right edges
          const normX = (x - w / 2) / (w * 0.40);
          const envelope = Math.exp(-0.5 * normX * normX);

          // Harmonic multi-frequency oscillation
          const phase = time * layer.speed + layer.phaseOffset;
          const wave1 = Math.sin(x * layer.freq + phase);
          const wave2 = Math.cos(x * layer.freq * 0.5 - phase * 0.6);
          const composite = wave1 * 0.65 + wave2 * 0.35;

          const amplitude = layer.baseAmp * dynamicMultiplier * envelope;
          const yOffset = composite * amplitude;

          topPoints.push([x, centerY - yOffset]);
          bottomPoints.push([x, centerY + yOffset]);
        }

        // Connect top curve forward
        ctx.moveTo(topPoints[0][0], topPoints[0][1]);
        for (let i = 1; i < topPoints.length; i++) {
          ctx.lineTo(topPoints[i][0], topPoints[i][1]);
        }

        // Connect bottom curve backward to create a closed fluid ribbon
        for (let i = bottomPoints.length - 1; i >= 0; i--) {
          ctx.lineTo(bottomPoints[i][0], bottomPoints[i][1]);
        }
        ctx.closePath();

        // Style: layer 4 is a crisp hairline; layers 0-2 are fluid filled ribbons
        if (idx === LAYERS.length - 1) {
          ctx.strokeStyle = layer.color;
          ctx.lineWidth = 1.25;
          ctx.stroke();
        } else {
          ctx.fillStyle = layer.color;
          ctx.fill();
        }
      });

      // Central baseline zero-point hairline
      ctx.globalCompositeOperation = 'source-over';
      ctx.beginPath();
      ctx.strokeStyle = isCalibrated ? 'rgba(34, 197, 94, 0.45)' : 'rgba(56, 189, 248, 0.25)';
      ctx.lineWidth = 0.85;
      ctx.moveTo(w * 0.08, centerY);
      ctx.lineTo(w * 0.92, centerY);
      ctx.stroke();

      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [analyser, width, height, isCalibrated]);

  return (
    <div className={`fluid-voice-container ${className}`}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="fluid-voice-canvas"
        aria-hidden="true"
      />
    </div>
  );
};
