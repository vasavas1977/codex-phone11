# Phone11 answer-time media repair, 2026-09-14

Three incoming calls at 06:46–06:47 UTC reached Siprix Answer successfully.
FreeSWITCH received an RTP/SAVP answer after offering RTP/AVP, logged
`secure media is administratively disabled`, and sent BYE with
`INCOMPATIBLE_DESTINATION`. This was not a handset Answer failure.

The 07:00 call used temporary mandatory SRTP on the FreeSWITCH bridge. It
connected and ended with NORMAL_CLEARING after an application hangup request.
That call does not validate the final media configuration or handset audio.

The final configuration keeps the existing RTPengine security boundary:

- Handset answers to FreeSWITCH: explicit RTP/AVP, DTLS off, SDES off.
- FreeSWITCH answers to handset-originated re-INVITEs: explicit RTP/SAVP,
  DTLS off, SDES AES_CM_128_HMAC_SHA1_80.
- FreeSWITCH recording bridge restored to its original plain RTP configuration.

Source commits: `08dad77` and correction `eb93f11`. The initial source patch
incorrectly forced plain RTP in both reply directions; the second commit fixes
the reverse direction and replaces the synthetic reverse topology in the test.

Validation: isolated real Kamailio transactions and FreeSWITCH XML fixture
passed. Real RTPengine 9.4 negotiation passed initial and same-dialog reverse
offer/answer checks. The original reverse rule failed that real RTPengine test.
These tests validate SDP negotiation, not physical audio.

Live reverse-rule deployment completed at 09:26:57 UTC. The apply script checked
zero FreeSWITCH channels before editing and again before restarting Kamailio;
configuration parser passed. At 09:27:27 UTC Kamailio RPC uptime responded,
FreeSWITCH had zero channels, and API health returned build `71f4b683`.
No backend or iPhone build change was needed for this repair.

Live file: `/opt/phone11ai/cloudphone11/infra/configs/kamailio/kamailio.cfg`.
Backups are alongside it with suffixes `.pre-fs-answer-avp-20260914T070227Z`
and `.pre-reverse-srtp-20260914T092646Z`. They represent earlier configurations
with known media defects; do not treat a blind restore as a verified fallback.

Operational correction: an earlier multi-command attempt rejected its file
edit because two channels were active, but a separately chained restart still
ran. Subsequent deployment uses one guarded process so a failed idle check
prevents every downstream edit/restart. Do not claim the earlier restart was
performed with zero active calls.

Pending acceptance: fresh incoming call, two-way audio for 30 seconds, explicit
hangup, repeat locked-screen incoming, Hold/resume, then recording Start/Stop
and playback/summary/transcript. No successful physical call using the final
configuration has yet been confirmed.

## Follow-up: failed registration fork deletes the shared media session

The 09:33:07 call connected at the server and ended normally at 09:33:33 UTC.
The next three attempts failed at Answer. RTPengine received correctly configured
answer commands but returned `Unknown call-id`; in the last attempt, those
errors preceded FreeSWITCH's rejection. The reply callback was running.

Two contacts for the same handset instance were registered simultaneously, from
Wi-Fi and cellular. An isolated actual Kamailio 5.8.4 reproduction established:
a failed fork's 486 triggers the old reply-route `rtpengine_delete()`, whose NG
command contains Call-ID and From-tag but no To-tag. It removes the shared
session before another fork answers. A subsequent failed answer conversion
forwards raw secure SDP to FreeSWITCH, which rejects it. Named reply-route
`drop` does not suppress final responses in standard Kamailio 5.8.

The bounded repair skips per-branch deletion for transactions carrying
`PHONE11_WAKE_FLAG`. Whole-transaction failure still uses
`PHONE11_WAKE_MEDIA_CLEANUP`; validated BYE cleanup is unchanged. Caller CANCEL
still finishes through aggregate failure. Non-wake reply behavior is preserved.
The flag is set before transaction creation and restored by TM on reply workers.
The isolated regression verifies preservation when one fork fails and one
answers, and exactly one cleanup when all forks fail.

Live apply at 09:47:40 UTC changed only that negative-reply guard. Parser passed
and FreeSWITCH had zero channels before the edit and before restart. Backup:
`kamailio.cfg.pre-fork-cleanup-20260914T094740Z`. At 09:48:15 UTC all four
calling/backend containers were running, Kamailio RPC responded, and there were
zero active channels. Registration table was empty after restart; requested
the user reopen Phone11 before a supervised test.

Separately, API health now reports `8ec2923d7003be8bfe78eac2fd9d5a457c065fb3`
and backend container start time 09:44:09 UTC. This task did not deploy that
backend change. The parallel Android task has been notified to coordinate and
avoid further live changes during the handset test. Do not attribute this
backend state to the scoped Kamailio repair.

Physical acceptance of the fork fix remains pending; source and isolated
signaling tests do not prove two-way handset audio or daily-use readiness.

Source repair and regression commit: `e9e1389`. Five static checks passed;
the exact Kamailio 5.8.4 runtime preserved state across 32 asynchronous repeats.
Fork tests use an NG media stub to verify command lifetime and forwarding of
returned SDP; actual SDP translation was covered separately by the real
RTPengine fixture above. The parallel Android task confirmed its backend
deployment changes only allowlisted AI failure diagnostics in four recording
worker modules, with no credentials, migrations, or telephony configuration
changes, and has paused live mutations during this call test.

## Handset result and mute follow-up

The user confirmed both parties could hear on the later call, then reported
that in-app Mute seemed unavailable while recording. Physical diagnostics show
native call 202 connected at 10:29:23 UTC and an app End request at 10:30:14.
The server recording for `e38e0f93-c059-47a0-95e7-fc329c3180a3` is ready;
capture ran from 10:29:28.527 until 10:30:14.381 UTC. The server ended normally.
AI summary is failed and remains a separate follow-up. An earlier attempt
ended with ORIGINATOR_CANCEL at 10:29:16; do not count both attempts as passes.

The copied phone diagnostic trail contains no accepted Mute command or Mute
error during the confirmed call. Native review found no recording-dependent
mute override, and exact SDK header compilation plus 149 native assertions
passed. Server capture changes do not issue microphone controls to the app.
The user has been asked whether the button changes to Unmute, does nothing or
errors, or only the saved recording contains their voice. Root cause of this
new report is unconfirmed; no speculative mute implementation change applied.
This one successful call does not establish repeated locked-screen acceptance.
