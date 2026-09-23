#!/usr/bin/env python3
"""Prepare and apply the additive Phone11 profile-photo schema on the VoIP host.

This deliberately does not discover a database by Docker service name. It takes
the routed candidate's exact container ID and image, copies its PG_* connection
settings into a short-lived root-only env file, and uses a pinned PostgreSQL 16
client image on that candidate's private network. No secret or customer row is
written to stdout. `prepare` makes a protected full backup and rehearses its
restore and the exact SQL in a network-isolated PostgreSQL 16 container. `apply`
requires that fresh proof, rechecks the same target and absent catalog, and
records the result. The database backup is retained for operator recovery;
restoring it over a live database is NEVER automatic because that loses writes.
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
import tempfile
import time
from typing import Any, Iterator, Mapping, Sequence


SCHEMA = "phone11-profile-photo-migration/v1"
BUILD = "channel-meetings-9aab162"
MAX_AGE_SECONDS = 30 * 60
MAX_BACKUP_BYTES = 256 * 1024 * 1024
LOCK_PATH = Path("/run/lock/phone11-profile-photo-migrate.lock")
CATALOG_SQL = """SELECT json_build_object(
 'database',current_database(),
 'server_version',current_setting('server_version_num')::int,
 'tenants',to_regclass('public.tenants') IS NOT NULL,
 'users',to_regclass('public.users') IS NOT NULL,
 'photos',to_regclass('public.phone11_workspace_profile_photos') IS NOT NULL,
 'deletions',to_regclass('public.phone11_profile_photo_deletions') IS NOT NULL,
 'columns',ARRAY(SELECT c.relname||'.'||a.attname||':'||format_type(a.atttypid,a.atttypmod)
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   JOIN pg_attribute a ON a.attrelid=c.oid
   WHERE n.nspname='public' AND c.relname IN
    ('phone11_workspace_profile_photos','phone11_profile_photo_deletions')
    AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum),
 'constraints',ARRAY(SELECT c.relname||'.'||pg_get_constraintdef(k.oid,true)
   FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
   JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname IN
    ('phone11_workspace_profile_photos','phone11_profile_photo_deletions')
   ORDER BY c.relname,k.conname),
 'indexes',ARRAY(SELECT indexname FROM pg_indexes WHERE schemaname='public'
   AND tablename IN ('phone11_workspace_profile_photos','phone11_profile_photo_deletions')
   ORDER BY indexname))::text"""
IDENTITY_SQL = """SELECT json_build_object(
 'database',current_database(),'user',current_user,
 'server_addr',host(inet_server_addr()),'server_port',inet_server_port(),
 'database_oid',(SELECT oid FROM pg_database WHERE datname=current_database()))::text"""

EXPECTED_COLUMNS = {
    "phone11_workspace_profile_photos.tenant_id:integer",
    "phone11_workspace_profile_photos.user_id:integer",
    "phone11_workspace_profile_photos.version:uuid",
    "phone11_workspace_profile_photos.storage_key:text",
    "phone11_workspace_profile_photos.mime_type:text",
    "phone11_workspace_profile_photos.size_bytes:integer",
    "phone11_workspace_profile_photos.content_sha256:text",
    "phone11_workspace_profile_photos.updated_at:timestamp with time zone",
    "phone11_profile_photo_deletions.storage_key:text",
    "phone11_profile_photo_deletions.tenant_id:integer",
    "phone11_profile_photo_deletions.user_id:integer",
    "phone11_profile_photo_deletions.queued_at:timestamp with time zone",
    "phone11_profile_photo_deletions.attempts:integer",
    "phone11_profile_photo_deletions.last_error_at:timestamp with time zone",
}
EXPECTED_INDEXES = {
    "phone11_workspace_profile_photos_pkey",
    "phone11_workspace_profile_photos_tenant_id_user_id_version_key",
    "phone11_workspace_profile_photos_version",
    "phone11_profile_photo_deletions_pkey",
    "phone11_profile_photo_deletions_due",
}


class MigrationError(RuntimeError):
    pass


def require(ok: bool, stage: str) -> None:
    if not ok:
        raise MigrationError(stage)


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def run(*argv: str, timeout: int = 120) -> bytes:
    try:
        result = subprocess.run(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise MigrationError("command_failed") from error
    # stderr may include connection details, so never propagate it.
    require(result.returncode == 0, "command_failed")
    return result.stdout


def secure_directory(path: Path) -> None:
    require(os.geteuid() == 0, "root_required")
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    state = path.lstat()
    require(stat.S_ISDIR(state.st_mode) and not stat.S_ISLNK(state.st_mode)
            and state.st_uid == 0 and stat.S_IMODE(state.st_mode) == 0o700,
            "evidence_directory")


def secure_file(path: Path, max_bytes: int) -> bytes:
    state = path.lstat()
    require(stat.S_ISREG(state.st_mode) and not stat.S_ISLNK(state.st_mode)
            and state.st_uid == 0 and stat.S_IMODE(state.st_mode) == 0o600
            and state.st_nlink == 1 and 0 < state.st_size <= max_bytes,
            "evidence_file")
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        opened = os.fstat(fd)
        require((opened.st_dev, opened.st_ino, opened.st_size) ==
                (state.st_dev, state.st_ino, state.st_size), "evidence_file")
        raw = os.read(fd, max_bytes + 1)
        require(len(raw) == state.st_size, "evidence_file")
        return raw
    finally:
        os.close(fd)


@contextmanager
def operator_lock() -> Iterator[None]:
    require(os.geteuid() == 0, "root_required")
    fd = os.open(LOCK_PATH, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        state = os.fstat(fd)
        require(stat.S_ISREG(state.st_mode) and state.st_uid == 0
                and state.st_nlink == 1 and stat.S_IMODE(state.st_mode) == 0o600,
                "operator_lock")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise MigrationError("operator_busy") from error
        yield
    finally:
        os.close(fd)


def atomic_write(path: Path, raw: bytes) -> None:
    require(not path.exists(), "evidence_exists")
    fd, name = tempfile.mkstemp(prefix=".photo-", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as output:
            output.write(raw)
            output.flush()
            os.fsync(output.fileno())
        os.link(name, path)
        directory = os.open(path.parent, os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def inspect_candidate(args: argparse.Namespace) -> dict[str, str]:
    require(bool(re.fullmatch(r"[0-9a-f]{64}", args.candidate_id)), "candidate_pin")
    require(bool(re.fullmatch(r"sha256:[0-9a-f]{64}", args.candidate_image)), "candidate_pin")
    raw = run("/usr/bin/docker", "inspect", args.candidate_id, timeout=20)
    require(len(raw) < 256 * 1024, "candidate_inspect")
    rows = json.loads(raw)
    require(isinstance(rows, list) and len(rows) == 1, "candidate_inspect")
    row = rows[0]
    networks = row.get("NetworkSettings", {}).get("Networks", {})
    require(row.get("Id") == args.candidate_id
            and row.get("Name") == "/cp11-api-candidate-channel"
            and row.get("Image") == args.candidate_image
            and row.get("State", {}).get("Running") is True
            and row.get("State", {}).get("Health", {}).get("Status") == "healthy"
            and args.network in networks, "candidate_changed")
    values = dict(part.split("=", 1) for part in row["Config"]["Env"] if "=" in part)
    # The API gives PG_CONNECTION_STRING precedence over discrete PG_* values.
    # Do not back up or migrate a different database if that override appears.
    require("PG_CONNECTION_STRING" not in values, "database_configuration")
    require(all(values.get(key) for key in
                ("PG_HOST", "PG_PORT", "PG_USER", "PG_PASSWORD", "PG_DATABASE")),
            "database_configuration")
    require(values["PG_DATABASE"] == "phone11ai", "database_configuration")
    require(values["PG_PORT"].isdigit() and 1 <= int(values["PG_PORT"]) <= 65535,
            "database_configuration")
    return values


def probe_route() -> None:
    conn = http.client.HTTPConnection("127.0.0.1", 80, timeout=5)
    try:
        conn.request("GET", "/api/profile/photo/1/1?v=11111111-1111-4111-8111-111111111111",
                     headers={"Host": "api.phone11.ai"})
        response = conn.getresponse()
        body = response.read(4096)
        require(response.status == 401 and
                response.getheader("x-phone11-photo-candidate") == BUILD and
                b"Sign in to access profile photos" in body, "route_unavailable")
    finally:
        conn.close()


@contextmanager
def connection_env(values: Mapping[str, str], evidence: Path) -> Iterator[Path]:
    ssl_mode = values.get("PG_SSL", "").lower()
    require(ssl_mode in ("false", "0", "disable", "true", "1", "require", ""),
            "database_ssl")
    # libpq's require mode matches the candidate's non-verifying TLS mode.
    require(values.get("PG_SSL_REJECT_UNAUTHORIZED", "false").lower() != "true",
            "database_ssl_certificate_required")
    selected = {
        "PGHOST": values["PG_HOST"], "PGPORT": values["PG_PORT"],
        "PGUSER": values["PG_USER"], "PGPASSWORD": values["PG_PASSWORD"],
        "PGDATABASE": values["PG_DATABASE"],
        "PGSSLMODE": "disable" if ssl_mode in ("false", "0", "disable") else "require",
    }
    require(all("\n" not in item and "\r" not in item for item in selected.values()),
            "database_configuration")
    fd, name = tempfile.mkstemp(prefix=".photo-pg-env-", dir=evidence)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w") as output:
            for key, value in selected.items():
                output.write(f"{key}={value}\n")
            output.flush()
            os.fsync(output.fileno())
        yield Path(name)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def client_args(args: argparse.Namespace, env_file: Path, evidence: Path,
                *, writable: bool = False) -> list[str]:
    require(bool(re.fullmatch(r"(?:postgres@)?sha256:[0-9a-f]{64}", args.pg16_image)),
            "client_image_pin")
    mount = f"type=bind,src={evidence},dst=/evidence" + ("" if writable else ",readonly")
    return ["/usr/bin/docker", "run", "--rm", "--network", args.network,
            "--env-file", str(env_file), "--mount", mount, "--user", "0:0",
            "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
            args.pg16_image]


def live_catalog(args: argparse.Namespace, env_file: Path, evidence: Path) -> dict[str, Any]:
    raw = run(*client_args(args, env_file, evidence), "psql", "-X", "-A", "-t",
              "-v", "ON_ERROR_STOP=1", "-c", CATALOG_SQL, timeout=30)
    require(len(raw) <= 32768, "catalog")
    return json.loads(raw)


def live_identity(args: argparse.Namespace, env_file: Path, evidence: Path) -> dict[str, Any]:
    raw = run(*client_args(args, env_file, evidence), "psql", "-X", "-A", "-t",
              "-v", "ON_ERROR_STOP=1", "-c", IDENTITY_SQL, timeout=30)
    require(len(raw) <= 4096, "database_identity")
    identity = json.loads(raw)
    require(identity.get("database") == "phone11ai"
            and identity.get("user") == "phone11ai"
            and identity.get("server_addr")
            and identity.get("server_port")
            and isinstance(identity.get("database_oid"), (int, str))
            and re.fullmatch(r"[0-9]+", str(identity["database_oid"])),
            "database_identity")
    return identity


def validate_catalog(catalog: Mapping[str, Any], *, present: bool) -> None:
    require(catalog.get("database") in ("phone11ai", "postgres")
            and 160000 <= catalog.get("server_version", 0) < 170000
            and catalog.get("tenants") is True and catalog.get("users") is True,
            "catalog_base")
    require(catalog.get("photos") is present and catalog.get("deletions") is present,
            "catalog_state")
    if not present:
        require(catalog.get("columns") == [] and catalog.get("constraints") == []
                and catalog.get("indexes") == [], "catalog_state")
        return
    require(set(catalog.get("columns", [])) == EXPECTED_COLUMNS
            and len(catalog["columns"]) == len(EXPECTED_COLUMNS)
            and set(catalog.get("indexes", [])) == EXPECTED_INDEXES
            and len(catalog["indexes"]) == len(EXPECTED_INDEXES), "catalog_shape")
    constraints = catalog.get("constraints", [])
    require(isinstance(constraints, list) and len(constraints) == 13
            and sum("PRIMARY KEY" in x for x in constraints) == 2
            and sum("FOREIGN KEY" in x and "REFERENCES tenants(id)" in x for x in constraints) == 2
            and sum("FOREIGN KEY" in x and "REFERENCES users(id)" in x for x in constraints) == 2
            and sum("CHECK" in x for x in constraints) == 6,
            "catalog_constraints")


def schema_shape(catalog: Mapping[str, Any]) -> dict[str, Any]:
    """Exclude deployment-specific database name and PG16 patch version."""
    return {key: value for key, value in catalog.items()
            if key not in ("database", "server_version")}


def migration_body(sql: bytes) -> str:
    text = sql.decode("utf-8", "strict")
    require(text.count("\nBEGIN;\n") == 1 and text.endswith("\nCOMMIT;\n"),
            "migration_envelope")
    start = text.index("\nBEGIN;\n") + len("\nBEGIN;\n")
    body = text[start:-len("\nCOMMIT;\n")]
    require(not re.search(r"(?im)^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;", body),
            "migration_envelope")
    return body


def transactional_sql(sql: bytes, expected_shape: Mapping[str, Any]) -> bytes:
    """Assert the rehearsed catalog inside the same transaction as the DDL."""
    body = migration_body(sql)
    expected_hex = canonical(expected_shape).hex()
    assertion = f"""
