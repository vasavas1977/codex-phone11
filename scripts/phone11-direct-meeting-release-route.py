#!/usr/bin/env python3
"""Guarded route switch for the Phone11 direct-meeting API candidate.

Run as root on the VoIP host after a separately reviewed candidate is already
healthy on loopback port 3011. Prepare seals the exact before/after site files;
activate requires that receipt. Only the two tRPC proxy_pass directives move.
This operator does not build images, start containers, or read credentials.
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import secrets
import stat
import subprocess
import sys
import time
from typing import Any, Iterator


SCHEMA = "phone11-direct-meeting-release-route/v1"
SITE = Path("/etc/nginx/sites-enabled/phone11ai")
STATE_ROOT = Path("/var/lib/phone11-direct-meeting-release-route")
# Keep the same lock used by the previous Phone11 route operator.
LOCK = Path("/run/phone11-desktop-provisioning-route.lock")
ORIGINAL_SHA256 = "1b9b4c7d89d2c65c6bf8b730decd57513c46194fe21b5470981c7525d0b0ed26"
CURRENT_CONTAINER = "cp11-api-candidate-chat-inbox"
CURRENT_IMAGE = "sha256:55b593f0c392c67bc74589dcae4cb0e36b2f2e6dcd8a3552be781429ed0e2d77"
CURRENT_BUNDLE = "75381c01555e1d924eddc2da2c97a1f1e44224dec5c4f03947518e24f6148b5b"
CURRENT_CONTAINER_ID = "2b8a0746153a273cb061073fe6d26302811d055ee666fd0eacf39fe1c3a20db7"
CURRENT_SOURCE_SHA = "2d125819a7f1713f05b3eaa3bcbf5e5672a84e0c"
CURRENT_LOCK_SHA = "24a72aa60f0b43fe3afdad41f2e0f0f348f75ac065172627913fe72d43f2c801"
TARGET_CONTAINER = "cp11-api-candidate-direct-meeting"
TARGET_SOURCE_SHA = "00b2ef21518c092819c95ae956963f5f191543e4"
TARGET_BUNDLE = "1f5abb9e19da7a6040d26634d64f8ea139049c61840884477afafc097ae14bbe"
TARGET_BUILD = "direct-meeting-20260926"
CURRENT_PORT = 3010
TARGET_PORT = 3011
MAX_SITE_BYTES = 2 * 1024 * 1024
MAX_COMMAND_BYTES = 2 * 1024 * 1024
MIGRATION_ROOT = Path("/opt/phone11ai/direct-meeting-20260926/migration")
MIGRATION_OPERATOR = MIGRATION_ROOT / "phone11-direct-meetings-migrate.py"
MIGRATION_OPERATOR_SHA256 = "d1505d50b6f161681394cdc207cfb37e8931edd0e7e157975bdf289792c108cf"
MIGRATION_SQL = MIGRATION_ROOT / "direct-meeting-migration.sql"
MIGRATION_SQL_SHA256 = "043174f9cdf6d113d85e20945be4302b14a0ea9365a1798bc428b5d51c59f4e8"
MIGRATION_MANIFEST = MIGRATION_ROOT / "manifest.json"
MIGRATION_RECEIPT = Path("/var/lib/phone11-direct-meetings/receipt.json")


class GuardError(RuntimeError):
    pass


def require(condition: bool, stage: str) -> None:
    if not condition:
        raise GuardError(stage)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_arg(value: str) -> str:
    if not re.fullmatch(r"[0-9a-f]{64}", value):
        raise argparse.ArgumentTypeError("expected a lowercase SHA-256 digest")
    return value


def read_regular(path: Path, *, root_only: bool = False) -> tuple[bytes, os.stat_result]:
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1, "file_shape")
    require(before.st_size <= MAX_SITE_BYTES, "file_size")
    if root_only:
        require(before.st_uid == 0 and before.st_gid == 0 and stat.S_IMODE(before.st_mode) == 0o600, "file_owner")
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        opened = os.fstat(fd)
        require((opened.st_dev, opened.st_ino, opened.st_size, opened.st_uid, opened.st_gid,
                 stat.S_IMODE(opened.st_mode)) == (before.st_dev, before.st_ino, before.st_size,
                 before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode)), "file_identity")
        with os.fdopen(fd, "rb", closefd=False) as stream:
            data = stream.read(MAX_SITE_BYTES + 1)
        require(len(data) <= MAX_SITE_BYTES, "file_size")
        return data, before
    finally:
        os.close(fd)


def rewrite_trpc(site: bytes, source_port: int, target_port: int) -> bytes:
    """Replace one proxy_pass in each exact tRPC location, preserving all else."""
    text = site.decode("utf-8")
    edits: list[tuple[int, int, str]] = []
    for location in ("= /api/trpc", "^~ /api/trpc/"):
        header = re.compile(r"(?m)^[ \t]*location[ \t]+" + re.escape(location) + r"[ \t]*\{")
        matches = list(header.finditer(text))
        require(len(matches) == 1, "trpc_location_shape")
        start = matches[0].end()
        end = text.find("}", start)
        require(end > start and "{" not in text[start:end], "trpc_location_shape")
        block = text[start:end]
        passes = list(re.finditer(r"(?m)^[ \t]*proxy_pass[ \t]+[^;\n]+;[ \t]*$", block))
        require(len(passes) == 1, "trpc_proxy_shape")
        old = f"proxy_pass http://127.0.0.1:{source_port};"
        require(passes[0].group().strip() == old, "trpc_proxy_drift")
        line = passes[0].group()
        changed = line.replace(old, f"proxy_pass http://127.0.0.1:{target_port};")
        require(changed != line, "trpc_proxy_drift")
        edits.append((start + passes[0].start(), start + passes[0].end(), changed))
    require(edits[0][1] <= edits[1][0] or edits[1][1] <= edits[0][0], "trpc_location_shape")
    for start, end, replacement in sorted(edits, reverse=True):
        text = text[:start] + replacement + text[end:]
    result = text.encode("utf-8")
    require(result != site, "trpc_proxy_drift")
    return result


def command(args: list[str], *, timeout: int = 15) -> bytes:
    completed = subprocess.run(args, capture_output=True, timeout=timeout, check=False)
    require(completed.returncode == 0 and len(completed.stdout) <= MAX_COMMAND_BYTES, "command_failed")
    return completed.stdout


def container_info(name: str) -> dict[str, Any]:
    value = json.loads(command(["docker", "inspect", name]))
    require(isinstance(value, list) and len(value) == 1 and isinstance(value[0], dict), "container_shape")
    item = value[0]
    require(item.get("Name") == "/" + name, "container_identity")
    state = item.get("State") or {}
    require(state.get("Running") is True and (state.get("Health") or {}).get("Status") == "healthy", "container_health")
    return item


def require_loopback_binding(info: dict[str, Any], port: int, stage: str) -> None:
    expected = {f"{port}/tcp": [{"HostIp": "127.0.0.1", "HostPort": str(port)}]}
    require((info.get("HostConfig") or {}).get("PortBindings") == expected, stage)
    network_ports = (info.get("NetworkSettings") or {}).get("Ports")
    require(isinstance(network_ports, dict)
            and network_ports.get(f"{port}/tcp") == expected[f"{port}/tcp"]
            and all(not entries for key, entries in network_ports.items() if key != f"{port}/tcp"), stage)


def check_candidate(image: str, bundle: str, build: str) -> None:
    info = container_info(TARGET_CONTAINER)
    require(info.get("Image") == "sha256:" + image, "candidate_image")
    labels = (info.get("Config") or {}).get("Labels") or {}
    require(labels.get("com.phone11.source-sha") == TARGET_SOURCE_SHA
            and labels.get("com.phone11.bundle-sha256") == TARGET_BUNDLE
            and labels.get("com.phone11.overlay-parent-image-id") == CURRENT_IMAGE
            and labels.get("com.phone11.overlay-kind") == "bundle-only", "candidate_labels")
    require_loopback_binding(info, TARGET_PORT, "candidate_binding")
    bundle_result = command(["docker", "exec", TARGET_CONTAINER, "sha256sum", "/app/dist/index.mjs"])
    require(bundle_result.decode("ascii", "strict").split()[0] == bundle, "candidate_bundle")
    connection = http.client.HTTPConnection("127.0.0.1", TARGET_PORT, timeout=5)
    try:
        connection.request("GET", "/api/health")
        response = connection.getresponse()
        raw = response.read(16_385)
        require(response.status == 200 and len(raw) <= 16_384, "candidate_http")
        health = json.loads(raw)
        require(health.get("ok") is True and health.get("service") == "phone11-backend"
                and health.get("build") == build and health.get("runtimeRole") == "api-candidate", "candidate_http")
    finally:
        connection.close()


def check_predecessor() -> None:
    info = container_info(CURRENT_CONTAINER)
    require(info.get("Image") == CURRENT_IMAGE, "predecessor_image")
    require_loopback_binding(info, CURRENT_PORT, "predecessor_binding")
    bundle_result = command(["docker", "exec", CURRENT_CONTAINER, "sha256sum", "/app/dist/index.mjs"])
    require(bundle_result.decode("ascii", "strict").split()[0] == CURRENT_BUNDLE, "predecessor_bundle")
    connection = http.client.HTTPConnection("127.0.0.1", CURRENT_PORT, timeout=5)
    try:
        connection.request("GET", "/api/health")
        response = connection.getresponse()
        raw = response.read(16_385)
        require(response.status == 200 and len(raw) <= 16_384, "predecessor_http")
        health = json.loads(raw)
        require(health.get("ok") is True and health.get("service") == "phone11-backend"
                and health.get("build") == "chat-inbox-20260925"
                and health.get("runtimeRole") == "api-candidate", "predecessor_http")
    finally:
        connection.close()


def ensure_state_root() -> None:
    STATE_ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = STATE_ROOT.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and info.st_gid == 0
            and stat.S_IMODE(info.st_mode) == 0o700, "state_directory")


def atomic_write(path: Path, data: bytes, *, mode: int, uid: int = 0, gid: int = 0) -> None:
    temporary = path.with_name("." + path.name + "." + secrets.token_hex(8))
    fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        os.fchown(fd, uid, gid)
        os.fchmod(fd, mode)
        with os.fdopen(fd, "wb", closefd=False) as stream:
            stream.write(data)
            stream.flush()
        os.fsync(fd)
        os.close(fd)
        fd = -1
        os.replace(temporary, path)
        directory_fd = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if fd >= 0:
            os.close(fd)
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


@contextmanager
def lock() -> Iterator[None]:
    fd = os.open(LOCK, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and stat.S_IMODE(info.st_mode) == 0o600, "lock_shape")
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        os.close(fd)


def nginx_validate_and_reload() -> None:
    command(["nginx", "-t"])
    command(["systemctl", "reload", "nginx"])


def receipt_bytes(receipt: dict[str, Any]) -> bytes:
    return (json.dumps(receipt, sort_keys=True, separators=(",", ":")) + "\n").encode()


def _protected_directory(path: Path) -> None:
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and info.st_gid == 0
            and stat.S_IMODE(info.st_mode) == 0o700, "migration_directory")


def _sha(value: Any) -> bool:
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def check_migration_applied() -> None:
    """Bind an applied migration receipt to the current protected PostgreSQL catalog.

    The reviewed migration operator's inventory mode is read-only. Its exact
    bytes and SQL are pinned before execution; it emits fingerprints only.
    """
    _protected_directory(MIGRATION_ROOT)
    _protected_directory(MIGRATION_RECEIPT.parent)
    operator, _ = read_regular(MIGRATION_OPERATOR, root_only=True)
    sql, _ = read_regular(MIGRATION_SQL, root_only=True)
    require(digest(operator) == MIGRATION_OPERATOR_SHA256
            and digest(sql) == MIGRATION_SQL_SHA256, "migration_artifact")
    manifest_raw, _ = read_regular(MIGRATION_MANIFEST, root_only=True)
    receipt_raw, _ = read_regular(MIGRATION_RECEIPT, root_only=True)
    manifest = json.loads(manifest_raw)
    receipt = json.loads(receipt_raw)
    require(isinstance(manifest, dict) and set(manifest) == {
        "schema", "target", "release", "database_identity_sha256",
        "before_catalog_sha256", "after_catalog_sha256", "sql_sha256",
    }, "migration_manifest")
    require(isinstance(receipt, dict) and set(receipt) == {
        "schema", "manifest_sha256", "sql_sha256", "database_identity_sha256",
        "before_catalog_sha256", "after_catalog_sha256", "container_id", "image",
        "source_sha", "bundle_sha256", "lock_sha256", "backup_proof_sha256",
        "restore_proof_sha256", "status", "verification_sha256",
    }, "migration_receipt")
    expected_target = {"container_id": CURRENT_CONTAINER_ID, "container_name": CURRENT_CONTAINER,
                       "image": CURRENT_IMAGE, "container_port": CURRENT_PORT, "host_port": CURRENT_PORT}
    expected_release = {"source_sha": CURRENT_SOURCE_SHA, "bundle_sha256": CURRENT_BUNDLE,
                        "lock_sha256": CURRENT_LOCK_SHA}
    require(manifest["schema"] == "phone11.direct-meetings-migration-manifest/v1"
            and manifest["target"] == expected_target
            and manifest["release"] == expected_release
            and manifest["sql_sha256"] == MIGRATION_SQL_SHA256
            and all(_sha(manifest[key]) for key in ("database_identity_sha256",
                    "before_catalog_sha256", "after_catalog_sha256"))
            and manifest["before_catalog_sha256"] != manifest["after_catalog_sha256"],
            "migration_manifest")
    require(receipt["schema"] == "phone11.direct-meetings-migration-journal/v1"
            and receipt["status"] == "applied"
            and receipt["manifest_sha256"] == digest(manifest_raw)
            and receipt["sql_sha256"] == MIGRATION_SQL_SHA256
            and receipt["container_id"] == CURRENT_CONTAINER_ID
            and receipt["image"] == CURRENT_IMAGE
            and receipt["source_sha"] == CURRENT_SOURCE_SHA
            and receipt["bundle_sha256"] == CURRENT_BUNDLE
            and receipt["lock_sha256"] == CURRENT_LOCK_SHA
            and all(_sha(receipt[key]) for key in ("backup_proof_sha256", "restore_proof_sha256"))
            and all(receipt[key] == manifest[key] for key in (
                "database_identity_sha256", "before_catalog_sha256", "after_catalog_sha256")),
            "migration_receipt")
    verified = {key: manifest[key] for key in ("database_identity_sha256",
                "before_catalog_sha256", "after_catalog_sha256", "sql_sha256")}
    require(receipt["verification_sha256"] == digest(json.dumps(
        verified, sort_keys=True, separators=(",", ":")).encode()), "migration_receipt")
    raw = command(["/usr/bin/python3", str(MIGRATION_OPERATOR), "--inventory",
                   "--sql", str(MIGRATION_SQL), "--container-id", CURRENT_CONTAINER_ID,
                   "--container-name", CURRENT_CONTAINER, "--container-port", str(CURRENT_PORT),
                   "--host-port", str(CURRENT_PORT)], timeout=30)
    inventory = json.loads(raw)
    require(isinstance(inventory, dict) and inventory.get("schema") ==
            "phone11.direct-meetings-migration-inventory/v1"
            and inventory.get("target") == expected_target
            and inventory.get("release") == expected_release
            and inventory.get("sql_sha256") == MIGRATION_SQL_SHA256
            and inventory.get("database_identity_sha256") == manifest["database_identity_sha256"]
            and inventory.get("before_catalog_sha256") == manifest["after_catalog_sha256"],
            "migration_catalog")


def inventory() -> None:
    site, info = read_regular(SITE)
    require(info.st_uid == 0 and info.st_gid == 0, "site_owner")
    print(json.dumps({"schema": SCHEMA, "site_sha256": digest(site), "route":
                      "original" if digest(site) == ORIGINAL_SHA256 else "changed"}, sort_keys=True))


RECEIPT_FIELDS = {"schema", "site", "before_sha256", "active_sha256", "target_container",
                  "target_image", "target_source_sha", "target_bundle_sha256", "target_build", "state"}


def load_receipt(receipt_dir: Path, expected_state: str | tuple[str, ...]) -> tuple[dict[str, Any], bytes, bytes]:
    require(receipt_dir.parent == STATE_ROOT and not receipt_dir.is_symlink(), "receipt_path")
    directory = receipt_dir.lstat()
    require(stat.S_ISDIR(directory.st_mode) and directory.st_uid == 0 and directory.st_gid == 0
            and stat.S_IMODE(directory.st_mode) == 0o700, "receipt_shape")
    raw, _ = read_regular(receipt_dir / "receipt.json", root_only=True)
    record = json.loads(raw)
    require(isinstance(record, dict) and set(record) == RECEIPT_FIELDS, "receipt_shape")
    accepted = (expected_state,) if isinstance(expected_state, str) else expected_state
    require(record["schema"] == SCHEMA and record["site"] == str(SITE)
            and record["target_container"] == TARGET_CONTAINER and record["state"] in accepted
            and record["before_sha256"] == ORIGINAL_SHA256
            and record["target_source_sha"] == TARGET_SOURCE_SHA
            and record["target_bundle_sha256"] == TARGET_BUNDLE
            and record["target_build"] == TARGET_BUILD
            and isinstance(record["target_image"], str)
            and re.fullmatch(r"sha256:[0-9a-f]{64}", record["target_image"]), "receipt_shape")
    before, _ = read_regular(receipt_dir / "site.before", root_only=True)
    active, _ = read_regular(receipt_dir / "site.active", root_only=True)
    require(digest(before) == record["before_sha256"] and digest(active) == record["active_sha256"]
            and rewrite_trpc(before, CURRENT_PORT, TARGET_PORT) == active
            and rewrite_trpc(active, TARGET_PORT, CURRENT_PORT) == before, "receipt_integrity")
    return record, before, active


def prepare(image: str) -> None:
    require(os.geteuid() == 0, "root_required")
    with lock():
        site, info = read_regular(SITE)
        require(info.st_uid == 0 and info.st_gid == 0, "site_owner")
        require(digest(site) == ORIGINAL_SHA256, "site_drift")
        target = rewrite_trpc(site, CURRENT_PORT, TARGET_PORT)
        require(rewrite_trpc(target, TARGET_PORT, CURRENT_PORT) == site, "route_roundtrip")
        check_predecessor()
        check_migration_applied()
        check_candidate(image, TARGET_BUNDLE, TARGET_BUILD)
        ensure_state_root()
        run = STATE_ROOT / (time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()) + "-" + secrets.token_hex(8))
        run.mkdir(mode=0o700)
        before = run / "site.before"
        after = run / "site.active"
        receipt_file = run / "receipt.json"
        atomic_write(before, site, mode=0o600)
        atomic_write(after, target, mode=0o600)
        record = {"schema": SCHEMA, "site": str(SITE), "before_sha256": digest(site),
                  "active_sha256": digest(target), "target_container": TARGET_CONTAINER,
                  "target_image": "sha256:" + image, "target_source_sha": TARGET_SOURCE_SHA,
                  "target_bundle_sha256": TARGET_BUNDLE,
                  "target_build": TARGET_BUILD, "state": "prepared"}
        atomic_write(receipt_file, receipt_bytes(record), mode=0o600)
        print(json.dumps({"state": "prepared", "receipt_dir": str(run),
                          "site_sha256": digest(site), "candidate_site_sha256": digest(target)}, sort_keys=True))


def activate(receipt_dir: Path) -> None:
    require(os.geteuid() == 0, "root_required")
    with lock():
        ensure_state_root()
        record, site, target = load_receipt(receipt_dir, "prepared")
        current, info = read_regular(SITE)
        require(info.st_uid == 0 and info.st_gid == 0, "site_owner")
        require(current == site, "site_drift")
        check_predecessor()
        check_migration_applied()
        check_candidate(record["target_image"][7:], TARGET_BUNDLE, TARGET_BUILD)
        current, _ = read_regular(SITE)
        require(current == site, "site_drift")
        try:
            atomic_write(SITE, target, mode=stat.S_IMODE(info.st_mode), uid=info.st_uid, gid=info.st_gid)
            nginx_validate_and_reload()
            require(read_regular(SITE)[0] == target, "site_drift")
            record["state"] = "active"
            atomic_write(receipt_dir / "receipt.json", receipt_bytes(record), mode=0o600)
        except Exception:
            if read_regular(SITE)[0] == target:
                atomic_write(SITE, site, mode=stat.S_IMODE(info.st_mode), uid=info.st_uid, gid=info.st_gid)
                try:
                    nginx_validate_and_reload()
                except Exception as error:
                    raise GuardError("restore_requires_operator") from error
            raise
        print(json.dumps({"state": "active", "receipt_dir": str(receipt_dir), "site_sha256": digest(target)}, sort_keys=True))


def rollback(receipt_dir: Path) -> None:
    require(os.geteuid() == 0, "root_required")
    with lock():
        ensure_state_root()
        record, before, active = load_receipt(receipt_dir, "active")
        site, info = read_regular(SITE)
        require(info.st_uid == 0 and info.st_gid == 0, "site_owner")
        require(site == active, "site_drift")
        check_predecessor()
        try:
            atomic_write(SITE, before, mode=stat.S_IMODE(info.st_mode), uid=info.st_uid, gid=info.st_gid)
            nginx_validate_and_reload()
            require(read_regular(SITE)[0] == before, "site_drift")
        except Exception:
            if read_regular(SITE)[0] == before:
                atomic_write(SITE, active, mode=stat.S_IMODE(info.st_mode), uid=info.st_uid, gid=info.st_gid)
                try:
                    nginx_validate_and_reload()
                except Exception as error:
                    raise GuardError("restore_requires_operator") from error
            raise
        record["state"] = "rolled_back"
        atomic_write(receipt_dir / "receipt.json", receipt_bytes(record), mode=0o600)
        print(json.dumps({"state": "rolled_back", "receipt_dir": str(receipt_dir),
                          "site_sha256": digest(before)}, sort_keys=True))


def recover(receipt_dir: Path) -> None:
    """Resolve an interrupted activate/rollback toward the pinned predecessor.

    A prepared receipt with an active site means the process stopped between
    writing/reloading Nginx and recording state. Rewriting the sealed before
    site and reloading is safe whether Nginx had switched or not. A receipt in
    active state with an already-restored site is handled the same way.
    """
    require(os.geteuid() == 0, "root_required")
    with lock():
        ensure_state_root()
        record, before, active = load_receipt(receipt_dir, ("prepared", "active"))
        site, info = read_regular(SITE)
        require(info.st_uid == 0 and info.st_gid == 0, "site_owner")
        require(site in (before, active), "site_drift")
        check_predecessor()
        if site == active:
            atomic_write(SITE, before, mode=stat.S_IMODE(info.st_mode), uid=info.st_uid, gid=info.st_gid)
        # Reload even when the file already equals before: an interrupted
        # rollback may have restored the file without reloading Nginx.
        nginx_validate_and_reload()
        require(read_regular(SITE)[0] == before, "site_drift")
        record["state"] = "rolled_back"
        atomic_write(receipt_dir / "receipt.json", receipt_bytes(record), mode=0o600)
        print(json.dumps({"state": "rolled_back", "receipt_dir": str(receipt_dir),
                          "site_sha256": digest(before)}, sort_keys=True))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_subparsers(dest="action", required=True)
    actions.add_parser("inventory", help="print only the site hash and route state")
    prepare_parser = actions.add_parser("prepare", help="seal exact site snapshots after pinned checks")
    prepare_parser.add_argument("--image-sha256", type=sha256_arg, required=True)
    activate_parser = actions.add_parser("activate", help="switch the two tRPC routes using a prepared receipt")
    activate_parser.add_argument("--receipt-dir", type=Path, required=True)
    rollback_parser = actions.add_parser("rollback", help="restore the sealed predecessor site")
    rollback_parser.add_argument("--receipt-dir", type=Path, required=True)
    recover_parser = actions.add_parser("recover", help="settle an interrupted switch to the predecessor")
    recover_parser.add_argument("--receipt-dir", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.action == "inventory":
            inventory()
        elif args.action == "prepare":
            prepare(args.image_sha256)
        elif args.action == "activate":
            activate(args.receipt_dir)
        elif args.action == "rollback":
            rollback(args.receipt_dir)
        else:
            recover(args.receipt_dir)
        return 0
    except (GuardError, OSError, ValueError, TimeoutError, subprocess.TimeoutExpired):
        print("Phone11 route operation refused; inspect the sealed receipt and live site before retrying.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
