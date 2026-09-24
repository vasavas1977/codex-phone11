#!/usr/bin/env python3
"""Guarded route switch for the Phone11 desktop provisioning API candidate.

Run as root on the VoIP host after a separately reviewed candidate is already
healthy on loopback port 3007. Only the two tRPC proxy_pass directives move.
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


SCHEMA = "phone11-desktop-provisioning-route/v1"
SITE = Path("/etc/nginx/sites-enabled/phone11ai")
STATE_ROOT = Path("/var/lib/phone11-desktop-provisioning-route")
LOCK = Path("/run/phone11-desktop-provisioning-route.lock")
ORIGINAL_SHA256 = "6ad776e84161d58be0eb37235652c90531c4f5fb4c3bccc4f042fc02a86a189b"
CURRENT_CONTAINER = "cp11-api-candidate-channel"
TARGET_CONTAINER = "cp11-api-candidate-desktop-provisioning"
CURRENT_PORT = 3006
TARGET_PORT = 3007
MAX_SITE_BYTES = 2 * 1024 * 1024
MAX_COMMAND_BYTES = 2 * 1024 * 1024


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


def check_candidate(image: str, bundle: str, build: str) -> None:
    info = container_info(TARGET_CONTAINER)
    require(info.get("Image") == "sha256:" + image, "candidate_image")
    bindings = (info.get("NetworkSettings") or {}).get("Ports") or {}
    bound = [entry for entries in bindings.values() if isinstance(entries, list) for entry in entries]
    require(any(entry.get("HostIp") in ("127.0.0.1", "::1") and entry.get("HostPort") == str(TARGET_PORT) for entry in bound), "candidate_binding")
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
    container_info(CURRENT_CONTAINER)
    connection = http.client.HTTPConnection("127.0.0.1", CURRENT_PORT, timeout=5)
    try:
        connection.request("GET", "/api/health")
        response = connection.getresponse()
        raw = response.read(16_385)
        require(response.status == 200 and len(raw) <= 16_384, "predecessor_http")
        health = json.loads(raw)
        require(health.get("ok") is True and health.get("service") == "phone11-backend", "predecessor_http")
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


def inventory() -> None:
    site, info = read_regular(SITE)
    require(info.st_uid == 0 and info.st_gid == 0, "site_owner")
    print(json.dumps({"schema": SCHEMA, "site_sha256": digest(site), "route":
                      "original" if digest(site) == ORIGINAL_SHA256 else "changed"}, sort_keys=True))


def activate(image: str, bundle: str, build: str) -> None:
    require(os.geteuid() == 0, "root_required")
    with lock():
        site, info = read_regular(SITE)
        require(info.st_uid == 0 and info.st_gid == 0, "site_owner")
        require(digest(site) == ORIGINAL_SHA256, "site_drift")
        target = rewrite_trpc(site, CURRENT_PORT, TARGET_PORT)
        require(rewrite_trpc(target, TARGET_PORT, CURRENT_PORT) == site, "route_roundtrip")
        check_predecessor()
        check_candidate(image, bundle, build)
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
                  "target_image": "sha256:" + image, "target_bundle_sha256": bundle,
                  "target_build": build, "state": "prepared"}
        atomic_write(receipt_file, receipt_bytes(record), mode=0o600)
        current, _ = read_regular(SITE)
        require(current == site, "site_drift")
        try:
            atomic_write(SITE, target, mode=stat.S_IMODE(info.st_mode), uid=info.st_uid, gid=info.st_gid)
            nginx_validate_and_reload()
            require(read_regular(SITE)[0] == target, "site_drift")
            record["state"] = "active"
            atomic_write(receipt_file, receipt_bytes(record), mode=0o600)
        except Exception:
            if read_regular(SITE)[0] == target:
                atomic_write(SITE, site, mode=stat.S_IMODE(info.st_mode), uid=info.st_uid, gid=info.st_gid)
                try:
                    nginx_validate_and_reload()
                except Exception as error:
                    raise GuardError("restore_requires_operator") from error
            raise
        print(json.dumps({"state": "active", "receipt_dir": str(run), "site_sha256": digest(target)}, sort_keys=True))


def rollback(receipt_dir: Path) -> None:
    require(os.geteuid() == 0, "root_required")
    with lock():
        ensure_state_root()
        require(receipt_dir.parent == STATE_ROOT and not receipt_dir.is_symlink(), "receipt_path")
        directory = receipt_dir.lstat()
        require(stat.S_ISDIR(directory.st_mode) and directory.st_uid == 0
                and stat.S_IMODE(directory.st_mode) == 0o700, "receipt_shape")
        raw, _ = read_regular(receipt_dir / "receipt.json", root_only=True)
        record = json.loads(raw)
        require(isinstance(record, dict) and set(record) == {"schema", "site", "before_sha256",
                "active_sha256", "target_container", "target_image", "target_bundle_sha256",
                "target_build", "state"}, "receipt_shape")
        require(record["schema"] == SCHEMA and record["site"] == str(SITE)
                and record["target_container"] == TARGET_CONTAINER and record["state"] == "active"
                and record["before_sha256"] == ORIGINAL_SHA256, "receipt_shape")
        before, _ = read_regular(receipt_dir / "site.before", root_only=True)
        active, _ = read_regular(receipt_dir / "site.active", root_only=True)
        require(digest(before) == record["before_sha256"] and digest(active) == record["active_sha256"]
                and rewrite_trpc(before, CURRENT_PORT, TARGET_PORT) == active, "receipt_integrity")
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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_subparsers(dest="action", required=True)
    actions.add_parser("inventory", help="print only the site hash and route state")
    activate_parser = actions.add_parser("activate", help="switch the two tRPC routes after pinned checks")
    activate_parser.add_argument("--image-sha256", type=sha256_arg, required=True)
    activate_parser.add_argument("--bundle-sha256", type=sha256_arg, required=True)
    activate_parser.add_argument("--build", required=True)
    rollback_parser = actions.add_parser("rollback", help="restore the sealed predecessor site")
    rollback_parser.add_argument("--receipt-dir", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.action == "inventory":
            inventory()
        elif args.action == "activate":
            require(bool(re.fullmatch(r"[A-Za-z0-9_.-]{7,128}", args.build)), "build_pin")
            activate(args.image_sha256, args.bundle_sha256, args.build)
        else:
            rollback(args.receipt_dir)
        return 0
    except (GuardError, OSError, ValueError, TimeoutError, subprocess.TimeoutExpired):
        print("Phone11 route operation refused; inspect the sealed receipt and live site before retrying.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
