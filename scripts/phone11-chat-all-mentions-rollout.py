#!/usr/bin/env python3
"""Guarded, migration-only operator for the Phone11 chat @all metadata table.

This tool uses the operator's existing libpq environment (PGSERVICE or the
standard PG* variables). It never accepts a credential on the command line,
prints database errors, changes an API route, or drops a table. `inspect` is
read-only; `apply` requires a separately reviewed, mode-0600 pin manifest.
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
from typing import Any


MIGRATION_SHA256 = "34a115197fa2accc2e9c35f7656899056e86e68875c05120836d273df2501557"
MANIFEST_SCHEMA = "phone11-chat-all-mentions-rollout/v1"
RECEIPT_SCHEMA = "phone11-chat-all-mentions-receipt/v1"
LOCK_KEY = "phone11-chat-all-mentions-live-delta-20260920"
MAX_BYTES = 64 * 1024
HEX64 = re.compile(r"[0-9a-f]{64}\Z")


class GuardError(Exception):
    def __init__(self, stage: str):
        super().__init__(stage)
        self.stage = stage


def require(value: bool, stage: str) -> None:
    if not value:
        raise GuardError(stage)


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def secure_file(path: Path, *, expected_mode: int | None, owner: int | None = None) -> bytes:
    """Read one regular file by inode, rejecting links and concurrent replacement."""
    try:
        before = path.lstat()
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= MAX_BYTES, "file_guard")
        if expected_mode is not None:
            require(stat.S_IMODE(before.st_mode) == expected_mode, "file_guard")
        if owner is not None:
            require(before.st_uid == owner, "file_guard")
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        try:
            opened = os.fstat(fd)
            require((before.st_dev, before.st_ino, before.st_size, before.st_uid) ==
                    (opened.st_dev, opened.st_ino, opened.st_size, opened.st_uid), "file_guard")
            with os.fdopen(fd, "rb", closefd=False) as file:
                raw = file.read(MAX_BYTES + 1)
            require(len(raw) <= MAX_BYTES and os.fstat(fd).st_size == len(raw), "file_guard")
            return raw
        finally:
            os.close(fd)
    except OSError as exc:
        raise GuardError("file_guard") from exc


def private_dir(path: Path) -> None:
    try:
        info = path.lstat()
        require(path.is_absolute() and stat.S_ISDIR(info.st_mode) and
                stat.S_IMODE(info.st_mode) == 0o700 and info.st_uid == os.geteuid(), "receipt_dir")
    except OSError as exc:
        raise GuardError("receipt_dir") from exc


def atomic_receipt(path: Path, value: dict[str, Any], *, exclusive: bool) -> None:
    raw = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()
    fd: int | None = None
    temporary: str | None = None
    try:
        fd, temporary = tempfile.mkstemp(prefix=".all-mentions-", dir=path.parent)
        os.fchmod(fd, 0o600)
        view = memoryview(raw)
        while view:
            written = os.write(fd, view)
            require(written > 0, "receipt_write")
            view = view[written:]
        os.fsync(fd)
        os.close(fd)
        fd = None
        if exclusive:
            os.link(temporary, path, follow_symlinks=False)
            os.unlink(temporary)
        else:
            os.replace(temporary, path)
        temporary = None
        directory = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    except OSError as exc:
        raise GuardError("receipt_write") from exc
    finally:
        if fd is not None:
            os.close(fd)
        if temporary is not None:
            Path(temporary).unlink(missing_ok=True)


IDENTITY_SQL = """jsonb_build_object(
  'db',current_database(),'usr',current_user,
  'version_num',current_setting('server_version_num'),
  'addr',inet_server_addr()::text,'port',inet_server_port(),
  'db_oid',(SELECT oid FROM pg_database WHERE datname=current_database()),
  'schema',current_schema())"""

# Catalog shape contains metadata only. OIDs, grants, columns and constraints
# make a pinned pre-state sensitive to concurrent DDL, not customer rows.
CATALOG_SQL = """(WITH objects AS (
  SELECT to_regclass('public.phone11_chat_messages') msg,
         to_regclass('public.phone11_chat_message_all_mentions') target
)
SELECT jsonb_build_object(
  'messages',(SELECT jsonb_build_object('oid',oid,'kind',relkind,'owner',pg_get_userbyid(relowner),
    'rls',relrowsecurity,'force_rls',relforcerowsecurity,'acl',relacl::text)
    FROM pg_class WHERE oid=objects.msg),
  'message_columns',(SELECT jsonb_agg(jsonb_build_object('name',attname,
    'type',format_type(atttypid,atttypmod),'not_null',attnotnull) ORDER BY attnum)
    FROM pg_attribute WHERE attrelid=objects.msg AND attnum>0 AND NOT attisdropped),
  'message_constraints',(SELECT jsonb_agg(jsonb_build_object('type',contype,
    'definition',pg_get_constraintdef(oid,true)) ORDER BY conname)
    FROM pg_constraint WHERE conrelid=objects.msg),
  'message_grants',(SELECT jsonb_agg(jsonb_build_object('grantee',grantee,
    'privilege',privilege_type) ORDER BY grantee,privilege_type)
    FROM information_schema.table_privileges WHERE table_schema='public'
      AND table_name='phone11_chat_messages'),
  'target',(SELECT jsonb_build_object('oid',oid,'kind',relkind,'owner',pg_get_userbyid(relowner),
    'rls',relrowsecurity,'force_rls',relforcerowsecurity,'acl',relacl::text)
    FROM pg_class WHERE oid=objects.target),
  'target_columns',(SELECT jsonb_agg(jsonb_build_object('name',attname,
    'type',format_type(atttypid,atttypmod),'not_null',attnotnull) ORDER BY attnum)
    FROM pg_attribute WHERE attrelid=objects.target AND attnum>0 AND NOT attisdropped),
  'target_constraints',(SELECT jsonb_agg(jsonb_build_object('type',contype,
    'definition',pg_get_constraintdef(oid,true),'validated',convalidated) ORDER BY conname)
    FROM pg_constraint WHERE conrelid=objects.target),
  'target_indexes',(SELECT jsonb_agg(jsonb_build_object('definition',pg_get_indexdef(indexrelid),
    'valid',indisvalid,'ready',indisready) ORDER BY indexrelid)
    FROM pg_index WHERE indrelid=objects.target),
  'target_grants',(SELECT jsonb_agg(jsonb_build_object('grantee',grantee,
    'privilege',privilege_type) ORDER BY grantee,privilege_type)
    FROM information_schema.table_privileges WHERE table_schema='public'
      AND table_name='phone11_chat_message_all_mentions')
) FROM objects)"""

TARGET_VALID_SQL = """(
  to_regclass('public.phone11_chat_message_all_mentions') IS NOT NULL
  AND EXISTS (SELECT 1 FROM pg_class WHERE oid=to_regclass('public.phone11_chat_message_all_mentions')
    AND relkind='r' AND pg_get_userbyid(relowner)=current_user
    AND NOT relrowsecurity AND NOT relforcerowsecurity)
  AND (SELECT jsonb_agg(jsonb_build_array(attname,format_type(atttypid,atttypmod),attnotnull)
      ORDER BY attnum) FROM pg_attribute
      WHERE attrelid=to_regclass('public.phone11_chat_message_all_mentions')
        AND attnum>0 AND NOT attisdropped) =
    '[["tenant_id","integer",true],["conversation_id","uuid",true],
      ["message_id","uuid",true],["start_offset","integer",true],
      ["length","integer",true]]'::jsonb
  AND (SELECT count(*)=4 AND bool_and(convalidated) FROM pg_constraint
       WHERE conrelid=to_regclass('public.phone11_chat_message_all_mentions'))
  AND EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid=to_regclass('public.phone11_chat_message_all_mentions')
        AND contype='f' AND convalidated AND
        confrelid='public.phone11_chat_messages'::regclass AND confdeltype='c')
  AND (SELECT count(*)=1 AND bool_and(indisvalid AND indisready AND indisprimary)
       FROM pg_index WHERE indrelid=to_regclass('public.phone11_chat_message_all_mentions'))
  AND NOT EXISTS (SELECT 1 FROM information_schema.table_privileges
       WHERE table_schema='public' AND table_name='phone11_chat_message_all_mentions'
         AND grantee<>current_user)
)"""

IDENTITY_HASH_SQL = f"encode(sha256(convert_to(({IDENTITY_SQL})::text,'UTF8')),'hex')"
CATALOG_HASH_SQL = f"encode(sha256(convert_to(({CATALOG_SQL})::text,'UTF8')),'hex')"


def observation_sql() -> str:
    return f"""SELECT jsonb_build_object(
      'identity_sha256',{IDENTITY_HASH_SQL},'catalog_sha256',{CATALOG_HASH_SQL},
      'target_exists',to_regclass('public.phone11_chat_message_all_mentions') IS NOT NULL,
      'target_valid',{TARGET_VALID_SQL})::text;"""


def transaction_sql(*, pins: dict[str, str] | None, migration: str | None) -> str:
    read_only = pins is None
    lines = [
        "BEGIN ISOLATION LEVEL SERIALIZABLE" + (" READ ONLY;" if read_only else ";"),
        # With pg_catalog omitted, PostgreSQL searches built-ins before public.
        # public remains current_schema(), as required by the pinned migration;
        # explicit pg_temp last prevents temporary relations shadowing it.
        "SET LOCAL search_path=public,pg_temp;",
        "SET LOCAL lock_timeout='2s';",
        "SET LOCAL statement_timeout='30s';",
        "SET LOCAL idle_in_transaction_session_timeout='35s';",
        f"SELECT pg_advisory_xact_lock(hashtextextended('{LOCK_KEY}',0));",
    ]
    if pins is not None:
        lines.append(f"""DO $phone11_operator_guard$ BEGIN
          IF {IDENTITY_HASH_SQL} <> '{pins['identity_sha256']}' THEN
            RAISE EXCEPTION 'phone11_identity_pin_mismatch'; END IF;
          IF {CATALOG_HASH_SQL} <> '{pins['before_catalog_sha256']}' THEN
            RAISE EXCEPTION 'phone11_catalog_pin_mismatch'; END IF;
          IF to_regclass('public.phone11_chat_message_all_mentions') IS NOT NULL THEN
            RAISE EXCEPTION 'phone11_target_already_exists'; END IF;
        END $phone11_operator_guard$;""")
        require(migration is not None, "migration")
        lines.append(migration)
        lines.append(f"""DO $phone11_operator_verify$ BEGIN
          IF NOT {TARGET_VALID_SQL} THEN
            RAISE EXCEPTION 'phone11_target_shape_mismatch'; END IF;
          IF {IDENTITY_HASH_SQL} <> '{pins['identity_sha256']}' THEN
            RAISE EXCEPTION 'phone11_identity_changed'; END IF;
        END $phone11_operator_verify$;""")
    lines += [observation_sql(), "COMMIT;"]
    return "\n".join(lines) + "\n"


def run_psql(sql: str) -> dict[str, Any]:
    environment = os.environ.copy()
    environment.pop("PGOPTIONS", None)
    environment["PGCONNECT_TIMEOUT"] = "5"
    environment["PGCLIENTENCODING"] = "UTF8"
    environment["PGAPPNAME"] = "phone11-chat-all-mentions-rollout"
    try:
        result = subprocess.run(
            ["psql", "-X", "-w", "-qAt", "-v", "ON_ERROR_STOP=1"],
            input=sql.encode(), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            env=environment, timeout=45, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise GuardError("database_command") from exc
    require(result.returncode == 0 and len(result.stdout) <= 4096, "database_transaction")
    try:
        lines = [line for line in result.stdout.decode("utf-8").splitlines() if line.strip()]
        require(len(lines) == 1, "database_response")
        value = json.loads(lines[0])
        require(isinstance(value, dict) and set(value) ==
                {"identity_sha256", "catalog_sha256", "target_exists", "target_valid"}, "database_response")
        require(all(isinstance(value[key], str) and HEX64.fullmatch(value[key])
                    for key in ("identity_sha256", "catalog_sha256")), "database_response")
        require(type(value["target_exists"]) is bool and type(value["target_valid"]) is bool,
                "database_response")
        return value
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise GuardError("database_response") from exc


def migration_file(path: Path) -> str:
    raw = secure_file(path, expected_mode=None)
    require(digest(raw) == MIGRATION_SHA256, "migration_pin")
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise GuardError("migration_pin") from exc


def manifest_file(path: Path, sha256: str) -> dict[str, str]:
    require(HEX64.fullmatch(sha256) is not None, "manifest_pin")
    raw = secure_file(path, expected_mode=0o600, owner=os.geteuid())
    require(digest(raw) == sha256, "manifest_pin")
    try:
        value = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise GuardError("manifest_shape") from exc
    require(isinstance(value, dict) and set(value) ==
            {"schema", "migration_sha256", "identity_sha256", "before_catalog_sha256"},
            "manifest_shape")
    require(value["schema"] == MANIFEST_SCHEMA and value["migration_sha256"] == MIGRATION_SHA256,
            "manifest_shape")
    require(all(isinstance(value[key], str) and HEX64.fullmatch(value[key])
                for key in ("identity_sha256", "before_catalog_sha256")), "manifest_shape")
    return value


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("inspect", "apply"))
    parser.add_argument("--migration", type=Path, required=True)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--manifest-sha256")
    parser.add_argument("--receipt-dir", type=Path)
    args = parser.parse_args()
    try:
        migration = migration_file(args.migration)
        if args.action == "inspect":
            require(args.manifest is None and args.manifest_sha256 is None and args.receipt_dir is None,
                    "inspect_arguments")
            result = run_psql(transaction_sql(pins=None, migration=None))
            state = "absent" if not result["target_exists"] else (
                "present_valid" if result["target_valid"] else "present_invalid")
            print(json.dumps({"state": state, "identity_sha256": result["identity_sha256"],
                              "catalog_sha256": result["catalog_sha256"]}, sort_keys=True))
            return 0
        require(args.manifest is not None and args.manifest_sha256 is not None and
                args.receipt_dir is not None, "apply_arguments")
        pins = manifest_file(args.manifest, args.manifest_sha256)
        private_dir(args.receipt_dir)
        receipt = args.receipt_dir / "all-mentions-receipt.json"
        require(not os.path.lexists(receipt), "receipt_exists")
        observed = run_psql(transaction_sql(pins=None, migration=None))
        require(observed["identity_sha256"] == pins["identity_sha256"] and
                observed["catalog_sha256"] == pins["before_catalog_sha256"] and
                not observed["target_exists"], "before_catalog")
        pending = {"schema": RECEIPT_SCHEMA, "status": "pending",
                   "manifest_sha256": args.manifest_sha256, "migration_sha256": MIGRATION_SHA256,
                   "identity_sha256": pins["identity_sha256"],
                   "before_catalog_sha256": pins["before_catalog_sha256"]}
        # The durable intent records an interrupted commit/receipt window.
        # Never retry a pending state automatically; inspect it and reconcile.
        atomic_receipt(receipt, pending, exclusive=True)
        result = run_psql(transaction_sql(pins=pins, migration=migration))
        require(result["identity_sha256"] == pins["identity_sha256"] and
                result["target_exists"] and result["target_valid"], "post_commit")
        applied = dict(pending, status="applied", after_catalog_sha256=result["catalog_sha256"])
        atomic_receipt(receipt, applied, exclusive=False)
        print(json.dumps({"status": "applied", "catalog_sha256": result["catalog_sha256"]}, sort_keys=True))
        return 0
    except GuardError as exc:
        print(json.dumps({"status": "blocked", "stage": exc.stage}, sort_keys=True), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
