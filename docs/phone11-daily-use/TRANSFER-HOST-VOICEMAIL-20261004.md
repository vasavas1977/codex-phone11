# Transfer, host removal and voicemail consumer follow-up — 4 October 2026

This bounded follow-up starts from `ebe33ea48aa57de414188bbb9125a8040b71c4f6`.
Physical phone testing remains owner-deferred. Provider activation, PBX
commissioning and production SDK licensing remain separate gates.

## Calling and voicemail

Blind transfer now retires retained screen callbacks on account, login, call
lifetime and route changes. Because the native SDK reports a call identifier
rather than a transfer request identifier, Phone11 allows one SDK transfer
invocation per call. A delayed earlier result cannot confirm a newer retry.
An uncertain attempt preserves the original call controls and does not force
hangup. Warm transfer, consultation calls and voicemail transfer remain
unsupported; Android and browser transfer capability remains unavailable.

Voicemail consumers bind playback, callback, read, delete and refresh to the
current account, extension, workspace and available inbox. Successful deletion
retires the selected audio immediately. Pending actions use per-message locks,
so switching A → B → A cannot submit another delete or read for pending A.
A failed desktop mark-read request can retry through pause/play without hiding
a current decoding failure. Missing desktop mutation capabilities stay explicit.
Voicemail ingestion remains off; these consumer checks do not prove a deposit.

## Source evidence recorded so far

Transfer candidate `42ee510ee4883998411842dc6108f2752345283b` and voicemail
candidate `f2654958194b798a4aa396d00f38d04a1c9c9cf6` passed independent
source review with no P0–P2 findings. Root integrated their exact file contents
as `ca8f22f` and `516d091`. At the latter pin, root ran 306 focused Vitest
cases across eleven files, 18 desktop player/renderer cases and ten native
bridge source checks; all passed without skips. Native checks include actual
Objective-C bridge/mock SDK lifecycle and retained SDK-header compilation,
not real SIP or handset acceptance. A guessed desktop test filename was rejected
by the file-existence precheck before execution; the discovered existing
renderer suite was then used successfully.

## Meeting moderation

Default-off host-removal composition now supplies a server-authorized admitted
member list to the shared web/iOS/Android meeting panel. Targets use the original
trusted logical participant identifier sent to Connect11 token minting, never
the opaque RTC identity, SID, display label or token identifier. Trusted profile photos
use the existing authorized directory descriptor; missing photos use initials.
Host authority, current membership and extension grant are checked under held
transaction locks. Requests bind the exact participant, room revision and member
revision. The room-bound idempotency key and operation UUID written into the
revoked membership prove which durable local denial belongs to that operation.
Retries reconcile only that same denial; readmitted, replaced, unrelated or
legacy unbound memberships fail closed. No schema migration or legacy rewrite
was introduced.

Connection loss permanently retires retained confirmations and completions,
including reconnect cycles that finish before React renders. Provider pending
and completed acknowledgments do not manufacture a removed media-roster entry.
Composition remains disabled without explicit reviewed dependencies. Desktop
removal integration, end-for-all, remote mute, waiting room and other absent
provider capabilities remain unavailable.

Independent review approved the complete host candidate
`f571100ad041c57e04f8b5f81365d8dc11e21083` with no remaining P0–P2 findings;
root integrated its exact 22 file blobs as `51b122e`. The unaccepted `944b423`
intermediate reproduced eight failures in 23 lifetime/panel cases; root applied
only the complete reviewed delta, not that intermediate as a standalone commit.
Root integration passed all 207 cases across fifteen related suites without
skips. The 31 disposable PostgreSQL cases (14 existing, ten snapshot/authority,
seven lifetime) subsequently passed hosted execution with zero skips at the
corrected source pin below.

## Integration and release guards

Scoped lint passed with zero errors and thirteen pre-existing warnings; diff
checks passed. The daily-use workflow now fails early when any of fifteen
required regression files is absent; root executed that exact gate successfully.
Independent workflow review approved the added exact test arguments and a
macOS native bridge check using the pinned SDK. YAML and shell syntax checks
passed. The later hosted results below are separate from these local workflow checks.

