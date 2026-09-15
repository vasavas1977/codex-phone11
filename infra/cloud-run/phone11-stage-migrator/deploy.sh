#!/bin/sh
set -eu

EXPECTED_PROJECT=phone11-stage-20260914
EXPECTED_REGION=asia-southeast1
EXPECTED_JOB=phone11-stage-migrator
EXPECTED_ACCOUNT=phone11-stage-migrator@phone11-stage-20260914.iam.gserviceaccount.com
EXPECTED_INSTANCE=phone11-stage-20260914:asia-southeast1:phone11-stage-wake-pg
EXPECTED_AUTH_ORIGIN=https://phone11-android-staging-api-413228367517.asia-southeast1.run.app
IMAGE="${PHONE11_STAGE_MIGRATOR_IMAGE:-}"
ENV_FILE="${PHONE11_STAGE_MIGRATOR_ENV_FILE:-}"
fail(){ echo "Phone11 staging migrator deployment refused: $1" >&2; exit 2; }

[ "${PHONE11_STAGE_MIGRATOR_PROJECT:-}" = "$EXPECTED_PROJECT" ] || fail "exact project is required"
[ "${PHONE11_STAGE_MIGRATOR_SERVICE_ACCOUNT:-}" = "$EXPECTED_ACCOUNT" ] || fail "dedicated migrator identity is required"
echo "$IMAGE" | grep -Eq "^asia-southeast1-docker\.pkg\.dev/${EXPECTED_PROJECT}/phone11-staging/phone11-stage-migrator@sha256:[a-f0-9]{64}$" || fail "exact immutable staging image is required"
[ -f "$ENV_FILE" ] || fail "private environment file is required"
MODE="$(stat -f '%Lp' "$ENV_FILE" 2>/dev/null || stat -c '%a' "$ENV_FILE" 2>/dev/null || true)"
[ "$MODE" = 600 ] || fail "environment file mode must be 0600"

grep -Fqx 'PHONE11_STAGE_MIGRATOR_PROJECT=phone11-stage-20260914' "$ENV_FILE" || fail "project environment mismatch"
grep -Fqx 'PHONE11_CLOUDSQL_INSTANCE=phone11-stage-20260914:asia-southeast1:phone11-stage-wake-pg' "$ENV_FILE" || fail "instance environment mismatch"
grep -Fqx 'PG_HOST=/cloudsql/phone11-stage-20260914:asia-southeast1:phone11-stage-wake-pg' "$ENV_FILE" || fail "socket environment mismatch"
grep -Fqx 'PG_USER=phone11-stage-migrator@phone11-stage-20260914.iam' "$ENV_FILE" || fail "database user mismatch"
grep -Fqx 'PG_DATABASE=phone11_wake_stage' "$ENV_FILE" || fail "database mismatch"
grep -Fqx 'PG_SSL=disable' "$ENV_FILE" || fail "socket TLS mode mismatch"
grep -Fqx 'PHONE11_CLOUDSQL_IAM_DB_AUTH=1' "$ENV_FILE" || fail "IAM database auth is required"
grep -Fqx 'PHONE11_STAGE_PILOT_EXTENSION=7101' "$ENV_FILE" || fail "extension mismatch"
grep -Fqx 'PHONE11_STAGE_PILOT_DOMAIN=sip.stage.phone11.test' "$ENV_FILE" || fail "SIP domain mismatch"
grep -Eq '^PHONE11_STAGE_PILOT_EMAIL=[^[:space:]]+@[^[:space:]]+$' "$ENV_FILE" || fail "pilot email is required"
grep -Fqx "PHONE11_AUTH_BASE_URL=$EXPECTED_AUTH_ORIGIN" "$ENV_FILE" || fail "deterministic Android staging API auth origin is required"
grep -Eq '^PHONE11_STAGE_MIGRATOR_PHASE=(canonical-plan|canonical-apply|auth-plan|auth-apply|push-plan|push-apply|identity-apply|grants-plan|grants-apply)$' "$ENV_FILE" || fail "migration phase is invalid"
if grep -Eq '^[A-Za-z0-9_]*(SECRET|TOKEN|PASSWORD|DATABASE_URL|CONNECTION_STRING|GOOGLE_APPLICATION_CREDENTIALS)[A-Za-z0-9_]*=' "$ENV_FILE"; then fail "secrets, passwords, connection URLs and key paths are forbidden in the environment file"; fi

