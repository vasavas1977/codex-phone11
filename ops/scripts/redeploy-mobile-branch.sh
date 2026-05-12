#!/usr/bin/env bash
set -euo pipefail

echo "=== Phone11 mobile branch backend redeploy ==="
echo "Host: $(hostname)"
echo "Time: $(date -Iseconds)"
echo "GitHub SHA: ${GITHUB_SHA:?missing GITHUB_SHA}"
echo "Deploy checkout: ${DEPLOY_CHECKOUT:?missing DEPLOY_CHECKOUT}"

mkdir -p "$DEPLOY_CHECKOUT"

ENV_FILE=""
for candidate in \
  "$DEPLOY_CHECKOUT/.env" \
  "/opt/phone11ai/cloudphone11/infra/compose/.env" \
  "/opt/phone11ai/cloudphone11/.env" \
  "/opt/phone11ai/.env"; do
  if [ -f "$candidate" ]; then ENV_FILE="$candidate"; break; fi
done
if [ -z "$ENV_FILE" ]; then
  echo "ERROR: no runtime .env file found on EC2."
  exit 51
fi
cp "$ENV_FILE" /tmp/phone11-runtime.env
echo "Using runtime env path: $ENV_FILE"

cd "$DEPLOY_CHECKOUT"
if [ ! -d .git ]; then
  git init
  git remote add origin https://github.com/vasavas1977/codex-phone11.git
else
  git remote set-url origin https://github.com/vasavas1977/codex-phone11.git
fi
git fetch --depth 1 origin "$GITHUB_SHA"
git checkout --force FETCH_HEAD
cp /tmp/phone11-runtime.env .env
export PHONE11_BUILD_SHA="$GITHUB_SHA"

read_env_file() {
  awk -F= -v key="$1" '$1 == key {sub(/^[^=]*=/, ""); print; exit}' .env
}

wait_for_backend_running() {
  echo "--- Waiting for backend container to stay running ---"
  local state=""
  for _ in $(seq 1 30); do
    state="$(docker inspect -f '{{.State.Status}} restarting={{.State.Restarting}} exit={{.State.ExitCode}}' cp11-backend 2>/dev/null || true)"
    echo "Backend state: ${state:-not-found}"
    if [[ "$state" == running\ restarting=false* ]]; then
      return 0
    fi
    sleep 2
  done
  echo "ERROR: backend container did not stay running. Recent backend logs:"
  docker logs --tail=120 cp11-backend || true
  return 1
}

wait_for_backend_health() {
  echo "--- Waiting for backend health endpoint ---"
  local body=""
  for _ in $(seq 1 30); do
    if body="$(curl -fsS http://127.0.0.1:3000/api/health 2>/tmp/phone11-health-error.log)"; then
      echo "$body"
      return 0
    fi
    echo "Health not ready: $(cat /tmp/phone11-health-error.log 2>/dev/null || true)"
    sleep 2
  done
  echo "ERROR: backend health endpoint did not become ready. Recent backend logs:"
  docker logs --tail=120 cp11-backend || true
  return 1
}

diagnose_public_api_route() {
  echo "--- Public API route diagnostics ---"
  echo "DNS for api.phone11.ai:"
  getent ahosts api.phone11.ai || true
  echo "Listening ports 80/443/3000/3001:"
  sudo ss -ltnp 2>/dev/null | grep -E ':(80|443|3000|3001)\b' || ss -ltnp 2>/dev/null | grep -E ':(80|443|3000|3001)\b' || true
  echo "Docker containers:"
  docker ps --format '{{.Names}} {{.Image}} {{.Ports}}' || true
  echo "Direct backend health:"
  curl -fsS http://127.0.0.1:3000/api/health || true
  echo
  echo "Local HTTP Host-route health:"
  curl -fsS -H 'Host: api.phone11.ai' http://127.0.0.1/api/health || true
  echo
  echo "Local HTTPS Host-route health:"
  curl -k -fsS --resolve api.phone11.ai:443:127.0.0.1 https://api.phone11.ai/api/health || true
  echo
  echo "Nginx proxy snippets:"
  if command -v nginx >/dev/null 2>&1; then
    sudo nginx -T 2>/dev/null | grep -E -C 4 'api\.phone11\.ai|proxy_pass|127\.0\.0\.1:3000|localhost:3000' || true
  else
    echo "nginx command not found"
  fi
}

