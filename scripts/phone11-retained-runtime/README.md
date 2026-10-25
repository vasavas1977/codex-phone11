# Retained HTTP receiver — source candidate

`listener.ts` is an explicit, workerless HTTP entrypoint over the maintained same-pool binding and route factories. Importing or building never listens, reads private input, installs signals, starts workers, sends push, migrates a database or changes production. A host must explicitly call `createRetainedApiListener(privateBinding).start()` and arrange signals/supervision to call its terminal `close()`. There is no automatic CLI or environment-secret loader.

Run from the repository root:

```sh
node scripts/phone11-retained-runtime/build.mjs
node scripts/phone11-retained-runtime/build.mjs --listener
node --test scripts/phone11-retained-runtime/test_bound.cjs scripts/phone11-retained-runtime/test_listener.cjs
node node_modules/typescript/bin/tsc -p scripts/phone11-retained-runtime/tsconfig.check.json --pretty false
```

Both outputs and manifests live only under ignored `.cache/phone11-retained-runtime/`. `SOURCE-PINS.json` pins35 bound inputs and36 listener inputs; a changed source refuses until reviewed pins are deliberately updated. Both graphs contain exactly one maintained `server/pbx/db.ts`, with no global backend index, full tRPC router or ESL bootstrap. `PROVENANCE.json` preserves the original82dd source acceptance; its unchanged-copy descriptions are historical, not descriptions of the current profile/listener changes.

## Explicit bindings

The listener requires a copied private input with these fields. There are no production defaults for role, OIDs, address, port, credential, storage or pilots:

- `host`: numeric IPv4/IPv6 bind address; `port`: exact1–65535, with no available-port fallback. Proxy trust remainsfalse. Exact ingress/CIDRs are a separate deployment binding.
- `runtime.database`: maintained strict discrete host/port/database/user/password/CA PEM binding. It ignores ambient database URLs/options, requires verified TLS/SAN and fixes the client/server deadlines/search path/application name. Connection timeout5s; query/statement10s; lock3s; idle transaction15s; max4.
- `runtime.databaseAuthority`: independently established role OID, database OID, client/server IPs and server port. The actual owned pool leases a connection before returning any app and requires16 exacttrue identity/TLS/settings/selected escalation predicates. Missing/NULL/extra/ambiguous rows refuse. Successful leases release; failed leases discard. This is not an exact table/column/sequence/function/RLS grant proof or continuous attestation.
- `runtime.auth`: explicit production HTTPS baseURL, secret and trustedOrigins. Conflicting existing auth/storage configuration and enabled password-reset mailer inputs refuse.
- `runtime.recordingsPath` and `runtime.chatMediaPath`: normalized absolute roots, never defaulted. `storage.recordings` and `storage.chatMedia` each supply exact device/inode/UID/GID/mode0700. The UID/GID must match the actual process. Startup opens each directory without following the leaf symlink, holds its FD, and compares fstat/lstat identity before connecting/listening. It enumerates no entries and reads no customer files. This is startup leaf-metadata proof only: ancestor/mount immutability, later path replacement, ACL write authority and exact deployed bind definitions require separate custody/admission. Both roots are required even for the smaller profile, so later expansion cannot silently change bindings.
- Optional `shutdownTimeoutMs`:1–30000, default30000, bounds each startup-settlement/resource-close phase. Deployment supervision must reserve these phase budgets; no library promises an unconditional process exit.

`runtime.profile` is copied before asynchronous setup and defaults to `auth-playback`. That profile admits GET/HEAD `/api/auth/me`, `/api/ready/auth`, `/api/recordings/play/:id`, POST `/api/auth/sign-out`, and OPTIONS for those same paths. Chat and all wake paths404 before CORS/parsing/auth/business getters. It explicitly binds wake disabled and refuses ambient pilot/push/APNS settings rather than borrowing them.

The named `retained-full` profile additionally admits POST `/api/chat/media/upload`, GET/HEAD `/api/chat/media/:id`, and POST `/api/phone11/wake/{claim,ready,status,end,offer,terminal}` (plus path-scoped OPTIONS). It requires all of:

```text
runtime.wake.pilotSipUris       1–2 unique maintained wakeOfferSchema SIP URIs
runtime.wake.pushSharedSecret  maintained integration-secret validation, max4096
runtime.wake.apns.keyPath      explicit normalized absolute private key path
runtime.wake.apns.keyId        maintained10-character key identifier
runtime.wake.apns.teamId       maintained10-character team identifier
runtime.wake.apns.bundleId     maintained dot-separated bundle identifier
runtime.wake.apns.environment  production or sandbox
```

