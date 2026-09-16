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
