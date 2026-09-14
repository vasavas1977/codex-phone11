# Phone11 Android isolated staging wake database plan

Status: source-ready, cloud resource not created. Reviewed 2026-09-15.

## Required data boundary

A valid Android wake binding is not a standalone row. The repository proves all
of these records are current in the same PostgreSQL transaction:

- canonical `users`, `tenants`, `extensions`, `user_extensions`, `sip_accounts`
  and `subscriber` rows;
- Better Auth `phone11_auth_*` tables and a non-expired authenticated session;
- an enabled `phone11_auth_identity` mapping owned by that session;
- one Android/Firebase `phone11_push_devices` registration for the exact SIP
  assignment and staging package;
- one non-expired `phone11_wake_bindings` row linked to that push revision.

The ordered add-only migration path is therefore: canonical staging PBX schema,
Better Auth migration plus identity mapping, `server/push/migration.sql`, then
`server/push/wake-migration.sql`. The two push migrations intentionally do not
create or seed the authority tables they reference. No production dump or real
customer row is needed or allowed for this lab.

## Lowest-cost viable GCP shape

Create one dedicated Cloud SQL for PostgreSQL instance only after approval:

| Setting | Exact value |
| --- | --- |
| Project | `phone11-stage-20260914` |
| Instance | `phone11-stage-wake-pg` |
| Region | `asia-southeast1` |
| Edition/version | Enterprise, PostgreSQL 16 |
| Machine | `db-f1-micro` shared core |
| Availability | Zonal, no replica |
| Storage | 10 GiB HDD, no automatic increase |
| Backup/PITR | Disabled for the disposable test lab |
| Network | Public IP only as a connector transport; no authorized networks |
| Connection policy | Cloud SQL connector enforcement `REQUIRED` |
| Encryption | Cloud SQL managed connector TLS; instance SSL mode `ENCRYPTED_ONLY` |
| Authentication | Cloud SQL IAM database authentication; no stored database password |
| Database | `phone11_wake_stage` |
| Runtime DB user | `phone11-fcm-lab@phone11-stage-20260914.iam` |
| Deletion protection | Enabled while evidence is being collected |

The public IP avoids a Serverless VPC Access connector and private-service
networking charges. It is not directly usable because there are no authorized
networks and connector enforcement rejects direct database sessions. The
connector authenticates the runtime identity and encrypts the upstream path.

Google's current published price for `db-f1-micro` is USD 0.0105/hour. Singapore
HDD storage is USD 0.000123288/GiB-hour. At 730 hours, the fixed estimate is
about USD 8.56/month: USD 7.67 compute plus USD 0.90 for 10 GiB storage, before
tax, egress and other usage. Shared-core instances have no Cloud SQL SLA. Stop
or delete the instance after the bounded lab; stopping removes CPU charges but
storage continues to bill.

Official references:

- <https://cloud.google.com/sql/pricing>
- <https://cloud.google.com/sql/docs/postgres/connect-run>
- <https://cloud.google.com/sql/docs/postgres/connect-connectors>
- <https://cloud.google.com/sql/docs/postgres/iam-authentication>
- <https://cloud.google.com/sql/docs/postgres/configure-ssl-instance>

## Runtime connection contract

The Cloud Run deployment now requires these non-secret environment values:

```text
PHONE11_CLOUDSQL_IAM_DB_AUTH=1
PHONE11_CLOUDSQL_INSTANCE=phone11-stage-20260914:asia-southeast1:phone11-stage-wake-pg
PG_HOST=/cloudsql/phone11-stage-20260914:asia-southeast1:phone11-stage-wake-pg
PG_USER=phone11-fcm-lab@phone11-stage-20260914.iam
PG_DATABASE=phone11_wake_stage
PG_SSL=disable
```

`PG_SSL=disable` applies only to the local Unix socket. Cloud Run's managed
Cloud SQL connector provides IAM authorization, peer verification and TLS on
the connection from the connector to Cloud SQL. The application obtains a
short-lived IAM login token through Application Default Credentials for each
new pool connection; the token is never placed in an environment variable,
file or log.

Before redeployment, grant the runtime service account only
`roles/cloudsql.client` and `roles/cloudsql.instanceUser`, attach the exact
instance to Cloud Run, add it as a Cloud SQL IAM service-account database user,
and grant that PostgreSQL role only `CONNECT`, schema `USAGE` and `SELECT` on
`phone11_auth_session`, `phone11_auth_identity`, `users`, `tenants`,
`extensions`, `user_extensions`, `sip_accounts`, `phone11_push_devices` and
`phone11_wake_bindings`. The minimal scenario service only runs the sanitized
readiness query. Migration ownership and enrollment DML belong to separate
operator and authenticated-API identities and are not granted to this runtime.

## Commissioning sequence and proof gates

1. Create and verify the exact instance settings above. Do not import data.
2. Apply the canonical staging schema and Better Auth migration with a separate
   migration identity. Apply the two add-only push migrations in order.
3. Create exactly one synthetic staging tenant, user, extension, SIP account and
   subscriber. Create the user's credential identity through the existing auth
   admin tool; do not insert a fabricated session or wake binding.
4. Deploy an authenticated staging API endpoint for the Android app. The
   currently deployed minimal FCM service exposes only health and lab scenario
   routes and cannot log in, register a token, or enroll a binding.
5. Rebuild the staging APK with that authenticated API origin, sign in as the
   synthetic pilot user, and let the existing client call `push.register` then
   `push.enrollWake`. Confirm `push.resolveWakeBinding` returns the same public
   binding after a process restart.
6. Configure the bounded scenario service with that real binding ID and a fresh
   execution window. A sanitized readiness query must show Android, FCM, the
   staging package, exact SIP URI and an unexpired binding before any SIP trigger.

## Current blockers

- The Cloud SQL instance and `phone11_wake_stage` database do not exist.
- The existing `phone11-stage-database-url` contains a deliberate loopback
  placeholder. The next deployment refuses that secret and requires IAM login.
- The minimal Cloud Run image has no public authentication or tRPC enrollment
  surface. A database alone cannot create a real authenticated Android binding.
- The current APK points at `https://api.staging.phone11.invalid`; it must be
  rebuilt against the commissioned authenticated staging API.
- The real SIP driver is still local and unreachable from Cloud Run. Database
  commissioning removes only the binding-readiness blocker.
