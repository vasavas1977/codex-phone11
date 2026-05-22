# Phone11 exact call log trigger

Purpose: collect server-side logs after the immediate capture window for the answered-call state problem.

Test focus:
- Caller extension: 1001
- PSTN destination: 020303988
- Symptom: caller app remains connecting/ringing even after callee answers
- Time window: around 2026-05-22T19:51Z through 19:56Z UTC
- Evidence needed: latest target Call-ID, INVITE/183/200/ACK/BYE flow, answer SDP, RTPEngine result, and backend/call-state logs.
