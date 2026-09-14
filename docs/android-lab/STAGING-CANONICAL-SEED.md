# Android staging canonical authority seed

Status: source-ready; cloud execution not yet performed.

`phone11-stage-migrator` is the keyless, connector-only operator path for the
empty `phone11_wake_stage` database. It is fixed to project
`phone11-stage-20260914`, the `phone11-stage-wake-pg` instance, IAM database
user `phone11-stage-migrator@phone11-stage-20260914.iam`, extension `7101` and
domain `sip.stage.phone11.test`. A wrong project, database, instance, IAM user,
extension or domain fails before database mutation.

The canonical phase creates eight minimal authority tables and exactly one
synthetic chain:

- organization `1`, tenant `1`, canonical non-admin user `1`;
- extension ID and number `7101`, with one primary `user_extensions` row;
- one active SIP account and one case-insensitively unique subscriber for
  `sip:7101@sip.stage.phone11.test`;
- an internally generated SIP password, stored only in the isolated database.

It creates no Better Auth identity or session, provider token, push device,
wake binding, call, DID, trunk or customer row. The operator email is normalized
and stored on the one synthetic canonical user. The login password stays in the
dedicated Secret Manager secret and reaches the existing auth-admin identity
command through a temporary mode-0600 file inside the job.

## Job phases

Use one phase per job revision, in this order:

1. `canonical-plan` performs only target and empty-schema inspection.
2. `canonical-apply` creates and proves the canonical chain in one transaction.
3. `auth-plan` prints the Better Auth migration plan.
4. `auth-apply` applies only the reviewed `phone11_auth_*` migration.
5. `push-plan` prints the two exact migration paths and SHA-256 digests.
6. `push-apply` applies `server/push/migration.sql`, then
   `server/push/wake-migration.sql` through the same migration identity.
7. `identity-apply` creates the one credential account and explicit identity
   mapping with `phone11-auth-admin`; it still creates no session.
8. `grants-plan`, then `grants-apply`, grants the Android API IAM database user
   read-only canonical/auth authority access plus DML only on Better Auth
   session/rate-limit and Android push/wake enrollment tables.

The login request from the installed app creates the Better Auth session. The
app then loads its exact 7101 assignment, registers its real FCM token and calls
`push.enrollWake`; only that authenticated flow creates the push and wake rows.

The environment file is mode 0600 and contains only non-secret exact settings:

```text
PHONE11_STAGE_MIGRATOR_PHASE=canonical-plan
PHONE11_STAGE_MIGRATOR_PROJECT=phone11-stage-20260914
PHONE11_CLOUDSQL_INSTANCE=phone11-stage-20260914:asia-southeast1:phone11-stage-wake-pg
PHONE11_CLOUDSQL_IAM_DB_AUTH=1
PG_HOST=/cloudsql/phone11-stage-20260914:asia-southeast1:phone11-stage-wake-pg
PG_USER=phone11-stage-migrator@phone11-stage-20260914.iam
PG_DATABASE=phone11_wake_stage
PG_SSL=disable
PHONE11_STAGE_PILOT_EXTENSION=7101
PHONE11_STAGE_PILOT_DOMAIN=sip.stage.phone11.test
PHONE11_STAGE_PILOT_EMAIL=<operator-approved-synthetic-email>
PHONE11_AUTH_BASE_URL=<exact-final-android-staging-api-origin>
```

Set these shell inputs to run the guarded deployment check:

```sh
export PHONE11_STAGE_MIGRATOR_PROJECT=phone11-stage-20260914
export PHONE11_STAGE_MIGRATOR_SERVICE_ACCOUNT=phone11-stage-migrator@phone11-stage-20260914.iam.gserviceaccount.com
export PHONE11_STAGE_MIGRATOR_IMAGE=asia-southeast1-docker.pkg.dev/phone11-stage-20260914/phone11-staging/phone11-stage-migrator@sha256:<verified-digest>
export PHONE11_STAGE_MIGRATOR_ENV_FILE=<absolute-mode-0600-environment-file>
infra/cloud-run/phone11-stage-migrator/deploy.sh
```

The default validates without deploying or running a job. Use `--deploy` to
create/update the job without running it. Use `--execute` only for the reviewed
phase. Both Secret Manager resources are mounted as files; no database password,
service-account key or connection URL is accepted.

The narrow Android staging API deliberately omits `cloudRecordings`. This seed
enables authenticated SIP configuration and wake enrollment only. Recording,
playback, transcript, summary and translation require a separately commissioned
authenticated recording-capable endpoint, its prerequisite/migration tables,
workspace membership and recording policy, plus the capture/storage/worker
runtime described in `docs/cloud-recording-capture-commissioning.md`.
