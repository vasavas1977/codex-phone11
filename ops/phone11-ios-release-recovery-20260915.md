# Phone11 iOS installation recovery — 15 September 2026

## Incident and restored baseline

The handset's working signed Siprix Build 49 was replaced first by a local
Debug app and then by a local PJSIP Release app. Both were incorrect daily-use
packages. The latter produced repeated missing PJSIP native bridge diagnostics
and the user saw Connection failed. A successful local build, signature check,
or installation does not establish the correct calling engine or pilot settings.

The original signed Build 49 was restored in place at **06:51 UTC** on
15 September. Installation and registration were verified. This recovery does
not establish a new physical call/audio acceptance result.

Original rollback identity:

- Application version: `1.0.0`, build `49`.
- Source: `0d9b87b1fb408b7d8fc377a3fdb7ad32a959a6f6`.
- Signing workflow: [34880323287](https://github.com/vasavas1977/codex-phone11/actions/runs/34880323287).
- EAS build: `2cd780c9-dbdb-4964-a692-4ea30ce354b6`.
- IPA SHA256: `e009bb13feec8b856eba8815917026a7e7a9976ffc1992afe3eae73d9b3fea66`.
- Local recovery package at this checkpoint:
  `/tmp/phone11-restore-build49/Phone11-49.ipa` and its extracted
  `/tmp/phone11-restore-build49/Payload/Phone11.app`.
- Durable rollback IPA:
  `/Users/vasavas16macbookpro/Library/Application Support/Phone11/verified-builds/49/Phone11-49.ipa`.

Keep the original signed IPA and verification evidence available before any
replacement. Temporary directories can disappear; retain a protected durable
copy when transferring this handoff. Preserve signed-in app data with an
in-place installation; do not uninstall to resolve a package mismatch.

## Correct candidate build

The candidate source `bc7ea8212749c8c55ac093fb97e8993c88d879c5` passed signing workflow
[34939681676](https://github.com/vasavas1977/codex-phone11/actions/runs/34939681676).
All native, app/service, and four PostgreSQL test jobs passed before signing.

- EAS build: `355972b4-41fc-4884-a1f8-9c2be4aeb674`.
- Version: `1.0.0 (50)`.
- IPA SHA256: `7f97aabd1dab6ca21e2881e0abdac921a8d056e5d1ea5bf9b74212d555110b93`.
- All 18 release-package checks passed. The separate native IPA verifier proved
  Siprix framework linkage, the Phone11Siprix native class, absence of the
  legacy PJSIP bridge, and the deep/strict signature.
- Installed in place at 07:13 UTC. Device inventory independently reported
  build 50. Launch succeeded and fresh handset diagnostics at
  `2026-09-15T07:13:39.021Z` reported `Siprix registration registered` after
  native engine initialization and foreground wake-owner restoration.
- The normal `phone11:///recents` deep link was sent successfully. Mac screen
  capture was unavailable (black frame), so visible handset controls and
  physical audio are still awaiting owner verification.
- Local artifact/evidence: `/tmp/phone11-recents-siprix-bc7ea82/`.

Parallel review of the UI found that call direction had been used to assign
contact names to arbitrary diarized speaker numbers. This was corrected before
signing: only a verified mapping names a voice; call header/row contact names
remain available. The initial candidate workflow was cancelled before signing.
The final focused correction checks passed 44 tests; the preceding broader
interface review passed 112 tests. These overlapping counts are not additive.

Select **`preview-ios-siprix-daily-pilot` explicitly** for the signed iOS build.
The workflow defaults to a different profile if its input is omitted. Use the
clean GitHub/EAS native-generation path so profile environment and added native
dependencies are applied together. Do not use the development-client profile
or reuse a local generated iOS project with unverified engine settings.

A signed Release build alone is insufficient. The expected configuration is:

- Bundle: `space.manus.phone11ai.t20260425073427`.
- Calling engine: `siprix`.
- Runtime: `1.0.0-siprix-daily-pilot-1`, with updates disabled.
- Native wake and chat notification commissioned markers both `1`.
- Wake origin: `https://api.phone11.ai`.
- Signed production APNs; original team and application identity retained;
  debugging disabled (`get-task-allow` false).
- Embedded JavaScript and native Siprix frameworks; no dependence on Metro
  or an Expo development launcher to start the daily-use app.

## Reusable package gate

Run from the repository with the candidate app already extracted. Replace the
candidate path below with the exact downloaded signing artifact's app:

```sh
python3 scripts/check-phone11-ios-release.py /absolute/candidate/Payload/Phone11.app \
  --baseline-app /tmp/phone11-restore-build49/Payload/Phone11.app \
  --baseline-ipa /tmp/phone11-restore-build49/Phone11-49.ipa
```

The script is read-only and reports check names and pass/fail booleans without
printing signing identities, device identifiers, profile contents, or secrets.
Exit `0` means all checks passed; exit `1` means the package must not be treated
as verified. It pins the original IPA hash, requires a build greater than 49,
compares configuration and signed entitlements, checks the deep/strict code
signature, embedded bundle and both Siprix frameworks, and verifies provisioning
expiry plus retention of the baseline profile's handset coverage.

For a self-test only, pass Build 49 as the candidate and add `--allow-baseline`.
Do not pass that option for a new candidate. The baseline passes all 18 checks
with this option; without it, it fails the newer-build requirement. The incorrect
local PJSIP Release package fails the engine runtime, commissioned markers,
origin, production APNs, debugging, framework, provisioning, and build checks.

Also run `scripts/verify-siprix-ipa.mjs` on the downloaded IPA for native bridge
symbols and actual framework linkage, which the configuration gate does not
claim to establish. Verify the workflow's full source hash, selected profile,
final success, and artifact hash separately. Neither package checker substitutes
for those source/build provenance checks.

## Handset acceptance remains separate

Before replacing the restored working app, retain its rollback package and
confirm the candidate passes all package gates. After an authorized in-place
install, independently confirm installed version, successful launch,
registration, retained account state, and the requested Recents controls.
Then verify actual incoming/outgoing calls and two-way audio on the physical
handset. Background/locked calling, receiver/Speaker/Bluetooth switching,
recording, and playback require their own physical checks. Package verification,
registration, and preview screenshots do not prove those behaviors.