DO $photo_catalog$
DECLARE actual jsonb;
DECLARE expected jsonb;
BEGIN
  SELECT (value)::jsonb INTO actual FROM ({CATALOG_SQL}) AS catalog(value);
  actual := actual - 'database' - 'server_version';
  expected := convert_from(decode('{expected_hex}','hex'),'UTF8')::jsonb;
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'photo_catalog_mismatch';
  END IF;
END
$photo_catalog$;
"""
    return ("BEGIN;\nSET LOCAL lock_timeout='2s';\n"
            "SET LOCAL statement_timeout='30s';\n" + body + "\n" +
            assertion + "COMMIT;\n").encode("utf-8")


def isolated_rehearsal(args: argparse.Namespace, evidence: Path,
                       script_name: str) -> dict[str, Any]:
    require(script_name in ("photo.sql", "rehearsed-apply.sql"), "rehearsal_script")
    name = "cp11-photo-rehearsal-" + secrets.token_hex(6)
    run("/usr/bin/docker", "run", "-d", "--network", "none", "--name", name,
        "--mount", "type=tmpfs,dst=/var/lib/postgresql/data,tmpfs-size=268435456",
        "--env", "POSTGRES_HOST_AUTH_METHOD=trust",
        "--env", "PGDATA=/var/lib/postgresql/data/pgdata",
        args.pg16_image, timeout=30)
    try:
        for _ in range(30):
            result = subprocess.run(["/usr/bin/docker", "exec", "-u", "postgres", name,
                                     "pg_isready", "-h", "/var/run/postgresql"],
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                    timeout=5, check=False)
            if result.returncode == 0:
                break
            time.sleep(1)
        else:
            raise MigrationError("restore_start")
        run("/usr/bin/docker", "cp", str(evidence / "backup.dump"),
            name + ":/tmp/backup.dump", timeout=60)
        run("/usr/bin/docker", "exec", "-u", "root", name, "chown", "postgres:postgres",
            "/tmp/backup.dump", timeout=10)
        run("/usr/bin/docker", "exec", "-u", "postgres", name, "pg_restore",
            "--exit-on-error", "--no-owner", "--no-acl", "-d", "postgres",
            "/tmp/backup.dump", timeout=300)
        restored_before = json.loads(run("/usr/bin/docker", "exec", "-u", "postgres", name,
                                         "psql", "-X", "-A", "-t", "-d", "postgres",
                                         "-c", CATALOG_SQL, timeout=30))
        validate_catalog(restored_before, present=False)
        run("/usr/bin/docker", "cp", str(evidence / script_name),
            name + ":/tmp/photo.sql", timeout=30)
        run("/usr/bin/docker", "exec", "-u", "root", name, "chown", "postgres:postgres",
            "/tmp/photo.sql", timeout=10)
        run("/usr/bin/docker", "exec", "-u", "postgres", "-e",
            "PGOPTIONS=-c lock_timeout=2000 -c statement_timeout=30000", name,
            "psql", "-X", "-v", "ON_ERROR_STOP=1", "-d", "postgres",
            "-f", "/tmp/photo.sql", timeout=90)
        raw = run("/usr/bin/docker", "exec", "-u", "postgres", name,
                  "psql", "-X", "-A", "-t", "-d", "postgres", "-c", CATALOG_SQL,
                  timeout=30)
        after = json.loads(raw)
        validate_catalog(after, present=True)
        return after
    finally:
        subprocess.run(["/usr/bin/docker", "rm", "-f", name], stdin=subprocess.DEVNULL,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       timeout=30, check=False)


def prepare(args: argparse.Namespace) -> None:
    evidence = args.evidence.resolve(strict=True)
    secure_directory(evidence)
    require(not (evidence / "backup.dump").exists()
            and not (evidence / "proof.json").exists(), "evidence_exists")
    sql = secure_file(args.sql, 64 * 1024)
    require(sha(sql) == args.sql_sha256, "sql_pin")
    values = inspect_candidate(args)
    probe_route()
    with connection_env(values, evidence) as env_file:
        identity = live_identity(args, env_file, evidence)
        before = live_catalog(args, env_file, evidence)
        validate_catalog(before, present=False)
        atomic_write(evidence / "photo.sql", sql)
        backup_tmp = evidence / ".backup.dump.tmp"
        try:
            run(*client_args(args, env_file, evidence, writable=True),
                "sh", "-c", "umask 077; exec pg_dump --format=custom --file=/evidence/.backup.dump.tmp", timeout=300)
            backup_raw = secure_file(backup_tmp, MAX_BACKUP_BYTES)
            os.replace(backup_tmp, evidence / "backup.dump")
            isolated = isolated_rehearsal(args, evidence, "photo.sql")
        finally:
            if backup_tmp.exists():
                backup_tmp.unlink()
    # Restored database name differs by design; all target catalog details must match.
    restored_shape = schema_shape(isolated)
    exact_apply_sql = transactional_sql(sql, restored_shape)
    atomic_write(evidence / "rehearsed-apply.sql", exact_apply_sql)
    exact_rehearsal = isolated_rehearsal(args, evidence, "rehearsed-apply.sql")
    require(schema_shape(exact_rehearsal) == restored_shape, "rehearsal_mismatch")
    proof = {"schema": SCHEMA, "created_at": int(time.time()),
             "candidate_id": args.candidate_id, "candidate_image": args.candidate_image,
             "network": args.network, "client_image": args.pg16_image,
             "sql_sha256": args.sql_sha256, "backup_sha256": sha(backup_raw),
             "apply_sql_sha256": sha(exact_apply_sql),
             "identity_sha256": sha(canonical(identity)),
             "before_sha256": sha(canonical(before)), "restored_shape": restored_shape}
    atomic_write(evidence / "proof.json", canonical(proof) + b"\n")
    print("photo_migration_prepare=ready")


def apply(args: argparse.Namespace) -> None:
    evidence = args.evidence.resolve(strict=True)
    secure_directory(evidence)
    require(not (evidence / "receipt.json").exists(), "already_applied")
    proof = json.loads(secure_file(evidence / "proof.json", 64 * 1024))
    require(set(proof) == {"schema", "created_at", "candidate_id", "candidate_image",
                           "network", "client_image", "sql_sha256", "backup_sha256",
                           "apply_sql_sha256", "identity_sha256", "before_sha256",
                           "restored_shape"}
            and proof["schema"] == SCHEMA
            and isinstance(proof["created_at"], int)
            and 0 <= time.time() - proof["created_at"] <= MAX_AGE_SECONDS
            and proof["candidate_id"] == args.candidate_id
            and proof["candidate_image"] == args.candidate_image
            and proof["network"] == args.network
            and proof["client_image"] == args.pg16_image
            and proof["sql_sha256"] == args.sql_sha256, "proof")
    require(sha(secure_file(evidence / "backup.dump", MAX_BACKUP_BYTES)) ==
            proof["backup_sha256"], "backup_changed")
    sql = secure_file(evidence / "photo.sql", 64 * 1024)
    require(sha(sql) == args.sql_sha256 and sha(secure_file(args.sql, 64 * 1024)) == args.sql_sha256,
            "sql_changed")
    exact_apply_sql = secure_file(evidence / "rehearsed-apply.sql", 128 * 1024)
    require(sha(exact_apply_sql) == proof["apply_sql_sha256"]
            and exact_apply_sql == transactional_sql(sql, proof["restored_shape"]),
            "apply_script_changed")
    values = inspect_candidate(args)
    probe_route()
    with connection_env(values, evidence) as env_file:
        require(sha(canonical(live_identity(args, env_file, evidence))) ==
                proof["identity_sha256"], "database_changed")
        before = live_catalog(args, env_file, evidence)
        validate_catalog(before, present=False)
        require(sha(canonical(before)) == proof["before_sha256"], "catalog_changed")
        run(*client_args(args, env_file, evidence), "psql", "-X", "-v", "ON_ERROR_STOP=1",
            "-f", "/evidence/rehearsed-apply.sql", timeout=90)
        after = live_catalog(args, env_file, evidence)
        validate_catalog(after, present=True)
        require(schema_shape(after) == proof["restored_shape"], "catalog_after_mismatch")
    receipt = {"schema": SCHEMA, "applied_at": int(time.time()),
               "candidate_id": args.candidate_id, "backup_sha256": proof["backup_sha256"],
               "sql_sha256": args.sql_sha256,
               "apply_sql_sha256": proof["apply_sql_sha256"],
               "after_sha256": sha(canonical(after))}
    atomic_write(evidence / "receipt.json", canonical(receipt) + b"\n")
    print("photo_migration_apply=complete")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("prepare", "apply"))
    parser.add_argument("--candidate-id", required=True)
    parser.add_argument("--candidate-image", required=True)
    parser.add_argument("--network", required=True)
    parser.add_argument("--pg16-image", required=True)
    parser.add_argument("--sql", required=True, type=Path)
    parser.add_argument("--sql-sha256", required=True)
    parser.add_argument("--evidence", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        require(bool(re.fullmatch(r"[0-9a-f]{64}", args.sql_sha256)), "sql_pin")
        require(bool(re.fullmatch(r"[a-zA-Z0-9_.-]{1,128}", args.network)), "network_pin")
        with operator_lock():
            (prepare if args.mode == "prepare" else apply)(args)
    except (MigrationError, OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
        stage = str(error) if isinstance(error, MigrationError) else "unexpected_failure"
        print(f"photo_migration_error={stage}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
