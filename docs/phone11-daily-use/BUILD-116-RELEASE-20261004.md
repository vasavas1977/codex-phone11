# Phone11 daily-pilot Build 116 and desktop candidates — 4 October 2026

**Source, hosted checks and all three platform packages are verified;
installation and physical acceptance remain owner-deferred.** This candidate
does not deploy backend changes, commission PBX/voicemail services or establish
full Zoom feature parity. Build 114 remains the recorded installed iOS version.

## Frozen source and checks

All three candidates bind to source
`b5a97e6bdf41c66347547dfb8340f954d8318bce`. The
[transfer and meeting/admin follow-up](DESKTOP-TRANSFER-ADMIN-COMPLETION-20261004.md)
covers retired direct-meeting callbacks, web membership deactivation confirmation
with an immutable draft, and optional desktop blind transfer with callback and
stale-reply fencing. Source checks include repository/desktop typechecks,
desktop builds, 87 desktop Node cases and 11 compiled fake-SDK transfer scenarios.
The recorded app/admin suites retain their existing optional skips; these are
not live calling or provider checks.

Exact-source hosted checks passed:

- [Owned authentication](https://github.com/vasavas1977/codex-phone11/actions/runs/37148434686).
- [Daily-use checks](https://github.com/vasavas1977/codex-phone11/actions/runs/37148434700), including the existing host-authority PG17 job.
- [Desktop helper checks](https://github.com/vasavas1977/codex-phone11/actions/runs/37148434767) and the [fresh Windows helper build](https://github.com/vasavas1977/codex-phone11/actions/runs/37148438823).
- [Offline release guards](https://github.com/vasavas1977/codex-phone11/actions/runs/37148434710).
- [Mobile native checks](https://github.com/vasavas1977/codex-phone11/actions/runs/37148434720), including Android compilation.

These are previously recorded release checks. This documentation update checked
receipt hashes, factual bindings and document links; it did not rerun those
implementation suites or builds.

## Signed iOS candidate

- [Signed workflow 37148440844](https://github.com/vasavas1977/codex-phone11/actions/runs/37148440844): success; all ten jobs succeeded.
- [Expo Build 116](https://expo.dev/accounts/vasavas/projects/phone11ai/builds/87a569b1-f931-43b4-97b9-dda1b7328a28): `FINISHED`, physical iOS/internal distribution, profile `preview-ios-siprix-daily-pilot`.
- Bundle `space.manus.phone11ai.t20260425073427`; application version `1.0.0`, native build `116`.
- Retained IPA: 26,320,883 bytes; SHA-256 `db244601483738ecc3d6c6304936bb7f5bbe2a45ae99194db4df3e37a04b876c`.

The IPA passed the native framework/bridge/signature verifier and all 22 signed
package checks against the retained Build 49 baseline. An independent comparison
against Build 115 passed all 42 supplemental checks, including exact EAS/source,
archive/signature/profile and device-set bindings. Build 116 covers all three
registered phones retained in Build 115. Device identifiers and signing details
are omitted. Build 115 and earlier rollback packages remain retained.

The Expo build-details page above is the installation handoff. No installation
or handset calling, wake/push/background, media or transfer acceptance was
performed for Build 116.

## Fresh desktop packages

Both packages received independent `APPROVE_PACKAGE_ONLY` review. Each contains
24 dist files, including eight runtime files, with matching shared macOS/Windows
bytes except the verified platform helper manifest pin in `main.cjs`. Complete
helper and package inventories were checked. Native helpers were refreshed for
this source; the earlier `71360e7` helpers were not reused.

| Candidate | Recorded artifact binding | Signing and runtime limits |
| --- | --- | --- |
| macOS arm64 | ASAR SHA-256 `2aa00a7cd0807329e1a60c6112bb30b6135ceaa009c1319a70b026f266dd1beb`; fresh helper SHA-256 `4cb888f5925b563adaa53f44758cb5787ed4b7300a2c35cd91869a0702d24953`; 299 inventory entries. | Strict deep ad-hoc signature verified; no notarization. Compiled against retained SHA-verified framework inputs; no full macOS SDK Git revision claim. |
| Windows x64 | Fresh helper artifact `11283228075`, SHA-256 `d594b0612328e60756cf6b44aefc46fc7bd513ea281508324d1f6c90ff988c76`; portable ZIP SHA-256 `fec495ae8252a3cb3d1b23a8a6671cad4c395a87bc6e8418e5777d307fd8c92d`, 169,103,752 bytes; all 78 entries and ten AMD64 PE files verified. | Own binaries unsigned. Exact cached Electron resource edits independently reproduced; no Windows execution acceptance. |

Both retain the 60-second trial limit; this is source/SDK/build-receipt evidence,
not a measured desktop call. Neither candidate was launched, installed or
uploaded during packaging/review. Earlier packages and working applications
remain retained. Real sign-in, SIP, audio/video, transfer and OS lifecycle checks,
SDK terms and formal distribution remain separate gates.

## Evidence custody and follow-up

The local [final release receipt](</Users/vasavas16macbookpro/Library/Application Support/Phone11/verification/transfer-admin-direct-b5a97e6-20261004/release-final.private.json>)
pins source, hosted CI, signed iOS and both producers/independent package reviews.
It contains the private artifact locations; those artifacts are not public
distribution links. No credentials or device identifiers are copied here.

The independently reviewed PBX routing authority candidate
`80269a865e716fefec03cf4584e44b1b71e8a815` follows this frozen release source.
Its 45 source and seven actual disposable PG17 cases passed locally; the new
hosted CI job's proof is pending. It is not included in the Build 116 source pin
and does not authorize migration, deployment or commissioning.

For physical acceptance, record the installed build, authenticated extensions
and shared room, then both directions of media, reconnect, SIP interruption and
Leave. The unchecked [Zoom workflow coverage](ZOOM-FEATURE-COVERAGE-20261004.md)
rows remain incomplete until their own implementation and acceptance gates pass.
