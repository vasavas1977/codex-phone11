# Isolated management-policy API candidate

The dedicated `server/_core/policy-management-entry.ts` exposes only the existing
`pbx.capabilities`, `pbx.fraudControls.get`, and `pbx.fraudControls.update`
procedures. It reuses the actual authentication context, CORS, live selected
administrator checks, fixed-role helper, atomic audit and restricted adapter.
Capabilities deliberately omit explicitTenantReads/explicitDidRouteDirectories
because their dependent procedures still run on the legacy public API.

Build separately with esbuild (Node, external packages, ESM). Startup requires
`NODE_ENV=production`, `PHONE11_RUNTIME_ROLE=api-policy`, immutable
`PHONE11_BUILD_SHA`, explicit `PHONE11_POLICY_PORT` and
`PHONE11_POLICY_LISTEN_HOST` (`127.0.0.1` or container `0.0.0.0`), existing auth
and membership/schema configuration, and the complete dedicated
`PHONE11_FRAUD_*` binding. No dotenv, migrations, jobs or provider callbacks run.
No CLI argument gives inert UNBOUND; the explicit operation flag is
`--serve-policy-management-v1`. Restricted DB identity is attested before listen.

Preferred deployment is the existing database container network with host port
published only on 127.0.0.1. Container0.0.0.0 is not authority to publish a host
public port. Secret projection/custody, complete current DB pins, shared-role
capacity, TLS host resolution and HBA eligibility require a reviewed operator
receipt. Never mount the whole protected-outbound startup or export credentials.
A source build does not commission that public binding.

The client sends exactly these three paths through httpLink, preserving normal
batching elsewhere. The gateway rejects batches, encoded/noncanonical paths,
unknown query parameters, wrong methods, compressed/oversized/non-JSON updates,
and cookie-authenticated writes without trusted Origin, before authentication.
Native bearer authentication keeps the established no-cookie-fallback boundary.
The gateway emits X-Phone11-Policy-Candidate with its immutable build marker.

An edge change must intercept or deny managed procedures in **every batch
position**, including encoded variants, so none reaches legacy fraud DML.
Three exact locations alone do not satisfy this contract; the existing
`^~ /api/trpc/` prefix also defeats sibling regex locations. Preserve unrelated
canonical procedures/batches on the existing upstream. Route construction,
normalization tests, action-time pins, guarded activation and exact rollback
remain separate operator work. Do not replay historical3016 route scripts.

Request transport is bounded by header/body/connection limits and socket
timeouts; transport disconnection does not prove a DB transaction aborted.
Shutdown drains HTTP and the policy pool, with a finite CLI deadline. A failed
startup closes its owned policy pool and never reports BOUND. No phone, carrier,
reboot or device acceptance follows from these source checks. Trial60s and
Android/phone testing remain owner-deferred.
