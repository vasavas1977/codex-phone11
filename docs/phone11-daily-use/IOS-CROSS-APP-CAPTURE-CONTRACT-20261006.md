# iOS cross-app capture contract — 6 October 2026

Cross-app iOS screen publishing remains unavailable. The current public ReplayKit
system-broadcast path does not establish the acknowledged OS-capture teardown
required by Phone11's media custody contract. No runtime adapter, extension,
App Group, entitlement, dependency, build flag or publication capability was added.

This investigation starts at source
`617dbd256a2c766c59dfd6b5909fde6f2d472502`, with React Native LiveKit 3.0.0,
React Native WebRTC 144.2.0, and livekit-client 2.22.3. The selected installed
Xcode SDK identifies itself as `iphoneos18.5` in `SDKSettings.json`.

## The missing acknowledgment

Apple's [WWDC 2018 ReplayKit presentation](https://devstreaming-cdn.apple.com/videos/wwdc/2018/601nz4m863hyf0/601/601_live_screen_broadcast_with_replaykit.pdf)
distinguishes the older app-controlled broadcast from continuous system capture
on slides 8–10. Slide 37 states that `RPSystemBroadcastPickerView` owns no session
state. The installed `RPBroadcast.h:177–186` exposes the system picker with only
its extension selection and microphone-button properties; it supplies no
`RPBroadcastController` or stop-completion method.

The extension's `finishBroadcastWithError:` is a void method
(`RPBroadcastExtension.h:147–150`). Its documented result is an error delivered
through the broadcasting app's `RPBroadcastControllerDelegate`. The system picker
does not give Phone11 that controller. Apple's
[`broadcastFinished` documentation](https://developer.apple.com/documentation/replaykit/rpbroadcastsamplehandler/broadcastfinished()?language=objc)
describes invocation when the broadcasting app calls `finishBroadcastWithHandler:`;
it does not promise this callback after the extension calls
`finishBroadcastWithError:`. This is a missing documented guarantee, not a claim
that a callback can never occur on a particular device.

Closing an App Group socket, discarding subsequent samples, emitting a Darwin
notification or returning from `finishBroadcastWithError:` can acknowledge
Phone11's own work. None of those establishes that the OS broadcast has finished.
A heartbeat timeout or missing samples likewise cannot establish teardown.
Waiting indefinitely for an undocumented callback would retain custody without
providing a deterministic stop outcome. Resolving that wait on timeout would
incorrectly release custody while capture may continue.

The older `RPBroadcastController` does have start and finish completion handlers;
the installed `RPBroadcast.h:136–150` documents success when the error is nil.
That is the older app-controlled path, not evidence that a system-picker session
has a host controller. Switching to `RPScreenRecorder` would also provide an
in-app capture stop completion, but would not implement the requested cross-app
sharing behavior.

## Why the pinned RN SDK does not close this gap

The pinned iOS sources were inspected from the existing dependency installation:

- `ScreenCapturePickerViewManager.m:16–20,32–55` presents the system picker and
  hides its microphone button; there is no session acknowledgment.
- `ScreenCaptureController.m:42–54,68–77` returns without capture when the App
  Group identifier is missing; start and stop are void.
- `WebRTCModule+RTCMediaStream.m:165–184,187–217` constructs and returns a video
  track before any broadcast-start receipt. `mediaStreamTrackRelease:424–435`
  stops its local capturer and removes the track without a completion promise.
- `ScreenCapturer.m:148–152,164–166` closes and clears the local socket reference;
  it supplies no OS broadcast teardown receipt.

The current upstream Swift SDK's
[`BroadcastManager.requestStop`](https://github.com/livekit/client-sdk-swift/blob/main/Sources/LiveKit/Broadcast/BroadcastManager.swift)
posts a Darwin stop request; its
[`LKSampleHandler`](https://github.com/livekit/client-sdk-swift/blob/main/Sources/LiveKit/Broadcast/LKSampleHandler.swift)
requests extension finish and sends its stopped notification from
`broadcastFinished`. This is useful implementation context, not an additional
Apple guarantee or an API in Phone11's pinned RN stack. Adding a Swift Room SDK
would also change the existing media architecture and would not by itself solve
the documented acknowledgment gap.

## A documented future primitive, unavailable here

Apple now documents [full-display capture with ScreenCaptureKit on iOS](https://developer.apple.com/documentation/screencapturekit/capturing-screen-content-on-ios).
Its picker returns a content filter to the host, and `SCStream` provides
[start](https://developer.apple.com/documentation/screencapturekit/scstream/startcapture(completionhandler:))
and [stop completion handlers](https://developer.apple.com/documentation/screencapturekit/scstream/stopcapture(completionhandler:)).
The sample explicitly requires iOS 27 or later and is marked beta. The selected
iOS 18.5 SDK has no ScreenCaptureKit header or framework. This investigation
does not adopt a future OS floor, change toolchains or claim compatibility with
the pinned RN WebRTC adapter.

## Validation and resulting decision

Three isolated Objective-C compiler surface probes were run against the installed
iOS 18.5 SDK, using the existing Xcode clang with `-fsyntax-only -fno-modules`,
ARC, blocks and an `arm64-apple-ios15.1` target:

1. The actual ReplayKit host-controller completion handlers, extension void stop
   and picker properties compiled successfully. A preprocessor check also
   confirmed that the selected iOS SDK lacks the ScreenCaptureKit header.
2. Accessing `RPSystemBroadcastPickerView.broadcastController` failed as expected:
   the SDK declares no such property.
3. Calling `finishBroadcastWithError:completionHandler:` failed as expected:
   the SDK declares no such selector.

Private fixtures and raw logs are under
`/tmp/phone11-ios-screen-contract-20261006` (directory mode 0700, files 0600).
These checks establish the current compiler surface, not native linking,
extension execution, callback delivery or handset acceptance. They require no
modules, package install, prebuild, signing or device launch.

Implementation is blocked on a documented supported cross-app capture primitive
that acknowledges OS teardown, or an explicit product decision to accept a
different custody boundary. That decision must precede any adapter using the
weaker ReplayKit extension stop request. Until then, keep iOS publishing
unavailable and preserve the existing auth, exact connected-room admission,
SIP interruption and media-lease release barrier. A future adapter must pass
only video, reject system/microphone audio buffers, and treat failed or missing
teardown acknowledgment as failure rather than successful release.
