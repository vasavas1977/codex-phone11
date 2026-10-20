# Phone11 Android and iOS parity — 20 October 2026

This Android integration uses the current shared React Native app, rather than the September virtual-lab fork. Screens, assets, API clients and business logic stay in the same source files for iOS and Android. A source change reaches installed apps only after rebuilding and installing each platform.

## Integrated sources

- Base `4f09443f25dfda47192fcd6ac25add0f0d8f69e9`: shared app plus current admin response deadline and profile navigation.
- Meeting stack `a9aa2ec`, `d16ca8a`, `8267da8`: Speaker/Gallery views, camera-off profile photos, bounded responsive gallery pages and browser playback lifetime protection.
- Admin stack through `9176b84`: session hydration/retry, stale extension action fencing, accessible assignments, registration-history wording, stable hydration and reachable people management.
- The latest iOS signed build and production backend are independent artifacts; this branch does not claim to replace either.

## Platform status

| Feature | Shared behavior in this candidate | Android acceptance still required |
| --- | --- | --- |
| Dialer, Recents, contacts, profile, Team Chat | Existing shared app screens and business logic | Authenticated handset walkthrough against the selected backend |
| Meeting views and avatars | Same native screen for iOS/Android; bounded Gallery and Speaker views | Two-handset audio/video, device rotation, camera and accessory lifecycle |
| Admin workspace | Latest hydration, permission, stale-action and navigation fixes | Authorized handset workflow; backend readiness is separate |
| Recording summary, transcript, seeking and sharing | Shared recording UI, API client and ownership guards | Real authorized recording, AI service availability, audible playback and share sheet |
| Android recording audio output | Integration in progress in the per-player Expo Audio adapter | Real route observation, speaker/earpiece/accessory listening and call takeover |
| SIP foreground voice | Current isolated `ai.phone11.mobile.foregroundtrial` native adapter | Physical microphone, registration, incoming/outgoing media and cleanup |
| Background/closed-app calls and OS call UI | Explicitly unsupported by the foreground trial | Android native wake/Telecom/service implementation and provider/device tests |
| Chat push | iOS/APNs implementation; Android delivery not implemented | Android notification token/enrollment/provider and lifecycle implementation |
| Transfer and screen broadcasting | Guarded source exists; foreground profile does not enable it | Separate native integration and acceptance; blind transfer remains unsupported |
| Sustained calling | Siprix trial remains limited to 60 seconds | Licensed SDK and sustained-call validation |

## Build and test evidence

Local development testing uses the fixed foreground-trial profile and exact pinned Siprix AAR. A local release variant may be signed with the existing Expo development key for the owner's A55 testing. Its public certificate is pinned before assembly and verified independently afterwards. This is development signing, not an EAS/distribution signer or store release.

Detailed local package, source hash, signer and validation results are recorded with the generated artifact. No EAS FINISHED receipt is fabricated. The repository's guarded internal cloud build retains its existing credential constraints.

The daily-use workflow explicitly runs the imported shared meeting/admin suites. The mobile workflow continues to exercise platform-specific source/configuration contracts. Keep new product screens shared; add native adapter tests whenever a platform-specific capability changes. Missing Android capability must remain explicit in this table rather than being counted as automatically implemented by an iOS change.

The Samsung A55 was absent from `adb devices -l` during this continuation. Installation, physical audio, background behavior and provider acceptance are not claimed.
