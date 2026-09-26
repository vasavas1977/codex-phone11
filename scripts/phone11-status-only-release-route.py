#!/usr/bin/env python3
"""Guarded 3011 -> 3012 route switch for a reviewed status-only API candidate.

Run as root on the VoIP host after a separately reviewed candidate is already
healthy on loopback port 3012. Prepare seals the exact before/after site files
and an execution-time pin manifest; activate requires that receipt. Only the
two tRPC proxy_pass directives move. Migration inventory probes are separate
reviewed root-owned programs; this operator neither applies SQL nor builds or
starts a container. It never prints environment variables or credentials.
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
import select
import stat
import subprocess
import sys
import time
from typing import Any, Iterator


SCHEMA = "phone11-status-only-release-route/v1"
SITE = Path("/etc/nginx/sites-enabled/phone11ai")
STATE_ROOT = Path("/var/lib/phone11-status-only-release-route")
# Keep the same lock used by the previous Phone11 route operator.
LOCK = Path("/run/phone11-desktop-provisioning-route.lock")
ORIGINAL_SHA256 = "2f744bb0df277cd4cbe7a50c2a6f9122530821d7bfa56f32d1fdb2ac64c59520"
CURRENT_CONTAINER = "cp11-api-candidate-direct-meeting"
CURRENT_IMAGE = "sha256:c32a2a3a72061f2d4dbb8a54a1528666fd25003cd9782ae9de4ffa60c0e7d1b3"
CURRENT_BUNDLE = "1f5abb9e19da7a6040d26634d64f8ea139049c61840884477afafc097ae14bbe"
CURRENT_CONTAINER_ID = "bd3b5acf2647d239b5d5298c23a0b1bf60699379b25e4e8023b67e27fd6a6195"
CURRENT_SOURCE_SHA = "00b2ef21518c092819c95ae956963f5f191543e4"
CURRENT_LOCK_SHA = "24a72aa60f0b43fe3afdad41f2e0f0f348f75ac065172627913fe72d43f2c801"
CURRENT_BUILD = "direct-meeting-20260926"
TARGET_CONTAINER = "cp11-api-candidate-status"
CURRENT_PORT = 3011
TARGET_PORT = 3012
MAX_SITE_BYTES = 2 * 1024 * 1024
MAX_COMMAND_BYTES = 2 * 1024 * 1024
PYTHON_EXECUTABLE = "/usr/bin/python3"
VERIFIED_CWD = "/"
VERIFIED_ENV = {"PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C"}
GATE_ROOT = Path("/opt/phone11ai/status-only-release-20260926/gates")
GATE_SCHEMA = "phone11.status-only-release-gates/v1"
STATUS_ROOT = Path("/opt/phone11ai/status-only-release-20260926/migration")
STATUS_OPERATOR = STATUS_ROOT / "phone11-profile-status-migrate.py"
STATUS_SQL = STATUS_ROOT / "profile-status-migration.sql"
STATUS_MANIFEST = STATUS_ROOT / "manifest.json"
STATUS_RECEIPT = Path("/var/lib/phone11-profile-status/receipt.json")
STATUS_OPERATOR_SHA = "376a0b45dd534d58b6019b91257373961f48f2275d822f5f23a56e9bf4a7a6c1"
STATUS_SQL_SHA = "92612ccd3c216cd46ac000e51c146bfdaa06117dea12211d64b70fe20b87bcc8"
# Direct-meeting migration remains independently pinned to its original 3010
# target; the database identity is compared with the new gate inventories.
MIGRATION_ROOT = Path("/opt/phone11ai/direct-meeting-20260926/migration")
MIGRATION_OPERATOR = MIGRATION_ROOT / "phone11-direct-meetings-migrate.py"
MIGRATION_OPERATOR_SHA256 = "d1505d50b6f161681394cdc207cfb37e8931edd0e7e157975bdf289792c108cf"
MIGRATION_SQL = MIGRATION_ROOT / "direct-meeting-migration.sql"
MIGRATION_SQL_SHA256 = "043174f9cdf6d113d85e20945be4302b14a0ea9365a1798bc428b5d51c59f4e8"
MIGRATION_MANIFEST = MIGRATION_ROOT / "manifest.json"
MIGRATION_RECEIPT = Path("/var/lib/phone11-direct-meetings/receipt.json")
DIRECT_CONTAINER = "cp11-api-candidate-chat-inbox"
DIRECT_IMAGE = "sha256:55b593f0c392c67bc74589dcae4cb0e36b2f2e6dcd8a3552be781429ed0e2d77"
DIRECT_BUNDLE = "75381c01555e1d924eddc2da2c97a1f1e44224dec5c4f03947518e24f6148b5b"
DIRECT_CONTAINER_ID = "2b8a0746153a273cb061073fe6d26302811d055ee666fd0eacf39fe1c3a20db7"
DIRECT_SOURCE_SHA = "2d125819a7f1713f05b3eaa3bcbf5e5672a84e0c"
DIRECT_PORT = 3010
CURRENT_ROUTE_RECEIPT = Path("/var/lib/phone11-direct-meeting-release-route/20260925T190157Z-225ab558495ccbde/receipt.json")


class GuardError(RuntimeError):
    pass


def require(condition: bool, stage: str) -> None:
    if not condition:
        raise GuardError(stage)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


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


def run_verified_python(source: bytes, args: list[str], *, timeout: int = 30) -> bytes:
    """Execute the bytes already verified, never a replaceable source pathname.

    Python's `-` mode copies the script through stdin before execution. `-I`
    excludes the working directory, user site, and Python environment from
    module search. A fixed cwd and minimal environment also prevent inherited
    search-path and interpreter hooks. Reviewed inventory scripts must not
    depend on __file__, inherited environment, or process stdin after startup.
    """
    require(0 < len(source) <= MAX_SITE_BYTES, "verified_source_size")
    completed = subprocess.run([PYTHON_EXECUTABLE, "-I", "-", *args], input=source,
                               cwd=VERIFIED_CWD, env=VERIFIED_ENV,
                               capture_output=True, timeout=timeout, check=False)
    require(completed.returncode == 0 and 0 < len(completed.stdout) <= MAX_COMMAND_BYTES,
            "verified_command_failed")
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


def check_candidate(pins: dict[str, str]) -> None:
    info = container_info(TARGET_CONTAINER)
    require(info.get("Id") == pins["container_id"] and info.get("Image") == pins["image"], "candidate_image")
    labels = (info.get("Config") or {}).get("Labels") or {}
    require(labels.get("com.phone11.source-sha") == pins["source_sha"]
            and labels.get("com.phone11.bundle-sha256") == pins["bundle_sha256"]
            and labels.get("com.phone11.lock-sha256") == pins["lock_sha256"]
            and labels.get("com.phone11.candidate-build") == pins["build"]
            and labels.get("com.phone11.overlay-parent-image-id") == CURRENT_IMAGE
            and labels.get("com.phone11.overlay-kind") == "bundle-only", "candidate_labels")
    environment = (info.get("Config") or {}).get("Env") or []
    require(isinstance(environment, list) and all(isinstance(item, str) for item in environment), "candidate_environment")
    hook = [item for item in environment
            if item.partition("=")[0] == "PHONE11_VOICEMAIL_HOOK_READY"]
    require(len(hook) <= 1 and (not hook or hook[0] == "PHONE11_VOICEMAIL_HOOK_READY=false"), "voicemail_hook_off")
    require_loopback_binding(info, TARGET_PORT, "candidate_binding")
    bundle_result = command(["docker", "exec", TARGET_CONTAINER, "sha256sum", "/app/dist/index.mjs"])
    require(bundle_result.decode("ascii", "strict").split()[0] == pins["bundle_sha256"], "candidate_bundle")
    connection = http.client.HTTPConnection("127.0.0.1", TARGET_PORT, timeout=5)
    try:
        connection.request("GET", "/api/health")
        response = connection.getresponse()
        raw = response.read(16_385)
        require(response.status == 200 and len(raw) <= 16_384, "candidate_http")
        health = json.loads(raw)
        require(health.get("ok") is True and health.get("service") == "phone11-backend"
                and health.get("build") == pins["build"] and health.get("runtimeRole") == "api-candidate", "candidate_http")
    finally:
        connection.close()


def check_predecessor() -> None:
    info = container_info(CURRENT_CONTAINER)
    require(info.get("Id") == CURRENT_CONTAINER_ID and info.get("Image") == CURRENT_IMAGE, "predecessor_image")
    labels = (info.get("Config") or {}).get("Labels") or {}
    require(labels.get("com.phone11.source-sha") == CURRENT_SOURCE_SHA
            and labels.get("com.phone11.bundle-sha256") == CURRENT_BUNDLE
            and labels.get("com.phone11.lock-sha256") == CURRENT_LOCK_SHA
            and labels.get("com.phone11.candidate-build") == CURRENT_BUILD, "predecessor_labels")
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
                and health.get("build") == CURRENT_BUILD
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


def check_current_route_receipt() -> None:
    _protected_directory(CURRENT_ROUTE_RECEIPT.parent.parent)
    _protected_directory(CURRENT_ROUTE_RECEIPT.parent)
    raw, _ = read_regular(CURRENT_ROUTE_RECEIPT, root_only=True)
    receipt = json.loads(raw)
    require(isinstance(receipt, dict) and receipt == {
        "active_sha256": ORIGINAL_SHA256,
        "before_sha256": "1b9b4c7d89d2c65c6bf8b730decd57513c46194fe21b5470981c7525d0b0ed26",
        "schema": "phone11-direct-meeting-release-route/v1",
        "site": str(SITE),
        "state": "active",
        "target_build": CURRENT_BUILD,
        "target_bundle_sha256": CURRENT_BUNDLE,
        "target_container": CURRENT_CONTAINER,
        "target_image": CURRENT_IMAGE,
        "target_source_sha": CURRENT_SOURCE_SHA,
    }, "current_route_receipt")


def check_migration_applied() -> str:
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
    expected_target = {"container_id": DIRECT_CONTAINER_ID, "container_name": DIRECT_CONTAINER,
                       "image": DIRECT_IMAGE, "container_port": DIRECT_PORT, "host_port": DIRECT_PORT}
    expected_release = {"source_sha": DIRECT_SOURCE_SHA, "bundle_sha256": DIRECT_BUNDLE,
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
            and receipt["container_id"] == DIRECT_CONTAINER_ID
            and receipt["image"] == DIRECT_IMAGE
            and receipt["source_sha"] == DIRECT_SOURCE_SHA
            and receipt["bundle_sha256"] == DIRECT_BUNDLE
            and receipt["lock_sha256"] == CURRENT_LOCK_SHA
            and all(_sha(receipt[key]) for key in ("backup_proof_sha256", "restore_proof_sha256"))
            and all(receipt[key] == manifest[key] for key in (
                "database_identity_sha256", "before_catalog_sha256", "after_catalog_sha256")),
            "migration_receipt")
    verified = {key: manifest[key] for key in ("database_identity_sha256",
                "before_catalog_sha256", "after_catalog_sha256", "sql_sha256")}
    require(receipt["verification_sha256"] == digest(json.dumps(
        verified, sort_keys=True, separators=(",", ":")).encode()), "migration_receipt")
    raw = run_verified_python(operator, ["--inventory", "--sql", str(MIGRATION_SQL),
                                         "--container-id", DIRECT_CONTAINER_ID,
                                         "--container-name", DIRECT_CONTAINER,
                                         "--container-port", str(DIRECT_PORT),
                                         "--host-port", str(DIRECT_PORT)], timeout=30)
    inventory = json.loads(raw)
    require(isinstance(inventory, dict) and inventory.get("schema") ==
            "phone11.direct-meetings-migration-inventory/v1"
            and inventory.get("target") == expected_target
            and inventory.get("release") == expected_release
            and inventory.get("sql_sha256") == MIGRATION_SQL_SHA256
            and inventory.get("database_identity_sha256") == manifest["database_identity_sha256"]
            and inventory.get("before_catalog_sha256") == manifest["after_catalog_sha256"],
            "migration_catalog")
    return manifest["database_identity_sha256"]


PIN_FIELDS = {"container_id", "image", "source_sha", "bundle_sha256", "lock_sha256", "build"}
def load_gate_manifest(path: Path) -> tuple[dict[str, Any], bytes]:
    require(path == GATE_ROOT / "manifest.json", "gate_path")
    _protected_directory(GATE_ROOT)
    raw, _ = read_regular(path, root_only=True)
    value = json.loads(raw)
    require(isinstance(value, dict) and set(value) == {"schema", "candidate"}
            and value["schema"] == GATE_SCHEMA and isinstance(value["candidate"], dict)
            and set(value["candidate"]) == PIN_FIELDS, "gate_manifest")
    pins = value["candidate"]
    require(all(isinstance(pins[k], str) for k in PIN_FIELDS)
            and re.fullmatch(r"[0-9a-f]{40}", pins["source_sha"]) is not None
            and re.fullmatch(r"[a-z0-9][a-z0-9-]{3,63}", pins["build"]) is not None
            and re.fullmatch(r"[0-9a-f]{64}", pins["container_id"]) is not None
            and re.fullmatch(r"sha256:[0-9a-f]{64}", pins["image"]) is not None
            and all(_sha(pins[k]) for k in ("bundle_sha256", "lock_sha256"))
            and pins["lock_sha256"] == CURRENT_LOCK_SHA, "gate_candidate")
    return value, raw


def check_status_migration_applied(direct_identity: str) -> tuple[str, str, bytes]:
    _protected_directory(STATUS_ROOT)
    _protected_directory(STATUS_RECEIPT.parent)
    operator, _ = read_regular(STATUS_OPERATOR, root_only=True)
    sql, _ = read_regular(STATUS_SQL, root_only=True)
    require(digest(operator) == STATUS_OPERATOR_SHA and digest(sql) == STATUS_SQL_SHA, "status_artifact")
    manifest_raw, _ = read_regular(STATUS_MANIFEST, root_only=True)
    receipt_raw, _ = read_regular(STATUS_RECEIPT, root_only=True)
    manifest, receipt = json.loads(manifest_raw), json.loads(receipt_raw)
    require(isinstance(manifest, dict) and set(manifest) == {
        "schema", "target", "release", "database_identity_sha256",
        "before_catalog_sha256", "after_catalog_sha256", "sql_sha256",
    }, "status_manifest")
    require(isinstance(receipt, dict) and set(receipt) == {
        "schema", "manifest_sha256", "sql_sha256", "database_identity_sha256",
        "before_catalog_sha256", "after_catalog_sha256", "container_id", "image",
        "source_sha", "bundle_sha256", "lock_sha256", "backup_proof_sha256",
        "restore_proof_sha256", "status", "verification_sha256",
    }, "status_receipt")
    target = {"container_id": CURRENT_CONTAINER_ID, "container_name": CURRENT_CONTAINER,
              "image": CURRENT_IMAGE, "container_port": CURRENT_PORT, "host_port": CURRENT_PORT}
    release = {"source_sha": CURRENT_SOURCE_SHA, "bundle_sha256": CURRENT_BUNDLE,
               "lock_sha256": CURRENT_LOCK_SHA}
    require(manifest["schema"] == "phone11.profile-status-migration-manifest/v1"
            and manifest["target"] == target and manifest["release"] == release
            and manifest["database_identity_sha256"] == direct_identity
            and manifest["sql_sha256"] == STATUS_SQL_SHA
            and all(_sha(manifest[k]) for k in ("before_catalog_sha256", "after_catalog_sha256"))
            and manifest["before_catalog_sha256"] != manifest["after_catalog_sha256"],
            "status_manifest")
    require(receipt["schema"] == "phone11.profile-status-migration-journal/v1"
            and receipt["status"] == "applied"
            and receipt["manifest_sha256"] == digest(manifest_raw)
            and receipt["sql_sha256"] == STATUS_SQL_SHA
            and all(receipt[k] == manifest[k] for k in (
                "database_identity_sha256", "before_catalog_sha256", "after_catalog_sha256"))
            and all(receipt[k] == (target | release)[k] for k in (
                "container_id", "image", "source_sha", "bundle_sha256", "lock_sha256"))
            and all(_sha(receipt[k]) for k in ("backup_proof_sha256", "restore_proof_sha256")),
            "status_receipt")
    verified = {k: manifest[k] for k in ("database_identity_sha256", "before_catalog_sha256",
                                       "after_catalog_sha256", "sql_sha256")}
    require(receipt["verification_sha256"] == digest(json.dumps(
        verified, sort_keys=True, separators=(",", ":")).encode()), "status_receipt")
    raw = run_verified_python(operator, ["--inventory", "--sql", str(STATUS_SQL),
                                         "--container-id", CURRENT_CONTAINER_ID,
                                         "--container-name", CURRENT_CONTAINER,
                                         "--container-port", str(CURRENT_PORT),
                                         "--host-port", str(CURRENT_PORT)], timeout=30)
    inventory = json.loads(raw)
    require(isinstance(inventory, dict)
            and inventory.get("schema") == "phone11.profile-status-migration-inventory/v1"
            and inventory.get("target") == target and inventory.get("release") == release
            and inventory.get("sql_sha256") == STATUS_SQL_SHA
            and inventory.get("database_identity_sha256") == direct_identity
            and inventory.get("before_catalog_sha256") == manifest["after_catalog_sha256"],
            "status_catalog")
    return direct_identity, manifest["after_catalog_sha256"], operator


PBX_DB_CONFIG_PROGRAM = r'''
const pg = require("pg");
function firstEnv(...keys) { for (const key of keys) { const value = process.env[key]; if (value) return value; } return undefined; }
function sslConfig(connectionString) {
  const mode = firstEnv("PG_SSL", "DB_SSL", "POSTGRES_SSL", "DATABASE_SSL")?.toLowerCase();
  if (mode === "false" || mode === "0" || mode === "disable" || connectionString?.includes("sslmode=disable")) return false;
  return {rejectUnauthorized:firstEnv("PG_SSL_REJECT_UNAUTHORIZED", "DB_SSL_REJECT_UNAUTHORIZED") === "true"};
}
function pbxConfig() {
  // Match the status router's server/pbx/db.ts buildPgConfig.
  const discrete = {
    host:firstEnv("PG_HOST", "DB_HOST", "POSTGRES_HOST"),
    port:firstEnv("PG_PORT", "DB_PORT", "POSTGRES_PORT"),
    user:firstEnv("PG_USER", "DB_USER", "POSTGRES_USER"),
    password:firstEnv("PG_PASSWORD", "DB_PASSWORD", "POSTGRES_PASSWORD"),
    database:firstEnv("PG_DATABASE", "DB_NAME", "DB_DATABASE", "POSTGRES_DB"),
  };
  const complete = [discrete.host,discrete.user,discrete.password,discrete.database].every(Boolean);
  const connectionString = process.env.PG_CONNECTION_STRING ?? (complete ? undefined : process.env.DATABASE_URL);
  if (connectionString) return {connectionString,ssl:sslConfig(connectionString),connectionTimeoutMillis:5000,max:1};
  if (!complete) throw new Error("configuration");
  return {host:discrete.host,port:parseInt(discrete.port ?? "5432",10),user:discrete.user,
    password:discrete.password,database:discrete.database,ssl:sslConfig(),connectionTimeoutMillis:5000,max:1};
}
'''

DND_COUNT_PROGRAM = PBX_DB_CONFIG_PROGRAM + r'''
(async()=>{const pool=new pg.Pool(pbxConfig());let client;
try {client=await pool.connect();await client.query("BEGIN TRANSACTION READ ONLY");await client.query("SET LOCAL statement_timeout='5000ms'");const result=await client.query("SELECT COUNT(*)::int AS count FROM phone11_workspace_profile_status_settings WHERE dnd_enabled IS TRUE");await client.query("ROLLBACK");process.stdout.write(String(result.rows[0]?.count));}
catch (_) {process.exitCode=2;} finally {client?.release();await pool.end().catch(()=>undefined);}})();
'''


# A clone can have the same database OID and schema fingerprint as production.
# A held advisory lock proves both containers reached the same PostgreSQL lock
# manager at the instant of the route gate, without privileged cluster APIs.
CLUSTER_LOCK_PROGRAM = PBX_DB_CONFIG_PROGRAM + r'''
const mode = process.argv[1], key = process.argv[2];
if (!["hold","probe"].includes(mode) || !/^[0-9]{1,19}$/.test(key)) process.exit(2);
(async()=>{const pool=new pg.Pool(pbxConfig());let client;
try {client=await pool.connect();await client.query("BEGIN TRANSACTION READ ONLY");await client.query("SET LOCAL statement_timeout='5000ms'");
  if(mode === "hold") {await client.query("SELECT pg_advisory_lock($1::bigint)",[key]);process.stdout.write("held\n");await new Promise(resolve=>{process.stdin.resume();process.stdin.once("end",resolve)});await client.query("SELECT pg_advisory_unlock($1::bigint)",[key]);}
  else {const acquired=(await client.query("SELECT pg_try_advisory_lock($1::bigint) acquired",[key])).rows[0]?.acquired;if(acquired) await client.query("SELECT pg_advisory_unlock($1::bigint)",[key]);process.stdout.write(acquired === false ? "blocked" : "free");}
  await client.query("ROLLBACK");
} catch (_) {process.exitCode=2;} finally {client?.release();await pool.end().catch(()=>undefined);}})();
'''


def check_same_database_cluster(candidate_container_id: str) -> None:
    key = str(secrets.randbits(63) + 1)
    holder_args = ["docker", "exec", "--interactive", "--workdir", "/app",
                   CURRENT_CONTAINER_ID, "node", "-e", CLUSTER_LOCK_PROGRAM, "hold", key]
    try:
        holder = subprocess.Popen(holder_args, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.DEVNULL)
    except OSError as error:
        raise GuardError("candidate_database_cluster") from error
    try:
        require(holder.stdout is not None and holder.stdin is not None, "candidate_database_cluster")
        readable, _, _ = select.select([holder.stdout], [], [], 10)
        require(bool(readable) and holder.stdout.readline() == b"held\n"
                and holder.poll() is None, "candidate_database_cluster")
        result = command(["docker", "exec", "--workdir", "/app", candidate_container_id,
                          "node", "-e", CLUSTER_LOCK_PROGRAM, "probe", key], timeout=15)
        require(holder.poll() is None and result == b"blocked", "candidate_database_cluster")
    except (OSError, subprocess.TimeoutExpired) as error:
        raise GuardError("candidate_database_cluster") from error
    finally:
        if holder.stdin is not None:
            holder.stdin.close()
        try:
            holder.wait(timeout=5)
        except subprocess.TimeoutExpired:
            holder.kill()
            holder.wait(timeout=5)
        if holder.stdout is not None:
            holder.stdout.close()
    require(holder.returncode == 0, "candidate_database_cluster")


def check_gate_manifest(value: dict[str, Any]) -> None:
    require(set(value) == {"schema", "candidate"}, "gate_manifest")
    direct_identity = check_migration_applied()
    status_identity, status_catalog, operator = check_status_migration_applied(direct_identity)
    pins = value["candidate"]
    raw = run_verified_python(operator, ["--inventory", "--sql", str(STATUS_SQL),
                                         "--container-id", pins["container_id"],
                                         "--container-name", TARGET_CONTAINER,
                                         "--container-port", str(TARGET_PORT),
                                         "--host-port", str(TARGET_PORT)], timeout=30)
    inventory = json.loads(raw)
    target = {"container_id": pins["container_id"], "container_name": TARGET_CONTAINER,
              "image": pins["image"], "container_port": TARGET_PORT, "host_port": TARGET_PORT}
    release = {"source_sha": pins["source_sha"], "bundle_sha256": pins["bundle_sha256"],
               "lock_sha256": pins["lock_sha256"]}
    require(isinstance(inventory, dict)
            and inventory.get("schema") == "phone11.profile-status-migration-inventory/v1"
            and inventory.get("target") == target and inventory.get("release") == release
            and inventory.get("sql_sha256") == STATUS_SQL_SHA
            and inventory.get("database_identity_sha256") == status_identity
            and inventory.get("before_catalog_sha256") == status_catalog,
            "candidate_database")
    check_same_database_cluster(pins["container_id"])
    for container_id in (CURRENT_CONTAINER_ID, pins["container_id"]):
        count = command(["docker", "exec", "--workdir", "/app", container_id,
                         "node", "-e", DND_COUNT_PROGRAM], timeout=15)
        require(count == b"0", "dnd_off")


def inventory() -> None:
    site, info = read_regular(SITE)
    require(info.st_uid == 0 and info.st_gid == 0, "site_owner")
    print(json.dumps({"schema": SCHEMA, "site_sha256": digest(site), "route":
                      "original" if digest(site) == ORIGINAL_SHA256 else "changed"}, sort_keys=True))


RECEIPT_FIELDS = {"schema", "site", "before_sha256", "active_sha256", "target_container",
                  "candidate", "gate_manifest_sha256", "state"}


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
            and _sha(record["gate_manifest_sha256"])
            and isinstance(record["candidate"], dict)
            and set(record["candidate"]) == PIN_FIELDS, "receipt_shape")
    pins = record["candidate"]
    require(all(isinstance(pins[key], str) for key in PIN_FIELDS)
            and re.fullmatch(r"[0-9a-f]{64}", pins["container_id"]) is not None
            and re.fullmatch(r"sha256:[0-9a-f]{64}", pins["image"]) is not None
            and re.fullmatch(r"[0-9a-f]{40}", pins["source_sha"]) is not None
            and all(_sha(pins[key]) for key in ("bundle_sha256", "lock_sha256"))
            and pins["lock_sha256"] == CURRENT_LOCK_SHA, "receipt_shape")
    before, _ = read_regular(receipt_dir / "site.before", root_only=True)
    active, _ = read_regular(receipt_dir / "site.active", root_only=True)
    require(digest(before) == record["before_sha256"] and digest(active) == record["active_sha256"]
            and rewrite_trpc(before, CURRENT_PORT, TARGET_PORT) == active
            and rewrite_trpc(active, TARGET_PORT, CURRENT_PORT) == before, "receipt_integrity")
    return record, before, active


def prepare(manifest_path: Path) -> None:
    require(os.geteuid() == 0, "root_required")
    with lock():
        site, info = read_regular(SITE)
        require(info.st_uid == 0 and info.st_gid == 0, "site_owner")
        require(digest(site) == ORIGINAL_SHA256, "site_drift")
        target = rewrite_trpc(site, CURRENT_PORT, TARGET_PORT)
        require(rewrite_trpc(target, TARGET_PORT, CURRENT_PORT) == site, "route_roundtrip")
        gates, manifest_raw = load_gate_manifest(manifest_path)
        check_predecessor()
        check_current_route_receipt()
        check_gate_manifest(gates)
        check_candidate(gates["candidate"])
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
                  "candidate": gates["candidate"], "gate_manifest_sha256": digest(manifest_raw),
                  "state": "prepared"}
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
        gates, manifest_raw = load_gate_manifest(GATE_ROOT / "manifest.json")
        require(digest(manifest_raw) == record["gate_manifest_sha256"]
                and gates["candidate"] == record["candidate"], "gate_drift")
        check_predecessor()
        check_current_route_receipt()
        check_gate_manifest(gates)
        check_candidate(record["candidate"])
        current, _ = read_regular(SITE)
        require(current == site, "site_drift")
        try:
            atomic_write(SITE, target, mode=stat.S_IMODE(info.st_mode), uid=info.st_uid, gid=info.st_gid)
            nginx_validate_and_reload()
            require(read_regular(SITE)[0] == target, "site_drift")
            check_candidate(record["candidate"])
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
            check_predecessor()
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
        check_predecessor()
        record["state"] = "rolled_back"
        atomic_write(receipt_dir / "receipt.json", receipt_bytes(record), mode=0o600)
        print(json.dumps({"state": "rolled_back", "receipt_dir": str(receipt_dir),
                          "site_sha256": digest(before)}, sort_keys=True))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_subparsers(dest="action", required=True)
    actions.add_parser("inventory", help="print only the site hash and route state")
    prepare_parser = actions.add_parser("prepare", help="seal exact site snapshots after pinned checks")
    prepare_parser.add_argument("--gate-manifest", type=Path, required=True,
                                help="root-owned 0600 manifest at the fixed protected gate path")
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
            prepare(args.gate_manifest)
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
