# Phone11 Mobile Branch Deploy Status

- Time UTC: 2026-05-17T04:06:36+00:00
- Workflow commit: d3bd725c34f982052da1ac00dd1581e8981cefe8
- Branch: codex/phone11-mobile-pjsip-20260506
- EC2 host: 43.209.112.208
- Pilot user id: 1
- Runtime DB host: phone11ai-production-postgres.cdk2qyg0ire3.ap-southeast-7.rds.amazonaws.com
- Runtime DB region: ap-southeast-7
- Result: failure
- Exit code: 41

## Sanitized output
```text
ERROR: RDS master secret is not available; skipping deploy to avoid the known phone11ai DB password failure.
Set PHONE11_RDS_MASTER_SECRET_ARN or PHONE11_RDS_MASTER_SECRET_JSON, then rerun this workflow.
```
