# Append POI Machine HUD CSS to Presence.css
with open('frontend/src/Presence.css', 'r', encoding='utf-8') as f:
    c = f.read()

poi_css = """
/* ==========================================================================
   Person of Interest (The Machine) Focus HUD
   ========================================================================== */
.poi-target-container {
  position: absolute;
  pointer-events: none;
  z-index: 12;
  transition: all 0.14s cubic-bezier(0.16, 1, 0.3, 1);
}

.poi-target-svg {
  width: 100%;
  height: 100%;
  display: block;
}

/* POI Intelligence Dossier Card */
.poi-dossier-card {
  position: absolute;
  top: 10px;
  bottom: 10px;
  width: 220px;
  max-width: 48%;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  background: rgba(8, 10, 14, 0.88);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow: 0 16px 36px rgba(0, 0, 0, 0.75);
  overflow: hidden;
  z-index: 14;
  pointer-events: none;
  animation: poi-fade-in 0.25s ease-out;
}

@keyframes poi-fade-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

.poi-dossier-card.dock-left {
  left: 10px;
}

.poi-dossier-card.dock-right {
  right: 10px;
}

.poi-dossier-banner {
  padding: 6px 8px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  text-align: center;
  line-height: 1.2;
}

.poi-dossier-alias {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  background: rgba(255, 255, 255, 0.04);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  font-family: 'JetBrains Mono', monospace;
  font-size: 9px;
}

.poi-dossier-alias .alias-key {
  color: var(--muted);
  font-weight: 600;
  letter-spacing: 0.08em;
}

.poi-dossier-alias .alias-val {
  color: #ffffff;
  font-weight: 700;
  letter-spacing: 0.06em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.poi-dossier-grid {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 8.5px;
}

.poi-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  line-height: 1.25;
}

.poi-k {
  color: var(--muted);
  letter-spacing: 0.06em;
  font-weight: 500;
}

.poi-v {
  color: var(--fg);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 62%;
}

.poi-dossier-callout {
  margin: 0 8px 8px 8px;
  padding: 5px 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  font-family: 'JetBrains Mono', monospace;
  font-size: 7.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-align: center;
  line-height: 1.3;
  text-transform: uppercase;
}
"""

if '.poi-target-container' not in c:
    c += poi_css
    with open('frontend/src/Presence.css', 'w', encoding='utf-8') as f:
        f.write(c)
    print("Added POI HUD CSS to Presence.css")
else:
    print("POI HUD CSS already present")
