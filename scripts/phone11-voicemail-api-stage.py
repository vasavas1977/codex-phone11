#!/usr/bin/env python3
"""Stage a workerless voicemail API on loopback 3013; never route or migrate.

The only mutable resources are an overlay image, a root-private state directory,
and the uniquely labelled candidate container. Docker/Compose output is captured
because inspect and rendered Compose contain production environment values.
"""
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

SCHEMA = "phone11-voicemail-api-stage/v1"
NAME = "cp11-api-candidate-voicemail"
PREDECESSOR = "cp11-api-candidate-status"
PORT = 3013
OLD_PORT = 3012
BUNDLE_TARGET = "/app/dist/index.mjs"
STATE = Path("/var/lib/phone11-voicemail-api-stage")
LOCK = Path("/run/phone11-voicemail-api-stage.lock")
PROJECT = "phone11-voicemail-api-stage"
SERVICE = "voicemail_api"
MAX_OUTPUT = 4 * 1024 * 1024
MAX_BUNDLE = 32 * 1024 * 1024
SHA = re.compile(r"[0-9a-f]{64}\Z")
COMMIT = re.compile(r"[0-9a-f]{40}\Z")
BUILD = re.compile(r"[A-Za-z0-9_.-]{7,128}\Z")


class Refused(Exception):
    pass


def need(ok: bool, stage: str) -> None:
    if not ok:
        raise Refused(stage)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical(value: Any) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def private_read(path: Path, max_bytes: int = MAX_OUTPUT) -> bytes:
    parent = path.parent
    while True:
        ancestor = parent.lstat()
        need(stat.S_ISDIR(ancestor.st_mode) and ancestor.st_uid == 0 and
             (stat.S_IMODE(ancestor.st_mode) & 0o022) == 0, "private_parent")
        if parent == parent.parent:
            break
        parent = parent.parent
    before = path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_uid == 0 and
         stat.S_IMODE(before.st_mode) == 0o600 and 0 < before.st_size <= max_bytes,
         "private_file")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        after = os.fstat(fd)
        need((before.st_dev, before.st_ino, before.st_size) ==
             (after.st_dev, after.st_ino, after.st_size), "private_file_race")
        data = os.read(fd, max_bytes + 1)
        need(len(data) == before.st_size, "private_file_size")
        return data
    finally:
        os.close(fd)


def run(args: list[str], *, input_data: bytes | None = None, timeout: int = 30) -> bytes:
    try:
        result = subprocess.run(args, input=input_data, capture_output=True,
                                timeout=timeout, check=False,
                                env={"PATH": "/usr/local/bin:/usr/bin:/bin", "LANG": "C", "LC_ALL": "C"})
    except (OSError, subprocess.TimeoutExpired) as error:
        raise Refused("command_unavailable") from error
    need(result.returncode == 0 and len(result.stdout) <= MAX_OUTPUT and
         len(result.stderr) <= MAX_OUTPUT, "command_failed")
    return result.stdout


def document(raw: bytes, stage: str) -> dict[str, Any]:
    try:
        value = json.loads(raw)
    except (ValueError, UnicodeError) as error:
        raise Refused(stage) from error
    need(isinstance(value, dict), stage)
    return value


def manifest(path: Path) -> tuple[dict[str, Any], str]:
    raw = private_read(path)
    m = document(raw, "manifest")
    need(set(m) == {"schema", "predecessor", "release", "source_checkout", "bundle_file"}
         and m["schema"] == SCHEMA, "manifest")
    old, new = m["predecessor"], m["release"]
    need(isinstance(old, dict) and set(old) ==
         {"container_id", "image", "source_sha", "bundle_sha256", "lock_sha256", "build"}, "manifest")
    need(isinstance(new, dict) and set(new) ==
         {"source_sha", "bundle_sha256", "lock_sha256", "build"}, "manifest")
    need(isinstance(old["container_id"], str) and isinstance(old["image"], str) and
         bool(SHA.fullmatch(old["container_id"])) and old["image"].startswith("sha256:") and
         bool(SHA.fullmatch(old["image"][7:])), "manifest")
    for value in (old, new):
        need(all(isinstance(value[key], str) for key in ("source_sha", "bundle_sha256", "lock_sha256", "build")) and
             bool(COMMIT.fullmatch(value["source_sha"])) and
             bool(SHA.fullmatch(value["bundle_sha256"])) and
             bool(SHA.fullmatch(value["lock_sha256"])) and
             bool(BUILD.fullmatch(value["build"])), "manifest")
    for key in ("source_checkout", "bundle_file"):
        need(isinstance(m[key], str) and Path(m[key]).is_absolute(), "manifest")
    need(old["source_sha"] != new["source_sha"] and old["bundle_sha256"] != new["bundle_sha256"], "manifest")
    need(old["lock_sha256"] == new["lock_sha256"], "lock_change")
    return m, sha(raw)


