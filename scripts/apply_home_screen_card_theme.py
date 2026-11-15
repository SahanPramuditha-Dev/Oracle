import os

tsx_path = r'c:\D\Projects\AI\Oracle\frontend\src\components\GeoWorkspace.tsx'
css_path = r'c:\D\Projects\AI\Oracle\frontend\src\components\GeoWorkspace.css'

# 1. Update GeoWorkspace.tsx header strip
with open(tsx_path, 'r', encoding='utf-8') as f:
    tsx = f.read()

old_header = """        <div className="geo-blade-title-row">
          <span className="geo-blade-header-title">SPATIAL INTELLIGENCE</span>
          <div className="geo-blade-status-badge" title={statusMessage}>
            <span className="geo-pulse-dot" />
            <span>{statusMessage !== 'Standby' ? statusMessage : (gpsLocked ? 'GPS ACTIVE' : 'STANDBY')}</span>
          </div>
        </div>"""

new_header = """        <div className="card-header-strip">
          <span className="card-section-tag">
            <Navigation size={12} strokeWidth={1.8} style={{ color: '#38bdf8', marginRight: 4 }} />
            Spatial Intelligence
          </span>
          <span className={`card-status-badge ${gpsLocked ? 'locked' : 'scanning'}`} title={statusMessage}>
            <span className="card-status-dot" />
            <span>{statusMessage !== 'Standby' ? statusMessage : (gpsLocked ? 'GPS Active (±10m)' : 'Standby')}</span>
          </span>
        </div>"""

if old_header in tsx:
    tsx = tsx.replace(old_header, new_header)
    print("Updated tsx header strip successfully!")
else:
    print("old_header not found in tsx, checking alternatives...")

with open(tsx_path, 'w', encoding='utf-8') as f:
    f.write(tsx)

# 2. Update GeoWorkspace.css card styling
with open(css_path, 'r', encoding='utf-8') as f:
    css = f.read()

# Replace .geo-left-blade and its children
blade_css_old = """.geo-left-blade {
  position: absolute;
  top: 86px;
  left: 28px;
  bottom: 28px;
  width: 350px;
  max-width: calc(100vw - 56px);
  z-index: 25;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 20px;
  background: rgba(14, 18, 25, 0.88);
  border: 1px solid rgba(157, 180, 211, 0.12);
  border-radius: 16px;
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
  box-shadow: 0 32px 80px -16px rgba(0, 0, 0, 0.85), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  pointer-events: auto;
  overflow-x: hidden;
  overflow-y: auto;
}"""

blade_css_new = """.geo-left-blade {
  position: absolute;
  top: 86px;
  left: 28px;
  bottom: 28px;
  width: 360px;
  max-width: calc(100vw - 56px);
  z-index: 25;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 22px 24px 20px 24px;
  box-sizing: border-box;
  background: rgba(14, 18, 24, 0.76);
  border: 1px solid rgba(232, 235, 239, 0.08);
  border-radius: 20px;
  backdrop-filter: blur(32px) saturate(170%);
  -webkit-backdrop-filter: blur(32px) saturate(170%);
  box-shadow: 0 32px 80px -16px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.03), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  pointer-events: auto;
  overflow-x: hidden;
  overflow-y: auto;
  user-select: none;
  font-family: Inter, system-ui, -apple-system, sans-serif;
  transition: border-color 0.4s ease, box-shadow 0.4s ease;
}"""

css = css.replace(blade_css_old, blade_css_new)

# Update right HUD styling to match home screen cards
right_hud_old = """.geo-right-hud {
  position: absolute;
  top: 86px;
  right: 28px;
  z-index: 25;
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 216px;
  pointer-events: auto;
}

.geo-hud-controls-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: rgba(14, 18, 25, 0.88);
  border: 1px solid rgba(157, 180, 211, 0.12);
  border-radius: 14px;
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
  box-shadow: 0 24px 60px -12px rgba(0, 0, 0, 0.85), inset 0 1px 0 rgba(255, 255, 255, 0.08);
}"""

