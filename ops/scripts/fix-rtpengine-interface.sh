#!/usr/bin/env bash
set -Eeuo pipefail

PUBLIC_IP="${PUBLIC_IP:-43.210.122.111}"
PRIVATE_IP="${PRIVATE_IP:-}"
RTPENGINE_CONTAINER="${RTPENGINE_CONTAINER:-p11-rtpengine}"
RTPENGINE_IMAGE="${RTPENGINE_IMAGE:-drachtio/rtpengine:latest}"
KAMAILIO_CONTAINER="${KAMAILIO_CONTAINER:-p11-kamailio}"
PORT_MIN="${PORT_MIN:-20000}"
PORT_MAX="${PORT_MAX:-30000}"
LISTEN_NG="${LISTEN_NG:-127.0.0.1:22222}"
LISTEN_HTTP="${LISTEN_HTTP:-127.0.0.1:22223}"

redact() {
  sed -E \
    -e 's#(AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|PGPASSWORD|DB_PASSWORD|POSTGRES_PASSWORD|JWT_SECRET|SIP_PASSWORD|PASSWORD|SECRET|TOKEN)=([^[:space:]]+)#\1=<redacted>#Ig' \
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

if [ -z "$PRIVATE_IP" ]; then
  PRIVATE_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1; i<=NF; i++) if ($i=="src") {print $(i+1); exit}}')"
fi

if [ -z "$PRIVATE_IP" ]; then
  echo "ERROR: Could not auto-detect private IP. Set PRIVATE_IP explicitly."
  exit 40
fi