command -v gcloud >/dev/null 2>&1 || fail "gcloud is unavailable"
[ "$(gcloud config get-value project 2>/dev/null)" = "$EXPECTED_PROJECT" ] || fail "active gcloud project mismatch"
gcloud iam service-accounts describe "$EXPECTED_ACCOUNT" --project="$EXPECTED_PROJECT" --format='value(email)' 2>/dev/null | grep -Fqx "$EXPECTED_ACCOUNT" || fail "migrator service account is unavailable"
for ROLE in roles/cloudsql.client roles/cloudsql.instanceUser; do
  gcloud projects get-iam-policy "$EXPECTED_PROJECT" --flatten='bindings[].members' --filter="bindings.role=$ROLE AND bindings.members=serviceAccount:$EXPECTED_ACCOUNT" --format='value(bindings.role)' 2>/dev/null | grep -Fqx "$ROLE" || fail "migrator identity is missing $ROLE"
done
gcloud sql instances describe phone11-stage-wake-pg --project="$EXPECTED_PROJECT" --format='value(connectionName)' 2>/dev/null | grep -Fqx "$EXPECTED_INSTANCE" || fail "isolated Cloud SQL instance is unavailable"
gcloud sql databases describe phone11_wake_stage --instance=phone11-stage-wake-pg --project="$EXPECTED_PROJECT" --format='value(name)' 2>/dev/null | grep -Fqx phone11_wake_stage || fail "isolated database is unavailable"
gcloud sql users list --instance=phone11-stage-wake-pg --project="$EXPECTED_PROJECT" --filter='name=phone11-stage-migrator@phone11-stage-20260914.iam AND type=CLOUD_IAM_SERVICE_ACCOUNT' --format='value(name)' 2>/dev/null | grep -Fqx phone11-stage-migrator@phone11-stage-20260914.iam || fail "migrator IAM database user is unavailable"
for SECRET in phone11-stage-auth-secret phone11-stage-pilot-login-password; do
  gcloud secrets describe "$SECRET" --project="$EXPECTED_PROJECT" --format='value(name)' >/dev/null 2>&1 || fail "$SECRET is unavailable"
  gcloud secrets get-iam-policy "$SECRET" --project="$EXPECTED_PROJECT" --flatten='bindings[].members' --filter="bindings.role=roles/secretmanager.secretAccessor AND bindings.members=serviceAccount:$EXPECTED_ACCOUNT" --format='value(bindings.role)' 2>/dev/null | grep -Fqx roles/secretmanager.secretAccessor || fail "migrator lacks secret-specific access"
done

if [ "${1:-}" != --deploy ] && [ "${1:-}" != --execute ]; then
  echo "Phone11 staging migrator validated; no job deployed or executed."
  exit 0
fi
gcloud run jobs deploy "$EXPECTED_JOB" --project="$EXPECTED_PROJECT" --region="$EXPECTED_REGION" \
  --image="$IMAGE" --service-account="$EXPECTED_ACCOUNT" --env-vars-file="$ENV_FILE" \
  --set-cloudsql-instances="$EXPECTED_INSTANCE" \
  --set-secrets='/secrets/auth/secret=phone11-stage-auth-secret:latest,/secrets/login/password=phone11-stage-pilot-login-password:latest' \
  --task-timeout=10m --max-retries=0 --tasks=1 --parallelism=1 --quiet
[ "${1:-}" = --execute ] || exit 0
gcloud run jobs execute "$EXPECTED_JOB" --project="$EXPECTED_PROJECT" --region="$EXPECTED_REGION" --wait --quiet
