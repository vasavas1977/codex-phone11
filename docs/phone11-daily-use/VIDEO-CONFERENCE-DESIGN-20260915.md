# Phone11 video and conference design

Date: 15 September 2026. Scope: Phone11 only. This is the implementation and acceptance target approved in the design conversation, not a claim that the features are installed or operational.

## Current evidence

- `app/call/video.tsx`, `app/conference/index.tsx`, and `app/conference/room.tsx` currently show unavailable screens.
- `modules/phone11-siprix/index.d.ts` still declares `hasVideo: false`. The bridge has no video renderer, camera controls, upgrade methods, or conference methods.
- `modules/phone11-siprix/ios/Phone11Siprix.m` creates and accepts audio-only calls, rejects a second active call, and leaves video-upgrade and switched-call callbacks empty.
- Blind transfer is being implemented separately in this working tree; source changes are not handset acceptance. The older `app/call/transfer.tsx` route still reports unavailable at this audit.
- System/Light/Dark appearance is implemented in the shared provider and Settings. Native automatic appearance needs a new binary. Existing audio, recording, and CallKit behavior must pass regression checks before release.

## SDK boundary

Siprix exposes video offer/accept, manual upgrade decisions, camera mute, and camera switching. Upgrade and hold requests need their resulting callbacks before the UI reports success. Its mixer combines audio across calls; it does not create a shared group-video experience. Calls without audio focus can still transmit video, so a private consultation must explicitly stop camera transmission or hold the previous leg. These capabilities describe the SDK, not the Phone11 bridge. [Siprix API reference](https://docs.siprix-voip.com/rst/api.html)

On iOS, Siprix provides a native UIView video window that is assigned to a call. Phone11 needs a React Native view manager with explicit attach/detach lifecycle; an image or generic video player cannot substitute for the live renderer. [Siprix integration guide](https://docs.siprix-voip.com/rst/integration.html)

Keep Phone11's existing CallKeep/PushKit ownership. Do not introduce a second CallKit provider or replace the application with the Flutter example. Validate exact APIs against the pinned SDK headers before bridge work.

## Visual layout

The app shell follows the user's System/Light/Dark preference. Recents, transcription, contacts, and settings use the shared palette. Active video and conference screens use a dark stage in both appearances.

| Area | Required behavior |
| --- | --- |
| One-to-one video | Remote participant fills the stage; movable self-preview stays inside safe bounds and clear of controls. Name and connection status remain readable. Camera-off remote uses their name/avatar. |
| Conference | Participant grid with names, microphone state, and camera-off avatars. Only actual received video streams are rendered. Audio-only conferences use avatars. |
| Bottom controls | Mute, Camera, Audio, More. End call remains visible above the safe area, including while menus are open. Controls never disappear behind captions or self-preview. |
| More | One sheet at a time: Add participant, Hold/Resume, Transfer, Recording, and Keypad as supported by the active session. No billable-call action. |
| Audio | System route picker with iPhone, Speaker, and currently available external/Bluetooth devices. Show the actual selected route; never invent a Bluetooth device. |
| Feedback | One short status near the relevant control. Pending operations disable duplicate submission, not the entire screen. End call remains usable. |

All icon controls require accessible labels, selected state, and at least 44-point targets. Text must remain usable at larger accessibility sizes. Names come from authenticated account/contact mapping; do not infer speaker identity from diarization order.

## Exact user flows

### Start or upgrade video

1. User chooses Video on a supported contact or Camera during a voice call.
2. Ask for camera permission at that action. Explain that camera video is shared with the other participant. Denial leaves voice connected and offers a Settings link without repeating prompts.
3. Show a local preview and explicit camera state before sending. Manual remote upgrade approval offers **Turn on camera** and **Continue with audio**.
4. During negotiation show **Starting video…**. Keep existing voice controls working. Only show video-connected state after native confirmation and renderer attachment.
5. Unsupported endpoint, rejected upgrade, missing video codec, or negotiation timeout returns to voice with **Video unavailable. Your voice call continues.** Never end an established voice call just because video fails.
6. Camera off stops transmission, not merely the preview. Switching front/rear camera preserves microphone state. App background/lock suspends camera; returning does not silently enable a camera the user turned off.

### Add a participant and merge audio

1. More → Add participant opens contacts/number entry. Cancel returns to the existing conversation unchanged.
2. Before dialing, confirm hold on the current leg and stop its camera transmission. Display the held participant clearly.
3. Dial the new participant as a separate consultation. On failure or cancel, end only the new leg and resume the original call.
4. When connected, show **Merge calls** and **Return to [name]**. Merge becomes available only when native and PBX capabilities permit it.
5. After merge confirmation, show all actual audio participants. End call ends the local conference legs; do not imply the user can end a PBX-hosted room for everyone unless the server explicitly authorizes it.
6. A participant leaving does not end remaining legs. Mute applies to the user's microphone across every joined leg. Per-participant removal requires an explicit supported operation.

### Group video

Group video requires a separately proven server video bridge or SFU and an authenticated room/participant contract. A local Siprix audio merge alone must never display a claim that every participant can see every other participant. Gate the grid's live-video mode on actual server negotiation and stream delivery. Participant limits, layout subscriptions, invitations, and host privileges follow the selected server capability, not a hard-coded marketing promise.

### Recording, routes, and interruptions

- Recording remains governed by workspace policy and actual server session mapping. Starting video or merging calls does not automatically start recording or add new participants to a recording without the applicable announcement/consent flow.
- Show recording state only after server confirmation. Timeout means unknown/retry, not an invented success. Do not promise video recording when only audio is captured.
- Preserve mute across recording changes, route changes, hold/resume, app navigation, and reconnect. Route selection must not start the microphone or camera unexpectedly.
- An incoming cellular/system call uses the existing CallKit audio lifecycle. Resume audio/video only when the OS returns ownership and native state agrees.
- Recording-derived follow-up tasks stay private to their owner unless explicitly shared. Conference membership is not permission to publish private summaries or tasks.

## Implementation ownership and release gates

| Gate | Required evidence before enabling |
| --- | --- |
| Native contract | One bridge owner adds optional capability detection, video state/events, camera commands, and renderer lifecycle. Old installed binaries continue voice-only without missing-method crashes. |
| Multi-call state | Replace the single-call guard only with per-leg state, identity binding, focus/hold handling, termination reconciliation, and stale-callback tests. Preserve wake-call adoption and generation/sequence protection. |
| Server | Prove SIP video codec/media compatibility; separately prove conference membership and any group-video topology. No direct PBX admin credentials in the app. |
| iOS | Release binary contains the intended Siprix engine and camera permission text; test real device renderer, camera indicator, CallKit incoming/locked behavior, routes, and background recovery. |
| Android | Independently implement and prove permissions, rendering, Telecom/audio focus, Bluetooth, background behavior, and push. iOS success is not Android parity. |
| Handset acceptance | Two actual endpoints for video; three for audio merge and group video. Confirm bidirectional sound, mute, camera off, switch camera, hold, participant drop, hangup, recording, and Wi-Fi/cellular transitions. Repeat calls rather than accepting a single successful attempt. |
| Rollout | Keep the working release available. Use a compatible native build and verified install page; a JavaScript update cannot supply a missing native renderer or conference method. No demo data or screenshots count as live acceptance. |

Recommended sequence: preserve voice regressions → one-to-one video → multi-call consultation/audio merge → server-backed group video. Enable each capability independently after its own evidence passes.

## Mobile and desktop product requirement

Phone11 must have intentional mobile **and** desktop layouts. A stretched handset layout is not desktop acceptance. "World-class" is the quality target; do not claim it is achieved until the interactions below pass with real content, assistive technology, and actual calls.

Benchmark direction: Zoom's desktop uses navigation between workspaces and supports keyboard calling controls. Teams places call history centrally with quick access to contacts. Phone11 should adopt this clarity while retaining its own minimal visual language. [Zoom desktop navigation](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0064516), [Zoom keyboard shortcuts](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0067050), [Teams calling experience](https://support.microsoft.com/en-US/teams/calls-devices/get-to-know-the-calling-experience-in-microsoft-teams)

### Adaptive layouts

These are proposed logical-width breakpoints, subject to content and device QA rather than device-name detection.

| Available width | Layout |
| --- | --- |
| Under 768 | Bottom navigation; one primary screen. Recents opens one call's recording/summary/transcript at a time. Back returns to the same list position. Active call opens a full-screen stage with a compact return-to-call banner when browsing elsewhere. |
| 768–1199 | Compact navigation rail and a list/detail workspace where both panes remain usable; fall back to one detail pane when text scaling or a side-by-side OS window makes space insufficient. |
| 1200 and above | Navigation rail, call list (initially 320 px), and flexible call detail/stage. A details panel can show transcript/summary alongside the active stage without covering End call. No giant centered dial pad surrounded by unused canvas. |

Desktop navigation contains Phone, Recents, Contacts, Team, and Settings, with visible labels when expanded and tooltips when compact. Keep actions scoped to the selected call. Search and All/Missed/Recorded filters belong above the list, not repeated in every detail pane. Selecting another record updates the detail pane and clearly marks selection without placing a call. Calling requires the dedicated Call action.

On desktop, provide a draggable list/detail divider with keyboard resizing and sensible minimum widths. The call stage grows with available space; remote video preserves aspect ratio, and self-preview stays inside the stage. The stage can expand within the app, then restore its previous size. Do not label this a detached call window until a separate window implementation is proven. At narrow sizes, stack panes rather than shrinking controls or forcing horizontal scrolling.

Mobile portrait prioritizes remote video, then controls. Landscape moves controls to a compact side/bottom dock while preserving camera preview and End call. Tablet split-screen uses available width, not full device width. Opening the keyboard for participant search must not hide cancellation or the ongoing-call indicator. Contact names, Thai text, and numbers wrap or truncate deliberately without overlapping status icons.

### Testable interaction and accessibility acceptance

- Test at 360×800, 390×844, 768×1024, 1024×768, 1280×800, and 1440×900 logical sizes, plus phone landscape and desktop 200% zoom. No horizontal page scroll, clipped primary actions, or controls under safe areas.
- Test System/Light/Dark on mobile and desktop. Selected states use more than color alone. Measure text contrast against the actual palette: target at least 4.5:1 for normal text, 3:1 for large text and meaningful control boundaries/icons.
- VoiceOver on iOS and a desktop screen reader announce participant name, muted/camera state, selected record, playback time, and route changes. Do not announce the call timer every second. Focus must remain stable when the transcript or participant roster updates.
- Keyboard-only desktop users can navigate, search, select a record, play/pause, seek, select an audio route, mute, open/close More, and end the call. Visible focus follows a logical order. Escape closes the topmost sheet and returns focus to its trigger; it never hangs up a call.
- The recording seek bar supports pointer dragging, touch dragging, and keyboard adjustment with an accessible elapsed/duration value. Seeking must not unexpectedly place calls, change records, or reset playback.
- Every draggable/resizable element has a keyboard alternative. Touch controls meet the 44-point minimum. No essential action depends on hover, right-click, or fine dragging alone. Zoom likewise emphasizes keyboard operation and controls that do not require fine motor precision. [Zoom accessibility FAQ](https://www.zoom.com/en/accessibility/faq/)
- Loading/failure/empty states preserve context: show only the requested translation as pending, allow cancel/back, keep the original text available, and provide a bounded retry. List selection and scroll position survive returning from a call or recording.
- Test long contact names, Thai/English mixed text, missing avatars, no contacts permission, no recording permission, disconnected Bluetooth, no network, and a changed account. No unsupported function appears to succeed.
- On real handset and desktop calling paths, verify that browsing Recents or resizing does not stop media, recording, or mute state. Visual preview success alone cannot satisfy this gate.

Document each check with platform/build, scenario, result, and evidence. Desktop web preview, native desktop calling, iOS calling, and Android calling are separate acceptance rows; do not infer one from another.
