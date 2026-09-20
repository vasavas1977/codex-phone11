# Phone11 Build 74 — signed package and chat API ready for handset testing

Verified 20 September 2026. This is the normal signed Phone11 app, with an embedded bundle and no development launcher. Do not uninstall the existing app.

- Source: `a0f5c463e9a09ef3ca43f53a4de5dae6f54651e5`.
- [Successful build workflow](https://github.com/vasavas1977/codex-phone11/actions/runs/35500743599).
- EAS build: `ab6de8f0-a31a-4caf-ad5a-8c2962c3dc87`, FINISHED, profile `preview-ios-siprix-daily-pilot`.
- [iPhone installation page](https://expo.dev/accounts/vasavas/projects/phone11ai/builds/ab6de8f0-a31a-4caf-ad5a-8c2962c3dc87). Use this page for Install; do not substitute the raw IPA download as the installation link.
- IPA SHA-256: `a70687ca777ca11be4184e175b45c7c08430f4cab21fa1e264bcc53213482509`.
- Package gate: 22/22 signed configuration checks passed, native Siprix linkage and strict signature passed, baseline handset coverage retained, and development launcher absent.
- Retained package and evidence: `~/Library/Application Support/Phone11/verified-builds/74/`.

## Included client behavior

Build 74 includes the Build 73 voice-clip fixes plus presence, typing indicators, and visible-message read receipts. Own direct messages show **Read**; own group/channel messages show **Read by N**, opening named readers and first-read times. Read means the message was displayed, not that a voice clip was played.

The receipt implementation passed 79 focused tests and 43 disposable PostgreSQL integration tests. The named-reader sheet was inspected at mobile light/dark and desktop widths using sample data.

## Release boundaries

**The chat schema and API are deployed and verified with pilot API checks. Two-iPhone acceptance remains pending.** Build 74 can now be used to test read receipts, named group readers, presence, typing, and the included voice-clip fixes. The separate conference pilot is also enabled for 3001 and 1020: both accounts passed public admission and real provider join-token checks. Actual handset audio/video is still unverified.

The known working live backend image `sha256:d42c70f34d5062bff779c235dd2b6e415bede3b3a86b9de73892acf35b392619` was rechecked running without replacement during preparation. Parallel API rollout is reviewed separately so SIP wake and existing workers remain running.

## Two-iPhone installation checkpoint

Build 74 was installed in place on both paired physical pilot iPhones without
uninstalling Phone11. Fresh device inventory reports version `1.0.0`, bundle
version `74` on both the iPhone 17 Pro Max and iPhone 15 Pro Max. The first
device launched to the conference deep link. The second device rejected launch
while locked; no unlock was attempted or bypassed.

This closes package installation only. It does not mark any camera, microphone,
remote media, lifecycle, SIP-boundary, or eviction observation as passed. Both
phones must be unlocked and the manual physical matrix must still be completed.

After server rollout, use the two-iPhone acceptance steps in [the receipt design](./READ-RECEIPTS-DESIGN-20260920.md), including background-notification exclusion, named group readers, thread isolation, and calling regression checks. Package verification is not handset or live delivery evidence.

## Test now on both iPhones

If Build 74 is already installed, reopen Phone11; no further build or development
connection is required for these server changes. Otherwise use the installation
page above without deleting the existing app.

- Team Chat: test typing, a new message read receipt, and **Read by 1** details
  in a group/channel containing the two pilot accounts.
- Voice clips: record a new short audible clip, cancel/back out, then record,
  preview, send and play it on the other phone.
- Conference: **Team Chat → Meet** opens the one admitted meeting automatically.
  Enable microphone and camera on both phones, then tap **Join meeting**. Check
  two-way audio/video, mute/camera controls, leaving, and a subsequent phone call.

The final read-only device inventory found both paired iPhones disconnected.
Installed Build 74 and physical media behavior remain unverified.
