# Channel UX and meeting start — 22 September 2026

## Owner request and research

Match the supplied Zoom channel references with blue structured mentions, red new-message alerts, and a channel header camera opening an all-selected participant picker before a meeting starts. Selection/deselection is the owner's requested extension, not a claim that Zoom's supplied confirmation dialog provides that control.

Official references:
- https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0064557 — member mentions and @all restrictions.
- https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0063548 — channel membership and instant meetings.
- https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0059918 — meetings from chat invite members.

## Implemented feature and release

- Blue structured mention spans preserve tenant/member verification. Plain unstructured @text is not treated as a verified mention.
- Red new-message/reply boundary and jump control for incoming server messages observed while the reader is away from the bottom. Loading older history cannot fabricate a new boundary. Channel/thread/account changes clear local arrivals.
- Group/channel header camera opens a member picker using authorized conversation details. All current invitees start selected; host is implicit. Search, individual toggle, select/deselect all and cancel are supported. Removed members/account changes reset selection. Cancelled or stale roster requests are ignored.
- Start now checks its separate server capability and explicit channel permission. On explicit confirmation it creates an idempotent meeting for host and selected members, then opens the exact server-admitted meeting in prejoin. The production capability was enabled on 23 September for the approved tenant and test channel.
- Private channel invitation cards poll the authenticated recipient inbox; invitations expire after two hours and contain no access token. This does not claim push notification delivery.
- Reopening a channel captures the current member’s authoritative read sequence before auto-read and marks the first incoming unread root message in red. Refresh and older-history pagination preserve that visit’s boundary.
- `/dev/channel-preview` is development-only, uses synthetic members and production presentation components, and redirects in release mode. No messages or invitations are sent.

## Verified

Focused tests, TypeScript and diff checking were run. Browser preview verified at 393x852: blue mention/red alerts, default all-selected picker, deselect one, select all, search, disabled Start and cancel returning to the preview. This is browser component evidence, not signed iPhone acceptance.

Build 83 is installed and launched on the paired iPhone 17 Pro Max. Signed iOS CI run 35765230017 succeeded for source 46ba51beb1f9918b31527139ef199577508e3971. The signed IPA passed 22 gates; SHA-256 `9b835fc450806b3d0d301e9c67626eb925b4a545f9da63b478d2f2045de1f968`. Build 82 remains available for rollback. Two-phone media behavior still requires physical acceptance.

## Meeting contract

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

The guarded migration was applied after a fresh backup and isolated restore rehearsal. The 3006 candidate activated successfully, routing moved from 3005 to 3006, and the baseline calling service remained healthy. The explicit hosting grant was applied and verified for users 1/3001 and 2/1020 in shared test channel `24ee4d70-8f57-4192-982c-badb88b8930a`. Other channel members remain unable to start meetings. Backend response and physical two-phone media acceptance are separate checks.

Thread-specific persisted unread counts still need an authoritative thread cursor; local red new-reply arrivals do not claim such a count.

## Release checkpoint

- Backend follow-up `9aab162` restricts channel hosting to the intersection of explicitly enabled and configured video tenants. Independent source review approved this delta; eight router tests passed.
- `c69fced` freezes protected Compose recovery and the migration operator. Recovery classification takes the same database advisory lock as apply; twelve operator tests include real overlapping PostgreSQL commit/rollback cases. The pending-before-lock recovery race was corrected and independently approved in `55b42ed`.
- `b453958` freezes API activation safeguards, inactive-port containment, and exact migration-receipt/tenant flag binding. The final activation correction passed 43 focused tests and independent source review in `bc67841`.
- Neither these checks nor signed build success establishes live activation or physical-device media acceptance.

- Reviewed Compose recovery ran successfully without restart: protected config SHA-256 `881ba5bd8219f11285d80ca4383885e0ab7a75db09a0ab0c6b9d037c3c54389d`.
- Owner approved meeting-host permission for both 3001 and 1020 in their shared test channel; the grant was applied and verified on 23 September.

## Reviewed release artifacts

- Migration recovery correction `55b42ed` independently approved source-only; 14 author-run tests cover delayed-before-lock execution and overlapping commit/rollback.
- Activation correction `bc67841` independently approved source-only; 43 focused tests pass.
- Backend source `9aab1625655c981e16fee8fab0a2e2af9f0fe2e1`, image `sha256:62d8dd798e8bc08b939b75aa57761e1f14341fdbbdcdac7d3a04ae63a6e79dbd`, bundle `a846c1c73ae3eeb55f4f4a60b3266981fad980ded33dc331c5ccd2dbb79f56c4`. Disposable network-disabled read-only image validation passed. No service activation is implied.

- Build 83 picker loads authorized members independently of hosting capability, selects all other members by default, permits individual deselection, and keeps Start disabled when authorization cannot be checked. Thirty-seven focused tests and TypeScript passed.

## Build 84 picker freeze correction

Build 83 could replace its native iOS meeting sheet while the channel roster arrived, freezing the UI. `0d902921d5de477214b9d570db55cb1383b5ba36` keeps the outer modal stable and resets only the inner selection content as the roster changes. Thirty-eight focused tests and TypeScript passed. Signed Build 84 (`f3e7160d-b468-45df-b6db-d4a5528df055`) passed 22 package gates, was installed in place on the iPhone 17 Pro Max, and was confirmed by device inventory. The owner subsequently confirmed the picker no longer froze.

## Build 85 picker keyboard correction

The owner confirmed Build 84 no longer froze, but typing in the channel meeting picker's member search let the iOS keyboard cover the selection sheet. `9fe0eebe7b1c0f91fa1069e4a300867e6c4af210` keeps the modal boundary stable and makes the sheet avoid the keyboard while its roster scroll area shrinks. Thirty-nine focused picker/chat checks and TypeScript passed; independent review approved the source change only. Signed Build 85 (`a86a9347-3447-41a1-a93e-22422c5a432f`, GitHub run `35815047455`) passed 22 package gates, was installed and launched on the iPhone 17 Pro Max, and device inventory confirmed bundle version 85. IPA SHA-256: `4120bf3128630488dff44a701c292a8c9c426ce49f35c09e8dc6ac4554bb1ae3`. The owner then confirmed the picker is working on the handset. Two-phone invitation, join, and media behavior remain unverified.
