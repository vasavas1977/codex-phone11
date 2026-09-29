#!/usr/bin/env python3
"""Guarded, workerless EC2 API candidate start. Never changes the public route."""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import secrets
import socket
import stat
import subprocess
import sys
import time
from typing import Any


SCHEMA = "phone11-mainline-ec2-candidate/v1"
PREDECESSOR = "cp11-api-candidate-sip-consistency"
PREDECESSOR_ID = "d25edd3c93db6d464d0cb2548ea07c0af66604694648a77b7aa9ec731997e25f"
PREDECESSOR_IMAGE = "sha256:920f21217b57750184ce546e47a6a9d93dd81787f74ff3bf76fb6faa905534c7"
PREDECESSOR_BUILD = "sip-admin-6180658"
PREDECESSOR_SOURCE = "6180658cfcef558a7f198bcd53aa4da68e3d7cd1"
PREDECESSOR_BUNDLE = "d489be90000d3cdc1c40088c6efb5048d65d44db6a3084ffebb9461ac87f682c"
PREDECESSOR_PORT = 3016
BASELINE = "cp11-backend"
BASELINE_IMAGE = "sha256:d42c70f34d5062bff779c235dd2b6e415bede3b3a86b9de73892acf35b392619"
RECOVERY = "cp11-password-recovery"
SITE_ENABLED = Path("/etc/nginx/sites-enabled/phone11ai")
SITE_SHA = "aa31a27c3d65a0167fb3f8d2aca08b059f86cbec824c0777e73b278169737485"
NGINX_DUMP_SHA = "9515fab03098d66cfbf1d5531fe16f603eb07442633f7dac5382539cecd4badb"
WAKE_URL = b"http://127.0.0.1:3000/api/phone11/wake"
WAKE_CONFIG = Path("/etc/kamailio/kamailio.cfg")
LOCK = Path("/run/phone11-desktop-provisioning-route.lock")
STATE_ROOT = Path("/var/lib/phone11-mainline-release-start")
SHA = re.compile(r"[0-9a-f]{64}\Z")
IMAGE = re.compile(r"sha256:[0-9a-f]{64}\Z")


class Refused(RuntimeError):
    pass


def require(ok: bool, stage: str) -> None:
    if not ok:
        raise Refused(stage)


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def command(*args: str, timeout: int = 20) -> bytes:
    try:
        result = subprocess.run(args, capture_output=True, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise Refused("command_timeout_or_missing") from error
    require(result.returncode == 0 and len(result.stdout) <= 2_000_000, "command_failed")
    return result.stdout


def secure_file(path: Path, *, root: bool = True, max_size: int = 2_000_000) -> bytes:
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1, "file_shape")
    require(not root or (before.st_uid == 0 and before.st_gid == 0 and not before.st_mode & 0o022), "file_owner")
    require(before.st_size <= max_size, "file_size")
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        after = os.fstat(fd)
        require((after.st_dev, after.st_ino, after.st_size) == (before.st_dev, before.st_ino, before.st_size), "file_drift")
        raw = os.read(fd, max_size + 1)
        require(len(raw) <= max_size, "file_size")
        return raw
    finally:
        os.close(fd)


