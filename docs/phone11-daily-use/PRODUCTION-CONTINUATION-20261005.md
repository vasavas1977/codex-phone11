# Phone11 production continuation — 5 October 2026

Full Zoom-style production is not complete. This follow-up records a reviewed
source batch and current release boundaries; it does not mark the feature
coverage checklist accepted.

## Latest reviewed source additions

The combined branch now contains these independently reviewed source candidates.
Their implementation pins are recorded here; the current combined head and its
cloud results are recorded separately in PR 7 and private verification receipts.

- PBX administrator reads require a fresh membership check. Twelve admin read
  paths no longer admit a removed or demoted administrator from a stale cache
  refill. Legacy workspace selection and query filters are preserved. Candidate
  `8555851fc5a2fb2cd37585789f02fe06b44a6bce` passed independent review; the lead
  repeated 23 focused revocation cases and 109 adjacent authorization cases.
  One existing optional database case was skipped. The focused 23-case CI gate
  requires zero skips. These mocks do not establish production database role
  changes or a lock held throughout every subsequent read. See
  [administrator read authority](PBX-ADMIN-READ-REVOCATION-20261005.md).
- Desktop meetings now have an explicit video-only Share/Stop control and a
  cancellable window/screen chooser. Capture requires the exact main frame,
  interactive admission, current session/room, user gesture, SDK publication
  rights and no SIP owner. Opaque choices are single-use and revalidated before
  granting capture. Late tracks, publication and failed cleanup remain owned;
  reconnect never restarts sharing automatically. Candidate
  `26a529aa85c457794811cd192fe2239d416c178e` passed independent review and 34
  new cases without skips. The lead repeated the complete desktop suite: 198
  passed and one explicitly opt-in Chromium application test was skipped.
  Desktop TypeScript and JavaScript bundling passed. No Electron application,
  OS picker, real capture or packaged-client acceptance was performed. A separate
  source-only packaging audit passed nine existing tests and rejected 27 dirty,
  untracked or ignored source cases; the bundle graph includes the new modules.
  Fresh client artifacts remain required. See
  [desktop screen publishing](DESKTOP-SCREEN-PUBLISHING-20261005.md).
- Desktop fake-SDK transfer tests wait for actual protocol frames instead of
  fixed sleeps. End-race callbacks are released only after termination, with
  a receipt proving they ran; strict reply/event and privacy assertions remain.
  Candidate `99ee070b8db6e6e0f2152b11c52808695a73292f` changes test code only.
  The lead reviewed the exact diff and repeated all eleven scenarios plus the
  adjacent accept/end, controls, hold, consultation and redirect checks.
- The strict Android APK verifier now uses the actual pinned SDK class
  `com.siprix.SiprixCore`. It still requires DEX definitions, not reference-only
  strings. Candidate `2869041cb4d26069f52ef6d85d520ec61ee83461` passed independent
  review and sixteen parser/pinned-AAR cases without skips.
- Android now has a separate, default-off consultation/attended-transfer source
  candidate. It preserves one process/media owner, exact original/consultation
  identities, callback-confirmed hold and focus, one uncertain REFER attempt,
  cancellation recovery and quarantined cleanup. Generic blind transfer remains
  unsupported. Independent review caught and corrected the leading `+` target
  mismatch before integration. Corrected candidate
  `0c971b6ae352466c8b8df381f86425a430b363ca` passed independent review; the lead
  repeated 372 native state assertions, 344 shared calling regressions and
  actual pinned Siprix/Android 35/React Native 0.81.5 compilation in OFF/OFF,
  ON/OFF and ON/ON gate combinations. These checks had no skips. No runtime,
  physical attended transfer or microphone/audio acceptance follows from them.
  Existing ordinary and isolated trial builds keep consultation off. See the
  [Android consultation boundary](../phone11-android-consultation-source-boundary.md).
- A public LiveKit room move retires the original admitted mobile/shared
  session immediately and refuses new microphone/camera operations. Tracked
  teardown must finish before media ownership can pass to SIP; failed cleanup
  stays addressable for an explicit Leave retry. No automatic fresh admission
  is inferred from a provider room move. Candidate
  `d6b7452804b50bc1bbf6b559601b84b8a090e502` passed independent source review,
  117 focused lifecycle regressions and four independent temporary capture-race
  probes, plus existing media-ownership cases. Real provider moves and native
  audio acknowledgment still require endpoint acceptance.
