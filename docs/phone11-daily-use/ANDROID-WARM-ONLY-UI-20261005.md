# Android warm-only transfer UI source candidate

Base: `7bddc2274d03340240a35dd340b964f435f5a54e`.

The provider exposes warm transfer on iOS Siprix and on Android only when the
existing foreground trial and consultation public flags are exactly `1` and
Siprix reports its authenticated native warm-transfer capability. Ordinary
Android stays disabled. Blind-transfer capability remains independent.

Active controls offer transfer for either supported mode and retain consultation
recovery for held originals. The transfer screen defaults to an available mode;
only builds supporting both show the mode selector. Warm-only builds never show
or submit blind transfer. Call/session/account scopes, request identity, pending
locks and native one-attempt checks remain authoritative. Retained handlers
recheck capability and selection; recovery checks current request, phase and
transfer-attempt state. No engine, native SDK, Answer media barrier, build flag,
workflow or external configuration changed.

Validation: 405 tests passed in the serial focused calling suite:

- `tests/phone11-transfer-lifecycle.test.tsx`
- `tests/phone11-transfer-screen.test.tsx`
- `tests/phone11-active-controls.test.tsx`
- `tests/phone11-active-call-navigation.test.tsx`
- `tests/phone11-siprix-engine.test.ts`
- `tests/phone11-siprix-selection.test.ts`
- `tests/phone11-android-call-permission.test.ts`
- `tests/phone11-android-answer-media.test.ts`
- `tests/phone11-siprix-callkit.test.ts`

Actual provider and screen tests cover warm-only, blind-only, both and neither,
retained selections, duplicate pending starts, ended/reused IDs, owner/account
changes, and warm-only restoration. Existing engine tests exercise exact Android
native trial predicates. The initial concurrent UI/permission run timed out in
an unchanged Dial-permission test; that entire file subsequently passed serially.
Focused ESLint: zero errors, five existing warnings. `git diff --check` passed.

An initial full TypeScript run identified transfer-view literal widening (fixed
with explicit types) and absent worktree desktop dependencies (existing installed
dependencies now linked). Final full TypeScript verification belongs to the
combined integration candidate; it is not claimed passed here. These are local
source checks only. CI, signed build, installation, provider transfer and physical
handset acceptance remain unverified; no external actions were performed.
