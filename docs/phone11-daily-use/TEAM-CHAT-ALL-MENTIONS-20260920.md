# Team Chat `@all` contract — 2026-09-20

Phone11 stores `@all` as a dedicated `{ start, length: 4 }` message descriptor. It is not a synthetic user and is not expanded into the existing 20-person mention list. The server accepts a new descriptor only when the text contains the exact lowercase `@all` range, the conversation is a group or channel, and the sender currently has an active workspace `owner` or `admin` role. Direct conversations and ordinary members fail closed.

`chat.details.canMentionAll` is the server capability and permission signal. A missing field or missing `public.phone11_chat_message_all_mentions` table is treated as false. The capability check is performed afresh, so applying the migration becomes visible without restarting or permanently caching an unsupported result. Existing message and history reads remain available before the migration.

Lost-response retries keep the original client ID and compare content, parent, attachments, person-mention descriptors, and the `@all` descriptor with the saved message before returning it. This comparison happens before fresh mention resolution or role checks, so an already accepted request remains idempotent after a mentioned member is removed or the sender is demoted. A changed retry conflicts, and every new send must pass current membership and authority checks.

Notifications continue through the existing conversation-member outbox. `@all` does not bypass active membership, extension assignment, session validity, conversation mute, DND, block, or unread checks and does not create a higher-priority provider event.

Fresh disposable databases receive the table from `server/chat/collaboration-migration.sql`; `server/chat/all-mentions-migration.sql` is the additive development migration for an existing complete chat schema. Production review should use only the separately guarded `server/chat/all-mentions-live-delta-20260920.sql` after catalog preflight. No application process runs these files automatically.
