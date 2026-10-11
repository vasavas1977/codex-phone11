# Meeting views

Phone11 defaults to Speaker view. Gallery displays the same participants with equally sized camera tiles. The view selector applies to the current room only; leaving or replacing the room resets it to Speaker, including reuse of an earlier room object.

The stage uses the existing authenticated room and actual SDK `isSpeaking` state. It keeps a simultaneous or quiet speaker stable, prefers remote participants over the local preview, and shows a named camera-off tile when that speaker has no available camera. All existing screen shares remain prominent, fit without cropping, and are never mirrored. The local camera preview is mirrored.

Changing views only changes local tile order and size. It does not publish, subscribe, change membership, start capture, grant host authority, or detach existing audio/video tracks. Remote audio remains attached independently of video layout; the audio status counts participants rather than their microphone and screen-audio tracks.

Browser audio recovery belongs to one room effect lifetime. Retired promises and queued events cannot change another room's prompt. The prompt follows actual `canPlaybackAudio` after either attempt outcome, and only one current retry runs at a time. SDK cancellation or a timeout is not added.

These are local Speaker/Gallery views. Host pinning/spotlighting, gallery paging, swipe navigation, and provider or physical-device acceptance remain separate work. Existing installed trial packages do not contain this source change until separately built and verified.
