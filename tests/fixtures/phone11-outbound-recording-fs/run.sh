#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
fixture_root="$repo_root/tests/fixtures/phone11-outbound-recording-fs"
image="${PHONE11_FREESWITCH_IMAGE:-sha256:b31c743f4c911a19687c61e3214968f2a24f93f9d3d667cc26284192e158ffc6}"
work="$(mktemp -d "${TMPDIR:-/tmp}/phone11-fs-fixture.XXXXXX")"
container=""

cleanup() {
  if [[ -n "$container" ]]; then
    docker rm -f "$container" >/dev/null 2>&1 || true
  fi
  python3 - "$work" <<'PY'
import shutil, sys
shutil.rmtree(sys.argv[1], ignore_errors=True)
PY
}
trap cleanup EXIT

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "This fixture requires a Linux host because it uses nsenter for an unshared Docker network namespace." >&2
  exit 2
fi
if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this isolated fixture as root so nsenter can join only the fixture network namespace." >&2
  exit 2
fi

docker image inspect "$image" >/dev/null

run_mode() {
  local mode="$1"
  local conf="$work/$mode-conf"
  local result="$work/$mode-result.json"
  local -a fixture_args=(--mode "$mode" --result "$result")
  if [[ "$mode" == "candidate" ]]; then
    fixture_args+=(--baseline "$work/baseline-result.json")
  fi

  python3 -B "$fixture_root/generate_config.py" \
    --repo "$repo_root" --output "$conf" --mode "$mode"
  container="phone11-fs-fixture-$mode-$$"
  docker run --detach --pull never --name "$container" \
    --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=16m \
    --tmpfs /var/lib/freeswitch:rw,nosuid,nodev,size=16m \
    --tmpfs /var/log/freeswitch:rw,nosuid,nodev,noexec,size=8m \
    --tmpfs /var/run/freeswitch:rw,nosuid,nodev,noexec,size=2m \
    --mount "type=bind,src=$conf,dst=/fixture/conf,readonly" \
    --entrypoint /usr/bin/freeswitch \
    "$image" -nf -nonat -conf /fixture/conf -log /var/log/freeswitch -db /var/lib/freeswitch >/dev/null

  local pid
  pid="$(docker inspect --format '{{.State.Pid}}' "$container")"
  if [[ "$pid" == "0" || "$(docker inspect --format '{{.State.Running}}' "$container")" != "true" ]]; then
    docker logs --tail 200 "$container" >&2 || true
    exit 1
  fi
  if ! nsenter --target "$pid" --net -- \
    python3 -B "$fixture_root/fixture.py" "${fixture_args[@]}"; then
    docker logs --tail 200 "$container" >&2 || true
    exit 1
  fi
  docker rm -f "$container" >/dev/null
  container=""
}

run_mode baseline
run_mode candidate
