#!/usr/bin/env bash
set -euo pipefail

echo "=== Phone11 mobile branch backend redeploy ==="
echo "Host: $(hostname)"
echo "Time: $(date -Iseconds)"
echo "GitHub SHA: ${GITHUB_SHA:?missing GITHUB_SHA}"
echo "Deploy checkout: ${DEPLOY_CHECKOUT:?missing DEPLOY_CHECKOUT}"

mkdir -p "$DEPLOY_CHECKOUT"

diagnose_runtime_layout() {
  echo "--- Runtime layout diagnostics ---"
  echo "Top-level deployment directories:"
  ls -la /opt 2>/dev/null || true
  ls -la /opt/phone11ai 2>/dev/null || true
  ls -la /home/ubuntu 2>/dev/null | sed -E 's/(\.env[^ ]*)/<env-file>/g' || true
  echo "Potential deploy/config files (paths only):"
  sudo find /opt /home/ubuntu -maxdepth 6 \
    \( -name '.env' -o -name 'docker-compose*.yml' -o -name 'compose*.yml' -o -name 'ecosystem*.config.*' -o -name 'package.json' \) \
    -printf '%p\n' 2>/dev/null | sort | sed -E 's#/\.env$#/<env-file>#g' || true
  echo "Docker containers:"
  docker ps --format '{{.Names}} {{.Image}} {{.Ports}}' 2>/dev/null || true
  echo "Node and proxy listeners:"
  sudo ss -ltnp 2>/dev/null | grep -E ':(80|443|3000|3001|8088)\b' || true
  echo "PM2 process list:"
  if command -v pm2 >/dev/null 2>&1; then pm2 list || true; else echo "pm2 command not found"; fi
  echo "Nginx proxy snippets:"
  if command -v nginx >/dev/null 2>&1; then
    sudo nginx -T 2>/dev/null | grep -E -C 4 'api\.phone11\.ai|proxy_pass|127\.0\.0\.1:3000|localhost:3000|3001|8088' || true
  else
    echo "nginx command not found"
  fi
}

ENV_FILE=""
for candidate in \
  "$DEPLOY_CHECKOUT/.env" \
  "/opt/phone11ai/phone11ai/deploy/backend/.env" \
  "/opt/phone11ai/cloudphone11/infra/compose/.env" \
  "/opt/phone11ai/cloudphone11/.env" \
  "/opt/phone11ai/.env" \
  "/home/ubuntu/phone11ai/.env" \
  "/home/ubuntu/cloudphone11/.env" \
  "/home/ubuntu/codex-phone11/.env"; do
  if [ -f "$candidate" ]; then ENV_FILE="$candidate"; break; fi
done
if [ -z "$ENV_FILE" ]; then
  echo "ERROR: no runtime .env file found on EC2."
  diagnose_runtime_layout
  exit 51
fi
cp "$ENV_FILE" /tmp/phone11-runtime.env
echo "Using runtime env path: $ENV_FILE"

echo "Runtime env keys:"
awk -F= '/^[A-Za-z_][A-Za-z0-9_]*=/ {print $1}' /tmp/phone11-runtime.env | sort | sed -E 's/(SECRET|PASSWORD|TOKEN|KEY).*/<secret-key-redacted>/g' | uniq

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

