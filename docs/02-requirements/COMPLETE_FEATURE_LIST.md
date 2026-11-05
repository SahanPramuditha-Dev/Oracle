# ORACLE complete feature register

Updated 4 November 2026. Full idea inventory retained; implementation status is audited separately.

## Purpose and counting rules

This is the single authoritative feature register. It retains every idea from the supplied development guide, pasted feedback, planning conversation and older workspace documents. The 133 consolidated entries describe user capabilities and shared controls. The 200 legacy detail entries describe finer implementation, interface and platform requirements. They overlap and must not be presented as 333 independent product capabilities.

The older register claimed 195 features but contains 200 actual rows. Counts here use parsed entries. IDs with a hyphen belong to the legacy namespace; F01 to F08 are distinct from the source PDF F1 to F20. Source scenarios are listed in [USE_CASES.md](USE_CASES.md).

## Planning status

The original inventory remains intact. The existing Phases 0–7 cover only a small first prototype, not this whole list. The current source audit classifies 14 consolidated entries as implemented software within stated limits, 24 as partial and 95 as not implemented. These are not weighted completion percentages. See [full-scope audit](../FULL_SCOPE_AUDIT.md) for every consolidated ID and the proposed continuation streams. A complete release allocation and schedule remain open; no unimplemented idea is silently removed or considered delivered.

## Consolidated capabilities and individual scenarios

### General AI assistant

#### A01 Text conversation

Ask for an explanation and receive a readable answer.

#### A02 Voice conversation

Speak a question and receive a spoken answer with a transcript.

#### A03 Follow up context

After discussing a laptop, ask what about its battery life.

#### A04 Wake word and push to talk

Say Oracle or press the microphone button to begin listening.

#### A05 Interrupt and cancel

Stop spoken output or cancel a pending action.

#### A06 Personal preferences

Save a preferred language and response length, then edit or forget them.

#### A07 Web search with sources

Search for current information and open the sources behind the answer.

#### A08 Document questions and summaries

Upload the development guide and ask which stages cover evaluation.

#### A09 Explanations and writing support

Explain an error or prepare a report outline or message draft.

#### A10 Translation

Translate typed or spoken content between verified supported languages.


### Computer actions

#### D01 Open programs

Open VS Code and Calculator by name.

#### D02 Open websites

Open the university portal in the browser.

#### D03 Search local files

Find the project proposal within folders the user has selected.

#### D04 Open files and folders

Open the ORACLE project directory or a chosen document.

#### D05 Media and volume control

Pause music and reduce the system volume.

#### D06 Window control

Switch to a supported application or minimize a window.

#### D07 Screenshot capture

Capture the screen and save it to a chosen location.

#### D08 Screen understanding

Analyze a user requested screenshot and explain the visible error.

#### D09 Computer status

Report available storage, battery level and supported resource information.

#### D10 File organization

Preview moving selected PDFs into a folder and execute after confirmation.

#### D11 Custom routines

Start project mode by opening the editor, folder, task list and timer.

#### D12 Message workflows

Draft a message, show recipient and content, and send only after approval through a configured service.

#### D13 Power control

Request sleep or shutdown with confirmation and a cancellation period.


### Personal productivity

#### P01 Notes

Save a spoken project idea as a searchable note.

#### P02 Tasks and checklists

Add model evaluation to a project checklist and mark it complete later.

#### P03 Timed reminders

Create a reminder for tomorrow at 8 AM and show the interpreted date and time.

#### P04 Timers and alarms

Start a 25 minute study timer and allow cancellation.

#### P05 Calendar viewing

Summarize events scheduled for tomorrow from a connected calendar.

#### P06 Calendar creation

Preview a meeting and confirm its date, time, timezone and venue before saving.

#### P07 Daily briefing

Show requested events, tasks and weather in one briefing.

#### P08 Project workspace

Group project notes, documents, tasks and memories under ORACLE.

#### P09 Meeting and lecture summaries

With permission, transcribe a recording and draft notes and action items.


### Camera and visual understanding

#### C01 Object detection and tracking

Draw boxes around supported objects with temporary tracking IDs.

#### C02 Look and ask

Point the camera at an object and ask what it is.

#### C03 Scene description

Ask what is visible on the desk and receive a description limited to the image.

#### C04 Attention based offers

Offer details when an object stays stable and centered, using configurable thresholds and optional pointing.

#### C05 Touch selection

Tap one object in a crowded frame to select it for a question.

#### C06 Gesture selection and zoom

Point and hold or define a selection region, pinch to change the crop, and open a palm to dismiss its card.

#### C07 Barcode scanning

Decode a product barcode and retrieve available product information.

