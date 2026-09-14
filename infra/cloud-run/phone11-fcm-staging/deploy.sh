#!/bin/sh
set -eu

EXPECTED_PROJECT="phone11-stage-20260914"
EXPECTED_REGION="asia-southeast1"
EXPECTED_SERVICE="phone11-fcm-staging-lab"
EXPECTED_CLOUDSQL_INSTANCE="phone11-stage-20260914:asia-southeast1:phone11-stage-wake-pg"
EXPECTED_DB_USER="phone11-fcm-lab@phone11-stage-20260914.iam"
EXPECTED_DB_NAME="phone11_wake_stage"
EXPECTED_RUNNER_ACCOUNT="phone11-sip-runner@phone11-stage-20260914.iam.gserviceaccount.com"
TARGET_PROJECT="${PHONE11_LAB_CLOUDRUN_PROJECT:-}"
TARGET_IMAGE="${PHONE11_LAB_CLOUDRUN_IMAGE:-}"
TARGET_ACCOUNT="${PHONE11_LAB_CLOUDRUN_SERVICE_ACCOUNT:-}"
ENV_FILE="${PHONE11_LAB_CLOUDRUN_ENV_FILE:-}"

fail(){ echo "Cloud Run staging deployment refused: $1" >&2;exit 2; }
[ "$TARGET_PROJECT" = "$EXPECTED_PROJECT" ]||fail "exact project is required"
echo "$TARGET_IMAGE"|grep -Eq "^[a-z0-9-]+-docker\\.pkg\\.dev/${EXPECTED_PROJECT}/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$"||fail "immutable staging image digest is required"
echo "$TARGET_ACCOUNT"|grep -Eq "^[a-z][a-z0-9-]{4,28}@${EXPECTED_PROJECT}\\.iam\\.gserviceaccount\\.com$"||fail "staging runtime service account is required"
[ -f "$ENV_FILE" ]||fail "private environment file is required"
MODE="$(stat -f '%Lp' "$ENV_FILE" 2>/dev/null||stat -c '%a' "$ENV_FILE" 2>/dev/null||true)"
[ "$MODE" = "600" ]||fail "environment file mode must be 0600"
while IFS= read -r LINE||[ -n "$LINE" ];do
 case "$LINE" in ""|'#'*)continue;;esac
 KEY="${LINE%%=*}"
 case "$KEY" in
  PHONE11_LAB_FCM_SCENARIO_ENABLED|PHONE11_LAB_FCM_ENVIRONMENT|PHONE11_LAB_FCM_PACKAGE|PHONE11_LAB_FCM_PROJECT_ID|PHONE11_LAB_FCM_SENDER_ID|PHONE11_LAB_FCM_APP_ID|PHONE11_LAB_FCM_APK_SHA256|PHONE11_LAB_FCM_EXECUTION_ID|PHONE11_LAB_FCM_EXECUTION_EXPIRES_AT|PHONE11_LAB_FCM_BINDING_ID|PHONE11_LAB_FCM_CASES|PHONE11_LAB_FCM_PUBLIC_ORIGIN|PHONE11_LAB_SIP_DRIVER_TRANSPORT|PHONE11_WAKE_ENABLED|PHONE11_WAKE_PILOT_SIP_URI|FCM_PROJECT_ID|PHONE11_BUILD_SHA|PHONE11_CLOUDSQL_IAM_DB_AUTH|PHONE11_CLOUDSQL_INSTANCE|PG_HOST|PG_USER|PG_DATABASE|PG_SSL);;
  *)fail "environment file contains an unsupported key";;
 esac
