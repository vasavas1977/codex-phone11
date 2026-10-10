# Routing reads and legacy provisioning authority — 4 October 2026

This follow-up addresses two remaining source access-control boundaries. It
does not activate advanced routing or voicemail, change a production database,
install an app, or establish provider/device acceptance.

## Current admission for routing reads

Ring-group, queue and business-hours pages previously used cached administrator
membership. Their seven read procedures now check current active membership and
an active workspace before reading routing records. Owner/admin access remains
available; revoked, deleted, inactive and demoted memberships are refused.
Tenant-qualified parent checks still precede child and queue-stat reads.

Existing workspace selection remains compatible: these facilities select the
oldest active membership when no workspace is provided, even when that oldest
membership lacks administrator rights. They do not skip it to select a later
administrator membership. Explicit workspace requests must match current
membership. IVR's existing exactly-one-membership rule remains unchanged.

This is admission at the start of a read request. It does not cancel a read
already admitted before a later revocation. The existing 18 routing mutation
transactions retain their actor/workspace locks and same-client capability
checks through commit.

## Authenticated legacy writes require prepared schema

The exposed legacy extension-create, extension-assignment and DID-create
callers supply the authenticated actor. Those three paths previously ran the
runtime schema initializer before rejecting a revoked administrator. They now
skip that initializer and retain their existing current actor/workspace checks
and transaction rollback.

Authenticated provisioning requires schema prepared by the deployment/operator
flow. A missing or partial schema is not repaired through a company-admin
request; it fails and rolls back. Existing SQL error distinctions are retained
rather than masking unrelated SQL failures as readiness errors. The ordinary
PBX admin extension-create workflow and mobile/desktop read-only configuration
paths remain separate.

The three legacy admin list exports (extensions, organizations and DID numbers)
also read prepared schema without invoking the global initializer. Their current
HTTP admission, SELECT queries, tenant filters and password redaction are
unchanged. Missing objects actually required by those queries fail with their
original SQL errors. A missing unused column can still return a reduced row;
these reads do not repair schema or impose a new readiness check.

Actorless internal/operator write helpers retain their existing initialization
behavior. Their authority and fresh/partial schema behavior remain separate
commissioning boundaries. No global default, tenant seed, initializer SQL or
production migration was changed by this fix.

## Evidence and release scope

Baseline repros, candidate checks, independent reviews and exact-head hosted
CI are recorded separately. Database fixtures are synthetic, isolated and
admitted before setup; runtime checks do not certify production ACLs or the
complete external writer inventory. The read candidate passed 92 checks,
including 10 PostgreSQL admission checks with routing resource results mocked;
combined sequentially with the 115 existing authority checks, this is 207 checks
without skips. All 18 mutation callbacks, both write/IVR authority helpers and
all nine read callback bodies were independently confirmed unchanged.

Ten additional PostgreSQL cases plus a mandatory-fixture guard exercise the actual
three legacy writer exports
with real provisioning DML under a runtime role without database or schema
CREATE: prepared-schema owner/admin success, cold revoked denial, tenant/role
refusal, missing/partial-schema refusal, atomic rollback and revocation ordering.
The instrumented test adapter replaces `getPool` and `withTransaction`, records
SQL and uses real PostgreSQL BEGIN/COMMIT/ROLLBACK with one connection. It does
not exercise the production `db.ts` wrapper. This is synthetic export/SQL proof,
not a real SIP/provider provisioning result.

The additional list-read candidate passed 18 export checks and 12 real
PostgreSQL cases, with all 30 failing on its frozen baseline. Those database
cases cover prepared reads for both synthetic tenants, required missing tables,
and a harmless missing unused column under the same role without CREATE. They
use an instrumented pool adapter and do not exercise production pool setup or
reprove HTTP admission. Existing admission and SELECT bodies are unchanged.

The one-connection routing regression now opens the connection with a normal
startup budget before arming its actual-reader mock, then restores the original
250 ms pending-checkout bound. It still rejects the former global-reader
counterexample. Queued one-shot mocks are reset between tests, and an early
writer refusal is observed instead of waiting for an unreachable write pause.
Production routing code and SQL/lock budgets were not changed by this test fix.

The routing CI job runs write and read suites sequentially because their fixture
resets overlap. A separate mandatory PostgreSQL 17 job owns the provisioning
fixture and grants the runtime schema USAGE, table SELECT/DML and sequence
USAGE/SELECT, with no CREATE or ownership. Exact bootstrap admission checks refuse
missing service identity, ambient connection fallback and mismatched URL
parameters before fixture DDL. Each required test file runs separately, so an
absent PostgreSQL suite cannot be masked by a passing mock suite. Hosted CI for this follow-up is pending at this
document's commit; the PR checks and private receipts record later results.

Client/native production inputs remain those of the verified
[Build 116 and desktop candidates](BUILD-116-RELEASE-20261004.md). These backend
changes do not create new native artifacts. Physical tests remain deferred.
Protected clone, active/rollback writer ownership and operator review are still
required by [PBX release gates](PBX-RELEASE-GATES-20261001.md).