#### C08 QR preview

Classify a QR payload and show its content before opening a link or taking an action.

#### C09 Text extraction and read aloud

Highlight text on a label, notice or page and read the extracted text aloud.

#### C10 Expiry date reading

Extract a date, ask the user to verify its meaning, and offer an expiry reminder.

#### C11 Receipt extraction

Extract items and totals for correction and optional expense logging.

#### C12 Visual translation

Extract sign or menu text and display a translation in a supported language.

#### C13 Poster to event

Extract event title, date, time and venue into an editable calendar preview.

#### C14 Food recognition

Suggest a food class and clearly label portion and nutrition estimates.

#### C15 Plant identification and disease classification

Show likely classes from a leaf image and retrieve curated care information.

#### C16 Repair information retrieval

Read an appliance model label and retrieve relevant sourced manual sections.

#### C17 Movie and game recognition

Use titles, logos and interface cues to suggest a title and retrieve details without identifying actors by face.

#### C18 Chessboard analysis

Detect the board and pieces, verify game state, and request a move from a chess engine.

#### C19 Correction feedback

Use a correction button or thumbs gesture to confirm or correct a result and optionally save feedback.


### Personal memory

#### M01 Explicit memory saving

Say remember this and review the content before storage.

#### M02 Visual memories

Save a selected image, description, time and optional place.

#### M03 Natural language search

Ask which laptop was saved last week and retrieve matching records.

#### M04 Last recorded object location

Ask where the keys were last recorded and see the supporting image and time.

#### M05 Conversation memory

Choose facts or summaries to retain for future conversations.

#### M06 Memory timeline

Browse approved memories by date and category.

#### M07 Related memories

Link a poster, event, venue, tasks and notes into one context.

#### M08 Evidence backed answers

Answer from retrieved records and expose the supporting memory.

#### M09 Correction and deletion

Edit a place note or delete a memory and remove it from search.

#### M10 Retention and review

Review older records and expire them according to the selected retention settings.


### People memory

#### H01 Anonymous person detection

Show temporary person boxes without enrolling identities.

#### H02 Consenting person enrollment

Explain the proposed storage and enroll a friend only through an explicit consent process.

#### H03 Saved person matching

Compare a visible face only against enrolled people and allow uncertain results to remain unmatched.

#### H04 Person notes

Save a name, relationship, birthday and user entered notes.

#### H05 Approved encounter records

Record the time and place of an encounter when that behaviour is enabled and agreed.

#### H06 People map and timeline

Review recorded encounters for a selected enrolled person.

#### H07 Pending enrollment expiry

Delete incomplete enrollment records after their configured lifetime.

#### H08 Relationship reminders

Offer an optional reminder to contact a saved friend.


### Maps places and travel

#### L01 Current location

Show the device reported position and available accuracy information.

#### L02 Saved places

Save home, university or a useful shop with a name and notes.

#### L03 Memory pins

Display where approved photos, notes and encounters were recorded.

#### L04 Parking memory

Save a parking photo, coordinates and a floor or landmark note.

#### L05 Nearby place search

Find nearby cafes, pharmacies or transport stops using available place data.

#### L06 Camera to place search

Recognize coffee related content and offer a nearby cafe search.

#### L07 Route preview

Show a route to a chosen destination with source and availability limits.

#### L08 Camera navigation overlay

Draw a directional arrow using route waypoints, GPS and compass readings.

#### L09 Location reminders

Offer the printing reminder when a supported location trigger detects arrival at university.

#### L10 Trip logging

Record opted in journeys for later commute analysis.

#### L11 Arrival time prediction

Estimate an arrival range using recorded trips and compare with a simple baseline.

#### L12 Leave time suggestions

Suggest when to depart for an event using available journey information.


### Proactive assistance

#### R01 Context based suggestions

Near a shop, offer to show a nonempty shopping list.

#### R02 Preparation prompts

Before a meeting, offer to open its related notes.

#### R03 Last seen item prompts

Mention an item recorded at a previous place when the stored evidence supports the prompt.

#### R04 Suggestion feedback

Accept, dismiss, postpone or disable a suggestion category.

#### R05 Personalized ranking

Use opted in acceptance and dismissal records to rank future suggestions.

#### R06 Quiet modes and limits

Suppress optional prompts during study, meetings or configured hours and enforce a prompt limit.


### Emergency and safety concepts

#### S01 Manual SOS

Start a configured emergency workflow with visible status and a cancellation step where appropriate.

#### S02 Emergency clip saving

Save an encrypted incident clip with time and location when explicitly activated.

#### S03 Trusted contact sharing

Share selected incident information using previously configured contacts and permissions.

