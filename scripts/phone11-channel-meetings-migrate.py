#!/usr/bin/env python3
"""Guarded Phone11 channel-meeting schema migration operator.

The operator has no baked-in deployment pins.  A root-owned manifest must bind
one immutable API container, its release labels, the exact SQL bytes, and the
database identity and before/after catalog fingerprints established by a fresh
backup and isolated restore rehearsal.  No application rows are read or
printed.
"""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import time
from typing import Any, Mapping, Sequence


MANIFEST_SCHEMA = "phone11.channel-meetings-migration-manifest/v1"
INVENTORY_SCHEMA = "phone11.channel-meetings-migration-inventory/v1"
BACKUP_PROOF_SCHEMA = "phone11.channel-meetings-backup-proof/v1"
RESTORE_PROOF_SCHEMA = "phone11.channel-meetings-restore-proof/v1"
RECEIPT_SCHEMA = "phone11.channel-meetings-migration-journal/v1"
LOCK_PATH = Path("/run/lock/phone11-channel-meetings-migrate.lock")
RECEIPT_PATH = Path("/var/lib/phone11-channel-meetings/receipt.json")
MAX_ARTIFACT_BYTES = 512 * 1024
MAX_OUTPUT_BYTES = 128 * 1024
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


def is_sha256(value: Any) -> bool:
    return isinstance(value, str) and bool(re.fullmatch(r"[0-9a-f]{64}", value))


def exact_keys(value: Mapping[str, Any], keys: set[str], stage: str) -> None:
    guarded(set(value) == keys, stage)


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
            and 0 < before.st_size <= MAX_ARTIFACT_BYTES,
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
        guarded(len(content) == before.st_size, "artifact")
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
        value = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise MigrationError(stage) from error
    guarded(isinstance(value, Mapping), stage)
    return value


def validate_target(value: Any, stage: str = "manifest") -> Mapping[str, Any]:
    guarded(isinstance(value, Mapping), stage)
    exact_keys(value, {"container_id", "container_name", "image", "container_port", "host_port"}, stage)
    guarded(
        isinstance(value.get("container_id"), str)
        and bool(re.fullmatch(r"[0-9a-f]{64}", value["container_id"]))
        and isinstance(value.get("container_name"), str)
        and bool(re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}", value["container_name"]))
        and isinstance(value.get("image"), str)
        and bool(re.fullmatch(r"sha256:[0-9a-f]{64}", value["image"]))
        and isinstance(value.get("container_port"), int)
        and 1 <= value["container_port"] <= 65535
        and isinstance(value.get("host_port"), int)
        and 1 <= value["host_port"] <= 65535,
        stage,
    )
    return value


def validate_release(value: Any, stage: str = "manifest") -> Mapping[str, Any]:
    guarded(isinstance(value, Mapping), stage)
    exact_keys(value, {"source_sha", "bundle_sha256", "lock_sha256"}, stage)
    guarded(
        isinstance(value.get("source_sha"), str)
        and bool(re.fullmatch(r"[0-9a-f]{40}", value["source_sha"]))
        and is_sha256(value.get("bundle_sha256"))
        and is_sha256(value.get("lock_sha256")),
        stage,
    )
    return value


def read_manifest(path: Path, *, uid: int = 0, gid: int = 0) -> tuple[Mapping[str, Any], str]:
    raw = secure_read(path, uid=uid, gid=gid)
    value = strict_json(raw, "manifest")
    exact_keys(value, {
        "schema", "target", "release", "database_identity_sha256",
        "before_catalog_sha256", "after_catalog_sha256", "sql_sha256",
    }, "manifest")
    guarded(value.get("schema") == MANIFEST_SCHEMA, "manifest")
    validate_target(value.get("target"))
    validate_release(value.get("release"))
    guarded(all(is_sha256(value.get(key)) for key in (
        "database_identity_sha256", "before_catalog_sha256",
        "after_catalog_sha256", "sql_sha256",
    )), "manifest")
    guarded(value["before_catalog_sha256"] != value["after_catalog_sha256"], "manifest")
    return value, sha256_bytes(raw)


