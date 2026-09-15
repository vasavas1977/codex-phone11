# Latest call summary investigation — 14 September 2026

Status: diagnostics are deployed and the owner-authorized single retry is complete. The recording is intact, but transcript and summary remain unavailable: Gemini returned a server error during generation (`provider_unavailable:generate`). No further retry is queued.

## Verified live evidence

Read-only queries against the existing Phone11 backend observed the latest call created at 12:40:02 Bangkok (05:40:02 UTC; call ID prefix `8b722fc2`). Its recording is `ready`, while summary and analysis job are `failed` after three attempts. Neither transcript nor summary exists. The persisted failure is only `analysis_failed`.

AI is enabled for the tenant and worker; a provider credential is configured. The worker model is `gemini-3.8-flash`. The previous recorded call at 11:35 Bangkok has a ready transcript and summary after one attempt. These facts establish an analysis-pipeline failure, rather than an iOS rendering-only problem or disabled AI policy.

The stored file is readable and has a valid RIFF/WAVE header: PCM16, 16 kHz, stereo, approximately 51 seconds, 3,264,098 bytes. Channel RMS levels are approximately -29.95 and -34.21 dBFS, with peaks of -6.26 and -7.81 dBFS. Both channels contain signal and neither peak clips. Aggregate levels do not prove spoken-word intelligibility.

The file was finalized at 05:40:59.684 UTC. The last failed attempt finished at approximately 05:43:16.499 UTC, inferred from the stored next-available timestamp minus the repository's fixed 30-second delay. This allows about 77 seconds of total execution across three attempts after two retry gaps, rather than three full 90-second request timeouts. There are no per-attempt timestamps in the job schema and no matching analysis error logs for this interval. Exact provider error, response, and failing phase were discarded by the old code and cannot be reconstructed from this evidence.

The speaker-diarization update changes the prompt, not the response schema. No evidence identifies that change as the cause. No customer transcript, provider response, secret, or audio content was printed or copied during this investigation. Audio was examined only for local format and aggregate signal measurements inside the existing backend.

## Diagnostic repair

The worker now preserves an allowlisted failure category and stage in the existing `failure_code` column. This distinguishes unreadable recording data, validation/persistence errors, rate limits, provider unavailability or rejection, expired request deadlines, and invalid structured results. Arbitrary exception strings cannot enter that ledger field. A successful authorized retry clears the prior failure code. Migration, retry count, lease rules, ownership checks, provider model, and capture behavior are unchanged.

Malformed generated JSON previously became a generic transport/provider failure; a regression test reproduces that diagnostic bug and verifies it is classified as `invalid_result:parse`. This is not evidence that malformed JSON caused the latest call's failure.

## Validation and remaining gate

- 26 provider/worker tests pass, including redaction, rate limits, malformed JSON, timeouts, local file failures, and revocation behavior.
- 27 isolated PostgreSQL/CDR tests pass, including persistence of a safe failure category and clearing it on a successful retry.
- Backend bundle builds. Repository-wide TypeScript checking still reports unrelated missing transfer types, marketing dependencies, and DOM/Node URL incompatibilities; changed files have no reported errors.
- The initial investigation performed no production deployment, recording mutation, paid provider retry, or test call. The later owner-authorized deployment and single retry are recorded below.

## Authorized deployment and one retry — 14 September, 16:45 Bangkok

The owner subsequently approved the diagnostic backend deployment and exactly one additional Gemini analysis attempt for call prefix `8b722fc2`. That authorization was fulfilled; it does not authorize another attempt.

- Production target was verified live as EC2 `i-0851dd1ea1cfeef71` in `ap-southeast-7a`, serving `api.phone11.ai`. Before deployment, public health reported `71f4b683d572585c8d07c561649a543acfe87d40`.
- Deployed source identity: `8ec2923d7003be8bfe78eac2fd9d5a457c065fb3`. The compiled backend's input difference from the old source is limited to `server/cloud-recordings/{failure,gemini,repository,worker}.ts`. Existing runtime dependencies were retained by deriving from the exact prior image; no migrations, model changes, credential changes or feature-flag changes were applied.
- Immutable deployed image: `sha256:cb460188ddf4d601750b3a3e2f6809a71aa14097eb715b10a47223bcfc60e192`. Deployed bundle SHA-256: `8576495bb2ac7be974da32ce142ec98c86d25aef75046dab1a383f95d57dbbc0`.
- The first deployment verification compared mount lists in Docker's incidental order and rolled back before any retry. Comparing the same mount objects by destination resolved that false difference. Final verification confirmed unchanged mounts/options, runtime environment (except build marker), host/network configuration and Kamailio/FreeSWITCH container identities. Public health and authentication readiness passed; the backend is running and healthy.
- Fresh preflight confirmed the exact call's active owner assignment, trusted capture route, automatic recording policy with AI enabled, completed capture cleanup, retention through 13 December, no purge or analysis lease, and absent transcript/summary. No recording capture or analysis was in progress during the deployment gate.
- The original failed job and its three attempts were preserved in a protected operational audit. A fenced transaction requeued only this job with its remaining budget set to one (`attempts=2` before the existing worker claims it, then `3`). The normal `claimJob` / `validateJob` / `finishJob` path performed the analysis and publication check. A separate exclusive operational marker prevents the retry launcher from being run twice.
- Queue authorization timestamp: `2026-09-14T09:45:35.664Z` (16:45:35 Bangkok). The job was observed processing once, then terminal `failed` with **`provider_unavailable:generate`**. This category means an HTTP status of 500 or greater from Gemini's `generateContent` request. Upload and provider file processing had completed. The exact HTTP status and response body were not retained; this result does not establish the cause of the original three failures.
- Final observation at `2026-09-14T09:46:41Z`: recording `ready`, summary/job `failed`, no lease, transcript absent, summary absent. There are three historical attempts plus this one authorized attempt; the current bounded worker counter is three. Its failed state is ineligible for automatic reprocessing.
- The original WAV remained 3,264,098 bytes with SHA-256 `87aac8edb39aedd2518a1359ecc394c851de3d23f87d49448cac517d1324312f` before and after. No audio or transcript content was printed or copied locally.

The root-only server evidence and rollback package is `/opt/phone11ai/summary-diagnostics-8ec2923-20260914/`. It contains immutable image identities, the prior container inspection, candidate/rollback compose files, original job/authorization audit and final safe probe. Rollback image: `sha256:d37c93800dffab8e3daff1063542bf9e13a11d3a9d1cea72fc97544dd2860d9f`. The diagnostics remain deployed; no second provider attempt was made. Recovery remains incomplete and any further paid retry requires new owner authorization.
