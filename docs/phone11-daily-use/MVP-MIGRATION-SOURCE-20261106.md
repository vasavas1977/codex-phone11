# Worker and SIP migration source preparation — 6 November 2026

This change maintains the reviewed worker launcher, rollback evidence checks and
passive SIP/FreeSWITCH classification in the Phone11 migration branch. It does
not activate a worker, edit runtime configuration, change database roles or
authorize a production cutover. Keep the 60-second calling trial. Android,
handset and provider testing remain separate.

## Maintained source

- `scripts/phone11-worker-runtime/`: the existing pinned factory, explicit
  launcher, two-sample known-failed-start prerequisite and complete container
  metadata fingerprints. Every ownership, admission, database, durable-work and
  external-work prerequisite must be independently established by the caller.
  The evidence modules never grant dispatch or admission-release authority.
- `scripts/phone11-sip-migration/`: bounded passive classification of explicitly
  supplied snapshots and connection ownership. Configuration selection and
  observed backing-store use remain separate. Unsupported, dynamic, ambiguous,
  unbracketed or idle evidence remains unknown. The caller separately proves
  freshness at action time. This package has no live transport.
- `Phone11 migration source checks`: factory provenance and lifecycle tests,
  strict recovery/evidence tests, passive SIP tests and an ephemeral Unix-socket
  PostgreSQL 16 schema fixture. Missing tools or skipped tests fail the check.
  This workflow has read-only repository permissions and no deploy action.

The worker factory's 40 reviewed source inputs are unchanged. Rebuilding the
locked graph reproduces the 271,163-byte factory with SHA-256
`db2b8717ba2193a1e174c51e97a4b823d03ab842a426ea2c4406af89c00fa85e`.
Private environment bindings, credential material, generated bundles, dependency
archives, cloud ownership journals and raw production observations are excluded
from this source change.

Local validation passed 28 Node cases and 38 Python cases without skips,
including five schema cases on a private Unix-socket PostgreSQL 17 fixture.
The hosted source check separately requires PostgreSQL 16. The maintained
launcher also fixes terminal-frame loss under stdout backpressure: confirmed
cleanup waits up to five seconds for the frame to flush, while a broken or
stalled pipe exits with code 70. Four real OS-pipe regressions cover that change.
Historical AWS timings below used the earlier launcher; they do not qualify
the new reporting change as a full native handover.

## Completed isolated measurements

The disposable Linux amd64 environment used actual systemd/cgroup v2, PostgreSQL
16.13 with TLS, Redis and nginx. Worker call admission and ESL were synthetic.
The separate SIP tests used the exact audited Kamailio image and synthetic SIP
requests. FreeSWITCH and real provider/media paths were outside these tests.

| Case | Fence request to verified readmission | Recovery segment |
| --- | ---: | --- |
| Worker forward | 4.804 s | Replacement readiness and systemd attachment verified |
| Worker known failed startup | 6.570 s | 2.222 s from rollback entry to both fixture gates reopened |
| Worker busy abort | 45.805 s | Original retained after the deliberate 45-second durable-work deadline |
| Kamailio forward | 4.167 s | Restricted TLS binding and synthetic registration verified |
| Kamailio wrong-CA rollback | 4.690 s | 3.246 s from confirmed candidate failure to restored admission |

The worker failed-start case injected an early role-OID mismatch before actor
admission. It does not qualify a later failure after actors or external work may
have run. An additional lost-acknowledgement case held both admission gates;
independent readback recorded a canceled start and the exact fixture was disposed
without retry, original restart or gate reopening. It produced no service
restoration measurement. The Kamailio busy test retained the original process;
its duration was not measured. Intervals in one row overlap and must not be added.

These are historical component measurements, not bounds on production downtime.
They remain separate from source checks on later changes. The disposable AWS
environment and temporary keys were removed and independently checked absent.
Estimated compute, IPv4 and disk cost was US$1.22 before tax/transfer within the
approved US$5 ceiling; the actual bill was unavailable. Production endpoint
responses remained as expected and no production cutover occurred.

## Remaining production gates

1. Resolve the original worker's effective bootstrap/configuration and actual
   pool authority with a fresh held-identity observer. Integrate the real native
   admission controls and independent ownership, journal and durable/external
   reconciliation into the complete handover and recovery path.
2. Obtain the exact custom FreeSWITCH artifact with established provenance and
   secret-free contents, or resolve an explicitly reviewed equivalent build.
   The current generic mutable package recipe does not reproduce the observed
   image. Prove effective core/post-load/profile DSNs and PostgreSQL, Unix-socket
   or SQLite use; a loaded module or absence of a matching socket is insufficient.
   Close all six live Kamailio module bindings and their required privileges.
3. Rehearse full native admission, known and unknown recovery, and actual cold
   boot on a new isolated persistent fixture. Preserve synthetic database OIDs,
   startup dependency/health order, network isolation and new-boot admission.
   The previous tmpfs fixture and systemd attachment test do not establish reboot
   recovery. Keep the complete measured maintenance window as a separate gate;
   earlier 30-minute worker and SIP reservations remain provisional allowances.
4. Refresh action-time source, process, certificate, capacity and ownership facts
   before proposing the production worker window, then the SIP window. A source
   merge does not authorize these live changes or their service pause.
5. Retire legacy LOGIN only after every runtime, boot, scheduled, backup, health,
   operator and rollback consumer is migrated or retired. Prove an independent
   administrator's exact role-change and readback authority, account for sessions
   and prepared transactions, and perform a separately authorized LOGIN-only
   change with known commit and fresh old-login rejection. Preserve the role,
   ownership, grants and password during that step.

Use the worker and SIP package READMEs for exact source-test commands and input
contracts. The maintained source may be merged into
`codex/phone11-production-close-20261022`; it is not a deployment or approval to
merge the unrelated long-running branch into `main`.