def read_proofs(
    backup_path: Path,
    restore_path: Path,
    manifest: Mapping[str, Any],
    manifest_sha256: str,
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
    exact_keys(backup, {
        "schema", "manifest_sha256", "database_identity_sha256",
        "before_catalog_sha256", "backup_sha256", "created_at_unix", "mechanism",
    }, "backup_proof")
    guarded(
        backup.get("schema") == BACKUP_PROOF_SCHEMA
        and backup.get("manifest_sha256") == manifest_sha256
        and backup.get("database_identity_sha256") == manifest["database_identity_sha256"]
        and backup.get("before_catalog_sha256") == manifest["before_catalog_sha256"]
        and is_sha256(backup.get("backup_sha256"))
        and isinstance(backup.get("created_at_unix"), int)
        and (not require_fresh or now - MAX_PROOF_AGE_SECONDS <= backup["created_at_unix"] <= now + 60)
        and backup.get("mechanism") == "cp11-postgres:pg_dump",
        "backup_proof",
    )
    exact_keys(restore, {
        "schema", "manifest_sha256", "database_identity_sha256",
        "before_catalog_sha256", "after_catalog_sha256", "sql_sha256",
        "backup_sha256", "restored_at_unix", "mechanism", "isolation",
        "catalog_verified", "migration_verified",
    }, "restore_proof")
    guarded(
        restore.get("schema") == RESTORE_PROOF_SCHEMA
        and restore.get("manifest_sha256") == manifest_sha256
        and restore.get("database_identity_sha256") == manifest["database_identity_sha256"]
        and restore.get("before_catalog_sha256") == manifest["before_catalog_sha256"]
        and restore.get("after_catalog_sha256") == manifest["after_catalog_sha256"]
        and restore.get("sql_sha256") == manifest["sql_sha256"]
        and restore.get("backup_sha256") == backup["backup_sha256"]
        and isinstance(restore.get("restored_at_unix"), int)
        and backup["created_at_unix"] <= restore["restored_at_unix"] <= now + 60
        and (not require_fresh or now - MAX_PROOF_AGE_SECONDS <= restore["restored_at_unix"])
        and restore.get("mechanism") == "cp11-postgres:pg_restore"
        and restore.get("isolation") == "separate_postgres_cluster"
        and restore.get("catalog_verified") is True
        and restore.get("migration_verified") is True,
        "restore_proof",
    )
    return sha256_bytes(backup_raw), sha256_bytes(restore_raw)


def inspect_target(target: Mapping[str, Any], release: Mapping[str, Any]) -> str:
    try:
        result = subprocess.run(
            ["/usr/bin/docker", "inspect", target["container_id"]],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=20,
            check=False,
        )
        guarded(result.returncode == 0 and 0 < len(result.stdout) <= MAX_OUTPUT_BYTES, "container")
        rows = json.loads(result.stdout)
        guarded(isinstance(rows, list) and len(rows) == 1 and isinstance(rows[0], Mapping), "container")
        container = rows[0]
        state = container.get("State")
        labels = container.get("Config", {}).get("Labels")
        ports = container.get("HostConfig", {}).get("PortBindings")
        port_key = f"{target['container_port']}/tcp"
        binding = ports.get(port_key) if isinstance(ports, Mapping) else None
        guarded(
            container.get("Id") == target["container_id"]
            and container.get("Name") == "/" + target["container_name"]
            and container.get("Image") == target["image"]
            and isinstance(state, Mapping)
            and state.get("Running") is True
            and state.get("Health", {}).get("Status") == "healthy"
            and isinstance(labels, Mapping)
            and labels.get("com.phone11.source-sha") == release["source_sha"]
            and labels.get("com.phone11.bundle-sha256") == release["bundle_sha256"]
            and labels.get("com.phone11.lock-sha256") == release["lock_sha256"]
            and isinstance(binding, list)
            and len(binding) == 1
            and binding[0].get("HostIp") == "127.0.0.1"
            and binding[0].get("HostPort") == str(target["host_port"]),
            "container",
        )
        return target["container_id"]
    except MigrationError:
        raise
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError, AttributeError) as error:
        raise MigrationError("container") from error