- Android Answer shares the incoming observer's exact media preparation and
  waits for tracked meeting teardown and audio-stop acknowledgment before the
  native SDK command. Session, account, call lifetime and active SIP lease are
  rechecked after asynchronous work. Failed cleanup refuses Answer and preserves
  explicit retry; duplicate actions and stale callbacks cannot bypass the barrier.
  iOS and ordinary paths retain their behavior. Candidate
  `74b37f3db492a29a533429a416f5bbac90578d77` passed independent review and 395
  actual-provider, meeting lifecycle, ownership, permission and calling mocks
  without skips. The lead repeated those checks plus five lease-state cases.
  The CI addition requires all sixteen new provider cases, with nonempty results
  and zero skips; its independently exercised five-suite gate passed 125 cases.
  Repository TypeScript and backend bundling are checked separately. See the
  [Android Answer media boundary](../phone11-android-answer-media-boundary.md).
- General mobile Meet entry no longer offers opaque UUID choices for multiple
  unlabelled rooms. It directs the current signed-in user to named Team Chat
  invitations; selected channel/direct invitations still use their exact room,
  tenant and title. An active Phone call gives fixed, actionable recovery copy
  and refuses admission/media work; explicit retry requests fresh admission.
  Candidate `eb85aef3228c5d2a40c509cb1f32f74116998b8f` passed independent review
  and 105 focused mocked entry/prejoin/owner/picker cases without skips. See
  [mobile meeting entry](MOBILE-MEETING-ENTRY-20261005.md).

The new Android consultation helper is also included in the exact trial DEX
definition inventory and ordinary-build exclusion. Integration gate
`1d0645187114d1855c3bac61bc3fd53542fe2d77` passed independent review, sixteen
pinned-AAR parser cases and four temporary helper-specific negative checks.
The older successful hosted six-class receipt below does not prove this new
seven-class inventory; a fresh hosted APK result remains required.

Cloud Mobile Native run **37252776802** passed at combined source
`7697489b6975e02ca287161504d32b5e9b93eaf4`: ordinary APK exclusion, real
SDK-linked trial assembly and strict trial verification all passed. The hosted
verifier reported trial APK SHA-256
`19eee3f2aa864428f006a5515e513b28282dbddc2aebda85012140f522b90c2e`
and exactly four SDK library entries across the two ARM ABIs. The APK was not
uploaded, downloaded, locally inspected or installed. Daily-use, release guards
and owned-auth runs passed at that source; desktop helper protocol CI failed the
fixed-delay test described above. Its corrected source requires a fresh cloud
run. Neither that older CI head nor its packaging receipt covers the later
desktop publisher or administrator-read changes.

Native screen publishing still needs a cancellable Android consent transaction
with acknowledged startup/stop, or an iOS ReplayKit extension/App Group protocol.
The pinned RN bridge does not supply these ownership primitives. See the exact
[native capture boundary](NATIVE-SCREEN-PUBLISHING-BOUNDARY-20261005.md).

## Earlier integrated source batch

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
- Browser meetings now have a reviewed video-only Share/Stop control. Capture
  starts directly from the user's click, requires explicit interactive admission
  and current SDK publication rights, and stops on permission loss, owner change,
  reconnect or Leave. Late picker/publication results and cleanup failures retain
  ownership until safely retired. The lead repeated 131 focused lifecycle,
  receiver and UI checks after integration, with zero skips. These are mocked
  source checks, not real browser/peer acceptance. See
  [browser screen publishing](WEB-SCREEN-PUBLISHING-CANDIDATE-20261005.md).
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
Daily-use (all ten jobs), desktop helper, owned auth and release guards passed
at this source. Mobile Native passed ordinary Android assembly, iOS bridge,
prebuild and config checks, but failed the isolated trial APK verification with
`trial_native_sdk_packaging_missing` after successful trial assembly. This
failure must be diagnosed and the corrected exact source checked again; neither
successful compilation nor synthetic parser checks closes actual packaging.
Earlier nineteen-job green CI belongs to `13ff36b`, not this new source.

