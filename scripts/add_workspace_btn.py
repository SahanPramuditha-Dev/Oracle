with open('frontend/src/components/PresenceHeader.tsx', 'r', encoding='utf-8') as f:
    c = f.read()

target = """          {/* Consolidated Subsystems & Workspace Applications Menu */}"""
replacement = """          {/* Direct Workspace Action Button */}
          {onOpenRecords && (
            <button
              type="button"
              className="hud-chip workspace-header-chip"
              onClick={onOpenRecords}
              title="Open Workspace (W)"
              aria-label="Workspace"
            >
              <LayoutGrid size={11} strokeWidth={1.8} style={{ marginRight: 4 }} />
              <span>Workspace</span>
            </button>
          )}

          {/* Consolidated Subsystems & Workspace Applications Menu */}"""

if "aria-label=\"Workspace\"" not in c:
    c = c.replace(target, replacement)
    with open('frontend/src/components/PresenceHeader.tsx', 'w', encoding='utf-8') as f:
        f.write(c)
    print("Added Workspace button to PresenceHeader.tsx")
else:
    print("Workspace button already present in PresenceHeader.tsx")
