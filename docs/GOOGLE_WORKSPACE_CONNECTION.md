# Google Calendar, Tasks and timed reminders

Project selected by the user: **oracle-5ac86**. ORACLE's backend `.env` contains this non-secret project ID. A project ID alone does not grant access to its settings or to a user's Calendar/Tasks data.

## Firebase and Google access

### Combined sign-in update — 5 November 2026

**Sign in with Google** now requests identity (`openid` and verified email) and Calendar/Tasks permissions in the same authorization-code/PKCE flow. FastAPI checks the account at Google's authenticated UserInfo endpoint before saving the connection. Identity is keyed by Google's stable `sub`, not by email; only the email is returned for display. The signed-in account and refresh grant are stored together in the Windows-encrypted credential store. No second Calendar/Tasks authorization flow is needed for a new connection.

While the sign-in popup is active, the UI polls only the local connection status. When the callback succeeds, it closes the popup and loads the Google views automatically. Cancellation invalidates only the matching sign-in attempt, so an older cancellation cannot erase a newer attempt. Manual refresh remains available for recovery. Account sign-in is optional for the local application; this remains a single-user connector rather than a global login gate or multi-user data-isolation system.

This uses Google OAuth in the Firebase project's Google Cloud project. It does not create a Firebase Authentication user/session or initialize the Firebase client SDK. Existing Firebase Google sign-in was observed enabled in the project's console. With the user's explicit **Approve $0 Google setup** authorization, a dedicated **ORACLE local backend** web client was created with redirect `http://127.0.0.1:8000/api/v1/google/callback`, and Calendar and Tasks APIs were enabled and visibly verified. The downloaded configuration was validated against project `oracle-5ac86` and saved in the ignored backend client file. Billing, paid quota and Firebase plan settings were not changed. The live status endpoint now reports configured true; final account sign-in/consent is a separate user step in the open Google account chooser.

Validation of the combined flow: 146 backend tests, three Google browser tests and production build passed. The browser test verifies automatic detection of account identity and service access after one sign-in initiation. No live Calendar events or Tasks were created, completed or changed for acceptance. Setup evidence is under `output/setup/` (screenshots contain no client secret).

Firebase Google sign-in can request additional Google API scopes and expose the Google provider's access token. The Firebase ID token authenticates a Firebase user; it is not a Calendar/Tasks access token. Reliable backend access after the browser closes additionally requires Google's offline authorization flow and a refresh token.

This increment implements that Google connection directly in FastAPI, using the OAuth client from the existing Firebase/Google Cloud project. It does not add a Firebase Authentication SDK, Firestore database or multi-user account system. Existing local PostgreSQL records and local gateway authorization remain in use. An existing Firebase sign-in can be added separately without replacing this connection.

## One-time project setup

1. Open [credentials for oracle-5ac86](https://console.cloud.google.com/apis/credentials?project=oracle-5ac86). Reuse the project's appropriate web OAuth client, or create a web-application client. A Gemini API key and a Firebase service-account JSON are not substitutes.
2. Enable [Google Calendar API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com?project=oracle-5ac86) and [Google Tasks API](https://console.cloud.google.com/apis/library/tasks.googleapis.com?project=oracle-5ac86).
3. Configure the OAuth consent screen and add your own Google account as a test user if the application is in testing. Review Calendar/Tasks access on the consent screen. Testing-mode offline grants for these scopes may expire after seven days; reconnect when Google requires it.
4. Register this exact authorized redirect URI: `http://127.0.0.1:8000/api/v1/google/callback`.
5. Download the OAuth client configuration to `C:/D/Projects/AI/Oracle/backend/google-client.json`. This path is Git-ignored. Do not paste its secret in chat or place it in frontend code. Changes are read when connecting; no new account or paid subscription is created by ORACLE.
6. In ORACLE open **Workspace → Google → Connect Google**. Complete Google's account/permission selection, return to ORACLE, then press **Refresh Google connection**.

The consent request includes `calendar.events`, `calendar.calendarlist.readonly`, and `tasks`. Grant all three to use this combined connector. No Gmail or Drive access is requested. This is currently a single local user's connection, not a multi-user service.

## Implemented behavior

- List calendars and task lists; explicitly load upcoming events for 14 days and Google tasks. Views are bounded to the first 100 records and indicate additional pages. No background synchronization or change subscriptions run.
- Create an event in a chosen calendar with a popup notification offset. All event times carry explicit timezone offsets. No attendees are added; no event-update emails are sent.
- Prefill an event from a local reminder. Prefilling does not publish it. Pressing **Create in Google Calendar** explicitly creates a separate cloud record with a notification at the local due time by default. Local snooze/delete does not modify the Google copy, and Google changes do not change the local reminder.
- Create date-only Google Tasks and mark them complete/reopen. Google Tasks API discards the due time and has no equivalent timed-notification settings. Use Calendar for timed reminders. ORACLE cannot guarantee delivery on Google devices; account/app notification settings still apply.
- Disconnect attempts Google token revocation and deletes local credentials. If revocation fails, the UI explains how to remove ORACLE's access from the Google Account. Dispatched operations may finish; disconnect is not a rollback.

## Authorization and storage

Authorization codes use single-use, ten-minute state and PKCE. The callback validates state even though it cannot require the local cookie after Google's cross-site redirect. Callback query values are removed from the Uvicorn access log. Client credentials, access tokens and refresh tokens are not returned to JavaScript.

Tokens are stored under ignored `data/private/google-tokens.dpapi`, encrypted for the current Windows user using DPAPI. The implementation fails closed rather than storing plaintext on unsupported systems. Credential refresh is serialized. There is no automatic mutation replay after authentication, network or Google API errors; refresh the remote view before repeating a change with an uncertain outcome. Calendar creations include a stable operation ID for the current draft to avoid duplicate inserts on a repeated request. Tasks creation has no equivalent client-generated ID guarantee.

## Verification

Six focused backend tests passed: authentication, OAuth state/PKCE, scope checks, token secrecy, refresh, event reminder payloads/timezones, date-only Tasks semantics, no mutation replay, disconnect and actual Windows DPAPI encryption. The full backend suite passed 146 tests and production build passed (existing bundle-size advisory). Three browser tests passed with controlled Google responses for setup feedback and explicit event/task/completion actions. The live local status endpoint reports project `oracle-5ac86`, configured true, and connected false until the user completes Google consent. No live Calendar events or Tasks were created, completed or changed for acceptance.

References: [Firebase Google sign-in](https://firebase.google.com/docs/auth/web/google-signin), [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Calendar events](https://developers.google.com/workspace/calendar/api/v3/reference/events), [Google Tasks resource](https://developers.google.com/tasks/reference/rest/v1/tasks).
