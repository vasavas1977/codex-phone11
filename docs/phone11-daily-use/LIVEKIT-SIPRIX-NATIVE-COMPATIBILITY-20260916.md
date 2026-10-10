# LiveKit / Siprix native coexistence review

Date: 2026-09-16. Read-only package and pinned binary inspection; no dependency installation, build, deployment, or device proof.

## Finding

Do not bundle the LiveKit React Native 2.x stack with the current Siprix media framework. The installed Siprix 1.0.40 `siprixMedia` binary embeds unprefixed Objective-C WebRTC classes, including `RTCAudioSession`, `RTCPeerConnection`, `RTCPeerConnectionFactory`, and `RTCCameraVideoCapturer`. `otool -ov` finds 92 distinct RTC-prefixed metadata names (classes/protocols). `nm -gU` alone misses these because they are not global exports. Objective-C runtime class collisions can remain even when dynamic libraries link.

Exact npm tarball inspection shows `@livekit/react-native@2.12.0` imports `<WebRTC/WebRTC.h>` and `@livekit/react-native-webrtc@144.1.2` depends on `WebRTC-SDK=144.7559.10`. This is the colliding unprefixed framework.

The candidate route is `@livekit/react-native@3.0.0` with `@livekit/react-native-webrtc@144.2.0`. Its podspec uses `LiveKitWebRTC=144.7559.15`, whose framework and Objective-C classes are namespaced (`LiveKitWebRTC`, `LKRTC...`). This addresses the identified collision but still needs a local combined link/load and runtime class-name check. It is not yet device-validated.

## Version constraints

Phone11 currently pins Expo ~54.0.29, React Native 0.81.5, React 19.1, and disables new architecture. Avoid an Expo/RN upgrade within this integration.

- `@livekit/react-native@3.0.0`: peer `@livekit/react-native-webrtc ^144.2.0`, `livekit-client ^2.19.0`, React/RN `*`; Node >=20. Upstream development uses RN0.83, so peer acceptance is not RN0.81 build proof.
- `@livekit/react-native-webrtc@144.2.0`: peer RN>=0.60; namespaced framework.
- `livekit-client@2.22.3`: current version satisfying the client peer range.
- `@config-plugins/react-native-webrtc@13.0.0`: Expo ^54. Latest15.0.2 requires Expo>=56 and must not be selected.
- Official `@livekit/react-native-expo-plugin@1.0.2` declares LiveKit RN ^2.1.0, excluding3.0.0. Do not silently ignore this mismatch. A reviewed local plugin/lifecycle integration or upstream compatible release is required.

The official Expo plugin contains native lifecycle setup, not merely app configuration: iOS `ExpoAppDelegateSubscriber` calls `LivekitReactNative.setup()`; Android `ApplicationLifecycleListener` calls `LiveKitReactNative.setup(application, audioType)`. A replacement must reproduce these on the exact RN3 API and set camera/microphone usage descriptions and permissions through the Expo54-compatible WebRTC config plugin. Leave multitasking camera access disabled.

## Minimal safe integration plan

1. In a disposable native checkout, pin the namespaced SDK versions above and reproduce reviewed Expo lifecycle setup without bypassing package peer constraints. Add `registerGlobals()` once at app startup only when native modules exist; older signed binaries must not import/start unsupported native SDK paths.
2. Prebuild and inspect Podfile.lock and embedded binaries: exactly one `LiveKitWebRTC`, existing `siprix`/`siprixMedia`, no unprefixed external `WebRTC.framework`. Compare Objective-C class metadata, not only exported linker symbols. Compile both iOS arm64 and simulator with the current old-architecture RN configuration before planning a signed build.
3. Introduce one media-session owner across SIP and conference calls. Reject conference join while SIP incoming/active, and coordinate an incoming SIP answer by stopping room tracks/disconnecting before CallKit takes audio. Do not run both microphone/camera pipelines concurrently. RNCallKeep remains the sole CallKit owner.
4. Scope LiveKit audio activation to a joined room. On room leave/failure/logout, stop tracks and disconnect, then stop LiveKit audio only if it still owns the session. Do not deactivate the shared AVAudioSession after SIP has acquired it. LiveKit's `startAudioSession` / `stopAudioSession` activate/deactivate the shared iOS audio session; plugin setup alone does not establish safe coexistence.
5. Use authenticated Connect11 room/token admission, participant publication state, interpreter status and typed events. Keep API secrets server-side. Build conference UI against this contract once available.
6. Verify on handsets: SIP call before/after conference, incoming SIP during conference, speaker/earpiece/Bluetooth, permission denial, background camera pause, interruption/lock screen, reconnect and logout. No production-readiness claim before these tests.

