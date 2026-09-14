# Latest call summary investigation — 14 September 2026

Status: latest recording is saved; its AI transcript and summary have **not** been recovered. This candidate improves failure diagnosis and has not been deployed.

## Verified live evidence

Read-only queries against the existing Phone11 backend observed the latest call created at 12:40:02 Bangkok (05:40:02 UTC; call ID prefix `8b722fc2`). Its recording is `ready`, while summary and analysis job are `failed` after three attempts. Neither transcript nor summary exists. The persisted failure is only `analysis_failed`.

AI is enabled for the tenant and worker; a provider credential is configured. The worker model is `gemini-3.8-flash`. The previous recorded call at 11:35 Bangkok has a ready transcript and summary after one attempt. These facts establish an analysis-pipeline failure, rather than an iOS rendering-only problem or disabled AI policy.

The stored file is readable and has a valid RIFF/WAVE header: PCM16, 16 kHz, stereo, approximately 51 seconds, 3,264,098 bytes. Channel RMS levels are approximately -29.95 and -34.21 dBFS, with peaks of -6.26 and -7.81 dBFS. Both channels contain signal and neither peak clips. Aggregate levels do not prove spoken-word intelligibility.

The file was finalized at 05:40:59.684 UTC. The last failed attempt finished at approximately 05:43:16.499 UTC, inferred from the stored next-available timestamp minus the repository's fixed 30-second delay. This allows about 77 seconds of total execution across three attempts after two retry gaps, rather than three full 90-second request timeouts. There are no per-attempt timestamps in the job schema and no matching analysis error logs for this interval. Exact provider error, response, and failing phase were discarded by the old code and cannot be reconstructed from this evidence.

The speaker-diarization update changes the prompt, not the response schema. No evidence identifies that change as the cause. No customer transcript, provider response, secret, or audio content was printed or copied during this investigation. Audio was examined only for local format and aggregate signal measurements inside the existing backend.

## Candidate repair

The worker now preserves an allowlisted failure category and stage in the existing `failure_code` column. This distinguishes unreadable recording data, validation/persistence errors, rate limits, provider unavailability or rejection, expired request deadlines, and invalid structured results. Arbitrary exception strings cannot enter that ledger field. A successful authorized retry clears the prior failure code. Migration, retry count, lease rules, ownership checks, provider model, and capture behavior are unchanged.

Malformed generated JSON previously became a generic transport/provider failure; a regression test reproduces that diagnostic bug and verifies it is classified as `invalid_result:parse`. This is not evidence that malformed JSON caused the latest call's failure.

## Validation and remaining gate

- 26 provider/worker tests pass, including redaction, rate limits, malformed JSON, timeouts, local file failures, and revocation behavior.
- 27 isolated PostgreSQL/CDR tests pass, including persistence of a safe failure category and clearing it on a successful retry.
- Backend bundle builds. Repository-wide TypeScript checking still reports unrelated missing transfer types, marketing dependencies, and DOM/Node URL incompatibilities; changed files have no reported errors.
- No production deployment, recording mutation, paid provider retry, or test call was performed.

The remaining recovery step is a separately authorized, narrowly scoped retry for this exact recording using the corrected diagnostics, after confirming its current ownership, consent/policy, retention, and absence of an active lease. Reprocessing must preserve the original WAV and use the existing lease/publication path. A ready database result followed by authenticated iOS playback/transcript/summary inspection is needed before declaring this call recovered.
