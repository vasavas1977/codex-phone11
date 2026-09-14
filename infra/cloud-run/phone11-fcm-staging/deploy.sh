#!/bin/sh
set -eu

EXPECTED_PROJECT="phone11-stage-20260914"
EXPECTED_REGION="asia-southeast1"
EXPECTED_SERVICE="phone11-fcm-staging-lab"
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
  PHONE11_LAB_FCM_SCENARIO_ENABLED|PHONE11_LAB_FCM_ENVIRONMENT|PHONE11_LAB_FCM_PACKAGE|PHONE11_LAB_FCM_PROJECT_ID|PHONE11_LAB_FCM_SENDER_ID|PHONE11_LAB_FCM_APP_ID|PHONE11_LAB_FCM_APK_SHA256|PHONE11_LAB_FCM_EXECUTION_ID|PHONE11_LAB_FCM_EXECUTION_EXPIRES_AT|PHONE11_LAB_FCM_BINDING_ID|PHONE11_LAB_FCM_CASES|PHONE11_LAB_FCM_PUBLIC_ORIGIN|PHONE11_LAB_SIP_DRIVER_ORIGIN|PHONE11_WAKE_ENABLED|PHONE11_WAKE_PILOT_SIP_URI|FCM_PROJECT_ID|PHONE11_BUILD_SHA);;
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
if grep -Eq '^[A-Za-z0-9_]*(SECRET|TOKEN|PASSWORD|GRANT)[A-Za-z0-9_]*=' "$ENV_FILE";then fail "secrets must use Secret Manager injection";fi

command -v gcloud >/dev/null 2>&1||fail "gcloud is unavailable"
ACTIVE_PROJECT="$(gcloud config get-value project 2>/dev/null)"
[ "$ACTIVE_PROJECT" = "$EXPECTED_PROJECT" ]||fail "active gcloud project is not the isolated staging project"
for NAME in phone11-lab-fcm-trigger phone11-lab-sip-driver phone11-stage-database-url;do
 gcloud secrets describe "$NAME" --project="$EXPECTED_PROJECT" --format='value(name)' >/dev/null 2>&1||fail "required Secret Manager resource is unavailable"
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
 --set-secrets='PHONE11_LAB_FCM_TRIGGER_SECRET=phone11-lab-fcm-trigger:latest,PHONE11_LAB_SIP_DRIVER_SECRET=phone11-lab-sip-driver:latest,DATABASE_URL=phone11-stage-database-url:latest' \
 --execution-environment=gen2 \
 --port=8080 --cpu=1 --memory=512Mi --concurrency=4 --timeout=15 \
 --min=0 --max=1 --ingress=all --no-allow-unauthenticated --quiet
