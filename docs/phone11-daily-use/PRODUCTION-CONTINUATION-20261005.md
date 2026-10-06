# Phone11 production continuation — 5 October 2026

Full Zoom-style production is not complete. This follow-up records a reviewed
source batch and current release boundaries; it does not mark the feature
coverage checklist accepted.

## 6 October source follow-up

Presence polling now retires at the observed sign-in boundary and rechecks its
owner before every 100-user request chunk. This prevents late capability errors,
responses and subsequent chunks from entering a replacement session. The final
source candidate `eeb9f307c12d0647306aed00edaf2029d306c818` passed independent
review, including probes that exposed and corrected an initial batching gap.
Seventeen checked-in lifetime cases pass without skips.

Administrator meeting-host changes now require the original current sign-in,
workspace, administrator read and exact conversation/member row. Synchronous
single-flight custody prevents opposing same-render writes and persists across
screen remounts until an already-dispatched request settles. Late results are
discarded; this does not cancel a server write. The 29 actual-component cases
pass without skips; independent review is recorded separately in PR 7. See
[administrator host actions](ADMIN-MEETING-HOST-ACTIONS-20261006.md).

The Android trial APK gate now verifies the full pinned source AAR and all
four packaged ARM library hashes. The reversible trial Gradle block preserves
only those SDK libraries from debug-symbol stripping. CLI manifest analysis,
ZIP/DEX inspection and hash receipts share one bounded APK snapshot; the
independent review found and corrected a path-replacement mismatch. Corrected
source candidate `8e630ba5824b9e7b9fda870a56a24fb4f3799cda` passed independent
review, 29 Python cases with the cached pinned AAR and nine runtime-plugin cases,
all without skips. Fresh hosted assembly must establish actual packaged byte
identity. See [packaged SDK integrity](ANDROID-PACKAGED-SDK-INTEGRITY-20261006.md).

The required setup report adds both suites to the existing executed/nonempty/
zero-skip gates. The lead ran all four setup suites: 237 cases, zero skips,
plus full repository TypeScript, scoped lint and backend bundling successfully.
The full required completion set passed 1,032 cases across 27 suites with no
skips; this is a local source run, separate from fresh hosted validation.
Hosted results at `178f5a2` below remain historical and do not prove these new
changes. Full production, deployment and device acceptance remain unfinished.

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

Three additional user-facing integration gaps were closed after the source audit:

- First-time hosts can reach meeting setup without already having an admitted
  room. Native capability alerts retain explicit setup and retry actions; web
  opens setup directly because React Native Web does not implement native alerts.
  Every retained action checks the exact current authenticated owner, chat owner
  and selected workspace object. Server hosting, roster and admission checks
  remain authoritative. Candidates `9582ed978112ef7a9b67218992e957e50bad2988`
  and `ee6892ae060bb72fd26dc7f9f4d65da2c85ab4a3` passed independent review;
  the final focused entry/creation set passed 191 mocked cases without skips.
- Android builds with the separate consultation source gates can expose their
  warm-only operation without requiring unsupported blind transfer. Ordinary
  builds remain disabled. The current provider capability and selected operation
  are checked separately; consultation defaults and recovery controls preserve
  session, account, call-lifetime and duplicate-attempt guards. Candidate
  `b76248dec702db53c29182501a6b0135b5805651` passed independent review and 405
  calling/provider/UI cases without skips, plus independent TypeScript and
  scoped lint. No native or configuration gate was enabled. See the
  [warm-only UI boundary](ANDROID-WARM-ONLY-UI-20261005.md).

- Administrator voicemail confirmation retires when its authenticated owner,
  workspace, current extension or mailbox assignment changes. Native retained
  buttons cannot submit stale actions. Web uses a visible confirmation dialog;
  Cancel and close release its reservation so another row remains usable.
  The corrected candidate `ed220dad2e1ba412b16c7ac287307c2f3cab34c4`
  passed independent review of the complete two-commit stack, 122 focused cases
  (including 73 confirmation cases) and four independent lifecycle diagnostics.
  The reviewer reproduced the earlier web lock on the prior candidate and
  verified the corrected behavior. No real mailbox setting was changed. See the
  [voicemail confirmation boundary](../phone11-admin-voicemail-confirmation-boundary.md).

