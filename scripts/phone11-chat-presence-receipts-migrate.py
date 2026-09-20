#!/usr/bin/env python3
"""Guarded one-time Phone11 presence/read-receipt schema operator.

The operator runs on the Phone11 host as root. Database settings remain inside
the already-running backend container and are consumed only by a redacted Node
process. ``--prepare`` is read-only. ``--apply`` holds the migration advisory
lock, revalidates exact database/catalog pins in the same transaction, applies
the immutable delta, proves that no pre-existing scoped metadata changed, and
then writes an exclusive root-only receipt. ``--recover-receipt`` is a
read-only recovery path for the narrow case where the database commit succeeded
but the exclusive receipt write failed; it re-proves the exact post-state
before creating the missing receipt.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import stat
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Mapping, Sequence


SOURCE_BASE_SHA = "f5b47b8f3b9c09c3bdec05effd6ead5ad664a9e9"
ACTIVE_CONTAINER = "cp11-backend"
ACTIVE_CONTAINER_ID = "f9ce934dc51b531fe1a9b2bd927634322f9c6c572a551592a48d3e0d26a49616"
ACTIVE_IMAGE = "sha256:d42c70f34d5062bff779c235dd2b6e415bede3b3a86b9de73892acf35b392619"
EXPECTED_OWNER = "phone11ai"
EXPECTED_DATABASE_FINGERPRINT = "6901e1f28e6fc33ebba8eefaa8708e663f1145a22ccdeb5bdc960cd849b4a552"
EXPECTED_BEFORE_CATALOG_FINGERPRINT = "c1bc10833710e9ceb2a25e0f713c384fc25d70982cd7862e1f6aceaa35526f6c"
EXPECTED_ARTIFACT_SHA256 = "dffee7ecb0d713a04cad25de1de493d71780b2d5b8f2d9be3101680e0ccfc93f"
RECEIPT_SCHEMA = "phone11-migration-receipt/v1"
MAX_ARTIFACT_BYTES = 128 * 1024
MAX_NODE_OUTPUT_BYTES = 2 * 1024 * 1024

TARGET_TABLES = {
    "phone11_chat_presence_sessions",
    "phone11_chat_read_receipts",
}

SCOPED_RELATIONS = (
    "users",
    "tenants",
    "tenant_memberships",
    "user_extensions",
    "extensions",
    "phone11_chat_conversations",
    "phone11_chat_members",
    "phone11_chat_messages",
    "phone11_chat_blocks",
    "phone11_chat_reports",
    "phone11_chat_reactions",
    "phone11_chat_bookmarks",
    "phone11_chat_pins",
    "phone11_chat_notification_preferences",
    "phone11_chat_presence",
    "phone11_chat_presence_sessions",
    "phone11_chat_message_mentions",
    "phone11_chat_attachments",
    "phone11_chat_read_receipts",
)


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


def secure_read(
    path: Path,
    *,
    expected_uid: int = 0,
    expected_gid: int = 0,
    expected_mode: int = 0o600,
) -> bytes:
    try:
        before = path.lstat()
        guarded(stat.S_ISREG(before.st_mode) and not stat.S_ISLNK(before.st_mode), "artifact")
        guarded(
            before.st_uid == expected_uid
            and before.st_gid == expected_gid
            and before.st_nlink == 1
            and stat.S_IMODE(before.st_mode) == expected_mode,
            "artifact",
        )
        guarded(before.st_size <= MAX_ARTIFACT_BYTES, "artifact")
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        try:
            opened = os.fstat(descriptor)
            guarded(
                (opened.st_dev, opened.st_ino, opened.st_uid, opened.st_gid)
                == (before.st_dev, before.st_ino, before.st_uid, before.st_gid),
                "artifact",
            )
            chunks: list[bytes] = []
            remaining = MAX_ARTIFACT_BYTES + 1
            while remaining:
                chunk = os.read(descriptor, min(65_536, remaining))
                if not chunk:
                    break
                chunks.append(chunk)
                remaining -= len(chunk)
            content = b"".join(chunks)
            guarded(len(content) <= MAX_ARTIFACT_BYTES, "artifact")
            guarded(os.fstat(descriptor).st_size == len(content), "artifact")
            return content
        finally:
            os.close(descriptor)
    except MigrationError:
        raise
    except OSError as error:
        raise MigrationError("artifact") from error


def inspect_active_container() -> None:
    try:
        result = subprocess.run(
            ["/usr/bin/docker", "inspect", ACTIVE_CONTAINER],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=20,
            check=False,
        )
        guarded(result.returncode == 0 and len(result.stdout) <= MAX_NODE_OUTPUT_BYTES, "container")
        document = json.loads(result.stdout)
        guarded(isinstance(document, list) and len(document) == 1, "container")
        current = document[0]
        state = current.get("State")
        guarded(isinstance(current, Mapping) and isinstance(state, Mapping), "container")
        guarded(
            current.get("Id") == ACTIVE_CONTAINER_ID
            and current.get("Image") == ACTIVE_IMAGE
            and state.get("Running") is True
            and state.get("Health", {}).get("Status") == "healthy",
            "container",
        )
    except MigrationError:
        raise
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as error:
        raise MigrationError("container") from error


NODE_PROGRAM = r"""
const fs = require("node:fs");
const crypto = require("node:crypto");
const pg = require("pg");
const action = process.argv[1];
const contract = JSON.parse(process.argv[2]);
const expectedIdentity = contract.database_fingerprint;
const expectedCatalog = contract.before_catalog_fingerprint;
const names = [
  "users", "tenants", "tenant_memberships", "user_extensions", "extensions",
  "phone11_chat_conversations", "phone11_chat_members", "phone11_chat_messages",
  "phone11_chat_blocks", "phone11_chat_reports", "phone11_chat_reactions",
  "phone11_chat_bookmarks", "phone11_chat_pins",
  "phone11_chat_notification_preferences", "phone11_chat_presence",
  "phone11_chat_presence_sessions", "phone11_chat_message_mentions",
  "phone11_chat_attachments", "phone11_chat_read_receipts"
];
function first(...keys) {
  for (const key of keys) if (process.env[key]) return process.env[key];
}
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(
      key => JSON.stringify(key) + ":" + canonical(value[key])
    ).join(",") + "}";
  }
  return JSON.stringify(value);
}
function sha(value) {
  return crypto.createHash("sha256").update(canonical(value)).digest("hex");
}
function config() {
  const discrete = {
    host: first("PG_HOST", "DB_HOST", "POSTGRES_HOST"),
    port: first("PG_PORT", "DB_PORT", "POSTGRES_PORT"),
    user: first("PG_USER", "DB_USER", "POSTGRES_USER"),
    password: first("PG_PASSWORD", "DB_PASSWORD", "POSTGRES_PASSWORD"),
    database: first("PG_DATABASE", "DB_NAME", "DB_DATABASE", "POSTGRES_DB")
  };
  const complete = discrete.host && discrete.user && discrete.password && discrete.database;
  const connectionString = process.env.PG_CONNECTION_STRING ||
    (!complete ? process.env.DATABASE_URL : undefined);
  const mode = (first("PG_SSL", "DB_SSL", "POSTGRES_SSL", "DATABASE_SSL") || "").toLowerCase();
  const ssl = mode === "false" || mode === "0" || mode === "disable" ||
    (connectionString || "").includes("sslmode=disable") ? false : {
      rejectUnauthorized: first("PG_SSL_REJECT_UNAUTHORIZED", "DB_SSL_REJECT_UNAUTHORIZED") === "true"
    };
  return connectionString ? {connectionString, ssl, connectionTimeoutMillis: 5000} : {
    host: discrete.host,
    port: Number(discrete.port || 5432),
    user: discrete.user,
    password: discrete.password,
    database: discrete.database,
    ssl,
    connectionTimeoutMillis: 5000
  };
}
async function identity(client) {
  return (await client.query(
    "SELECT current_database() db,current_user usr,current_setting('server_version_num') version_num," +
    "inet_server_addr()::text addr,inet_server_port() port," +
    "(SELECT oid FROM pg_database WHERE datname=current_database()) db_oid"
  )).rows[0];
}
async function catalog(client) {
  const relations = (await client.query(`
    SELECT c.relname name,c.relkind,pg_get_userbyid(c.relowner) owner,
      c.relrowsecurity rls,c.relforcerowsecurity force_rls
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY($1::text[])
    ORDER BY c.relname`, [names])).rows;
  const columns = (await client.query(`
    SELECT c.relname table_name,a.attnum ordinal,a.attname column_name,
      format_type(a.atttypid,a.atttypmod) data_type,a.attnotnull not_null,
      pg_get_expr(ad.adbin,ad.adrelid) default_expr
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_attrdef ad ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum
    WHERE n.nspname='public' AND c.relname=ANY($1::text[])
      AND a.attnum>0 AND NOT a.attisdropped
    ORDER BY c.relname,a.attnum`, [names])).rows;
  const constraints = (await client.query(`
    SELECT c.relname table_name,con.conname name,con.contype type,
      con.convalidated validated,con.condeferrable deferrable,
      pg_get_constraintdef(con.oid,true) definition
    FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY($1::text[])
    ORDER BY c.relname,con.conname`, [names])).rows;
  const indexes = (await client.query(`
    SELECT tablename table_name,indexname name,indexdef definition
    FROM pg_indexes WHERE schemaname='public' AND tablename=ANY($1::text[])
    ORDER BY tablename,indexname`, [names])).rows;
  const grants = (await client.query(`
    SELECT table_name,grantee,privilege_type,is_grantable
    FROM information_schema.table_privileges
    WHERE table_schema='public' AND table_name=ANY($1::text[])
    ORDER BY table_name,grantee,privilege_type`, [names])).rows;
  const policies = (await client.query(`
    SELECT tablename,policyname,roles,cmd,qual,with_check
    FROM pg_policies WHERE schemaname='public' AND tablename=ANY($1::text[])
    ORDER BY tablename,policyname`, [names])).rows;
  return {relations, columns, constraints, indexes, grants, policies};
}
function withoutTargets(value) {
  const targets = new Set(contract.targets);
  const result = {};
  for (const section of ["relations", "columns", "constraints", "indexes", "grants"]) {
    const key = section === "relations" ? "name" : "table_name";
    result[section] = value[section].filter(row => !targets.has(row[key]));
  }
  result.policies = value.policies.filter(row => !targets.has(row.tablename));
  return result;
}
function equal(left, right) { return canonical(left) === canonical(right); }
function verifyAfter(before, after) {
  if (sha(before) !== expectedCatalog || !equal(withoutTargets(before), withoutTargets(after))) {
    throw new Error("catalog_drift");
  }
  const targets = new Set(contract.targets);
  const targetRows = (section) => after[section].filter(row =>
    targets.has(section === "relations" ? row.name : section === "policies" ? row.tablename : row.table_name));
  const relations = targetRows("relations");
  if (relations.length !== contract.targets.length ||
      !equal(relations.map(row => row.name).sort(), [...contract.targets].sort()) ||
      !relations.every(row => row.relkind === "r" && row.owner === contract.owner &&
        row.rls === false && row.force_rls === false)) throw new Error("relations");
  const columns = targetRows("columns");
  for (const table of contract.targets) {
    const actual = columns.filter(row => row.table_name === table).map(row =>
      [row.column_name, row.data_type, row.not_null, row.default_expr]);
    if (!equal(actual, contract.columns[table])) throw new Error("columns");
  }
  const constraints = targetRows("constraints");
  for (const table of contract.targets) {
    const actual = constraints.filter(row => row.table_name === table);
    if (actual.length !== contract.constraints[table].length ||
        !actual.every(row => row.validated === true && row.deferrable === false) ||
        !equal(actual.map(row => row.definition).sort(), [...contract.constraints[table]].sort())) {
      throw new Error("constraints");
    }
  }
  const indexes = Object.fromEntries(targetRows("indexes").map(row =>
    [row.name, {table_name: row.table_name, definition: row.definition}]));
  if (!equal(indexes, contract.indexes)) throw new Error("indexes");
  const grants = targetRows("grants");
  for (const table of contract.targets) {
    const actual = grants.filter(row => row.table_name === table);
    if (actual.length !== contract.privileges.length ||
        !equal(actual.map(row => row.privilege_type).sort(), [...contract.privileges].sort()) ||
        !actual.every(row => row.grantee === contract.owner && row.is_grantable === "YES")) {
      throw new Error("grants");
    }
  }
  if (targetRows("policies").length !== 0) throw new Error("policies");
  const afterFingerprint = sha(after);
  const verification = {
    source_base_sha: contract.source_base_sha,
    artifact_sha256: contract.artifact_sha256,
    database_fingerprint: contract.database_fingerprint,
    before_catalog_fingerprint: contract.before_catalog_fingerprint,
    after_catalog_fingerprint: afterFingerprint,
    added_tables: [...contract.targets].sort()
  };
  return {after_catalog_fingerprint: afterFingerprint, verification_sha256: sha(verification)};
}
(async () => {
  const client = new pg.Client(config());
  try {
    if (!["prepare", "apply", "recover"].includes(action)) throw new Error("mode");
    await client.connect();
    await client.query(action === "apply" ? "BEGIN" : "BEGIN TRANSACTION READ ONLY");
    await client.query("SET LOCAL statement_timeout='30000ms'");
    await client.query("SET LOCAL lock_timeout='2000ms'");
    if (action === "apply") await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('phone11-chat-presence-receipts-live-delta-20260920', 0))"
    );
    const beforeIdentity = await identity(client);
    const beforeCatalog = await catalog(client);
    if (sha(beforeIdentity) !== expectedIdentity ||
        (action !== "recover" && sha(beforeCatalog) !== expectedCatalog)) {
      throw new Error("pin");
    }
    if (action !== "apply") {
      let nodeVerification;
      if (action === "recover") {
        const reconstructedBefore = withoutTargets(beforeCatalog);
        nodeVerification = verifyAfter(reconstructedBefore, beforeCatalog);
      }
      await client.query("ROLLBACK");
      const result = {ok: true, action, identity_fingerprint: sha(beforeIdentity),
        catalog_fingerprint: sha(beforeCatalog)};
      if (action === "recover") {
        result.catalog = beforeCatalog;
        result.node_verification = nodeVerification;
      }
      console.log(JSON.stringify(result));
      return;
    }
    const sql = fs.readFileSync(0, "utf8");
    await client.query(sql);
    const afterIdentity = await identity(client);
    const afterCatalog = await catalog(client);
    if (sha(afterIdentity) !== expectedIdentity) throw new Error("identity");
    const nodeVerification = verifyAfter(beforeCatalog, afterCatalog);
    await client.query("COMMIT");
    console.log(JSON.stringify({ok: true, action, identity_fingerprint: sha(afterIdentity),
      before_catalog: beforeCatalog, after_catalog: afterCatalog, node_verification: nodeVerification}));
  } catch (_error) {
    try { await client.query("ROLLBACK"); } catch (_ignored) {}
    console.log(JSON.stringify({ok: false, error: "MIGRATION_BLOCKED"}));
    process.exitCode = 1;
  } finally {
    try { await client.end(); } catch (_ignored) {}
  }
})();
"""


def run_database(action: str, sql: bytes = b"") -> Mapping[str, Any]:
    guarded(action in {"prepare", "apply", "recover"}, "database")
    try:
        result = subprocess.run(
            [
                "/usr/bin/docker",
                "exec",
                "-i",
                ACTIVE_CONTAINER,
                "node",
                "-e",
                NODE_PROGRAM,
                action,
                json.dumps(verification_contract(), sort_keys=True, separators=(",", ":")),
            ],
            input=sql,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=90 if action == "apply" else 45,
            check=False,
        )
        guarded(
            result.returncode == 0
            and 0 < len(result.stdout) <= MAX_NODE_OUTPUT_BYTES,
            "database",
        )
        document = json.loads(result.stdout)
        guarded(isinstance(document, Mapping) and document.get("ok") is True, "database")
        return document
    except MigrationError:
        raise
    except (OSError, subprocess.TimeoutExpired, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise MigrationError("database") from error


def catalog_fingerprint(catalog: Mapping[str, Any]) -> str:
    return sha256_bytes(canonical_bytes(catalog))


def without_targets(catalog: Mapping[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for section in ("relations", "columns", "constraints", "indexes", "grants"):
        values = catalog.get(section)
        guarded(isinstance(values, list), "verification")
        key = "name" if section == "relations" else "table_name"
        result[section] = [value for value in values if value.get(key) not in TARGET_TABLES]
    policies = catalog.get("policies")
    guarded(isinstance(policies, list), "verification")
    result["policies"] = [value for value in policies if value.get("tablename") not in TARGET_TABLES]
    return result


def target_rows(catalog: Mapping[str, Any], section: str) -> list[Mapping[str, Any]]:
    values = catalog.get(section)
    guarded(isinstance(values, list), "verification")
    key = "name" if section == "relations" else "tablename" if section == "policies" else "table_name"
    return [value for value in values if value.get(key) in TARGET_TABLES]


EXPECTED_COLUMNS = {
    "phone11_chat_presence_sessions": [
        ("tenant_id", "integer", True, None),
        ("user_id", "integer", True, None),
        ("session_id", "uuid", True, None),
        ("generation", "uuid", True, None),
        ("sequence", "bigint", True, None),
        ("status", "text", True, None),
        ("active", "boolean", True, "true"),
        ("last_seen_at", "timestamp with time zone", True, "now()"),
        ("lease_expires_at", "timestamp with time zone", True, "now()"),
    ],
    "phone11_chat_read_receipts": [
        ("tenant_id", "integer", True, None),
        ("conversation_id", "uuid", True, None),
        ("message_id", "uuid", True, None),
        ("reader_id", "integer", True, None),
        ("read_at", "timestamp with time zone", True, "clock_timestamp()"),
    ],
}

EXPECTED_CONSTRAINT_DEFINITIONS = {
    "phone11_chat_presence_sessions": {
        "PRIMARY KEY (tenant_id, user_id, session_id)",
        "CHECK (sequence >= 0)",
        "CHECK (status = ANY (ARRAY['available'::text, 'away'::text, 'on_call'::text, 'in_meeting'::text]))",
        "FOREIGN KEY (tenant_id) REFERENCES tenants(id)",
        "FOREIGN KEY (user_id) REFERENCES users(id)",
    },
    "phone11_chat_read_receipts": {
        "PRIMARY KEY (tenant_id, conversation_id, message_id, reader_id)",
        "FOREIGN KEY (reader_id) REFERENCES users(id)",
        "FOREIGN KEY (tenant_id, conversation_id, message_id) REFERENCES phone11_chat_messages(tenant_id, conversation_id, id) ON DELETE CASCADE",
        "FOREIGN KEY (tenant_id, conversation_id, reader_id) REFERENCES phone11_chat_members(tenant_id, conversation_id, user_id) ON DELETE CASCADE",
    },
}

EXPECTED_INDEXES = {
    "phone11_chat_presence_sessions_pkey": {
        "table_name": "phone11_chat_presence_sessions",
        "definition": "CREATE UNIQUE INDEX phone11_chat_presence_sessions_pkey ON public.phone11_chat_presence_sessions USING btree (tenant_id, user_id, session_id)",
    },
    "phone11_chat_presence_sessions_fresh": {
        "table_name": "phone11_chat_presence_sessions",
        "definition": "CREATE INDEX phone11_chat_presence_sessions_fresh ON public.phone11_chat_presence_sessions USING btree (tenant_id, user_id, lease_expires_at DESC)",
    },
    "phone11_chat_read_receipts_pkey": {
        "table_name": "phone11_chat_read_receipts",
        "definition": "CREATE UNIQUE INDEX phone11_chat_read_receipts_pkey ON public.phone11_chat_read_receipts USING btree (tenant_id, conversation_id, message_id, reader_id)",
    },
    "phone11_chat_read_receipts_sender_lookup": {
        "table_name": "phone11_chat_read_receipts",
        "definition": "CREATE INDEX phone11_chat_read_receipts_sender_lookup ON public.phone11_chat_read_receipts USING btree (tenant_id, conversation_id, message_id, read_at, reader_id)",
    },
}

FULL_PRIVILEGES = {"DELETE", "INSERT", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE"}


def verification_contract() -> dict[str, Any]:
    """One contract consumed by both the in-transaction and operator checks."""

    return {
        "source_base_sha": SOURCE_BASE_SHA,
        "artifact_sha256": EXPECTED_ARTIFACT_SHA256,
        "database_fingerprint": EXPECTED_DATABASE_FINGERPRINT,
        "before_catalog_fingerprint": EXPECTED_BEFORE_CATALOG_FINGERPRINT,
        "owner": EXPECTED_OWNER,
        "targets": sorted(TARGET_TABLES),
        "columns": {table: [list(value) for value in values] for table, values in EXPECTED_COLUMNS.items()},
        "constraints": {table: sorted(values) for table, values in EXPECTED_CONSTRAINT_DEFINITIONS.items()},
        "indexes": EXPECTED_INDEXES,
        "privileges": sorted(FULL_PRIVILEGES),
    }


def verify_after(document: Mapping[str, Any]) -> tuple[str, str]:
    guarded(document.get("identity_fingerprint") == EXPECTED_DATABASE_FINGERPRINT, "verification")
    before = document.get("before_catalog")
    after = document.get("after_catalog")
    guarded(isinstance(before, Mapping) and isinstance(after, Mapping), "verification")
    guarded(catalog_fingerprint(before) == EXPECTED_BEFORE_CATALOG_FINGERPRINT, "verification")
    guarded(without_targets(before) == without_targets(after), "verification")

    relations = target_rows(after, "relations")
    guarded(
        len(relations) == 2
        and {relation.get("name") for relation in relations} == TARGET_TABLES
        and all(
            relation.get("relkind") == "r"
            and relation.get("owner") == EXPECTED_OWNER
            and relation.get("rls") is False
            and relation.get("force_rls") is False
            for relation in relations
        ),
        "verification",
    )

    columns = target_rows(after, "columns")
    for table, expected in EXPECTED_COLUMNS.items():
        actual = [
            (
                column.get("column_name"),
                column.get("data_type"),
                column.get("not_null"),
                column.get("default_expr"),
            )
            for column in columns
            if column.get("table_name") == table
        ]
        guarded(actual == expected, "verification")

    constraints = target_rows(after, "constraints")
    for table, expected in EXPECTED_CONSTRAINT_DEFINITIONS.items():
        table_constraints = [constraint for constraint in constraints if constraint.get("table_name") == table]
        actual = {
            constraint.get("definition")
            for constraint in table_constraints
        }
        guarded(
            len(table_constraints) == len(expected)
            and actual == expected
            and all(
                constraint.get("validated") is True
                and constraint.get("deferrable") is False
                for constraint in table_constraints
            ),
            "verification",
        )

    indexes = target_rows(after, "indexes")
    actual_indexes = {
        index.get("name"): {
            "table_name": index.get("table_name"),
            "definition": index.get("definition"),
        }
        for index in indexes
    }
    guarded(actual_indexes == EXPECTED_INDEXES, "verification")

    grants = target_rows(after, "grants")
    for table in TARGET_TABLES:
        table_grants = [grant for grant in grants if grant.get("table_name") == table]
        guarded(
            len(table_grants) == len(FULL_PRIVILEGES)
            and {grant.get("privilege_type") for grant in table_grants} == FULL_PRIVILEGES
            and all(
                grant.get("grantee") == EXPECTED_OWNER
                and grant.get("is_grantable") == "YES"
                for grant in table_grants
            ),
            "verification",
        )
    guarded(not target_rows(after, "policies"), "verification")

    after_fingerprint = catalog_fingerprint(after)
    verification = {
        "source_base_sha": SOURCE_BASE_SHA,
        "artifact_sha256": EXPECTED_ARTIFACT_SHA256,
        "database_fingerprint": EXPECTED_DATABASE_FINGERPRINT,
        "before_catalog_fingerprint": EXPECTED_BEFORE_CATALOG_FINGERPRINT,
        "after_catalog_fingerprint": after_fingerprint,
        "added_tables": sorted(TARGET_TABLES),
    }
    verification_sha256 = sha256_bytes(canonical_bytes(verification))
    node_verification = document.get("node_verification")
    if node_verification is not None:
        guarded(
            node_verification == {
                "after_catalog_fingerprint": after_fingerprint,
                "verification_sha256": verification_sha256,
            },
            "verification",
        )
    return after_fingerprint, verification_sha256


def verify_recovery(document: Mapping[str, Any]) -> tuple[str, str]:
    """Verify the exact committed post-state without performing any write."""

    guarded(document.get("identity_fingerprint") == EXPECTED_DATABASE_FINGERPRINT, "verification")
    after = document.get("catalog")
    guarded(isinstance(after, Mapping), "verification")
    before = without_targets(after)
    guarded(catalog_fingerprint(before) == EXPECTED_BEFORE_CATALOG_FINGERPRINT, "verification")
    return verify_after(
        {
            "identity_fingerprint": document.get("identity_fingerprint"),
            "before_catalog": before,
            "after_catalog": after,
            "node_verification": document.get("node_verification"),
        },
    )


def write_receipt(
    path: Path,
    verification_sha256: str,
    *,
    expected_uid: int = 0,
    expected_gid: int = 0,
) -> None:
    guarded(path.is_absolute(), "receipt")
    descriptor: int | None = None
    temporary: str | None = None
    try:
        parent = path.parent.lstat()
        guarded(
            stat.S_ISDIR(parent.st_mode)
            and not stat.S_ISLNK(parent.st_mode)
            and parent.st_uid == expected_uid
            and parent.st_gid == expected_gid
            and stat.S_IMODE(parent.st_mode) == 0o700,
            "receipt",
        )
        guarded(not os.path.lexists(path), "receipt")
        receipt = canonical_bytes(
            {
                "schema": RECEIPT_SCHEMA,
                "status": "applied",
                "artifact_sha256": EXPECTED_ARTIFACT_SHA256,
                "database_fingerprint": EXPECTED_DATABASE_FINGERPRINT,
                "verification_sha256": verification_sha256,
            },
        )
        descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
        try:
            os.fchmod(descriptor, 0o600)
            os.fchown(descriptor, expected_uid, expected_gid)
            view = memoryview(receipt)
            while view:
                written = os.write(descriptor, view)
                guarded(written > 0, "receipt")
                view = view[written:]
            os.fsync(descriptor)
            info = os.fstat(descriptor)
            guarded(
                info.st_uid == expected_uid
                and info.st_gid == expected_gid
                and stat.S_IMODE(info.st_mode) == 0o600
                and info.st_nlink == 1,
                "receipt",
            )
        finally:
            os.close(descriptor)
            descriptor = None
        os.link(temporary, path, follow_symlinks=False)
        os.unlink(temporary)
        temporary = None
        published = path.lstat()
        guarded(
            stat.S_ISREG(published.st_mode)
            and not stat.S_ISLNK(published.st_mode)
            and published.st_uid == expected_uid
            and published.st_gid == expected_gid
            and stat.S_IMODE(published.st_mode) == 0o600
            and published.st_nlink == 1
            and published.st_size == len(receipt),
            "receipt",
        )
        directory = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    except MigrationError:
        raise
    except OSError as error:
        raise MigrationError("receipt") from error
    finally:
        if descriptor is not None:
            try:
                os.close(descriptor)
            except OSError:
                pass
        if temporary is not None:
            try:
                os.unlink(temporary)
            except OSError:
                pass


def verify_existing_receipt(
    path: Path,
    verification_sha256: str,
    *,
    expected_uid: int = 0,
    expected_gid: int = 0,
) -> None:
    expected = canonical_bytes(
        {
            "schema": RECEIPT_SCHEMA,
            "status": "applied",
            "artifact_sha256": EXPECTED_ARTIFACT_SHA256,
            "database_fingerprint": EXPECTED_DATABASE_FINGERPRINT,
            "verification_sha256": verification_sha256,
        },
    )
    guarded(
        secure_read(path, expected_uid=expected_uid, expected_gid=expected_gid) == expected,
        "receipt",
    )


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--prepare", action="store_true")
    modes.add_argument("--apply", action="store_true")
    modes.add_argument("--recover-receipt", action="store_true")
    parser.add_argument("--sql", required=True, type=Path)
    parser.add_argument("--receipt", type=Path)
    return parser.parse_args(argv)


def run(arguments: argparse.Namespace) -> int:
    try:
        guarded(os.geteuid() == 0, "root")
        sql = secure_read(arguments.sql)
        guarded(sha256_bytes(sql) == EXPECTED_ARTIFACT_SHA256, "artifact")
        inspect_active_container()
        if arguments.prepare:
            guarded(arguments.receipt is None, "arguments")
            document = run_database("prepare")
            guarded(
                document.get("identity_fingerprint") == EXPECTED_DATABASE_FINGERPRINT
                and document.get("catalog_fingerprint") == EXPECTED_BEFORE_CATALOG_FINGERPRINT,
                "verification",
            )
            print("migration=PREPARE_READY apply=NOT_RUN")
            return 0
        guarded(arguments.receipt is not None, "arguments")
        if arguments.recover_receipt:
            document = run_database("recover")
            guarded(isinstance(document.get("node_verification"), Mapping), "verification")
            _after_fingerprint, verification_sha256 = verify_recovery(document)
            if os.path.lexists(arguments.receipt):
                verify_existing_receipt(arguments.receipt, verification_sha256)
                print("migration=ALREADY_APPLIED receipt=ALREADY_PRESENT")
                return 0
            write_receipt(arguments.receipt, verification_sha256)
            print("migration=ALREADY_APPLIED receipt=RECOVERED")
            return 0
        guarded(not os.path.lexists(arguments.receipt), "receipt")
        document = run_database("apply", sql)
        guarded(isinstance(document.get("node_verification"), Mapping), "verification")
        _after_fingerprint, verification_sha256 = verify_after(document)
        write_receipt(arguments.receipt, verification_sha256)
        print("migration=APPLIED receipt=WRITTEN")
        return 0
    except MigrationError as error:
        print("migration=BLOCKED stage=" + error.stage)
        return 1
    except (KeyboardInterrupt, OSError):
        print("migration=BLOCKED stage=operator")
        return 1


def main(argv: Sequence[str] | None = None) -> int:
    return run(parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
