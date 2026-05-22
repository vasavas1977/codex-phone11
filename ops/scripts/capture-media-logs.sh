#!/usr/bin/env bash
set -Eeuo pipefail

SINCE_MINUTES="${SINCE_MINUTES:-90}"
EXTENSION="${EXTENSION:-1001}"
DESTINATION="${DESTINATION:-020303988}"
INCLUDE_RAW_LOGS="${INCLUDE_RAW_LOGS:-0}"

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

focused_log_excerpt() {
  local name="$1"
  local pattern="$2"
  local label="$3"

  section "${label}: ${name}"
  docker logs --since "${SINCE_MINUTES}m" --timestamps "$name" 2>&1 \
    | grep -Eia "$pattern" \
    | grep -Eiv 'mod_xml_cdr|/api/freeswitch/cdr' \
    | tail -n 160 \
    | redact || true
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
echo "include_raw_logs=${INCLUDE_RAW_LOGS}"

run "docker containers" docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'

mapfile -t CONTAINERS < <(container_names)
KAMAILIO_CONTAINER="$(container_for 'kamailio')"
FREESWITCH_CONTAINER="$(container_for 'freeswitch')"
RTPENGINE_CONTAINER="$(container_for 'rtpengine|rtp-engine|rtp_engine')"

section "focused latest call trace"
EXTENSION_PATTERN="$(egrep_escape "$EXTENSION")"
DESTINATION_PATTERN="$(egrep_escape "${DESTINATION:-__phone11_no_destination_filter__}")"
CALL_TRACE_PATTERN="${EXTENSION_PATTERN}|${DESTINATION_PATTERN}|INVITE|ACK|BYE|CANCEL|REGISTER|180 Ringing|183 Session Progress|200 OK|SIP/2.0|Call-ID|call-id|branch=|to-tag|from-tag|rtpengine|RTPENGINE|offer|answer|SDP|m=audio|c=IN IP4|ICE|DTLS|SRTP|RTP/AVP|RTP/SAVP|RTP/SAVPF|audio|codec|media|sofia|hangup|answered|CHANNEL_ANSWER|EXECUTE|bridge"
if [ "${#CONTAINERS[@]}" -gt 0 ]; then
  for name in "${CONTAINERS[@]}"; do
    focused_log_excerpt "$name" "$CALL_TRACE_PATTERN" "latest call SIP/media excerpt"
  done
fi

run "listening SIP and RTP sockets" sh -lc "ss -lunpt 2>/dev/null | grep -E '(:5060|:5080|:5061|:8088|:20000|:30000|:40000|:50000)' || true"

section "live media config snapshot"
if [ -n "$KAMAILIO_CONTAINER" ]; then
  exec_in_container "$KAMAILIO_CONTAINER" "Kamailio live RTPEngine config snippets" \
    'grep -nE "rtpengine_sock|route\\[TO_FREESWITCH\\]|onreply_route\\[FREESWITCH_REPLY\\]|rtpengine_offer|rtpengine_answer|direction=|ICE=|DTLS|SDES|transport-protocol" /etc/kamailio/kamailio.cfg | sed -E "s#(postgres://)[^:@/]+:[^@]+@#\1<redacted>:<redacted>@#g; s#(secret=)[^&[:space:]]+#\1<redacted>#Ig"'
fi
if [ -n "$RTPENGINE_CONTAINER" ]; then
  run "RTPEngine docker runtime config" \
    sh -lc "docker inspect --format 'name={{.Name}} image={{.Config.Image}} network={{.HostConfig.NetworkMode}} cmd={{json .Config.Cmd}}' '$RTPENGINE_CONTAINER'"
  exec_in_container "$RTPENGINE_CONTAINER" "RTPEngine process command" \
    'ps -eo pid,args | grep -E "[r]tpengine" || true'
  exec_in_container "$RTPENGINE_CONTAINER" "RTPEngine UDP socket sample" \
    'if command -v ss >/dev/null 2>&1; then ss -lunp | head -n 35; else cat /proc/net/udp | head -n 25; fi'
fi

if [ "${#CONTAINERS[@]}" -eq 0 ]; then
  section "no matching containers"
  echo "No Phone11 SIP/media containers matched on this host."
elif [ "$INCLUDE_RAW_LOGS" = "1" ]; then
  for name in "${CONTAINERS[@]}"; do
    container_logs "$name"
  done
fi

if [ -n "$KAMAILIO_CONTAINER" ]; then
  exec_in_container "$KAMAILIO_CONTAINER" "Kamailio live RTPEngine config snippets" \
    'grep -nE "rtpengine_sock|route\\[TO_FREESWITCH\\]|onreply_route\\[FREESWITCH_REPLY\\]|rtpengine_offer|rtpengine_answer|direction=|ICE=|DTLS|SDES|transport-protocol" /etc/kamailio/kamailio.cfg | sed -E "s#(postgres://)[^:@/]+:[^@]+@#\1<redacted>:<redacted>@#g; s#(secret=)[^&[:space:]]+#\1<redacted>#Ig"'
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
  run "RTPEngine docker runtime config" \
    sh -lc "docker inspect --format 'name={{.Name}} image={{.Config.Image}} network={{.HostConfig.NetworkMode}} cmd={{json .Config.Cmd}}' '$RTPENGINE_CONTAINER'"
  exec_in_container "$RTPENGINE_CONTAINER" "RTPEngine process command" \
    'ps -eo pid,args | grep -E "[r]tpengine" || true'
  exec_in_container "$RTPENGINE_CONTAINER" "RTPEngine UDP socket sample" \
    'if command -v ss >/dev/null 2>&1; then ss -lunp | head -n 35; else cat /proc/net/udp | head -n 25; fi'
  exec_in_container "$RTPENGINE_CONTAINER" "RTPEngine session list" \
    'for cmd in "rtpengine-ctl list active" "rtpengine-ctl list sessions" "ngcp-rtpengine-ctl list active" "ngcp-rtpengine-ctl list all"; do echo "$ $cmd"; sh -lc "$cmd" || true; done'
fi

section "focused SIP/media timeline"
EXTENSION_PATTERN="$(egrep_escape "$EXTENSION")"
DESTINATION_PATTERN="$(egrep_escape "${DESTINATION:-__phone11_no_destination_filter__}")"
FOCUS_PATTERN="${EXTENSION_PATTERN}|${DESTINATION_PATTERN}|INVITE|ACK|BYE|CANCEL|REGISTER|180 Ringing|183 Session Progress|200 OK|SIP/2.0|rtp|srtp|codec|media|answer|offer|ICE|DTLS|audio|SDP|RTPENGINE"
if [ "${#CONTAINERS[@]}" -gt 0 ]; then
  for name in "${CONTAINERS[@]}"; do
    echo "--- ${name} ---"
    docker logs --since "${SINCE_MINUTES}m" --timestamps "$name" 2>&1 \
      | grep -Ei "$FOCUS_PATTERN" \
      | grep -Eiv 'mod_xml_cdr|/api/freeswitch/cdr' \
      | tail -n 160 \
      | redact || true
  done
fi

section "capture complete"
echo "time_utc=$(date -u -Iseconds)"
