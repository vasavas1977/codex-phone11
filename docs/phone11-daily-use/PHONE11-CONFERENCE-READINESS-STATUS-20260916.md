# Phone11 conference readiness status

**Status: Phone11 source foundation complete; live conferencing disabled.**

This is the operational status record for Phone11 meetings. It separates code
that is complete in this repository from work that must be proven by Connect11
and on signed devices. A passing source test, local preview, or UI screen is
not permission to enable conferencing.

## What Phone11 has completed in source

| Area | Completed boundary | Current behaviour |
| --- | --- | --- |
| Client UX | Team/Meetings entry, pre-join, room states, browser-session abstraction, and SIP-media ownership coordinator | The app explains that meetings are unavailable; it does not create a room or start camera/microphone media. |
| Admission | Tenant-scoped room/member/consent schema and read-only resolver | A future composition root can derive only opaque, server-owned meeting and participant references after active membership, admitted lobby state, non-revocation, and a matching unwithdrawn consent receipt. |
| Connect11 contract | Strict `phone11-conference.v1` S2S facade and an injected provider bridge | The bridge can only consume resolver output. It does not derive rooms, identities, language, role, or consent from a device request. |
| Safety | Short token validation, version/language/profile checks, no client-readable credential path, and generic errors | Invalid admission input is rejected before any Connect11 request. Tokens are neither logged nor persisted. |
| Regression coverage | Admission, facade, bridge, policy, browser-session, transcription, and SIP/meeting ownership tests | These are source checks only; no meeting media has been enabled. |

The mounted `meetings` router is intentionally unchanged: all capabilities are
`false` and its normal join route has no provider. Do not add an environment
flag to bypass this state.

## Remaining gates and owners

| Gate | Owner | Evidence required before enabling the matching capability |
| --- | --- | --- |
| Deploy the facade | Connect11 | Exact deployed revision and HTTPS facade URL, scoped server-only credentials, and the published `phone11-conference.v1` response. |
| Isolate media issuance | Connect11 / platform security | Evidence that every alternate, legacy, public/demo, and external issuer rejects the derived Phone11 room, or proof of a dedicated media project/credentials. |
| Run meeting workers | Connect11 | Production registration for the conference dispatcher, arrival evidence storage, an approved language allowlist, and expected `out-<language>` media tracks. Arrival evidence alone is not current presence or audible translation. |
| Apply Phone11 migration | Phone11 operations | Reviewed migration application, active tenant/member lifecycle writes, consent receipts, revocation behavior, audit retention, and database backup/rollback evidence. |
| Compose backend | Phone11 | A reviewed server-only composition root that injects the admission resolver and facade bridge only after the prior gates are recorded. The default router must stay disabled until this review. |
| Prove native coexistence | Phone11 mobile | A clean signed iOS and Android build proving the selected LiveKit approach does not conflict with Siprix/WebRTC, CallKit, audio focus, camera, or Bluetooth. |
| Prove customer workflow | Phone11 QA + Connect11 | Authorized two-device and multi-participant tests: join, audio/video, leave/rejoin, reconnect, SIP interruption, route changes, caption/translation state, consent, and ordinary Phone11-call regression. |
| Enable optional services | Feature owners | Separate lifecycle and privacy evidence for interpreter, voice bot, captions, recording, summaries, export, retention, and deletion. They must not be enabled as a single bundle. |

## Activation order

1. Connect11 records deployment and issuer-isolation evidence.
2. Phone11 operations applies and verifies the admission migration without
   exposing a client route.
3. Phone11 wires the existing resolver and facade bridge in a reviewed backend
   composition change, with capabilities still fail-closed on an error.
4. Build a signed native candidate and complete the device matrix, including
   normal SIP-call regression.
5. Enable **video meeting admission** for a limited authorized workspace only
   after the evidence is reviewed.
6. Enable interpreter, bot, captions, and recording one at a time only when
   their individual lifecycle and privacy contracts are proven.

## Canonical references

Read these in order when preparing the next change:

1. [Connect11–Phone11 adapter handoff](CONNECT11-PHONE11-ADAPTER-HANDOFF-20260916.md)
   for the versioned S2S contract and external deployment gates.
2. [LiveKit and Siprix native compatibility](LIVEKIT-SIPRIX-NATIVE-COMPATIBILITY-20260916.md)
   for the in-process native-media decision.
3. [Video and conference test matrix](VIDEO-CONFERENCE-TEST-MATRIX-20260916.md)
   for signed-device acceptance.
4. [Conference activation checklist](PHONE11-CONFERENCE-ACTIVATION-CHECKLIST-20260916.md)
   for detailed privacy, policy, and user-state requirements.

The older CoreGuard `/get-livekit-token` shape and `conf-p11-*` room naming are
retired design material. Phone11 must use only Connect11's derived, opaque
namespace once the documented gates have passed.