The first full TypeScript run found mock-signature inference errors in the new
member-removal test. Its failed log is retained. Independently reviewed amendment
`710c64f` only types the existing API mock signatures; assertions and runtime
implementation are unchanged. Root integrated it as `9711881`, reran all nineteen
controller cases without skips and passed whole-repository TypeScript checking.
These source pins, raw checks and review hashes are retained in private custody.

The first hosted PostgreSQL attempt on `770f95a` executed 31 cases with 29
passes, two failures and zero skips. Both failures occurred while setting up new
fixture revocations: those updates omitted the revision change required by the
existing BEFORE UPDATE trigger. The test-only correction adds a fresh revision
to those two updates, retaining all assertions and production constraints.
The first failed raw job log is retained. The corrected source passed a new
automatically triggered hosted run; the failed attempt is never counted as a pass.

## Frozen release-candidate evidence

Implementation and test source is frozen at
`22fd18314ed6671cbb4a7cfd9408adf4d6456b68`, tree
`f8256c69b15e934c4190da3498a11106366b857e`. Later documentation changes do
not retag that source or its packages.

All five automatically triggered hosted workflows and all nineteen jobs passed
on that source tree, attempt one. Four jobs checked out the exact source and
fifteen checked out its authenticated PR merge with the identical full tree.
Mandatory routing/legacy checks passed 225 cases, including forty actual
owned disposable PostgreSQL cases; the separate host-removal job passed 31
and the native bridge job passed ten. Each required gate had zero skips.
Android debug compilation passed. Optional full source discovery recorded
3,255 Vitest passes and 523 skips, plus 68 Node passes and ten platform skips;
those optional skips are not counted as required-gate passes. PR-only Windows
helper custody/export steps were intentionally skipped and are not package proof.
Root rehashed 52 evidence files, verified the nineteen checkout bindings and
all five complete workflow archives, and checked the required raw summaries.

Signed internal iOS [Build 119](https://expo.dev/accounts/vasavas/projects/phone11ai/builds/d492c632-e4f8-41e7-9b4f-3dcf9762e16f),
fresh macOS arm64 and Windows x64 trial packages were produced from that frozen
source. All three passed independent package review. The iOS reviewer reran 22
signed checks and 42 supplemental checks and proved
the exact three existing registered phones against the signed provisioning and
fresh authenticated inventory. Source provenance binds authenticated metadata,
the clean checkout and submission custody. A submitted archive digest was not
retained, so this does not establish cloud reproducibility. The original early
preparation-plan bytes were also not retained; its historical digest cannot now
be rehashed. Preserved helper snapshots, the later paused plan, and the actual
corrected-source submission custody are separately pinned. Historical planning
records are not substituted for actual submission or signed-package evidence.

Independent desktop verification covered all 82 consumed source inputs, actual
Expo configuration, all 24 compiled files, native helper reuse and rollback
custody. macOS inventory covered 280 regular files and nineteen contained
relative links, thirteen helper files and five helper links, with strict deep
signature verification. Windows verification covered all 78 ZIP entries with
CRC and exact-byte equality, ten AMD64 PE images, fourteen unchanged
non-resource sections and exact resource-edit reproduction. Twenty-three
shared compiled files matched across macOS and Windows; the main file differed
only by its platform helper-manifest digest. These checks do not establish an
independent compiler rebuild. macOS is ad-hoc signed; Windows own binaries are
unsigned. Trial calls
remain limited to sixty seconds. No package was installed or launched, and
no provider activation, deployment or production database mutation occurred.
Builds 49 and 115–118 and the earlier desktop rollback packages remain retained.
Build 114 remains the last recorded installed iOS baseline; this is not a fresh
audit of either phone. Physical acceptance remains owner-deferred.

See the [coverage checklist](ZOOM-FEATURE-COVERAGE-20261004.md) for the remaining
Phone11/Zoom workflow gaps.
