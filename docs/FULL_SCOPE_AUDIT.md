# ORACLE full-scope feature and scenario audit

**5 November currency note:** The counts and feature rows below describe the 4 November snapshot. The replacement UI is now backend-connected, and newer code includes local providers, richer vision/people modules and additional desktop controls. Do not report the historical counts as a fresh audit. Current bounded integration evidence is in [frontend/backend integration](FRONTEND_BACKEND_INTEGRATION.md); three additional acceptance checks cover sleep cancellation, camera denial and backend recovery. Hardware and full journey acceptance remain separate. Phase 8 expansion should first check those newer implementations, then address absent sourced search/document workflows.

Checked 4 November 2026 against the registers, backend routes, frontend modules and current acceptance evidence. This is a documentation/source audit, not an additional execution of every scenario.

## Correction to the phase summary

Phases 0–7 describe a deliberately small first prototype, based on three connected demonstration slices. They do **not** cover the full ORACLE inventory. The previous statement that only one core phase remained was true only for that initial plan and was misleading as a full-project progress statement. Most original capabilities have not been implemented. Nothing in the inventory is deleted or deemed delivered by reaching Phase 7.

The feature register contains 133 consolidated capabilities plus 200 overlapping legacy detail rows. The scenario register contains 24 integrated journeys plus 70 overlapping legacy entries. These counts must not be added together as unique features, nor confused with the 84 backend/38 browser tests.

## Consolidated feature status

“Implemented” means a current software path exists within the limits stated below, not unrestricted capability or hardware/production sign-off. “Partial” includes useful building blocks that do not meet the full definition. “Not implemented” means there is no dedicated product workflow; general chat or an isolated library is not a substitute.

| Status | Consolidated entries |
|---|---:|
| Implemented | 14 |
| Partial | 24 |
| Not implemented | 95 |

These are entry counts, not a weighted completion percentage or estimates of remaining effort.