def manifest(path: Path) -> dict[str, Any]:
    require(path.is_absolute(), "manifest_path")
    value = json.loads(secure_file(path))
    require(isinstance(value, dict) and set(value) == {"schema", "predecessor", "baseline", "recovery", "candidate", "nginx", "wake"}, "manifest_shape")
    require(value["schema"] == SCHEMA, "manifest_schema")
    for key, fields in {
        "predecessor": {"container_id", "image", "source_sha", "bundle_sha256", "runtime_sha256"},
        "baseline": {"container_id", "image", "runtime_sha256", "build", "role"},
        "recovery": {"container_id", "image", "runtime_sha256", "build", "role"},
        "candidate": {"image", "source_sha", "bundle_sha256", "lock_sha256", "build", "name", "port"},
        "nginx": {"site_path", "site_sha256", "dump_sha256"},
        "wake": {"config_path", "config_sha256", "reference_count"},
    }.items():
        require(isinstance(value[key], dict) and set(value[key]) == fields, "manifest_shape")
    p, b, r, c, n, w = (value[key] for key in ("predecessor", "baseline", "recovery", "candidate", "nginx", "wake"))
    require(p["container_id"] == PREDECESSOR_ID and p["image"] == PREDECESSOR_IMAGE
            and p["source_sha"] == PREDECESSOR_SOURCE and p["bundle_sha256"] == PREDECESSOR_BUNDLE, "predecessor_pin")
    require(b["image"] == BASELINE_IMAGE and IMAGE.fullmatch(r["image"]), "protected_runtime_pin")
    require(all(re.fullmatch(r"[0-9a-f]{64}", x["container_id"]) for x in (p, b, r)), "container_pin")
    require(all(SHA.fullmatch(x["runtime_sha256"]) for x in (p, b, r)), "runtime_pin")
    require(all(SHA.fullmatch(x) for x in (p["bundle_sha256"], c["bundle_sha256"], c["lock_sha256"], n["site_sha256"], n["dump_sha256"], w["config_sha256"])), "sha_pin")
    require(re.fullmatch(r"[0-9a-f]{40}", p["source_sha"]) is not None, "source_pin")
    require(re.fullmatch(r"[0-9a-f]{40}", c["source_sha"]) is not None and IMAGE.fullmatch(c["image"]), "candidate_pin")
    require(c["image"] != p["image"] and re.fullmatch(r"cp11-api-candidate-[a-z0-9-]{1,50}", c["name"]) is not None and c["name"] != PREDECESSOR, "candidate_identity")
    require(type(c["port"]) is int and 1024 <= c["port"] <= 65535 and c["port"] not in {3000, 3004, PREDECESSOR_PORT}, "candidate_port")
    require(isinstance(c["build"], str) and re.fullmatch(r"[a-zA-Z0-9._-]{1,80}", c["build"]) is not None, "candidate_build")
    require(n["dump_sha256"] == NGINX_DUMP_SHA and n["site_sha256"] == SITE_SHA
            and n["site_path"] == str(SITE_ENABLED), "nginx_pin")
    require(b["role"] == "default" and r["role"] in {"default", "api-candidate"}
            and all(isinstance(x["build"], str) and re.fullmatch(r"[a-zA-Z0-9._-]{1,80}", x["build"]) for x in (b, r)), "protected_role_pin")
    require(Path(n["site_path"]).is_absolute() and Path(w["config_path"]) == WAKE_CONFIG, "path_pin")
    require(type(w["reference_count"]) is int and w["reference_count"] > 0, "wake_pin")
    return value


def inspect(name: str) -> dict[str, Any]:
    value = json.loads(command("docker", "inspect", name))
    require(isinstance(value, list) and len(value) == 1 and isinstance(value[0], dict), "inspect_shape")
    return value[0]


def env_map(container: dict[str, Any]) -> dict[str, str]:
    entries = container.get("Config", {}).get("Env")
    require(isinstance(entries, list), "env_shape")
    values: dict[str, str] = {}
    for entry in entries:
        require(isinstance(entry, str) and "=" in entry, "env_shape")
        key, value = entry.split("=", 1)
        require(bool(key) and key not in values and "\n" not in value and "\r" not in value, "env_shape")
        values[key] = value
    return values


def runtime_hash(container: dict[str, Any]) -> str:
    config, host = container.get("Config", {}), container.get("HostConfig", {})
    canonical = {
        "config": {key: config.get(key) for key in ("User", "Entrypoint", "Cmd", "WorkingDir", "Env")},
        "host": {key: host.get(key) for key in ("NetworkMode", "Privileged", "ReadonlyRootfs", "Memory", "PortBindings", "RestartPolicy", "CapAdd", "CapDrop", "Devices", "PidMode", "IpcMode")},
        "mounts": sorted((str(item.get("Type")), str(item.get("Source")), str(item.get("Destination")), bool(item.get("RW")), str(item.get("Propagation"))) for item in container.get("Mounts", [])),
    }
    return digest(json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode())