At integrated implementation head
`445664052016e7d1f264fd861ca9ceff106be559`, the lead ran 907 tests across
25 distinct test files with no failures or skips, including the meeting entry,
calling/transfer, media-ownership, administrator authority and voicemail fixes.
Repository TypeScript, scoped ESLint (zero errors; existing warnings retained)
and backend bundling passed. These are local source checks; fresh hosted CI,
client artifacts, deployment and physical-device acceptance have separate
receipts and do not follow from these results.

The directory UI regression assertion was aligned with the already reviewed
fresh selected-workspace authority helper rather than the earlier cached helper.
Independent checks passed 34 cases; assertion probes rejected cached authority
and an omitted workspace argument. The production query was not changed by this
one-line test correction.

The new Android consultation helper is also included in the exact trial DEX
definition inventory and ordinary-build exclusion. Integration gate
`1d0645187114d1855c3bac61bc3fd53542fe2d77` passed independent review, sixteen
pinned-AAR parser cases and four temporary helper-specific negative checks.
The older successful hosted six-class receipt below does not prove this new
seven-class inventory. A fresh hosted APK result must be attributed to the
exact combined head separately in PR 7 and private verification receipts.

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

## Release safeguard follow-up

Desktop packagers now require source-bound native-helper receipts rather than
accepting only a self-consistent helper manifest. Corrected candidate
`9aebaa8a88f9af67b0dc2138ff266a2b1b78825a` binds the Windows copied helper and
runtime libraries, anchored manifest leaf, retained manifest digest and exact
current source after the final awaited packaging check. macOS checks its existing
native provenance and linked input receipt against the current source and retained
SDK inputs. Older helper receipts retain their original revision and cannot be
retagged to this source. Independent review reproduced and corrected stale HEAD,
late DLL, copied-parent and manifest replacement paths, then passed 33 focused
executions on the final candidate. The author and lead each passed all 88 receipt
and adjacent committed-source cases with no failures or skips. These checks are
offline fixtures, including the actual Windows success tail; they do not build or
run a packaged client. Receipt custody, compiler causality and concurrent-writer
atomicity remain separate limitations. See the
[desktop helper provenance boundary](DESKTOP-HELPER-SOURCE-PROVENANCE-20261005.md).

The unsigned offline voicemail bundle now packages the existing producer, relay,
fixed runner and both reviewed Lua helpers without installing or starting them.
Independent review found an unrecorded compiler-input path; corrected candidate
`0626809c41451d5f2c7ce4de9e25c917fcaccb79` compiles captured entry bytes only,
permits actual Node built-ins and refuses additional filesystem dependencies.
The source-revision field remains a caller-supplied label; the independently
retained manifest digest and release-operator custody are still required.
Independent review passed all 76 bundle cases, reproduced refusal of the original
extra-input case and checked a valid CLI bundle plus negative custody cases.
The lead integrated the corrected stack and passed 143 bundle, producer,
durability, helper and lifecycle cases across five files without skips. The
runtime plan is caller-attested: host/storage/secret/deposit/commissioning and
rollout acceptance remain false. See the
[offline bundle boundary](VOICEMAIL-OFFLINE-BUNDLE-20261005.md).

PBX preflight and the locked, before-DDL migration guard now agree on enforced
base prerequisites: normal persistent relations, exact integer keys, no default
or generated tenant assignment, validated immediate same-schema foreign-key
guards, origin-enabled RI triggers, and nondeferrable primary keys with usable
backing indexes. Independent review caught a deferrable-key false-readiness
case before integration. Corrected candidate
`a332322ebce9cc0571a29978a2d1843be513b5f7` passed independent review and all
117 local PostgreSQL/mock/readiness cases without skips. The lead repeated the
same 117 cases on the integrated branch using a fresh, task-owned PostgreSQL
17.11 cluster and stopped it afterward. Actual deferrable-key
cases now refuse at the initial prerequisite guard before any routing DDL.
The current SQL/preflight hashes invalidate earlier rehearsal plans; existing
historical receipts retain their original pins. No legacy schema is silently
repaired and no production migration is performed. See
[base prerequisite checks](PBX-BASE-PREREQUISITE-GUARD-20261005.md).

