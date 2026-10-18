# Audit storage and fixed-tenant permission contract

This prepares PostgreSQL storage and an isolated permission contract for the two
outbound-call flags. It does **not** make the existing shared application pool
ready to use that role. No script is an application startup migration, role
bootstrap, credential loader, production action, or automatic retry/rollback tool.

## Maintained storage

`audit-storage-migration.sql` independently defines the actual `audit.ts` insertion
shape: eleven supplied fields plus generated `id` and default `created_at`.
Tenant/actor are int4; action/resource type/id and optional metadata are text;
old/new values are JSONB; IP is inet; created_at is timestamptz. The bigint id uses
GENERATED ALWAYS AS IDENTITY, so normal insertion cannot choose an id. The driver
continues returning bigint ids as strings and timestamp values using pg's normal
Date handling. No actor FK or customer seed is invented. The tenant FK is RESTRICT,
so deleting a tenant does not silently delete its audit history. Nonpositive
identities and blank action/resource types are refused. Audit redaction stays in
`audit.ts`; SQL storage does not turn arbitrary input into safe audit content.

A native temporary row-free model checks exact columns, types, nullability,
defaults, identity, CHECKs, PK, tenant FK, indexes and identity-sequence options.
An existing incompatible table, policy or user trigger refuses atomically; it is
never repaired or silently replaced. Both maintained audit and fraud migrations
also reject nonowner table/column ACL entries before their own COMMIT, including
operator default privileges inherited by first creation. Audit additionally
checks its identity sequence ACL. RLS does not govern TRUNCATE/TRIGGER or sequence
authority, so a later permission-file refusal is insufficient. Checks expand
ACL entries with aclexplode/coalesced acldefault; they never revoke or repair
foreign ACLs. New audit storage enables and forces RLS
with **no policies**. It grants no runtime access. The migration is idempotent
only before the separate permission contract introduces its intentional policies.
It is not a general post-permission schema verifier.

Both audit SQL files require explicit database/schema and `expected_server_major`
pins (16 or 17, actual must match), READ COMMITTED/origin sessions, ordinary
persistent relation identities and no event triggers. They own BEGIN/COMMIT with
5s lock and 30s statement limits. Run whole files on a fresh idle operator
connection: an enclosing caller transaction is forbidden and is not automatically
detected. Native PG17 rehearsal can establish PG17 behavior only; it cannot
qualify production PG16. Production requires fresh exact PG16 compatibility proof.

## One fixed-tenant service principal

`audit-runtime-permissions.sql` requires a positive fixed tenant and exact names
**and OIDs** of two existing distinct roles: a LOGIN runtime and a NOLOGIN helper
owner. Both must be NOSUPERUSER, NOBYPASSRLS, NOINHERIT, NOCREATEDB, NOCREATEROLE,
NOREPLICATION, have no members/memberships, own no existing object, and have no
unreviewed ambient application table/column/sequence/schema-create or definer
function authority (including PUBLIC-derived rights). Unknown ACL/RLS/helper
state refuses; no foreign role, policy, privilege or function is repaired.

The operator must first independently bind successful exact maintained fraud and
audit ABI migrations, their source bytes and actual relation/sequence OIDs. The
permission file locks those pinned objects and parent relations and makes extra
writable-shape/default/identity/ACL checks. These narrower checks do not replace
the full maintained ABI evidence. Required `phone11.*` settings are operator
inputs during preparation only. Generated policies contain immutable tenant and
session-user literals and target the selected role OID. Runtime-writable GUCs are
never tenant or actor authentication. Both session_user and current_user must be
the selected login; SET ROLE is not genuine login proof.

Runtime receives schema USAGE; SELECT on its RLS-filtered fraud row; INSERT only
on tenant_id/international_enabled/premium_rate_enabled; UPDATE only on those two
flags and updated_at; audit INSERT on the eleven actual supplied columns; USAGE
only on the audit identity sequence; and EXECUTE only on the lock helper. There is
no runtime audit SELECT/UPDATE/DELETE/TRUNCATE, manual id/created_at insertion,
financial/alert/geo update, parent membership/tenant UPDATE, helper ownership or
helper-owner membership. Sequence USAGE permits allocation/currval, not setval.
Other existing ten-field API writes are outside this role's two-control contract.
The audit policy accepts only fixed-tenant `update` / `fraud_controls` entries
with matching resource id and a current active admin/owner actor. No audit read
policy is created; existing audit-log pages need their own qualified contract.

