# Phone11 signed internal release handoff

Date: 16 September 2026  
Scope: deliver a reviewed Phone11 source revision to the already provisioned
iPhone without replacing it with Expo Go, a development launcher, or a
different calling engine.

## Release lane

Use **only** `preview-ios-siprix-daily-pilot` for the next internal handset
candidate. It is an ad-hoc internal distribution build that retains:

- bundle identifier `space.manus.phone11ai.t20260425073427`;
- the Siprix engine and embedded native frameworks;
- production APNs, incoming-call wake and Chat-notification pilot markers;
- the `1.0.0-siprix-daily-pilot-1` runtime identity with Expo over-the-air
  updates disabled; and
- automatic EAS build-number incrementing.

The GitHub Actions manual-build default is this same profile. It has no effect
until an authorized operator dispatches the workflow. Do not use
`development`, an Expo development client, Expo Go, a locally generated Debug
app, PJSIP, or a store profile for this internal handset update. The two former
development-client profiles that reused Phone11's production bundle identifier
have been removed from `eas.json`; the automated release-profile guard rejects
any future attempt to add that unsafe combination back.

## Before requesting the signed build

1. Start from one reviewed commit on the Phone11 release branch and record its
   SHA. Confirm the working iPhone still has Phone11 installed and is included
   in the internal provisioning profile.
2. Preserve the known-good rollback IPA before replacing the app. Build 49 is
   the package-verification baseline; later retained signed builds may also be
   used as a physical rollback only after their identity is checked.
3. Run the relevant source, native and configuration checks. At minimum, the
   release workflow must finish its daily-use and native-check jobs before EAS
   signing begins. A local preview or JavaScript export is not a handset
   release gate.
4. Dispatch **Phone11 Siprix iOS internal build** with
   `preview-ios-siprix-daily-pilot`. Confirm the workflow source SHA matches
   the reviewed SHA and that EAS reports `FINISHED`. Do not substitute another
   finished EAS build from a different commit or profile.

## Verify the downloaded IPA before installation

Extract the exact downloaded artifact and run both read-only checks:

```sh
node scripts/verify-siprix-ipa.mjs /absolute/path/Phone11.ipa
python3 scripts/check-phone11-ios-release.py \
  /absolute/path/Payload/Phone11.app \
  --baseline-app /tmp/phone11-restore-build49/Payload/Phone11.app \
  --baseline-ipa /tmp/phone11-restore-build49/Phone11-49.ipa
```

The candidate is installable only if both checks pass and the expected app
identity, newer build number, daily-pilot runtime, production APNs,
commissioning markers, embedded JavaScript, Siprix frameworks, strict code
signature, and baseline-device provisioning coverage all match. Retain the
artifact hash, EAS build ID, source SHA and check output with the rollback IPA.

## Install and accept on the existing iPhone

1. Install the verified IPA **in place** over Phone11. Do not uninstall; this
   preserves the existing signed-in account and local encrypted state.
2. Confirm the installed bundle ID, version and build number from independent
   device inventory. Open Phone11 manually if iOS rejects remote launch.
3. Confirm it is the Phone11 product app, not an Expo sign-in screen or
   developer launcher. It must launch without Metro or a QR code.
4. Confirm registration reaches Ready to call, then run a consenting test call
   with incoming/outgoing audio, mute, End, Recents, recording state, playback
   and Team Chat recorded as separate results. Test background/locked calling,
   Bluetooth and Wi-Fi-to-cellular movement separately.
5. If launch, registration, audio or the signed identity fails, stop the test,
   reinstall the retained known-good signed IPA in place, and record the exact
   failure. Do not attempt recovery with a Debug, local Release, PJSIP or
   development-client build.

## Boundaries

This handoff does not request an EAS build, alter signing credentials, publish
an update, submit to TestFlight/App Store, change PBX routing, or activate any
production feature. Store release remains blocked on the separate App Store
readiness gates, including a production Siprix license and complete physical
acceptance.
