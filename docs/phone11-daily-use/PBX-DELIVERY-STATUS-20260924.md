# Phone11 PBX delivery status — 24 September 2026

This is the current source and release boundary for the request to bring
Phone11's mobile app, macOS/Windows desktop app, and company admin portal
closer to Zoom Phone. The [Zoom Support feature research](ZOOM-PHONE-FEATURE-RESEARCH-20260924.md)
describes the reference workflows. Similar menu labels do not establish
working PBX behavior.

| User outcome | Phone11 source state | Next proof or implementation |
| --- | --- | --- |
| Dial/answer an assigned extension on iPhone | Native Siprix/CallKit pilot exists; actual call and background behavior depend on the installed signed build and PBX. | Re-run two-handset foreground, locked, Wi-Fi and cellular calls on the exact candidate. |
| Mute, hold, keypad and speaker | Native call controls exist. | Verify each control during a live two-way call; preserve the current call if a control fails. |
| Direct call transfer | This source candidate adds a simple destination screen, available only when the installed iOS bridge advertises callback-confirmed blind transfer. | Sign a new build and prove successful and rejected PBX REFER against a second endpoint. Warm and voicemail transfer are separate work. |
| Recents and voicemail | Local call history and authenticated personal voicemail playback exist in source. | Prove missed calls while the app is unavailable, multi-device CDR reconciliation, protected playback and mailbox ownership on the deployed service. |
| Manage existing users and extensions | The Phone11 admin portal has API-backed membership role/status and extension assignment. This source candidate adds explicit workspace selection for these operations. | Deploy matching API/web versions and test owner, admin, member, revoked user and two-tenant access; identity creation/invitations remain a separate shared-account workflow. |
| Configure DID, IVR, ring group, queue and business hours | API-backed screens and advanced routing schema exist in source, including action/member/agent/rule editors. This candidate scopes DID inventory and workspace timezone settings to a selected tenant. It disables DID route editing for multi-workspace admins until destination lists also use that tenant. A separate, unapplied number-inventory migration stages new numbers as pending and creates no carrier assignments or routes. | Review and commission the optional schemas and exact Kamailio/FreeSWITCH routes in an isolated tenant, then exercise a real test DID through each path and failure fallback. Carrier-verified activation and E911 provisioning remain separate operator work. Other multi-workspace routing sections still need explicit tenant inputs on every route. |
| Call from macOS or Windows | The responsive web UI has no SIP/media engine. [Desktop media spike](DESKTOP-PBX-MEDIA-SPIKE-20260924.md) selects a native Siprix path for both OSes. A versioned desktop call boundary and a native helper with private-pipe account provisioning, one-call dial/answer/end, mute, hold/resume and DTMF controls exist in source. The macOS arm64 helper builds and passes bootstrap and fake-SDK call-control tests. The Siprix trial is acceptable for prototype calls with its 60-second call limit. | Verify deployed TLS/SRTP ingress; connect the helper to an authenticated main-process adapter and app shell, compile on Windows, package signed apps, then prove repeated inbound/outbound two-way audio and lifecycle cases. A paid license is needed before removing the trial limit. No desktop calling claim until that acceptance passes. |

SIP provisioning is being tightened so the authenticated user must have an
active workspace membership, a matching explicit extension grant, and matching
extension/SIP-account ownership before receiving a password. Reassigning an
extension revokes former grants in the same transaction. Production encryption
now requires an explicit `SIP_DEK_SECRET`; changing that key without migrating
existing ciphertext would make those records unreadable. These source changes
need deployment-key provenance and a reviewed rollout before production use.
Admin extension creation now writes the assigned user's grant and the same
password into both the SIP account and Kamailio subscriber within one
transaction. Admin password reset rotates those two stores together and checks
that the account identity belongs to the selected extension. These paths have
isolated PostgreSQL commit/rollback coverage; a live SIP REGISTER remains to
be proven. Audit entries are written after commit through the existing
best-effort audit helper, so audit delivery itself is not atomic.

## Product and service ownership

- **Phone11:** PBX tenants and memberships, extensions, device bindings,
  company numbers, routing, CDRs, voicemail, internal chat and Phone11 admin
  authorization. The admin portal should remain at `/admin` on the Phone11 web
  origin and ordinary self-service at `/portal`.
- **Super Number:** shared company/account identity, invitations, entitlements
  and billing. The two products do not currently have a verified common
  provisioning API. Link identities through an explicit reviewed mapping of
  product tenant IDs and user IDs; email or company name is not sufficient.
- **Carrier/PBX operators:** number supply, porting, emergency support, live
  SIP/media transport and deployed call routing. A saved admin object is not
  proof that a carrier call reaches it.

## Release order

1. Complete and independently review the selected-workspace People,
   Extensions, DID inventory and Workspace settings API and portal changes.
   Keep route editing and other PBX admin routes blocked for accounts with
   multiple workspaces until all related reads and writes take an explicit
   tenant and enforce current membership.
2. Deploy the matching API and static portal to a controlled test environment.
   Test two tenants, one shared administrator, role revocation, extension
   assignment and cross-tenant denial. Record exact source/build/schema IDs.
3. Review the number-inventory migration against the selected database before
   applying it. It adds no number or route and defaults admin-created inventory
   to pending. Commission advanced routing with a read-only schema preflight,
   reviewed migration and PBX config. Use a non-customer, carrier-provisioned
   DID and real calls; capture ringing, answer, audio, fallback, CDR and audit
   evidence before any operator activates its route.
4. Sign the iPhone transfer candidate and run a real two-endpoint transfer
   matrix. Extend to warm and voicemail transfer only after separate native
   and PBX confirmation.
5. Connect the native helper's account and one-call operations to a privileged
   desktop session adapter, adding the remaining media controls and a minimal
   app shell. Build the same helper on Windows. Prove both against the isolated
   PBX before packaging signed macOS and Windows apps around the tested
   boundary. Do not enable the browser dialer as a substitute for desktop
   calling.

The first release should keep the UI small: **Phone** for dialing/history and
active-call actions; **Admin Portal** for People, Extensions, Numbers, Call
Routing and Reports. Deeper policy and emergency settings appear only when
their carrier, authorization and operational paths are verified. Zoom's
[admin setup](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060257),
[phone user management](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0069309),
and [call transfer guidance](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0064805)
inform this ordering; Phone11's actual support remains defined by its own
source, deployment and device evidence.

## Source verification for this candidate

On 24 September 2026, the latest full web/mobile Vitest run completed with
2,080 passing tests and 290 skipped; the separate Node/native-source suite
passed 69 tests. A separate isolated PostgreSQL run passed all 120 PBX admin,
provisioning and SIP-key tests, including commit/rollback, stale-grant and
subscriber-ownership cases. TypeScript checking, the backend bundle, and
changed-file lint (zero errors) passed. An earlier Expo static web export also
passed before these server/desktop-only changes. The desktop call boundary
passed 22 focused Node tests. The local macOS arm64 Siprix helper compiled and
passed its private-pipe bootstrap smoke, Answer/End, mute/hold/DTMF and
late-hold-recovery fake-SDK tests. Independent source re-review found no
remaining P0–P2 issue in the reviewed PBX credential and desktop hold paths. A pinned
macOS/Windows build workflow is present in source but has not run on CI. These
checks do not constitute a signed iPhone or desktop build, a Windows build, a
live PBX route, an actual phone call, or production deployment.
