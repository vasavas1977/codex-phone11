# Phone11 extension tenant prerequisite: source and operator gate

The 30 September 2026 read-only catalog of the actual PBX target showed four
extensions, no NULL `tenant_id`, no extension tenant foreign key, and a nullable
integer `tenant_id` with `DEFAULT 1`. Both `tenants.id` and `extensions.id` are
integer primary keys. The existing PBX preflight correctly reports
`incompatible` because `extensions.tenant_id` is nullable. Zero NULL rows do
not repair that contract.

`server/pbx/extension-tenant-prerequisites.sql` is an explicit, operator-only
transaction for the narrower nullable/no-FK/no-default shape. It requires
session settings `phone11.expected_database` and `phone11.expected_schema` to
match the connected database and current schema. It qualifies table names with
the reviewed schema, uses a five-second lock timeout and 30-second statement
timeout, locks both source tables, verifies ordinary tables, integer columns,
primary keys, no `tenant_id` default, and no conflicting tenant FK, then checks
for NULL or orphaned assignments before DDL. It sets `tenant_id` NOT NULL and
adds and validates `phone11_extensions_tenant_fk`; an exact validated replay
does no DDL. It creates no assignments, grants, roles, defaults, or data.

**This SQL must not be applied to the actual target yet.** Its no-default guard
deliberately rejects the observed `DEFAULT 1`. The checked-in candidate's two
extension creation paths pass explicit `tenant_id`, and its legacy schema
initializer does not restore a dropped default on an existing column. That
does not establish every currently deployed or external DB writer. A subsequent
read-only audit of the exact running 3016 bundle found two literal extension
INSERT column lists, both specifying `tenant_id`, and no literal positional
INSERT/COPY. The live activity and effective-role inventory still showed a
shared superuser login and did not establish writer completeness. Retaining
`DEFAULT 1` while marking the prerequisite ready could
silently assign an omitted-tenant insert to tenant 1; dropping it could break
an unknown predecessor writer or rollback path. Review the exact 3016 image,
all extension writers, and rollback compatibility first. If removal is safe,
review an amended transaction that recognizes exactly `DEFAULT 1`, drops it
inside the same bounded transaction, and tests that actual shape on a protected
clone. Do not bypass the guard or weaken preflight.

Before any operator run, independently pin the intended database, schema,
server, migration file digest, operator role, backup, and active application
image. Verify the absence of NULL/orphaned extension tenants and inspect table,
column, sequence, schema, and default ACLs plus runtime-role access without
printing credentials. Confirm the operator can alter the target tables and
the app role will retain its existing access. No blanket grants or default-ACL
changes belong in this prerequisite. Apply only from an approved secure session
with the two exact session settings; never from application startup. Save
preflight and catalog readback before and after. A lock timeout or guard failure
means rollback and investigation, not a blind retry.

The next advanced-routing migration remains a separate gate. It also requires
the exact `phone11.expected_database` and `phone11.expected_schema` session
settings, checks that ordinary `tenants` and `extensions` tables exist in that
schema, and pins its transaction-local search path with `pg_temp` last. Its
member triggers check the final inserted or updated row and lock its referenced
extension while checking the parent tenant. Its extension update trigger
refuses tenant moves for an extension with
ring-group or queue membership. These guards serialize concurrent member
insertion and extension movement in either order under READ COMMITTED. An
extension tenant move in REPEATABLE READ or SERIALIZABLE is refused, even for
a nonmember, because an older snapshot could miss a newly committed member.
Existing memberships on soft-deleted extensions remain on replay, while new
membership on a deleted extension is refused. After installing all guards and
holding their DDL locks, the migration refuses existing cross-tenant or orphaned
member rows on replay. The read-only preflight checks the guards' enabled
catalog wiring, unrestricted update events, exact tenant-change predicate,
volatility, pinned function search path, and same-schema validated foreign keys,
but cannot prove a function body has not been changed. Review exact trigger
function definitions separately before commissioning. Review the
app role's explicit privileges on the nine new tables and their serial
sequences; a compatible schema alone does not prove usable or safe tenant ACLs.
Rehearse the prerequisite and advanced migration in order against a protected
clone of the actual schema, then separately verify authenticated two-tenant
authorization, routing, provider, and handset behavior. Keep additive schema
on application rollback; dropping populated routing tables needs a separate
reviewed recovery.

The isolated PostgreSQL prerequisite test uses only a random schema in the
dedicated loopback `phone11_pbx_test` database. It covers success and replay
for the no-default fixture, NULL/orphaned-row refusal, wrong target pins,
incompatible and partial catalog states, the observed `DEFAULT 1` refusal,
and lock-contention rollback. It does not establish hosted DB readiness.
