# Phone11 mobile navigation comparison — 25 September 2026

The iPhone 17 Pro Max on signed Build 102 was inspected through iPhone Mirroring. Phone11 already has a keypad, recent calls with All/Missed/Recorded filters, searchable contacts, a Team Chat inbox with Mentions, and an admitted meeting entry. Zoom Phone's documented mobile flows provide a useful reference for discoverability and labels, while Phone11 retains its own visual identity.

## Changes delivered in Build 103

- Recents now has a visible, accessible Voicemail entry leading to the existing voicemail screen. Previously the Recents header gave no route to it. Zoom's mobile call history and voicemail guidance place these tasks close to calling history.
- Settings reports the real SIP state: ready, connecting, failed, offline, or extension setup required. A saved but disabled account no longer appears connected or offers Reconnect.
- Settings no longer says all video is unavailable when admitted Team Chat meetings exist; the copy distinguishes gated meetings from unavailable PBX conference calling and the 60-second SIP trial.
- My profile distinguishes loading, failed, and unavailable workspace status, and offers a retry on failure. The former message incorrectly implied the company needed an app update for any failed profile query.

The source is commit `333462eed6b1b79b0f5bd86811db138c10e786bb`; signed daily-pilot Build 103 is [fc7099e5-4cce-4141-b764-9ad2ab95e581](https://expo.dev/accounts/vasavas/projects/phone11ai/builds/fc7099e5-4cce-4141-b764-9ad2ab95e581). [CI run 36151161653](https://github.com/vasavas1977/codex-phone11/actions/runs/36151161653) passed all jobs. The IPA SHA-256 is `bbb522307129965b932cdb5b5aa5ea7b5f2019184513e02275e13d2782c2c8e0`. The retained-Build-49 daily-pilot verifier passed signature, Siprix, APNs, bundle identity, and baseline checks. `devicectl` installed it in place on the paired iPhone 17 Pro Max and read back version 1.0.0/build 103. App launch succeeded. On-screen Build 103 UX acceptance and two-phone media/push testing remain separate gates.

## Next product gaps

- A contact's detail screen has Call and Message, but no person-specific video invite. Do not route a contact button to generic admitted-meeting prejoin: that would not invite the contact. Build and verify a tenant-scoped direct invitation path first, then add the action beside Call.
- The second test iPhone was unavailable to CoreDevice during Build 103 installation. It remains on Build 102 until it reconnects and the same verified IPA is installed in place.
- Continue checking Team Chat unread and meeting states on the signed app; a successful package build does not prove a two-person invitation or two-way audio.

Reference behavior: [Zoom mobile call history](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0069013), [voicemail](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0068876), [contacts](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0065609), and [availability](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0065488).

## Build 104 follow-up

- Recents adds a Starred filter using the existing user-scoped call favorites; hidden calls remain excluded. On the iPhone 17 Pro Max, Starred appeared and its empty state read “No starred calls.”
- The expanded voicemail item has a guarded Call back action for a valid caller number. The live inbox currently returns `SERVICE_UNAVAILABLE`, so no actual voicemail item or callback was exercised. The screen now distinguishes storage setup, authentication, access, and connection errors. Build 104 displayed the storage setup message.
- Team Chat now retains a 44-point video icon for signed-in users. It opens prejoin only when the protected capability reports available; loading, error, and unavailable states give a reason or retry. On the iPhone 17 Pro Max, tapping the icon opened the admitted-meeting prejoin screen, which showed one ready meeting and muted microphone/video defaults. No meeting was joined or two-way media tested in this follow-up.
- My profile now treats the service's `PRECONDITION_FAILED` status as an uncommissioned workspace capability instead of suggesting a network retry. The live status screen was not rechecked on Build 104 after iPhone Mirroring disconnected.

Source commit `97f703c795c5c8e964d95ac8ce9f5692bcfa569e` passed 82 focused local tests, TypeScript, diff check, and all jobs of [CI run 36158213810](https://github.com/vasavas1977/codex-phone11/actions/runs/36158213810). Signed daily-pilot [Build 104](https://expo.dev/accounts/vasavas/projects/phone11ai/builds/c9dcb74d-f5bc-49eb-87dd-3d9aa8d79ee3) reports that exact commit and profile `preview-ios-siprix-daily-pilot`. Its IPA SHA-256 is `599544a56fcde705d4aab7c2a2ca7039ce9998ef6ba9dadb18e5068638221e51`; the retained-Build-49 daily-pilot verifier passed package signature and baseline checks. The IPA is retained at `~/Library/Application Support/Phone11/verified-builds/104/Phone11-104.ipa`. CoreDevice installed it in place on the iPhone 17 Pro Max and read back version 1.0.0/build 104.

The iPhone 15 Pro Max still reads Build 102. Its network device connection timed out before installation, so two-phone audio, video, push, and background ringing acceptance remain open. The contact-specific Meet shortcut also remains open pending a tenant-scoped direct invitation path; the existing group/channel admission cannot be presented as a one-person invite. Workspace status and voicemail storage require separate server commissioning, not a mobile-only change.
