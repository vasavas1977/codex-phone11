#!/usr/bin/env python3
"""Start an isolated, pinned 3010 chat-inbox API candidate without changing any route.

Run as root on the VoIP host after reviewing the image, source 3009 runtime,
and schema. The effective environment is cloned in memory and never printed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import time
from urllib.request import urlopen


SOURCE = "cp11-api-candidate-meeting-title"
TARGET = "cp11-api-candidate-chat-inbox"
SOURCE_IMAGE = "sha256:c66d4e95e4177a75bb4a3c0c6a900de80c57f071b0b3d8d7daa45332404b2398"
SOURCE_BUNDLE = "870fdad722679a67575a57c27fee5131c2128aa75d97d201064588c76cb0292e"
TARGET_SOURCE_SHA = "2d125819a7f1713f05b3eaa3bcbf5e5672a84e0c"
TARGET_BUNDLE = "75381c01555e1d924eddc2da2c97a1f1e44224dec5c4f03947518e24f6148b5b"
BUILD = "chat-inbox-20260925"
NETWORK = "cloudphone11-prod_cp11-net"
STAGING = Path("/opt/phone11ai/chat-inbox-20260925")
EXPECTED_MOUNTS = {
    ("/opt/phone11ai/cloud-media/recordings", "/var/lib/phone11/recordings", True, "rprivate"),
    ("/opt/phone11ai/apns-private/wake-inactive-d8b81515a52d12c3/runtime-apns.p8", "/run/secrets/phone11-apns.p8", False, "rprivate"),
    ("/var/lib/docker/volumes/phone11ai-voip_fs_recordings/_data/phone11", "/var/lib/freeswitch/recordings/phone11", True, "rslave"),
    ("/opt/phone11ai/auth-recovery-20260909/runtime-data", "/var/lib/phone11", True, "rprivate"),
    ("/opt/phone11ai/cloud-media/spool", "/var/lib/phone11/recording-spool", True, "rprivate"),
}


def run(*args: str) -> str:
    result = subprocess.run(args, capture_output=True, text=True, check=False)
    if result.returncode:
        raise RuntimeError(f"command failed ({args[0]} {args[1]}), exit {result.returncode}")
    return result.stdout.strip()


def create_with_memory_environment(args: list[str], variables: dict[str, str], image: str) -> str:
    """Pass the protected environment to Docker through an inherited Linux memfd."""
    if not hasattr(os, "memfd_create"):
        raise RuntimeError("Linux in-memory environment transfer is required")
    fd = os.memfd_create("phone11-chat-inbox-candidate-env", os.MFD_CLOEXEC)
    try:
        with os.fdopen(os.dup(fd), "wb") as stream:
            for key, value in variables.items():
                stream.write(f"{key}={value}\n".encode("utf-8"))
        os.lseek(fd, 0, os.SEEK_SET)
        command = [*args, "--env-file", f"/proc/self/fd/{fd}", image]
        result = subprocess.run(command, capture_output=True, text=True, check=False, pass_fds=(fd,))
        if result.returncode:
            raise RuntimeError(f"Docker candidate create failed with exit {result.returncode}")
        return result.stdout.strip()
    finally:
        os.close(fd)


def inspect(name: str) -> dict:
    data = json.loads(run("docker", "inspect", name))
    if len(data) != 1:
        raise RuntimeError("Docker inspect returned an ambiguous object")
    return data[0]


def file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(65536), b""):
            h.update(block)
    return h.hexdigest()


def sha256_arg(value: str) -> str:
    if not re.fullmatch(r"[0-9a-f]{64}", value):
        raise argparse.ArgumentTypeError("expected a lowercase SHA-256 digest")
    return "sha256:" + value


def main(target_image: str) -> None:
    if os.geteuid() != 0:
        raise RuntimeError("root is required for the protected runtime clone")
    if file_hash(STAGING / "dist/index.mjs") != TARGET_BUNDLE:
        raise RuntimeError("staged candidate bundle changed")
    source = inspect(SOURCE)
    image = inspect(target_image)
    if source["Image"] != SOURCE_IMAGE or source["State"]["Status"] != "running":
        raise RuntimeError("source 3009 runtime changed")
    labels = image["Config"].get("Labels") or {}
    if (image["Id"] != target_image
            or labels.get("com.phone11.bundle-sha256") != TARGET_BUNDLE
            or labels.get("com.phone11.source-sha") != TARGET_SOURCE_SHA
            or labels.get("com.phone11.overlay-parent-image-id") != SOURCE_IMAGE
            or labels.get("com.phone11.overlay-kind") != "bundle-only"):
        raise RuntimeError("candidate image changed")
    source_bundle = run("docker", "exec", SOURCE, "sha256sum", "/app/dist/index.mjs").split()[0]
    if source_bundle != SOURCE_BUNDLE:
        raise RuntimeError("live 3009 bundle changed")
    with urlopen("http://127.0.0.1:3009/api/health", timeout=5) as response:
        raw = response.read(16_385)
        if response.status != 200 or len(raw) > 16_384:
            raise RuntimeError("source 3009 health changed")
        health = json.loads(raw)
        if health.get("ok") is not True or health.get("service") != "phone11-backend" or health.get("build") != "meeting-title-20260925" or health.get("runtimeRole") != "api-candidate":
            raise RuntimeError("source 3009 health changed")
    target_check = subprocess.run(["docker", "inspect", TARGET], capture_output=True, text=True, check=False)
    if target_check.returncode == 0:
        raise RuntimeError("candidate container already exists")
    if target_check.returncode != 1 or f"no such object: {TARGET}" not in target_check.stderr.lower():
        raise RuntimeError("candidate absence could not be verified")
    with socket.socket() as sock:
        sock.settimeout(0.4)
        if sock.connect_ex(("127.0.0.1", 3010)) == 0:
            raise RuntimeError("port 3010 is occupied")

    config = source["Config"]
    host = source["HostConfig"]
    for field in ("User", "Entrypoint", "Cmd", "WorkingDir"):
        if image["Config"].get(field) != config.get(field):
            raise RuntimeError(f"candidate image runtime {field} differs from 3009")
    if host["NetworkMode"] != NETWORK or host["Privileged"] or host["ReadonlyRootfs"]:
        raise RuntimeError("source runtime isolation changed")
    if host["Memory"] != 2147483648 or config["User"] != "cloudphone":
        raise RuntimeError("source runtime limits changed")
    if host["PortBindings"] != {"3009/tcp": [{"HostIp": "127.0.0.1", "HostPort": "3009"}]}:
        raise RuntimeError("source loopback binding changed")
    if host["RestartPolicy"]["Name"] != "unless-stopped":
        raise RuntimeError("source restart policy changed")
    variables: dict[str, str] = {}
    for entry in config["Env"]:
        name, value = entry.split("=", 1)
        if not name or name in variables or "\n" in value or "\r" in value:
            raise RuntimeError("source environment cannot be safely cloned")
        variables[name] = value
    if variables.get("PHONE11_RUNTIME_ROLE") != "api-candidate" or variables.get("PORT") != "3009":
        raise RuntimeError("source API role or port changed")
    variables["PORT"] = "3010"
    variables["PHONE11_BUILD_SHA"] = BUILD

    mounts = source["Mounts"]
    if len(mounts) != 5 or any(item["Type"] != "bind" for item in mounts):
        raise RuntimeError("source mounts changed")
    actual_mounts = {(item["Source"], item["Destination"], item["RW"], item["Propagation"])
                     for item in mounts}
    if actual_mounts != EXPECTED_MOUNTS:
        raise RuntimeError("source mount layout changed")
    destinations = [item["Destination"] for item in mounts]
    if len(set(destinations)) != len(destinations):
        raise RuntimeError("source mounts overlap")
    args = ["docker", "create", "--name", TARGET, "--restart", "no",
            "--network", NETWORK, "--network-alias", "candidate_chat_inbox",
            "--memory", "2147483648", "-p", "127.0.0.1:3010:3010"]
    for item in mounts:
        option = f"type=bind,src={item['Source']},dst={item['Destination']}"
        if not item["RW"]:
            option += ",readonly"
        if item["Propagation"] not in {"", "rprivate"}:
            option += f",bind-propagation={item['Propagation']}"
        args.extend(["--mount", option])
    health = ("fetch('http://127.0.0.1:3010/api/health')"
              ".then(async r=>{const b=await r.json();"
              "if(!r.ok||b.runtimeRole!=='api-candidate'||"
              f"b.build!=='{BUILD}')process.exit(1)}}).catch(()=>process.exit(1))")
    args.extend(["--health-cmd", f"node -e \"{health}\"", "--health-interval", "10s",
                 "--health-timeout", "3s", "--health-start-period", "10s",
                 "--health-retries", "3"])

    created_id: str | None = None
    try:
        created_id = create_with_memory_environment(args, variables, target_image)
        if len(created_id) != 64 or any(c not in "0123456789abcdef" for c in created_id):
            raise RuntimeError("Docker create did not return a container ID")
        run("docker", "start", created_id)
        target = inspect(TARGET)
        if target["Image"] != target_image or target["State"]["Status"] != "running":
            raise RuntimeError("candidate did not start from pinned image")
        if run("docker", "exec", TARGET, "sha256sum", "/app/dist/index.mjs").split()[0] != TARGET_BUNDLE:
            raise RuntimeError("running candidate bundle mismatch")
        for _ in range(30):
            try:
                with urlopen("http://127.0.0.1:3010/api/health", timeout=2) as response:
                    data = json.load(response)
                if data.get("ok") is True and data.get("runtimeRole") == "api-candidate" and data.get("build") == BUILD:
                    run("docker", "update", "--restart", "unless-stopped", TARGET)
                    print(f"candidate_ready image={target_image} bundle={TARGET_BUNDLE} port=3010")
                    return
            except Exception:
                pass
            time.sleep(1)
        raise RuntimeError("candidate health did not become ready; route remains on 3009")
    except Exception:
        if created_id and len(created_id) == 64 and all(c in "0123456789abcdef" for c in created_id):
            subprocess.run(["docker", "rm", "-f", created_id], capture_output=True, check=False)
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image-sha256", type=sha256_arg, required=True,
                        help="reviewed candidate image ID, 64 lowercase hex characters")
    main(parser.parse_args().image_sha256)
