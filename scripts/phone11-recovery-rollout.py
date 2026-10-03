#!/usr/bin/env python3
"""Additive, fail-closed rollout for Phone11 password recovery.

The operator clones the healthy workerless API candidate onto loopback port
3004, adds recovery configuration from one root-only file, and routes only the
credential sign-in, two recovery writes, and the mobile capability read.  It
never restarts or replaces the baseline or current candidate containers.
"""

from __future__ import annotations

import argparse
import copy
from contextlib import contextmanager
from dataclasses import dataclass
import importlib.util
import json
import os
from pathlib import Path
import re
import socket
import stat
import sys
import tempfile
import time
from typing import Any, Mapping, Sequence


HERE = Path(__file__).resolve().parent
PILOT_PATH = HERE / "phone11-parallel-api-pilot.py"
SPEC = importlib.util.spec_from_file_location("phone11_recovery_shared", PILOT_PATH)
if SPEC is None or SPEC.loader is None:  # pragma: no cover
    raise RuntimeError("parallel operator unavailable")
pilot = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = pilot
SPEC.loader.exec_module(pilot)

SCHEMA = "phone11-recovery-rollout/v1"
SECRET_SCHEMA = "phone11-password-recovery-secrets/v1"
BASELINE_CONTAINER = "cp11-backend"
BASELINE_PORT = 3000
LIVE_CONTAINER = "cp11-api-candidate-next"
LIVE_PORT = 3003
TARGET_CONTAINER = "cp11-password-recovery"
TARGET_SERVICE = "recovery"
TARGET_PORT = 3004
ROLE = "api-candidate"
PUBLIC_ORIGIN = "https://api.phone11.ai"
RESET_UI_ORIGIN = "https://1toall.phone11.ai"
RECOVERY_HEADER = "x-phone11-recovery-candidate"
SERIALIZATION_HEADER = "x-phone11-credential-serialization"
SERIALIZATION_CONTRACT = "pg-advisory-v1"
NGINX_DRAIN_TIMEOUT_SECONDS = 30.0
NGINX_DRAIN_INTERVAL_SECONDS = 0.25
STATE_ROOT = Path("/var/lib/phone11-recovery-rollout")
ROLLBACK_SITE = STATE_ROOT / "nginx.before"
RECEIPT_FILE = STATE_ROOT / "receipt.json"
PHASE_PRE_CONTAINER = "pre_container"
PHASE_PRE_SIGNIN = "pre_signin"
PHASE_SIGNIN_DRAINED = "signin_drained"
PHASE_ROUTED_DRAINED = "routed_drained"
PHASE_ACTIVE = "active"
PHASE_POST_ORIGINAL = "post_original_precleanup"
PHASE_ROLLED_BACK = "rolled_back"
RECEIPT_KEYS = {
    "schema", "phase", "manifest_sha256", "original_sha256", "signin_sha256",
    "routed_sha256", "original_dump_sha256", "signin_dump_sha256",
    "routed_dump_sha256", "baseline_snapshot_sha256", "target_container_id",
    "target_runtime_sha256",
}

GuardError = pilot.GuardError
AtomicWriteError = pilot.AtomicWriteError
System = pilot.System
atomic_write = pilot.atomic_write
canonical_hash = pilot.canonical_hash
candidate_runtime_shape = pilot.candidate_runtime_shape
environment = pilot.environment
exact_keys = pilot.exact_keys
guarded = pilot.guarded
is_image_digest = pilot.is_image_digest
is_sha256 = pilot.is_sha256
one_inspect = pilot.one_inspect
operator_lock = pilot.operator_lock
request_result = pilot.request_result
require_sha256 = pilot.require_sha256
secure_read = pilot.secure_read
sha256_bytes = pilot.sha256_bytes
strict_json = pilot.strict_json


@dataclass(frozen=True)
class RuntimePin:
    container_id: str
    image: str
    runtime_sha256: str
    build: str


@dataclass(frozen=True)
class Pins:
    baseline: RuntimePin
    live: RuntimePin
    release_image: str
    release_build: str
    release_source_sha: str
    release_bundle_sha256: str
    release_lock_sha256: str
    secret_file: Path
    secret_sha256: str
    nginx_site: Path
    nginx_site_sha256: str
    nginx_dump_sha256: str
    nginx_marker: str
    target_project: str
    public_origin: str


def _runtime(value: Any) -> RuntimePin:
    guarded(isinstance(value, Mapping), "manifest")
    exact_keys(value, {"container_id", "image", "runtime_sha256", "build"}, "manifest")
    guarded(isinstance(value.get("container_id"), str) and bool(re.fullmatch(r"[0-9a-f]{64}", value["container_id"])), "manifest")
    guarded(is_image_digest(value.get("image")) and is_sha256(value.get("runtime_sha256")), "manifest")
    guarded(isinstance(value.get("build"), str) and bool(re.fullmatch(r"[A-Za-z0-9_.-]{7,128}", value["build"])), "manifest")
    return RuntimePin(value["container_id"], value["image"], value["runtime_sha256"], value["build"])


def parse_manifest(document: Mapping[str, Any]) -> Pins:
    exact_keys(document, {"schema", "baseline", "live_candidate", "release", "secrets", "nginx", "target", "public_origin"}, "manifest")
    guarded(document.get("schema") == SCHEMA and document.get("public_origin") == PUBLIC_ORIGIN, "manifest")
    baseline, live = _runtime(document.get("baseline")), _runtime(document.get("live_candidate"))
    release, secrets, nginx, target = (document.get(key) for key in ("release", "secrets", "nginx", "target"))
    for value in (release, secrets, nginx, target):
        guarded(isinstance(value, Mapping), "manifest")
    exact_keys(release, {"image", "build", "source_sha", "bundle_sha256", "lock_sha256"}, "manifest")
    exact_keys(secrets, {"file", "sha256"}, "manifest")
    exact_keys(nginx, {"site", "site_sha256", "dump_sha256", "marker"}, "manifest")
    exact_keys(target, {"project"}, "manifest")
    guarded(is_image_digest(release.get("image")) and release["image"] not in {baseline.image, live.image}, "manifest")
    guarded(isinstance(release.get("build"), str) and bool(re.fullmatch(r"[A-Za-z0-9_.-]{7,128}", release["build"])), "manifest")
    guarded(isinstance(release.get("source_sha"), str) and bool(re.fullmatch(r"[0-9a-f]{40}", release["source_sha"])), "manifest")
    guarded(all(is_sha256(release.get(key)) for key in ("bundle_sha256", "lock_sha256")), "manifest")
    guarded(all(is_sha256(value) for value in (secrets.get("sha256"), nginx.get("site_sha256"), nginx.get("dump_sha256"))), "manifest")
    guarded(all(isinstance(value, str) and value.startswith("/") and "\x00" not in value for value in (secrets.get("file"), nginx.get("site"))), "manifest")
    marker = nginx.get("marker")
    guarded(isinstance(marker, str) and marker.startswith("# PHONE11_PARALLEL_API_INSERT ") and "\n" not in marker and "\r" not in marker, "manifest")
    guarded(isinstance(target.get("project"), str) and bool(re.fullmatch(r"[a-z][a-z0-9_-]{7,62}", target["project"])), "manifest")
    guarded(target["project"] not in {"phone11-api-candidate", "phone11-api-candidate-next"}, "manifest")
    return Pins(
        baseline, live, release["image"], release["build"], release["source_sha"],
        release["bundle_sha256"], release["lock_sha256"], Path(secrets["file"]), secrets["sha256"],
        Path(nginx["site"]), nginx["site_sha256"], nginx["dump_sha256"], marker,
        target["project"], document["public_origin"],
    )