## Sources inspected

- LiveKit Expo quickstart: https://docs.livekit.io/home/quickstarts/expo
- Namespaced framework details: https://github.com/livekit/webrtc-xcframework
- Official SDK source: https://github.com/livekit/client-sdk-react-native
- Official WebRTC fork: https://github.com/livekit/react-native-webrtc
- Exact published npm metadata and tarballs for the versions listed above (registry.npmjs.org).
- Local Phone11 `package.json`, `app.config.ts`, `modules/phone11-siprix/Phone11Siprix.podspec`, and staged pinned arm64 Siprix frameworks. `otool -L` confirms Siprix embeds its media framework instead of depending on an external WebRTC.framework.

## Exact namespaced binary audit and remaining limitation

The actual `LiveKitWebRTC.xcframework.zip` release 144.7559.15 was downloaded to temporary storage (66,615,427 bytes; SHA-256 `2edf0cd197590157d5f07c1c619d6eab302711c5e9a6dc0e81b08c7989375821`). Its arm64 binary SHA-256 is `f21ef36eb8cf510c90f30dbacee3f757d89b2591e7fdc9ca427feddb83522f89`.

`otool -ov` finds 132 LKRTC-prefixed metadata names. The only RTC-prefixed metadata name still shared with Siprix is `RTCDevice`, an Objective-C category on `UIDevice`, not an RTC class. However, namespacing RTC classes does **not** remove shared categories on Apple classes. Both binaries define:

| Apple class/category | Shared selectors |
| --- | --- |
| NSString / StdString | `stdString`, `stdStringForString:`, `stringForStdString:` |
| NSString / AbslStringView | `stringForAbslStringView:` |
| AVCaptureSession / DevicePosition | `devicePositionForSampleBuffer:` |
| UIDevice / RTCDevice | `machineName` |
| UIDevice / H264Profile | `maxSupportedH264Profile` |

The `stringForAbslStringView:` Objective-C type encoding differs: Siprix `{string_view=*Q}`, LiveKit `{basic_string_view<char, std::char_traits<char>>=*Q}`. Both contain a pointer and length in the metadata; this does not prove equivalent semantic or ABI behavior. Objective-C category methods can replace each other at runtime regardless of symbol visibility. Do not label the namespaced pair safe based solely on successful linking. Vendor confirmation, a combined-process runtime/media probe, or a WebRTC build that namespaces these category selectors is still required. Avoid attempting unreviewed binary symbol patches.

## Concrete package/plugin proposal (not installed)

Use exact candidate pins `@livekit/react-native=3.0.0`, `@livekit/react-native-webrtc=144.2.0`, `livekit-client=2.22.3`, `@config-plugins/react-native-webrtc=13.0.0`. Do not add the currently incompatible official Expo plugin package to production until its peer range is corrected upstream or a reviewed local derivative is used.

A local `modules/phone11-livekit-expo` derivative of official plugin1.0.2 can retain its license, configuration metadata and Expo lifecycle classes, declare exact LiveKit3 peers, and disable screen sharing/multitasking camera access by default. Source comparison confirms these public native setup entry points still exist in3.0:

- iOS module `livekit_react_native`, public Objective-C `LivekitReactNative.setup()`, called once by an `ExpoAppDelegateSubscriber`. `livekit_react_native_webrtc.WebRTCModuleOptions.sharedInstance()` remains available. Keep `enableMultitaskingCameraAccess=false`.
- Android `com.livekit.reactnative.LiveKitReactNative.setup(application, AudioType.CommunicationAudioType())` and `com.oney.WebRTCModule.WebRTCModuleOptions.getInstance()` remain available. Explicitly set `enableMediaProjectionService=false` after setup for a camera-only first version, because SDK3 setup sets it true.
- SDK3 iOS podspec is unchanged from2.12 and still supports the legacy React module path via `install_modules_dependencies`. This is source-level compatibility evidence, not a verified Expo54/RN0.81 compile.

Before modifying the app dependency graph, validate the proposed module in a disposable checkout with Expo54, RN0.81.5 and `newArchEnabled=false`. Required tests: peer closure without overrides; config plugin idempotence and microphone/camera permissions; prebuild preserving the Siprix and RNCallKeep hooks; iOS arm64/simulator compile; Android compile; combined ObjC category audit; both framework load orders and media operations; native missing-module fallback; and exclusive media ownership across incoming SIP and conference. No source-only test can establish camera/audio crash freedom.

