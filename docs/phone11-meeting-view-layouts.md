# Meeting views

Phone11 defaults to Speaker view. Gallery displays the same participants with equally sized camera tiles. The view selector applies to the current room only; leaving or replacing the room resets it to Speaker, including reuse of an earlier room object.

The stage uses the existing authenticated room and actual SDK `isSpeaking` state. It keeps a simultaneous or quiet speaker stable, prefers remote participants over the local preview, and shows a named camera-off tile when that speaker has no available camera. All existing screen shares remain prominent, fit without cropping, and are never mirrored. The local camera preview is mirrored.

Camera-off tiles reuse the existing workspace profile avatar in both mobile and browser views. The authenticated parent resolves the participant from the current room snapshot and the matching workspace directory; the stage receives a rendered avatar, not a photo URL or credentials. Unmatched participants, stale directories, and identities from another workspace cannot select another user's photo. Missing or unavailable photos keep the existing initials fallback. Turning a camera on replaces the avatar tile with that camera's existing track.

Changing views only changes local tile order and size. It does not publish, subscribe, change membership, start capture, grant host authority, or detach existing audio/video tracks. Remote audio remains attached independently of video layout; the audio status counts participants rather than their microphone and screen-audio tracks.

Browser audio recovery belongs to one room effect lifetime. Retired promises and queued events cannot change another room's prompt. The prompt follows actual `canPlaybackAudio` after either attempt outcome, and only one current retry runs at a time. SDK cancellation or a timeout is not added.

These are local Speaker/Gallery views. Host pinning/spotlighting and provider or physical-device acceptance remain separate work. Existing installed trial packages do not contain this source change until separately built and verified.

Gallery camera and camera-off tiles use pages with accessible Previous/Next controls and a page count. Capacity follows measured stage width (one to four columns, two rows); before measurement a two-column fallback applies. The stage lives in a content-sized scrolling surface, so it does not feed its own content height back into page capacity. All simultaneous screen shares stay prominent and outside camera pagination. Mobile also recognizes completed single-finger horizontal swipes; vertical, short, cancelled, multi-touch and long gestures do not change the page, and it never captures the parent scroll responder.

Room replacement, leaving, reusing an earlier room, and Speaker/Gallery transitions reset the page. Roster or width changes clamp the current page. Off-page camera/avatar nodes remain mounted at positive size with transparent presentation, disabled pointer interaction and hidden accessibility; browser descendants are inert. Paging does not detach tracks, duplicate audio, call subscription/publish/capture/reconnect APIs or change permissions. Existing SDK adaptation to normal resizing, viewport scrolling and app background remains SDK-owned; no provider or physical-media continuity is asserted by these source tests.
