# Phone11 Phone and Meetings workflow mapping

Date: 2026-09-28. Zoom's documented tasks are the UX reference, not its branding or an integration with a Zoom account. This record distinguishes source integration from a deployed service, provider admission, and signed-device acceptance.

## Integration candidate

Branch `codex/phone11-zoom-feature-integration-20260928` starts from the feature-rich Phone11 source at `951162c`, rather than the older desktop-port branch with demo mobile Contacts and a simulated call screen. It retains tenant-bound Team Chat, mobile SIP calling, channel/direct meeting admission, mobile prejoin and room, desktop meeting window, and selected-workspace admin pages. It now also contains the later desktop call-state and voicemail safety fixes, the protected `pbx.directory.list` endpoint, and tenant-bound desktop Contacts. The candidate is a source branch; it is not a released build.

The directory requires an explicitly selected tenant, active tenant membership and an assigned active extension. It repeats that authority check in the row-producing query, filters to active tenant members, bounds search and pagination, and returns only display name, extension number and extension ID. The desktop discards results from a previous tenant/session and fills the dialpad when a contact is selected; it does not auto-call. Desktop sign-in now asks a multi-workspace user to select a workspace before SIP starts, then binds provisioning to that tenant and verifies the server's echoed tenant. Mobile SIP provisioning also uses the selected workspace, and a routine same-session auth refresh no longer tears down an active call. Changed credentials wait for ringing, active, and held calls; the iOS Siprix path also coordinates with native wake admission. Android retains its separate PJSIP/JavaScript call guard, and equivalent native wake behavior has not been proven. This Phone directory intentionally lists callable active user extensions, including the caller; Team Chat's separate people picker excludes the caller and chat-blocked peers. Both use active membership and extension assignment, but their filters serve different actions.

## Daily Phone tasks

| User task, with Zoom reference | Phone11 candidate | Remaining acceptance |
| --- | --- | --- |
| [Dial, answer, and control a call](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0061379) | Mobile SIP and desktop trial support the core dial/answer/end path; desktop Contacts source now looks up selected-tenant extensions. The owner previously confirmed one 1996 → 3001 desktop-to-iPhone call with two-way audio. | Repeat on signed macOS, Windows and iOS builds, including background wake, failure, second attempt and tenant switching. The prior single call does not establish broad parity. |
| [Mute, hold, transfer and manage an active call](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060061) | Core mobile and desktop mute/hold/keypad exist; transfer capability is narrower than Zoom Phone. | Prove PBX-backed blind transfer, rejected transfer, second-call behavior and lifecycle cleanup with real endpoints before exposing unsupported controls. |
| [Review history and voicemail](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0069013) | Desktop history exists. Desktop voicemail is deliberately disabled until owner-bound storage/delivery is proven. | Verify call-time ownership through CDR ingestion, authenticated history, mailbox storage, playback, deletion and cross-tenant denial on live services. |
| [Manage routing, numbers and users](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0069180) | The selected-workspace admin source includes people/extensions, DIDs, IVR, queues, ring groups, schedules and reports. | Review remaining implicit-tenant PBX admin procedures; prove role gates, persisted route, commissioned DID, real carrier delivery and rollback. A saved admin setting is not carrier activation. |

## Meetings tasks

| User task, with Zoom reference | Phone11 candidate | Remaining acceptance |
| --- | --- | --- |
| [Start or join a meeting](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060700) | Mobile has channel/direct actions. Desktop now has channel Meet now with current members selected by default and optional deselection. Both use server admission and select the returned exact room for prejoin; a conversation invitation no longer asks the user to choose an unrelated room. | Deploy the whole chat/auth/meeting migration chain, prove both users receive the invite and join the same room, and test expiration/revocation. General scheduling remains unbuilt and needs its own durable meeting lifecycle. |
| [Check audio and video before joining](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0062765) | Mobile prejoin and desktop device checks exist in source. Desktop prejoin now offers a stoppable speaker tone and a live mic/camera join-state summary; users must confirm what they hear. | Signed devices must pass mic/speaker/camera permission, deny/retry, device selection and default-state tests. |
| [Use in-meeting controls](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0062674) | Mobile and desktop room source includes mic/camera, participant roster, layout and leave behavior. Meeting and SIP media have a guarded boundary. | Prove two-way audio/video, rejoin, network change, cleanup and an incoming SIP call during a meeting on two physical clients. |
| [Host moderation and waiting room](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0065566) | Channel hosting rights and admission checks exist. Full waiting-room and host/cohost controls do not. | Implement server-authoritative host actions and policy inheritance, then test revoked, cross-tenant and reconnect cases before showing those controls. |

## Release sequence