def inventory_target(
    container_id: str,
    container_name: str,
    container_port: int,
    host_port: int,
) -> tuple[Mapping[str, Any], Mapping[str, Any]]:
    """Read nonsecret immutable runtime pins without accepting a mutable name for exec."""
    guarded(bool(re.fullmatch(r"[0-9a-f]{64}", container_id)), "inventory")
    guarded(
        bool(re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}", container_name))
        and 1 <= container_port <= 65535
        and 1 <= host_port <= 65535,
        "inventory",
    )
    try:
        result = subprocess.run(
            ["/usr/bin/docker", "inspect", container_id],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=20,
            check=False,
        )
        guarded(result.returncode == 0 and 0 < len(result.stdout) <= MAX_OUTPUT_BYTES, "inventory")
        rows = json.loads(result.stdout)
        guarded(isinstance(rows, list) and len(rows) == 1 and isinstance(rows[0], Mapping), "inventory")
        container = rows[0]
        state = container.get("State")
        labels = container.get("Config", {}).get("Labels")
        ports = container.get("HostConfig", {}).get("PortBindings")
        binding = ports.get(f"{container_port}/tcp") if isinstance(ports, Mapping) else None
        target = {
            "container_id": container_id,
            "container_name": container_name,
            "image": container.get("Image"),
            "container_port": container_port,
            "host_port": host_port,
        }
        release = {
            "source_sha": labels.get("com.phone11.source-sha") if isinstance(labels, Mapping) else None,
            "bundle_sha256": labels.get("com.phone11.bundle-sha256") if isinstance(labels, Mapping) else None,
            "lock_sha256": labels.get("com.phone11.lock-sha256") if isinstance(labels, Mapping) else None,
        }
        validate_target(target, "inventory")
        validate_release(release, "inventory")
        guarded(
            container.get("Id") == container_id
            and container.get("Name") == "/" + container_name
            and isinstance(state, Mapping)
            and state.get("Running") is True
            and state.get("Health", {}).get("Status") == "healthy"
            and isinstance(binding, list)
            and len(binding) == 1
            and binding[0].get("HostIp") == "127.0.0.1"
            and binding[0].get("HostPort") == str(host_port),
            "inventory",
        )
        return target, release
    except MigrationError:
        raise
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError, AttributeError) as error:
        raise MigrationError("inventory") from error