def load_pins(path: Path) -> Pins:
    guarded(os.geteuid() == 0, "root")
    return parse_manifest(strict_json(secure_read(path, mode=0o600), "manifest"))


def load_secrets(raw: bytes, expected_sha256: str) -> Mapping[str, str]:
    require_sha256(raw, expected_sha256, "secrets")
    value = strict_json(raw, "secrets")
    exact_keys(value, {"schema", "provider", "resend_api_key", "from"}, "secrets")
    guarded(value.get("schema") == SECRET_SCHEMA and value.get("provider") == "resend", "secrets")
    key, sender = value.get("resend_api_key"), value.get("from")
    guarded(isinstance(key, str) and key.startswith("re_") and 4 <= len(key) <= 256 and not re.search(r"\s", key), "secrets")
    guarded(isinstance(sender, str) and 3 <= len(sender) <= 320 and not re.search(r"[\r\n]", sender), "secrets")
    return {
        "PHONE11_PASSWORD_RESET_PROVIDER": "resend",
        "PHONE11_PASSWORD_RESET_RESEND_API_KEY": key,
        "PHONE11_PASSWORD_RESET_FROM": sender,
    }


def _proxy_location(path: str, build: str) -> str:
    return (
        f"    location = {path} {{\n"
        f"        proxy_pass http://127.0.0.1:{TARGET_PORT};\n"
        "        proxy_http_version 1.1;\n"
        "        proxy_pass_request_headers on;\n"
        "        proxy_set_header Host $host;\n"
        "        proxy_set_header X-Real-IP $remote_addr;\n"
        "        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n"
        "        proxy_set_header X-Forwarded-Proto $scheme;\n"
        f"        add_header X-Phone11-Recovery-Candidate {build} always;\n"
        "    }\n"
    )


def signin_proxy_fragment(marker: str, build: str) -> bytes:
    guarded(bool(re.fullmatch(r"[A-Za-z0-9_.-]{7,128}", build)), "nginx_route")
    return (_proxy_location("/api/auth/sign-in/email", build) + f"    {marker}\n").encode()


def proxy_fragment(marker: str, build: str) -> bytes:
    guarded(bool(re.fullmatch(r"[A-Za-z0-9_.-]{7,128}", build)), "nginx_route")
    paths = (
        "/api/auth/sign-in/email",
        "/api/mobile/config",
        "/api/auth/request-password-reset",
        "/api/auth/reset-password",
    )
    return ("".join(_proxy_location(path, build) for path in paths) + f"    {marker}\n").encode()


def _rewrite(value: Any, old_build: str, new_build: str) -> Any:
    if isinstance(value, str):
        return value.replace(f":{LIVE_PORT}", f":{TARGET_PORT}").replace(f"PORT={LIVE_PORT}", f"PORT={TARGET_PORT}").replace(old_build, new_build)
    if isinstance(value, list):
        return [_rewrite(item, old_build, new_build) for item in value]
    if isinstance(value, Mapping):
        return {key: _rewrite(item, old_build, new_build) for key, item in value.items()}
    return value


def compose_healthcheck(value: Any, old_build: str, new_build: str) -> Mapping[str, Any]:
    guarded(isinstance(value, Mapping), "candidate_config")
    keys = {"Test", "Interval", "Timeout", "Retries", "StartPeriod", "StartInterval"}
    guarded("Test" in value and set(value).issubset(keys), "candidate_config")
    test = value.get("Test")
    guarded(isinstance(test, list) and bool(test) and all(isinstance(item, str) for item in test), "candidate_config")
    result: dict[str, Any] = {"test": _rewrite(test, old_build, new_build)}
    for source, target in (
        ("Interval", "interval"), ("Timeout", "timeout"),
        ("StartPeriod", "start_period"), ("StartInterval", "start_interval"),
    ):
        if source in value:
            duration = value[source]
            guarded(type(duration) is int and duration >= 0, "candidate_config")
            result[target] = f"{duration}ns"
    if "Retries" in value:
        retries = value["Retries"]
        guarded(type(retries) is int and retries >= 0, "candidate_config")
        result["retries"] = retries
    return result


def docker_healthcheck(value: Any) -> Mapping[str, Any]:
    guarded(isinstance(value, Mapping), "target_runtime")
    keys = {"test", "interval", "timeout", "retries", "start_period", "start_interval"}
    guarded("test" in value and set(value).issubset(keys), "target_runtime")
    test = value.get("test")
    guarded(isinstance(test, list) and bool(test) and all(isinstance(item, str) for item in test), "target_runtime")
    result: dict[str, Any] = {"Test": list(test)}
    for source, target in (
        ("interval", "Interval"), ("timeout", "Timeout"),
        ("start_period", "StartPeriod"), ("start_interval", "StartInterval"),
    ):
        if source in value:
            duration = value[source]
            guarded(isinstance(duration, str) and bool(re.fullmatch(r"[0-9]+ns", duration)), "target_runtime")
            result[target] = int(duration[:-2])
    if "retries" in value:
        retries = value["retries"]
        guarded(type(retries) is int and retries >= 0, "target_runtime")
        result["Retries"] = retries
    return result


