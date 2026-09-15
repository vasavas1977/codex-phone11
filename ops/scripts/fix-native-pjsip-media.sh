#!/usr/bin/env bash
set -Eeuo pipefail

KAMAILIO_CONTAINER="${KAMAILIO_CONTAINER:-p11-kamailio}"
KAMAILIO_CFG="${KAMAILIO_CFG:-/etc/kamailio/kamailio.cfg}"
PATCH_VERSION="native-pjsip-media-20260522-02"

redact() {
  sed -E \
    -e 's#(postgres://)[^:@/]+:[^@]+@#\1<redacted>:<redacted>@#g' \
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

section "Phone11 native PJSIP media fix"
echo "time_utc=$(date -u -Iseconds)"
echo "patch_version=$PATCH_VERSION"
echo "kamailio_container=$KAMAILIO_CONTAINER"
echo "kamailio_cfg=$KAMAILIO_CFG"

if ! docker ps -a --format '{{.Names}}' | grep -qx "$KAMAILIO_CONTAINER"; then
  echo "ERROR: Kamailio container does not exist: $KAMAILIO_CONTAINER"
  exit 40
fi

container_state() {
  docker inspect --format '{{.State.Running}} {{.State.Restarting}} {{.RestartCount}} {{.State.ExitCode}}' "$KAMAILIO_CONTAINER" 2>/dev/null || true
}

ensure_kamailio_running() {
  local state latest_backup
  state="$(container_state)"
  echo "container_state=$state"
  if echo "$state" | grep -q '^true false '; then
    return 0
  fi

  section "recover Kamailio before patch"
  latest_backup="$(ls -td /tmp/phone11-native-pjsip-media-*/kamailio.cfg.before 2>/dev/null | head -n 1 || true)"
  if [ -z "$latest_backup" ]; then
    echo "ERROR: Kamailio is not stable and no prior backup was found."
    docker logs --tail 160 "$KAMAILIO_CONTAINER" 2>&1 | redact || true
    exit 41
  fi

  echo "restoring_backup=$latest_backup"
  docker cp "$latest_backup" "$KAMAILIO_CONTAINER:$KAMAILIO_CFG"
  docker restart "$KAMAILIO_CONTAINER" 2>&1 | redact
  sleep 8
  state="$(container_state)"
  echo "post_restore_container_state=$state"
  if ! echo "$state" | grep -q '^true false '; then
    echo "ERROR: Kamailio did not recover after restoring the last backup."
    docker logs --tail 200 "$KAMAILIO_CONTAINER" 2>&1 | redact || true
    exit 42
  fi
}

ensure_kamailio_running

BACKUP_SUFFIX="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="/tmp/phone11-native-pjsip-media-${BACKUP_SUFFIX}"
mkdir -p "$BACKUP_DIR"
docker cp "$KAMAILIO_CONTAINER:$KAMAILIO_CFG" "$BACKUP_DIR/kamailio.cfg.before"

section "current media route"
grep -nE "route\\[TO_FREESWITCH\\]|onreply_route\\[FREESWITCH_REPLY\\]|rtpengine_offer|rtpengine_answer|transport-protocol|DTLS|SDES|phone11_media_profile" \
  "$BACKUP_DIR/kamailio.cfg.before" | redact || true

python3 - "$BACKUP_DIR/kamailio.cfg.before" "$BACKUP_DIR/kamailio.cfg.after" <<'PY'
import sys
from pathlib import Path

src = Path(sys.argv[1])
dst = Path(sys.argv[2])
text = src.read_text()

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
if offer_old not in text and 'phone11_media_profile' not in text:
    raise SystemExit("Could not find expected rtpengine_offer block")
if offer_old in text:
    text = text.replace(offer_old, offer_new)

answer_old = '        $var(rtpe_rc) = rtpengine_answer("replace-origin ICE=force rtcp-mux-require transport-protocol=UDP/TLS/RTP/SAVPF DTLS=passive SDES=off generate-mid direction=priv direction=pub");\n        xlog("L_ALERT", "RTPENGINE_ANSWER rc=$var(rtpe_rc) for call $ci\\n");\n'
answer_new = '''        if ($avp(phone11_media_profile) == "webrtc") {
            $var(rtpe_rc) = rtpengine_answer("replace-origin ICE=force rtcp-mux-require transport-protocol=UDP/TLS/RTP/SAVPF DTLS=passive SDES=off generate-mid direction=priv direction=pub");
        } else {
            $var(rtpe_rc) = rtpengine_answer("replace-origin replace-session-connection ICE=remove rtcp-mux-demux transport-protocol=RTP/AVP DTLS=off SDES=off direction=priv direction=pub");
        }
        xlog("L_ALERT", "RTPENGINE_ANSWER rc=$var(rtpe_rc) media_profile=$avp(phone11_media_profile) for call $ci\\n");
'''
if answer_old not in text and 'media_profile=$avp(phone11_media_profile)' not in text:
    raise SystemExit("Could not find expected rtpengine_answer block")
if answer_old in text:
    text = text.replace(answer_old, answer_new)

dst.write_text(text)
PY

section "patched media route"
grep -nE "route\\[TO_FREESWITCH\\]|onreply_route\\[FREESWITCH_REPLY\\]|rtpengine_offer|rtpengine_answer|transport-protocol|DTLS|SDES|phone11_media_profile" \
  "$BACKUP_DIR/kamailio.cfg.after" | redact || true

docker cp "$BACKUP_DIR/kamailio.cfg.after" "$KAMAILIO_CONTAINER:/tmp/kamailio.cfg.phone11-native-pjsip-candidate"

run "Kamailio candidate config syntax check" docker exec "$KAMAILIO_CONTAINER" kamailio -c -f /tmp/kamailio.cfg.phone11-native-pjsip-candidate

docker cp "$BACKUP_DIR/kamailio.cfg.after" "$KAMAILIO_CONTAINER:$KAMAILIO_CFG"

section "restart Kamailio"
docker restart "$KAMAILIO_CONTAINER" 2>&1 | redact
sleep 5

CONTAINER_STATE="$(container_state)"
echo "container_state=$CONTAINER_STATE"
if ! echo "$CONTAINER_STATE" | grep -q '^true false '; then
  echo "ERROR: Kamailio did not stay running. Rolling back config."
  docker cp "$BACKUP_DIR/kamailio.cfg.before" "$KAMAILIO_CONTAINER:$KAMAILIO_CFG" || true
  docker restart "$KAMAILIO_CONTAINER" || true
  docker logs --tail 120 "$KAMAILIO_CONTAINER" 2>&1 | redact || true
  exit 41
fi

run "Kamailio restart logs" docker logs --tail 80 "$KAMAILIO_CONTAINER"
run "live media route after restart" docker exec "$KAMAILIO_CONTAINER" sh -lc \
  "grep -nE 'route\\[TO_FREESWITCH\\]|onreply_route\\[FREESWITCH_REPLY\\]|rtpengine_offer|rtpengine_answer|transport-protocol|DTLS|SDES|phone11_media_profile' '$KAMAILIO_CFG'"

section "fix complete"
echo "backup_dir=$BACKUP_DIR"
echo "time_utc=$(date -u -Iseconds)"