NODE_PROGRAM = r'''
const crypto = require("node:crypto");
const fs = require("node:fs");
const pg = require("pg");
const action = process.argv[1];
const contract = JSON.parse(process.argv[2]);
function first(...keys) { for (const key of keys) if (process.env[key]) return process.env[key]; }
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object") return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  return JSON.stringify(value);
}
function sha(value) { return crypto.createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : canonical(value)).digest("hex"); }
function config() {
  const discrete = {host:first("PG_HOST","DB_HOST","POSTGRES_HOST"),port:first("PG_PORT","DB_PORT","POSTGRES_PORT"),user:first("PG_USER","DB_USER","POSTGRES_USER"),password:first("PG_PASSWORD","DB_PASSWORD","POSTGRES_PASSWORD"),database:first("PG_DATABASE","DB_NAME","DB_DATABASE","POSTGRES_DB")};
  const complete = [discrete.host,discrete.user,discrete.password,discrete.database].every(Boolean);
  const connectionString = process.env.PG_CONNECTION_STRING ?? (complete ? undefined : process.env.DATABASE_URL);
  const mode = first("PG_SSL","DB_SSL","POSTGRES_SSL","DATABASE_SSL")?.toLowerCase();
  const ssl = mode === "false" || mode === "0" || mode === "disable" || connectionString?.includes("sslmode=disable") ? false : {rejectUnauthorized:first("PG_SSL_REJECT_UNAUTHORIZED","DB_SSL_REJECT_UNAUTHORIZED") === "true"};
  if (!connectionString && !complete) throw new Error("configuration");
  return connectionString ? {connectionString,ssl,connectionTimeoutMillis:5000,max:1} : {...discrete,port:parseInt(discrete.port ?? "5432",10),ssl,connectionTimeoutMillis:5000,max:1};
}
async function identity(client) {
  return (await client.query("SELECT current_database() database,current_schema() schema,current_setting('server_version_num') server_version_num,(SELECT oid::text FROM pg_database WHERE datname=current_database()) database_oid")).rows[0];
}
async function catalog(client) {
  const relations = (await client.query("SELECT n.nspname schema,c.relname name,c.relkind kind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f') ORDER BY n.nspname,c.relname")).rows;
  const columns = (await client.query("SELECT n.nspname schema,c.relname table_name,a.attname name,pg_catalog.format_type(a.atttypid,a.atttypmod) type,a.attnotnull not_null,a.attidentity identity,a.attgenerated generated,pg_get_expr(d.adbin,d.adrelid,true) default_expression FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped ORDER BY n.nspname,c.relname,a.attnum")).rows;
  const constraints = (await client.query("SELECT n.nspname schema,c.relname table_name,con.conname name,con.contype type,con.convalidated validated,pg_get_constraintdef(con.oid,true) definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY n.nspname,c.relname,con.conname")).rows;
  const indexes = (await client.query("SELECT ns.nspname schema,t.relname table_name,i.relname name,pg_get_indexdef(i.oid) definition FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_class t ON t.oid=x.indrelid JOIN pg_namespace ns ON ns.oid=t.relnamespace WHERE ns.nspname='public' ORDER BY ns.nspname,t.relname,i.relname")).rows;
  const triggers = (await client.query("SELECT n.nspname schema,c.relname table_name,t.tgname name,pg_get_triggerdef(t.oid,true) definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY n.nspname,c.relname,t.tgname")).rows;
  const functions = (await client.query("SELECT n.nspname schema,p.proname name,p.prokind kind,pg_get_function_identity_arguments(p.oid) arguments,pg_get_function_result(p.oid) result,l.lanname language,p.provolatile volatility,p.prosecdef security_definer,CASE WHEN p.prokind IN ('f','p') THEN pg_get_functiondef(p.oid) ELSE NULL END definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname='public' ORDER BY n.nspname,p.proname,arguments")).rows;
  return {relations,columns,constraints,indexes,triggers,functions};
}
function migrationBody(raw) {
  const begin = raw.indexOf("BEGIN;\n");
  if (begin < 0 || raw.indexOf("BEGIN;\n",begin+1) >= 0 || !raw.endsWith("\nCOMMIT;\n")) throw new Error("migration_envelope");
  return raw.slice(0,begin) + raw.slice(begin+"BEGIN;\n".length,-"\nCOMMIT;\n".length);
}
async function snapshot(client) {
  const currentIdentity = await identity(client); const currentCatalog = await catalog(client);
  return {identity_fingerprint:sha(currentIdentity),catalog_fingerprint:sha(currentCatalog)};
}
(async()=>{
  if (!["snapshot","recover","apply"].includes(action)) throw new Error("action");
  const pool = new pg.Pool(config()); let client;
  try {
    client = await pool.connect();
    if (action === "apply") {
      const sql = fs.readFileSync(0);
      if (sha(sql) !== contract.sql_sha256) throw new Error("artifact");
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout='2000ms'");
      await client.query("SET LOCAL statement_timeout='30000ms'");
      const locked = (await client.query("SELECT pg_try_advisory_xact_lock(hashtextextended('phone11-channel-meetings-live-delta-v1',0)) locked")).rows[0]?.locked;
      if (locked !== true) throw new Error("advisory_lock");
      const before = await snapshot(client);
      if (before.identity_fingerprint !== contract.database_identity_sha256 || before.catalog_fingerprint !== contract.before_catalog_sha256) throw new Error("precondition");
      await client.query(migrationBody(sql.toString("utf8")));
      const after = await snapshot(client);
      if (after.identity_fingerprint !== before.identity_fingerprint || after.catalog_fingerprint !== contract.after_catalog_sha256) throw new Error("postcondition");
      await client.query("COMMIT");
      process.stdout.write(JSON.stringify({before,after})+"\n");
    } else {
      await client.query("BEGIN TRANSACTION READ ONLY");
      await client.query("SET LOCAL statement_timeout='10000ms'");
      if (action === "recover") {
        const locked = (await client.query("SELECT pg_try_advisory_xact_lock(hashtextextended('phone11-channel-meetings-live-delta-v1',0)) locked")).rows[0]?.locked;
        if (locked !== true) throw new Error("advisory_lock");
      }
      const before = await snapshot(client);
      await client.query("ROLLBACK");
      process.stdout.write(JSON.stringify({before})+"\n");
    }
  } catch (_error) {
    try { if (client) await client.query("ROLLBACK"); } catch (_ignored) {}
    process.exitCode=1;
  } finally { client?.release(); await pool.end().catch(()=>undefined); }
})();
'''


