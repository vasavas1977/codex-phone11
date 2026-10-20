# Phone11 Android and iOS parity — 20 October 2026

This Android integration uses the current shared React Native app, rather than the September virtual-lab fork. Screens, assets, API clients and business logic stay in the same source files for iOS and Android. A source change reaches installed apps only after rebuilding and installing each platform.

## Integrated sources

- Base `4f09443f25dfda47192fcd6ac25add0f0d8f69e9`: shared app plus current admin response deadline and profile navigation.
- Meeting stack `a9aa2ec`, `d16ca8a`, `8267da8`: Speaker/Gallery views, camera-off profile photos, bounded responsive gallery pages and browser playback lifetime protection.
- Admin stack through `9176b84`: session hydration/retry, stale extension action fencing, accessible assignments, registration-history wording, stable hydration and reachable people management.
- Included recording stack: `7c98708` recovered-summary refresh, `7f4dff6` summary completion, `9e472f4` Recents seeking/actions, `a65eaa8` compact controls, `8f3c366` output retention, `d0cf247` playback cancellation and `d682481` released-player protection.
- Included provisioning stack: `ef739fe` selected-workspace mobile provisioning, `f00ce47` tenant-scoped strict server credentials and `a8492b6` dialer lifetime/navigation protection. This matches inspected iOS source; it does not assert a new per-dial workspace authorization rule.
- The latest iOS signed build and production backend are independent artifacts; this branch does not claim to replace either.

## Platform status

| Feature | Shared behavior in this candidate | Android acceptance still required |
| --- | --- | --- |
| Dialer, Recents, contacts, profile, Team Chat | Existing shared app screens and business logic | Authenticated handset walkthrough against the selected backend |
| Meeting views and avatars | Same native screen for iOS/Android; bounded Gallery and Speaker views | Two-handset audio/video, device rotation, camera and accessory lifecycle |
| Admin workspace | Latest hydration, permission, stale-action and navigation fixes | Authorized handset workflow; backend readiness is separate |
| Recording summary, transcript, seeking and sharing | Shared recording UI, API client and ownership guards | Real authorized recording, AI service availability, audible playback and share sheet |
| Android recording audio output | Per-player Expo Audio adapter observes the native output, mutes unconfirmed receiver playback and requires explicit resume after interruptions | Speaker/earpiece/accessory listening, route changes and call takeover on the A55 |
| SIP foreground voice | Current isolated `ai.phone11.mobile.foregroundtrial` native adapter | Physical microphone, registration, incoming/outgoing media and cleanup |
| Background/closed-app calls and OS call UI | Explicitly unsupported by the foreground trial | Android native wake/Telecom/service implementation and provider/device tests |
| Chat push | iOS/APNs implementation; Android delivery not implemented | Android notification token/enrollment/provider and lifecycle implementation |
| Transfer and screen broadcasting | Guarded source exists; foreground profile does not enable it | Separate native integration and acceptance; blind transfer remains unsupported |
| Sustained calling | Siprix trial remains limited to 60 seconds | Licensed SDK and sustained-call validation |

## Build and test evidence

Local development testing uses the fixed foreground-trial profile and exact pinned Siprix AAR. A local release variant may be signed with the existing Expo development key for the owner's A55 testing. Its public certificate is pinned before assembly and verified independently afterwards. This is development signing, not an EAS/distribution signer or store release.

Detailed local package, source hash, signer and validation results are recorded with the generated artifact. No EAS FINISHED receipt is fabricated. The repository's guarded internal cloud build retains its existing credential constraints.

The daily-use workflow explicitly runs the imported shared meeting/admin suites. The mobile workflow continues to exercise platform-specific source/configuration contracts. Keep new product screens shared; add native adapter tests whenever a platform-specific capability changes. Missing Android capability must remain explicit in this table rather than being counted as automatically implemented by an iOS change.

The Expo Audio patch must be compiled from source. `expo.autolinking.android.buildFromSource` selects `expo-audio`; using Expo's prebuilt artifact would bypass the patched native code. The installed Java state harness checks receiver admission and interruption behavior; native Kotlin compilation and package inspection remain separate checks.

The Samsung A55 was absent from `adb devices -l` during this continuation. Installation, physical audio, background behavior and provider acceptance are not claimed.

## Remaining native work

Background calling requires an Android FCM receiver, authenticated expiring wake bindings, incoming-call notification/OS UI, original-call adoption, and cancellation/logout/revocation cleanup. The current trusted enrollment schema and dispatch path are iOS/APNs-specific. A generic FCM sender alone does not provide this call lifecycle.

Implement that work under a separate default-off profile with package-matching Firebase configuration and its own verifier. The current foreground verifier intentionally rejects Phone11 wake services; do not weaken it to label a background build as a foreground trial. Validate lock screen, Doze, process recreation, denied permissions, stale notifications and repeated calls on the handset.

The old local lab uses synthetic SIP accounts, loopback-bound services and emulator address `10.0.2.2`. A physical handset needs reachable SIP/RTP networking and DNS. Its older staging API must also satisfy the current selected-workspace/tenant contract before reuse. The current foreground profile embeds `https://api.phone11.ai`; no authenticated backend or provider acceptance is inferred from packaging it.
