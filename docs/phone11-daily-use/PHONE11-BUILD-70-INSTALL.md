# Phone11 Build 70 — Team Chat visual update

[Open the signed Build 70 install page](https://expo.dev/accounts/vasavas/projects/phone11ai/builds/1bda4c6d-278f-427b-90c0-c687c5eadfc9).

Scan `artifacts/Phone11-build-70-install.png` from the second registered iPhone. Install over the existing Phone11 app; do not uninstall it and do not use a development launcher.

## Signed artifact

- App: Phone11 1.0.0, build 70
- Bundle ID: `space.manus.phone11ai.t20260425073427`
- EAS build ID: `1bda4c6d-278f-427b-90c0-c687c5eadfc9`
- Build profile: `preview-ios-siprix-daily-pilot`
- EAS fingerprint: `3ec64e06172a27287151604ab806dfb68934f035`
- IPA SHA-256: `88bcf768d689c3a60d855d3c62db5efc8da65c25e84064933d285372e219c89a`

The signed-app gate passed all 18 checks: expected identity/version, Build 49 baseline, Siprix daily runtime, over-the-air updates disabled, commissioned call wake and chat notifications, Phone11 API origin, production APNs, signing identity, debugging disabled, strict code signature, embedded JavaScript, both Siprix frameworks and provisioning coverage for both pilot iPhones. The native verifier also confirmed the Phone11 Siprix bridge and absence of the legacy bridge.

## Installed evidence

Build 70 was installed in place and launched on the connected iPhone. Device inventory then reported Phone11 1.0.0, bundle version 70. This proves installation and launch only; Team Chat appearance, messaging and locked-screen notification behavior still require handset acceptance.

## Team Chat source in this build

- Inbox SHA-256: `06d965e881ed6bc9296828c40080042e68286c2b7fa9b9a8d2cb504af32c69b6`
- Conversation SHA-256: `4dcb1fb59192a68ce6a44675170eba8adce843b0452880bcd7a102354752e7eb`
- Focused Team Chat UI tests: 30 passed
- Team Chat notification tests: 48 passed
- Standalone/native packaging guards: 16 passed
- TypeScript and bounded whitespace checks: passed
