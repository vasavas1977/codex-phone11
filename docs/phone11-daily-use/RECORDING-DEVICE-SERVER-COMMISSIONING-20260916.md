# Recording device and server commissioning

**Status:** Not commissioned. This runbook is for an authorized, non-production
pilot with two consenting test participants. It does not authorize a migration,
FreeSWITCH change, recording-policy change, Gemini credential use, live call,
or customer-data processing.

Phone11's expected recording path is:

```text
policy and exact call route
  -> two-leg spoken notice
  -> bounded stereo WAV capture
  -> authenticated private upload and durable manifest
  -> leased AI analysis
  -> Recents playback, summary, and transcript
```

Each arrow has an independent acceptance check. A green later step never proves
an earlier one.

## Scope and roles

Use a temporary test workspace, a dedicated test extension, and two physical
phones. The workspace administrator owns policy changes; the PBX operator owns
the non-production FreeSWITCH and storage environment; the test caller and
Phone11 user give consent before every recorded call. The observer records the
evidence packet below and may stop the run at any time.

Do not use a customer DID, customer contact, real recording, production Gemini
key, or a shared administrator account. Do not copy recording bytes, account
tokens, SIP IDs, phone numbers, or provider responses into tickets or chat.

## Source facts checked before the pilot

The following source behavior exists but is not live proof:

| Area | Current contract | Pilot expectation |
| --- | --- | --- |
| Start | Capture is disabled unless `PHONE11_CLOUD_RECORDING_CAPTURE_ENABLED=true`; it requires an active policy, exact route, assigned extension, and both-leg announcement completion. | A request without any one prerequisite offers no Start control and records nothing. |
| Stop | A successful PBX stop command first writes `capture_stop_requested_at`. The handset must then stop offering Stop while it waits for the exact `RECORD_STOP` event and upload. | The user sees a finalizing state only; Stop never persists or reappears after an accepted stop. |
| Capture | One anchored channel records bounded 16 kHz stereo audio to a tenant/token path. A transport acknowledgement alone is not completion. | Both participants hear the notice and both directions are audible in the stored WAV. |
| Upload | The spool checks a private regular WAV, uploads using the exact capture token, retries durably, and deletes local copies only after a confirmed ready acknowledgement. | A short forced upload-response loss leaves a retryable pending record, not a duplicate or false-ready recording. |
| AI | The worker reads only owned private storage under a lease and retries bounded provider failures. | A ready analysis has a complete transcript and a summary; provider failures leave an honest failed state. |
| Playback | Recents exposes playback only for an owned, unexpired ready recording. | Playback is audible to the owner, denied to another test tenant, and remains separate from the active-call audio route. |

### Current speaker-name blocker

Do **not** enable automatic human names in the pilot yet. The verified role-map
contract records which stereo channel belongs to the Phone11 extension or the
remote party, but the current Gemini request asks Gemini to label `Speaker 1`
as caller and `Speaker 2` as recipient. Those two orders are not equivalent on
every bridge. The generic Gemini request also does not split the stereo WAV
before analysis.

Named transcript and summary labels require the follow-up implementation to:

1. validate and split the stored stereo PCM WAV into separate mono WAVs;
2. transcribe each channel independently with timestamps;
3. merge turns by timestamp with a deterministic tie rule;
4. persist the same capture-token-bound stereo role map with the analysis; and
5. return contact and signed-in names locally only when that analysis provenance
   and the role map both verify.

Until then, Phone11 must show generic `Speaker 1` and `Speaker 2`, even when a
contact is matched. A manual local correction remains private to the account.

## Required non-production prerequisites

Complete and record each check before opening the feature gate:

1. **Database rehearsal.** Review the selected database and migration order on
   a protected clone: `prerequisites.sql`, then `migration.sql`. Confirm the
   resulting test tenant, active extension assignment, route row, policy row,
   and capture-token uniqueness. Do not run application startup as a migration.
