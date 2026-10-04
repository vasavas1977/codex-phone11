# Admin recovery, meeting admission and storage readiness — 4 October 2026

This follow-up starts from source `7b63a2a4a8d3b73f369b07caf1160688aea5ce5d`.
It fixes bounded lifecycle and readiness failures. Production activation and
physical phone testing remain separate; the owner has deferred phone testing.

## Changes

- Selected-workspace lookup failures show a recoverable error instead of
  incorrectly claiming that an administrator lacks access. Cached owner data
  cannot keep management controls active while that lookup has failed.
  Retry and member actions retain their account and workspace boundaries.
  Invitation actions also retire on unmount, login-session replacement and
  role change. Request-owned completion cannot release a newer action's lock.
- Meeting prejoin actions bind to the initiating authentication owner object.
  Signing in again with the same numeric user ID retires old actions; ordinary
  profile refresh preserves the current owner. A late old-room completion closes
  only its own session and cannot navigate into the replacement session.
- Voicemail storage readiness exercises the same required publication primitives
  as deposits: exclusive hard-link publication, full-byte replay, file fsync and
  directory fsync. A writable directory alone no longer supplies readiness.
  The probe uses its own private scratch names, cleans up only those names and
  refuses readiness when required primitives or cleanup fail.

## Evidence and limits

Root integration checks passed 191 cases across twelve meeting and voicemail
suites. The first command failed in the local pnpm launcher before tests started;
the preserved direct executable run used the existing installed dependencies.
Every test file was checked for existence before execution.
The integrated admin suites passed another 97 cases: 50 parent-screen checks,
42 actual invitation-child callback cases and five existing user-management
checks. The child baseline reproduced 28 failures and retained fourteen positive
cases; the parent baseline reproduced fifteen failures and retained one actual
role-denial case. These callback harnesses do not mount a browser or send emails.
Whole-repository TypeScript checking passed on the integrated implementation.
Scoped lint passed with zero errors and one existing voicemail array-style
warning, plus the existing Node configuration warning. Diff checks passed.

The meeting owner-session cases exercise actual screen callbacks through a
static harness on web, iOS and Android. They do not establish mounted UI,
native audio, provider admission or handset behavior. Storage probes establish
point-in-time primitive support, not mount survival, a real deposit or authorized
playback. Ingestion and provider host controls remain off.

Independent review approved the meeting candidate `3775739` and voicemail
candidate `8200d4b` as source only. Admin review found that unmounting its
invitation child could leave retained mutation callbacks active; the revised
candidate `55eb9eb` adds lifecycle, session and authority fences with actual
child regressions and passed independent source review with no P0–P2 findings.
No reviewer reran tests or inferred real invitation delivery.

The daily-use workflow explicitly includes the new regressions and related
admin, authentication and media-owner checks. A required-file gate fails before
bulk Vitest execution if any of eight paths is absent. YAML parsing and all
51 shell-step syntax checks passed; the gate rejected the missing child suite
before integration and passed after that suite was integrated.

Fresh signed iOS package verification and new-head hosted checks are required
for these client changes. Earlier packages retain their original source pins;
desktop reuse requires complete consumed-input equality. Existing rollback
artifacts are retained. No installation, app launch, store/OTA submission,
backend deployment, customer mutation or PBX commissioning follows from this
source report. Complete Zoom Phone/Meeting parity remains open in the
[coverage checklist](ZOOM-FEATURE-COVERAGE-20261004.md).
