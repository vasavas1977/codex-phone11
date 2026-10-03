# Phone11 Data safety working inventory — 15 September 2026

Draft for the final Android release. Do not paste into Play Console as a completed declaration: exact Android SDK behavior, provider terms, data-retention rules, and production feature flags still need verification.

| Data category to evaluate | Source-backed processing | Proposed purpose / remaining decision |
| --- | --- | --- |
| Personal information: name, email, user/account IDs, phone numbers | Existing-account authentication/profile; assigned extension and work directory; call routing and call metadata. | Account management and app functionality. Confirm which fields are required and retained after account closure. |
| Messages / other in-app messages | Team message content stored on the server; drafts/pending sends stored locally under owner/workspace keys. | App functionality. In-app user communication and service-provider processing need correct sharing classification. |
| Audio / voice recordings | Microphone sends call audio; enabled cloud recording retains WAV audio; the authorized worker sends recordings to Gemini for transcription/summary. | Calling and optional recording/AI functionality. Verify whether collection is optional for every user under automatic workspace policies; do not blanket-mark optional. Document recipients, retention and deletion. |
| Other user-generated content | Transcripts, AI summaries and action items persisted server-side; personal notes/task metadata and confirmed speaker names stored locally; intentional export/share can leave the app. | App functionality. Match Play's exact category definitions, identify local-only versus transmitted content, and document user-controlled export. |
| Contacts | Device address-book matching is local and the permission text states it stays on the device. A selected telephone number is used when placing a call; confirmed names may appear in user-requested exports. | Do not declare wholesale address-book upload without evidence. Verify final Android SDK/network behavior and distinguish local matching from transmitted call identifiers. |
| Device/other IDs and diagnostics | Auth/session infrastructure and app diagnostics; current notification registration is iOS-only. | Verify Android release identifiers, FCM/APNs differences, diagnostic uploads, retention and linked identifiers before answering. Do not transfer iOS token declarations mechanically to Android. |
| Location, financial information, photos/video, advertising IDs | No completed Android release inventory proves these categories either collected or absent. Some installed media dependencies and older routes exceed the current supported calling UI. | Inspect actual SDK initialization, merged permissions and runtime traffic. Do not claim “no collection” from hidden UI alone. |

Account creation is disabled in current mobile auth configuration. Confirm whether release onboarding links anywhere to registration; this changes account-deletion requirements. Regardless of that result, answer Google's deletion questions and publish truthful retention/request-handling information.

Do not claim all data is encrypted in transit solely because the REST API uses HTTPS. Verify the Android SIP signaling and media configuration as well as storage/export paths. Document the scope of the claim without implying end-to-end encryption for a server-recorded call.

Privacy-policy inputs still required: publishing legal entity and contact; privacy/request URL; release countries and intended audience; actual telephony/cloud/AI processors and contractual role; account/message/recording/log retention; supported deletion request procedure and justified retained data; diagnostic/analytics behavior; SDK licensing and data disclosures.

Google defines collection/sharing and exemptions in its [Data safety guidance](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en). The final answers must match the signed Android artifact, its connected service configuration, and the approved policy.
