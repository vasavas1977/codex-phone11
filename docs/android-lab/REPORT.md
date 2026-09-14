# Phone11 Android virtual lab report

Date: 14 September 2026 (Asia/Bangkok)

Status: **PARTIAL**, by design. The complete 62-case matrix reports every unexecuted or blocked release gate and preserves first-attempt failures even when a corrected rerun passes.

## Source and artifact identity

- Repository: `https://github.com/vasavas1977/codex-phone11.git`
- Selected base: `71f4b683d572585c8d07c561649a543acfe87d40` on `codex/phone11-daily-use-20260910`. Live remote inventory and fetch showed this was newer than the supplied baseline and contained the iOS Build39 recording finalization work.
- Worktree: `/Users/vasavas16macbookpro/Documents/Codex/phone11-android-virtual-lab-20260914`
- Branch: `codex/phone11-android-virtual-lab-20260914`
- Final APK source commit: `c8102b747066f188e925d06499488373d02da80e`
- APK: `android/app/build/outputs/apk/release/app-release.apk`
- APK SHA-256: `eeba6448a2e5992b022dadd7558895e11f07a61ab6a19b648f153c60183d0585`
- Android application ID: `ai.phone11.mobile.lab`; version `1.0.0` / code `1`; minimum SDK24; target/compile SDK36; ARM64 only.
- Actual emulator: `Phone11_Lab_API35`, API35 Google APIs ARM64, serial `emulator-5580`.
- Actual native runtime: `Phone11Lab 1.1.0 from 20260905_1222` from pinned Siprix AAR SHA-256 `3173ee8bae7aa37d3be3b44f7533d43b4e4d8625110d1d2bd8d79367973c9198`.

The final APK is a local lab artifact signed by the generated local Android signing configuration. It is not a production/store build.

## Implemented work

The branch adds the Android Siprix adapter inside the existing Phone11 native module, rather than a second application. Shared Expo/React Native screens, theme, call logic, recording history, transcript and summary UI remain common to iOS and Android. Lab-only flags select a distinct Android ID, local API base, pinned AAR and synthetic SIP allowlist.

The native adapter provides callback-driven initialization, accounts, registration, outgoing/incoming calls, answer/reject/hangup, mute, hold, DTMF, routing, snapshots, generation/sequence filtering, bridge ownership leases and bounded synthetic media capture. Unsupported Android wake/CallKit operations reject explicitly. An isolated Asterisk fixture binds only loopback host ports, has no trunks, uses generated credentials and allows only extensions7101,7102,7190 and7191 with20-second call limits.

Recording playback changes are shared across iOS and Android: the progress control is draggable and accessible, replay/seek is clamped, player volume and mute state are corrected, and late playback operations are canceled on blur, sign-out or an active call. iOS adds a guarded recording speaker option and protects Siprix/CallKit audio-session ownership. Android receives shared seeking and playback fixes; an Android-specific recording speaker/earpiece selector remains a declared parity gap.

The AI investigation adds safe failure category and stage persistence for future failures. It does not store raw provider responses, transcript content or credentials.

## Executed results

The final matrix counts are:

| Evidence level | PASS | FAIL | BLOCKED | NOT RUN |
|---|---:|---:|---:|---:|
| L0 logic/contracts | 9 | 0 | 2 | 2 |
| L1 real native APK | 5 | 0 | 1 | 0 |
| L2 real isolated SIP/media | 9 | 3 | 6 | 9 |
| L3 real Firebase wake | 0 | 0 | 13 | 0 |
| L4 physical device | 0 | 0 | 3 | 0 |

The three retained L2 failures are historical first attempts: SIP-01 failed because the emulator Wi-Fi policy table had no route, then passed after the dedicated emulator route was restored; MEDIA-01 and MEDIA-02 failed because Docker could not export existing container files using `docker cp`, then passed after a bounded binary export with remote/local SHA verification. The report intentionally retains the original failures.

Verified runtime outcomes:

- SIP-04:20/20 outgoing calls passed with ordered native dialing, proceeding, connected and terminated callbacks plus correlated PBX INVITE200/BYE200.
- SIP-05:20/20 foreground incoming calls passed with one incoming callback, answer at the PBX, one termination and no remaining channel.
- SIP-02 and SIP-03 passed bad-credential rejection, unreachable registration after43.138 seconds, and correct-registration recovery.
- SIP-09/SIP-10/CTRL-03 passed local and remote hangup, a subsequent call without restart, actual second-call busy rejection, and PBX-received DTMF `123#`.
- MEDIA-01/MEDIA-02 later passed: the SDK recording decoded a440Hz downlink tone and a2.9-second DTMF-1 synthetic transmit signal on empirically identified stereo channels; the independent PBX receive capture detected the uplink signal.
- MEDIA-04 passed:605 PBX downlink RTP packets were deliberately dropped inside the owned container, the decoder correctly failed the downlink assertion while retaining verified uplink, and the exact rule was removed with absence verified.
- PERM-01 passed on the updated APK: revoked microphone permission produced `E_MICROPHONE_PERMISSION`, no native call/INVITE/PBX channel, visible permission recovery, then a successful synthetic call.
- LIFE-02 passed: HOME/background was observed, no ADB/UI polling occurred for three seconds, PID/start time/generation stayed the same, the call remained connected, and cleanup completed.
- The actual SDK loaded from a self-contained release APK without Metro. The APK contains the bundled JS plus ARM64 Siprix, SiprixMedia, React Native and Hermes libraries, contains no PJSIP native library, and reports call state through the Siprix native callback stream.

