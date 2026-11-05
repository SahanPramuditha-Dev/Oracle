# ORACLE complete scenario register

Updated 4 November 2026. Full scenario inventory retained; current implementation audit linked below.

## Current implementation boundary

The initial development phases do not complete this full register. No J01–J24 broad journey is fully accepted as originally specified, even though several narrower demonstrations and shared components pass. See [full-scope audit](../FULL_SCOPE_AUDIT.md) for all 24 integrated journeys and all 70 legacy scenarios with implementation limits. Original example responses below remain illustrative, not evidence of delivered behavior.

## Scenario register

There are 24 integrated journeys J01 to J24 and 70 legacy scenarios SC-01 to SC-70. All are proposed examples. The two sets overlap; 94 means scenario entries, not 94 independent workflows or passed tests. Every consolidated feature also has a short individual example in [the feature register](COMPLETE_FEATURE_LIST.md).

When a journey is selected for implementation, define its preconditions, trigger, result, cancellation, failure behaviour and privacy effects. J scenarios already reference consolidated feature IDs. The SC scenarios reference the retained legacy IDs. For now these are discussion examples rather than implementation checklists.

## Integrated journeys


### J01 Project working session

Features: D01 D04 D11 P02 P04

Start project mode. Open configured programs and folder, display tasks, start a timer and report individual failures.

Conditions: User selected applications and paths; routine configuration.

### J02 Understand and remember an object

Features: C02 C05 M01 M02 M03 M08

Select an object, ask about it, review the answer, save it and retrieve it later with the original evidence.

Conditions: Camera permission; explicit save; uncertainty visible.

### J03 University event assistant

Features: C09 C13 P03 P06 L02 L07 M07

Scan a poster, correct its fields, confirm the event, save the venue and retrieve notes before attending.

Conditions: Resolve ambiguous date and timezone; confirm calendar write.

### J04 Find parked vehicle

Features: L04 M03 M04 L07

Save a parking photo and floor note, then retrieve the record and route toward its recorded coordinates.

Conditions: GPS accuracy shown; indoor floor note; record is historical.

### J05 Product and allergy check

Features: C07 C09 X01 C10 P03

Scan a product, review retrieved and visible label information, compare listed ingredients and optionally save an expiry reminder.

Conditions: Ingredient information can be missing; verify expiry date; no guarantee of allergen safety.

### J06 Work with the development guide

Features: D03 D04 A08 P02 P08

Find the guide, summarize a selected section, preview extracted tasks and approve additions to the checklist.

Conditions: Selected search folders; document content treated as data.

### J07 Prepare for university

Features: P05 L11 L12 X14 D11

Review events, estimate departure time, show a checklist and offer the configured study routine.

Conditions: Calendar and trip availability; predictions presented as estimates.

### J08 Remember a consenting friend

Features: H02 H04 H05 H06 U02

Enroll with consent, save notes, approve an encounter record and later review or delete it.

Conditions: Consent and enrollment design; uncertain matches remain unconfirmed.

### J09 Repair information

Features: C09 C16 A08

Read a model label, verify the model and retrieve relevant manual instructions with source references.

Conditions: No unsupported repair steps; hazardous repairs referred to qualified help.

### J10 Control personal data

Features: U02 U03 M09 U07

Inspect a saved record, edit or delete it and verify removal from retrieval and applicable linked stores.

Conditions: Define handling for vectors, thumbnails, logs and backups.

### J11 Gesture shopping assistant

Features: C06 C07 C09 C19 X01 X02

Select and enlarge a product crop, identify it, inspect details, correct errors and optionally save a price link.

Conditions: Digital zoom adds no missing detail; price access may be unavailable.

### J12 Restaurant assistant

Features: C12 C11 X11 X13

Translate selected menu text, scan the bill, correct extracted values, allocate items and calculate shares and tip.

Conditions: Supported languages; totals and service charges verified.

### J13 Plant companion

Features: C15 X16 P03

Open a saved plant, inspect a leaf, review likely classes, log care and create a watering reminder.

Conditions: Real world image evaluation; uncertain disease class labelled.

### J14 Language learning

Features: C02 X22 A10

Select an object, hear its name in a supported language and answer a vocabulary quiz.

Conditions: Verify recognition and language support.

### J15 Personal daily diary

Features: X20 M02 L03 X18 X19

Dictate a thought, save selected memories, review an editable daily story and revisit older records.

Conditions: Only approved records included; no claim to capture the entire day.

### J16 Chess coach

Features: C18 C19

Scan a board, correct the pieces, supply missing game state, then request a hint or move with an explanation.

Conditions: Turn, castling and en passant state may require user input; reject invalid positions.

### J17 Voice desktop assistance

Features: A02 D01 D02 A07 D05

Ask by voice to open an app, run a search and change volume; see each action outcome.

