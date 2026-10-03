# Meeting and voicemail source completion — 4 October 2026

This batch completes bounded source fixes and release preparation. It does not
complete Zoom parity, commission voicemail or activate host removal. Physical
phone acceptance remains owner-deferred.

## Integrated changes

- Desktop `7edaaa1`: initial LiveKit connection failure stays on prejoin for
  Retry. Cancel/Leave invalidate pending admission and capture immediately and
  request the existing bounded main-process close. Retired room callbacks cannot
  detach replacement-room media or remove its participants. Room selection is
  locked while joining.
- Host removal `982d903` + `08fdb9d`: an unmounted, default-off per-tenant
  service reuses the durable eviction ledger. Original creator, current host
  permission, exact channel/direct membership and admitted identity are checked
  in the transaction that denies member reminting and invalidates leases.
  Server-derived subjects retain the same idempotency key after uncertain
  requests; polling uses the stored provider UUID. Processing remains pending;
  nullable creation timestamps are accepted; invalid completion timestamps and
  unsafe revocation cutoffs are refused. Provider acknowledgment is not physical
  removal proof. No host-control UI or RPC endpoint is exposed.
- Voicemail `a3424f9` + `2cd1f7e`: extension, ring-group, queue, time-condition,
  DID and static/loopback deposits use guarded entry paths. Backend/FreeSWITCH
  mode mismatches refuse recording. Protected routes resolve fresh personal
  mailbox bindings, bypass stale XML caching, and require durable admission
  before recording. Both configuration trees package identical helpers;
  infrastructure images explicitly require the Lua module.

Zoom's [host-control reference](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0065164)
informs the participant-management workflow. Unsupported end-for-all, remote
mute, waiting-room, co-host and host-transfer controls remain gated.
Connect11's existing server-only REST contract is reused rather than creating a
second provider-removal service or relying on unreleased SDK packages.

## Root verification

On the integrated source tree, the lead ran:

- Desktop suite: 100 passed, one pre-existing optional Chromium test skipped.
- Host suites: 51 passed, including 14 real disposable PostgreSQL 17 cases;
  after the safe-integer follow-up, all 41 selected transport/service cases
  passed. Counts overlap and should not be summed.
- Voicemail route suites: 45 passed; existing queue, ring-group and
  time-condition regression suites: 14 passed. Three Lua runners: 34 cases
  passed. Both helper pairs were byte-identical.
- Whole-repository TypeScript, desktop TypeScript and desktop build passed.
  Scoped lint reported zero errors and six pre-existing warnings.
- Independent reviewers approved the desktop, host-removal and voicemail
  changes as source only. No live provider or physical-media acceptance is
  inferred from their mocked lifecycle checks.

Hosted CI and new package receipts must be pinned separately after the final
source push; an older green workflow is not evidence for this batch.

## Release prerequisites

Before any backend rollout, stage and verify exact voicemail helpers and loaded
`mod_lua` with both flags off, then rehearse legacy deposits and rollback. Before
commissioning, invalidate old compiled dialplans, drain legacy calls, and verify
the private source/outbox/relay/runner, schema definitions, admission/replay,
final WAV and owner-epoch lifecycle. See the [routing contract](../../server/pbx/VOICEMAIL-ROUTING.md)
and [fresh read-only target findings](VOICEMAIL-ACCEPTANCE-PACKET-20261004.md).

Host removal needs separately reviewed provider eviction readiness, namespace
and credential bindings before composition and consumer controls. No join
capability or HTTP 202 receipt supplies that approval.

The mobile/client tree is unchanged from signed Build 115 (`1dfda34`); its
verified package and rollback custody remain valid evidence for that tree.
Installation, two-phone audio/video, reconnect, push/background and voicemail
playback remain deferred. New desktop trial packages require their own source,
helper-integrity and signing receipts and do not establish runtime acceptance.
