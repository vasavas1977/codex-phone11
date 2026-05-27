# Phone11 V91 Route53 API DNS Status

- Time UTC: 2026-05-27T01:15:00+00:00
- Branch: codex/phone11-mobile-pjsip-20260506
- Workflow commit: b962aee7047afd9150de05e27e1c9dd9aa35ada0
- Hosted zone id: not-set
- Change id: not-set
- API record: api.phone11.ai
- Target live API IP: 43.210.122.111
- Old API IP observed by V90: 43.209.112.208
- Result: failure
- Exit code: 254

## Sanitized output
```text
=== Phone11 V91 Route53 API DNS alignment ===
Time: 2026-05-27T01:14:56+00:00
Record: api.phone11.ai. -> 43.210.122.111
Old API IP observed in V90: 43.209.112.208
--- Locate hosted zone ---

aws: [ERROR]: An error occurred (AccessDenied) when calling the ListHostedZonesByName operation: User: arn:aws:iam::326786006484:user/phone11-github-deploy is not authorized to perform: route53:ListHostedZonesByName because no identity-based policy allows the route53:ListHostedZonesByName action
```
