# Phone11 call log capture trigger

Purpose: collect latest Kamailio, RTPEngine, FreeSWITCH, and backend logs for a fresh answered PSTN call after the public SDP patch.

Test focus:
- Caller extension: 1001
- PSTN destination: 020303988
- Symptom: caller app remains connecting/ringing after callee answers
- Evidence needed: latest Call-ID, INVITE/183/200/ACK/BYE flow, before/after answer SDP, RTP engine result, backend state logs.
