# Desktop in-meeting text chat — 1 October 2026

The desktop meeting toolbar now opens a Chat side panel for everyone currently
in the exact admitted room. It uses the existing isolated meeting preload and
SDK Room; the page remains script-free and exposes no Room, admission or token
bridge. The Chat panel replaces the participant roster in the existing side
column. Enter sends, Shift+Enter adds a line, Escape closes, and buttons and the
message log support keyboard focus. Text and SDK participant names render as
plain DOM text, without HTML, links or rich content execution.

## Transport and authorization

Pinned `livekit-client` 2.22.3 exposes public `LocalParticipant.publishData`,
`RoomEvent.DataReceived`, participant permissions and connection events. Its
[data packet documentation](https://docs.livekit.io/transport/data/packets/)
describes reliable room-wide packets and topics; the
[2.22.3 participant reference](https://docs.livekit.io/reference/client-sdk-js/classes/LocalParticipant.html)
and [room events](https://docs.livekit.io/reference/client-sdk-js/enums/RoomEvent.html)
match the installed signatures. Reliable packets are suitable for short live
messages, but they provide no persisted history or recipient read receipts.

The shared codec carries only `{ version: 1, id, text }` on topic
`phone11.meeting.chat.v1`. It accepts valid UTF-8, a UUID v4 message ID, at most
1,000 UTF-16 code units of nonempty text and at most 4,096 packet bytes. Unknown
fields, future wire versions, malformed encoding and disallowed controls fail
closed. There are no packet-supplied sender names, application user IDs, tenant
IDs or room IDs. The authorized SDK room supplies scope; the current SDK remote
participant supplies sender identity and name. Server-origin packets without
an identified member and stale/replaced participant objects are ignored.

Sending requires both the interactive admission profile and the current SDK
`canPublishData === true` permission immediately before publish. Listener
members can receive, but cannot send. Missing permission, revocation, connection
loss or cancellation closes sending; receive also requires current subscription
permission. The existing media lifecycle's `current()` guard and exact Room
reference reject old-session callbacks. Leave, disconnect, join failure and
window teardown detach chat handlers, clear messages and draft, and invalidate
late publish acknowledgements. No chat operation requests media permissions or
changes the existing iframe, IPC or SIP audio-ownership boundaries.

The panel retains the latest 200 messages in memory, with bounded duplicate
suppression and a 100-packet/10-second receive ceiling. A failed local send
keeps its draft; retrying the same text reuses the message ID. It never retries
automatically or treats SDK success as recipient delivery. Messages before
joining or during a disconnected interval are not recovered. There is no local
storage, server persistence, message-content logging or provider API change.

## Validation and remaining acceptance

### Desktop trusted profile photos — 2 October follow-up

Chat sender rows, the participant roster and camera-off video tiles now have
photos or initials. Active video remains the participant's image. The existing
`meetingAvatarTenant`/`meetingAvatarPerson` resolver requires the admitted local
SDK identity to match the actual signed-in owner and selected tenant, and the
remote SDK identity to match an authorized same-tenant directory member.
Unknown, opaque, ambiguous and cross-tenant identities stay initials. Names,
participant metadata and chat packets never supply a photo URL or user mapping.

The main process uses existing `chat.directory`, `profile.self` and versioned
`/api/profile/photo/{tenant}/{user}?v={version}` contracts with its current
session bearer. Only an exact server-relative descriptor can reach a fixed
same-origin fetch; redirects, external URLs and URL credentials are rejected.
One room-scoped ten-second deadline covers metadata headers/body (64 KiB) and
image headers/body (2 MiB). Cancellation aborts pending body reads. Main checks
raster format/dimensions before the platform decoder, then emits a resized PNG
of at most 96 pixels and 64 KiB. The
[Electron nativeImage API](https://www.electronjs.org/docs/latest/api/native-image)
documents portable PNG/JPEG decoding; any unsupported or invalid source image
(including animated WebP) falls back to initials.

The exact meeting frame, account revision and fresh main-owned room revision
gate photo IPC. The renderer retains at most 64 identities and 4 MiB of avatar
bytes for one current SDK Room. Room teardown clears that cache and draft;
account/room replacement, disconnected or replaced SDK participants, late
replies and late image callbacks cannot attach an old image. Image load failure
keeps initials. Credentials never cross photo IPC; only normalized raster bytes
do. The existing static page CSP remains unchanged, using its existing `data:`
image allowance. There is no disk cache, SDK metadata dependency or provider API.

Follow-up validation: full desktop suite plus authenticated-provider regressions,
125 passed and one opt-in Chromium history test skipped; focused
avatar/auth/provider/media/chat checks; desktop
TypeScript/build; and the network-blocked chat Chromium rehearsal. The latter
uses the production meeting-window IPC, Electron decoder, static page and
isolated preload with synthetic authenticated-provider and SDK fixtures. It
checks valid photos, unknown/invalid/failed image fallback, stale room/account
IPC, injected descriptor fields, keyboard behavior and clearing on leave.

Focused tests cover the real public SDK event signatures with fake room events:
sender spoofing, listener/missing/revoked permission, connection changes,
teardown and stale callbacks, uncertain-send retry, UTF-8/size/version rejection,
duplicate packets and bounded retention. Validation passed:

- Desktop controller and existing UI/media/permission focused suites: 27 tests.
- Shared codec suite: 16 tests.
- Desktop TypeScript check and `node scripts/build.mjs`.
- `node scripts/test-meeting-chat.mjs` from `desktop/app`: actual static HTML and
  isolated preload in Chromium, with synthetic SDK room/admission fixtures and
  all network blocked. It checks trusted SDK sender/plaintext rendering,
  Enter/Shift+Enter/composition/Escape focus, permission revocation and clearing
  on leave. This proves local UI behavior, not a real server or peer delivery.
- `git diff --check`.

This is desktop source only. Mobile/native chat, cross-client compatibility,
history, guest messaging, moderation and delivery/read receipts are outside
this slice. Independent source review and an authorized two-desktop test of
send/receive, listener behavior, reconnect and clearing on leave remain required.
No meeting was created, token minted, provider called, package installed,
public route changed or app deployed by this workstream.