done < "$ENV_FILE"
grep -Fqx 'PHONE11_LAB_FCM_SCENARIO_ENABLED=1' "$ENV_FILE"||fail "scenario gate is missing"
grep -Fqx 'PHONE11_LAB_FCM_ENVIRONMENT=staging' "$ENV_FILE"||fail "staging environment is missing"
grep -Fqx 'PHONE11_LAB_FCM_PACKAGE=ai.phone11.mobile.staging' "$ENV_FILE"||fail "staging package mismatch"
grep -Fqx 'PHONE11_LAB_FCM_PROJECT_ID=phone11-stage-20260914' "$ENV_FILE"||fail "Firebase project mismatch"
grep -Fqx 'PHONE11_LAB_FCM_SENDER_ID=413228367517' "$ENV_FILE"||fail "Firebase sender mismatch"
grep -Fqx 'PHONE11_LAB_FCM_APP_ID=1:413228367517:android:f41353883923fc15911e74' "$ENV_FILE"||fail "Firebase app mismatch"
grep -Fqx 'FCM_PROJECT_ID=phone11-stage-20260914' "$ENV_FILE"||fail "provider project mismatch"
grep -Fqx 'PHONE11_WAKE_ENABLED=1' "$ENV_FILE"||fail "wake gate is missing"
grep -Fqx 'PHONE11_LAB_SIP_DRIVER_TRANSPORT=reverse_pull' "$ENV_FILE"||fail "private reverse-pull SIP transport is required"
if grep -q '^PHONE11_LAB_SIP_DRIVER_ORIGIN=' "$ENV_FILE";then fail "public SIP-driver origins are forbidden";fi
grep -Fqx 'PHONE11_CLOUDSQL_IAM_DB_AUTH=1' "$ENV_FILE"||fail "Cloud SQL IAM database authentication is required"
grep -Fqx "PHONE11_CLOUDSQL_INSTANCE=$EXPECTED_CLOUDSQL_INSTANCE" "$ENV_FILE"||fail "Cloud SQL instance mismatch"
grep -Fqx "PG_HOST=/cloudsql/$EXPECTED_CLOUDSQL_INSTANCE" "$ENV_FILE"||fail "Cloud SQL Unix socket mismatch"
grep -Fqx "PG_USER=$EXPECTED_DB_USER" "$ENV_FILE"||fail "Cloud SQL IAM database user mismatch"
grep -Fqx "PG_DATABASE=$EXPECTED_DB_NAME" "$ENV_FILE"||fail "isolated staging database mismatch"
grep -Fqx 'PG_SSL=disable' "$ENV_FILE"||fail "Cloud SQL local connector socket mode is required"
if grep -Eq '^[A-Za-z0-9_]*(SECRET|TOKEN|PASSWORD|GRANT)[A-Za-z0-9_]*=' "$ENV_FILE";then fail "secrets must use Secret Manager injection";fi

command -v gcloud >/dev/null 2>&1||fail "gcloud is unavailable"
ACTIVE_PROJECT="$(gcloud config get-value project 2>/dev/null)"
[ "$ACTIVE_PROJECT" = "$EXPECTED_PROJECT" ]||fail "active gcloud project is not the isolated staging project"
for NAME in phone11-lab-fcm-trigger phone11-lab-sip-driver;do
 gcloud secrets describe "$NAME" --project="$EXPECTED_PROJECT" --format='value(name)' >/dev/null 2>&1||fail "required Secret Manager resource is unavailable"
done
gcloud iam service-accounts describe "$EXPECTED_RUNNER_ACCOUNT" --project="$EXPECTED_PROJECT" --format='value(email)' 2>/dev/null \
 |grep -Fqx "$EXPECTED_RUNNER_ACCOUNT"||fail "keyless SIP runner service account is unavailable"
if [ -n "$(gcloud iam service-accounts keys list --iam-account="$EXPECTED_RUNNER_ACCOUNT" --managed-by=user --format='value(name)' 2>/dev/null)" ];then fail "SIP runner service account must remain keyless";fi
gcloud run services get-iam-policy "$EXPECTED_SERVICE" --project="$EXPECTED_PROJECT" --region="$EXPECTED_REGION" --flatten='bindings[].members' \
 --filter="bindings.role=roles/run.invoker AND bindings.members=serviceAccount:$EXPECTED_RUNNER_ACCOUNT" --format='value(bindings.role)' 2>/dev/null \
 |grep -Fqx 'roles/run.invoker'||fail "SIP runner is not the private Cloud Run invoker"
