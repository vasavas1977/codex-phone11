#!/bin/sh
set -eu

fail(){ echo "Phone11 staging migrator refused: $1" >&2; exit 2; }
[ "${CLOUD_RUN_JOB:-}" = "phone11-stage-migrator" ] || fail "exact Cloud Run Job is required"
[ "${PHONE11_STAGE_MIGRATOR_PROJECT:-}" = "phone11-stage-20260914" ] || fail "exact staging project is required"
[ "${PHONE11_CLOUDSQL_INSTANCE:-}" = "phone11-stage-20260914:asia-southeast1:phone11-stage-wake-pg" ] || fail "exact Cloud SQL instance is required"
[ "${PG_HOST:-}" = "/cloudsql/phone11-stage-20260914:asia-southeast1:phone11-stage-wake-pg" ] || fail "exact Cloud SQL socket is required"
[ "${PG_USER:-}" = "phone11-stage-migrator@phone11-stage-20260914.iam" ] || fail "exact IAM database user is required"
[ "${PG_DATABASE:-}" = "phone11_wake_stage" ] || fail "exact staging database is required"
[ "${PG_SSL:-}" = "disable" ] || fail "managed connector socket mode is required"
[ "${PHONE11_CLOUDSQL_IAM_DB_AUTH:-}" = "1" ] || fail "IAM database authentication is required"
[ "${PHONE11_STAGE_PILOT_EXTENSION:-}" = "7101" ] || fail "exact pilot extension is required"
[ "${PHONE11_STAGE_PILOT_DOMAIN:-}" = "sip.stage.phone11.test" ] || fail "exact pilot SIP domain is required"
[ -z "${DATABASE_URL:-}${PG_CONNECTION_STRING:-}${PG_PASSWORD:-}${DB_PASSWORD:-}${POSTGRES_PASSWORD:-}${GOOGLE_APPLICATION_CREDENTIALS:-}" ] || fail "database passwords, connection URLs and key files are forbidden"

AUTH_SECRET_FILE=/secrets/auth/secret
LOGIN_PASSWORD_SOURCE=/secrets/login/password
PRIVATE_PASSWORD_FILE=/tmp/phone11-stage-login-password
cleanup(){ rm -f "$PRIVATE_PASSWORD_FILE"; }
trap cleanup EXIT HUP INT TERM

case "${PHONE11_STAGE_MIGRATOR_PHASE:-}" in
  canonical-plan|canonical-apply)
    ARGS=""
    if [ "$PHONE11_STAGE_MIGRATOR_PHASE" = "canonical-apply" ]; then ARGS="--apply --confirm-empty-database"; fi
    # ARGS contains only the fixed switches above; all operator data remains quoted.
    # shellcheck disable=SC2086
    exec node dist/staging-seed.mjs $ARGS \
      --project phone11-stage-20260914 \
      --instance phone11-stage-20260914:asia-southeast1:phone11-stage-wake-pg \
      --database phone11_wake_stage --extension 7101 \
      --domain sip.stage.phone11.test --email "${PHONE11_STAGE_PILOT_EMAIL:-}"
    ;;
  auth-plan|auth-apply|identity-apply)
    [ -r "$AUTH_SECRET_FILE" ] || fail "mounted auth secret is unavailable"
    export PHONE11_AUTH_SECRET="$(cat "$AUTH_SECRET_FILE")"
    [ "${#PHONE11_AUTH_SECRET}" -ge 32 ] || fail "mounted auth secret is invalid"
    [ -n "${PHONE11_AUTH_BASE_URL:-}" ] || fail "auth base URL is required"
    export PHONE11_AUTH_TRUSTED_ORIGINS="$PHONE11_AUTH_BASE_URL"
    if [ "$PHONE11_STAGE_MIGRATOR_PHASE" = "auth-plan" ]; then
      exec node dist/auth-admin.mjs migrate
    elif [ "$PHONE11_STAGE_MIGRATOR_PHASE" = "auth-apply" ]; then
      exec node dist/auth-admin.mjs migrate --apply
    fi
    [ -r "$LOGIN_PASSWORD_SOURCE" ] || fail "mounted pilot login password is unavailable"
    umask 077
    cat "$LOGIN_PASSWORD_SOURCE" > "$PRIVATE_PASSWORD_FILE"
    chmod 0600 "$PRIVATE_PASSWORD_FILE"
    node dist/auth-admin.mjs create-identity --apply --user-id 1 \
      --email "${PHONE11_STAGE_PILOT_EMAIL:-}" --password-file "$PRIVATE_PASSWORD_FILE"
    ;;
  push-plan|push-apply)
    ARGS=""
    if [ "$PHONE11_STAGE_MIGRATOR_PHASE" = "push-apply" ]; then ARGS="--apply --confirm-staging"; fi
    # shellcheck disable=SC2086
    exec node dist/push-migrate.mjs $ARGS --project phone11-stage-20260914 \
      --instance phone11-stage-20260914:asia-southeast1:phone11-stage-wake-pg \
      --database phone11_wake_stage
    ;;
  grants-plan|grants-apply)
    ARGS=""
    if [ "$PHONE11_STAGE_MIGRATOR_PHASE" = "grants-apply" ]; then ARGS="--apply --confirm-staging"; fi
    # shellcheck disable=SC2086
    exec node dist/runtime-grants.mjs $ARGS --project phone11-stage-20260914 \
      --instance phone11-stage-20260914:asia-southeast1:phone11-stage-wake-pg \
      --database phone11_wake_stage \
      --runtime-user phone11-android-api@phone11-stage-20260914.iam
    ;;
  *) fail "phase must be canonical-plan, canonical-apply, auth-plan, auth-apply, push-plan, push-apply, identity-apply, grants-plan or grants-apply";;
esac
