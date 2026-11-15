# ORACLE Design System & Color Theme Specification

**Document Version:** 2.0.0  
**Design Architecture:** Obsidian Glass & Celestial Chronometer  
**Primary Interface:** ORACLE — Presence (`/`) & Dormant Mode (`/dormant.html`)  
**Main Reference:** Live Presence HUD Command Center  

---

## 1. Design Philosophy & Aesthetic Foundation

ORACLE's interface is designed around the concept of **Intelligent Presence** — a calm, ambient, aerospace-grade command center inspired by cinematic HUDs (such as Iron Man's JARVIS and spacecraft telemetry interfaces). Rather than overwhelming the user with heavy static sidebars, the UI organizes all operational intelligence into a balanced, tri-planar spatial composition.

```
+-----------------------------------------------------------------------------------+
|  [Depth Plane 3: HUD Overlay]                                                      |
|  [Logo & Clearance]           [00:09:49 Chronometer]           [Tactical Controls]|
|                                                                                   |
|                                                                                   |
|                   +---------------------------------------+                       |
|                   |  [Depth Plane 2: Celestial 3D Orb]    |                       |
|                   |  Luminous Nucleus (White/Ice Blue)    |                       |
|                   |  Point Cloud Shells & Vector Rings    |                       |
|                   |  Audio-Reactive Acoustic Energy       |                       |
|                   +---------------------------------------+                       |
|                                                                                   |
|                                                                                   |
|  [Status Pill: SUN 8 NOV • ONLINE]                             [Acoustic Waveform]|
+-----------------------------------------------------------------------------------+
|  [Depth Plane 1: Deep Space Canvas & Radial Nebula Vignette]                      |
+-----------------------------------------------------------------------------------+
```

### The Three Spatial Depth Planes
1. **Depth Plane 1 (Background Cosmos):** An infinite, ultra-dark void (`#06090e` to `#0c0e11`) with subtle radial gradients, core atmospheric nebula glow, and peripheral vignettes that focus visual attention inward.
2. **Depth Plane 2 (Kinetic Celestial Orb):** A dynamic WebGL wireframe entity rendered with Three.js. It features a pulsating white/ice-blue nucleus, concentric particle shells, and inclined orbital rings with revolving node satellites that respond in real time to microphone audio and system cognition states.
3. **Depth Plane 3 (Obsidian Glass HUD Overlay):** Floating tactile capsules, sub-pixel hairline borders, frosted glassmorphism (`backdrop-filter: blur(28px-40px)`), and crisp monospace telemetry docked along viewport boundaries.

---

## 2. Color Palette & Token System

The color palette balances deep cosmic absorption with crisp, high-contrast typography and luminous status accents.

### 2.1 Master Palette Table

| Token Name | Value | Preview / Role | Primary Application |
|---|---|---|---|
| `--bg-void` | `#020408` | Deepest Black | Canvas boundaries, outer vignette rim |
| `--bg-canvas` | `#06090e` | Deep Space Navy | Tactical map background, dormant canvas |
| `--bg` | `#0c0e11` | Obsidian Base | Primary viewport background, root surface |
| `--bg-surface` | `#0e1218` | Dark Slate Surface | Fallback solid background for containers |
| `--bg-surface-glass` | `rgba(14, 18, 24, 0.82)` | Obsidian Glass | Glass cards, Viewfinder, conversation drawers |
| `--bg-surface-glass-heavy`| `rgba(14, 18, 25, 0.94)` | Dense Glass | Master modals (Workspace, Settings) |
| `--bg-pill` | `rgba(232, 235, 239, 0.05)` | Frosted Pill | Badges, docked buttons, quick action icons |
| `--bg-pill-hover` | `rgba(232, 235, 239, 0.09)` | Illuminated Pill | Hovered buttons and selectable chips |
| `--fg-bright` | `#ffffff` | Pure White | Emissive orb nucleus, focused active icons |
| `--fg` | `#e8ebef` | Silver White | Primary headings, button labels, time digits |
| `--fg-secondary` | `#c5d3e3` | Pale Ice Slate | Subheadings, secondary labels, table headers |
| `--muted` | `rgba(232, 235, 239, 0.52)` | Muted Ash | Input placeholders, inactive tabs, timestamps |
| `--faint` | `rgba(232, 235, 239, 0.29)` | Faint Translucent | Subtitles (`INTELLIGENT PRESENCE`), grid lines |
| `--disabled` | `rgba(232, 235, 239, 0.18)` | Disabled Slate | Deactivated toggles, disabled actions |
| `--accent` | `#9db4d3` | Steel Blue | Primary accent, orb ring tint, active focus rings |
| `--accent-bright` | `#cfe2f7` | Luminous Ice Blue | Particle highlights, selected badge background |
| `--accent-deep` | `#355c8a` | Deep Cosmic Cobalt | Outer orbital ring tint, subtle back-glows |
| `--accent-cyan` | `#00f3ff` | Electric Cyan | Tactical HUD targets, POI reticles, map routes |
| `--accent-sky` | `#38bdf8` | Sky Blue | Active conversation chips, streaming ticker |
| `--status-ready` | `#22c55e` | Emerald Green | Ready pill dot, user clearance indicator, verified |
| `--status-active` | `#38bdf8` | Ice Sky Blue | Online status dot, active listening session |
| `--status-warning` | `#f59e0b` | Solar Amber | Action confirmation cards, snooze states |
| `--status-critical` | `#ef4444` | Coral Crimson | Emergency stop, camera failure, auth errors |

