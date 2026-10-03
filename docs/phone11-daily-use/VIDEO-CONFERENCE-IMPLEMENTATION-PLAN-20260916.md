# Phone11 video and conference implementation plan

Date: 16 September 2026
Scope: Phone11. This is an implementation plan and acceptance contract. It does not claim that video or conference calling is deployed, provisioned, or usable in the installed application.

## Decision

Build in two independently releasable steps:

1. **One-to-one SIP video** extends the existing Phone11 voice call. It preserves the working iOS voice, CallKit, PushKit, recording, and Recents paths when video is unavailable.
2. **Server-backed conference** follows. Audio conference and group video are distinct: FreeSWITCH can host the audio bridge, while group video needs a separately authenticated SFU or MCU that supplies real participant streams.

Phone11 remains the product application. The Siprix Flutter plugin is a useful official capability reference and evaluation harness; it is not a reason to replace Phone11's React Native application with the sample Flutter app. Share domain contracts and user experience across mobile and desktop, while keeping each platform's media and OS-call integration native.

## Current source boundary

| Area | Observed state | Consequence |
| --- | --- | --- |
| Current iOS bridge | `modules/phone11-siprix/index.d.ts` fixes `Call.hasVideo` to `false`; no camera, video upgrade, renderer, or conference methods are exported. | The TypeScript application cannot safely request or display video. |
| Current iOS runtime | `modules/phone11-siprix/ios/Phone11Siprix.m` initializes `singleCallMode = YES` and `enableVideoCall = NO`; invites and accepts use `withVideo:NO`; video upgrade callbacks are empty. | Existing voice remains intentionally single-call and audio-only. |
| Current UI | `lib/phone/capabilities.ts` sets `video` and `conference` to `false`; `app/call/video.tsx` and conference routes deliberately show unavailable screens. | Do not expose a call control until the matching native/server capability is confirmed. |
| Conference prototype | `lib/conference/engine.ts` creates local records and can fall back after ESL failure. The currently routed screens do not present it as a live room. | A local record, mock participant, or successful UI action is never conference proof. |
| Desktop | The current desktop/browser view is presentation evidence only. No Phone11 native desktop SIP/video renderer or media acceptance exists. | A responsive web screen must not be described as a desktop calling client. |
| Android | There is no equivalent Phone11 native Siprix/Telecom/video implementation. | iOS proof cannot establish Android support. |

The existing [video design](VIDEO-CONFERENCE-DESIGN-20260915.md) and [test matrix](VIDEO-CONFERENCE-TEST-MATRIX-20260916.md) remain the user-facing design and present-tense capability record. This document turns their gates into a build sequence.

## Reference capability, not an implementation promise