Daily-use CI requires the new voicemail bundle suite, both actual PostgreSQL
base-prerequisite suites, and the desktop helper receipt suite to execute with
nonempty, passing assertions and zero skips. The explicit Bash shell preserves
test-process failure through `tee`; runner and relay inputs trigger both event
watch lists. Independent review of workflow blob
`44a97b1bd7a69ab9e0bd388ed35b44bc062ee785` rejected 22 JSON and 19 TAP negative
fixtures and preserved a synthetic producer exit 17. The lead executed the
actual PBX report gate against the integrated 57 migration and 23 preflight
cases. These offline checks are separate from fresh hosted workflow results.

At integrated implementation head
`3a0a4c7e0296077c06ed90c35b401f51a06cd9ac`, the lead passed 348 executed cases
across ten focused test files: 143 voicemail, 117 PBX and 88 desktop provenance
and committed-source cases. All passed without skips. Full repository TypeScript,
scoped ESLint and backend bundling also passed. ESLint emitted only the existing
Node configuration-type warning. These current local checks do not retag earlier
hosted CI, signed mobile builds or desktop packages. Fresh hosted results belong
to the final pushed revision and are recorded separately in PR 7 and private
verification receipts.

## Authentication, voicemail and dependency follow-up

Three additional corrected source stacks passed independent review before
integration. The lead repeated 457 Vitest cases across nineteen files with zero
failures or skips: 160 voicemail cases and 297 authentication, meeting, native/SIP
and Android media cases. Full repository TypeScript, scoped ESLint and backend
bundling passed. ESLint retains one preexisting array-type warning and the
existing Node configuration-type warning; no lint errors were reported.

Corrected web stack `fb274fab7dc0755ace0db789f4976f15dbaee533` captures the exact
observed authentication lifetime before queued work and fences late media work.
Independent review found that the original logout helper erased cleanup custody
before awaiting a failed SDK stop. The corrected registry hides retired rooms
from owner-facing routes while retaining their exact cleanup lifecycle for retry;
web/native replacement joins and SIP handoff remain blocked until media drains.
The reviewer repeated 298 cases, including the original real-helper failure
probe. This is client lifecycle protection, not provider token revocation or
administrator screen-policy enforcement. See
[web authentication lifetime](WEB-MEETING-AUTH-LIFETIME-20261005.md).

Voicemail candidate `3b29d1f9a5db607b6ed827a8117af289409155be` persists both the
quarantine directory and its parent before retiring the source manifest, then
checks captured manifest/directory identities during cleanup. Failed sync or
conflicting/replaced evidence remains retryable. Producer and fixed runner bytes
are unchanged; changed relay bytes require fresh bundle pins. Independent review
passed 36 checked-in cases and seven additional real-file failure probes; this
does not establish commissioned-volume power-loss durability or exclusive host
custody. See
[quarantine durability](VOICEMAIL-RELAY-QUARANTINE-DURABILITY-20261005.md).

Corrected maintained dependency stack
`0d4ab0653a728237309dc300b75899460ca8ede7` keeps `braces@3.0.3` and applies a
bounded structural-depth/cycle patch. Independent review found and corrected
exponential traversal of compact shared-node trees in the first candidate;
completed-subtree heights now preserve longest-path checks without repeating
all DAG paths. The lead and independent reviewer each passed 115 focused cases
through an actual offline, frozen pnpm 9.12.0 sixteen-package consumer install,
with zero downloads or skips. All 764 registered unchanged upstream tests also
passed. This is a maintained mitigation, not an official fixed version or a
clean vulnerability scan; it does not bound every resource-exhaustion class.
A full Phone11 dependency install and hosted result are separate gates. See
[maintained dependency boundary](BRACES-DEPTH-MITIGATION-20261005.md).

