# Phone11 production continuation — 5 October 2026

Full Zoom-style production is not complete. This follow-up records a reviewed
source batch and current release boundaries; it does not mark the feature
coverage checklist accepted.

## Integrated source batch

Source `acc93c2fa6ea15c4dc48e424c0624fbbf1f8a07a` is on draft PR 7.
Three independent GPT-6.1 Sol High workers contributed implementation and review;
the lead integrated changes and repeated focused checks.

- Mobile/web receivers render a participant's camera and shared screen together.
  Screen content fits in its full frame and retains attachment cleanup. This is
  receiving support, not a new native or desktop screen publisher.
- API candidate start requires the protected, fresh, exact-runtime voicemail
  prerequisite before candidate creation and before receipt emission. Encoded
  XML cannot bypass DTD/entity/processing-instruction rejection. See the
  [prerequisite contract](VOICEMAIL-RELEASE-PREREQUISITE-20261005.md). Caller
  attestations do not establish operator authority or actual module readiness.
- A separate Android foreground trial wires the hardened bridge and complete
  checksum-pinned Siprix AAR. Paired flags, separate identity, native gates and
  lifecycle/permission checks are mandatory. Ordinary prebuild reverses the
  trial wiring. Background wake, transfer and native SIP video remain unsupported.
  See [Android integration](ANDROID-FOREGROUND-INTEGRATION-20261005.md).
- Mobile CI now assembles ordinary and isolated trial APKs. The verifier checks
  application identity, debug/runtime metadata, audio permissions, native SDK
  libraries and actual DEX class definitions. Synthetic verifier tests do not
  prove an APK was built. Debug packaging does not establish standalone launch,
  calling, licensing or handset acceptance.

Lead checks at this source passed: 201 calling/CallKit/selection tests, eleven
receiver tests, ten Android Node tests containing 106 Java assertions, 56 offline
voicemail/operator Python tests, seven APK parser tests, repository TypeScript
and backend bundling. These focused tests had no skips. Independent reviewers
also compiled the actual Android module against pinned Siprix, Android 35 and
React Native 0.81.5 headers with both native gate values. Whole-repository cloud
checks have their own pass/skip boundaries.

Exact-head cloud runs: Mobile Native 37225385476, daily-use 37225385489,
desktop helper 37225385475, owned auth 37225385466 and release guards 37225385468.
They were started at the source above; completion must be read from their actual
results. Earlier nineteen-job green CI belongs to `13ff36b`, not this new source.

## Live and package boundary

Fresh public reads observed API build `team-chat-media-d41fc504` and static portal
source `63203c8910ff09ba59eeb6dfcba1f58c769bface`. Neither matches this candidate.
A public health response is not authenticated tenant, database, provider or
physical-device proof. No route switch or production mutation was performed.

Retained Build 120 and desktop trial artifacts keep their original provenance.
The changed mobile receiver/shared-engine inputs require fresh client packaging
and validation; do not retag old artifacts to the new commit. Phone testing is
still owner-deferred. No new client installation, OTA/store publication,
production SDK credential, formal signing or provider activation is claimed.

## Work that remains

1. Finish authoritative meeting controls with Connect11. The reviewed opaque
   one-use host-grant design separates Phone11 authorization from Connect11
   enforcement. Exact wire/digest fixtures, control-revision conflict handling,
   verified room binding/enrollment, admitted-only issuance, authenticated trust
   and external restore-incarnation recovery remain unresolved. No host-control
   endpoint is invented or enabled by this batch.
2. Finish participant screen publishing. Browser-only video capture is a
   separate source slice with explicit user choice and actual publication-grant
   checks. Native capture and the desktop source-picker permission boundary
   require separate implementation/acceptance. Admin screen policy, captions,
   recording/AI and waiting-room controls remain unimplemented or gated.
3. Close PBX writer/principal, protected-clone and active/rollback evidence;
   stage both exact Lua helpers with ingestion off, rehearse legacy deposit and
   rollback, and prove an owned real voicemail deposit/playback before activation.
   Offline planners and caller-evidence packets cannot replace these actions.
4. Obtain frozen, authenticated scheduling and bot/artifact consumer contracts
   from Super Number. Its recorder-interface source merges do not establish a
   deployed shared scheduling or recording service. Phone11 must reuse those
   services rather than create duplicate event or transcript stores.
5. Confirm SDK production coverage and formal mobile/macOS/Windows distribution,
   then accept exact-build calls, two-phone meeting speech/video, background
   ringing, notifications, reconnect and cleanup. Trial packages and old call
   observations do not complete this gate.

New work must keep source, CI, package, deployment, provider and device evidence
separate. Draft status remains appropriate until actual release gates pass.
