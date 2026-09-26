#!/usr/bin/env python3
"""Prove the voicemail migration on an isolated restore; never mutate the live DB.

The archive is supplied by the protected backup process. This operator does not
make a production backup, deploy an image, apply SQL to a remote database, or
enable the FreeSWITCH hook. Its receipt is evidence for a later reviewed handoff.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "server/pbx/voicemail-storage-migration.sql"
SOURCE_BASE_SHA = "6939177617a6bdb12f057121d044c1203583f3aa"
MIGRATION_SHA256 = "a281bd01a98685683a75e5c0db05b5ad03eec8596afeea07c423888c93f65297"
ACTIVE_BACKEND_ID = "f9ce934dc51b531fe1a9b2bd927634322f9c6c572a551592a48d3e0d26a49616"
ACTIVE_BACKEND_IMAGE = "sha256:d42c70f34d5062bff779c235dd2b6e415bede3b3a86b9de73892acf35b392619"
ACTIVE_FREESWITCH_ID = "1a575aa273fa62e3184e1a2c650322dcdec776dc8ac8707c10be95450143014b"
ACTIVE_FREESWITCH_IMAGE = "sha256:b31c743f4c911a19687c61e3214968f2a24f93f9d3d667cc26284192e158ffc6"
CLONE_POSTGRES_IMAGE = "sha256:4e6e670bb069649261c9c18031f0aded7bb249a5b6664ddec29c013a89310d50"
RECEIPT_SCHEMA = "phone11.voicemail-clone-validation/v1"


class ValidationError(RuntimeError):
    pass


def require(condition: bool, stage: str) -> None:
    if not condition:
        raise ValidationError(stage)


def digest_regular_private(path: Path, *, archive: bool = False, private: bool = True) -> str:
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1, "file_type")
    if private:
        require(before.st_uid == os.getuid() and stat.S_IMODE(before.st_mode) == 0o600, "file_privacy")
    require(0 < before.st_size < 1024 * 1024 * 1024 * 1024, "file_size")
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        opened = os.fstat(fd)
        require((opened.st_dev, opened.st_ino) == (before.st_dev, before.st_ino), "file_changed")
        digest = hashlib.sha256()
        first = True
        while chunk := os.read(fd, 1024 * 1024):
            if first and archive:
                require(chunk.startswith(b"PGDMP"), "archive_format")
            first = False
            digest.update(chunk)
        after = os.fstat(fd)
        require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) ==
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns), "file_changed")
        return digest.hexdigest()
    finally:
        os.close(fd)


def stage_checked_file(source: Path, target: Path, *, archive: bool, private: bool) -> str:
    """Pin bytes inside the private clone directory before invoking PostgreSQL."""
    before = source.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1, "file_type")
    require(0 < before.st_size < 1024 * 1024 * 1024 * 1024, "file_size")
    if private:
        require(before.st_uid == os.getuid() and stat.S_IMODE(before.st_mode) == 0o600, "file_privacy")
    source_fd = os.open(source, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        target_fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except BaseException:
        os.close(source_fd)
        raise
    try:
        opened = os.fstat(source_fd)
        require((opened.st_dev, opened.st_ino) == (before.st_dev, before.st_ino), "file_changed")
        digest = hashlib.sha256()
        first = True
        while chunk := os.read(source_fd, 1024 * 1024):
            if first and archive:
                require(chunk.startswith(b"PGDMP"), "archive_format")
            first = False
            digest.update(chunk)
            view = memoryview(chunk)
            while view:
                written = os.write(target_fd, view)
                require(written > 0, "copy_write")
                view = view[written:]
        os.fsync(target_fd)
        after = os.fstat(source_fd)
        require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) ==
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns), "file_changed")
        return digest.hexdigest()
    finally:
        os.close(source_fd)
        os.close(target_fd)


def run(args: list[str], *, env: dict[str, str] | None = None, timeout: int = 120) -> str:
    result = subprocess.run(args, env=env, stdin=subprocess.DEVNULL,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, timeout=timeout, check=False)
    require(result.returncode == 0, "command:" + Path(args[0]).name)
    return result.stdout.strip()


def pg_bin(name: str) -> str:
    found = shutil.which(name)
    require(found is not None, "missing_tool:" + name)
    return found


def free_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


CATALOG_QUERY = """
SELECT json_build_object(
  'extensions', to_regclass('public.extensions') IS NOT NULL,
  'admissions', to_regclass('public.voicemail_deposit_admissions') IS NOT NULL,
  'messages', to_regclass('public.voicemail_messages') IS NOT NULL,
  'owner_epoch', EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='extensions'
      AND column_name='voicemail_owner_epoch' AND udt_name='uuid' AND is_nullable='NO'),
  'owner_trigger', EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgname='phone11_voicemail_owner_epoch_rotate' AND tgenabled='O' AND NOT tgisinternal),
  'guard_trigger', EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgname='phone11_voicemail_extension_tenant_guard' AND tgenabled='O' AND NOT tgisinternal),
  'owner_function', to_regprocedure('public.phone11_voicemail_owner_epoch_rotate()') IS NOT NULL,
  'guard_function', to_regprocedure('public.phone11_voicemail_extension_tenant_guard()') IS NOT NULL,
  'admissions_index', to_regclass('public.phone11_voicemail_admissions_tenant') IS NOT NULL,
  'inbox_index', to_regclass('public.phone11_voicemail_inbox') IS NOT NULL
)::text;
"""


def catalog(psql: str, socket_dir: str, port: int) -> dict[str, bool]:
    output = run([psql, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1",
                  "-h", socket_dir, "-p", str(port), "-U", "phone11_clone",
                  "-d", "phone11_clone", "-c", CATALOG_QUERY])
    document = json.loads(output)
    require(isinstance(document, dict) and all(isinstance(v, bool) for v in document.values()), "catalog")
    return document


def extension_count(psql: str, socket_dir: str, port: int) -> int:
    output = run([psql, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1",
                  "-h", socket_dir, "-p", str(port), "-U", "phone11_clone",
                  "-d", "phone11_clone", "-c", "SELECT count(*) FROM public.extensions"])
    return int(output)


def inspect_owned_clone(docker: str, name: str, token: str, docker_env: dict[str, str]) -> dict[str, object] | None:
    """Resolve only this invocation's unpredictable clone name and label."""
    result = subprocess.run([docker, "inspect", name], env=docker_env,
                            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True, timeout=10)
    if result.returncode != 0:
        require(result.returncode == 1 and "no such object" in (result.stderr or "").casefold(),
                "clone_inspect_unavailable")
        return None
    document = json.loads(result.stdout)
    require(isinstance(document, list) and len(document) == 1, "clone_inspect_format")
    item = document[0]
    require(item.get("Name") == "/" + name and
            item.get("Config", {}).get("Labels", {}).get("phone11.voicemail.clone-token") == token,
            "clone_identity")
    return item


