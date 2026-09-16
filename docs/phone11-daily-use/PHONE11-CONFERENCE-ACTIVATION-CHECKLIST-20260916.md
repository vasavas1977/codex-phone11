# Phone11 conference activation checklist

**Status: source contract and acceptance checklist only.** Phone11 meeting
capabilities are currently unavailable. This document does not prove a deployed
Connect11 facade, a CoreGuard worker, a recording service, a native media path,
or an installed handset build.

Phone11 will reuse the existing CoreGuard LiveKit, caption-normalization, and
interpreter/voice-bot services through an authenticated Connect11 facade. It
must not create a second translator or bot, call an anonymous CoreGuard token
endpoint from a handset, or repurpose the Alert11 incident issuer for Phone11
rooms.

## 1. Current Phone11 boundary

The mounted authenticated tRPC surface is `meetings.capabilities` and
`meetings.join({ meetingId })`. A caller supplies only a UUID `meetingId`.
Phone11 derives tenant, room, and participant identity after checking an active
tenant membership, active meeting membership, non-revocation, and a meeting
that has not ended. Application administrators have no bypass.

The current Phone11 authorization inputs are:

| Field | Exact value | Authority |
| --- | --- | --- |
| Meeting reference | Opaque Phone11 meeting ID after membership authorization | Phone11 server |
| Participant reference | Opaque, meeting-bound participant ID | Future Phone11 admission resolver |
| Join input | `{ "meetingId": "UUID" }` | Authenticated Phone11 client |
| Join result | `{ "url": "wss://…", "token": "…" }` | Phone11 server, after provider validation |

Connect11 derives the actual media room and LiveKit identity from these trusted
opaque values using its isolated namespace. Phone11 must not construct or
guess a room name or media identity.

The checked-in provider adapter is not wired into the router. It always reports
`available`, `video`, `interpretation`, `voiceBot`, and `recording` as `false`.
An authenticated join therefore returns the safe setup-pending failure rather
than a token. Keep this behaviour until every applicable item below is
evidenced.

## 2. Historical CoreGuard design note — not an activation contract

The detailed CoreGuard wire example below is retained only as historical design
context. It is superseded by
[`CONNECT11-PHONE11-ADAPTER-HANDOFF-20260916.md`](CONNECT11-PHONE11-ADAPTER-HANDOFF-20260916.md),
which is the canonical `phone11-conference.v1` contract. Do **not** implement
the old `/get-livekit-token` endpoint, `conf-p11-*` coordinates, or a direct
Phone11-to-CoreGuard connection. The current source adapter remains unmounted.

### Retired predecessor wire shape

Phone11 may call a Connect11 facade only from its server. The facade must be a
versioned, authenticated service boundary around the existing CoreGuard
implementation; a mobile publishable key, a direct browser call, or a shared
anonymous issuer does not meet this contract.

### Target `phone11-conference.v1` facade contract

This is the required Connect11 dependency for the early Phone11 conference
integration. It is a target contract, not evidence that the endpoint or its
workers are deployed. Both calls are server-to-server (S2S), authenticated with
the `realtime:conference:status` or `realtime:conference:join` scope shown
below. Phone11 clients never receive that credential and never call these
routes directly.

```text
GET /realtime/conference/capabilities
S2S scope: realtime:conference:status
Response:
{
  "contract_version": "phone11-conference.v1",
  "available": false,
  "unavailable_reasons": ["…"],
  "supported_listen_languages": ["th"],
  "grant_profiles": ["interactive", "listener"],
  "interpreter": {
    "start": "join_dispatch",
    "stop": "unsupported",
    "status": "arrival_evidence",
    "current_presence": false
  },
  "worker_media": {
    "listen_attribute": "lang",
    "audio_track_prefix": "out-"
  }
}

POST /realtime/conference/join
S2S scope: realtime:conference:join
Strict body:
{
  "meeting_id": "UUID",
  "participant_id": "p11-t<tenantId>-u<userId>",
  "grant_profile": "interactive | listener",
  "listen_language": "BCP-47 language tag",
  "consent_assertion": {
    "accepted": true,
    "meeting_id": "UUID",
    "participant_id": "p11-t<tenantId>-u<userId>",
    "purpose": "live_interpretation",
    "policy_version": "string",
    "asserted_at": "RFC 3339 timestamp"
  }
}
Success:
{
  "rtc_url": "wss://approved-media-endpoint",
  "access_token": "signed-jwt",
  "expires_at": "RFC 3339 timestamp",
  "arrival_observation_id": "opaque ID",
  "arrival_state": "pending | arrived | failed"
}

GET /realtime/conference/arrivals/<arrival_observation_id>
S2S scope: realtime:conference:status
Response: the current arrival evidence for that opaque observation ID.
```

