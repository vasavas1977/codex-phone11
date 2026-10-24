# Retained HTTP library — source only

This is the maintained integration of the independently reviewed operational bound-v2 candidate, artifact SHA256 `82ddacbb272d4989bcf9ab602a54d96d31571a2902d9b1c8936e83170264d8e9`. `bound.ts` and `composition.ts` are exact source copies. `PROVENANCE.json` records their hashes; `SOURCE-PINS.json` binds the35 local source inputs. The local build changes only repository-relative resolution/output paths. It emits no committed runtime artifact and never listens or starts workers.

From the repository root:

```sh
node scripts/phone11-retained-runtime/build.mjs
node --test scripts/phone11-retained-runtime/test_bound.cjs
```

The artifact and build manifest are written under ignored `.cache/phone11-retained-runtime/`. A source-input change requires deliberate pin/review updates; the builder does not silently bless new inputs. No runtime configuration, secret, live database, provider or recording file is read by the build. Tests use synthetic input, inert external PG/BetterAuth constructors and loopback HTTP. They prove configuration/module-graph/route/lifecycle wiring, not actual SQL, authentication, TLS or storage acceptance.

`createBoundRetainedRuntime(privateBinding)` validates explicit production HTTPS auth values, discrete verified-TLS database binding and absolute recording/chat roots. It refuses conflicting existing auth/storage settings and excluded mailer configuration. It binds `configureOwnedPbxPool` before any getter and before dynamic storage/router evaluation. Auth `/me`, the media SDK, playback and transactions use the same maintained `getPhone11Auth`/`getPool` graph; arbitrary unrelated auth/pool injection is not public. Setup is single-attempt and terminal on failure. Private environment drift/closure causes503 before admitted handlers. Close uses the same terminal owned-pool promise; maintained HTTP shutdown drains before calling it. A close rejection remains unconfirmed cleanup.

Only canonical session/me/readiness/signout, six wake actions, chat-media upload/read and recording playback are admitted. Full tRPC/admin, sign-in/reset/mobile-config, native CDR, FS/Kam callbacks, recording/voicemail ingestion, voicemail retrieval, profile/photo, websocket and background workers are excluded. `/api/auth/get-session` remains404, matching both maintained and captured legacy HTTP gates; programmatic BetterAuth getSession remains internal. Caller/owner/tenant/cookie/replay/expiry/file predicates are unchanged. There is no CLI/serve/start API, listener, readiness claim, migration or provider startup.

Before any real listener, separately qualify actual restricted role/ACL/schema/TLS identity, current consumer/ingress selection, storage inode/mount/UID authority, real installed auth behavior and exact permitted SQL. Media workspace FOR SHARE still needs a deliberately qualified narrow lock-column contract; no broad business UPDATE, sequences, DDL, ownership, RLS bypass or production grants follow. Prior clone-only assigned-authority proof used UPDATE(id) on user_extensions/extensions/tenants and UPDATE(created_at) on tenant_memberships; it does not grant that direct-write capability in production. Wake has service-owned lock/write/provider requirements, and actual pilot/SIP/capture/provider flags remain unqualified.

The same-graph pool ownership seam does not prove every resource is drained. Actual wake offers may create APNS sessions and late cancellation work; disconnected async work is not settled merely because HTTP closes. The local source graph has no Redis import or configured Redis auth storage, but external runtime/resource behavior still needs exact-image qualification. This library does not retire old3000, change its login, fence duplicate workers, prove reboot recovery or establish provider/device acceptance. Trial60 and Android/phone deferrals remain.
