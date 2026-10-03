# Phone11 Build 81 — Zoom-style chat header

22 September 2026.

## Release

- Source: `f9dfcff9013df6bf9136d1c4ab8eed7dba107e9d`.
- CI: https://github.com/vasavas1977/codex-phone11/actions/runs/35679406557 — success.
- Signed daily-pilot, version 1.0.0 / build 81.
- Installation page: https://expo.dev/accounts/vasavas/projects/phone11ai/builds/50819203-cc93-4d66-9176-ccdfafe38c94
- IPA SHA-256: `3f1b6070ab4aefec90cca59d5fc90b32f0da3014104df34d8956b0a3ba42148b`.
- Retained package: `~/Library/Application Support/Phone11/verified-builds/81/Phone11-81.ipa`; Build 80 retained for rollback.

Build 80 predates the chat header change in `84bf0e8`; it must not be described as containing this update. Build 81 includes the profile/avatar layout, presence line and video control beside the phone control in direct conversations. The camera remains visible while availability is checked or denied, with disabled semantics. A cached capability plus a refresh error cannot navigate.

## Verification

- Worker: 26 focused meeting-action, avatar and chat-control tests passed; type checking and diff check passed. Main separately passed 30 profile/chat tests.
- All CI native, application/service and PostgreSQL jobs passed before signing.
- EAS reports FINISHED with the exact source hash above.
- Native IPA verification and all 22 release checks passed, including production APNs, signing identity, disabled debugging, embedded JS, Siprix frameworks/bridge, background modes and retained handset provisioning.
- Extracted installation artifact rechecked for bundle/build identity and deep strict signature; no ExpoDevLauncher path was present.
- iPhone 15 Pro Max updated in place; fresh device inventory reports 1.0.0 (81), and launch succeeded.
- iPhone 17 Pro Max became unavailable before installation. No Build 81 install on that phone is claimed; reconnect or use the installation page.

## Test and limits

Open Team Chat and a direct conversation: inspect avatar, presence, camera beside phone, name truncation and composer with the keyboard shown. Tap the enabled camera to open the admitted meeting flow; it does not automatically invite/call that conversation's peer. Continue two-phone meeting media and calling regression checks separately.

Profile-photo service commissioning remains pending; initials are the expected fallback. No backend deployment was performed for this release. Installation/launch and package checks do not establish on-phone visual acceptance, provider joining, two-way media, push delivery or background calling acceptance.

## Second-phone installation follow-up

On 22 September 2026, after the owner reconnected the iPhone 17 Pro Max, the same verified Build 81 artifact was installed in place. Bundle/build identity and deep strict code signature were rechecked before installation. Fresh installed-app inventory confirmed Phone11 1.0.0 (81), and launch succeeded. Both pilot phones have now received Build 81; visual and two-phone runtime acceptance remain separate.