read_first_env() {
  local value=""
  for key in "$@"; do
    value="$(read_env_file "$key")"
    if [ -n "$value" ]; then
      echo "$value"
      return 0
    fi
  done
  return 0
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

try_repair_backend_db_password_from_rds_secret() {
  echo "--- Checking RDS managed secret for DB password repair ---"
  local db_host db_port db_user db_password db_name secret_arn secret_json secret_file
  db_host="$(read_first_env PG_HOST DB_HOST POSTGRES_HOST)"
  db_port="$(read_first_env PG_PORT DB_PORT POSTGRES_PORT)"
  db_user="$(read_first_env PG_USER DB_USER POSTGRES_USER)"
  db_password="$(read_first_env PG_PASSWORD DB_PASSWORD POSTGRES_PASSWORD)"
  db_name="$(read_first_env PG_DATABASE DB_NAME DB_DATABASE POSTGRES_DB)"
  db_port="${db_port:-5432}"
  secret_json=""

  if [ -z "$db_host" ] || [ -z "$db_user" ] || [ -z "$db_password" ] || [ -z "$db_name" ]; then
    echo "DB env is incomplete; skipping DB password repair."
    return 0
  fi

  secret_file="${RDS_MASTER_SECRET_FILE:-}"
  if [ -n "$secret_file" ] && [ -s "$secret_file" ]; then
    secret_json="$(cat "$secret_file")"
    rm -f "$secret_file" || true
    echo "Using workflow-supplied RDS master secret for DB password repair."
  elif [ -n "${RDS_MASTER_SECRET_JSON:-}" ]; then
    secret_json="$RDS_MASTER_SECRET_JSON"
    echo "Using environment-supplied RDS master secret for DB password repair."
  elif command -v aws >/dev/null 2>&1; then
    secret_arn="$(aws rds describe-db-instances \
      --query "DBInstances[?Endpoint.Address=='$db_host'].MasterUserSecret.SecretArn | [0]" \
      --output text 2>/tmp/phone11-rds-secret-error.log || true)"

    if [ -z "$secret_arn" ] || [ "$secret_arn" = "None" ]; then
      secret_arn="$(aws secretsmanager list-secrets \
        --query "SecretList[?contains(Name, 'phone11') && (contains(Name, 'postgres') || contains(Name, 'rds') || contains(Name, 'database'))].ARN | [0]" \
        --output text 2>/tmp/phone11-rds-secret-error.log || true)"
    fi

    if [ -z "$secret_arn" ] || [ "$secret_arn" = "None" ]; then
      echo "No RDS managed master secret was discoverable with the current AWS credentials; continuing with normal verification."
      if [ -s /tmp/phone11-rds-secret-error.log ]; then
        sed -E 's/(AccessKeyId|SecretAccessKey|SessionToken|password|secret)[^ ]*/<redacted>/Ig' /tmp/phone11-rds-secret-error.log || true
      fi
      return 0
    fi

    secret_json="$(aws secretsmanager get-secret-value \
      --secret-id "$secret_arn" \
      --query SecretString \
      --output text 2>/tmp/phone11-rds-secret-error.log || true)"
  else
    echo "AWS CLI is not available on EC2 and no workflow-supplied RDS master secret was provided; skipping DB password repair."
    return 0
  fi

  if [ -z "$secret_json" ] || [ "$secret_json" = "None" ]; then
    echo "RDS master secret exists but could not be read; continuing with normal verification."
    if [ -s /tmp/phone11-rds-secret-error.log ]; then
      sed -E 's/(AccessKeyId|SecretAccessKey|SessionToken|password|secret)[^ ]*/<redacted>/Ig' /tmp/phone11-rds-secret-error.log || true
    fi
    return 0
  fi

  local host_secret_tmp container_secret_path repair_status
  host_secret_tmp="/tmp/phone11-rds-master-secret.for-container.json"
  container_secret_path="/tmp/phone11-rds-master-secret.json"
  printf '%s' "$secret_json" > "$host_secret_tmp"
  chmod 600 "$host_secret_tmp"
  docker cp "$host_secret_tmp" cp11-backend:"$container_secret_path"
  rm -f "$host_secret_tmp"

  set +e
  docker exec -i \
    -e APP_DB_HOST="$db_host" \
    -e APP_DB_PORT="$db_port" \
    -e APP_DB_USER="$db_user" \
    -e APP_DB_PASSWORD="$db_password" \
    -e APP_DB_NAME="$db_name" \
    -e RDS_MASTER_SECRET_FILE="$container_secret_path" \
    cp11-backend node --input-type=module - <<'NODE'
import fs from 'node:fs';
import pg from 'pg';

const secretPath = process.env.RDS_MASTER_SECRET_FILE;
const secret = JSON.parse(fs.readFileSync(secretPath, 'utf8'));
const app = {
  host: process.env.APP_DB_HOST,
  port: Number(process.env.APP_DB_PORT || secret.port || 5432),
  user: process.env.APP_DB_USER,
  password: process.env.APP_DB_PASSWORD,
  database: process.env.APP_DB_NAME,
};
const admin = {
  host: secret.host || app.host,
  port: Number(secret.port || app.port || 5432),
  user: secret.username || secret.user,
  password: secret.password,
};

function quoteIdent(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value || '')) {
    throw new Error('Unsafe database role name in DB_USER');
  }
  return `"${value.replace(/"/g, '""')}"`;
}

function quoteLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

if (!admin.user || !admin.password) {
  throw new Error('RDS master secret is missing username/password fields');
}
if (!app.user || !app.password || !app.database || !app.host) {
  throw new Error('Application DB env is incomplete');
}

