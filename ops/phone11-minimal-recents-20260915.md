# Minimal Recents and named transcript speakers

Installed candidate: Build 51, source `765c9e10baccb591205cf7295f6d2b74d5e3907e`.

- Recents primary filters are All, Missed, Recorded. AI-summary availability stays on individual calls; favorite actions remain in call details.
- Transcription has a compact Name speakers control below the selector, offering device-contact and account-name suggestions. Names are applied only after the user confirms the voice mapping.
- Assignments are private to this device/account and recording. Saving or clearing updates inline and full transcript views immediately, including copied/exported transcript text. A SHA256 source fingerprint invalidates the assignment after retranscription. Unlabeled legacy transcripts remain unassigned.
- Calling configuration is unchanged. Use only `preview-ios-siprix-daily-pilot`; never install a Debug/development launcher or PJSIP substitute.

Validation: 11 files/92 focused tests passed before the final synchronization amendment; the amendment passed 3 files/41 tests, including two added multi-view cases. Required native, app/service, and four PostgreSQL CI jobs all passed on the installed source. All 18 release checks and the independent Siprix IPA verifier passed. Full-repository TypeScript checking is not clean due to existing marketing-site, transfer, and recording-share errors.

Signing run: https://github.com/vasavas1977/codex-phone11/actions/runs/34947793099

EAS build: `77185342-84d5-403a-8c2b-a3e8f6547248`.

IPA SHA256: `df64ae0837a1c3bd822a07efac92be538b2a7b445db2a26884f52ee74fca34ae`.

The verified IPA, check results, install result, and release notes are retained under `/Users/vasavas16macbookpro/Library/Application Support/Phone11/verified-builds/51/`. Build 50 remains available there as the prior known-working rollback.

Handset installation succeeded at 2026-09-15 15:47 Bangkok; fresh app inventory reports version 1.0.0/build 51. Remote launch was denied by iOS preflight; the device reported `passcodeRequired: true`. User was asked to unlock and manually open Phone11. Fresh Build 51 registration, visual acceptance, and audio are not yet verified. Do not present installation or CI as handset acceptance.