def cloned_config(inspect: Mapping[str, Any], pins: Pins, secrets: Mapping[str, str]) -> Mapping[str, Any]:
    config, host, networks = inspect.get("Config"), inspect.get("HostConfig"), inspect.get("NetworkSettings", {}).get("Networks")
    guarded(isinstance(config, Mapping) and isinstance(host, Mapping) and isinstance(networks, Mapping), "candidate_config")
    # The live API candidate retains worker/media mounts from its parent
    # Compose service even though api-candidate mode does not use them. They
    # remain source-runtime evidence only: the recovery service below has no
    # volumes entry and owned_target() requires an empty mount list.
    guarded(len(networks) == 1 and isinstance(inspect.get("Mounts"), list), "candidate_config")
    guarded(host.get("NetworkMode") in networks and not host.get("Privileged") and not host.get("CapAdd") and not host.get("Devices"), "candidate_config")
    env = dict(environment(inspect, "candidate_config"))
    guarded(env.get("PHONE11_RUNTIME_ROLE") == ROLE and env.get("PORT") == str(LIVE_PORT) and env.get("PHONE11_BUILD_SHA") == pins.live.build, "candidate_config")
    trusted_origins = {value.strip() for value in env.get("PHONE11_AUTH_TRUSTED_ORIGINS", "").split(",") if value.strip()}
    guarded(RESET_UI_ORIGIN in trusted_origins, "trusted_origin")
    guarded(not any(name in env for name in secrets), "candidate_config")
    env.update(secrets)
    env.update({"PHONE11_RUNTIME_ROLE": ROLE, "PORT": str(TARGET_PORT), "PHONE11_BUILD_SHA": pins.release_build})
    labels = config.get("Labels")
    guarded(labels is None or isinstance(labels, Mapping), "candidate_config")
    replaced_labels = {
        "com.phone11.source-sha",
        "com.phone11.bundle-sha256",
        "com.phone11.lock-sha256",
        "com.phone11.candidate-build",
        "com.phone11.recovery-only",
    }
    retained_labels = {
        key: value for key, value in dict(labels or {}).items()
        if not key.startswith("com.docker.compose.") and key not in replaced_labels
    }
    service: dict[str, Any] = {
        "container_name": TARGET_CONTAINER,
        "image": pins.release_image,
        "environment": {key: value.replace("$", "$$") for key, value in env.items()},
        "ports": [{"host_ip": "127.0.0.1", "published": str(TARGET_PORT), "target": TARGET_PORT, "protocol": "tcp", "mode": "ingress"}],
        "networks": list(networks.keys()),
        "restart": host.get("RestartPolicy", {}).get("Name") or "no",
        "read_only": bool(host.get("ReadonlyRootfs")),
        "healthcheck": compose_healthcheck(config.get("Healthcheck"), pins.live.build, pins.release_build),
        "labels": {**retained_labels, "com.phone11.candidate-build": pins.release_build, "com.phone11.recovery-only": "true"},
    }
    for source, target in (("Entrypoint", "entrypoint"), ("Cmd", "command"), ("User", "user"), ("WorkingDir", "working_dir")):
        if config.get(source) not in (None, "", []):
            service[target] = copy.deepcopy(config[source])
    return {"name": pins.target_project, "services": {TARGET_SERVICE: service}, "networks": {name: {"external": True, "name": name} for name in networks}}


@contextmanager
def frozen_recovery_config(document: Mapping[str, Any]):
    """Yield a root-only Compose snapshot and fail if its secret copy remains."""

    directory = Path(tempfile.mkdtemp(prefix="phone11-password-recovery."))
    path = directory / "compose.json"
    cleanup_error: OSError | None = None
    try:
        os.chmod(directory, 0o700)
        atomic_write(
            path,
            json.dumps(document, sort_keys=True, separators=(",", ":")).encode(),
            mode=0o600,
            uid=0,
            gid=0,
        )
        yield path
    except OSError as error:
        raise GuardError("candidate_config") from error
    finally:
        try:
            path.unlink(missing_ok=True)
        except OSError as error:
            cleanup_error = error
        try:
            directory.rmdir()
        except OSError as error:
            cleanup_error = cleanup_error or error
        if cleanup_error is not None:
            raise GuardError("candidate_config_cleanup") from cleanup_error


def _mobile_config(system: System, origin: str) -> tuple[Mapping[str, Any], Mapping[str, tuple[str, ...]]]:
    result = request_result(system.request(origin, {"method": "GET", "path": "/api/mobile/config", "headers": {"Connection": "close", "Host": "api.phone11.ai"}, "body": "", "_timeout": 10}))
    guarded(result.status == 200 and result.headers.get("cache-control") == ("no-store",), "readiness")
    try:
        body = json.loads(result.body)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise GuardError("readiness") from error
    guarded(isinstance(body, Mapping) and body.get("authProvider") == "phone11" and body.get("emailPasswordEnabled") is True, "readiness")
    guarded(body.get("registrationEnabled") is False, "readiness")
    guarded("re_" not in result.body.decode("utf-8", errors="ignore") and "PHONE11_" not in result.body.decode("utf-8", errors="ignore"), "readiness")
    return body, result.headers


def read_baseline_mobile_config(system: System, origin: str) -> Mapping[str, Any]:
    body, headers = _mobile_config(system, origin)
    guarded(RECOVERY_HEADER not in headers, "readiness")
    availability = body.get("passwordResetAvailability")
    enabled = body.get("passwordResetEnabled")
    guarded(
        (enabled is None and availability is None)
        or (enabled is False and availability == "disabled"),
        "readiness",
    )
    return body


def read_mobile_config(system: System, origin: str, build: str | None = None) -> Mapping[str, Any]:
    body, headers = _mobile_config(system, origin)
    guarded(body.get("passwordResetEnabled") is True and body.get("passwordResetAvailability") == "general", "readiness")
    if build is not None:
        guarded(headers.get(RECOVERY_HEADER) == (build,), "readiness")
    return body


def config_ready(system: System, origin: str, baseline: Mapping[str, Any], build: str | None = None) -> None:
    body = read_mobile_config(system, origin, build)
    recovery_fields = {"passwordResetEnabled", "passwordResetAvailability"}
    guarded(all(body.get(key) == value for key, value in baseline.items() if key not in recovery_fields), "config_compatibility")
    guarded(set(body).issubset(set(baseline) | recovery_fields), "config_compatibility")


def recovery_preflights(system: System, origin: str, build: str | None = None) -> None:
    for path in ("/api/auth/request-password-reset", "/api/auth/reset-password"):
        result = request_result(system.request(origin, {
            "method": "OPTIONS", "path": path,
            "headers": {"Connection": "close", "Origin": RESET_UI_ORIGIN, "Access-Control-Request-Method": "POST"},
            "body": "", "_timeout": 10,
        }))
        guarded(result.status == 204 and result.headers.get("access-control-allow-origin") == (RESET_UI_ORIGIN,), "post_preflight")
        methods = ",".join(result.headers.get("access-control-allow-methods", ()))
        guarded("POST" in {value.strip() for value in methods.split(",")}, "post_preflight")
        if build is not None:
            guarded(result.headers.get(RECOVERY_HEADER) == (build,), "post_preflight")


