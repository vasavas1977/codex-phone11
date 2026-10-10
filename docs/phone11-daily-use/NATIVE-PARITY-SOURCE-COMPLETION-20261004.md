# Native parity and PBX rehearsal source follow-up — 4 October 2026

This follow-up closes a bounded source batch. It does not establish complete
Zoom Phone/Meetings parity, deployment, provider activation or device acceptance.
It builds on `595a66c3c12d74e08371a9ac1ea5ff7d4ecbce57`. Prior Build 120 and
desktop trial packages retain their original `da04d97` runtime source pin.
Integrated implementation is `be21027299fcaa23af9ad7bc6b8887f529418ba6`;
the following CI/documentation commit does not change its runtime inputs.

## Changes

- Desktop consultation and attended transfer have a separate, default-off
  `PHONE11_DESKTOP_WARM_TRANSFER_SOURCE_ENABLED` compiler gate. The native helper
  owns the original call and one consultation, reserves commands before SDK
  callbacks, and requires accepted preparation, callback-confirmed hold/focus
  and explicit continuation commands. Transfer has one SDK attempt and no
  automatic End. Cancel restores local hold and audio focus separately; the
  remaining consultation has an explicit End after the original call ends.
  SDK-created redirected legs are never adopted: fresh unowned legs receive
  bounded mute/End cleanup, ambiguous identities are not targeted, and every
  unsupported redirect retires the privileged helper pipe.
- Android has a default-off foreground ordinary-calling source candidate with
  one bridge lease, account and active call; generation fences, ID retirement,
  duplicate-command guards and quarantined failed shutdown. It binds the
  independently pinned official Android SDK. Autolinking remains `android: null`,
  registration capability remains false, and background wake, video and transfer
  remain unsupported. See the [Android source contract](../../modules/phone11-siprix/android/README.md).
- `scripts/phone11-pbx-rehearsal-readiness.ts` validates offline protected-clone
  planning metadata, exact source/target/writer/rollback pins, required cases,
  freshness and supplied review bindings. It never connects to a database or
  executes migrations. A valid manifest is only eligible for operator review;
  evidence provenance and durable consumption still need an accountable operator.
  Imported assertions cannot grant execution or activation authority.

## Validation boundaries

Independent reviews found and corrected synchronous desktop callback/refusal
races, a local-plus-remote-hold restoration collision, noncanonical PBX system
identifiers and blocking FIFO manifest reads. Android corrections preserve End
after an accepted answer and keep a pending local hold distinct from remote
hold. Redirect regressions cover cleanup refusal, late callbacks and reused or
overlapping identities. These cases preserve the review counterexamples.

Hosted checks compile the ordinary and gated desktop source against the pinned
real macOS/Windows SDKs. Android's compiler project is manually included in the
locked generated host for actual React Native/API compilation; it does not
autolink into the ordinary app or package a native SIP runtime. Local React
declaration stubs are a separate limited check, never full RN or Android proof.
Final source, compiler and hosted results are recorded separately in PR 7 and
private receipts. A compiler success does not prove SIP/RTP or acoustic behavior.

Independent desktop review approved the frozen `ee01be93` candidate; its
cherry-picked runtime inputs are unchanged in the integrated implementation.
Root reran all six native protocol suites, 96 desktop boundary cases and 164
desktop app cases with one existing Chromium fixture skip, plus desktop build
and full TypeScript checking. The PBX validator passed 37 cases; the separate
calling/transfer/voicemail regression run passed 245. Prior cold-start test
timeouts and corrected review/invocation failures remain retained separately;
successful reruns do not rewrite that history.

Android UCC is also being developed on the separate
`codex/phone11-android-virtual-lab-20260914` branch (observed `41f842b8` on
4 October). Its staging APK and reported checks belong to that branch. This
isolated, inactive Siprix compiler project neither replaces that app nor proves
its native runtime acceptance. Preserve separate parity and release receipts.

The owner deferred physical phone testing. No phone installation, launch,
meeting invitation, call or new provider action belongs to this batch. New
desktop native source requires fresh helper/package provenance before use;
earlier packages cannot be relabeled as this source.

## Remaining external work

1. Accept matching-build two-phone meetings, ordinary calls, transfer recovery,
   audio routes, background recovery, alerts and teardown on actual devices.
2. Admit PBX commissioning using the actual-target writer/credential-holder
   inventory, approved active/rollback artifacts and a protected clone retaining
   access/trigger ownership; then prove real routing and voicemail deposits.
3. Connect11 still has no authoritative end-for-all, remote mute, waiting-room
   admission or unban API. Its `phone11-plain-video.v1` eviction is asynchronous:
   `202` means queued denial; completed provider acknowledgement is not roster
   or handset proof. Phone11 must keep unsupported host controls gated.
4. Reuse Super Number's canonical scheduling/recording services when a released,
   authenticated Phone11 consumer contract is pinned. Do not add a duplicate
   calendar, bot, recording or transcript store here.
5. Complete Android runtime/background integration and device acceptance, SDK
   production licensing, Windows signing and macOS notarization/distribution.

No merge, backend deployment, OTA/store release, provider activation, production
migration or paid-license acceptance follows from these source checks.
