# Phone11 V92 old API proxy trigger

Route53 change was blocked by IAM, so this triggers a narrow old-host nginx proxy patch:

- current public `api.phone11.ai`: `43.209.112.208`
- live backend/SIP host: `43.210.122.111`
- goal: make old public API host proxy `api.phone11.ai` requests to live backend until Route53 permission is granted.
