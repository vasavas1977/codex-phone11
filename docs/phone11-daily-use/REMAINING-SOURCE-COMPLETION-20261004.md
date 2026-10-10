# Phone11 remaining source follow-up — 4 October 2026

Implementation and required CI contracts are frozen at
`da04d979f9a05ebd803d7b3545f49fe22c4fa401` (runtime changes through `40dccb7`).
This completes three bounded source slices. It does not establish full Zoom
parity, production commissioning or owner-deferred physical acceptance.

## Implemented behavior

- Desktop meeting hosts can inspect admitted access, confirm permanent member
  removal and poll/retry the exact operation through protected IPC. Host access
  binds the authenticated session, tenant, room revision and current membership.
  Logout, reconnect or route retirement invalidates stale controls. Admitted
  access and the actual SDK media roster remain distinct; a provider receipt
  does not remove a media tile. The server feature remains default-off.
- The iOS native warm-transfer candidate owns one original and one consultation
  call. Only an explicit authenticated continuation after authoritative hold
  starts the second leg; attended transfer uses the pinned SDK selector and a
  one-attempt fence. Cancellation and audio focus follow SDK callbacks. If the
  original ends first, explicit End still reaches the exact remaining owned leg
  from CallKit, the active screen and Recents. Session/account/request/history
  replacement retires that relationship. No automatic BYE or assumed success is
  substituted for a transfer outcome. `PHONE11_WARM_TRANSFER_SOURCE_ENABLED`
  defaults to zero; ordinary builds retain their single-call baseline. Native
  wake-owned sessions, Android, browser and desktop warm transfer are unsupported.
- The voicemail producer persists and checks private child/parent directory
  entries before backend admission or retirement. Failed fsync, path/descriptor
  replacement and uncertain publication fail closed while retaining the same
  durable UUID for reconciliation. Direct configured parents must already exist;
  this does not initialize arbitrary ancestor paths. Ingestion remains off.

## Validation and retained limits

Root integrated all three reviewed candidates and ran 362 call/voicemail-action
checks, 67 producer checks, 21 native/packaging checks and the full TypeScript
compiler successfully. Required suites had no skips. The native run compiled
actual bridge source against the staged pinned header with both the default-off
and test-only enabled gates; callback behavior used a mock SDK. Desktop source
checks passed 163 cases with one existing platform history skip, while the 36
focused removal cases had zero skips; desktop typecheck and JS build passed.
Changed mobile/producer/test lint reported zero errors and thirteen warnings.

Independent reviews approved source only. The first warm-transfer review found
and reproduced an orphaned End action; that failure and the unchanged passing
counterexample are retained. Early dependency-wrapper, parser-path and lint-path
failures are preserved rather than counted as successful feature checks. Two CI
YAML files and 69 shell blocks parsed; sixteen guard fixtures, including negative cases, behaved
correctly. Exact workflow guards accepted the retained real JSON/TAP outputs,
including every required case and both native gates.

Hosted CI and any fresh trial packages must retain separate receipts for the
frozen implementation pin above. Current review/check status is tracked in
[PR 7](https://github.com/vasavas1977/codex-phone11/pull/7); the earlier Build 119
and desktop trials retain their original `22fd183` source pin and cannot prove
this follow-up. Later documentation commits do not retag implementation inputs
or signed artifacts.

No install, launch, provider activation, live deposit, transfer, audio or physical
phone test is established by this source batch. Keep sixty-second trial limits,
rollback packages and separate Android acceptance. Super Number owns the shared
future-event and meeting-bot services; Phone11 must consume a released,
authenticated contract instead of creating a duplicate service. Desktop warm
transfer still requires its own native two-call state model, exact desktop SDK
headers, both-OS compilation and independent real endpoint acceptance.
