# Phone11 daily-pilot Build 115 — 4 October 2026

**Signed package verified; installation and physical acceptance deferred by the
owner.** This candidate does not activate voicemail storage or deploy backend
changes, and it is not a full Zoom feature-parity release.

- Source: `1dfda34846d5b002866a6554a2ba74a9012430f7`.
- [Signed workflow 37142011158](https://github.com/vasavas1977/codex-phone11/actions/runs/37142011158): success, including eight prerequisite checks.
- [Expo Build 115](https://expo.dev/accounts/vasavas/projects/phone11ai/builds/ba4c8e6c-6509-42ac-9104-c3150f8fec01): `FINISHED`, physical iOS/internal distribution, profile `preview-ios-siprix-daily-pilot`.
- Bundle: `space.manus.phone11ai.t20260425073427`; application version `1.0.0`, native build `115`.
- Retained IPA: 26,316,710 bytes; SHA-256 `9e758097ea2629377bf995adcbf9e98fad2e2952115a8c9acdc8879967c81594`.

The official workflow's private EAS metadata binds the finished build to this
exact source. The primary installation handoff is the Expo build-details page
above, not a raw IPA URL. Private package and metadata custody use directory
mode `0700` and file mode `0600`.

## Verified checks

All five hosted checks passed on the candidate source: owned authentication,
release guards, daily-use checks, desktop helper build and mobile native checks,
including Android compilation. Local source results and the original isolated
timeout reruns are recorded in [integration state](INTEGRATION-STATUS-20261001.md#4-october-consumer-corrections).

The retained IPA passed the native signature/framework/bridge verifier and all
22 signed-package checks against the pinned Build 49 baseline. These checks
include the daily-pilot runtime, disabled OTA/debugging, production APNs,
calling background modes, shared permissions, bundle/signing identity and
valid provisioning. No check was weakened to obtain this result.

An independent private comparison with recovered Build 114 passed exact EAS,
source/version/build/hash/signature/profile binding and device-set coverage:
Build 115 covers all three registered devices retained in Build 114, including
the added iPhone 13. Device identifiers and signing identities are omitted.
Builds 113 and 114 remain retained as rollback packages.

## Changes and limits

The candidate includes corrected About capability/build labels, cancelled
meeting-join fencing, serialized browser joins, workspace status expiry and
loading/retry feedback, and account-scoped voicemail mutation feedback. It does
not claim a fix for unobserved physical audio behavior.

Later desktop-only playback guidance and voicemail storage durability source
changes are outside this iOS source pin. Their own review/CI/backend/package
receipts remain separate. Voicemail ingestion and desktop voicemail stay gated.

Build 114 remains the recorded installed version. The owner asked to continue
source and release work and test phones later; no installation or physical
audio/video, background ringing, push delivery or voicemail playback check was
performed for Build 115. Next device acceptance must record the exact installed
build, both authenticated extensions, room identity and each direction's media,
reconnect, SIP interruption and Leave behavior.
