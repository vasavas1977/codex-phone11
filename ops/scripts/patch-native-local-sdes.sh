#!/usr/bin/env bash
set -Eeuo pipefail

KAMAILIO_CONTAINER="${KAMAILIO_CONTAINER:-p11-kamailio}"
KAMAILIO_CFG="${KAMAILIO_CFG:-/etc/kamailio/kamailio.cfg}"
PATCHER="${PATCHER:-$(cd "$(dirname "$0")/../.." && pwd)/scripts/phone11-native-local-sdes-patch.mjs}"
PATCH_VERSION="phone11-native-local-sdes-20260917-01"

redact() {
  sed -E \
    -e 's#(postgres://)[^:@/]+:[^@]+@#\1<redacted>:<redacted>@#g' \
    -e 's#(password|passwd|pwd|secret|token|authorization)([=:][[:space:]]*)[^[:space:],;]+#\1\2<redacted>#Ig'
}

section() { printf '\n===== %s =====\n' "$1"; }

run() {
  local label="$1"
  shift
  section "$label"
  "$@" 2>&1 | redact
}

container_state() {
  docker inspect --format '{{.State.Running}} {{.State.Restarting}} {{.RestartCount}} {{.State.ExitCode}}' "$KAMAILIO_CONTAINER" 2>/dev/null || true
}

require_no_active_dialogs() {
  local stage active
  stage="$1"
  if ! active="$(docker exec "$KAMAILIO_CONTAINER" kamctl rpc dlg.list 2>/dev/null | python3 -c '
import json
import sys
value = json.load(sys.stdin)
value = value.get("result", value) if isinstance(value, dict) else value
if isinstance(value, list):
    print(len(value))
elif isinstance(value, dict):
    dialogs = value.get("Dialogs", value.get("dialogs"))
    if not isinstance(dialogs, list):
        raise ValueError("dlg.list response has no dialog array")
    print(len(dialogs))
else:
    raise ValueError("unexpected dlg.list response")
')"; then
    echo "ERROR: Could not query active Kamailio dialogs before $stage"
    exit 43
  fi
  active="$(printf '%s' "$active" | tr -d '[:space:]')"
  if ! [[ "$active" =~ ^[0-9]+$ ]]; then
    echo "ERROR: Unexpected active-dialog response before $stage"
    exit 44
  fi
  echo "active_dialogs_before_${stage}=$active"
  if [ "$active" -ne 0 ]; then
    echo "ERROR: Refusing to restart Kamailio while active dialogs exist. Retry after calls end."
    exit 45
  fi
}

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is required to run the guarded config patcher"
  exit 30
fi
if [ ! -f "$PATCHER" ]; then
  echo "ERROR: patcher not found: $PATCHER"
  exit 31
fi
if ! docker ps -a --format '{{.Names}}' | grep -qx "$KAMAILIO_CONTAINER"; then
  echo "ERROR: Kamailio container does not exist: $KAMAILIO_CONTAINER"
  exit 40
fi

section "Phone11 native local-extension SDES patch"
echo "time_utc=$(date -u -Iseconds)"
echo "patch_version=$PATCH_VERSION"
echo "kamailio_container=$KAMAILIO_CONTAINER"
echo "kamailio_cfg=$KAMAILIO_CFG"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="/tmp/phone11-native-local-sdes-${STAMP}"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
docker cp "$KAMAILIO_CONTAINER:$KAMAILIO_CFG" "$BACKUP_DIR/kamailio.cfg.before"
chmod 600 "$BACKUP_DIR/kamailio.cfg.before"

require_no_active_dialogs "candidate_patch"

run "guarded config patch" node "$PATCHER" "$BACKUP_DIR/kamailio.cfg.before" "$BACKUP_DIR/kamailio.cfg.after"

section "candidate SDES route evidence"
grep -nE 'PHONE11_LOCAL_EXTENSION|LOCAL_EXTENSION_REPLY|RTP/SAVP|SDES-only-AES_CM_128_HMAC_SHA1_80|rtcp-mux-demux|DTLS=off|ICE=remove|has_sdp=\$rb' \
  "$BACKUP_DIR/kamailio.cfg.after" | redact
if grep -q 'LOCAL_EXTENSION_REPLY.*\$rb' "$BACKUP_DIR/kamailio.cfg.after"; then
  echo "ERROR: local reply route still logs raw SDP"
  exit 41
fi

docker cp "$BACKUP_DIR/kamailio.cfg.after" "$KAMAILIO_CONTAINER:/tmp/kamailio.cfg.phone11-native-local-sdes"
run "Kamailio candidate syntax check" docker exec "$KAMAILIO_CONTAINER" kamailio -c -f /tmp/kamailio.cfg.phone11-native-local-sdes

require_no_active_dialogs "config_apply"
docker cp "$BACKUP_DIR/kamailio.cfg.after" "$KAMAILIO_CONTAINER:$KAMAILIO_CFG"
run "restart Kamailio" docker restart "$KAMAILIO_CONTAINER"
sleep 5
STATE="$(container_state)"
echo "container_state=$STATE"
if ! echo "$STATE" | grep -q '^true false '; then
  echo "ERROR: Kamailio did not remain healthy; restoring backup."
  docker cp "$BACKUP_DIR/kamailio.cfg.before" "$KAMAILIO_CONTAINER:$KAMAILIO_CFG" || true
  docker restart "$KAMAILIO_CONTAINER" >/dev/null 2>&1 || true
  run "rollback logs" docker logs --tail 120 "$KAMAILIO_CONTAINER"
  exit 42
fi

run "active SDES route evidence" docker exec "$KAMAILIO_CONTAINER" sh -lc \
  "grep -nE 'PHONE11_LOCAL_EXTENSION|LOCAL_EXTENSION_REPLY|RTP/SAVP|SDES-only-AES_CM_128_HMAC_SHA1_80|rtcp-mux-demux|DTLS=off|ICE=remove|has_sdp=\\\$rb' '$KAMAILIO_CFG'"
run "recent Kamailio logs" docker logs --tail 100 "$KAMAILIO_CONTAINER"

section "patch complete"
echo "backup_dir=$BACKUP_DIR"
echo "time_utc=$(date -u -Iseconds)"
