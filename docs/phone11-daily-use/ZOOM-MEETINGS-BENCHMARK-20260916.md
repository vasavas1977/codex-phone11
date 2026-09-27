# Phone11 meetings — Zoom benchmark and Connect11 integration

Research date: 16 September 2026. This is a design and acceptance specification, not a claim of deployed feature parity.

## Product decision

Phone11 owns the mobile/desktop meeting experience and enterprise administration. Connect11 supplies the shared LiveKit conferencing and interpreter service. Individual SIP calls remain on Siprix. Do not provision a second group-video platform or reuse the public Connect11 demonstration token flow as enterprise authentication.

Use Zoom's familiar workflows and control hierarchy with Phone11 branding. A feature is available only when the server and installed client both support it. Zoom plan/platform restrictions are not Phone11 promises.

## Minimal navigation and appearance

- Mobile: retain Phone, Recents, Contacts, Team and Settings. Put **Meetings** inside Team with Upcoming / Past and three primary actions: New meeting, Join, Schedule. Do not add another persistent bottom tab until usage justifies it.
- Desktop: dedicated Meetings destination in the app sidebar, upcoming list and meeting detail side by side. Separate meeting window only when actual desktop window support exists.
- System / Light / Dark preference. Light surfaces for lists, scheduling and administration; a neutral dark meeting stage for video in either theme. Preserve the user's explicit theme choice.
- Meeting-specific controls stay in the meeting. Default policies live in Settings → Meetings. Enterprise policy lives in Admin → Meetings. Do not duplicate a large settings button on every list.
- Every pushed screen has Back. Closing a panel does not leave a meeting; Leave is a distinct, persistent action.

## User journey

| Stage | Phone11 design | Required behavior |
|---|---|---|
| Schedule | Title, time/timezone, invitees, security; advanced settings collapsed | Stable meeting ID, recurrence/DST handling, copy invitation without sending automatically, explicit host |
| Prejoin | Real camera preview, display name, mic/camera toggles, audio route/test, spoken/listening language | Permission denied recovery; camera off until opted in; no room publication before admission |
| Waiting room | Host/meeting name, waiting status, Cancel | Server admission; reconnect does not bypass the lobby; denied/ended states distinct |
| In meeting | Video stage, participant names, compact toolbar | Real media tracks and server roles; no generated participant tiles presented as connected |
| Reconnect | Preserve stage and show connection status with retry/leave | Bound retry, republish only with current permission, retain mute/camera choices |
| Leave | Participant: Leave. Host: Leave with host handoff or End for everyone | Server authorization and confirmation; local disconnect never silently ends everyone |
| After meeting | Recording, transcript, summary, agreed actions, attendance where permitted | Processing/error/ready distinct; recording visibility separately authorized; private tasks stay private |

## Mobile meeting layout

Header: Back/minimize, meeting title, connection status, Leave. Center: active speaker by default; swipe or View switches to a paged gallery. A small movable self-preview never covers captions or the Leave action. Landscape uses available safe-area space, not fixed portrait dimensions.

Bottom toolbar: **Mic · Camera · Participants · More**. Each icon has a short label and at least a 44-point target. More contains Share, Chat, Captions, Language, Reactions and host tools. When interpreting is active, show a small **Listening: Thai** chip above the toolbar; tapping it opens language settings.

Audio route picker lists iPhone/earpiece, Speaker and connected Bluetooth devices. Show actual route selection, not a hard-coded list. Ending the meeting remains possible while another control is pending.

## Desktop meeting layout

Large resizable stage with Speaker / Gallery / Shared content views. Participants and Chat open in a right panel, not separate full-page navigation. Bottom toolbar: Mic and route selector, Camera and device selector, Share, Participants, Chat, Captions, Language, More, Leave. Host controls appear only to host/cohost. Keyboard shortcuts, visible focus, tooltips and screen-reader state labels accompany icons.

Sharing offers a window/screen picker, clear sharing border and persistent Stop sharing. Receiving screen share must work independently of publishing share. Native iOS screen publishing requires a tested ReplayKit extension; do not expose an unimplemented button.

## Interpreter experience

- Distinguish **spoken language**, **listening language**, and **caption language**.
- Host starts/stops interpretation subject to enterprise policy and explicit participant notice.
- Each attendee selects an available listening channel. Original audio is always a selectable fallback; optionally lower or mute original audio when interpreted audio is confirmed playing.
- Show Preparing / Interpreting / Reconnecting / Unavailable based on actual worker and track evidence. A successful dispatch request does not mean an interpreter has arrived.
- Language changes affect only that attendee's subscriptions unless host changes the room configuration. Keep the current audio until the replacement channel is ready; avoid double playback and feedback loops.
- AI interpretation and human interpreter roles are different features. Do not label an AI worker as a human interpreter.
- Never promise language pairs or participant limits before Connect11 returns its supported capabilities.

## Enterprise admin information architecture

Overview; People & groups; Meetings; Phone system; Recordings & AI; Devices; Reports; Security & audit; Integrations.