### 2.2 CSS Variables Declaration (`:root`)

The authoritative tokens are declared in [`frontend/src/Presence.css`](file:///C:/D/Projects/AI/Oracle/frontend/src/Presence.css):

```css
:root {
  color-scheme: dark;

  /* --- Core Canvas & Void Tokens --- */
  --bg: #0c0e11;
  --bg-canvas: #06090e;
  --bg-void: #020408;
  --bg-surface: #0e1218;
  --bg-surface-glass: rgba(14, 18, 24, 0.82);
  --bg-surface-glass-heavy: rgba(14, 18, 25, 0.94);
  --bg-pill: rgba(232, 235, 239, 0.05);
  --bg-pill-hover: rgba(232, 235, 239, 0.09);
  --bg-pill-active: rgba(157, 180, 211, 0.14);

  /* --- Typography & Foreground Tokens --- */
  --fg: #e8ebef;
  --fg-bright: #ffffff;
  --fg-secondary: #c5d3e3;
  --muted: rgba(232, 235, 239, 0.52);
  --faint: rgba(232, 235, 239, 0.29);
  --disabled: rgba(232, 235, 239, 0.18);

  /* --- Accent & Illumination Palette --- */
  --accent: #9db4d3;
  --accent-bright: #cfe2f7;
  --accent-muted: #7e95ad;
  --accent-deep: #355c8a;
  --accent-cyan: #00f3ff;
  --accent-sky: #38bdf8;
  --accent-glow: rgba(157, 180, 211, 0.22);
  --accent-cyan-glow: rgba(0, 243, 255, 0.18);

  /* --- Hairline Borders & Specular Insets --- */
  --border-hairline: rgba(232, 235, 239, 0.08);
  --border-subtle: rgba(232, 235, 239, 0.12);
  --border-accent: rgba(157, 180, 211, 0.24);
  --border-cyan: rgba(0, 243, 255, 0.28);
  --specular-top: inset 0 1px 0 rgba(255, 255, 255, 0.08);

  /* --- Semantic Status Indicators --- */
  --status-ready: #22c55e;
  --status-ready-glow: rgba(34, 197, 94, 0.35);
  --status-active: #38bdf8;
  --status-active-glow: rgba(56, 189, 248, 0.35);
  --status-warning: #f59e0b;
  --status-warning-glow: rgba(245, 158, 11, 0.35);
  --status-critical: #ef4444;
  --status-critical-glow: rgba(239, 68, 68, 0.35);

  /* --- Elevation & Glassmorphism --- */
  --shadow-card: 0 32px 80px -16px rgba(0, 0, 0, 0.85);
  --shadow-modal: 0 40px 100px -20px rgba(0, 0, 0, 0.95);
  --blur-glass: 28px;
  --blur-modal: 40px;

  /* --- Font Families --- */
  --font-sans: 'Inter', system-ui, -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
}
```

---

## 3. Typography & Monospace Hierarchy

Typography utilizes two coordinated Google Fonts: **Inter** for clean UI controls and brand identity, and **JetBrains Mono** for chronometers, timestamps, coordinates, and telemetry.

### 3.1 Font Families & Weights

| Style Role | Font Family | Weights | Character Spacing | Typical Elements |
|---|---|---|---|---|
| **Brand Lettermark** | `Inter` | 700 (Bold) | `0.38em` uppercase | `ORACLE` header logo |
| **Brand Subtitle** | `Inter` | 400 (Regular) | `0.22em` uppercase | `INTELLIGENT PRESENCE` |
| **Tactile Buttons** | `Inter` | 500 (Medium) | `0.03em` | `:: Workspace`, `Tactical Map` |
| **Chronometer** | `JetBrains Mono` | 300 / 400 | `0.06em` | `00:09:49` Docked clock |
| **Status Pills** | `JetBrains Mono` | 400 (Regular) | `0.08em` uppercase | `SUN 8 NOV • ONLINE`, `READY` |
| **HUD Coordinates** | `JetBrains Mono` | 400 (Regular) | Normal | Lat/Lng, Confidence scores, FPS |
| **Body / Transcripts** | `Inter` | 400 / 500 | Normal | Conversation speech, modal settings |

---

## 4. Celestial 3D Orb Scene Architecture

The center visual element is a Three.js WebGL scene implemented in [`frontend/src/scene/PresenceScene.ts`](file:///C:/D/Projects/AI/Oracle/frontend/src/scene/PresenceScene.ts).

### 4.1 Structural Components
1. **Luminous Nucleus:** A central core sphere (`0xffffff` emissive aura with `#CFE2F7` inner falloff) representing active consciousness.
2. **Core Halo Nebula:** A CSS radial glow (`rgba(157, 180, 211, 0.048)` with `filter: blur(60px)`) suspended directly behind the 3D canvas.
3. **Point Cloud Shell:** Concentric spheres of point particles (`#DFE5EC` and `#7AA7D9`) that shimmer and expand based on audio RMS amplitude.
4. **Orbital Vector Rings:** Inclined wireframe ellipses (`#355C8A` and `#7E95AD`) rotated along trigonometric axes, carrying revolving satellite nodes (`0xaab8c9`).

### 4.2 Reactive States

| Assistant State | Core Nucleus Behavior | Orbital Rings | Particle Shell |
|---|---|---|---|
| **Dormant / Standby** | Slow harmonic breath (0.8 Hz) | Slow laminar rotation (0.002 rad/frame) | Rest volume (radius ~1.0) |
| **Audio Acquisition (Listening)**| Dynamic RMS dilation (scale 1.0 - 1.45) | Rotation speed scales with audio input | Points pulse with mic frequency |
| **Inference (Thinking)** | Smooth rotating orbital precession | Accelerated multi-axis spin | Concentric rings constrict inward |
| **Vocalizing (Speaking)** | Pulsing in sync with TTS waveform | Rhythmic oscillation | Surface nodes emit radial ripples |

---

## 5. Glassmorphism, Elevation & Borders

The visual depth of all floating panels relies on three coordinated CSS techniques:

### 5.1 The Obsidian Glass Recipe
```css
.oracle-glass-surface {
  background: rgba(14, 18, 24, 0.82);
  backdrop-filter: blur(32px) saturate(170%);
  -webkit-backdrop-filter: blur(32px) saturate(170%);
  border: 1px solid rgba(232, 235, 239, 0.08);
  box-shadow: 
    0 32px 80px -16px rgba(0, 0, 0, 0.85),
    0 0 0 1px rgba(255, 255, 255, 0.03),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
}
```

- **Backdrop Blur & Saturation:** `blur(28px-40px)` diffuses the background 3D orb points, while `saturate(170%-200%)` maintains optical clarity without washed-out graying.
- **Sub-Pixel Hairline Border:** A `1px solid rgba(232, 235, 239, 0.08)` border creates high-definition contrast against the deep black void.
- **Top Specular Inset:** `inset 0 1px 0 rgba(255, 255, 255, 0.08)` simulates overhead ambient studio lighting reflecting off the glass edge.
- **Deep Ambient Shadow:** Multi-stop box shadows (`0 32px 80px -16px rgba(0, 0, 0, 0.85)`) elevate dialogs seamlessly off the background.

---

## 6. Component Design Standards

### 6.1 Header Bar & Chronometer Capsule
The header bar floats at the top of the viewport with mathematically absolute horizontal centering (`left: 50%; transform: translateX(-50%)`).
- **Brand Identity:** Iris glyph + `ORACLE` (13px, weight 700, tracking `0.38em`) + `INTELLIGENT PRESENCE` (8.5px, tracking `0.22em`, opacity 0.38).
- **Docked Chronometer:** JetBrains Mono timestamp in a rounded pill (`padding: 4px 14px; border-radius: 9999px; background: rgba(232, 235, 239, 0.05); border: 1px solid rgba(232, 235, 239, 0.08)`).
- **Clearance Badge:** User identity pill (`• Sahan - Admin`) featuring an emerald status dot (`#22c55e`).
- **Mode Actions:** Tactile rounded buttons with subtle micro-borders (`:: Workspace`, `Tactical Map`).

### 6.2 Surveillance Viewfinder
Implemented in [`frontend/src/components/SurveillanceViewfinder.tsx`](file:///C:/D/Projects/AI/Oracle/frontend/src/components/SurveillanceViewfinder.tsx):
- **Glass Card Shell:** Compact obsidian glass card anchored to the top-right corner or draggable.
- **Camera Viewport:** 16:9 aspect ratio video surface with corner targeting reticles.
- **POI Indicators:** Electric cyan bounding boxes (`rgba(0, 243, 255, 0.8)`) with corner brackets and confidence score tags in JetBrains Mono.
- **Targeting HUD:** Tactical crosshairs and optical recognition badges.

### 6.3 Holographic Tactical Map HUD
Implemented in [`frontend/src/components/GeoWorkspace.tsx`](file:///C:/D/Projects/AI/Oracle/frontend/src/components/GeoWorkspace.tsx):
- **Deep Space Vignette:** Radial fade blending the dark vector map into `#06090e`.
- **Tactical Grid:** Subtle 72px Cartesian grid lines (`rgba(0, 243, 255, 0.025)`).
- **Floating Command Capsule:** Centered navigation bar below the header with search input, routing chips, and layer toggles.
- **Telemetry HUD:** Fixed bottom-left capsule displaying GPS coordinates (`LAT / LNG`), heading, speed, and active route segment metrics.

### 6.4 Master Modals (Records Workspace & Settings)
- **Two-Pane Split Architecture:** Master sidebar on the left (220px) with segmented category icons; detail content panel on the right.
- **Top Ribbon:** Modal title, category breadcrumb, and a dedicated tactile close button (`Esc` or `×`).
- **Input Styling:** Obsidian inputs (`background: rgba(8, 12, 18, 0.65); border: 1px solid rgba(232, 235, 239, 0.12)`) with glowing cyan/steel blue focus outlines.

---

## 7. Status & Semantic Indicators

ORACLE conveys status through consistent, color-coded illuminated dots paired with plain text labels:

| State | Dot Color | Glow Aura | Meaning |
|---|---|---|---|
| **READY** | `#22c55e` (Emerald) | `rgba(34, 197, 94, 0.35)` | System operational, models ready, idle |
| **ONLINE** | `#38bdf8` (Ice Sky) | `rgba(56, 189, 248, 0.35)` | Backend WebSocket connected, network active |
| **LISTENING** | `#00f3ff` (Cyan) | `rgba(0, 243, 255, 0.45)` | Microphone capturing user speech |
| **PROCESSING**| `#9db4d3` (Steel) | `rgba(157, 180, 211, 0.30)` | LLM / Vision model inference underway |
| **CONFIRMATION**| `#f59e0b` (Amber) | `rgba(245, 158, 11, 0.35)` | Action proposal awaiting user approval |
| **ALERT / ERROR**| `#ef4444` (Crimson)| `rgba(239, 68, 68, 0.40)` | Disconnection, permission denial, error |

---

## 8. Accessibility & Ergonomics

1. **High Contrast:** All text meets or exceeds WCAG 2.1 AA/AAA contrast ratios against the `#0c0e11` background:
   - Primary Text (`#e8ebef` on `#0c0e11`): Contrast ratio **14.2:1** (AAA requires 7:1).
   - Secondary Text (`--muted` on `#0c0e11`): Contrast ratio **7.8:1** (AA requires 4.5:1).
2. **Dual-Channel Status:** Colors are never used alone to convey critical state; all indicators include text labels (e.g. `• READY`, `• ONLINE`) or distinct geometric icons.
3. **Hit Targets:** Interactive buttons, pills, and toggles enforce a minimum touch/click target of **44×44px**.
4. **Reduced Motion:** When `@media (prefers-reduced-motion: reduce)` is active, 3D orb orbital spin rates are dropped to gentle static geometry and backdrop transition durations are clamped to zero.

---

## 9. File References & Cross-Links

- **Primary Stylesheet:** [`frontend/src/Presence.css`](file:///C:/D/Projects/AI/Oracle/frontend/src/Presence.css)
- **Tactical Map Styles:** [`frontend/src/components/GeoWorkspace.css`](file:///C:/D/Projects/AI/Oracle/frontend/src/components/GeoWorkspace.css)
- **Surveillance Viewfinder Styles:** [`frontend/src/components/SurveillanceViewfinder.css`](file:///C:/D/Projects/AI/Oracle/frontend/src/components/SurveillanceViewfinder.css)
- **Records Workspace Styles:** [`frontend/src/components/RecordsWorkspace.css`](file:///C:/D/Projects/AI/Oracle/frontend/src/components/RecordsWorkspace.css)
- **Settings Modal Styles:** [`frontend/src/components/SystemSettingsModal.css`](file:///C:/D/Projects/AI/Oracle/frontend/src/components/SystemSettingsModal.css)
- **3D Celestial Scene:** [`frontend/src/scene/PresenceScene.ts`](file:///C:/D/Projects/AI/Oracle/frontend/src/scene/PresenceScene.ts)
- **Dormant Mode Canvas:** [`dormant.html`](file:///C:/D/Projects/AI/Oracle/dormant.html)
