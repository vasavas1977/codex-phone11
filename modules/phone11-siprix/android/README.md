# Phone11 Android foreground source candidate

This is a default-off source candidate for ordinary audio dial, foreground
incoming answer, End, mute, hold, DTMF and observed SDK speaker selection. It is
not Android native acceptance. The package still has `android: null` in the
React Native autolinking config; shared app/Expo configuration, iOS code, iOS SDK
pins and signed daily-pilot artifacts are unchanged.

The real Android SDK is the official `siprix/SampleJava` AAR from revision
`80d198ed6179b45ff8cd8dad9b8086976b4197a0`, version `1.1.0`, build
`20260905_1222`. Its SHA-256 is
`3173ee8bae7aa37d3be3b44f7533d43b4e4d8625110d1d2bd8d79367973c9198`.
See `sdk-lock.json`. This Android pin is independent of the existing iOS 1.0.40
pin. The trial has a 60-second call limit. No SDK bytes, license, credentials or
download/install logic are committed here.

## Native contract

The module exports `NativeModules.Phone11Siprix` and `Phone11SiprixEvent` with
process-monotonic generation/sequence fields and decimal account/call IDs.
The engine boundary forwards the real SDK callbacks onto Android's main queue,
including callbacks delivered synchronously while a command allocates its ID.
Connection, termination, registration success/failure and hold state come from
SDK callbacks. A successful REGISTER request creates only `registering`; a
successful INVITE creates only `dialing`. Mute is reported after SDK acceptance
because this SDK has no separate microphone mute callback. Speaker is observed
through the SDK-selected audio device; it is not acoustic/media proof.
`audioSessionActive` remains false because this module has no accepted native
OS audio-session activation contract.

One live bridge lease, one account lifetime and one active audio call are allowed.
Account deletion requires destroy/reinitialize before another account; retired
call IDs cannot be reused in one generation. Duplicate answer/End requests have
one SDK invocation. Pending hold blocks another toggle and the SDK hold query
checks the local bit; remote hold remains visible separately in `holdState`.
Account/call/session generations fence delayed callbacks and bridge invalidation.
SDK command failure preserves current state and rejects `E_SIPRIX_<signed code>`.
Failed shutdown retains SDK/account/call state and explicitly quarantines all
commands with `E_CLEANUP_REQUIRED`; retry destroy is available. Invalidation
releases the bridge owner after cleanup failure, and the next owner can retry
cleanup, but cannot initialize or command that quarantined runtime.

No credential configuration is stored by the Java state machine or returned in
snapshots/events. Temporary native account password/auth fields are cleared after
account addition. Vendor logging is disabled; raw callback response, caller display
name, SIP headers, message body and provider token are never forwarded. Returned
remote URI omits parameters and rejects credential-bearing URI syntax.

Video, warm/blind transfer, consultation, native wake adoption/history, FCM,
background/locked/Doze/process-death ringing, OS call UI and recording playback
route controls are unsupported. Optional transfer methods are absent,
`warmTransferAvailable=false`, video capabilities are false, and
`getCapabilities().registrationAvailable=false` reports
`android_native_acceptance_required`. No extra service/receiver/provider is added.
Video capture is disabled; unsolicited upgrade requests are rejected only through
the current generation/call boundary. A confirmed unexpected video negotiation
requests End and emits an explicit error.

## Compiler and packaging gates

Set `PHONE11_SIPRIX_ANDROID_AAR` to an already staged official AAR and run:

```sh
node modules/phone11-siprix/android/verify-sdk.mjs
```

For a hosted actual React Native/Android source compiler check, generate the
repository's locked Android Expo host, then manually include a compiler project
in its generated `settings.gradle` (do not autolink the module):

```groovy
include ':phone11-siprix-android-source'
project(':phone11-siprix-android-source').projectDir =
    new File(rootProject.projectDir, '../modules/phone11-siprix/android')
```

The host must provide its locked React Native Maven dependency and
`rootProject.ext.compileSdkVersion`. Run from that generated host:

```sh
./gradlew :phone11-siprix-android-source:verifyPhone11SiprixAndroidSdk \
  :phone11-siprix-android-source:compileDebugJavaWithJavac \
  -Pphone11SiprixAndroidAar=/absolute/path/to/pinned/siprix_voip_sdk.aar
```

The library uses `compileOnly` for API binding. That does **not** package the SDK
in an executable APK. Source activation defaults off with
`phone11AndroidForegroundSourceEnabled` omitted. An explicitly enabled build
fails unless the host `:app` has an `implementation(files(...))` dependency on
that same exact AAR; checksum verification still applies. Runtime initialization
also requires the separately default-false manifest
`ai.phone11.siprix.FOREGROUND_SOURCE_ENABLED` gate. Enabling either gate,
autolinking, APK packaging or changing shared engine selection requires a later
reviewed integration. This compiler candidate supplies none of those changes.

## Validation actually run on 4 October 2026

The official AAR remained at its original cached path in the pinned SampleJava
checkout. Its hash and all four native ABI pairs were verified. No SDK dependency
or Android tool was downloaded/installed.

```sh
PHONE11_SIPRIX_ANDROID_AAR=/absolute/path/to/pinned/siprix_voip_sdk.aar \
PHONE11_ANDROID_API_JAR=/absolute/path/to/android-35/android.jar \
node --test modules/phone11-siprix/tests/android-*.test.mjs \
  modules/phone11-siprix/tests/android-sdk-compiler.mjs
```

Four Node tests pass, including 78 isolated Java lifecycle assertions. The actual
adapter and state source pass JDK 17 `javac -Xlint:all -Werror` against the real
pinned official `classes.jar` and real installed Android 35 `android.jar`.
A separate whole-module host declaration check passes with **React declaration
stubs**, the real Siprix API and the real Android API. The stubs are test-only;
this is not full React Native compiler/runtime proof. The actual SDK compiler gate is an explicit `android-sdk-compiler.mjs` invocation
and fails if SDK/API paths are absent. The ordinary `*.test.mjs` wildcard runs
only platform-independent readiness/lifecycle checks, with no platform skips.

A full local Gradle/React Native dependency cache was not found. Full real
React Native Gradle compilation, linking/packaging, hosted CI, signed Android APK,
deployment, provider behavior, RTP/audio, permissions recovery, background lifecycle
and physical-device acceptance remain unverified. No device was installed,
launched or called for this work.

Sources:
- [Pinned official Java sample](https://github.com/siprix/SampleJava/tree/80d198ed6179b45ff8cd8dad9b8086976b4197a0)
- [Official Android integration guidance](https://docs.siprix-voip.com/rst/integration.html)
- [Official trial terms](https://www.siprix-voip.com/download/)