Meetings contains Default policies, Host permissions, Guest access, Waiting room, Screen sharing, Interpretation, Captions and Meeting limits. Policy detail shows effective value, inherited source and whether an administrator locked it. Scope is organization → group → user/meeting, with a documented conflict rule; use an explicit selected group priority rather than whichever database row happens to be first.

Roles: organization owner, scoped administrator, meeting host/cohost and participant. Configuration access does not grant recording/transcript access. Enforce roles on the server; hidden buttons are not authorization.

Recordings & AI contains opt-in/automatic policy, recording notice, sharing, retention, deletion and access audit. Keep Phone11's private recording follow-up tasks owner-only until explicitly shared; Connect11 meeting membership does not implicitly share them.

## Delivery priorities

**P0 — usable and safe:** authenticated tenant/account mapping; scoped short-lived room credentials; meeting lifecycle; prejoin; lobby/admission; mic/camera/audio output; speaker/gallery; participants; host/cohost and removal/lock; chat; interpreter language selection and visible status; connection recovery; responsive mobile/desktop layout; admin policy inheritance/locking; audit events. No handset calling regression.

**P1 — collaboration:** scheduling/recurrence/calendar handoff; desktop screen sharing and mobile share viewing; captions; recording/transcripts/AI summaries; tasks; reactions/raise hand; background blur; meeting quality reports; SSO/provisioning integration where supported.

**P2 — advanced parity:** breakout rooms, polls, whiteboard, remote control, webinars, room hardware, native mobile screen-share publishing, advanced compliance and large-event capacity. These remain explicit backlog items until implemented and tested; they are not cosmetic buttons.

## Ownership and integration gates

- Phone11: account/tenant mapping adapter, branded UI, app session lifecycle, policy presentation, own admin pages, task privacy.
- Connect11: authoritative room lifecycle, scoped token service, host permissions, interpreter dispatch/arrival/channel contract, provider integration, usage/audit and service configuration.
- Secrets remain server-side. Map Phone11 workspace/user IDs to Connect11 customer/subject IDs explicitly; no email/domain guessing.
- One media owner at a time on mobile. An incoming SIP/system call must follow an explicit interruption policy before LiveKit can release/reacquire audio.
- Existing signed Phone11 builds lack the new native modules. Browser previews and source tests do not establish installed support. Preserve the signed product app; never replace it with an Expo development launcher.
- Test two users in different tenants, unauthorized join, host departure, revoked membership, token expiry, background/foreground, Bluetooth change, cellular/Wi-Fi switching, interpreter failure and recording/task privacy. Validate camera/audio on two real endpoints, then three for a conference.

## Primary sources

- [Zoom host/cohost controls](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0065164): role-based meeting controls and AI feature access.
- [Zoom participant management](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0065566): participant moderation and host responsibilities.
- [Zoom waiting room configuration](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0059359): admission and policy exceptions.
- [Zoom desktop/mobile settings](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060612): app preferences and meeting window/control behavior.
- [Zoom video layouts](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0063672): speaker, gallery and participant layout choices.
- [Zoom language interpretation](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0064768): listening channels and original audio controls.
- [Zoom Voice translator](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0084896): AI translation is distinct from human interpretation and has quality limitations.
- [Zoom meeting summaries](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0058013): host and administrator control of summaries.
- [Zoom breakout management](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0062540): role/platform differences matter.
- [LiveKit Expo integration](https://docs.livekit.io/transport/sdk-platforms/expo/): native WebRTC and audio-session integration required for mobile.

## Enterprise research addendum

Use a People & groups area with distinct Users, Groups and Roles pages. Meeting host, cohost and alternative host are meeting-scoped responsibilities, not aliases for enterprise administrator. Show a policy preview for a selected user so group conflicts are understandable before publication. Meeting hosts cannot override an administrator-locked setting.

Administrative actions need actor, workspace, target, action, timestamp, result and correlation ID. Include recording download/share/delete and policy changes in access/audit controls. Display retention for original audio, interpreted channels, transcripts and summaries independently if their policies differ. A recording announcement is not equivalent to an affirmative consent receipt.

Additional official references:
- [Zoom role management](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0064983)
- [Zoom tiered settings](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0065579)
- [Zoom meeting roles](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0064033)
- [Zoom recording consent](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0059819)
- [Zoom recording governance](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0065362)
- [Zoom admin activity logs](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0067251)

## Confirmed Connect11 source gap as of this review

The coordinating Connect11 task inspected main `ca37cfbfa3db9fd36e4ff138b20f727dc8d05382`. Existing `/api/v1/realtime/tokens` issues tenant-prefixed room-scoped join credentials using a backend API key. It does not yet implement Phone11 meeting membership, waiting-room admission, role-specific publication policy, production language discovery, join-time listening language, conference consent, or public interpreter lifecycle status. Demo language configuration must not be treated as the product contract. Connect11 owns those shared token/interpreter additions; Phone11 owns membership, lobby, policies, consent receipts and UI. Deployment status remains separate from source status.
