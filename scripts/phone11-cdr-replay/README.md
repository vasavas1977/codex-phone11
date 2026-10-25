# Phone11 CDR replay engine

Source-only recovery component; not installed or scheduled on the PBX.

Run `python3 -B scripts/phone11-cdr-replay/test_replay_worker.py -q`.

The worker preserves every native spool file. It validates URL-encoded XML,
snapshots exact bytes durably, writes intent before sending and accepts only the
qualified CDR receiver acknowledgement. A persisted cursor prevents retained
acknowledged files from starving later entries. Known HTTP 500/503 responses
have at most three attempts with persisted backoff. Timeouts and interrupted
intent require reconciliation; they are not automatically replayed.

The acknowledgement covers the call record, leg and events, not recording
registration or voicemail delivery. Native files contain percent-encoded XML
without the `cdr=` prefix; transport adds that prefix without double encoding.

A reviewed source transport adapter is available; its actual binding to the
verified receiver remains pending. Production integration still requires current
tenant/route authorization, independent producer completion evidence and service
lifecycle qualification. Stable file metadata
alone is not proof that the producer finished. Injected callbacks must be
bounded; the engine cannot preempt arbitrary callbacks. A crashed temporary
state write fails closed for operator reconciliation. No cleanup or retention
policy for original files and durable snapshots is implemented here.

Admission receives the original channel SIP Call-ID alongside UUID, tenant and
payload hash. That value is untrusted: the production admission provider must
match it against current trusted routing state. Missing SIP identity is explicit
`None`, not a parent-derived fallback. The extra field is never added to the
durable journal or completion identity, and original encoded bytes stay unchanged.

The engine passed 27 offline tests. No customer spool entries were
read or replayed to qualify it. The 60-second trial remains unchanged.

## Pure trusted-route admission SQL

`admission.py` is a source-only, stdlib-only SELECT builder and strict input
validator. It requires an active trusted direct UUID route or unique active wake
route matching the original tenant/SIP identity, and refuses unbound, ambiguous
or cross-tenant parent/leg records. It corrects the historical nonexistent
`call_legs.call_uuid` reference to the actual `leg_uuid` column. It does not
connect to PostgreSQL, attest a receiver, stop a producer or enable replay.

Run `python3 -B scripts/phone11-cdr-replay/test_admission_pg.py -v`. The six
focused tests use an owned Unix-socket-only local PostgreSQL16/17 cluster and
synthetic rows. They skip explicitly when suitable local tools are unavailable;
`PHONE11_REPLAY_PG_BIN` can select an existing installation. The embedded
column/type/nullability projection comes from captured PG16 metadata; this is
not a full restored-schema, constraint, trigger, TLS or production-role test.
Integration passed all six cases on PostgreSQL17.11 and removed its owned
cluster. Cases cover the historical42703 error, positive trusted routes, tenant
and SIP refusals, ambiguity/inactive routes, parent/leg collisions and missing
role/SELECT permissions.

Separately, root's read-only PG16 diagnostic passed on 2026-10-25 at
06:29:22–06:29:25 UTC (`PBX-CDR-NEGATIVE-ADMISSION-PG16-20261025-v1.json`):
the exact corrected query parsed against the current catalog, the fixed
reserved identity was absent, admission was false, and protected epochs and
cleanup checks passed. This proves negative catalog compatibility only; no
positive current route, restricted application pool, producer completion,
spool access or replay was qualified by that observation. The W-specific
runtime authority and operational packet are not part of this source module.
