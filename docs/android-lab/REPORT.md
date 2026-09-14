# Phone11 Android virtual lab report

Date: 14 September 2026 (Asia/Bangkok)

Status: **PARTIAL**, by design. The complete 62-case matrix reports every unexecuted or blocked release gate and preserves first-attempt failures even when a corrected rerun passes.

## Source and artifact identity

- Repository: `https://github.com/vasavas1977/codex-phone11.git`
- Selected base: `71f4b683d572585c8d07c561649a543acfe87d40` on `codex/phone11-daily-use-20260910`. Live remote inventory and fetch showed this was newer than the supplied baseline and contained the iOS Build39 recording finalization work.
- Worktree: `/Users/vasavas16macbookpro/Documents/Codex/phone11-android-virtual-lab-20260914`
- Branch: `codex/phone11-android-virtual-lab-20260914`
- Final APK source commit: `a84d05b4733e554eab10a0a3ff707aff8465de7d`
- APK: `.lab/Phone11-Android-Lab-1.0.0-a84d05b.apk`
- APK SHA-256: `a76df83d3a42b8da077dd843a6fc2ee83e21c04ebf030500a2750801d78881e0`
- Android application ID: `ai.phone11.mobile.lab`; version `1.0.0` / code `1`; minimum SDK24; target/compile SDK36; ARM64 only.
- Actual emulator: `Phone11_Lab_API35`, API35 Google APIs ARM64, serial `emulator-5580`.
- Actual native runtime: `Phone11Lab 1.1.0 from 20260905_1222` from pinned Siprix AAR SHA-256 `3173ee8bae7aa37d3be3b44f7533d43b4e4d8625110d1d2bd8d79367973c9198`.

The final APK is a local lab artifact signed by the generated local Android signing configuration. It is not a production/store build.

## Implemented work

The branch adds the Android Siprix adapter inside the existing Phone11 native module, rather than a second application. Shared Expo/React Native screens, theme, call logic, recording history, transcript and summary UI remain common to iOS and Android. Lab-only flags select a distinct Android ID, local API base, pinned AAR and synthetic SIP allowlist.

The native adapter provides callback-driven initialization, accounts, registration, outgoing/incoming calls, answer/reject/hangup, mute, hold, DTMF, routing, snapshots, generation/sequence filtering, bridge ownership leases and bounded synthetic media capture. Unsupported Android wake/CallKit operations reject explicitly. An isolated Asterisk fixture binds only loopback host ports, has no trunks, uses generated credentials and allows only extensions7101,7102,7190 and7191 with20-second call limits.

Android SIP identity and routing are now supplied through an explicit build contract: application ID, SIP host/port, account allowlist and destination allowlist must agree in Expo runtime configuration, the generated manifest and the native adapter. Non-lab builds retain `ai.phone11.mobile` and receive no Android SIP configuration. A custom staging identity can be injected, but this remains an architecture path behind `PHONE11_ANDROID_LAB=1`, not a commissioned product build.

The native wake foundation now owns one persisted pending-call record and rejects duplicate, expired, canceled, rotated-session, logged-out and corrupt records. A strict data-only Firebase ingress adapter accepts only a matching persisted session owner, forwards unrelated messages to Expo and requires a configured Firebase app before commissioning. The incoming-call service builds a high-importance CallStyle notice with immutable, owner-checked open, answer and decline actions plus deterministic expiry/logout cleanup. Both Phone11 services are private and disabled by default. Full-screen presentation is intentionally inactive because `USE_FULL_SCREEN_INTENT` is undeclared. No Firebase project, matching client file, provider credential or deployed Android wake service exists, so L3 remains blocked.

The disabled incoming-call service can now adopt one already initialized, registered Siprix process core and one ringing SDK call. It refuses cold/no-engine, multiple-account, multiple-call, mismatched binding, expired and logged-out states; it never creates a second core or account. Outgoing call starts now reserve synchronously before entering the lifecycle queue, so concurrent user actions cannot start two native calls, while termination and failed-start paths still permit a later retry.

After the exact-APK campaign, a default-off source candidate added the missing authenticated Android enrollment chain. The shared client obtains an FCM token only after the native staging/Firebase capability passes, registers `platform=android` and `tokenType=fcm` under the captured authenticated session, enrolls and resolves the exact wake binding, saves the public binding in the native bridge, rotates register-first, and clears native/token state on logout. The server wake path now selects only the matching Android-FCM or iOS-VoIP pair and sends Android a data-only envelope containing exactly version, call UUID, binding UUID and expiry. The existing iOS APNs branch is unchanged. This source candidate has contract evidence only and is not part of the previously identified APK.