These install only the exact PHONE11_WAKE_ENABLED/plural pilot/PUSH_SHARED_SECRET/APNS values before dynamic router evaluation. Singular pilot/other conflicting selected values refuse. Actual maintained wake/APNS/integration-secret validators run before app return; no key content is read or notification sent by setup. Key custody, valid key material, pilot enrollment and provider/device delivery remain distinct runtime acceptance. The selected values are copied; subsequent input mutation cannot change them. Selected environment drift/closure gives503 before business handlers. Native3018 remains a separate deployed owner; this source does not redirect it.

## Compatibility and exclusions

After startup, both profiles serve GET/HEAD `/health` and `/api/health`200 (liveness, not continuous DB readiness), `/api/ws/status`503, and `/manus-storage/*`503/no-store. `/api/oauth/*`, `/api/auth/session` and `/api/auth/logout` return410 without SQL. No websocket is started. `/api/auth/get-session` deliberately remains404, matching maintained/captured HTTP gates; BetterAuth's internal programmatic getSession is unchanged.

Sign-in/reset/mobile-config, full tRPC/admin, FS/Kam callbacks/DID, native CDR, recording upload, all voicemail routes and profile/photo remain404 here. Their specialized receivers/current disposition must be preserved at ingress. Registered unused maintained handlers remain behind the exact method/path/profile gate. No extra permissions follow from those dormant handlers. Current chat/workspace/owner/replay/expiry/file predicates and wake provider/tenant predicates are unchanged.

## Startup and terminal drain

`start()` returns the same pending promise, and reports LISTENING only after directory checks, actual owned-pool attestation and successful exact socket bind. Closing sets terminal admission immediately. Checks after every startup await and a Node listen AbortSignal prevent late listen after close, including a pending bind. Port conflict, wrong authority and failed setup refuse without another start attempt. A copy of input prevents caller mutation races. HTTP parser/keepalive/header bounds are explicit; there is no port scanning/fallback.

`close()` returns one terminal promise. It first waits the actual startup work to settle, then uses the maintained `createPhone11Shutdown` HTTP-first drain, the private owned wake instance's drain, and the same graph's terminal PG closer. Held directory FDs close after confirmed resource closure. Pending auth/media HTTP is drained normally; a timeout is not proof that arbitrary disconnected work settled. The owned wake drain separately tracks underlying operations and late offer-to-cancel chains, fences new work and aborts only owned controllers. Failed cancellation/persistence or an ignored deadline retains uncertainty/pool rather than claiming cleanup. A later settlement never turns a rejected close into success. A host must retain/reconcile uncertain resources and exact process state; it must not blindly retry or revoke a credential based on a rejected close.

The32 focused tests use actual local directories/sockets/routes/lifecycle and inert external PG/BetterAuth transports, plus narrow builtin wait injection to expose races. They cover default/full gates, config refusal/drift/copy, shared pool identity/refusal/close, storage mismatch/symlink, close during storage/readiness/listen, port conflict, active HTTP drain, terminal close and ignored-dependency uncertainty. They do not establish actual PostgreSQL/provider/storage-write acceptance.

## Qualification and cutover limits

Historical82dd PG16 receipts apply to that old artifact. Later733a passed actual isolated PG16 same-pool identity/settings, wrong-expectation refusal, auth/session/playback,16 denials/TLS negatives and cleanup at06:27 UTC (`PBX-SAME-POOL-RETAINED-PG16-20261025-v1.json`). Corrected owned-wake-drain artifactba997 passed the same narrow auth/playback/idle-close scope at06:51 UTC (`PBX-SAME-POOL-RETAINED-PG16-20261025-v3.json`), with unchanged protected production identities. These receipts do not qualify this new profile/listener artifact. Prior chat/wake isolated artifacts likewise are not a combined proof for the current full graph.

Next exact executable acceptance is a fresh isolated PG16/image run of this listener with independent role/OID/address expectations, actual auth/session/playback plus full-profile chat/wake persistence and active-drain cases using inert provider transport, exact narrow grant matrix and owned synthetic filesystem. Do not grant broad business UPDATE merely to satisfy old FOR SHARE; use the separately qualified narrow service-owned lock columns. Then bind actual role/CA/HBA/network/port/root/key/private config and source custody, qualify health/negative auth/owned storage, and move only the explicit matching ingress. No production values or role grants are selected by this source.

Retiring old3000 also requires the independent DID caller/receiver convergence, dispositions for remaining callbacks/photo fallbacks, and a controlled worker takeover. The old actor still owns capture/AI/retention/chat/ESL consumers; a new workerless HTTP listener cannot retire its credential. Fence and stop the exact old actor, prove absence/reconcile in-flight/leases/unknown effects, then admit one replacement worker owner without duplication. Other services sharing an elevated role must be attributed separately before any shared-role revocation. No source acceptance here claims production retirement, provider acceptance, cold boot, real calls, Android or physical-phone acceptance. Trial60 and device deferrals remain unchanged.