| ID | Capability | Status | Evidence / limitation | Proposed continuation |
|---|---|---|---|---|
| A01 | Text conversation | Implemented | Gemini text endpoint and conversation UI; local LLM remains deferred. | Maintain/validate current scope |
| A02 | Voice conversation | Partial | Local transcription/review and local speech software pass; human microphone/speaker test deferred. | 7 + 8: core integration and assistant expansion |
| A03 | Follow up context | Implemented | Bounded context within the current page session, not long-term memory. | Maintain/validate current scope |
| A04 | Wake word and push to talk | Partial | Local push-to-talk exists; keyword wake uses optional browser recognition, not local wake-word inference. | 7 + 8: core integration and assistant expansion |
| A05 | Interrupt and cancel | Implemented | Capture/wait/playback cancellation and proposal cancellation; already dispatched work may finish. | Maintain/validate current scope |
| A06 | Personal preferences | Partial | UI preferences exist; persistent assistant language/response-length preferences do not. | 12: connected personal memory |
| A07 | Web search with sources | Not implemented | No search-provider adapter, result ingestion or source citation pipeline. Opening a URL is not web search. | 8: assistant tools and desktop workflows |
| A08 | Document questions and summaries | Not implemented | No PDF/document ingestion, chunking or document-grounded Q&A. | 8: assistant tools and desktop workflows |
| A09 | Explanations and writing support | Implemented | General explanation/writing through Gemini; no specialized document or screen pipeline. | Maintain/validate current scope |
| A10 | Translation | Partial | Text model can translate on request; dedicated language-verified translation flow absent. | 7 + 8: core integration and assistant expansion |
| D01 | Open programs | Implemented | Backend discovery, proposal and confirmation for configured executable targets only. | Maintain/validate current scope |
| D02 | Open websites | Implemented | Validated explicit HTTP(S) URL proposal and confirmation. | Maintain/validate current scope |
| D03 | Search local files | Not implemented | No dedicated implementation found in the current product modules/routes. | 8: assistant tools and desktop workflows |
| D04 | Open files and folders | Not implemented | No dedicated implementation found in the current product modules/routes. | 8: assistant tools and desktop workflows |
| D05 | Media and volume control | Not implemented | No dedicated implementation found in the current product modules/routes. | 8: assistant tools and desktop workflows |
| D06 | Window control | Not implemented | No dedicated implementation found in the current product modules/routes. | 8: assistant tools and desktop workflows |
| D07 | Screenshot capture | Not implemented | No dedicated implementation found in the current product modules/routes. | 8: assistant tools and desktop workflows |
| D08 | Screen understanding | Not implemented | No dedicated implementation found in the current product modules/routes. | 8: assistant tools and desktop workflows |
| D09 | Computer status | Not implemented | Development readiness measurements are not a product system-status feature. | 8: assistant tools and desktop workflows |
| D10 | File organization | Not implemented | No dedicated implementation found in the current product modules/routes. | 8: assistant tools and desktop workflows |
| D11 | Custom routines | Not implemented | No dedicated implementation found in the current product modules/routes. | 8: assistant tools and desktop workflows |
| D12 | Message workflows | Not implemented | No dedicated implementation found in the current product modules/routes. | 8: assistant tools and desktop workflows |
| D13 | Power control | Not implemented | No dedicated implementation found in the current product modules/routes. | 8: assistant tools and desktop workflows |
| P01 | Notes | Implemented | Backend notes CRUD/search, including reviewed dictated text. | Maintain/validate current scope |
| P02 | Tasks and checklists | Not implemented | Current tasks are timers/reminders, not general checklists or completion-state project tasks. | 9: productivity, calendars and workspaces |
| P03 | Timed reminders | Partial | Entered due times and a limited relative-time command; general date/time interpretation and background delivery absent. | 9: productivity, calendars and workspaces |
| P04 | Timers and alarms | Partial | Timers, cancellation and in-page alerts work; no operating-system alarm when the app is closed/asleep. | 9: productivity, calendars and workspaces |
| P05 | Calendar viewing | Not implemented | No dedicated implementation found in the current product modules/routes. | 9: productivity, calendars and workspaces |
| P06 | Calendar creation | Not implemented | No dedicated implementation found in the current product modules/routes. | 9: productivity, calendars and workspaces |
| P07 | Daily briefing | Not implemented | No dedicated implementation found in the current product modules/routes. | 9: productivity, calendars and workspaces |
| P08 | Project workspace | Not implemented | No dedicated implementation found in the current product modules/routes. | 9: productivity, calendars and workspaces |
| P09 | Meeting and lecture summaries | Not implemented | No dedicated implementation found in the current product modules/routes. | 9: productivity, calendars and workspaces |
| C01 | Object detection and tracking | Partial | Supported object boxes exist; stable tracking IDs and general tracking do not. | 11: richer visual workflows |
| C02 | Look and ask | Partial | Supported detector labels/counts can be reported; arbitrary object understanding/selection absent. | 11: richer visual workflows |
| C03 | Scene description | Partial | Detection summary exists; spatially grounded scene understanding absent. | 11: richer visual workflows |
| C04 | Attention based offers | Not implemented | No dedicated implementation found in the current product modules/routes. | 11: richer visual workflows |
| C05 | Touch selection | Not implemented | No dedicated implementation found in the current product modules/routes. | 11: richer visual workflows |
| C06 | Gesture selection and zoom | Not implemented | No dedicated implementation found in the current product modules/routes. | 11: richer visual workflows |
| C07 | Barcode scanning | Not implemented | QR support does not implement 1-D product barcodes. | 11: richer visual workflows |
| C08 | QR preview | Implemented | Local QR decode and inert payload preview; no automatic navigation. | Maintain/validate current scope |
| C09 | Text extraction and read aloud | Partial | OCR and correction work; direct recognized-text read-aloud workflow is not wired. | 11: richer visual workflows |
| C10 | Expiry date reading | Not implemented | No dedicated implementation found in the current product modules/routes. | 11: richer visual workflows |
| C11 | Receipt extraction | Not implemented | No dedicated implementation found in the current product modules/routes. | 11: richer visual workflows |
| C12 | Visual translation | Not implemented | No dedicated implementation found in the current product modules/routes. | 11: richer visual workflows |
| C13 | Poster to event | Not implemented | No dedicated implementation found in the current product modules/routes. | 11: richer visual workflows |
| C14 | Food recognition | Not implemented | No dedicated implementation found in the current product modules/routes. | 11: richer visual workflows |
| C15 | Plant identification and disease classification | Not implemented | No dedicated implementation found in the current product modules/routes. | 11: richer visual workflows |
| C16 | Repair information retrieval | Not implemented | No dedicated implementation found in the current product modules/routes. | 11: richer visual workflows |
| C17 | Movie and game recognition | Not implemented | No dedicated implementation found in the current product modules/routes. | 11: richer visual workflows |
| C18 | Chessboard analysis | Not implemented | No dedicated implementation found in the current product modules/routes. | 11: richer visual workflows |
| C19 | Correction feedback | Partial | OCR/memory text correction exists; gesture/object/classifier correction or training feedback absent. | 11: richer visual workflows |
| M01 | Explicit memory saving | Implemented | Explicit image/description save through authenticated backend. | Maintain/validate current scope |
| M02 | Visual memories | Implemented | Normalized image and description stored together in PostgreSQL. | Maintain/validate current scope |
| M03 | Natural language search | Partial | Keyword search and a local find-memories command; semantic/time-aware natural-language retrieval absent. | 12: connected personal memory |
| M04 | Last recorded object location | Not implemented | Free-text photo notes do not establish structured last-seen object tracking. | 12: connected personal memory |
| M05 | Conversation memory | Not implemented | Page context is not cross-session conversation memory. | 12: connected personal memory |
| M06 | Memory timeline | Partial | Saved timestamps and ordered lists; no category/date timeline interface. | 12: connected personal memory |
| M07 | Related memories | Not implemented | No dedicated implementation found in the current product modules/routes. | 12: connected personal memory |
| M08 | Evidence backed answers | Partial | Stored image, source kind and save time can be inspected; no grounded conversational retrieval answer. | 12: connected personal memory |
| M09 | Correction and deletion | Implemented | Edit/delete active notes and image memories; asset removed from active retrieval. | Maintain/validate current scope |
| M10 | Retention and review | Not implemented | No dedicated implementation found in the current product modules/routes. | 12: connected personal memory |
| H01 | Anonymous person detection | Implemented | Anonymous person/face boxes through existing local detectors; no enrollment or identity matching. | Maintain/validate current scope |
| H02 | Consenting person enrollment | Not implemented | No dedicated implementation found in the current product modules/routes. | 13: consent-based people features |
| H03 | Saved person matching | Not implemented | No dedicated implementation found in the current product modules/routes. | 13: consent-based people features |
| H04 | Person notes | Not implemented | No dedicated implementation found in the current product modules/routes. | 13: consent-based people features |
| H05 | Approved encounter records | Not implemented | No dedicated implementation found in the current product modules/routes. | 13: consent-based people features |
| H06 | People map and timeline | Not implemented | No dedicated implementation found in the current product modules/routes. | 13: consent-based people features |
| H07 | Pending enrollment expiry | Not implemented | No dedicated implementation found in the current product modules/routes. | 13: consent-based people features |
| H08 | Relationship reminders | Not implemented | No dedicated implementation found in the current product modules/routes. | 13: consent-based people features |
| L01 | Current location | Not implemented | Manual city weather lookup is not device location or a map. | 10: maps and travel |
| L02 | Saved places | Not implemented | No dedicated implementation found in the current product modules/routes. | 10: maps and travel |
| L03 | Memory pins | Not implemented | No dedicated implementation found in the current product modules/routes. | 10: maps and travel |
| L04 | Parking memory | Not implemented | No dedicated implementation found in the current product modules/routes. | 10: maps and travel |
| L05 | Nearby place search | Not implemented | No dedicated implementation found in the current product modules/routes. | 10: maps and travel |
| L06 | Camera to place search | Not implemented | No dedicated implementation found in the current product modules/routes. | 10: maps and travel |
| L07 | Route preview | Not implemented | No dedicated implementation found in the current product modules/routes. | 10: maps and travel |
| L08 | Camera navigation overlay | Not implemented | No dedicated implementation found in the current product modules/routes. | 10: maps and travel |
| L09 | Location reminders | Not implemented | No dedicated implementation found in the current product modules/routes. | 10: maps and travel |
| L10 | Trip logging | Not implemented | No dedicated implementation found in the current product modules/routes. | 10: maps and travel |
| L11 | Arrival time prediction | Not implemented | No dedicated implementation found in the current product modules/routes. | 10: maps and travel |
| L12 | Leave time suggestions | Not implemented | No dedicated implementation found in the current product modules/routes. | 10: maps and travel |
| R01 | Context based suggestions | Not implemented | No dedicated implementation found in the current product modules/routes. | 14: proactive assistance |
| R02 | Preparation prompts | Not implemented | No dedicated implementation found in the current product modules/routes. | 14: proactive assistance |
| R03 | Last seen item prompts | Not implemented | No dedicated implementation found in the current product modules/routes. | 14: proactive assistance |
| R04 | Suggestion feedback | Not implemented | No dedicated implementation found in the current product modules/routes. | 14: proactive assistance |
| R05 | Personalized ranking | Not implemented | No dedicated implementation found in the current product modules/routes. | 14: proactive assistance |
| R06 | Quiet modes and limits | Not implemented | Sound/motion preferences are not scheduled quiet modes or proactive prompt limits. | 14: proactive assistance |
| S01 | Manual SOS | Not implemented | No SOS workflow; safety concepts are not validated services. | 15: explicit safety demonstrations |
| S02 | Emergency clip saving | Not implemented | No dedicated implementation found in the current product modules/routes. | 15: explicit safety demonstrations |
| S03 | Trusted contact sharing | Not implemented | No dedicated implementation found in the current product modules/routes. | 15: explicit safety demonstrations |
| S04 | Experimental fall detection | Not implemented | No dedicated implementation found in the current product modules/routes. | 15: explicit safety demonstrations |
| S05 | Experimental repeated person alert | Not implemented | No dedicated implementation found in the current product modules/routes. | 15: explicit safety demonstrations |
| U01 | Sensor permissions and indicators | Partial | Camera/microphone opt-in and indicators; location permission and full device acceptance incomplete. | 7 + 18: cross-cutting integration and validation |
| U02 | Data dashboard | Partial | Notes/image-memory browse/edit/delete; no complete data dashboard or record export UI. | 7 + 18: cross-cutting integration and validation |
| U03 | Storage and retention controls | Partial | Explicit save and quotas; no category retention settings or expiry jobs. | 7 + 18: cross-cutting integration and validation |
| U04 | Local processing and cloud disclosure | Implemented | Local/cloud processing disclosures; explicit browser speech option and local voice default. | Maintain/validate current scope |
| U05 | Consequential action confirmation | Partial | Mapped desktop actions require confirmation; no generalized confirmation layer for all future action classes. | 7 + 18: cross-cutting integration and validation |
| U06 | Sources and uncertainty | Partial | OCR confidence and source metadata; no live web citations or complete observation/estimate provenance. | 7 + 18: cross-cutting integration and validation |
| U07 | Action history | Partial | Page-local tool outcomes; no durable timestamped action audit across sessions. | 7 + 18: cross-cutting integration and validation |
| U08 | Offline behaviour | Partial | Local voice/OCR/records and network-blocked voice checks; no fully offline conversational assistant. | 7 + 18: cross-cutting integration and validation |
| U09 | Accessibility | Partial | Responsive UI, captions, keyboard/focus and reduced motion; no full accessibility/device sign-off. | 7 + 18: cross-cutting integration and validation |
| U10 | Backup and recovery | Implemented | PostgreSQL dump and isolated restore verification; not automatic backup scheduling. | Maintain/validate current scope |
| U11 | Evaluation dashboard | Not implemented | No dedicated implementation found in the current product modules/routes. | 7 + 18: cross-cutting integration and validation |
| X01 | Allergen profile and product alerts | Not implemented | No dedicated implementation found in the current product modules/routes. | 16: selected specialist workflows |
| X02 | Price tracking from a supplied link | Not implemented | No dedicated implementation found in the current product modules/routes. | 16: selected specialist workflows |
| X03 | Local product recognition | Not implemented | No dedicated implementation found in the current product modules/routes. | 16: selected specialist workflows |
| X04 | Sketch recognition | Not implemented | No dedicated implementation found in the current product modules/routes. | 16: selected specialist workflows |
| X05 | Gesture games | Not implemented | No dedicated implementation found in the current product modules/routes. | 16: selected specialist workflows |
| X06 | Other board game assistance | Not implemented | No dedicated implementation found in the current product modules/routes. | 16: selected specialist workflows |
| X07 | Animal and wildlife identification | Not implemented | No dedicated implementation found in the current product modules/routes. | 16: selected specialist workflows |
| X08 | Constellation finder | Not implemented | No dedicated implementation found in the current product modules/routes. | 16: selected specialist workflows |
| X09 | AR measurement | Not implemented | No dedicated implementation found in the current product modules/routes. | 16: selected specialist workflows |
| X10 | Medicine label and reminder helper | Not implemented | No dedicated implementation found in the current product modules/routes. | 16: selected specialist workflows |
| X11 | Bill splitting | Not implemented | No dedicated implementation found in the current product modules/routes. | 16: selected specialist workflows |
| X12 | Camera currency conversion | Not implemented | No dedicated implementation found in the current product modules/routes. | 16: selected specialist workflows |
| X13 | Tip calculator | Not implemented | No dedicated implementation found in the current product modules/routes. | 16: selected specialist workflows |
| X14 | Weather based preparation | Partial | Actual city forecast; no context-driven preparation/reminder workflow. | 16: selected specialist workflows |
| X15 | Wardrobe memory and suggestions | Not implemented | No dedicated implementation found in the current product modules/routes. | 16: selected specialist workflows |
| X16 | Plant care diary | Not implemented | No dedicated implementation found in the current product modules/routes. | 16: selected specialist workflows |
| X17 | Home inventory | Not implemented | No dedicated implementation found in the current product modules/routes. | 12: connected personal memory |
| X18 | Daily story | Not implemented | No dedicated implementation found in the current product modules/routes. | 12: connected personal memory |
| X19 | On this day memories | Not implemented | No dedicated implementation found in the current product modules/routes. | 12: connected personal memory |
| X20 | Voice diary | Partial | Voice-to-reviewed text and searchable notes; no dedicated diary workflow. | 12: connected personal memory |
| X21 | Walking companion | Not implemented | No dedicated implementation found in the current product modules/routes. | 16: selected specialist workflows |
| X22 | Object based language practice | Not implemented | No dedicated implementation found in the current product modules/routes. | 16: selected specialist workflows |
| F01 | Native Android client | Not implemented | Responsive web UI is not a native Android application. | 17: additional platforms and devices |
| F02 | Smart glasses and IoT client | Not implemented | No dedicated implementation found in the current product modules/routes. | 17: additional platforms and devices |
| F03 | On device mobile inference | Not implemented | No dedicated implementation found in the current product modules/routes. | 17: additional platforms and devices |
| F04 | Visual positioning | Not implemented | No dedicated implementation found in the current product modules/routes. | 17: additional platforms and devices |
| F05 | Child and guardian product | Not implemented | No dedicated implementation found in the current product modules/routes. | 17: additional platforms and devices |
| F06 | Music recognition | Not implemented | No dedicated implementation found in the current product modules/routes. | 17: additional platforms and devices |
| F07 | Currency note recognition | Not implemented | No dedicated implementation found in the current product modules/routes. | 17: additional platforms and devices |
| F08 | Medication interaction information | Not implemented | No dedicated implementation found in the current product modules/routes. | 17: additional platforms and devices |