right_hud_new = """.geo-right-hud {
  position: absolute;
  top: 86px;
  right: 28px;
  z-index: 25;
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 226px;
  pointer-events: auto;
}

.geo-hud-controls-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px 18px;
  box-sizing: border-box;
  background: rgba(14, 18, 24, 0.76);
  border: 1px solid rgba(232, 235, 239, 0.08);
  border-radius: 18px;
  backdrop-filter: blur(32px) saturate(170%);
  -webkit-backdrop-filter: blur(32px) saturate(170%);
  box-shadow: 0 32px 80px -16px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.03), inset 0 1px 0 rgba(255, 255, 255, 0.08);
}"""

css = css.replace(right_hud_old, right_hud_new)

# Update telemetry box
telem_old = """.geo-hud-telemetry-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  background: rgba(14, 18, 25, 0.82);
  border: 1px solid rgba(157, 180, 211, 0.16);
  border-radius: 10px;
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  font-family: 'JetBrains Mono', monospace;
}"""

telem_new = """.geo-hud-telemetry-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 18px;
  box-sizing: border-box;
  background: rgba(14, 18, 24, 0.76);
  border: 1px solid rgba(232, 235, 239, 0.08);
  border-radius: 18px;
  backdrop-filter: blur(32px) saturate(170%);
  -webkit-backdrop-filter: blur(32px) saturate(170%);
  box-shadow: 0 32px 80px -16px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.03), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  font-family: 'JetBrains Mono', monospace;
}"""

css = css.replace(telem_old, telem_new)

# Update tabs row
tabs_old = """.geo-blade-tabs-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px;
  background: rgba(20, 26, 38, 0.6);
  border: 1px solid rgba(157, 180, 211, 0.14);
  border-radius: 8px;
}

.geo-tab-pill {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 24px;
  border-radius: 6px;
  background: transparent;
  border: none;
  color: #94a3b8;
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  cursor: pointer;
  transition: all 0.2s ease;
}

.geo-tab-pill:hover {
  color: #ffffff;
  background: rgba(0, 243, 255, 0.08);
}

.geo-tab-pill.active {
  background: rgba(0, 243, 255, 0.18);
  border: 1px solid rgba(0, 243, 255, 0.45);
  color: #00f3ff;
  box-shadow: 0 0 10px rgba(0, 243, 255, 0.2);
}"""

tabs_new = """.geo-blade-tabs-row {
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
  gap: 5px;
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
}"""

css = css.replace(tabs_old, tabs_new)

# Update search input
search_old = """.geo-blade-search-input {
  width: 100%;
  padding: 8px 12px 8px 34px;
  background: rgba(20, 26, 38, 0.7);
  border: 1px solid rgba(157, 180, 211, 0.18);
  border-radius: 8px;
  color: #ffffff;
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  outline: none;
  transition: all 0.2s ease;
}

.geo-blade-search-input:focus {
  border-color: rgba(0, 243, 255, 0.5);
  background: rgba(20, 26, 38, 0.95);
  box-shadow: 0 0 14px rgba(0, 243, 255, 0.2);
}"""

search_new = """.geo-blade-search-input {
  width: 100%;
  height: 38px;
  box-sizing: border-box;
  padding: 0 14px 0 34px;
  background: rgba(232, 235, 239, 0.035);
  border: 1px solid rgba(232, 235, 239, 0.08);
  border-radius: 12px;
  color: #f1f5f9;
  font-family: Inter, system-ui, -apple-system, sans-serif;
  font-size: 12px;
  outline: none;
  transition: all 0.2s ease;
}

.geo-blade-search-input:focus {
  background: rgba(14, 18, 24, 0.92);
  border-color: rgba(56, 189, 248, 0.4);
  box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.05);
}"""

css = css.replace(search_old, search_new)

# Update category buttons
cat_old = """.geo-cat-btn {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(20, 26, 38, 0.5);
  border: 1px solid rgba(157, 180, 211, 0.12);
  color: #cbd5e1;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.geo-cat-btn:hover {
  background: rgba(0, 243, 255, 0.1);
  border-color: rgba(0, 243, 255, 0.35);
  color: #ffffff;
  transform: translateX(2px);
}

.geo-cat-btn.emergency {
  border-color: rgba(239, 68, 68, 0.25);
  color: #fca5a5;
}

.geo-cat-btn.emergency:hover {
  background: rgba(239, 68, 68, 0.18);
  border-color: #ef4444;
  color: #ffffff;
}"""