Recording playback changes are shared across iOS and Android: the progress control is draggable and accessible, replay/seek is clamped, player volume and mute state are corrected, and late playback operations are canceled on blur, sign-out or an active call. Android now exposes explicit speaker/earpiece playback selection through Expo Audio's native Android route. Emulator and physical acoustic listening remain separate acceptance gates.

The refreshed Android candidate also keeps Mute, Hold, Speaker and Keypad controls outside the scrolling recording region, records bounded mute command stages, keeps the isolated API/build flag in the standalone Expo runtime, and makes repeated native prebuilds idempotent for the lab manifest. The isolated build cannot silently fall back to the production API.

The AI investigation adds safe failure category and stage persistence for future failures. It does not store raw provider responses, transcript content or credentials.

## Executed results

The final matrix counts are:

| Evidence level | PASS | FAIL | BLOCKED | NOT RUN |
|---|---:|---:|---:|---:|
| L0 logic/contracts | 9 | 0 | 2 | 2 |
| L1 real native APK | 5 | 0 | 1 | 0 |
| L2 real isolated SIP/media | 9 | 6 | 7 | 5 |
| L3 real Firebase wake | 0 | 0 | 13 | 0 |
| L4 physical device | 0 | 0 | 3 | 0 |

The three retained L2 failures are historical first attempts: SIP-01 failed because the emulator Wi-Fi policy table had no route, then passed after the dedicated emulator route was restored; MEDIA-01 and MEDIA-02 failed because Docker could not export existing container files using `docker cp`, then passed after a bounded binary export with remote/local SHA verification. The report intentionally retains the original failures.

Verified runtime outcomes:

- SIP-04:20/20 outgoing calls passed with ordered native dialing, proceeding, connected and terminated callbacks plus correlated PBX INVITE200/BYE200.
- SIP-05:20/20 foreground incoming calls passed with one incoming callback, answer at the PBX, one termination and no remaining channel.
- The refreshed exact-APK campaign `.lab/sip-1789383622451/` repeated SIP-01, SIP-04, SIP-05, SIP-09, SIP-10 and CTRL-03 successfully on commit `bec452c`. Native mute/unmute callbacks and snapshot state also agreed; CTRL-01 remains blocked only for peer-observed microphone audio.
- Two preserved preflight runs made no SIP attempt because the rebuilt standalone app initially lost its lab runtime flag and then exposed its state only as visual text. Runtime config now carries the lab flag and loopback API through Expo Constants, and the state container is machine-readable again. The successful campaign followed on the exact corrected APK.
- SIP-02 and SIP-03 passed bad-credential rejection, unreachable registration after43.138 seconds, and correct-registration recovery.
- SIP-09/SIP-10/CTRL-03 passed local and remote hangup, a subsequent call without restart, actual second-call busy rejection, and PBX-received DTMF `123#`.
- MEDIA-01/MEDIA-02 later passed: the SDK recording decoded a440Hz downlink tone and a2.9-second DTMF-1 synthetic transmit signal on empirically identified stereo channels; the independent PBX receive capture detected the uplink signal.
- MEDIA-04 passed:605 PBX downlink RTP packets were deliberately dropped inside the owned container, the decoder correctly failed the downlink assertion while retaining verified uplink, and the exact rule was removed with absence verified.
- PERM-01 passed on the updated APK: revoked microphone permission produced `E_MICROPHONE_PERMISSION`, no native call/INVITE/PBX channel, visible permission recovery, then a successful synthetic call.
- LIFE-02 passed: HOME/background was observed, no ADB/UI polling occurred for three seconds, PID/start time/generation stayed the same, the call remained connected, and cleanup completed.
- LIFE-01 passed on predecessor APK candidate `e657d92b...`: Android changed the activity token in8.25seconds while retaining the same PID, process start time, native generation, one connected native call and one PBX channel; cleanup completed. Three earlier failed attempts remain preserved.
- LIFE-03 passed on the exact final APK. A50ms Recents flick removed the Phone11 task and activity; `stopped=false` distinguished removal from force-stop, the app process exited, no Phone11 service remained and the PBX channel persisted briefly. Explicit relaunch created a new PID with an uninitialized, idle native state, then cleanup cleared the owned call. Earlier snap-back, screenshot-timeout and no-process harness failures remain preserved.
- SIP-11 passed on the exact final APK. One native dial start produced one logical Siprix call, one hashed SIP Call-ID and one PBX channel. The two INVITE transactions were the initial request,401challenge and authenticated retry for that same Call-ID. A second rapid command rejected with `E_STATE`; hangup terminated once; a clean retry used a fresh Call-ID and left zero channels; rapid duplicate Answer also produced one connected call. Historical failures from the old transaction-count rule remain preserved in aggregate counts.
- The actual SDK loaded from a self-contained release APK without Metro. The APK contains the bundled JS plus ARM64 Siprix, SiprixMedia, React Native and Hermes libraries, contains no PJSIP native library, and reports call state through the Siprix native callback stream.

