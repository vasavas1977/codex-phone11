# Phone11 Build 74 — signed package verified, server rollout pending

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

**Server activation, migrations, and two-iPhone acceptance are not complete.** Installing this package alone does not enable these new server-backed features. Keep that limitation visible in any handoff; do not tell the user they can already test live read receipts, presence, typing, or conferencing.

The known working live backend image `sha256:d42c70f34d5062bff779c235dd2b6e415bede3b3a86b9de73892acf35b392619` was rechecked running without replacement during preparation. Parallel API rollout is reviewed separately so SIP wake and existing workers remain running.

After server rollout, use the two-iPhone acceptance steps in [the receipt design](./READ-RECEIPTS-DESIGN-20260920.md), including background-notification exclusion, named group readers, thread isolation, and calling regression checks. Package verification is not handset or live delivery evidence.