#### S04 Experimental fall detection

Detect a possible fall from supported sensors and ask whether assistance is needed.

#### S05 Experimental repeated person alert

Test short window visual recurrence without identifying strangers or inferring intent.


### Privacy reliability and controls

#### U01 Sensor permissions and indicators

Show when the camera, microphone or location is active and provide controls.

#### U02 Data dashboard

Inspect, edit, export and delete supported stored record types.

#### U03 Storage and retention controls

Choose which categories are saved and their retention periods.

#### U04 Local processing and cloud disclosure

Explain which requested operation needs an external service and what data it receives.

#### U05 Consequential action confirmation

Review sending, sharing, purchases, deletions and similar actions before execution.

#### U06 Sources and uncertainty

Separate observations, retrieved information and estimates and request a clearer view when necessary.

#### U07 Action history

Show the requested action, its outcome and relevant time without exposing secrets.

#### U08 Offline behaviour

Continue available local functions and explain which lookups require connectivity.

#### U09 Accessibility

Provide large text, captions, read aloud and suitable controls.

#### U10 Backup and recovery

Export or back up approved information and restore it through a reviewed workflow.

#### U11 Evaluation dashboard

Display measured accuracy, latency, retrieval quality and resource usage.


### Additional daily life learning and showcase features

#### X01 Allergen profile and product alerts

Compare available ingredient information with saved allergies and clearly flag missing or incomplete information.

#### X02 Price tracking from a supplied link

Save a product link and display observed price changes where access is supported.

#### X03 Local product recognition

Use a custom trained model to suggest a local grocery product class from an image.

#### X04 Sketch recognition

Analyze a doodle and offer likely object categories.

#### X05 Gesture games

Play rock paper scissors through hand gesture detection.

#### X06 Other board game assistance

Read a tic tac toe or draughts state and use game specific rules to suggest a move.

#### X07 Animal and wildlife identification

Suggest likely species from a photo and show sourced information with uncertainty.

#### X08 Constellation finder

Use time, location and orientation to show likely stars in the pointed direction.

#### X09 AR measurement

Estimate distance between selected points using a supported scale or depth method.

#### X10 Medicine label and reminder helper

Read a label and create reminders only from instructions the user verifies.

#### X11 Bill splitting

Review receipt items, assign them to people and calculate each share including agreed adjustments.

#### X12 Camera currency conversion

Confirm a scanned amount and currency and convert with a dated exchange rate.

#### X13 Tip calculator

Apply a selected percentage to a confirmed total.

#### X14 Weather based preparation

Before an outing, offer an umbrella reminder based on a dated forecast.

#### X15 Wardrobe memory and suggestions

Save tagged clothing images and request an outfit suggestion for an occasion or weather.

#### X16 Plant care diary

Save a plant profile, log watering and compare leaf images over time.

#### X17 Home inventory

Save possessions with location notes and retrieve the last recorded location.

#### X18 Daily story

Generate an editable daily summary from approved records and link back to those records.

#### X19 On this day memories

Retrieve approved memories from the same calendar date in earlier years.

#### X20 Voice diary

Transcribe a spoken thought with optional tags, time and place.

#### X21 Walking companion

Show supported step data, suggest a route and provide configured hydration prompts.

#### X22 Object based language practice

Identify a selected object, say its name in a supported language and offer a vocabulary quiz.


### Further concepts retained from the source guide

#### F01 Native Android client

Use a future native client for supported background tasks, sensors and explicitly permitted phone functions.

#### F02 Smart glasses and IoT client

Explore a camera equipped wearable or device as another input client after the core assistant works.

#### F03 On device mobile inference

Run supported models on the phone to reduce dependence on a laptop backend.

#### F04 Visual positioning

Research locating the user from imagery with an appropriate reference system.

#### F05 Child and guardian product

Treat guardian workflows and child use as a separate future product requiring dedicated design.

#### F06 Music recognition

Identify an audio sample using a configured fingerprinting service and show available track details.

#### F07 Currency note recognition

Explore a trained model for supported Sri Lankan currency note classes.

#### F08 Medication interaction information

Investigate a validated medication information source as a separate concept; do not infer safety from incomplete medication data.


## Legacy detail requirements

Original identifiers and descriptions are retained below for traceability. They are proposals, not verified behaviour. Absolute claims such as instant, seamless, zero cost, exact recognition, guaranteed latency, complete deletion or immutable logs require qualification by the architecture, privacy and testing documents. Old phase assignments have been removed because they conflict with the new roadmap. QR content is previewed rather than automatically opened. Local processing is preferred; provider fallback never silently sends private data to a cloud service. Appearance alone does not verify wiring, component specifications, identity or physical distance.