2. **Private PBX connectivity.** Restrict ESL to the recording worker host.
   Configure the required values only in the private environment:
   `PHONE11_RECORDING_ESL_HOST`, `PHONE11_RECORDING_ESL_PORT`,
   `PHONE11_RECORDING_ESL_PASSWORD`, `PHONE11_RECORDING_ANNOUNCEMENT_PATH`,
   `PHONE11_RECORDING_SPOOL_PATH`, `PHONE11_RECORDING_UPLOAD_URL`, and
   `FS_SHARED_SECRET`. Verify the upload endpoint is HTTPS and ends exactly at
   `/api/recordings/upload`.
3. **Prompt and media mount.** Place the approved short male notice in the
   FreeSWITCH prompt mount and use the configured path. Confirm the prompt is
   mono, 8 kHz signed PCM. Confirm `/var/lib/freeswitch/recordings/phone11` is
   a real private mount, not a symlink; the service can create a `0700` tenant
   directory and the FreeSWITCH process can write the expected WAV there.
4. **Storage and retention.** Create an empty non-production private storage
   root for the test tenant and set a short pilot retention policy. Confirm the
   retention worker and physical deletion have an isolated rehearsal plan.
5. **Consent and disclosure.** The administrator policy does not replace
   participant consent or the required Gemini disclosure. Obtain local legal
   approval and explicit consent for the test recording before it starts.
6. **Known build.** Record the signed Phone11 build identifier, server SHA,
   policy mode, and test extension. A development launcher and a browser
   preview are not handset acceptance evidence.

Keep the capture and AI gates off until items 1–6 have been reviewed by the
authorized operators.

## Commissioning sequence

Run the tests in this order. Stop at the first failure, preserve only the
redacted evidence, disable the pilot policy, and fix the failed layer before
retrying.

### 1. Route and notice

1. Start one inbound test call to the assigned Phone11 extension. Confirm the
   active call is stable in both directions before touching recording.
2. With manual policy selected, tap **Start recording** once. Confirm that the
   two test phones both hear the approved notice once, in full, before ordinary
   speech continues. The operator confirms two exact `PLAYBACK_STOP` events:
   one per expected channel UUID and the approved prompt path.
3. Confirm Start changes to a live recording state only after the notice. A
   failed, interrupted, missing, or one-leg notice must yield no capture file,
   no ready recording, and no second automatic notice.
4. Repeat once using automatic policy only after manual behavior passes. Turn
   policy off and prove that a new call cannot start capture.

**Pass:** both participants hear one notice; the capture row is tied to the
test extension and exact channel UUID; no caller number or timestamp was used
as an ownership key.

### 2. Start, stop, and reconnect

1. Speak two short distinct phrases, one per person, after the notice.
2. Tap **Stop recording** once while the call remains connected. It should
   become a finalizing/saving state immediately after PBX acknowledgement.
3. Reload Recents or briefly background/foreground the app. The UI must not
   present another Stop action, nor claim the recording is ready before the
   exact `RECORD_STOP` event and upload finish.
4. Observe the exact `RECORD_STOP` event for the token-bound WAV. Confirm the
   temporary finalizing state reaches either ready or an honest retryable/
   failed state.
5. In a separate call, simulate only a worker reconnect after the stop request.
   The reconciler may repeat the exact private `uuid_record ... stop <token>`
   command; it must never create a new token, repeat the notice, hang up the
   call, or require a second user tap.

**Pass:** accepted Stop never sticks; a response-loss/reconnect resolves to one
capture identity; live audio remains connected throughout.

### 3. Manifest, upload, and cleanup

1. Inspect the completed WAV in the private test storage with a local operator
   tool. Verify it is a bounded RIFF/WAVE file and contains audible audio from
   both test phrases. Record a checksum and media metadata, not the audio.
2. Confirm the durable capture record has the same call UUID, tenant, capture
   token, and storage key through start, stop, and upload. Confirm the upload
   endpoint accepts exactly one copy for a retry of that token.