def credential_serialization_ready(system: System, origin: str, build: str | None = None) -> None:
    result = request_result(system.request(origin, {
        "method": "GET", "path": "/api/auth/sign-in/email",
        "headers": {"Connection": "close", "Host": "api.phone11.ai"},
        "body": "", "_timeout": 10,
    }))
    guarded(
        result.status == 404
        and result.headers.get(SERIALIZATION_HEADER) == (SERIALIZATION_CONTRACT,),
        "credential_serialization",
    )
    if build is not None:
        guarded(result.headers.get(RECOVERY_HEADER) == (build,), "credential_serialization")


def nginx_worker_pids(system: System) -> set[int]:
    raw = system.command(["ps", "-eo", "pid=,args="])
    workers: set[int] = set()
    try:
        lines = raw.decode("utf-8", errors="strict").splitlines()
    except UnicodeDecodeError as error:
        raise GuardError("nginx_workers") from error
    for raw_line in lines:
        parts = raw_line.strip().split(None, 1)
        if len(parts) != 2 or not parts[1].startswith("nginx: worker process"):
            continue
        guarded(parts[0].isdigit(), "nginx_workers")
        workers.add(int(parts[0]))
    guarded(bool(workers), "nginx_workers")
    return workers


def wait_for_nginx_worker_drain(system: System, old_workers: set[int]) -> None:
    guarded(bool(old_workers), "nginx_drain")
    deadline = time.monotonic() + NGINX_DRAIN_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        current = nginx_worker_pids(system)
        if old_workers.isdisjoint(current):
            return
        time.sleep(min(NGINX_DRAIN_INTERVAL_SECONDS, max(0, deadline - time.monotonic())))
    raise GuardError("nginx_drain")


def baseline_snapshot(system: System) -> list[tuple[int, bytes]]:
    values = []
    for path in ("/api/ready/auth", "/api/auth/me", "/api/auth/sign-out"):
        result = request_result(system.request(PUBLIC_ORIGIN, {"method": "GET", "path": path, "headers": {"Connection": "close"}, "body": "", "_timeout": 10}))
        guarded(100 <= result.status <= 599 and RECOVERY_HEADER not in result.headers, "baseline_probe")
        values.append((result.status, result.body))
    return values


def baseline_snapshot_sha256(system: System) -> str:
    normalized = [
        {"status": status, "body_sha256": sha256_bytes(body)}
        for status, body in baseline_snapshot(system)
    ]
    return canonical_hash(normalized)


def runtime_pin(inspect: Mapping[str, Any], stage: str) -> RuntimePin:
    state = inspect.get("State")
    guarded(isinstance(state, Mapping) and state.get("Running") is True and state.get("Health", {}).get("Status") == "healthy", stage)
    env = environment(inspect, stage)
    guarded(isinstance(env.get("PHONE11_BUILD_SHA"), str), stage)
    return RuntimePin(inspect["Id"], inspect["Image"], canonical_hash(candidate_runtime_shape(inspect)), env["PHONE11_BUILD_SHA"])


def emit_inventory(arguments: argparse.Namespace, system: System) -> None:
    guarded(os.geteuid() == 0 and arguments.output.is_absolute() and not os.path.lexists(arguments.output), "inventory")
    guarded(arguments.secret_file.is_absolute() and arguments.nginx_site.is_absolute(), "inventory")
    baseline, live = one_inspect(system, BASELINE_CONTAINER, "inventory"), one_inspect(system, LIVE_CONTAINER, "inventory")
    baseline_pin, live_pin = runtime_pin(baseline, "inventory"), runtime_pin(live, "inventory")
    guarded(environment(baseline, "inventory").get("PHONE11_RUNTIME_ROLE", "default") == "default", "inventory")
    guarded(environment(live, "inventory").get("PHONE11_RUNTIME_ROLE") == ROLE and environment(live, "inventory").get("PORT") == str(LIVE_PORT), "inventory")
    secret_raw, site_raw = secure_read(arguments.secret_file, mode=0o600), secure_read(arguments.nginx_site)
    secrets = load_secrets(secret_raw, sha256_bytes(secret_raw))
    release = system.json_command(["docker", "image", "inspect", arguments.release_image], "inventory")
    guarded(isinstance(release, list) and len(release) == 1 and release[0].get("Id") == arguments.release_image, "inventory")
    labels = release[0].get("Config", {}).get("Labels")
    guarded(isinstance(labels, Mapping) and labels.get("com.phone11.source-sha") == arguments.release_source_sha, "inventory")
    guarded(all(is_sha256(labels.get(key)) for key in ("com.phone11.bundle-sha256", "com.phone11.lock-sha256")), "inventory")
    markers = re.findall(rb"(?m)^\s*(# PHONE11_PARALLEL_API_INSERT [^\r\n]+)\s*$", site_raw)
    guarded(len(markers) == 1 and b"127.0.0.1:3004" not in site_raw, "inventory")
    marker = markers[0].decode("ascii")
    document = {
        "schema": SCHEMA,
        "baseline": baseline_pin.__dict__, "live_candidate": live_pin.__dict__,
        "release": {"image": arguments.release_image, "build": arguments.release_build, "source_sha": arguments.release_source_sha,
                    "bundle_sha256": labels["com.phone11.bundle-sha256"], "lock_sha256": labels["com.phone11.lock-sha256"]},
        "secrets": {"file": str(arguments.secret_file), "sha256": sha256_bytes(secret_raw)},
        "nginx": {"site": str(arguments.nginx_site), "site_sha256": sha256_bytes(site_raw),
                  "dump_sha256": sha256_bytes(system.command(["nginx", "-T"])), "marker": marker},
        "target": {"project": arguments.target_project}, "public_origin": PUBLIC_ORIGIN,
    }
    pins = parse_manifest(document)
    cloned_config(live, pins, secrets)
    raw = json.dumps(document, sort_keys=True, separators=(",", ":")).encode()
    atomic_write(arguments.output, raw, mode=0o600, uid=0, gid=0)
    print(f"inventory=READY manifest_sha256={sha256_bytes(raw)}")