Conditions: Supported allowlisted actions and validated inputs.

### J18 Screen troubleshooting

Features: D07 D08 A09

Request a screenshot analysis, inspect the proposed explanation and choose any next action.

Conditions: Explicit capture; avoid silently recording sensitive screen content.

### J19 Outdoor discovery

Features: X07 X08 L01

Photograph wildlife for likely species, or switch to an orientation based sky view.

Conditions: Species uncertainty and sensor accuracy shown; sky view is a distinct mode.

### J20 Wardrobe and weather

Features: X15 X14 P05

Select an occasion, review the forecast and request suggestions using saved clothing.

Conditions: User approved wardrobe and relevant weather data.

### J21 Home inventory search

Features: X17 M02 M04

Save a passport location with a private note, then ask for its last recorded location.

Conditions: Sensitive memory access and deletion controls.

### J22 Emergency workflow demonstration

Features: S01 S02 S03

Activate a test SOS, review cancellation behaviour, save a test clip and exercise configured sharing.

Conditions: Clearly designated test mode; delivery and storage results visible; no reliability guarantee.

### J23 Travel price calculation

Features: C09 X12 X13

Read a foreign price, confirm amount and currency, convert using a dated rate and calculate an optional tip.

Conditions: Rate timestamp and rounding shown.

### J24 Focus and proactive support

Features: R01 R02 R04 R05 R06

Enable focus mode, suppress optional prompts, then review accepted and dismissed suggestions afterward.

Conditions: Prompt limits and user controls enforced.


## Behaviour ideas to consider

- Ask for clarification when the selected object, date, person, file or action is ambiguous.
- Denied sensor access stops that input and leaves text or manual alternatives available.
- A timeout, unavailable provider or missing file produces a visible failure without invented success.
- Preview consequential changes and bind confirmation to the exact action and inputs.
- Stop cancels pending work; report any irreversible step that already happened.
- Show the source record for memory answers and distinguish a historical sighting from current position.
- No scenario is currently a delivery commitment; select the first demonstrations during scope review.
- Log minimal evidence needed for evaluation; do not save raw camera or microphone streams by default.

## Legacy scenario interpretation

The following examples are preserved from the previous workspace register. Their exact sample answers are hypothetical, not validated outputs. Product specifications need a verified model identifier and source. Wire colour does not establish ground or electrical safety. Wearable obstacle and repair guidance is future research, not a safety service. Optical detail cannot be created by digital enlargement. A photograph alone cannot establish every chess state field or a person's intent.

## Legacy domain 1 Everyday Visual Assistance (SC-01 to SC-06)

### SC-01 — Identify an Unknown Object
- **Interaction**: User holds up a printed circuit board to the webcam: *"Oracle, what is this?"*
- **Oracle Response**: Analyzes frame, classifies chip package: *"That appears to be an ESP32 development board (ESP-WROOM-32). It features integrated 2.4 GHz Wi-Fi, Bluetooth, and 30 GPIO pins, commonly used for IoT and smart home projects."*
- **Follow-up**: User: *"What can I build with it?"* -> Oracle retains ESP32 subject and suggests 3 practical projects (Wi-Fi environmental logger, Bluetooth relay controller, or smart switch).
- **Features Involved**: `CV-01`, `CV-03`, `CV-05`, `CV-06`, `AI-04`, `AI-07`, `VO-02`, `VO-03`.

### SC-02 — Read and Explain Documents
- **Interaction**: User holds a legal or technical document in front of camera: *"Oracle, read this document."*
- **Oracle Response**: Extracts OCR text, outlines key terms and clauses, and provides a concise executive summary.
- **Follow-up**: User: *"Explain the third paragraph in simple terms."* -> Oracle references the extracted paragraph without re-requesting the image.
- **Features Involved**: `CV-09`, `CV-10`, `AI-03`, `AI-04`, `ASSIST-04`.

### SC-03 — Describe Surroundings
- **Interaction**: User: *"Oracle, describe what is in front of me."*
- **Oracle Response**: Scans scene: *"Your desk has a laptop in the center, an open spiral notebook to the right, a smartphone face-up near the keyboard, and a coffee mug on the left."*
- **Features Involved**: `CV-04`, `CV-07`, `CV-08`, `ASSIST-08`.

### SC-04 — Compare Two Objects
- **Interaction**: User holds two development boards (e.g., Arduino Uno and ESP32): *"What's the difference between these two?"*
- **Oracle Response**: Identifies both boards in frame and compares processor speed, wireless capability, operating voltage, and memory.
- **Features Involved**: `CV-17`, `AI-07`, `ASSIST-09`.

### SC-05 — Understand Screen Content
- **Interaction**: User points camera at or screen-shares a code terminal displaying a stack trace: *"Oracle, what does this error mean?"*
- **Oracle Response**: Reads the traceback (e.g. `ModuleNotFoundError: No module named 'fastapi'`), identifies the root cause, and provides the terminal command to install it.
- **Features Involved**: `CV-09`, `CV-23`, `ASSIST-02`, `ASSIST-03`.

