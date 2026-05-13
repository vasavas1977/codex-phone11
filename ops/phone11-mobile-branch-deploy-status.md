# Phone11 Mobile Branch Deploy Status

- Time UTC: 2026-05-13T10:02:09+00:00
- Workflow commit: 573a38ac55f4f312d2b3a8f6224235fd03a6f5e4
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
