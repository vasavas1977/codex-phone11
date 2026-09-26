#!/usr/bin/env python3
"""Create a private status backup and prove its migration on an isolated PG16 restore.

Run only on the reviewed VoIP host as root. The live database is read only;
the sole SQL mutation is inside a disposable --network none PostgreSQL clone.
No database rows, credentials, or command stderr are printed.
"""

from __future__ import annotations

import argparse
import importlib.util
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
import uuid
from typing import Any


OPERATOR_PATH = Path(__file__).with_name("phone11-profile-status-migrate.py")
spec = importlib.util.spec_from_file_location("phone11_status_migration", OPERATOR_PATH)
assert spec and spec.loader
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)

POSTGRES_IMAGE = "sha256:4e6e670bb069649261c9c18031f0aded7bb249a5b6664ddec29c013a89310d50"
DOCKER = "/usr/bin/docker"
MAX_BACKUP_BYTES = 1024 * 1024 * 1024 * 1024


class ProofError(RuntimeError):
    pass


def require(ok: bool, stage: str) -> None:
    if not ok:
        raise ProofError(stage)


def command(args: list[str], *, payload: bytes | None = None, timeout: int = 120,
            max_output: int = 128 * 1024) -> bytes:
    try:
        stdin_args = {"stdin": subprocess.DEVNULL} if payload is None else {"input": payload}
        result = subprocess.run(args, **stdin_args, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ProofError("command") from error
    require(result.returncode == 0 and len(result.stdout) <= max_output, "command")
    return result.stdout


def private_new(path: Path, content: bytes) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        view = memoryview(content)
        while view:
            written = os.write(fd, view)
            require(written > 0, "artifact_write")
            view = view[written:]
        os.fsync(fd)
    finally:
        os.close(fd)


def private_directory(path: Path) -> None:
    entry = path.lstat()
    require(stat.S_ISDIR(entry.st_mode) and not stat.S_ISLNK(entry.st_mode)
            and entry.st_uid == 0 and entry.st_gid == 0
            and stat.S_IMODE(entry.st_mode) == 0o700, "output_directory")


def archive_digest(path: Path, *, uid: int = 0, gid: int = 0) -> str:
    import hashlib
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_uid == uid
            and before.st_gid == gid and stat.S_IMODE(before.st_mode) == 0o600
            and before.st_nlink == 1 and 5 < before.st_size < MAX_BACKUP_BYTES, "backup_file")
    digest = hashlib.sha256()
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        opened = os.fstat(fd)
        require((opened.st_dev, opened.st_ino, opened.st_size) ==
                (before.st_dev, before.st_ino, before.st_size), "backup_changed")
        first = True
        while chunk := os.read(fd, 1024 * 1024):
            if first:
                require(chunk.startswith(b"PGDMP"), "backup_format")
                first = False
            digest.update(chunk)
        after = os.fstat(fd)
        require((after.st_size, after.st_mtime_ns) == (before.st_size, before.st_mtime_ns),
                "backup_changed")
        return digest.hexdigest()
    finally:
        os.close(fd)


def json_result(raw: bytes, stage: str) -> dict[str, Any]:
    try:
        value = json.loads(raw)
    except (ValueError, UnicodeDecodeError) as error:
        raise ProofError(stage) from error
    require(isinstance(value, dict), stage)
    return value


def docker_inspect(container: str) -> dict[str, Any]:
    rows = json_result_list(command([DOCKER, "inspect", container], timeout=20), "docker_inspect")
    require(len(rows) == 1 and isinstance(rows[0], dict), "docker_inspect")
    return rows[0]


def json_result_list(raw: bytes, stage: str) -> list[Any]:
    try:
        value = json.loads(raw)
    except (ValueError, UnicodeDecodeError) as error:
        raise ProofError(stage) from error
    require(isinstance(value, list), stage)
    return value