wait_for_public_api_health() {
  echo "--- Verifying public api.phone11.ai route ---"
  local body=""
  for _ in $(seq 1 20); do
    if body="$(curl -fsS --connect-timeout 5 --max-time 12 https://api.phone11.ai/api/health 2>/tmp/phone11-public-health-error.log)"; then
      echo "Public health: $body"
      if [[ "$body" == *"$GITHUB_SHA"* ]]; then
        return 0
      fi
      echo "ERROR: public API answered, but it is not serving this deploy commit."
      echo "Expected build marker: $GITHUB_SHA"
      diagnose_public_api_route
      return 61
    fi
    echo "Public health not ready: $(cat /tmp/phone11-public-health-error.log 2>/dev/null || true)"
    sleep 3
  done
  echo "ERROR: public api.phone11.ai health endpoint did not become ready."
  diagnose_public_api_route
  return 62
}

DB_NAME_VALUE="$(read_env_file DB_NAME)"
DB_USER_VALUE="$(read_env_file DB_USER)"
DB_PASSWORD_VALUE="$(read_env_file DB_PASSWORD)"
DB_NAME_VALUE="${DB_NAME_VALUE:-cloudphone11}"
DB_USER_VALUE="${DB_USER_VALUE:-cloudphone11}"
if [ -z "$DB_PASSWORD_VALUE" ]; then
  echo "ERROR: DB_PASSWORD is missing in runtime env."
  exit 52
fi

echo "--- Aligning Postgres role password ---"
docker exec -i -u postgres cp11-postgres psql -U "$DB_USER_VALUE" -d "$DB_NAME_VALUE" -v ON_ERROR_STOP=1 -v db_user="$DB_USER_VALUE" -v db_password="$DB_PASSWORD_VALUE" <<'SQL'
ALTER ROLE :"db_user" WITH PASSWORD :'db_password';
SQL

echo "--- Rebuilding backend with patched Dockerfile and DB config ---"
docker compose --env-file .env -f infra/compose/docker-compose.prod.yml up -d --build --force-recreate backend
wait_for_backend_running

echo "--- Verifying backend DB env and pilot extension ---"
docker exec -i -e PILOT_USER_ID="${PILOT_USER_ID:-1}" cp11-backend node --input-type=module - <<'NODE'
import pg from 'pg';
const pilotUserId = Number.parseInt(process.env.PILOT_USER_ID || '1', 10);
const required = ['PG_HOST', 'PG_USER', 'PG_PASSWORD', 'PG_DATABASE'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Missing backend PG env: ${missing.join(', ')}`);
console.log(`Backend PG env present: host=${process.env.PG_HOST}, user=${process.env.PG_USER}, database=${process.env.PG_DATABASE}, password=<set>`);
const pool = new pg.Pool({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT || 5432),
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
  ssl: false,
  connectionTimeoutMillis: 5000,
});
try {
  const auth = await pool.query('select current_user, current_database()');
  console.log(`Backend PG auth OK as ${auth.rows[0].current_user} on ${auth.rows[0].current_database}`);
  const ext = await pool.query(`
    SELECT e.extension_number, COALESCE(e.sip_domain, sa.sip_domain) AS sip_domain
    FROM extensions e
    LEFT JOIN user_extensions ue ON ue.extension_id = e.id AND ue.user_id = $1
    LEFT JOIN sip_accounts sa ON sa.extension_id = e.id AND sa.deleted_at IS NULL
    WHERE (ue.user_id = $1 OR e.user_id = $1 OR sa.user_id = $1)
      AND COALESCE(e.status, 'active') = 'active'
      AND e.deleted_at IS NULL
    ORDER BY ue.is_primary DESC NULLS LAST, e.id ASC
    LIMIT 1
  `, [pilotUserId]);
  if (!ext.rows.length) throw new Error(`No pilot extension found for user ${pilotUserId}`);
  console.log(`Pilot extension ready: ${ext.rows[0].extension_number} on ${ext.rows[0].sip_domain || 'sip.phone11.ai'}`);
} finally {
  await pool.end();
}
NODE

docker restart cp11-backend >/dev/null
wait_for_backend_running
wait_for_backend_health
wait_for_public_api_health
echo "Redeploy finished."
