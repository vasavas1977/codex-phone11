# Phone11 recording controls and Build 42

Date: 2026-09-14

## Source and checks

- Recording-stop fix: `00d976712521f892f4ba9cace7d3843fbacd41eb`
- Transcript speaker-name fix: `c5ed9a6`
- Professional recording announcement: `24e8d08`
- Required Phone11 daily-use workflow `34839095813`: all five jobs passed.
- Signed iOS workflow `34839122945`: native checks, daily-use checks and signing passed.

The stop fix persists the confirmed PBX stop before replying, suppresses stale
Stop controls while the file finalizes, and displays `Saving recording...`.
Retryable start failures display `Not recording`. Speaker labels prefer handset
contact and signed-in user names, with distinct Speaker 1/Speaker 2 fallbacks.

## Live backend

The generic deploy workflow stopped before replacement because its historical
environment file did not contain `PHONE11_TRUSTED_PROXY_CIDRS`. The existing
backend remained healthy. The successful bounded deployment reused the exact
current runtime configuration and mounts, disabled workers in an isolated
candidate probe, and required zero active calls, zero active captures and zero
processing jobs immediately before replacement.

- Previous image: `sha256:cb460188ddf4d601750b3a3e2f6809a71aa14097eb715b10a47223bcfc60e192`
- Current image: `sha256:66d1ae327ae83b70033c2ff3ceac63d78cfe2cfcad1b4906b4fbd58c3deca484`
- Local and public health both reported exact source `00d976712521f892f4ba9cace7d3843fbacd41eb`.
- Kamailio and FreeSWITCH containers were unchanged.
- The live announcement file remained SHA256 `cad76a406f7607fdac2ee9cb798d47d47c75ba2670b44652781d85b772a4422f`.
- A private rollback configuration and deployment result are retained at
  `/opt/phone11ai/recording-controls-00d9767-20260914` on the server.

## Installed iPhone build

- EAS build: `96b0782b-9c60-4ecf-98cb-3ef61fbe0e0d`
- App version/build: `1.0.0 (42)`
- Bundle: `space.manus.phone11ai.t20260425073427`
- IPA bytes: `16,853,867`
- IPA SHA256: `6b47ede293aef8e0982922b1a47bd8a06288de3012b5a112978d6bb3f715ff91`
- ZIP integrity and embedded provisioning profile verified.
- Installation succeeded and independent device inventory reports build 42.

The phone was locked when launch was attempted, so opening Build 42 and the
physical call acceptance remain pending. Acceptance must confirm the short male
announcement on both sides, Stop changing to saving/finalized, two-party cloud
playback, summary/transcript, participant labels, Hold/resume, and repeated
locked incoming calls.

## Post-call and AI recovery verification

Follow-up on 2026-09-14 confirmed manual Stop persisted, recording capture was
cleaned up, and the recording was linked to call history. The latest WAV passed
container validation: stereo PCM, 16 kHz, 16-bit, 20.16 seconds, 1,290,338 bytes,
with non-silent samples. This is server evidence; it does not prove who spoke on
each audio channel.

The two recent calls lacked summaries because the Gemini generation stage
returned temporary provider-unavailable and rate-limit failures. The original
30-second retry interval exhausted the three-attempt budget. Source `13c6b61`
added allowlisted stage-specific diagnostics and transient retries after about
60 seconds and 300 seconds, preserving the three-attempt limit. Daily CI
`34850910795` passed.

The same authorized Gemini key was verified against `gemini-3.5-flash`, then the
live model was changed to that stable model. Only the two affected failed test
jobs were requeued. Both completed with nonempty Thai summaries and transcripts.
At 2026-09-14 14:15 UTC the latest two recordings and their jobs were `ready`:

- Latest: 144 transcript characters, two nonempty turns, two distinct speaker
  labels, zero unlabeled turns.
- Previous: 27 transcript characters, one nonempty turn, one speaker label,
  zero unlabeled turns.

