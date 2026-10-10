# Manual PBX database observation

`pbx.databaseReadiness` samples one connection checked out from the application's
existing PBX pool. The only input is a strict positive `tenantId`; current active
workspace owner/admin authority is required. It reports catalog privilege
booleans, not customer rows, database role names or connection configuration.
There is no UI, polling, provider call, schema change or privilege grant.

Use an **unbatched GET** with `x-phone11-read-only-probe: 1` and existing
authenticated session custody. The HTTP guard rejects missing headers, POST
and mixed/batched requests before authentication context is created. Existing
read-only authentication suppresses session renewal/deletion and database rate
limit writes. Other routes retain their existing request semantics.

The deployment must explicitly commission the nonsecret server-side value
`PHONE11_PBX_READINESS_EXPECTED_SERVER_ADDRESS` from reviewed current local
Postgres container/network custody. Absent/invalid configuration returns
`NOT_COMMISSIONED` after bounded fresh selected-tenant admin authorization; no
catalog query runs in that case. There is no invented address or request override. The fixed
expected target is database `phone11ai`, OID `16384`, PostgreSQL version `160013`,
TCP port `5432`, and schema `public`. Address changes or PostgreSQL upgrades
require a reviewed new binding/source; a mismatch never grants admission.

The helper bounds checkout to five seconds and total operation to 45 seconds.
Strict tenant input and authenticated user enter the helper directly; the route
does not await a separate unbounded shared-pool membership query. The helper
rechecks live selected-tenant authority after checkout, executes one fixed
catalog SELECT inside REPEATABLE READ READ ONLY with local lock/statement/idle
timeouts, rolls back, then rechecks authority in a fresh autocommit snapshot
before releasing the client and returning metadata. Revocation at either check
discards the observation. These checks provide a final authorization point;
they do not hold membership locks through network delivery. Timed-out, broken
or late-arriving clients are discarded; the shared pool is never shut down.

Session authorization is compared internally to the borrowed driver's startup
user. An unverified or changed session authorization refuses identity admission.
`roleIsLogin=false` honestly reports a different current role (for example SET
ROLE). Powerful role flags are returned truthfully and are never labeled a
restricted runtime. Results describe only the sampled app-owned connection,
which may be newly opened from the existing pool configuration. They do not
prove all existing pooled sessions, other writers, tenant isolation, migration
readiness or rollback acceptance. No environment/DSN/password reconstruction,
app startup import or new credential connection is performed.

Shared PBX pool/query failure logging now uses constant events while preserving
error propagation and pool behavior. Diagnostic failures expose constant
statuses only; original errors, causes, stacks, SQL and parameters are not
returned or deliberately logged by the diagnostic. Catalog/table outputs are
strict boolean allowlists and no response is cached.

This is a source candidate rooted at `237983ee`. The old active3023/retained3022
API bundles do not contain this route. No current deployment, runtime probe,
PostgreSQL execution, provider or device acceptance is claimed. Focused mocked
tests cover guards, revocation, transaction order, late checkout, timeout,
decoder failures and logging privacy. Disposable PostgreSQL verification and
independent source/release review remain necessary before runtime acceptance.