## Live lock helper and explicit trust boundary

The fixed helper is SECURITY DEFINER, VOLATILE, STRICT and PARALLEL UNSAFE. Its
search_path is exactly pg_catalog,pg_temp, and every application table is schema
qualified. Its fixed static body verifies the original session login, accepts
only a positive actor id, selects exactly one active admin/owner membership in the
literal tenant joined to an active tenant, and takes the same FOR UPDATE locks
on membership and tenant through transaction completion. Missing/duplicate actor
rows refuse. It contains no dynamic SQL, DML, GUC identity, or unrestricted
callback. PUBLIC EXECUTE is revoked in the creation transaction; only the fixed
runtime login is granted EXECUTE. Any preexisting overload/name refuses; no
CREATE OR REPLACE is used. Owner/config/language/signature/ACL and full body SHA256
are checked before commit; freeze the selected literal body/hash again for actual
runtime qualification. Runtime cannot alter the function or its schema.

The separate NOLOGIN owner gets only schema USAGE, SELECT on the queried parent
columns, and UPDATE(id) on tenants plus UPDATE(user_id) on tenant_memberships,
because PostgreSQL row locking requires UPDATE on at least one column. **These
key-update privileges are security-sensitive.** They are confined to a no-member,
NOLOGIN definer owner; the body never updates a key, role or status. There is no
claim that these are harmless or that runtime receives them.

Actor id is explicitly authenticated by the backend, not by PostgreSQL. A runtime
service login can supply the id of an active administrator in its fixed tenant;
the helper verifies current authority and holds locks but does not establish who
signed into the application. Fraud row writes do not independently require an
audit row at database level: the existing leased strict-audit application
transaction provides that atomicity. This contract does not protect against a
compromised trusted backend within its fixed tenant or an operator/superuser.

## Concrete application integration still missing

`db.ts` currently uses one shared pool. `withPbxMutation` forces tenant/actor into
the audit parameters but establishes no database principal. Its live admin lock
currently queries parents directly, which this runtime deliberately cannot do.
Do not switch the existing pool to this login or claim current handlers run under
these permissions.

The remaining source integration must route only the selected fixed tenant's
flag GET and flag mutation to a dedicated pool whose actual session_user is this
login, reject any other selected tenant before dispatch, retain the existing
backend authentication/current admin checks, replace the direct commit lock in
that narrowly routed transaction with the pinned helper, and keep supplied flag
DML plus strict audit on that same leased client. Unrelated handlers stay outside
this contract. The broad API may not silently fall back to a privileged pool
when restricted DML or audit is denied. No router/db integration was authored in
this packet. That is an engineering dependency, not a new permission prompt.

## Prepared evidence and remaining release prerequisites

Offline source/contract tests and disposable native migration/runtime tests are
prepared only. Native fixtures require PHONE11_PBX_TEST_DATABASE_URL for the
explicit loopback phone11_pbx_test database with a port. They create generated
schema/roles, use a separate authenticated nonsuperuser/nonbypass LOGIN for all
runtime assertions, test forged GUC/cross-tenant denials, denied parent UPDATE,
append-only audit, live membership locks and rollback on audit denial. Operator
setup authority is not runtime acceptance. They start no server/container.
At most four connections are needed; an eight-connection isolated cluster cap is
sufficient. No test, SQL, database or process operation was run by this author.

Before production use: independent exact-source review; actual version-qualified
native checks; dedicated pool/lock integration and actual-handler restricted-role
proof; fresh authenticated target/schema/ABI/source/receipt custody; fresh
protected backup and isolated recoverability/rehearsal for the exact fraud+audit
forward delta; and Root's action-time release qualification. Old clone-only audit
source is not promoted, old consumed capture/clone operations are not replayed,
and PG17/source/superuser success is not PG16 restricted-runtime acceptance.
No provider, device, Android, calling, budget/currency enforcement, deployment or
production action is established by this packet.
