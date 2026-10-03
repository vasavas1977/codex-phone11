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
- The daily-use workflow now explicitly runs the new host/voicemail suites and
  all three Lua runners, including runtime/packaging path filters. Its 13
  selected TypeScript suites passed locally (114 tests); YAML structure, shell
  syntax and exact test paths passed. Local Lua is 5.5.1; hosted execution uses
  explicitly installed 5.4. Real PostgreSQL coverage remains a separate local
  disposable harness, not a fabricated hosted check.

All five hosted workflows passed for exact source
`b13fd44014152378bbf6b100144b8035bb0b7cb5`: daily-use (`37145096395`),
mobile native including Android compilation (`37145096401`), owned
authentication (`37145096471`), release guards (`37145096477`) and native
desktop helpers on both platforms (`37145096410`). The new hosted daily-use
steps actually ran 43 host cases, 71 voicemail cases and 34 cases on Ubuntu
Lua 5.4.6. All seven jobs succeeded; one existing optional desktop Chromium
test skipped. The new host PostgreSQL suite was still outside this hosted run.
Later source changes require fresh checks; this receipt does not cover them.

Independent package review approved macOS and Windows portable trials built
from `6800babb085f0c2544723a069b8a4f05d53dd35f`, whose desktop trees match
`b13fd44`. Both platforms' eight bundled runtime files, static files and pinned
helpers matched. The Windows ZIP's 78 entries matched the verified directory;
its SHA-256 is
`aee24784b81225d765932acaa79f265b03dc50de528fd0ba95126351f68f31e7`.
macOS strict deep signature verification passed with an ad-hoc signature;
it is not notarized. Windows app/helper are unsigned. Neither package was
installed or launched for this receipt; provider and device acceptance remain
separate, and the existing 60-second trial limit is unchanged.

## Further source completion after `b13fd44`

- `a5e6a45` adds a file-only helper/runtime preflight. It compares both reviewed
  source copies and supplied snapshots, parses the supplied Lua configuration,
  and checks bounded, fresh caller evidence. Failed or stale module probes
  remain unknown; staging cannot claim installed readiness. Rollout and
  commissioning approval are always false. The lead ran 43 focused cases,
  whole-repository TypeScript and scoped lint successfully. Independent review
  passed 36 verifier cases and CLI failure/UNKNOWN/oversized-input checks.
  See [the utility contract](VOICEMAIL-HELPER-PREFLIGHT.md).
- `4cdf8ba` adds a dedicated hosted PostgreSQL 17 service for durable host
  authority tests. A fixed Unix socket, native runner identity, database/version
  assertions and bounded real SQL readiness prevent a missing service from
  silently skipping the suite. The final PostgreSQL process must have replaced
  initdb's temporary server. Local execution passed 14 real PG17 cases and an
  actual Docker PG17 identity/readiness check; an independent review verified
  preserved jobs/permissions and eleven mocked guard scenarios. Hosted
  execution of this new job still requires its own final-head receipt.
- `282ca5e` adds accessible prejoin Refresh/Retry for desktop recipients whose
  invitation arrives after the window opens or whose initial access request
  fails. Refresh preserves channel invite selections and direct-chat search
  state. A removed selection requires an explicit choice instead of silently
  changing rooms. Main-process and preload request/session guards reject stale
  refreshes after start, join, close or authentication changes. Two regression
  cases failed against the baseline before the fix; the worker's final desktop
  suite passed 120 cases with one existing optional Chromium skip. The lead
  also ran the integrated full desktop suite, TypeScript and build successfully.

These source changes do not stage voicemail helpers or enable host controls.
Desktop Refresh needs new package bytes; the earlier `6800bab` trials above
are retained evidence for their own desktop tree. Final-head hosted and package
receipts are retained separately, rather than inferring them from earlier runs.

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