3. Force one safe response-loss or transient non-success response in the
   isolated upload environment. Confirm the spool copy survives, retry uses
   the same token, and completion deletes the FreeSWITCH and spool copies only
   after the ready acknowledgement.
4. Confirm a different tenant and unassigned user cannot list, inspect, or
   play the test recording.

**Pass:** one private object, one durable manifest, no duplicate, no public URL,
and no local copy left after confirmed cleanup.

### 4. Analysis, transcript, and summary

1. Enable the AI worker only after the storage path passes. Use a dedicated
   non-production Gemini credential held only by the worker. Confirm the worker
   accepts only the lease-owned private storage file.
2. Record the job transitions: queued, leased, completed or a bounded failure
   code. A provider timeout, rate limit, or invalid result must not block calling
   or expose a partial transcript as ready.
3. Confirm the ready transcript includes both short phrases and the summary is
   based on that complete transcript. Verify Thai and English if both are used.
4. Keep generic speaker labels for this phase. The named-speaker gate above is
   a separate future acceptance test.

**Pass:** the transcript and summary are complete, owner-scoped, and truthful
about failure. A recording being playable does not count as AI proof.

### 5. Recents playback and actions

1. Open the ready record in Recents on the same signed-in handset. Verify the
   correct contact/number, call direction, duration, recording badge, and AI
   summary badge. The summary and transcript tabs must refer to the same
   recording ID.
2. Play through the earpiece by default. Test Play/Pause, draggable seek,
   rewind/forward, speaker picker, Bluetooth route if available, and an
   interruption by an incoming call. Verify the active-call route is unchanged.
3. Test copy/share/export only while authenticated. Confirm the owner can use
   them and another tenant cannot obtain the media or generated text.
4. Let the pilot retention period expire in the isolated environment. Confirm
   playback and list/detail access remain blocked after physical deletion and
   the record cannot become playable again from stale metadata.

**Pass:** the handset plays only the authorized recording; every visual status
matches the server state; expired content cannot be restored by the client.

## Evidence packet

For each passing call retain only the minimum redacted evidence:

- signed build ID, backend SHA, test run ID, UTC timestamps, and policy mode;
- anonymized tenant/extension aliases and one-way hashes of call UUID and
  capture token;
- notice event confirmation for both UUID aliases and the approved prompt path;
- capture, stop-request, stop-event, upload, cleanup, and job-state timestamps;
- WAV format metadata and checksum, without audio bytes or transcription text;
- masked Recents screenshots for ready playback and either completed or failed
  AI state; and
- test operator, participant-consent record location, result, and defect link.

The evidence owner deletes the non-production recording according to the pilot
retention policy once the run is accepted.

## Safe automated verification before any pilot

Run these local checks against a disposable database or mocked transport before
requesting pilot activation:

```sh
pnpm vitest run \
  tests/phone11-recording-service.test.ts \
  tests/phone11-recording-channel-dump.test.ts \
  tests/phone11-recording-ledger.test.ts \
  tests/phone11-cloud-recording-ui.test.tsx \
  tests/phone11-cloud-recordings-postgres.test.ts \
  tests/phone11-verified-speaker-identity.test.ts
pnpm build:backend
```

The PostgreSQL suite skips when its isolated database is absent; a skip is not
a pass for the migration or tenant-isolation check.

Before named speakers can be enabled, add and pass source tests for valid and
malformed stereo RIFF splitting, extra RIFF chunks, silent-channel handling,
separate provider uploads, timestamp merge ties, provider-file cleanup,
capture-token provenance, atomic transcript/summary publication, and generic
fallback if either channel or role evidence is missing. Add a real-media test
fixture only from consented synthetic phrases; it must not contain customer
audio.

## Exit decision

The pilot is accepted only when all five commissioning sections pass on both
an inbound and outbound physical call. At that point audio recording, upload,
analysis, and playback may be considered a supervised pilot feature. Speaker
names remain unavailable until the separate stereo-transcription and verified
role-mapping implementation and its two-direction physical proof have passed.
