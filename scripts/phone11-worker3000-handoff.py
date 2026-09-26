#!/usr/bin/env python3
"""Read-only, fail-closed pins for the first cp11-backend (3000) handoff.

No command here stops, starts, removes, or recreates a container. The deployed
old worker has no awaited dispatcher drain and Kamailio has no maintenance gate;
therefore a truthful mutation receipt cannot yet be produced by this operator.
Docker output (including Env) is never printed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
from typing import Any

SCHEMA = "phone11-worker3000-handoff/v1"
NAME = "cp11-backend"
BUNDLE = "/app/dist/index.mjs"
SHA = re.compile(r"[0-9a-f]{64}\Z")
IMAGE = re.compile(r"sha256:[0-9a-f]{64}\Z")
MAX_BYTES = 4 * 1024 * 1024


class Refused(Exception):
    pass


def need(value: bool, stage: str) -> None:
    if not value:
        raise Refused(stage)


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def private_json(path: Path) -> dict[str, Any]:
    need(path.is_absolute(), "manifest_path")
    parent = path.parent
    while True:
        item = parent.lstat()
        need(stat.S_ISDIR(item.st_mode) and item.st_uid == 0 and
             not stat.S_IMODE(item.st_mode) & 0o022, "private_parent")
        if parent == parent.parent:
            break
        parent = parent.parent
    before = path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_uid == 0 and
         stat.S_IMODE(before.st_mode) == 0o600 and
         0 < before.st_size <= MAX_BYTES, "private_manifest")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        after = os.fstat(fd)
        need((before.st_dev, before.st_ino, before.st_size, before.st_mode) ==
             (after.st_dev, after.st_ino, after.st_size, after.st_mode), "manifest_race")
        raw = os.read(fd, MAX_BYTES + 1)
        need(len(raw) == before.st_size, "manifest_size")
    finally:
        os.close(fd)
    def unique(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            need(key not in result, "duplicate_manifest_key")
            result[key] = value
        return result
    try:
        value = json.loads(raw, object_pairs_hook=unique)
    except (ValueError, UnicodeError) as error:
        raise Refused("manifest_json") from error
    need(isinstance(value, dict), "manifest_shape")
    return value


def command(args: list[str]) -> bytes:
    try:
        result = subprocess.run(args, capture_output=True, timeout=15, check=False,
                                env={"PATH": "/usr/local/bin:/usr/bin:/bin", "LANG": "C"})
    except (OSError, subprocess.TimeoutExpired) as error:
        raise Refused("command_unavailable") from error
    need(result.returncode == 0 and len(result.stdout) <= MAX_BYTES and
         len(result.stderr) <= MAX_BYTES, "command_failed")
    return result.stdout


def inspect_one(args: list[str]) -> dict[str, Any]:
    try:
        value = json.loads(command(args))
    except (ValueError, UnicodeError) as error:
        raise Refused("inspect_json") from error
    need(isinstance(value, list) and len(value) == 1 and isinstance(value[0], dict), "inspect_shape")
    return value[0]


def manifest(value: dict[str, Any]) -> None:
    need(set(value) == {"schema", "old", "release", "snapshot_sha256"} and
         value["schema"] == SCHEMA, "manifest_shape")
    old, new = value["old"], value["release"]
    need(isinstance(old, dict) and set(old) ==
         {"container_id", "image", "bundle_sha256"} and
         isinstance(new, dict) and set(new) ==
         {"image", "bundle_sha256"}, "manifest_shape")
    need(isinstance(old["container_id"], str) and SHA.fullmatch(old["container_id"]) is not None and
         all(isinstance(item["image"], str) and IMAGE.fullmatch(item["image"]) is not None and
             isinstance(item["bundle_sha256"], str) and SHA.fullmatch(item["bundle_sha256"]) is not None
             for item in (old, new)) and
         isinstance(value["snapshot_sha256"], str) and SHA.fullmatch(value["snapshot_sha256"]) is not None and
         old["image"] != new["image"] and old["bundle_sha256"] != new["bundle_sha256"], "manifest_pin")


def env_map(info: dict[str, Any]) -> dict[str, str]:
    values = info.get("Config", {}).get("Env")
    need(isinstance(values, list), "environment")
    result: dict[str, str] = {}
    for item in values:
        need(isinstance(item, str) and "=" in item, "environment")
        key, value = item.split("=", 1)
        need(re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key) is not None and
             key not in result, "environment")
        result[key] = value
    return result


def snapshot(info: dict[str, Any]) -> dict[str, Any]:
    """Pin the exact configuration that a later reviewed run must preserve."""
    cfg, host, network = info.get("Config"), info.get("HostConfig"), info.get("NetworkSettings")
    mounts = info.get("Mounts")
    need(isinstance(cfg, dict) and isinstance(host, dict) and isinstance(network, dict) and
         isinstance(mounts, list) and isinstance(network.get("Networks"), dict), "snapshot_shape")
    need(len(network["Networks"]) == 1 and host.get("NetworkMode") in network["Networks"], "network_shape")
    need(len({m.get("Destination") for m in mounts if isinstance(m, dict)}) == len(mounts) and
         all(isinstance(m, dict) and m.get("Type") == "bind" and
             isinstance(m.get("Source"), str) and isinstance(m.get("Destination"), str) and
             isinstance(m.get("RW"), bool) for m in mounts), "mount_shape")
    need(host.get("PortBindings") == {"3000/tcp": [{"HostIp": "127.0.0.1", "HostPort": "3000"}]}, "port_shape")
    env = env_map(info)
    need(env.get("PORT") == "3000" and env.get("PHONE11_RUNTIME_ROLE", "default") == "default", "worker_role")
    attachment_fields = ("IPAMConfig", "Aliases", "Links", "DriverOpts")
    attachments = {name: {field: details.get(field) for field in attachment_fields}
                   for name, details in network["Networks"].items() if isinstance(details, dict)}
    need(len(attachments) == len(network["Networks"]), "network_shape")
    return {"Config": cfg, "HostConfig": host, "Mounts": mounts,
            "NetworkConfig": attachments}


def verify(value: dict[str, Any], old: dict[str, Any], old_image: dict[str, Any], new_image: dict[str, Any],
           peers: list[dict[str, Any]], old_bundle: str) -> None:
    manifest(value)
    need(old.get("Id") == value["old"]["container_id"] and old.get("Image") == value["old"]["image"] and
         old.get("Name") == "/" + NAME and old.get("State", {}).get("Running") is True,
         "old_identity")
    need(digest(canonical(snapshot(old))) == value["snapshot_sha256"], "old_config_drift")
    need(old_bundle == value["old"]["bundle_sha256"], "old_bundle_drift")
    need(old_image.get("Id") == value["old"]["image"], "old_image_identity")
    need(new_image.get("Id") == value["release"]["image"], "new_image_identity")
    labels = new_image.get("Config", {}).get("Labels") or {}
    need(labels.get("com.phone11.overlay-parent-image-id") == value["old"]["image"] and
         labels.get("com.phone11.overlay-kind") == "bundle-only" and
         labels.get("com.phone11.bundle-sha256") == value["release"]["bundle_sha256"],
         "new_image_labels")
    # An overlay must change only the application bundle. Its inherited image
    # process/environment settings are separately pinned before any handoff.
    image_config = new_image.get("Config") or {}
    parent_config = old_image.get("Config") or {}
    for field in ("User", "WorkingDir", "Entrypoint", "Cmd", "Env", "Healthcheck", "ExposedPorts"):
        need(image_config.get(field) == parent_config.get(field), "new_image_config_drift")
    # Peer inventory is deliberately required from a separate live docker ps,
    # not a caller-supplied assertion. A second default-role worker blocks.
    for peer in peers:
        if peer.get("Id") == old.get("Id") or peer.get("State", {}).get("Running") is not True:
            continue
        role = env_map(peer).get("PHONE11_RUNTIME_ROLE", "default")
        need(role != "default", "double_worker")


def verify_exclusive_phase(old: dict[str, Any], replacement: dict[str, Any] | None,
                           peers: list[dict[str, Any]], *, rollback: bool) -> None:
    """Post-mutation inspection contract for a future reviewed operator.

    This does not authorize the transition. It catches a double worker and a
    rollback that re-enables notifications after DND was exposed.
    """
    old_running = old.get("State", {}).get("Running") is True
    new_running = replacement is not None and replacement.get("State", {}).get("Running") is True
    need(old_running != new_running, "worker_exclusivity")
    active = old if old_running else replacement
    need(active is not None and env_map(active).get("PHONE11_RUNTIME_ROLE", "default") == "default", "active_role")
    if rollback:
        need(old_running and not new_running, "rollback_order")
        need(env_map(old).get("PHONE11_CHAT_NOTIFICATIONS_ENABLED") == "0", "rollback_notifications")
    else:
        need(not old_running and new_running, "replacement_order")
        need(replacement is not None and replacement.get("Name") == "/" + NAME,
             "replacement_name")
        original = snapshot(old)
        current = snapshot(replacement)
        need(current["HostConfig"] == original["HostConfig"] and
             current["Mounts"] == original["Mounts"] and
             current["NetworkConfig"] == original["NetworkConfig"], "replacement_host_drift")
        for field in ("User", "WorkingDir", "Entrypoint", "Cmd", "Healthcheck", "ExposedPorts"):
            need(current["Config"].get(field) == original["Config"].get(field), "replacement_process_drift")
        old_env, new_env = env_map(old), env_map(replacement)
        old_env.pop("PHONE11_BUILD_SHA", None)
        new_env.pop("PHONE11_BUILD_SHA", None)
        need(new_env == old_env, "replacement_env_drift")
    for peer in peers:
        if peer.get("Id") != active.get("Id") and peer.get("State", {}).get("Running") is True:
            need(env_map(peer).get("PHONE11_RUNTIME_ROLE", "default") != "default", "double_worker")


def live_inventory() -> list[dict[str, Any]]:
    try:
        ids = command(["docker", "ps", "--no-trunc", "--format", "{{.ID}}"]).decode().splitlines()
    except UnicodeError as error:
        raise Refused("inventory") from error
    need(len(ids) <= 128 and all(SHA.fullmatch(item) for item in ids), "inventory")
    return [inspect_one(["docker", "inspect", item]) for item in ids]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    args = parser.parse_args()
    try:
        need(os.geteuid() == 0, "root_required")
        value = private_json(args.manifest)
        manifest(value)
        old = inspect_one(["docker", "inspect", NAME])
        old_image = inspect_one(["docker", "image", "inspect", value["old"]["image"]])
        new_image = inspect_one(["docker", "image", "inspect", value["release"]["image"]])
        bundle = command(["docker", "exec", value["old"]["container_id"], "sha256sum", BUNDLE]).split()
        need(len(bundle) == 2 and bundle[1] == BUNDLE.encode() and
             re.fullmatch(rb"[0-9a-f]{64}", bundle[0]) is not None, "old_bundle_probe")
        verify(value, old, old_image, new_image, live_inventory(), bundle[0].decode("ascii"))
        print("PINS_VERIFIED_ONLY: worker handoff mutation gate remains closed")
    except (Refused, OSError, KeyError, TypeError, AttributeError) as error:
        stage = str(error) if isinstance(error, Refused) else "inspection_unavailable"
        print(f"REFUSED: {stage}", file=sys.stderr)
        raise SystemExit(2) from None


if __name__ == "__main__":
    main()