def clean_source(m: dict[str, Any]) -> None:
    repo = m["source_checkout"]
    need(run(["git", "-C", repo, "rev-parse", "HEAD"]).decode().strip() ==
         m["release"]["source_sha"], "source_commit")
    need(run(["git", "-C", repo, "status", "--porcelain", "--untracked-files=all"]) == b"", "dirty_source")


def bundle(m: dict[str, Any]) -> bytes:
    data = private_read(Path(m["bundle_file"]), MAX_BUNDLE)
    need(sha(data) == m["release"]["bundle_sha256"], "bundle_hash")
    return data


def inspect(name: str) -> dict[str, Any] | None:
    result = subprocess.run(["docker", "inspect", name], capture_output=True,
                            timeout=15, check=False,
                            env={"PATH": "/usr/local/bin:/usr/bin:/bin", "LANG": "C", "LC_ALL": "C"})
    if result.returncode != 0:
        error = result.stderr.decode("utf-8", "replace").strip()
        absent = re.fullmatch(
            r"(?:error(?::| response from daemon:)\s*)?no such (?:object|container):\s*" +
            re.escape(name), error, re.IGNORECASE)
        need(result.stdout.strip() in (b"", b"[]") and len(result.stderr) <= MAX_OUTPUT and
             absent is not None,
             "inspect_failed")
        return None
    need(len(result.stdout) <= MAX_OUTPUT and len(result.stderr) <= MAX_OUTPUT, "inspect_size")
    value = json.loads(result.stdout)
    need(isinstance(value, list) and len(value) == 1 and isinstance(value[0], dict), "inspect_shape")
    return value[0]


def env_map(info: dict[str, Any]) -> dict[str, str]:
    values = info["Config"].get("Env")
    need(isinstance(values, list), "environment")
    result: dict[str, str] = {}
    for item in values:
        need(isinstance(item, str) and "=" in item, "environment")
        key, value = item.split("=", 1)
        need(bool(re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key)) and key not in result, "environment")
        result[key] = value
    return result


def labels(info: dict[str, Any]) -> dict[str, str]:
    result = info["Config"].get("Labels") or {}
    need(isinstance(result, dict), "labels")
    return result


def check_old(m: dict[str, Any]) -> dict[str, Any]:
    info = inspect(PREDECESSOR)
    need(info is not None and info.get("Name") == "/" + PREDECESSOR and
         info.get("Id") == m["predecessor"]["container_id"] and
         info.get("Image") == m["predecessor"]["image"], "predecessor_identity")
    need(info["State"].get("Running") is True and
         (info["State"].get("Health") or {}).get("Status") == "healthy", "predecessor_health")
    old = m["predecessor"]
    actual = labels(info)
    need(all(actual.get("com.phone11." + k) == old[v] for k, v in
             (("source-sha", "source_sha"), ("bundle-sha256", "bundle_sha256"),
              ("lock-sha256", "lock_sha256"), ("candidate-build", "build"))), "predecessor_labels")
    env = env_map(info)
    need(env.get("PHONE11_RUNTIME_ROLE") == "api-candidate" and env.get("PORT") == str(OLD_PORT) and
         env.get("PHONE11_VOICEMAIL_HOOK_READY", "false") == "false", "predecessor_role")
    need(info["HostConfig"].get("PortBindings") ==
         {f"{OLD_PORT}/tcp": [{"HostIp": "127.0.0.1", "HostPort": str(OLD_PORT)}]}, "predecessor_port")
    actual_bundle = run(["docker", "exec", PREDECESSOR, "sha256sum", BUNDLE_TARGET]).split()
    need(len(actual_bundle) == 2 and actual_bundle[0].decode() == old["bundle_sha256"] and
         actual_bundle[1].decode() == BUNDLE_TARGET, "predecessor_bundle")
    return info