def health(port: int, build: str, role: str) -> None:
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    try:
        connection.request("GET", "/api/health")
        response = connection.getresponse()
        raw = response.read(16_385)
        require(response.status == 200 and len(raw) <= 16_384, "health_http")
        value = json.loads(raw)
        require(value.get("ok") is True and value.get("service") == "phone11-backend"
                and value.get("build") == build and value.get("runtimeRole") == role, "health_identity")
    finally:
        connection.close()


def pinned_container(name: str, pin: dict[str, Any], *, port: int, build: str, role: str) -> dict[str, Any]:
    item = inspect(name)
    require(item.get("Name") == "/" + name and item.get("Id") == pin["container_id"] and item.get("Image") == pin["image"], "container_identity")
    state = item.get("State", {})
    require(state.get("Running") is True and (state.get("Health") or {}).get("Status") == "healthy", "container_health")
    require(runtime_hash(item) == pin["runtime_sha256"], "runtime_drift")
    variables = env_map(item)
    require(variables.get("PHONE11_RUNTIME_ROLE", "default") == role and variables.get("PORT") == str(port), "runtime_role")
    health(port, build, role)
    return item


def site_and_wake(pins: dict[str, Any], candidate_port: int | None = None) -> None:
    path = Path(pins["nginx"]["site_path"])
    require(path in {SITE_ENABLED, Path("/etc/nginx/sites-available/phone11ai")}, "site_path")
    if path != SITE_ENABLED:
        require(SITE_ENABLED.is_symlink() and SITE_ENABLED.resolve(strict=True) == path, "enabled_site_link")
    require(digest(secure_file(path)) == pins["nginx"]["site_sha256"], "site_drift")
    dump = command("nginx", "-T")
    require(digest(dump) == pins["nginx"]["dump_sha256"], "nginx_dump_drift")
    if candidate_port is not None:
        require(re.search(rb"(?<![0-9])(?:127\.0\.0\.1|localhost):" + str(candidate_port).encode() + rb"(?![0-9])", dump) is None, "candidate_upstream_collision")
    wake = secure_file(Path(pins["wake"]["config_path"]))
    require(digest(wake) == pins["wake"]["config_sha256"] and wake.count(WAKE_URL) == pins["wake"]["reference_count"], "wake_drift")
    require(command("docker", "exec", "p11-kamailio", "sha256sum", str(WAKE_CONFIG)).decode().split()[0] == pins["wake"]["config_sha256"], "wake_runtime_drift")


def source_runtime(pins: dict[str, Any]) -> dict[str, Any]:
    source = pinned_container(PREDECESSOR, pins["predecessor"], port=PREDECESSOR_PORT, build=PREDECESSOR_BUILD, role="api-candidate")
    labels = source.get("Config", {}).get("Labels") or {}
    require(labels.get("com.phone11.source-sha") == pins["predecessor"]["source_sha"]
            and labels.get("com.phone11.bundle-sha256") == pins["predecessor"]["bundle_sha256"], "source_labels")
    require(command("docker", "exec", PREDECESSOR, "sha256sum", "/app/dist/index.mjs").decode().split()[0] == pins["predecessor"]["bundle_sha256"], "source_bundle")
    host = source["HostConfig"]
    require(host.get("NetworkMode") not in {"host", "none", "bridge", ""} and not host.get("Privileged")
            and not host.get("CapAdd") and not host.get("Devices") and host.get("Memory", 0) > 0
            and host.get("PidMode") in {"", None} and host.get("IpcMode") in {"", None, "private"}, "source_isolation")
    require(host.get("PortBindings") == {f"{PREDECESSOR_PORT}/tcp": [{"HostIp": "127.0.0.1", "HostPort": str(PREDECESSOR_PORT)}]}, "source_binding")
    require(host.get("NanoCpus") in (0, None) and host.get("SecurityOpt") in (None, [])
            and host.get("ReadonlyRootfs") is False and host.get("CapDrop") in (None, []), "unsupported_runtime")
    mounts = source.get("Mounts", [])
    require(isinstance(mounts, list) and all(item.get("Type") == "bind" and Path(item.get("Source", "")).is_absolute() and Path(item.get("Destination", "")).is_absolute() for item in mounts), "source_mounts")
    require(len({item["Destination"] for item in mounts}) == len(mounts), "source_mounts")
    return source


