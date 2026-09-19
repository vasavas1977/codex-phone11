# Phone11 Team Chat upgrade proposal

19 September 2026. Proposal only; additional capabilities below are not shipped in Build 68.

## Decision

Adopt Zoom's familiar mobile chat structure, Teams' conversation details hub, and Slack's focused reply/catch-up patterns. Keep Phone11 branding and a smaller default surface. Improve the complete daily workflow rather than only restyling message bubbles.

Build 68 is a bounded cleanup: text chat, direct/group/channel creation, room search, replies, drafts/retry, unread counts, reporting/blocking, and theme-aware layouts. The inspected message model has no attachments, reactions, mentions, photo avatars, typing state or per-message delivered/read receipts. These require service and data work, not additional decorative buttons. The user confirmed successful messaging between the pilot accounts; this is not proof of all background/offline scenarios.

## Proposed experience

### Inbox

- Label the tab Chat. Compact avatar/workspace identity, title, Search and New message.
- Initial tabs: All, Unread, Chats, Channels. Add Mentions when mention delivery is implemented; keep Saved and Drafts in More. No empty feature tabs.
- Rows: 44-point avatar, 17-point name, 14-point preview, quiet timestamp, readable unread badge, muted/pinned indicators. Use real profile pictures when supported, initials otherwise; never invent presence.
- Pin important conversations; mute via explicit All messages / Mentions and replies / Off choices. Muting suppresses alerts, not message availability. Keep unread tracking and app-badge rules separate and consistent across devices.
- One New message entry: searchable people picker; one person opens a DM; multiple selections create a group. Channel creation is a separate action with name, membership and privacy settings backed by policy.

### Conversation

- Back, avatar/name, compact call action where the destination is supported, and More. Tap the name for details. Show Meet only after this integration is ready for the account.
- Date separators, sender grouping, subdued timestamps, gray incoming bubbles, restrained blue outgoing bubbles, and a clear first-unread boundary.
- Preserve reading position. New incoming messages show a New messages button when the user is reading older content; they must not pull the reader to the bottom.
- Default message surface contains content, optional reactions and a truthful reply count. Long-press opens React, Reply, Copy, Save, and permitted Edit/Delete. Report stays in the overflow, with an accessible alternative to long-press.
- Composer stays immediately above the keyboard: attachment plus, multiline text, emoji, Send. Add voice recording only with preview/cancel, upload and permission handling. Preserve drafts by user, tenant, conversation and thread.
- File cards show type, filename, size and upload/progress/retry. Images open a full viewer. Preview before sending; no silent sends from file selection.
- Sent means server accepted. Delivered/Read labels remain absent until their events and privacy rules exist.

### Replies and details

- Mobile: dedicated Replies screen, visible parent message, reply list, Reply composer; Back restores the prior room position.
- Desktop: persistent conversation list on the left, room in the center, optional replies/details pane on the right. Keyboard navigation, contextual hover actions and familiar search shortcuts.
- Reply counts and unread replies come from server state. Keep one thread root; do not create invisible nested threads.
- Conversation details: members, files/photos/links, search, mute/pin and applicable leave/report actions. A DM converted into a group creates a new conversation without exposing private DM history.
- Saved messages are private bookmarks. Converting a message into a task is a separate explicit action. Private recording follow-ups must never enter shared chat/calendar automatically.

## Delivery order

1. **Reliable foundation and navigation:** fix the open one-way calling issue separately; prove keyboard, drafts/retry, background notification deep links and read-position behavior on two phones. Finish inbox/details/desktop navigation and room search context jump.
2. **Everyday collaboration:** images/files with protected storage and upload recovery, reactions, reply counts, Pin/Mute and private Save. This is the smallest release that would feel materially closer to the owner's Zoom references.
3. **Attention and discovery:** identity-based mentions with autocomplete, Mentions view, tenant-scoped cross-conversation search, unread-reply tracking, notification preferences, policy-aware edit/delete. Mention fan-out must respect current membership and mute policy.
4. **Advanced conveniences:** voice notes, truthful typing/presence, optional read receipts, chat-to-meeting handoff, scoped AI summaries/translation and shared-calendar task actions. AI is secondary to dependable ordinary chat.

## Service work and acceptance

- Stable message IDs and client idempotency survive offline retries; drafts key on thread as well as room.
- Each content read, search hit, attachment download, notification recipient and mutation rechecks user/tenant/channel access. Removing a member must revoke future retrieval and notifications.
- File upload needs membership checks, type/size validation, quarantine/scanning as appropriate, short-lived authorized downloads, retention/deletion behavior and failed-upload cleanup. Do not put private attachments on public URLs.
- Add persistent per-user conversation preferences, reaction membership records, typed mention targets and reply counts; build on the existing read cursors. Avoid claiming unread state is a recipient read receipt.
- Validate font scaling and Thai combining marks; use native system typography and at least 44-point mobile action targets. Test light/dark and small/large phones.
- Release acceptance: two distinct accounts send text/file/replies both directions; background notification opens the exact message; offline retry produces one message; navigation preserves room/thread drafts; mute behaves as labelled; search/attachments reject removed members and another tenant; desktop keyboard and split-pane behavior pass.
- Continue signed standalone iPhone installs. No development launcher; no claim of feature parity from a mockup or unit tests.

## Research basis

These sources establish comparator behavior; the layout, prioritization and rollout above are Phone11 product recommendations.

- [Zoom Chat overview](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0059918): conversation categories, mobile content composer and per-conversation notification settings.
- [Zoom replies and message actions](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0066130): threads, reactions and policy-controlled editing/deletion.
- [Teams mobile chat management](https://support.microsoft.com/en-us/teams/chat/manage-chats-with-the-teams-mobile-app): title opens chat dashboard, search/shared content/members, and distinct group conversation when adding to a DM.
- [Slack threads](https://slack.com/help/articles/115000769927-Use-threads-to-organize-discussions): focused threaded discussions and desktop side-by-side work.
- [Slack saved items](https://slack.com/help/articles/360042650274-Save-messages-and-files-for-later): personal follow-up collection.
- [Apple accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) and [layout](https://developer.apple.com/design/human-interface-guidelines/layout): readable controls, Dynamic Type and device/localization checks.

## Calling issue remains open

User reports 1020 to 3001 works, while 3001 to 1020 stays Calling and does not ring. Live inspection saw both registrations; contact counts changed between snapshots. A recent logged 482 response is not mapped to the failed direction and is not a proven cause. Client review found no concrete target-construction bug. Bounded metadata captures did not capture a fresh 3001-to-1020 INVITE; a new failed-direction reproduction is required. A separate source-only reverse background wake candidate now passes 25 service, 11 static/patch and 43 isolated PostgreSQL tests, TypeScript, and both gated Kamailio parser configurations. This is not foreground-call acceptance or a deployed fix. No live routing changes were made during this design research.
