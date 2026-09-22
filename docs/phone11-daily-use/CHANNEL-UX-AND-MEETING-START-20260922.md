# Channel UX and meeting start — 22 September 2026

## Owner request and research

Match the supplied Zoom channel references with blue structured mentions, red new-message alerts, and a channel header camera opening an all-selected participant picker before a meeting starts. Selection/deselection is the owner's requested extension, not a claim that Zoom's supplied confirmation dialog provides that control.

Official references:
- https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0064557 — member mentions and @all restrictions.
- https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0063548 — channel membership and instant meetings.
- https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0059918 — meetings from chat invite members.

## Implemented source, not a released phone update

- Blue structured mention spans preserve tenant/member verification. Plain unstructured @text is not treated as a verified mention.
- Red new-message/reply boundary and jump control for incoming server messages observed while the reader is away from the bottom. Loading older history cannot fabricate a new boundary. Channel/thread/account changes clear local arrivals.
- Group/channel header camera opens a member picker using authorized conversation details. All current invitees start selected; host is implicit. Search, individual toggle, select/deselect all and cancel are supported. Removed members/account changes reset selection. Cancelled or stale roster requests are ignored.
- Start remains disabled with an honest explanation: channel creation/invitations do not yet exist. Existing admitted-room join capability is deliberately not used to pretend this feature works.
- `/dev/channel-preview` is development-only, uses synthetic members and production presentation components, and redirects in release mode. No messages or invitations are sent.

## Verified

Focused tests, TypeScript and diff checking were run. Browser preview verified at 393x852: blue mention/red alerts, default all-selected picker, deselect one, select all, search, disabled Start and cancel returning to the preview. This is browser component evidence, not signed iPhone acceptance.

Build 81 remains installed. No new signed build, API deployment, migration, push delivery or meeting initiation occurred in this change.

## Required next implementation: actual channel meetings

The `Complete Connect11 project` task confirmed the existing plain-video contract. Connect11 has no room/member provisioning API, and none is needed: Phone11 owns admission; the media room is created on the first authorized join. Continue using protected `phone11-plain-video.v1` token issuance with server-owned opaque meeting and participant IDs, fresh tokens, and the existing admission revision/lease checks. Do not add a generic arbitrary-room token route or send a channel roster to a fabricated provider endpoint.

Implement an authenticated `startChannelMeeting(channelId, selectedMemberIds, requestId)` workflow:

1. Resolve the actor's current channel and tenant membership on the server. Check explicit channel meeting-start permission. Validate all selected invitees remain active members of that exact tenant/channel and eligible Phone11 identities; host is added independently.
2. In one transaction, create a server UUID open room, admission members for host and selected invitees only, the source channel/creator linkage, and durable targeted invitation outbox records. Unselected users must not obtain admission from a copied link.
3. Deduplicate request IDs by tenant and actor; bind channel and canonical selection fingerprint. Same request returns the same meeting; changed payload conflicts. Unique per-recipient outbox keys prevent duplicate invites.
4. Invitations contain meeting references only, never tokens. Recipient joins through existing fresh authorization/token issuance. Recheck removal, disabled identity, tenant changes and room lifecycle; failed provider delivery must remain queued/failed rather than delivered.
5. Add permission/rate/participant bounds, failure/retry coverage, isolated PostgreSQL transaction and tenant tests, independent security review, then deploy through the existing protected rollout route. Only then enable Start and build the signed update.
6. Validate two phones: selected recipient invitation/join, unselected denial, double tap/retry deduplication, concurrent member removal, audio/video, leave/rejoin and SIP interruption.

## Remaining unread history gap

The server tracks `phone11_chat_members.last_read_sequence` but does not expose it in history responses. Channel unread totals cannot locate an exact first-unread message, especially when replies are excluded from the root timeline. Add only the current authorized member's cursor to the history response and client state for a truthful revisit divider. Thread-specific unread counts/badges require an authoritative thread cursor or receipt query; they must not be inferred from total reply count.

## Orchestration constraint

One Terra XHigh worker completed the visual/route work. Attempts to start the planned independent Sol integration worker and reuse the earlier header worker failed with the agent-thread limit. Main handled contract coordination, picker implementation and integration review. No independent security approval for a future creation backend is claimed.