def database_command(container_id: str, action: str, contract: str) -> list[str]:
    return [
        "/usr/bin/docker", "exec", "--interactive", "--workdir", "/app",
        container_id, "node", "-e", NODE_PROGRAM, action, contract,
    ]


def run_with_input(command: Sequence[str], payload: bytes, *, timeout: int) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        command,
        input=payload,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        timeout=timeout,
        check=False,
    )


def run_database(manifest: Mapping[str, Any], action: str, sql: bytes = b"") -> Mapping[str, Any]:
    contract = canonical_bytes({
        "database_identity_sha256": manifest["database_identity_sha256"],
        "before_catalog_sha256": manifest["before_catalog_sha256"],
        "after_catalog_sha256": manifest["after_catalog_sha256"],
        "sql_sha256": manifest["sql_sha256"],
    }).decode("utf-8")
    try:
        container_id = inspect_target(manifest["target"], manifest["release"])
        result = run_with_input(database_command(container_id, action, contract), sql, timeout=45)
        guarded(result.returncode == 0 and 0 < len(result.stdout) <= MAX_OUTPUT_BYTES, "database")
        return strict_json(result.stdout, "database")
    except MigrationError:
        raise
    except (OSError, subprocess.TimeoutExpired) as error:
        raise MigrationError("database") from error


def collect_inventory(
    sql: bytes,
    container_id: str,
    container_name: str,
    container_port: int,
    host_port: int,
) -> Mapping[str, Any]:
    target, release = inventory_target(container_id, container_name, container_port, host_port)
    provisional = {
        "target": target,
        "release": release,
        "database_identity_sha256": "0" * 64,
        "before_catalog_sha256": "0" * 64,
        "after_catalog_sha256": "0" * 64,
        "sql_sha256": sha256_bytes(sql),
    }
    snapshot = run_database(provisional, "snapshot")
    before = snapshot.get("before")
    guarded(
        isinstance(before, Mapping)
        and is_sha256(before.get("identity_fingerprint"))
        and is_sha256(before.get("catalog_fingerprint")),
        "inventory",
    )
    return {
        "schema": INVENTORY_SCHEMA,
        "created_at_unix": int(time.time()),
        "target": target,
        "release": release,
        "database_identity_sha256": before["identity_fingerprint"],
        "before_catalog_sha256": before["catalog_fingerprint"],
        "sql_sha256": sha256_bytes(sql),
    }


def assert_snapshot(document: Mapping[str, Any], manifest: Mapping[str, Any], expected: str) -> None:
    before = document.get("before")
    guarded(
        isinstance(before, Mapping)
        and before.get("identity_fingerprint") == manifest["database_identity_sha256"]
        and before.get("catalog_fingerprint") == manifest[expected],
        "precondition" if expected == "before_catalog_sha256" else "verification",
    )


