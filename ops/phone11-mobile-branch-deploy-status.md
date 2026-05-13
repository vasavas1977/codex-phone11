# Phone11 Mobile Branch Deploy Status

- Time UTC: 2026-05-13T08:51:51+00:00
- Workflow commit: 603f61fef72131520f7d60576594aec767fa5d2c
- Branch: codex/phone11-mobile-pjsip-20260506
- EC2 host: 43.209.112.208
- Pilot user id: 1
- Result: failure
- Exit code: 41

## Sanitized output
```text
ERROR: RDS master secret is not available; skipping deploy to avoid the known phone11ai DB password failure.
Grant phone11-github-deploy Secrets Manager read access, then rerun this workflow.

aws: [ERROR]: An error occurred (AccessDeniedException) when calling the List<redacted> operation: User: arn:aws:iam::326786006484:user/phone11-github-deploy is not authorized to perform: <redacted> because no identity-based policy allows the <redacted> action
```
