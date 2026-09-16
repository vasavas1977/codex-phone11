# Phone11 Team Chat: focused UC comparison

Reviewed 16 September 2026. This is a feature comparison and implementation plan, not a claim of live handset acceptance.

## Primary references
- Zoom getting started: https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0059918
- Zoom mentions: https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0064557
- Microsoft send/read messages: https://support.microsoft.com/en-us/teams/chat/send-and-read-messages-in-microsoft-teams
- Microsoft threads: https://support.microsoft.com/en-us/teams/teams-channels/follow-threads-in-microsoft-teams

Zoom emphasizes unread navigation, mentions, conversation search and communication shortcuts. Teams supports editing, saved messages, unread state and threaded replies. Phone11 should adopt those interaction patterns progressively while keeping its mobile screen minimal.

## Verified in current source
Direct/group/private-channel creation, workspace membership guards, conversation and saved-message search, unread counts, persistent drafts, pending/failed/sent text states, manual retry and earlier-message pagination exist. The room refreshes every five seconds while active. Sent means server accepted, not recipient read. Live two-account delivery and locked-phone notifications require separate current verification.

## Implemented in this update
- Scrollable 44-point-minimum filter controls: All, Unread, Chats, Groups, Channels, Drafts.
- Draft previews in the conversation list, scoped to the current account/workspace.
- Search teammates by name or extension in New conversation.
- Selected-filter accessibility state; larger filter labels.
- Existing failed-send retry and account/tenant guards retained.

## Prioritized next increments
1. Quoted replies and threads: stable parent message IDs, membership checks on every read/write, deleted-parent behavior, scoped reply notifications.
2. Edit/delete own messages: server authorization, edited labels, retention/audit policy and client reconciliation.
3. Mentions/reactions: structured member IDs, no name-text notification matching, deduplicated recipient notification delivery.
4. Attachments: private storage, size/type limits, malware scanning, short-lived authorized downloads, progress/cancel/retry.
5. Pin/mute/save and unread navigation: per-user persisted preferences; distinguish read receipts from server acceptance.
6. Desktop list/detail layout with keyboard navigation; mobile focused conversation and accessible overflow actions.
7. Enterprise controls: membership lifecycle, retention, audit access and company isolation, then authenticated two-account and two-tenant tests.

Do not add inactive buttons for these future features. Do not copy private recording follow-ups into shared conversations automatically. Phone11 remains the internal messaging authority; Super Number and LINE OA must use explicit mappings and separate external routing.

## Handset acceptance
Use two authorized accounts in one workspace. Verify direct and group messages, foreground refresh, background alerts, notification deep link, offline failed send/retry without duplicates, relaunch draft restoration, search, membership removal and tenant switch. Never equate unit tests or an APNs acceptance response with physical notification delivery.