Phone11 derives the meeting ID, participant ID, tenant membership, grant
profile eligibility, language-policy eligibility, and consent policy from
trusted server records. The facade derives all authorization scope from its S2S
principal and trusted Phone11 values; it must reject extra fields, client
identity/tenant/room/role injection, inconsistent nested consent identifiers,
an unsupported grant profile or language, and any request whose target meeting
is disabled.

`consent_assertion` is an admission input, not a replay-proof durable consent
receipt. Recording remains disabled until a separate durable receipt establishes
the required announcement, consent, recording-session ID, and audit evidence.
Likewise, `arrival_state: "pending"` is not interpreter readiness: Phone11 must
query the arrival status and wait for the facade's arrival evidence before
showing interpreted audio as live.

The facade issues a fixed five-minute grant only when capability is enabled,
issuer isolation is proven, capacity is available, interpreter dispatch is
accepted, and the required arrival observation exists. It returns no token when
any condition fails. The current early interpreter contract has no stop action
(`"stop": "unsupported"`), so Phone11 must state that limit and must not show
a Stop interpreter control.

Use the returned worker-media names exactly: a participant's listening language
is the `lang` attribute and translated audio tracks use the `out-` prefix. The
new Phone11 room namespace must never begin with `translator-`, `conv-`, or
`conf-`; it is derived and reserved by the Connect11 facade and remains opaque
to the client. The current unwired source adapter's `conf-p11-t<tenantId>-<meetingId>`
coordinate is therefore not the target facade namespace and must not be carried
into the new contract. Do not silently rewrite a service or worker track
identity into a human display name.

### Minimum video admission contract

For the initial video-only activation, the Phone11 server-to-facade exchange is
the existing CoreGuard wire shape:

```text
POST {connect11AuthenticatedFacadeBaseUrl}/get-livekit-token
Headers:
  content-type: application/json
  apikey: <server-only Connect11 credential>
  authorization: Bearer <same server-only credential>
Body:
  {
    "room": "conf-p11-t<tenantId>-<meetingId>",
    "identity": "p11-t<tenantId>-u<userId>",
    "mode": "video_only",
    "sourceLang": "th",
    "targetLang": "th"
  }
Response:
  { "url": "wss://approved-media-endpoint", "token": "signed-jwt" }
```

Phone11 must reject the response unless all of the following are true:

- The facade URL is HTTPS and the media URL is the configured WSS endpoint;
  neither may carry user information, query parameters, or fragments.
- The JWT verifies with the configured issuer and signing secret, has the
  canonical subject, expires within five minutes, and grants join only to the
  canonical room.
- The token grants no room administration, room creation/listing/recording,
  SIP, or agent permission.
- The facade returns no credentials, provider payload, or token in an error;
  Phone11 does not log or persist the token.
- A separate Connect11 isolation review proves that *every* issuer sharing the
  LiveKit project rejects arbitrary access to `conf-p11-*` rooms. A room prefix
  alone is insufficient.

The facade must rate-limit admission and support immediate eviction/revocation
of a connected participant. Phone11 rechecks membership on every join, but a
short-lived token can otherwise remain valid for up to five minutes after
membership removal.

### Required extension before conferencing, interpretation, or a voice bot

Do not enable any of these capabilities simply because the underlying CoreGuard
service has modes named `conference`, `translator`, or `voicebot`. The
authenticated facade must publish a reviewed versioned contract that, for the
canonical room and identity, defines all of these facts before Phone11 requests
the mode:

