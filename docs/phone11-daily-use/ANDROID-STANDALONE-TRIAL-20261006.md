# Standalone Android foreground trial source

This source adds an INTERNAL release APK path for the isolated 60-second Siprix
trial. It does not establish a signed build or phone result. No cloud build,
SDK download, dependency installation, signing, provider change or handset action
was performed to prepare this path. Physical tests remain owner-deferred.

## Frozen build inputs

Use `preview-android-siprix-foreground-trial` only for Android. It has no inherited
iOS or development-client profile: INTERNAL distribution, `developmentClient=false`,
`buildType=apk` (`:app:assembleRelease`), remote version-code auto-increment,
`android-foreground-trial` channel, preview environment, pnpm 9.12.0 and the
`ubuntu-24.04-jdk-17-ndk-r27b` SDK-54 image.

Its explicit native/public foreground flags are both `1`; store, wake, commissioned
chat and both screen flags are `0`. Siprix selection, API origin `https://api.phone11.ai`
and scheme `phone11` must agree. The existing config/plugin retain:

- package `ai.phone11.mobile.foregroundtrial`;
- Android runtime `1.0.0-siprix-android-foreground-trial-1`, legacy RN bridge and
  no `expo-updates` native client dependency;
- one manually registered bridge with the full runtime AAR;
- ARM64 and ARMv7 only, with the four Siprix native library bytes preserved;
- Siprix 1.1.0 build `20260905_1222`, no license credential, 60-second call limit,
  foreground audio only. Wake/background/closed-app calling remains unsupported.

Keep Expo 54 / React Native 0.81.5 and the exact reviewed lockfile/patches. A
future authenticated build receipt must bind its actual submitted source SHA,
profile, image, version code and APK bytes. A source test or older staging APK
does not supply that receipt.

## SDK transport and local readiness

The new EAS pre-install hook runs Android transport only when the exact profile,
cloud/platform and full flag agreement pass. It obtains the AAR directly from the
official SampleJava revision `80d198ed6179b45ff8cd8dad9b8086976b4197a0`, checks
SHA-256 `3173ee8bae7aa37d3be3b44f7533d43b4e4d8625110d1d2bd8d79367973c9198`,
then atomically writes private build-local bytes and uses `set-env` to supply the
absolute AAR path to later phases. It accepts no URL override or redirect, limits
the body to 64 MiB and the complete transfer to 120 seconds, and fails before
dependency installation on transport, checksum or environment-publication failure.
An explicit existing AAR path must already be absolute, regular and checksum-pinned;
an invalid supplied path never falls back to a download.

The new profile's postinstall verifies that staged Android AAR instead of running
the iOS SDK stage, so it cannot remove the Android SDK by replacing the iOS vendor
directory. Other iOS, ordinary Android and existing debug CI install plans retain
their prior dispatch. Vendor files remain excluded from the EAS source archive;
the transport does not upload or rehost the standalone SDK. Readiness and tests
use an explicitly supplied already-owned AAR and perform no network operation.

Expo documents [pre-install before native generation](https://docs.expo.dev/build-reference/android-builds/),
[persistent build environment variables](https://docs.expo.dev/eas/environment-variables/usage/),
and [release APK profile behavior](https://docs.expo.dev/eas/json/).
Siprix documents its [60-second trial](https://www.siprix-voip.com/download/)
and [application-conjoined distribution and restrictions](https://docs.siprix-voip.com/rst/license.html).
This path preserves evaluation use; it makes no production-license claim.

## Fresh signed APK gate

The existing `--trial` verifier remains debug-only. For a fresh standalone build,
use the new `--standalone-trial` mode with the actual APK, installed `apkanalyzer`
and `apksigner`, the pinned local AAR, and `--expected-signer-sha256` from an
independent trusted signing-custody receipt. Do not derive the expected fingerprint
from the candidate APK being accepted. No keystore or password is read by this gate.

The mode requires a non-debug, non-test-only manifest, the separate package/native
gate, actual bridge/SDK DEX definitions, required audio permissions, ARM-only native
inventory and the four SDK hashes. Screen capture and Phone11-owned wake/push
services must remain absent. Generic Expo notification libraries are not evidence
of commissioned Phone11 notifications. A bounded nonempty embedded Hermes bundle
must exist; its identity is recorded without claiming execution or bytecode semantics.
The gate also rejects an Expo OTA runtime or enabled OTA metadata.

The CLI cryptographically verifies the same private APK snapshot with the actual
Android SDK `apksigner`, requires one signer and a verified v2/v3 scheme, and checks
the independently supplied certificate fingerprint before emitting a signed package
receipt. Direct byte inspection always says `signature_verified=false`. Mocked tools
cannot establish acceptance. Preserve the authenticated EAS FINISHED/source/profile
receipt, actual APK hash and independent signing identity alongside this result.

Only after that fresh package gate and owner action-time build/distribution authority
may its EAS build-details page be handed off for installation. Keep previous packages
under their original provenance. The separate trial application ID does not replace
the retained iOS daily-pilot app or another Android identity. Startup without Metro and
actual call/audio/permission lifecycle results still require the deferred handset tests.