def cleanup_owned_clone(docker: str, name: str, token: str, docker_env: dict[str, str]) -> None:
    # A timed-out create can still finish on the daemon. Probe by the name
    # chosen before create, then remove only a container with our secret label.
    for _ in range(3):
        item = inspect_owned_clone(docker, name, token, docker_env)
        if item is not None:
            removed = subprocess.run([docker, "rm", "-f", "-v", item["Id"]], env=docker_env,
                                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                     stderr=subprocess.DEVNULL, timeout=20)
            require(removed.returncode == 0, "clone_cleanup:" + name)
            require(inspect_owned_clone(docker, name, token, docker_env) is None,
                    "clone_cleanup_unverified:" + name)
            return
        time.sleep(1)


def docker_clone(backup: Path, sql: Path, data_mib: int) -> tuple[dict[str, bool], int, dict[str, bool], int]:
    """Restore only inside a short-lived, no-network PostgreSQL 16 container."""
    require(256 <= data_mib <= 32768, "clone_data_limit")
    docker = "/usr/bin/docker"
    require(Path(docker).is_file(), "missing_tool:docker")
    docker_env = {key: value for key, value in os.environ.items() if not key.startswith("DOCKER_")}
    docker_env["DOCKER_HOST"] = "unix:///var/run/docker.sock"
    token = uuid.uuid4().hex
    name = "p11vm-" + token
    container_id = ""
    try:
        try:
            container_id = run([
                docker, "create", "--name", name,
                "--label", "phone11.voicemail.clone-token=" + token,
                "--network", "none", "--read-only",
                "--tmpfs", f"/var/lib/postgresql/data:rw,nosuid,nodev,size={data_mib}m",
                "--tmpfs", "/var/run/postgresql:rw,nosuid,nodev,size=16m",
                "--tmpfs", "/tmp:rw,nosuid,nodev,size=64m",
                "--mount", f"type=bind,source={backup},target=/tmp/backup.dump,readonly",
                "--mount", f"type=bind,source={sql},target=/tmp/migration.sql,readonly",
                "-e", "POSTGRES_HOST_AUTH_METHOD=trust", CLONE_POSTGRES_IMAGE,
                "postgres", "-c", "listen_addresses=", "-c", "unix_socket_directories=/var/run/postgresql",
            ], env=docker_env, timeout=40)
        except subprocess.TimeoutExpired as error:
            raise ValidationError("clone_create_uncertain:" + name) from error
        require(len(container_id) == 64 and all(c in "0123456789abcdef" for c in container_id), "clone_container_id")
        inspected = inspect_owned_clone(docker, name, token, docker_env)
        require(inspected is not None and inspected.get("Id") == container_id, "clone_container_id")
        host_config = inspected.get("HostConfig", {})
        require(inspected.get("Image") == CLONE_POSTGRES_IMAGE and
                inspected.get("State", {}).get("Running") is False and
                host_config.get("NetworkMode") == "none" and
                host_config.get("ReadonlyRootfs") is True and
                not host_config.get("PortBindings") and
                set(host_config.get("Tmpfs", {})) ==
                {"/var/lib/postgresql/data", "/var/run/postgresql", "/tmp"} and
                {m.get("Destination"): m.get("Source") for m in inspected.get("Mounts", [])
                 if m.get("Type") == "bind" and m.get("RW") is False} ==
                {"/tmp/backup.dump": str(backup), "/tmp/migration.sql": str(sql)} and
                len(inspected.get("Mounts", [])) == 2, "clone_isolation")
        # Identity and isolation are checked before any PostgreSQL process can
        # read the backup. A timed-out start is removed by name in finally.
        require(run([docker, "start", container_id], env=docker_env, timeout=40) == container_id,
                "clone_start_output")

        def execute(tool: str, *args: str, timeout: int = 120) -> str:
            return run([docker, "exec", "-u", "0", container_id, tool, *args],
                       env=docker_env, timeout=timeout)

        ready = False
        for _ in range(30):
            probe = subprocess.run([docker, "exec", "-u", "0", container_id,
                                    "pg_isready", "-h", "/var/run/postgresql", "-U", "postgres"],
                                   stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                   stderr=subprocess.DEVNULL, env=docker_env, timeout=5)
            if probe.returncode == 0:
                ready = True
                break
            time.sleep(1)
        require(ready, "clone_startup")
        execute("createdb", "-h", "/var/run/postgresql", "-U", "postgres", "phone11_clone")
        execute("pg_restore", "--no-owner", "--no-acl", "--exit-on-error", "-h", "/var/run/postgresql",
                "-U", "postgres", "-d", "phone11_clone", "/tmp/backup.dump", timeout=600)

        def sql_query(query: str) -> str:
            return execute("psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1",
                           "-h", "/var/run/postgresql", "-U", "postgres", "-d", "phone11_clone", "-c", query)

        before = json.loads(sql_query(CATALOG_QUERY))
        require(isinstance(before, dict) and all(type(v) is bool for v in before.values()), "pre_catalog_format")
        require(before["extensions"] and not any(v for k, v in before.items() if k != "extensions"), "pre_catalog")
        count_before = int(sql_query("SELECT count(*) FROM public.extensions"))
        execute("psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-h", "/var/run/postgresql",
                "-U", "postgres", "-d", "phone11_clone", "-f", "/tmp/migration.sql")
        after = json.loads(sql_query(CATALOG_QUERY))
        require(isinstance(after, dict) and all(after.values()), "post_catalog")
        count_after = int(sql_query("SELECT count(*) FROM public.extensions"))
        require(count_after == count_before, "extension_rows_changed")
        return before, count_before, after, count_after
    finally:
        cleanup_owned_clone(docker, name, token, docker_env)


