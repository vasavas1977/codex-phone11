# Build 17 incoming test — 11 September 2026

Build 17 was installed in place and independently verified in the paired iPhone inventory. App source is `b284243d86a14eb55225be0b61148184d4f969df`. These bounded direct echo calls targeted extension 3001 through the existing SIP proxy and bypassed the public-number carrier. The user confirmed readiness on the physical phone.

## First attempt: invalid audio and End acceptance

At 06:02:26.835 UTC the server received ringing. At 06:02:34.955 it received answer confirmation and entered the echo application. The test helper then ended the call at 06:02:35.055, only 100 ms later. The user reported ringing but no connection when answering. Independent server-log review found that signaling had connected, but the helper's early termination invalidated the audio and manual End checks.

The helper had started packet capture without the required capture permission. Capture exited immediately; the helper incorrectly used that process's lifetime as its observation timer. The correction checks capture startup before dialing, uses a separate 55-second observation window, and requires an accepted 45-second safety timer bound to the exact test call. The corrected helper was independently reviewed. No app or live routing change was made in response to this contaminated attempt.

## Corrected retry: received and ringing, no answer observed

The retry began at 06:05:32.408 UTC. Its private packet capture contains the phone's 180 Ringing response at 06:05:32.431. No successful INVITE answer response followed. The server canceled the unanswered call at 06:05:52.031 after the configured 20-second ringing timeout. The 200 response in this capture acknowledges CANCEL; it is not answer confirmation. Independent FreeSWITCH review agrees: NO_ANSWER, with no connected/echo event.

The call had ended before the 45-second safety guard; final cleanup confirmed the test call was inactive. No handset-initiated BYE was observed for this attempt. The user reported that Answer still did not connect on this second call. Clarification of which call screen was used remains pending. This is an unresolved handset failure, not a passed answer test.

## Acceptance status

Foreground incoming delivery and ringing have signaling evidence on build 17. The first attempt additionally confirms an answer reached the server, but clear echo and handset End are not accepted. The user reports attempting Answer, while signaling shows no successful answer. The exact failing UI/native step is not established. No further test call should be placed until the handset behavior is clarified and readiness is re-established. Public-number incoming, locked/background calling, long calls, and two-person chat remain separate gates.

## Subsequent diagnostics

The app's persisted diagnostics were retrieved privately from its own container. They contain registration and call-ended events, but no native Answer-request event for these attempts. Missing persisted events are not conclusive: the diagnostics persistence code permits overlapping writes, and the in-app answer path lacked explicit request/acceptance tracing. A later direct device screenshot showed Phone11's Phone tab with Ready to call and no active call. It does not establish which screen was visible while the second call rang.

Review also found that the current-call banner hid on any call-screen path, even when that screen referred to a previous call. A source fix and tests now keep new incoming calls reachable, including when a reused SDK ID appears on the wrong kind of call screen. Pending banner actions are bound to the original owner and durable call identity, so an old unresolved hang-up cannot disable a new call. This concrete navigation defect has not yet been causally linked to the reported second attempt.

## Follow-up source validation

The incoming screen now records an Answer handler invocation with bounded eligibility/pending booleans. Native Answer tracing distinguishes callback receipt, unknown/duplicate suppression and SDK command acceptance. Shared engine tracing records request and SDK acceptance without treating either as a connected call. No caller handles, credentials, native payloads or raw error text were added to these traces.

Diagnostic storage operations now run in order, merge newly arrived events during hydration, and invalidate stale work after clearing history. Call handlers remain nonblocking. Storage failures can still prevent persistence; missing logs must not override handset or server evidence.

All **112 focused tests** passed across incoming/active controls, route selection and banner actions, Siprix engine and native mapping, and diagnostic persistence. Independent review covered the navigation/action-token changes, engine tracing, and persistence races. These changes do not yet constitute a successful physical answer/audio/End test.
