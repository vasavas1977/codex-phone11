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
| Call from macOS or Windows | The responsive web UI has no SIP/media engine. [Desktop media spike](DESKTOP-PBX-MEDIA-SPIKE-20260924.md) selects a native Siprix path for both OSes. A versioned desktop call boundary, privileged helper supervisor, native helper, protected credential provider, and minimal Electron trial shell exist in source. The helper implements one-call dial/answer/end, mute, hold/resume and DTMF through private pipes. The macOS arm64 helper builds and passes bootstrap and fake-SDK call-control tests. A local ad-hoc signed macOS package has passed integrity/signature checks and opened to sign-in. The Siprix trial is acceptable for prototype calls with its per-call 60-second limit. | Sign in with a test account, verify deployed TLS/SRTP ingress, compile and run on Windows, package formally signed apps, and prove repeated inbound/outbound two-way audio and lifecycle cases. A paid license is needed before removing the trial limit. No desktop calling claim until that acceptance passes. |

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
copied to an external staging directory passed full-tree integrity verification
and credential-free startup. The Electron 44 macOS arm64 trial package was
then built locally from committed app source with only the required staged
resources. The local bundle passed helper-tree and embedded-pin checks,
`codesign --verify --deep --strict`, and opened from its final Downloads path
to the sign-in screen showing the 60-second trial limit. It uses an ad-hoc
signature, not a Developer ID distribution signature or notarization.
Independent final source review found no remaining concrete P0–P2 packaging
issue. At packaging time, no account sign-in or live call had been observed. These
checks do not constitute a signed iPhone or distributable desktop build, a
Windows runtime build, a live PBX route, an actual phone call, or production
deployment.

The first local trial package mistakenly targeted `https://phone11.ai`, whose
public health endpoint reports old build `7b0c678` and whose auth-readiness
route is absent. A user sign-in attempt in that package displayed the generic
setup error. The intended backend `https://api.phone11.ai` reports auth ready
and email/password enabled; repository mobile and owned-auth settings also
point there. The macOS trial was repackaged with that exact API origin, passed
helper-integrity and ad-hoc signature checks, and opened to sign-in. An
authenticated retry and a call had not yet been observed. No backend deploy
was needed for that origin correction.

A separate local Windows x64 package workflow now checks the pinned official
Siprix SDK revision and DLL hashes, requires an externally compiled x64
Phone11 helper, and verifies the packaged helper and manifest pin. Its source
and failure paths passed local checks and independent review. No Windows
helper executable is available on this Mac, so the Windows package was not
created and no Windows sign-in, SIP, media, or trial cutoff was observed.

A read-only reachability probe from this Mac on 24 September resolved
`sip.phone11.ai` to `43.210.122.111`: TCP 5060 accepted a connection, while
TCP/TLS 5061 refused it. This is a single vantage-point network observation,
not a SIP registration or proof of the configured transport for either test
account. The desktop trial must use its server-provisioned transport; do not
switch it to plaintext solely to make the probe pass. Confirm the actual PBX
listener and certificate before a TLS desktop call acceptance test.

## Desktop trial sign-in recovery (24 September 2026)

The installed macOS trial authenticated against `https://api.phone11.ai` but
then reported that calling access could not be loaded. The live tRPC backend
served a phone configuration without `extension.id`, which the protected
desktop provider requires. The deployed backend bundle matched pinned source
commit `9aab162`; a narrow overlay brought its phone-provisioning read path to
the current tenant, active-membership, explicit-grant and SIP-digest checks.
One inactive historical SIP account for extension 1020 required the duplicate
identity guard to count only active, non-deleted competing accounts.

The replacement image `sha256:b714cec08a15f6465baba58204a3473494e8c043bd3cef5323b5a35d676f6baa`
was started on loopback port 3007 while the prior 3006 service remained live.
Its bundle SHA-256 is `8dda0429b527238d96e742f03e8c2f8b523247c705b5d3cf9350c0a57e699897`.
An isolated runtime probe returned configured extension ID 4 / 3001 for test
user 1, ID 1 / 1020 for test user 2, and no configuration for an unrelated
user; no SIP secret was printed. The Nginx tRPC route was then moved from
3006 to 3007 using the guarded operator and receipt at
`/var/lib/phone11-desktop-provisioning-route/20260924T163132Z-0e29f178edeecb57`.
The resulting site SHA-256 is
`66e18ffe1a93f643c541c501620b184fd31c2ce8958f1920947156ebe7e4b81f`.
Both API containers remained healthy and the public unauthenticated tRPC
request returned 401. After the user retried sign-in, direct inspection of
the installed Mac app showed `Tenant 1 · Extension 3001`, `Ready to call`,
and no active call. The renderer displays `Ready to call` only when its
calling state reports registration. Desktop sign-in, extension loading and
registered UI state are therefore observed; ringing and two-way audio still
need a real call test. Roll back with the guarded route operator and sealed
receipt if acceptance fails. The public `api.phone11.ai` origin is the desktop
API; `1toall.phone11.ai` does not serve this tRPC path.
