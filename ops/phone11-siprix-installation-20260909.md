# Phone11 Siprix iOS Installation

## Scope

Install Siprix into the existing Phone11 React Native app, preserving its bundle identity and sign-in storage. This is an internal voice trial, not a paid license, public release, or production telephony cutover.

- Profile: `preview-ios-siprix`, channel: `siprix-trial`.
- Runtime: `1.0.0-siprix-1`; build flag: `EXPO_PUBLIC_SIP_ENGINE=siprix`.
- SDK: Siprix 1.0.40 from `siprix/SampleSwiftUI` commit `53ae99e16531f64cf6e7832ed9e5d126a7e2d4ce`.
- Archive and device binary SHA-256 checks enforced by `scripts/stage-siprix-sdk.mjs`.
- Trial calls are limited to 60 seconds per the [vendor download terms](https://www.siprix-voip.com/download/). This is the trial constraint, not a verified handset call-duration result.

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

### Verified Build And Package Gates

Verified on September 9, 2026. These checks establish the signed package contents, not device or telephony acceptance.

- Build source: `186ce5e141bbdaa871c166fe9cdb07dc70666ff1`.
- [GitHub Actions run 34375812385](https://github.com/vasavas1977/codex-phone11/actions/runs/34375812385): `completed`, conclusion `success`, at that exact source SHA; checked with `gh run view`.
- EAS build: `15c70587-dbb5-4252-91c7-6036e2e9fff6`, platform `IOS`, profile `preview-ios-siprix`, status `FINISHED`. The local build-result JSON confirms the same source SHA and completion at `2026-09-09T16:25:11.928Z` (23:25:11 Asia/Bangkok).
- Build-result evidence: `/tmp/phone11-siprix-build-result/phone11-siprix-build.json`.
- Signed IPA: `/tmp/phone11-siprix-build10.ipa`.
- IPA SHA-256: `ce4414c2baa962817971fd347dd7f84b2eec446c57c04c0f81f732b3a673f2db`.
- Package version `1.0.0`, build number `10`; bundle identifier preserved as `space.manus.phone11ai.t20260425073427`. Package identity does not by itself prove sign-in storage survived installation.
- Re-ran `node scripts/verify-siprix-ipa.mjs /tmp/phone11-siprix-build10.ipa`: exit `0`; matching SHA-256, `siprix.framework` and `siprixMedia.framework` present and linked, `Phone11Siprix` native class present, and `PjSipModule` class absent under the verifier's binary checks.
- `codesign --verify --deep --strict` passed for the extracted app. The verifier explicitly reports `handsetRuntimeVerified: false`.

### Verified Device Installation And Launch

Parent-provided device verification on September 9, 2026; these handset actions were not repeated by this documentation update:

- `pymobiledevice3 apps install` succeeded at 100%, installing signed Build 10 in place. No uninstall was performed.
- `pymobiledevice3 apps list` confirms the original bundle `space.manus.phone11ai.t20260425073427`, version `1.0.0`, build `10` on the device.
- DVT launch returned process ID `46441`. This confirms the launch request returned a process, not sustained app health, rendered UI, SDK initialization, or registration.
- UI inspection is blocked at the Mac login in iPhone Mirroring; the owner has been asked to unlock. No successful app UI inspection is claimed.

### Build 10 Handset Startup Finding

- Mirroring connected after owner authentication; Phone11 rendered its dark keypad and Settings, with `Signed In` and the existing extension visible.
- An explicit registration test at 23:35:55 Asia/Bangkok failed with `Siprix initialization failed (E_SDK_VERSION)`. It did not reach SIP registration.
- The native bridge compared `[sdk version]` to bare `1.0.40`. Inspection of the checksum-pinned arm64 framework's `SiprixModule::version()` shows the default `siprix` product prefix concatenated with ` 1.0.40 from 20260620_1419`.
- The correction accepts only the pinned version's known formatting, preserves the original SDK version in snapshots, and still rejects unknown versions. Source tests do not establish that the replacement package runs on the handset; a signed rebuild and repeated device test are required.

### Pending Device And Runtime Gates

Installation, process launch, and the app UI are verified above. The following remain unverified:

- Successful native Siprix SDK initialization. The UI retained the signed-in account and extension, but a fresh authenticated API request has not yet been checked.
- Native-confirmed SIP registration/unregistration and account isolation on the installed app.
- Inbound/outbound call signaling, answer, local/remote termination, and CallKit lifecycle on the physical iPhone.
- Physical two-way audio, PSTN audio, speaker/earpiece/Bluetooth routing, mute, hold, and DTMF. A connected UI or package signature is not audio proof.
- Runtime behavior within the 60-second trial limit; longer-call capability is not established by this trial.
- Background, locked/suspended, terminated-app and PushKit incoming-call behavior.
- DID routing/reachability and end-to-end inbound delivery.

This evidence update performed no handset action, live call, server change, license change, or production activation.

## Independent Server Issue

The previously staged Kamailio mid-dialog private-route repair remains unapplied pending approval. Installing a different handset SDK does not establish that ACK/BYE routing or PSTN audio is fixed. Do not restart the server or promote that candidate as part of this SDK installation.
