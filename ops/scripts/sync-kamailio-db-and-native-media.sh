#!/usr/bin/env bash
set -Eeuo pipefail

KAMAILIO_CONTAINER="${KAMAILIO_CONTAINER:-p11-kamailio}"
KAMAILIO_CFG="${KAMAILIO_CFG:-/etc/kamailio/kamailio.cfg}"
PATCH_VERSION="kamailio-db-native-media-20260522-01"

redact() {
  sed -E \
    -e 's#(postgres://)[^:@/]+:[^@]+@#\1<redacted>:<redacted>@#g' \
    -e 's#(DB_PASSWORD|PG_PASSWORD|POSTGRES_PASSWORD|DB_PASSWORD_B64|AWS_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID|AWS_SESSION_TOKEN)=([^[:space:]]+)#\1=<redacted>#Ig' \
    -e 's#(password|passwd|pwd|secret|token|authorization)([=:][[:space:]]*)[^[:space:],;]+#\1\2<redacted>#Ig'
}

section() {
  printf '\n===== %s =====\n' "$1"
}

run() {
  local label="$1"
  shift
  section "$label"
  "$@" 2>&1 | redact
}

section "Phone11 Kamailio DB and native media sync"
echo "time_utc=$(date -u -Iseconds)"
echo "patch_version=$PATCH_VERSION"
echo "kamailio_container=$KAMAILIO_CONTAINER"
echo "kamailio_cfg=$KAMAILIO_CFG"

for required in DB_HOST DB_USER DB_PASSWORD_B64 DB_NAME; do
  if [ -z "${!required:-}" ]; then
    echo "ERROR: Missing required environment value: $required"
    exit 30
  fi
done

if ! docker ps -a --format '{{.Names}}' | grep -qx "$KAMAILIO_CONTAINER"; then
  echo "ERROR: Kamailio container does not exist: $KAMAILIO_CONTAINER"
  exit 40
fi

BACKUP_SUFFIX="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="/tmp/phone11-kamailio-db-native-media-${BACKUP_SUFFIX}"
mkdir -p "$BACKUP_DIR"
docker cp "$KAMAILIO_CONTAINER:$KAMAILIO_CFG" "$BACKUP_DIR/kamailio.cfg.before"

section "current container state"
docker inspect --format 'state={{.State.Running}} restarting={{.State.Restarting}} restart_count={{.RestartCount}} exit={{.State.ExitCode}} image={{.Config.Image}}' "$KAMAILIO_CONTAINER" 2>&1 | redact || true

section "current DB/media route evidence"
grep -nE "substdef.*DB_URL|db_url|route\\[TO_FREESWITCH\\]|onreply_route\\[FREESWITCH_REPLY\\]|rtpengine_offer|rtpengine_answer|transport-protocol|DTLS|SDES|phone11_media_profile" \
  "$BACKUP_DIR/kamailio.cfg.before" | redact || true

python3 - "$BACKUP_DIR/kamailio.cfg.before" "$BACKUP_DIR/kamailio.cfg.after" <<'PY'
import base64
import os
import re
import sys
from pathlib import Path
from urllib.parse import quote

src = Path(sys.argv[1])
dst = Path(sys.argv[2])
text = src.read_text()

host = os.environ["DB_HOST"].strip()
port = os.environ.get("DB_PORT", "5432").strip() or "5432"
user = os.environ["DB_USER"].strip()
name = os.environ["DB_NAME"].strip()
password = base64.b64decode(os.environ["DB_PASSWORD_B64"]).decode()
db_url = f"postgres://{quote(user, safe='')}:{quote(password, safe='')}@{host}:{port}/{name}?sslmode=require"

text, subst_count = re.subn(
    r'#!substdef\s+"!DB_URL!.*?!g"',
    f'#!substdef "!DB_URL!{db_url}!g"',
    text,
    count=1,
)
if subst_count == 0:
    raise SystemExit("Could not find DB_URL substdef line")

