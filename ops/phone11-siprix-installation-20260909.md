# Phone11 Siprix iOS Installation

## Scope

Install Siprix into the existing Phone11 React Native app, preserving its bundle identity and sign-in storage. This is an internal voice trial, not a paid license, public release, or production telephony cutover.

- Profile: `preview-ios-siprix`, channel: `siprix-trial`.
- Runtime: `1.0.0-siprix-1`; build flag: `EXPO_PUBLIC_SIP_ENGINE=siprix`.
- SDK: Siprix 1.0.40 from `siprix/SampleSwiftUI` commit `53ae99e16531f64cf6e7832ed9e5d126a7e2d4ce`.
- Archive and device binary SHA-256 checks enforced by `scripts/stage-siprix-sdk.mjs`.
- Trial calls are limited to 60 seconds per the vendor download terms: https://www.siprix-voip.com/download/

## Ownership

`Phone11Siprix` is the native calling module. CallKeep remains the only CallKit provider and forwards OS audio activation/deactivation to Siprix. PJSIP is excluded from native iOS autolinking for this build, while the old adapter remains available for a separately built rollback profile.

Credentials come from the existing authenticated provisioning store and are not written into native preferences or diagnostic logs. Native generation/sequence checks and JS ownership checks reject obsolete callbacks after logout/account replacement. No SIP passwords are rotated by this installation.

The trial adapter supports one audio call, registration, incoming/outgoing calls, answer/hangup, mute, hold, DTMF and speaker routing. Video and transfer fail explicitly; no fallback into PJSIP is allowed. PushKit wake/terminated-app incoming calls remain a separate unfinished integration.

## Evidence

- Verified autolinking resolves Phone11Siprix and CallKeep, without PJSIP.
- Siprix-selected iOS Metro export succeeded.
- Existing authentication tests: 52 passed; existing SIP/auth/audio tests: 26 passed.
- Dedicated Siprix adapter, selection, native bridge and CallKit tests are run by the signed-build workflow.
- Full repository TypeScript check has existing unrelated marketing-site, server and missing transfer-type errors; it is not a passing release gate.
- USB discovery during implementation returned no connected iPhone; owner was asked to reconnect/unlock.
- Signed build, IPA inspection, handset installation/startup, SIP registration, and two-way PSTN audio are distinct pending verification gates until recorded below.

## Independent Server Issue

The previously staged Kamailio mid-dialog private-route repair remains unapplied pending approval. Installing a different handset SDK does not establish that ACK/BYE routing or PSTN audio is fixed. Do not restart the server or promote that candidate as part of this SDK installation.