| Capability | Connect11 facade must authoritatively return or enforce |
| --- | --- |
| Conference | Meeting lifecycle, authorized membership and host/cohost role, admitted participant list/revision, join/leave and room-end events, and the publication/subscription policy for each participant. |
| Interpreter | Permitted source and listening languages, whether the listener is hearing original or translated audio, worker dispatch identity, `starting`/`ready`/`failed`/`stopped` events, room cleanup, and who owns the original and translated captions. |
| Voice bot | Explicit meeting policy/host approval, bot service identity, dispatch identity, readiness/error/stop events, audio-track permissions, transcript ownership, and a reliable stop operation. |
| Recording | Whether recording is allowed, consent/announcement receipt, immutable recording session ID, start/stop result, access scope, retention/deletion policy, and audit event IDs. |

Each response/event must include a contract version, immutable meeting ID,
canonical participant or service identity, monotonically increasing room or
membership revision, and an opaque operation ID where an operation is
requested. It must never infer a Phone11 tenant, user, host, or policy from an
email domain, display name, client-supplied room, or client-supplied role.

If Connect11 cannot provide one of these facts, Phone11 keeps its matching
capability `false` and shows it as unavailable. Phone11 has no source evidence
that the facade, interpreter worker, or voice-bot worker satisfies this extended
contract today.

## 3. User-visible states

The UI must render the actual state; controls are not evidence of an enabled
service.

| State | What the person sees | Required behaviour |
| --- | --- | --- |
| Unavailable / setup pending | “Meetings are not available for this workspace yet.” | No join token, interpreter, bot, or recording controls. Keep ordinary Phone11 calling available. |
| Pre-join / joining | “Joining meeting…” with the selected mic and camera choices. | Microphone and camera start off unless the person explicitly enabled each one. Cancel stops tracks and invalidates pending callbacks. |
| Connected | Participant roster, mute/camera state, and actual connected media. | Render names only from the authenticated meeting roster; never decorate an audio conference as a video grid. |
| Reconnecting | “Reconnecting…” | Keep the state distinct from a completed leave; reconcile a fresh room revision after recovery. |
| Disconnected | “Meeting disconnected. Rejoin to continue.” | Clear participants and active controls. Do not resurrect a stale room after a delayed SDK completion. |
| Error | “Meeting operation failed. Check permissions and connection, then retry.” | Do not show SDK errors, token text, endpoints, or provider payloads. |
| SIP interruption | “Meeting paused for phone call” followed by an explicit Resume action. | Stop meeting playback, microphone, camera, and sharing before Phone11 takes SIP media. Do not automatically resume after the call. A failed pause blocks SIP media and surfaces a recoverable failure. |
| Interpreter or bot unavailable / starting / failed | State supplied by the facade, for example “Interpreter is starting” or “Interpreter unavailable”. | No translated-audio, bot, or “live” claim before a matching `ready` event. Preserve ordinary meeting media when policy permits; show the feature-specific error. |
| Recording pending / active / failed / stopped | A visible recording notice and state from the recording receipt. | `active` appears only after a durable start receipt. If a required notice or consent cannot be confirmed, remain off. |

Language selection is allowed only if the selected native/LiveKit adapter exposes
the configured participant-attribute capability. Validate language tags before
writing them. An unsupported adapter stays visibly unsupported; it must not
pretend that a JavaScript-only update added native media support.

## 4. Privacy, recording, and speaker names

1. Meeting policy is trusted server data. Resolve the tenant, group, user, and
   meeting layers together, preserve restrictive locks in either boolean
   direction, and reject missing/cross-tenant/conflicting policy records. The
   relevant settings are guest access, waiting room, publishing audio/video and
   screen share, interpreter use, and recording.
2. Recording begins only after the facade returns the required consent and
   announcement receipt plus a durable recording-session ID. Announce capture
   to every participant required by workspace policy, including later joiners.
   A client click or a successful transport request alone is not a recording.
3. Keep recordings, captions, transcripts, summaries, exports, and corrections
   tenant- and meeting-scoped. Use authorized, short-lived access routes;
   conference membership does not by itself grant access to a person's private
   notes, tasks, or summary. Record audit events for policy changes, admission,
   recording, export/share, deletion, name correction, moderation, and admin
   access before customer activation.
