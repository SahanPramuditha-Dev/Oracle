with open('frontend/src/components/AdminProtocolOverlay.tsx', 'r', encoding='utf-8') as f:
    c = f.read()

c = c.replace(
    "ORACLE // CLEARANCE GATEWAY",
    "ORACLE // ADMIN CLEARANCE PROTOCOL"
)
c = c.replace(
    "LEVEL 5 DUAL-BIOMETRIC AUTHENTICATION",
    "DUAL-FACTOR BIOMETRIC GATE"
)

with open('frontend/src/components/AdminProtocolOverlay.tsx', 'w', encoding='utf-8') as f:
    f.write(c)

print('Updated header titles in AdminProtocolOverlay.tsx')