def assert_applied(document: Mapping[str, Any], manifest: Mapping[str, Any]) -> str:
    before, after = document.get("before"), document.get("after")
    guarded(
        isinstance(before, Mapping)
        and isinstance(after, Mapping)
        and before.get("identity_fingerprint") == manifest["database_identity_sha256"]
        and before.get("catalog_fingerprint") == manifest["before_catalog_sha256"]
        and after.get("identity_fingerprint") == manifest["database_identity_sha256"]
        and after.get("catalog_fingerprint") == manifest["after_catalog_sha256"],
        "verification",
    )
    return sha256_bytes(canonical_bytes({
        "database_identity_sha256": manifest["database_identity_sha256"],
        "before_catalog_sha256": manifest["before_catalog_sha256"],
        "after_catalog_sha256": manifest["after_catalog_sha256"],
        "sql_sha256": manifest["sql_sha256"],
    }))


def receipt_base(
    manifest: Mapping[str, Any], manifest_sha256: str,
    backup_sha256: str, restore_sha256: str,
) -> dict[str, Any]:
    return {
        "schema": RECEIPT_SCHEMA,
        "manifest_sha256": manifest_sha256,
        "sql_sha256": manifest["sql_sha256"],
        "database_identity_sha256": manifest["database_identity_sha256"],
        "before_catalog_sha256": manifest["before_catalog_sha256"],
        "after_catalog_sha256": manifest["after_catalog_sha256"],
        "container_id": manifest["target"]["container_id"],
        "image": manifest["target"]["image"],
        "source_sha": manifest["release"]["source_sha"],
        "bundle_sha256": manifest["release"]["bundle_sha256"],
        "lock_sha256": manifest["release"]["lock_sha256"],
        "backup_proof_sha256": backup_sha256,
        "restore_proof_sha256": restore_sha256,
    }


def receipt_document(base: Mapping[str, Any], status: str, verification_sha256: str | None = None) -> dict[str, Any]:
    guarded(status in {"intent", "applied", "not_applied"}, "receipt")
    value = dict(base)
    value["status"] = status
    if status == "applied":
        guarded(is_sha256(verification_sha256), "receipt")
        value["verification_sha256"] = verification_sha256
    return value


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


def reserve_receipt(path: Path, base: Mapping[str, Any], *, uid: int = 0, gid: int = 0) -> Mapping[str, Any]:
    intent = receipt_document(base, "intent")
    write_receipt(path, intent, uid=uid, gid=gid)
    return intent


def read_receipt(path: Path, base: Mapping[str, Any], *, uid: int = 0, gid: int = 0) -> Mapping[str, Any]:
    value = strict_json(secure_read(path, uid=uid, gid=gid), "receipt")
    guarded(all(value.get(key) == item for key, item in base.items()), "receipt")
    status = value.get("status")
    guarded(status in {"intent", "applied", "not_applied"}, "receipt")
    keys = set(base) | {"status"}
    if status == "applied":
        keys.add("verification_sha256")
        guarded(is_sha256(value.get("verification_sha256")), "receipt")
    guarded(set(value) == keys, "receipt")
    return value


def assess_recovery(document: Mapping[str, Any], manifest: Mapping[str, Any]) -> tuple[str, str | None]:
    current = document.get("before")
    guarded(
        isinstance(current, Mapping)
        and current.get("identity_fingerprint") == manifest["database_identity_sha256"],
        "recovery",
    )
    catalog = current.get("catalog_fingerprint")
    if catalog == manifest["before_catalog_sha256"]:
        return "not_applied", None
    guarded(catalog == manifest["after_catalog_sha256"], "recovery")
    return "applied", assert_applied({
        "before": {
            "identity_fingerprint": manifest["database_identity_sha256"],
            "catalog_fingerprint": manifest["before_catalog_sha256"],
        },
        "after": current,
    }, manifest)