### AI legacy detail entries

| Legacy ID | Detail requirement | Source description |
|---|---|---|
| AI-01 | Natural Language Understanding | Understand normal conversational human language, idioms, and nuances. |
| AI-02 | Context Awareness | Understand the user's current physical, visual, and dialogue situation. |
| AI-03 | Contextual Conversations | Maintain meaningful multi-turn dialogue with memory of prior statements. |
| AI-04 | Follow-Up Understanding | Accurately resolve pronouns and deictic references ("that", "it", "the third one"). |
| AI-05 | Intent Recognition | Identify whether user wants information, physical analysis, or an action. |
| AI-06 | Complex Reasoning | Multi-step logical analysis for technical, scientific, and diagnostic problems. |
| AI-07 | Multimodal Reasoning | Jointly reason over simultaneous video frames, audio tone, and text. |
| AI-08 | Natural Response Generation | Generate concise, conversational, and direct spoken-first responses. |
| AI-09 | Clarification Prompts | Ask targeted questions when input is ambiguous or visual details are unclear. |
| AI-10 | Confidence Awareness | Explicitly communicate uncertainty and avoid visual or factual hallucinations. |
| AI-11 | Tool Calling | Formulate structured tool invocation arguments to execute backend actions. |
| AI-12 | Task Planning | Break complex user objectives into sequential sub-tasks. |
| AI-13 | Conversation Summarization | Condense long session transcripts into compact episodic representations. |
| AI-14 | Multilingual Support | Primary English support with extensible localization (Sinhala, Tamil, etc.). |
| AI-15 | Personality Configuration | Maintain a consistent, calm, professional, JARVIS-inspired demeanor. |
| AI-16 | Response Adaptation | Dynamically adjust response verbosity based on voice vs. text mode. |
| AI-17 | Conversation Interruption | Instantly cancel generation when user speaks or cancels. |
| AI-18 | Multi-Step Instructions | Follow instructions involving several sequential operations. |
| AI-19 | Cross-Modal References | Tie a spoken inquiry directly to an identified visual bounding box. |
| AI-20 | AI Provider Abstraction | Swappable backends (Gemini 2.0 Flash, GPT-4o, Claude 3.5, Local Ollama). |

### VO legacy detail entries

| Legacy ID | Detail requirement | Source description |
|---|---|---|
| VO-01 | Microphone Access | Low-latency audio capture via browser Web Audio API / PCM streaming. |
| VO-02 | Speech-to-Text (STT) | Continuous speech recognition (Web Speech fallback + Whisper engine). |
| VO-03 | Text-to-Speech (TTS) | Streaming audio generation using Piper / Edge-TTS / Cloud neural voices. |
| VO-04 | Wake Word Detection | Local wake word ("Hey Oracle" / "Oracle") with zero cloud streaming in standby. |
| VO-05 | Push-to-Talk (PTT) | Instant hardware/keyboard/UI trigger (Spacebar/button) for noisy environments. |
| VO-06 | Continuous Conversation | Hands-free continuous interaction mode without repeated button pressing. |
| VO-07 | Voice Activity Detection (VAD) | Local silero-VAD or WebRTC-VAD for clean speech boundary detection. |
| VO-08 | Noise Suppression | Local audio filter pipeline to minimize fan noise and room reverberation. |
| VO-09 | Speech Interruption (Barge-in) | Audio playback halts within 350ms when user speaks while Oracle is talking. |
| VO-10 | Natural Voice Model | High-fidelity neural voice with conversational pacing and natural prosody. |
| VO-11 | Speaking Indicators | Real-time UI waveform / orb visualization reflecting assistant vocalization. |
| VO-12 | Voice Profile Selection | Ability to switch between voice profiles and timbre in user settings. |
| VO-13 | Multilingual Speech | Speech recognition and generation for multiple supported languages. |
| VO-14 | Speech Speed Control | User-configurable speech playback rate (0.8x to 1.5x). |
| VO-15 | Audio Earcons & Feedback | Subtle audio cues for wake-up, acknowledgement, and task completion. |
| VO-16 | Real-Time Transcription | Live subtitle display of user speech and assistant utterances on UI canvas. |
| VO-17 | Low-Latency Streaming | Stream TTS chunks over WebSocket so audio starts before LLM finishes generation. |
| VO-18 | Echo Management | Hardware AEC / software acoustic echo cancellation to prevent self-triggering. |
| VO-19 | Background Listening | Controlled background audio listening when user explicitly engages continuous mode. |
| VO-20 | Voice Session Lifecycle | Clean state machine for voice sessions (Idle, Listening, Processing, Speaking). |

