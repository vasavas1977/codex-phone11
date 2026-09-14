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