The current official Siprix Flutter package advertises SIP/RTP audio/video calls, SRTP/TLS, multiple calls, camera/microphone controls, transfer, audio joining, and native iOS/Android/desktop platform packages. Its trial drops calls after 60 seconds; a production licence and provider-compatible SIP credentials are required. [Package documentation](https://pub.dev/packages/siprix_voip_sdk), [official API and integration documentation](https://docs.siprix-voip.com/rst/flutter.html), [API reference](https://docs.siprix-voip.com/rst/api.html).

Relevant integration facts to validate against the **pinned native SDK headers**, before changing the Phone11 bridge:

- The Flutter example's video path owns a local and a remote renderer for the lifetime of a call. Phone11 needs equivalent native view attachment and detachment, not an image view or a recording player.
- The vendor advises a camera usage description for iOS/macOS video; Android needs a real camera permission flow. Permission is requested only when a person chooses video, never during sign-in or registration.
- Background incoming calls remain an OS responsibility: iOS needs the existing PushKit/CallKit path and Android needs its own FCM/foreground/Telecom design. Do not introduce a second CallKit provider alongside Phone11's existing CallKeep owner. [iOS CallKit/PushKit guide](https://docs.siprix-voip.com/rst/ioscallkit.html).
- Siprix audio mixing/multiple calls does not supply a group-video topology. A conference grid is permitted only after the server sends, authorizes, and delivers each visible video stream.

## Shared call and room contracts

Create stable server-owned IDs before implementation. The client must never invent them from display names or SIP addresses.

```text
call_id                immutable Phone11 call record
media_session_id       one negotiated point-to-point media session
conference_id          tenant-scoped server room
participant_id         immutable room membership, not a device identifier
participant_version    increasing membership/role revision
media_capabilities     codecs, audio/video, camera, screen-share flags
operation_id           idempotency key for join, leave, mute, start/stop recording
recording_session_id   server-confirmed capture session; optional per call/room
```

Every command includes authenticated tenant, user, device/session binding, target ID, expected revision, and an idempotency key. Server events carry a monotonic room/call revision. Clients reconcile a fresh snapshot after reconnect and discard stale events. Names come from the authenticated account/contact mapping; they never come from diarization order or an unauthenticated SIP display name.

## Stage 0 — make the existing voice bridge extensible

**Outcome:** a versioned capability boundary that leaves installed audio-only binaries safe.

1. Extend the native contract with an optional `video` capability, a per-call media state, video-upgrade request/result events, camera state, and renderer attach/detach operations. Missing methods must result in an explicit unsupported state, never a crash.
2. Keep `singleCallMode` enabled and video disabled in the currently released native binary. Do not change registration, PushKit wake adoption, CallKeep ownership, route selection, mute, or recording commands in this stage.
3. Add generation/sequence checks to all media callbacks, including callback delivery after call termination, app relaunch, and renderer disposal.
4. Add a capability endpoint/cache tied to native build version and account policy. UI reads this instead of assuming a JavaScript update added a native renderer.
5. Add diagnostics that record SDK build/version, opaque call ID, operation, native error category, and elapsed time. Do not log credentials, full SIP headers, raw recording contents, or contact text.

**Exit gate:** host tests cover event ordering and unsupported-old-build behavior; one signed iOS build confirms ordinary inbound and outbound voice, mute, hold, DTMF, routes, recording controls, and locked-screen acceptance are unchanged.

## Stage 1 — one-to-one video

### Media and signalling

- Verify the PBX/SIP edge accepts the selected video codecs, RTP/SRTP, ICE/STUN/TURN policy, and re-INVITE/UPDATE behavior. Treat codec negotiation and NAT traversal as server acceptance tests, not app-only tests.
- Add outbound video invite, inbound video offer, and in-call upgrade/downgrade. No visual state moves to **Video connected** until both native negotiation confirmation and remote renderer attachment succeed.
- Keep the existing voice leg alive when camera permission, remote acceptance, codec negotiation, or rendering fails. The user sees **Video unavailable — voice continues** with one retry path.
- Camera-off stops transmission at the media layer and replaces the local/remote tile with the person’s avatar/name. It must not merely cover the preview.
- On lock/background, suspend camera according to OS policy. Foregrounding restores only the camera state the caller explicitly left enabled; it never silently turns video back on.

### Mobile UX

- Remote video occupies a dark, edge-to-edge stage. A movable local preview is constrained to safe areas and cannot cover End call, captions, or a permission error.
- The durable control row is **Mute**, **Camera**, **Audio**, **More**, and **End call**. Audio opens the system route picker; it lists only real earpiece, speaker, and connected Bluetooth devices.
- More contains only supported actions: keypad, hold/resume, transfer, recording state, and participant add only after their related capability gate is passed. One sheet can be open at a time.
- The active-call return banner stays available while the user opens Recents, Chat, or Contacts. Returning preserves call, mute, camera, and recording state.

### Desktop UX

- Ship no desktop calling control until a native desktop media adapter is selected and proven. The browser view is not that adapter.
- Preserve Phone11's shared TypeScript call state and design tokens, then provide an explicit macOS/Windows/Linux media implementation or a deliberately limited web client with its own supported-browser and device matrix.
- At 1200 logical pixels and above: navigation rail, Recents/list column, flexible video stage, and optional participant/transcript panel. At tablet width: two panes. At handset width: one stage with back navigation.
- Desktop supports keyboard mute, camera, route picker, end call, focus-visible controls, and a resizable list/detail divider with keyboard alternatives. A web preview must not simulate hardware routes or camera success.

**Exit gate:** two real endpoints, on both Wi-Fi and cellular, demonstrate bidirectional audio/video, camera permission denial, camera off/on, front/rear switch, route change, lock/background/return, remote rejection, timeout, and hangup. Repeat each direction (outbound/inbound) at least three times in the same signed build. A desktop client gets a separate two-endpoint acceptance row.

## Stage 2 — consultation and audio conference

**Outcome:** safe three-way audio before group video.

1. Replace the single-call assumption only after the native bridge has per-leg IDs, explicit focus, hold/resume, mute propagation, call termination reconciliation, and stale-event protection.
2. Implement **Add participant** as a consultation call. The original leg is held and its camera transmission stops before dialing the next person. A failed or cancelled consultation resumes only the original call.
3. Offer **Merge calls** only after native and PBX confirmation. Display **Return to [name]** until merge succeeds. One participant leaving must not end other legs.
4. Move conference authority to a tenant-scoped middleware service in front of FreeSWITCH ESL. Clients receive short-lived room grants; no ESL credentials, room PINs, or raw event socket access belong in the app.
5. Persist room state, membership, role, lock, waiting room, room revision, audit actor, and operation receipt on the server. If the middleware cannot confirm an action, show pending/failed and retain the last server-confirmed roster.

**Exit gate:** three distinct real accounts demonstrate consultation cancel, consultation failure, successful merge, participant departure, moderator-only actions, route changes, reconnect, and end semantics. A local fallback or a mock **You** participant fails this gate.

## Stage 3 — group video conference

**Outcome:** an honest group-video experience, not an audio conference with a decorative grid.

- Select and commission an SFU or MCU whose signaling and room grants integrate with Phone11 identity. The conference service owns participant lifecycle, subscriptions, active speaker, limits, screen share policy, and media recording capability.
- The SIP/PBX conference audio bridge and the SFU have an explicit media ownership boundary. If the product joins PSTN/SIP callers to a video room, implement a controlled gateway and prove audio/video synchronization. Do not imply a PSTN caller has video.
- Each tile maps to an authenticated `participant_id` and actual received stream. No stream means an avatar/audio-only tile. Layout subscriptions change as tile visibility changes; the UI must not subscribe to every camera without a capacity policy.
- Host/moderator capabilities are server-authorized: invite, admit, remove, mute request, lock room, assign co-host, recording request, and end-for-all. A local button does not grant authority.
- Add screen sharing only after camera/grid/reconnect acceptance. It has its own permissions, privacy notice, capacity controls, and renderer tests.

**Exit gate:** three real participants on at least two networks complete join/leave/rejoin, camera on/off, active-speaker/grid layout, moderator admit/remove, audio-only participant, network change, host departure, and room end. Every visible stream is verified by its remote sender and receiver.

## Recording, AI, privacy, and governance

- Workspace policy decides whether recording is off, manual, or automatic. Client state changes only after the recording service returns a durable receipt.
- For video or a room, use a separate recording capability flag. Audio capture does not permit the UI to label a file as video recorded.
- Issue the required short recording announcement before capture and include all newly joining participants according to workspace policy. If consent/announcement cannot be confirmed, recording does not start.
- Store access control at tenant, workspace, call/room, participant, and owner level. Recording links are authorized and short-lived. Never expose a predictable storage URL.
- AI transcription and summary labels use verified Phone11 account/contact names when mapping confidence is sufficient; otherwise use neutral labels and allow authorized correction. Do not guess identity from voice diarization.
- Recording-derived follow-up tasks remain private to the owner by default. Conference membership alone grants no access to a personal summary, transcript, or task.
- Keep audit entries for policy change, join/leave, recording start/stop, export/share, deletion, name correction, role action, and admin access. Define retention, legal hold, deletion, and export rules before enabling a customer tenant.

## Quality, security, and release test plan

| Layer | Required evidence |
| --- | --- |
| Contract/unit | Capability parsing; old-native compatibility; command idempotency; stale call/room event rejection; authorization and name-resolution rules; recording state machine. |
| Native bridge | iOS compile/link against the exact pinned headers; Android equivalent implementation; renderer lifecycle and memory leak checks; no duplicated CallKit/Telecom ownership. |
| Server | SIP video codec and SRTP path; TURN/ICE behavior; tenant/room authorization; event replay handling; FreeSWITCH middleware receipts; SFU admission and stream authorization. |
| Security | Short-lived grants; no secrets in mobile logs; rate limits; audit fields; permission denial; revoked membership; route/room cross-tenant attempts; storage URL access after revocation. |
| UX/accessibility | 44-point mobile controls; VoiceOver/TalkBack labels; keyboard desktop paths; dynamic type; Thai/English long names; color-independent selected states; return/back behavior; network loading/failure states. |
| Real-device | iPhone and Android separately; a supported desktop client separately; incoming/outgoing, lock/background, Wi-Fi/cellular, Bluetooth route, camera, mute, recording, reconnect, and repeated-call reliability. |
| Release | Compatible signed native build, versioned capability rollout, rollback switch, crash/error monitoring, and install confirmation on a real device. A web preview or OTA JavaScript update cannot add a missing native renderer. |

## Delivery order and stop conditions

1. **Protect the voice release:** Stage 0 contract and voice regression acceptance.
2. **Video pilot:** Stage 1 only for an authorized test tenant, behind the server capability flag.
3. **Audio conference pilot:** Stage 2 with a non-production FreeSWITCH middleware environment and three test accounts.
4. **Group-video pilot:** Stage 3 after SFU/MCU selection, security review, and room/media acceptance.
5. **Broad release:** only after mobile, desktop, policy, observability, and support handoff each have evidence.

Stop and keep a capability hidden if any of these occur: missing renderer method, camera permission/recovery failure, a voice regression, server operation without a durable receipt, an unverified recording announcement, cross-tenant access, an unproven desktop media path, or an Android-only/iOS-only claim of parity.

## Implementation ownership

| Owner | Owns |
| --- | --- |
| Phone11 mobile bridge | iOS/Android capability adapter, renderer lifecycle, native call/media events, OS permissions, CallKeep/CallKit/Telecom integration. |
| Phone11 product UI | Call/conference state display, accessible controls, Recents/history presentation, named transcript/summary display, truthful unavailable states. |
| UCC media service | SIP/media compatibility, TURN/ICE policy, FreeSWITCH middleware, SFU/MCU integration, room grants, event stream, recording receipts. |
| Enterprise admin | Tenant policy, roles, retention, moderation/audit viewing, authorised feature rollout, support runbooks. |
| QA/release | Matrix ownership, real-device evidence, signed-build installation, crash monitoring, rollback rehearsal. |

No owner may activate a live provider, purchase a Siprix licence, provision a PBX/SFU, migrate production state, or record customer traffic as part of this document. Those actions require their own reviewed configuration and explicit authorization.
