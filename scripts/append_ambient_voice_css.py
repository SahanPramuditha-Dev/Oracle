css = """

/* ==========================================================================
   AMBIENT BACKGROUND VOICE ENGINE DOCK (Persistent Hands-Free Link)
   ========================================================================== */

.ambient-voice-pill {
  position: fixed;
  bottom: 84px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 120;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 8px 16px;
  background: rgba(12, 14, 18, 0.78);
  border: 1px solid rgba(157, 180, 211, 0.22);
  border-radius: 9999px;
  backdrop-filter: blur(28px);
  -webkit-backdrop-filter: blur(28px);
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.55), 0 0 20px rgba(157, 180, 211, 0.08);
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  user-select: none;
  animation: ambientPillAppear 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes ambientPillAppear {
  from {
    opacity: 0;
    transform: translate(-50%, 14px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translate(-50%, 0) scale(1);
  }
}

.ambient-voice-pill:hover {
  background: rgba(16, 20, 26, 0.88);
  border-color: rgba(157, 180, 211, 0.45);
  box-shadow: 0 16px 42px rgba(0, 0, 0, 0.65), 0 0 28px rgba(157, 180, 211, 0.18);
  transform: translate(-50%, -2px);
}

.ambient-voice-indicator {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
}

.ambient-voice-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #38bdf8;
  box-shadow: 0 0 10px #38bdf8;
  transition: background 0.2s ease, box-shadow 0.2s ease;
}

.ambient-voice-pulse {
  position: absolute;
  top: 0;
  left: 0;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1.5px solid #38bdf8;
  opacity: 0;
  animation: ambientRingPulse 2s cubic-bezier(0, 0.2, 0.8, 1) infinite;
}

@keyframes ambientRingPulse {
  0% {
    transform: scale(0.6);
    opacity: 0.9;
  }
  100% {
    transform: scale(1.9);
    opacity: 0;
  }
}

.ambient-voice-pill.speaking-active .ambient-voice-dot {
  background: #4ade80;
  box-shadow: 0 0 14px #4ade80;
}

.ambient-voice-pill.speaking-active .ambient-voice-pulse {
  border-color: #4ade80;
  animation-duration: 0.9s;
}

.ambient-voice-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.ambient-voice-title {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #e2e8f0;
}

.ambient-voice-subtitle {
  font-family: 'JetBrains Mono', monospace;
  font-size: 8.5px;
  letter-spacing: 0.04em;
  color: #94a3b8;
}

.ambient-voice-mute-btn {
  font-family: 'JetBrains Mono', monospace;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.08em;
  padding: 3px 9px;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(157, 180, 211, 0.25);
  color: #94a3b8;
  cursor: pointer;
  transition: all 0.18s ease;
}

.ambient-voice-mute-btn:hover {
  background: rgba(239, 68, 68, 0.15);
  border-color: rgba(239, 68, 68, 0.5);
  color: #ef4444;
}
"""

with open('frontend/src/Presence.css', 'a', encoding='utf-8') as f:
    f.write(css)

print('Appended ambient voice pill CSS')