Daily-use workflow blob `b5507b1b56f10d047b0542ccac82c9136b773646` now requires
23 nonempty completion suites to pass without skips and a separately executed,
passing installed-consumer dependency case. Independent review rejected missing,
duplicated, unexecuted and contradictory report fixtures and confirmed that
Bash preserves test failure through `tee`. Both event path lists watch patch
files. Exact-head hosted results are recorded separately in PR 7 and private
receipts; earlier green runs do not establish this new batch.

The subsequent frozen head `6ed24449ea3527ea2888c1b3f423c4f094a7eb63`, tree
`209200abfd58b90b4d7162c1ecfa8c59cc706ac4`, passed all twenty jobs across five
fresh hosted workflows. Daily-use and desktop jobs executed merge
`82c299f4119236f21010d81492cbd3a7b1b0ee6b`, whose entire tree matches that head;
mobile jobs executed the head directly. Authentication and release-guard logs
show the same merge checkout. This evidence retains those pins after any later
source or documentation change.

- [Daily-use](https://github.com/vasavas1977/codex-phone11/actions/runs/37340234095)
  preserved the normal full frozen pnpm 9.12 install and native postinstall.
  The actual installed dependency consumer passed 115 cases, and all 23 strict
  completion suites passed 927 cases, with zero failures or skips. Disposable
  PostgreSQL migration/preflight passed 57/23; the desktop helper passed 87.
  One optional Chromium history case skipped outside the strict completion gate.
- [Mobile](https://github.com/vasavas1977/codex-phone11/actions/runs/37340234175)
  passed 3,903 broad Vitest cases with 546 skips and 196 Node cases with eleven
  platform skips. Dedicated iOS header/mock-native gates passed fourteen cases
  without skips. Actual ordinary Android compilation and APK runtime-exclusion
  verification passed; the isolated foreground trial compiled and passed its
  seven-class/four-ARM-library verifier. Ordinary parser tests retained one
  explicit unstaged-SDK skip; trial parser tests passed all sixteen.
- [Desktop](https://github.com/vasavas1977/codex-phone11/actions/runs/37340234065)
  passed pinned macOS/Windows SDK compilation/bootstrap and fake-SDK protocol
  checks. Two expected PR-only Windows staging/receipt steps skipped. This is
  helper CI, not full-client or signed-distribution acceptance.
- [Authentication](https://github.com/vasavas1977/codex-phone11/actions/runs/37340234045)
  passed 82/95/78/39 cases across four executions. The first two each skipped
  the optional rendered-app case; database fixtures do not prove deployed login.
  [Release guards](https://github.com/vasavas1977/codex-phone11/actions/runs/37340234225)
  passed both Python suites, containing eleven and thirty-nine checks.

Private raw logs, exact checkout/tree records and fresh APK verifier hashes are
retained. This establishes source CI and debug packaging only. No APK was
downloaded or installed by the audit, and no deployment, provider operation,
voicemail commissioning, production SDK license or physical-device acceptance
is established by these results.

The subsequent native authentication candidate
`56700c9e74976d668e067600ea6bad5940f27ba1` binds queued joins, SDK media and
audio/output work to the original observed sign-in object and sticky retirement.
Five new failures reproduced against the prior source; 288 focused and adjacent
cases then passed without skips. Independent review repeated those cases and
passed four additional controller race/failed-cleanup probes. The integrated
three files matched the reviewed candidate byte for byte. Failed cleanup remains
hidden from owner-facing routes while retaining registry and media-lease custody;
this is not provider-token revocation or physical-native acceptance. See
[native authentication lifetime](NATIVE-MEETING-AUTH-LIFETIME-20261005.md).

The subsequent Android screen-consent candidate
`f0a38374242a063676ba8c0e6af4d22b7396cdec`, tree
`f73717e694c76c7dc7625e023b3ccfbadaf40ff8`, passed complementary independent
native/session and configuration reviews. Three reproduced native custody
defects were corrected: track double disposal, cancellation before operation
publication, and queued work surviving module invalidation. Manifest validation
also rejects disabled capture components and validates direct and symlink CLI
entry paths. Capture cancellation precedes queued authentication, route and
registry cleanup; uncertain native teardown retains its lease and requires
acknowledged cleanup before replacement or SIP acquisition.

All twenty integrated candidate files matched the frozen source byte for byte.
Root verification passed 399 focused cases across fourteen suites and 29 Node
native/manifest cases, with zero skips, plus full TypeScript and backend
compilation. The four native Node cases execute 22 Java scenarios against actual
extracted bridge/service code with JNI-free doubles. Independent native review
also compiled all 39 patched bridge Java sources against the actual pinned SDK;
this is not a full app or JNI/capture acceptance result. Configuration review
passed 37 cases, validated Android OFF/ON/OFF source manifests and recomputed
equality of all 22 generated iOS native files against base `6ed24449`.

The package patch remains default off. Ordinary Android screen publishing and
iOS screen publishing remain unsupported; no build flag, device, provider or
production configuration was enabled. See the
[Android screen-consent boundary](ANDROID-SCREEN-CONSENT-TRANSACTION-20261005.md).
The reviewed CI configuration requires 25 nonempty completion suites and the
installed-patch native/manifest tests with zero skips. A separate sixth mobile
job compiles the actual patched Android bridge with screen configuration ON and
validates its merged manifest, then restores generated OFF configuration.
Ordinary builds separately validate generated and merged OFF manifests. These
CI definitions are source checks until a fresh exact-source hosted run finishes;
the earlier twenty-job `6ed24449` receipt is not evidence for this new batch.

The recording speaker-rename copy also received a two-quote JSX escaping fix
without changing displayed text or behavior. Afterward, direct installed ESLint
passed the normal Expo app/components scope (131 files, zero errors, 33 retained
warnings) and the changed meeting/configuration files (zero errors, four
warnings); full TypeScript was repeated and passed. The Expo launcher initially
aborted an automatic ambient-package-manager dependency refresh before module
purge, so validation used the installed linter without refreshing dependencies.
An exploratory whole-repository lint failed on generated outputs and 88 tracked
error-bearing files that matched base `6ed24449` byte for byte; its raw failure
and scope comparison are retained. This is not a claim of clean whole-repository
lint or a reason to weaken the required release checks.

The first fresh `602391bd` hosted run passed all ten daily-use jobs: 25 strict
suites executed 986 cases without skips, with 115 installed braces cases and
29 installed native/manifest cases also passing. Its desktop, authentication
and release-guard workflows passed. Mobile exposed two separate CI failures:
three synthetic configuration cases rejected the newly imported screen plugin,
and the screen compile job could not find `rg` before reaching compilation.
The corrected synthetic harness loads the actual plugin through its existing
restricted VM and retains filesystem/environment/import denials; ten actual
configuration cases then passed without skips. The project guard uses portable
`grep -F --` with independently verified present/missing-project behavior.
Neither correction changes native capture source or enables a flag. Old run
receipts retain `602391bd`; the failed ON job is not compilation or merged
manifest proof, and final hosted acceptance requires a fresh corrected run.

## Reviewed relay and release follow-up — 6 October 2026

The relay now refuses WAV replacement, in-place mutation and changed source
paths before upload. The exact reviewed author revision is
`2c140a54bfc23e6a9ca780f7df58e56124988553`; integration
`faffc1a7ba20df3bda7529d00b6c969873960401` preserves its behavioral bytes.
Seven voicemail suites pass 200 cases with zero skips in both the author and
integration checkouts. Independent review ran the 28-case relay suite plus four
additional real-filesystem probes covering FIFO refusal, root replacement,
retry recovery and stable uploaded bytes. Full integration TypeScript and scoped
ESLint pass. The author's full TypeScript attempt failed on its reused dependency
set's missing desktop types; it is not the integration checkout result.

The [relay commissioning findings](PBX-VOICEMAIL-COMMISSIONING-20261006.md)
describe the bounded inode/path observations and remaining trusted storage
requirement. The [iOS capture investigation](IOS-CROSS-APP-CAPTURE-CONTRACT-20261006.md)
records three compiler probes and the missing documented system-broadcast
teardown acknowledgment. It adds no runtime, capture extension or activation.

Fresh read-only portal observations on 6 October confirm workspace profile
status enabled and meeting hosting enabled for both members in Test and their
direct chat. Advanced phone-system sections remain disabled. The public API
still reports build `team-chat-media-d41fc504`; this is not the source candidate.
No workspace configuration, membership, routing or deployment was changed.
Connect11 coordination still supplies no frozen released authoritative
host-control contract, and shared bot/artifact custody work remains separate.

The owner confirmed **trial-only Siprix coverage** on 6 October. Existing
60-second trial artifacts do not establish unrestricted production entitlement
on any platform. Fresh client packaging, exact-build acceptance and the deferred
physical phone checks remain required. Hosted source checks and unsigned local
bundles do not replace those gates. The earlier green `617dbd2` runs keep their
original SHA; a new integrated revision requires its own hosted results.

## Live and package boundary

After the owner signed in, a fresh read-only portal check confirmed extension
3001 in the Phone11 workspace, workspace status enabled, and hosting enabled
for 3001 and 1020 in the Test channel and their direct chat. The deployed admin
overview still disables advanced phone-system sections. Its voicemail-admin
route is absent and shows the unmatched-route page. The browser was restored
to the signed-in admin overview. No settings or memberships were changed;
these reads do not establish current-source deployment or provider acceptance.

Fresh public reads observed API build `team-chat-media-d41fc504` and static portal
source `63203c8910ff09ba59eeb6dfcba1f58c769bface`. Neither matches this candidate.
A public health response is not authenticated tenant, database, provider or
physical-device proof. No route switch or production mutation was performed.

Retained Build 120 and desktop trial artifacts keep their original provenance.
The changed mobile receiver/shared-engine inputs require fresh client packaging
and validation; do not retag old artifacts to the new commit. Phone testing is
still owner-deferred. No new client installation, OTA/store publication,
production SDK credential, formal signing or provider activation is claimed.

## Standalone Android trial preparation — 6 October 2026

The [standalone Android trial source](ANDROID-STANDALONE-TRIAL-20261006.md)
adds a separate INTERNAL release-APK profile and guarded, checksum-pinned SDK
pre-install transport. Existing iOS and debug installation dispatch stays intact.
The release verifier requires one APK snapshot, actual installed signature
verification and an independently supplied signing fingerprint. Relative and
bare manifest component names are normalized before refusing Phone11 wake
services and receivers. This is foreground evaluation source with 60-second
calls; no cloud release build, signing, distribution or phone installation was
performed.

The new CI gates execute all 11 build/transport cases with the actual pinned
local AAR, and all 40 APK-verifier cases with the installed Android signing tool.
Local extraction of both workflow gates passed without skips, including actual
unsigned-fixture rejection. Full integration TypeScript and scoped ESLint were
checked separately. The previous e6a2995 hosted results retain their source pin;
this addition requires fresh hosted checks and independent final source review.

A fresh package-presence check found the earlier unsigned e6a2995 Mac app's
recorded temporary path absent. Historical build, inventory and review receipts
remain, but they are not a currently available distribution package. Rebuild
before any distribution; preserve the existing signed rollback packages.

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
   The later coordination receipt pins draft shared-platform PR 480 at
   `3cf250f69a3b3c3da2d3d2a735d9fd41baca4c8e`: private room publication/playback
   reuses owner-only canonical recording and conversation identities and a
   scalar object/null SQL descriptor. A fresh read confirmed the same open draft
   head and its passing publication/playback job; overall hosted checks remain
   in progress. No deployed authenticated Phone11 consumer endpoint is established.
   A real custody issuer, constrained gateway principal and reviewed application
   binding remain prerequisites. Synthetic receipts confer no runtime authority;
   Phone11 introduces no duplicate chat, event, recording or transcript store.
5. Confirm SDK production coverage and formal mobile/macOS/Windows distribution,
   then accept exact-build calls, two-phone meeting speech/video, background
   ringing, notifications, reconnect and cleanup. Trial packages and old call
   observations do not complete this gate.

New work must keep source, CI, package, deployment, provider and device evidence
separate. Draft status remains appropriate until actual release gates pass.