## Reproduction and primary references

Read-only steps (use your staged paths; do not install either SDK into the release app):

```sh
# Hidden Objective-C metadata is essential; exported symbols alone miss the issue.
otool -ov modules/phone11-siprix/vendor/siprixMedia.xcframework/ios-arm64/siprixMedia.framework/siprixMedia > /tmp/siprix-objc.txt
otool -L modules/phone11-siprix/vendor/siprixMedia.xcframework/ios-arm64/siprixMedia.framework/siprixMedia
# Download the fixed vendor release to temporary storage, extract its ios-arm64
# binary, then inspect with otool -ov/-L and compare class/category selectors.
# Never copy these audit binaries over the staged Siprix release frameworks.
```

The audit extracted exact npm tarballs from registry metadata for each pinned version, without running package lifecycle scripts or changing package.json/pnpm-lock.yaml. Inspect `livekit-react-native-webrtc.podspec`, SDK iOS imports, `LiveKitReactNativeModule.swift`, Android `LiveKitReactNative.kt`, and Expo plugin native lifecycle files. For ObjC categories, compare metadata blocks containing `cls ... _OBJC_CLASS_$_NSString`, `...UIDevice`, or `...AVCaptureSession`, including the methods and type encodings. A zero-overlap RTC class list is insufficient.

Primary fixed artifacts:

- [LiveKit 144.7559.15 framework release](https://github.com/livekit/webrtc-xcframework/releases/tag/144.7559.15)
- [Framework zip](https://github.com/livekit/webrtc-xcframework/releases/download/144.7559.15/LiveKitWebRTC.xcframework.zip)
- [SDK3 published metadata](https://registry.npmjs.org/@livekit/react-native/3.0.0)
- [WebRTC144.2 published metadata](https://registry.npmjs.org/@livekit/react-native-webrtc/144.2.0)
- [Expo plugin1.0.2 metadata](https://registry.npmjs.org/@livekit/react-native-expo-plugin/1.0.2)
- [Expo54 config plugin13.0.0 metadata](https://registry.npmjs.org/@config-plugins/react-native-webrtc/13.0.0)
- [Pinned Siprix source/framework revision](https://github.com/siprix/SampleSwiftUI/tree/53ae99e16531f64cf6e7832ed9e5d126a7e2d4ce)
- [LiveKit connection and server-token guidance](https://docs.livekit.io/intro/basics/connect/)

## Temporary system-browser conference client

An authenticated Connect11 conference page in the system browser is a reasonable interim path for foreground group video and interpreter UI. It keeps the WebRTC code in the browser process instead of loading a second WebRTC implementation into Phone11's Siprix process. It does not provide equivalent native CallKit, background audio, push acceptance, camera lifecycle, or seamless in-app UX; label it explicitly as opening the conference in the browser.

Use this sequence:

1. Phone11 makes an authenticated POST to Connect11 to create or select a meeting launch request scoped to the current user and tenant. A non-secret request identifier may appear in the launch URL; it must confer no access on its own.
2. Open the approved Connect11 HTTPS origin in the system browser. Authenticate there through an existing same-origin secure HttpOnly session or normal sign-in. Do not copy the app JWT, LiveKit token, API key, or a bearer-equivalent handoff secret into query strings/fragments.
3. Browser submits an authenticated same-origin POST to redeem the launch request once. The server checks user/tenant binding, membership, expiry and replay before minting a short-lived room/identity-scoped LiveKit token in the response body. Keep the room token in memory; never persist it in localStorage or URL history.
4. Only then request browser camera/microphone permission and join. The meeting page can display captions/interpreter output using the agreed Connect11 contract. A native app return link contains no credentials.
5. Block launch during a SIP call and explain that joining opens the browser. Browser process isolation eliminates the duplicate in-process ObjC classes, but OS microphone/audio interruptions still require explicit testing. Do not imply that two simultaneous calls are supported.

This is a proposed integration pending the actual Connect11 admission contract; no launch endpoint, browser meeting or native SDK dependency was added by this audit. Recommendation: use vendor-confirmed full namespacing or combined runtime/link/media proof before embedding LiveKit3 beside Siprix. Use a separately authenticated browser meeting only if its reduced behavior is accepted and verified.
