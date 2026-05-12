# Phone11 Mobile Branch Deploy Status

- Time UTC: 2026-05-12T19:56:42+00:00
- Workflow commit: 7d72832e68fd70dc8032be66f4ca99794b165e7b
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
