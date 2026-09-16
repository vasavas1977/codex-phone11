# Phone11 video and conference test matrix

Date: 16 September 2026  
Scope: Phone11 only. This matrix records the current implementation boundary and the evidence needed before exposing video or conference controls.

## Current status

| Capability | Current state | Evidence in source | Can it be tested in the current build? |
| --- | --- | --- | --- |
| One-to-one SIP voice | Available on the commissioned iOS Siprix path | `lib/phone/capabilities.ts` sets `voice: true`; the Siprix adapter handles registration, one call, answer, mute, hold, DTMF, route, and hangup | Yes, on a compatible native build and real device |
| Recording and AI history | Separate voice-call feature | Recording controls and Recents are separate from the media bridge | Yes, only where the build has a server-confirmed recording and completed transcript/summary |
| SIP video | Implemented in source; not handset-proven | Optional native capability detection, explicit camera permission/video invite and answer, camera controls, negotiated events and local/remote views | Only after a new signed native build and two-endpoint media verification; older builds stay voice-only |
| Audio conference / consultation | Unavailable in the active Phone11 adapter | Siprix native runtime is single-call mode; the JS engine rejects a second active call; `lib/phone/capabilities.ts` sets `conference: false` | No; do not use the local conference engine as live evidence |
| Group video | Connect11 LiveKit selected; integration pending | Shared room/token/interpreter contract coordinated with Connect11; SDK coexistence review required | No; not deployed or linked into the installed app |
| Desktop video or native desktop calling | Not proven | Browser/desktop preview is UI evidence only; native Siprix acceptance is separate | No live media proof |

The legacy `lib/sip/pjsip-engine.ts` contains older voice/video-oriented comments and methods, but it is not evidence that the current Phone11 iOS Siprix build supports video. Testing that path would produce a result for a different adapter and could obscure the active production boundary.

The files under `lib/conference/` now use an authenticated server adapter. Synthetic rooms, mock self-participants and mobile ESL credentials were removed. Provisioned FreeSWITCH audio-room controls are separate from the selected Connect11 LiveKit group-meeting path. No room creation, join routing or live deployment is implied by adapter tests.

## What can be tested now

Use a Phone11 native build on a real iPhone. Expo Go, the web preview, screenshots, and a simulator cannot prove SIP media, CallKit, camera, or Bluetooth behavior. Keep a second real endpoint available for the remote party.

1. Confirm the Phone11 account is signed in and the registration indicator says **Ready to call**.
2. Place one outbound voice call to the second endpoint. Confirm two-way audio, mute/unmute, hold/resume, DTMF, speaker/Bluetooth route selection, and hangup.
3. Repeat as an inbound call. Answer from the foreground and locked-screen system UI. Confirm audio returns after the app is foregrounded and after a Wi-Fi/cellular transition.
4. End the call, open Recents, and verify the recording, playback, transcript, speaker names, summary, and retry/empty states according to the recording policy.
5. On older installed builds, video/conference remain unavailable. After installing a newly signed video-capable build, follow the two-device video sequence below; conference remains unavailable until the Connect11 integration is commissioned.

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

Once these gates pass, the practical two-device sequence is: choose **Video call** from Phone → approve camera → dial a video-capable extension → remote party deliberately answers with video → verify both live frames and sound → turn camera off/on → switch camera → change audio route → background/foreground (camera stays muted until explicitly resumed) → end → verify history. Ordinary voice calls are not silently upgraded; in-call upgrade is not implemented.

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

The current user can safely test Phone11's single-call voice, recording, playback, transcript, summary, mute, hold, DTMF, audio route, and locked-screen behavior. The user cannot yet test SIP video, audio conferencing, or group video because those capabilities have not been built, installed and commissioned together on the handset. Enabling a button or navigating to a mock conference would create a false acceptance signal.

The implementation sequence is: preserve voice regressions → sign and prove one-to-one video → integrate Connect11 LiveKit meetings and interpreter → commission multi-device meetings. PBX consultation/audio merge is a separate feature. Native SDK changes require a new signed build; source tests cannot establish device acceptance.

