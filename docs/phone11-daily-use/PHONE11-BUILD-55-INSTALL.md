# Phone11 Build 55 install

This QR opens the verified Expo install page for Phone11 `1.0.0 (55)`:

![QR code for the Phone11 Build 55 install page](PHONE11-BUILD-55-INSTALL-QR.png)

Direct install page:

[Open Phone11 Build 55](https://expo.dev/accounts/vasavas/projects/phone11ai/builds/42cda9a0-eb1b-45f3-b540-84a7c04b4ef8)

## Install on the registered iPhone

1. Open the iPhone Camera app and scan the QR.
2. Confirm Safari opens an `expo.dev` page for Build 55.
3. Choose Install. Install over the current Phone11 app to preserve its data.
4. Open Phone11 and confirm the Settings screen contains **Recording & AI** and the **System / Light / Dark** appearance choices.

Build 55 is an ad hoc internal package. It installs only on iPhones included in its provisioning profile. A different iPhone must first be registered and included in a newly signed build.

## Verified package

- Source commit: `f0d8b30e4b5affea03a5b2572d5f74d16fd38140`
- EAS build ID: `42cda9a0-eb1b-45f3-b540-84a7c04b4ef8`
- Bundle ID: `space.manus.phone11ai.t20260425073427`
- Version/build: `1.0.0 (55)`
- SHA-256: `1b6a446a16bb7d7ef1694c267040fa12f0464b4ed1b529812583dd8395a6f878`
- Siprix and SiprixMedia frameworks are linked.
- Deep code-signature verification passed.
- The package retains production APNs, wake commissioning, chat-notification commissioning, and the baseline handset provisioning identity.

This package has automatic Expo updates disabled. The QR installs Build 55; it does not silently update an installed copy. Native calling behavior still needs handset acceptance after installation.
