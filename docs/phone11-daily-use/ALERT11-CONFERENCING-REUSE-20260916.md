# Phone11 conferencing reuse decision

Source reviewed: vasavas1977/onetoall191-35f1a5e4, commit `3df7aee46b7081d2a674773149bfb3795c63e0ba`. Two independent read-only reviews covered media and authorization. No deployment, live calls, credentials, or installed Phone11 build changed.

## Decision

Reuse the existing conferencing integration and locate its working AI backend before building another interpreter or voice bot. Phone11 owns its product UI, meeting membership, company administration, and adapter. Connect11 owns discovery and coordination of the existing shared service. Do not wait for the entire Connect11 blueprint.

## Reuse map

| Source | Reuse in Phone11 |
| --- | --- |
| `src/realtime/types.ts` | Room interface and participant/media events; replace emergency roles |
| `src/realtime/providers/LiveKitProvider.ts` | Browser LiveKit room adapter |
| `src/components/realtime/ParticipantTile.tsx`, `ParticipantStrip.tsx` | Web participant presentation |
| `src/components/dispatch/LiveVideoModal.tsx` | Conference lifecycle and grid patterns; remove incident dependencies |
| `src/realtime/providers/CoreGuardLiveKitProvider.ts` | Existing service wire contract |
| `src/core-guard/transcription.ts` | Original/translated caption normalization and Thai deduplication |
| `src/realtime/useCoreGuardTranslatorSession.ts` | Translation sidecar lifecycle and cleanup; currently cloned caller audio |

The browser React components are not drop-in React Native components. Native iOS/Android integration and Siprix coexistence require separate validation; see LIVEKIT-SIPRIX-NATIVE-COMPATIBILITY-20260916.md.

## Existing external contract

`POST {coreGuardApiBaseUrl}/get-livekit-token` accepts `{room, identity, mode, sourceLang, targetLang}` and returns `{url, token}`. Modes are `video_only`, `conference`, and `translator`. Existing client sends a configured publishable key in apikey and Bearer headers. Language changes use participant attributes `targetLang` and `targetLanguage`; captions use LiveKit transcription events.

Do not reproduce the client-side authorization pattern blindly. Phone11 must authenticate membership, derive tenant-scoped room/participant identities and permissions on the server, and prevent alternate token endpoints from granting access to Phone11 rooms. The local Alert11 token function accepts client room/identity/role/permission and does not bind the minted room to the authorized incident. Tenant credential lookup alone is insufficient room authorization.

## Backend discovery required

This checkout contains consumer adapters, not the interpreter/translator worker or conversational voice-bot implementation. Its handle-livekit-call function is emergency incident/SMS integration, not the bot. User reports the production flow already works; this audit does not dispute that but cannot verify its deployed backend from this checkout.

Locate the worker repository and deployed revision; confirm dispatch names, room isolation, language-track mapping, ready/error/stop events, reconnect cleanup, and transcript ownership. Historical docs describe `tts-for-<listenerIdentity>` and `out-<language>` but these are not verified current runtime contracts. Avoid the emergency webhook's room/trunk/DID matching routes when provisioning Phone11 meetings.

## Integration order and evidence

1. Connect11 identifies the existing service and confirms its minimal contract; no duplicate worker implementation.
2. Phone11 implements an authenticated adapter with server-derived roles, isolated rooms, consent and private transcript handling.
3. Reuse browser media/caption code and adapt the minimal Phone11 meeting UI; retain existing signed calling app.
4. Test cross-tenant denial, unauthorized joins, role escalation, duplicate dispatch, leave/rejoin and language changes using synthetic data.
5. Separately prove two-device media, interpretation and bot behavior; then validate native audio ownership and signed-build delivery.

Current evidence is source inspection only. No claim of deployed Phone11 conferencing or handset acceptance is made.

## Connect11 discovery follow-up

Connect11 task reports read-only discovery of maintained worker source at `vasavas1977/core-guard-style-79ba133d`, branch `feat/realtime-interpreter`, revision `15a05b5aaa64`. Its `supabase/functions/get-livekit-token/index.ts` supports translator, voicebot, chatbot, conversation, conference, and video_only. Dispatch maps translator/voicebot/chatbot to `translator-1way`, conversation/conference to `twoway-translator`, and video_only to no worker. Connect11 reports both workers Running; Phone11 has not independently exercised them.

The existing endpoint is anonymous demo access and does not enforce company membership or provide reliable dispatch-ready/status/stop behavior. Phone11 must target the planned authenticated Connect11 facade. A facade alone does not provide isolation if the anonymous issuer can still mint Phone11 room tokens using shared project credentials. Activation requires alternate-issuer isolation or separate project credentials, as well as the versioned service contract and two-device proof.