Subsequent source review also closed an explicit Android selection of the iOS
store-profile configuration: it now refuses that platform mismatch before
packaging. The iOS path and ordinary/trial Android profiles retain their
existing behavior. This source guard does not establish production licensing or
store distribution. See [store boundary](STORE-DISTRIBUTION-BOUNDARY-20261005.md)
and the separate [dependency advisory](DEPENDENCY-ADVISORY-20261005.md).

## Earlier reviewed follow-up candidate

Combined implementation and CI-gate source:
`bc560157768263fbdd88b02d8cfc4ecc4f33e228`.

- The trial now writes an explicit, reversible two-ARM ABI filter. The pinned
  full SDK contains four ABIs, and React Native's legacy-architecture path skips
  the architecture property's automatic filter. The original failed APK's
  inventory was not observed; the explanation is source-derived and requires
  a new hosted APK result. The verifier remains strict and now reports missing,
  unexpected and empty native-library entries safely.
- Android trial Dial/Answer checks and requests microphone permission from the
  user action, then rechecks account and call ownership. Duplicate actions join
  the same command even when native callbacks precede command completion.
  Observed replacement, termination, logout and disposal invalidate the pending
  action. Denial preserves the existing incoming ringing session. iOS and
  initial CallKeep behavior are unchanged. See
  [permission recovery](ANDROID-CALL-PERMISSION-20261005.md).
- Browser Share/Stop uses the existing control icons. Automatic cleanup errors
  now outrank stale feedback and give explicit Stop retry guidance. Android
  meeting permission errors refer to Android Settings.
- Daily-use CI requires four exact interactive-media suites, nonempty assertions
  and zero skips. The lead executed all 109 cases, then 230 existing calling,
  CallKit, entry and media-ownership regressions. Ten Android integration/SDK
  Node cases, ten synthetic APK parser cases, full TypeScript, backend bundling,
  workflow parsing and diff checks passed. Independent reviews found and resolved
  the callback-first and hidden-cleanup-message bugs; corrected source was
  approved with explicit mock/compiler/artifact limits.

Hosted CI for this follow-up is separate from the earlier failed run. No new
APK, signed client, real capture, SIP call, provider or physical-device result is
established by the local checks. The earlier package/runtime pins remain intact.

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
   endpoint is invented or enabled by this batch. Connect11's reversible
   preparation packet now has cross-runtime synthetic digest vectors, proposed
   raw-body rejection cases, lifetime enrollment and end-only revision rules.
   It remains outside git and unpublished; strict decoder, host authority and
   endpoint implementation are not established by byte/hash checks.
2. Accept the reviewed browser and desktop screen publishers with actual source
   selection, remote viewing and cancellation/reconnect tests. Native capture
   requires the separate primitives and platform gates described above. Admin
   screen policy, captions,
   recording/AI and waiting-room controls remain unimplemented or gated.
3. Close PBX writer/principal, protected-clone and active/rollback evidence;
   stage both exact Lua helpers with ingestion off, rehearse legacy deposit and
   rollback, and prove an owned real voicemail deposit/playback before activation.
   Offline planners and caller-evidence packets cannot replace these actions.
4. Obtain frozen, authenticated scheduling and bot/artifact consumer contracts
   from Super Number. Its recorder-interface source merges do not establish a
   deployed shared scheduling or recording service. Phone11 must reuse those
   services rather than create duplicate event or transcript stores. The fresh
   coordination handoff pins shared Alpha `f6b7da544cb5975e43fb433c98965782aefe56a2`
   with green postmerge checks, but confirms that no released authenticated
   Phone11 scheduling or bot-recording consumer API is verified. Canonical
   privileged SQL and note11 capture Edge Functions are not handset consumer
   endpoints; capture completion does not confer playback/publication authority.
5. Confirm SDK production coverage and formal mobile/macOS/Windows distribution,
   then accept exact-build calls, two-phone meeting speech/video, background
   ringing, notifications, reconnect and cleanup. Trial packages and old call
   observations do not complete this gate.

New work must keep source, CI, package, deployment, provider and device evidence
separate. Draft status remains appropriate until actual release gates pass.
