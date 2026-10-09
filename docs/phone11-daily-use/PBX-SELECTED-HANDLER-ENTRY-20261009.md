# Selected clone-handler entry (source preparation)

This candidate adds a single-use entry for four internal calls: `IVR_CREATE`,
`IVR_LIST`, `PROVISION_CREATE`, and `PROVISION_ASSIGN`. It is **not executable
admission**. Build and synthetic-fixture admission literals are null, and the
unchanged real-pg adapter separately refuses `EXECUTION_UNBOUND`. Neither
valid-shaped JSON nor caller-supplied hashes authenticate these admissions.
The current entry refuses before any product-module or driver import.

## Authentic selected code

After a future reviewed admission, the entry dynamically loads the literal
`server/pbx/ivr-router.ts` root and uses its actual `ivrRouter.createCaller` for
IVR calls, or loads `server/phone-provisioning.ts` and invokes its actual helpers.
The private input requires positive int4 actor/tenant/assignee/extension IDs;
provisioning always receives `actorUserId`. Thus the selected provisioning lane
does not run the actorless schema initializer. The context is a synthetic
internal identity, not HTTP/JWT authentication. The actual protected middleware,
transaction-held membership/role checks, capability reads, SQL, audit wrapper,
and SIP crypto remain in the selected graph. Their answers are not mocked.

The source contract pins the ten assessed files at product source
`f2fa504dbad22d0966b9f1d43dae86865ef80158`. The unchanged adapter retains its
historical product admission pin `cd2b317c01d27ee472dca969a097133bd8968464`;
this candidate does not silently rebind that admission or authorize software.

## Two explicit resource aliases

A future reviewed bundle must resolve **only** the selected graph's
`server/pbx/db.ts` imports to `selected-resource-bridge.ts`, and its `ioredis`
import (only from `server/pbx/redis.ts`) to that bridge's default transport.
The real `server/pbx/redis.ts` wrapper remains compiled. The bridge's DB exports
forward queries, values, results, and transaction callbacks to the genuine
admitted adapter; it does not supply a default pool or implement replacement SQL.
The adapter retains its connection/query/transaction/lifetime/close deadlines
and commit/rollback/error behavior.

The Redis alias is a bounded private-memory transport, not external Redis:
64 keys, 16 KiB values, 300-second TTL, numeric tenant-membership and IVR keys,
and IVR-only invalidation patterns. It has no socket/retry/network events.
It implements only the cache/invalidation operations used by these selected
lanes; rate limiting/idempotency and other router facilities are unsupported.
External invalidation, cross-process cache behavior and real Redis availability
remain unexercised. Wrapper cache misses still execute their real SQL callback;
no membership, authorization, capability or business result is fabricated.

Private synthetic SIP/Redis environment values are installed only after real
adapter admission. Existing SIP/Redis key names cause refusal without reading
their values. The synthetic domain is `clone.phone11.invalid`; crypto uses a
public clone-only synthetic DEK, never an existing application key. The adapter
independently rejects ambient DB/PG configuration. The entry suppresses the
selected wrappers' diagnostic console calls during its one isolated call and
restores them afterward; it has no startup/CLI/stdout behavior. Only fixed
status fields and allowlisted error codes are returned. Rows, plaintext SIP
material, context, SQL, error messages/details/stacks and raw results are not
returned. `CALL_COMPLETED` means only that the selected call returned and the
adapter closed; it does not validate result/audit persistence or grant acceptance.
Cancellation retires the bridge; finalization closes the adapter and removes
only the synthetic environment keys installed by this entry. Container cleanup
and opaque recovery custody still belong to the separately reviewed custodian.

## Validation and next action

From this checkout, the offline suite also performs an in-memory esbuild
compile, using explicit aliases and checking source pins/metafile/external
imports. It never evaluates the product modules, pg driver, or compiled bundle:

```sh
./node_modules/.bin/vitest run tests/phone11-pbx-clone-selected-handler-entry.test.ts
```

The compile retains nine authentic product files (the tenth, DB, is aliased)
plus entry/bridge/adapter, with only `@trpc/server`, `zod`, `superjson`, `crypto`
and lazy `pg` external imports. It excludes full appRouter, PBX router, context
SDK, profile codecs, auth startup, CDR/Gemini/provider modules and the adapter's
test factory. Injected bridge tests are unit tests, not real handler/driver proof.

Next source work is a reviewed isolated-worker bundle/custodian binding and
synthetic fixture assertions, followed by genuine Linux x64 Node/driver/image,
restricted LOGIN, private socket, rollback and lifecycle admission. A caller
cannot bind these by editing JSON; current source must stay disabled until that
reviewed revision. No worker/image/container/SQL/handler was executed here.

Full legacy phone RPC/Zod validation, PBX router, actorless/fresh/partial
initialization, HTTP/JWT authentication, actual rollback artifact execution,
external Redis and production application-principal proof are not exposed or
proved. A successful future selected call cannot replace those gates or the
existing schema/recovery, provider, SIP license, signing or device acceptance.
