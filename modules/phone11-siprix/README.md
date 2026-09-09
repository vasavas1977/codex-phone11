# Phone11 Siprix iOS Trial Bridge

Native module: `NativeModules.Phone11Siprix`. Event channel: `Phone11SiprixEvent`.
The authoritative JS contract is `index.d.ts`. All exported operations return
Promises. Importing the package does not initialize any SIP runtime.

## Packaging

Use this package as a local React Native dependency. The parent build workstream
stages both official binary frameworks under `vendor/`:

- `siprix.xcframework`
- `siprixMedia.xcframework`

Source: official `siprix/SampleSwiftUI`, pinned revision
`53ae99e16531f64cf6e7832ed9e5d126a7e2d4ce`, bundled SDK `1.0.40`.
The bridge uses the Objective-C `Siprix.h` selectors from that exact framework.
Runtime initialization checks `[sdk version]` against `1.0.40`; mismatch rejects
with `E_SDK_VERSION`. Snapshot `sdkVersion` is the actual SDK-reported value.
The podspec links React-Core and both frameworks, not sample source or PJSIP.
The parent owns dependency installation, EAS/Expo configuration, PJSIP exclusion,
microphone usage description, entitlements, signing, and preserving app identity.

## Lifecycle And Events

1. Subscribe with `new NativeEventEmitter(Phone11Siprix)` before initialization.
2. `initialize({})` starts one process-wide SDK with one bridge lease. Repeated
   initialization by the same bridge is idempotent, not an extra reference count.
3. `createAccount(config)` adds an in-memory account with SDK expiry zero.
   Optional properties must be omitted, not supplied as `null`.
4. `registerAccount(id, expirySeconds)` requests registration. Only the SDK's
   `RegStateSuccess` callback creates `registrationState: 'registered'`.
5. Call IDs and account IDs are decimal strings. `makeCall` returns the allocated
   call in `dialing` state. Registration, proceeding, connected, termination,
   and hold events are driven by SDK callbacks, never optimistic JS success.
6. `getSnapshot()` contains native state even when there were no event listeners.
   Every event includes monotonically increasing process `sequence` and runtime
   `generation`. After attaching, reconcile the snapshot and discard stale events.
7. `destroy()` uninitializes the SDK, releases account credentials and runtime
   references, and changes generation. SDK cleanup failure rejects, retains the
   SDK/delegate for a retry, and quarantines other operations. A different live
   bridge cannot destroy or reuse this lease. Bridge invalidation attempts cleanup.

One account and one active audio call are supported. After deleting an account,
destroy/reinitialize before creating another. This prevents delayed old account
callbacks from being applied to a reused account ID. Reused retired call IDs also
fail closed. SDK callbacks are always enqueued to the main queue, including
synchronous callbacks, so returned IDs are tracked before event processing.

`callMuted` reflects successful SDK `callMuteMic` return; the SDK has no separate
mute callback. `audioSession` records forwarding of the OS activation hook, not
proof of RTP or physical audio. `speaker` is read from the current AVAudioSession
route, not inferred from a successful route request. `held` means any hold;
`setHold` checks only the local bit with `callGetHoldState` before calling the
SDK toggle. A pending hold command rejects another toggle until its callback.

`registration` events retain numeric SDK `regState` and optional `sipStatusCode`.
The latter is extracted only from an RFC-style `SIP/2.0 NNN` prefix or exact
allowlisted standard status/reason strings. Unrecognized vendor response formats
are deliberately not guessed. No raw response, header, credential, or caller
display-name text is returned. Remote URIs exclude password/parameter text.
The source does not log. Callers may record SDK version, numeric registration
state and numeric SIP status without recording account configuration.

SDK command errors reject as `E_SIPRIX_<signed numeric code>`, for example
`E_SIPRIX_-77`, with the failed operation name. Validation/ownership errors use
distinct `E_*` codes. SDK registration failure without an immediately failed
command is an event, not a fabricated rejected command.

## CallKit Ownership

RNCallKeep remains the ONLY CallKit provider. Siprix `enableCallKit:YES` enables
external audio-session management; this bridge does not instantiate a CXProvider,
CXCallController, PushKit registry, or the sample's coordinator.

Forward RNCallKeep `didActivateAudioSession` and `didDeactivateAudioSession` to
`handleNativeAudioSession(true/false)`. That uses only SDK
`activateSession:` / `deactivateSession:` on the shared AVAudioSession. The bridge
does not call `setActive:` or create another OS call. Outbound/inbound OS reporting
and answer/end UI actions remain with the existing NativeCallManager.

## Validation And Limits

Run from the app repository:

```sh
node --test modules/phone11-siprix/tests/*.test.mjs
ruby -c modules/phone11-siprix/Phone11Siprix.podspec
```

The test harness compiles the actual bridge against the staged official Siprix
header using host-only React/UIKit/AVAudioSession declarations, then executes the
bridge with a mock Siprix implementation. It covers initialization ownership,
real-error propagation, registration callback truth, account cleanup, stale
generation rejection, snapshots without listeners, call ordering, single-call
rejection, mute/hold/DTMF, audio activation idempotence, failed shutdown, privacy,
and numeric SIP status parsing. No SIP traffic or real credentials are used.

2026-09-09 local verification: both test cases passed, with 95 native assertions.
This is NOT an iOS SDK compile/link, device install, CallKit/PushKit acceptance,
registration, PSTN, or audio proof. This Mac has Command Line Tools, not Xcode;
the parent cloud signed build is the next compile/link gate. There is no Android
implementation, transfer/video support, or background/cold-start push adapter.
The pinned SDK trial limits calls to 60 seconds according to its bundled README.
No license purchase, auth change, production action, or commit is performed here.
