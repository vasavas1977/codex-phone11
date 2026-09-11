# Phone11 daily-use readiness — 12 September 2026

Phone11 is still an internal pilot. The working public-number foreground call is accepted for the tested two-phone case, but dependable background and long-call use are not yet accepted.

| Area | Current evidence | Still required |
| --- | --- | --- |
| Incoming public calls | Installed build 23 passed the user-confirmed two-way test; the dedicated-number PCMA setting is retained. | Repeat on the release candidate and other network states. |
| Background calls | Native wake handling, server wake candidate and an isolated signed pilot are prepared. | Apple push setup, authenticated backend checks, commissioning, then background and locked-phone ringing, Answer, two-way speech, End and Recents. |
| Team Chat | Real scoped messages, drafts, unread counts, ordinary-alert outbox and notification enrollment are implemented. | Deploy the later alert migration/backend and verify with an authorized second participant, including locked-screen alert and tap. |
| Alert recovery | Temporary enrollment failures retry only for the same active account/workspace; token events cannot recursively request tokens. | Real permission, offline recovery and recipient-device tests. |
| Long calls | No production Siprix license is configured in the installed build. | Configure a valid license and accept a call longer than 60 seconds. |
| Network/audio changes | Guarded reconnect and call controls are implemented. | Wi-Fi/cellular changes, interruption, speaker/Bluetooth and mute/hold tests on real phones. |

The latest application source is `1b004bac738111d1ba7849e627341f641cea3af1`. The final enrollment patch passed 64 focused tests; a separate reviewer passed 49 overlapping tests. These totals must not be added. The iPhone JavaScript export passed using the existing local dependency-resolution path. All required clean signing checks passed in [workflow 34633414125](https://github.com/vasavas1977/codex-phone11/actions/runs/34633414125). The resulting version 1.0.0/build 25 is signed and independently verified, but not installed.

Build 25: EAS `207befc2-ca78-44b9-a252-0fbdb962e7cd`, 16,572,310 bytes, SHA256 `d29afc67a2a88cec6b040dbc613df4a57b15fa5581c55f2e4497c7138bb0ce2c`. Its actual signed production APNs entitlement, provisioning profile and signing identity match installed build 23. Native wake and ordinary-chat pilot markers are both 1; runtime is `1.0.0-siprix-daily-pilot-1` and updates are disabled. No Siprix license is configured. Build 23 remains the installed app.

The live backend remains on `75fa3c9`. Four additive call-wake tables passed a complete restore rehearsal and protected-data checks before application. The separate frozen backend candidate passed basic private checks and was stopped while legitimate owner sign-in checks are pending. The later two-table ordinary-message alert migration is not applied. No new provider delivery, app installation or physical background acceptance is claimed.

## Owner inputs needed to finish commissioning

- Complete sign-in in the open Apple Developer page. Passwords and verification codes should stay there.
- Identify the existing private Phone11 sign-in handoff file, or provide the account through the intended private sign-in flow; do not paste passwords in chat.
- Confirm whether a paid Siprix license exists and where its private handoff is stored. The vendor documents the trial's [60-second call limit](https://www.siprix-voip.com/download/).
- Make the two test phones and an authorized second chat participant available after provider/backend setup is ready.

Selected-workspace message alerts remain best effort. Their delivery window is ten minutes, and uncertain provider attempts are not replayed. OS-reclaimed and user force-quit calling require separate results. Full Zoom feature parity, voicemail, transfer and production rollout are not claimed.