def port_free() -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.bind(("127.0.0.1", PORT))
            return True
        except OSError:
            return False


def private_state() -> None:
    STATE.mkdir(mode=0o700, exist_ok=True)
    st = STATE.lstat()
    need(stat.S_ISDIR(st.st_mode) and st.st_uid == 0 and stat.S_IMODE(st.st_mode) == 0o700,
         "state_directory")


def create_once(path: Path, data: bytes) -> None:
    temporary = path.with_name("." + path.name + "." + secrets.token_hex(8))
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb", closefd=False) as stream:
            stream.write(data)
            stream.flush()
        os.fsync(fd)
    finally:
        os.close(fd)
    try:
        os.link(temporary, path, follow_symlinks=False)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        temporary.unlink(missing_ok=True)


def locked() -> int:
    fd = os.open(LOCK, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    st = os.fstat(fd)
    need(st.st_uid == 0 and stat.S_IMODE(st.st_mode) == 0o600, "lock")
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    return fd


def overlay_image(m: dict[str, Any], manifest_sha: str) -> str:
    old, new = m["predecessor"], m["release"]
    existing_receipt = STATE / "image.json"
    if existing_receipt.exists():
        record = document(private_read(existing_receipt), "image_receipt")
        need(record.get("schema") == SCHEMA and record.get("manifest_sha256") == manifest_sha,
             "image_receipt")
        check_image(m, record.get("image"))
        return record["image"]
    dockerfile = (f"FROM {old['image']}\nCOPY --chmod=0644 index.mjs {BUNDLE_TARGET}\n"
                  f"LABEL com.phone11.source-sha={new['source_sha']} "
                  f"com.phone11.bundle-sha256={new['bundle_sha256']} "
                  f"com.phone11.lock-sha256={new['lock_sha256']} "
                  f"com.phone11.candidate-build={new['build']} "
                  f"com.phone11.overlay-parent-image-id={old['image']} "
                  "com.phone11.overlay-kind=bundle-only\n")
    context = STATE / "build"
    if not context.exists():
        context.mkdir(mode=0o700)
    need(stat.S_IMODE(context.lstat().st_mode) == 0o700 and context.lstat().st_uid == 0, "build_directory")
    for name, data in (("Dockerfile", dockerfile.encode()), ("index.mjs", bundle(m))):
        target = context / name
        if target.exists():
            need(private_read(target, MAX_BUNDLE) == data, "build_context_drift")
        else:
            create_once(target, data)
    tag = f"phone11-voicemail-stage:{new['source_sha'][:12]}-{new['bundle_sha256'][:12]}"
    run(["docker", "build", "--network=none", "--pull=false", "-t", tag, str(context)], timeout=180)
    image_result = json.loads(run(["docker", "image", "inspect", tag]))
    need(isinstance(image_result, list) and len(image_result) == 1, "image_shape")
    image = image_result[0]
    image_id = image.get("Id")
    need(isinstance(image_id, str) and image_id.startswith("sha256:") and SHA.fullmatch(image_id[7:]), "image_id")
    check_image(m, image_id)
    receipt = {"schema": SCHEMA, "manifest_sha256": manifest_sha, "image": image_id}
    path = STATE / "image.json"
    if path.exists():
        need(document(private_read(path), "image_receipt") == receipt, "image_receipt")
    else:
        create_once(path, canonical(receipt))
    return image_id


def check_image(m: dict[str, Any], image_id: Any) -> None:
    need(isinstance(image_id, str) and image_id.startswith("sha256:") and
         SHA.fullmatch(image_id[7:]), "image_id")
    result = json.loads(run(["docker", "image", "inspect", image_id]))
    need(isinstance(result, list) and len(result) == 1 and result[0].get("Id") == image_id,
         "image_identity")
    actual = (result[0].get("Config") or {}).get("Labels") or {}
    old, new = m["predecessor"], m["release"]
    need(actual.get("com.phone11.overlay-parent-image-id") == old["image"] and
         actual.get("com.phone11.overlay-kind") == "bundle-only" and
         actual.get("com.phone11.source-sha") == new["source_sha"] and
         actual.get("com.phone11.bundle-sha256") == new["bundle_sha256"] and
         actual.get("com.phone11.lock-sha256") == new["lock_sha256"] and
         actual.get("com.phone11.candidate-build") == new["build"], "image_labels")
    parent_result = json.loads(run(["docker", "image", "inspect", old["image"]]))
    need(isinstance(parent_result, list) and len(parent_result) == 1 and
         parent_result[0].get("Id") == old["image"], "parent_image")
    parent_config = parent_result[0].get("Config") or {}
    child_config = result[0].get("Config") or {}
    need(all(parent_config.get(key) == child_config.get(key) for key in
             ("User", "WorkingDir", "Entrypoint", "Cmd", "Env", "Healthcheck", "ExposedPorts")),
         "image_runtime_drift")


def healthcheck(old: dict[str, Any], build: str) -> dict[str, Any]:
    existing = (old.get("Config") or {}).get("Healthcheck") or {}
    need(isinstance(existing, dict) and isinstance(existing.get("Test"), list) and
         existing["Test"][0] in {"CMD", "CMD-SHELL"}, "healthcheck_shape")
    script = ("fetch('http://127.0.0.1:3013/api/health').then(async r=>{"
              "const b=await r.json();if(!r.ok||b.runtimeRole!=='api-candidate'||"
              f"b.build!=={json.dumps(build)})process.exit(1)"
              "}).catch(()=>process.exit(1))")
    result: dict[str, Any] = {"test": ["CMD", "node", "-e", script]}
    for source, target in (("Interval", "interval"), ("Timeout", "timeout"),
                           ("StartPeriod", "start_period")):
        value = existing.get(source)
        if value:
            need(type(value) is int and value > 0, "healthcheck_shape")
            result[target] = str(value) + "ns"
    retries = existing.get("Retries")
    if retries is not None:
        need(type(retries) is int and retries > 0, "healthcheck_shape")
        result["retries"] = retries
    return result


def compose(old: dict[str, Any], image: str, manifest_sha: str, build: str) -> tuple[bytes, bytes, dict[str, str]]:
    cfg, host = old["Config"], old["HostConfig"]
    need(host.get("NetworkMode") in (old.get("NetworkSettings") or {}).get("Networks", {}) and
         len(old["NetworkSettings"]["Networks"]) == 1, "network_shape")
    need(not host.get("Privileged") and not host.get("Devices") and not host.get("CapAdd") and
         not host.get("Dns") and not host.get("ExtraHosts") and not host.get("Tmpfs") and
         not host.get("Links") and not host.get("PublishAllPorts"), "unsupported_host_shape")
    mounts = old.get("Mounts")
    need(isinstance(mounts, list) and len({v.get("Destination") for v in mounts}) == len(mounts)
         and all(v.get("Type") == "bind" and isinstance(v.get("Source"), str) and
                 isinstance(v.get("Destination"), str) for v in mounts), "mount_shape")
    need(all(not (BUNDLE_TARGET == v["Destination"].rstrip("/") or
                  BUNDLE_TARGET.startswith(v["Destination"].rstrip("/") + "/") or
                  v["Destination"] == "/") for v in mounts), "bundle_shadow_mount")
    env = env_map(old)
    env.update({"PORT": str(PORT), "PHONE11_RUNTIME_ROLE": "api-candidate",
                "PHONE11_VOICEMAIL_HOOK_READY": "false", "PHONE11_BUILD_SHA": build})
    need(all("\n" not in key + value and "\r" not in key + value and "\0" not in key + value
             for key, value in env.items()), "environment_encoding")
    env_file = "".join(key + "=" + value + "\n" for key, value in sorted(env.items())).encode()
    service: dict[str, Any] = {
        "container_name": NAME, "image": image, "pull_policy": "never",
        # Raw env_file avoids Compose's variable expansion of secrets. Docker
        # inspect after start must still equal the exact inherited values.
        "env_file": [{"path": str(STATE / "runtime.env"), "format": "raw"}],
        "user": cfg.get("User") or None,
        "working_dir": cfg.get("WorkingDir") or None,
        "entrypoint": cfg.get("Entrypoint"), "command": cfg.get("Cmd"),
        "ports": [f"127.0.0.1:{PORT}:{PORT}"],
        "volumes": [{"type": "bind", "source": v["Source"], "target": v["Destination"],
                     "read_only": not v.get("RW", False), "bind": {"create_host_path": False}}
                    for v in mounts],
        "networks": ["existing"],
        "restart": host.get("RestartPolicy", {}).get("Name", "no"),
        "healthcheck": healthcheck(old, build),
        "mem_limit": host.get("Memory") or None,
        "read_only": bool(host.get("ReadonlyRootfs")),
        "labels": {"com.phone11.voicemail-stage.manifest-sha256": manifest_sha,
                   "com.phone11.voicemail-stage.owner": "phone11-voicemail-api-stage/v1"},
    }
    for key in list(service):
        if service[key] is None:
            del service[key]
    if host.get("PidsLimit"):
        service["pids_limit"] = host["PidsLimit"]
    if host.get("SecurityOpt"):
        service["security_opt"] = host["SecurityOpt"]
    if host.get("CapDrop"):
        service["cap_drop"] = host["CapDrop"]
    model = {"services": {SERVICE: service}, "networks": {"existing":
             {"external": True, "name": host["NetworkMode"]}}}
    return canonical(model), env_file, env


def candidate_ok(m: dict[str, Any], manifest_sha: str, image: str,
                 old: dict[str, Any], expected_env: dict[str, str]) -> bool:
    info = inspect(NAME)
    if info is None:
        return False
    need(info.get("Name") == "/" + NAME and info.get("Image") == image and
         info.get("State", {}).get("Running") is True and
         (info["State"].get("Health") or {}).get("Status") == "healthy", "candidate_identity")
    lab = labels(info)
    need(lab.get("com.phone11.voicemail-stage.manifest-sha256") == manifest_sha and
         lab.get("com.phone11.voicemail-stage.owner") == SCHEMA, "candidate_owner")
    need(env_map(info) == expected_env and expected_env["PHONE11_RUNTIME_ROLE"] == "api-candidate" and
         expected_env["PHONE11_VOICEMAIL_HOOK_READY"] == "false", "candidate_env")
    old_config, new_config = old["Config"], info["Config"]
    need(all(new_config.get(key) == old_config.get(key) for key in
             ("User", "WorkingDir", "Entrypoint", "Cmd")), "candidate_process_shape")
    old_host, new_host = old["HostConfig"], info["HostConfig"]
    need(all(new_host.get(key) == old_host.get(key) for key in
             ("Memory", "ReadonlyRootfs", "PidsLimit", "SecurityOpt", "CapDrop", "CapAdd", "Privileged")) and
         (new_host.get("RestartPolicy") or {}).get("Name") ==
         (old_host.get("RestartPolicy") or {}).get("Name"), "candidate_host_shape")
    need((info.get("Config") or {}).get("Healthcheck", {}).get("Test") ==
         healthcheck(old, m["release"]["build"])["test"], "candidate_healthcheck")
    need(info["HostConfig"].get("PortBindings") ==
         {f"{PORT}/tcp": [{"HostIp": "127.0.0.1", "HostPort": str(PORT)}]}, "candidate_port")
    network_ports = info["NetworkSettings"].get("Ports") or {}
    need(network_ports.get(f"{PORT}/tcp") ==
         [{"HostIp": "127.0.0.1", "HostPort": str(PORT)}] and
         all(not bindings for key, bindings in network_ports.items() if key != f"{PORT}/tcp"),
         "candidate_port")
    need(set(info["NetworkSettings"]["Networks"]) == set(old["NetworkSettings"]["Networks"]), "candidate_network")
    expected_mounts = {(v["Type"], v["Source"], v["Destination"], v["RW"]) for v in old["Mounts"]}
    actual_mounts = {(v["Type"], v["Source"], v["Destination"], v["RW"]) for v in info["Mounts"]}
    need(actual_mounts == expected_mounts, "candidate_mounts")
    actual_bundle = run(["docker", "exec", NAME, "sha256sum", BUNDLE_TARGET]).split()
    need(len(actual_bundle) == 2 and actual_bundle[0].decode() == m["release"]["bundle_sha256"], "candidate_bundle")
    conn = http.client.HTTPConnection("127.0.0.1", PORT, timeout=5)
    try:
        conn.request("GET", "/api/health")
        reply = conn.getresponse()
        body = reply.read(16_385)
        need(reply.status == 200 and len(body) <= 16_384, "candidate_http")
        health = document(body, "candidate_http")
        need(health.get("ok") is True and health.get("service") == "phone11-backend" and
             health.get("runtimeRole") == "api-candidate" and
             health.get("build") == m["release"]["build"], "candidate_http")
    finally:
        conn.close()
    return True


def cleanup_owned(manifest_sha: str, image: str) -> None:
    """Remove only this operator's un-routed candidate after failed startup."""
    info = inspect(NAME)
    if info is None:
        return
    lab = labels(info)
    need(info.get("Name") == "/" + NAME and info.get("Image") == image and
         lab.get("com.phone11.voicemail-stage.owner") == SCHEMA and
         lab.get("com.phone11.voicemail-stage.manifest-sha256") == manifest_sha and
         lab.get("com.docker.compose.project") == PROJECT and
         lab.get("com.docker.compose.service") == SERVICE, "cleanup_identity")
    run(["docker", "rm", "-f", info["Id"]], timeout=30)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=("prepare", "build", "start", "recover"))
    parser.add_argument("--manifest", required=True, type=Path)
    args = parser.parse_args()
    need(os.geteuid() == 0, "root")
    lock_fd = locked()
    try:
        m, manifest_sha = manifest(args.manifest)
        clean_source(m)
        bundle(m)
        old = check_old(m)
        if args.phase == "prepare":
            need(inspect(NAME) is None, "candidate_exists")
            need(port_free(), "candidate_port_busy")
            print("prepare=READY")
            return
        private_state()
        if args.phase == "build":
            need(inspect(NAME) is None, "candidate_exists")
            need(port_free(), "candidate_port_busy")
            image = overlay_image(m, manifest_sha)
            print("build=READY image=" + image)
            return
        image_receipt = document(private_read(STATE / "image.json"), "image_receipt")
        need(image_receipt.get("schema") == SCHEMA and
             image_receipt.get("manifest_sha256") == manifest_sha, "image_receipt")
        image = image_receipt["image"]
        check_image(m, image)
        data, env_bytes, expected_env = compose(old, image, manifest_sha, m["release"]["build"])
        environment_path = STATE / "runtime.env"
        if environment_path.exists():
            need(private_read(environment_path) == env_bytes, "environment_drift")
        else:
            create_once(environment_path, env_bytes)
        compose_path = STATE / "compose.json"
        if compose_path.exists():
            need(private_read(compose_path) == data, "compose_drift")
        else:
            create_once(compose_path, data)
        existing = inspect(NAME)
        if existing is None and args.phase == "recover":
            print("recover=ABSENT")
            return
        if existing is not None:
            try:
                if candidate_ok(m, manifest_sha, image, old, expected_env):
                    print(args.phase + "=READY already_running=true")
                    return
            except (Refused, OSError, ValueError):
                # A prior process may have failed after Compose create. Only
                # explicit recovery removes its exact owned, unhealthy unit.
                if args.phase == "recover" and (existing.get("State") or {}).get("Running") is not True:
                    cleanup_owned(manifest_sha, image)
                    print("recover=CLEANED")
                    return
                raise Refused("candidate_drift") from None
        need(args.phase == "start", "candidate_missing")
        need(port_free(), "candidate_port_busy")
        # An exact single-service external-network model; Compose never builds,
        # pulls, starts a dependency, or selects another project service.
        run(["docker", "compose", "-p", PROJECT, "-f", str(compose_path), "config", "--quiet"])
        try:
            run(["docker", "compose", "-p", PROJECT, "-f", str(compose_path),
                 "up", "-d", "--no-deps", "--no-build", SERVICE], timeout=90)
            for _ in range(20):
                try:
                    if candidate_ok(m, manifest_sha, image, old, expected_env):
                        print("start=READY")
                        return
                except (Refused, OSError, ValueError):
                    pass
                time.sleep(2)
            raise Refused("candidate_health")
        except (Refused, OSError, ValueError):
            cleanup_owned(manifest_sha, image)
            raise Refused("candidate_start_or_health") from None
    finally:
        os.close(lock_fd)


if __name__ == "__main__":
    try:
        main()
    except Refused as error:
        print("BLOCKED stage=" + str(error), file=sys.stderr)
        sys.exit(2)
