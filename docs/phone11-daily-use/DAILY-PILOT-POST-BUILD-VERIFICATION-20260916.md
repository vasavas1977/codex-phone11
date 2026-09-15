# Phone11 daily-pilot post-build verification

Date: 16 September 2026  
Scope: the signed internal iOS candidate produced by the
`preview-ios-siprix-daily-pilot` profile. This is a release evidence checklist,
not a request to build, install, publish, change credentials, or alter PBX
routing.

## Evidence must agree

Do not treat a browser login, a green EAS build, an IPA, or a successful
installation as interchangeable evidence. Record all of these for the same
candidate:

| Checkpoint | Required evidence | Reject when |
| --- | --- | --- |
| Source | Reviewed Git SHA and clean workflow checkout | SHA differs from the selected build source |
| CI | `daily-use-check` and `native-check` succeeded | either prerequisite is skipped, cancelled, or failed |
| EAS | `FINISHED`, `preview-ios-siprix-daily-pilot`, same source SHA, immutable build ID and artifact URL | profile is development, basic preview, wake-only, PJSIP, simulator, or store |
| IPA | SHA-256 retained, package gate succeeds | bundle, signing, provisioned device coverage, native bridge, runtime, or pilot marker differs |
| Handset | in-place install, app inventory, normal product launch, registration and feature acceptance | it opens Expo Go, a development launcher, a Metro/QR prompt, or a different build |

A Chrome session can be useful for the EAS web console. It does not by itself
authenticate the local EAS CLI or GitHub Actions secret used to create a build.
The operator must verify the EAS build record after an authorized workflow run.

## Candidate identity

The daily-pilot candidate must resolve to all of the following:

- profile and channel: `preview-ios-siprix-daily-pilot` / `siprix-daily-pilot`;
- bundle identifier: `space.manus.phone11ai.t20260425073427`;
- app version: `1.0.0`; build number strictly greater than the Build 49
  rollback baseline;
- runtime: `1.0.0-siprix-daily-pilot-1`, with Expo updates disabled;
- SIP engine: Siprix, including `siprix.framework` and
  `siprixMedia.framework`, with the `Phone11Siprix` bridge present and legacy
  PJSIP bridge absent;
- production APNs, `Phone11WakeCommissioned = 1`,
  `Phone11ChatNotificationsCommissioned = 1`, and wake origin
  `https://api.phone11.ai`;
- retained bundle/application/team signing identity, `get-task-allow = false`,
  and a valid profile covering the known-good device.

The trusted rollback is Build 49 at:

```text
/Users/vasavas16macbookpro/Library/Application Support/Phone11/verified-builds/49/Phone11-49.ipa
```

Keep that IPA untouched until the candidate passes package and handset checks.

## Exact post-build procedure

1. In the EAS build page, record the build ID, profile, status, source SHA,
   finish time and artifact URL. Compare the SHA with the reviewed release
   commit. Download the IPA without changing its name or contents.
2. Save the artifact's SHA-256 beside those fields. Do not use an older IPA
   from Downloads merely because it has a similar version number.
3. From the Phone11 release checkout, run the combined, read-only package gate:

   ```sh
   node scripts/verify-phone11-daily-pilot-ipa.mjs \
     /absolute/path/to/downloaded/Phone11.ipa \
     --baseline-ipa \
     "/Users/vasavas16macbookpro/Library/Application Support/Phone11/verified-builds/49/Phone11-49.ipa"
   ```

   Exit `0` and `"passed": true` are required. The command verifies the IPA
   archive layout, application identity, native Siprix linkage and bridge,
   strict code signature, embedded JavaScript, daily-pilot runtime, disabled
   OTA updates, signing entitlements, pilot markers and baseline device
   coverage. It removes only its temporary inspection files.
4. Save the JSON output with the EAS build metadata and candidate hash. Do not
   log the provisioning profile, device identifiers, certificates, SIP
   credentials, license, or API tokens.
5. Install only the verified IPA **in place** over the existing Phone11 app.
   Do not uninstall. Confirm independent device inventory reports the expected
   bundle ID, version, and new build number.
6. Launch Phone11 manually. It must reach the product sign-in/Ready-to-call
   path without Expo sign-in, Expo Go, Metro, QR scanning, or a development
   launcher. Confirm retained account state before placing a call.
7. Record separate handset results for: outgoing and incoming audio; mute;
   End; Recents; recording start/stop/finalization; recording playback; named
   transcript/summary; Team Chat; locked incoming call; Bluetooth output; and
   Wi-Fi-to-cellular movement. A passing package gate proves none of these.

## Failure handling

- Package or provenance failure: do not install. Retain the downloaded IPA and
  record the failed checkpoint.
- Install, launch, registration, or audio failure: stop the test, restore the
  retained Build 49 IPA in place, and capture the exact build ID, app inventory
  and failure time. Do not recover using Expo Go, a debug build, a local
  Release app, PJSIP, or a different profile.
- A missing EAS CLI login or GitHub Actions secret is a build-dispatch blocker,
  not a reason to substitute another package. It requires the authorized
  account owner to complete the sign-in on the actual build surface.

## Script assessment

`verify-siprix-ipa.mjs` validates the IPA's Siprix linkage, native bridge
symbols, absence of the legacy bridge, strict signature, bundle ID and hash.
`check-phone11-ios-release.py` validates the signed daily-pilot configuration
against Build 49. The new `verify-phone11-daily-pilot-ipa.mjs` combines both
without requiring the operator to unpack either IPA manually. It intentionally
does **not** claim EAS provenance, device installation, registration, live
audio, notification delivery, recording, PBX routing, or user acceptance.
