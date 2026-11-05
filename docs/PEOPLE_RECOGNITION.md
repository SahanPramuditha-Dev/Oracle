# People recognition and verification

## Available behavior

Open **System Settings → Biometric Faces** to enroll, add views, edit a profile, assign a relationship or permission, revoke an identity, delete individual samples, or verify a selected face photo. A new enrollment stays selected so subsequent captures attach to that exact identity. Use **Enroll another person** to create a new identity.

- Stable person IDs own separate face-sample records. Names are labels, never identity keys. Same-name people stay separate.
- Relationships: owner, family, friend, colleague, guest. Permissions: standard, administrator, disabled. Enrollment states: incomplete, active, needs new samples, revoked.
- Existing rows retain their IDs, names, notes and embeddings during migration. Each becomes one identity with one legacy sample and needs-new-samples status. Existing names/notes do not grant privileges; all migrated identities have standard permission and guest relationship. Assign intended roles explicitly in settings.
- New identities default to standard/guest and incomplete. Three accepted varied samples mark enrollment active. Maximum: 12 samples. All valid samples may participate in a biometric comparison, including incomplete enrollment; enrollment state communicates sample coverage, not access approval.
- Adding a sample requires an explicit person ID. Duplicate views (cosine >= .995), mismatching views (best score < .45), poor-quality captures, and images containing multiple detected faces are rejected. These numerical gates are initial heuristics, not calibrated guarantees.
- Quality checks cover face size, detector score, sharpness, exposure and coarse landmark pose. They do not reliably detect all occlusions or spoofing.
- Identification compares each eligible distinct identity using its highest valid sample score. It requires the configured threshold and a .05 margin over the next distinct identity. Disabled/revoked identities are excluded. Outcomes include no face, poor quality, unknown, uncertain and recognized. No invented confidence probability is returned.
- Camera names appear only after two consecutive matching observations on an overlapping tracked face. Absence, ambiguity, identity changes, errors, long gaps and camera restarts clear confirmation. Stale labels clear after seven seconds. This remains sampled IoU tracking, not continuous motion tracking.
- Optical Sentry checks confirmed identities explicitly categorized as owner. Unknown faces or other recognized relationships do not establish owner presence.

## Verification boundaries

`POST /api/v1/people/verify?person_id=...` compares exactly one detected face against the selected person's samples. Default threshold: .45; minimum permitted: .363. It also rejects ambiguity with other eligible identities. Name-based requests remain compatible only when exactly one identity has that name; ambiguous names return 409. A supplied person ID takes precedence.

A successful result describes a **biometric comparison only**, expires after 30 seconds, and always returns `access_allowed: false`, `liveness: not_evaluated`, and `second_factor: not_checked`. It is not a reusable access token. No login, unlock or action authorization consumes this result. The browser removes the verified display when it expires or its photo/profile changes. Existing application authorization and action approval remain independent.

An evaluated presentation-attack detector, second-factor enrollment and verification, and access-policy integration remain unimplemented. Repeated face matching, pose checks and expiration do not replace those features. Do not interpret administrator metadata or `has_admin` as an access grant.

## API changes

- `GET /api/v1/people`: separate identities, sample counts/IDs, quality metadata and structured categories; no raw embeddings.
- `PATCH /api/v1/people/{id}`: edit name, notes, relationship, permission and enrollment state. Requires existing local authorization. Active enrollment requires at least three stored samples.
- `POST /api/v1/people/enroll?...&person_id=...&append_sample=true`: add a view to the selected identity. Requests without an ID create a separate identity rather than replacing by name.
- `DELETE /api/v1/people/{id}`: delete only that identity and its samples.
- `DELETE /api/v1/people/{id}/samples/{sample_id}`: delete one sample, update enrollment coverage, retain the identity.
- Identification and verification return cosine similarity, thresholds, states and reasons. The old synthetic `confidence` percentage is removed.

Inference uses a per-recognizer reentrant lock. Writes serialize on the database record lock; gallery snapshots reload on each operation so other workers' edits are visible on subsequent requests. An already-running request can finish against its initial gallery snapshot; no access is granted by that snapshot.

## Validation and evaluation

Regression coverage includes legacy migration, same-name identities, multiple samples, duplicate rejection, mismatching additions, distinct-identity ambiguity, revocation, deletion scope, corrupt embeddings, quality gates, API authorization, concurrent inference, browser confirmation and verification expiry. Real-model tests reuse a fixture portrait for integration checks; they are not an accuracy benchmark.

Run the held-out identification evaluator:

```powershell
.\backend\.venv\Scripts\python.exe scripts\evaluate_people.py path\to\manifest.json --threshold 0.45
```

Manifest structure (image paths relative to the manifest):

```json
{
  "enrollment": [{"id": "person-a", "images": ["a-front.jpg", "a-angle.jpg"]}],
  "probes": [
    {"image": "a-another-session.jpg", "expected_id": "person-a"},
    {"image": "unenrolled-person.jpg", "expected_id": null}
  ]
}
```

The evaluator uses a temporary gallery, rejects exact enrollment/probe image reuse, and reports known-person wrong-identity rate, known-person rejection rate, unknown-person false acceptance, quality/ambiguity counts and latency. Capture genuinely separate sessions; recompression or crops of the same enrollment photo are not held-out evidence. Temporary biometric storage is deleted on normal exit; reports contain aggregate counts only.

Collect representative local-camera data before selecting thresholds. Evaluate different lighting, distances, poses, glasses, partial obstruction, same-name people, lookalikes and unknown visitors. Verification false acceptance/rejection, video ID switches, end-to-end camera latency and presentation attacks need separate labeled evaluations. No measured accuracy, liveness certification or calibrated probability is claimed.

## Automatic person focus

The camera automatically selects a single visible person and keeps a selected body track when additional people enter. Use **Focus person** to switch between multiple subjects. An unambiguously associated face and body share one thin outline; recognition details appear below the video. Scores and notes are collapsed under **Recognition details**. Unrelated object overlays are hidden until **Show all objects** is enabled.

Face-to-body association checks containment in the upper body and rejects ambiguous overlapping assignments. Body tracking may continue when a face is hidden, but the recognized name is removed and the status changes to **Face hidden or not detected**. It does not preserve identity from clothing or body appearance. Existing face-confirmation and stale-result expiry rules continue to apply. If a body cannot be detected, a detected face can serve as the focus subject. These are sampled-frame tracking behaviors, not camera lens autofocus or a security verification.