Automated checks passed:36 Node lab/config/packaging tests,198 focused shared Vitest tests,5 bridge-lease assertions,18 destination/state native-guard assertions, and6 media-watchdog JVM scenarios. The backend bundle also completed. Repository-wide TypeScript still has the same235 baseline diagnostics in unrelated transfer/marketing code; changed files introduced no additional diagnostics in the recorded comparison.

## Open gates

- L3 remains blocked: there is no matching lab Firebase client/sender, authenticated Android native wake receiver/service, or verified pending-call delivery adapter. No fake notification or local broadcast was counted as Firebase evidence.
- Android authenticated Phone11 UCC sign-in/backend acceptance, process death/Doze/locked-screen incoming calls, notification/full-screen/foreground-service ownership and logout isolation remain open.
- Physical Android handset audio, microphone, earpiece, speaker, wired/Bluetooth accessories, mobile-network changes and OEM power behavior remain L4.
- Reject/cancel product-history reconciliation and decoded media after hold/resume remain blocked even though their signaling samples passed.
- The original `SOURCES.md` mentioned by the supplied documents was not supplied or found. `docs/android-lab/SOURCES.md` records the verified repository and vendor sources used instead.

## iOS recording investigation

The latest production call was created at12:40:02 Bangkok on14 September (call prefix `8b722fc2`). Its recording is ready, but the AI analysis job failed all three attempts and has no transcript or summary. The preceding11:35 call succeeded on its first attempt. AI is enabled and configured.

The retained WAV is valid PCM16 stereo at16kHz, approximately51seconds and3,264,098bytes. Both channels contain non-clipped signal (about-29.95 and-34.21dBFS RMS). This rules out an absent/empty recording, but does not prove speech clarity. The old worker persisted only `analysis_failed`, so the exact Gemini/provider failure cannot be reconstructed without an authorized retry. The diagnostic source change records an allowlisted reason and stage for future attempts.

Playback, seek and iOS speaker changes pass local tests but are not installed on the iPhone. This Mac has only a wildcard development profile without `aps-environment`; it cannot produce the matching daily-pilot push-enabled build. The existing EAS `preview-ios-siprix-daily-pilot` profile is the concrete next build path after owner approval. No iOS build, install, backend deployment or paid AI retry occurred.

## Production boundary

No production trunk, PSTN/customer call, Firebase send, customer credential, migration, SDK purchase, store publication, deployment, merge, push or PR was performed. Android calls used only the loopback-bound generated fixture. Build scripts reject inherited `.env`, strip production-facing public variables, validate the SDK checksum and refuse physical devices or non-allowlisted destinations. Fixture cleanup affected only resources with this worktree's ownership labels.

## Reproduction

Run sequentially from the worktree:

```sh
export LAB_EMULATOR_SERIAL=emulator-5580
pnpm install --frozen-lockfile --ignore-scripts
pnpm lab:doctor
pnpm lab:setup
pnpm lab:test:harness
pnpm lab:test:logic
pnpm lab:test:push:contract
pnpm lab:up
pnpm lab:android:build
pnpm lab:android:install
pnpm lab:test:sip
LAB_MEDIA_HOST_MIC_DISABLED=1 pnpm lab:test:media
LAB_EXPECTED_APK_SHA256="$(node -p 'require("./.lab/apk.json").sha256')" pnpm lab:test:errors
LAB_EXPECTED_APK_SHA256="$(node -p 'require("./.lab/apk.json").sha256')" pnpm lab:test:network
pnpm lab:test:push:live
pnpm lab:report
pnpm lab:down
```

`lab:test:push:live` exits blocked until the real L3 prerequisites exist. Use `LAB_MEDIA_BLOCK_DOWNLINK=1` only after a preserved positive media pass to execute MEDIA-04. The runbook contains emulator creation/start and cleanup details.

## Evidence index

- Final report: `.lab/report.html`, `.lab/report.json`, `.lab/junit.xml`
- Final APK identity/native load: `.lab/apk.json`, `.lab/final-updated-native-proof.json`, `.lab/final-updated-sdk.png`, `.lab/final-apk-badging.txt`, `.lab/final-apk-manifest.txt`, `.lab/final-apk-inventory.txt`
- 40-call campaign: `.lab/sip-1789368207834/`
- Preserved initial SIP failure and repair: `.lab/sip-1789367584943/`, `.lab/network-repair.json`
- Network outage: `.lab/network-1789369786972/`
- Positive media: `.lab/media-1789369455402-4994a875/`
- Downlink fault: `.lab/media-1789369630909-70e24d6f/`
- Permission/lifecycle rerun: `.lab/final-updated-error-proof.json`, `.lab/error-attempts/`
- Shared UI: `.lab/shared-phone11-ui.png`; lab runtime: `.lab/sdk-initialized.png`
- iOS investigations: `docs/phone11-daily-use/SUMMARY-FAILURE-20260914.md`, `docs/phone11-daily-use/RECORDING-PLAYBACK-CANDIDATE-20260914.md`

The next Android acceptance gate is an isolated staging Firebase project plus native authenticated wake/service implementation, followed by background, lock, Doze and true process-death delivery. The next iOS gate is the signed daily-pilot candidate and physical playback/seek/speaker check; recovering the12:40 summary additionally requires approval for one production Gemini retry after the diagnostic backend change is deployed.
