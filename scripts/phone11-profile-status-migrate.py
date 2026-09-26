#!/usr/bin/env python3
"""Guarded Phone11 profile-status schema migration operator.

The operator has no baked-in deployment pins.  A root-owned manifest must bind
one immutable API container, its release labels, the exact SQL bytes, and the
database identity and before/after catalog fingerprints established by a fresh
backup and isolated restore rehearsal.  No application rows are read or
printed.
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import select
import stat
import subprocess
import tempfile
import time
from typing import Any, Mapping, Sequence


MANIFEST_SCHEMA = "phone11.profile-status-migration-manifest/v1"
INVENTORY_SCHEMA = "phone11.profile-status-migration-inventory/v1"
BACKUP_PROOF_SCHEMA = "phone11.profile-status-backup-proof/v1"
RESTORE_PROOF_SCHEMA = "phone11.profile-status-restore-proof/v1"
RECEIPT_SCHEMA = "phone11.profile-status-migration-journal/v1"
LOCK_PATH = Path("/run/lock/phone11-profile-status-migrate.lock")
# The first attempt's intent is preserved for audit. Its superuser-owned
# rehearsal fingerprint could not match the live API role's table ownership,
# so use a separate journal for the corrected role-matched proof.
RECEIPT_PATH = Path("/var/lib/phone11-profile-status/receipt-role-rehearsal-v2.json")
FAILED_V1_RECEIPT = Path("/var/lib/phone11-profile-status/receipt.json")
BACKUP_ARCHIVE_PATH = Path("/opt/phone11ai/status-only-release-20260926/migration/backup.dump")
FAILED_V1_ARCHIVE = BACKUP_ARCHIVE_PATH.parent.parent / "failed-status-apply-v1"
PENDING_CLEANUP_DIR = BACKUP_ARCHIVE_PATH.parent / "cleanup-pending"
FAILED_V1_PINS = {
    "receipt.json": "ac3388d3cde9c52fc7d56e18bc605e33dcc154b7596700a75dcca94fba6e4c00",
    "manifest.json": "861ee275a8f7f370f6f589f3fad3946339294bce3640e20877893c192fa84c2b",
    "backup-proof.json": "30fb1310a14267b6c55faf1925c0f185e037a5000ac98f4ac6861698d13b999a",
    "restore-proof.json": "77df2d521d7c0cc6141d863031d1af94421e03332b973299174366202b09975f",
    "backup.dump": "20b699a348a2491c46149b0307917b646110956bec172079d6ea03d9c6ab956c",
    "phone11-profile-status-migrate.py": "f6b2d09d00f77c6c59d943ba5507b994da89654c9a8034a76f9aa2df2cc41e67",
    "phone11-profile-status-restore-proof.py": "4c577cff6b1d4ee1de426af9c037a64bd2cf832d5b3050b2747a8d1dd0925d0a",
}
FAILED_V1_IDENTITY = "4a7172827511ecb9430342de97d66a94b704c67d5d705147e3d42febb6c28fbe"
FAILED_V1_BEFORE = "b943cf0156fba54bcdd4260fd8be7eda684d1fe1b957702234fc65681185236d"
FAILED_V1_AFTER = "bfe1505255aeb922384969b4f586f7136bb0ac83585863f66ff5d849079315e9"
FAILED_V1_SQL = "92612ccd3c216cd46ac000e51c146bfdaa06117dea12211d64b70fe20b87bcc8"
FAILED_V1_API_CONTAINER = "bd3b5acf2647d239b5d5298c23a0b1bf60699379b25e4e8023b67e27fd6a6195"
FAILED_V1_API_ROLE = "phone11ai"
MAX_ARTIFACT_BYTES = 512 * 1024
MAX_BACKUP_BYTES = 1024 * 1024 * 1024 * 1024
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


def verify_backup_archive(proof_path: Path, proof_sha256: str,
                          *, archive_path: Path = BACKUP_ARCHIVE_PATH,
                          uid: int = 0, gid: int = 0) -> str:
    """Keep the proved recovery archive present and byte-identical at action time."""
    proof_raw = secure_read(proof_path, uid=uid, gid=gid)
    guarded(sha256_bytes(proof_raw) == proof_sha256, "backup_proof_changed")
    proof = strict_json(proof_raw, "backup_proof")
    expected = proof.get("backup_sha256")
    guarded(is_sha256(expected), "backup_proof")
    descriptor: int | None = None
    try:
        before = archive_path.lstat()
        guarded(stat.S_ISREG(before.st_mode) and not stat.S_ISLNK(before.st_mode)
                and before.st_uid == uid and before.st_gid == gid
                and stat.S_IMODE(before.st_mode) == 0o600 and before.st_nlink == 1
                and 5 < before.st_size < MAX_BACKUP_BYTES, "backup_archive")
        descriptor = os.open(archive_path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        opened = os.fstat(descriptor)
        guarded((opened.st_dev, opened.st_ino, opened.st_size) ==
                (before.st_dev, before.st_ino, before.st_size), "backup_archive")
        digest = hashlib.sha256()
        first = True
        while chunk := os.read(descriptor, 1024 * 1024):
            if first:
                guarded(chunk.startswith(b"PGDMP"), "backup_archive")
                first = False
            digest.update(chunk)
        after = os.fstat(descriptor)
        guarded((after.st_size, after.st_mtime_ns) ==
                (before.st_size, before.st_mtime_ns), "backup_archive")
        retained = archive_path.lstat()
        guarded((retained.st_dev, retained.st_ino, retained.st_size, retained.st_mtime_ns) ==
                (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns),
                "backup_archive")
        guarded(digest.hexdigest() == expected, "backup_archive")
        return expected
    except MigrationError:
        raise
    except OSError as error:
        raise MigrationError("backup_archive") from error
    finally:
        if descriptor is not None:
            os.close(descriptor)


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
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object") return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  return JSON.stringify(value);
}
function sha(value) { return crypto.createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : canonical(value)).digest("hex"); }
function firstEnv(...keys) { for (const key of keys) { const value = process.env[key]; if (value) return value; } return undefined; }
function sslConfig(connectionString) {
  const mode = firstEnv("PG_SSL", "DB_SSL", "POSTGRES_SSL", "DATABASE_SSL")?.toLowerCase();
  if (mode === "false" || mode === "0" || mode === "disable" || connectionString?.includes("sslmode=disable")) return false;
  return {rejectUnauthorized:firstEnv("PG_SSL_REJECT_UNAUTHORIZED", "DB_SSL_REJECT_UNAUTHORIZED") === "true"};
}
function config() {
  // Match the profile router's server/pbx/db.ts buildPgConfig, not server/db.ts.
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
async function identity(client) {
  return (await client.query("SELECT current_database() database,current_schema() schema,current_setting('server_version_num') server_version_num,(SELECT oid::text FROM pg_database WHERE datname=current_database()) database_oid")).rows[0];
}
async function catalog(client) {
  // pg_dump omits explicit owner-only ACLs because they equal built-in defaults.
  // Fingerprint effective grants rather than NULL-versus-explicit storage, and
  // resolve role OIDs so a faithful restore in a fresh cluster compares equal.
  const relations = (await client.query(`SELECT n.nspname schema,c.relname name,c.relkind kind,
    pg_get_userbyid(c.relowner) owner_name,
    COALESCE((SELECT jsonb_agg(acl_entry.entry ORDER BY acl_entry.entry)
      FROM (SELECT jsonb_build_array(
        CASE WHEN x.grantee=0 THEN jsonb_build_array('public')
             WHEN grantee.rolname IS NOT NULL THEN jsonb_build_array('role',grantee.rolname)
             ELSE jsonb_build_array('oid',x.grantee::text) END,
        CASE WHEN grantor.rolname IS NOT NULL THEN jsonb_build_array('role',grantor.rolname)
             ELSE jsonb_build_array('oid',x.grantor::text) END,
        x.privilege_type,x.is_grantable) entry
        FROM aclexplode(COALESCE(c.relacl,acldefault(
          (CASE WHEN c.relkind='S' THEN 's' ELSE 'r' END)::"char",c.relowner))) x
        LEFT JOIN pg_roles grantee ON grantee.oid=x.grantee
        LEFT JOIN pg_roles grantor ON grantor.oid=x.grantor) acl_entry),'[]'::jsonb) acl,
    c.relrowsecurity row_security,c.relforcerowsecurity force_row_security
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')
    ORDER BY n.nspname,c.relname`)).rows;
  const columns = (await client.query("SELECT n.nspname schema,c.relname table_name,a.attname name,a.attacl::text acl,pg_catalog.format_type(a.atttypid,a.atttypmod) type,a.attnotnull not_null,a.attidentity identity,a.attgenerated generated,pg_get_expr(d.adbin,d.adrelid,true) default_expression FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped ORDER BY n.nspname,c.relname,a.attnum")).rows;
  const constraints = (await client.query("SELECT n.nspname schema,c.relname table_name,con.conname name,con.contype type,con.convalidated validated,pg_get_constraintdef(con.oid,true) definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY n.nspname,c.relname,con.conname")).rows;
  const indexes = (await client.query("SELECT ns.nspname schema,t.relname table_name,i.relname name,pg_get_indexdef(i.oid) definition FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_class t ON t.oid=x.indrelid JOIN pg_namespace ns ON ns.oid=t.relnamespace WHERE ns.nspname='public' ORDER BY ns.nspname,t.relname,i.relname")).rows;
  const triggers = (await client.query("SELECT n.nspname schema,c.relname table_name,t.tgname name,pg_get_triggerdef(t.oid,true) definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY n.nspname,c.relname,t.tgname")).rows;
  const functions = (await client.query("SELECT n.nspname schema,p.proname name,p.prokind kind,pg_get_function_identity_arguments(p.oid) arguments,pg_get_function_result(p.oid) result,l.lanname language,p.provolatile volatility,p.prosecdef security_definer,CASE WHEN p.prokind IN ('f','p') THEN pg_get_functiondef(p.oid) ELSE NULL END definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname='public' ORDER BY n.nspname,p.proname,arguments")).rows;
  const policies = (await client.query("SELECT n.nspname schema,c.relname table_name,p.polname name,p.polcmd command,p.polpermissive permissive,COALESCE((SELECT jsonb_agg(pol_role.entry ORDER BY pol_role.entry) FROM (SELECT CASE WHEN role_oid=0 THEN jsonb_build_array('public') WHEN r.rolname IS NOT NULL THEN jsonb_build_array('role',r.rolname) ELSE jsonb_build_array('oid',role_oid::text) END entry FROM unnest(p.polroles) role_oid LEFT JOIN pg_roles r ON r.oid=role_oid) pol_role),'[]'::jsonb) roles,pg_get_expr(p.polqual,p.polrelid,true) using_expression,pg_get_expr(p.polwithcheck,p.polrelid,true) check_expression FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY n.nspname,c.relname,p.polname")).rows;
  const defaultAcl = (await client.query("SELECT COALESCE(n.nspname,'') schema,pg_get_userbyid(d.defaclrole) role_name,d.defaclobjtype object_type,d.defaclacl::text acl FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace ORDER BY schema,role_name,object_type,acl")).rows;
  return {relations,columns,constraints,indexes,triggers,functions,policies,defaultAcl};
}
async function assertStatusTablesSafe(client) {
  const rows = (await client.query("SELECT c.relname name,c.relkind kind,c.relrowsecurity row_security,c.relforcerowsecurity force_row_security,EXISTS (SELECT 1 FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) acl WHERE acl.grantee<>c.relowner) non_owner_grant,EXISTS (SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) acl WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped AND acl.grantee<>c.relowner) non_owner_column_grant,EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid) has_policy FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('phone11_workspace_profile_status','phone11_workspace_profile_status_settings') ORDER BY c.relname")).rows;
  if (rows.length !== 2 || rows.some(row => row.kind !== 'r' || row.row_security || row.force_row_security || row.non_owner_grant || row.non_owner_column_grant || row.has_policy)) throw new Error('status_acl');
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
  if (!["snapshot","recover","apply","rehearsal","details","retry_guard"].includes(action)) throw new Error("action");
  const pool = new pg.Pool(config()); let client;
  try {
    client = await pool.connect();
    if (action === "rehearsal") {
      const role = contract.rehearsal_role;
      if (typeof role !== "string" || !/^[A-Za-z_][A-Za-z_0-9]{0,62}$/.test(role)) throw new Error("rehearsal_role");
      await client.query('SET ROLE "' + role + '"');
    }
    if (action === "apply" || action === "rehearsal") {
      const sql = fs.readFileSync(0);
      if (sha(sql) !== contract.sql_sha256) throw new Error("artifact");
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout='2000ms'");
      await client.query("SET LOCAL statement_timeout='30000ms'");
      const locked = (await client.query("SELECT pg_try_advisory_xact_lock(hashtextextended('phone11-profile-status-live-delta-v1',0)) locked")).rows[0]?.locked;
      if (locked !== true) throw new Error("advisory_lock");
      const before = await snapshot(client);
      if ((action === "apply" && before.identity_fingerprint !== contract.database_identity_sha256) || before.catalog_fingerprint !== contract.before_catalog_sha256) throw new Error("precondition");
      if (action === "rehearsal" && (await identity(client)).server_version_num !== "160013") throw new Error("postgres_version");
      await client.query(migrationBody(sql.toString("utf8")));
      await assertStatusTablesSafe(client);
      const after = await snapshot(client);
      if (after.identity_fingerprint !== before.identity_fingerprint ||
          (action === "apply" && after.catalog_fingerprint !== contract.after_catalog_sha256) ||
          after.catalog_fingerprint === before.catalog_fingerprint) throw new Error("postcondition");
      await client.query("COMMIT");
      process.stdout.write(JSON.stringify({before,after})+"\n");
    } else {
      await client.query("BEGIN TRANSACTION READ ONLY");
      await client.query("SET LOCAL statement_timeout='10000ms'");
      if (action === "recover" || action === "retry_guard") {
        const locked = (await client.query("SELECT pg_try_advisory_xact_lock(hashtextextended('phone11-profile-status-live-delta-v1',0)) locked")).rows[0]?.locked;
        if (locked !== true) throw new Error("advisory_lock");
      }
      const before = await snapshot(client);
      if (action === "retry_guard") {
        const currentRole = (await client.query("SELECT current_user AS role_name,pg_get_userbyid(datdba) AS database_owner FROM pg_database WHERE datname=current_database()")).rows[0];
        const tables = (await client.query("SELECT to_regclass('public.phone11_workspace_profile_status') status_table,to_regclass('public.phone11_workspace_profile_status_settings') settings_table")).rows[0];
        if (before.identity_fingerprint !== contract.database_identity_sha256 ||
            before.catalog_fingerprint !== contract.before_catalog_sha256 ||
            currentRole.role_name !== contract.current_user ||
            currentRole.database_owner !== contract.database_owner ||
            tables.status_table !== null || tables.settings_table !== null) throw new Error("retry_precondition");
        process.stdout.write(JSON.stringify({retry_guard:"held",before})+"\n");
        await new Promise(resolve => { process.stdin.once("end",resolve); process.stdin.resume(); });
        await client.query("ROLLBACK");
        return;
      }
      const details = action === "details" ? {
        database:(await identity(client)).database,
        server_version_num:(await identity(client)).server_version_num,
        current_user:(await client.query("SELECT current_user")).rows[0].current_user,
        database_owner:(await client.query("SELECT pg_get_userbyid(datdba) owner FROM pg_database WHERE datname=current_database()")).rows[0].owner,
        roles:(await client.query("SELECT rolname FROM pg_roles WHERE left(rolname,3)<>'pg_' ORDER BY rolname")).rows.map(row=>row.rolname),
      } : undefined;
      await client.query("ROLLBACK");
      process.stdout.write(JSON.stringify({before,...(details ? {details} : {})})+"\n");
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
    guarded(status in {"intent", "applied"}, "receipt")
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
    guarded(status in {"intent", "applied"}, "receipt")
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
        # The caller may have timed out while docker exec remains alive but has
        # not yet reached BEGIN or the advisory lock.  A pre-catalog snapshot
        # therefore cannot prove rollback and must never make retry eligible.
        return "pending", None
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


def failed_v1_file(name: str, *, archived: bool) -> Path:
    guarded(name in FAILED_V1_PINS and name != "receipt.json", "failed_v1")
    source = BACKUP_ARCHIVE_PATH.parent / name
    destination = FAILED_V1_ARCHIVE / name
    source_exists = os.path.lexists(source)
    destination_exists = os.path.lexists(destination)
    guarded(not (source_exists and destination_exists), "failed_v1")
    guarded(destination_exists if archived else source_exists or destination_exists, "failed_v1")
    path = destination if destination_exists else source
    guarded(sha256_bytes(secure_read(path)) == FAILED_V1_PINS[name], "failed_v1")
    return path


def failed_v1_evidence(*, archived: bool) -> Mapping[str, Any]:
    guarded(sha256_bytes(secure_read(FAILED_V1_RECEIPT)) == FAILED_V1_PINS["receipt.json"], "failed_v1")
    files = {name: failed_v1_file(name, archived=archived)
             for name in FAILED_V1_PINS if name != "receipt.json"}
    manifest, manifest_sha = read_manifest(files["manifest.json"])
    guarded(manifest_sha == FAILED_V1_PINS["manifest.json"]
            and manifest["target"]["container_id"] == FAILED_V1_API_CONTAINER
            and manifest["database_identity_sha256"] == FAILED_V1_IDENTITY
            and manifest["before_catalog_sha256"] == FAILED_V1_BEFORE
            and manifest["after_catalog_sha256"] == FAILED_V1_AFTER
            and manifest["sql_sha256"] == FAILED_V1_SQL, "failed_v1")
    backup_sha, restore_sha = read_proofs(files["backup-proof.json"],
                                           files["restore-proof.json"],
                                           manifest, manifest_sha, require_fresh=False)
    guarded(backup_sha == FAILED_V1_PINS["backup-proof.json"]
            and restore_sha == FAILED_V1_PINS["restore-proof.json"], "failed_v1")
    guarded(verify_backup_archive(files["backup-proof.json"], backup_sha,
                                  archive_path=files["backup.dump"])
            == FAILED_V1_PINS["backup.dump"], "failed_v1")
    old_base = receipt_base(manifest, manifest_sha, backup_sha, restore_sha)
    guarded(read_receipt(FAILED_V1_RECEIPT, old_base)["status"] == "intent", "failed_v1")
    return manifest


def no_old_status_worker(container_id: str, *, expected_holders: int = 0) -> None:
    try:
        result = subprocess.run(
            ["/usr/bin/docker", "top", container_id, "-eo", "pid,args"],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, timeout=15, check=False,
        )
        guarded(result.returncode == 0 and len(result.stdout) <= 2 * 1024 * 1024, "old_worker")
        lines = result.stdout.decode("utf-8").splitlines()
        guarded(len(lines) >= 1 and "PID" in lines[0].upper(), "old_worker")
        # docker top may wrap or truncate the long `node -e` program. Count
        # the short, unambiguous exec prefix rather than inspecting SQL text.
        workers = [line for line in lines[1:] if re.search(r"(?:^|[\s/])node\s+-e(?:\s|$)", line)]
        guarded(len(workers) == expected_holders, "old_worker")
    except MigrationError:
        raise
    except (OSError, subprocess.TimeoutExpired, UnicodeDecodeError) as error:
        raise MigrationError("old_worker") from error


@contextmanager
def held_retry_guard(manifest: Mapping[str, Any]):
    """Hold the old transaction advisory key while archiving or reserving v2."""
    guarded(manifest["target"]["container_id"] == FAILED_V1_API_CONTAINER, "retry_guard")
    guarded(inspect_target(manifest["target"], manifest["release"])
            == FAILED_V1_API_CONTAINER, "retry_guard")
    contract = canonical_bytes({
        "database_identity_sha256": FAILED_V1_IDENTITY,
        "before_catalog_sha256": FAILED_V1_BEFORE,
        "current_user": FAILED_V1_API_ROLE,
        "database_owner": FAILED_V1_API_ROLE,
    }).decode("utf-8")
    process: subprocess.Popen[bytes] | None = None
    try:
        process = subprocess.Popen(
            database_command(FAILED_V1_API_CONTAINER, "retry_guard", contract),
            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        guarded(process.stdin is not None and process.stdout is not None, "retry_guard")
        deadline = time.monotonic() + 20
        response = bytearray()
        while b"\n" not in response and time.monotonic() < deadline:
            ready, _, _ = select.select([process.stdout], [], [], max(0, deadline - time.monotonic()))
            guarded(bool(ready), "retry_guard")
            chunk = os.read(process.stdout.fileno(), 4096)
            guarded(bool(chunk) and len(response) + len(chunk) <= MAX_OUTPUT_BYTES, "retry_guard")
            response.extend(chunk)
        guarded(response.count(b"\n") == 1, "retry_guard")
        result = strict_json(bytes(response).strip(), "retry_guard")
        guarded(result.get("retry_guard") == "held"
                and result.get("before") == {
                    "identity_fingerprint": FAILED_V1_IDENTITY,
                    "catalog_fingerprint": FAILED_V1_BEFORE,
                }
                and process.poll() is None, "retry_guard")
        yield process
        guarded(process.poll() is None, "retry_guard")
    except MigrationError:
        raise
    except (OSError, subprocess.TimeoutExpired) as error:
        raise MigrationError("retry_guard") from error
    finally:
        if process is not None:
            if process.stdin is not None and not process.stdin.closed:
                process.stdin.close()
            try:
                exit_code = process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
                raise MigrationError("retry_guard")
            if process.stdout is not None:
                process.stdout.close()
            guarded(exit_code == 0, "retry_guard")


def archive_failed_v1() -> None:
    guarded(os.geteuid() == 0 and not os.path.lexists(RECEIPT_PATH)
            and not os.path.lexists(PENDING_CLEANUP_DIR), "failed_v1")
    with operator_lock():
        old_manifest = failed_v1_evidence(archived=False)
        no_old_status_worker(FAILED_V1_API_CONTAINER)
        with held_retry_guard(old_manifest) as holder:
            no_old_status_worker(FAILED_V1_API_CONTAINER, expected_holders=1)
            failed_v1_evidence(archived=False)
            parent = FAILED_V1_ARCHIVE.parent.lstat()
            guarded(stat.S_ISDIR(parent.st_mode) and parent.st_uid == 0
                    and parent.st_gid == 0 and stat.S_IMODE(parent.st_mode) == 0o700,
                    "failed_v1")
            if not os.path.lexists(FAILED_V1_ARCHIVE):
                FAILED_V1_ARCHIVE.mkdir(mode=0o700)
            directory = FAILED_V1_ARCHIVE.lstat()
            guarded(stat.S_ISDIR(directory.st_mode) and directory.st_uid == 0
                    and directory.st_gid == 0 and stat.S_IMODE(directory.st_mode) == 0o700,
                    "failed_v1")
            for name in FAILED_V1_PINS:
                if name == "receipt.json":
                    continue
                source = BACKUP_ARCHIVE_PATH.parent / name
                destination = FAILED_V1_ARCHIVE / name
                if os.path.lexists(source):
                    guarded(not os.path.lexists(destination), "failed_v1")
                    os.replace(source, destination)
                    for directory_path in (source.parent, destination.parent):
                        descriptor = os.open(directory_path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
                        try:
                            os.fsync(descriptor)
                        finally:
                            os.close(descriptor)
                guarded(sha256_bytes(secure_read(destination)) == FAILED_V1_PINS[name], "failed_v1")
            guarded(holder.poll() is None, "retry_guard")
            failed_v1_evidence(archived=True)


def validate_v2_retry(manifest: Mapping[str, Any]) -> None:
    old = failed_v1_evidence(archived=True)
    guarded(manifest["target"] == old["target"]
            and manifest["release"] == old["release"]
            and manifest["database_identity_sha256"] == FAILED_V1_IDENTITY
            and manifest["before_catalog_sha256"] == FAILED_V1_BEFORE
            and manifest["sql_sha256"] == FAILED_V1_SQL
            and manifest["after_catalog_sha256"] != FAILED_V1_AFTER
            and not os.path.lexists(RECEIPT_PATH), "retry_precondition")


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--prepare", action="store_true")
    modes.add_argument("--apply", action="store_true")
    modes.add_argument("--recover", action="store_true")
    modes.add_argument("--inventory", action="store_true")
    modes.add_argument("--archive-failed-v1", action="store_true")
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
        if getattr(arguments, "archive_failed_v1", False):
            guarded(arguments.manifest is None and arguments.backup_proof is None
                    and arguments.restore_proof is None and arguments.receipt is None
                    and all(getattr(arguments, key, None) is None for key in (
                        "container_id", "container_name", "container_port", "host_port"))
                    and arguments.sql == BACKUP_ARCHIVE_PATH.parent / "profile-status-migration.sql"
                    and sha256_bytes(secure_read(arguments.sql)) == FAILED_V1_SQL,
                    "arguments")
            archive_failed_v1()
            print("profile_status=FAILED_V1_ARCHIVED apply=NOT_RUN")
            return 0
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
            guarded(not os.path.lexists(PENDING_CLEANUP_DIR), "cleanup_pending")
            verify_backup_archive(arguments.backup_proof, backup_sha256)
            if arguments.prepare:
                guarded(arguments.receipt is None, "arguments")
                validate_v2_retry(manifest)
                assert_snapshot(run_database(manifest, "snapshot"), manifest, "before_catalog_sha256")
                print("profile_status=PREPARE_READY apply=NOT_RUN")
                return 0
            guarded(arguments.receipt == RECEIPT_PATH, "arguments")
            if arguments.recover:
                existing = read_receipt(arguments.receipt, base)
                status, verification_sha256 = assess_recovery(run_database(manifest, "recover"), manifest)
                if existing.get("status") == "intent":
                    guarded(status == "applied", "settlement_pending")
                    replacement = receipt_document(base, "applied", verification_sha256)
                    write_receipt(arguments.receipt, replacement, expected=existing)
                    print("profile_status=RECOVERED status=APPLIED")
                    return 0
                guarded(existing.get("status") == status, "recovery")
                if status == "applied":
                    guarded(existing.get("verification_sha256") == verification_sha256, "recovery")
                print("profile_status=RECOVERY_VALID status=" + status.upper())
                return 0
            # Refuse a stale/wrong database before creating an intent.  The
            # apply transaction repeats this exact check after acquiring its
            # advisory lock, so no mutation can race this read-only preflight.
            validate_v2_retry(manifest)
            assert_snapshot(run_database(manifest, "snapshot"), manifest, "before_catalog_sha256")
            verify_backup_archive(arguments.backup_proof, backup_sha256)
            no_old_status_worker(FAILED_V1_API_CONTAINER)
            with held_retry_guard(manifest) as holder:
                no_old_status_worker(FAILED_V1_API_CONTAINER, expected_holders=1)
                validate_v2_retry(manifest)
                verify_backup_archive(arguments.backup_proof, backup_sha256)
                guarded(holder.poll() is None, "retry_guard")
                intent = reserve_receipt(arguments.receipt, base)
                guarded(holder.poll() is None, "retry_guard")
            # The pinned v1 operator checks its postgres-owned after hash
            # before COMMIT. This API's pinned current_user is phone11ai, so
            # a late v1 worker can only roll back after the holder releases.
            # The v2 apply repeats the before check under the same SQL lock.
            verification_sha256 = assert_applied(run_database(manifest, "apply", sql), manifest)
            verify_backup_archive(arguments.backup_proof, backup_sha256)
            write_receipt(
                arguments.receipt,
                receipt_document(base, "applied", verification_sha256),
                expected=intent,
            )
            print("profile_status=APPLIED receipt=WRITTEN")
            return 0
    except MigrationError as error:
        print("profile_status=BLOCKED stage=" + error.stage)
        return 1
    except (OSError, KeyboardInterrupt):
        print("profile_status=BLOCKED stage=operator")
        return 1


if __name__ == "__main__":
    raise SystemExit(run(parse_args()))
