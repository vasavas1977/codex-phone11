# Phone11 video and conference test matrix

Date: 16 September 2026  
Scope: Phone11 only. This matrix records the current implementation boundary and the evidence needed before exposing video or conference controls.

## Current status

| Capability | Current state | Evidence in source | Can it be tested in the current build? |
| --- | --- | --- | --- |
| One-to-one SIP voice | Available on the commissioned iOS Siprix path | `lib/phone/capabilities.ts` sets `voice: true`; the Siprix adapter handles registration, one call, answer, mute, hold, DTMF, route, and hangup | Yes, on a compatible native build and real device |
| Recording and AI history | Separate voice-call feature | Recording controls and Recents are separate from the media bridge | Yes, only where the build has a server-confirmed recording and completed transcript/summary |
| SIP video | Unavailable | `lib/phone/capabilities.ts` sets `video: false`; `modules/phone11-siprix/index.d.ts` fixes `hasVideo: false`; `Phone11Siprix.m` sets `enableVideoCall = NO`, sends `withVideo = NO`, and discards video-upgrade callbacks | No; the video route intentionally shows an unavailable state |
| Audio conference / consultation | Unavailable in the active Phone11 adapter | Siprix native runtime is single-call mode; the JS engine rejects a second active call; `lib/phone/capabilities.ts` sets `conference: false` | No; do not use the local conference engine as live evidence |
| Group video | Not implemented | No native video renderer, camera controls, SFU/MCU room contract, or participant stream contract is connected | No |
| Desktop video or native desktop calling | Not proven | Browser/desktop preview is UI evidence only; native Siprix acceptance is separate | No live media proof |

The legacy `lib/sip/pjsip-engine.ts` contains older voice/video-oriented comments and methods, but it is not evidence that the current Phone11 iOS Siprix build supports video. Testing that path would produce a result for a different adapter and could obscure the active production boundary.

The files under `lib/conference/` describe a future FreeSWITCH adapter. They create local conference records and a mock `You` participant, and may fall back to local mode when the configured REST middleware is unavailable. The routes deliberately do not import that store. A local record or a successful mock action must not be reported as a live conference.

## What can be tested now

Use a Phone11 native build on a real iPhone. Expo Go, the web preview, screenshots, and a simulator cannot prove SIP media, CallKit, camera, or Bluetooth behavior. Keep a second real endpoint available for the remote party.

1. Confirm the Phone11 account is signed in and the registration indicator says **Ready to call**.
2. Place one outbound voice call to the second endpoint. Confirm two-way audio, mute/unmute, hold/resume, DTMF, speaker/Bluetooth route selection, and hangup.
3. Repeat as an inbound call. Answer from the foreground and locked-screen system UI. Confirm audio returns after the app is foregrounded and after a Wi-Fi/cellular transition.
4. End the call, open Recents, and verify the recording, playback, transcript, speaker names, summary, and retry/empty states according to the recording policy.
5. Open the video and conference routes only to verify the honest unavailable state. Do not place a video or conference test call from these routes; there is no connected media path behind them.

For every native call, record the app build, platform, direction, network, account/tenant, endpoint, and result. A UI state such as “connected” is not enough without bidirectional sound on both endpoints.

## Video readiness matrix

Video should remain hidden until every prerequisite below is proven in the same native build.

| Gate | Required implementation or evidence | Test |
| --- | --- | --- |
| Capability | Per-build capability negotiation; account video codec configuration; incoming upgrade policy | Verify unsupported endpoints stay audio-only and show a recoverable message |
| Camera | Runtime camera permission requested at the user action; camera-off stops transmission | Deny permission, continue voice, grant permission, turn camera on/off, and verify the OS camera indicator |
| Renderer | React Native view manager backed by Siprix video-window APIs, with attach/detach by call and runtime generation | Start video, background/foreground, rotate, and end the call without a stale or blank renderer |
| Negotiation | Invite/answer/upgrade callbacks drive state; no optimistic “video connected” label | Test accepted, rejected, unsupported-codec, timeout, and remote audio-only cases; established voice must survive failure |
| Controls | Mute, camera, audio route, camera switch, More, and End call remain accessible | Test touch, keyboard/accessibility labels, lock/background, route changes, and repeated calls |
| Server media | Verified SIP video codec path or a tenant-scoped video service | Confirm actual remote frames and audio on two real endpoints; source XML or SDK capability alone does not pass |

Once these gates pass, the practical two-device sequence is: call voice → choose **Video** → approve camera → verify local preview → obtain remote approval/answer → verify both live frames → turn camera off/on → switch camera → change audio route → lock/unlock → end → confirm the call remains in history with the correct media type.

## Conference readiness matrix

Conference testing needs at least three real endpoints for three-way audio and a separately proven server video bridge or SFU for group video.

| Gate | Required implementation or evidence | Test |
| --- | --- | --- |
| Multiple call legs | Per-leg IDs, focus, hold/resume, mute, termination, and stale-event reconciliation | Hold participant A, consult B, cancel B, resume A; then repeat with B answering and leaving |
| Merge ownership | Explicit **Merge calls**, **Return to [name]**, and end semantics | Verify one leg can end without ending the remaining conversation; do not imply “end for everyone” without server authorization |
| Room contract | Authenticated tenant-scoped room membership, invitations, host/moderator permissions, and participant events | Join from three accounts and verify each roster change is server-confirmed |
| Group video | MCU/SFU negotiation, stream delivery, camera-off avatars, layout/subscriptions, and limits | Verify every visible tile has an actual received stream; audio-only participants show as audio-only |
| Recording/privacy | Server-confirmed recording state, announcement/consent, participant ownership, and private summary/task rules | Start/stop only after confirmation; verify private follow-ups are not shared with other participants by default |
| Mobile/desktop | Intentional responsive layouts and platform-specific media/audio focus behavior | Run the same room on iPhone and desktop at the supported widths; check navigation, resizing, accessibility, background, and reconnect |

## Current user-facing test result

The current user can safely test Phone11's single-call voice, recording, playback, transcript, summary, mute, hold, DTMF, audio route, and locked-screen behavior. The user cannot yet test SIP video, audio conferencing, or group video because those capabilities are correctly gated off in the current Phone11 bridge. Enabling a button or navigating to a mock conference would create a false acceptance signal.

The implementation sequence remains: preserve voice regressions → add and prove one-to-one video → add multi-call consultation/audio merge → connect a server-backed group-video room. Each stage requires a new native build and real-device evidence before the next control is exposed.

