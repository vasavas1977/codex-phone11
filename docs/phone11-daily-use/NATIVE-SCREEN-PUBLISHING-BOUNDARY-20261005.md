# Native screen publishing boundary — 5 October 2026

Source feasibility only. Native meeting screen publishing remains unsupported. No capture, app launch, installation, signing, provider action or device acceptance was performed.

## Source and dependency evidence

Phone11 base: `36cc3d207f2cabeed4a2c73a97dc6394a4a8fdbb`, tree `c631dce5a1c4783015f49205de6e3f36756f0b18`. The separate desktop video-only candidate is `26a529aa85c457794811cd192fe2239d416c178e`, tree `0997e5d0a1c4a91e7465d6750499a12fde3f14ee`; its [boundary](DESKTOP-SCREEN-PUBLISHING-20261005.md) does not establish native support.

[pnpm-lock.yaml](../../pnpm-lock.yaml), lines 28–33, pins `@livekit/react-native` 3.0.0 and `@livekit/react-native-webrtc` 144.2.0, with `livekit-client` 2.22.3 and the existing patch hash. Phone11 uses the JavaScript Room through RN WebRTC, rather than the native Swift/Android Room SDKs. Swift's documented in-app capture mode is not evidence of an API in this RN bridge.

Dependency evidence below was read from the existing cache under `/Users/vasavas16macbookpro/Documents/Codex/phone11-zoom-mainline-integration-20260928/node_modules/`; these are **cached dependency paths**, not checked-in Phone11 files:

| Cached path relative to that node_modules directory | Evidence |
| --- | --- |
| `@livekit/react-native/README.md:382–431` | Android needs the projection foreground-service permission; iOS needs a Broadcast Extension and explicit picker. |
| `@livekit/react-native/android/src/main/java/com/livekit/reactnative/LiveKitReactNative.kt:64–67` | Setup enables the bridge's internal projection service. |
| `@livekit/react-native-webrtc/android/src/main/java/com/oney/WebRTCModule/GetUserMediaImpl.java:68–83,285–338` | One pending consent promise; Activity result starts service/capture without a cancellable Phone11 authority generation. |
| `@livekit/react-native-webrtc/android/src/main/java/com/oney/WebRTCModule/MediaProjectionService.java:25–50,64–76` | Startup failures are logged and return void; no acknowledgment of completed `startForeground` before capture. |
| `@livekit/react-native-webrtc/src/MediaStreamTrack.ts:123–126,250–257` and Android `WebRTCModule.java:899–909` | Stop/release queue native work without a native teardown completion promise. |
| `@livekit/react-native-webrtc/android/src/main/java/com/oney/WebRTCModule/ScreenCaptureController.java:68–87` | Disposal aborts the service; MediaProjection OS-stop callback stops capture and emits the ended event. |
| `@livekit/react-native-webrtc/ios/RCTWebRTC/ScreenCapturePickerViewManager.m:16–20,27–50` | ReplayKit picker expects `RTCScreenSharingExtension`, hides its microphone button, and requires explicit presentation. |
| `@livekit/react-native-webrtc/ios/RCTWebRTC/ScreenCaptureController.m:42–54,70` and `WebRTCModule+RTCMediaStream.m:165–207` | App Group socket capture requires `RTCAppGroupIdentifier`; missing configuration silently starts no capture although a track can resolve. Simulator capture returns nil. |

## Reuse and missing primitives

[native-session.ts](../../lib/meetings/native-session.ts):176 constructs a session without a screen adapter. Its current-auth/connected-room/media-lease check at 188–192, SIP interruption at 290, and leave/lease release at 416–456 provide the existing authority. [media-ownership.ts](../../lib/meetings/media-ownership.ts):17–20 requires meeting sharing to stop before SIP owns media. These must remain the single owner; failed cleanup must retain the lease.

[app.config.ts](../../app.config.ts):101 lacks `FOREGROUND_SERVICE_MEDIA_PROJECTION`; the generic cached WebRTC config plugin does not add it. [with-phone11-livekit.js](../../plugins/with-phone11-livekit.js) supplies native setup, but no projection admission transaction, ReplayKit extension or App Group configuration.

Android is the smaller first platform, **conditional on implementing a native transaction**, not merely wrapping `getDisplayMedia` in JavaScript. Minimum API invariants:

- `begin(operation, sessionGeneration)` is invoked only by an explicit Share press after current authenticated ownership, interactive admission, connected SDK `canPublish`/`ScreenShare`, and current meeting media lease/SIP-idle checks. It owns a fresh OS consent request and one-use projection result; raw consent intents never cross JS or persist.
- `cancel(operation)` invalidates pending consent immediately. A late Activity result must be discarded before starting service/capture. Revalidate current Activity and the same admitted room/lease after every asynchronous boundary.
- Capture starts only after an acknowledged successful projection foreground service startup. Refusal returns a recoverable error and clears the operation; never log success or publish after service failure.
- `stop(operation)` is idempotent and resolves only after projection/capturer disposal and service teardown. Pending consent, late track creation/publication and failed cleanup stay owned until drained; failed stop retains authority and visible retry. JS `track.stop()` alone is not this acknowledgment.
- Publish exactly one video track, no capture audio. Stop on auth loss, permission revocation, reconnect, room replacement, leave or SIP interruption. Require a new Share action after interruption; never restore capture from process state.

A bounded candidate should add a reversible Android-only, default-off build flag and permission plus a reproducible change to the pinned bridge/native transaction. Ordinary Android and iOS must remain unchanged. Cross-app/background sharing needs separate lifetime acceptance: the owned OS consent Activity transition must be distinguished from genuine background loss, and the projection service alone does not prove continuing meeting microphone/camera safety.

The public [meeting admission DTO](../../server/meetings/service.ts):17–33 and [native admission](../../lib/meetings/native-session.ts):26–31 do not expose room revision. Canonical admission storage already has revisions; define the current session-lifetime binding before promising that fence. Do not introduce a duplicate product store or infer host-operation authority from screen entitlement.

## iOS prerequisites and acceptance gates

iOS needs a Broadcast Upload Extension target, exact App Group and extension identifiers, matching host/extension entitlements and provisioning, the two expected Info.plist keys, and a video-only SampleHandler. The extension protocol needs session-generation binding, start/frame readiness and stop acknowledgments, and extension termination on authority loss or closed host connection. A resolved empty track or closed socket alone is not proof that system broadcasting has started or ended. Phone11 currently implements none of these extension prerequisites.

Before enabling either platform: compile the exact native bridge change, inspect generated manifests/entitlements and reversible default-off configuration, and test consent cancellation, stale results, service refusal, revocation, reconnect, late publication and teardown ownership. Physical device gates include consent during auth/SIP changes, OS stop/lock, rotation, background behavior, cleanup retry, visible remote video and absence of screen audio. iOS requires signed extension/device checks; simulator success cannot establish capture acceptance.

Primary references: [Android MediaProjection requirements](https://developer.android.com/media/grow/media-projection), [LiveKit RN screen-sharing instructions](https://github.com/livekit/client-sdk-react-native#screenshare), and [LiveKit platform screen-sharing guide](https://docs.livekit.io/transport/media/screenshare/). Current guides explain platform requirements; exact installed API behavior above is taken from the pinned local cache.
