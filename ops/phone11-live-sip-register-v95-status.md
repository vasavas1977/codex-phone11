# Phone11 V95 Live SIP REGISTER Credential Self-Test Status

- Time UTC: 2026-05-27T01:32:48+00:00
- Branch: codex/phone11-mobile-pjsip-20260506
- Workflow commit: 1a20330b05599cde5df52a4230706f6a86432c94
- Live EC2 host: 43.210.122.111
- Live EC2 instance: i-0851dd1ea1cfeef71
- Extension: 1001
- SIP domain: sip.phone11.ai
- Latest app SIP password fingerprint from user log: 2b847b074c0ba53a
- Result: success
- Exit code: 0

## Sanitized output
```text
=== Phone11 V95 live SIP REGISTER credential self-test ===
Live EC2 host: 43.210.122.111
Extension: 1001
SIP domain: sip.phone11.ai
--- Locate live EC2 ---
Found live EC2 instance i-0851dd1ea1cfeef71 in ap-southeast-7a private=10.0.1.69
--- Prepare temporary SSH access ---
{
    "RequestId": "181cb086-bcc9-4070-88bf-28e951552e8a",
    "Success": true
}
--- Prepare remote REGISTER self-test script ---
--- Run remote REGISTER self-test on live EC2 ---
Warning: Permanently added '43.210.122.111' (ED25519) to the list of known hosts.
--- SIP listener evidence ---
udp   UNCONN 0      0           10.0.1.69:5060       0.0.0.0:*                                      
udp   UNCONN 0      0               [::1]:5060          [::]:*                                      
tcp   LISTEN 0      1024        10.0.1.69:5060       0.0.0.0:*                                      
tcp   LISTEN 0      64              [::1]:5060          [::]:*                                      
cp11-backend cloudphone11-prod-backend Up 2 minutes (healthy)
p11-kamailio ghcr.io/kamailio/kamailio:5.8.4-bookworm Up 2 days
--- Credential and REGISTER test ---
REGISTER_CREDENTIAL_SOURCE=subscriber username=1001 domain=sip.phone11.ai fp=6ed481a55a18a945 len=36
REGISTER_FIRST_RESPONSE=SIP/2.0 401 Unauthorized
REGISTER_SECOND_RESPONSE=SIP/2.0 200 OK
V95_SIP_REGISTER_200_OK=true username=1001 domain=sip.phone11.ai target=10.0.1.69:5060 credentialFp=6ed481a55a18a945
V95 live SIP REGISTER credential self-test succeeded.
```