4. A live CoreGuard caption may contain `participantIdentity`, or it may have
   no identity. Resolve a visible name only from the authenticated roster for
   that exact canonical identity. If that proof is absent, display a neutral
   speaker label. Never derive a name or role from diarization order, voice,
   telephone number, caller-ID, direction, an unauthenticated SIP display
   name, or a model's speaker guess.
5. Store and display original and translated captions as distinct linked text.
   Keep an identical translation only once. The UI must not turn an interpreter
   or voice-bot service identity into a human participant name.
6. The existing two-channel Phone11 call-recording identity rule remains
   separate: retain `Speaker 1`/`Speaker 2` unless the anchored channel,
   peer/signal-bond evidence, left/right mapping, and record-swap evidence
   agree. A meeting recording needs its own immutable roster/participant proof;
   it cannot borrow PBX channel evidence or guess a speaker from captions.

## 5. Two-device activation acceptance

Run these tests only with synthetic meeting content and authorized test users.
Use two real devices with compatible signed Phone11 builds; prove iOS and
Android separately before claiming cross-platform support. A browser preview,
unit suite, worker health signal, or a token response is not two-device media
acceptance.

| Test | Required observation | Pass condition |
| --- | --- | --- |
| Admission and isolation | User A and User B, in the same authorized test meeting, join with server-derived identities. A user from another tenant and a revoked user attempt the same meeting. | A and B receive only their room grants and can join. Cross-tenant and revoked attempts receive no grant or room information. Revoke B while connected and verify facade eviction or the documented short-token expiry/rejoin boundary. |
| Media and controls | Both devices explicitly enable microphone; each then enables/disables camera and changes between real speaker, earpiece, and Bluetooth routes where available. | Each person hears the other in both directions and sees a real remote stream only while the sender publishes one. Mute/camera indicators match the remote observation. No synthetic participant or fake success appears. |
| Network and lifecycle | Background/foreground one device, switch Wi-Fi/cellular where available, leave/rejoin, and trigger a normal incoming SIP call while the meeting is active. | The UI progresses through reconnect/disconnect truthfully, reconciles the roster, stops all meeting media before SIP takes ownership, and requires explicit resume with mic/camera still off. Ordinary inbound/outbound Phone11 calling remains sound. |
| Interpreter | A speaks a short Thai phrase and B selects an approved different listening language. Repeat with the worker unavailable. | Do not report interpretation until the facade reports `ready`. The original and translated captions remain linked, do not duplicate identical text, and have only roster-proven speaker labels. Worker failure is visible and does not become a false success. |
| Voice bot | A host enables the bot only when the facade policy permits it, then stops it. Repeat with dispatch failure. | Bot identity, ready/error/stop state, and any transcript ownership match the facade contract. A failed dispatch produces no bot audio or “bot active” state. |
| Recording and privacy | Start, stop, and attempt to access a synthetic recording with an authorized participant, a different tenant, and a former member. Exercise a late joiner when the policy requires an announcement. | Active recording follows a durable receipt and visible notice. Authorized access follows the stated scope; cross-tenant/former-member access fails. The audit trail, deletion/retention behavior, and name fallback are reviewed without exposing credentials or private contact labels. |

## 6. Activation decision

Keep all meeting capabilities unavailable until the reviewer has recorded:

- the Connect11 facade URL, contract version, deployed revision, and isolated
  token-issuer review;
- the authorized membership/migration path, rate limit, revocation/eviction
  behaviour, and policy-resolution evidence;
- the interpreter/voice-bot dispatch, lifecycle, transcript-ownership, and
  cleanup evidence for each advertised capability;
- the recording consent, receipt, access, retention, deletion, and audit
  evidence; and
- the completed two-device results, including native platform, signed build
  identifiers, network/media observations, and ordinary Phone11 call
  regression result.

Only then may the corresponding capability change from `false`. Enable video,
conference, interpretation, voice bot, and recording independently; evidence
for one does not activate the others.
