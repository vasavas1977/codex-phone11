# Fixed-tenant outbound-policy API integration

## Current commissioning state (18 October 2026)

Production PostgreSQL TLS was enabled and verified with certificate and host
validation. The new audit/fraud storage, separate policy and identity LOGINs,
NOLOGIN helper, restricted grants and new-role-only TLS/SCRAM HBA rules were
installed. Fresh credentials were committed in protected server custody.
The subsequent Node login/adapter proof refused without a precise failure
stage. This is a partial committed state: do not replay provisioning, recreate
the vault, reset passwords or change HBA rules to retry it. A separately
reviewed read-only diagnostic must qualify the existing state first.

The serving backend and protected outbound route remain unchanged. The detached
canonical identity executor and raw HTTP owner have not been commissioned as
production ingress. Android and physical-phone tests remain deferred.

The current source passed full TypeScript, the backend bundle, 448 focused
core/identity/adapter/shutdown tests, 85 admin UI/revocation tests, and 67 genuine
generated PostgreSQL 16.13 storage/API/HTTP cases. These checks are distinct
from the pending live LOGIN, relay, serving API and carrier acceptance.

## API behavior

The fraud GET/update handlers use a dedicated restricted LOGIN, not the shared
PBX connection. Existing admission still resolves the authenticated user's
selected workspace and checks current administrator authority. Within the
dedicated transaction, `phone11_lock_fixed_fraud_admin(actor_id)` rechecks and
locks authority through read or write commit. The two-flag upsert and required
audit insertion share the same client. Database, identity, commit and cleanup
failures do not fall back to a more privileged connection.

Only `internationalEnabled` and `premiumRateEnabled` are writable. Unsupported
limit/geo/alert fields, unknown fields, and empty updates fail. Other retained
columns remain readable; this change does not implement spending enforcement,
trunks, IVR, queue routing, or emergency calling changes.

## Configuration and commissioning

Configure these dedicated server-only `PHONE11_FRAUD_` variables together from a
reviewed operator permission receipt. No value is inferred from `PG_*`, a shared
database URL, tenant selection in the browser, or writable session GUCs.

| Suffix | Source / meaning |
| --- | --- |
| HOST, PORT, DATABASE | Exact reviewed server and explicit database/port |
| USER, PASSWORD | Separately custodied restricted LOGIN credentials |
| TENANT_ID | One fixed positive tenant ID; other selected tenants refuse |
| SCHEMA, SCHEMA_OID | Reviewed namespace name and OID |
| ROLE_OID | OID of the exact LOGIN |
| HELPER_OID, HELPER_OWNER, HELPER_OWNER_OID | Exact helper identity and separate NOLOGIN owner |
| HELPER_SHA256 | SHA256 of the helper `prosrc`, issued together with tenant/login pins |
| SERVER_MAJOR | Reviewed PostgreSQL major, currently 16 or 17 |
| FRAUD_OID, AUDIT_OID, AUDIT_SEQUENCE_OID | Exact maintained relation/identity-sequence OIDs |
| TLS_CA_PEM (optional) | Trusted CA addition; peer verification remains required |

Names use the adapter's strict lower-case identifier syntax. Keep credentials in
the existing protected server custody mechanism, never browser code, command
arguments, reports or Git. Configuration is latched at startup. Any change
fails closed until a drained `closeFraudPolicyPool()` or process restart; do not
rotate credentials during an active operation.

Each lease checks actual session/current login, database, major, principal and
namespace OIDs, safe role/owner authority, exact helper hash/ABI/ACL and the
pinned storage objects. Use an operator DDL/grant freeze while serving this
binding; these checks do not establish an adversarial concurrent privileged-DDL
boundary. The app actor ID is trusted authenticated backend context, not a
separate PostgreSQL end-user login.

TLS verifies both the chain and the configured host explicitly, including IPv4
certificate SANs. A driver's reported hostname cannot redirect that identity
check. This runtime rejects IPv6 literal bindings before opening the pool.
`PHONE11_FRAUD_GENERATED_LAB=1` is permitted only for
the exact generated `127.0.0.1` / `phone11_pbx_test` database and cannot be used
for a production host. Startup options, query/statement/lock/idle transaction
timeouts and a two-connection maximum are explicit. There is no URL option or
ambient `PGOPTIONS` override.

The `explicitFraudControls` capability means selected-tenant protocol and valid
configuration only. The first read still attests the actual connection; a bad
login, missing storage or revoked authority leaves the form unavailable.

## Validation layers

- Adapter tests substitute only the PostgreSQL transport to cover identity,
  configuration, lifecycle, TLS and error behavior.
- Router tests invoke actual callers with fake transport to cover admission,
  selected tenant, flags-only updates, audit rollback and error sanitization.
