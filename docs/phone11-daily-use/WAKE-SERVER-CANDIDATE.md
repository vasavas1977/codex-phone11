# Phone11 scoped wake server candidate

This implementation is disabled by default and has not been deployed or accepted on a locked handset. It complements [the native candidate](NATIVE-WAKE-CANDIDATE.md). Apply `server/push/migration.sql` before `server/push/wake-migration.sql` using the reviewed database deployment/backup procedure. No startup DDL runs automatically.

## Protocol

An authenticated, registered iOS phone enrolls through `push.enrollWake`. The exact auth session, owner, tenant, extension, device, push revision and random session binding are retained. The server stores only a hash of the random wake grant. Enrollment expires no later than the auth session or seven days. First pilot supports one live enrolled phone per account; enrollment never silently replaces a different live device.

The trusted proxy posts `{sipUri,sipCallId}` to `/api/phone11/wake/offer` with `x-push-secret`. Both `PHONE11_WAKE_ENABLED=1` and a valid exact `PHONE11_WAKE_PILOT_SIP_URI` are required. A durable pending call is deduplicated and the request waits at most 25 seconds for native registration readiness. APNs submission has one immutable five-second budget and an immediate cancellation signal; delayed database/provider work cannot renew it or start a later push. Device invalidation and acceptance use revision-aware registry updates.

The APNs envelope contains only `{aps:{"content-available":1},v:1,callUUID,bindingId,expiresAt}`. Native POST requests to `claim`, `ready`, `status`, and `end` use `Authorization: Wake <grant>` and `{callUUID,bindingId}` at the fixed HTTPS origin. They have strict schemas, a 4KB JSON limit, no-store responses and generic bounded errors. Grants and SIP credentials must not be logged.

`claim` checks current auth, identity, assignment and exact SIP subscriber, including a final check after waiting for credentials. Its credential/setup deadline is at most 30 seconds and cannot be extended. `ready` after actual native registration releases the proxy's held request; this is registration readiness, not proof of answered audio. During a matched connected call, native heartbeat extends a separate 90-second busy lease. `end` works after setup expiry. Trusted proxy `terminal` records cancelled/ended state; a five-minute tombstone prevents a terminal event arriving before its offer from causing a later ring.

Wake database transactions also bound statements to three seconds, lock waits to two seconds, and idle transactions to five seconds; HTTP timeouts alone do not release a database lock wait. Session, assignment, push and binding locks use a consistent order to avoid logout/token-refresh deadlocks. Same identity/session token updates transfer the binding revision atomically; identity changes/deletion revoke it. Old APNs responses cannot delete a new revision. Removing a grant prevents further credential claims, but cannot revoke a SIP password already obtained; PBX rotation is a separate operation.

Before each new offer, an independent transaction removes at most 1000 expired terminal tombstones and 1000 call rows whose setup expiry is older than 24 hours and which have no live busy lease. Locked rows are skipped. This bounds ongoing growth during traffic; idle rows remain until a later offer or explicit `pruneExpired` maintenance run.

## Deployment and evidence boundaries

Use the existing verified Apple app identity/environment and protected provider key storage. `APNS_KEY_PATH`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_ENVIRONMENT`, and `PUSH_SHARED_SECRET` were absent at the last read-only presence check. No real Apple request or key setup was performed for this candidate.

Do not set the native commissioning flag from an Expo/public runtime toggle. Complete matching proxy hold/resume/cancel integration and signed app/module checks first. Then prove a consenting public-number call while foreground, background, locked and OS-reclaimed, with Answer, clear two-way audio, End and persisted Recents. Reboot-before-first-unlock, caller cancellation, duplicate push, revoked session and network loss remain explicit physical scenarios.

The 41 real PostgreSQL candidate tests cover migrations twice, exact owner/session/assignment revocation, concurrent offers, token-refresh and logout deadlocks, expiry during credential/enrollment/offer waits, cancellation before insertion, active lease preservation and bounded cleanup. HTTP/service and native tests complement these; none represents physical delivery or audio proof.

Read-only deployment preflight on 11 September confirmed that all existing columns required by this candidate are present. The new push/wake tables are absent, so migrations remain a prerequisite. The healthy public backend still reports source `75fa3c940aa983cff30ed967d444c73b43cc9a53`; this preflight changed no data or runtime configuration.
