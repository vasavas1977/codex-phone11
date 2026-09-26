#!/usr/bin/env python3
"""Prove both reviewed catalog definitions on the retained pre-status backup.

This never writes to the live database. It restores the exact status backup in
an isolated PostgreSQL container, then runs both pinned read-only snapshot
programs against that same clone before writing a protected bridge proof.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys
import time
import types
import uuid
from typing import Any


ROOT = Path("/opt/phone11ai/status-only-release-20260926/migration")
DIRECT_ROOT = Path("/opt/phone11ai/direct-meeting-20260926/migration")
DIRECT_OPERATOR = DIRECT_ROOT / "phone11-direct-meetings-migrate.py"
DIRECT_MANIFEST = DIRECT_ROOT / "manifest.json"
STATUS_OPERATOR = ROOT / "phone11-profile-status-migrate.py"
STATUS_MANIFEST = ROOT / "manifest.json"
STATUS_BACKUP_PROOF = ROOT / "backup-proof.json"
STATUS_RESTORE_PROOF = ROOT / "restore-proof.json"
BACKUP = ROOT / "backup.dump"
PROOF = ROOT / "catalog-bridge-proof.json"
RESTORE_HELPER = ROOT / "phone11-profile-status-restore-proof.py"
DIRECT_OPERATOR_SHA = "d1505d50b6f161681394cdc207cfb37e8931edd0e7e157975bdf289792c108cf"
STATUS_OPERATOR_SHA = "eb6b9faa19b15d62a15b87dc3f441c25eff24a1f18a6a35bbe212a6744897d7f"
RESTORE_HELPER_SHA = "ee8be9cdf0acb6c8516b2122f3d16ff83087479ac7c3668b711067548dc4f02f"
CURRENT_CONTAINER_ID = "bd3b5acf2647d239b5d5298c23a0b1bf60699379b25e4e8023b67e27fd6a6195"
CURRENT_IMAGE = "sha256:c32a2a3a72061f2d4dbb8a54a1528666fd25003cd9782ae9de4ffa60c0e7d1b3"
SCHEMA = "phone11.status-catalog-bridge-proof/v1"


class BridgeError(RuntimeError):
    pass


def require(ok: bool, stage: str) -> None:
    if not ok:
        raise BridgeError(stage)


def load_reviewed(path: Path, expected_sha: str, name: str) -> tuple[types.ModuleType, bytes]:
    # Import only the verified bytes, so a path replacement cannot change the
    # program executed after the digest check.
    raw = secure_read(path)
    require(sha(raw) == expected_sha, "artifact")
    module = types.ModuleType(name)
    module.__file__ = str(path)
    exec(compile(raw, str(path), "exec"), module.__dict__)
    return module, raw


def sha(raw: bytes) -> str:
    import hashlib
    return hashlib.sha256(raw).hexdigest()


def secure_read(path: Path) -> bytes:
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_uid == 0 and before.st_gid == 0
            and stat.S_IMODE(before.st_mode) == 0o600 and before.st_nlink == 1
            and 0 < before.st_size <= 2 * 1024 * 1024, "artifact")
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        opened = os.fstat(descriptor)
        require((opened.st_dev, opened.st_ino, opened.st_size, opened.st_uid, opened.st_gid)
                == (before.st_dev, before.st_ino, before.st_size, before.st_uid, before.st_gid),
                "artifact")
        raw = os.read(descriptor, 2 * 1024 * 1024 + 1)
        require(len(raw) == before.st_size, "artifact")
        return raw
    finally:
        os.close(descriptor)


def checked_json(raw: bytes, keys: set[str], stage: str) -> dict[str, Any]:
    try:
        value = json.loads(raw)
    except (ValueError, UnicodeDecodeError) as error:
        raise BridgeError(stage) from error
    require(isinstance(value, dict) and set(value) == keys, stage)
    return value


def private_directory(path: Path) -> None:
    entry = path.lstat()
    require(stat.S_ISDIR(entry.st_mode) and entry.st_uid == 0 and entry.st_gid == 0
            and stat.S_IMODE(entry.st_mode) == 0o700, "directory")


def snapshot_direct(restore: types.ModuleType, direct: types.ModuleType,
                    clone_id: str, marker_root: Path) -> dict[str, Any]:
    token = uuid.uuid4().hex
    name = "p11bridge-node-" + token
    marker = restore.pending_marker(marker_root, name, token)
    uncertain = False
    args = [restore.DOCKER, "run", "--rm", "--name", name,
            "--label", "phone11.status-restore-token=" + token,
            "--interactive", "--network", "container:" + clone_id,
            "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
            "--workdir", "/app", "--entrypoint", "node",
            "-e", "PG_CONNECTION_STRING=postgresql://postgres@127.0.0.1:5432/phone11_clone?sslmode=disable",
            CURRENT_IMAGE, "-e", direct.NODE_PROGRAM, "snapshot", "{}"]
    try:
        try:
            value = restore.json_result(restore.command(args, payload=b"", timeout=90), "direct_snapshot")
        except restore.ProofError:
            uncertain = True
            raise
        return value
    finally:
        restore.cleanup_owned(name, token)
        if not uncertain:
            restore.clear_pending_marker(marker)


def clone_fingerprints(restore: types.ModuleType, direct: types.ModuleType,
                       roles: list[str], database_owner: str,
                       *, data_mib: int) -> tuple[str, str]:
    require(256 <= data_mib <= 32768, "clone_limit")
    token = uuid.uuid4().hex
    name = "p11bridge-" + token
    marker = restore.pending_marker(ROOT, name, token)
    clone_id = ""
    uncertain = False
    try:
        try:
            clone_id = restore.command([
                restore.DOCKER, "create", "--name", name,
                "--label", "phone11.status-restore-token=" + token,
                "--network", "none", "--read-only",
                "--tmpfs", f"/var/lib/postgresql/data:rw,nosuid,nodev,size={data_mib}m",
                "--tmpfs", "/var/run/postgresql:rw,nosuid,nodev,size=16m",
                "--tmpfs", "/tmp:rw,nosuid,nodev,size=64m",
                "--mount", f"type=bind,source={BACKUP},target=/tmp/backup.dump,readonly",
                "-e", "POSTGRES_HOST_AUTH_METHOD=trust", restore.POSTGRES_IMAGE,
                "postgres", "-c", "listen_addresses=127.0.0.1",
            ], timeout=40).decode().strip()
        except restore.ProofError:
            uncertain = True
            raise
        require(re.fullmatch(r"[0-9a-f]{64}", clone_id) is not None, "clone_id")
        item = restore.inspect_owned(name, token)
        require(item is not None and item.get("Id") == clone_id
                and item.get("Image") == restore.POSTGRES_IMAGE
                and item.get("HostConfig", {}).get("NetworkMode") == "none"
                and item.get("HostConfig", {}).get("ReadonlyRootfs") is True
                and not item.get("HostConfig", {}).get("PortBindings")
                and set(item.get("HostConfig", {}).get("Tmpfs", {})) ==
                    {"/var/lib/postgresql/data", "/var/run/postgresql", "/tmp"}
                and {m.get("Destination"): m.get("Source") for m in item.get("Mounts", [])
                     if m.get("Type") == "bind" and m.get("RW") is False} ==
                    {"/tmp/backup.dump": str(BACKUP)}
                and len(item.get("Mounts", [])) == 1, "clone_isolation")
        try:
            require(restore.command([restore.DOCKER, "start", clone_id], timeout=40).decode().strip()
                    == clone_id, "clone_start")
        except restore.ProofError:
            uncertain = True
            raise
        ready = False
        for _ in range(30):
            try:
                restore.command([restore.DOCKER, "exec", "--user", "0", clone_id,
                                 "pg_isready", "-h", "127.0.0.1", "-U", "postgres"], timeout=5)
                ready = True
                break
            except restore.ProofError:
                time.sleep(1)
        require(ready, "clone_ready")
        for role in roles:
            if role != "postgres":
                restore.clone_sql(clone_id, "CREATE ROLE " + restore.quote_identifier(role) + " NOLOGIN;")
        restore.clone_sql(clone_id, "CREATE DATABASE phone11_clone OWNER "
                          + restore.quote_identifier(database_owner) + ";")
        restore.command([restore.DOCKER, "exec", "--user", "0", clone_id, "pg_restore",
                         "--clean", "--if-exists", "--exit-on-error", "-h", "127.0.0.1",
                         "-U", "postgres", "-d", "phone11_clone", "/tmp/backup.dump"], timeout=600)
        direct_snapshot = snapshot_direct(restore, direct, clone_id, ROOT)
        status_snapshot = restore.clone_node(CURRENT_IMAGE, clone_id, "snapshot", {}, ROOT)
        direct_before = direct_snapshot.get("before")
        status_before = status_snapshot.get("before")
        require(isinstance(direct_before, dict) and isinstance(status_before, dict), "clone_snapshot")
        return direct_before.get("catalog_fingerprint"), status_before.get("catalog_fingerprint")
    finally:
        restore.cleanup_owned(name, token)
        if not uncertain:
            restore.clear_pending_marker(marker)


def create(data_mib: int) -> dict[str, Any]:
    require(os.geteuid() == 0, "root")
    for directory in (ROOT, DIRECT_ROOT):
        private_directory(directory)
    require(not os.path.lexists(PROOF) and not os.path.lexists(ROOT / "cleanup-pending"),
            "proof_exists")
    status, _ = load_reviewed(STATUS_OPERATOR, STATUS_OPERATOR_SHA, "status_migration")
    direct, _ = load_reviewed(DIRECT_OPERATOR, DIRECT_OPERATOR_SHA, "direct_migration")
    restore, _ = load_reviewed(RESTORE_HELPER, RESTORE_HELPER_SHA, "status_restore")
    # The restored helper imports its sibling by path during module load. Use
    # the bytes already verified above for every subsequent snapshot call.
    restore.migration = status
    status_manifest_raw = secure_read(STATUS_MANIFEST)
    direct_manifest_raw = secure_read(DIRECT_MANIFEST)
    status_manifest = checked_json(status_manifest_raw, {"schema", "target", "release",
        "database_identity_sha256", "before_catalog_sha256", "after_catalog_sha256", "sql_sha256"},
        "status_manifest")
    direct_manifest = checked_json(direct_manifest_raw, set(status_manifest), "direct_manifest")
    require(status_manifest["database_identity_sha256"] == direct_manifest["database_identity_sha256"]
            and status_manifest["schema"] == status.MANIFEST_SCHEMA
            and direct_manifest["schema"] == direct.MANIFEST_SCHEMA, "manifest")
    backup_raw = secure_read(STATUS_BACKUP_PROOF)
    restore_raw = secure_read(STATUS_RESTORE_PROOF)
    backup_sha, _ = status.read_proofs(STATUS_BACKUP_PROOF, STATUS_RESTORE_PROOF,
                                       status_manifest, sha(status_manifest_raw), require_fresh=False)
    backup = checked_json(backup_raw, {"schema", "manifest_sha256", "database_identity_sha256",
        "before_catalog_sha256", "backup_sha256", "created_at_unix", "mechanism"}, "backup_proof")
    require(backup_sha == sha(backup_raw) and backup["before_catalog_sha256"] ==
            status_manifest["before_catalog_sha256"], "backup_proof")
    status.verify_backup_archive(STATUS_BACKUP_PROOF, backup_sha)
    source = restore.source_action(CURRENT_CONTAINER_ID, "details")
    source_before = source.get("before")
    require(isinstance(source_before, dict)
            and source_before.get("identity_fingerprint") ==
            status_manifest["database_identity_sha256"]
            and source_before.get("catalog_fingerprint") ==
            status_manifest["after_catalog_sha256"], "live_status")
    details = source.get("details")
    require(isinstance(details, dict) and isinstance(details.get("roles"), list)
            and all(isinstance(role, str) for role in details["roles"])
            and isinstance(details.get("database_owner"), str)
            and details["database_owner"] in details["roles"], "source_details")
    direct_catalog, status_catalog = clone_fingerprints(restore, direct, details["roles"],
                                                        details["database_owner"], data_mib=data_mib)
    require(direct_catalog == direct_manifest["after_catalog_sha256"], "direct_catalog")
    require(status_catalog == status_manifest["before_catalog_sha256"], "status_catalog")
    require(restore.archive_digest(BACKUP) == backup["backup_sha256"], "backup_changed")
    proof = {"schema": SCHEMA, "database_identity_sha256": status_manifest["database_identity_sha256"],
             "direct_manifest_sha256": sha(direct_manifest_raw),
             "status_manifest_sha256": sha(status_manifest_raw),
             "backup_proof_sha256": backup_sha, "backup_sha256": backup["backup_sha256"],
             "direct_operator_sha256": DIRECT_OPERATOR_SHA,
             "status_operator_sha256": STATUS_OPERATOR_SHA,
             "restore_helper_sha256": RESTORE_HELPER_SHA,
             "direct_after_catalog_sha256": direct_catalog,
             "status_before_catalog_sha256": status_catalog,
             "isolation": "separate_postgres_cluster", "mechanism": "cp11-postgres:pg_restore"}
    restore.private_new(PROOF, status.canonical_bytes(proof))
    directory_fd = os.open(ROOT, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
                           | getattr(os, "O_NOFOLLOW", 0))
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)
    return proof


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--create", action="store_true", required=True)
    parser.add_argument("--clone-data-mib", type=int, default=4096)
    args = parser.parse_args()
    try:
        result = create(args.clone_data_mib)
        print(json.dumps({"result": "bridge_validated", "proof_sha256": sha(
            json.dumps(result, sort_keys=True, separators=(",", ":")).encode())}, sort_keys=True))
        return 0
    except Exception as error:
        stage = str(error) if isinstance(error, BridgeError) else type(error).__name__
        print(json.dumps({"result": "blocked", "stage": stage}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
