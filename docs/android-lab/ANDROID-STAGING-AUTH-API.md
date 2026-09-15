# Phone11 Android authenticated staging API

Status: source-ready; not deployed. Reviewed 2026-09-15.

This service is the narrow public HTTPS API needed by the commissioned Android
staging app. Cloud Run may accept an unauthenticated network request so a user
can sign in, but the application exposes only these surfaces:

- `/health`, `/api/mobile/config`, `/api/ready/auth`;
- the existing owned `/api/auth/me`, email sign-in and sign-out flow;
- `phone.getConfig` for the authenticated user's existing SIP assignment;
- `push.register`, `push.enrollWake` and `push.resolveWakeBinding`.

The tRPC router omits account creation, pilot provisioning, administrators,
PBX, IVR, recordings, chat, public push triggers, wake offers and lab scenario
actions. Registration accepts only Android, FCM and
`ai.phone11.mobile.staging`. Runtime schema creation is disabled.

## Isolated runtime contract

The deployment guard is fixed to:

| Item                | Exact value                                                          |
| ------------------- | -------------------------------------------------------------------- |
| Project             | `phone11-stage-20260914`                                             |
| Region              | `asia-southeast1`                                                    |
| Service             | `phone11-android-staging-api`                                        |
| Runtime identity    | `phone11-android-api@phone11-stage-20260914.iam.gserviceaccount.com` |
| Cloud SQL connector | `phone11-stage-20260914:asia-southeast1:phone11-stage-wake-pg`       |
| Database            | `phone11_wake_stage`                                                 |
| IAM database user   | `phone11-android-api@phone11-stage-20260914.iam`                     |
| Firebase app        | `1:413228367517:android:f41353883923fc15911e74`                      |
| Android package     | `ai.phone11.mobile.staging`                                          |
| SIP assignment      | `sip:7101@sip.stage.phone11.test`                                    |

The service obtains short-lived Cloud SQL IAM login tokens from its runtime
identity. It refuses `DATABASE_URL`, connection strings, database passwords,
service-account key files, schema bootstrap and the legacy owner fallback. The
Better Auth secret is injected from the dedicated Secret Manager resource
`phone11-stage-auth-secret`; it is never accepted in the non-secret env file.

## Remaining operator seed and access work

No resources were created and no deployment was performed by this source
change. Before a dry-run can pass, an operator must:

1. Create the dedicated runtime service account and Cloud SQL IAM database
   user, grant only `roles/cloudsql.client` and `roles/cloudsql.instanceUser`,
   and grant secret accessor on `phone11-stage-auth-secret` only.
2. Apply the reviewed canonical PBX, Better Auth, push and wake migrations with
   a separate migration identity. The runtime identity needs the SELECT and
   narrowly required session, rate-limit, push-device and wake-binding DML
   grants; it must not own the schema.
3. Use the guarded `phone11-stage-migrator` phases in
   `STAGING-CANONICAL-SEED.md` to seed exactly one synthetic active tenant,
   canonical user, extension, `user_extensions`, SIP account and subscriber for
   extension 7101. Run its separate existing auth-admin identity phase to create
   the credential account and explicit `phone11_auth_identity` mapping. Do not
   fabricate a session or wake binding.
4. Create a new random 32-byte-or-longer auth secret, build the dedicated image
   to the exact Artifact Registry path, resolve it to a digest, and provide a
   mode-0600 non-secret environment file containing the final Cloud Run origin.
5. Run `deploy.sh` without `--execute` first. Its default is validation only.
   Actual deployment remains a separate approved action.

After deployment, the APK still needs a rebuild with that final HTTPS API
origin. A real pilot result then requires email sign-in, owned SIP config load,
FCM registration, wake enrollment, process restart, and resolution of the same
public binding under the same live session.
