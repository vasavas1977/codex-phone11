"""Real PostgreSQL rehearsal for the guarded plain-video admission delta."""

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


ROOT = Path(__file__).parents[1]
SCRIPT = ROOT / "scripts" / "phone11-plain-video-admission-migrate.py"
SQL = ROOT / "server" / "meetings" / "plain-video-admission-live-delta-20260920.sql"
FIXTURE = ROOT / "scripts" / "phone11-plain-video-admission-fixture.ts"
SPEC = importlib.util.spec_from_file_location("phone11_plain_video_migration", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
operator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(operator)

BASELINE = r"""
CREATE TABLE users(id INTEGER PRIMARY KEY);
CREATE TABLE tenants(id INTEGER PRIMARY KEY,status TEXT NOT NULL DEFAULT 'active');
CREATE TABLE tenant_memberships(
  user_id INTEGER NOT NULL REFERENCES users(id),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  status TEXT NOT NULL DEFAULT 'active',
  PRIMARY KEY(user_id,tenant_id)
);
CREATE TABLE phone11_auth_identity(
  auth_user_id TEXT PRIMARY KEY,
  legacy_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  disabled_at TIMESTAMPTZ
);
INSERT INTO users(id) VALUES (1),(2);
INSERT INTO tenants(id,status) VALUES (1,'active');
INSERT INTO tenant_memberships(user_id,tenant_id,status)
VALUES (1,1,'active'),(2,1,'active');
INSERT INTO phone11_auth_identity(auth_user_id,legacy_user_id,disabled_at)
VALUES ('pilot-1',1,NULL),('pilot-2',2,NULL);
"""


class OperatorUnitTests(unittest.TestCase):
    def test_artifact_hash_is_pinned(self) -> None:
        self.assertEqual(operator.sha256(SQL.read_bytes()), operator.EXPECTED_ARTIFACT_SHA256)

    def test_atomic_receipt_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            os.chmod(root, 0o700)
            path = root / "receipt.json"
            operator.write_receipt(path, "1" * 64, os.getuid(), os.getgid())
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(
                operator.secure_read(path, os.getuid(), os.getgid()),
                operator.receipt_bytes("1" * 64),
            )
            with self.assertRaises(operator.MigrationError):
                operator.write_receipt(path, "2" * 64, os.getuid(), os.getgid())


class DisposablePostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        tools = [shutil.which(name) for name in ("initdb", "pg_ctl", "psql", "node")]
        cls.tsx = ROOT / "node_modules" / ".bin" / "tsx"
        if not all(tools) or not cls.tsx.exists():
            raise unittest.SkipTest("PostgreSQL/Node test tools unavailable")
        cls.initdb, cls.pg_ctl, cls.psql, cls.node = tools
        cls.temporary = tempfile.TemporaryDirectory(prefix="p11v-")
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

    def psql_run(self, database: str, sql: str, check: bool = False) -> subprocess.CompletedProcess:
        return subprocess.run(
            [self.psql, "-h", "127.0.0.1", "-p", str(self.port), "-U", "phone11ai", "-d", database, "-X", "-q", "-v", "ON_ERROR_STOP=1"],
            input=sql,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=check,
            timeout=40,
        )

    def new_database(self, name: str) -> None:
        self.psql_run("postgres", f'CREATE DATABASE "{name}";', True)
        self.psql_run(name, BASELINE, True)

    def environment(self, database: str) -> dict[str, str]:
        result = os.environ.copy()
        result.update({
            "PG_HOST": "127.0.0.1",
            "PG_PORT": str(self.port),
            "PG_USER": "phone11ai",
            "PG_PASSWORD": "unused-local-test-value",
            "PG_DATABASE": database,
            "PG_SSL": "false",
        })
        return result

    def snapshot(self, database: str) -> dict:
        pin = "if(sha(id)!==contract.database_fingerprint||(action!=='recover'&&sha(before)!==contract.before_catalog_fingerprint))throw Error('pin');"
        program = operator.NODE_PROGRAM.replace(pin, "")
        self.assertNotEqual(program, operator.NODE_PROGRAM)
        result = subprocess.run(
            [self.node, "-e", program, "prepare", json.dumps(operator.contract())],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=self.environment(database),
            check=True,
            timeout=40,
        )
        return json.loads(result.stdout)

    def apply(self, database: str, before: dict) -> subprocess.CompletedProcess:
        contract = operator.contract()
        contract["database_fingerprint"] = before["identity_fingerprint"]
        contract["before_catalog_fingerprint"] = before["catalog_fingerprint"]
        return subprocess.run(
            [self.node, "-e", operator.NODE_PROGRAM, "apply", json.dumps(contract)],
            input=SQL.read_text(),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=self.environment(database),
            check=False,
            timeout=40,
        )

    def recover(self, database: str, before: dict) -> subprocess.CompletedProcess:
        contract = operator.contract()
        contract["database_fingerprint"] = before["identity_fingerprint"]
        contract["before_catalog_fingerprint"] = before["catalog_fingerprint"]
        return subprocess.run(
            [self.node, "-e", operator.NODE_PROGRAM, "recover", json.dumps(contract)],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=self.environment(database),
            check=False,
            timeout=40,
        )

    def targets_absent(self, database: str) -> bool:
        result = self.psql_run(
            database,
            "SELECT count(*)=0 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname LIKE 'phone11_plain_video_%';",
            True,
        )
        return "t" in result.stdout

    def test_guarded_apply_and_actual_fixture_dry_run_then_apply(self) -> None:
        database = "video_success"
        self.new_database(database)
        before = self.snapshot(database)
        applied = self.apply(database, before)
        self.assertEqual(applied.returncode, 0, applied.stderr)
        document = json.loads(applied.stdout)
        self.assertEqual(document["proof"]["target_fingerprint"], operator.EXPECTED_TARGET_FINGERPRINT)

        fixture_env = self.environment(database)
        fixture_env["PHONE11_PLAIN_VIDEO_ADMISSION_DATABASE_URL"] = (
            f"postgresql://phone11ai@127.0.0.1:{self.port}/{database}?sslmode=disable"
        )
        arguments = [str(self.tsx), str(FIXTURE), "--tenant-id", "1", "--user-id", "1", "--user-id", "2"]
        dry_run = subprocess.run(
            [*arguments, "--dry-run"], env=fixture_env, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True, check=False, timeout=40,
        )
        self.assertEqual(dry_run.returncode, 0, dry_run.stderr)
        self.assertIn("dry run passed", dry_run.stdout)
        empty = self.psql_run(database, "SELECT count(*)=0 FROM phone11_plain_video_admission_rooms;", True)
        self.assertIn("t", empty.stdout)
        fixture = subprocess.run(
            [*arguments, "--apply"], env=fixture_env, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True, check=False, timeout=40,
        )
        self.assertEqual(fixture.returncode, 0, fixture.stderr)
        counts = self.psql_run(
            database,
            "SELECT (SELECT count(*) FROM phone11_plain_video_admission_rooms)=1 AND (SELECT count(*) FROM phone11_plain_video_admission_members)=2;",
            True,
        )
        self.assertIn("t", counts.stdout)

    def test_default_grant_post_shape_failure_rolls_back(self) -> None:
        database = "video_default_grant"
        self.new_database(database)
        self.psql_run("postgres", "CREATE ROLE video_leak;", True)
        self.psql_run(
            database,
            "ALTER DEFAULT PRIVILEGES FOR ROLE phone11ai IN SCHEMA public GRANT SELECT ON TABLES TO video_leak;",
            True,
        )
        result = self.apply(database, self.snapshot(database))
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(self.targets_absent(database))

    def test_recovery_rejects_mutated_revision_trigger_function_body(self) -> None:
        database = "video_trigger_tamper"
        self.new_database(database)
        before = self.snapshot(database)
        applied = self.apply(database, before)
        self.assertEqual(applied.returncode, 0, applied.stderr)
        self.psql_run(
            database,
            """CREATE OR REPLACE FUNCTION phone11_plain_video_admission_touch_revision()
               RETURNS trigger LANGUAGE plpgsql AS $$
               BEGIN
                 NEW.updated_at := clock_timestamp();
                 RETURN NEW;
               END;
               $$;""",
            True,
        )
        recovered = self.recover(database, before)
        self.assertNotEqual(recovered.returncode, 0)

    def test_partial_target_and_reapply_fail_closed(self) -> None:
        database = "video_partial"
        self.new_database(database)
        self.psql_run(database, "CREATE TABLE phone11_plain_video_partial(id INTEGER);", True)
        result = self.apply(database, self.snapshot(database))
        self.assertNotEqual(result.returncode, 0)
        probe = self.psql_run(database, "SELECT to_regclass('phone11_plain_video_admission_rooms') IS NULL;", True)
        self.assertIn("t", probe.stdout)

    def test_outer_advisory_lock_times_out_before_snapshot(self) -> None:
        database = "video_lock"
        self.new_database(database)
        before = self.snapshot(database)
        holder = subprocess.Popen(
            [self.psql, "-h", "127.0.0.1", "-p", str(self.port), "-U", "phone11ai", "-d", database, "-X", "-q"],
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            text=True,
        )
        assert holder.stdin is not None
        holder.stdin.write("BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('phone11-plain-video-admission-live-delta-20260920',0)); SELECT pg_sleep(6); COMMIT;\n")
        holder.stdin.close()
        time.sleep(0.5)
        started = time.monotonic()
        result = self.apply(database, before)
        elapsed = time.monotonic() - started
        holder.wait(timeout=15)
        self.assertNotEqual(result.returncode, 0)
        self.assertLess(elapsed, 5)
        self.assertTrue(self.targets_absent(database))


if __name__ == "__main__":
    unittest.main()
