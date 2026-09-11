# Phone11 daily-use release checkpoint

10 September 2026. This release replaces the demo paths in the five main mobile tabs with real account, phone, directory and chat workflows. It is an internal preview, not Zoom feature parity or a production calling certificate.

## Implemented

- Enabled, authenticated phone accounts connect automatically in the foreground and recover after returning to the app. Reconnect is available without opening diagnostics. Recovery waits while a real call is active.
- Dialpad, Recents and Contacts share actual call creation, duplicate-tap protection, existing-call navigation, and account-change checks. In-call commands retain the real call on failure. End call stays outside the scrolling controls in a safe-area footer.
- Contacts come from explicit active workspace assignments. Calling requires the same phone tenant; messaging creates an authorized server conversation. No demo people or presence are displayed.
- Team Chat has private direct/group/channel conversations, saved messages, unread markers, paged history, scoped message search and explicit failed-message retry. Drafts and unsent messages persist by owner/workspace and clear on logout. Sent means server acknowledgement, not recipient receipt.
- Settings exposes actual connection, history, chat and sign-out actions. Unsupported SMS, video, transfer and voicemail paths have explicit unavailable states.
- Backend media and push routes enforce owner/integration authorization. Missing providers/storage report unavailable. The retired unscoped storage-signing proxy is disabled.

## Verification before deployment

- 174 combined calling, account, directory, media and push regression tests passed.
- 52 existing authentication client/UI tests passed.
- Chat state, restart persistence, controls and real PostgreSQL tests passed, including concurrent retries and cross-workspace denial.
- Additional Recents, native audio/SDP, packaging and legacy storage checks passed.
- Backend bundle and iOS JavaScript export passed. The repository-wide TypeScript check still has legacy diagnostics; these are not a clean full-project typecheck claim.
- Continuous integration now requires the daily-use tests and a disposable real PostgreSQL service before the existing native/signing build.

## Deployment and handset evidence

The first release is now deployed and installed:

