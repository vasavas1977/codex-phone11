# Phone11 Apple App Store readiness — 15 September 2026

## Decision

Phone11 is **not ready for App Store submission**. The repository now has an isolated, fail-closed store build profile, but no store build was requested, uploaded, submitted or released. The current internal handset build and local Release product are not App Store artifacts.

Do not submit until every P0 gate below is closed against one exact commit and one TestFlight build.

## Safe preparation completed

- `production-ios-siprix-store` is isolated from the existing internal pilot profiles. It requests store distribution, the production EAS environment, Xcode 26, the registered pilot bundle identifier, production APNs, native incoming-call wake, chat notifications and auto-incremented build numbers.
- `PHONE11_APP_STORE_BUILD=1` fails configuration when the bundle identifier falls back, the calling engine is not Siprix, production call/chat notification gates are absent, or `PHONE11_SIPRIX_LICENSE` is missing. The license remains an EAS environment secret and is not placed in `eas.json` or public Expo configuration.
- Build diagnostics now say `1.0.40-licensed` only when a license is actually configured; internal builds without it remain identified as `1.0.40-trial`.
- Local derived iOS directories and Python bytecode caches are ignored. The two derived directories currently occupy about 6.2 GB and contain local signed products; they must never enter an EAS source archive.
- Fourteen focused packaging/wake tests pass, including rejection of an unlicensed store configuration and verification that a fake test license is absent from public config.

## Artifact and configuration evidence

| Check | Current evidence | App Store implication |
|---|---|---|
| Required toolchain | Store profile pins `macos-sequoia-15.6-xcode-26.0`. | Meets Apple's current Xcode 26 / iOS 26 SDK upload floor in configuration. Prove the SDK again from the delivered archive. |
| Latest local Release product | Version 1.0.0, build 5; Xcode 16.4 / iOS 18.5 SDK; development provisioning; `get-task-allow=true`; `aps-environment=development`. | Not uploadable as the release candidate and below Apple's current SDK floor. |
| Existing signed pilot builds | Internal/ad hoc profiles. Prior verified production APNs pilots remain internal builds. | Internal installation and physical call success do not prove App Store signing or TestFlight processing. |
| Bundle identifier | Store candidate currently uses `space.manus.phone11ai.t20260425073427`. | The owner must confirm this permanent identifier before the first App Store upload. Apple does not allow changing the bundle ID after a build is uploaded. |
| App icon | Generated iOS catalog contains a 1024×1024 RGB icon with no alpha. Its source is only 192×192 and already contains a rounded tile/shadow. | Mechanically valid, but replace with a native 1024×1024 master without baked platform rounding for a professional listing. |
| Privacy manifest | Aggregated manifest has required-reason API entries and tracking false, but `NSPrivacyCollectedDataTypes` is empty. | This conflicts with the service's account, call, recording, transcript, summary, chat and push-token data flow. Reconcile the manifest and App Store privacy answers from one approved data inventory. |
| Device family | `supportsTablet:true`; the generated product supports iPhone and iPad. | Either complete iPad acceptance and supply 13-inch iPad screenshots, or make an explicit product decision to ship iPhone only before building. |
| Store assets | No App Store screenshots or localized store metadata are present in the repository. | At least one real in-use screenshot is required for each supported device family. |
| Submit profile | `submit.production` has no `ascAppId`; App Store Connect app-record state was not inspected. | Confirm/create the app record and add its Apple ID only after the permanent bundle identity is approved. |

## P0 product and policy gates

1. **Obtain and install the production Siprix license.** The owner previously confirmed that no paid license exists, and the present SDK is identified as trial with a 60-second limit. Apple says demos, betas and trial versions belong in TestFlight, not on the App Store. The new store guard intentionally blocks an unlicensed build.

2. **Finish crash and real-device acceptance.** Apple requires an on-device, stable, complete app and rejects binaries that crash or show obvious technical problems. Run a clean TestFlight build through repeated incoming/outgoing calls, locked/background wake, answer/reject/end, two-way audio, mute/hold, Wi-Fi↔cellular movement, recording start/stop/finalization, playback routes, Recents, contacts, sign-in/out and Team Chat. Preserve exact build/commit evidence and review crash reports from that build.

3. **Remove preview/trial and inaccurate screens from the store binary.** Settings currently says “Preview availability,” “limited to 60 seconds,” and that background incoming calls are not connected. Several routes expose unavailable features. `app/settings/about.tsx` describes CloudPhone11/liblinphone/Flexisip even though the accepted native path is Phone11/Siprix/custom PushKit routing. Replace this with accurate Phone11 information, hide unfinished routes, and remove placeholder or demo behavior. Apple requires final, accessible functionality and accurate metadata.

4. **Add an in-app privacy page and a public privacy-policy URL.** Neither is implemented in the release navigation. The policy must describe account identifiers, numbers/call metadata, recordings, transcripts, summaries, chat, device/push identifiers, retention/deletion, security, processors and how users revoke consent/request deletion. It must name Google/Gemini as a third-party AI processor when enabled. Apple requires the policy both in App Store Connect and inside the app.