def candidate_image(pins: dict[str, Any], source: dict[str, Any]) -> None:
    image = inspect(pins["candidate"]["image"])
    require(image.get("Id") == pins["candidate"]["image"], "candidate_image")
    labels = image.get("Config", {}).get("Labels") or {}
    candidate = pins["candidate"]
    require(labels.get("com.phone11.source-sha") == candidate["source_sha"]
            and labels.get("com.phone11.bundle-sha256") == candidate["bundle_sha256"]
            and labels.get("com.phone11.lock-sha256") == candidate["lock_sha256"]
            and labels.get("com.phone11.candidate-build") == candidate["build"]
            and labels.get("com.phone11.runtime-role-guard") == "api-candidate", "candidate_labels")
    require(image.get("Os") == "linux" and image.get("Architecture") == "amd64", "candidate_platform")
    for key in ("User", "Entrypoint", "Cmd", "WorkingDir"):
        require(image["Config"].get(key) == source["Config"].get(key), "candidate_runtime")
    require(image["Config"].get("User") == "cloudphone", "candidate_user")
    image_defaults = env_map(image)
    source_vars = env_map(source)
    require(all(key in source_vars and source_vars[key] == value
                for key, value in image_defaults.items() if key not in {"PORT", "PHONE11_BUILD_SHA"}), "image_env_defaults")


def mount_shape(item: dict[str, Any]) -> tuple[Any, ...]:
    return tuple(item.get(key) for key in ("Type", "Source", "Destination", "RW", "Propagation"))


def health_command(port: int, build: str) -> str:
    check = ("const http=require('node:http');http.get('http://127.0.0.1:"
             + str(port) + "/api/health',r=>{let s='';r.on('data',x=>s+=x);"
             + "r.on('end',()=>{try{const b=JSON.parse(s);process.exit(r.statusCode===200&&b.runtimeRole==='api-candidate'&&b.build==='"
             + build + "'?0:1)}catch{process.exit(1)}})}).on('error',()=>process.exit(1))")
    return f'node -e "{check}"'


def check_candidate(pins: dict[str, Any], source: dict[str, Any], expected_id: str) -> None:
    c = pins["candidate"]
    item = inspect(c["name"])
    require(item.get("Name") == "/" + c["name"] and item.get("Id") == expected_id
            and item.get("Image") == c["image"], "candidate_identity")
    state = item.get("State") or {}
    require(state.get("Running") is True and (state.get("Health") or {}).get("Status") == "healthy", "candidate_health")
    expected_env = env_map(source)
    require(expected_env.get("PHONE11_RUNTIME_ROLE") == "api-candidate", "source_role")
    expected_env["PORT"] = str(c["port"])
    expected_env["PHONE11_BUILD_SHA"] = c["build"]
    require(env_map(item) == expected_env, "candidate_env_delta")
    require((item.get("Config", {}).get("Healthcheck") or {}).get("Test") == ["CMD-SHELL", health_command(c["port"], c["build"])], "candidate_healthcheck")
    host, source_host = item.get("HostConfig") or {}, source["HostConfig"]
    binding = {f"{c['port']}/tcp": [{"HostIp": "127.0.0.1", "HostPort": str(c["port"])}]}
    require(host.get("PortBindings") == binding and (item.get("NetworkSettings") or {}).get("Ports", {}).get(f"{c['port']}/tcp") == binding[f"{c['port']}/tcp"], "candidate_binding")
    for key in ("NetworkMode", "Memory", "NanoCpus", "ReadonlyRootfs", "Privileged", "CapAdd", "CapDrop", "SecurityOpt", "Devices", "PidMode", "IpcMode"):
        require(host.get(key) == source_host.get(key), "candidate_isolation")
    require(sorted(mount_shape(x) for x in item.get("Mounts", [])) == sorted(mount_shape(x) for x in source.get("Mounts", [])), "candidate_mounts")
    labels = item.get("Config", {}).get("Labels") or {}
    require(all(labels.get(key) == value for key, value in {
        "com.phone11.source-sha": c["source_sha"],
        "com.phone11.bundle-sha256": c["bundle_sha256"],
        "com.phone11.lock-sha256": c["lock_sha256"],
        "com.phone11.candidate-build": c["build"],
        "com.phone11.runtime-role-guard": "api-candidate",
    }.items()), "candidate_labels")
    require(command("docker", "exec", c["name"], "sha256sum", "/app/dist/index.mjs").decode().split()[0] == c["bundle_sha256"], "candidate_bundle")
    health(c["port"], c["build"], "api-candidate")