cat_new = """.geo-cat-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(232, 235, 239, 0.025);
  border: 1px solid rgba(232, 235, 239, 0.06);
  color: #cbd5e1;
  font-family: Inter, system-ui, -apple-system, sans-serif;
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
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.04);
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
}"""

css = css.replace(cat_old, cat_new)

# Update mode pills
mode_old = """.geo-mode-pill {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 25px;
  border-radius: 6px;
  background: rgba(20, 26, 38, 0.5);
  border: 1px solid rgba(157, 180, 211, 0.14);
  color: #cbd5e1;
  font-size: 10.5px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.geo-mode-pill:hover {
  background: rgba(0, 243, 255, 0.1);
  border-color: rgba(0, 243, 255, 0.35);
  color: #ffffff;
}

.geo-mode-pill.active {
  background: rgba(0, 243, 255, 0.18);
  border-color: #00f3ff;
  color: #00f3ff;
  font-weight: 600;
}"""

mode_new = """.geo-mode-pill {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 28px;
  border-radius: 8px;
  background: rgba(232, 235, 239, 0.025);
  border: 1px solid rgba(232, 235, 239, 0.06);
  color: #94a3b8;
  font-family: Inter, system-ui, -apple-system, sans-serif;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.geo-mode-pill:hover {
  background: rgba(232, 235, 239, 0.06);
  color: #ffffff;
  border-color: rgba(232, 235, 239, 0.12);
}

.geo-mode-pill.active {
  background: rgba(56, 189, 248, 0.12);
  border-color: rgba(56, 189, 248, 0.4);
  color: #38bdf8;
  font-weight: 600;
}"""

css = css.replace(mode_old, mode_new)

# Update right HUD buttons
hud_btn_old = """.geo-hud-btn {
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  background: rgba(157, 180, 211, 0.06);
  border: 1px solid rgba(157, 180, 211, 0.16);
  color: #cbd5e1;
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  user-select: none;
}

.geo-hud-btn:hover {
  background: rgba(0, 243, 255, 0.12);
  border-color: rgba(0, 243, 255, 0.4);
  color: #ffffff;
  box-shadow: 0 0 12px rgba(0, 243, 255, 0.2);
}

.geo-hud-btn.active {
  background: rgba(0, 243, 255, 0.2);
  border-color: #00f3ff;
  color: #00f3ff;
  font-weight: 600;
  box-shadow: 0 0 14px rgba(0, 243, 255, 0.3);
}

.geo-hud-btn.close {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.25);
  color: #f87171;
}

.geo-hud-btn.close:hover {
  background: rgba(239, 68, 68, 0.25);
  border-color: #ef4444;
  color: #ffffff;
}"""

hud_btn_new = """.geo-hud-btn {
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  height: 30px;
  padding: 0 10px;
  border-radius: 8px;
  background: rgba(232, 235, 239, 0.03);
  border: 1px solid rgba(232, 235, 239, 0.08);
  color: #cbd5e1;
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  user-select: none;
}

.geo-hud-btn:hover {
  background: rgba(232, 235, 239, 0.07);
  border-color: rgba(56, 189, 248, 0.35);
  color: #ffffff;
}

.geo-hud-btn.active {
  background: rgba(56, 189, 248, 0.14);
  border-color: rgba(56, 189, 248, 0.45);
  color: #38bdf8;
  font-weight: 600;
  box-shadow: 0 0 12px rgba(56, 189, 248, 0.2);
}

.geo-hud-btn.close {
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.2);
  color: #f87171;
}

.geo-hud-btn.close:hover {
  background: rgba(239, 68, 68, 0.2);
  border-color: #ef4444;
  color: #ffffff;
}"""

css = css.replace(hud_btn_old, hud_btn_new)

with open(css_path, 'w', encoding='utf-8') as f:
    f.write(css)

print("Applied Home Screen Card Theme to GeoWorkspace successfully!")
