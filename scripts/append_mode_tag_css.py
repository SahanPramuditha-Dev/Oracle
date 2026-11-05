css = """

/* Mode Tag in Conversation HUD (Replacing segment buttons) */
.hud-blade-mode-tag {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 4px 10px;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(157, 180, 211, 0.14);
  cursor: pointer;
  transition: all 0.2s ease;
  user-select: none;
}

.hud-blade-mode-tag:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(157, 180, 211, 0.35);
  box-shadow: 0 0 12px rgba(157, 180, 211, 0.12);
}

.hud-blade-mode-tag .mode-tag-icon {
  display: flex;
  align-items: center;
  justify-content: center;
}

.hud-blade-mode-tag .mode-tag-label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 8.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--muted);
  transition: color 0.2s ease;
}

.hud-blade-mode-tag:hover .mode-tag-label {
  color: var(--fg);
}

/* Settings Mode Cards */
.settings-mode-card:hover {
  border-color: rgba(56, 189, 248, 0.35) !important;
  background: rgba(56, 189, 248, 0.05) !important;
  transform: translateY(-1px);
}
"""

with open('frontend/src/Presence.css', 'a', encoding='utf-8') as f:
    f.write(css)

print("Appended HUD mode tag and settings mode card styles to Presence.css")
