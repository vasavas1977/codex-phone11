# Phone11 Phone and Meetings workflow mapping

Date: 2026-09-28. Zoom's documented tasks are the UX reference, not its branding or an integration with a Zoom account. This record distinguishes source integration from a deployed service, provider admission, and signed-device acceptance.

## Integration candidate

Branch `codex/phone11-zoom-feature-integration-20260928` starts from the feature-rich Phone11 source at `951162c`, rather than the older desktop-port branch with demo mobile Contacts and a simulated call screen. It retains tenant-bound Team Chat, mobile SIP calling, channel/direct meeting admission, mobile prejoin and room, desktop meeting window, and selected-workspace admin pages. It now also contains the later desktop call-state and voicemail safety fixes, the protected `pbx.directory.list` endpoint, and tenant-bound desktop Contacts. The candidate is a source branch; it is not a released build.

The directory requires an explicitly selected tenant, active tenant membership and an assigned active extension. It repeats that authority check in the row-producing query, filters to active tenant members, bounds search and pagination, and returns only display name, extension number and extension ID. The desktop discards results from a previous tenant/session and fills the dialpad when a contact is selected; it does not auto-call. Desktop sign-in now asks a multi-workspace user to select a workspace before SIP starts, then binds provisioning to that tenant and verifies the server's echoed tenant. Mobile SIP provisioning also uses the selected workspace, and a routine same-session auth refresh no longer tears down an active call. Changed credentials wait for ringing, active, held, and native wake calls to finish. This Phone directory intentionally lists callable active user extensions, including the caller; Team Chat's separate people picker excludes the caller and chat-blocked peers. Both use active membership and extension assignment, but their filters serve different actions.

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
| [Start or join a meeting](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060700) | Channel and direct-contact actions, participant selection and server admission exist. A conversation invitation resolves to its exact meeting rather than asking the user to choose an unrelated room. | Deploy the whole chat/auth/meeting migration chain, prove both users receive the invite and join the same room, and test expiration/revocation. General scheduling remains unbuilt. |
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

## Candidate verification on 2026-09-28

- Root TypeScript check and server bundle passed. The full root test command passed 2,255 Vitest tests plus 69 native Node tests; 326 Vitest cases were skipped by their explicit environment gates.
- Desktop app typecheck, build and 42 Node tests passed. The synthetic Electron meeting preview reached and passed its assertions, but its runner timed out while closing Electron, so that preview gate remains unresolved.
- On disposable local PostgreSQL, 164 PBX/migration/provisioning tests, three selected-directory tests, and the channel and direct meeting concurrency tests passed. No hosted database was changed.
- No candidate API deployment, Connect11 provider admission, signed iPhone build, signed desktop package, or two-device Phone/meeting acceptance was performed by these checks. The feature branch is substantially divergent from `origin/main`; its SQL migration chain and provider configuration must be reconciled with the actual deployment target before rollout.