## All 24 integrated journeys

**None of the 24 broad integrated journeys is fully accepted end to end as originally specified.** Some narrower demonstration slices pass. Reusing OCR, speech or memory does not complete every journey that references them.

| Journey | Current status | Missing scope / limitation |
|---|---|---|
| J01 | Partial | App launch and timers exist; folder opening, general checklist/project mode and routines missing. |
| J02 | Partial | OCR/crop and approved photo memory exist; arbitrary object selection, understanding and grounded recall missing. |
| J03 | Building blocks only | OCR/QR and notes exist; poster event extraction, calendar writes and venue maps missing. |
| J04 | Building blocks only | Photo/note storage exists; parking coordinates, floor model and routing missing. |
| J05 | Building blocks only | OCR and reminders exist; products, allergen profile, ingredient reasoning and expiry interpretation missing. |
| J06 | Building blocks only | Text chat and notes exist; local file search, document ingestion and task extraction missing. |
| J07 | Building blocks only | Weather exists; calendar briefing, trip prediction, checklist and study routine missing. |
| J08 | Not implemented | No consenting enrollment, saved-person matching or encounter workflow. |
| J09 | Building blocks only | OCR exists; verified-model manual lookup and source-grounded repair workflow missing. |
| J10 | Partial | Active note/image edit/delete and asset removal verified; full data dashboard, export, retention and action history missing. |
| J11 | Building blocks only | Manual crop and OCR exist; gestures, product lookup and price-link workflow missing. |
| J12 | Building blocks only | OCR exists; visual translation, receipt items and bill/tip workflow missing. |
| J13 | Building blocks only | Memory/reminders exist; plant identification, disease evaluation and care diary missing. |
| J14 | Building blocks only | Detector labels and speech exist; language-verified object vocabulary and quizzes missing. |
| J15 | Building blocks only | Dictated notes/photo memories exist; diary synthesis, location context and historical stories missing. |
| J16 | Not implemented | No chessboard/piece extraction, state correction or chess engine. |
| J17 | Partial | Reviewed local speech and app proposal work; sourced web search and system volume control missing; human audio acceptance deferred. |
| J18 | Building blocks only | Uploaded still OCR exists; screen capture, screenshot understanding and troubleshooting workflow missing. |
| J19 | Not implemented | No species recognition or orientation-based sky view. |
| J20 | Building blocks only | Weather exists; wardrobe, occasion context and calendar preparation missing. |
| J21 | Partial | Photo/text keyword recall exists; dedicated inventory, item-location reasoning and sensitive-item access design missing. |
| J22 | Not implemented | No test SOS, incident clip or configured-contact sharing workflow. |
| J23 | Building blocks only | OCR exists; verified amount/currency extraction, dated exchange rates and tip calculation missing. |
| J24 | Not implemented | No proactive prompt engine, focus schedule, feedback history or ranking. |

