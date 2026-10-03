# Recorded-call mute follow-up

The user confirmed two-way sound on the 10:29 UTC call, then reported that
tapping Mute during recording left the button unchanged with no message.
Saved handset diagnostics contain no accepted Mute command or Mute failure for
that call. This is not evidence of an SDK command succeeding but leaking sound.

Native review found the exact `callMuteMic:mute:` selector, state updated only
after success, and no recording-related mute override. Exact SDK compilation
and 149 native assertions passed. FreeSWITCH logs show no recording-triggered
renegotiation. The call ended normally and its cloud recording is ready.

Candidate changes:

- `e5a6580`: retain safe request, dispatch, rejection, acceptance and session-change
  stages. Early command preconditions previously rejected outside diagnostics.
  Existing authentication, call ownership and SDK behavior remain unchanged.
- `c549279` and `c9e401c`: place Mute/Hold/Speaker/Keypad outside the scrolling
  recording area. Recording status changes cannot move these controls or put
  their touch handling inside the scroll responder. Tap diagnostics use a
  bounded native identifier and no account/credential data.
- `8c2c6e9`: update the existing layout regression to verify all essential
  controls remain outside the scrolling call details.

102 focused tests passed. Independent review confirmed the fixed controls fit
a 320-point portrait layout while caller/recording/keypad content remains
scrollable. This is a tap-handling mitigation and diagnostic improvement;
the physical cause is not conclusively proven.

Initial signed workflow 34834300259 stopped before signing because an old test
expected Mute to scroll; all other initial native/database jobs passed. Updated
workflow 34834490638 builds exact source
`8c2c6e9fc0c4181114933b1f3ecba28d7a5d9f9f` with profile
`preview-ios-siprix-daily-pilot`. Workflow finished successfully, producing
EAS build `8c97c7c9-0130-45ef-9af2-cef8889c5e73`, Phone11 1.0.0 build 41.

Build 41 installed at 10:55:02 UTC; device app inventory confirms version 41.
Before installation FreeSWITCH had zero active channels. Bundle identity,
code signature, Siprix linkage, production APNs, background VoIP and the new
tap/command diagnostic markers in the compiled JS bundle all verified.
IPA SHA-256: `8ee8ab7620978267aced7ba11bb1d0fd15f9603d3c54b00ee84d053315faa7c2`.
Local artifact: `/tmp/phone11-mute-build41.ipa`; verification result:
`/tmp/phone11-mute-build41-verification.json`. No uninstall was performed.
The launch request was rejected because the iPhone was locked. User unlock/open
was requested; physical mute acceptance is still pending.

Final handset acceptance passed on build 41. Server call legs became active at
11:16:56 UTC and both ended by 11:17:52. The user confirmed Mute and Unmute
worked during recording. Persisted handset diagnostics independently show call
201 requested, dispatched and accepted Mute at 11:17:27.147-194 UTC, then
requested, dispatched and accepted Unmute at 11:17:32.743-791 UTC. There were
no rejected stages. FreeSWITCH returned to zero active channels. The newest
cloud record is `ready`, its capture stop is persisted, and summary status is
`ready`. This establishes the scoped recorded-call control path on this device;
it does not by itself prove every network, Bluetooth or cold-launch scenario.

Acceptance on the signed build: answer a call, start recording, tap Mute and
verify the caller cannot hear the Phone11 microphone, then Unmute and verify
speech returns. End explicitly. Inspect saved tap/command stages and recording
completion. Do not infer acoustic muting from the Unmute label alone.

The parallel Android task produced signed build 40 from source `8ec2923d`
but confirmed it was not installed. Coordinate one source/build on the iPhone;
do not install that older parallel artifact over this candidate.

## Separate summary follow-up

Offline review of the live `8ec2923d` backend tree passed 29 checks. Its safe
`provider_unavailable:generate` category collapses HTTP 500/503/504, so the exact
provider response status is still unknown. Preserve the four-module diagnostic
changes inherited from `a184ff0` before future backend deployment from this
branch. Current evidence does not support an arbitrary model switch.

Speaker 1/2 are voice groups, not established caller/callee identities. The
current named-speaker mapping needs separate attribution verification before
claiming names are reliable. No backend/provider change or generation retry was
made in this mute investigation.
