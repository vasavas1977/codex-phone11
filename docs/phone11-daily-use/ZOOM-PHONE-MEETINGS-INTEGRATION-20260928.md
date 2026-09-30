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
| [Start or join a meeting](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060700) | Mobile has channel/direct actions. Desktop offers channel Meet now with current members selected by default and optional deselection, plus a direct-contact Meet now chooser. Protected search and paging reach older direct chats; name and tenant extension distinguish contacts with the same name. The desktop direct path rechecks the selected tenant, current two-member chat, host capability, and exact returned peer and room. Both use server admission and select the returned exact room for prejoin; a conversation invitation no longer asks the user to choose an unrelated room. | Deploy the whole chat/auth/meeting migration chain, prove both users receive the invite and join the same room, and test expiration/revocation. General scheduling remains unbuilt and needs its own durable meeting lifecycle. |
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
5. [Admin onboarding and delegation](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060257): tenant-scoped invitation and acceptance source is under review on the 30 September branch. Its migration, sender and deployment remain gated; it does not yet establish a live onboarding flow or delegated Phone administration.

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

The inherited workflows automatically built an image on `main` and deployed it to EKS staging after image-build success, independently of test CI. The 29 September release correction makes those operational workflows manual-only. They do not ship signed mobile or desktop apps, and EKS is not the verified active Phone11 backend. Before a runtime release, pin rollback images, prove the actual database schema and tenant assignments, confirm Connect11 admission, and run two-device call/meeting audio, background wake, invite, and reconnect tests on the resulting signed builds.

## Active release target verified on 2026-09-29

The read-only runtime inventory supersedes historical port-3010 topology notes for the current tRPC route. Both `/api/trpc` and `/api/trpc/` route to `127.0.0.1:3016` on the existing VoIP EC2 host. That workerless service is `cp11-api-candidate-sip-consistency`, build `sip-admin-6180658`, image `sha256:920f21217b57750184ce546e47a6a9d93dd81787f74ff3bf76fb6faa905534c7`. Preserve it as the current route predecessor; recheck its container ID and Nginx hash immediately before any switch. The inventory is a timestamped pin, not an activation receipt.

The port-3000 `cp11-backend` remains image `sha256:d42c70f34d5062bff779c235dd2b6e415bede3b3a86b9de73892acf35b392619`; password recovery remains on port 3004. The generic EC2 deploy workflow replaces that port-3000 baseline and is unsuitable for releasing this workerless candidate. A release must use a separately reviewed candidate topology and preserve the baseline, dedicated routes, and SIP wake behavior.

Repository `AWS_REGION` is `ap-southeast-7`. The accessible AWS account has no EKS cluster there and no `cloudphone11/backend` ECR repository. GitHub's deployed credential identity is unverified; do not infer that its account is the same. No EKS target or rollback image has been commissioned by this audit.

The manual EKS workflow requires an existing digest-pinned predecessor and resolves the requested commit tag to an immutable ECR digest. It refuses a mutable predecessor such as the base manifest's `:latest`. Commissioning that path requires a separately reviewed pin of the actual running image; the release helper does not infer it from a mutable tag. Image builds publish only the commit tag, without advancing `latest`. Deploy and rollback use atomic Kubernetes resource-version/image tests, and rollback is considered even after an ambiguous patch-command failure. Eleven offline mocked tests passed and are wired into `Phone11 release guard checks`; these tests do not validate a live Kubernetes cluster or replace product acceptance.

The protected logical restore of the actual `cp11-postgres` / `phone11ai` database passed in an isolated PostgreSQL 16 clone. A separate read-only comparison with the seven pinned PR migrations found all 21 tables, 22 explicit indexes, four enabled triggers and three trigger functions matching source; no additive schema delta was justified or applied. Restore excluded owners/ACLs, and catalog equality does not prove authenticated tenant isolation or migration-ledger history.

The focused plain-video source checks passed 47 tests at `fb4e1daa`. Current Connect11 documentation confirms the three-field `phone11-plain-video.v1` join request and separate status and join/evict credentials. At 01:56 UTC on 29 September, one status-only GET from the active candidate's protected configuration returned HTTP 200: the strict capability contract matched, availability was true, both grant profiles were advertised, TTL was 300 seconds, and interpreter dispatch was disabled. The tenant-1 configuration matched the locally protected customer/scope metadata, and display-name transmission was disabled. No join token was minted. Local metadata and capabilities do not independently prove current provider principal binding or media permission enforcement; token grants, admission revision checks, permanent revocation, and two-device audio/video remain separate acceptance gates.

No signed client package for `fb4e1daa` was found in the inspected build metadata. The iPhone daily-pilot profile remains the intended lane; desktop CI compiles/tests helpers but does not produce signed macOS or Windows installers. Verify current rollback IPA bytes, signing/provisioning and vendor redistribution terms before producing or installing release packages. Prior user-confirmed calling on an older build does not replace acceptance on the candidate revision.

The inspected iOS workflow result records finished Build 107 from older source `20809a8`. An existing local Build 71 IPA has SHA-256 `19f3f4c33e3d5812683a01e87245f864c0058a3d2082afad5479779f9b131b80` and matching package-verification records, but those records mark installation and handset acceptance pending. Its age and unproven rollback compatibility make it insufficient as the designated current rollback package.

