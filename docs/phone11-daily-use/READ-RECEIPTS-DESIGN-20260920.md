# Team Chat read receipts

Status: implemented, source-verified, and deployed with live pilot API checks on
20 September 2026. Two-iPhone behavior is not yet verified; see
`READ-RECEIPTS-LIVE-ACCEPTANCE-20260920.md`.

## Experience

- A sent direct message shows a small **Read** label after the recipient views it.
- A sent group/channel message shows **Read by 3**. Tap it (or Message details in the message menu) to open a compact **Read by** sheet with member names, avatar initials and first-read times. Include a clear Close action and accessible labels.
- Only the sender sees their message's detailed receipt list. Keep the conversation uncluttered; no permanent per-person checkmark rows.
- Empty means **No read receipts yet**, not proof that nobody read it. Older clients may not publish receipts. Do not label absent receipts “Unread” or claim “Everyone read” without an authoritative audience snapshot.
- Receipts start with observed message visibility after rollout. Never infer historical receipts from existing unread counters. Opening notifications, search results, or the chat list does not acknowledge messages.
- Read means the message was displayed, not that a voice clip was played or an attachment opened. Do not add a Delivered state without a delivery acknowledgment.

## Implementation contract

The existing `last_read_sequence` is an unread-badge cursor. `markAsRead` can acknowledge a newer thread sequence than the loaded root timeline. Reusing it would falsely mark unseen messages read. Preserve that cursor and add separate per-message receipts.

Record explicit message IDs with a server-generated first-read timestamp and idempotent uniqueness per tenant, conversation, message and recipient. Batch at most 50 IDs. Validate each message's conversation and root/thread context; exclude deleted messages and the reader's own messages. Repeat active workspace, conversation membership, extension assignment and bilateral block checks for both writes and queries. Do not return revoked or blocked member identities. Use existing authenticated owner binding and fail closed on older servers or absent migration.

The client acknowledges only actual viewable message cells after a short visibility dwell while the conversation is focused, the app is foreground, and no overlay obscures it. Cancel pending visibility work on blur/background, thread, account, auth-session or workspace replacement. No receipts from restored state or cached notification previews. Avoid a whole-cell visibility threshold that makes long messages impossible to acknowledge; use a viewport-relative threshold with tests. Bound polling and queries to visible sent messages and the open details sheet.

Do not change membership semantics or add retrospective recipient snapshots in this increment. A positive Read by list satisfies the requested named-reader experience without asserting an unknowable historical unread audience. New members who can legitimately view existing history may contribute an actual receipt when viewing it.

## Verification

Completed on 20 September 2026: 79 focused receipt/chat tests passed, 244 Team Chat non-database tests passed, and 43 disposable PostgreSQL 17 tests passed. TypeScript and whitespace checks passed; focused ESLint had no errors. The lead reran the 79 focused tests and TypeScript successfully, and inspected the production reader-sheet component in the local sample preview at 390px light/dark and 1280px desktop. The preview uses sample names, not live handset receipts. Slow summary requests, thread/account changes and stale detail responses received follow-up source review and targeted fixes before acceptance.

Test first-read idempotence; cross-tenant/conversation/thread rejection; sender-only receipt details; missing/deactivated/blocked membership; own/deleted message exclusion; duplicate/bounded batches; background and obscured-screen cancellation; thread/auth-owner replacement; delayed responses; long messages; and older-server fallback. Run real disposable PostgreSQL tests, TypeScript, focused lifecycle tests, and browser checks at mobile and desktop widths. Signed-build installation and two-iPhone observation remain separate acceptance gates.

### Two-iPhone acceptance after server and signed app rollout

1. From 3001 send a new direct message to 1020 while 1020 is on the Home Screen. It stays Sent even if a notification appears.
2. Open that conversation on 1020 and bring the message into view. Within one refresh interval, 3001 shows Read without needing to scroll or reopen the chat.
3. In a shared group/channel, send another message from 3001. After 1020 views it, tap Read by 1 on 3001 and confirm the real member name and first-read time. Close returns to the same conversation.
4. Send a thread reply. Viewing only the root timeline must not mark the reply read. Opening Replies and viewing that reply does.
5. Repeat with a long message, a voice clip, temporary mobile-data loss, and switching away/back. Read on the voice clip means its message was shown, not audio playback completion. An existing receipt's timestamp must not change on a repeat view.
6. Recheck an app-to-app call, answer, two-way audio and locked-screen ringing after installation. This chat change must preserve the previously accepted calling behavior.

## References

- [Zoom read receipts](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0074542): compact receipt details, account/client controls, group limits.
- [Zoom receipt FAQ](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0074544): behavior and limits. Phone11 deliberately avoids age-based or unread-cursor-based inferred reads.
- [Microsoft Teams read receipts](https://support.microsoft.com/en-us/teams/chat/use-read-receipts-for-messages-in-microsoft-teams): Read by member details and distinction between viewing a chat and notification previews.

Enterprise admin enforcement and per-user opt-out are a separate policy increment; this implementation must not claim those controls exist. Receipt visibility stays within the existing authorized conversation and sender access boundaries.
