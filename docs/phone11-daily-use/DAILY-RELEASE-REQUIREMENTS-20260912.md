# Phone11 release requirements — 12 September 2026

This independent release audit makes no production, device, purchasing or provider changes. The current operational record is [Daily readiness](DAILY-READINESS-20260912.md). Build 25 is installed and the owner reports Ready to call; that status is not background-call or long-call acceptance.

## License needed for normal call lengths

The owner has no paid Siprix license. The vendor documents a 60-second trial call limit ([Siprix download](https://www.siprix-voip.com/download/)). Build 25 has no configured license. The current app therefore remains a short-call pilot even if background ringing succeeds.

A procurement request is ready to specify:

- Product: Phone11 native iOS SIP calling SDK, including production redistribution and unrestricted call duration.
- App identifier: `space.manus.phone11ai.t20260425073427`; confirm the vendor's exact identifier binding and whether a later identifier change needs another license.
- Confirm supported SDK version, iOS versions, commercial distribution rights, updates/support period, license validation and offline behavior, expiry/revocation behavior, and whether Android requires separate coverage.
- Obtain a written quote and binding scope/terms before purchase. The vendor's site advertises a one-time model, but this audit does not establish a price or coverage for Phone11 ([Siprix](https://www.siprix-voip.com/)). No vendor contact, purchase or terms acceptance is authorized or performed here.

Implementation already supports `PHONE11_SIPRIX_LICENSE` during native prebuild. `app.config.ts` writes only the native `Phone11SiprixLicense` plist value; the bridge applies that value during SDK initialization. It is excluded from public Expo runtime configuration. It is embedded in the distributed native artifact, so this is not a promise that an installed-app license is unextractable. Do not put the real value in chat, Git, public configuration or logs. Use a protected build secret after the owner supplies an authorized license.

After configuration, make a newly signed build, inspect license presence without printing it, and confirm SDK initialization plus an actual two-way public-number call well beyond 60 seconds. Configuration alone does not prove the license was accepted. Repeat Answer, End and Recents on that licensed artifact.

## Signed artifact and renewal

Build 25 artifact SHA256 is `d29afc67a2a88cec6b040dbc613df4a57b15fa5581c55f2e4497c7138bb0ce2c`, application source `1b004bac738111d1ba7849e627341f641cea3af1`. Direct decoding of its embedded provisioning profile and distribution certificate on 12 September found:

| Item | Verified value |
| --- | --- |
| Distribution | Registered-device ad hoc profile; one device; debugging disabled |
| Profile expiry | 28 April 2027, 03:36:38 UTC / 10:36:38 Bangkok |
| Signing certificate expiry | 28 April 2027, 03:36:38 UTC / 10:36:38 Bangkok |
| Update behavior | Updates disabled; native changes require a replacement signed installation |
| Pilot runtime | `1.0.0-siprix-daily-pilot-1` |

Renew and install a freshly signed build before expiry; these dates are not a guarantee against earlier revocation or account changes. Registered-device distribution does not cover arbitrary additional phones. Apple explains [ad hoc profiles](https://developer.apple.com/help/account/provisioning-profiles/create-an-ad-hoc-provisioning-profile) and [regenerating expired profiles](https://developer.apple.com/help/account/provisioning-profiles/edit-download-or-delete-profiles). No reminder was scheduled or distribution channel changed by this audit.

## Upgrade and rollback acceptance

Preserve the accepted scoped PCMA route, existing bundle identity, signed baseline artifacts and exact prior backend configuration. Before any operational rollback, require a fresh zero-call check across all three call/media systems; an unexplained RTP session must not be deleted merely to pass the guard.

An application rollback is a separate signed install, not an over-the-air update. Verify the baseline profile remains valid, review compatibility with the current backend, and confirm in-place installation and retained account state; do not assume older-build downgrade behavior or uninstall a signed-in app. Prefer a forward corrective build if downgrade cannot safely retain state. Build 23's historical foreground audio result does not prove its compatibility with every later server change.

The live operational record reports backend `f21e763` owner authentication, phone-configuration equality and legacy chat-owner compatibility accepted. This audit independently reran 13 local chat-owner tests covering expected-owner binding and older clients without the header. These tests do not substitute for physical calls, provider delivery or a live rollback rehearsal. Keep additive schemas when restoring only application code unless a separate reviewed data rollback requires otherwise.

## Remaining physical acceptance

1. Fresh all-idle check, reviewed provider and routing activation, then locked and background incoming calls with audible speech in both directions, immediate End and one Recents entry.
2. Treat foreground, locked, OS-reclaimed and user force-quit states separately; record limitations actually observed.
3. Licensed calls beyond 60 seconds; incoming and outgoing public-number paths, missed and declined calls, and repeated calls after idle.
4. Wi-Fi/cellular transitions and recovery after loss of service; microphone permission recovery, mute, speaker, Bluetooth and interruption behavior.
5. Authorized second chat participant: send/receive, unread reconciliation, locked-screen alert and notification tap; deploy and verify the separate message-alert backend/migration first.
6. Recheck sign-in recovery and upgrade persistence, plus production distribution and renewal ownership before wider release.

No background, long-call, two-person chat, voicemail, transfer or full Zoom parity claim follows from this checklist.

## Local validation

- `node --test tests/phone11-siprix-packaging.test.mjs`: 9 passed, including blank/missing license behavior, native-only license injection and absence from public Expo configuration.
- `node node_modules/vitest/vitest.mjs run tests/phone11-chat-owner.test.ts`: 13 passed.
- Direct signed IPA profile/certificate inspection yielded the dates above; no keys, passwords or certificate bodies were printed.
- The initial package-manager wrapper refused a dependency-directory operation; no override or reinstall was used. Tests ran through the existing local runner.