def inspect_owned(name: str, token: str) -> dict[str, Any] | None:
    try:
        result = subprocess.run([DOCKER, "inspect", name], stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                timeout=15, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ProofError("clone_inspect") from error
    if result.returncode == 1:
        require(b"no such object" in result.stderr.lower()
                or b"no such container" in result.stderr.lower(), "clone_inspect")
        return None
    require(result.returncode == 0 and len(result.stdout) < 128 * 1024, "clone_inspect")
    rows = json_result_list(result.stdout, "clone_inspect")
    require(len(rows) == 1 and rows[0].get("Name") == "/" + name
            and rows[0].get("Config", {}).get("Labels", {}).get("phone11.status-restore-token") == token,
            "clone_identity")
    return rows[0]


def cleanup_owned(name: str, token: str) -> None:
    # A timed-out create/start may still complete on the daemon. Remove only
    # this invocation's random name after its private label is verified.
    for _ in range(3):
        item = inspect_owned(name, token)
        if item is not None:
            command([DOCKER, "rm", "-f", "-v", item["Id"]], timeout=30)
            require(inspect_owned(name, token) is None, "clone_cleanup")
            return
        time.sleep(1)


def source_action(container_id: str, action: str, contract: dict[str, Any] | None = None) -> dict[str, Any]:
    raw = command(migration.database_command(container_id, action,
                  migration.canonical_bytes(contract or {}).decode()), timeout=45)
    return json_result(raw, "source_probe")


# Reuse the status operator's PBX connection configuration, then hold a random
# PostgreSQL session lock in the API connection while probing cp11-postgres.
# Identical OIDs/catalogs in a copied cluster cannot pass this challenge.
LOCK_PROGRAM = migration.NODE_PROGRAM.split("async function identity(client) {")[0] + r'''
const key=process.argv[1];
if(!/^[0-9]{1,19}$/.test(key)) process.exit(2);
(async()=>{const pool=new pg.Pool(config());let client;
try {client=await pool.connect();await client.query("SET statement_timeout='5000ms'");
  await client.query("SELECT pg_advisory_lock($1::bigint)",[key]);
  process.stdout.write("held\n");
  await new Promise(resolve=>{process.stdin.resume();process.stdin.once("end",resolve)});
  await client.query("SELECT pg_advisory_unlock($1::bigint)",[key]);
}catch(_error){process.exitCode=2}finally{client?.release();await pool.end().catch(()=>undefined)}})();
'''


def check_same_cluster(api_id: str, postgres_id: str, database: str) -> None:
    key = str(secrets.randbits(63) + 1)
    try:
        holder = subprocess.Popen([DOCKER, "exec", "--interactive", "--workdir", "/app",
                                   api_id, "node", "-e", LOCK_PROGRAM, key, "{}"],
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.DEVNULL)
    except OSError as error:
        raise ProofError("source_cluster") from error
    try:
        require(holder.stdin is not None and holder.stdout is not None, "source_cluster")
        readable, _, _ = select.select([holder.stdout], [], [], 10)
        require(bool(readable) and holder.stdout.readline() == b"held\n"
                and holder.poll() is None, "source_cluster")
        result = command([DOCKER, "exec", "--user", "postgres", postgres_id,
                          "psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1",
                          "-U", "postgres", "-d", database, "-c",
                          "SELECT pg_try_advisory_lock(" + key + "::bigint)"], timeout=15)
        require(holder.poll() is None and result.strip() == b"f", "source_cluster")
    except (OSError, ValueError) as error:
        raise ProofError("source_cluster") from error
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
    require(holder.returncode == 0, "source_cluster")


def clone_node(image: str, clone_id: str, action: str, contract: dict[str, Any],
               *, sql: bytes = b"") -> dict[str, Any]:
    # The clone has NetworkMode=none; this sidecar shares only its isolated
    # loopback namespace. No host port or external network exists.
    token = uuid.uuid4().hex
    name = "p11status-node-" + token
    args = [DOCKER, "run", "--rm", "--name", name,
            "--label", "phone11.status-restore-token=" + token,
            "--interactive", "--network", "container:" + clone_id,
            "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
            "--workdir", "/app", "--entrypoint", "node",
            "-e", "PG_CONNECTION_STRING=postgresql://postgres@127.0.0.1:5432/phone11_clone?sslmode=disable",
            image, "-e", migration.NODE_PROGRAM, action,
            migration.canonical_bytes(contract).decode()]
    try:
        raw = command(args, payload=sql, timeout=90)
        return json_result(raw, "clone_node")
    finally:
        cleanup_owned(name, token)


def quote_identifier(value: str) -> str:
    require(bool(value) and "\x00" not in value and len(value.encode("utf-8")) <= 63,
            "role_name")
    return '"' + value.replace('"', '""') + '"'


def clone_sql(clone_id: str, statement: str) -> None:
    command([DOCKER, "exec", "--user", "0", clone_id, "psql", "-X", "-q",
             "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-U", "postgres",
             "-d", "postgres", "-c", statement], timeout=30)


def clone_rehearsal(backup: Path, sql_path: Path, source_image: str, roles: list[str],
                    before_catalog: str, sql_sha: str, data_mib: int) -> str:
    require(256 <= data_mib <= 32768, "clone_limit")
    token = uuid.uuid4().hex
    name = "p11status-" + token
    clone_id = ""
    try:
        clone_id = command([
            DOCKER, "create", "--name", name, "--label", "phone11.status-restore-token=" + token,
            "--network", "none", "--read-only",
            "--tmpfs", f"/var/lib/postgresql/data:rw,nosuid,nodev,size={data_mib}m",
            "--tmpfs", "/var/run/postgresql:rw,nosuid,nodev,size=16m",
            "--tmpfs", "/tmp:rw,nosuid,nodev,size=64m",
            "--mount", f"type=bind,source={backup},target=/tmp/backup.dump,readonly",
            "--mount", f"type=bind,source={sql_path},target=/tmp/migration.sql,readonly",
            "-e", "POSTGRES_HOST_AUTH_METHOD=trust", POSTGRES_IMAGE,
            "postgres", "-c", "listen_addresses=127.0.0.1",
        ], timeout=40).decode().strip()
        require(re.fullmatch(r"[0-9a-f]{64}", clone_id) is not None, "clone_id")
        item = inspect_owned(name, token)
        require(item is not None and item.get("Id") == clone_id
                and item.get("Image") == POSTGRES_IMAGE
                and item.get("HostConfig", {}).get("NetworkMode") == "none"
                and item.get("HostConfig", {}).get("ReadonlyRootfs") is True
                and not item.get("HostConfig", {}).get("PortBindings")
                and set(item.get("HostConfig", {}).get("Tmpfs", {})) ==
                {"/var/lib/postgresql/data", "/var/run/postgresql", "/tmp"}
                and {m.get("Destination"): m.get("Source") for m in item.get("Mounts", [])
                     if m.get("Type") == "bind" and m.get("RW") is False} ==
                {"/tmp/backup.dump": str(backup), "/tmp/migration.sql": str(sql_path)}
                and len(item.get("Mounts", [])) == 2, "clone_isolation")
        require(command([DOCKER, "start", clone_id], timeout=40).decode().strip() == clone_id,
                "clone_start")
        ready = False
        for _ in range(30):
            try:
                command([DOCKER, "exec", "--user", "0", clone_id, "pg_isready",
                         "-h", "127.0.0.1", "-U", "postgres"], timeout=5)
                ready = True
                break
            except ProofError:
                time.sleep(1)
        require(ready, "clone_ready")
        for role in roles:
            if role != "postgres":
                clone_sql(clone_id, "CREATE ROLE " + quote_identifier(role) + " NOLOGIN;")
        clone_sql(clone_id, "CREATE DATABASE phone11_clone;")
        command([DOCKER, "exec", "--user", "0", clone_id, "pg_restore",
                 "--clean", "--if-exists", "--exit-on-error", "-h", "127.0.0.1", "-U", "postgres",
                 "-d", "phone11_clone", "/tmp/backup.dump"], timeout=600)
        before = clone_node(source_image, clone_id, "snapshot", {})["before"]
        require(before.get("catalog_fingerprint") == before_catalog, "restore_catalog")
        # Rehearsal runs the exact migration operator's SQL/ACL/catalog logic.
        result = clone_node(source_image, clone_id, "rehearsal", {
            "before_catalog_sha256": before_catalog,
            "sql_sha256": sql_sha,
        }, sql=migration.secure_read(sql_path))
        require(result.get("before", {}).get("catalog_fingerprint") == before_catalog
                and result.get("after", {}).get("catalog_fingerprint") != before_catalog,
                "clone_migration")
        return result["after"]["catalog_fingerprint"]
    finally:
        cleanup_owned(name, token)


def create_proof(sql_path: Path, out_dir: Path, api_id: str, api_name: str,
                 api_port: int, postgres_id: str, data_mib: int) -> dict[str, str]:
    require(os.geteuid() == 0, "root")
    require(re.fullmatch(r"[0-9a-f]{64}", postgres_id) is not None, "postgres_id")
    private_directory(out_dir)
    for name in ("backup.dump", "manifest.json", "backup-proof.json", "restore-proof.json"):
        require(not (out_dir / name).exists(), "output_exists")
    sql = migration.secure_read(sql_path)
    inventory = migration.collect_inventory(sql, api_id, api_name, api_port, api_port)
    source = source_action(api_id, "details")
    require(source.get("before", {}).get("identity_fingerprint") ==
            inventory["database_identity_sha256"]
            and source.get("before", {}).get("catalog_fingerprint") ==
            inventory["before_catalog_sha256"], "source_changed")
    details = source.get("details")
    require(isinstance(details, dict) and isinstance(details.get("database"), str)
            and re.fullmatch(r"[A-Za-z_][A-Za-z_0-9]{0,62}", details["database"]) is not None
            and details.get("server_version_num") == "160013"
            and isinstance(details.get("roles"), list)
            and all(isinstance(role, str) for role in details["roles"]), "source_details")
    pg = docker_inspect(postgres_id)
    require(pg.get("Id") == postgres_id and pg.get("Name") == "/cp11-postgres"
            and pg.get("Image") == POSTGRES_IMAGE
            and pg.get("State", {}).get("Running") is True, "postgres_container")
    require(command([DOCKER, "exec", "--user", "postgres", postgres_id,
                     "pg_dump", "--version"], timeout=10).strip() ==
            b"pg_dump (PostgreSQL) 16.13", "pg_dump_version")
    require(command([DOCKER, "exec", "--user", "postgres", postgres_id,
                     "pg_restore", "--version"], timeout=10).strip() ==
            b"pg_restore (PostgreSQL) 16.13", "pg_restore_version")
    database = details["database"]
    identity_sql = ("SELECT row_to_json(t)::text FROM (SELECT current_database() database,"
                    "current_schema() schema,current_setting('server_version_num') server_version_num,"
                    "(SELECT oid::text FROM pg_database WHERE datname=current_database()) database_oid) t")
    identity = json_result(command([DOCKER, "exec", "--user", "postgres", postgres_id,
                  "psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1",
                  "-U", "postgres", "-d", database, "-c", identity_sql], timeout=20),
                  "database_identity")
    require(migration.sha256_bytes(migration.canonical_bytes(identity)) ==
            inventory["database_identity_sha256"], "database_identity")
    check_same_cluster(api_id, postgres_id, database)
    backup_path = out_dir / "backup.dump"
    fd = os.open(backup_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        try:
            result = subprocess.run([DOCKER, "exec", "--user", "postgres", postgres_id,
                                     "pg_dump", "-Fc", "-U", "postgres", "-d", database],
                                    stdin=subprocess.DEVNULL, stdout=fd, stderr=subprocess.DEVNULL,
                                    timeout=600, check=False)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise ProofError("backup") from error
        require(result.returncode == 0, "backup")
        os.fsync(fd)
    finally:
        os.close(fd)
    backup_sha = archive_digest(backup_path)
    backup_at = int(time.time())
    require(source_action(api_id, "snapshot").get("before") == source["before"],
            "source_changed_after_backup")
    after_catalog = clone_rehearsal(backup_path, sql_path, inventory["target"]["image"],
                                    details["roles"], inventory["before_catalog_sha256"],
                                    inventory["sql_sha256"], data_mib)
    require(archive_digest(backup_path) == backup_sha, "backup_changed")
    manifest = {key: inventory[key] for key in (
        "target", "release", "database_identity_sha256", "before_catalog_sha256", "sql_sha256")}
    manifest.update(schema=migration.MANIFEST_SCHEMA, after_catalog_sha256=after_catalog)
    manifest_raw = migration.canonical_bytes(manifest)
    manifest_sha = migration.sha256_bytes(manifest_raw)
    restored_at = int(time.time())
    backup_proof = {
        "schema": migration.BACKUP_PROOF_SCHEMA,
        "manifest_sha256": manifest_sha,
        "database_identity_sha256": manifest["database_identity_sha256"],
        "before_catalog_sha256": manifest["before_catalog_sha256"],
        "backup_sha256": backup_sha,
        "created_at_unix": backup_at,
        "mechanism": "cp11-postgres:pg_dump",
    }
    restore_proof = {
        "schema": migration.RESTORE_PROOF_SCHEMA,
        "manifest_sha256": manifest_sha,
        "database_identity_sha256": manifest["database_identity_sha256"],
        "before_catalog_sha256": manifest["before_catalog_sha256"],
        "after_catalog_sha256": after_catalog,
        "sql_sha256": manifest["sql_sha256"],
        "backup_sha256": backup_sha,
        "restored_at_unix": restored_at,
        "mechanism": "cp11-postgres:pg_restore",
        "isolation": "separate_postgres_cluster",
        "catalog_verified": True,
        "migration_verified": True,
    }
    private_new(out_dir / "manifest.json", manifest_raw)
    private_new(out_dir / "backup-proof.json", migration.canonical_bytes(backup_proof))
    private_new(out_dir / "restore-proof.json", migration.canonical_bytes(restore_proof))
    actual_manifest, actual_sha = migration.read_manifest(out_dir / "manifest.json")
    require(actual_manifest == manifest and actual_sha == manifest_sha, "manifest_written")
    migration.read_proofs(out_dir / "backup-proof.json", out_dir / "restore-proof.json",
                          manifest, manifest_sha)
    directory_fd = os.open(out_dir, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)
    return {"manifest_sha256": manifest_sha, "backup_sha256": backup_sha,
            "before_catalog_sha256": inventory["before_catalog_sha256"],
            "after_catalog_sha256": after_catalog}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sql", type=Path, required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--api-container-id", required=True)
    parser.add_argument("--api-container-name", required=True)
    parser.add_argument("--api-port", type=int, required=True)
    parser.add_argument("--postgres-container-id", required=True)
    parser.add_argument("--clone-data-mib", type=int, default=4096)
    args = parser.parse_args()
    try:
        outcome = create_proof(args.sql, args.out_dir, args.api_container_id,
                               args.api_container_name, args.api_port,
                               args.postgres_container_id, args.clone_data_mib)
        print(json.dumps({"result": "rehearsal_validated", **outcome}, sort_keys=True))
        return 0
    except (ProofError, migration.MigrationError, OSError, ValueError, KeyError, TypeError) as error:
        stage = error.stage if isinstance(error, migration.MigrationError) else (
            str(error) if isinstance(error, ProofError) else type(error).__name__)
        print(json.dumps({"result": "blocked", "stage": stage}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
