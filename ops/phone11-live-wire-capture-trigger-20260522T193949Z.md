# Phone11 live wire capture trigger

Purpose: capture the next iOS native PJSIP PSTN call after the public SDP patch.

Test focus:
- Caller extension: 1001
- PSTN destination: 020303988
- Symptom: caller app stays connecting/ringing even after callee answers
- Evidence needed: SIP 200 OK/ACK transition, rewritten answer SDP, RTP both directions

Requested capture: run long enough for a coordinated fresh call and redact secrets.
