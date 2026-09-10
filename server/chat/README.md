# Phone11 Team Chat

This replaces the sample channels and local-only messages with authenticated, persisted text conversations. The mobile app supports a workspace directory, direct/group/private-channel creation, conversation search/filtering, search within saved messages, unread counts, paged history, and sending/failed/retry states. A message becomes **Sent** only after the backend confirms its database transaction. This is server acceptance, not a recipient delivery/read receipt.

## Data and access

- Uses `server/pbx/db.ts` and the same PostgreSQL database as Phone11 owned authentication.
- The authenticated `ctx.user.id` is the `users.id` mapped by `phone11_auth_identity.legacy_user_id`. The client cannot select a sender.
- The deployed Phone11 model grants workspace access through explicit `user_extensions` assignments joined to active, undeleted `extensions` and an active `tenants` row. No tenant 1 fallback, guessed organization, or `extensions.user_id` fallback is used. Chat-only users need an explicit membership model in a later release.
- Every request reads current assignment state; access does not rely on the older PBX membership cache. Every room read/write also checks conversation membership in that tenant.
- Directory results expose only user ID, display name, and the primary active extension within the selected tenant. They never include SIP credentials.
- Composite foreign keys bind all messages and conversation memberships to one tenant. Sender/client-key uniqueness makes retries idempotent, including simultaneous retries. A conflict with changed content is rejected.
- Read markers advance only through saved messages in that conversation; future messages cannot be pre-marked as read.

## Deployment

1. Confirm the backend's actual PostgreSQL database contains `users`, `tenants`, `user_extensions`, and `extensions` with the columns queried by `service.ts`.
2. Review/apply `migration.sql` to that database. It creates only the three `phone11_chat_*` tables and their indexes. It grants no users or assignments and inserts no sample messages. Existing migrations cannot be assumed to include it.
3. Deploy the backend containing `chatRouter` registered in `fullRouter` and the updated mobile build.
4. Use two explicitly authorized test accounts with active assignments in the same tenant. Create one conversation; send, receive, reload on the second client, retry a dropped response, and check unread/reset. Also confirm an unrelated tenant/account cannot list or read it.

## Verification

`tests/phone11-chat-persistence.test.ts` covers restart recovery, explicit retry, storage failure, and logout/write ordering. `tests/phone11-chat-state.test.ts` covers network acknowledgement, failed retry, refresh deduplication, pagination, unread acknowledgement, logout/account switching, and revoked access. The PostgreSQL test uses real transactions and multiple concurrent connections; it never targets the configured application database.

```sh
# Start a dedicated disposable local database. Pick an unused loopback port.
docker run --detach --rm --name phone11-chat-test \
  -e POSTGRES_PASSWORD=phone11-local-test-only -e POSTGRES_DB=phone11_chat_test \
  -p 127.0.0.1:57951:5432 postgres:16-alpine
PHONE11_CHAT_TEST_DATABASE_URL=postgresql://postgres:phone11-local-test-only@127.0.0.1:57951/phone11_chat_test \
  node_modules/.bin/vitest run tests/phone11-chat-state.test.ts tests/phone11-chat-persistence.test.ts tests/phone11-chat-postgres.test.ts
docker stop phone11-chat-test
```

The integration suite refuses non-loopback URLs or a database not named `phone11_chat_test`. Without that environment variable, only the database-dependent tests are skipped; authentication and mobile state tests still run.

## Scope and remaining work

The foreground chat refreshes every five seconds while its screen is focused, and on returning to the app. It does not promise background notifications, typing/presence, attachments, edit/delete, threaded replies, reactions, search across conversations, public channel discovery, or recipient receipts. Drafts and unacknowledged text are saved in AsyncStorage under authenticated user and tenant keys. They survive a restart and restore only after workspace access is checked; interrupted sends appear as Failed and require explicit Retry. Saves complete before network sending begins. Only pending text is stored locally, never a full server-message cache. Logout removes that owner's pending data with writes/deletion serialized; other accounts cannot reuse it. AsyncStorage is app-private local storage, not an additional encrypted message vault. Storage failures are visible and block sending until the pending text can be saved. Account changes clear all in-memory chat content and discard stale asynchronous responses. Conversations are currently limited to the latest 200 in the list, 500 directory contacts, 50 participants, and 4,000 characters per message.

The Zoom mobile baseline includes direct/group/channel messaging, directory, files, searching, unread handling, channel management, and richer replies. These establish subsequent acceptance milestones rather than justify showing simulated features:

- [Zoom Chat getting started](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0059918)
- [Zoom Chat comparison by platform](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060777)
- [Creating and using channels](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0063548)
- [Channel management](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0063707)

Saved-message search is limited to a freshly authorized conversation, literal substring matching (including Thai), 2–100 input characters, and the latest 50 results. It uses bound SQL parameters; no client-supplied pattern is executed as SQL.
