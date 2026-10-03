# Phone11 Build 54 scan-to-install handoff

Date: 15 September 2026

This QR opens the verified EAS Build page for Phone11 `1.0.0 (54)`:

![QR code for the Phone11 Build 54 EAS install page](PHONE11-BUILD-54-INSTALL-QR.png)

If scanning is unavailable, open the same page directly:

[Open the Phone11 Build 54 EAS page](https://expo.dev/accounts/vasavas/projects/phone11ai/builds/383548fa-9833-4346-a678-e7256bee030f)

## Install from the iPhone

1. Scan the QR with the iPhone Camera app.
2. Confirm Safari opens an `expo.dev` page whose build ID ends in
   `383548fa-9833-4346-a678-e7256bee030f`.
3. Use the install action on that page. If Expo asks for account access, use an
   account that is allowed to view this `vasavas/phone11ai` build.
4. Install in place to preserve existing Phone11 app data. Do not delete the
   currently installed app as a workaround.
5. After installation, confirm the app reports version `1.0.0` and build `54`
   before running handset acceptance.

The previous QR is retired. It decoded to the raw EAS `.ipa` artifact URL,
which Safari can treat as a download rather than presenting the supported EAS
install handoff.

## Verified identity

- EAS build page:
  `https://expo.dev/accounts/vasavas/projects/phone11ai/builds/383548fa-9833-4346-a678-e7256bee030f`
- The replacement QR independently decodes to that exact page.
- The page responded successfully and identifies an internal-distribution
  build.
- Bundle ID: `space.manus.phone11ai.t20260425073427`.
- Version/build: `1.0.0 (54)`.
- Local IPA: `/private/tmp/Phone11-54-e4842.ipa`.
- SHA-256:
  `c6d7c3a21ac832e4973dc72898922c3e5491e4f9aa378c1dd0d8b9fab8a953a4`.
- The hosted EAS artifact and local IPA produced the same SHA-256.
- The embedded provisioning profile expires on 28 April 2027.
- `EXUpdatesEnabled` is `false` in both the retained Build 49 baseline and
  Build 54.

## Actual installation limits

Build 54 is an ad hoc iOS package whose embedded provisioning profile includes
one registered device. Installation will fail on any other iPhone. If the
scanning iPhone is not that registered device, register it with the Phone11 EAS
project and create a new signed build; changing the QR cannot add a device to an
already signed IPA.

The iPhone must run iOS 15.1 or later and must be able to reach `expo.dev` and
the hosted artifact. An unavailable or unauthorized EAS page, an expired link,
or a blocked network also prevents this handoff.

Build 54 does not receive automatic Expo over-the-air updates. Any later source
change requires a separately built and installed package. Installing the IPA
would prove only package installation and launch; it would not prove account
retention, SIP registration, incoming or outgoing calling, two-way audio,
background/locked ringing, recording, playback, or task synchronization.

No installation, deployment, device registration, or credential access was
performed while preparing this handoff.
