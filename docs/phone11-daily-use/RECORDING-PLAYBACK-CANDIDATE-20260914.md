# Recording playback candidate — 14 September 2026

Base: `71f4b683d572585c8d07c561649a543acfe87d40`.

## Changes

Recents and full call details use the same shared React Native player on iOS and Android. The progress track now has a 44-point touch target, draggable thumb, a preview while dragging, one clamped decoder seek on release, cancellation on interrupted gestures, and screen-reader adjustment actions. Existing play/pause and ±15-second controls remain.

Playback prepares media audio before starting, sets the player volume to 1 and clears player mute. This does not change system volume or amplify/alter the recording. Completed recordings restart from zero. Expo players are created with `keepAudioSessionActive: true`: the installed Expo default schedules process-wide deactivation 100 ms after pause/completion and only checks Expo players, which could silence a newly active SIP call. Disabling that delayed cleanup leaves session ownership with native call control; idle navigation cleanup restores the media category without blindly deactivating the shared session. Route requests are serialized and invalidated on pause, sign-out, navigation blur, or a call; a late promise cannot start audio after invalidation.

The iOS Siprix bridge adds a dedicated recording media-route operation. It refuses to change AVAudioSession when native calls, an incoming wake, or CallKeep's active audio session own it. Normal playback uses the playback category/default mode, clearing a stale voice-chat/receiver category. The optional speaker switch uses play-and-record/default mode and Apple's speaker override. Navigation cleanup returns to the normal media category only while no native call owns audio. It never deactivates a live call's audio session.

The speaker switch is exposed only when the installed iOS native bridge supports it. Existing binaries fall back to Expo's media setup. Android inherits shared controls and Expo media routing; a forced Android speaker switch is not advertised without a verified native capability. The installed Expo Audio 1.1 source documents `shouldRouteThroughEarpiece` as Android-only, so it is not used to claim an iOS speaker switch.

## Diagnosis and limits

The prior cloud player never configured a media audio session. Its position bar was display-only. These source defects explain missing seeking and are plausible contributors to muted/receiver-level playback after a call; they do not prove the latest recording's intelligibility.

A separate read-only backend investigation measured the latest recording as 51-second stereo PCM16/16 kHz. Both channels contain sound and peaks are below clipping; channel RMS was approximately -29.95/-34.21 dBFS. Aggregate measurements do not establish clarity. This patch does not normalize the original or export/listen to customer audio.

## Validation

- 33 focused Vitest tests pass: authorized playback/focus, shared UI, seek gestures/cancellation/accessibility, replay, route setup/errors/serialization, and late call/blur/pause rejection.
- Three native tests pass: pinned SDK selector compilation, 155 actual-bridge assertions with a mock SDK, and 242 native wake-runtime assertions.
- Whole-repository TypeScript check has the same 235 diagnostic lines as the untouched base (missing transfer types and marketing-site dependencies/types); no additional diagnostics.
- `git diff --check` passes.

No deployment, signed build, real call, or handset listening test was performed by this subtask. A new signed iOS build is required for the speaker capability. On that build verify playback after an ended call, silent-switch playback, dragging while paused/playing, speaker/headset transitions, incoming-call interruption, and navigation/sign-out interruption. Judge audibility on the physical handset. Android media behavior requires emulator and physical-device proof separately.

## Signed candidate gate

Read-only local signing inspection found an Apple Development identity and a wildcard development profile without `aps-environment`. It cannot produce the matching push-enabled daily-pilot candidate. No credentials were created or downloaded, no cloud build was started, and installed Build39 was left unchanged.

The existing reviewed EAS profile is `preview-ios-siprix-daily-pilot`, with internal distribution, automatic build-number increment, bundle override `space.manus.phone11ai.t20260425073427`, and production APNs inherited through the wake-pilot profile. After owner approval for the external build, use that existing profile and verify the resulting entitlements and native bridge before installation. Do not substitute a wildcard/no-push development build or submit to a store.