### SC-06 — Understand Diagrams
- **Interaction**: User holds up a system architecture diagram or circuit schematic: *"Explain how this diagram works."*
- **Oracle Response**: Traverses the components and arrows, explaining data flow from inputs through processing blocks to the output display.
- **Features Involved**: `CV-22`, `AI-07`, `ASSIST-05`.

---

## Legacy domain 2 Technical Support & Diagnostics (SC-07 to SC-10)

### SC-07 — PC Hardware Identification
- **Interaction**: User opens desktop tower: *"Oracle, what components can you identify?"*
- **Oracle Response**: Recognizes GPU PCIe slot, RAM DIMM slots, CPU cooler, and ATX 24-pin power connector, noting which RAM slots are populated.
- **Features Involved**: `CV-05`, `CV-06`, `ASSIST-01`.

### SC-08 — Computer Troubleshooting
- **Interaction**: User: *"My computer is running slowly and freezing."*
- **Oracle Response**: Guides user through opening Task Manager or offers to run an authorized system resource check to inspect CPU/RAM spikes.
- **Features Involved**: `ASSIST-03`, `TOOL-12`, `TOOL-05`.

### SC-09 — Network Troubleshooting
- **Interaction**: User points camera at Wi-Fi router: *"Why is my internet not working?"*
- **Oracle Response**: Identifies router LED status (e.g. red/amber WAN light) and guides user through testing local gateway ping and DNS resolution.
- **Features Involved**: `CV-06`, `ASSIST-02`, `TOOL-13`.

### SC-10 — Electronics Assistance
- **Interaction**: User shows a color-banded resistor: *"What resistance value is this?"*
- **Oracle Response**: Decodes color bands (e.g., Red-Red-Brown-Gold) and calculates 220 Ohms with 5% tolerance.
- **Features Involved**: `CV-15`, `CV-06`, `ASSIST-10`.

---

## Legacy domain 3 Education and Learning (SC-11 to SC-18)

- **SC-11: Learn from Textbooks**: Explains page diagrams and core equations from a physics or chemistry book shown to camera.
- **SC-12: Understand Concepts**: Clear, analogy-driven explanations of conceptual queries (e.g., *"What is memory paging in operating systems?"*).
- **SC-13: Solve Problems**: Step-by-step guidance through homework or engineering calculations without simply spitting out the raw answer.
- **SC-14: Learn Programming**: Reads code on screen, annotates algorithmic complexity ($O(n \log n)$), and explains edge cases.
- **SC-15: Diagram Tutoring**: Interactively tests the user on what each node in a machine learning flowchart represents.
- **SC-16: Language Translation**: Reads foreign physical signage or print and speaks natural translated English.
- **SC-17: Practical Assembly**: Step-by-step guidance through physical mechanical or electronic kit assembly.
- **SC-18: Revision Assistant**: Generates quiz questions based on the document or notes currently visible on the user's desk.

---

## Legacy domain 4 Conversational Continuity & Context (SC-19 to SC-23)

- **SC-19: Multiple Follow-Up Questions**: Sustained 6-turn dialogue about an ESP32 board without having to re-specify the object.
- **SC-20: Referring to Observed Objects**: User asks about *"the second object"* from an earlier desk scan; Oracle immediately maps this to the phone.
- **SC-21: Switching Subjects Without Memory Loss**: User pivots from discussing microcontrollers to asking about Linux commands, then asks *"Which one did we talk about first?"* — Oracle cleanly preserves both threads.
- **SC-22: Correcting the Assistant**: User corrects Oracle: *"No, that's not a Raspberry Pi, it's an Orange Pi 5."* -> Oracle gratefully acknowledges and recalibrates for all future turns.
- **SC-23: Incomplete / Implicit Instructions**: User says *"Make it simpler"* or *"Summarize that"* -> Oracle infers the target of the operation from the immediate prior turn.

---

## Legacy domain 5 Real-Time Environmental Awareness (SC-24 to SC-32)

- **SC-24: Find an Object**: *"Where is my notebook?"* -> Oracle checks its recent visual cache and confirms it was placed to the right of the laptop.
- **SC-25: Object Movement Detection**: Notifies user when a designated item is moved or picked up.
- **SC-26: Scene Changes**: Detects if room lighting changes drastically or someone walks into view.
- **SC-27: Counting Objects**: *"How many blue capacitors are on this breadboard?"* -> Counts and circles them.
- **SC-28: Color Filtering**: *"Which wire is connected to ground?"* -> Identifies the black/green wire.
- **SC-29: Hand Gesture Interaction**: Responds to a user palm gesture to pause speaking or thumbs up to confirm an action.
- **SC-30: Activity Recognition**: Recognizes when user starts soldering, writing, or reading.
- **SC-31: Visual Comparison Over Time**: Compares a 3D print progress frame at hour 1 vs. hour 3.
- **SC-32: Requested Monitoring**: *"Watch this battery charging indicator and notify me when the green light turns on."*

