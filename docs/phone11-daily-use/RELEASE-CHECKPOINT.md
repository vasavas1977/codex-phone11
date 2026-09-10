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
- 33 chat state, restart persistence and real PostgreSQL tests passed, including concurrent retries and cross-workspace denial.
- Additional Recents, native audio/SDP, packaging and legacy storage checks passed.
- Backend bundle and iOS JavaScript export passed. The repository-wide TypeScript check still has legacy diagnostics; these are not a clean full-project typecheck claim.
- Continuous integration now requires the daily-use tests and a disposable real PostgreSQL service before the existing native/signing build.

## Deployment and handset evidence

Pending at this source checkpoint. Append exact deployed source/image, migration result, signed build, installation and physical results after execution. Do not infer these from the tests above.

The immediately preceding build 13 passed a direct incoming echo call and handset-initiated hang-up, confirmed by the user. That call bypassed the public-number carrier; public DID inbound acceptance remains separate. Earlier outbound PSTN testing also does not prove every new release or network state.

## Remaining production gates

Incoming public-number calling, native PushKit/APNs delivery while locked/backgrounded, production Siprix licensing and long calls, two authorized chat clients, and physical audio-route/control tests remain separate acceptance gates. PushKit and production notification transport still require implementation as well as provider configuration. Do not describe these as credentials-only blockers.

See [the researched gap audit](ZOOM-GAP-AUDIT.md), [chat deployment instructions](../../server/chat/README.md), and [backend compatibility changes](backend-security.md). Later PBX and collaboration features must be accepted before their controls are enabled.