## All 70 legacy scenarios

Legacy descriptions are illustrative, not validated outputs. This preserves every legacy scenario and does not assume feature equivalence from similar names. The 200 legacy feature-detail rows remain preserved and are not individually signed off by this audit.

| Scenario | Description | Status | Limitation |
|---|---|---|---|
| SC-01 | Identify an Unknown Object | Partial / building blocks | Supported class labels only; no reliable board/chip/model identification. |
| SC-02 | Read and Explain Documents | Partial / building blocks | OCR exists; document-grounded explanation and paragraph context missing. |
| SC-03 | Describe Surroundings | Partial / building blocks | Object summary only, no grounded spatial scene narration. |
| SC-04 | Compare Two Objects | Not implemented | No dedicated end-to-end workflow found. |
| SC-05 | Understand Screen Content | Partial / building blocks | OCR/typed explanation building blocks; no screen-capture analysis pipeline. |
| SC-06 | Understand Diagrams | Not implemented | No dedicated end-to-end workflow found. |
| SC-07 | PC Hardware Identification | Not implemented | No dedicated end-to-end workflow found. |
| SC-08 | Computer Troubleshooting | Partial / building blocks | General advice possible; no product telemetry or authorized diagnostic tools. |
| SC-09 | Network Troubleshooting | Not implemented | No dedicated end-to-end workflow found. |
| SC-10 | Electronics Assistance | Not implemented | No dedicated end-to-end workflow found. |
| SC-11 | Learn from Textbooks | Partial / building blocks | OCR/chat building blocks; diagram and equation understanding not integrated. |
| SC-12 | Understand Concepts | Implemented, bounded text/app scope | General conceptual Q&A through Gemini, within its limitations. |
| SC-13 | Solve Problems | Partial / building blocks | General model problem-solving only; no verified calculation/evaluation workflow. |
| SC-14 | Learn Programming | Partial / building blocks | Typed code discussion possible; no screen-code ingestion/annotation. |
| SC-15 | Diagram Tutoring | Not implemented | No dedicated end-to-end workflow found. |
| SC-16 | Language Translation | Partial / building blocks | OCR and speech exist; dedicated verified visual translation missing. |
| SC-17 | Practical Assembly | Not implemented | No dedicated end-to-end workflow found. |
| SC-18 | Revision Assistant | Partial / building blocks | No document-grounded quiz pipeline; generic Q&A is only a building block. |
| SC-19 | Multiple Follow-Up Questions | Partial / building blocks | Bounded text follow-up exists; observed-object grounding missing. |
| SC-20 | Referring to Observed Objects | Not implemented | No dedicated end-to-end workflow found. |
| SC-21 | Switching Subjects Without Memory Loss | Partial / building blocks | Short page context only; no independent persistent subject threads. |
| SC-22 | Correcting the Assistant | Partial / building blocks | Page-local text corrections only; no lasting visual model recalibration. |
| SC-23 | Incomplete / Implicit Instructions | Implemented, bounded text/app scope | Immediate bounded follow-up context; no durable memory implied. |
| SC-24 | Find an Object | Partial / building blocks | Keyword image memories only; no last-seen visual object-location cache. |
| SC-25 | Object Movement Detection | Not implemented | No dedicated end-to-end workflow found. |
| SC-26 | Scene Changes | Not implemented | No dedicated end-to-end workflow found. |
| SC-27 | Counting Objects | Partial / building blocks | COCO class counts, not fine-grained blue capacitor counting. |
| SC-28 | Color Filtering | Not implemented | Not implemented; wire color alone cannot establish electrical ground. |
| SC-29 | Hand Gesture Interaction | Not implemented | No dedicated end-to-end workflow found. |
| SC-30 | Activity Recognition | Not implemented | No dedicated end-to-end workflow found. |
| SC-31 | Visual Comparison Over Time | Not implemented | No dedicated end-to-end workflow found. |
| SC-32 | Requested Monitoring | Not implemented | No dedicated end-to-end workflow found. |
| SC-33 | Daily Planning | Not implemented | No dedicated end-to-end workflow found. |
| SC-34 | Voice Reminders | Partial / building blocks | Limited reminder phrasing/form; not this full general voice/date workflow. |
| SC-35 | Calendar Scheduling | Not implemented | No dedicated end-to-end workflow found. |
| SC-36 | Shopping & Product Analysis | Partial / building blocks | OCR only; no integrated product/nutrition/price comparison. |
| SC-37 | Cooking Guidance | Not implemented | No dedicated end-to-end workflow found. |
| SC-38 | Travel Assistance | Partial / building blocks | OCR/text chat building blocks only; no verified transit assistance flow. |
| SC-39 | Visual Accessibility | Not implemented | No dedicated end-to-end workflow found. |
| SC-40 | Real-Life Sign Translation | Partial / building blocks | OCR/speech building blocks only; no integrated sign translation. |
| SC-41 | Multi-Step Task Guidance | Partial / building blocks | General text guidance possible; no grounded supported diagnostic sequence. |
| SC-42 | Personal Knowledge Recall | Partial / building blocks | Keyword record browsing; no grounded conversational recall with time filters. |
| SC-43 | Open Application | Implemented, bounded text/app scope | Only configured, discovered apps through proposal and explicit confirmation. |
| SC-44 | Search Local Files | Not implemented | No dedicated end-to-end workflow found. |
| SC-45 | Explain File Contents | Not implemented | No dedicated end-to-end workflow found. |
| SC-46 | Browser Information Lookup | Not implemented | No dedicated end-to-end workflow found. |
| SC-47 | Execute Terminal Diagnostic | Not implemented | No dedicated end-to-end workflow found. |
| SC-48 | Automate Repetitive Tasks | Not implemented | No dedicated end-to-end workflow found. |
| SC-49 | System Diagnostics Telemetry | Not implemented | No dedicated end-to-end workflow found. |
| SC-50 | Cross-Device Session Handoff | Not implemented | No dedicated end-to-end workflow found. |
| SC-51 | Identify a Building | Not implemented | No dedicated end-to-end workflow found. |
| SC-52 | Read a Distant Sign | Partial / building blocks | Crop/OCR building blocks; no distant-sign/wearable/optical-zoom workflow. |
| SC-53 | Identify Product on Shelf | Not implemented | No dedicated end-to-end workflow found. |
| SC-54 | Locate Misplaced Object | Not implemented | No dedicated end-to-end workflow found. |
| SC-55 | First-Person Spatial Guidance | Not implemented | No dedicated end-to-end workflow found. |
| SC-56 | Hands-Free Machine Repair | Not implemented | No dedicated end-to-end workflow found. |
| SC-57 | Contextual Wearable Q&A | Not implemented | No dedicated end-to-end workflow found. |
| SC-58 | Audio Micro-Notifications | Not implemented | No dedicated end-to-end workflow found. |
| SC-59 | Cross-Session Recurring Object Recognition | Not implemented | No dedicated end-to-end workflow found. |
| SC-60 | Configured Environment Presets | Not implemented | No dedicated end-to-end workflow found. |
| SC-61 | Proactive Contextual Suggestions | Not implemented | No dedicated end-to-end workflow found. |
| SC-62 | Personalized Workflow Optimization | Not implemented | No dedicated end-to-end workflow found. |
| SC-63 | Multi-Camera Fusion | Not implemented | No dedicated end-to-end workflow found. |
| SC-64 | External Sensor Telemetry | Not implemented | No dedicated end-to-end workflow found. |
| SC-65 | Full Offline Fallback | Partial / building blocks | Local OCR/voice/records work; offline local LLM/vision-reasoning fallback missing. |
| SC-66 | Local On-Device Reasoning | Partial / building blocks | Local OCR/voice are not local schematic reasoning. |
| SC-67 | Long-Term Project Summarization | Not implemented | No dedicated end-to-end workflow found. |
| SC-68 | Smart-Home Device Orchestration | Not implemented | No dedicated end-to-end workflow found. |
| SC-69 | Real-Time Multilingual Dialogue | Not implemented | No dedicated end-to-end workflow found. |
| SC-70 | Unified Tri-Device Continuum | Not implemented | No dedicated end-to-end workflow found. |

