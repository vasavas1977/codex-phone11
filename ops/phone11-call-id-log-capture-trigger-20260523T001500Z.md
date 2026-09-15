# Phone11 exact call log capture trigger

Triggered after user reported the controlled PSTN call test is done.

Target:
- extension: 1001
- destination: 020303988
- host: 43.210.122.111

Focus:
- fresh SIP Call-ID after the public SDP patch
- 200 OK / ACK behavior
- answer SDP c=IN IP4 address
- RTP/media evidence
- caller state staying connecting after callee answer
