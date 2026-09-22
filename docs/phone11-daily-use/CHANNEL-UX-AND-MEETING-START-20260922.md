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
- Start now checks its separate server capability and explicit channel permission. On explicit confirmation it creates an idempotent meeting for host and selected members, then opens the exact server-admitted meeting in prejoin. Until the migration, backend release, and pilot permission are commissioned, the production capability remains unavailable.
- Private channel invitation cards poll the authenticated recipient inbox; invitations expire after two hours and contain no access token. This does not claim push notification delivery.
- Reopening a channel captures the current member’s authoritative read sequence before auto-read and marks the first incoming unread root message in red. Refresh and older-history pagination preserve that visit’s boundary.
- `/dev/channel-preview` is development-only, uses synthetic members and production presentation components, and redirects in release mode. No messages or invitations are sent.

## Verified

Focused tests, TypeScript and diff checking were run. Browser preview verified at 393x852: blue mention/red alerts, default all-selected picker, deselect one, select all, search, disabled Start and cancel returning to the preview. This is browser component evidence, not signed iPhone acceptance.

Build 82 is installed in place on the paired iPhone 17 Pro Max; device inventory confirmed version 82. Launch was blocked by the locked device, so runtime acceptance is pending. Signed iOS CI run 35692980986 succeeded for client source 224081af468f7ad530a85d7a6f1d72399a9f34a9; Build 82 artifact verification passed all 22 signed-package gates. EAS build `a942497d-839b-465a-82ea-70478de5ddca`; IPA SHA-256 `794af30bf7b1f0cecc94089567d79fbb144fcc595f3da172bdfea3880c614d9b`. Build 81 rollback is retained. No API deployment, migration, push delivery or meeting initiation is established by this change.

## Implemented meeting contract; rollout pending

The `Complete Connect11 project` task confirmed the existing plain-video contract. Connect11 has no room/member provisioning API, and none is needed: Phone11 owns admission; the media room is created on the first authorized join. Continue using protected `phone11-plain-video.v1` token issuance with server-owned opaque meeting and participant IDs, fresh tokens, and the existing admission revision/lease checks. Do not add a generic arbitrary-room token route or send a channel roster to a fabricated provider endpoint.

The authenticated `startChannelMeeting(channelId, selectedMemberIds, requestId)` workflow implements the following contract:

1. Resolve the actor's current channel and tenant membership on the server. Check explicit channel meeting-start permission. Validate all selected invitees remain active members of that exact tenant/channel and eligible Phone11 identities; host is added independently.
2. In one transaction, create a server UUID open room, admission members for host and selected invitees only, the source channel/creator linkage, and durable targeted invitation outbox records. Unselected users must not obtain admission from a copied link.
3. Deduplicate request IDs by tenant and actor; bind channel and canonical selection fingerprint. Same request returns the same meeting; changed payload conflicts. Unique per-recipient outbox keys prevent duplicate invites.
4. Invitations contain meeting references only, never tokens. Recipient joins through existing fresh authorization/token issuance. Recheck removal, disabled identity, tenant changes and room lifecycle; failed provider delivery must remain queued/failed rather than delivered.
5. Add permission/rate/participant bounds, failure/retry coverage, isolated PostgreSQL transaction and tenant tests, independent security review, then deploy through the existing protected rollout route. Only then enable Start and build the signed update.
6. Validate two phones: selected recipient invitation/join, unselected denial, double tap/retry deduplication, concurrent member removal, audio/video, leave/rejoin and SIP interruption.

## Validation and remaining release work

The independent Connect11 review found and the worker corrected volatile timestamp defaults, non-conflicting permission locks, and LIMIT-before-origin-filter behavior. A fresh isolated PostgreSQL cluster passed 49 integration checks, including meeting defaults and concurrent permission revocation. The independent Connect11 rereview approved the corrected backend source with no remaining concrete P0–P2 findings in its scope. Full Vitest: 399 suites, 1,919 passed, 285 environment-dependent skips, zero failures; TypeScript passes. Client controls cover safe retries, duplicate taps and account-change results; signed handset behavior remains unverified.

A separate fixed 3005-to-3006 API rollout operator is prepared. Fresh read-only host inspection confirmed all existing API slots healthy, but the live 3005 container's temporary Compose source no longer exists. Protected configuration recovery, reviewed migration, pilot grants, API activation, and signed iPhone release remain required. Build 82 is now installed on the iPhone 17 Pro Max, with runtime acceptance pending unlock. The iPhone 15 Pro Max was unavailable.

Thread-specific persisted unread counts still need an authoritative thread cursor; local red new-reply arrivals do not claim such a count.

## Release checkpoint

- Backend follow-up `9aab162` restricts channel hosting to the intersection of explicitly enabled and configured video tenants. Independent source review approved this delta; eight router tests passed.
- `c69fced` freezes protected Compose recovery and the migration operator. Recovery classification takes the same database advisory lock as apply; twelve operator tests include real overlapping PostgreSQL commit/rollback cases. Independent review found a pending-before-lock recovery race; correction is in progress.
- `b453958` freezes API activation safeguards, inactive-port containment, and exact migration-receipt/tenant flag binding. Forty-two focused operator tests passed; independent review found leading-zero port containment and stale migration provenance issues; corrections are in progress.
- Neither these checks nor signed build success establishes live activation or physical-device media acceptance.

- Reviewed Compose recovery ran successfully without restart: protected config SHA-256 `881ba5bd8219f11285d80ca4383885e0ab7a75db09a0ab0c6b9d037c3c54389d`.
- Owner approved meeting-host permission for both 3001 and 1020 in their shared test channel; no grant or live migration has run yet.
