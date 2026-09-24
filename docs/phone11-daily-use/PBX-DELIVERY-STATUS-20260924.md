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
| Call from macOS or Windows | The responsive web UI has no SIP/media engine. [Desktop media spike](DESKTOP-PBX-MEDIA-SPIKE-20260924.md) selects a native Siprix path for both OSes. A versioned, source-tested desktop call boundary and a native helper bootstrap exist; the macOS arm64 helper builds and initializes locally. The Siprix trial is acceptable for prototype calls with its 60-second call limit. | Verify deployed TLS/SRTP ingress; implement privileged provisioning and real helper call operations, compile on Windows, package signed apps, then prove repeated inbound/outbound two-way audio and lifecycle cases. A paid redistribution license is needed before removing the trial limit. No desktop calling claim until that acceptance passes. |

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
5. Extend the macOS helper bootstrap to authenticated account and call media
   operations, then build the same helper on Windows. Prove both against the
   isolated PBX before packaging signed macOS and Windows apps around the
   tested boundary. Do not enable the browser dialer as a substitute for
   desktop calling.

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

On 24 September 2026, the web/mobile Vitest run completed with 2,061 passing
tests and 285 skipped; the separate Node/native-source suite passed 69 tests.
The targeted PBX admin, transfer and profile suites passed 143 tests with six
skipped. TypeScript checking, the backend bundle, the Expo static web export,
and changed-file lint (zero errors) also passed. The desktop call boundary
passed 19 focused Node tests and an independent source re-review found no
remaining P0–P2 issue in its End recovery path. The local macOS arm64 Siprix
helper compiled and passed its private-pipe bootstrap smoke test. A pinned
macOS/Windows build workflow is present in source but has not run on CI. These
checks do not constitute a signed iPhone or desktop build, a Windows build, a
live PBX route, an actual phone call, or production deployment.
