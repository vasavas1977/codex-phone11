# Phone11 IAM Grant RDS Modify Status

- Time UTC: 2026-05-17T04:20:06+00:00
- Branch: codex/phone11-mobile-pjsip-20260506
- Workflow commit: 13928bb4cd5dd08e82a57ee1fa4ee21179af2710
- IAM user: phone11-github-deploy
- RDS resource: arn:aws:rds:ap-southeast-7:326786006484:db:phone11ai-production-postgres
- Policy name: Phone11ScopedRdsModifyInstance
- Result: failure
- Exit code: 254

## Sanitized output
```text
=== Phone11 scoped IAM RDS modify grant ===
Applying scoped inline policy Phone11ScopedRdsModifyInstance to IAM user phone11-github-deploy.

aws: [ERROR]: An error occurred (AccessDenied) when calling the PutUserPolicy operation: User: arn:aws:iam::326786006484:user/phone11-github-deploy is not authorized to perform: iam:PutUserPolicy on resource: user phone11-github-deploy because no identity-based policy allows the iam:PutUserPolicy action
ERROR: AWS denied or failed the IAM policy update with status 254.
```
