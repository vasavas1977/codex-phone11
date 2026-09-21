"""Hermetic checks and an optional disposable PostgreSQL 16 operator rehearsal."""

from __future__ import annotations

import importlib.util
import argparse
import contextlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
import uuid
from unittest.mock import patch


ROOT = Path(__file__).parents[1]
SCRIPT = ROOT / "scripts" / "phone11-tenant-settings-migrate.py"
SQL = ROOT / "server" / "pbx" / "tenant-settings-migration.sql"
SPEC = importlib.util.spec_from_file_location("phone11_tenant_settings_operator", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
operator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(operator)


def fixture_environment(host: str, port: int, database: str) -> dict[str, str]:
    return {
        "PG_HOST": host,
        "PG_PORT": str(port),
        "PG_USER": "phone11ai",
        "PG_PASSWORD": "test-only",
        "PG_DATABASE": database,
        "PG_SSL": "false",
    }


def proof_files(root: Path, *, now: int, backup_sha: str = "a" * 64) -> tuple[Path, Path]:
    backup = root / "backup.json"
    restore = root / "restore.json"
    backup.write_text(json.dumps({
        "schema": operator.BACKUP_PROOF_SCHEMA,
        "database_identity_sha256": operator.EXPECTED_DATABASE_IDENTITY_SHA256,
        "backup_sha256": backup_sha,
        "created_at_unix": now,
        "mechanism": "cp11-postgres:pg_dump",
    }))
    restore.write_text(json.dumps({
        "schema": operator.RESTORE_PROOF_SCHEMA,
        "database_identity_sha256": operator.EXPECTED_DATABASE_IDENTITY_SHA256,
        "backup_sha256": backup_sha,
        "restored_at_unix": now + 1,
        "mechanism": "cp11-postgres:pg_restore",
        "isolation": "separate_postgres_cluster",
        "catalog_verified": True,
    }))
    for path in (backup, restore):
        os.chmod(path, 0o600)
    return backup, restore


class OperatorUnitTests(unittest.TestCase):
    def test_source_migration_digest_is_pinned(self) -> None:
        self.assertEqual(operator.sha256_bytes(SQL.read_bytes()), operator.EXPECTED_ARTIFACT_SHA256)

    def test_backup_and_restore_proofs_must_be_fresh_and_linked(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            os.chmod(root, 0o700)
            backup, restore = proof_files(root, now=1_000_000)
            first, second = operator.read_proofs(
                backup,
                restore,
                now=1_000_010,
                uid=os.getuid(),
                gid=os.getgid(),
            )
            self.assertRegex(first, r"^[0-9a-f]{64}$")
            self.assertRegex(second, r"^[0-9a-f]{64}$")
            document = json.loads(restore.read_text())
            document["isolation"] = "same_postgres_cluster"
            restore.write_text(json.dumps(document))
            os.chmod(restore, 0o600)
            with self.assertRaises(operator.MigrationError):
                operator.read_proofs(backup, restore, now=1_000_010, uid=os.getuid(), gid=os.getgid())

    def test_recovery_accepts_only_the_unchanged_proofs_pinned_by_intent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            os.chmod(root, 0o700)
            backup, restore = proof_files(root, now=1_000_000)
            hashes = operator.read_proofs(
                backup,
                restore,
                now=2_000_000,
                uid=os.getuid(),
                gid=os.getgid(),
                require_fresh=False,
            )
            self.assertEqual(len(hashes), 2)
            restore.write_text(restore.read_text() + " ")
            os.chmod(restore, 0o600)
            changed = operator.read_proofs(
                backup,
                restore,
                now=2_000_000,
                uid=os.getuid(),
                gid=os.getgid(),
                require_fresh=False,
            )
            self.assertNotEqual(changed, hashes)

    def test_prepared_state_requires_the_pinned_absent_catalog(self) -> None:
        document = {
            "before": {
                "identity_fingerprint": operator.EXPECTED_DATABASE_IDENTITY_SHA256,
                "catalog_fingerprint": operator.EXPECTED_BEFORE_CATALOG_SHA256,
                "target_state": "absent",
            },
        }
        operator.assert_prepared(document)
        document["before"]["target_state"] = "compatible"
        with self.assertRaises(operator.MigrationError):
            operator.assert_prepared(document)

    def test_container_and_database_command_failures_fail_closed(self) -> None:
        failed = subprocess.CompletedProcess([], 1, b"", b"")
        with patch.object(operator.subprocess, "run", return_value=failed):
            with self.assertRaises(operator.MigrationError):
                operator.inspect_target()
            with self.assertRaises(operator.MigrationError):
                operator.run_database("prepare")

    def test_target_is_inspected_and_executed_by_full_immutable_id(self) -> None:
        inspection = [{
            "Id": operator.TARGET_CONTAINER_ID,
            "Name": "/" + operator.TARGET_CONTAINER,
            "Image": operator.TARGET_IMAGE,
            "State": {"Running": True, "Health": {"Status": "healthy"}},
            "HostConfig": {"PortBindings": {operator.TARGET_PORT: [{"HostIp": "127.0.0.1", "HostPort": "3003"}]}},
        }]
        completed = [
            subprocess.CompletedProcess([], 0, json.dumps(inspection).encode(), b""),
            subprocess.CompletedProcess([], 0, b'{"before":{}}', b""),
        ]
        with patch.object(operator.subprocess, "run", side_effect=completed) as invoked:
            operator.run_database("prepare")
        self.assertEqual(invoked.call_args_list[0].args[0][-1], operator.TARGET_CONTAINER_ID)
        self.assertEqual(invoked.call_args_list[1].args[0][4], operator.TARGET_CONTAINER_ID)

    def test_fixture_environment_does_not_inherit_connection_overrides(self) -> None:
        with patch.dict(os.environ, {
            "PG_CONNECTION_STRING": "postgresql://external.invalid/customer",
            "DATABASE_URL": "postgresql://external.invalid/customer",
            "PGSERVICE": "customer",
            "PGPASSFILE": "/external/passfile",
        }):
            environment = fixture_environment("/isolated/socket", 5432, "fixture")
        self.assertEqual(set(environment), {"PG_HOST", "PG_PORT", "PG_USER", "PG_PASSWORD", "PG_DATABASE", "PG_SSL"})
        self.assertEqual(environment["PG_HOST"], "/isolated/socket")

    def test_receipt_reserves_intent_exclusively_and_transitions_atomically(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            os.chmod(root, 0o700)
            receipt = root / "receipt.json"
            base = operator.receipt_base("a" * 64, "b" * 64)
            intent = operator.reserve_receipt(receipt, base, uid=os.getuid(), gid=os.getgid())
            self.assertEqual(intent["status"], "intent")
            with self.assertRaises(operator.MigrationError):
                operator.reserve_receipt(receipt, base, uid=os.getuid(), gid=os.getgid())
            applied = operator.receipt_document(
                base,
                "applied",
                after_catalog_sha256="c" * 64,
                verification_sha256="d" * 64,
            )
            operator.write_receipt(
                receipt,
                applied,
                expected=intent,
                uid=os.getuid(),
                gid=os.getgid(),
            )
            self.assertEqual(receipt.stat().st_mode & 0o777, 0o600)
            self.assertEqual(operator.read_receipt(receipt, base, uid=os.getuid(), gid=os.getgid()), applied)

    def test_apply_reserves_durable_intent_before_any_database_mutation(self) -> None:
        events: list[str] = []
        arguments = argparse.Namespace(
            prepare=False,
            apply=True,
            recover=False,
            sql=Path("/sql"),
            backup_proof=Path("/backup"),
            restore_proof=Path("/restore"),
            receipt=operator.RECEIPT_PATH,
        )
        def reserve(*_args, **_kwargs):
            events.append("intent")
            return {"status": "intent"}
        def database(*_args, **_kwargs):
            events.append("database")
            raise operator.MigrationError("database")
        with (
            patch.object(operator.os, "geteuid", return_value=0),
            patch.object(operator, "secure_read", return_value=SQL.read_bytes()),
            patch.object(operator, "read_proofs", return_value=("a" * 64, "b" * 64)),
            patch.object(operator, "operator_lock", return_value=contextlib.nullcontext()),
            patch.object(operator, "reserve_receipt", side_effect=reserve),
            patch.object(operator, "run_database", side_effect=database),
        ):
            self.assertEqual(operator.run(arguments), 1)
        self.assertEqual(events, ["intent", "database"])

    def test_apply_rejects_an_alternate_journal_path_before_database_access(self) -> None:
        arguments = argparse.Namespace(
            prepare=False,
            apply=True,
            recover=False,
            sql=Path("/sql"),
            backup_proof=Path("/backup"),
            restore_proof=Path("/restore"),
            receipt=Path("/tmp/bypass.json"),
        )
        with (
            patch.object(operator.os, "geteuid", return_value=0),
            patch.object(operator, "secure_read", return_value=SQL.read_bytes()),
            patch.object(operator, "read_proofs", return_value=("a" * 64, "b" * 64)),
            patch.object(operator, "operator_lock", return_value=contextlib.nullcontext()),
            patch.object(operator, "run_database") as database,
        ):
            self.assertEqual(operator.run(arguments), 1)
        database.assert_not_called()

    def test_recovery_uses_read_only_database_action_and_finalizes_intent(self) -> None:
        arguments = argparse.Namespace(
            prepare=False,
            apply=False,
            recover=True,
            sql=Path("/sql"),
            backup_proof=Path("/backup"),
            restore_proof=Path("/restore"),
            receipt=operator.RECEIPT_PATH,
        )
        base = operator.receipt_base("a" * 64, "b" * 64)
        intent = operator.receipt_document(base, "intent")
        with (
            patch.object(operator.os, "geteuid", return_value=0),
            patch.object(operator, "secure_read", return_value=SQL.read_bytes()),
            patch.object(operator, "read_proofs", return_value=("a" * 64, "b" * 64)),
            patch.object(operator, "operator_lock", return_value=contextlib.nullcontext()),
            patch.object(operator, "read_receipt", return_value=intent),
            patch.object(operator, "run_database", return_value={"before": {}}) as database,
            patch.object(operator, "assess_recovery", return_value=("not_applied", None, None)),
            patch.object(operator, "write_receipt") as write,
        ):
            self.assertEqual(operator.run(arguments), 0)
        database.assert_called_once_with("recover")
        write.assert_called_once_with(
            operator.RECEIPT_PATH,
            operator.receipt_document(base, "not_applied"),
            expected=intent,
        )

    def test_recovery_classifies_an_exact_absent_state_without_retrying(self) -> None:
        document = {"before": {
            "identity_fingerprint": operator.EXPECTED_DATABASE_IDENTITY_SHA256,
            "catalog_fingerprint": operator.EXPECTED_BEFORE_CATALOG_SHA256,
            "target_state": "absent",
            "catalog": {},
        }}
        self.assertEqual(operator.assess_recovery(document), ("not_applied", None, None))


class PostgreSQL16OperatorRehearsal(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.temporary = tempfile.TemporaryDirectory(prefix="phone11-tenant-operator-pg16-")
        cls.root = Path(cls.temporary.name)
        cls.postgres_container_id = None
        postgres_image = os.environ.get("PHONE11_PG16_DOCKER_IMAGE")
        node_image = os.environ.get("PHONE11_NODE_DOCKER_IMAGE")
        if postgres_image or node_image:
            if not postgres_image or not node_image:
                raise unittest.SkipTest("both isolated Docker image IDs are required")
            cls.setup_docker_fixture(postgres_image, node_image)
            return
        bindir = Path(os.environ.get("PHONE11_PG16_BINDIR", "/opt/homebrew/opt/postgresql@16/bin"))
        tools = [bindir / name for name in ("initdb", "pg_ctl", "psql")]
        if not all(path.is_file() and os.access(path, os.X_OK) for path in tools):
            raise unittest.SkipTest("PostgreSQL 16 binaries are not provisioned; set PHONE11_PG16_BINDIR to an isolated PostgreSQL 16 installation")
        version = subprocess.run([str(tools[0]), "--version"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, check=True).stdout
        if "PostgreSQL) 16." not in version:
            raise unittest.SkipTest("PHONE11_PG16_BINDIR is not PostgreSQL 16")
        cls.initdb_bin, cls.pg_ctl_bin, cls.psql_bin = map(str, tools)
        cls.node_executable = shutil.which("node")
        if not cls.node_executable:
            raise unittest.SkipTest("Node.js is unavailable")
        cls.fixture_kind = "local"
        cls.data = cls.root / "data"
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
        cls.port = probe.getsockname()[1]
        cls.host = "127.0.0.1"
        cls.psql_host = cls.host
        subprocess.run([cls.initdb_bin, "-D", str(cls.data), "-A", "trust", "-U", "phone11ai"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        subprocess.run([cls.pg_ctl_bin, "-D", str(cls.data), "-o", f"-h 127.0.0.1 -p {cls.port}", "-w", "start"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)

    @classmethod
    def setup_docker_fixture(cls, postgres_image: str, node_image: str) -> None:
        if not all(value.startswith("sha256:") and len(value) == 71 for value in (postgres_image, node_image)):
            raise unittest.SkipTest("Docker fixtures require exact sha256 image IDs")
        cls.docker_bin = shutil.which("docker")
        if not cls.docker_bin:
            raise unittest.SkipTest("Docker is unavailable")
        cls.fixture_kind = "docker"
        cls.node_image = node_image
        cls.port = 5432
        cls.host = "/phone11-socket"
        cls.psql_host = "/var/run/postgresql"
        suffix = uuid.uuid4().hex[:12]
        name = "phone11-tenant-pg16-" + suffix
        cls.socket_volume = "phone11-tenant-socket-" + suffix
        subprocess.run([cls.docker_bin, "volume", "create", cls.socket_volume], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, check=True, timeout=20)
        command = [
            cls.docker_bin, "run", "--detach", "--network", "none",
            "--cpus", "0.50", "--memory", "512m", "--pids-limit", "128",
            "--name", name,
            "--tmpfs", "/var/lib/postgresql/data:rw,nosuid,nodev,size=384m",
            "--mount", f"type=volume,source={cls.socket_volume},target=/var/run/postgresql",
            "--env", "POSTGRES_USER=phone11ai", "--env", "POSTGRES_PASSWORD=test-only",
            "--env", "POSTGRES_DB=postgres", postgres_image,
            "-c", "listen_addresses=",
            "-c", "max_connections=20",
        ]
        started = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True, timeout=60)
        cls.postgres_container_id = started.stdout.strip()
        if len(cls.postgres_container_id) != 64:
            raise RuntimeError("isolated PostgreSQL container did not return a full ID")
        deadline = time.monotonic() + 45
        ready = None
        consecutive_ready = 0
        while time.monotonic() < deadline:
            ready = subprocess.run(
                [cls.docker_bin, "exec", cls.postgres_container_id, "pg_isready", "-h", cls.psql_host, "-U", "phone11ai", "-d", "postgres"],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, check=False, timeout=10,
            )
            if ready.returncode == 0:
                consecutive_ready += 1
                if consecutive_ready >= 3:
                    break
            else:
                consecutive_ready = 0
            time.sleep(0.25)
        else:
            logs = subprocess.run(
                [cls.docker_bin, "logs", "--tail", "40", cls.postgres_container_id],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, check=False, timeout=10,
            ).stdout
            subprocess.run([cls.docker_bin, "rm", "--force", cls.postgres_container_id], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False, timeout=30)
            cls.postgres_container_id = None
            subprocess.run([cls.docker_bin, "volume", "rm", cls.socket_volume], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False, timeout=20)
            raise RuntimeError("isolated PostgreSQL 16 fixture did not become ready: " + (ready.stdout if ready else "") + logs)
        version_result = cls.run_psql("postgres", "SHOW server_version_num;", check=True)
        version = version_result.stdout.strip()
        if not version.startswith("16"):
            subprocess.run([cls.docker_bin, "rm", "--force", cls.postgres_container_id], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False, timeout=30)
            cls.postgres_container_id = None
            subprocess.run([cls.docker_bin, "volume", "rm", cls.socket_volume], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False, timeout=20)
            raise RuntimeError(f"isolated Docker fixture is not PostgreSQL 16: stdout={version!r} stderr={version_result.stderr!r}")

    @classmethod
    def tearDownClass(cls) -> None:
        if getattr(cls, "postgres_container_id", None):
            subprocess.run([cls.docker_bin, "rm", "--force", cls.postgres_container_id], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False, timeout=30)
        if getattr(cls, "socket_volume", None):
            subprocess.run([cls.docker_bin, "volume", "rm", cls.socket_volume], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False, timeout=20)
        if hasattr(cls, "pg_ctl_bin"):
            subprocess.run([cls.pg_ctl_bin, "-D", str(cls.data), "-m", "immediate", "-w", "stop"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        if hasattr(cls, "temporary"):
            cls.temporary.cleanup()

    @classmethod
    def run_psql(cls, database: str, sql: str, *, check: bool = False) -> subprocess.CompletedProcess:
        if cls.fixture_kind == "docker":
            command = [cls.docker_bin, "exec", "--interactive", "--env", "PGPASSWORD=test-only", cls.postgres_container_id, "psql"]
        else:
            command = [cls.psql_bin]
        return subprocess.run(command + ["-h", cls.psql_host, "-p", str(cls.port), "-U", "phone11ai", "-d", database, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"], input=sql, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=check, timeout=40)

    def environment(self, database: str) -> dict[str, str]:
        return fixture_environment(self.host, self.port, database)

    def node(self, action: str, database: str, contract: dict, sql: str = "") -> subprocess.CompletedProcess:
        environment = self.environment(database)
        program = operator.NODE_PROGRAM.replace(
            "} catch (_error) {\n",
            "} catch (_error) { process.stderr.write(String(_error?.message ?? _error));\n",
            1,
        )
        if self.fixture_kind == "docker":
            command = [
                self.docker_bin, "run", "--rm", "--interactive", "--network", "none", "--read-only",
                "--cpus", "0.50", "--memory", "256m", "--pids-limit", "64",
                "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
                "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=16m",
                "--mount", f"type=volume,source={self.socket_volume},target=/phone11-socket,readonly",
                "--workdir", "/app",
            ]
            for key, value in environment.items():
                command.extend(["--env", f"{key}={value}"])
            command.extend([self.node_image, "node", "-e", program, action, json.dumps(contract, separators=(",", ":"))])
            return subprocess.run(command, input=sql, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=False, timeout=45)
        return subprocess.run([self.node_executable, "-e", program, action, json.dumps(contract, separators=(",", ":"))], input=sql, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, cwd=ROOT, env=environment, check=False, timeout=45)

    def snapshot(self, database: str) -> dict:
        result = self.node("prepare", database, {})
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)["before"]

    def new_database(self, database: str) -> None:
        self.run_psql("postgres", f'CREATE DATABASE "{database}";', check=True)
        self.run_psql(database, "CREATE TABLE tenants (id INTEGER PRIMARY KEY, status TEXT NOT NULL DEFAULT 'active');", check=True)

    def contract(self, snapshot: dict) -> dict:
        return {"database_identity_sha256": snapshot["identity_fingerprint"], "before_catalog_sha256": snapshot["catalog_fingerprint"]}

    def test_apply_rerun_wrong_target_and_rollback_are_bounded(self) -> None:
        database = "tenant_operator_success"
        self.new_database(database)
        before = self.snapshot(database)
        self.assertEqual(before["target_state"], "absent")
        applied = self.node("apply", database, self.contract(before), SQL.read_text())
        self.assertEqual(applied.returncode, 0, applied.stderr)
        self.assertEqual(json.loads(applied.stdout)["after"]["target_state"], "compatible")
        self.assertNotEqual(self.node("apply", database, self.contract(before), SQL.read_text()).returncode, 0)
        recovered = self.node("recover", database, self.contract(before))
        self.assertEqual(recovered.returncode, 0, recovered.stderr)
        self.assertEqual(operator.assess_recovery(
            json.loads(recovered.stdout),
            expected_identity_sha256=before["identity_fingerprint"],
            expected_before_sha256=before["catalog_fingerprint"],
        )[0], "applied")

        wrong_database = "tenant_operator_wrong_target"
        self.new_database(wrong_database)
        refused = self.node("apply", wrong_database, {"database_identity_sha256": "0" * 64, "before_catalog_sha256": "0" * 64}, SQL.read_text())
        self.assertNotEqual(refused.returncode, 0)
        self.assertEqual(self.run_psql(wrong_database, "SELECT to_regclass('tenant_settings') IS NULL;", check=True).stdout.strip(), "t")

        rollback_database = "tenant_operator_rollback"
        self.new_database(rollback_database)
        rollback_before = self.snapshot(rollback_database)
        invalid = "BEGIN;\nCREATE TABLE tenant_settings (tenant_id INTEGER); SELECT missing_column FROM definitely_missing;\nCOMMIT;\n"
        failed = self.node("apply", rollback_database, self.contract(rollback_before), invalid)
        self.assertNotEqual(failed.returncode, 0)
        self.assertEqual(self.run_psql(rollback_database, "SELECT to_regclass('tenant_settings') IS NULL;", check=True).stdout.strip(), "t")
        rollback_recovery = self.node("recover", rollback_database, self.contract(rollback_before))
        self.assertEqual(rollback_recovery.returncode, 0, rollback_recovery.stderr)
        self.assertEqual(operator.assess_recovery(
            json.loads(rollback_recovery.stdout),
            expected_identity_sha256=rollback_before["identity_fingerprint"],
            expected_before_sha256=rollback_before["catalog_fingerprint"],
        ), ("not_applied", None, None))

        incompatible_database = "tenant_operator_recovery_failure"
        self.new_database(incompatible_database)
        incompatible_before = self.snapshot(incompatible_database)
        self.run_psql(incompatible_database, "CREATE TABLE tenant_settings (tenant_id INTEGER);", check=True)
        incompatible = self.node("recover", incompatible_database, self.contract(incompatible_before))
        self.assertEqual(incompatible.returncode, 0, incompatible.stderr)
        with self.assertRaises(operator.MigrationError):
            operator.assess_recovery(
                json.loads(incompatible.stdout),
                expected_identity_sha256=incompatible_before["identity_fingerprint"],
                expected_before_sha256=incompatible_before["catalog_fingerprint"],
            )


if __name__ == "__main__":
    unittest.main()