Final integrated verification passed:36 Node lab/config/wake/notice/adoption checks,155 focused Vitest calling/wake/build/playback checks and23 offline lifecycle/SIP harness assertions. Native JVM verification passed the injected SIP scope, bridge lease, persisted wake, strict FCM envelope, notification ownership, existing-engine adoption and media lifecycle contracts. Android release Java compilation, release Lint, APK assembly and merged-manifest processing passed. The exact final APK was installed and cold-launched on `emulator-5580`; it rendered the shared Phone11 dialer. Its packaged manifest contains one `Phone11IncomingCallService` and one `Phone11FirebaseMessagingService`, both with `enabled=false` and `exported=false`. Repository-wide TypeScript still has the same235 baseline diagnostics in unrelated transfer/marketing code; changed files introduced no diagnostics in the recorded comparison. Focused lint reported zero errors.

The later Android enrollment source candidate passed95 focused client/server token, identity, rotation, logout, retry and provider tests plus10 native/config Node tests. Its backend bundle and Android release Java compilation passed. The42 real PostgreSQL wake tests remained skipped because no dedicated loopback `phone11_push_test` database was configured; no live database or provider was contacted. Repository-wide TypeScript retained only its existing unrelated diagnostics and reported none in the changed enrollment files.

## Open gates

- L3 remains blocked: the authenticated enrollment/sender source candidate has no matching lab Firebase project/client file, provider credential, deployed server, rebuilt commissioned APK or verified provider delivery. The private data-only ingress and incoming-call services are disabled and uncommissioned in the exact tested APK. No fake notification or local broadcast was counted as Firebase evidence.
- Android authenticated Phone11 UCC sign-in/backend acceptance, process death/Doze/locked-screen incoming calls, full-screen presentation, foreground-service SIP adoption and end-to-end logout isolation remain open.
- Android speaker/earpiece recording route selection is implemented and contract-tested. Physical handset audio, microphone, earpiece, speaker, wired/Bluetooth accessories, mobile-network changes and OEM power behavior remain L4.
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
LAB_SIP_CAMPAIGN=bec452c pnpm lab:test:sip
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
- Final integrated APK: `.lab/Phone11-Android-Lab-1.0.0-a84d05b.apk`, `.lab/final-a84d05b-apk.json`, `.lab/final-a84d05b-badging.txt`, `.lab/final-a84d05b-manifest.txt`, `.lab/final-a84d05b-launch.png`
- Final APK identity/native load: `.lab/apk.json`, `.lab/final-updated-native-proof.json`, `.lab/final-updated-sdk.png`, `.lab/final-apk-badging.txt`, `.lab/final-apk-manifest.txt`, `.lab/final-apk-inventory.txt`
- 40-call campaign: `.lab/sip-1789368207834/`
- Refreshed 40-call exact-APK campaign plus mute-state check: `.lab/sip-1789383622451/`, `.lab/attempts-3ac0c31.json`
- Preserved initial SIP failure and repair: `.lab/sip-1789367584943/`, `.lab/network-repair.json`
- Network outage: `.lab/network-1789369786972/`
- Positive media: `.lab/media-1789369455402-4994a875/`
- Downlink fault: `.lab/media-1789369630909-70e24d6f/`
- Permission/lifecycle rerun: `.lab/final-updated-error-proof.json`, `.lab/error-attempts/`
- Exact final-APK lifecycle and rapid-call passes: `.lab/error-attempts/a76df83d3a42/LIFE-03/attempt-3.json`, `.lab/errors-1789391932292/`, `.lab/error-attempts/a76df83d3a42/SIP-11/attempt-2.json`, `.lab/errors-1789391827232/`
- Shared UI: `.lab/shared-phone11-ui.png`; lab runtime: `.lab/sdk-initialized.png`
- iOS investigations: `docs/phone11-daily-use/SUMMARY-FAILURE-20260914.md`, `docs/phone11-daily-use/RECORDING-PLAYBACK-CANDIDATE-20260914.md`

The source candidate now covers authenticated Android FCM token registration, native binding persistence, wake enrollment/resolution, rotation/logout isolation and platform-specific server delivery. The next Android acceptance gate is a reviewed isolated Firebase project/client/sender configuration, a rebuilt staging APK and an approved isolated server target. Only after those are commissioned can the lab execute heads-up delivery, background, lock, Doze and true process-death cases. Full-screen use additionally requires a deliberate permission and policy decision. The next iOS gate is the signed daily-pilot candidate and physical playback/seek/speaker check; recovering the12:40 summary additionally requires approval for one production Gemini retry after the diagnostic backend change is deployed.
