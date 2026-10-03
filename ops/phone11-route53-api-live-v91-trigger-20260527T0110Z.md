# Phone11 V91 Route53 API DNS trigger

Trigger `.github/workflows/phone11-route53-api-live-v91.yml` after the workflow exists on the branch.

Observed blocker from V90:
- live EC2: `43.210.122.111`
- public `api.phone11.ai`: resolved to old backend `43.209.112.208`

Expected change:
- Route53 A record `api.phone11.ai` -> `43.210.122.111`
