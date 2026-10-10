# Mobile trial release inputs — 6 October 2026

There is no authenticated signed mobile package receipt for current source
`faffc1a7ba20df3bda7529d00b6c969873960401`, tree
`46b4aba9e0809fa166514bc4507918f889a8b858`. This is a trial handoff only;
no build, signing, download, installation, handset launch or provider action was
performed. Physical phone testing remains owner-deferred.

## Source and retained package relationship

Read-only `git ls-tree -r` observations of the selected mobile input paths give
396 entries and inventory SHA-256
`8d9a7cee493f4f8253e1c037c2736add64712dac7b15d67726339deab4734f79`
for both this candidate and Mobile CI source
`617dbd256a2c766c59dfd6b5909fde6f2d472502`. These paths cover app/assets,
components/constants/hooks/lib/shared/modules/plugins/patches, package/lock/config
files and the environment/native-prebuild/SDK-stage scripts. The exact inventory
is retained privately at `/tmp/phone11-mobile-trial-release-inputs-20261006`.
It is a scoped source comparison, not a submitted archive digest or cloud
reproducibility proof. Later documentation-only commits may preserve this digest;
the actual future EAS build must retain its own exact submitted source SHA.

Retained Build 120 has 69 differing entries in that scope. Its provenance stays:

- source `da04d979f9a05ebd803d7b3545f49fe22c4fa401`, tree
  `254b5e3842959c2d29d68833bc21a3ec8c6c27f5`;
- EAS `7a137569-5519-4596-b91d-2cede965df9e`, recorded FINISHED / INTERNAL,
  `preview-ios-siprix-daily-pilot`, version 1.0.0 / build 120;
- IPA 26,348,843 bytes, current local SHA-256
  `e7adb470823dc04b296897b8dccaa6275c93eecd619a7c6f1a2a9aab0ebfbff3`;
- historical independent package approval: 22 signed checks and 42 supplemental
  checks; Siprix 1.0.40 trial, 60-second limit, configured-license boolean false,
  new architecture false, OTA false; installation/launch were not performed.

The retained [Build 120 details page](https://expo.dev/accounts/vasavas/projects/phone11ai/builds/7a137569-5519-4596-b91d-2cede965df9e)
keeps its original package identity. It is not a current-candidate install link.
Its local IPA remains in
`~/Library/Application Support/Phone11/verification/ios-integrated-trial-da04d97-20261004/Phone11-120.ipa`.
Build 119 is also retained unchanged at
`~/Library/Application Support/Phone11/verification/ios-transfer-removal-voicemail-next-20261004/Phone11-119.ipa`,
SHA-256 `3004eaf8ffd731e862a238cc46e4c25d885179fe4ef9adb2e253a229a0cec902`.

The recovered Build 113 receipt binds source
`ae54c8a9c8f81aef6e56d98ff869d3a98dcb7924` to re-signed EAS
`8eaabd8e-8ee8-4ad8-99b8-c5bce09079f4`. Its retained IPA is 26,346,738 bytes,
SHA-256 `d8f3ac0d7a96050b1a45946269a5554667e68db2fd47efa7d7cfb43af2d58996`.
It is separate from Build 113's original signing/package receipt and cannot cover
this candidate. No current handset inventory was collected.

## Fresh iOS trial inputs

Use the reviewed standalone INTERNAL profile
`preview-ios-siprix-daily-pilot`, channel `siprix-daily-pilot`, registered bundle
`space.manus.phone11ai.t20260425073427`, API origin `https://api.phone11.ai`,
scheme `phone11`, Siprix selection, commissioned incoming-call/chat flags and
production APNs already specified by its inherited profiles. The pinned cloud
image is `macos-sequoia-15.6-xcode-26.0`. Keep store and both Android foreground
and screen gates off. No production SDK license is an input to this trial.

Keep Expo 54, RN 0.81.5, LiveKit RN 3.0.0 / RN WebRTC 144.2.0 /
livekit-client 2.22.3 and the reviewed lockfile/patches. The already staged iOS
Siprix 1.0.40 arm64 binaries match `stage-siprix-sdk.mjs` pins:
`siprix=e46cc2aa751037b765d98dfc661d520b7a4717f59f9347de3ee295e72b2b9d7f`,
`siprixMedia=52fe237d7224304c0e7ad3bba4d0e404ea1078dc959baf93465bd2d29cf418e8`.
The archived framework source revision is
`53ae99e16531f64cf6e7832ed9e5d126a7e2d4ce`; no staging/download was run here.

An authorized build needs a clean frozen checkout, release prerequisites passing
at that source, existing signing identity and current provisioning coverage for
the intended test devices, and a remote auto-incremented build number newer than
the retained trial. No particular next number or current signing/device coverage
is inferred from the old receipt. Afterward bind EAS FINISHED status/profile/SHA
and the actual IPA hash, run the current combined package gate against retained
Build 49, and retain supplemental trial/configuration/device-coverage evidence.
The expected candidate runtime is
`1.0.0-siprix-daily-pilot-chat-media-2`, with OTA disabled and the trial SDK.
Once verified, hand off that build's EAS details page and QR for in-place install;
retain Build 120/119 and the known-good Build 49 baseline without alteration.

## Android package gap

The Mobile CI foreground trial uses `:app:assembleDebug`. The workflow explicitly
states that this APK may require Metro and is not distributed. No matching
standalone signed Android trial package is established, and `eas.json` has no
dedicated standalone foreground-trial profile. Do not hand off that debug APK as
the signed release or use an iOS commissioned profile for Android.

A separate reviewed Android trial package/profile must bind
`ai.phone11.mobile.foregroundtrial`, runtime
`1.0.0-siprix-android-foreground-trial-1`, matching native/public foreground
flags = 1, Siprix selection, and store/wake/chat/screen flags = 0. The SDK is
1.1.0 build `20260905_1222`, 60-second trial; its exact AAR SHA-256 is
`3173ee8bae7aa37d3be3b44f7533d43b4e4d8625110d1d2bd8d79367973c9198`.
Supply the pinned AAR through a reviewed build transport, package only ARM64 and
ARMv7, preserve its four native library hashes, and verify the actual standalone
APK with the current trial verifier. Signing/distribution custody and absence of
a Metro dependency need their own receipts. Existing staging/lab packages keep
their separate branch provenance. Android background wake remains unsupported.
