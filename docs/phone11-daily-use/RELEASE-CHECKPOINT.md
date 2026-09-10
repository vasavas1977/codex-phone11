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

### Latest installed app: build 15

Build **15** now supersedes build 14 on the paired iPhone. Its source is `ab518f6396b0141be633b7ce11ed984622ac113a`, and signed EAS build `3d00896a-f0be-4fee-afa5-e8f008687a92` passed every required check in [GitHub run 34473813573](https://github.com/vasavas1977/codex-phone11/actions/runs/34473813573). This includes actual iOS native linking, the real PostgreSQL chat/push/auth tests and mobile regression checks. The IPA is 16,565,794 bytes, SHA256 `83e0908c8ccba41d01281a487f6f6ce4ee55fd394b5bca1ba2a4c8e344a6e818`. Installation succeeded and the device inventory independently reports version 1.0.0/build 15 with the expected bundle identifier.

Build 15 adds the disabled native push foundation and bounded sign-out cleanup. It still has no production Siprix license. Push registration remains compiled off; no Apple delivery or cold/locked calling is claimed. The live backend still runs `75fa3c9`; the separate server push migration/candidate has not been deployed. Actual build 15 UI/call acceptance remains blocked by the owner's Mac unlock for iPhone Mirroring.

The immediately preceding build 13 passed a direct incoming echo call and handset-initiated hang-up, confirmed by the user. That call bypassed the public-number carrier; public DID inbound acceptance remains separate. Earlier outbound PSTN testing also does not prove every new release or network state.

## Remaining production gates

Incoming public-number calling, native PushKit/APNs delivery while locked/backgrounded, production Siprix licensing and long calls, two authorized chat clients, and physical audio-route/control tests remain separate acceptance gates. The commissioned background call path still requires implementation as well as provider configuration. Do not describe these as credentials-only blockers.

The optional production license now has a native prebuild-only configuration path that excludes the value from public Expo configuration. A configured value alone is not proof that the SDK accepted a valid license or that a long call passed.

See [the researched gap audit](ZOOM-GAP-AUDIT.md), [chat deployment instructions](../../server/chat/README.md), and [backend compatibility changes](backend-security.md). Later PBX and collaboration features must be accepted before their controls are enabled.
