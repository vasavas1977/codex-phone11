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
`preview-ios-siprix-daily-pilot`. Installation and handset acceptance pending.

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