## Proposed continuation beyond the initial prototype

This is a proposed decomposition of the former catch-all “extensions” phase, not an already approved schedule or a commitment that every experimental idea is suitable for release. Existing full-scope features are retained. Select release scope explicitly before estimates; each increment needs named feature IDs, scenario acceptance and backend/storage boundaries.

| Proposed phase | Work | Examples of scenarios unlocked |
|---|---|---|
| 8 | Sourced web search, document ingestion/Q&A, scoped file tools, desktop controls and approved routines | J01, J06, J09, J17, J18 |
| 9 | General tasks/checklists, calendar reading/writing, project workspaces, briefings and meeting summaries | J01, J03, J06, J07, J20 |
| 10 | Device location, saved places/parking, map pins, nearby search and route previews; predictions later within this stream | J03, J04, J07 |
| 11 | Object selection/tracking, richer scene reasoning, barcode/product/receipt/poster extraction and verified visual translation | J02, J03, J05, J09, J11, J12 |
| 12 | Grounded record answers, persistent approved context, timelines/links, item-location records and diaries | J02, J04, J10, J15, J21 |
| 13 | Consent/enrollment design, saved people, encounter records and deletion lifecycle | J08 |
| 14 | Opt-in context rules, quiet modes, suggestion feedback, limits and evaluated ranking | J07, J20, J24 |
| 15 | Explicit test-mode SOS/clip/sharing; experimental detection requires separate feasibility and evaluation | J22 |
| 16 | Selected specialist workflows: allergens, prices, plants, chess, language learning, wildlife, finance calculations, wardrobe and inventory | J05, J11–J16, J19–J21, J23 |
| 17 | Native Android, cross-device sessions, glasses/IoT and device-specific inference | Legacy wearable/device journeys |
| 18 | Release-level cross-domain validation, retention/export, accessibility, evaluation, offline/resource and recovery coverage | All selected release journeys |

The numbering is a planning proposal. Streams have dependencies and overlapping shared controls; they are not equal-sized phases. No fixed number of remaining implementation days or “almost complete” product claim is supported.

## Implementation evidence examined

- Backend: `app/main.py`, `desktop.py`, `records.py`, `reading.py`, `memory.py`, `voice.py`, `database.py` and migrations.
- Frontend: conversation/settings, planner/notes/memories, camera/OCR, detector modules, local/browser voice hooks and city weather panel.
- Current tests demonstrate the narrow software paths, including PostgreSQL persistence, OCR/QR, approved action boundaries and local voice. Physical printed-label and human audio acceptance remain open.
- Original scenario/feature wording remains in the source registers; proposed continuation does not remove it.
