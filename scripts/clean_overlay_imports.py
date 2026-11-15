with open('frontend/src/components/AdminProtocolOverlay.tsx', 'r', encoding='utf-8') as f:
    c = f.read()

c = c.replace(
    "import { motion, AnimatePresence } from 'framer-motion';",
    "import { motion } from 'framer-motion';"
)
c = c.replace(
    "import { Shield, ShieldCheck, Mic, Camera, KeyRound, X, CheckCircle2, Volume2 } from 'lucide-react';",
    "import { Shield, ShieldCheck, Mic, Camera, KeyRound, Volume2 } from 'lucide-react';"
)

with open('frontend/src/components/AdminProtocolOverlay.tsx', 'w', encoding='utf-8') as f:
    f.write(c)

print('Cleaned unused imports in AdminProtocolOverlay.tsx')
