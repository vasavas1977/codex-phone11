#!/bin/sh
set -eu

EXPECTED_PROJECT="phone11-stage-20260914"
EXPECTED_REGION="asia-southeast1"
EXPECTED_SERVICE="phone11-android-staging-api"
EXPECTED_ACCOUNT="phone11-android-api@phone11-stage-20260914.iam.gserviceaccount.com"
EXPECTED_DB_USER="phone11-android-api@phone11-stage-20260914.iam"
EXPECTED_INSTANCE="phone11-stage-20260914:asia-southeast1:phone11-stage-wake-pg"
EXPECTED_DATABASE="phone11_wake_stage"
TARGET_PROJECT="${PHONE11_ANDROID_API_CLOUDRUN_PROJECT:-}"
TARGET_IMAGE="${PHONE11_ANDROID_API_CLOUDRUN_IMAGE:-}"
TARGET_ACCOUNT="${PHONE11_ANDROID_API_CLOUDRUN_SERVICE_ACCOUNT:-}"
ENV_FILE="${PHONE11_ANDROID_API_CLOUDRUN_ENV_FILE:-}"

fail(){ echo "Android staging API deployment refused: $1" >&2; exit 2; }
[ "$TARGET_PROJECT" = "$EXPECTED_PROJECT" ] || fail "exact project is required"
[ "$TARGET_ACCOUNT" = "$EXPECTED_ACCOUNT" ] || fail "dedicated runtime service account is required"
echo "$TARGET_IMAGE" | grep -Eq "^asia-southeast1-docker\.pkg\.dev/${EXPECTED_PROJECT}/phone11-staging/phone11-android-staging-api@sha256:[a-f0-9]{64}$" || fail "exact immutable staging image is required"
[ -f "$ENV_FILE" ] || fail "private environment file is required"
MODE="$(stat -f '%Lp' "$ENV_FILE" 2>/dev/null || stat -c '%a' "$ENV_FILE" 2>/dev/null || true)"
[ "$MODE" = "600" ] || fail "environment file mode must be 0600"

while IFS= read -r LINE || [ -n "$LINE" ]; do
  case "$LINE" in ""|'#'*) continue;; esac
  KEY="${LINE%%=*}"
  case "$KEY" in
    PHONE11_ANDROID_STAGING_API_ENABLED|PHONE11_ANDROID_STAGING_API_ENVIRONMENT|PHONE11_ANDROID_STAGING_API_PROJECT|PHONE11_ANDROID_STAGING_API_SERVICE|PHONE11_ANDROID_STAGING_API_RUNTIME_SERVICE_ACCOUNT|PHONE11_ANDROID_STAGING_API_PUBLIC_ORIGIN|PHONE11_ANDROID_STAGING_PACKAGE|PHONE11_ANDROID_FIREBASE_PROJECT_ID|PHONE11_ANDROID_FIREBASE_SENDER_ID|PHONE11_ANDROID_FIREBASE_APP_ID|PHONE11_CLOUDSQL_IAM_DB_AUTH|PHONE11_CLOUDSQL_INSTANCE|PG_HOST|PG_USER|PG_DATABASE|PG_SSL|PHONE11_PHONE_SCHEMA_BOOTSTRAP|PHONE11_WAKE_ENABLED|PHONE11_WAKE_PILOT_SIP_URI|PHONE11_AUTH_BASE_URL|PHONE11_AUTH_TRUSTED_ORIGINS|SIP_DOMAIN|SIP_PORT|SIP_TRANSPORT|SIP_STUN_SERVER|PHONE11_BUILD_SHA);;
    *) fail "environment file contains an unsupported key";;
  esac
done < "$ENV_FILE"

