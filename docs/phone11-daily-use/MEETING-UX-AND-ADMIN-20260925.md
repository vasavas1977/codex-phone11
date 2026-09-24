# Phone11 meetings: Zoom-informed UX and release boundary

Phone11 uses its own brand and Connect11 meeting service. Zoom Workplace is the interaction reference, not an SDK or a source of graphics. These references describe the behavior reviewed on 25 September 2026:

- [Zoom mobile meeting controls](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0063582): primary controls at the bottom, participant panel and More for secondary actions.
- [Zoom meeting join flow](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060732): review audio and video before joining and distinguish entry from waiting-room state.
- [Zoom participant controls](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0062674): connected-audio state, mute, video, participants and leave; availability varies by role and policy.
- [Zoom desktop meeting layouts](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0063672): gallery and speaker layouts keep participant identity and media controls distinct.
- [Zoom account meeting settings](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0061300) and [waiting room](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0059359): account policy must be enforced server-side, with explicit admin/user scope.
- [Zoom tiered settings](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0065579): account, group, and user values have explicit precedence; locked account or group settings cannot be changed below that level.
- [Zoom iOS audio](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0064460): joining meeting audio is a distinct step from muting an already connected microphone.

## Interaction parity sequence

Phone11 keeps its own visual identity and copies the useful interaction model, not Zoom artwork or labels. The order below follows the user-visible meeting journey and keeps controls honest about the capabilities the service actually supports.

| Moment | Expected Phone11 behavior | Current boundary |
| --- | --- | --- |
| Before joining | Show the chosen meeting, signed-in identity, camera and microphone choices, and an unmistakable Join action. Keep Back available. | Choice/status screen exists. A live camera preview and audio-device test are not yet implemented. |
| Connecting | Distinguish joining, connected, reconnecting, and failed states. Never show a working mute control before media is connected. | Implemented in the mobile room; real-device network transitions remain unverified. |
| During mobile meeting | Keep the other person's video prominent and primary audio, video, participants, and leave controls reachable at the bottom. Put secondary actions in More. | Implemented for admitted calls. Meeting chat, share, hand raise, and captions must not be offered until functional and authorized. |
| During desktop meeting | Show named video tiles, a participant roster, gallery/speaker selection, audible output status, and persistent mute, camera, and leave controls. | Real join and media controls are staged locally. Roster/layout work is in progress; live admission and macOS/Windows media acceptance remain. |
| Admin setup | Owner/admin sees workspace meeting eligibility and channel host permissions. Future account/group/user policy must show inheritance and lock state only when enforced by server admission and room actions. | Channel host permission is implemented in source only. Waiting room, recording, sharing, and policy inheritance are not live settings. |

The iPhone audio acceptance gate is concrete: join one room on extensions 3001 and 1020 using the same signed build, unmute both, and hear speech in both directions. Video frames alone do not pass this gate. A failed direction should be diagnosed from the exact device log and audio route before adding more controls.

## Implemented source slice

| Surface        | Behavior                                                                                                                                                                                                                           | Evidence boundary                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| iPhone meeting | Prejoin shows chosen mic and camera states; room keeps video prominent, bottom media/participants/more/leave controls, live roster and connection status. Only existing session actions are offered.                               | Source and component tests; a new signed build and real two-phone usability test are required.     |
| Desktop trial  | Signed-in Meetings entry opens a sandboxed, isolated media window. Privileged code fetches admission for the phone tenant; the calling renderer receives no meeting token. The media window provides room choice, prejoin, join/leave, microphone and camera controls, and incoming audio/video. SIP activity closes the meeting through a media-stop barrier. | Source, IPC/security and local build tests passed. A macOS arm64 package from committed source passed ad-hoc code-signature and helper-integrity verification; distributable signing, Windows package/runtime, and two-party media tests remain. |
| Admin portal   | Tenant-scoped Meetings page lists eligible group/channel members and lets an active owner/admin set `can_start_meeting`. The same flag is checked by channel-meeting start. Disabled tenant mapping or absent schema fails closed. | Source/API tests; hosted DB/deployment authorization and an actual admin/member test are separate. |

## Next service gates

Desktop admission and an isolated LiveKit window are implemented in source. The controlled entry is `meetings.availableForTenant` plus a tenant-bound `meetings.join`, and desktop must reject any room that does not match the signed-in phone tenant. The calling renderer remains isolated from media and credentials. Audio-device selection, reconnect quality, signed macOS/Windows packaging, and a real two-party A/V test are still release gates.

The admin page must not display waiting-room, recording, screen-sharing or policy-lock switches until Connect11/Phone11 enforce each setting on token issuance and in-room actions. A UI toggle alone cannot define access. Channel host permission is the first supported setting; it does not grant meeting access outside an admitted channel or create an arbitrary room.

Meeting acceptance requires two signed native iPhones for camera frames, speaking/hearing in both directions, mute/unmute, camera on/off, participant roster, permission denial, disconnect/reconnect, SIP interruption, sign-out, and leave/rejoin. Build 96 from source `eba9a3c037c888634b19ad33498831720768db87` passed the signed IPA verifier and was installed on the paired iPhone 17 Pro Max and iPhone 15 Pro Max; device inventory reports version 1.0.0 build 96 on both. Its two-way listening and UI behavior are not yet confirmed. Record exact build/source IDs and device result separately from test success. A third participant is needed before claiming group layout or three-party media acceptance.
