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
| Call from macOS or Windows | The responsive web UI has no SIP/media engine. [Desktop media spike](DESKTOP-PBX-MEDIA-SPIKE-20260924.md) selects a native Siprix path for both OSes. A versioned desktop call boundary, privileged helper supervisor, native helper, protected credential provider, and minimal Electron trial shell exist in source. The helper implements one-call dial/answer/end, mute, hold/resume and DTMF through private pipes. The macOS arm64 helper builds and passes bootstrap and fake-SDK call-control tests. The Siprix trial is acceptable for prototype calls with its per-call 60-second limit. | Finish independent review of the desktop shell and full packaged helper tree, then verify deployed TLS/SRTP ingress, compile on Windows, package signed apps, and prove repeated inbound/outbound two-way audio and lifecycle cases. A paid license is needed before removing the trial limit. No desktop calling claim until that acceptance passes. |

SIP provisioning in this source candidate requires the authenticated user to have an
active workspace membership, a matching explicit extension grant, and matching
extension/SIP-account/subscriber identity and digest before receiving a password.
Ambiguous global SIP identities fail closed. Reassigning an extension revokes
former grants and rotates its authentication in the same transaction. Suspending
an extension or deactivating its workspace member revokes its subscriber
authentication; re-enabling it requires an active assignee and mints a fresh
secret. The admin API no longer returns the plaintext password on create/reset,
and PBX audit reads redact legacy credential fields. A cached Kamailio
registration and an established call can outlive this database revocation;
the [registrar acceptance procedure](PBX-SIP-REVOCATION-ACCEPTANCE-20260924.md)
must be completed before claiming immediate offboarding. Production encryption
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
5. Complete the protected desktop provider and minimal Electron shell review,
   including integrity verification for the Siprix libraries that the OS loader
   uses. Build the helper on Windows. Prove macOS and Windows against the
   isolated PBX before packaging signed apps around the tested boundary. Do
   not enable the browser dialer as a substitute for desktop calling.

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

On 24 September 2026, the full web/mobile Vitest run completed with
2,088 passing tests and 291 skipped; the separate Node/native-source suite
passed 69 tests. An isolated PostgreSQL focused run passed 131 PBX admin,
provisioning and legacy-admin tests after the SIP revocation and authorization
edits. TypeScript checking, the backend bundle and `git diff --check` passed.
The desktop call boundary and supervisor passed 37 focused Node tests after
the independent stale-session fix; the local macOS arm64 Siprix helper compiled and
passed its private-pipe and fake-SDK call-control smoke tests. The pinned
Windows SDK source contract passes locally, but the macOS/Windows build
workflow has not run on CI. The authenticated provider's focused tests passed
and its sign-in/grant lookup had an independent read-only source review. After
the packaging and stale-update fixes, the desktop boundary/provider tests
passed 43/43 and Electron shell tests passed 5/5. A real macOS helper bundle
copied to a temporary staging directory passed full-tree integrity verification
and credential-free startup; the Electron 44 trial window opened and displayed
its local sign-in screen. Independent final source review found no concrete
P0–P2 issue. This is not a packaged Electron launch, account sign-in, or call.
These checks do not constitute a signed iPhone or
desktop build, a Windows build, a live PBX route, an actual phone call, or
production deployment.

A read-only reachability probe from this Mac on 24 September resolved
`sip.phone11.ai` to `43.210.122.111`: TCP 5060 accepted a connection, while
TCP/TLS 5061 refused it. This is a single vantage-point network observation,
not a SIP registration or proof of the configured transport for either test
account. The desktop trial must use its server-provisioned transport; do not
switch it to plaintext solely to make the probe pass. Confirm the actual PBX
listener and certificate before a TLS desktop call acceptance test.
