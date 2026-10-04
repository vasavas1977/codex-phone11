# Meeting, directory and voicemail reliability — 4 October 2026

Implementation source: `4c018ba99e86a913c75b181caa6cacafa55640a9`, integrated
from independently reviewed candidates against `732919d80386f7462fd3f1d66b09bcb7a4dc7636`.
This follow-up fixes three lifecycle failures; it does not establish complete
Zoom parity, production activation or physical-device acceptance.

## Changes

- Native meeting joins now serialize pending setup and cleanup. A superseded
  join cannot publish another room or audio session using the same media lease.
  Failed audio teardown retains ownership and blocks replacement until cleanup
  succeeds. Existing SIP interruption and account-change checks remain active.
  Shared source tests cover iOS and Android; native hardware audio is unverified.
- Desktop contact rows bind their click callbacks to the directory owner,
  workspace, search and request generation that rendered them. A retained row
  from an earlier account or refresh cannot fill the current account's dialer.
  Current rows retain existing registration, call and pending-action guards.
- New voicemail objects are written and synchronized in a private staging file,
  then published through an exclusive hard link. Interrupted writes cannot leave
  a truncated final object that prevents every later relay retry. Concurrent
  publication requires matching final size and SHA-256, file synchronization
  and directory synchronization before database completion. Existing poisoned
  final objects still fail closed; this change does not repair them automatically.

## Source evidence

The integrated checkout passed 82 meeting tests (80 primary lifecycle cases plus
two route-exit cases), 78 voicemail storage/producer/relay/lifecycle tests and 26
desktop directory/renderer/shell tests. Full repository TypeScript checking
passed. Scoped lint had zero errors and three existing renderer style warnings.
Private raw logs retain an initial nonexistent meeting-test filter and its
correction; the missing route-exit suite was then executed separately.

The desktop author separately recorded seven baseline counterexamples and nine
passing candidate regressions, 45 passing related tests with one existing
opt-in skip, and a passing desktop build/typecheck. The voicemail author recorded
three failing baseline retry cases and 78 passing candidate checks. The native
author recorded a failing baseline overlap case and 82 passing candidate checks.
Each candidate received independent source review with no P0–P2 findings:

- Native: `8e29997af890b790ef1b86144bf1ff8a90c5926e`.
- Desktop: `228ae6428efa05c289dc55dbe301d7764f419825`.
- Voicemail: `464e6b1dc6ce58756ee090ee72724494fbba9999`.

The daily-use workflow explicitly includes voicemail durability regressions.
Hosted checks for this follow-up require the new pushed head; earlier green
checks at `732919d` do not establish these changes.

## Release and acceptance boundary

Native meeting and desktop renderer production inputs changed. Build 116 and
the earlier desktop packages do not contain these fixes. Fresh signed internal
iOS and macOS/Windows trial candidates are being prepared from the implementation
pin above; their completion requires separate package receipts. Existing rollback
packages remain retained. No phone installation or runtime launch is implied.

Voicemail ingestion remains off. Production storage must independently prove
same-directory hard-link publication and file/directory synchronization support.
Private orphan staging files after a process crash require reviewed retention;
this change introduces no automatic sweep or unrelated recording-store changes.
Real deposits and authorized playback, PBX commissioning, two-phone meeting
audio/video, SDK licensing, Windows signing and macOS notarization remain separate
gates. The owner has deferred physical phone tests while source/release work continues.
