#!/usr/bin/env bash
set -Eeuo pipefail

KAMAILIO_CONTAINER="${KAMAILIO_CONTAINER:-p11-kamailio}"
KAMAILIO_CFG="${KAMAILIO_CFG:-/etc/kamailio/kamailio.cfg}"
BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:3000}"
PUBLIC_MEDIA_IP="${PUBLIC_MEDIA_IP:-43.210.122.111}"
PATCH_VERSION="kamailio-public-media-backend-route-20260523-02"

redact() {
  sed -E \
    -e 's#(postgres://)[^:@/]+:[^@]+@#\1<redacted>:<redacted>@#g' \
    -e 's#(DB_PASSWORD|PG_PASSWORD|POSTGRES_PASSWORD|AWS_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID|AWS_SESSION_TOKEN)=([^[:space:]]+)#\1=<redacted>#Ig' \
    -e 's#(password|passwd|pwd|secret|token|authorization)([=:][[:space:]]*)[^[:space:],;]+#\1\2<redacted>#Ig'
}

section() { printf '\n===== %s =====\n' "$1"; }
run() {
  local label="$1"
  shift
  section "$label"
  "$@" 2>&1 | redact
}

section "Phone11 Kamailio public media/backend route fix"
echo "time_utc=$(date -u -Iseconds)"
echo "patch_version=$PATCH_VERSION"
echo "kamailio_container=$KAMAILIO_CONTAINER"
echo "kamailio_cfg=$KAMAILIO_CFG"
echo "backend_url=$BACKEND_URL"
echo "public_media_ip=$PUBLIC_MEDIA_IP"

if ! docker ps -a --format '{{.Names}}' | grep -qx "$KAMAILIO_CONTAINER"; then
  echo "ERROR: Kamailio container does not exist: $KAMAILIO_CONTAINER"
  exit 40
fi

BACKUP_SUFFIX="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="/tmp/phone11-kamailio-public-media-backend-${BACKUP_SUFFIX}"
mkdir -p "$BACKUP_DIR"
docker cp "$KAMAILIO_CONTAINER:$KAMAILIO_CFG" "$BACKUP_DIR/kamailio.cfg.before"

section "before evidence"
grep -nE 'BACKEND_URL|http_client_query|http_connect|DID lookup failed|rtpengine_answer|media-address|RTPENGINE_ANSWER|transport-protocol|phone11_media_profile' "$BACKUP_DIR/kamailio.cfg.before" | redact || true

python3 - "$BACKUP_DIR/kamailio.cfg.before" "$BACKUP_DIR/kamailio.cfg.after" <<'PY'
import os
import re
import sys
from pathlib import Path

src = Path(sys.argv[1])
dst = Path(sys.argv[2])
text = src.read_text()
backend_url = os.environ.get("BACKEND_URL", "http://127.0.0.1:3000")
public_media_ip = os.environ.get("PUBLIC_MEDIA_IP", "43.210.122.111")

text, backend_subst_count = re.subn(
    r'#!substdef\s+"!BACKEND_URL!.*?!g"',
    f'#!substdef "!BACKEND_URL!{backend_url}!g"',
    text,
    count=1,
)
if backend_subst_count == 0:
    raise SystemExit("Could not find BACKEND_URL substdef")

old_http = '        http_client_query("backend", "$var(api_url)", "", "$var(api_result)");\n\n        if ($rc == 200) {'
new_http = '        $var(http_rc) = http_connect("backend", "$var(api_url)", "$var(api_result)");\n\n        if ($var(http_rc) == 200) {'
if old_http in text:
    text = text.replace(old_http, new_http, 1)
elif 'http_connect("backend", "$var(api_url)", "$var(api_result)")' not in text:
    raise SystemExit("Could not find expected backend DID lookup block")

text = text.replace('DID lookup failed for $rU (rc=$rc), routing to FS', 'DID lookup failed for $rU (rc=$var(http_rc)), routing to FS')

old_answer = '            $var(rtpe_rc) = rtpengine_answer("replace-origin replace-session-connection ICE=remove rtcp-mux-demux transport-protocol=RTP/AVP DTLS=off SDES=off direction=priv direction=pub");'
new_answer = f'            $var(rtpe_rc) = rtpengine_answer("replace-origin replace-session-connection ICE=remove rtcp-mux-demux transport-protocol=RTP/AVP DTLS=off SDES=off direction=priv direction=pub address-family=IP4 media-address={public_media_ip}");'
if old_answer in text:
    text = text.replace(old_answer, new_answer, 1)
elif f'media-address={public_media_ip}' not in text:
    raise SystemExit("Could not find expected native rtpengine_answer block")

dst.write_text(text)
PY

section "after evidence"
grep -nE 'BACKEND_URL|http_client_query|http_connect|DID lookup failed|rtpengine_answer|media-address|RTPENGINE_ANSWER|transport-protocol|phone11_media_profile' "$BACKUP_DIR/kamailio.cfg.after" | redact || true

docker cp "$BACKUP_DIR/kamailio.cfg.after" "$KAMAILIO_CONTAINER:$KAMAILIO_CFG"

section "syntax check"
if ! docker exec "$KAMAILIO_CONTAINER" sh -lc "kamailio -c -f '$KAMAILIO_CFG'" 2>&1 | redact; then
  echo "ERROR: Kamailio syntax check failed. Rolling back."
  docker cp "$BACKUP_DIR/kamailio.cfg.before" "$KAMAILIO_CONTAINER:$KAMAILIO_CFG" || true
  exit 41
fi

section "restart Kamailio"
docker restart "$KAMAILIO_CONTAINER" 2>&1 | redact
sleep 10
CONTAINER_STATE="$(docker inspect --format '{{.State.Running}} {{.State.Restarting}} {{.RestartCount}} {{.State.ExitCode}}' "$KAMAILIO_CONTAINER" 2>/dev/null || true)"
echo "container_state=$CONTAINER_STATE"
if ! echo "$CONTAINER_STATE" | grep -q '^true false '; then
  echo "ERROR: Kamailio did not stay running. Rolling back config."
  docker cp "$BACKUP_DIR/kamailio.cfg.before" "$KAMAILIO_CONTAINER:$KAMAILIO_CFG" || true
  docker restart "$KAMAILIO_CONTAINER" 2>&1 | redact || true
  docker logs --tail 160 "$KAMAILIO_CONTAINER" 2>&1 | redact || true
  exit 42
fi

run "live evidence after restart" docker exec "$KAMAILIO_CONTAINER" sh -lc "grep -nE 'BACKEND_URL|http_client_query|http_connect|DID lookup failed|rtpengine_answer|media-address|RTPENGINE_ANSWER|transport-protocol|phone11_media_profile' '$KAMAILIO_CFG'"
run "Kamailio recent restart logs" docker logs --tail 80 "$KAMAILIO_CONTAINER"

section "fix complete"
echo "backup_dir=$BACKUP_DIR"
echo "time_utc=$(date -u -Iseconds)"