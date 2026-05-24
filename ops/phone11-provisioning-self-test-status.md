# Phone11 Provisioning Backend Self-Test Status

- Time UTC: 2026-05-24T16:37:58+00:00
- Branch: codex/phone11-mobile-pjsip-20260506
- Workflow commit: 159af3c02b1d704db73e782447921188f8fb193d
- EC2 host: 43.209.112.208
- EC2 instance: i-0cc8f248b08c5f2fb
- Pilot user id: 1
- Result: success
- Exit code: 0

## Sanitized output
```text
=== Phone11 provisioning backend self-test ===
Time: 2026-05-24T16:37:37+00:00
--- Locate EC2 ---
Found EC2 instance i-0cc8f248b08c5f2fb in ap-southeast-7b
--- Prepare temporary SSH access ---
{
    "RequestId": "3223b9db-65a4-469c-bcaf-66e96cbab650",
    "Success": true
}
--- Prepare remote live-backend test script ---
--- Run remote live-backend test ---
Warning: Permanently added '43.209.112.208' (ED25519) to the list of known hosts.
--- Runtime containers ---
cp11-backend phone11-backend-public:7b0c678eeff3893ce53c964f17a88d76327299ab Up 7 days (healthy)
--- Public and local health ---
{"ok":true,"timestamp":1779640677159,"build":"7b0c678eeff3893ce53c964f17a88d76327299ab","service":"phone11-backend"}
{"ok":true,"timestamp":1779640677168,"build":"7b0c678eeff3893ce53c964f17a88d76327299ab","service":"phone11-backend"}
--- Backend env keys, names only ---
DB_HOST=<set>
DB_NAME=<set>
DB_<redacted>
DB_USER=<set>
JWT_<redacted>
SIP_DOMAIN=<set>
--- Authenticated provisioning API self-test ---
DB env present: host=phone11ai-production-postgres.cdk2qyg0ire3.ap-southeast-7.rds.amazonaws.com, user=phone11ai, database=phone11ai, ssl=enabled, <redacted>
DB auth OK: current_user=phone11ai, database=phone11ai
Pilot user loaded: id=1, email=vasavas1977@gmail.com, role=admin, openId=<set>
auth.me OK: id=1, email=vasavas1977@gmail.com, openId=<set>
ensurePilotConfig OK: extension=1001, username=1001, domain=sip.phone11.ai, port=5060, transport=UDP, <redacted>
getConfig OK: extension=1001, username=1001, domain=sip.phone11.ai, port=5060, transport=UDP, <redacted>
Provisioning backend self-test succeeded.
```
