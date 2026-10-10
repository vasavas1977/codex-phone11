#!/usr/bin/env python3
"""Narrow admission-diagnostics hotfix route, using the sealed mainline operator.

The candidate must be separately source-reviewed, workerless and prepared with
phone11-mainline-release-start.py. This operator keeps its complete source,
image/bundle, runtime-role, predecessor, baseline/recovery, Nginx and wake pins.
Only the two sealed tRPC directives move from 3016 to the candidate port.

Acceptance is limited to pinned runtime health and an anonymous meetings.join
401/UNAUTHORIZED rejection. No authenticated API, schema/provisioning, database,
provider admission or token mint probe is permitted. The reviewed candidate's
protectedProcedure must reject anonymous callers before the join resolver.
The HTTP client sends fixed headers and a synthetic UUID, never credentials,
and does not retain cookies or follow redirects. Each exchange has a five-second
wall deadline, five-second socket idle timeout and 16 KiB response limit.
Public health identifies the
retained baseline worker; it does not identify the tRPC candidate. These probes
do not establish successful admission, billing recovery or media/device behavior.

Root-only fixture (no configurable requests), sealed by --probes-sha256:
{"schema":"phone11-admission-hotfix-probes/v1","candidate_port":3020,
 "candidate_build":"reviewed-build","public_build":"pinned-baseline-build",
 "public_role":"default"}
Use prepare/activate/rollback/recover with the same arguments as the mainline
route operator. Receipts use a separate schema and root and are not compatible
with its authenticated-probe receipts. Runtime execution needs operator authority.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import http.client
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import socket
import sys
import threading
import time
from typing import Any, Iterator
from urllib.parse import urlsplit

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("phone11_admission_hotfix_route_core", HERE / "phone11-mainline-release-route.py")
if spec is None or spec.loader is None:
    raise RuntimeError("helper_missing")
route = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = route
spec.loader.exec_module(route)
start = route.start
SCHEMA = "phone11-admission-hotfix-ec2-route/v1"
FIXTURE_SCHEMA = "phone11-admission-hotfix-probes/v1"
ROOT = Path("/var/lib/phone11-admission-hotfix-release-route")
PUBLIC_ORIGIN = "https://api.phone11.ai"
JOIN_BODY = b'{"json":{"meetingId":"00000000-0000-4000-8000-000000000000"}}'
MAX_RESPONSE = 16_384
HTTP_DEADLINE_SECONDS = 5


def fixture(path: Path, expected_sha: str, pins: dict[str, Any] | None = None) -> dict[str, Any]:
    raw = route.root_file(path)
    start.require(start.SHA.fullmatch(expected_sha) is not None
                  and len(raw) <= 4_096 and start.digest(raw) == expected_sha, "hotfix_fixture")
    value = json.loads(raw)
    start.require(isinstance(value, dict) and set(value) ==
                  {"schema", "candidate_port", "candidate_build", "public_build", "public_role"}
                  and value["schema"] == FIXTURE_SCHEMA, "hotfix_fixture")
    start.require(type(value["candidate_port"]) is int and 1024 <= value["candidate_port"] <= 65535
                  and value["candidate_port"] not in {3000, 3004, 3016, 3018}
                  and value["public_role"] == "default"
                  and all(isinstance(value[key], str) and re.fullmatch(r"[A-Za-z0-9._-]{1,80}", value[key])
                          for key in ("candidate_build", "public_build")), "hotfix_fixture")
    if pins is not None:
        start.require(value["candidate_port"] == pins["candidate"]["port"]
                      and value["candidate_build"] == pins["candidate"]["build"]
                      and value["public_build"] == pins["baseline"]["build"]
                      and value["public_role"] == pins["baseline"]["role"], "hotfix_fixture_pin")
    return value


@contextmanager
def http_deadline() -> Iterator[None]:
    """Linux main-thread wall deadline; progress cannot reset the probe budget."""
    start.require(threading.current_thread() is threading.main_thread()
                  and all(hasattr(signal, key) for key in ("SIGALRM", "ITIMER_REAL", "getitimer", "setitimer")),
                  "hotfix_deadline_support")
    previous_handler = signal.getsignal(signal.SIGALRM)
    start.require(previous_handler in (signal.SIG_DFL, signal.SIG_IGN) or callable(previous_handler),
                  "hotfix_deadline_support")
    previous_timer = signal.getitimer(signal.ITIMER_REAL)
    began = time.monotonic()
    def expire(_signum, _frame):
        raise start.Refused("hotfix_probe_deadline")
    signal.signal(signal.SIGALRM, expire)
    try:
        # An existing earlier alarm must not be delayed by this operation.
        seconds = min(HTTP_DEADLINE_SECONDS, previous_timer[0]) if previous_timer[0] > 0 else HTTP_DEADLINE_SECONDS
        signal.setitimer(signal.ITIMER_REAL, seconds)
        yield
    finally:
        try:
            signal.setitimer(signal.ITIMER_REAL, 0)
        finally:
            signal.signal(signal.SIGALRM, previous_handler)
            remaining = max(0.000001, previous_timer[0] - (time.monotonic() - began)) if previous_timer[0] > 0 else 0
            signal.setitimer(signal.ITIMER_REAL, remaining, previous_timer[1])


def request(origin: str, method: str, path: str, body: bytes | None = None) -> tuple[int, bytes]:
    """Direct bounded HTTP only: no ambient auth, proxy, cookie jar or redirects."""
    parsed = urlsplit(origin)
    connection_type = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
    with http_deadline():
        connection = connection_type(parsed.hostname, parsed.port, timeout=5)
        try:
            headers = {"Accept": "application/json", "Connection": "close"}
            if body is not None:
                headers["Content-Type"] = "application/json"
            connection.request(method, path, body=body, headers=headers)
            response = connection.getresponse()
            raw = response.read(MAX_RESPONSE + 1)
            start.require(len(raw) <= MAX_RESPONSE, "hotfix_probe_size")
            return response.status, raw
        except (OSError, http.client.HTTPException, socket.timeout) as error:
            raise start.Refused("hotfix_probe_transport") from error
        finally:
            connection.close()


def probes(path: Path, expected_sha: str, origin: str) -> None:
    value = fixture(path, expected_sha)
    candidate_origin = f"http://127.0.0.1:{value['candidate_port']}"
    start.require(origin in {candidate_origin, PUBLIC_ORIGIN}, "hotfix_probe_origin")
    candidate = origin == candidate_origin
    status, raw = request(origin, "GET", "/api/health")
    health = json.loads(raw)
    start.require(status == 200 and isinstance(health, dict) and health.get("ok") is True
                  and health.get("service") == "phone11-backend"
                  and health.get("build") == value["candidate_build" if candidate else "public_build"]
                  and (health.get("runtimeRole") == "api-candidate" if candidate else
                       (health.get("runtimeRole") == value["public_role"] or "runtimeRole" not in health)),
                  "hotfix_health")
    status, raw = request(origin, "POST", "/api/trpc/meetings.join", JOIN_BODY)
    result = json.loads(raw)
    error = result.get("error") if isinstance(result, dict) and set(result) == {"error"} else None
    payload = error.get("json") if isinstance(error, dict) and set(error) == {"json"} else None
    data = payload.get("data") if isinstance(payload, dict) else None
    start.require(status == 401 and isinstance(payload, dict) and payload.get("code") == -32001
                  and isinstance(data, dict) and data.get("code") == "UNAUTHORIZED"
                  and data.get("httpStatus") == 401 and data.get("path") == "meetings.join", "hotfix_join_rejection")


# A private module instance preserves the existing operator and all its guards.
route.SCHEMA, route.ROOT, route.probes = SCHEMA, ROOT, probes


def prepare(pins: dict[str, Any], receipt: Path, path: Path, expected_sha: str) -> Path:
    fixture(path, expected_sha, pins)
    return route.prepare(pins, receipt, path, expected_sha)


def activate(pins: dict[str, Any], directory: Path, path: Path, origin: str) -> None:
    record, _, _ = route.sealed(directory, "prepared", pins)
    fixture(path, record["fixture_sha256"], pins)
    route.activate(pins, directory, path, origin)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "activate", "rollback", "recover"))
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--start-receipt", type=Path)
    parser.add_argument("--receipt-dir", type=Path)
    parser.add_argument("--probes-file", type=Path)
    parser.add_argument("--probes-sha256")
    parser.add_argument("--public-origin", default=PUBLIC_ORIGIN)
    args = parser.parse_args()
    fd = None
    try:
        start.require(os.geteuid() == 0, "root_required")
        fd = start.lock()
        pins = start.manifest(args.manifest)
        if args.action == "prepare":
            start.require(args.start_receipt is not None and args.probes_file is not None
                          and args.probes_sha256 is not None, "arguments")
            print(prepare(pins, args.start_receipt, args.probes_file, args.probes_sha256))
        else:
            start.require(args.receipt_dir is not None, "arguments")
            if args.action == "activate":
                start.require(args.probes_file is not None, "arguments")
                activate(pins, args.receipt_dir, args.probes_file, args.public_origin)
            elif args.action == "rollback":
                route.rollback(pins, args.receipt_dir, args.public_origin)
            else:
                route.recover(pins, args.receipt_dir, args.public_origin)
        return 0
    except (start.Refused, route.old.GuardError, OSError, ValueError, KeyError, TypeError):
        print("Phone11 admission hotfix route refused; inspect pinned host state and sealed receipt.", file=sys.stderr)
        return 1
    finally:
        if fd is not None:
            os.close(fd)


if __name__ == "__main__":
    raise SystemExit(main())