def absent_target(name: str, port: int) -> None:
    result = subprocess.run(("docker", "inspect", name), capture_output=True, timeout=20, check=False)
    require(result.returncode == 1 and (b"no such object" in result.stderr.lower() or b"no such container" in result.stderr.lower()), "candidate_presence")
    with socket.socket() as sock:
        sock.settimeout(1)
        require(sock.connect_ex(("127.0.0.1", port)) != 0, "candidate_port_busy")
        try:
            sock.bind(("127.0.0.1", port))
        except OSError as error:
            raise Refused("candidate_port_busy") from error


def create_in_memory(args: list[str], variables: dict[str, str], image: str) -> str:
    require(hasattr(os, "memfd_create"), "memory_env_required")
    fd = os.memfd_create("phone11-mainline-candidate-env", os.MFD_CLOEXEC)
    try:
        with os.fdopen(os.dup(fd), "wb") as stream:
            for key, value in variables.items():
                stream.write(f"{key}={value}\n".encode())
        os.lseek(fd, 0, os.SEEK_SET)
        try:
            result = subprocess.run([*args, "--env-file", f"/proc/self/fd/{fd}", image], capture_output=True, timeout=45, pass_fds=(fd,), check=False)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise Refused("candidate_create_ambiguous") from error
        require(result.returncode == 0, "candidate_create")
        created = result.stdout.decode().strip()
        require(SHA.fullmatch(created), "candidate_id")
        return created
    finally:
        os.close(fd)


def lock():
    fd = os.open(LOCK, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
    info = os.fstat(fd)
    require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and stat.S_IMODE(info.st_mode) == 0o600, "route_lock")
    for _ in range(30):
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            break
        except BlockingIOError:
            time.sleep(0.2)
    else:
        os.close(fd)
        raise Refused("route_lock_busy")
    return fd


def write_receipt(pins: dict[str, Any], created: str) -> Path:
    STATE_ROOT.mkdir(mode=0o700, exist_ok=True)
    info = STATE_ROOT.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and stat.S_IMODE(info.st_mode) == 0o700, "receipt_root")
    path = STATE_ROOT / (created + ".json")
    data = {"schema": SCHEMA, "container_id": created, "image": pins["candidate"]["image"],
            "source_sha": pins["candidate"]["source_sha"], "bundle_sha256": pins["candidate"]["bundle_sha256"],
            "build": pins["candidate"]["build"], "name": pins["candidate"]["name"], "port": pins["candidate"]["port"]}
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        os.write(fd, (json.dumps(data, sort_keys=True) + "\n").encode())
        os.fsync(fd)
    finally:
        os.close(fd)
    return path


