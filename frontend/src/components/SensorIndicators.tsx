import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Camera, CameraOff, MessageSquare } from 'lucide-react';
import { SensorColor, SensorsTelemetry } from '../hooks/useSensors';

interface SensorIndicatorsProps {
  sensors: SensorsTelemetry;
  isDormant: boolean;
  onOpenChat?: () => void;
}

export const SensorIndicators: React.FC<SensorIndicatorsProps> = ({ sensors, isDormant, onOpenChat }) => {
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null);

  const micOn = sensors.mic.state === 'blue' || sensors.mic.state === 'green';
  const previousMicOn = useRef(micOn);
  const [micNotice, setMicNotice] = useState('');
  useEffect(() => {
    if (previousMicOn.current === micOn) return;
    previousMicOn.current = micOn;
    setMicNotice(micOn ? 'Mic on' : 'Mic off');
    const timer = window.setTimeout(() => setMicNotice(''), 1800);
    return () => window.clearTimeout(timer);
  }, [micOn]);

  const getDotClass = (color: SensorColor) => {
    switch (color) {
      case 'green':
        return 'sensor-dot sensor-dot-green';
      case 'blue':
        return 'sensor-dot sensor-dot-blue';
      case 'red':
        return 'sensor-dot sensor-dot-red';
      default:
        return 'sensor-dot sensor-dot-gray';
    }
  };

  return (
    <div
      className={`sensors-telemetry-capsule ${isDormant ? 'sensors-dormant' : ''}`}
      aria-label="Sensory telemetry channels"
    >
      {/* Microphone Channel */}
      <div
        className="sensor-item"
        onMouseEnter={() => setActiveTooltip('mic')}
        onMouseLeave={() => setActiveTooltip(null)}
      >
        <button
          type="button"
          className={`sensor-btn mic-toggle ${micOn ? 'mic-on' : 'sensor-btn-muted'}`}
          onClick={sensors.toggleMic}
          aria-pressed={micOn}
          aria-label={`${sensors.mic.label}: ${sensors.mic.detail}`}
          title={sensors.mic.detail}
        >
          <span className="mic-toggle-icon" aria-hidden="true">
            {micOn ? <Mic size={13} strokeWidth={1.75} /> : <MicOff size={13} strokeWidth={1.75} />}
          </span>
          <span className={getDotClass(sensors.mic.state)} aria-hidden="true" />
        </button>
        <span className={`mic-state-notice ${micNotice ? 'visible' : ''}`} role="status" aria-live="polite">{micNotice}</span>

        {activeTooltip === 'mic' && (
          <div className="sensor-tooltip" role="tooltip">
            <span className="tooltip-title">MIC</span>
            <span className="tooltip-desc">{sensors.mic.detail}</span>
          </div>
        )}
      </div>

      {/* Optical Camera / Vision Channel */}
      <div
        className="sensor-item"
        onMouseEnter={() => setActiveTooltip('camera')}
        onMouseLeave={() => setActiveTooltip(null)}
      >
        <button
          type="button"
          className={`sensor-btn ${sensors.camera.state === 'gray' ? 'sensor-btn-muted' : ''}`}
          onClick={sensors.toggleCamera}
          aria-label={`${sensors.camera.label}: ${sensors.camera.detail}`}
          title={sensors.camera.detail}
        >
          {sensors.camera.state === 'gray' || sensors.camera.state === 'red' ? (
            <CameraOff size={13} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <Camera size={13} strokeWidth={1.75} aria-hidden="true" />
          )}
          <span className={getDotClass(sensors.camera.state)} aria-hidden="true" />
        </button>

        {activeTooltip === 'camera' && (
          <div className="sensor-tooltip" role="tooltip">
            <span className="tooltip-title">VISION</span>
            <span className="tooltip-desc">{sensors.camera.detail}</span>
          </div>
        )}
      </div>

      {/* Neural Chat Core Channel */}
      <div
        className="sensor-item header-chat-control"
        onMouseEnter={() => setActiveTooltip('chat')}
        onMouseLeave={() => setActiveTooltip(null)}
      >
        <button
          type="button"
          className="sensor-btn"
          onClick={onOpenChat}
          aria-label={`${sensors.chat.label}: ${sensors.chat.detail}`}
          title="Neural core conversation (C or /)"
        >
          <MessageSquare size={13} strokeWidth={1.75} aria-hidden="true" />
          <span className={getDotClass(sensors.chat.state)} aria-hidden="true" />
        </button>

        {activeTooltip === 'chat' && (
          <div className="sensor-tooltip" role="tooltip">
            <span className="tooltip-title">CORE CHAT</span>
            <span className="tooltip-desc">{sensors.chat.detail}</span>
          </div>
        )}
      </div>

    </div>
  );
};