const ssl = { rejectUnauthorized: false };
const databases = [...new Set([app.database, secret.dbname, 'postgres'].filter(Boolean))];
let adminPool;
let lastError;
for (const database of databases) {
  adminPool = new pg.Pool({
    host: admin.host,
    port: admin.port,
    user: admin.user,
    password: admin.password,
    database,
    ssl,
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  try {
    await adminPool.query('select 1');
    break;
  } catch (error) {
    lastError = error;
    await adminPool.end().catch(() => undefined);
    adminPool = undefined;
  }
}
if (!adminPool) {
  throw lastError ?? new Error('Could not connect with RDS master secret');
}

try {
  await adminPool.query(`ALTER ROLE ${quoteIdent(app.user)} WITH PASSWORD ${quoteLiteral(app.password)}`);
  console.log(`Database role password aligned for ${app.user} using RDS managed credentials.`);
} finally {
  await adminPool.end();
}

const verifyPool = new pg.Pool({
  host: app.host,
  port: app.port,
  user: app.user,
  password: app.password,
  database: app.database,
  ssl,
  max: 1,
  connectionTimeoutMillis: 5000,
});
try {
  await verifyPool.query('select 1');
  console.log(`Application DB login verified for ${app.user} after password alignment.`);
} finally {
  await verifyPool.end();
}
NODE
  repair_status=$?
  set -e
  docker exec cp11-backend rm -f "$container_secret_path" >/dev/null 2>&1 || true
  return "$repair_status"
}

verify_backend_db_and_pilot() {
  echo "--- Verifying backend DB env and pilot extension ---"
  docker exec -i -e PILOT_USER_ID="${PILOT_USER_ID:-1}" cp11-backend node --input-type=module - <<'NODE'
import pg from 'pg';
const firstEnv = (...keys) => keys.map((key) => process.env[key]).find(Boolean);
const pilotUserId = Number.parseInt(process.env.PILOT_USER_ID || '1', 10);
const cfg = {
  host: firstEnv('PG_HOST', 'DB_HOST', 'POSTGRES_HOST'),
  port: Number(firstEnv('PG_PORT', 'DB_PORT', 'POSTGRES_PORT') || 5432),
  user: firstEnv('PG_USER', 'DB_USER', 'POSTGRES_USER'),
  password: firstEnv('PG_PASSWORD', 'DB_PASSWORD', 'POSTGRES_PASSWORD'),
  database: firstEnv('PG_DATABASE', 'DB_NAME', 'DB_DATABASE', 'POSTGRES_DB'),
};
const missing = Object.entries(cfg).filter(([key, value]) => key !== 'port' && !value).map(([key]) => key);
if (missing.length) throw new Error(`Missing backend DB env: ${missing.join(', ')}`);
const sslMode = firstEnv('PG_SSL', 'DB_SSL', 'POSTGRES_SSL', 'DATABASE_SSL')?.toLowerCase();
const ssl = sslMode === 'false' || sslMode === '0' || sslMode === 'disable' ? false : { rejectUnauthorized: false };
console.log(`Backend DB env present: host=${cfg.host}, user=${cfg.user}, database=${cfg.database}, ssl=${ssl ? 'enabled' : 'disabled'}, password=<set>`);
const pool = new pg.Pool({ ...cfg, ssl, connectionTimeoutMillis: 5000 });
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

free_backend_port() {
  echo "--- Freeing port 3000 for backend container ---"
  docker rm -f cp11-backend >/dev/null 2>&1 || true
  if command -v fuser >/dev/null 2>&1; then
    sudo fuser -k 3000/tcp || true
  else
    sudo ss -ltnp 2>/dev/null | awk '/:3000 / {print}' | sed -nE 's/.*pid=([0-9]+).*/\1/p' | sort -u | xargs -r sudo kill || true
  fi
}

deploy_standalone_backend() {
  echo "--- Deploying standalone public API backend container ---"
  docker build --no-cache -f infra/docker/backend/Dockerfile -t "phone11-backend-public:$GITHUB_SHA" .
  free_backend_port
  docker run -d \
    --name cp11-backend \
    --restart always \
    --network host \
    --env-file .env \
    -e PHONE11_BUILD_SHA="$GITHUB_SHA" \
    -e PORT=3000 \
    "phone11-backend-public:$GITHUB_SHA"
  wait_for_backend_running
  try_repair_backend_db_password_from_rds_secret
  verify_backend_db_and_pilot
  docker restart cp11-backend >/dev/null
  wait_for_backend_running
  wait_for_backend_health
  wait_for_public_api_health
  echo "Redeploy finished."
}

if ! docker inspect cp11-postgres >/dev/null 2>&1; then
  deploy_standalone_backend
  exit 0
fi

DB_NAME_VALUE="$(read_first_env DB_NAME DB_DATABASE POSTGRES_DB)"
DB_USER_VALUE="$(read_first_env DB_USER POSTGRES_USER)"
DB_PASSWORD_VALUE="$(read_first_env DB_PASSWORD POSTGRES_PASSWORD)"
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
try_repair_backend_db_password_from_rds_secret
verify_backend_db_and_pilot

docker restart cp11-backend >/dev/null
wait_for_backend_running
wait_for_backend_health
wait_for_public_api_health
echo "Redeploy finished."