A prior verification query overescaped its regular expression and incorrectly
counted labeled lines as unlabeled. A corrected exact-label query confirmed the
results above; no additional reprocessing or deletion was performed.

## Current backend deployment

The combined source `c2309c9e43c3f9295e1199d8b9ba6380f91b672c` contains strict
transcript validation (`a6c4cc2`) and the AI resilience fix. CI runs `34853470566`
and `34853468908` passed. The isolated backend probe passed before deployment.

- Image: `sha256:ca1e2eb12a557a6e762644caf7812396b07578e9dbaf1b7772b18cce4ecd93fe`
- Model: `gemini-3.5-flash`
- Deployment completed: 2026-09-14 14:14:58 UTC.
- Zero active calls, active captures, and processing jobs were required before
  the backend replacement.
- Local and public health reported the exact source; general ESL authenticated
  and subscribed; Kamailio and FreeSWITCH containers were unchanged by this
  backend deployment.
- Protected candidate, rollback, and result files are retained at
  `/opt/phone11ai/recents-speaker-c2309c9-20260914` on the server.

Earlier in this repair, the backend event-socket host was aligned with the
host-networked FreeSWITCH gateway, and the mismatched event-socket credential
was aligned privately. The FreeSWITCH healthcheck now reads its configured
credential instead of assuming a default. Its script is bind-mounted from
`/opt/phone11ai/deploy/voip/freeswitch-healthcheck.sh`. The canonical FreeSWITCH
container was independently verified healthy with both SIP profiles running.

Strict publication now rejects transcripts unless every nonempty turn begins
exactly `Speaker 1:` or `Speaker 2:`. These labels distinguish voices, not proven
participant identities. Source `f8638c1` therefore removes direction-based name
substitution from the app; actual named-speaker attribution still requires
verified channel mapping. The replacement handset build and handset visibility
check are tracked separately from the successful server recovery.

## Recents stale-result repair

Source `7c98708d296aa0dee1c6ff881e72cb50210f8e8b` adds a fixed 15-minute
foreground polling budget, 10-second checks while pending, and 60-second checks
for a cached AI failure. Initial and in-flight requests are allowed to complete;
local timer checks do not issue overlapping network requests. A visible
`Refresh AI status` action remains available for pending or failed results after
the automatic budget ends. Recents keeps its loading indicator visible until
both local history and cloud metadata finish refreshing. Same-user session
refreshes reload safely; logout and account changes invalidate old results.

The primary reviewer independently ran 47 focused UI, transcript, auth-isolation,
and polling tests successfully. This source also includes the generic-speaker
fail-safe `f8638c1`. A replacement signed iPhone build was requested after review.
The older signed Build 43 / source `c2309c9` was verified but deliberately not
installed because it predates these app corrections.

## Installed replacement Build 44

- Reviewed app source: `7c98708d296aa0dee1c6ff881e72cb50210f8e8b`.
- Signed workflow `34855633508`: native, all five daily-use jobs, and build passed.
- EAS build: `4909e3cb-9444-427b-becd-b7365417e2d9`, finished.
- Version: `1.0.0 (44)`; bundle `space.manus.phone11ai.t20260425073427`.
- IPA SHA256: `25c69278ecb14d2b541f2a00db7e1bf21426b0188277931627a3201fa62e34c9`.
- Strict/deep signature verification, embedded app metadata, production push
  entitlement, valid Ad Hoc profile, and target-device inclusion passed.
- Fresh idle check at 2026-09-14 14:37:53 UTC found zero calls, active captures,
  and processing jobs, with the backend healthy.
- Installation began at 14:38:15 UTC and succeeded. Independent installed-app
  inventory confirmed Build 44. Launch succeeded at 14:38:42 UTC and process
  inventory confirmed Phone11 running.

Both summaries are server-ready; the user-facing Recents visibility check has
been requested and remains unconfirmed. No new physical call or voice-to-person
attribution is claimed by this build installation. The UI changes use shared
React Native code; a new Android package and Android handset acceptance were
not performed in this repair.
