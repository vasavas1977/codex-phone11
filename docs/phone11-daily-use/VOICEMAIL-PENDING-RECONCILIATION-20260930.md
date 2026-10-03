# Phone11 uncertain voicemail admission reconciliation

This is a source-only commissioning contract. `PHONE11_VOICEMAIL_HOOK_READY`
remains off. A missing `voicemail_file_path` after `mod_voicemail` is ambiguous:
the caller may have abandoned the deposit, the module may have written a final
WAV without returning its path, or the hook may have been interrupted. The Lua
adapter therefore keeps the private pending admission and any source WAV. It
does not infer abandonment or delete either one.

The backend upload path and database insertion guard accept a matching durable
admission regardless of age so a completed WAV can be delivered or replayed
after a long outage. Elapsed time alone does not invalidate completed evidence.
The private producer permits operator review of an unresolved pending record
only after eight days; the backend permits exact reviewed retirement after seven.
`inspect` is read-only and reports up to 100 stale channel identities per run.
Before any `retire`, the operator must inspect the active FreeSWITCH mailbox
directory and logs for that exact channel and message identity, verify whether
a final WAV or delivered/quarantined manifest exists, and preserve any uncertain
media. If a final WAV exists, investigate or recover it; **do not attest that
there is no final WAV**. `retire` requires one exact channel UUID and an
explicit `reviewedNoFinalWav: true` input on standard input. It asks the backend
to expire only that tenant/extension/message UUID, then moves the pending JSON
to a private `retired-pending` archive. A denied or unavailable backend leaves
the pending file in place for retry. The backend also refuses retirement when
the message was already stored. Neither command deletes WAVs or manifests.

The fixed runner serializes `admit`, `complete`, `inspect`, and `retire` with a
kernel `flock`. All production use must go through that runner;
calling the producer directly bypasses the `flock` serialization. The
producer rejects new admissions before contacting the backend at 1,000 pending
files or 5,000 total private evidence entries. An unreadable, unfamiliar, or
symlinked evidence layout also fails closed. This caps unattended growth by
making new deposits unavailable; it does not silently discard evidence.
Archived evidence needs an approved retention/export procedure before removal.

No global prune endpoint is exposed through the shared FreeSWITCH integration
secret. The producer now durably records a private pending intent with a client
message UUID before contacting the backend. It POSTs only to
`/api/recordings/voicemail/admission/idempotent` with that exact UUID. An older
backend returns 404 on this path and cannot mistake it for a legacy insert,
including after a rollback between uncertain admission attempts. The backend inserts once
under the existing admission primary key. A retry can acknowledge the same row
only while its tenant, extension, owner, and owner epoch still match the locked
active mailbox. It does not renew the row's age. A lost response, malformed
response, or private acknowledgement write failure retains the same intent and
does not release the call into `mod_voicemail`. The acknowledged pending record
is atomically replaced and directory-synced before recording begins.

The unacknowledged intent has `requestMessageUuid` and deliberately omits
`messageUuid`, so an older producer's pending parser refuses it during a
producer rollback. Existing acknowledged pending files without an `admitted`
flag and older admission clients remain supported. `inspect` reports whether
each stale record is acknowledged; reviewed `retire` uses the same exact UUID
for either state. No pending file or WAV is removed automatically. Historical
admissions with no matching local pending file, including those created by an
older producer before this change, still require a separate operator-authorized
database retention procedure. A changed backend schema,
FreeSWITCH lifecycle, clock, runtime path, or volume mount requires a fresh
commissioning review. If the original SQL migration was already applied, its
age-gated trigger guard needs an explicit reviewed `CREATE OR REPLACE FUNCTION`
deployment; editing this source file does not update a live database.

The private producer recognizes only an exact two-link crash state: a pending
file linked to its private producer temp file, or a reviewed pending file
linked to the matching `retired-pending` entry. It verifies both names refer
to the same private regular inode before recovery. An unrelated hardlink,
third link, symlink, or conflicting archive target blocks the operation. An
`inspect` call remains read-only; a retry cleans the matching producer temp
link and syncs the directory. Retirement repeats the backend's idempotent
exact-UUID expiry before completing the interrupted private move.

The source checks exercise missing final paths, interruption-age retention,
exact review, backend outage retry, stored-message conflict, and the hard cap.
They do not prove FreeSWITCH returns a final WAV after caller hangup. Keep the
hook off until that lifecycle is traced on the active image and a signed-device
mailbox test passes.

## Isolated lifecycle rehearsal

Run from the repository root:

```sh
./node_modules/.bin/vitest run tests/phone11-voicemail-lifecycle-rehearsal.test.ts
```

The temporary private mailbox and outbox use the actual producer and relay
functions with in-process admission/upload responses. The fixture proves the
relay makes zero upload attempts while only pending admission exists, then
publishes the exact tenant/extension/message manifest after `complete`. A lost
upload response keeps that manifest for retry; the fake backend records one
accepted message under two upload attempts. A WAV from a different mailbox
cannot publish a manifest or upload. A simulated backend owner rejection (409)
quarantines the completed manifest and preserves the WAV. The output includes:

```text
voicemail_lifecycle_rehearsal {"admission":"22222222-2222-4222-8222-222222222222","preFinalizeUploads":0,"replayAttempts":2,"uniqueAccepted":1,"manifestRemaining":false,"wavPreserved":true}
voicemail_failure_rehearsal {"crossMailboxManifest":false,"crossMailboxUploads":0,"ownerRejected":409,"quarantined":true}
```

These are isolated fixture observations, not FreeSWITCH, hosted database, or
provider evidence. Before enabling the hook, the operator still needs to trace
the exact active FreeSWITCH image and durable mounts: verify that admission
finishes before `mod_voicemail`, that a completed deposit returns with the
correct account/domain and final private WAV path even across caller hangup,
and that abandoned/interrupted deposits retain pending evidence without
inventing a completion. Then verify backend owner-epoch rejection and replay
against an isolated tenant, plus authenticated playback on a signed device.

On 1 October, the focused producer, storage, and lifecycle suites passed 44
cases; the isolated local PostgreSQL suite passed eight cases, including
concurrent same-UUID admission and owner-epoch replay. TypeScript passed.
These checks are local source/rehearsal evidence, not a deployed backend or
FreeSWITCH acceptance. After installing the official Homebrew Lua
package locally, `lua tests/phone11-voicemail-hook.lua` passed 12 cases.
The Lua harness supplies simulated FreeSWITCH objects; it does not establish
the actual host's `mod_voicemail` callback or completed deposit behavior.