if ! [[ "$PRIVATE_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "ERROR: PRIVATE_IP is not an IPv4 address: $PRIVATE_IP"
  exit 41
fi

if ! [[ "$PUBLIC_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "ERROR: PUBLIC_IP is not an IPv4 address: $PUBLIC_IP"
  exit 42
fi

if ! [[ "$PORT_MIN" =~ ^[0-9]+$ ]] || ! [[ "$PORT_MAX" =~ ^[0-9]+$ ]] || [ "$PORT_MIN" -ge "$PORT_MAX" ]; then
  echo "ERROR: Invalid RTP port range: $PORT_MIN-$PORT_MAX"
  exit 43
fi

BACKUP_SUFFIX="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="/tmp/phone11-rtpengine-fix-${BACKUP_SUFFIX}"
BACKUP_CONTAINER="${RTPENGINE_CONTAINER}-before-${BACKUP_SUFFIX}"
PRIOR_BACKUP_CONTAINER="$(docker ps -a --format '{{.Names}}' | grep -E "^${RTPENGINE_CONTAINER}-before-" | sort | tail -n 1 || true)"
mkdir -p "$BACKUP_DIR"

rollback_rtpengine() {
  local reason="$1"
  echo "ERROR: $reason. Rolling back."
  docker logs --tail 120 "$RTPENGINE_CONTAINER" 2>&1 | redact || true
  docker rm -f "$RTPENGINE_CONTAINER" >/dev/null 2>&1 || true
  if [ -n "$PRIOR_BACKUP_CONTAINER" ] && docker ps -a --format '{{.Names}}' | grep -qx "$PRIOR_BACKUP_CONTAINER"; then
    docker rename "$PRIOR_BACKUP_CONTAINER" "$RTPENGINE_CONTAINER"
    docker start "$RTPENGINE_CONTAINER"
    echo "Rolled back to prior backup container: $PRIOR_BACKUP_CONTAINER"
  else
    docker rename "$BACKUP_CONTAINER" "$RTPENGINE_CONTAINER"
    docker start "$RTPENGINE_CONTAINER"
    echo "Rolled back to current-run backup container: $BACKUP_CONTAINER"
  fi
}

section "Phone11 RTPEngine interface fix"
echo "time_utc=$(date -u -Iseconds)"
echo "public_ip=$PUBLIC_IP"
echo "private_ip=$PRIVATE_IP"
echo "rtpengine_container=$RTPENGINE_CONTAINER"
echo "backup_container=$BACKUP_CONTAINER"
echo "rtpengine_image=$RTPENGINE_IMAGE"
echo "rtp_port_range=${PORT_MIN}-${PORT_MAX}"
echo "listen_ng=$LISTEN_NG"
echo "listen_http=$LISTEN_HTTP"
echo "prior_backup_container=${PRIOR_BACKUP_CONTAINER:-none}"

run "current RTPEngine container" docker inspect \
  --format 'name={{.Name}} image={{.Config.Image}} network={{.HostConfig.NetworkMode}} cmd={{json .Config.Cmd}} restart={{.HostConfig.RestartPolicy.Name}}' \
  "$RTPENGINE_CONTAINER"
docker inspect "$RTPENGINE_CONTAINER" > "$BACKUP_DIR/${RTPENGINE_CONTAINER}.inspect.json"

if docker ps --format '{{.Names}}' | grep -qx "$KAMAILIO_CONTAINER"; then
  run "Kamailio media route evidence" docker exec "$KAMAILIO_CONTAINER" sh -lc \
    'grep -nE "rtpengine_sock|rtpengine_offer|rtpengine_answer|direction=pub|direction=priv" /etc/kamailio/kamailio.cfg || true'
fi

section "replace RTPEngine container"
docker stop "$RTPENGINE_CONTAINER" 2>&1 | redact
docker rename "$RTPENGINE_CONTAINER" "$BACKUP_CONTAINER" 2>&1 | redact

set +e
docker run -d \
  --name "$RTPENGINE_CONTAINER" \
  --restart unless-stopped \
  --network host \
  --privileged \
  "$RTPENGINE_IMAGE" \
  rtpengine \
  "--interface=pub/${PRIVATE_IP}!${PUBLIC_IP}" \
  "--interface=priv/${PRIVATE_IP}" \
  "--listen-ng=${LISTEN_NG}" \
  "--listen-http=${LISTEN_HTTP}" \
  "--port-min=${PORT_MIN}" \
  "--port-max=${PORT_MAX}" \
  --log-level=4 \
  --foreground
START_RC=$?
set -e

if [ "$START_RC" -ne 0 ]; then
  rollback_rtpengine "New RTPEngine container failed to start"
  exit 44
fi

sleep 8

CONTAINER_STATE="$(docker inspect --format '{{.State.Running}} {{.State.Restarting}} {{.RestartCount}} {{.State.ExitCode}}' "$RTPENGINE_CONTAINER" 2>/dev/null || true)"
echo "container_state=$CONTAINER_STATE"
if ! echo "$CONTAINER_STATE" | grep -q '^true false '; then
  rollback_rtpengine "New RTPEngine container is not stable"
  exit 45
fi
run "candidate RTPEngine logs" docker logs --tail 120 "$RTPENGINE_CONTAINER"
SOCKET_SNAPSHOT="$(ss -lunp 2>/dev/null | grep -E '(:5060|:5080|:22222|:22223|:20000|:30000)' || true)"
section "candidate host SIP/RTP/control sockets"
printf '%s\n' "${SOCKET_SNAPSHOT:-<no matching sockets>}"
if ! printf '%s\n' "$SOCKET_SNAPSHOT" | grep -Eq '127[.]0[.]0[.]1:22222|localhost:22222'; then
  rollback_rtpengine "New RTPEngine control socket did not open on 127.0.0.1:22222"
  exit 46
fi

run "new RTPEngine container" docker inspect \
  --format 'name={{.Name}} image={{.Config.Image}} network={{.HostConfig.NetworkMode}} cmd={{json .Config.Cmd}} restart={{.HostConfig.RestartPolicy.Name}}' \
  "$RTPENGINE_CONTAINER"
run "new RTPEngine logs" docker logs --tail 120 "$RTPENGINE_CONTAINER"
run "host SIP/RTP/control sockets" sh -lc "ss -lunpt 2>/dev/null | grep -E '(:5060|:5080|:22222|:${PORT_MIN}|:${PORT_MAX}|:20000|:30000)' || true"

section "rollback note"
echo "Old container kept as: $BACKUP_CONTAINER"
if [ -n "$PRIOR_BACKUP_CONTAINER" ]; then
  echo "Prior backup still present as: $PRIOR_BACKUP_CONTAINER"
fi
echo "Inspect backup saved under: $BACKUP_DIR"
echo "Rollback command if needed: docker rm -f $RTPENGINE_CONTAINER && docker rename $BACKUP_CONTAINER $RTPENGINE_CONTAINER && docker start $RTPENGINE_CONTAINER"

section "fix complete"
echo "time_utc=$(date -u -Iseconds)"
