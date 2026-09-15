# Phone11 Latest Provisioning Status

- Time UTC: 2026-05-12T12:35:48+00:00
- Workflow commit: 0d5b7e59647de5d2257b9820f8c9bdabcc229a91
- EC2 host: 43.210.122.111
- Pilot user id: 1
- Result: success
- Exit code: 0

## Sanitized output
```text
=== Phone11 pilot SIP provisioning ===
Host: ip-10-0-1-69
Time: 2026-05-12T12:35:42+00:00
Pilot user id: 1
Using runtime env path: /opt/phone11ai/codex-phone11-deploy/.env
--- Aligning Postgres role password with runtime env ---
ALTER ROLE
Database role password aligned.
--- Backend PG authentication and pilot provisioning ---
Backend PG auth OK as phone11ai on phone11ai
Found pilot extension 1020 for user 1 on sip.phone11.ai
--- Restarting backend after provisioning ---
{"ok":true,"timestamp":1778589348131}
Pilot provisioning is ready for the iPhone to sync.
```
