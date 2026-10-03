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

## 2026-09-28 source-integration gate

The status above is historical live evidence from May, not validation of the
merged Phone11 candidate. The integrated source requires an explicit selected
tenant and an assigned, active extension with matching SIP account and Kamailio
subscriber credentials. `phone.ensurePilotConfig` is now a read of that
assignment: it does not allocate an extension, claim 1020 through
`OWNER_OPEN_ID`, or repair missing credentials. Before any release, an operator
must provision and verify the intended tenant/user mapping and registrar state
through a separately reviewed workflow. Admin password reset also fails closed
when the subscriber is missing; repair needs its own privileged, audited path.