### CV legacy detail entries

| Legacy ID | Detail requirement | Source description |
|---|---|---|
| CV-01 | Webcam Integration | HTML5 MediaDevices camera integration with resolution/device selectors. |
| CV-02 | Live Camera Preview | Low-latency 16:9 camera feed panel embedded in UI. |
| CV-03 | Snapshot Capture | High-resolution still-frame capture on command or trigger. |
| CV-04 | Object Detection | Local YOLO / MobileNet detection of common objects with bounding boxes. |
| CV-05 | Object Classification | Categorization of specialized physical items (microcontrollers, tools, components). |
| CV-06 | Object Description | Rich explanations of object purpose, specifications, and pinouts. |
| CV-07 | Scene Understanding | Holistic classification of the user's workspace, room, or setting. |
| CV-08 | Spatial Relationship Mapping | Determine relative positions ("to the left of", "under the monitor"). |
| CV-09 | Optical Character Recognition (OCR) | Extract text from book pages, screens, chips, and physical packaging. |
| CV-10 | Document Understanding | Layout analysis for receipts, invoices, code printouts, and data sheets. |
| CV-11 | Image Understanding & Q&A | Answer arbitrary user questions about uploaded or captured visual frames. |
| CV-12 | Object Tracking | Track an identified entity across consecutive video frames. |
| CV-13 | Person & Face Presence | Notice presence of user in front of camera (privacy-respecting presence check). |
| CV-14 | Hand Gesture Recognition | MediaPipe hand gesture recognition (palm stop, thumbs up, pointing). |
| CV-15 | Color Identification | Extract dominant colors and distinguish colored components (wires, LEDs). |
| CV-16 | Visual Item Counting | Count repeating objects in frame (resistors, screws, keys, people). |
| CV-17 | Visual Comparison | Side-by-side comparative analysis of two objects or frames. |
| CV-18 | Visual Working Memory | Cache observed objects in session memory for subsequent conversational queries. |
| CV-19 | Environmental Audio-Visual Description | Generate spoken overview of everything visible in the room or desk. |
| CV-20 | Visual Question Answering (VQA) | Direct prompt answering grounded in specific image crops. |
| CV-21 | QR & Barcode Decoding | Local decoding of 1D barcodes and 2D QR codes with instant URL resolution. |
| CV-22 | Technical Diagram Interpretation | Parse flowcharts, circuit schematics, block diagrams, and system graphs. |
| CV-23 | Screen & Window Capture | Optional desktop screen-share stream for debugging code and error dialogs. |
| CV-24 | Visual Change Detection | Detect significant frame modifications (items removed or moved). |
| CV-25 | Visual Snapshot History | User-accessible gallery of captured frames during an active session. |

### ENV legacy detail entries

| Legacy ID | Detail requirement | Source description |
|---|---|---|
| ENV-01 | Live Scene Monitoring | Frame sampling at configurable intervals (e.g. 1 frame every 3s) for changes. |
| ENV-02 | Object Appearance Detection | Alert or record when a new object enters the monitored scene. |
| ENV-03 | Object Disappearance Detection | Alert when an object leaves the camera's field of view. |
| ENV-04 | Scene Change Detection | Detect environmental transitions (lighting changes, room shifts). |
| ENV-05 | Movement & Motion Gating | Local background subtraction to discard static frames and conserve compute. |
| ENV-06 | Relative Spatial Positioning | Quantify distances and directional bearings between observed objects. |
| ENV-07 | Activity Recognition | Identify common human tasks (soldering, reading, typing, drinking coffee). |
| ENV-08 | Environment Summarization | Produce episodic summaries of changes in the user's workspace. |
| ENV-09 | User-Directed Monitoring | "Watch this 3D print and tell me if it fails" targeted monitoring loops. |
| ENV-10 | Event Notifications | Audio or visual alerts when a monitored condition is met. |
| ENV-11 | Temporal Visual Context | Answer questions comparing the scene now vs. 10 minutes ago. |
| ENV-12 | Camera Privacy Shutter | Software & physical toggle with clear indicator to disable monitoring. |

### MEM legacy detail entries

