# Baseline inspected 14 September 2026

Repository: `https://github.com/vasavas1977/codex-phone11.git`.
Selected base: `71f4b683d572585c8d07c561649a543acfe87d40`, branch `codex/phone11-daily-use-20260910`, also returned by live `git ls-remote --heads origin` and fetch. This is newer than the supplied `2003984` baseline and includes the stop-recording finalization and speaker-label changes used by the referenced task's iOS Build39.

Original worktree: `/Users/vasavas16macbookpro/Documents/Codex/2026-05-05/can-you-build-antive-mobile-app/phone11-incoming-controls-20260910`. Three unrelated daily-use documents were dirty; none were copied, reset, stashed, or overwritten. Android worktree: `/Users/vasavas16macbookpro/Documents/Codex/phone11-android-virtual-lab-20260914`, branch `codex/phone11-android-virtual-lab-20260914`. No applicable AGENTS.md was found in its original ancestry; this branch adds the owner's cross-platform convention.

Remote inventory contained daily-use, incoming-controls, mobile-pjsip, owned-auth and main. Current daily-use local module had only iOS implementation and `android:null`; no newer Android branch was present in that inventory. The new bridge extends this module rather than creating a different app.

Declared app versions: Expo54.0.29, React Native0.81.5, TypeScript5.9.3. Package declares pnpm9.12.0; this host's pnpm wrapper actually used11.19.0 for the offline frozen-lockfile install. No lockfile change or lifecycle script execution was needed. This tool-version difference is recorded rather than hidden.

Resolved prebuild: original production ID `ai.phone11.mobile`; dedicated Android ID `ai.phone11.mobile.lab`; minimum24, compile/target36, build tools36.0.0, NDK27.1.12297006; primary AVD API35 Google APIs ARM64. SDK inventory and image revision are in doctor evidence. The emulator booted under Hypervisor.Framework. No physical Android phone was used.

## Ownership

| Responsibility | Lab owner | Gap |
|---|---|---|
| SIP runtime and state | Process-owned Java Siprix Runtime, main-thread commands/callbacks | FCM process restart restoration not implemented |
| JS rendering / business logic | Existing shared React Native app | Authenticated cloud UCC parity requires separate staging fixture |
| Audio focus/routing | Siprix Android core | No physical device/acoustic claim |
| Foreground visible call UI | Lab diagnostic screen for native fixtures; shared app call UI for authenticated sessions | No Android background call service or notification acceptance |
| Android Telecom/ConnectionService | None in lab; CallKeep explicitly excluded | Foreground scope only |
| FCM receiver / notification / native wake | None commissioned | L3 BLOCKED; unsupported methods reject |
| iOS CallKit / native wake | Existing iOS bridge and CallKeep | Not rewritten by Android integration |

`react-native.config.js` excludes Android PJSIP and CallKeep only in the explicit Siprix lab. Actual generated autolinking confirms Siprix present and PJSIP/CallKeep absent. Names in shared call-store such as PJSIP_INV_STATE_CONFIRMED are compatibility strings, not proof that PJSIP is running.

## Production boundary

No production Android signing, deployment, migrations, store publication, calls, pushes, SDK purchase or cloud device spend. The lab build refuses inherited `.env`, forces a local API base and native host/destination allowlists, uses a distinct application ID, disables backup, and stages a checksum-verified trial AAR. Generated SIP passwords live only in private `.lab` runtime files and transient UI input.

The separately requested iOS investigation reads latest production recording/job metadata; it is not part of emulator acceptance. Any iOS fix requires its own reviewed build/deployment decision.
