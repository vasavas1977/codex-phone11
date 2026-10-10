# Mobile in-meeting chat

Source base: `9c0f9827b001dce0c76a261ceb5dcea6855258df`. The mobile integration consumes the frozen shared `phone11.meeting.chat.v1` codec; it does not change the room/token server, native media lifecycle, dependencies or configuration.

`MeetingRoomState` passes its existing authenticated `nativeRoom` and public `BrowserMeetingSession` into `MeetingRoomChat`. Runtime narrowing requires the SDK data API, participant map, events and connection state; an old/restored room without that surface has no Chat control. Sending requires the exact current session room, connected state, live authenticated owner, no SIP interruption or Leave, interactive membership, and the SDK's live `canPublishData` permission. A synchronous Leave epoch invalidates pending callbacks even if teardown fails before React commits. The same room/local participant/identity and authority are rechecked after publication settles. No new room, token, participant identity or fallback transport is created.

The pinned `livekit-client` 2.22.3 API uses `localParticipant.publishData(payload, { reliable: true, topic })` and `dataReceived(payload, participant, kind, topic)`. `participantPermissionsChanged`, `connectionStateChanged` and `disconnected` invalidate revoked/stale operations. Received text requires a current exact SDK remote participant object, `canSubscribe`, the v1 topic and reliable packet kind. The payload contains only version, message ID and text; sender names and photos never come from it. UUIDs are duplicate-suppression keys, not credentials. The controller bounds packets via the codec, message history at 200, duplicate keys at 400, and incoming packets at 100 per 10 seconds. Failed publication preserves the draft and reuses its ID for the same explicit retry; it reports no delivery confirmation.

The sheet has a plaintext composer, Cancel and Done, keyboard avoidance for iOS/Android, accessible labels and disabled/busy states. The existing authorized participant labels and `ProfileAvatar` photo resolver are reused, with initials when no authorized photo mapping exists. Controls wrap on narrow screens. History and drafts are ephemeral and cleared on scope changes; no chat persistence, raw SDK errors or logging is added.

## Installed encoding bootstrap

Expo 54 supplies the existing encoding runtime; no polyfill is added. Installed evidence paths:

- `node_modules/expo-router/entry.js` imports `entry-classic.js`; it imports `build/renderRootComponent.js`, which calls Expo `registerRootComponent`.
- `node_modules/expo/src/launch/registerRootComponent.tsx:1` imports `../Expo.fx`.
- `node_modules/expo/src/Expo.fx.tsx:2` imports `./winter` before app registration; `src/winter/index.ts` imports `./runtime`.
- `node_modules/expo/src/winter/runtime.native.ts:8` installs `TextDecoder` using `./TextDecoder`; `src/winter/TextDecoder.ts:2` documents Hermes-provided UTF-8 `TextEncoder`. Its decoder supports the codec's fatal UTF-8 mode.

These source paths support the expected Expo/Hermes bootstrap ordering before a meeting route renders. They do not establish behavior in the signed physical-device build.

## Acceptance boundary

Local tests cover actual SDK sender checks, spoof/unknown sender rejection, payload/history/rate bounds, receive-only and revoked permissions, failed-send retries, room/account/leave/SIP invalidation, subscription disposal, keyboard layout, accessibility and plaintext rendering. Full application TypeScript, focused ESLint and existing avatar regressions are separate checks. No native installation, authenticated meeting, mobile-to-desktop delivery, provider call, token mint or production action is performed. Those runtime/device acceptance gates remain open.

Validation on 1 October 2026: 111 focused tests passed (27 mobile chat, 16 shared codec, 6 avatar UI, 18 browser session, 39 native session, 5 media ownership); full `node_modules/.bin/tsc --noEmit`, focused `node_modules/.bin/eslint`, and `git diff --check` passed. The initial `pnpm exec` attempts aborted at the host's automatic install/purge check; installed tools were then invoked directly without package/config changes or enabling installation. Initial local test-harness clock/default-argument mistakes and boolean-literal test typing errors were corrected before the passing run. The existing avatar UI test only adds a matching auth-store mock; its assertions are unchanged.
