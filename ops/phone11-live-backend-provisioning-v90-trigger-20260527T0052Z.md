# Phone11 V90 live backend provisioning trigger

Created to run `.github/workflows/phone11-live-backend-provisioning-v90.yml` against live EC2 host `43.210.122.111` after the workflow file exists on the branch.

Expected proof:
- redeploy current branch commit to the live backend
- compare provisioning `phone.getConfig` SIP password fingerprint with the live `subscriber.password` fingerprint
- commit sanitized result to `ops/phone11-live-backend-provisioning-v90-status.md`
