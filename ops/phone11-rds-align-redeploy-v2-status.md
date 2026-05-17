# Phone11 RDS Align and Redeploy V2 Status

- Time UTC: 2026-05-17T04:11:47+00:00
- Branch: codex/phone11-mobile-pjsip-20260506
- Workflow commit: 96716de36523dc7ffd13a6418a6cc152957f5f81
- EC2 host: 43.209.112.208
- RDS instance: phone11ai-production-postgres
- Runtime DB host: phone11ai-production-postgres.cdk2qyg0ire3.ap-southeast-7.rds.amazonaws.com
- Runtime DB region: ap-southeast-7
- Runtime DB name: phone11ai
- Runtime DB user: <db-user>
- Runtime env file: /opt/phone11ai/codex-phone11-deploy/.env
- Result: failure
- Exit code: 40

## Sanitized output
```text
=== Phone11 RDS align and backend redeploy V2 ===
Time: 2026-05-17T04:11:31+00:00
--- Locating EC2 instance ---
Found EC2 instance i-0cc8f248b08c5f2fb in ap-southeast-7b
--- Preparing temporary SSH access ---
EC2 Instance Connect key accepted.
--- Reading backend DB config from EC2 .env ---
Backend DB config loaded from /opt/phone11ai/codex-phone11-deploy/.env
DB host: phone11ai-production-postgres.cdk2qyg0ire3.ap-southeast-7.rds.amazonaws.com
DB region: ap-southeast-7
DB name: phone11ai
DB user: <db-user>
--- Finding RDS instance ---
RDS instance: phone11ai-production-postgres
--- Aligning RDS master password to backend env password ---
aws: [ERROR]: An error occurred (AccessDenied) when calling the ModifyDBInstance operation: User: arn:aws:iam::326786006484:user/phone11-github-deploy is not authorized to perform: rds:ModifyDBInstance on resource: arn:aws:rds:ap-southeast-7:326786006484:db:phone11ai-production-postgres because no identity-based policy allows the rds:ModifyDBInstance action
ERROR: RDS password alignment failed with status 254.
```