INSTANCE_JSON="$(gcloud sql instances describe phone11-stage-wake-pg --project="$EXPECTED_PROJECT" --format=json 2>/dev/null)"||fail "isolated Cloud SQL instance is unavailable"
printf '%s' "$INSTANCE_JSON"|node -e '
let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const x=JSON.parse(s),ip=x.settings?.ipConfiguration,ok=x.connectionName==="phone11-stage-20260914:asia-southeast1:phone11-stage-wake-pg"&&x.region==="asia-southeast1"&&x.databaseVersion==="POSTGRES_16"&&x.settings?.tier==="db-f1-micro"&&x.settings?.availabilityType==="ZONAL"&&x.settings?.dataDiskType==="PD_HDD"&&Number(x.settings?.dataDiskSizeGb)===10&&x.settings?.storageAutoResize===false&&x.settings?.deletionProtectionEnabled===true&&x.settings?.backupConfiguration?.enabled===false&&ip?.sslMode==="ENCRYPTED_ONLY"&&(ip?.authorizedNetworks?.length??0)===0&&x.ipAddresses?.some(a=>a.type==="PRIMARY")&&x.settings?.connectorEnforcement==="REQUIRED"&&x.settings?.databaseFlags?.some(f=>f.name==="cloudsql.iam_authentication"&&f.value==="on");if(!ok)process.exit(1)})' \
 ||fail "Cloud SQL instance does not match the isolated low-cost security profile"
gcloud sql databases describe "$EXPECTED_DB_NAME" --instance=phone11-stage-wake-pg --project="$EXPECTED_PROJECT" --format='value(name)' 2>/dev/null \
 |grep -Fqx "$EXPECTED_DB_NAME"||fail "isolated staging database is unavailable"
gcloud sql users list --instance=phone11-stage-wake-pg --project="$EXPECTED_PROJECT" --filter="name=$EXPECTED_DB_USER AND type=CLOUD_IAM_SERVICE_ACCOUNT" --format='value(name)' 2>/dev/null \
 |grep -Fqx "$EXPECTED_DB_USER"||fail "Cloud SQL IAM database user is unavailable"
for ROLE in roles/cloudsql.client roles/cloudsql.instanceUser;do
 gcloud projects get-iam-policy "$EXPECTED_PROJECT" --flatten='bindings[].members' --filter="bindings.role=$ROLE AND bindings.members=serviceAccount:$TARGET_ACCOUNT" --format='value(bindings.role)' 2>/dev/null \
  |grep -Fqx "$ROLE"||fail "runtime service account is missing $ROLE"
done

if [ "${1:-}" != "--execute" ];then
 echo "Cloud Run staging deployment validated; no deployment performed. Re-run with --execute after approval."
 exit 0
fi

gcloud run deploy "$EXPECTED_SERVICE" \
 --project="$EXPECTED_PROJECT" \
 --region="$EXPECTED_REGION" \
 --image="$TARGET_IMAGE" \
 --service-account="$TARGET_ACCOUNT" \
 --env-vars-file="$ENV_FILE" \
 --set-secrets='PHONE11_LAB_FCM_TRIGGER_SECRET=phone11-lab-fcm-trigger:latest,PHONE11_LAB_SIP_DRIVER_SECRET=phone11-lab-sip-driver:latest' \
 --add-cloudsql-instances="$EXPECTED_CLOUDSQL_INSTANCE" \
 --execution-environment=gen2 \
 --port=8080 --cpu=1 --memory=512Mi --concurrency=4 --timeout=15 \
 --min=0 --max=1 --ingress=all --no-allow-unauthenticated --quiet