---

## Legacy domain 6 Everyday Life & Personal Assistance (SC-33 to SC-42)

- **SC-33: Daily Planning**: Reviews calendar and to-do items via spoken morning briefing.
- **SC-34: Voice Reminders**: *"Remind me in 45 minutes to check the oven."*
- **SC-35: Calendar Scheduling**: Spoken booking and inspection of scheduled meetings.
- **SC-36: Shopping & Product Analysis**: Compares nutritional labels or pricing stickers of two products.
- **SC-37: Cooking Guidance**: Reads recipe steps aloud one by one, waiting for user cues before reading the next step.
- **SC-38: Travel Assistance**: Reads foreign transit schedules and explains terminal platforms.
- **SC-39: Visual Accessibility**: Real-time auditory narration for visually impaired users.
- **SC-40: Real-Life Sign Translation**: Speaks translated road signs, warning placards, or ingredient lists.
- **SC-41: Multi-Step Task Guidance**: Guides user through resetting an unresponsive router.
- **SC-42: Personal Knowledge Recall**: *"What was the model number of the motor we ordered last week?"* -> Recalls from persistent memory.

---

## Legacy domain 7 Computer & Device Control (SC-43 to SC-50)

- **SC-43: Open Application**: Launches approved local developer tools on command.
- **SC-44: Search Local Files**: Finds project files matching user-specified keywords or timestamps.
- **SC-45: Explain File Contents**: Reads local config, JSON, or log files and summarizes anomalies.
- **SC-46: Browser Information Lookup**: Fetches API reference documentation from official websites.
- **SC-47: Execute Terminal Diagnostic**: Runs safe, whitelisted command (e.g. `ping 8.8.8.8` or `git status`).
- **SC-48: Automate Repetitive Tasks**: Runs pre-approved compilation or asset bundling scripts.
- **SC-49: System Diagnostics Telemetry**: Displays live CPU, GPU, memory, and battery health telemetry.
- **SC-50: Cross-Device Session Handoff**: Hands off an ongoing desktop investigation to an Android phone when walking away from desk.

---

## Legacy domain 8 Smart-Glasses First-Person Interaction (SC-51 to SC-58)

- **SC-51: Identify a Building**: Analyzes first-person wearable camera view: *"That is the City Central Library."*
- **SC-52: Read a Distant Sign**: Zooms optical crop and reads street or gate signage directly into ear speaker.
- **SC-53: Identify Product on Shelf**: Provides instant specs and price comparison for a store item viewed.
- **SC-54: Locate Misplaced Object**: Guides user's gaze toward misplaced keys spotted in peripheral FOV.
- **SC-55: First-Person Spatial Guidance**: Warns of obstacles or guides walking direction hands-free.
- **SC-56: Hands-Free Machine Repair**: Provides audio instructions while both hands are inside an appliance.
- **SC-57: Contextual Wearable Q&A**: Answers questions about whatever the user is looking at without button presses.
- **SC-58: Audio Micro-Notifications**: Discreet whispered audio alerts for important calendar events or messages.

---

## Legacy domain 9 Advanced Research & Frontier Scenarios (SC-59 to SC-70)

- **SC-59: Cross-Session Recurring Object Recognition**: Recognizes user's custom lab equipment across days.
- **SC-60: Configured Environment Presets**: Automatically switches mode when user is at work desk vs. electronics bench.
- **SC-61: Proactive Contextual Suggestions**: Notices user has opened soldering iron and reminds them to turn on fume extractor.
- **SC-62: Personalized Workflow Optimization**: Suggests automated scripts for frequently repeated manual commands.
- **SC-63: Multi-Camera Fusion**: Fuses desk overhead camera and laptop webcam perspectives.
- **SC-64: External Sensor Telemetry**: Ingests temperature/humidity data from IoT BLE beacons.
- **SC-65: Full Offline Fallback**: Runs quantized local LLM and local vision model when internet disconnects.
- **SC-66: Local On-Device Reasoning**: Keeps sensitive proprietary schematics strictly on local machine.
- **SC-67: Long-Term Project Summarization**: Generates weekly progress report from logged activities.
- **SC-68: Smart-Home Device Orchestration**: Adjusts workbench lighting or smart plugs based on visual activity.
- **SC-69: Real-Time Multilingual Dialogue**: Simultaneously translates two people speaking different languages.
- **SC-70: Unified Tri-Device Continuum**: Continuous unbroken context spanning Laptop -> Phone -> Smart Glasses.