| Legacy ID | Detail requirement | Source description |
|---|---|---|
| MEM-01 | Session Scratchpad | In-memory conversational state and recent multimodal references. |
| MEM-02 | Conversation History | SQLite-backed transcripts of prior dialogues with full-text search. |
| MEM-03 | Persistent Long-Term Memory | Stored preferences, project notes, hardware pinouts, and key user facts. |
| MEM-04 | User Preferences Profile | Tone, language, speaking rate, camera defaults, and tool privileges. |
| MEM-05 | Project Memory | Retain specific context about active user projects (e.g., "Smart Garden IoT"). |
| MEM-06 | Visual Session Memory | References to visual artifacts observed earlier in the day/session. |
| MEM-07 | Associative Context Retrieval | Retrieve relevant memories based on semantic and keyword triggers. |
| MEM-08 | Memory Summarization | Periodic consolidation of granular facts into high-level episodic memory. |
| MEM-09 | Memory Inspection & Editing | Dedicated UI settings panel to view, modify, and delete memory records. |
| MEM-10 | One-Click Memory Deletion | Complete privacy wipe of database or selective item purging. |
| MEM-11 | Explicit Memory Consent | Oracle prompts: "Should I remember this for your next session?" before storing. |
| MEM-12 | Persona Personalization | Tailor explanations to user expertise level (beginner vs. senior engineer). |
| MEM-13 | Cross-Device Sync | Sync authorized memory records between laptop, Android, and future nodes. |
| MEM-14 | Memory Expiration (TTL) | Temporary flags and reminders auto-expire after configurable durations. |
| MEM-15 | Memory Provenance | Track source timestamp, modality, and confidence for every stored fact. |

### ASSIST legacy detail entries

| Legacy ID | Detail requirement | Source description |
|---|---|---|
| ASSIST-01 | Object Explanations | Explain what unfamiliar physical items are, how they work, and their uses. |
| ASSIST-02 | Technical Assistance | Guide electronics, hardware assembly, and debugging workflows. |
| ASSIST-03 | Computer Diagnostics | Diagnose BSODs, terminal errors, high CPU/RAM usage, and broken setups. |
| ASSIST-04 | Document Assistance | Summarize, translate, and extract action items from shown documents. |
| ASSIST-05 | Learning & Tutoring | Step-by-step interactive tutor for mathematics, physics, and programming. |
| ASSIST-06 | Step-by-Step Task Guidance | Real-time audio guidance through multi-step procedures (e.g. assembly). |
| ASSIST-07 | Product Information & Specs | Look up datasheets, pinouts, and safety warnings for scanned products. |
| ASSIST-08 | Environment Descriptions | Describe physical surroundings for situational awareness or accessibility. |
| ASSIST-09 | Everyday Decision Support | Help weigh trade-offs between two options (e.g. comparing hardware components). |
| ASSIST-10 | Measurement Estimation | Visual estimation of rough dimensions and scale relative to known objects. |
| ASSIST-11 | Live Translation | Translate printed foreign text (signs, manuals, menus) into spoken English. |
| ASSIST-12 | Information Extraction | Parse serial numbers, MAC addresses, model numbers, and error codes. |
| ASSIST-13 | Systematic Troubleshooting | Guide users through binary isolation and diagnostic sanity checks. |
| ASSIST-14 | Core Knowledge Explanations | Deep scientific, engineering, and historical queries on demand. |
| ASSIST-15 | Interactive Progress Guidance | Wait for user confirmation ("Done with step 2") before providing step 3. |
| ASSIST-16 | Reminder Assistance | Create time-based and context-based reminders via voice. |
| ASSIST-17 | Task Planning Assistance | Help structure complex work sprints and daily priorities. |
| ASSIST-18 | Research Assistance | Query approved technical documentation and summarize key findings. |
| ASSIST-19 | Spatial & Directional Assistance | Explain paths, wire routing, and layout orientations. |
| ASSIST-20 | Visual Accessibility Mode | Audio descriptions of visual media for visually impaired users. |

### TOOL legacy detail entries

| Legacy ID | Detail requirement | Source description |
|---|---|---|
| TOOL-01 | Tool Registry | JSON-schema validated registry of callable backend functions. |
| TOOL-02 | Semantic Tool Selection | AI identifies correct tool and constructs validated arguments. |
| TOOL-03 | Safe Execution Engine | Run tools in isolated asynchronous workers with timeout controls. |
| TOOL-04 | Multi-Step Orchestration | Chain sequential tool outputs into subsequent reasoning steps. |
| TOOL-05 | Tiered Approval Flow | Require explicit user confirmation modal or voice OK for mutating actions. |
| TOOL-06 | Execution Audit History | Full log of tools executed, inputs, outputs, timestamps, and exit codes. |
| TOOL-07 | Graceful Error Recovery | Catch tool timeouts/exceptions and formulate helpful diagnostic replies. |
| TOOL-08 | External API Connectors | Support for weather, search, and developer documentation APIs. |
| TOOL-09 | Reminder & Timer Tool | Local timer and notification scheduler. |
| TOOL-10 | Calendar Tool | Read and append local / iCal / Google Calendar schedules. |
| TOOL-11 | Local File Reader Tool | Read authorized code, logs, and text files on the developer machine. |
| TOOL-12 | Diagnostic OS Query Tool | Inspect CPU/RAM load, disk space, and active processes safely. |
| TOOL-13 | Network Diagnostic Tool | Perform ping, DNS lookup, and HTTP status verification. |
| TOOL-14 | Script Automation Runner | Execute pre-approved PowerShell / Python scripts in workspace. |
| TOOL-15 | Action Cancellation | Immediate termination signal for running subprocesses on user request. |