offer_old = '    # A-leg = WebRTC (public), B-leg = FreeSWITCH (private/plain RTP)\n    $var(rtpe_rc) = rtpengine_offer("replace-origin ICE=remove ICE-lite=backward DTLS-reverse=passive rtcp-mux-demux transport-protocol=RTP/AVP DTLS=off SDES=off direction=pub direction=priv");\n'
offer_new = '''    # Native PJSIP over UDP/TCP is not WebRTC. Keep the PSTN pilot on plain RTP/AVP.
    # WebRTC callers can still use the DTLS-SRTP answer profile below.
    if ($proto == "ws" || $proto == "wss") {
        $avp(phone11_media_profile) = "webrtc";
        $var(rtpe_rc) = rtpengine_offer("replace-origin ICE=remove ICE-lite=backward DTLS-reverse=passive rtcp-mux-demux transport-protocol=RTP/AVP DTLS=off SDES=off direction=pub direction=priv");
    } else {
        $avp(phone11_media_profile) = "native";
        $var(rtpe_rc) = rtpengine_offer("replace-origin replace-session-connection ICE=remove rtcp-mux-demux transport-protocol=RTP/AVP DTLS=off SDES=off direction=pub direction=priv");
    }
'''
if offer_old in text:
    text = text.replace(offer_old, offer_new)
elif 'phone11_media_profile' not in text:
    raise SystemExit("Could not find expected rtpengine_offer block")

answer_old = '        $var(rtpe_rc) = rtpengine_answer("replace-origin ICE=force rtcp-mux-require transport-protocol=UDP/TLS/RTP/SAVPF DTLS=passive SDES=off generate-mid direction=priv direction=pub");\n        xlog("L_ALERT", "RTPENGINE_ANSWER rc=$var(rtpe_rc) for call $ci\\n");\n'
answer_new = '''        if ($avp(phone11_media_profile) == "webrtc") {
            $var(rtpe_rc) = rtpengine_answer("replace-origin ICE=force rtcp-mux-require transport-protocol=UDP/TLS/RTP/SAVPF DTLS=passive SDES=off generate-mid direction=priv direction=pub");
        } else {
            $var(rtpe_rc) = rtpengine_answer("replace-origin replace-session-connection ICE=remove rtcp-mux-demux transport-protocol=RTP/AVP DTLS=off SDES=off direction=priv direction=pub");
        }
        xlog("L_ALERT", "RTPENGINE_ANSWER rc=$var(rtpe_rc) media_profile=$avp(phone11_media_profile) for call $ci\\n");
'''
if answer_old in text:
    text = text.replace(answer_old, answer_new)
elif 'media_profile=$avp(phone11_media_profile)' not in text:
    raise SystemExit("Could not find expected rtpengine_answer block")

dst.write_text(text)
PY

section "patched DB/media route evidence"
grep -nE "substdef.*DB_URL|db_url|route\\[TO_FREESWITCH\\]|onreply_route\\[FREESWITCH_REPLY\\]|rtpengine_offer|rtpengine_answer|transport-protocol|DTLS|SDES|phone11_media_profile" \
  "$BACKUP_DIR/kamailio.cfg.after" | redact || true

docker cp "$BACKUP_DIR/kamailio.cfg.after" "$KAMAILIO_CONTAINER:$KAMAILIO_CFG"

section "restart Kamailio"
docker restart "$KAMAILIO_CONTAINER" 2>&1 | redact
sleep 10

CONTAINER_STATE="$(docker inspect --format '{{.State.Running}} {{.State.Restarting}} {{.RestartCount}} {{.State.ExitCode}}' "$KAMAILIO_CONTAINER" 2>/dev/null || true)"
echo "container_state=$CONTAINER_STATE"
if ! echo "$CONTAINER_STATE" | grep -q '^true false '; then
  echo "ERROR: Kamailio did not stay running. Rolling back config."
  docker cp "$BACKUP_DIR/kamailio.cfg.before" "$KAMAILIO_CONTAINER:$KAMAILIO_CFG" || true
  docker restart "$KAMAILIO_CONTAINER" 2>&1 | redact || true
  docker logs --tail 200 "$KAMAILIO_CONTAINER" 2>&1 | redact || true
  exit 41
fi

run "Kamailio restart logs" docker logs --tail 120 "$KAMAILIO_CONTAINER"
run "live DB/media route after restart" docker exec "$KAMAILIO_CONTAINER" sh -lc \
  "grep -nE 'substdef.*DB_URL|db_url|route\\[TO_FREESWITCH\\]|onreply_route\\[FREESWITCH_REPLY\\]|rtpengine_offer|rtpengine_answer|transport-protocol|DTLS|SDES|phone11_media_profile' '$KAMAILIO_CFG'"

section "sync complete"
echo "backup_dir=$BACKUP_DIR"
echo "time_utc=$(date -u -Iseconds)"