- `phone11-fraud-policy-native-api.test.ts` invokes the actual API and dynamic
  dialplan handlers and dedicated adapter with a genuine generated restricted
  LOGIN. Membership and SIP-origin transport are supplied by the generated
  operator fixture. Redis/rate limiting, recording/CDR and unrelated dialplan
  integrations are mocked. Fraud DML, the actor-lock helper, strict audit and
  protected dialplan policy reads use the real restricted connection. It
  exercises readback, tenant rejection, failed audit, post-admission revocation
  and no fallback. It also saves flags through the API and invokes the real
  FreeSWITCH callback authentication middleware and handler before returning
  denied/bridge XML. No HTTP listener or carrier is contacted.
- That native suite does not exercise real cookie authentication, network HTTP,
  production PG16, live storage, deployment, PSTN or physical phones. Qualify
  those boundaries separately before claiming production acceptance.

The final generated local run on PostgreSQL **17.11** passed **55/55** tests:
8 runtime-permission, 17 audit-storage, 18 fraud-migration and 12 actual API /
dynamic-dialplan-handler cases. The finite results are retained at
`/private/tmp/p11-policy-v8ze2xah/receipt.json` and
`/private/tmp/p11-policy-v8ze2xah/vitest-result.json`. The receipt records generated
data only, no production access, stable source, successful test/cluster exit and
a stopped owned PostgreSQL child; generated data is retained.

The run binds all **20 source pins** in
`/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/review/pbx-api-integration-20261017-v1/NATIVE-API-MANIFEST-v4.json`,
SHA256 `cd921b76bb78ff0ca4c791a99dbe00e9f99eea55b437399604e867704935e79f`.
The manifest digest and source pins match that historical receipt. The adapter
later received an exact-host TLS identity fix, and a fresh generated PG16 run
passed 67/67 tests against the updated source and new dependency tree. The launcher
has since gained a separately scoped HTTP-authentication test path; the old
manifest does not authorize the changed launcher. Historical receipts remain
immutable, and the new scope requires its own manifest and result.

The current private dependency candidate passes full strict TypeScript, backend
build and **151 affected adapter/API/FreeSWITCH tests**. The real
`@types/react-dom` declaration package resolves the fixture error; existing
locked desktop dependencies are installed separately without scripts or an
Electron binary download. Earlier 503-test evidence remains historical. These source/build results and
generated PG17 results do not qualify production PG16, the live restricted LOGIN,
live commissioning or serving routes.

### Actual HTTP and session-cookie qualification

The separately scoped `phone11-fraud-policy-http.test.ts` passed **12/12** cases
against a newly generated PG17 cluster. Real Better Auth credential sign-in,
session cookies, `createContext`/SDK resolution, HTTP/tRPC guards, selected-tenant
membership SQL and restricted fraud transactions run together. Cases cover
save/readback/audit, missing/tampered/revoked sessions, bearer precedence,
nonadmin/revoked membership, wrong tenant, malformed fields, untrusted Origin
and genuine audit rejection with policy rollback. Only shared DB transport and
unrelated integrations are substituted; no production account, email or provider
is involved. Node HTTP carries the cookies; this is not browser-engine or HTTPS
Secure/SameSite enforcement acceptance.

The finite result is `/private/tmp/p11-policy-0mw59u3l/receipt.json` plus
`vitest-result.json`. Its manifest is the same operator packet's
`HTTP-AUTH-MANIFEST.json`, SHA256
`65bd05101ee8f115b03d9cfae1ce6ee405e3bc378fb7f3b8b4e94fdf5d844d75`:
31 source, six tool and 16 selected dependency-entry pins, not a complete
transitive dependency closure. Source remained stable; the owned Node test
exited, PostgreSQL stopped with exit 0 and the temporary dependency link was
removed. Historical 55-test evidence remains separate and was not rerun.

## Routing deployment remains a separate gate

The dynamic `/api/freeswitch/dialplan` path uses this dedicated adapter for
protected destinations, requiring exactly one matching tenant row and boolean
flags. Missing binding/storage, malformed rows and commit failures deny before
recording metadata or bridge XML. It does not require an administrator actor
helper for a telephony-service read. Domestic/internal/emergency branches do
not acquire this policy lease. Both local Thai `1900xxxxxx` and canonical
`+661900xxxxxx` require premium permission only; either form can be allowed while
international permission is off. International premium destinations such as US
`+1900` require both flags. Ordinary local Thai toll-free routing remains
unsupported.

Some checked-in deployment paths bypass that callback: the production compose
mounts XML-curl configuration with dialplan binding disabled, local outbound XML
can bridge directly, and the separate `deploy/kamailio` configuration can send
PSTN directly to the SBC. These configurations were not changed or activated.
The active server topology must be verified and protected fallback paths fixed
before live enforcement is claimed. Merely enabling XML-curl is insufficient if
its failure falls back to an unguarded local international bridge.
