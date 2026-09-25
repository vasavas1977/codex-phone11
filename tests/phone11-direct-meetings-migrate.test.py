"""Hermetic checks for the guarded direct-meeting migration operator."""

from __future__ import annotations

import argparse
import contextlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).parents[1]
SCRIPT = ROOT / "scripts" / "phone11-direct-meetings-migrate.py"
SPEC = importlib.util.spec_from_file_location("phone11_direct_meetings_operator", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
operator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(operator)


def manifest_document(sql_sha256: str = "d" * 64) -> dict:
    return {
        "schema": operator.MANIFEST_SCHEMA,
        "target": {
            "container_id": "1" * 64,
            "container_name": "cp11-api-candidate-settings",
            "image": "sha256:" + "2" * 64,
            "container_port": 3005,
            "host_port": 3005,
        },
        "release": {
            "source_sha": "3" * 40,
            "bundle_sha256": "4" * 64,
            "lock_sha256": "5" * 64,
        },
        "database_identity_sha256": "a" * 64,
        "before_catalog_sha256": "b" * 64,
        "after_catalog_sha256": "c" * 64,
        "sql_sha256": sql_sha256,
    }


def write_protected(path: Path, value: bytes | dict) -> None:
    path.write_bytes(value if isinstance(value, bytes) else operator.canonical_bytes(value))
    os.chmod(path, 0o600)


def proof_documents(manifest: dict, manifest_sha256: str, *, now: int) -> tuple[dict, dict]:
    backup = {
        "schema": operator.BACKUP_PROOF_SCHEMA,
        "manifest_sha256": manifest_sha256,
        "database_identity_sha256": manifest["database_identity_sha256"],
        "before_catalog_sha256": manifest["before_catalog_sha256"],
        "backup_sha256": "e" * 64,
        "created_at_unix": now,
        "mechanism": "cp11-postgres:pg_dump",
    }
    restore = {
        "schema": operator.RESTORE_PROOF_SCHEMA,
        "manifest_sha256": manifest_sha256,
        "database_identity_sha256": manifest["database_identity_sha256"],
        "before_catalog_sha256": manifest["before_catalog_sha256"],
        "after_catalog_sha256": manifest["after_catalog_sha256"],
        "sql_sha256": manifest["sql_sha256"],
        "backup_sha256": backup["backup_sha256"],
        "restored_at_unix": now + 1,
        "mechanism": "cp11-postgres:pg_restore",
        "isolation": "separate_postgres_cluster",
        "catalog_verified": True,
        "migration_verified": True,
    }
    return backup, restore


class DirectMeetingMigrationOperatorTests(unittest.TestCase):
    def test_distinct_receipt_and_shared_schema_advisory_key(self) -> None:
        self.assertEqual(operator.RECEIPT_PATH, Path("/var/lib/phone11-direct-meetings/receipt.json"))
        self.assertEqual(operator.LOCK_PATH, Path("/run/lock/phone11-direct-meetings-migrate.lock"))
        self.assertIn("phone11-channel-meetings-live-delta-v1", operator.NODE_PROGRAM)
        self.assertEqual(operator.MANIFEST_SCHEMA, "phone11.direct-meetings-migration-manifest/v1")

    def test_manifest_pins_container_release_database_catalogs_and_sql(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "manifest.json"
            value = manifest_document()
            write_protected(path, value)
            loaded, digest = operator.read_manifest(path, uid=os.getuid(), gid=os.getgid())
            self.assertEqual(loaded, value)
            self.assertEqual(digest, operator.sha256_bytes(path.read_bytes()))

            value["target"]["container_id"] = "short"
            write_protected(path, value)
            with self.assertRaises(operator.MigrationError):
                operator.read_manifest(path, uid=os.getuid(), gid=os.getgid())

    def test_backup_restore_proofs_are_fresh_linked_and_attest_isolated_migration(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = manifest_document()
            manifest_sha256 = operator.sha256_bytes(operator.canonical_bytes(manifest))
            backup, restore = proof_documents(manifest, manifest_sha256, now=1_000_000)
            backup_path, restore_path = root / "backup.json", root / "restore.json"
            write_protected(backup_path, backup)
            write_protected(restore_path, restore)
            digests = operator.read_proofs(
                backup_path, restore_path, manifest, manifest_sha256,
                now=1_000_010, uid=os.getuid(), gid=os.getgid(),
            )
            self.assertTrue(all(operator.is_sha256(item) for item in digests))

            restore["migration_verified"] = False
            write_protected(restore_path, restore)
            with self.assertRaises(operator.MigrationError):
                operator.read_proofs(
                    backup_path, restore_path, manifest, manifest_sha256,
                    now=1_000_010, uid=os.getuid(), gid=os.getgid(),
                )

    def test_target_inspection_uses_immutable_id_and_exact_release_labels(self) -> None:
        manifest = manifest_document()
        target, release = manifest["target"], manifest["release"]
        inspection = [{
            "Id": target["container_id"],
            "Name": "/" + target["container_name"],
            "Image": target["image"],
            "State": {"Running": True, "Health": {"Status": "healthy"}},
            "Config": {"Labels": {
                "com.phone11.source-sha": release["source_sha"],
                "com.phone11.bundle-sha256": release["bundle_sha256"],
                "com.phone11.lock-sha256": release["lock_sha256"],
            }},
            "HostConfig": {"PortBindings": {
                "3005/tcp": [{"HostIp": "127.0.0.1", "HostPort": "3005"}],
            }},
        }]
        completed = subprocess.CompletedProcess([], 0, json.dumps(inspection).encode(), b"")
        with patch.object(operator.subprocess, "run", return_value=completed) as invoked:
            self.assertEqual(operator.inspect_target(target, release), target["container_id"])
        self.assertEqual(invoked.call_args.args[0], ["/usr/bin/docker", "inspect", target["container_id"]])

        inspection[0]["Config"]["Labels"]["com.phone11.source-sha"] = "9" * 40
        completed = subprocess.CompletedProcess([], 0, json.dumps(inspection).encode(), b"")
        with patch.object(operator.subprocess, "run", return_value=completed):
            with self.assertRaises(operator.MigrationError):
                operator.inspect_target(target, release)

    def test_inventory_emits_only_nonsecret_runtime_and_database_hashes(self) -> None:
        manifest = manifest_document()
        target, release = manifest["target"], manifest["release"]
        snapshot = {"before": {
            "identity_fingerprint": manifest["database_identity_sha256"],
            "catalog_fingerprint": manifest["before_catalog_sha256"],
        }}
        with (
            patch.object(operator, "inventory_target", return_value=(target, release)),
            patch.object(operator, "run_database", return_value=snapshot) as database,
            patch.object(operator.time, "time", return_value=1234),
        ):
            value = operator.collect_inventory(
                b"reviewed sql", target["container_id"], target["container_name"], 3005, 3005,
            )
        self.assertEqual(set(value), {
            "schema", "created_at_unix", "target", "release",
            "database_identity_sha256", "before_catalog_sha256", "sql_sha256",
        })
        self.assertNotIn("after_catalog_sha256", value)
        database.assert_called_once()
        self.assertEqual(database.call_args.args[1], "snapshot")

    def test_database_exec_is_interactive_by_immutable_id_and_forwards_sql(self) -> None:
        manifest = manifest_document()
        sql = b"BEGIN;\nSELECT 'channel-meetings';\nCOMMIT;\n"
        result = subprocess.CompletedProcess([], 0, b'{"before":{},"after":{}}', b"")
        with (
            patch.object(operator, "inspect_target", return_value=manifest["target"]["container_id"]),
            patch.object(operator, "run_with_input", return_value=result) as invoked,
        ):
            operator.run_database(manifest, "apply", sql)
        command = invoked.call_args.args[0]
        self.assertEqual(command[:5], ["/usr/bin/docker", "exec", "--interactive", "--workdir", "/app"])
        self.assertEqual(command[5], manifest["target"]["container_id"])
        self.assertEqual(invoked.call_args.args[1], sql)

    def test_real_subprocess_forwards_exact_sql_bytes(self) -> None:
        sql = b"BEGIN;\nSELECT 'exact-bytes';\nCOMMIT;\n"
        result = operator.run_with_input(
            [sys.executable, "-c", "import sys;sys.stdout.buffer.write(sys.stdin.buffer.read())"],
            sql,
            timeout=10,
        )
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, sql)

    def test_node_transaction_is_bounded_advisory_locked_and_postchecked_before_commit(self) -> None:
        program = operator.NODE_PROGRAM
        self.assertIn("pg_try_advisory_xact_lock", program)
        self.assertIn("SET LOCAL lock_timeout='2000ms'", program)
        self.assertIn("SET LOCAL statement_timeout='30000ms'", program)
        self.assertLess(program.index("const before = await snapshot(client)"), program.index("await client.query(migrationBody"))
        self.assertLess(program.index("const after = await snapshot(client)"), program.index('await client.query("COMMIT")'))
        self.assertIn("after.catalog_fingerprint !== contract.after_catalog_sha256", program)

    def test_receipt_reserves_exclusive_intent_and_is_durable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            os.chmod(root, 0o700)
            path = root / "receipt.json"
            manifest = manifest_document()
            base = operator.receipt_base(manifest, "6" * 64, "7" * 64, "8" * 64)
            intent = operator.reserve_receipt(path, base, uid=os.getuid(), gid=os.getgid())
            self.assertEqual(intent["status"], "intent")
            with self.assertRaises(operator.MigrationError):
                operator.reserve_receipt(path, base, uid=os.getuid(), gid=os.getgid())
            applied = operator.receipt_document(base, "applied", "9" * 64)
            operator.write_receipt(path, applied, expected=intent, uid=os.getuid(), gid=os.getgid())
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(operator.read_receipt(path, base, uid=os.getuid(), gid=os.getgid()), applied)

    def test_apply_prevalidates_then_reserves_intent_before_database_mutation(self) -> None:
        events: list[str] = []
        manifest = manifest_document("d" * 64)
        arguments = argparse.Namespace(
            prepare=False, apply=True, recover=False,
            manifest=Path("/manifest"), sql=Path("/sql"),
            backup_proof=Path("/backup"), restore_proof=Path("/restore"),
            receipt=operator.RECEIPT_PATH,
        )
        with (
            patch.object(operator.os, "geteuid", return_value=0),
            patch.object(operator, "read_manifest", return_value=(manifest, "6" * 64)),
            patch.object(operator, "secure_read", return_value=b"sql"),
            patch.object(operator, "sha256_bytes", side_effect=lambda value: "d" * 64 if value == b"sql" else __import__("hashlib").sha256(value).hexdigest()),
            patch.object(operator, "read_proofs", return_value=("7" * 64, "8" * 64)),
            patch.object(operator, "operator_lock", return_value=contextlib.nullcontext()),
            patch.object(operator, "reserve_receipt", side_effect=lambda *_args: events.append("intent") or {"status": "intent"}),
            patch.object(operator, "run_database", side_effect=[
                {"before": {
                    "identity_fingerprint": manifest["database_identity_sha256"],
                    "catalog_fingerprint": manifest["before_catalog_sha256"],
                }},
                operator.MigrationError("database"),
            ]) as database,
        ):
            self.assertEqual(operator.run(arguments), 1)
        self.assertEqual(events, ["intent"])
        self.assertEqual([call.args[1] for call in database.call_args_list], ["snapshot", "apply"])

    def test_recovery_only_reads_snapshot_and_classifies_exact_before_or_after(self) -> None:
        manifest = manifest_document()
        before = {"before": {
            "identity_fingerprint": manifest["database_identity_sha256"],
            "catalog_fingerprint": manifest["before_catalog_sha256"],
        }}
        self.assertEqual(operator.assess_recovery(before, manifest), ("pending", None))
        after = {"before": {
            "identity_fingerprint": manifest["database_identity_sha256"],
            "catalog_fingerprint": manifest["after_catalog_sha256"],
        }}
        status, verification = operator.assess_recovery(after, manifest)
        self.assertEqual(status, "applied")
        self.assertTrue(operator.is_sha256(verification))
        after["before"]["catalog_fingerprint"] = "f" * 64
        with self.assertRaises(operator.MigrationError):
            operator.assess_recovery(after, manifest)

    def test_recovery_lock_refusal_never_finalizes_intent(self) -> None:
        sql = b"reviewed sql"
        manifest = manifest_document(operator.sha256_bytes(sql))
        base = operator.receipt_base(manifest, "6" * 64, "7" * 64, "8" * 64)
        intent = operator.receipt_document(base, "intent")
        arguments = argparse.Namespace(
            prepare=False, apply=False, recover=True, inventory=False,
            manifest=Path("/manifest"), sql=Path("/sql"),
            backup_proof=Path("/backup"), restore_proof=Path("/restore"),
            receipt=operator.RECEIPT_PATH,
            container_id=None, container_name=None, container_port=None, host_port=None,
        )
        with (
            patch.object(operator.os, "geteuid", return_value=0),
            patch.object(operator, "read_manifest", return_value=(manifest, "6" * 64)),
            patch.object(operator, "secure_read", return_value=sql),
            patch.object(operator, "read_proofs", return_value=("7" * 64, "8" * 64)),
            patch.object(operator, "operator_lock", return_value=contextlib.nullcontext()),
            patch.object(operator, "read_receipt", return_value=intent),
            patch.object(operator, "run_database", side_effect=operator.MigrationError("database")) as database,
            patch.object(operator, "write_receipt") as write,
        ):
            self.assertEqual(operator.run(arguments), 1)
        database.assert_called_once_with(manifest, "recover")
        write.assert_not_called()

    def test_recovery_pre_catalog_snapshot_keeps_intent_nonterminal(self) -> None:
        sql = b"reviewed sql"
        manifest = manifest_document(operator.sha256_bytes(sql))
        base = operator.receipt_base(manifest, "6" * 64, "7" * 64, "8" * 64)
        intent = operator.receipt_document(base, "intent")
        arguments = argparse.Namespace(
            prepare=False, apply=False, recover=True, inventory=False,
            manifest=Path("/manifest"), sql=Path("/sql"),
            backup_proof=Path("/backup"), restore_proof=Path("/restore"),
            receipt=operator.RECEIPT_PATH,
            container_id=None, container_name=None, container_port=None, host_port=None,
        )
        before = {"before": {
            "identity_fingerprint": manifest["database_identity_sha256"],
            "catalog_fingerprint": manifest["before_catalog_sha256"],
        }}
        with (
            patch.object(operator.os, "geteuid", return_value=0),
            patch.object(operator, "read_manifest", return_value=(manifest, "6" * 64)),
            patch.object(operator, "secure_read", return_value=sql),
            patch.object(operator, "read_proofs", return_value=("7" * 64, "8" * 64)),
            patch.object(operator, "operator_lock", return_value=contextlib.nullcontext()),
            patch.object(operator, "read_receipt", return_value=intent),
            patch.object(operator, "run_database", return_value=before),
            patch.object(operator, "write_receipt") as write,
        ):
            self.assertEqual(operator.run(arguments), 1)
        write.assert_not_called()


class PostgreSQLAdvisoryRecoveryOverlapTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.initdb = shutil.which("initdb")
        cls.pg_ctl = shutil.which("pg_ctl")
        cls.psql = shutil.which("psql")
        cls.node = shutil.which("node")
        if not all((cls.initdb, cls.pg_ctl, cls.psql, cls.node)):
            raise unittest.SkipTest("local PostgreSQL and Node binaries are required")
        try:
            subprocess.run(
                [cls.node, "-e", "require('pg')"], cwd=ROOT,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                check=True, timeout=10,
            )
        except (OSError, subprocess.SubprocessError):
            raise unittest.SkipTest("Node pg module is unavailable")
        cls.temporary = tempfile.TemporaryDirectory(prefix="phone11-channel-recovery-")
        cls.data = Path(cls.temporary.name) / "data"
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            cls.port = probe.getsockname()[1]
        subprocess.run(
            [cls.initdb, "-D", str(cls.data), "-A", "trust", "-U", "phone11ai"],
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True, timeout=30,
        )
        subprocess.run(
            [cls.pg_ctl, "-D", str(cls.data), "-o", f"-h 127.0.0.1 -p {cls.port}", "-w", "start"],
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True, timeout=30,
        )

    @classmethod
    def tearDownClass(cls) -> None:
        if hasattr(cls, "pg_ctl") and hasattr(cls, "data"):
            subprocess.run(
                [cls.pg_ctl, "-D", str(cls.data), "-m", "immediate", "-w", "stop"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False, timeout=30,
            )
        if hasattr(cls, "temporary"):
            cls.temporary.cleanup()

    @classmethod
    def environment(cls) -> dict[str, str]:
        return {
            "PATH": os.environ.get("PATH", ""),
            "PG_HOST": "127.0.0.1",
            "PG_PORT": str(cls.port),
            "PG_USER": "phone11ai",
            "PG_PASSWORD": "test-only",
            "PG_DATABASE": "postgres",
            "PG_SSL": "false",
        }

    @classmethod
    def node_action(cls, action: str, contract: dict, sql: str = "", *, timeout: int = 15) -> subprocess.CompletedProcess:
        return subprocess.run(
            [cls.node, "-e", operator.NODE_PROGRAM, action, json.dumps(contract, separators=(",", ":"))],
            input=sql, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            cwd=ROOT, env=cls.environment(), check=False, timeout=timeout,
        )

    @classmethod
    def psql_command(cls, sql: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            [cls.psql, "-h", "127.0.0.1", "-p", str(cls.port), "-U", "phone11ai",
             "-d", "postgres", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"],
            input=sql, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            env=cls.environment(), check=True, timeout=15,
        )

    @classmethod
    def snapshot(cls) -> dict:
        result = cls.node_action("snapshot", {})
        if result.returncode != 0:
            raise AssertionError(result.stderr)
        return json.loads(result.stdout)["before"]

    @classmethod
    def wait_for_advisory_lock(cls) -> None:
        deadline = __import__("time").monotonic() + 10
        while __import__("time").monotonic() < deadline:
            result = cls.psql_command("SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND granted;")
            if int(result.stdout.strip()) > 0:
                return
            __import__("time").sleep(0.05)
        raise AssertionError("apply transaction did not acquire its advisory lock")

    def test_recovery_cannot_classify_until_overlapping_apply_commits_or_rolls_back(self) -> None:
        before = self.snapshot()
        self.psql_command("CREATE TABLE channel_overlap(id integer PRIMARY KEY);")
        after_catalog = self.snapshot()["catalog_fingerprint"]
        self.psql_command("DROP TABLE channel_overlap;")
        self.assertEqual(self.snapshot()["catalog_fingerprint"], before["catalog_fingerprint"])

        def contract(sql: str) -> dict:
            return {
                "database_identity_sha256": before["identity_fingerprint"],
                "before_catalog_sha256": before["catalog_fingerprint"],
                "after_catalog_sha256": after_catalog,
                "sql_sha256": operator.sha256_bytes(sql.encode()),
            }

        committed_sql = "BEGIN;\nCREATE TABLE channel_overlap(id integer PRIMARY KEY);\nSELECT pg_sleep(2);\nCOMMIT;\n"
        applying = subprocess.Popen(
            [self.node, "-e", operator.NODE_PROGRAM, "apply", json.dumps(contract(committed_sql), separators=(",", ":"))],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            cwd=ROOT, env=self.environment(),
        )
        assert applying.stdin is not None
        applying.stdin.write(committed_sql)
        applying.stdin.close()
        self.wait_for_advisory_lock()
        fenced = self.node_action("recover", contract(committed_sql))
        self.assertNotEqual(fenced.returncode, 0, "recovery classified while apply still held the lock")
        applying.wait(timeout=10)
        apply_stdout = applying.stdout.read() if applying.stdout else ""
        apply_stderr = applying.stderr.read() if applying.stderr else ""
        if applying.stdout:
            applying.stdout.close()
        if applying.stderr:
            applying.stderr.close()
        self.assertEqual(applying.returncode, 0, apply_stderr + apply_stdout)
        recovered = self.node_action("recover", contract(committed_sql))
        self.assertEqual(recovered.returncode, 0, recovered.stderr)
        self.assertEqual(json.loads(recovered.stdout)["before"]["catalog_fingerprint"], after_catalog)

        self.psql_command("DROP TABLE channel_overlap;")
        rollback_sql = "BEGIN;\nCREATE TABLE channel_overlap(id integer PRIMARY KEY);\nSELECT pg_sleep(2);\nSELECT missing_column FROM channel_overlap;\nCOMMIT;\n"
        rolling_back = subprocess.Popen(
            [self.node, "-e", operator.NODE_PROGRAM, "apply", json.dumps(contract(rollback_sql), separators=(",", ":"))],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            cwd=ROOT, env=self.environment(),
        )
        assert rolling_back.stdin is not None
        rolling_back.stdin.write(rollback_sql)
        rolling_back.stdin.close()
        self.wait_for_advisory_lock()
        fenced = self.node_action("recover", contract(rollback_sql))
        self.assertNotEqual(fenced.returncode, 0, "recovery classified while rollback outcome was unknown")
        rolling_back.wait(timeout=10)
        if rolling_back.stdout:
            rolling_back.stdout.close()
        if rolling_back.stderr:
            rolling_back.stderr.close()
        self.assertNotEqual(rolling_back.returncode, 0)
        recovered = self.node_action("recover", contract(rollback_sql))
        self.assertEqual(recovered.returncode, 0, recovered.stderr)
        self.assertEqual(json.loads(recovered.stdout)["before"]["catalog_fingerprint"], before["catalog_fingerprint"])

    def test_prelock_delayed_apply_keeps_recovery_nonterminal_then_can_commit(self) -> None:
        self.psql_command("DROP TABLE IF EXISTS channel_delayed;")
        before = self.snapshot()
        self.psql_command("CREATE TABLE channel_delayed(id integer PRIMARY KEY);")
        after_catalog = self.snapshot()["catalog_fingerprint"]
        self.psql_command("DROP TABLE channel_delayed;")
        sql = "BEGIN;\nCREATE TABLE channel_delayed(id integer PRIMARY KEY);\nCOMMIT;\n"
        contract = {
            "database_identity_sha256": before["identity_fingerprint"],
            "before_catalog_sha256": before["catalog_fingerprint"],
            "after_catalog_sha256": after_catalog,
            "sql_sha256": operator.sha256_bytes(sql.encode()),
        }
        wrapper = (
            "import os,signal,sys;"
            "os.kill(os.getpid(),signal.SIGSTOP);"
            "os.execv(sys.argv[1],sys.argv[1:])"
        )
        delayed = subprocess.Popen(
            [sys.executable, "-c", wrapper, self.node, "-e", operator.NODE_PROGRAM,
             "apply", json.dumps(contract, separators=(",", ":"))],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, cwd=ROOT, env=self.environment(),
        )
        assert delayed.stdin is not None
        delayed.stdin.write(sql)
        delayed.stdin.close()
        stopped_pid, stopped_status = os.waitpid(delayed.pid, os.WUNTRACED)
        self.assertEqual(stopped_pid, delayed.pid)
        self.assertTrue(os.WIFSTOPPED(stopped_status))

        while_apply_has_not_locked = self.node_action("recover", contract)
        self.assertEqual(while_apply_has_not_locked.returncode, 0, while_apply_has_not_locked.stderr)
        snapshot = json.loads(while_apply_has_not_locked.stdout)
        self.assertEqual(operator.assess_recovery(snapshot, {
            **manifest_document(contract["sql_sha256"]),
            "database_identity_sha256": contract["database_identity_sha256"],
            "before_catalog_sha256": contract["before_catalog_sha256"],
            "after_catalog_sha256": contract["after_catalog_sha256"],
        }), ("pending", None))

        os.kill(delayed.pid, signal.SIGCONT)
        delayed.wait(timeout=10)
        delayed_stdout = delayed.stdout.read() if delayed.stdout else ""
        delayed_stderr = delayed.stderr.read() if delayed.stderr else ""
        if delayed.stdout:
            delayed.stdout.close()
        if delayed.stderr:
            delayed.stderr.close()
        self.assertEqual(delayed.returncode, 0, delayed_stderr + delayed_stdout)
        settled = self.node_action("recover", contract)
        self.assertEqual(settled.returncode, 0, settled.stderr)
        self.assertEqual(json.loads(settled.stdout)["before"]["catalog_fingerprint"], after_catalog)
        self.psql_command("DROP TABLE channel_delayed;")


if __name__ == "__main__":
    unittest.main()
