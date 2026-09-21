#!/usr/bin/env python3
"""Guarded additive migration operator for Phone11 tenant settings.

This program runs only on the VOIP host.  It reads the database configuration
inside the routed API candidate, never prints it, and can only apply the exact
reviewed migration after a fresh protected backup and an isolated-restore
attestation have both been supplied.  It never reads application or customer
rows.
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
import tempfile
import time
from typing import Any, Mapping, Sequence


TARGET_CONTAINER = "cp11-api-candidate-next"
TARGET_CONTAINER_ID = "1ff061d46da9da6f078b17d85810baf745c265c413221d612bfbd0ed3650f901"
TARGET_IMAGE = "sha256:2e7225e80ec7e5fac5d82c20f294372bbcf325116de9926f7dff5f2a9ee1f1a9"
TARGET_PORT = "3003/tcp"
EXPECTED_DATABASE_IDENTITY_SHA256 = "35adc6d560d05208bc55746d26c6ed298b19e699dab66c3b5b9124c422f5a17f"
EXPECTED_BEFORE_CATALOG_SHA256 = "0da5b0d9a09e50624b36fc7a8e1fe262bb130b36a0d52b1b727f27b767edb084"
EXPECTED_ARTIFACT_SHA256 = "86b829b502b6d1a34e542247de2df6b653a6bcb4e106b4c17d58a8a1c8f2751c"
RECEIPT_SCHEMA = "phone11.tenant-settings-migration-journal/v2"
BACKUP_PROOF_SCHEMA = "phone11.tenant-settings-backup-proof/v1"
RESTORE_PROOF_SCHEMA = "phone11.tenant-settings-restore-proof/v1"
LOCK_PATH = Path("/run/lock/phone11-tenant-settings-migrate.lock")
RECEIPT_PATH = Path("/var/lib/phone11-tenant-settings/receipt.json")
MAX_ARTIFACT_BYTES = 128 * 1024
MAX_NODE_OUTPUT_BYTES = 64 * 1024
MAX_PROOF_AGE_SECONDS = 30 * 60


class MigrationError(RuntimeError):
    def __init__(self, stage: str) -> None:
        super().__init__(stage)
        self.stage = stage


def guarded(condition: bool, stage: str) -> None:
    if not condition:
        raise MigrationError(stage)


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def secure_read(path: Path, *, uid: int = 0, gid: int = 0) -> bytes:
    descriptor: int | None = None
    try:
        before = path.lstat()
        guarded(
            stat.S_ISREG(before.st_mode)
            and not stat.S_ISLNK(before.st_mode)
            and before.st_uid == uid
            and before.st_gid == gid
            and stat.S_IMODE(before.st_mode) == 0o600
            and before.st_nlink == 1
            and before.st_size <= MAX_ARTIFACT_BYTES,
            "artifact",
        )
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        opened = os.fstat(descriptor)
        guarded(
            (opened.st_dev, opened.st_ino, opened.st_uid, opened.st_gid, opened.st_size)
            == (before.st_dev, before.st_ino, before.st_uid, before.st_gid, before.st_size),
            "artifact",
        )
        content = os.read(descriptor, MAX_ARTIFACT_BYTES + 1)
        guarded(len(content) == before.st_size and len(content) <= MAX_ARTIFACT_BYTES, "artifact")
        return content
    except MigrationError:
        raise
    except OSError as error:
        raise MigrationError("artifact") from error
    finally:
        if descriptor is not None:
            os.close(descriptor)


def strict_json(raw: bytes, stage: str) -> Mapping[str, Any]:
    try:
        document = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise MigrationError(stage) from error
    guarded(isinstance(document, Mapping), stage)
    return document


def read_proofs(
    backup_path: Path,
    restore_path: Path,
    *,
    now: int | None = None,
    uid: int = 0,
    gid: int = 0,
    require_fresh: bool = True,
) -> tuple[str, str]:
    now = int(time.time()) if now is None else now
    backup_raw = secure_read(backup_path, uid=uid, gid=gid)
    restore_raw = secure_read(restore_path, uid=uid, gid=gid)
    backup = strict_json(backup_raw, "backup_proof")
    restore = strict_json(restore_raw, "restore_proof")
    guarded(
        set(backup) == {"schema", "database_identity_sha256", "backup_sha256", "created_at_unix", "mechanism"}
        and backup.get("schema") == BACKUP_PROOF_SCHEMA
        and backup.get("database_identity_sha256") == EXPECTED_DATABASE_IDENTITY_SHA256
        and isinstance(backup.get("backup_sha256"), str)
        and bool(re.fullmatch(r"[0-9a-f]{64}", backup["backup_sha256"]))
        and isinstance(backup.get("created_at_unix"), int)
        and (not require_fresh or now - MAX_PROOF_AGE_SECONDS <= backup["created_at_unix"] <= now + 60)
        and backup.get("mechanism") == "cp11-postgres:pg_dump",
        "backup_proof",
    )
    guarded(
        set(restore) == {"schema", "database_identity_sha256", "backup_sha256", "restored_at_unix", "mechanism", "isolation", "catalog_verified"}
        and restore.get("schema") == RESTORE_PROOF_SCHEMA
        and restore.get("database_identity_sha256") == EXPECTED_DATABASE_IDENTITY_SHA256
        and restore.get("backup_sha256") == backup["backup_sha256"]
        and isinstance(restore.get("restored_at_unix"), int)
        and backup["created_at_unix"] <= restore["restored_at_unix"] <= now + 60
        and (not require_fresh or now - MAX_PROOF_AGE_SECONDS <= restore["restored_at_unix"])
        and restore.get("mechanism") == "cp11-postgres:pg_restore"
        and restore.get("isolation") == "separate_postgres_cluster"
        and restore.get("catalog_verified") is True,
        "restore_proof",
    )
    return sha256_bytes(backup_raw), sha256_bytes(restore_raw)


def inspect_target() -> str:
    try:
        result = subprocess.run(
            ["/usr/bin/docker", "inspect", TARGET_CONTAINER_ID],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=20,
            check=False,
        )
        guarded(result.returncode == 0 and len(result.stdout) <= MAX_NODE_OUTPUT_BYTES, "container")
        document = json.loads(result.stdout)
        guarded(isinstance(document, list) and len(document) == 1 and isinstance(document[0], Mapping), "container")
        container = document[0]
        state = container.get("State")
        ports = container.get("HostConfig", {}).get("PortBindings")
        guarded(
            container.get("Id") == TARGET_CONTAINER_ID
            and container.get("Name") == "/" + TARGET_CONTAINER
            and container.get("Image") == TARGET_IMAGE
            and isinstance(state, Mapping)
            and state.get("Running") is True
            and state.get("Health", {}).get("Status") == "healthy"
            and isinstance(ports, Mapping)
            and TARGET_PORT in ports
            and isinstance(ports[TARGET_PORT], list)
            and len(ports[TARGET_PORT]) == 1
            and ports[TARGET_PORT][0].get("HostIp") == "127.0.0.1"
            and ports[TARGET_PORT][0].get("HostPort") == "3003",
            "container",
        )
        return TARGET_CONTAINER_ID
    except MigrationError:
        raise
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError, AttributeError) as error:
        raise MigrationError("container") from error


NODE_PROGRAM = r'''
const crypto = require("node:crypto");
const fs = require("node:fs");
const pg = require("pg");
const action = process.argv[1];
const contract = JSON.parse(process.argv[2]);
const checkExpression = "business_hours_timezone::text = btrim(business_hours_timezone::text) AND char_length(business_hours_timezone::text) >= 1 AND char_length(business_hours_timezone::text) <= 64";
function first(...keys) { for (const key of keys) if (process.env[key]) return process.env[key]; }
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object") return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  return JSON.stringify(value);
}
function sha(value) { return crypto.createHash("sha256").update(canonical(value)).digest("hex"); }
function config() {
  const discrete = { host:first("PG_HOST","DB_HOST","POSTGRES_HOST"), port:first("PG_PORT","DB_PORT","POSTGRES_PORT"), user:first("PG_USER","DB_USER","POSTGRES_USER"), password:first("PG_PASSWORD","DB_PASSWORD","POSTGRES_PASSWORD"), database:first("PG_DATABASE","DB_NAME","DB_DATABASE","POSTGRES_DB") };
  const complete = [discrete.host, discrete.user, discrete.password, discrete.database].every(Boolean);
  const connectionString = process.env.PG_CONNECTION_STRING ?? (complete ? undefined : process.env.DATABASE_URL);
  const mode = first("PG_SSL","DB_SSL","POSTGRES_SSL","DATABASE_SSL")?.toLowerCase();
  const ssl = mode === "false" || mode === "0" || mode === "disable" || connectionString?.includes("sslmode=disable") ? false : {rejectUnauthorized:first("PG_SSL_REJECT_UNAUTHORIZED","DB_SSL_REJECT_UNAUTHORIZED") === "true"};
  if (!connectionString && !complete) throw new Error("configuration");
  return connectionString ? {connectionString, ssl, connectionTimeoutMillis:5000, max:1} : {...discrete, port:parseInt(discrete.port ?? "5432",10), ssl, connectionTimeoutMillis:5000, max:1};
}
async function identity(client) {
  return (await client.query("SELECT current_database() database,current_schema() schema,current_setting('server_version_num') server_version_num,(SELECT oid FROM pg_database WHERE datname=current_database()) database_oid")).rows[0];
}
async function catalog(client) {
  const relations = (await client.query("SELECT c.relname name,c.relkind kind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relname IN ('tenants','tenant_settings') ORDER BY c.relname")).rows;
  const columns = (await client.query("SELECT c.relname table_name,columns.column_name name,columns.data_type type,columns.is_nullable = 'NO' not_null FROM information_schema.columns columns JOIN pg_class c ON c.relname=columns.table_name JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname=columns.table_schema WHERE columns.table_schema=current_schema() AND columns.table_name IN ('tenants','tenant_settings') ORDER BY c.relname,columns.ordinal_position")).rows;
  const constraints = (await client.query("SELECT c.relname table_name,con.conname name,con.contype type,con.convalidated validated,pg_get_constraintdef(con.oid,true) definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relname IN ('tenants','tenant_settings') ORDER BY c.relname,con.conname")).rows;
  return {relations, columns, constraints};
}
function withoutTarget(value) {
  return {relations:value.relations.filter(row => row.name !== "tenant_settings"), columns:value.columns.filter(row => row.table_name !== "tenant_settings"), constraints:value.constraints.filter(row => row.table_name !== "tenant_settings")};
}
function state(value) {
  const relation = value.relations.find(row => row.name === "tenant_settings");
  if (!relation) return "absent";
  const columns = value.columns.filter(row => row.table_name === "tenant_settings");
  const expected = new Map([["tenant_id",["integer",true]],["business_hours_timezone",["character varying",true]],["created_at",["timestamp with time zone",true]],["updated_at",["timestamp with time zone",true]]]);
  const exactColumns = relation.kind === "r" && columns.length === expected.size && columns.every(row => expected.has(row.name) && expected.get(row.name)[0] === row.type && expected.get(row.name)[1] === row.not_null);
  const constraints = value.constraints.filter(row => row.table_name === "tenant_settings");
  const definitions = new Set(constraints.map(row => row.definition));
  const exactConstraints = constraints.length === 3 && constraints.every(row => row.validated === true) && definitions.has("PRIMARY KEY (tenant_id)") && definitions.has("FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE") && definitions.has("CHECK (" + checkExpression + ")");
  return exactColumns && exactConstraints ? "compatible" : "incompatible";
}
function migrationBody(raw) {
  const begin = raw.indexOf("BEGIN;\n");
  if (begin < 0 || raw.indexOf("BEGIN;\n", begin + 1) >= 0 || !raw.endsWith("\nCOMMIT;\n")) throw new Error("migration_envelope");
  return raw.slice(0, begin) + raw.slice(begin + "BEGIN;\n".length, -"\nCOMMIT;\n".length);
}
async function snapshot(client) {
  const currentIdentity = await identity(client); const currentCatalog = await catalog(client);
  return {identity_fingerprint:sha(currentIdentity), catalog_fingerprint:sha(currentCatalog), target_state:state(currentCatalog), catalog:currentCatalog};
}
(async () => {
  if (!["prepare", "apply", "recover"].includes(action)) throw new Error("action");
  const pool = new pg.Pool(config()); let client;
  try {
    client = await pool.connect();
    if (action === "apply") {
      const sql = fs.readFileSync(0,"utf8");
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout='2000ms'");
      await client.query("SET LOCAL statement_timeout='30000ms'");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('phone11-tenant-settings-live-delta-20260922',0))");
      const before = await snapshot(client);
      if (before.identity_fingerprint !== contract.database_identity_sha256 || before.catalog_fingerprint !== contract.before_catalog_sha256 || before.target_state !== "absent") throw new Error("precondition");
      await client.query(migrationBody(sql));
      const after = await snapshot(client);
      if (after.identity_fingerprint !== before.identity_fingerprint || after.target_state !== "compatible" || sha(withoutTarget(after.catalog)) !== before.catalog_fingerprint) throw new Error("postcondition");
      await client.query("COMMIT");
      process.stdout.write(JSON.stringify({before, after}) + "\n");
    } else {
      await client.query("BEGIN TRANSACTION READ ONLY");
      await client.query("SET LOCAL statement_timeout='5000ms'");
      const before = await snapshot(client);
      await client.query("ROLLBACK");
      process.stdout.write(JSON.stringify({before}) + "\n");
    }
  } catch (_error) {
    try { if (client) await client.query("ROLLBACK"); } catch (_ignored) {}
    process.exitCode = 1;
  } finally { client?.release(); await pool.end().catch(() => undefined); }
})();
'''


def run_database(action: str, sql: bytes = b"") -> Mapping[str, Any]:
    contract = canonical_bytes(
        {
            "database_identity_sha256": EXPECTED_DATABASE_IDENTITY_SHA256,
            "before_catalog_sha256": EXPECTED_BEFORE_CATALOG_SHA256,
        },
    ).decode("utf-8")
    try:
        container_id = inspect_target()
        result = subprocess.run(
            ["/usr/bin/docker", "exec", "--workdir", "/app", container_id, "node", "-e", NODE_PROGRAM, action, contract],
            input=sql,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=45,
            check=False,
        )
        guarded(result.returncode == 0 and 0 < len(result.stdout) <= MAX_NODE_OUTPUT_BYTES, "database")
        document = strict_json(result.stdout, "database")
        return document
    except MigrationError:
        raise
    except (OSError, subprocess.TimeoutExpired) as error:
        raise MigrationError("database") from error


def assert_prepared(document: Mapping[str, Any]) -> None:
    before = document.get("before")
    guarded(
        isinstance(before, Mapping)
        and before.get("identity_fingerprint") == EXPECTED_DATABASE_IDENTITY_SHA256
        and before.get("catalog_fingerprint") == EXPECTED_BEFORE_CATALOG_SHA256
        and before.get("target_state") == "absent",
        "precondition",
    )


def without_target_catalog(catalog: Mapping[str, Any], stage: str) -> dict[str, list[Mapping[str, Any]]]:
    result: dict[str, list[Mapping[str, Any]]] = {}
    for key in ("relations", "columns", "constraints"):
        rows = catalog.get(key)
        guarded(isinstance(rows, list) and all(isinstance(row, Mapping) for row in rows), stage)
        result[key] = [row for row in rows if row.get("table_name", row.get("name")) != "tenant_settings"]
    return result


def assert_applied(document: Mapping[str, Any]) -> tuple[str, str]:
    before, after = document.get("before"), document.get("after")
    guarded(isinstance(before, Mapping) and isinstance(after, Mapping), "verification")
    guarded(
        before.get("identity_fingerprint") == EXPECTED_DATABASE_IDENTITY_SHA256
        and before.get("catalog_fingerprint") == EXPECTED_BEFORE_CATALOG_SHA256
        and before.get("target_state") == "absent"
        and after.get("identity_fingerprint") == EXPECTED_DATABASE_IDENTITY_SHA256
        and after.get("target_state") == "compatible",
        "verification",
    )
    after_catalog = after.get("catalog")
    guarded(isinstance(after_catalog, Mapping), "verification")
    without_target = without_target_catalog(after_catalog, "verification")
    guarded(sha256_bytes(canonical_bytes(without_target)) == EXPECTED_BEFORE_CATALOG_SHA256, "verification")
    after_catalog_sha256 = str(after.get("catalog_fingerprint"))
    guarded(bool(re.fullmatch(r"[0-9a-f]{64}", after_catalog_sha256)), "verification")
    verification_sha256 = sha256_bytes(canonical_bytes({
        "database_identity_sha256": EXPECTED_DATABASE_IDENTITY_SHA256,
        "before_catalog_sha256": EXPECTED_BEFORE_CATALOG_SHA256,
        "after_catalog_sha256": after_catalog_sha256,
    }))
    return after_catalog_sha256, verification_sha256


def receipt_base(backup_sha256: str, restore_sha256: str) -> dict[str, str]:
    return {
        "schema": RECEIPT_SCHEMA,
        "artifact_sha256": EXPECTED_ARTIFACT_SHA256,
        "database_identity_sha256": EXPECTED_DATABASE_IDENTITY_SHA256,
        "before_catalog_sha256": EXPECTED_BEFORE_CATALOG_SHA256,
        "backup_proof_sha256": backup_sha256,
        "restore_proof_sha256": restore_sha256,
    }


def receipt_document(base: Mapping[str, str], status: str, **extra: str) -> dict[str, str]:
    guarded(status in {"intent", "applied", "not_applied"}, "receipt")
    document = dict(base)
    document.update(extra)
    document["status"] = status
    return document


def write_receipt(
    path: Path,
    receipt: Mapping[str, Any],
    *,
    expected: Mapping[str, Any] | None = None,
    uid: int = 0,
    gid: int = 0,
) -> None:
    descriptor: int | None = None
    directory_descriptor: int | None = None
    temporary: str | None = None
    try:
        parent = path.parent.lstat()
        guarded(
            path.is_absolute()
            and stat.S_ISDIR(parent.st_mode)
            and not stat.S_ISLNK(parent.st_mode)
            and parent.st_uid == uid
            and parent.st_gid == gid
            and stat.S_IMODE(parent.st_mode) == 0o700,
            "receipt",
        )
        if expected is None:
            guarded(not os.path.lexists(path), "receipt")
        else:
            guarded(strict_json(secure_read(path, uid=uid, gid=gid), "receipt") == expected, "receipt")
        content = canonical_bytes(receipt)
        descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
        os.fchmod(descriptor, 0o600)
        os.fchown(descriptor, uid, gid)
        view = memoryview(content)
        while view:
            written = os.write(descriptor, view)
            guarded(written > 0, "receipt")
            view = view[written:]
        os.fsync(descriptor)
        os.close(descriptor)
        descriptor = None
        if expected is None:
            os.link(temporary, path, follow_symlinks=False)
            os.unlink(temporary)
            temporary = None
        else:
            guarded(strict_json(secure_read(path, uid=uid, gid=gid), "receipt") == expected, "receipt")
            os.replace(temporary, path)
            temporary = None
        directory_descriptor = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0))
        directory = os.fstat(directory_descriptor)
        guarded(
            (directory.st_dev, directory.st_ino, directory.st_uid, directory.st_gid)
            == (parent.st_dev, parent.st_ino, parent.st_uid, parent.st_gid),
            "receipt",
        )
        os.fsync(directory_descriptor)
        published = path.lstat()
        guarded(
            stat.S_ISREG(published.st_mode)
            and not stat.S_ISLNK(published.st_mode)
            and published.st_uid == uid
            and published.st_gid == gid
            and stat.S_IMODE(published.st_mode) == 0o600
            and published.st_nlink == 1
            and published.st_size == len(content),
            "receipt",
        )
        guarded(secure_read(path, uid=uid, gid=gid) == content, "receipt")
    except MigrationError:
        raise
    except OSError as error:
        raise MigrationError("receipt") from error
    finally:
        if descriptor is not None:
            os.close(descriptor)
        if directory_descriptor is not None:
            os.close(directory_descriptor)
        if temporary is not None:
            Path(temporary).unlink(missing_ok=True)


def reserve_receipt(path: Path, base: Mapping[str, str], *, uid: int = 0, gid: int = 0) -> Mapping[str, Any]:
    intent = receipt_document(base, "intent")
    write_receipt(path, intent, uid=uid, gid=gid)
    return intent


def read_receipt(path: Path, base: Mapping[str, str], *, uid: int = 0, gid: int = 0) -> Mapping[str, Any]:
    document = strict_json(secure_read(path, uid=uid, gid=gid), "receipt")
    guarded(all(document.get(key) == value for key, value in base.items()), "receipt")
    guarded(document.get("status") in {"intent", "applied", "not_applied"}, "receipt")
    expected_keys = set(base) | {"status"}
    if document.get("status") == "applied":
        expected_keys |= {"after_catalog_sha256", "verification_sha256"}
        guarded(
            isinstance(document.get("after_catalog_sha256"), str)
            and bool(re.fullmatch(r"[0-9a-f]{64}", document["after_catalog_sha256"]))
            and isinstance(document.get("verification_sha256"), str)
            and bool(re.fullmatch(r"[0-9a-f]{64}", document["verification_sha256"])),
            "receipt",
        )
    guarded(set(document) == expected_keys, "receipt")
    return document


def assess_recovery(
    document: Mapping[str, Any],
    *,
    expected_identity_sha256: str = EXPECTED_DATABASE_IDENTITY_SHA256,
    expected_before_sha256: str = EXPECTED_BEFORE_CATALOG_SHA256,
) -> tuple[str, str | None, str | None]:
    current = document.get("before")
    guarded(isinstance(current, Mapping), "recovery")
    guarded(current.get("identity_fingerprint") == expected_identity_sha256, "recovery")
    if current.get("target_state") == "absent" and current.get("catalog_fingerprint") == expected_before_sha256:
        return "not_applied", None, None
    catalog = current.get("catalog")
    guarded(current.get("target_state") == "compatible" and isinstance(catalog, Mapping), "recovery")
    without_target = without_target_catalog(catalog, "recovery")
    guarded(sha256_bytes(canonical_bytes(without_target)) == expected_before_sha256, "recovery")
    after_catalog_sha256 = str(current.get("catalog_fingerprint"))
    guarded(bool(re.fullmatch(r"[0-9a-f]{64}", after_catalog_sha256)), "recovery")
    verification_sha256 = sha256_bytes(canonical_bytes({
        "database_identity_sha256": expected_identity_sha256,
        "before_catalog_sha256": expected_before_sha256,
        "after_catalog_sha256": after_catalog_sha256,
    }))
    return "applied", after_catalog_sha256, verification_sha256


def operator_lock(path: Path = LOCK_PATH):
    class Lock:
        descriptor: int | None = None

        def __enter__(self) -> None:
            import fcntl

            self.descriptor = os.open(path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
            info = os.fstat(self.descriptor)
            guarded(
                stat.S_ISREG(info.st_mode)
                and info.st_uid == 0
                and info.st_gid == 0
                and stat.S_IMODE(info.st_mode) == 0o600
                and info.st_nlink == 1,
                "lock",
            )
            fcntl.flock(self.descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)

        def __exit__(self, *_ignored: Any) -> None:
            if self.descriptor is not None:
                os.close(self.descriptor)

    return Lock()


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--prepare", action="store_true")
    modes.add_argument("--apply", action="store_true")
    modes.add_argument("--recover", action="store_true")
    parser.add_argument("--sql", type=Path, required=True)
    parser.add_argument("--backup-proof", type=Path, required=True)
    parser.add_argument("--restore-proof", type=Path, required=True)
    parser.add_argument("--receipt", type=Path)
    return parser.parse_args(argv)


def run(arguments: argparse.Namespace) -> int:
    try:
        guarded(os.geteuid() == 0, "root")
        sql = secure_read(arguments.sql)
        guarded(sha256_bytes(sql) == EXPECTED_ARTIFACT_SHA256, "artifact")
        backup_sha256, restore_sha256 = read_proofs(
            arguments.backup_proof,
            arguments.restore_proof,
            require_fresh=not arguments.recover,
        )
        base = receipt_base(backup_sha256, restore_sha256)
        with operator_lock():
            if arguments.prepare:
                guarded(arguments.receipt is None, "arguments")
                assert_prepared(run_database("prepare"))
                print("tenant_settings=PREPARE_READY apply=NOT_RUN")
                return 0
            guarded(arguments.receipt is not None, "arguments")
            guarded(arguments.receipt == RECEIPT_PATH, "arguments")
            if arguments.recover:
                existing = read_receipt(arguments.receipt, base)
                status, after_catalog_sha256, verification_sha256 = assess_recovery(run_database("recover"))
                if existing.get("status") == "intent":
                    replacement = receipt_document(base, status)
                    if status == "applied":
                        guarded(after_catalog_sha256 is not None and verification_sha256 is not None, "recovery")
                        replacement.update({
                            "after_catalog_sha256": after_catalog_sha256,
                            "verification_sha256": verification_sha256,
                        })
                    write_receipt(arguments.receipt, replacement, expected=existing)
                    print("tenant_settings=RECOVERED status=" + status.upper())
                    return 0
                guarded(existing.get("status") == status, "recovery")
                if status == "applied":
                    guarded(
                        existing.get("after_catalog_sha256") == after_catalog_sha256
                        and existing.get("verification_sha256") == verification_sha256,
                        "recovery",
                    )
                print("tenant_settings=RECOVERY_VALID status=" + status.upper())
                return 0
            intent = reserve_receipt(arguments.receipt, base)
            document = run_database("apply", sql)
            after_catalog_sha256, verification_sha256 = assert_applied(document)
            write_receipt(
                arguments.receipt,
                receipt_document(
                    base,
                    "applied",
                    after_catalog_sha256=after_catalog_sha256,
                    verification_sha256=verification_sha256,
                ),
                expected=intent,
            )
            print("tenant_settings=APPLIED receipt=WRITTEN")
            return 0
    except MigrationError as error:
        print("tenant_settings=BLOCKED stage=" + error.stage)
        return 1
    except (OSError, KeyboardInterrupt):
        print("tenant_settings=BLOCKED stage=operator")
        return 1


if __name__ == "__main__":
    raise SystemExit(run(parse_args()))
