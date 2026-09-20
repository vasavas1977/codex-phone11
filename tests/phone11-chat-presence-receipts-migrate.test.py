"""Hermetic operator checks plus a real disposable PostgreSQL rehearsal."""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch


ROOT = Path(__file__).parents[1]
SCRIPT = ROOT / "scripts" / "phone11-chat-presence-receipts-migrate.py"
SQL = ROOT / "server" / "chat" / "presence-receipts-live-delta-20260920.sql"
SPEC = importlib.util.spec_from_file_location("phone11_chat_schema_operator", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
operator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(operator)


FULL_PRIVILEGES = {
    "DELETE",
    "INSERT",
    "REFERENCES",
    "SELECT",
    "TRIGGER",
    "TRUNCATE",
    "UPDATE",
}


def synthetic_catalog(*, include_targets: bool) -> dict:
    catalog = {
        "relations": [{"name": "users", "relkind": "r", "owner": "phone11ai", "rls": False, "force_rls": False}],
        "columns": [{"table_name": "users", "ordinal": 1, "column_name": "id", "data_type": "integer", "not_null": True, "default_expr": None}],
        "constraints": [{"table_name": "users", "name": "users_pkey", "type": "p", "validated": True, "deferrable": False, "definition": "PRIMARY KEY (id)"}],
        "indexes": [{"table_name": "users", "name": "users_pkey", "definition": "CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id)"}],
        "grants": [],
        "policies": [],
    }
    if not include_targets:
        return catalog
    for table, columns in operator.EXPECTED_COLUMNS.items():
        catalog["relations"].append({"name": table, "relkind": "r", "owner": "phone11ai", "rls": False, "force_rls": False})
        for ordinal, (name, data_type, not_null, default_expr) in enumerate(columns, 1):
            catalog["columns"].append({"table_name": table, "ordinal": ordinal, "column_name": name, "data_type": data_type, "not_null": not_null, "default_expr": default_expr})
        for index, definition in enumerate(sorted(operator.EXPECTED_CONSTRAINT_DEFINITIONS[table]), 1):
            catalog["constraints"].append({"table_name": table, "name": f"constraint_{index}", "type": "c", "validated": True, "deferrable": False, "definition": definition})
        for privilege in sorted(FULL_PRIVILEGES):
            catalog["grants"].append({"table_name": table, "grantee": "phone11ai", "privilege_type": privilege, "is_grantable": "YES"})
    catalog["indexes"].extend(
        {"name": name, **definition}
        for name, definition in operator.EXPECTED_INDEXES.items()
    )
    return catalog


class OperatorUnitTests(unittest.TestCase):
    def test_artifact_hash_is_pinned(self) -> None:
        self.assertEqual(operator.sha256_bytes(SQL.read_bytes()), operator.EXPECTED_ARTIFACT_SHA256)

    def test_post_verification_accepts_only_two_exact_additions(self) -> None:
        before = synthetic_catalog(include_targets=False)
        after = synthetic_catalog(include_targets=True)
        with patch.object(operator, "EXPECTED_BEFORE_CATALOG_FINGERPRINT", operator.catalog_fingerprint(before)):
            after_fingerprint, verification = operator.verify_after({
                "identity_fingerprint": operator.EXPECTED_DATABASE_FINGERPRINT,
                "before_catalog": before,
                "after_catalog": after,
            })
        self.assertEqual(after_fingerprint, operator.catalog_fingerprint(after))
        self.assertRegex(verification, r"^[0-9a-f]{64}$")

    def test_post_verification_rejects_existing_schema_drift(self) -> None:
        before = synthetic_catalog(include_targets=False)
        after = synthetic_catalog(include_targets=True)
        after["columns"][0]["data_type"] = "bigint"
        with patch.object(operator, "EXPECTED_BEFORE_CATALOG_FINGERPRINT", operator.catalog_fingerprint(before)):
            with self.assertRaises(operator.MigrationError):
                operator.verify_after({
                    "identity_fingerprint": operator.EXPECTED_DATABASE_FINGERPRINT,
                    "before_catalog": before,
                    "after_catalog": after,
                })

    def test_post_verification_rejects_wrong_identity_or_target_policy(self) -> None:
        before = synthetic_catalog(include_targets=False)
        after = synthetic_catalog(include_targets=True)
        with patch.object(operator, "EXPECTED_BEFORE_CATALOG_FINGERPRINT", operator.catalog_fingerprint(before)):
            with self.assertRaises(operator.MigrationError):
                operator.verify_after({"identity_fingerprint": "0" * 64, "before_catalog": before, "after_catalog": after})
            after["policies"].append({"tablename": "phone11_chat_read_receipts", "policyname": "unexpected"})
            with self.assertRaises(operator.MigrationError):
                operator.verify_after({
                    "identity_fingerprint": operator.EXPECTED_DATABASE_FINGERPRINT,
                    "before_catalog": before,
                    "after_catalog": after,
                })

    def test_receipt_recovery_accepts_exact_post_state_and_rejects_drift(self) -> None:
        before = synthetic_catalog(include_targets=False)
        after = synthetic_catalog(include_targets=True)
        document = {
            "identity_fingerprint": operator.EXPECTED_DATABASE_FINGERPRINT,
            "catalog": after,
        }
        with patch.object(operator, "EXPECTED_BEFORE_CATALOG_FINGERPRINT", operator.catalog_fingerprint(before)):
            after_fingerprint, verification = operator.verify_recovery(document)
            self.assertEqual(after_fingerprint, operator.catalog_fingerprint(after))
            self.assertRegex(verification, r"^[0-9a-f]{64}$")
            after["relations"][0]["owner"] = "unexpected"
            with self.assertRaises(operator.MigrationError):
                operator.verify_recovery(document)

    def test_secure_artifact_rejects_symlink_and_unsafe_mode(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            real = root / "real.sql"
            real.write_text("SELECT 1")
            os.chmod(real, 0o600)
            link = root / "link.sql"
            link.symlink_to(real)
            with self.assertRaises(operator.MigrationError):
                operator.secure_read(link, expected_uid=os.getuid(), expected_gid=os.getgid())
            os.chmod(real, 0o640)
            with self.assertRaises(operator.MigrationError):
                operator.secure_read(real, expected_uid=os.getuid(), expected_gid=os.getgid())

    def test_receipt_is_exclusive_and_operator_compatible(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            os.chmod(root, 0o700)
            path = root / "receipt.json"
            operator.write_receipt(
                path,
                "1" * 64,
                expected_uid=os.getuid(),
                expected_gid=os.getgid(),
            )
            receipt = json.loads(path.read_text())
            self.assertEqual(set(receipt), {
                "schema", "status", "artifact_sha256", "database_fingerprint", "verification_sha256",
            })
            self.assertEqual(receipt["schema"], "phone11-migration-receipt/v1")
            self.assertEqual(receipt["status"], "applied")
            self.assertEqual(receipt["artifact_sha256"], operator.EXPECTED_ARTIFACT_SHA256)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            operator.verify_existing_receipt(
                path,
                "1" * 64,
                expected_uid=os.getuid(),
                expected_gid=os.getgid(),
            )
            with self.assertRaises(operator.MigrationError):
                operator.write_receipt(
                    path,
                    "2" * 64,
                    expected_uid=os.getuid(),
                    expected_gid=os.getgid(),
                )

    def test_receipt_write_failure_never_publishes_partial_final_path(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            os.chmod(root, 0o700)
            path = root / "receipt.json"
            with patch.object(operator.os, "write", side_effect=OSError("simulated")):
                with self.assertRaises(operator.MigrationError):
                    operator.write_receipt(
                        path,
                        "1" * 64,
                        expected_uid=os.getuid(),
                        expected_gid=os.getgid(),
                    )
            self.assertFalse(path.exists())
            self.assertEqual(list(root.iterdir()), [])


BASELINE = r"""
CREATE TABLE users (id INTEGER PRIMARY KEY);
CREATE TABLE tenants (id INTEGER PRIMARY KEY, status VARCHAR(32) NOT NULL DEFAULT 'active');
CREATE TABLE tenant_memberships (
  user_id INTEGER NOT NULL REFERENCES users(id),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  status TEXT NOT NULL DEFAULT 'active',
  PRIMARY KEY (user_id, tenant_id)
);
CREATE TABLE extensions (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  deleted_at TIMESTAMPTZ
);
CREATE TABLE user_extensions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  extension_id INTEGER NOT NULL REFERENCES extensions(id),
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, extension_id)
);
CREATE TABLE phone11_chat_conversations (id UUID PRIMARY KEY);
CREATE TABLE phone11_chat_members (
  tenant_id INTEGER NOT NULL,
  conversation_id UUID NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (tenant_id, conversation_id, user_id)
);
CREATE TABLE phone11_chat_messages (
  id UUID PRIMARY KEY,
  sequence BIGINT NOT NULL,
  tenant_id INTEGER NOT NULL,
  conversation_id UUID NOT NULL,
  sender_id INTEGER NOT NULL,
  client_id UUID NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  parent_message_id UUID,
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, conversation_id, id)
);
CREATE TABLE phone11_chat_blocks (id INTEGER PRIMARY KEY);
CREATE TABLE phone11_chat_presence (tenant_id INTEGER NOT NULL, user_id INTEGER NOT NULL, PRIMARY KEY (tenant_id, user_id));
"""


class DisposablePostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        required = [shutil.which(name) for name in ("initdb", "pg_ctl", "psql", "node")]
        if not all(required):
            raise unittest.SkipTest("PostgreSQL binaries are unavailable")
        cls.initdb, cls.pg_ctl, cls.psql, cls.node = required
        cls.temporary = tempfile.TemporaryDirectory(prefix="phone11-chat-schema-")
        cls.root = Path(cls.temporary.name)
        cls.data = cls.root / "data"
        cls.socket_dir = cls.root / "socket"
        cls.socket_dir.mkdir(mode=0o700)
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            cls.port = probe.getsockname()[1]
        subprocess.run(
            [cls.initdb, "-D", str(cls.data), "-U", "phone11ai", "-A", "trust", "--no-locale", "--encoding=UTF8"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True,
            timeout=30,
        )
        subprocess.run(
            [cls.pg_ctl, "-D", str(cls.data), "-o", f"-h 127.0.0.1 -p {cls.port} -k {cls.socket_dir}", "-w", "start"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True,
            timeout=30,
        )

    @classmethod
    def tearDownClass(cls) -> None:
        if hasattr(cls, "pg_ctl"):
            subprocess.run(
                [cls.pg_ctl, "-D", str(cls.data), "-m", "immediate", "-w", "stop"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
                timeout=30,
            )
        if hasattr(cls, "temporary"):
            cls.temporary.cleanup()

    def psql_run(self, database: str, sql: str, *, check: bool = False) -> subprocess.CompletedProcess:
        return subprocess.run(
            [self.psql, "-h", "127.0.0.1", "-p", str(self.port), "-U", "phone11ai", "-d", database, "-v", "ON_ERROR_STOP=1", "-X", "-q"],
            input=sql,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=check,
            timeout=40,
        )

    def new_database(self, name: str, *, baseline: str = BASELINE) -> None:
        self.psql_run("postgres", f'CREATE DATABASE "{name}";', check=True)
        self.psql_run(name, baseline, check=True)

    def apply_delta(self, database: str) -> subprocess.CompletedProcess:
        return self.psql_run(database, "BEGIN;\n" + SQL.read_text() + "\nCOMMIT;\n")

    def node_environment(self, database: str) -> dict[str, str]:
        environment = os.environ.copy()
        environment.update({
            "PG_HOST": "127.0.0.1",
            "PG_PORT": str(self.port),
            "PG_USER": "phone11ai",
            "PG_PASSWORD": "unused-local-test-value",
            "PG_DATABASE": database,
            "PG_SSL": "false",
        })
        return environment

    def node_snapshot(self, database: str) -> dict:
        pin_check = """    if (sha(beforeIdentity) !== expectedIdentity ||
        (action !== \"recover\" && sha(beforeCatalog) !== expectedCatalog)) {
      throw new Error(\"pin\");
    }
"""
        program = operator.NODE_PROGRAM.replace(pin_check, "")
        self.assertNotEqual(program, operator.NODE_PROGRAM)
        recover_check = """      if (action === \"recover\") {
        const reconstructedBefore = withoutTargets(beforeCatalog);
        nodeVerification = verifyAfter(reconstructedBefore, beforeCatalog);
      }
"""
        program = program.replace(recover_check, "")
        self.assertNotEqual(program, operator.NODE_PROGRAM)
        result = subprocess.run(
            [self.node, "-e", program, "recover", json.dumps(operator.verification_contract())],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=self.node_environment(database),
            check=False,
            timeout=40,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def node_apply(self, database: str, before: dict) -> subprocess.CompletedProcess:
        contract = operator.verification_contract()
        contract["database_fingerprint"] = before["identity_fingerprint"]
        contract["before_catalog_fingerprint"] = before["catalog_fingerprint"]
        return subprocess.run(
            [self.node, "-e", operator.NODE_PROGRAM, "apply", json.dumps(contract)],
            input=SQL.read_text(),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=self.node_environment(database),
            check=False,
            timeout=40,
        )

    def test_real_postgres_success_and_reapply_rejection(self) -> None:
        database = "phone11_success"
        self.new_database(database)
        before = self.node_snapshot(database)
        first = self.node_apply(database, before)
        self.assertEqual(first.returncode, 0, first.stderr)
        after = self.node_snapshot(database)
        with (
            patch.object(operator, "EXPECTED_DATABASE_FINGERPRINT", after["identity_fingerprint"]),
            patch.object(operator, "EXPECTED_BEFORE_CATALOG_FINGERPRINT", before["catalog_fingerprint"]),
        ):
            operator.verify_after({
                "identity_fingerprint": after["identity_fingerprint"],
                "before_catalog": before["catalog"],
                "after_catalog": after["catalog"],
            })
        result = self.psql_run(database, "SELECT to_regclass('phone11_chat_presence_sessions') IS NOT NULL AND to_regclass('phone11_chat_read_receipts') IS NOT NULL;", check=True)
        self.assertIn("t", result.stdout)
        second = self.apply_delta(database)
        self.assertNotEqual(second.returncode, 0)

    def test_real_postgres_incompatible_prerequisite_rolls_back(self) -> None:
        database = "phone11_incompatible"
        incompatible = BASELINE.replace(",\n  UNIQUE (tenant_id, conversation_id, id)\n", "\n")
        self.new_database(database, baseline=incompatible)
        result = self.apply_delta(database)
        self.assertNotEqual(result.returncode, 0)
        probe = self.psql_run(database, "SELECT to_regclass('phone11_chat_presence_sessions') IS NULL AND to_regclass('phone11_chat_read_receipts') IS NULL;", check=True)
        self.assertIn("t", probe.stdout)

    def test_in_transaction_post_verification_rolls_back_default_grant_drift(self) -> None:
        database = "phone11_default_grant"
        self.new_database(database)
        self.psql_run("postgres", "CREATE ROLE phone11_leak;", check=True)
        self.psql_run(
            database,
            "ALTER DEFAULT PRIVILEGES FOR ROLE phone11ai IN SCHEMA public GRANT SELECT ON TABLES TO phone11_leak;",
            check=True,
        )
        before = self.node_snapshot(database)
        result = self.node_apply(database, before)
        self.assertNotEqual(result.returncode, 0)
        probe = self.psql_run(
            database,
            "SELECT to_regclass('phone11_chat_presence_sessions') IS NULL AND to_regclass('phone11_chat_read_receipts') IS NULL;",
            check=True,
        )
        self.assertIn("t", probe.stdout)

    def test_real_postgres_advisory_lock_timeout_rolls_back(self) -> None:
        database = "phone11_lock"
        self.new_database(database)
        holder = subprocess.Popen(
            [self.psql, "-h", "127.0.0.1", "-p", str(self.port), "-U", "phone11ai", "-d", database, "-v", "ON_ERROR_STOP=1", "-X", "-q"],
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            text=True,
        )
        assert holder.stdin is not None
        holder.stdin.write("BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('phone11-chat-presence-receipts-live-delta-20260920', 0)); SELECT pg_sleep(6); COMMIT;\n")
        holder.stdin.close()
        time.sleep(0.5)
        started = time.monotonic()
        result = self.apply_delta(database)
        elapsed = time.monotonic() - started
        holder.wait(timeout=15)
        self.assertNotEqual(result.returncode, 0)
        self.assertLess(elapsed, 5)
        probe = self.psql_run(database, "SELECT to_regclass('phone11_chat_presence_sessions') IS NULL AND to_regclass('phone11_chat_read_receipts') IS NULL;", check=True)
        self.assertIn("t", probe.stdout)


if __name__ == "__main__":
    unittest.main()
