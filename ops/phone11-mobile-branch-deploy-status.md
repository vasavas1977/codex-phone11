# Phone11 Mobile Branch Deploy Status

- Time UTC: 2026-09-14T11:40:19+00:00
- Workflow commit: 00d976712521f892f4ba9cace7d3843fbacd41eb
- Branch: codex/phone11-daily-use-20260910
- EC2 host: 43.210.122.111
- Pilot user id: 1
- Result: failure
- Exit code: 1

## Sanitized output
```text
=== Phone11 mobile branch backend deployment ===
Host: ip-10-0-1-69
Time: 2026-09-14T11:40:18+00:00
GitHub SHA: 00d976712521f892f4ba9cace7d3843fbacd41eb
Deploy checkout: /opt/phone11ai/codex-phone11-deploy
Live project path: /opt/phone11ai/cloudphone11
Pilot user id: 1
Using runtime env path: /opt/phone11ai/codex-phone11-deploy/.env
--- Aligning Postgres role password with runtime env ---
ALTER ROLE
Database role password aligned.
--- Validating compose config ---
error while interpolating services.backend.environment.PHONE11_TRUSTED_PROXY_CIDRS: required variable PHONE11_TRUSTED_PROXY_CIDRS is missing a value: Set exact trusted reverse-proxy addresses
```
