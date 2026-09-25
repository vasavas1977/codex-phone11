#!/usr/bin/env python3
"""Start an isolated, pinned 3008 meeting API candidate without changing any route.

Run as root on the VoIP host after reviewing the image, source 3007 runtime,
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
import tempfile
import time
from urllib.request import urlopen


SOURCE = "cp11-api-candidate-desktop-provisioning"
TARGET = "cp11-api-candidate-meetings"
SOURCE_IMAGE = "sha256:b714cec08a15f6465baba58204a3473494e8c043bd3cef5323b5a35d676f6baa"
SOURCE_BUNDLE = "8dda0429b527238d96e742f03e8c2f8b523247c705b5d3cf9350c0a57e699897"
TARGET_BUNDLE = "97770ec21c24ec80f235545ffd66371eb9dd8fd756444578a6af09a5640c2d3b"
BUILD = "meeting-admin-20260925"
NETWORK = "cloudphone11-prod_cp11-net"
STAGING = Path("/opt/phone11ai/meeting-admin-20260925")
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
        raise RuntimeError("source 3007 runtime changed")
    if image["Id"] != target_image or (image["Config"].get("Labels") or {}).get("com.phone11.bundle-sha256") != TARGET_BUNDLE:
        raise RuntimeError("candidate image changed")
    source_bundle = run("docker", "exec", SOURCE, "sha256sum", "/app/dist/index.mjs").split()[0]
    if source_bundle != SOURCE_BUNDLE:
        raise RuntimeError("live 3007 bundle changed")
    target_check = subprocess.run(["docker", "inspect", TARGET], capture_output=True, text=True, check=False)
    if target_check.returncode == 0:
        raise RuntimeError("candidate container already exists")
    if target_check.returncode != 1 or f"no such object: {TARGET}" not in target_check.stderr.lower():
        raise RuntimeError("candidate absence could not be verified")
    with socket.socket() as sock:
        sock.settimeout(0.4)
        if sock.connect_ex(("127.0.0.1", 3008)) == 0:
            raise RuntimeError("port 3008 is occupied")

    config = source["Config"]
    host = source["HostConfig"]
    for field in ("User", "Entrypoint", "Cmd", "WorkingDir"):
        if image["Config"].get(field) != config.get(field):
            raise RuntimeError(f"candidate image runtime {field} differs from 3007")
    if host["NetworkMode"] != NETWORK or host["Privileged"] or host["ReadonlyRootfs"]:
        raise RuntimeError("source runtime isolation changed")
    if host["Memory"] != 2147483648 or config["User"] != "cloudphone":
        raise RuntimeError("source runtime limits changed")
    if host["PortBindings"] != {"3007/tcp": [{"HostIp": "127.0.0.1", "HostPort": "3007"}]}:
        raise RuntimeError("source loopback binding changed")
    if host["RestartPolicy"]["Name"] != "unless-stopped":
        raise RuntimeError("source restart policy changed")
    variables: dict[str, str] = {}
    for entry in config["Env"]:
        name, value = entry.split("=", 1)
        if not name or name in variables or "\n" in value or "\r" in value:
            raise RuntimeError("source environment cannot be safely cloned")
        variables[name] = value
    if variables.get("PHONE11_RUNTIME_ROLE") != "api-candidate" or variables.get("PORT") != "3007":
        raise RuntimeError("source API role or port changed")
    variables["PORT"] = "3008"
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
            "--network", NETWORK, "--network-alias", "candidate_meetings",
            "--memory", "2147483648", "-p", "127.0.0.1:3008:3008"]
    for item in mounts:
        option = f"type=bind,src={item['Source']},dst={item['Destination']}"
        if not item["RW"]:
            option += ",readonly"
        if item["Propagation"] not in {"", "rprivate"}:
            option += f",bind-propagation={item['Propagation']}"
        args.extend(["--mount", option])
    health = ("fetch('http://127.0.0.1:3008/api/health')"
              ".then(async r=>{const b=await r.json();"
              "if(!r.ok||b.runtimeRole!=='api-candidate'||"
              f"b.build!=='{BUILD}')process.exit(1)}}).catch(()=>process.exit(1))")
    args.extend(["--health-cmd", f"node -e \"{health}\"", "--health-interval", "10s",
                 "--health-timeout", "3s", "--health-start-period", "10s",
                 "--health-retries", "3"])

    fd, env_path = tempfile.mkstemp(prefix="candidate-env-", dir=STAGING)
    created_id: str | None = None
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w") as stream:
            for key, value in variables.items():
                stream.write(f"{key}={value}\n")
            stream.flush()
            os.fsync(stream.fileno())
        args.extend(["--env-file", env_path, target_image])
        created_id = run(*args)
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
                with urlopen("http://127.0.0.1:3008/api/health", timeout=2) as response:
                    data = json.load(response)
                if data.get("ok") is True and data.get("runtimeRole") == "api-candidate" and data.get("build") == BUILD:
                    run("docker", "update", "--restart", "unless-stopped", TARGET)
                    print(f"candidate_ready image={target_image} bundle={TARGET_BUNDLE} port=3008")
                    return
            except Exception:
                pass
            time.sleep(1)
        raise RuntimeError("candidate health did not become ready; route remains on 3007")
    except Exception:
        if created_id and len(created_id) == 64 and all(c in "0123456789abcdef" for c in created_id):
            subprocess.run(["docker", "rm", "-f", created_id], capture_output=True, check=False)
        raise
    finally:
        Path(env_path).unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image-sha256", type=sha256_arg, required=True,
                        help="reviewed candidate image ID, 64 lowercase hex characters")
    main(parser.parse_args().image_sha256)
