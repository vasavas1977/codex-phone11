# Phone11 PSTN post-public-media-fix test capture

User placed a fresh PSTN test call after the Kamailio public media/backend route fix.

Capture target:
- identify latest call from extension 1001 to PSTN destination 020303988
- inspect Kamailio offer/answer SDP
- verify whether native answer SDP now advertises public media IP 43.210.122.111 instead of private 10.0.1.69
- inspect FreeSWITCH and RTPEngine evidence for no-audio/answered-call behavior