5. **Obtain explicit consent before third-party AI processing.** The current recording policy lets a workspace administrator toggle AI summaries, but the UI does not disclose that audio is sent to Google's Gemini API or obtain explicit permission from the app user before that transfer. Apple's current guideline 5.1.2(i) specifically requires disclosure and explicit permission before personal data is shared with third-party AI. Add a durable, versioned consent/revocation flow; admin policy alone is insufficient evidence of each user's permission.

6. **Prove recording notice and consent.** Every manual and automatic recording path must show a clear visual state and provide the approved audible notice before capture, including inbound/outbound, reconnect, background and repeated calls. Apple requires explicit consent and a clear visual and/or audible indication when recording. Country-specific call-recording law still needs owner/legal review for each storefront.

7. **Complete Team Chat safety controls or remove Team Chat from this version.** Current chat has no proven filtering, offensive-content reporting, user blocking or published support contact. Apple's user-generated-content rule requires all four plus timely operational response.

8. **Complete App Privacy declarations.** A conservative draft inventory to verify is: name, email address, phone number/call parties, user ID, device/push ID, audio data, messages, transcripts/summaries/notes and support content, normally linked to the signed-in work account and used for app functionality. Device Contacts can stay undeclared only if the final binary keeps the address book and derived names on device. Confirm retention and every server/processor before publishing the answers.

9. **Decide account lifecycle and review access.** The current app uses Phone11-owned email/password for pre-provisioned business accounts, with in-app signup disabled. On this evidence, Sign in with Apple is not required and Apple's in-app account-deletion rule is not triggered by account creation. If signup or an external creation link is added, provide in-app deletion. Create a stable App Review account with a working extension, safe test number, recording/AI policy and Team Chat peer; keep the backend available throughout review.

10. **Complete App Store Connect metadata.** Confirm name, subtitle, primary category, age-rating questionnaire, copyright, price/availability, content rights, support URL/contact, privacy URL, localized description/keywords/promotional text, App Review contact, detailed review notes, export-compliance answers and release mode. Explain the real CallKit/PushKit incoming-call flow, microphone/contacts use, recording consent, Gemini processing and how the reviewer can test without making chargeable or emergency calls.

11. **Verify encryption/export status.** `ITSAppUsesNonExemptEncryption=false` is configured, but the final Siprix/SRTP/HTTPS binary and distribution territories need an export-compliance determination. Do not carry the answer forward only because internal builds accepted it.

## Store asset set

- Supply 1–10 screenshots showing the real app in use, with fictional data. Apple's current iPhone 6.9-inch accepted portrait sizes include 1260×2736, 1290×2796 and 1320×2868. Because Phone11 currently supports iPad, a 13-inch iPad screenshot is also required at 2064×2752 or 2048×2732 portrait (or the listed landscape equivalents).
- Recommended first five frames: Phone/ready state, incoming CallKit screen, active-call controls, Recents recording playback, AI summary/transcript with fictional names, and Team Chat only after its safety controls are complete.
- Do not use the development-launcher, login-only, preview, error, placeholder or real-customer screens as store media.

## Final release sequence

1. Close P0 product/privacy/safety gates and decide iPhone-only versus universal iPhone/iPad support.
2. Approve the permanent bundle identifier and App Store Connect app record.
3. Store the paid `PHONE11_SIPRIX_LICENSE` only in the protected EAS production environment; confirm production APNs credentials/capabilities and `ascAppId` without publishing secret values.
4. Build `production-ios-siprix-store` from the exact reviewed commit. Do not use any `preview-*` profile.
5. Inspect the archive: Xcode/SDK, distribution profile, `get-task-allow=false`, production APNs entitlement, app identity/version/build, privacy manifests, icon, native libraries, absence of dev launcher behavior and absence of secret leakage.
6. Upload to TestFlight, complete internal then external acceptance, collect Organizer/TestFlight crash evidence, and resolve every observed crash or call failure.
7. Populate and independently review metadata/privacy/age/export answers and screenshots against that exact binary.
8. Only then request the owner's final approval to add the build to App Review and submit. Uploading a build and submitting it for review are separate external actions.

## Official current sources

- [Apple upcoming submission requirements](https://developer.apple.com/news/upcoming-requirements/)
- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Apple App Store Connect app information](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information)
- [Apple app privacy management](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy)
- [Apple privacy manifest data-use guidance](https://developer.apple.com/documentation/BundleResources/describing-data-use-in-privacy-manifests)
- [Apple screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications)
- [Apple submitting an app](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-app)
- [Expo production iOS builds](https://docs.expo.dev/tutorial/eas/ios-production-build/)
- [Expo EAS Submit for iOS](https://docs.expo.dev/submit/ios/)