### UI legacy detail entries

| Legacy ID | Detail requirement | Source description |
|---|---|---|
| UI-01 | Main Canvas Experience | 16:9 minimalist command center layout inspired by JARVIS aesthetics. |
| UI-02 | Voice Visualizer | Central audio-reactive orb/waveform reflecting listening/speaking energy. |
| UI-03 | Listening State | Distinct cyan pulsing glow indicating microphone audio acquisition. |
| UI-04 | Processing / Thinking State | Subtle rotating orbit indicator denoting LLM/Vision inference. |
| UI-05 | Speaking State | Fluid harmonic waveform animating in sync with assistant TTS output. |
| UI-06 | Camera Preview Viewport | Collapsible 16:9 video panel with live feed and detection overlays. |
| UI-07 | Conversation Stream | Chronological transcript stream with markdown and code syntax rendering. |
| UI-08 | Real-Time Transcription Strip | Live captions ticker for user speech and Oracle vocalizations. |
| UI-09 | Visual Detection HUD | Bounding boxes, labels, and OCR text highlights overlaid on camera feed. |
| UI-10 | Token Streaming Display | Smooth character-by-character typewriter text streaming. |
| UI-11 | Session History Drawer | Sidebar to browse, resume, export, or delete previous sessions. |
| UI-12 | Settings Modal | Configure AI models, API keys, audio devices, and privacy options. |
| UI-13 | Device Status Hub | Indicators for camera, microphone, battery, and connected nodes. |
| UI-14 | Connection Status Pill | Live WebSocket ping latency and backend connection indicator. |
| UI-15 | Active Model Badge | Visual badge indicating current reasoning engine (e.g. Gemini 2.0 / Ollama). |
| UI-16 | Dark Modern Theme | Deep charcoal background (#0B0F17) with cyan/teal (#06B6D4) accents. |
| UI-17 | Fluid Responsive Layout | Scalable from standard laptops (1366x768) to 4K displays. |
| UI-18 | Keyboard Shortcuts System | Space/Alt+V (Talk), Alt+C (Cam), Esc (Cancel), Alt+K (Clear). |
| UI-19 | Accessibility & Screen Reader | ARIA live regions and keyboard navigation for all controls. |
| UI-20 | Toast & Error System | Non-intrusive notification toasts for system events and warnings. |
| UI-21 | Privacy Sentinel Indicator | Bright hardware/software indicator whenever mic or camera is active. |
| UI-22 | Notification Center | Drawer for system alerts, timers, and scheduled event notifications. |
| UI-23 | Layout Customization | Toggle visibility of camera, chat, or debug telemetry drawers. |
| UI-24 | Session Controls | Start new session, pause observation, clear context, and emergency stop. |

### AND legacy detail entries

| Legacy ID | Detail requirement | Source description |
|---|---|---|
| AND-01 | Mobile Authentication | Secure token-based pairing with the user's primary Oracle backend. |
| AND-02 | Camera Stream Relay | Stream rear/front smartphone camera feed to Oracle vision pipeline. |
| AND-03 | Mobile Microphone Input | Low-latency audio streaming using mobile mic array. |
| AND-04 | Speaker Audio Output | High-clarity audio output through phone earpiece or loudspeaker. |
| AND-05 | Adaptive Bitrate Video | Dynamic WebRTC video quality based on cellular/Wi-Fi bandwidth. |
| AND-06 | Mobile Snapshot Mode | Send full-resolution 48MP/12MP photos for fine-grained OCR/inspection. |
| AND-07 | Voice Assistant Mode | Dedicated hands-free Android voice UI with lockscreen accessibility. |
| AND-08 | Foreground Service | Persistent background service ensuring continuous operation when screen is off. |
| AND-09 | QR Code Pairing | Instantly pair phone to desktop instance by scanning a QR code on the desktop UI. |
| AND-10 | Session Continuity | Seamlessly hand off conversations between desktop and smartphone. |
| AND-11 | Push Notifications | Timely mobile alerts for scheduled reminders or environmental events. |
| AND-12 | Local Offline Mode | Basic offline voice recording and cached memory lookup. |
| AND-13 | Mobile Settings Panel | Control bandwidth limits, camera resolution, and battery optimization. |
| AND-14 | Network Handover | Uninterrupted voice/data session transition between Wi-Fi and 5G. |
| AND-15 | Battery Optimization | Thermal and power management to preserve mobile battery during streaming. |

### GL legacy detail entries

| Legacy ID | Detail requirement | Source description |
|---|---|---|
| GL-01 | First-Person Camera | Ultra-lightweight POV camera integration (ESP32-CAM or wearable bridge). |
| GL-02 | Bone Conduction / Open Mic | Directional near-ear microphone capture with ambient wind reduction. |
| GL-03 | Open-Ear Audio Output | Audio feedback delivered through discreet temple micro-speakers. |
| GL-04 | Bluetooth BLE / Wi-Fi | Low-energy wireless bridge between glasses and smartphone relay. |
| GL-05 | Smartphone Relay Gateway | Phone acts as compute and networking gateway for wearable frame. |
| GL-06 | True POV Visual Reasoning | AI interprets objects directly from the user's line of sight. |
| GL-07 | Voice-First Navigation | Complete zero-touch operation through spoken prompts and tap triggers. |
| GL-08 | Contextual Wearable Q&A | Immediate audio answers to questions about real-world items in view. |
| GL-09 | Battery Telemetry | Live battery level monitoring and energy-saving sleep cycles. |
| GL-10 | Ultra-Low Latency Pipeline | Optimized pipeline targeting `< 1.2s` total turn-around for wearable queries. |
| GL-11 | Visible Recording LED | Physical LED indicator satisfying privacy requirements when camera captures. |
| GL-12 | Subtle Audio Chimes | Haptic/audio earcons alerting user to recognition without distracting. |
| GL-13 | IMU / Head Movement Sensor | Orientation sensing to detect when user is nodding or focusing on an object. |
| GL-14 | Micro-HUD Integration | Optional monochromatic heads-up display overlay for text snippets. |

### SEC legacy detail entries

| Legacy ID | Detail requirement | Source description |
|---|---|---|
| SEC-01 | Local Authentication | Password/token protection for local API endpoints and web client. |
| SEC-02 | Role-Based Permissions | Granular controls separating read-only queries from system modifications. |
| SEC-03 | Secret & API Key Isolation | All cloud API credentials stored exclusively in server environment files. |
| SEC-04 | Transport Layer Encryption | TLS 1.3 / WSS protocols for all remote network and device communications. |
| SEC-05 | Encrypted Storage | SQLite database encryption (SQLCipher) for stored memories and logs. |
| SEC-06 | Explicit Camera Consent | Browser and application camera access prompts with permission revocation. |
| SEC-07 | Explicit Mic Consent | Microphone access gated behind user authorization. |
| SEC-08 | Recording Sentinel | Unmistakable UI badge and tray notification whenever sensors are active. |
| SEC-09 | Retention Policies | Automated TTL cleanup of transient audio buffers and unprocessed frames. |
| SEC-10 | Right to be Forgotten | Dedicated "Wipe Everything" button that deletes all databases and logs. |
| SEC-11 | Comprehensive Audit Log | Immutable local log of all executed commands, tools, and memory writes. |
| SEC-12 | API Rate Limiting | Token-bucket rate limiters on backend routes to prevent runaway costs. |
| SEC-13 | Input Sanitization | Strict Pydantic model validation on all REST and WebSocket payloads. |
| SEC-14 | Resilient Error Handling | Safe fallbacks for missing files, disconnected devices, and network drops. |
| SEC-15 | WebSocket Reconnect | Automatic reconnect protocol with message replay and state recovery. |
| SEC-16 | Multi-Model Failover | Automatic cascade: Primary Cloud LLM -> Backup Cloud LLM -> Local LLM. |
| SEC-17 | System Resource Watchdog | Monitor RAM/CPU load and throttle frame rate if system experiences pressure. |
| SEC-18 | API Cost Tracking | Live telemetry tracking estimated cents spent per model invocation. |
| SEC-19 | User Consent Dialogs | Interactive confirmation modals for sensitive actions. |
| SEC-20 | Command Whitelist Sandbox | Strict whitelist of allowed shell utilities preventing arbitrary command injection. |

## Sources

- Supplied Project_ORACLE_Development_Guide.pdf, November 2026, 26 pages.
- Supplied Pasted text.txt feedback.
- User planning conversation through 3 November 2026.
- Previous workspace feature and scenario registers, retained in the pre-consolidation archive.

The PDF is a source proposal. Its model counts, feature tiers, API availability and legal statements are not adopted as verified requirements.
