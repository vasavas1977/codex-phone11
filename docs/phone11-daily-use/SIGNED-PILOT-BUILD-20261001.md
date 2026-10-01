# Phone11 signed daily-pilot build 111

Date: 1 October 2026 (Asia/Bangkok)

Scope: verification and private staging of the owner-authorized GitHub Actions run and its signed iOS candidate. No installation or physical-device acceptance was performed.

## Source and build provenance

- Reviewed source: `11cd1f199cd4cd79d133637ad59271a21014d9e8`.
- GitHub Actions run [36757228208](https://github.com/vasavas1977/codex-phone11/actions/runs/36757228208) completed successfully for that exact SHA. All prerequisite daily-use jobs and `native-check` passed; the signed build job passed.
- EAS build: [Build 111](https://expo.dev/accounts/vasavas/projects/phone11ai/builds/0505f5ca-b0d9-4f78-9da2-39c30a2074eb), status `FINISHED`, profile `preview-ios-siprix-daily-pilot`, source SHA `11cd1f199cd4cd79d133637ad59271a21014d9e8`, app version `1.0.0`, build number `111`, iOS. EAS completion time: `2026-09-30T18:25:37.547Z`.
- EAS details page is the internal-install handoff URL. The signed artifact URL and provisioning profile contents are intentionally omitted.

## Private package evidence

The IPA is staged at:

```text
/Users/vasavas16macbookpro/Library/Application Support/Phone11/verified-builds/111/Phone11-111.ipa
```

The file is mode `0600`, 26,284,014 bytes, SHA-256 `e8b8dd4f8c32724b664c4fe02d65df6ec9840676f178c9962e1d291c2b762eae`. Sanitized build metadata and verifier results are retained beside it as `Phone11-111-verification.json`, also mode `0600`.

`node scripts/verify-siprix-ipa.mjs` passed: bundle ID `space.manus.phone11ai.t20260425073427`, version `1.0.0`, build `111`, Siprix and Siprix Media frameworks linked, `Phone11Siprix` native bridge present, legacy PJSIP bridge absent, and strict code-signature verification passed.

`node scripts/verify-phone11-daily-pilot-ipa.mjs` passed with all 22 checks against the retained Build 49 IPA. Build 49 SHA-256 matched the verifier's pinned value `e009bb13feec8b856eba8815917026a7e7a9976ffc1992afe3eae73d9b3fea66`. Checks covered bundle and version identity; build increment; expected daily-pilot runtime and disabled OTA updates; wake and chat commissioning markers; microphone, camera, and photo-library usage text; calling background modes and wake origin; production APNs and retained signing identity; disabled debugging; embedded JavaScript; both Siprix frameworks; and valid, unexpired provisioning with baseline handset coverage.

## Device boundary

Build 111 is a successfully signed and package-verified candidate. It was not installed or launched. This work makes no claim about handset inventory, sign-in, SIP registration, background wake, chat behavior, call media, or physical acceptance. The task handoff stated build 110 was installed and build 109 retained for rollback; neither was touched. Build 49 was read only as the package-comparison baseline.