- Source: `75fa3c940aa983cff30ed967d444c73b43cc9a53`.
- Backend image: `sha256:baf25c98c7af79635cd81b7a1cc0d09292491d87264c75fd5f2239771a64b4a0`. Existing runtime settings, network, port and storage were preserved. The original image/Compose remain available for application rollback.
- Chat migration: three new tables, 18 columns and four foreign keys verified. Five existing phone-binding table digests remained identical. No conversations or messages were seeded.
- A complete 57,707-byte private database backup was saved before migration and its restore catalog parsed. A full restoration rehearsal was not performed.
- Candidate and public API checks passed with the existing approved owner: actual password sign-in, canonical profile, extension 3001/tenant 1 provisioning, authorized chat list/directory, sign-out and revoked-session HTTP 401. Probe credentials and session values were not published; the probe created no conversations or messages.
- Public workspace currently has zero conversations and zero other directory users. Two-person chat acceptance requires an explicitly authorized second account.
- Signed iOS build **14**, EAS build `07d50ba3-7983-46b6-8e88-24ac0cba5091`, completed in [GitHub run 34470366819](https://github.com/vasavas1977/codex-phone11/actions/runs/34470366819). Exact source matched. The 16,556,558-byte IPA SHA256 is `be8f351d0681cc425fb77262bddf44874075594c23a6bfd85ec387486cc5d58b`.
- Build 14 installed successfully in place on the existing paired iPhone. It has no configured production Siprix license and remains a trial. New physical UI/call testing is awaiting the owner's Mac unlock for iPhone Mirroring; installation does not prove audio, reconnection, or public-number receipt.

Subsequent push-engineering changes are a separate candidate, not part of this deployed/installed source. The candidate adds durable session-bound device records, explicit APNs HTTP/2 delivery, and a disabled native PushKit foundation. Native cold-launch/SIP resume, call correlation and proxy wake routing still require implementation; provider credentials alone will not complete background calling. See [native foundation](NATIVE-PUSH-FOUNDATION.md) and [server candidate](SERVER-PUSH-CANDIDATE.md).

### Previous installed app: build 15

Build **15** superseded build 14 on the paired iPhone. Its source is `ab518f6396b0141be633b7ce11ed984622ac113a`, and signed EAS build `3d00896a-f0be-4fee-afa5-e8f008687a92` passed every required check in [GitHub run 34473813573](https://github.com/vasavas1977/codex-phone11/actions/runs/34473813573). This includes actual iOS native linking, the real PostgreSQL chat/push/auth tests and mobile regression checks. The IPA is 16,565,794 bytes, SHA256 `83e0908c8ccba41d01281a487f6f6ce4ee55fd394b5bca1ba2a4c8e344a6e818`. Installation succeeded and the device inventory independently reports version 1.0.0/build 15 with the expected bundle identifier.

Build 15 adds the disabled native push foundation and bounded sign-out cleanup. It still has no production Siprix license. Push registration remains compiled off; no Apple delivery or cold/locked calling is claimed. The live backend still runs `75fa3c9`; the separate server push migration/candidate has not been deployed. On 11 September, device inventory and foreground UI were checked again. An outgoing echo connected and appeared once in Recents; physical audio and End confirmation remain pending. A direct incoming retest received no handset response. See the [handset checkpoint](HANDSET-20260911.md). Further acceptance should use Phone11 open on the physical phone because iPhone Mirroring disconnects during calls.

The immediately preceding build 13 passed a direct incoming echo call and handset-initiated hang-up, confirmed by the user. That call bypassed the public-number carrier; public DID inbound acceptance remains separate. Earlier outbound PSTN testing also does not prove every new release or network state.

### Previous answer repair: build 17

The 11 September answer-control repair is signed as **build 17**, source `b284243d86a14eb55225be0b61148184d4f969df`. The exact-source [signing workflow](https://github.com/vasavas1977/codex-phone11/actions/runs/34559119758) passed all required checks; the downloaded app version and bundle were verified. After the user reconnected the iPhone, the verified IPA was installed successfully and independent device inventory confirmed version 1.0.0/build 17. The first build 17 incoming test answered but was cut short by the test helper; a corrected retry rang and timed out unanswered. Audio and handset End acceptance remain open. See the [build 17 handset checkpoint](HANDSET-BUILD17-20260911.md). See the [answer repair checkpoint](ANSWER-CONTROLS-20260911.md) for the artifact hash and verification details.

### Previous installed app: build 18

Build **18** is installed and independently verified on the paired iPhone. Exact source `89288f8683b70ab71428eb9d592ed92925eb019d` passed [signing workflow 34569374391](https://github.com/vasavas1977/codex-phone11/actions/runs/34569374391); EAS build `e32b0f23-b501-4bcf-97d9-997eb94a4ec8`. It keeps current incoming calls reachable from stale or wrong-type call screens, binds banner actions to their owner/call, and preserves ordered Answer diagnostics. All 112 focused tests passed. The 16,569,291-byte IPA SHA256 is `da16c2e826989c037a4db978d98850d71c0c9af4a160294743e16f2fd74acc54`.

A new physical test on build 18 rang, connected through the in-app Answer action and ended from the handset after approximately 17 seconds. The owner reported missing or unclear echo; the exact-call server record shows zero audio packets in either direction. Review identified that in-app Answer bypassed the system answer transaction used to activate CallKit audio. The correction and 147 focused regression tests are complete and installed as build 19 below; the subsequent bounded physical echo test passed. See the [audio repair and physical evidence](IN-APP-ANSWER-AUDIO-20260911.md). This is not public-number, background, long-call or two-person-chat acceptance. The live backend remains on the first-release source.

### Latest installed app: build 19

Build **19** routes in-app iOS Answer through the system CallKit answer transaction, preserves call/owner identity through pending actions and retries, and records bounded audio activation diagnostics. Caller labels now omit the SIP server URI. All 147 focused tests, iOS export, native and required server checks passed. Exact source `aba6ff24f6ebebd688c51dc669fd213cdae3d44b` completed [signing workflow 34577365729](https://github.com/vasavas1977/codex-phone11/actions/runs/34577365729); EAS build `05e5e98f-a61e-4532-b7d3-06c3bd68a877`. The 16,572,596-byte IPA SHA256 is `08e42e4fe9da52097b143838ca7342aeeac22674db7edbf5f200dfefbf7045d5`. Installation succeeded and independent device inventory confirmed version 1.0.0/build 19.

The owner confirmed that build 19 connected, played clear echo and ended immediately. Handset diagnostics establish the in-app system Answer and actual audio activation; independent server records confirm media in both directions and a phone-initiated End before cleanup. The post-call physical screen returned to Ready to call and showed the test caller in its recent list. This closes the build 18 foreground in-app Answer/audio failure for the bounded direct echo path. See the [audio repair checkpoint](IN-APP-ANSWER-AUDIO-20260911.md).

## Remaining production gates

The owner subsequently reported a call to 02-030-3001 that connected but was silent in both directions. Public-number two-phone audio is **failing and unresolved**. The successful build 19 direct echo proves only its bounded foreground path; it does not close this separate carrier/media-relay path. A matched, monitored repeat is being prepared; see the [audio investigation record](IN-APP-ANSWER-AUDIO-20260911.md).

Build 19 now has physical foreground direct incoming, in-app Answer, clear echo and immediate handset End acceptance. The earlier [build 15 checkpoint](HANDSET-20260911.md) remains historical; this short direct echo bypassed the public carrier and does not establish the remaining gates below.

Incoming public-number calling, native PushKit/APNs delivery while locked/backgrounded, production Siprix licensing and long calls, two authorized chat clients, and physical audio-route/control tests remain separate acceptance gates. The commissioned background call path still requires implementation as well as provider configuration. Do not describe these as credentials-only blockers.

The optional production license now has a native prebuild-only configuration path that excludes the value from public Expo configuration. A configured value alone is not proof that the SDK accepted a valid license or that a long call passed.

See [the researched gap audit](ZOOM-GAP-AUDIT.md), [chat deployment instructions](../../server/chat/README.md), and [backend compatibility changes](backend-security.md). Later PBX and collaboration features must be accepted before their controls are enabled.