def operator_lock(path: Path = LOCK_PATH):
    class Lock:
        descriptor: int | None = None

        def __enter__(self) -> None:
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
            try:
                fcntl.flock(self.descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise MigrationError("lock") from error

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
    modes.add_argument("--inventory", action="store_true")
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--sql", type=Path, required=True)
    parser.add_argument("--backup-proof", type=Path)
    parser.add_argument("--restore-proof", type=Path)
    parser.add_argument("--receipt", type=Path)
    parser.add_argument("--container-id")
    parser.add_argument("--container-name")
    parser.add_argument("--container-port", type=int)
    parser.add_argument("--host-port", type=int)
    return parser.parse_args(argv)


def run(arguments: argparse.Namespace) -> int:
    try:
        guarded(os.geteuid() == 0, "root")
        if getattr(arguments, "inventory", False):
            guarded(
                arguments.manifest is None
                and arguments.backup_proof is None
                and arguments.restore_proof is None
                and arguments.receipt is None
                and isinstance(arguments.container_id, str)
                and isinstance(arguments.container_name, str)
                and isinstance(arguments.container_port, int)
                and isinstance(arguments.host_port, int),
                "arguments",
            )
            sql = secure_read(arguments.sql)
            with operator_lock():
                print(canonical_bytes(collect_inventory(
                    sql,
                    arguments.container_id,
                    arguments.container_name,
                    arguments.container_port,
                    arguments.host_port,
                )).decode("utf-8"))
            return 0
        guarded(
            isinstance(arguments.manifest, Path)
            and isinstance(arguments.backup_proof, Path)
            and isinstance(arguments.restore_proof, Path)
            and all(getattr(arguments, key, None) is None for key in (
                "container_id", "container_name", "container_port", "host_port",
            )),
            "arguments",
        )
        manifest, manifest_sha256 = read_manifest(arguments.manifest)
        sql = secure_read(arguments.sql)
        guarded(sha256_bytes(sql) == manifest["sql_sha256"], "artifact")
        backup_sha256, restore_sha256 = read_proofs(
            arguments.backup_proof,
            arguments.restore_proof,
            manifest,
            manifest_sha256,
            require_fresh=not arguments.recover,
        )
        base = receipt_base(manifest, manifest_sha256, backup_sha256, restore_sha256)
        with operator_lock():
            if arguments.prepare:
                guarded(arguments.receipt is None, "arguments")
                assert_snapshot(run_database(manifest, "snapshot"), manifest, "before_catalog_sha256")
                print("channel_meetings=PREPARE_READY apply=NOT_RUN")
                return 0
            guarded(arguments.receipt == RECEIPT_PATH, "arguments")
            if arguments.recover:
                existing = read_receipt(arguments.receipt, base)
                status, verification_sha256 = assess_recovery(run_database(manifest, "recover"), manifest)
                if existing.get("status") == "intent":
                    replacement = receipt_document(base, status, verification_sha256)
                    write_receipt(arguments.receipt, replacement, expected=existing)
                    print("channel_meetings=RECOVERED status=" + status.upper())
                    return 0
                guarded(existing.get("status") == status, "recovery")
                if status == "applied":
                    guarded(existing.get("verification_sha256") == verification_sha256, "recovery")
                print("channel_meetings=RECOVERY_VALID status=" + status.upper())
                return 0
            # Refuse a stale/wrong database before creating an intent.  The
            # apply transaction repeats this exact check after acquiring its
            # advisory lock, so no mutation can race this read-only preflight.
            assert_snapshot(run_database(manifest, "snapshot"), manifest, "before_catalog_sha256")
            intent = reserve_receipt(arguments.receipt, base)
            verification_sha256 = assert_applied(run_database(manifest, "apply", sql), manifest)
            write_receipt(
                arguments.receipt,
                receipt_document(base, "applied", verification_sha256),
                expected=intent,
            )
            print("channel_meetings=APPLIED receipt=WRITTEN")
            return 0
    except MigrationError as error:
        print("channel_meetings=BLOCKED stage=" + error.stage)
        return 1
    except (OSError, KeyboardInterrupt):
        print("channel_meetings=BLOCKED stage=operator")
        return 1


if __name__ == "__main__":
    raise SystemExit(run(parse_args()))
