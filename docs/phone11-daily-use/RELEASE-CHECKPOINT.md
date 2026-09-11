# Phone11 daily-use release checkpoint

The opening implementation, verification and deployment sections record the first release on 10 September 2026. The latest signed and independently verified installation is [build 23](#signed-and-installed-candidate-build-23), source `f21e763`. The accepted direct echo remains build 19 evidence; build 23 physical call acceptance is pending. Public-number one-way audio remains unresolved; the temporary PCMA canary was inconclusive and has been rolled back.

10 September 2026. This release replaces the demo paths in the five main mobile tabs with real account, phone, directory and chat workflows. It is an internal preview, not Zoom feature parity or a production calling certificate.

## Implemented

- Enabled, authenticated phone accounts connect automatically in the foreground and recover after returning to the app. Reconnect is available without opening diagnostics. Recovery waits while a real call is active.
- Dialpad, Recents and Contacts share actual call creation, duplicate-tap protection, existing-call navigation, and account-change checks. In-call commands retain the real call on failure. End call stays outside the scrolling controls in a safe-area footer.
- Contacts come from explicit active workspace assignments. Calling requires the same phone tenant; messaging creates an authorized server conversation. No demo people or presence are displayed.
- Team Chat has private direct/group/channel conversations, saved messages, unread markers, paged history, scoped message search and explicit failed-message retry. Drafts and unsent messages persist by owner/workspace and clear on logout. Sent means server acknowledgement, not recipient receipt.
- Settings exposes actual connection, history, chat and sign-out actions. Unsupported SMS, video, transfer and voicemail paths have explicit unavailable states.
- Backend media and push routes enforce owner/integration authorization. Missing providers/storage report unavailable. The retired unscoped storage-signing proxy is disabled.

## First-release verification before deployment

- 174 combined calling, account, directory, media and push regression tests passed.
- 52 existing authentication client/UI tests passed.
- Chat state, restart persistence, controls and real PostgreSQL tests passed, including concurrent retries and cross-workspace denial.
- Additional Recents, native audio/SDP, packaging and legacy storage checks passed.
- Backend bundle and iOS JavaScript export passed. The repository-wide TypeScript check still has legacy diagnostics; these are not a clean full-project typecheck claim.
- Continuous integration now requires the daily-use tests and a disposable real PostgreSQL service before the existing native/signing build.

## Deployment and handset evidence

The first-release backend deployment and historical build 14 installation were verified as follows. Later handset builds are recorded below:

- Source: `75fa3c940aa983cff30ed967d444c73b43cc9a53`.
- Backend image: `sha256:baf25c98c7af79635cd81b7a1cc0d09292491d87264c75fd5f2239771a64b4a0`. Existing runtime settings, network, port and storage were preserved. The original image/Compose remain available for application rollback.
- Chat migration: three new tables, 18 columns and four foreign keys verified. Five existing phone-binding table digests remained identical. No conversations or messages were seeded.
- A complete 57,707-byte private database backup was saved before migration and its restore catalog parsed. A full restoration rehearsal was not performed.
- Candidate and public API checks passed with the existing approved owner: actual password sign-in, canonical profile, extension 3001/tenant 1 provisioning, authorized chat list/directory, sign-out and revoked-session HTTP 401. Probe credentials and session values were not published; the probe created no conversations or messages.
- Public workspace currently has zero conversations and zero other directory users. Two-person chat acceptance requires an explicitly authorized second account.
- Signed iOS build **14**, EAS build `07d50ba3-7983-46b6-8e88-24ac0cba5091`, completed in [GitHub run 34470366819](https://github.com/vasavas1977/codex-phone11/actions/runs/34470366819). Exact source matched. The 16,556,558-byte IPA SHA256 is `be8f351d0681cc425fb77262bddf44874075594c23a6bfd85ec387486cc5d58b`.
- Build 14 installed successfully in place on the existing paired iPhone. It has no configured production Siprix license and remains a trial. At that checkpoint, physical UI/call testing awaited the owner's Mac unlock for iPhone Mirroring; installation alone did not prove audio, reconnection, or public-number receipt.

Subsequent push-engineering changes are a separate candidate, not part of this deployed/installed source. The candidate adds durable session-bound device records, explicit APNs HTTP/2 delivery, and a disabled native PushKit foundation. The subsequent disabled integrated wake candidate now implements native bootstrap, SIP/CallKit correlation and scoped wake grants; see [the current candidate](NATIVE-WAKE-CANDIDATE.md). Proxy commissioning and physical wake/media acceptance remain open; provider credentials alone do not complete background calling. See [native foundation](NATIVE-PUSH-FOUNDATION.md) and [server candidate](SERVER-PUSH-CANDIDATE.md).

### Previous installed app: build 15

Build **15** superseded build 14 on the paired iPhone. Its source is `ab518f6396b0141be633b7ce11ed984622ac113a`, and signed EAS build `3d00896a-f0be-4fee-afa5-e8f008687a92` passed every required check in [GitHub run 34473813573](https://github.com/vasavas1977/codex-phone11/actions/runs/34473813573). This includes actual iOS native linking, the real PostgreSQL chat/push/auth tests and mobile regression checks. The IPA is 16,565,794 bytes, SHA256 `83e0908c8ccba41d01281a487f6f6ce4ee55fd394b5bca1ba2a4c8e344a6e818`. Installation succeeded and the device inventory independently reports version 1.0.0/build 15 with the expected bundle identifier.

Build 15 adds the disabled native push foundation and bounded sign-out cleanup. It still has no production Siprix license. Push registration remains compiled off; no Apple delivery or cold/locked calling is claimed. The live backend still runs `75fa3c9`; the separate server push migration/candidate has not been deployed. On 11 September, device inventory and foreground UI were checked again. An outgoing echo connected and appeared once in Recents; physical audio and End confirmation remain pending. A direct incoming retest received no handset response. See the [handset checkpoint](HANDSET-20260911.md). Further acceptance should use Phone11 open on the physical phone because iPhone Mirroring disconnects during calls.

The immediately preceding build 13 passed a direct incoming echo call and handset-initiated hang-up, confirmed by the user. That call bypassed the public-number carrier; public DID inbound acceptance remains separate. Earlier outbound PSTN testing also does not prove every new release or network state.

### Previous answer repair: build 17

The 11 September answer-control repair is signed as **build 17**, source `b284243d86a14eb55225be0b61148184d4f969df`. The exact-source [signing workflow](https://github.com/vasavas1977/codex-phone11/actions/runs/34559119758) passed all required checks; the downloaded app version and bundle were verified. After the user reconnected the iPhone, the verified IPA was installed successfully and independent device inventory confirmed version 1.0.0/build 17. The first build 17 incoming test answered but was cut short by the test helper; a corrected retry rang and timed out unanswered. Audio and handset End acceptance remain open. See the [build 17 handset checkpoint](HANDSET-BUILD17-20260911.md). See the [answer repair checkpoint](ANSWER-CONTROLS-20260911.md) for the artifact hash and verification details.

### Previous installed app: build 18

Build **18** was installed and independently verified on the paired iPhone, before build 19 superseded it. Exact source `89288f8683b70ab71428eb9d592ed92925eb019d` passed [signing workflow 34569374391](https://github.com/vasavas1977/codex-phone11/actions/runs/34569374391); EAS build `e32b0f23-b501-4bcf-97d9-997eb94a4ec8`. It keeps current incoming calls reachable from stale or wrong-type call screens, binds banner actions to their owner/call, and preserves ordered Answer diagnostics. All 112 focused tests passed. The 16,569,291-byte IPA SHA256 is `da16c2e826989c037a4db978d98850d71c0c9af4a160294743e16f2fd74acc54`.

A new physical test on build 18 rang, connected through the in-app Answer action and ended from the handset after approximately 17 seconds. The owner reported missing or unclear echo; the exact-call server record shows zero audio packets in either direction. Review identified that in-app Answer bypassed the system answer transaction used to activate CallKit audio. The correction and 147 focused regression tests are complete and installed as build 19 below; the subsequent bounded physical echo test passed. See the [audio repair and physical evidence](IN-APP-ANSWER-AUDIO-20260911.md). This is not public-number, background, long-call or two-person-chat acceptance. The live backend remains on the first-release source.

### Previous installed app: build 19 — foreground echo accepted

Build **19** routes in-app iOS Answer through the system CallKit answer transaction, preserves call/owner identity through pending actions and retries, and records bounded audio activation diagnostics. Caller labels now omit the SIP server URI. All 147 focused tests, iOS export, native and required server checks passed. Exact source `aba6ff24f6ebebd688c51dc669fd213cdae3d44b` completed [signing workflow 34577365729](https://github.com/vasavas1977/codex-phone11/actions/runs/34577365729); EAS build `05e5e98f-a61e-4532-b7d3-06c3bd68a877`. The 16,572,596-byte IPA SHA256 is `08e42e4fe9da52097b143838ca7342aeeac22674db7edbf5f200dfefbf7045d5`. Installation succeeded and independent device inventory confirmed version 1.0.0/build 19.

The owner confirmed that build 19 connected, played clear echo and ended immediately. Handset diagnostics establish the in-app system Answer and actual audio activation; independent server records confirm media in both directions and a phone-initiated End before cleanup. The post-call physical screen returned to Ready to call and showed the test caller in its recent list. This closes the build 18 foreground in-app Answer/audio failure for the bounded direct echo path. See the [audio repair checkpoint](IN-APP-ANSWER-AUDIO-20260911.md).

## Remaining production gates

The owner initially reported silence in both directions on a call to 02-030-3001. Later matched calls established the current symptom: Phone11 hears the caller, but the caller cannot hear Phone11. Public-number two-phone audio is **failing and unresolved**. Packet forwarding and aggregate outgoing G.711 energy have been observed, but carrier intelligibility has not been established. The PCMA-only interoperability canary was inconclusive and was rolled back; see [the current investigation](#build-21-public-number-investigation-11-september). The successful build 19 direct echo remains evidence only for its bounded foreground path.

Build 19 now has physical foreground direct incoming, in-app Answer, clear echo and immediate handset End acceptance. The earlier [build 15 checkpoint](HANDSET-20260911.md) remains historical; this short direct echo bypassed the public carrier and does not establish the remaining gates below.

Incoming public-number calling, native PushKit/APNs delivery while locked/backgrounded, production Siprix licensing and long calls, two authorized chat clients, and physical audio-route/control tests remain separate acceptance gates. Background calling has a disabled integrated source candidate signed and installed as build 21; approved deployment/commissioning and physical acceptance remain required. Production credential revocation may require additional engineering. These are not credentials-only blockers.

The optional production license now has a native prebuild-only configuration path that excludes the value from public Expo configuration. A configured value alone is not proof that the SDK accepted a valid license or that a long call passed.

See [the researched gap audit](ZOOM-GAP-AUDIT.md), [chat deployment instructions](../../server/chat/README.md), and [backend compatibility changes](backend-security.md). Later PBX and collaboration features must be accepted before their controls are enabled.


### New daily-use source candidate: 11 September

The integrated daily-use candidate was signed and installed as build 21 from `54923dc9583987fa5e1ee0bd5cb0407a8ff9c6c4`. Its public-number tests below have not achieved two-way audio acceptance. Later registration and incoming-screen fixes are signed and artifact-verified as build 23 from `f21e763`; build 23 is now installed and independently verified. See [build 21 installation evidence](#signed-and-installed-candidate-build-21) and [the latest installed candidate](#signed-and-installed-candidate-build-23).

The next candidate repairs chat draft/outbox scope, authoritative unread counts and message ordering. Every queued chat operation captures its authenticated actor; the server checks the new owner assertion and trusted-origin CORS permits that header. Deploy the server compatibility change before a browser client using the header. The server remains authority for workspace membership and message access.

Background calling now has an integrated, disabled source implementation. Native bootstrap shares the existing SDK and CallKit provider; a scoped device/session grant fetches the currently assigned SIP credentials into memory, exact wake UUIDs correlate the delivered INVITE, and Answer waits for that call. PostgreSQL enforces current session/assignment authority, serializes incoming calls, retains caller-cancellation tombstones, and prevents expired credentials escaping after lock/network waits. A separate bounded busy lease supports active calls without extending credential access. Same-device token refresh retains its grant; logout and reassignment revoke it. Full SIP credential revocation still requires PBX password rotation.

The native commissioning flag remains zero and server wake enablement defaults off. Build 21 is installed, but its public-number tests still fail two-way hearing. Signing/installation do not establish public-number audio, Apple delivery, locked-device calling, long licensed calls or two-person chat. A scoped PCMA-only carrier-pilot test was later applied, checked and rolled back without a matched initial call; it did not establish a codec fix or regression.

Final local integrated verification passed 572 tests across 44 files, ten native compilation/runtime checks and 17 packaging/plugin checks, plus backend compilation, iOS JavaScript export and real isolated Expo iOS prebuild. Earlier scoped checkpoints included 543 tests across 42 files, nine native checks, 12 packaging/plugin checks, 40 HTTP/service tests, 41 real wake database tests and 56 authentication client/UI tests. These overlapping historical and scoped totals must not be added to the final integrated total. The disabled proxy candidate passed four static guards and exact Kamailio 5.8.4 parser checks in both gate states. Seven isolated synthetic SIP scenarios subsequently passed, including one original INVITE, duplicate suppression, UUID correlation, cancellation and actual timeout. These tests have no real media/provider endpoints. Repository-wide TypeScript still contains pre-existing diagnostics; no clean whole-repository typecheck is claimed. Exact-source signing, artifact identity and independent installation evidence are recorded below.

Foreground enrollment maintenance now recovers after login/account changes and app return, renews near-expiry grants while idle, and retries transient failures. It runs independently of call-entry/Answer, cancels when a real call starts, and remains inert behind the native disabled gate. The 53 focused refresh/client/Answer checks passed independently. The full private wake-routing candidate also passed the actual installed Kamailio parser without a reload or call. Subsequent two-phone public-number tests remain one-way; their matched forwarding and energy evidence is recorded below.

Build 20 reached EAS for source `9a1dc33681b845bb036f92b4e97b6a45cc1cb167` but failed during Prebuild; no IPA was produced or installed. The launch matcher incorrectly treated a later superclass method call as another launch declaration. It now matches the complete method declaration, with the actual generated Expo 54 AppDelegate as a regression fixture. All 17 plugin/packaging checks and a real isolated Expo iOS prebuild pass. The signing workflow now requires that real generation check before submitting to EAS.

### Signed and installed candidate: build 21

Exact code `54923dc9583987fa5e1ee0bd5cb0407a8ff9c6c4` passed [signing workflow 34593302684](https://github.com/vasavas1977/codex-phone11/actions/runs/34593302684). EAS build `6d4153f6-644a-49cf-bcf9-28c2a511fd64` reports `FINISHED`. The verified artifact is version **1.0.0**, build **21**, bundle `space.manus.phone11ai.t20260425073427`. The IPA is **16,599,251 bytes**, SHA256 `2587eff28183f2b9002292a029a9f684f1bbdc1cba535161be20a53708a5369e`. ZIP integrity and embedded provisioning-profile presence were verified. Profile presence alone does not establish commissioned Apple delivery or an enabled wake path.

The native commissioning gate remains zero. Installation succeeded, and independent device app inventory confirms the expected bundle, version 1.0.0 and build 21. Build 19's accepted direct echo remains historical evidence for that version. Build 21 has been physically tested on the public-number path, but two-way audio acceptance failed. This signed build does not deploy the backend/proxy candidate or establish public-number two-way audio, APNs delivery, locked/background calling, licensed long calls or two-person chat.


### Build 21 public-number investigation: 11 September

The owner confirmed that a public-number call connected and Phone11 could hear the caller, but the caller could not hear Phone11. A matched passive trace captured ring, Answer, ACK and a handset-initiated End. It observed 601 handset-to-relay RTP packets and 601 forwarded to the carrier, with 595 packets in the reverse direction and no capture drops. The successful relay queries reported no stream errors. This establishes forwarding for the selected call, not audible speech in those packets or carrier playout. The earlier unmatched monitor used an outdated caller filter; a later cancelled attempt is separate from this connected call.

A subsequent dedicated-DID G.711 level test retained only aggregate numeric levels, not audio samples or recordings. The checker passed 18 offline tests plus an independent comparison of all 512 byte/codec decode cases. In the matched call, 660 outgoing PCMA packets contained 105,600 samples with RMS **1,208.43**, peak **17,920** and 12,834 samples above the configured nontrivial threshold. Incoming PCMU measured RMS **1,461.236**, peak **17,788** across 691 packets. There were no capture drops or observed relay stream errors. This establishes substantial outgoing signal energy, not intelligible speech or carrier playout; the user still reported one-way hearing. The monitor reached its bounded deadline without observing BYE, so its completion did not establish that the call had ended.

Separately, source `230ebb0` fixes a reproduced registration timing issue: an accepted native registration command previously appeared unregistered, allowing a five-second restart before the existing pending-registration grace. It now remains registering until the actual SDK callback. All 83 focused engine/lifecycle tests and nine native checks passed, including 140 normal-runtime assertions. The unchanged Swift packaging check timed out locally twice without a compiler diagnostic. This fix is included in signed builds 22 and 23 and in the latest verified installation, build 23. It is not claimed as the one-way audio fix.


### PCMA interoperability canary — inconclusive, rolled back

A private candidate appended only `codec-strip=all codec-offer=PCMA codec-offer=telephone-event` to the two existing carrier-pilot offer branches. It preserved the dedicated DID/3001 scope, FreeSWITCH branches, security/NAT/routing and RTP/SRTP settings. Exact Kamailio 5.8.4 parsing and six isolated semantic checks using the installed RTPEngine 9.4 image passed, including repeated codec flags, initial offer/answer, both re-offer directions and telephone-event payload preservation. Multi-codec asymmetric G.711 remains standards-valid; the candidate tested interoperability rather than an established codec defect.

After idle checks, the candidate configuration `b0d449b54b126e4e2a2b095919d39f17b395d5eec8d537c3f24803e51c47357b` was applied and service health checked. The bounded monitor did **not** capture a matching initial call (`triggered: false`), while the user reported an indefinitely displayed Answering state. This result is **inconclusive**: it proves neither a codec fix nor a codec-induced regression.

The original configuration was restored after fresh zero-active-call checks, and health was verified. Private rollback evidence confirms both host and container SHA256 `bb9168b3a9c312ea05267af290c3d9e581a5b31c199f905bfb410c8e986ae378`. The canary is no longer active. The private packet/level/rollback artifacts retain the detailed evidence; no caller identity or device identifier is published here.

### Signed candidate: build 22 — installation not verified

The registration fix passed [workflow 34599327212](https://github.com/vasavas1977/codex-phone11/actions/runs/34599327212) for exact source `38ada268dafa6697f6681de5143e166b5c1bb641`. EAS build `354a3990-16cc-4ed7-8597-32288f423283` finished. The artifact was independently checked as version **1.0.0/build 22**, **16,599,195 bytes**, SHA256 `9cbce10554b68b38a9db32c65ecab9e08b6af3cdb755eaab878a0114e1539b4c`. ZIP integrity, expected application identity and embedded provisioning profile were verified. The installation attempt stalled/failed as device connectivity was lost; build 22 installation is **not verified**. Build 23 subsequently installed successfully and is the latest independently verified installation.

### Signed and installed candidate: build 23

Source `f21e763479b2cf1aac1bb31aaf6be25b8e214ff7` adds bounded incoming-screen feedback to the registration fix. After an accepted Answer remains unconnected for 20 seconds, the screen shows **Not connected** and a clear End call action. A pending End stays pending until the actual terminal event, with call/owner guards and duplicate-action protection. This repairs misleading or trapped controls; it does not establish that the underlying native connection failure or public-number one-way audio is resolved.

The incoming controls passed **23** focused tests; **66** adjacent checks and an independent **62**-check overlapping review also passed. These overlapping totals must not be added. [Workflow 34601224621](https://github.com/vasavas1977/codex-phone11/actions/runs/34601224621) succeeded; EAS build `24201ece-fcc2-45df-b0eb-9392968e7559` finished. The verified artifact is version **1.0.0/build 23**, **16,601,007 bytes**, SHA256 `84235774a43aeeb0a242b6e92726a05f74fdcab60f1fb52e1de947544752e2e7`. Content length, ZIP integrity, application identity and provisioning-profile presence were checked; its signing identity matches build 21.

After the iPhone reconnected over USB, build 23 installed successfully. The installer reported completion, and independent device inventory confirms the expected application identity, version **1.0.0** and build **23**. Automated launch was rejected by the iOS process-control service; opening the app on the physical phone and call acceptance remain pending. The live backend remains `75fa3c9`, the PCMA canary is rolled back, and native/server background calling remains disabled.
