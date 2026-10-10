# Android foreground trial integration

Base source: `13ff36bf006f0db2160cd50f4c32dc807c0d3d75`.
This slice adds a default-off Android host integration for the existing hardened
Siprix runtime. It imports no UCC lab bridge, modifies no SDK cache, supplies no
license or credentials, and performs no device, provider, installation or release action.

## Build and native boundaries

The explicit candidate requires:

- `PHONE11_ANDROID_FOREGROUND_TRIAL=1`.
- `EXPO_PUBLIC_PHONE11_ANDROID_FOREGROUND_TRIAL=1`.
- `EXPO_PUBLIC_SIP_ENGINE=siprix`.
- `PHONE11_SIPRIX_ANDROID_AAR` pointing to an absolute, already staged AAR path.
- No store, iOS wake or chat notification commissioning.

Both omitted trial flags mean disabled. A missing, malformed or inconsistent flag
fails closed. The candidate Android package is `ai.phone11.mobile.foregroundtrial`;
the normal Android/iOS identities remain their existing configured values. The
candidate has its own Android runtime version; the iOS runtime and SDK metadata
retain their existing behavior.

The Expo plugin adds one manually owned Gradle project, one bridge package, the full
runtime AAR dependency and two explicit native gates. Gradle verifies the exact SDK
SHA-256 `3173ee8bae7aa37d3be3b44f7533d43b4e4d8625110d1d2bd8d79367973c9198`
and rejects activation without the same AAR in `:app` implementation dependencies.
The API extraction remains separate from executable APK packaging.

Native capability checks precede shared-engine initialization and do not acquire
the SDK lease or initialize SIP. The capability profile remains a foreground
60-second trial with all wake/background/closed-app/video/transfer claims false.
Native package/build/manifest gates are checked independently. React Native must
be resumed for initialization, account creation, registration, dial and Answer;
microphone permission must pass before dial/Answer SDK work. Cleanup stays available.
The existing account, generation, callback truth, duplicate request, cleanup-failure
quarantine, one-call and one-lease protections remain intact.

An ordinary prebuild removes the owned candidate project, full-AAR dependency,
package registration, Gradle property and manifest gate. Other plugin imports and
configuration remain available. Autolinking stays disabled; the candidate excludes
the Android PJSIP package.

## Verification

Run platform-independent checks with:

```sh
node --test tests/phone11-android-runtime-integration.test.mjs \
  modules/phone11-siprix/tests/android-runtime.test.mjs \
  modules/phone11-siprix/tests/android-sdk-binding.test.mjs
```

The separate `android-sdk-compiler.mjs` requires
`PHONE11_SIPRIX_ANDROID_AAR` and `PHONE11_ANDROID_API_JAR`.
`android-react-native-compiler.mjs` additionally requires explicit cached
`PHONE11_REACT_ANDROID_AAR`, `PHONE11_KOTLIN_STDLIB_JAR`, `PHONE11_FBJNI_AAR`,
`PHONE11_INFER_ANNOTATIONS_JAR`, `PHONE11_KOTLIN_ANNOTATIONS_JAR` and
`PHONE11_JSR305_JAR` paths. Neither compiler skips, downloads or mutates its inputs.
The latter compiles the whole actual module with real React Native 0.81.5 APIs,
the real Siprix/Android APIs and both native build flag values, without React stubs.

Validation on 5 October:

- Android configuration/native lifecycle and existing iOS configuration regressions passed.
- Shared calling/CallKit/engine-selection regressions passed, including Android
  missing/mismatched native capability and stale-session rejection.
- Both actual SDK/API and real React Native compiler gates passed.
- Actual Expo 54 trial prebuild, repeat prebuild and subsequent ordinary prebuild passed.
- Full repository TypeScript passed using the existing cached root and desktop dependencies.
- Scoped lint had zero errors; existing style warnings remain.

## Remaining acceptance

The hosted candidate APK must independently prove the exact trial package and
native gates, actual bridge and `SiprixCore` DEX classes, configured ABI native
library pairs, required permissions and absence of Phone11 wake/FCM services.
A debug APK proves compiler/linking/packaging and may depend on Metro; it is not a
self-contained release or handset calling result.

Release/runtime gates remain: matching standalone app identity, authenticated SIP
assignment, microphone recovery, incoming/outgoing controls, sustained licensed
two-way audio, OS call UI/audio focus, network/accessory recovery, cold-process
claim/ready/status/end ownership, push delivery, locked/Doze/process-death behavior
and physical target-device acceptance. No source capability in this slice claims
these results.