grep -Fqx 'PHONE11_ANDROID_STAGING_API_ENABLED=1' "$ENV_FILE" || fail "API gate is missing"
grep -Fqx 'PHONE11_ANDROID_STAGING_API_ENVIRONMENT=staging' "$ENV_FILE" || fail "staging environment is missing"
grep -Fqx "PHONE11_ANDROID_STAGING_API_PROJECT=$EXPECTED_PROJECT" "$ENV_FILE" || fail "project mismatch"
grep -Fqx "PHONE11_ANDROID_STAGING_API_SERVICE=$EXPECTED_SERVICE" "$ENV_FILE" || fail "service mismatch"
grep -Fqx "PHONE11_ANDROID_STAGING_API_RUNTIME_SERVICE_ACCOUNT=$EXPECTED_ACCOUNT" "$ENV_FILE" || fail "runtime identity mismatch"
grep -Fqx 'PHONE11_ANDROID_STAGING_PACKAGE=ai.phone11.mobile.staging' "$ENV_FILE" || fail "Android package mismatch"
grep -Fqx 'PHONE11_ANDROID_FIREBASE_PROJECT_ID=phone11-stage-20260914' "$ENV_FILE" || fail "Firebase project mismatch"
grep -Fqx 'PHONE11_ANDROID_FIREBASE_SENDER_ID=413228367517' "$ENV_FILE" || fail "Firebase sender mismatch"
grep -Fqx 'PHONE11_ANDROID_FIREBASE_APP_ID=1:413228367517:android:f41353883923fc15911e74' "$ENV_FILE" || fail "Firebase app mismatch"
grep -Fqx 'PHONE11_CLOUDSQL_IAM_DB_AUTH=1' "$ENV_FILE" || fail "Cloud SQL IAM auth is required"
grep -Fqx "PHONE11_CLOUDSQL_INSTANCE=$EXPECTED_INSTANCE" "$ENV_FILE" || fail "Cloud SQL instance mismatch"
grep -Fqx "PG_HOST=/cloudsql/$EXPECTED_INSTANCE" "$ENV_FILE" || fail "Cloud SQL socket mismatch"
grep -Fqx "PG_USER=$EXPECTED_DB_USER" "$ENV_FILE" || fail "Cloud SQL IAM database user mismatch"
grep -Fqx "PG_DATABASE=$EXPECTED_DATABASE" "$ENV_FILE" || fail "database mismatch"
grep -Fqx 'PG_SSL=disable' "$ENV_FILE" || fail "managed connector socket mode is required"
grep -Fqx 'PHONE11_PHONE_SCHEMA_BOOTSTRAP=0' "$ENV_FILE" || fail "runtime schema changes must be disabled"
grep -Fqx 'PHONE11_WAKE_ENABLED=1' "$ENV_FILE" || fail "wake enrollment gate is missing"
grep -Fqx 'PHONE11_WAKE_PILOT_SIP_URI=sip:7101@sip.stage.phone11.test' "$ENV_FILE" || fail "pilot SIP identity mismatch"
grep -Fqx 'SIP_DOMAIN=sip.stage.phone11.test' "$ENV_FILE" || fail "SIP domain mismatch"
if grep -Eq '^[A-Za-z0-9_]*(SECRET|TOKEN|PASSWORD|GRANT|DATABASE_URL|CONNECTION_STRING)[A-Za-z0-9_]*=' "$ENV_FILE"; then fail "secrets and database credentials are forbidden in the environment file"; fi
PUBLIC_ORIGIN="$(sed -n 's/^PHONE11_ANDROID_STAGING_API_PUBLIC_ORIGIN=//p' "$ENV_FILE")"
AUTH_BASE_URL="$(sed -n 's/^PHONE11_AUTH_BASE_URL=//p' "$ENV_FILE")"
[ "$PUBLIC_ORIGIN" = "$AUTH_BASE_URL" ] || fail "auth origin must match the Android API origin"
echo "$PUBLIC_ORIGIN" | grep -Eq '^https://(api\.stage\.phone11\.ai|phone11-android-staging-api-[a-z0-9]+-as\.a\.run\.app)$' || fail "exact HTTPS staging origin is required"

