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
calling the producer directly bypasses the admission-cap race protection. The
producer rejects new admissions before contacting the backend at 1,000 pending
files or 5,000 total private evidence entries. An unreadable, unfamiliar, or
symlinked evidence layout also fails closed. This caps unattended growth by
making new deposits unavailable; it does not silently discard evidence.
Archived evidence needs an approved retention/export procedure before removal.

No global prune endpoint is exposed through the shared FreeSWITCH integration
secret. Admissions with no matching local pending file, including a failure
between backend admission and private-file persistence, require a separate
operator-authorized database retention procedure. A changed backend schema,
FreeSWITCH lifecycle, clock, runtime path, or volume mount requires a fresh
commissioning review. If the original SQL migration was already applied, its
age-gated trigger guard needs an explicit reviewed `CREATE OR REPLACE FUNCTION`
deployment; editing this source file does not update a live database.

The source checks exercise missing final paths, interruption-age retention,
exact review, backend outage retry, stored-message conflict, and the hard cap.
They do not prove FreeSWITCH returns a final WAV after caller hangup. Keep the
hook off until that lifecycle is traced on the active image and a signed-device
mailbox test passes.