class Operator:
    def __init__(self, pins: Pins, system: System, manifest_sha256: str) -> None:
        self.pins, self.system, self.manifest_sha256 = pins, system, manifest_sha256
        self.target_config: Mapping[str, Any] | None = None
        self.expected_env: Mapping[str, str] | None = None

    def ensure_state_root(self) -> None:
        try:
            STATE_ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
            info = STATE_ROOT.lstat()
        except OSError as error:
            raise GuardError("state") from error
        guarded(stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode), "state")
        guarded(info.st_uid == os.geteuid() and info.st_gid == os.getegid() and stat.S_IMODE(info.st_mode) == 0o700, "state")

    def validate_receipt(self, value: Mapping[str, Any]) -> dict[str, Any]:
        exact_keys(value, RECEIPT_KEYS, "receipt")
        receipt = dict(value)
        phases = {
            PHASE_PRE_CONTAINER, PHASE_PRE_SIGNIN, PHASE_SIGNIN_DRAINED, PHASE_ROUTED_DRAINED,
            PHASE_ACTIVE, PHASE_POST_ORIGINAL, PHASE_ROLLED_BACK,
        }
        guarded(
            receipt.get("schema") == SCHEMA
            and receipt.get("phase") in phases
            and receipt.get("manifest_sha256") == self.manifest_sha256,
            "receipt",
        )
        for key in (
            "original_sha256", "signin_sha256", "routed_sha256",
            "original_dump_sha256", "baseline_snapshot_sha256",
        ):
            guarded(is_sha256(receipt.get(key)), "receipt")
        target_id = receipt.get("target_container_id")
        target_runtime = receipt.get("target_runtime_sha256")
        guarded(
            (target_id is None and target_runtime is None)
            or (
                isinstance(target_id, str)
                and bool(re.fullmatch(r"[0-9a-f]{64}", target_id))
                and is_sha256(target_runtime)
            ),
            "receipt",
        )
        for key in ("signin_dump_sha256", "routed_dump_sha256"):
            guarded(receipt.get(key) is None or is_sha256(receipt.get(key)), "receipt")
        phase = receipt["phase"]
        if phase in {PHASE_PRE_CONTAINER, PHASE_PRE_SIGNIN}:
            guarded(receipt["signin_dump_sha256"] is None and receipt["routed_dump_sha256"] is None, "receipt")
        elif phase == PHASE_SIGNIN_DRAINED:
            guarded(is_sha256(receipt["signin_dump_sha256"]) and receipt["routed_dump_sha256"] is None, "receipt")
        elif phase in {PHASE_ROUTED_DRAINED, PHASE_ACTIVE}:
            guarded(is_sha256(receipt["signin_dump_sha256"]) and is_sha256(receipt["routed_dump_sha256"]), "receipt")
        if phase not in {PHASE_PRE_CONTAINER, PHASE_POST_ORIGINAL, PHASE_ROLLED_BACK}:
            guarded(target_id is not None and target_runtime is not None, "receipt")
        if phase == PHASE_PRE_CONTAINER:
            guarded(target_id is None and target_runtime is None, "receipt")
        return receipt

    def load_receipt(self) -> dict[str, Any]:
        return self.validate_receipt(strict_json(secure_read(RECEIPT_FILE, mode=0o600), "receipt"))

    def write_receipt(self, receipt: Mapping[str, Any]) -> dict[str, Any]:
        validated = self.validate_receipt(receipt)
        raw = json.dumps(validated, sort_keys=True, separators=(",", ":")).encode()
        atomic_write(RECEIPT_FILE, raw, mode=0o600, uid=0, gid=0)
        guarded(secure_read(RECEIPT_FILE, mode=0o600) == raw, "receipt")
        return validated

    def advance_receipt(self, receipt: Mapping[str, Any], phase: str, **updates: Any) -> dict[str, Any]:
        next_receipt = {**dict(receipt), **updates, "phase": phase}
        return self.write_receipt(next_receipt)

    def route_bytes(self, original: bytes) -> tuple[bytes, bytes]:
        signin = original.replace(
            self.pins.nginx_marker.encode(),
            signin_proxy_fragment(self.pins.nginx_marker, self.pins.release_build).rstrip(b"\n"),
        )
        routed = original.replace(
            self.pins.nginx_marker.encode(),
            proxy_fragment(self.pins.nginx_marker, self.pins.release_build).rstrip(b"\n"),
        )
        guarded(
            signin != original and signin.count(b"127.0.0.1:3004") == 1
            and routed != original and routed.count(b"127.0.0.1:3004") == 4,
            "nginx_route",
        )
        return signin, routed

    def resume_inputs(self, receipt: Mapping[str, Any], *, verify_baseline: bool = True) -> Mapping[str, Any] | None:
        self.pinned_runtime(BASELINE_CONTAINER, self.pins.baseline, "default", BASELINE_PORT)
        live = self.pinned_runtime(LIVE_CONTAINER, self.pins.live, ROLE, LIVE_PORT)
        self.image()
        secrets = load_secrets(secure_read(self.pins.secret_file, mode=0o600), self.pins.secret_sha256)
        self.target_config = cloned_config(live, self.pins, secrets)
        expected = dict(environment(live, "candidate_config")); expected.update(secrets)
        expected.update({"PHONE11_RUNTIME_ROLE": ROLE, "PORT": str(TARGET_PORT), "PHONE11_BUILD_SHA": self.pins.release_build})
        self.expected_env = expected
        if verify_baseline:
            guarded(baseline_snapshot_sha256(self.system) == receipt["baseline_snapshot_sha256"], "baseline_changed")
        if receipt["phase"] == PHASE_PRE_CONTAINER:
            names = self.system.command(["docker", "ps", "-a", "--format", "{{.Names}}"])
            if TARGET_CONTAINER.encode() not in names.splitlines():
                return None
            return self.owned_target()
        target = self.target()
        guarded(
            target.get("Id") == receipt["target_container_id"]
            and canonical_hash(candidate_runtime_shape(target)) == receipt["target_runtime_sha256"],
            "target_runtime",
        )
        return target

    def pinned_runtime(self, name: str, pin: RuntimePin, role: str, port: int) -> Mapping[str, Any]:
        inspect = one_inspect(self.system, name, stage=f"{role}_runtime")
        guarded(inspect.get("Id") == pin.container_id and inspect.get("Image") == pin.image, f"{role}_runtime")
        guarded(canonical_hash(candidate_runtime_shape(inspect)) == pin.runtime_sha256, f"{role}_runtime")
        env = environment(inspect, f"{role}_runtime")
        guarded(env.get("PHONE11_BUILD_SHA") == pin.build and env.get("PORT", str(port)) == str(port), f"{role}_runtime")
        guarded(env.get("PHONE11_RUNTIME_ROLE", "default") == role, f"{role}_runtime")
        pilot.health(self.system, f"http://127.0.0.1:{port}", pin.build, None if role == "default" else role)
        return inspect

    def image(self) -> None:
        value = self.system.json_command(["docker", "image", "inspect", self.pins.release_image], "image")
        guarded(isinstance(value, list) and len(value) == 1 and value[0].get("Id") == self.pins.release_image, "image")
        labels = value[0].get("Config", {}).get("Labels")
        guarded(isinstance(labels, Mapping) and labels.get("com.phone11.source-sha") == self.pins.release_source_sha, "image")
        guarded(labels.get("com.phone11.bundle-sha256") == self.pins.release_bundle_sha256 and labels.get("com.phone11.lock-sha256") == self.pins.release_lock_sha256, "image")

    def nginx(self) -> bytes:
        raw = secure_read(self.pins.nginx_site)
        require_sha256(raw, self.pins.nginx_site_sha256, "nginx")
        guarded(raw.count(self.pins.nginx_marker.encode()) == 1 and b"127.0.0.1:3004" not in raw, "nginx")
        require_sha256(self.system.command(["nginx", "-T"]), self.pins.nginx_dump_sha256, "nginx")
        return raw

    def prepare(self) -> None:
        self.pinned_runtime(BASELINE_CONTAINER, self.pins.baseline, "default", BASELINE_PORT)
        live = self.pinned_runtime(LIVE_CONTAINER, self.pins.live, ROLE, LIVE_PORT)
        names = self.system.command(["docker", "ps", "-a", "--format", "{{.Names}}"])
        guarded(TARGET_CONTAINER.encode() not in names.splitlines(), "target_absent")
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            sock.bind(("127.0.0.1", TARGET_PORT))
        except OSError as error:
            raise GuardError("target_port") from error
        finally:
            sock.close()
        self.image()
        secrets = load_secrets(secure_read(self.pins.secret_file, mode=0o600), self.pins.secret_sha256)
        self.target_config = cloned_config(live, self.pins, secrets)
        expected = dict(environment(live, "candidate_config")); expected.update(secrets)
        expected.update({"PHONE11_RUNTIME_ROLE": ROLE, "PORT": str(TARGET_PORT), "PHONE11_BUILD_SHA": self.pins.release_build})
        self.expected_env = expected
        self.nginx()
        self.system.command(["nginx", "-t"])
        baseline_snapshot(self.system)
        print(f"prepare=READY build={self.pins.release_build}")

    def owned_target(self) -> Mapping[str, Any]:
        guarded(self.expected_env is not None and isinstance(self.target_config, Mapping), "candidate_config")
        services = self.target_config.get("services")
        guarded(isinstance(services, Mapping) and isinstance(services.get(TARGET_SERVICE), Mapping), "candidate_config")
        service = services[TARGET_SERVICE]
        inspect = one_inspect(self.system, TARGET_CONTAINER, "target_runtime")
        guarded(inspect.get("Image") == self.pins.release_image, "target_runtime")
        guarded(environment(inspect, "target_runtime") == self.expected_env, "target_runtime")
        config = inspect.get("Config", {})
        labels = inspect.get("Config", {}).get("Labels")
        guarded(
            isinstance(labels, Mapping)
            and labels.get("com.docker.compose.project") == self.pins.target_project
            and labels.get("com.docker.compose.service") == TARGET_SERVICE
            and labels.get("com.phone11.source-sha") == self.pins.release_source_sha
            and labels.get("com.phone11.bundle-sha256") == self.pins.release_bundle_sha256
            and labels.get("com.phone11.lock-sha256") == self.pins.release_lock_sha256
            and labels.get("com.phone11.candidate-build") == self.pins.release_build
            and labels.get("com.phone11.recovery-only") == "true",
            "target_runtime",
        )
        host = inspect.get("HostConfig", {})
        networks = inspect.get("NetworkSettings", {}).get("Networks")
        guarded(
            isinstance(config, Mapping) and isinstance(host, Mapping) and isinstance(networks, Mapping)
            and not inspect.get("Mounts")
            and set(networks) == set(service.get("networks", ()))
            and host.get("NetworkMode") in networks
            and not host.get("Privileged") and not host.get("CapAdd") and not host.get("Devices")
            and host.get("RestartPolicy", {}).get("Name") == service.get("restart")
            and bool(host.get("ReadonlyRootfs")) == bool(service.get("read_only"))
            and host.get("PortBindings") == {f"{TARGET_PORT}/tcp": [{"HostIp": "127.0.0.1", "HostPort": str(TARGET_PORT)}]},
            "target_runtime",
        )
        guarded(config.get("Healthcheck") == docker_healthcheck(service.get("healthcheck")), "target_runtime")
        for inspect_key, service_key in (("Entrypoint", "entrypoint"), ("Cmd", "command"), ("User", "user"), ("WorkingDir", "working_dir")):
            if service_key in service:
                guarded(config.get(inspect_key) == service[service_key], "target_runtime")
        return inspect

    def target(self) -> Mapping[str, Any]:
        inspect = self.owned_target()
        state = inspect.get("State")
        guarded(isinstance(state, Mapping) and state.get("Running") is True and state.get("Health", {}).get("Status") == "healthy", "target_runtime")
        pilot.health(self.system, f"http://127.0.0.1:{TARGET_PORT}", self.pins.release_build, ROLE)
        baseline_config = read_baseline_mobile_config(self.system, f"http://127.0.0.1:{LIVE_PORT}")
        config_ready(self.system, f"http://127.0.0.1:{TARGET_PORT}", baseline_config)
        recovery_preflights(self.system, f"http://127.0.0.1:{TARGET_PORT}")
        credential_serialization_ready(self.system, f"http://127.0.0.1:{TARGET_PORT}")
        return inspect

    def wait_target(self) -> Mapping[str, Any]:
        deadline = time.monotonic() + 30.0
        while time.monotonic() < deadline:
            try:
                return self.target()
            except GuardError:
                time.sleep(min(0.25, max(0, deadline - time.monotonic())))
        raise GuardError("target_readiness")

    def transition(self, expected: bytes, replacement: bytes, expected_dump_sha256: str, stage: str) -> str:
        current = secure_read(self.pins.nginx_site)
        guarded(current == expected, stage)
        require_sha256(self.system.command(["nginx", "-T"]), expected_dump_sha256, stage)
        info = self.pins.nginx_site.stat()
        old_workers = nginx_worker_pids(self.system)
        durability_error: AtomicWriteError | None = None
        try:
            atomic_write(self.pins.nginx_site, replacement, mode=info.st_mode & 0o777, uid=info.st_uid, gid=info.st_gid)
        except AtomicWriteError as error:
            if not error.committed:
                raise
            guarded(secure_read(self.pins.nginx_site) == replacement, stage)
            durability_error = error
        self.system.command(["nginx", "-t"])
        self.system.command(["systemctl", "reload", "nginx"])
        wait_for_nginx_worker_drain(self.system, old_workers)
        guarded(secure_read(self.pins.nginx_site) == replacement, stage)
        dump_sha256 = sha256_bytes(self.system.command(["nginx", "-T"]))
        if durability_error is not None:
            raise durability_error
        return dump_sha256

    def restore(self, original: bytes, signin: bytes, routed: bytes, expected_dump_sha256: str | None = None) -> None:
        current = secure_read(self.pins.nginx_site)
        guarded(current in {original, signin, routed}, "rollback")
        dump_sha256 = expected_dump_sha256 or sha256_bytes(self.system.command(["nginx", "-T"]))
        if current == routed:
            dump_sha256 = self.transition(routed, signin, dump_sha256, "rollback_hide_recovery")
            current = signin
        if current == signin:
            self.transition(signin, original, dump_sha256, "rollback_restore_signin")
        guarded(self.nginx() == original, "rollback")

    def cleanup_target(self, expected_id: str | None = None) -> None:
        names = self.system.command(["docker", "ps", "-a", "--format", "{{.Names}}"])
        if TARGET_CONTAINER.encode() not in names.splitlines():
            return
        inspect = one_inspect(self.system, TARGET_CONTAINER, "cleanup")
        guarded(inspect.get("Image") == self.pins.release_image, "cleanup")
        if expected_id is not None:
            guarded(inspect.get("Id") == expected_id, "cleanup")
        self.system.command(["docker", "rm", "-f", inspect["Id"]])
        after = self.system.command(["docker", "ps", "-a", "--format", "{{.Names}}"])
        guarded(TARGET_CONTAINER.encode() not in after.splitlines(), "cleanup")

    def receipt_routes(self, receipt: Mapping[str, Any]) -> tuple[bytes, bytes, bytes]:
        original = secure_read(ROLLBACK_SITE, mode=0o600)
        require_sha256(original, receipt["original_sha256"], "receipt")
        signin, routed = self.route_bytes(original)
        require_sha256(signin, receipt["signin_sha256"], "receipt")
        require_sha256(routed, receipt["routed_sha256"], "receipt")
        return original, signin, routed

    def public_rollback_absent(self) -> None:
        for path in ("/api/mobile/config", "/api/auth/sign-in/email"):
            headers = request_result(self.system.request(PUBLIC_ORIGIN, {
                "method": "GET", "path": path,
                "headers": {"Connection": "close"}, "body": "", "_timeout": 10,
            })).headers
            guarded(RECOVERY_HEADER not in headers, "rollback")

    def rollback_receipt(self, receipt: Mapping[str, Any]) -> dict[str, Any]:
        receipt = self.validate_receipt(receipt)
        original, signin, routed = self.receipt_routes(receipt)
        phase = receipt["phase"]
        names = self.system.command(["docker", "ps", "-a", "--format", "{{.Names}}"])
        target_present = TARGET_CONTAINER.encode() in names.splitlines()
        target_id = receipt["target_container_id"]
        if target_present:
            if phase == PHASE_PRE_CONTAINER:
                target = self.owned_target()
                target_id = target.get("Id")
                guarded(isinstance(target_id, str) and bool(re.fullmatch(r"[0-9a-f]{64}", target_id)), "rollback")
            else:
                target = one_inspect(self.system, TARGET_CONTAINER, "rollback")
                guarded(target.get("Id") == target_id and target.get("Image") == self.pins.release_image, "rollback")
        elif phase not in {PHASE_PRE_CONTAINER, PHASE_POST_ORIGINAL, PHASE_ROLLED_BACK}:
            raise GuardError("rollback")

        if phase == PHASE_ROLLED_BACK:
            guarded(not target_present and self.nginx() == original, "rollback")
            return receipt

        current = secure_read(self.pins.nginx_site)
        guarded(current in {original, signin, routed}, "rollback")
        if phase == PHASE_PRE_CONTAINER:
            guarded(current == original and self.nginx() == original, "rollback")
            self.public_rollback_absent()
            updates: dict[str, Any] = {}
            if target_present:
                updates = {
                    "target_container_id": target_id,
                    "target_runtime_sha256": canonical_hash(candidate_runtime_shape(target)),
                }
            receipt = self.advance_receipt(receipt, PHASE_POST_ORIGINAL, **updates)
        elif phase != PHASE_POST_ORIGINAL:
            current_dump_sha256 = sha256_bytes(self.system.command(["nginx", "-T"]))
            if current == routed:
                self.restore(original, signin, routed, current_dump_sha256)
            elif current == signin:
                self.restore(original, signin, routed, current_dump_sha256)
            else:
                self.transition(original, original, current_dump_sha256, "rollback_confirm_original")
                guarded(self.nginx() == original, "rollback")
            self.public_rollback_absent()
            receipt = self.advance_receipt(receipt, PHASE_POST_ORIGINAL)
        else:
            guarded(self.nginx() == original, "rollback")
            self.public_rollback_absent()

        self.pinned_runtime(BASELINE_CONTAINER, self.pins.baseline, "default", BASELINE_PORT)
        self.pinned_runtime(LIVE_CONTAINER, self.pins.live, ROLE, LIVE_PORT)
        if target_present:
            self.cleanup_target(target_id)
        receipt = self.advance_receipt(receipt, PHASE_ROLLED_BACK)
        return receipt

    def continue_activation(self, receipt: Mapping[str, Any]) -> dict[str, Any]:
        receipt = self.validate_receipt(receipt)
        original, signin, routed = self.receipt_routes(receipt)
        phase = receipt["phase"]
        current = secure_read(self.pins.nginx_site)

        if phase == PHASE_PRE_CONTAINER:
            if current != original:
                self.rollback_receipt(receipt)
                raise GuardError("activation_recovered")
            guarded(self.target_config is not None and self.expected_env is not None, "candidate_config")
            names = self.system.command(["docker", "ps", "-a", "--format", "{{.Names}}"])
            if TARGET_CONTAINER.encode() not in names.splitlines():
                with frozen_recovery_config(self.target_config) as frozen:
                    self.system.command([
                        "docker", "compose", "--project-name", self.pins.target_project,
                        "--project-directory", str(self.pins.secret_file.parent), "-f", str(frozen),
                        "up", "-d", "--no-deps", TARGET_SERVICE,
                    ], timeout=120)
            target = self.wait_target()
            target_id = target.get("Id")
            guarded(isinstance(target_id, str) and bool(re.fullmatch(r"[0-9a-f]{64}", target_id)), "target_runtime")
            receipt = self.advance_receipt(
                receipt, PHASE_PRE_SIGNIN,
                target_container_id=target_id,
                target_runtime_sha256=canonical_hash(candidate_runtime_shape(target)),
            )
            phase = receipt["phase"]

        if phase == PHASE_PRE_SIGNIN:
            if current != original:
                self.rollback_receipt(receipt)
                raise GuardError("activation_recovered")
            signin_dump_sha256 = self.transition(
                original, signin, receipt["original_dump_sha256"], "signin_cutover",
            )
            receipt = self.advance_receipt(
                receipt, PHASE_SIGNIN_DRAINED,
                signin_dump_sha256=signin_dump_sha256,
            )
            phase = receipt["phase"]
            current = signin

        if phase == PHASE_SIGNIN_DRAINED:
            if current != signin:
                self.rollback_receipt(receipt)
                raise GuardError("activation_recovered")
            require_sha256(self.system.command(["nginx", "-T"]), receipt["signin_dump_sha256"], "signin_resume")
            credential_serialization_ready(self.system, PUBLIC_ORIGIN, self.pins.release_build)
            guarded(baseline_snapshot_sha256(self.system) == receipt["baseline_snapshot_sha256"], "baseline_changed")
            self.pinned_runtime(BASELINE_CONTAINER, self.pins.baseline, "default", BASELINE_PORT)
            self.pinned_runtime(LIVE_CONTAINER, self.pins.live, ROLE, LIVE_PORT)
            self.target()
            routed_dump_sha256 = self.transition(
                signin, routed, receipt["signin_dump_sha256"], "recovery_publish",
            )
            receipt = self.advance_receipt(
                receipt, PHASE_ROUTED_DRAINED,
                routed_dump_sha256=routed_dump_sha256,
            )
            phase = receipt["phase"]
            current = routed

        if phase == PHASE_ROUTED_DRAINED:
            if current != routed:
                self.rollback_receipt(receipt)
                raise GuardError("activation_recovered")
            require_sha256(self.system.command(["nginx", "-T"]), receipt["routed_dump_sha256"], "routed_resume")
            baseline_config = read_baseline_mobile_config(self.system, f"http://127.0.0.1:{LIVE_PORT}")
            config_ready(self.system, PUBLIC_ORIGIN, baseline_config, self.pins.release_build)
            recovery_preflights(self.system, PUBLIC_ORIGIN, self.pins.release_build)
            credential_serialization_ready(self.system, PUBLIC_ORIGIN, self.pins.release_build)
            guarded(baseline_snapshot_sha256(self.system) == receipt["baseline_snapshot_sha256"], "baseline_changed")
            self.pinned_runtime(BASELINE_CONTAINER, self.pins.baseline, "default", BASELINE_PORT)
            self.pinned_runtime(LIVE_CONTAINER, self.pins.live, ROLE, LIVE_PORT)
            self.target()
            receipt = self.advance_receipt(receipt, PHASE_ACTIVE)
            phase = receipt["phase"]

        guarded(phase == PHASE_ACTIVE and secure_read(self.pins.nginx_site) == routed, "activation")
        require_sha256(self.system.command(["nginx", "-T"]), receipt["routed_dump_sha256"], "activation")
        return receipt

    def activate(self) -> None:
        if os.path.lexists(RECEIPT_FILE):
            existing = self.load_receipt()
            if existing["phase"] != PHASE_ROLLED_BACK:
                try:
                    self.resume_inputs(existing)
                    self.continue_activation(existing)
                except GuardError as error:
                    try:
                        self.rollback_receipt(self.load_receipt())
                    except GuardError as rollback_error:
                        raise GuardError("rollback_failed") from rollback_error
                    raise error
                print(f"activate=COMPLETE build={self.pins.release_build} routes=4 resumed=1")
                return

        self.prepare()
        guarded(self.target_config is not None and self.expected_env is not None, "candidate_config")
        baseline_sha256 = baseline_snapshot_sha256(self.system)
        original = self.nginx()
        signin, routed = self.route_bytes(original)
        receipt_written = False
        try:
            self.ensure_state_root()
            atomic_write(ROLLBACK_SITE, original, mode=0o600, uid=0, gid=0)
            guarded(secure_read(ROLLBACK_SITE, mode=0o600) == original, "receipt")
            receipt = self.write_receipt({
                "schema": SCHEMA,
                "phase": PHASE_PRE_CONTAINER,
                "manifest_sha256": self.manifest_sha256,
                "original_sha256": sha256_bytes(original),
                "signin_sha256": sha256_bytes(signin),
                "routed_sha256": sha256_bytes(routed),
                "original_dump_sha256": self.pins.nginx_dump_sha256,
                "signin_dump_sha256": None,
                "routed_dump_sha256": None,
                "baseline_snapshot_sha256": baseline_sha256,
                "target_container_id": None,
                "target_runtime_sha256": None,
            })
            receipt_written = True
            self.continue_activation(receipt)
        except GuardError as error:
            try:
                if receipt_written:
                    self.rollback_receipt(self.load_receipt())
            except GuardError as rollback_error:
                raise GuardError("rollback_failed") from rollback_error
            raise error
        print(f"activate=COMPLETE build={self.pins.release_build} routes=4 drains=2")

    def rollback(self) -> None:
        receipt = self.load_receipt()
        if receipt["phase"] == PHASE_PRE_CONTAINER:
            self.resume_inputs(receipt, verify_baseline=False)
        self.rollback_receipt(receipt)
        print("rollback=COMPLETE routes=0")


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    modes = parser.add_mutually_exclusive_group(required=True)
    for mode in ("inventory", "prepare", "activate", "rollback"):
        modes.add_argument(f"--{mode}", action="store_true")
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--secret-file", type=Path)
    parser.add_argument("--nginx-site", type=Path)
    parser.add_argument("--release-image")
    parser.add_argument("--release-build")
    parser.add_argument("--release-source-sha")
    parser.add_argument("--target-project", default="phone11-password-recovery")
    arguments = parser.parse_args(argv)
    if arguments.inventory:
        required = (arguments.output, arguments.secret_file, arguments.nginx_site, arguments.release_image, arguments.release_build, arguments.release_source_sha)
        if any(value is None for value in required) or arguments.manifest is not None:
            parser.error("--inventory requires all inventory inputs and no --manifest")
    elif arguments.manifest is None:
        parser.error("--manifest is required")
    return arguments


def main(argv: Sequence[str]) -> int:
    arguments = parse_args(argv)
    try:
        with operator_lock():
            if arguments.inventory:
                emit_inventory(arguments, System())
                return 0
            raw = secure_read(arguments.manifest, mode=0o600)
            operator = Operator(parse_manifest(strict_json(raw, "manifest")), System(), sha256_bytes(raw))
            if arguments.prepare:
                operator.prepare()
            elif arguments.activate:
                operator.activate()
            else:
                operator.rollback()
        return 0
    except GuardError as error:
        print(f"blocked={error.stage}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
