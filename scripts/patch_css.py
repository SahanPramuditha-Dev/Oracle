import os

path = r'c:\D\Projects\AI\Oracle\frontend\src\components\GeoWorkspace.css'
with open(path, 'r', encoding='utf-8') as f:
    css = f.read()

# 1. Replace .geo-left-blade styles and remove brackets
old_blade = """.geo-left-blade {
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
  background: rgba(14, 18, 25, 0.82);
  border: 1px solid rgba(157, 180, 211, 0.16);
  border-radius: 12px;
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  box-shadow: 0 16px 44px rgba(0, 0, 0, 0.65), 0 0 24px rgba(0, 243, 255, 0.05);
  pointer-events: auto;
  overflow-y: auto;
}

.geo-left-blade::-webkit-scrollbar {
  width: 3px;
}

.geo-left-blade::-webkit-scrollbar-thumb {
  background: rgba(0, 243, 255, 0.25);
  border-radius: 3px;
}

/* Tactical Corner Reticle Brackets */
.geo-left-blade::before {
  content: '';
  position: absolute;
  top: -1px;
  left: -1px;
  width: 10px;
  height: 10px;
  border-top: 2px solid #00f3ff;
  border-left: 2px solid #00f3ff;
  border-top-left-radius: 4px;
}

.geo-left-blade::after {
  content: '';
  position: absolute;
  bottom: -1px;
  right: -1px;
  width: 10px;
  height: 10px;
  border-bottom: 2px solid #00f3ff;
  border-right: 2px solid #00f3ff;
  border-bottom-right-radius: 4px;
}"""

new_blade = """.geo-left-blade {
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
}

.geo-left-blade::-webkit-scrollbar {
  width: 4px;
}

.geo-left-blade::-webkit-scrollbar-track {
  background: transparent;
}

.geo-left-blade::-webkit-scrollbar-thumb {
  background: rgba(157, 180, 211, 0.2);
  border-radius: 4px;
}

.geo-left-blade::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 243, 255, 0.35);
}"""

# 2. Update .geo-right-hud
old_right_hud = """.geo-right-hud {
  position: absolute;
  top: 86px;
  right: 28px;
  z-index: 25;
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 172px;
  pointer-events: auto;
}

.geo-hud-controls-group {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 10px;
  background: rgba(14, 18, 25, 0.82);
  border: 1px solid rgba(157, 180, 211, 0.16);
  border-radius: 10px;
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55);
}"""

new_right_hud = """.geo-right-hud {
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

# 3. Update basemap grid to repeat(3, 1fr)
old_grid = """.geo-hud-basemap-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}"""

new_grid = """.geo-hud-basemap-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 5px;
}"""

norm_css = css.replace('\r\n', '\n')

if old_blade in norm_css:
    norm_css = norm_css.replace(old_blade, new_blade)
    print("Replaced old blade successfully!")
else:
    print("Old blade NOT found!")

if old_right_hud in norm_css:
    norm_css = norm_css.replace(old_right_hud, new_right_hud)
    print("Replaced right hud successfully!")
else:
    print("Old right hud NOT found!")

if old_grid in norm_css:
    norm_css = norm_css.replace(old_grid, new_grid)
    print("Replaced grid successfully!")
else:
    print("Old grid NOT found!")

with open(path, 'w', encoding='utf-8') as f:
    f.write(norm_css)

print("GeoWorkspace.css updated!")
