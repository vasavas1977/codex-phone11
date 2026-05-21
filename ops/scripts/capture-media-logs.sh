#!/usr/bin/env bash
set -Eeuo pipefail

SINCE_MINUTES="${SINCE_MINUTES:-90}"
EXTENSION="${EXTENSION:-1001}"
DESTINATION="${DESTINATION:-020303988}"

redact() {
  sed -E \
    -e 's#(Authorization: Bearer )[A-Za-z0-9._~+/=-]+#\1<redacted>#g' \
    -e 's#(AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|PGPASSWORD|DB_PASSWORD|POSTGRES_PASSWORD|JWT_SECRET|SIP_PASSWORD|PASSWORD|SECRET|TOKEN)=([^[:space:]]+)#\1=<redacted>#Ig' \
    -e 's#(password|passwd|pwd|secret|token|authorization)([=:][[:space:]]*)[^[:space:],;]+#\1\2<redacted>#Ig' \
    -e 's#(postgres(ql)?://[^:[:space:]]+):[^@[:space:]]+@#\1:<redacted>@#Ig'
}

section() {
  printf '\n===== %s =====\n' "$1"
}

run() {
  local label="$1"
  shift
  section "$label"
  "$@" 2>&1 | redact || true
}

container_names() {
  docker ps --format '{{.Names}}' 2>/dev/null | grep -E \
    '(^p11-|^cp11-|kamailio|freeswitch|rtpengine|rtp-engine|rtp_engine|redis|backend)' || true
}

container_for() {
  local pattern="$1"
  container_names | grep -Ei "$pattern" | head -n 1 || true
}

egrep_escape() {
  printf '%s' "$1" | sed -E 's/[][(){}.^$*+?|\\]/\\&/g'
}

container_logs() {
  local name="$1"
  section "docker logs: ${name} since ${SINCE_MINUTES}m"
  docker logs --since "${SINCE_MINUTES}m" --timestamps "$name" 2>&1 | redact || true
}

exec_in_container() {
  local name="$1"
  local label="$2"
  shift 2
  section "${label}: ${name}"
  docker exec "$name" sh -lc "$*" 2>&1 | redact || true
}

section "Phone11 media log capture"
echo "time_utc=$(date -u -Iseconds)"
if date -u -d "${SINCE_MINUTES} minutes ago" -Iseconds >/dev/null 2>&1; then
  echo "window_start_utc=$(date -u -d "${SINCE_MINUTES} minutes ago" -Iseconds)"
fi
echo "host=$(hostname)"
echo "since_minutes=${SINCE_MINUTES}"
echo "extension=${EXTENSION}"
echo "destination=${DESTINATION}"

run "docker containers" docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
run "listening SIP and RTP sockets" sh -lc "ss -lunpt 2>/dev/null | grep -E '(:5060|:5080|:5061|:8088|:20000|:30000|:40000|:50000)' || true"

mapfile -t CONTAINERS < <(container_names)
if [ "${#CONTAINERS[@]}" -eq 0 ]; then
  section "no matching containers"
  echo "No Phone11 SIP/media containers matched on this host."
else
  for name in "${CONTAINERS[@]}"; do
    container_logs "$name"
  done
fi

KAMAILIO_CONTAINER="$(container_for 'kamailio')"
FREESWITCH_CONTAINER="$(container_for 'freeswitch')"
RTPENGINE_CONTAINER="$(container_for 'rtpengine|rtp-engine|rtp_engine')"

if [ -n "$KAMAILIO_CONTAINER" ]; then
  exec_in_container "$KAMAILIO_CONTAINER" "Kamailio user location" \
    'if command -v kamcmd >/dev/null 2>&1; then kamcmd ul.dump; else echo "kamcmd not found"; fi'
  exec_in_container "$KAMAILIO_CONTAINER" "Kamailio dialogs" \
    'if command -v kamcmd >/dev/null 2>&1; then kamcmd dlg.list || kamcmd dialog.list || true; else echo "kamcmd not found"; fi'
fi

if [ -n "$FREESWITCH_CONTAINER" ]; then
  exec_in_container "$FREESWITCH_CONTAINER" "FreeSWITCH status" \
    'if command -v fs_cli >/dev/null 2>&1; then fs_cli -x "status"; else echo "fs_cli not found"; fi'
  exec_in_container "$FREESWITCH_CONTAINER" "FreeSWITCH Sofia status" \
    'if command -v fs_cli >/dev/null 2>&1; then fs_cli -x "sofia status"; else echo "fs_cli not found"; fi'
  exec_in_container "$FREESWITCH_CONTAINER" "FreeSWITCH active calls" \
    'if command -v fs_cli >/dev/null 2>&1; then fs_cli -x "show calls"; fs_cli -x "show channels"; else echo "fs_cli not found"; fi'
fi

if [ -n "$RTPENGINE_CONTAINER" ]; then
  exec_in_container "$RTPENGINE_CONTAINER" "RTPEngine session list" \
    'for cmd in "rtpengine-ctl list active" "rtpengine-ctl list sessions" "ngcp-rtpengine-ctl list active" "ngcp-rtpengine-ctl list all"; do echo "$ $cmd"; sh -lc "$cmd" || true; done'
fi

section "focused SIP/media timeline"
EXTENSION_PATTERN="$(egrep_escape "$EXTENSION")"
DESTINATION_PATTERN="$(egrep_escape "${DESTINATION:-__phone11_no_destination_filter__}")"
FOCUS_PATTERN="${EXTENSION_PATTERN}|${DESTINATION_PATTERN}|INVITE|ACK|BYE|CANCEL|REGISTER|200 OK|401|403|407|488|rtp|srtp|codec|media|answer|offer|ICE|DTLS|audio|SDP|RTPENGINE"
if [ "${#CONTAINERS[@]}" -gt 0 ]; then
  for name in "${CONTAINERS[@]}"; do
    echo "--- ${name} ---"
    docker logs --since "${SINCE_MINUTES}m" --timestamps "$name" 2>&1 \
      | grep -Ei "$FOCUS_PATTERN" \
      | redact || true
  done
fi

section "capture complete"
echo "time_utc=$(date -u -Iseconds)"
