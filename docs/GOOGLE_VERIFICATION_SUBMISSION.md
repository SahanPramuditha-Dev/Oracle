# Google verification preparation — 5 November 2026

## Current result

The OAuth client and Calendar/Tasks APIs are configured. Google sign-in has reached the **unverified app** warning; live account consent and access remain incomplete. Public verification has not been submitted or approved.

Console inspection found blank homepage/privacy/terms links and developer-contact fields, and no declared scopes under Data Access. Verification Center therefore described the configured scope list as having no sensitive scopes, even though Oracle's runtime authorization request includes Calendar/Tasks scopes. The request and the declared scope list must be aligned before submission.

## Prepared artifacts

- `verification-site/public/`: a responsive homepage, privacy policy, terms page, stylesheet and favicon. The site has no scripts, trackers, account forms or assistant backend.
- `verification-site/firebase.json`: hosting configuration for only that public directory, with a restrictive content-security policy and device permissions disabled. It does not upload the assistant, credentials, models or database.
- `verification-site/review.json`: proposed branding URLs, the existing support contact, scope-by-scope justification and pending evidence. Scope values match the implementation.
- `scripts/check_google_verification.py`: local preflight for required files, internal links, secret markers, hosting boundaries and scope consistency. Passing this check is not Google approval.

The contact email is the existing Google OAuth support contact. The operator must review the identity, privacy and terms statements before they are made public. No site has been published by this preparation step. Firebase CLI currently reports expired login credentials; reauthentication is required before inspecting or changing a hosting release.

## Publish only after owner review

1. Review the pages locally at `http://127.0.0.1:8766/` while the preview server is running, or open the HTML files in `verification-site/public/`.
2. Reauthenticate Firebase CLI using `firebase login --reauth`. Complete the official Google login yourself. Do not post passwords, authorization codes or CLI tokens in chat.
3. Inspect existing hosting sites/releases for project `oracle-5ac86` before deploying. Do not overwrite an existing unrelated site or change billing. The proposed site ID must exist and belong to the selected project.
4. After approval and any needed changes, run from `verification-site/`: `firebase deploy --only hosting --project oracle-5ac86 --config firebase.json`. This publishes the five public files and replaces that site's current hosting release; it is not a local preview.
5. Verify the public HTTPS pages, then set `ORACLE_PUBLIC_SITE_URL=https://oracle-5ac86.firebaseapp.com` in ignored `backend/.env` so the application links to the published policy. Do not point the UI to unpublished policy URLs.

The supplied Firebase domain is already listed as an authorized domain in the project. That alone is not proof of domain ownership or brand verification. Confirm the ownership evidence Google requires; do not invent a Search Console verification token. An owned custom domain may be needed depending on the app's final deployment and Google's review.

## Complete Google Auth Platform

Use project `oracle-5ac86`:

1. **Branding:** consistent app name, support contact, developer-contact email, public homepage and matching privacy/terms URLs.
2. **Data Access:** declare exactly the five scopes in `verification-site/review.json`; confirm Google's classifications and justify the sensitive scopes. Do not request Drive, Gmail or broader Calendar administration access. If access to non-owned calendars is removed from the product, reassess the narrower `calendar.events.owned` scope before review.
3. **Audience:** use Testing and explicit test users during development. Testing or publishing alone does not remove a sensitive-scope warning. Do not switch to public production simply to suppress the warning.
4. **Client/distribution:** the existing loopback HTTP web callback is for local development. Before a public submission, decide whether the distributed product is an installed/desktop application with its appropriate OAuth client, or an HTTPS web application. Never expose this single-user local gateway, its bearer token or client secret publicly to satisfy a web callback requirement.
5. **Verification Center:** supply accurate scope justifications and the demonstration below, review policy/compliance statements as the app owner, then submit for Google's review. Approval and timing are controlled by Google.

## Demonstration recording script

Record the actual implemented flow using a dedicated calendar/task list with disposable demonstration records. Obtain and perform the Google consent yourself; the agent has not bypassed the warning or approved data access. Do not use a public recording containing unrelated personal calendars, secrets or tokens.

1. Show the public Oracle homepage and linked privacy policy, including Google data use, deletion and support contact.
2. Open the local application, Workspace → Google, and the in-product Google-data disclosure.
3. Start one Google sign-in, show the requested permissions and public client ID, complete consent, and show the verified connected account in Oracle. Do not show the client secret, access/refresh tokens or downloaded credential file.
4. Load calendar names and choose the demonstration calendar; load upcoming events to demonstrate the two Calendar scopes.
5. Explicitly create one future event named **Oracle verification demo** with the displayed timezone and notification offset. Show the resulting event in Google Calendar. This is a real account write and must be performed/authorized by the owner.
6. Choose the demonstration task list, create **Oracle verification demo task** with a due date, show it in Google Tasks, then mark it complete in Oracle. Explain date-only Tasks due dates.
7. Show Disconnect Google and the account's access-management controls. Explain local encrypted token removal and that existing cloud records are not deleted by disconnecting.

Google requires a clear demonstration of the OAuth flow and each sensitive-scope feature. A prerecorded mock response is not live scope-use evidence. The operator must review and approve any recording upload and verification submission.

## Boundaries

Personal-use/development exceptions can allow limited testing without verification, with Google's warning still present. Preparing this package, enabling APIs or creating a client does not remove that warning. No public website, domain verification, demo recording, review submission or approval is claimed complete here.

Sources: [verification requirements](https://support.google.com/cloud/answer/13464321), [sensitive-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification), [personal-use exceptions](https://support.google.com/cloud/answer/13464323), [OAuth policies](https://developers.google.com/identity/protocols/oauth2/policies).
