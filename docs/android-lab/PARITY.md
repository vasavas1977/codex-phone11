# Phone11 Android and iOS parity — 27 October 2026

Phone11 uses shared React Native screens, assets, API clients and business logic for iOS and Android. This Android working tree now includes the latest inspected shared product changes from `706b5b301a1c00e053855f69f31dacdd0539f6f7`. An installed app changes only after its platform is rebuilt and installed; backend changes require their own deployment. This source comparison does not identify or replace the signed daily-use iPhone build.

## Integrated and preserved sources

The Android checkout remains based on `d93c384a4f516f58eb6328e9d64c6b7451dbd01e`; the iOS/shared source branch and Android branch share base `cdb5c41c8c4b45bcb405ef04f6b619cc1f1f29e5`. They diverge: the newer date of the iOS/backend branch does not supersede Android-only improvements.

- Imported latest shared product behavior: workspace outbound international/premium-rate policy controls, selected-tenant policy hooks, singleton policy gateway transport, initial unconfigured-policy save, and explicit admin session-expiry recovery. See [the sync receipt](IOS-SYNC-20261027.md) for source commits, dependencies and validation.
- Preserved Android meeting stack: Speaker/Gallery views, camera-off profile photos, bounded responsive gallery pages and browser playback lifetime protection.
- Preserved Android admin stack: session hydration/retry, stale extension action fencing, accessible assignments, registration history, stable hydration and reachable people management. Policy integration retains scoped extension invalidation safeguards.
- Preserved recording summaries/transcripts, Recents seeking/actions, playback cancellation and output retention. The Android Expo Audio patch observes native outputs, mutes unconfirmed receiver playback and requires explicit resume after interruptions.
- Preserved selected-workspace provisioning, tenant-scoped strict credentials and dialer lifetime/navigation guards.

## Platform status

| Feature | Source in this candidate | Acceptance still required |
| --- | --- | --- |
| Dialer, Recents, contacts, profile, Team Chat | Shared iOS/Android app screens and business logic | Authenticated handset walkthrough against the selected backend |
| Meeting views and avatars | Shared native Speaker/Gallery screens and bounded pages | Two-handset meeting audio/video, rotation, camera and accessory lifecycle |
| Admin workspace and outbound policy | Latest inspected policy UI/gateway/session recovery plus Android admin safeguards | Authorized handset workflow; capability, restricted backend binding and deployment readiness |
| Recording summary, transcript, seeking and sharing | Shared UI, API client and ownership guards | Authorized recording, AI availability, audible playback and share sheet |
| Android recording audio output | Patched per-player Expo Audio adapter and source regressions | Speaker/earpiece/accessory listening, route changes and call takeover |
| SIP foreground voice | Isolated `ai.phone11.mobile.foregroundtrial` adapter and native candidate source | Physical microphone, registration, incoming/outgoing media and cleanup |
| Background/closed-app calls and OS call UI | Native FCM wake, Telecom/incoming-call services, encrypted wake state and completed-call history source implemented under explicit candidate gates | Firebase/backend commissioning, signed candidate, permissions, lock screen, Doze, process recreation, original-call adoption and logout/revocation tests |
| Android Team Chat push | FCM client enrollment, channel, token coordination, generic notification and authorized tap resolution; server dispatch/migration source implemented | Explicit flags, matching Firebase package/project, authorized schema/deployment, provider delivery and lifecycle tests |
| One-to-one SIP video | Unsupported by the Android candidate | Separate native implementation and media acceptance; meeting video is a different path |
| Transfer and screen broadcasting | Guarded source exists; foreground profile does not enable it | Separate native integration and acceptance; blind transfer remains unsupported |
| Sustained calling | Siprix `1.1.0`, build `20260905_1222`, retains the 60-second trial limit | Licensed SDK and sustained-call validation |

## Candidate and validation boundaries

Native wake/chat implementation is source complete for the guarded candidate, with ordinary-build defaults off. `preview-android-native-candidate` uses `ai.phone11.mobile.androidcandidate` with wake/chat off by default. `preview-android-wake-candidate` is the explicit staging wake/chat profile. Matching native/JS flags, a fixed HTTPS origin and matching Firebase project/package metadata are required. The existing foreground verifier keeps its stricter foreground-only scope. See [native candidate details](../android-native-completion-20261020.md).

The Expo Audio patch must compile from source: `expo.autolinking.android.buildFromSource` selects `expo-audio`; a prebuilt artifact can bypass the patch. Compiler, package/signer verification, installed app, physical media and provider delivery each need distinct evidence.

Current local source checks and known environment limitations are recorded in [the sync receipt](IOS-SYNC-20261027.md). No physical-device or emulator acceptance was performed or claimed for this sync. No installed app, production backend, Firebase configuration or customer traffic is changed by these source results.

## Keeping both platforms current

1. Compare incoming shared changes against the common base, then preserve platform work already present on either branch. Avoid replacing shared directories from a divergent branch.
2. Keep product screens/hooks/assets shared; isolate native behavior behind explicit capabilities and default-off candidate gates. Add platform lifecycle/ownership tests when adapters change.
3. Run shared product/auth/policy regressions, mobile/server typechecks and the relevant native/package checks. Record failures and environment exclusions explicitly.
4. Bind build receipts to an exact committed source SHA, variant, package, signer and artifact checksum. Build both platforms when shared application code changes.
5. Deploy required backend/schema changes through their existing authorization gates, then install the intended builds and validate actual handset/provider behavior. Source parity alone does not establish installed parity.