command -v gcloud >/dev/null 2>&1 || fail "gcloud is unavailable"
ACTIVE_PROJECT="$(gcloud config get-value project 2>/dev/null)"
[ "$ACTIVE_PROJECT" = "$EXPECTED_PROJECT" ] || fail "active gcloud project is not the isolated staging project"
gcloud iam service-accounts describe "$EXPECTED_ACCOUNT" --project="$EXPECTED_PROJECT" --format='value(email)' 2>/dev/null | grep -Fqx "$EXPECTED_ACCOUNT" || fail "dedicated runtime service account is unavailable"
gcloud secrets describe phone11-stage-auth-secret --project="$EXPECTED_PROJECT" --format='value(name)' >/dev/null 2>&1 || fail "auth secret is unavailable"
gcloud secrets get-iam-policy phone11-stage-auth-secret --project="$EXPECTED_PROJECT" --flatten='bindings[].members' --filter="bindings.role=roles/secretmanager.secretAccessor AND bindings.members=serviceAccount:$EXPECTED_ACCOUNT" --format='value(bindings.role)' 2>/dev/null | grep -Fqx 'roles/secretmanager.secretAccessor' || fail "runtime identity lacks secret-specific auth access"
INSTANCE_JSON="$(gcloud sql instances describe phone11-stage-wake-pg --project="$EXPECTED_PROJECT" --format=json 2>/dev/null)" || fail "isolated Cloud SQL instance is unavailable"
printf '%s' "$INSTANCE_JSON" | node -e '
let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const x=JSON.parse(s),ip=x.settings?.ipConfiguration,ok=x.connectionName==="phone11-stage-20260914:asia-southeast1:phone11-stage-wake-pg"&&x.region==="asia-southeast1"&&x.databaseVersion==="POSTGRES_16"&&x.settings?.tier==="db-f1-micro"&&x.settings?.availabilityType==="ZONAL"&&x.settings?.dataDiskType==="PD_HDD"&&Number(x.settings?.dataDiskSizeGb)===10&&x.settings?.storageAutoResize===false&&x.settings?.deletionProtectionEnabled===true&&x.settings?.backupConfiguration?.enabled===false&&x.settings?.connectorEnforcement==="REQUIRED"&&ip?.sslMode==="ENCRYPTED_ONLY"&&(ip?.authorizedNetworks?.length??0)===0&&x.ipAddresses?.some(a=>a.type==="PRIMARY")&&x.settings?.databaseFlags?.some(f=>f.name==="cloudsql.iam_authentication"&&f.value==="on");if(!ok)process.exit(1)})' || fail "Cloud SQL security profile mismatch"
gcloud sql databases describe "$EXPECTED_DATABASE" --instance=phone11-stage-wake-pg --project="$EXPECTED_PROJECT" --format='value(name)' 2>/dev/null | grep -Fqx "$EXPECTED_DATABASE" || fail "isolated database is unavailable"
gcloud sql users list --instance=phone11-stage-wake-pg --project="$EXPECTED_PROJECT" --filter="name=$EXPECTED_DB_USER AND type=CLOUD_IAM_SERVICE_ACCOUNT" --format='value(name)' 2>/dev/null | grep -Fqx "$EXPECTED_DB_USER" || fail "API IAM database user is unavailable"
for ROLE in roles/cloudsql.client roles/cloudsql.instanceUser; do
  gcloud projects get-iam-policy "$EXPECTED_PROJECT" --flatten='bindings[].members' --filter="bindings.role=$ROLE AND bindings.members=serviceAccount:$EXPECTED_ACCOUNT" --format='value(bindings.role)' 2>/dev/null | grep -Fqx "$ROLE" || fail "runtime service account is missing $ROLE"
done

if [ "${1:-}" != "--execute" ]; then
  echo "Android staging API deployment validated; no deployment performed. Re-run with --execute only after resource and deployment approval."
  exit 0
fi

gcloud run deploy "$EXPECTED_SERVICE" \
  --project="$EXPECTED_PROJECT" --region="$EXPECTED_REGION" --image="$TARGET_IMAGE" \
  --service-account="$EXPECTED_ACCOUNT" --env-vars-file="$ENV_FILE" \
  --set-secrets='PHONE11_AUTH_SECRET=phone11-stage-auth-secret:latest' \
  --add-cloudsql-instances="$EXPECTED_INSTANCE" --execution-environment=gen2 \
  --port=8080 --cpu=1 --memory=512Mi --concurrency=8 --timeout=15 \
  --min=0 --max=1 --ingress=all --allow-unauthenticated --quiet