1. Integrate and independently review the SIP tenant/credential seam without replacing the richer meeting router. Remove implicit owner-extension allocation. Keep the protected directory and current meeting admission checks.
2. Run TypeScript, desktop, PBX, chat and meeting suites against the combined commit. Run gated disposable-PostgreSQL concurrency and migration tests in an isolated database. A skipped test is not a pass.
3. Verify the deployed database schema, selected-tenant mappings and Connect11 `phone11-plain-video.v1` grant. Its current token request accepts only opaque `meeting_id`, `participant_id` and `grant_profile`; keep the optional display-name request disabled until the provider contract supports it.
4. Stage server and client releases with rollback pins. Verify authenticated endpoints, provider admission and signed macOS/Windows/iPhone behavior separately. Preserve the already working mobile SIP wake path.
5. Only after the core route passes, add scheduling, lobby/moderation, transfer and owner-bound voicemail to close the remaining Zoom-workflow gaps.

Source tests, a built bundle and an authenticated token do not prove live audio, push or background ringing. This document is not a statement of complete Zoom Phone or Meetings parity.

## Remaining Zoom workflow slices

The source mapping above covers the core daily-use path, not every Zoom control. The next distinct product slices are:

1. [Shared call history](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0069013): mobile Recents currently reads an owner-local store while desktop reads PBX CDR. A tenant- and user-bound reconciliation contract is required before claiming the same history on both clients; a CDR row alone does not establish call ownership.
2. [Meeting scheduling](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060700): immediate channel/direct rooms must not be repurposed as future meetings. Scheduling needs durable time, invitee, cancellation, expiry and reminder state, plus the corresponding server authorization.
3. [In-meeting collaboration and moderation](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0062674): current rooms have basic participant, microphone, camera and leave controls. Screen sharing, meeting chat, waiting-room and host actions need provider-capability checks and server-authoritative policy before the controls are shown.
4. [Phone transfer and voicemail](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0066777): transfer remains narrower than Zoom Phone. Mailbox configuration and schema checks do not establish completed-message delivery, owner-bound storage, playback or deletion. Both require PBX-backed end-to-end tests.
5. [Admin onboarding and delegation](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060257): the admin UI currently manages assigned users and extensions but does not create or invite users. A verified invitation sender, identity lifecycle and target-scoped role checks are required before adding onboarding and delegated Phone administration.

## Related product boundaries

Phone11 Team Chat is the internal workspace conversation store; Super Number's external LINE OA Inbox keeps its separate provider send and assignment path. Any shared tenant, user, or contact context must cross an explicit authenticated contract. The visible meeting notetaker is a shared note11/Super Number capability, not a second Phone11 bot or Zoom cloud-recording sync. These boundaries were coordinated with the `Complete Super Number v7.2 Alpha` task on 2026-09-28; they do not imply either provider feature is live.

## Candidate verification on 2026-09-28

- Root TypeScript check and server bundle passed after the combined desktop/mobile changes. The full root test command passed, including 69 native Node tests; environment-gated Vitest cases were skipped, not counted as passes. Focused iOS native wake tests also passed after the bridge-reload lease fix. The changed JavaScript/TypeScript files have zero ESLint errors; the repository-wide lint still fails on a larger existing backlog.
- Desktop app typecheck, build and 44 Node tests passed after adding channel Meet now. The synthetic Electron meeting preview reached and passed its assertions before this change, but its runner timed out while closing Electron, so that preview gate remains unresolved and the new picker has no physical desktop-media acceptance yet.
- On disposable local PostgreSQL, 164 PBX/migration/provisioning tests, three selected-directory tests, and the channel and direct meeting concurrency tests passed. No hosted database was changed.
- No candidate API deployment, Connect11 provider admission, signed iPhone build, signed desktop package, or two-device Phone/meeting acceptance was performed by these checks. The feature branch is substantially divergent from `origin/main`; its SQL migration chain and provider configuration must be reconciled with the actual deployment target before rollout.

## Mainline integration and release gate

The isolated `codex/phone11-zoom-mainline-integration-20260928` branch merges the candidate with `origin/main` at `4b1f6f1`. The merge preserves explicit selected-tenant SIP assignment, user-only secret provisioning, and fail-closed reset when a subscriber is missing; it also retains mainline SIP URI collision and subscriber-consistency checks. It does not silently recreate the old tenant-1 pilot assignment. The stale V61 and V62 EC2 patch workflows are manual-only. Generic EAS production builds now activate the App Store guard, while the dedicated Siprix store profile remains the signed iOS path.

On this isolated source, TypeScript and backend bundle checks passed, 2,278 Vitest tests passed with 331 environment-gated skips, and the 69 native Node tests passed after locally staging the checksum-verified, ignored Siprix trial SDK and test dependencies. Focused PBX tests passed 139 cases with one skip; five SIP lifecycle tests passed on disposable PostgreSQL. These results do not validate the hosted schema. Read-only preflights against the disposable meeting and PBX fixtures reported incompatible because those fixtures do not contain the full protected-clone prerequisite schema. A real protected-clone preflight, migration-order review, and authenticated tenant/provider checks are still required.

A future push to `main` would build a backend image and automatically deploy it to EKS **staging** after successful CI. No push has occurred. That path does not ship a signed mobile or desktop app. Before any mainline push or signed release, pin rollback images, prove the actual database migrations and tenant assignments, confirm Connect11 admission, and run two-device call/meeting audio, background wake, invite, and reconnect tests on the resulting signed builds.
