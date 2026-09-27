#!/usr/bin/env python3
"""Backup and rehearse the invitation migration in a disposable, networkless clone.

Run only on the approved root host. This program has no live apply mode: its only
live database commands are read-only SELECT and pg_dump. It never prints Docker
environment, SQL output, email rows, or command stderr.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import select
import stat
import subprocess
import sys
import time
import uuid


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "server/invitations/migration.sql"
DOCKER = "/usr/bin/docker"
SHA = re.compile(r"[0-9a-f]{64}\Z")
GIT_SHA = re.compile(r"[0-9a-f]{40}\Z")
ROLE = re.compile(r"[a-z_][a-z_0-9]{0,62}\Z")
NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\Z")
SCHEMA = "phone11.invitation-clone-rehearsal/v1"
MAX_OUTPUT = 64 * 1024 * 1024
MAX_BACKUP = 1024 * 1024 * 1024 * 1024
PG_WRAPPER = (
    'if [ -n "${POSTGRES_PASSWORD:-}" ]; then '
    'PGPASSWORD="$POSTGRES_PASSWORD"; export PGPASSWORD; fi; '
    'PGOPTIONS="-c default_transaction_read_only=on -c lock_timeout=3000 -c statement_timeout=900000"; '
    'export PGOPTIONS; exec "$@"'
)

# Explicitly include ACLs and grants in the catalog proof. Object identifiers
# are omitted so the source and a fresh restore can be compared byte-for-byte.
CATALOG_SQL = r"""
SELECT jsonb_build_object(
 'schema_acl', (SELECT nspacl::text FROM pg_namespace WHERE nspname='public'),
 'relations', (SELECT coalesce(jsonb_agg(jsonb_build_array(c.relname,c.relkind,
   pg_get_userbyid(c.relowner),c.relacl::text,c.relrowsecurity,c.relforcerowsecurity)
   ORDER BY c.relname),'[]'::jsonb) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f') AND
   (NOT %(base)s OR (c.relname NOT LIKE 'phone11_workspace_invitation%%'
      AND c.relname<>'phone11_users_normalized_email_unique'))),
 'columns', (SELECT coalesce(jsonb_agg(jsonb_build_array(c.relname,a.attname,
   format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,
   a.attacl::text,pg_get_expr(d.adbin,d.adrelid,true)) ORDER BY c.relname,a.attnum),'[]'::jsonb)
   FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
   JOIN pg_namespace n ON n.oid=c.relnamespace
   LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
   WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped AND
   (NOT %(base)s OR (c.relname NOT LIKE 'phone11_workspace_invitation%%'
      AND c.relname<>'phone11_users_normalized_email_unique'))),
 'constraints', (SELECT coalesce(jsonb_agg(jsonb_build_array(c.relname,x.conname,x.contype,
   x.convalidated,pg_get_constraintdef(x.oid,true)) ORDER BY c.relname,x.conname),'[]'::jsonb)
   FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid
   JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND
   (NOT %(base)s OR c.relname NOT LIKE 'phone11_workspace_invitation%%')),
 'indexes', (SELECT coalesce(jsonb_agg(jsonb_build_array(t.relname,i.relname,
   pg_get_indexdef(i.oid),x.indisvalid,x.indisready) ORDER BY t.relname,i.relname),'[]'::jsonb)
   FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_class t ON t.oid=x.indrelid
   JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND
   (NOT %(base)s OR (t.relname NOT LIKE 'phone11_workspace_invitation%%'
      AND i.relname<>'phone11_users_normalized_email_unique'))),
 'triggers', (SELECT coalesce(jsonb_agg(jsonb_build_array(c.relname,t.tgname,
   t.tgenabled,pg_get_triggerdef(t.oid,true)) ORDER BY c.relname,t.tgname),'[]'::jsonb)
   FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
   JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
   AND NOT t.tgisinternal AND (NOT %(base)s OR c.relname NOT LIKE 'phone11_workspace_invitation%%')),
 'functions', (SELECT coalesce(jsonb_agg(jsonb_build_array(p.proname,
   pg_get_function_identity_arguments(p.oid),pg_get_userbyid(p.proowner),p.proacl::text,
   p.prosecdef,pg_get_functiondef(p.oid)) ORDER BY p.proname,
   pg_get_function_identity_arguments(p.oid)),'[]'::jsonb)
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prokind IN ('f','p')),
 'default_acl', (SELECT coalesce(jsonb_agg(jsonb_build_array(coalesce(n.nspname,''),
   pg_get_userbyid(d.defaclrole),d.defaclobjtype,d.defaclacl::text)
   ORDER BY coalesce(n.nspname,''),pg_get_userbyid(d.defaclrole),d.defaclobjtype),'[]'::jsonb)
   FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace)
)::text;
"""

PREFLIGHT_SQL = r"""
SELECT jsonb_build_object(
 'identity', jsonb_build_object('database',current_database(),'role',current_user,
   'schema',current_schema(),'version',current_setting('server_version_num')),
 'permissions', jsonb_build_object(
   'schema_create',has_schema_privilege('public','CREATE'),
   'users_owner',(SELECT pg_get_userbyid(c.relowner)=current_user FROM pg_class c
     WHERE c.oid=to_regclass('public.users')),
   'tenants_owner',(SELECT pg_get_userbyid(c.relowner)=current_user FROM pg_class c
     WHERE c.oid=to_regclass('public.tenants'))),
 'role_attributes',(SELECT jsonb_build_object(
   'superuser',r.rolsuper,'createdb',r.rolcreatedb,'createrole',r.rolcreaterole,
   'replication',r.rolreplication,'bypassrls',r.rolbypassrls,
   'inherit',r.rolinherit,'login',r.rolcanlogin,'connection_limit',r.rolconnlimit,
   'valid_until',r.rolvaliduntil IS NULL,
   'membership_count',(SELECT count(*) FROM pg_auth_members m WHERE m.member=r.oid))
   FROM pg_roles r WHERE r.rolname=current_user),
 'required', (SELECT coalesce(jsonb_object_agg(name,to_regclass('public.'||name) IS NOT NULL),'{}'::jsonb)
   FROM (VALUES ('users'),('tenants'),('tenant_memberships'),('phone11_auth_user'),
     ('phone11_auth_account'),('phone11_auth_identity'),('phone11_auth_session')) x(name)),
 'collisions', (SELECT coalesce(jsonb_object_agg(name,
   to_regclass('public.'||name) IS NOT NULL OR to_regtype('public.'||name) IS NOT NULL),'{}'::jsonb)
   FROM (VALUES ('phone11_users_normalized_email_unique'),
     ('phone11_workspace_invitations'),('phone11_workspace_invitations_pkey'),
     ('phone11_workspace_invitations_token_digest_key'),
     ('phone11_workspace_invitations_one_pending_email'),
     ('phone11_workspace_invitations_tenant_recent'),
     ('phone11_workspace_invitation_events'),('phone11_workspace_invitation_events_pkey'),
     ('phone11_workspace_invitation_events_tenant_recent')) x(name))
)::text;
"""

COUNT_SQL = r"""
WITH canonical AS (SELECT count(*) n FROM users WHERE email IS NOT NULL
  GROUP BY lower(trim(email)) HAVING count(*)>1),
