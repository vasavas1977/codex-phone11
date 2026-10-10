# Phone11 presence implementation candidate

This source candidate adds company-scoped presence without changing SIP, CallKit, wake, routing, notification, or meeting-admission policy.

## Behavior

- A root publisher starts after Phone11 resolves the authenticated account's server-authorized primary/current Team Chat workspace, so opening the Phone tab first does not suppress presence.
- App activity publishes `available` or `away`. A real account-owned SIP call publishes `on_call`. A native meeting publishes `in_meeting` only while its `BrowserMeetingSession` is connected or reconnecting. SIP call state has priority when separate sessions are simultaneously in a call and meeting.
- Every process/workspace generation has a UUID plus process-monotonic sequence. The server retains a bounded tombstone after cleanup, so a delayed lower-sequence request cannot revive a retired session. A different process gets a different random session ID.
- The server uses 90-second server-clock leases, aggregates multiple device sessions, serializes per-account writes, limits live sessions to 16, and bounds retained rows to 32 per workspace account.
- Presence queries repeat active workspace membership and active-extension checks. Responses contain only status and last activity time; no call party, number, room, title, token, or participant data is stored or returned.
- Viewed contacts refresh in batches of at most 100 every five seconds while Phone11 is foregrounded and immediately on resume. A failed or unsupported query clears the requested cached entries to `Status unavailable`; it never fabricates `Offline`.
- Manual availability, DND, calendar, and presenting states remain absent because Phone11 does not yet implement their behavior.

## Rolling compatibility and schema

The client first calls `chat.presenceCapability`. An old server, a temporary request failure, or a new server without `phone11_chat_presence_sessions` keeps the rich publisher and UI fail-closed. Capability failures retry after 10 seconds; successful capability checks refresh after 60 seconds. The existing legacy heartbeat remains accepted for old clients, and legacy status is used only until an authoritative session row exists.

Apply `server/chat/collaboration-migration.sql` through the reviewed database migration procedure before enabling this candidate. The application never runs DDL at startup. The disposable PostgreSQL integration suite reads that same migration and covers lease priority, expiry, stale sequence rejection, active-membership isolation, and concurrent session-cap serialization.

## Validation and remaining gates

The source checks include TypeScript, focused client/router/UI tests, and the disposable PostgreSQL suite when `PHONE11_CHAT_TEST_DATABASE_URL` or `PHONE11_CHAT_TEST_SOCKET` points to the dedicated local test database. The visual fixture is `/dev/presence-preview`; it uses the production indicator component with explicit deterministic states and contains no simulated runtime engine.

Deployment, migration application, signed builds, background timer behavior on physical iOS, and the two-iPhone call/meeting/expiry acceptance matrix remain separate gates. The 90-second lease is the correctness boundary when iOS suspends timers or the app is force-closed.

### Integration evidence, 20 September 2026

The implementation worker ran the disposable PostgreSQL 17.11 chat suite: 38/38 passed; the temporary cluster was stopped and removed. Focused presence/typing/boundary tests: 70/70 passed. Full Vitest: 1,655 passed, with 242 separately configured database tests skipped; the chat database suite was exercised separately. TypeScript passed; changed-file lint had no errors and four existing chat-screen hook warnings. Root inspected the tenant, block, session-cap, stale-update, and UI integration changes and verified light/dark phone previews plus desktop presence layout. Backend esbuild compilation passed. These results do not represent production deployment or physical-device acceptance.
