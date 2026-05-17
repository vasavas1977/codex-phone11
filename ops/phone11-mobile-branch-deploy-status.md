# Phone11 Mobile Branch Deploy Status

- Time UTC: 2026-05-17T14:25:51+00:00
- Workflow commit: bf9dcf70dced3498fca7981dc3e8f91016d88c39
- Branch: codex/phone11-mobile-pjsip-20260506
- EC2 host: 43.209.112.208
- Pilot user id: 1
- Result: failure
- Exit code: 41

## Sanitized output
```text
ERROR: RDS master secret is not available; skipping deploy to avoid the known phone11ai DB password failure.
Set PHONE11_RDS_MASTER_SECRET_ARN or PHONE11_RDS_MASTER_SECRET_JSON, then rerun this workflow.
```