auth AS (SELECT count(*) n FROM phone11_auth_user WHERE email IS NOT NULL
  GROUP BY lower(trim(email)) HAVING count(*)>1)
SELECT jsonb_build_object(
 'canonical_duplicate_groups',(SELECT count(*) FROM canonical),
 'canonical_duplicate_rows',(SELECT coalesce(sum(n),0) FROM canonical),
 'auth_duplicate_groups',(SELECT count(*) FROM auth),
 'active_bridge_email_mismatches',(SELECT count(*) FROM phone11_auth_identity i
   JOIN users u ON u.id=i.legacy_user_id JOIN phone11_auth_user a ON a.id=i.auth_user_id
   WHERE i.disabled_at IS NULL AND lower(trim(u.email)) IS DISTINCT FROM lower(trim(a.email)))
)::text;
"""

POST_SQL = r"""
SELECT jsonb_build_object(
 'invitations',to_regclass('public.phone11_workspace_invitations') IS NOT NULL,
 'events',to_regclass('public.phone11_workspace_invitation_events') IS NOT NULL,
 'column_count',(SELECT count(*) FROM information_schema.columns
   WHERE table_schema='public' AND table_name='phone11_workspace_invitations'
   AND column_name=ANY(ARRAY['id','tenant_id','email','role','issuer_user_id',
     'token_digest','expires_at','status','accepted_user_id','accepted_at','revoked_at',
     'delivery_status','delivery_error','provider_message_id','created_at','updated_at'])),
 'index_count',(SELECT count(*) FROM pg_index ix JOIN pg_class idx ON idx.oid=ix.indexrelid
   JOIN pg_class tbl ON tbl.oid=ix.indrelid JOIN pg_namespace ns ON ns.oid=tbl.relnamespace
   WHERE ns.nspname='public' AND ix.indisunique AND ix.indisvalid AND ix.indisready AND
   ((idx.relname='phone11_users_normalized_email_unique' AND tbl.relname='users'
     AND ix.indnkeyatts=1 AND ix.indnatts=1
     AND pg_get_indexdef(ix.indexrelid,1,true)='lower(TRIM(BOTH FROM email))'
     AND (pg_get_expr(ix.indpred,ix.indrelid)='(email IS NOT NULL)' OR ix.indpred IS NULL))
   OR (idx.relname='phone11_workspace_invitations_one_pending_email'
     AND tbl.relname='phone11_workspace_invitations' AND ix.indnkeyatts=2 AND ix.indnatts=2
     AND pg_get_indexdef(ix.indexrelid,1,true)='tenant_id'
     AND pg_get_indexdef(ix.indexrelid,2,true)='email'
     AND pg_get_expr(ix.indpred,ix.indrelid)='(status = ''pending''::text)')
   OR (idx.relname='phone11_workspace_invitations_token_digest_key'
     AND tbl.relname='phone11_workspace_invitations' AND ix.indnkeyatts=1 AND ix.indnatts=1
     AND pg_get_indexdef(ix.indexrelid,1,true)='token_digest' AND ix.indpred IS NULL)))
)::text;
"""


class Blocked(RuntimeError):
    pass


def need(condition: bool, stage: str) -> None:
    if not condition:
        raise Blocked(stage)


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def docker_env() -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if not k.startswith("DOCKER_")}
    env["DOCKER_HOST"] = "unix:///var/run/docker.sock"
    return env


def command(args: list[str], *, timeout: int = 60, limit: int = MAX_OUTPUT) -> bytes:
    result = subprocess.run(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, env=docker_env(), timeout=timeout)
    need(result.returncode == 0 and len(result.stdout) <= limit, "command")
    return result.stdout.strip()


def inspect(container_id: str) -> dict[str, object]:
    raw = command([DOCKER, "inspect", container_id], timeout=20)
    rows = json.loads(raw)
    need(isinstance(rows, list) and len(rows) == 1 and isinstance(rows[0], dict), "inspect")
    return rows[0]


def verify_source(args: argparse.Namespace) -> None:
    need(os.geteuid() == 0 and Path(DOCKER).is_file(), "root_host")
    for value in (args.api_id, args.pg_id, args.api_bundle_sha, args.sql_sha):
        need(bool(SHA.fullmatch(value)), "pin")
    for value in (args.api_image, args.pg_image):
        need(value.startswith("sha256:") and bool(SHA.fullmatch(value[7:])), "pin")
    need(bool(GIT_SHA.fullmatch(args.api_source_sha)) and bool(ROLE.fullmatch(args.role))
         and bool(ROLE.fullmatch(args.database)) and bool(NAME.fullmatch(args.api_name))
         and bool(NAME.fullmatch(args.pg_name))
         and re.fullmatch(r"[0-9]{5,6}", args.server_version_num) is not None, "pin")
    need(args.api_bundle_path.startswith("/app/") and ".." not in Path(args.api_bundle_path).parts,
         "bundle_path")
    need(256 <= args.clone_data_mib <= 32768, "clone_data_limit")
    api, pg = inspect(args.api_id), inspect(args.pg_id)
    need(api.get("Id") == args.api_id and api.get("Image") == args.api_image
         and api.get("Name") == "/" + args.api_name
         and api.get("State", {}).get("Running") is True, "api_identity")
    labels = api.get("Config", {}).get("Labels", {})
    need(labels.get("com.phone11.source-sha") == args.api_source_sha
         and labels.get("com.phone11.bundle-sha256") == args.api_bundle_sha,
         "api_release")
    need(pg.get("Id") == args.pg_id and pg.get("Image") == args.pg_image
         and pg.get("Name") == "/" + args.pg_name
         and pg.get("State", {}).get("Running") is True, "pg_identity")
    actual = command([DOCKER, "exec", args.api_id, "sha256sum", args.api_bundle_path], timeout=20)
    need(actual.split()[:1] == [args.api_bundle_sha.encode()], "api_bundle")


def pg_live(args: argparse.Namespace, tool: str, *tool_args: str, timeout: int = 60) -> bytes:
    # No password appears in argv, logs, receipts, or Docker inspect output.
    return command([DOCKER, "exec", args.pg_id, "sh", "-c", PG_WRAPPER, "--", tool,
                    *tool_args], timeout=timeout)


def live_json(args: argparse.Namespace, sql: str) -> dict[str, object]:
    raw = pg_live(args, "psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1",
                  "-h", "/var/run/postgresql", "-U", args.role, "-d", args.database,
                  "-c", "BEGIN TRANSACTION READ ONLY", "-c", "SET LOCAL statement_timeout = '30s'",
                  "-c", "SET LOCAL lock_timeout = '3s'", "-c", sql, "-c", "ROLLBACK")
    value = json.loads(raw)
    need(isinstance(value, dict), "database_json")
    return value


def preflight(document: dict[str, object], counts: dict[str, object] | None,
              *, role: str, database: str, version: str) -> None:
    identity = document.get("identity")
    need(isinstance(identity, dict) and identity == {
        "database": database, "role": role, "schema": "public", "version": version}, "db_identity")
    required, collisions = document.get("required"), document.get("collisions")
    need(isinstance(required, dict) and len(required) == 7
         and all(v is True for v in required.values()), "prerequisites")
    need(document.get("permissions") == {"schema_create": True,
         "users_owner": True, "tenants_owner": True}, "role_permissions")
    # The official postgres image creates POSTGRES_USER as its bootstrap
    # superuser. Refuse a live role whose authority differs from that clone.
    need(document.get("role_attributes") == {
        "superuser": True, "createdb": True, "createrole": True,
        "replication": True, "bypassrls": True, "inherit": True,
        "login": True, "connection_limit": -1, "valid_until": True,
        "membership_count": 0}, "role_attributes")
    need(isinstance(collisions, dict) and len(collisions) == 9
         and all(v is False for v in collisions.values()), "object_collision")
    if counts is None:
        return
    need(isinstance(counts, dict) and counts.get("canonical_duplicate_groups") == 0
         and counts.get("canonical_duplicate_rows") == 0, "canonical_duplicates")
    need(counts.get("auth_duplicate_groups") == 0
         and counts.get("active_bridge_email_mismatches") == 0, "auth_identity")


def private_directory(path: Path) -> None:
    need(path.is_absolute(), "private_directory")
    ancestor = path
    while True:
        need(not stat.S_ISLNK(ancestor.lstat().st_mode), "private_directory")
        if ancestor == ancestor.parent:
            break
        ancestor = ancestor.parent
    s = path.lstat()
    need(stat.S_ISDIR(s.st_mode) and s.st_uid == 0 and s.st_gid == 0
         and stat.S_IMODE(s.st_mode) == 0o700, "private_directory")


def digest_private_archive(path: Path) -> str:
    before = path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_uid == 0 and before.st_gid == 0
         and before.st_nlink == 1 and stat.S_IMODE(before.st_mode) == 0o600
         and 5 < before.st_size <= MAX_BACKUP, "backup_integrity")
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        opened = os.fstat(fd)
        need((opened.st_dev, opened.st_ino) == (before.st_dev, before.st_ino),
             "backup_integrity")
        digest = hashlib.sha256()
        first = True
        while chunk := os.read(fd, 1024 * 1024):
            if first:
                need(chunk.startswith(b"PGDMP"), "backup_integrity")
                first = False
            digest.update(chunk)
        after = os.fstat(fd)
        need((before.st_size, before.st_mtime_ns) == (after.st_size, after.st_mtime_ns),
             "backup_integrity")
        return digest.hexdigest()
    finally:
        os.close(fd)


def backup(args: argparse.Namespace, path: Path) -> str:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        process = subprocess.Popen(
            [DOCKER, "exec", args.pg_id, "sh", "-c", PG_WRAPPER, "--", "pg_dump",
             "--format=custom", "--no-password", "-h", "/var/run/postgresql",
             "-U", args.role, "-d", args.database],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            env=docker_env())
    except BaseException:
        os.close(fd)
        path.unlink(missing_ok=True)
        raise
    digest = hashlib.sha256()
    size = 0
    deadline = time.monotonic() + args.timeout
    try:
        with os.fdopen(fd, "wb", closefd=True) as output:
            assert process.stdout is not None
            while True:
                readable, _, _ = select.select([process.stdout], [], [],
                                               max(0, deadline - time.monotonic()))
                need(bool(readable), "backup_timeout")
                chunk = os.read(process.stdout.fileno(), 1024 * 1024)
                if not chunk:
                    break
                if size == 0:
                    need(chunk.startswith(b"PGDMP"), "archive_format")
                size += len(chunk)
                need(size <= MAX_BACKUP and time.monotonic() < deadline, "backup_limit")
                output.write(chunk)
                digest.update(chunk)
            output.flush()
            os.fsync(output.fileno())
        need(process.wait(timeout=max(1, deadline - time.monotonic())) == 0 and size > 5,
             "backup_failed")
        need(stat.S_IMODE(path.stat().st_mode) == 0o600, "backup_privacy")
        return digest.hexdigest()
    except BaseException:
        process.kill()
        process.wait(timeout=10)
        path.unlink(missing_ok=True)
        raise
    finally:
        if process.stdout is not None:
            process.stdout.close()


def clone_inspect(name: str, token: str) -> dict[str, object] | None:
    result = subprocess.run([DOCKER, "inspect", name], stdin=subprocess.DEVNULL,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            env=docker_env(), timeout=20)
    if result.returncode != 0:
        need(result.returncode == 1 and b"no such object" in result.stderr.lower(),
             "clone_inspect")
        return None
    rows = json.loads(result.stdout)
    need(isinstance(rows, list) and len(rows) == 1, "clone_inspect")
    item = rows[0]
    need(item.get("Name") == "/" + name and
         item.get("Config", {}).get("Labels", {}).get("phone11.invitation.clone-token") == token,
         "clone_identity")
    return item


def cleanup_clone(name: str, token: str) -> None:
    item = clone_inspect(name, token)
    if item is not None:
        command([DOCKER, "rm", "-f", "-v", item["Id"]], timeout=30)
        need(clone_inspect(name, token) is None, "clone_cleanup")


def clone_json(container_id: str, role: str, database: str, sql: str) -> dict[str, object]:
    raw = command([DOCKER, "exec", container_id, "psql", "-X", "-q", "-A", "-t",
                   "-v", "ON_ERROR_STOP=1", "-h", "/var/run/postgresql",
                   "-U", role, "-d", database, "-c", sql], timeout=120)
    value = json.loads(raw)
    need(isinstance(value, dict), "clone_json")
    return value


def catalog_hash(value: dict[str, object]) -> str:
    return sha(json.dumps(value, sort_keys=True, separators=(",", ":")).encode())


def validate_clone_isolation(item: dict[str, object], container_id: str,
                             image: str, archive: Path, migration: Path) -> None:
    need(item.get("Id") == container_id and item.get("Image") == image
         and item.get("State", {}).get("Running") is False, "clone_pin")
    host = item.get("HostConfig", {})
    mounts = item.get("Mounts", [])
    need(host.get("NetworkMode") == "none" and host.get("ReadonlyRootfs") is True
         and not host.get("PortBindings")
         and host.get("Memory") == 768 * 1024 * 1024
         and host.get("MemorySwap") == 768 * 1024 * 1024
         and host.get("NanoCpus") == 500_000_000
         and host.get("PidsLimit") == 128
         and set(host.get("Tmpfs", {})) == {
             "/var/lib/postgresql/data", "/var/run/postgresql", "/tmp"}
         and len(mounts) == 2
         and {m.get("Destination"): m.get("Source") for m in mounts
              if m.get("Type") == "bind" and m.get("RW") is False} == {
                  "/tmp/backup.dump": str(archive), "/tmp/migration.sql": str(migration)},
         "clone_isolation")


def restore_argv(container_id: str, role: str, database: str) -> list[str]:
    # Preserve source owners and grants. The pinned live role and the isolated
    # bootstrap role have identical superuser attributes; an unknown grantee
    # makes pg_restore fail closed before the migration is attempted.
    return [DOCKER, "exec", container_id, "pg_restore", "--single-transaction",
            "--exit-on-error", "-h", "/var/run/postgresql", "-U", role,
            "-d", database, "/tmp/backup.dump"]


def rehearse(args: argparse.Namespace, archive: Path, migration: Path,
             source_catalog: dict[str, object]) -> dict[str, object]:
    token = uuid.uuid4().hex
    name = "p11inv-" + token
    container_id = ""
    try:
        container_id = command([
            DOCKER, "create", "--name", name,
            "--label", "phone11.invitation.clone-token=" + token,
            "--network", "none", "--read-only",
            "--memory", "768m", "--memory-swap", "768m", "--cpus", "0.5",
            "--pids-limit", "128",
            "--tmpfs", f"/var/lib/postgresql/data:rw,nosuid,nodev,size={args.clone_data_mib}m",
            "--tmpfs", "/var/run/postgresql:rw,nosuid,nodev,size=16m",
            "--tmpfs", "/tmp:rw,nosuid,nodev,size=64m",
            "--mount", f"type=bind,source={archive},target=/tmp/backup.dump,readonly",
            "--mount", f"type=bind,source={migration},target=/tmp/migration.sql,readonly",
            "-e", "POSTGRES_USER=" + args.role, "-e", "POSTGRES_DB=" + args.database,
            "-e", "POSTGRES_HOST_AUTH_METHOD=trust", args.pg_image,
            "postgres", "-c", "listen_addresses=", "-c", "unix_socket_directories=/var/run/postgresql",
        ], timeout=40).decode()
        need(bool(SHA.fullmatch(container_id)), "clone_id")
        item = clone_inspect(name, token)
        need(item is not None, "clone_pin")
        validate_clone_isolation(item, container_id, args.pg_image, archive, migration)
        need(command([DOCKER, "start", container_id], timeout=40).decode() == container_id,
             "clone_start")
        ready = False
        for _ in range(30):
            result = subprocess.run([DOCKER, "exec", container_id, "pg_isready",
                                     "-h", "/var/run/postgresql", "-U", args.role],
                                    stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                    stderr=subprocess.DEVNULL, env=docker_env(), timeout=5)
            if result.returncode == 0:
                ready = True
                break
            time.sleep(1)
        need(ready, "clone_ready")
        command(restore_argv(container_id, args.role, args.database), timeout=args.timeout)
        restored = clone_json(container_id, args.role, args.database,
                              CATALOG_SQL % {"base": "false"})
        base_before = clone_json(container_id, args.role, args.database,
                                 CATALOG_SQL % {"base": "true"})
        source_hash = catalog_hash(source_catalog)
        before_hash = catalog_hash(restored)
        need(source_hash == before_hash, "restore_catalog_acl")
        pre = clone_json(container_id, args.role, args.database, PREFLIGHT_SQL)
        counts = clone_json(container_id, args.role, args.database, COUNT_SQL)
        preflight(pre, counts, role=args.role, database=args.database,
                  version=args.server_version_num)
        start = time.monotonic()
        command([DOCKER, "exec", container_id, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1",
                 "-h", "/var/run/postgresql", "-U", args.role, "-d", args.database,
                 "-f", "/tmp/migration.sql"], timeout=args.timeout, limit=1024)
        elapsed = round(time.monotonic() - start, 3)
        after = clone_json(container_id, args.role, args.database,
                           CATALOG_SQL % {"base": "false"})
        base_after = clone_json(container_id, args.role, args.database,
                                CATALOG_SQL % {"base": "true"})
        need(base_after == base_before, "base_catalog_unstable")
        post = clone_json(container_id, args.role, args.database, POST_SQL)
        need(post == {"invitations": True, "events": True,
                      "column_count": 16, "index_count": 3}, "post_catalog")
        need(catalog_hash(after) != before_hash, "migration_no_change")
        return {"clone_id": container_id, "clone_image": args.pg_image,
                "source_catalog_sha256": source_hash,
                "before_catalog_sha256": before_hash,
                "after_catalog_sha256": catalog_hash(after),
                "base_catalog_sha256": catalog_hash(base_after),
                "migration_seconds": elapsed, "preflight_counts": counts}
    finally:
        cleanup_clone(name, token)


def write_receipt(path: Path, value: dict[str, object]) -> None:
    payload = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(payload)
            output.flush()
            os.fsync(output.fileno())
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def run(args: argparse.Namespace) -> dict[str, object]:
    private_directory(args.output_dir)
    need(not (args.output_dir / "backup.dump").exists()
         and not (args.output_dir / "rehearsal.json").exists(), "output_exists")
    sql = MIGRATION.read_bytes()
    need(sha(sql) == args.sql_sha, "sql_pin")
    need(MIGRATION.is_file() and not MIGRATION.is_symlink(), "sql_file")
    verify_source(args)
    pre = live_json(args, PREFLIGHT_SQL)
    # Refuse a missing table, schema drift, or name collision before data scans.
    preflight(pre, None, role=args.role, database=args.database,
              version=args.server_version_num)
    counts = live_json(args, COUNT_SQL)
    preflight(pre, counts, role=args.role, database=args.database,
              version=args.server_version_num)
    source_catalog = live_json(args, CATALOG_SQL % {"base": "false"})
    staged_sql = args.output_dir / "migration.sql"
    fd = os.open(staged_sql, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(sql)
            output.flush()
            os.fsync(output.fileno())
        backup_path = args.output_dir / "backup.dump"
        backup_sha = backup(args, backup_path)
        details = rehearse(args, backup_path, staged_sql, source_catalog)
        need(digest_private_archive(backup_path) == backup_sha, "backup_integrity")
        verify_source(args)
        need(catalog_hash(live_json(args, CATALOG_SQL % {"base": "false"})) ==
             details["source_catalog_sha256"], "source_catalog_changed")
        receipt = {"schema": SCHEMA, "live_apply": False,
                   "api_container_id": args.api_id, "api_image": args.api_image,
                   "api_source_sha": args.api_source_sha,
                   "api_bundle_sha256": args.api_bundle_sha,
                   "pg_container_id": args.pg_id, "pg_image": args.pg_image,
                   "database": args.database, "role": args.role,
                   "sql_sha256": args.sql_sha, "backup_sha256": backup_sha,
                   **details, "created_at_unix": int(time.time())}
        write_receipt(args.output_dir / "rehearsal.json", receipt)
        return receipt
    finally:
        staged_sql.unlink(missing_ok=True)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    for name in ("api-id", "api-name", "api-image", "api-source-sha", "api-bundle-sha",
                 "api-bundle-path", "pg-id", "pg-name", "pg-image", "role", "database",
                 "server-version-num", "sql-sha"):
        p.add_argument("--" + name, required=True)
    p.add_argument("--output-dir", type=Path, required=True)
    p.add_argument("--clone-data-mib", type=int, default=4096)
    p.add_argument("--timeout", type=int, default=900)
    a = p.parse_args()
    need(60 <= a.timeout <= 3600, "timeout")
    return a


def main() -> int:
    try:
        result = run(parse_args())
        print(json.dumps({"result": "clone_rehearsed", "receipt": "rehearsal.json",
                          "backup_sha256": result["backup_sha256"],
                          "migration_seconds": result["migration_seconds"]}, sort_keys=True))
        return 0
    except (Blocked, OSError, ValueError, json.JSONDecodeError,
            subprocess.TimeoutExpired) as error:
        stage = str(error) if isinstance(error, Blocked) else type(error).__name__
        print(json.dumps({"result": "blocked", "stage": stage}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
