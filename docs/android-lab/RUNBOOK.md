# Phone11 Android lab operator runbook

Run from `/Users/vasavas16macbookpro/Documents/Codex/phone11-android-virtual-lab-20260914`. This is a local trial lab, not an Android production release. No store, deployment, or real-number calling commands are included.

## Prerequisites

Java17, Node22, pnpm9.12.0 (the current host wrapper reports11.19.0), Docker, Android SDK platform36/build-tools36.0.0/NDK27.1.12297006, emulator, and `system-images;android-35;google_apis;arm64-v8a`. Primary emulator serial5580 and namePhone11_Lab_API35 are explicitly checked. Keep at least10GB spare disk for a first build.

The first local run installed missing Android tools/images and booted a dedicated emulator. To reproduce on a new approved Mac, tool installation is an explicit setup step:

```sh
export ANDROID_HOME="$HOME/Library/Android/sdk"
"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" 'emulator' 'system-images;android-35;google_apis;arm64-v8a' 'platforms;android-36' 'build-tools;36.0.0' 'ndk;27.1.12297006'
printf 'no\n' | "$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" create avd -n Phone11_Lab_API35 -k 'system-images;android-35;google_apis;arm64-v8a' --device pixel_7
"$ANDROID_HOME/emulator/emulator" -avd Phone11_Lab_API35 -port 5580 -no-window -no-audio -no-boot-anim -no-snapshot
```

Do not use `--force` to replace an existing AVD. Host microphone is disabled for synthetic tests. Its activation for a human listening test needs operator awareness and OS permission. No physical phone is targeted.

## Build and test

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

`lab:setup` downloads only the pinned official Siprix AAR and validates its checksum. `lab:android:build` rejects inherited `.env`, strips inherited public build variables, uses a distinct lab ID, bundles JavaScript into the release APK (signed only by local debug key), checks native libraries, and saves APK identity to `.lab/apk.json`. This APK is for sideloading in the lab, not store submission.

The commissioned Expo/Gradle staging path is fail-closed and cannot prebuild without two explicit commission flags, the exact staging package, staging-only API/SIP hosts, and a private Firebase file whose identity matches every declared Firebase value. It neither contains credentials nor commissions an external service. See [COMMISSIONED-FCM-STAGING.md](COMMISSIONED-FCM-STAGING.md) for the contract; keep using `lab:android:build` for the credential-free virtual lab.

`lab:test:sip` exercises actual installed native calls through UI automation. It opens the lab route, requests microphone through the visible Android permission dialog, enters a transient synthetic password into a secure input, and observes SDK state plus PBX evidence. Diagnostic attempts are separate from the20 individual repeatability samples. Original failures are retained. See `lab/android/FIXTURE.md` for fixture controls and namespace-local network protection.

Run device harnesses sequentially. Set `LAB_MEDIA_HOST_MIC_DISABLED=1` only for the dedicated emulator started with disabled host input. Media capture uses a generated tone and an independent PBX receive recording; it refuses to clear an unexported existing capture. Error checks deliberately revoke microphone permission on the lab package and recover through the visible Android dialog. Neither permission changes nor captures target an ordinary Phone11 installation. Separate per-case ledgers retain first failures and cap diagnostic attempts.

`lab:test:push:contract` runs the authenticated wake-contract tests. `lab:test:push:live` runs the strict [real-FCM preflight](FCM-LIVE-HARNESS.md), writes truthful L3 blockers into the normal report input and exits2 while staging inputs are absent. A token file alone cannot unblock that gate. No local broadcast is labeled FCM.

`lab:report` includes all62 matrix rows, not just executed tests. JSON, HTML, and JUnit separate logic, native runtime, SIP, real push and physical device results. Missing coverage cannot produce full PASS. Generated files and per-run credentials are under ignored, private `.lab/`. Review redaction before sharing raw runtime artifacts.

## Cleanup and failure recovery

`lab:down` removes only the fixture resources matching this worktree's run metadata/ownership labels. It never runs the repository's production Compose stack or removes unrelated containers. Emulator app cleanup hangs up and destroys its native session. Do not force-stop as a substitute for normal call cleanup unless testing force-stop explicitly.

To stop this dedicated emulator when finished:

```sh
"$ANDROID_HOME/platform-tools/adb" -s emulator-5580 emu kill
```

If build dependencies time out, inspect the uniquely named `.lab/build-*.log`. Do not discard failed attempts. Diagnose before retrying; default runtime limit is two diagnostic reruns after the initial attempt.

## Remaining acceptance

Primary-image native and SIP results are only the cases actually reported. Authenticated full UCC backend integration, realFCM background/locked/Doze/process-death handling, targetAPI36 runtime/minimum-API coverage, physical Bluetooth/earpiece/acoustics/cellular behavior, signed Android distribution and store release require their own evidence. iOS playback improvements need a new signed iOS build and physical listening/seek checks; shared code inclusion is not an installation claim.
