# Atomic routing audit prerequisites

Routing mutations insert one audit on their existing PostgreSQL transaction
client before COMMIT. An audit insertion/serialization failure rejects the
operation with a fixed error and dispatches rollback; cache invalidation stays after
commit. Unknown transaction, COMMIT, ROLLBACK or release errors are returned as a
fixed transaction-failure message without a database cause. Controlled
authorization/validation refusals retain their codes. A cleanup failure after an
acknowledged COMMIT can leave both changes durable; the error makes no rollback
claim. Postcommit cache work remains outside transaction-error handling. Existing tenant/member/resource locks, target validation, isolation and
route responses are preserved. This does not provide exactly-once client retry
semantics: a lost COMMIT acknowledgement remains ambiguous and must not be
interpreted as proof that nothing committed.

All 18 IVR-router mutation paths are covered: IVR create/update/delete/actions;
ring-group create/update/delete/members; queue create/update/delete/agents/login/
logout; time-condition create/update/delete/rules. A queue login/logout affecting
no agent row does not claim a change. Existing Zod defaults still apply to partial
updates. Replacement operations record deleted and inserted rows from RETURNING,
including an empty replacement. Stable resource IDs and action names identify the
operation. Before/after summaries contain only fixed operational columns. Names,
descriptions, destinations, caller identities, media paths, TTS, skills and secrets
are excluded; shared audit redaction is retained as a second boundary. Date or
other nonplain prototype values retain the existing redaction behavior. These are
change summaries, not complete configuration backups.

`insertAuditLog(execute, entry)` is strict. `writeAuditLog(entry)` retains its
legacy best-effort semantics for other callers. The nine existing audit-producing
PBX-router admin operations also use strict insertion on their transaction client:
workspace timezone, membership update, extension create/update/delete, SIP
password reset, number creation/route assignment and fraud-control update.
Their existing audit actions, payloads, secret redaction and authorization checks
are preserved. Workspace timezone uses its existing conditional membership-locking
UPSERT inside the transaction, keeping that authority lock through the audit and
COMMIT. A timezone request with no change field remains a no-op. This is not a
claim that every endpoint in the product produces an audit.

The PBX operations use fixed messages for audit and unknown transaction failures;
controlled authorization and validation errors retain their codes. Cache work
stays after an acknowledged commit. Failure there, loss of a COMMIT response or
release failure does not prove that the business change rolled back. Client
retries must not assume otherwise. The tests cover these boundaries with injected
transports; actual audit storage and runtime permissions still require the
separate admission below.

## Existing storage that must be verified before runtime admission

No migration or DDL is included. The existing unqualified `audit_logs` INSERT uses
these eleven columns, in order:

`tenant_id, actor_user_id, action, resource_type, resource_id, old_value,
new_value, ip_address, user_agent, request_id, session_id`.

The selected database/search_path must resolve that relation safely. Verify its
actual column types accept the existing bound values, omitted required columns
have valid defaults (including any identifier/timestamp), and all constraints,
RLS and triggers permit the intended tenant audit. If partitioned, verify usable
partition coverage for server-generated insertion times, including future
maintenance. The repository comment describing a partitioned table is not DDL
or evidence that a current partition exists.

The exact runtime/rehearsal role needs INSERT on the audit relation and necessary
partition/default/sequence privileges. The routing before/after projections also
need SELECT on their explicitly named operational columns. Schema capabilities,
PBX preflight and database-readiness checks currently omit audit storage. Their
success does not establish audit write readiness. Missing audit prerequisites
now intentionally fail the routing mutation rather than silently lose its audit.
Do not invent grants or a new audit schema from this source change; obtain a
separately qualified metadata observation and a contained rollback/insertion
rehearsal before runtime admission.

The separately frozen public source at
`work/phone11-publish-pbx-20261014/pbx/audit-storage-schema-v1/audit_create_body_v1.sql`
designs an ordinary 13-column table matching these eleven INSERT fields plus
BIGSERIAL `id` and defaulted `created_at`, with FORCE RLS and no policies. It is
compatible with this source API in shape; it does not establish current storage
or a restricted writer's authority. An owner/bootstrap role can bypass RLS where
an ordinary restricted role cannot. This fix neither changes that design nor
adds policy/grants.

## Frozen rehearsal boundary

The original `phone11-pbx-ivr-safety-20261013` checkout and existing selected
product/import/build contracts pin the old audit/router bytes. They remain
unchanged. This worktree's source cannot inherit their build, worker, fixture,
restricted-role or handler authority. A successor must independently bind the
new source/import graph, package/compiler/container bytes and audit storage
prerequisites before any admitted rehearsal. No deployment or database action is
authorized by this document.

The old `restricted-runtime-plan-v1/audit_insert_observation_v1.sql` requires
`new_value->>'name'='clone-rehearsal'`. Names are deliberately absent from the new
safe summaries, so that frozen observer is incompatible with this successor.
Leave it untouched; a separately reviewed successor should link the admitted
fixture menu ID, tenant, actor, action, resource ID and operational JSON ID.
Do not claim the old name predicate passed for these new bytes.

Unit tests inject pg/Redis transports and exercise the real router, audit
serialization and `db.withTransaction` control path. They establish client reuse,
SQL ordering, rejection/rollback dispatch, safe values and failure privacy; they
do not establish actual PostgreSQL durability, role grants, partitions, live
cache/provider behavior or production acceptance.
