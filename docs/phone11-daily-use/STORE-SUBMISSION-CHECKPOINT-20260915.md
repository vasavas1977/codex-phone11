# Phone11 store submission checkpoint — 15 September 2026

## Decision

Prepare both listings now, but do not upload or submit either binary yet.

- **Apple:** the internal iOS package is technically well formed, but the app still needs a paid Siprix license, privacy/AI consent, Team moderation, final metadata and one exact TestFlight build that passes repeated handset acceptance.
- **Google Play:** Android cannot be submitted as a usable phone app because the selected Siprix bridge is iOS-only and the fallback Android SIP package has no verified arm64 native runtime. Android incoming-call delivery and physical-device acceptance are also unproven.

## What is already ready

- A fail-closed Apple store profile prevents an unlicensed or wrongly configured store build.
- Signed internal Build 53 was produced from exact source `4b87e4e58735e9bd25aca8977451e872fa4c6127`; package and signing checks passed. It is internal evidence, not the store binary.
- Apple and Google privacy/data inventories and official-policy checklists exist in this directory.
- Current shared app configuration targets API 36 and supplies Android adaptive-icon layers. These facts do not prove a releasable Android calling client.

## Local work that can proceed without credentials or publication

1. Replace the inaccurate Preview/60-second/background-call copy in Settings and remove the obsolete CloudPhone11/liblinphone/Flexisip architecture screen from the release navigation.
2. Add an easily accessible in-app Privacy page and Terms page using owner-approved legal text; prepare public HTML pages for later hosting.
3. Add versioned, revocable user permission before recordings are sent to Gemini, while retaining workspace recording policy and the audible/visual recording notice.
4. Implement Team Chat report-user/report-message and block-user controls, plus accepted-use terms and an operational moderation queue.
5. Reconcile `PrivacyInfo.xcprivacy`, Apple App Privacy answers and Google Data safety answers against the actual backend, storage, Gemini, APNs/FCM and retention behavior.
6. Prepare fictional reviewer data, repeatable reviewer instructions, descriptions, keywords, support text, age/content-rating answers and screenshot shot lists.
7. Add release checks that reject preview copy, placeholder links, development launchers, trial SDK state, absent privacy/support URLs and unsupported Android calling.
8. Run the final cross-platform source/test/security suite and retain exact commit evidence before any paid store build.

## Owner/account inputs still required

- Permanent iOS bundle ID, Android package ID, public legal entity/support contact, privacy/support URLs, release countries, age audience and iPhone-only versus iPhone+iPad decision.
- Paid production Siprix license and confirmation that its distribution terms cover App Store and Google Play binaries.
- App Store Connect app record/Apple ID, Google Play package ownership and signing state, dedicated reviewer accounts and final privacy/export/legal answers.
- Final approval immediately before any paid build, upload, TestFlight/Play track release or review submission.

## Store-ready proof required

### Apple

Use one exact `production-ios-siprix-store` build. Verify distribution signing, production APNs, no debugger/dev launcher, final privacy manifests and licensed Siprix state. On that TestFlight build, repeat incoming/outgoing, lock/background answer and reject, two-way audio, mute/hold, Wi-Fi/mobile-data movement, recording lifecycle, playback routes, Recents, contacts, sign-in/out and two-account Team Chat. Review crash reports before submission.

### Google Play

First implement and license a real Android calling engine plus Android call push/lifecycle. Produce a signed AAB from an Android-specific profile, then verify target API 36, merged permissions, arm64 libraries, 16 KB compatibility, signing certificate and absence of iOS-only flags. Repeat the full calling/recording/chat acceptance set on physical Android and complete Play app-access, UGC, permission and Data safety declarations against that exact AAB.

## Source documents

- [Apple readiness](APP-STORE-READINESS-20260915.md)
- [Google Play readiness](GOOGLE-PLAY-READINESS-20260915.md)
- [Google Play Data safety inventory](GOOGLE-PLAY-DATA-SAFETY-DRAFT-20260915.md)
- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Google Play UGC policy](https://support.google.com/googleplay/android-developer/answer/9876937?hl=en)
- [Google Play target API requirement](https://developer.android.com/google/play/requirements/target-sdk)
- [Android 16 KB compatibility](https://developer.android.com/guide/practices/page-sizes)