def validate_clone(backup: Path, expected_sha256: str, receipt: Path, *,
                   engine: str = "local", clone_data_mib: int = 4096) -> dict[str, object]:
    require(len(expected_sha256) == 64 and all(c in "0123456789abcdef" for c in expected_sha256), "backup_pin")
    require(engine in ("local", "docker"), "engine")
    require(not receipt.exists(), "receipt_exists")
    parent = receipt.parent.resolve(strict=True)
    parent_stat = parent.stat()
    require(parent_stat.st_uid == os.getuid() and stat.S_IMODE(parent_stat.st_mode) == 0o700, "receipt_directory")

    # Keep the Unix socket path short enough for macOS and Linux PostgreSQL.
    # TemporaryDirectory creates this cluster with mode 0700.
    with tempfile.TemporaryDirectory(prefix="p11vm-", dir="/tmp") as temp:
        staged_backup = Path(temp) / "backup.dump"
        staged_sql = Path(temp) / "migration.sql"
        backup_sha256 = stage_checked_file(backup, staged_backup, archive=True, private=True)
        require(backup_sha256 == expected_sha256, "backup_digest")
        require(stage_checked_file(MIGRATION, staged_sql, archive=False, private=False) ==
                MIGRATION_SHA256, "migration_pin")
        if engine == "docker":
            before, count_before, after, count_after = docker_clone(staged_backup, staged_sql, clone_data_mib)
        else:
            initdb, pg_ctl, createdb, pg_restore, psql = (pg_bin(name) for name in
                ("initdb", "pg_ctl", "createdb", "pg_restore", "psql"))
            data = str(Path(temp) / "data")
            port = free_port()
            clean_env = {key: value for key, value in os.environ.items() if not key.startswith("PG")}
            run([initdb, "-D", data, "-U", "phone11_clone", "--auth-local=trust",
                 "--auth-host=reject", "--no-locale", "-E", "UTF8"], env=clean_env)
            started = False
            try:
                started = True  # Stop even if startup reports failure after spawning.
                run([pg_ctl, "-D", data, "-o", f"-k {temp} -p {port} -c listen_addresses=",
                     "-l", str(Path(temp) / "postgres.log"), "start"], env=clean_env)
                run([createdb, "-h", temp, "-p", str(port), "-U", "phone11_clone", "phone11_clone"], env=clean_env)
                run([pg_restore, "--no-owner", "--no-acl", "--exit-on-error", "-h", temp,
                     "-p", str(port), "-U", "phone11_clone", "-d", "phone11_clone", str(staged_backup)],
                    env=clean_env, timeout=600)
                before = catalog(psql, temp, port)
                require(before["extensions"] and not any(v for k, v in before.items() if k != "extensions"), "pre_catalog")
                count_before = extension_count(psql, temp, port)
                run([psql, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-h", temp, "-p", str(port),
                     "-U", "phone11_clone", "-d", "phone11_clone", "-f", str(staged_sql)], env=clean_env)
                after = catalog(psql, temp, port)
                require(all(after.values()), "post_catalog")
                count_after = extension_count(psql, temp, port)
                require(count_after == count_before, "extension_rows_changed")
            finally:
                if started:
                    subprocess.run([pg_ctl, "-D", data, "-m", "immediate", "stop"],
                                   env=clean_env, stdin=subprocess.DEVNULL,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)

    result: dict[str, object] = {
        "schema": RECEIPT_SCHEMA,
        "source_base_sha": SOURCE_BASE_SHA,
        "migration_sha256": MIGRATION_SHA256,
        "backup_sha256": backup_sha256,
        "backend_id": ACTIVE_BACKEND_ID,
        "backend_image": ACTIVE_BACKEND_IMAGE,
        "freeswitch_id": ACTIVE_FREESWITCH_ID,
        "freeswitch_image": ACTIVE_FREESWITCH_IMAGE,
        "restored_to": ("isolated_no_network_postgresql_16_container" if engine == "docker"
                        else "isolated_local_postgresql_cluster"),
        "pre_catalog": before,
        "post_catalog": after,
        "extension_rows_before": count_before,
        "extension_rows_after": count_after,
        "hook_ready": False,
        "validated_at_unix": int(time.time()),
    }
    payload = (json.dumps(result, sort_keys=True, separators=(",", ":")) + "\n").encode()
    temporary = parent / (".voicemail-receipt-" + uuid.uuid4().hex + ".tmp")
    linked = False
    try:
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
        try:
            view = memoryview(payload)
            while view:
                written = os.write(fd, view)
                require(written > 0, "receipt_write")
                view = view[written:]
            os.fsync(fd)
        finally:
            os.close(fd)
        os.link(temporary, receipt)
        linked = True
        directory = os.open(parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    except BaseException:
        if linked:
            receipt.unlink(missing_ok=True)
        raise
    finally:
        temporary.unlink(missing_ok=True)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backup", type=Path, required=True, help="private pg_dump custom archive")
    parser.add_argument("--backup-sha256", required=True, help="independently approved archive digest")
    parser.add_argument("--receipt", type=Path, required=True, help="new receipt under a private directory")
    parser.add_argument("--engine", choices=("local", "docker"), default="local")
    parser.add_argument("--clone-data-mib", type=int, default=4096,
                        help="Docker clone data tmpfs MiB (256..32768)")
    args = parser.parse_args()
    try:
        result = validate_clone(args.backup, args.backup_sha256, args.receipt,
                                engine=args.engine, clone_data_mib=args.clone_data_mib)
        print(json.dumps({"result": "clone_validated", "receipt": str(args.receipt),
                          "extensions": result["extension_rows_after"], "hook_ready": False}))
        return 0
    except (ValidationError, OSError, ValueError, subprocess.TimeoutExpired, json.JSONDecodeError) as error:
        stage = str(error) if isinstance(error, ValidationError) else type(error).__name__
        print(json.dumps({"result": "blocked", "stage": stage}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