The coordinating Connect11 task freshly checked AWS metadata at approximately 01:59 UTC: API task definition `connect11-prod-api:27` and worker `connect11-prod-worker:23` were running on release `a991df46046cbfd8c39d18e15a7445d572ff8284`, observed image digest `sha256:8e23cf6b36d1949484c02d587eddcbc40a27bfc42bad623113b09bb9bd38e66e`. Plain-video/eviction/persistence and revocation-attestation flags were enabled, and expected namespace fingerprints agreed. The API was healthy and public readiness passed. The worker has no task healthcheck, so running status does not establish queue processing. Actual join-key record correlation, runtime-loaded namespace fingerprint and eviction behavior remain unverified; obtaining them requires an existing scoped staff metadata session or read-only operator channel. No token, meeting or eviction was created by these checks.

## Source progress on 2026-09-30

The later personal-history slice adds a selected-workspace completed-CDR query
with call-time ownership, active membership/assignment rechecks and exact
timestamp keyset paging. Desktop exposes Load more and bounded call-end
reconciliation; mobile exposes Workspace history separately from This device
records. Read the [history contract and coverage limits](PERSONAL-CALL-HISTORY-20260930.md),
especially the still-unattributed internal/emergency ingestion paths. The
isolated PostgreSQL history suite passed; this slice postdates the running
3020 candidate and installed signed Build 110.

Desktop channel Meet now permits authorized channels with 51–100 invitees
to reduce the invite list to the existing 50-person limit. It still selects all
listed members initially, excludes the host, disables Start over the limit,
and checks selection again before IPC. The previous roster-size rejection
prevented this selection flow even though the backend accepts a smaller list.

The [voicemail lifecycle rehearsal](VOICEMAIL-PENDING-RECONCILIATION-20260930.md#isolated-lifecycle-rehearsal)
passes finalize-before-upload, lost-response replay, mailbox-path rejection
and simulated owner rejection. The local Lua harness also passes. Voicemail
remains default-off until actual FreeSWITCH final-WAV lifecycle and protected
playback are verified. An actual-target read-only schema inspection found
workspace settings and meeting admission compatible, while advanced PBX
commissioning is blocked by the nullable extension tenant column and absent
routing tables; the [release plan](EC2-CANDIDATE-RELEASE-PLAN-20260929.md#commands-ready-versus-still-blocked)
records the concrete results.

The current mainline integration source adds an in-room speaker output selector to the isolated desktop meeting window. Its Electron permission handler grants `speaker-selection` only to the exact meeting frame while no SIP call owns audio. The meeting client uses LiveKit's active output switch, disables the control when unavailable, serializes headset-change refreshes with a pending switch, and discards stale device results after meeting teardown. The mobile room adds guarded audio-output switching: iOS offers Automatic and Speaker; Android lists available routed outputs. Mobile route work is serialized with the meeting audio lease before it returns control to SIP. An iOS Bluetooth/AirPlay picker is intentionally deferred because the installed native picker has no completion or dismissal hook to prevent a late route change after SIP resumes.

The source also adds a default-off, tenant-scoped admin invitation path with single-use acceptance. Its separate [source and migration note](ADMIN-INVITATIONS-SOURCE-20260930.md) records the remaining live sender, database and authenticated acceptance gates. Neither source work nor a successful web export means these features are on the live Phone11 host or signed client packages. The active EC2 candidate still needs its exact schema and rollback checks, protected user/provider probes, a built candidate image, and physical two-client meeting audio and invite acceptance before a route change. Zoom-level transfer, shared call history, scheduling, moderation, voicemail delivery and Windows media acceptance remain open product work.

The desktop source now includes direct-contact Meet now with selected-tenant protected search, keyset paging, a protected capability recheck before starting, and an idempotent request ID on retry. An optional direct-search failure leaves admitted and channel meetings available. The voicemail read endpoint returns whether an owned unread row actually changed; desktop voicemail remains disabled while mailbox storage, delivery and owner-bound playback await live acceptance. The invitation source now has a disposable-PostgreSQL CI step. These additions have not been released to a signed client or the active API.

For the initial audio-output and invitation commit, root TypeScript and tests, backend bundle, desktop TypeScript/build and 48 desktop Node tests passed. The invitation/auth disposable-PostgreSQL suite passed 92 cases with one environment-gated browser skip; the intentionally rejected phase-2-before-phase-1 migration was tested. Focused ESLint and diff checks passed.

After direct-chat search, paging and extension labels were integrated, root TypeScript and backend build passed. A serial root test run passed 2,305 Vitest cases with 346 environment-gated skips, plus 69 native Node tests; a concurrent run had one unrelated profile-photo timeout, whose 18 focused tests then passed on rerun. Desktop TypeScript/build and 56 Node tests passed. The chat/notification disposable-PostgreSQL suite passed 91 cases, including older chats, same-name paging, tenant and block isolation; invitation/auth passed 92 with one skip. An independent source review found no remaining P0–P2 issue in the direct Meet slice. These checks do not establish production schema compatibility, email delivery, provider admission or physical audio routing.