def start(pins: dict[str, Any]) -> Path:
    require(os.geteuid() == 0, "root_required")
    site_and_wake(pins, pins["candidate"]["port"])
    pinned_container(BASELINE, pins["baseline"], port=3000, build=pins["baseline"]["build"], role=pins["baseline"]["role"])
    pinned_container(RECOVERY, pins["recovery"], port=3004, build=pins["recovery"]["build"], role=pins["recovery"]["role"])
    source = source_runtime(pins)
    candidate_image(pins, source)
    c = pins["candidate"]
    absent_target(c["name"], c["port"])
    variables = env_map(source)
    require(variables.get("PHONE11_RUNTIME_ROLE") == "api-candidate" and variables.get("PORT") == str(PREDECESSOR_PORT), "source_role")
    variables["PORT"] = str(c["port"])
    variables["PHONE11_BUILD_SHA"] = c["build"]
    host = source["HostConfig"]
    network = host["NetworkMode"]
    args = ["docker", "create", "--name", c["name"], "--restart", "no", "--network", network,
            "--memory", str(host["Memory"]), "-p", f"127.0.0.1:{c['port']}:{c['port']}"]
    for item in source["Mounts"]:
        option = f"type=bind,src={item['Source']},dst={item['Destination']}"
        if not item["RW"]:
            option += ",readonly"
        if item["Propagation"] not in {"", "rprivate"}:
            option += f",bind-propagation={item['Propagation']}"
        args.extend(("--mount", option))
    args.extend(("--health-cmd", health_command(c["port"], c["build"]), "--health-interval", "10s", "--health-timeout", "3s", "--health-start-period", "10s", "--health-retries", "3"))
    operation_token = secrets.token_hex(16)
    args.extend(("--label", f"com.phone11.release-operation={operation_token}"))
    created = None
    try:
        created = create_in_memory(args, variables, c["image"])
        command("docker", "start", created)
        for _ in range(30):
            try:
                health(c["port"], c["build"], "api-candidate")
                if (inspect(c["name"]).get("State", {}).get("Health") or {}).get("Status") == "healthy":
                    break
            except (OSError, json.JSONDecodeError):
                pass
            except Refused as error:
                if str(error) != "health_http":
                    raise
            time.sleep(1)
        else:
            raise Refused("candidate_health")
        check_candidate(pins, source, created)
        site_and_wake(pins, c["port"])
        source_runtime(pins)
        pinned_container(BASELINE, pins["baseline"], port=3000, build=pins["baseline"]["build"], role=pins["baseline"]["role"])
        pinned_container(RECOVERY, pins["recovery"], port=3004, build=pins["recovery"]["build"], role=pins["recovery"]["role"])
        command("docker", "update", "--restart", "unless-stopped", c["name"])
        check_candidate(pins, source, created)
        require((inspect(c["name"]).get("HostConfig", {}).get("RestartPolicy") or {}).get("Name") == "unless-stopped", "candidate_restart_policy")
        return write_receipt(pins, created)
    except Exception:
        if created and SHA.fullmatch(created):
            try:
                current = inspect(c["name"])
                if current.get("Id") == created:
                    command("docker", "rm", "-f", created)
            except Refused:
                pass
        elif created is None:
            # Docker may have created the named, stopped container before its CLI
            # timed out. Never remove it without a confirmed returned ID.
            try:
                current = inspect(c["name"])
                if (current.get("Config", {}).get("Labels") or {}).get("com.phone11.release-operation") == operation_token:
                    raise Refused("candidate_create_ambiguous_retained")
            except Refused as error:
                if str(error) == "candidate_create_ambiguous_retained":
                    raise
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    args = parser.parse_args()
    fd = None
    try:
        fd = lock()
        receipt = start(manifest(args.manifest))
        print(f"candidate_ready receipt={receipt}")
        return 0
    except Refused as error:
        if str(error).startswith("candidate_create_ambiguous"):
            print("Phone11 candidate create outcome is ambiguous; a stopped named container may remain. Inspect exact ownership before retrying.", file=sys.stderr)
        else:
            print("Phone11 candidate start refused; inspect pins and host state before retrying.", file=sys.stderr)
        return 1
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError):
        print("Phone11 candidate start refused; inspect pins and host state before retrying.", file=sys.stderr)
        return 1
    finally:
        if fd is not None:
            os.close(fd)


if __name__ == "__main__":
    raise SystemExit(main())
