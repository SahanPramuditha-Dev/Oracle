css_content = """/* ========================================================================= */
/* ORACLE — Holographic Celestial Floating Capsule HUD                       */
/* Concept 1: Spotlight Aerospace Capsule · Zero Monolithic Sidebars         */
/* ========================================================================= */

.geo-workspace-container {
  position: fixed;
  inset: 0;
  z-index: 5;
  background: #07090e;
  overflow: hidden;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  color: #e2e8f0;
  user-select: none;
}

/* Fullscreen Map Canvas */
.geo-map-viewport {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
}

/* Tactical Cyber Dark Canvas — Cold Ice-Cyan & Deep Space Obsidian (No Orange!) */
.geo-map-viewport.dark-tactical .maplibregl-canvas {
  filter: invert(100%) hue-rotate(0deg) brightness(92%) contrast(125%) saturate(110%);
}

.geo-map-viewport.satellite-mode .maplibregl-canvas {
  filter: none;
}

/* Top Scrim Mask — Ensures PresenceHeader text is 100% crisp & readable */
.geo-top-scrim {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 96px;
  z-index: 15;
  pointer-events: none;
  background: linear-gradient(180deg, rgba(7, 9, 14, 0.96) 0%, rgba(7, 9, 14, 0.72) 60%, transparent 100%);
}

/* Vignette Radial Gradient - Blends Map into Deep Space Background */
.geo-vignette {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  background: radial-gradient(circle at 50% 50%, transparent 55%, rgba(7, 9, 14, 0.65) 85%, #07090e 100%);
}

/* Subtle Tactical Grid Lines */
.geo-tactical-grid {
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
  background-image:
    linear-gradient(rgba(56, 189, 248, 0.015) 1px, transparent 1px),
    linear-gradient(90deg, rgba(56, 189, 248, 0.015) 1px, transparent 1px);
  background-size: 80px 80px;
}

/* ========================================================================= */
/* 1. CELESTIAL FLOATING COMMAND CAPSULE (Top Center HUD)                    */
/* ========================================================================= */

.geo-floating-capsule {
  position: absolute;
  top: 76px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 8px 5px 14px;
  background: rgba(14, 18, 24, 0.82);
  border: 1px solid rgba(232, 235, 239, 0.08);
  border-radius: 9999px;
  backdrop-filter: blur(36px) saturate(180%);
  -webkit-backdrop-filter: blur(36px) saturate(180%);
  box-shadow: 
    0 24px 60px -12px rgba(0, 0, 0, 0.85),
    0 0 24px -4px rgba(56, 189, 248, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  user-select: none;
  pointer-events: auto;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.geo-floating-capsule:focus-within {
  border-color: rgba(56, 189, 248, 0.4);
  box-shadow: 
    0 32px 80px -16px rgba(0, 0, 0, 0.95),
    0 0 32px -4px rgba(56, 189, 248, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.12);
}

/* Search Form inside Capsule */
.geo-capsule-search-form {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 260px;
}

.geo-capsule-search-icon {
  color: rgba(157, 180, 211, 0.55);
  flex-shrink: 0;
}

.geo-capsule-search-input {
  width: 100%;
  background: transparent;
  border: none;
  outline: none;
  color: #f1f5f9;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  font-size: 12px;
  font-weight: 400;
}

.geo-capsule-search-input::placeholder {
  color: rgba(148, 163, 184, 0.5);
}

.geo-capsule-clear-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(232, 235, 239, 0.08);
  border: none;
  color: #94a3b8;
  cursor: pointer;
  transition: all 0.15s ease;
}

.geo-capsule-clear-btn:hover {
  background: rgba(232, 235, 239, 0.15);
  color: #ffffff;
}

.geo-capsule-divider {
  width: 1px;
  height: 20px;
  background: rgba(232, 235, 239, 0.08);
  margin: 0 2px;
}

/* Mode Selector inside Capsule */
.geo-capsule-mode-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.geo-capsule-relative-wrap {
  position: relative;
}

/* Capsule Buttons */
.geo-capsule-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border-radius: 9999px;
  background: rgba(232, 235, 239, 0.035);
  border: 1px solid rgba(232, 235, 239, 0.06);
  color: rgba(232, 235, 239, 0.75);
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.geo-capsule-btn:hover {
  background: rgba(232, 235, 239, 0.08);
  border-color: rgba(232, 235, 239, 0.15);
  color: #ffffff;
}

.geo-capsule-btn.active {
  background: rgba(56, 189, 248, 0.14);
  border-color: rgba(56, 189, 248, 0.4);
  color: #38bdf8;
  font-weight: 600;
  box-shadow: 0 0 12px rgba(56, 189, 248, 0.15);
}

.geo-capsule-btn.close {
  padding: 0 8px;
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.2);
  color: #f87171;
}

.geo-capsule-btn.close:hover {
  background: rgba(239, 68, 68, 0.22);
  border-color: #ef4444;
  color: #ffffff;
}

/* Basemap Flyout Menu */
.geo-basemap-flyout {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  width: 250px;
  padding: 8px;
  background: rgba(14, 18, 24, 0.94);
  border: 1px solid rgba(232, 235, 239, 0.08);
  border-radius: 16px;
  backdrop-filter: blur(36px) saturate(180%);
  -webkit-backdrop-filter: blur(36px) saturate(180%);
  box-shadow: 0 32px 80px -16px rgba(0, 0, 0, 0.95), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  z-index: 60;
  animation: flyoutFadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes flyoutFadeIn {
  from { opacity: 0; transform: translateY(-4px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.geo-flyout-item {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 32px;
  border-radius: 8px;
  background: rgba(232, 235, 239, 0.025);
  border: 1px solid rgba(232, 235, 239, 0.06);
  color: #cbd5e1;
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.18s ease;
}

.geo-flyout-item:hover {
  background: rgba(232, 235, 239, 0.07);
  border-color: rgba(56, 189, 248, 0.3);
  color: #ffffff;
}

.geo-flyout-item.active {
  background: rgba(56, 189, 248, 0.14);
  border-color: rgba(56, 189, 248, 0.45);
  color: #38bdf8;
  font-weight: 600;
}

/* ========================================================================= */
/* 2. CONTEXTUAL FLOATING DRAWER (Left HUD Card - Appears on demand)         */
/* ========================================================================= */

.geo-floating-drawer {
  position: absolute;
  top: 130px;
  left: 28px;
  width: 350px;
  max-height: calc(100vh - 180px);
  z-index: 45;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px 22px;
  box-sizing: border-box;
  background: rgba(14, 18, 24, 0.78);
  border: 1px solid rgba(232, 235, 239, 0.08);
  border-radius: 20px;
  backdrop-filter: blur(36px) saturate(180%);
  -webkit-backdrop-filter: blur(36px) saturate(180%);
  box-shadow: 
    0 32px 80px -16px rgba(0, 0, 0, 0.9),
    0 0 28px -4px rgba(56, 189, 248, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
  pointer-events: auto;
  overflow-x: hidden;
  overflow-y: auto;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  animation: drawerSlideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes drawerSlideIn {
  from { opacity: 0; transform: translateX(-16px); }
  to { opacity: 1; transform: translateX(0); }
}

.geo-floating-drawer::-webkit-scrollbar {
  width: 4px;
}

.geo-floating-drawer::-webkit-scrollbar-track {
  background: transparent;
}

.geo-floating-drawer::-webkit-scrollbar-thumb {
  background: rgba(157, 180, 211, 0.2);
  border-radius: 4px;
}

.geo-floating-drawer::-webkit-scrollbar-thumb:hover {
  background: rgba(56, 189, 248, 0.4);
}

.geo-drawer-close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgba(232, 235, 239, 0.04);
  border: 1px solid rgba(232, 235, 239, 0.08);
  color: #94a3b8;
  cursor: pointer;
  transition: all 0.15s ease;
}

.geo-drawer-close-btn:hover {
  background: rgba(232, 235, 239, 0.12);
  color: #ffffff;
}

/* Tabs inside Drawer */
.geo-blade-tabs-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px;
  background: rgba(232, 235, 239, 0.03);
  border: 1px solid rgba(232, 235, 239, 0.06);
  border-radius: 9999px;
}

.geo-tab-pill {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 26px;
  border-radius: 9999px;
  background: transparent;
  border: 1px solid transparent;
  color: var(--muted, #94a3b8);
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.08em;
  cursor: pointer;
  transition: all 0.2s ease;
}

.geo-tab-pill:hover {
  color: #ffffff;
  background: rgba(232, 235, 239, 0.06);
}

.geo-tab-pill.active {
  background: rgba(56, 189, 248, 0.14);
  border-color: rgba(56, 189, 248, 0.4);
  color: #38bdf8;
  box-shadow: 0 0 12px rgba(56, 189, 248, 0.18);
}

/* Target Pin Context Card */
.geo-target-pin-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  background: rgba(232, 235, 239, 0.025);
  border: 1px solid rgba(56, 189, 248, 0.25);
  border-radius: 12px;
}

.geo-pin-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.geo-pin-title {
  font-size: 12px;
  font-weight: 600;
  color: #f1f5f9;
}

.geo-pin-desc {
  font-size: 10.5px;
  color: #94a3b8;
  line-height: 1.4;
}

.geo-pin-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
}

.geo-mini-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 26px;
  padding: 0 10px;
  border-radius: 6px;
  background: rgba(232, 235, 239, 0.04);
  border: 1px solid rgba(232, 235, 239, 0.08);
  color: #cbd5e1;
  font-size: 10.5px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.18s ease;
}

.geo-mini-btn:hover {
  background: rgba(232, 235, 239, 0.08);
  border-color: rgba(56, 189, 248, 0.3);
  color: #ffffff;
}

.geo-mini-btn.primary {
  background: rgba(56, 189, 248, 0.15);
  border-color: rgba(56, 189, 248, 0.4);
  color: #38bdf8;
  font-weight: 600;
}

.geo-mini-btn.dismiss {
  color: #94a3b8;
}

/* Route Section */
.geo-route-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.geo-route-header-box {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.geo-route-dest-name {
  font-size: 13.5px;
  font-weight: 600;
  color: #f1f5f9;
}

.geo-route-dest-address {
  font-size: 10.5px;
  color: #94a3b8;
  line-height: 1.4;
}

.geo-voice-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: rgba(56, 189, 248, 0.12);
  border: 1px solid rgba(56, 189, 248, 0.3);
  color: #38bdf8;
  cursor: pointer;
  transition: all 0.2s ease;
}

.geo-voice-btn:hover {
  background: rgba(56, 189, 248, 0.25);
  color: #ffffff;
}

.geo-route-metrics-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: rgba(232, 235, 239, 0.025);
  border: 1px solid rgba(232, 235, 239, 0.06);
  border-radius: 10px;
}

.geo-metric-block {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.geo-metric-label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 8.5px;
  color: #64748b;
  letter-spacing: 0.08em;
}

.geo-metric-val {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  font-weight: 600;
  color: #f1f5f9;
}

.geo-metric-val.cyan {
  color: #38bdf8;
}

.geo-metric-divider {
  width: 1px;
  height: 24px;
  background: rgba(232, 235, 239, 0.08);
}

.geo-steps-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 7px 10px;
  border-radius: 8px;
  background: rgba(232, 235, 239, 0.03);
  border: 1px solid rgba(232, 235, 239, 0.06);
  color: #cbd5e1;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.18s ease;
}

.geo-steps-container {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 180px;
  overflow-y: auto;
  padding-right: 4px;
}

.geo-step-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(232, 235, 239, 0.02);
  font-size: 11px;
  color: #cbd5e1;
  line-height: 1.35;
}

.geo-step-idx {
  font-family: 'JetBrains Mono', monospace;
  font-size: 9px;
  color: #38bdf8;
  font-weight: 600;
}

.geo-cancel-route-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  height: 30px;
  border-radius: 8px;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.2);
  color: #f87171;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.geo-cancel-route-btn:hover {
  background: rgba(239, 68, 68, 0.2);
  color: #ffffff;
}

/* Category Discovery Stack */
.geo-categories-stack {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.geo-section-title {
  font-family: 'JetBrains Mono', monospace;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.12em;
  color: #64748b;
  text-transform: uppercase;
  margin-bottom: 2px;
}

.geo-cat-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(232, 235, 239, 0.025);
  border: 1px solid rgba(232, 235, 239, 0.06);
  color: #cbd5e1;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.02);
}

.geo-cat-btn:hover {
  background: rgba(232, 235, 239, 0.06);
  border-color: rgba(56, 189, 248, 0.3);
  color: #ffffff;
  transform: translateX(2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.geo-cat-btn.emergency {
  border-color: rgba(239, 68, 68, 0.2);
  color: #fca5a5;
  background: rgba(239, 68, 68, 0.04);
}

.geo-cat-btn.emergency:hover {
  background: rgba(239, 68, 68, 0.12);
  border-color: rgba(239, 68, 68, 0.45);
  color: #ffffff;
}

.geo-notice-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba(34, 197, 94, 0.1);
  border: 1px solid rgba(34, 197, 94, 0.25);
  color: #4ade80;
  font-size: 11px;
}

.geo-parking-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  background: rgba(232, 235, 239, 0.025);
  border: 1px solid rgba(34, 197, 94, 0.25);
  border-radius: 10px;
}

.geo-parking-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  font-weight: 600;
  color: #4ade80;
}

.geo-parking-meta {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  color: #94a3b8;
}

.geo-parking-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
}

/* GIS Tab Styles */
.geo-gis-tab-content,
.geo-layers-tab-content {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.geo-gis-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  background: rgba(232, 235, 239, 0.02);
  border: 1px solid rgba(232, 235, 239, 0.06);
  border-radius: 12px;
}

.geo-gis-slider-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.geo-gis-slider {
  flex: 1;
  accent-color: #38bdf8;
  height: 4px;
  cursor: pointer;
}

.geo-slider-val {
  font-size: 10px;
  color: #38bdf8;
  font-weight: 600;
}

.geo-gis-actions-row,
.geo-measurement-toggles {
  display: flex;
  align-items: center;
  gap: 6px;
}

.geo-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  border-radius: 8px;
  background: rgba(232, 235, 239, 0.04);
  border: 1px solid rgba(232, 235, 239, 0.08);
  color: #cbd5e1;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.geo-action-btn:hover {
  background: rgba(232, 235, 239, 0.08);
  color: #ffffff;
}

.geo-action-btn.primary {
  background: rgba(56, 189, 248, 0.15);
  border-color: rgba(56, 189, 248, 0.4);
  color: #38bdf8;
  font-weight: 600;
}

.geo-gis-result-box,
.geo-measure-readout {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  background: rgba(232, 235, 239, 0.02);
  border-radius: 8px;
}

.geo-res-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10.5px;
  color: #94a3b8;
}

.geo-measure-hint {
  font-size: 9.5px;
  color: #64748b;
  margin-bottom: 2px;
}

.geo-prov-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10px;
  color: #94a3b8;
}

.geo-custom-layer-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  border-radius: 6px;
  background: rgba(232, 235, 239, 0.03);
  font-size: 11px;
  color: #38bdf8;
}

.geo-icon-btn.danger {
  background: transparent;
  border: none;
  color: #f87171;
  cursor: pointer;
}

/* ========================================================================= */
/* 3. BOTTOM FLOATING TELEMETRY PILL (Minimalist Aerospace Standard)          */
/* ========================================================================= */

.geo-bottom-telemetry-pill {
  position: absolute;
  bottom: 22px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 18px;
  background: rgba(14, 18, 24, 0.82);
  border: 1px solid rgba(232, 235, 239, 0.08);
  border-radius: 9999px;
  backdrop-filter: blur(32px) saturate(170%);
  -webkit-backdrop-filter: blur(32px) saturate(170%);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.06);
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  color: #94a3b8;
  user-select: none;
  pointer-events: auto;
}

.geo-telem-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.geo-telem-divider {
  width: 1px;
  height: 12px;
  background: rgba(232, 235, 239, 0.08);
}

.geo-telem-k {
  color: #64748b;
  font-weight: 500;
}

.geo-telem-v {
  color: #e2e8f0;
  font-weight: 600;
}

.geo-telem-v.cyan {
  color: #38bdf8;
}

.geo-telem-v.green {
  color: #22c55e;
}

.geo-pulse-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 6px #22c55e;
  animation: geoPulse 1.8s infinite;
}

@keyframes geoPulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.3; transform: scale(0.8); }
}

/* Markers */
.geo-user-marker-pulse {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #38bdf8;
  border: 2px solid #ffffff;
  box-shadow: 0 0 16px #38bdf8, 0 0 32px rgba(56, 189, 248, 0.5);
  animation: userPulse 2s infinite ease-out;
}

@keyframes userPulse {
  0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(56, 189, 248, 0.7); }
  70% { transform: scale(1.15); box-shadow: 0 0 0 14px rgba(56, 189, 248, 0); }
  100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(56, 189, 248, 0); }
}

.geo-dest-marker {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #f87171;
  border: 2px solid #ffffff;
  box-shadow: 0 0 16px #f87171;
}

.geo-target-pin {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #38bdf8;
  border: 2px solid #ffffff;
  box-shadow: 0 0 14px #38bdf8;
  cursor: pointer;
}
"""

with open(r'c:\D\Projects\AI\Oracle\frontend\src\components\GeoWorkspace.css', 'w', encoding='utf-8') as f:
    f.write(css_content)

print("Wrote Concept 1 GeoWorkspace.css successfully!")
