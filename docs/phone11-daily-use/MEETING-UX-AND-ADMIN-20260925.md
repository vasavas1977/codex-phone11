# Phone11 meetings: Zoom-informed UX and release boundary

Phone11 uses its own brand and Connect11 meeting service. Zoom Workplace is the interaction reference, not an SDK or a source of graphics. These references describe the behavior reviewed on 25 September 2026:

- [Zoom mobile meeting controls](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0063582): primary controls at the bottom, participant panel and More for secondary actions.
- [Zoom meeting join flow](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060732): review audio and video before joining and distinguish entry from waiting-room state.
- [Zoom participant controls](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0062674): connected-audio state, mute, video, participants and leave; availability varies by role and policy.
- [Zoom desktop meeting layouts](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0063672): gallery and speaker layouts keep participant identity and media controls distinct.
- [Zoom account meeting settings](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0061300) and [waiting room](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0059359): account policy must be enforced server-side, with explicit admin/user scope.

## Implemented source slice

| Surface        | Behavior                                                                                                                                                                                                                           | Evidence boundary                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| iPhone meeting | Prejoin shows chosen mic and camera states; room keeps video prominent, bottom media/participants/more/leave controls, live roster and connection status. Only existing session actions are offered.                               | Source and component tests; a new signed build and real two-phone usability test are required.     |
| Desktop trial  | Signed-in Meetings entry opens a sandboxed, isolated media window. Privileged code fetches admission for the phone tenant; the calling renderer receives no meeting token. The media window provides room choice, prejoin, join/leave, microphone and camera controls, and incoming audio/video. SIP activity closes the meeting through a media-stop barrier. | Source, IPC/security and local build tests; signed macOS/Windows packages and two-party device tests remain. |
| Admin portal   | Tenant-scoped Meetings page lists eligible group/channel members and lets an active owner/admin set `can_start_meeting`. The same flag is checked by channel-meeting start. Disabled tenant mapping or absent schema fails closed. | Source/API tests; hosted DB/deployment authorization and an actual admin/member test are separate. |

## Next service gates

Desktop admission and an isolated LiveKit window are implemented in source. The controlled entry is `meetings.availableForTenant` plus a tenant-bound `meetings.join`, and desktop must reject any room that does not match the signed-in phone tenant. The calling renderer remains isolated from media and credentials. Audio-device selection, reconnect quality, signed macOS/Windows packaging, and a real two-party A/V test are still release gates.

The admin page must not display waiting-room, recording, screen-sharing or policy-lock switches until Connect11/Phone11 enforce each setting on token issuance and in-room actions. A UI toggle alone cannot define access. Channel host permission is the first supported setting; it does not grant meeting access outside an admitted channel or create an arbitrary room.

Meeting acceptance requires two signed native iPhones for camera frames, speaking/hearing in both directions, mute/unmute, camera on/off, participant roster, permission denial, disconnect/reconnect, SIP interruption, sign-out, and leave/rejoin. The installed Build 93 contains the duplex audio-session change, but its two-way listening result has not been confirmed. A newer source-reviewed build adds fail-closed media teardown; do not treat it as device-proven until installed and tested. Record exact build/source IDs and device result separately from test success. A third participant is needed before claiming group layout or three-party media acceptance.
