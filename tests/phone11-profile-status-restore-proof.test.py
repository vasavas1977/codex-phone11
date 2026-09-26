"""Source and real-PostgreSQL checks for the status backup/restore proof."""

from __future__ import annotations

import importlib.util
import json
import os
import select
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).parents[1]
SCRIPT = ROOT / "scripts/phone11-profile-status-restore-proof.py"
SPEC = importlib.util.spec_from_file_location("phone11_status_restore", SCRIPT)
assert SPEC and SPEC.loader
helper = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(helper)


class ProofUnitTests(unittest.TestCase):
    @staticmethod
    def clone_identity() -> dict:
        return {"Id": "a" * 64, "Image": helper.POSTGRES_IMAGE,
                "HostConfig": {"NetworkMode": "none", "ReadonlyRootfs": True,
                               "PortBindings": {}, "Tmpfs": {
                                   "/var/lib/postgresql/data": "rw",
                                   "/var/run/postgresql": "rw", "/tmp": "rw"}},
                "Mounts": [
                    {"Type": "bind", "RW": False, "Destination": "/tmp/backup.dump",
                     "Source": "/private/backup.dump"},
                    {"Type": "bind", "RW": False, "Destination": "/tmp/migration.sql",
                     "Source": "/private/migration.sql"},
                ]}

    @staticmethod
    def fake_clone_command(args, **_kwargs):
        if args[1] in ("create", "start"):
            return ("a" * 64 + "\n").encode()
        return b""

    def test_rejects_nonprivate_archive_and_wrong_format(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "backup.dump"
            path.write_bytes(b"PGDMPtest")
            os.chmod(path, 0o644)
            with self.assertRaisesRegex(helper.ProofError, "backup_file"):
                helper.archive_digest(path, uid=os.getuid(), gid=os.getgid())
            os.chmod(path, 0o600)
            self.assertEqual(len(helper.archive_digest(path, uid=os.getuid(), gid=os.getgid())), 64)
            path.write_bytes(b"wrongformat")
            with self.assertRaisesRegex(helper.ProofError, "backup_format"):
                helper.archive_digest(path, uid=os.getuid(), gid=os.getgid())

    def test_output_parent_is_private_and_existing_files_block(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            os.chmod(path, 0o755)
            with self.assertRaisesRegex(helper.ProofError, "output_directory"):
                helper.private_directory(path)
            os.chmod(path, 0o700)
            with patch("os.geteuid", return_value=0), patch.object(helper, "private_directory"):
                # SQL is intentionally absent; the expected collision blocks
                # before the source or production container can be accessed.
                (path / "manifest.json").write_text("old")
                with self.assertRaisesRegex(helper.ProofError, "output_exists"):
                    helper.create_proof(path / "migration.sql", path, "a" * 64,
                                        "candidate", 3011, "b" * 64, 4096)

    def test_new_artifact_is_private_and_does_not_overwrite(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "receipt.json"
            helper.private_new(path, b"{}")
            self.assertEqual(path.read_bytes(), b"{}")
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError):
                helper.private_new(path, b"changed")
            self.assertEqual(path.read_bytes(), b"{}")

    def test_cleanup_never_removes_a_container_without_its_private_label(self) -> None:
        with patch.object(helper, "inspect_owned", side_effect=helper.ProofError("clone_identity")):
            with patch.object(helper, "command") as command:
                with self.assertRaisesRegex(helper.ProofError, "clone_identity"):
                    helper.cleanup_owned("p11status-random", "expected")
                command.assert_not_called()

    def test_inspect_failure_is_not_mistaken_for_absent_clone(self) -> None:
        result = subprocess.CompletedProcess([], 1, b"", b"daemon unavailable")
        with patch.object(helper.subprocess, "run", return_value=result):
            with self.assertRaisesRegex(helper.ProofError, "clone_inspect"):
                helper.inspect_owned("p11status-random", "expected")

    def test_failed_clone_restore_still_runs_owned_cleanup(self) -> None:
        calls = []
        def fake_command(args, **_kwargs):
            calls.append(args)
            if args[1] == "exec" and "pg_restore" in args:
                raise helper.ProofError("restore_failed")
            return self.fake_clone_command(args)
        with patch.object(helper, "command", side_effect=fake_command):
            with patch.object(helper, "inspect_owned", return_value=self.clone_identity()):
                with patch.object(helper, "clone_sql"):
                    with patch.object(helper, "cleanup_owned") as cleanup, \
                         patch.object(helper, "pending_marker", return_value=Path("/tmp/fake-marker")), \
                         patch.object(helper, "clear_pending_marker"):
                        with self.assertRaisesRegex(helper.ProofError, "restore_failed"):
                            helper.clone_rehearsal(Path("/private/backup.dump"),
                                Path("/private/migration.sql"), "sha256:" + "b" * 64,
                                ["postgres"], "c" * 64, "d" * 64, 4096, Path("/ignored"))
                        cleanup.assert_called_once()

    def test_wrong_restored_catalog_and_failed_migration_block_and_cleanup(self) -> None:
        for outcome in ("wrong_catalog", "failed_migration"):
            with self.subTest(outcome=outcome):
                if outcome == "wrong_catalog":
                    node_result = [{"before": {"catalog_fingerprint": "e" * 64}}]
                else:
                    node_result = [
                        {"before": {"catalog_fingerprint": "c" * 64}},
                        helper.ProofError("migration_failed"),
                    ]
                with patch.object(helper, "command", side_effect=self.fake_clone_command):
                    with patch.object(helper, "inspect_owned", return_value=self.clone_identity()):
                        with patch.object(helper, "clone_sql"):
                            with patch.object(helper, "clone_node", side_effect=node_result):
                                with patch.object(helper.migration, "secure_read", return_value=b"BEGIN;\nCOMMIT;\n"):
                                    with patch.object(helper, "cleanup_owned") as cleanup:
                                        with patch.object(helper, "pending_marker", return_value=Path("/tmp/fake-marker")), \
                                             patch.object(helper, "clear_pending_marker"):
                                            with self.assertRaises(helper.ProofError):
                                                helper.clone_rehearsal(Path("/private/backup.dump"),
                                                    Path("/private/migration.sql"), "sha256:" + "b" * 64,
                                                    ["postgres"], "c" * 64, "d" * 64, 4096, Path("/ignored"))
                                        cleanup.assert_called_once()

    def test_late_clone_create_or_start_keeps_manual_cleanup_gate(self) -> None:
        for phase in ("create", "start"):
            for failure in ("command_timeout", "command_exit"):
                with self.subTest(phase=phase, failure=failure), tempfile.TemporaryDirectory() as directory:
                    out_dir = Path(directory)
                    os.chmod(out_dir, 0o700)
                    def late_command(args, **_kwargs):
                        if args[1] == phase:
                            raise helper.ProofError(failure)
                        return self.fake_clone_command(args)
                    with patch.object(helper, "command", side_effect=late_command), \
                         patch.object(helper, "inspect_owned", return_value=self.clone_identity()), \
                         patch.object(helper, "cleanup_owned") as cleanup:
                        with self.assertRaisesRegex(helper.ProofError, failure):
                            helper.clone_rehearsal(Path("/private/backup.dump"),
                                Path("/private/migration.sql"), "sha256:" + "b" * 64,
                                ["postgres"], "c" * 64, "d" * 64, 4096, out_dir)
                        cleanup.assert_called_once()
                    markers = list((out_dir / "cleanup-pending").glob("*.json"))
                    self.assertEqual(len(markers), 1)
                    self.assertEqual(markers[0].stat().st_mode & 0o777, 0o600)
                    marker = json.loads(markers[0].read_text())
                    self.assertEqual(marker["schema"], "phone11.status-restore-cleanup-pending/v1")
                    self.assertTrue(marker["container_name"].startswith("p11status-"))

    def test_late_sidecar_run_keeps_manual_cleanup_gate(self) -> None:
        for failure in ("command_timeout", "command_exit"):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                out_dir = Path(directory)
                os.chmod(out_dir, 0o700)
                with patch.object(helper, "command", side_effect=helper.ProofError(failure)), \
                     patch.object(helper, "cleanup_owned") as cleanup:
                    with self.assertRaisesRegex(helper.ProofError, failure):
                        helper.clone_node("sha256:" + "b" * 64, "a" * 64,
                                          "snapshot", {}, out_dir)
                    cleanup.assert_called_once()
                markers = list((out_dir / "cleanup-pending").glob("*.json"))
                self.assertEqual(len(markers), 1)
                self.assertIn("p11status-node-", markers[0].name)

    def test_cleanup_directory_entry_is_synced_before_docker_create(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            out_dir = Path(directory)
            os.chmod(out_dir, 0o700)
            parent = out_dir.stat()
            events = []
            original_fsync = os.fsync
            def trace_fsync(fd):
                opened = os.fstat(fd)
                if (opened.st_dev, opened.st_ino) == (parent.st_dev, parent.st_ino):
                    events.append("parent_fsync")
                return original_fsync(fd)
            def failed_create(args, **_kwargs):
                events.append("docker_create")
                raise helper.ProofError("command_exit")
            with patch.object(helper.os, "fsync", side_effect=trace_fsync), \
                 patch.object(helper, "command", side_effect=failed_create), \
                 patch.object(helper, "cleanup_owned"):
                with self.assertRaisesRegex(helper.ProofError, "command_exit"):
                    helper.clone_rehearsal(Path("/private/backup.dump"),
                        Path("/private/migration.sql"), "sha256:" + "b" * 64,
                        ["postgres"], "c" * 64, "d" * 64, 4096, out_dir)
            self.assertEqual(events, ["parent_fsync", "docker_create"])
            self.assertEqual(len(list((out_dir / "cleanup-pending").glob("*.json"))), 1)

    def test_parent_sync_failure_prevents_any_docker_request(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            out_dir = Path(directory)
            os.chmod(out_dir, 0o700)
            parent = out_dir.stat()
            original_fsync = os.fsync
            def failed_parent_sync(fd):
                opened = os.fstat(fd)
                if (opened.st_dev, opened.st_ino) == (parent.st_dev, parent.st_ino):
                    raise OSError("synthetic parent fsync failure")
                return original_fsync(fd)
            with patch.object(helper.os, "fsync", side_effect=failed_parent_sync), \
                 patch.object(helper, "command") as command:
                with self.assertRaises(OSError):
                    helper.clone_rehearsal(Path("/private/backup.dump"),
                        Path("/private/migration.sql"), "sha256:" + "b" * 64,
                        ["postgres"], "c" * 64, "d" * 64, 4096, out_dir)
            command.assert_not_called()

    def test_pending_cleanup_blocks_new_proof_even_without_prior_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            out_dir = Path(directory)
            os.chmod(out_dir, 0o700)
            (out_dir / "cleanup-pending").mkdir(mode=0o700)
            with patch("os.geteuid", return_value=0), patch.object(helper, "private_directory"):
                with self.assertRaisesRegex(helper.ProofError, "cleanup_pending"):
                    helper.create_proof(out_dir / "migration.sql", out_dir, "a" * 64,
                                        "candidate", 3011, "b" * 64, 4096)

    def test_manifest_and_archive_hash_mismatch_cannot_make_proofs_valid(self) -> None:
        migration = helper.migration
        manifest = {
            "database_identity_sha256": "a" * 64,
            "before_catalog_sha256": "b" * 64,
            "after_catalog_sha256": "c" * 64,
            "sql_sha256": "d" * 64,
        }
        with tempfile.TemporaryDirectory() as directory:
            backup_path, restore_path = Path(directory) / "backup.json", Path(directory) / "restore.json"
            backup = {"schema": migration.BACKUP_PROOF_SCHEMA, "manifest_sha256": "f" * 64,
                      "database_identity_sha256": "a" * 64, "before_catalog_sha256": "b" * 64,
                      "backup_sha256": "e" * 64, "created_at_unix": 1000,
                      "mechanism": "cp11-postgres:pg_dump"}
            restore = {"schema": migration.RESTORE_PROOF_SCHEMA, "manifest_sha256": "f" * 64,
                       "database_identity_sha256": "a" * 64, "before_catalog_sha256": "b" * 64,
                       "after_catalog_sha256": "c" * 64, "sql_sha256": "d" * 64,
                       "backup_sha256": "e" * 64, "restored_at_unix": 1001,
                       "mechanism": "cp11-postgres:pg_restore",
                       "isolation": "separate_postgres_cluster",
                       "catalog_verified": True, "migration_verified": True}
            backup_path.write_bytes(migration.canonical_bytes(backup))
            restore_path.write_bytes(migration.canonical_bytes(restore))
            os.chmod(backup_path, 0o600)
            os.chmod(restore_path, 0o600)
            with self.assertRaisesRegex(migration.MigrationError, "backup_proof"):
                migration.read_proofs(backup_path, restore_path, manifest, "0" * 64,
                                      now=1002, uid=os.getuid(), gid=os.getgid())
            backup["manifest_sha256"] = "0" * 64
            restore["manifest_sha256"] = "0" * 64
            restore["backup_sha256"] = "1" * 64
            backup_path.write_bytes(migration.canonical_bytes(backup))
            restore_path.write_bytes(migration.canonical_bytes(restore))
            with self.assertRaisesRegex(migration.MigrationError, "restore_proof"):
                migration.read_proofs(backup_path, restore_path, manifest, "0" * 64,
                                      now=1002, uid=os.getuid(), gid=os.getgid())


class CrossClusterCatalogTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.node = shutil.which("node")
        cls.initdb = shutil.which("initdb")
        cls.pg_ctl = shutil.which("pg_ctl")
        cls.psql = shutil.which("psql")
        cls.pg_dump = shutil.which("pg_dump")
        cls.pg_restore = shutil.which("pg_restore")
        if not all((cls.node, cls.initdb, cls.pg_ctl, cls.psql, cls.pg_dump, cls.pg_restore)):
            raise unittest.SkipTest("PostgreSQL/Node binaries unavailable")
        cls.node_modules = Path(os.environ.get("NODE_PATH", str(ROOT / "node_modules")))
        if not cls.node_modules.exists():
            raise unittest.SkipTest("Node pg module unavailable")
        cls.temp = tempfile.TemporaryDirectory(prefix="p11status-realpg-")
        cls.base = Path(cls.temp.name)
        cls.clusters = []
        try:
            for number in (1, 2):
                data = cls.base / f"data{number}"
                sock = cls.base / f"s{number}"
                sock.mkdir(mode=0o700)
                with socket.socket() as listener:
                    listener.bind(("127.0.0.1", 0))
                    port = listener.getsockname()[1]
                subprocess.run([cls.initdb, "-D", str(data), "-U", "pgadmin",
                                "-A", "trust"], stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, check=True, timeout=45)
                subprocess.run([cls.pg_ctl, "-D", str(data), "-o",
                                f"-k {sock} -p {port} -c listen_addresses=",
                                "-w", "start"], stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, check=True, timeout=45)
                cls.clusters.append((data, sock, port))
            cls.psql_run(0, "CREATE DATABASE phone11_real", database="postgres")
            cls.psql_run(1, "CREATE DATABASE extra_db", database="postgres")
            cls.psql_run(1, "CREATE DATABASE phone11_real", database="postgres")
            cls.psql_run(0, "CREATE ROLE p11owner; CREATE ROLE p11reader;")
            cls.psql_run(0, """
                CREATE TABLE public.p11_equivalent (id integer, value text);
                ALTER TABLE public.p11_equivalent OWNER TO p11owner;
                GRANT SELECT(value) ON public.p11_equivalent TO p11reader;
                ALTER TABLE public.p11_equivalent ENABLE ROW LEVEL SECURITY;
                CREATE POLICY p11_read ON public.p11_equivalent TO p11reader USING (true);
                ALTER DEFAULT PRIVILEGES FOR ROLE p11owner IN SCHEMA public
                  GRANT SELECT ON TABLES TO p11reader;
            """)
            # Different OIDs for both owner and grantee in the fresh cluster.
            cls.psql_run(1, "CREATE ROLE extra_role; CREATE ROLE p11reader; CREATE ROLE p11owner;")
            dump = cls.base / "backup.dump"
            with dump.open("wb") as output:
                subprocess.run([cls.pg_dump, "-Fc", "-h", str(cls.clusters[0][1]),
                                "-p", str(cls.clusters[0][2]), "-U", "pgadmin",
                                "-d", "phone11_real"], stdout=output,
                               stderr=subprocess.PIPE, check=True, timeout=60)
            subprocess.run([cls.pg_restore, "--exit-on-error", "-h", str(cls.clusters[1][1]),
                            "-p", str(cls.clusters[1][2]), "-U", "pgadmin", "-d",
                            "phone11_real", str(dump)], stdout=subprocess.DEVNULL,
                           stderr=subprocess.PIPE, check=True, timeout=60)
        except Exception:
            cls.tearDownClass()
            raise

    @classmethod
    def tearDownClass(cls) -> None:
        for data, _sock, _port in getattr(cls, "clusters", []):
            subprocess.run([cls.pg_ctl, "-D", str(data), "-m", "immediate",
                            "-w", "stop"], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, check=False, timeout=30)
        if hasattr(cls, "temp"):
            cls.temp.cleanup()

    @classmethod
    def psql_run(cls, index: int, sql: str, *, database: str = "phone11_real") -> str:
        _data, sock, port = cls.clusters[index]
        result = subprocess.run([cls.psql, "-X", "-q", "-A", "-t",
                                 "-v", "ON_ERROR_STOP=1", "-h", str(sock),
                                 "-p", str(port), "-U", "pgadmin", "-d", database],
                                input=sql, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True, check=True, timeout=30)
        return result.stdout.strip()

    @classmethod
    def snapshot(cls, index: int) -> dict:
        _data, sock, port = cls.clusters[index]
        env = {"PATH": os.environ["PATH"], "NODE_PATH": str(cls.node_modules),
               "DB_HOST": str(sock), "DB_PORT": str(port), "DB_USER": "pgadmin",
               "DB_PASSWORD": "test", "DB_NAME": "phone11_real", "DB_SSL": "false"}
        result = subprocess.run([cls.node, "-e", helper.migration.NODE_PROGRAM,
                                 "snapshot", "{}"], cwd=ROOT, env=env,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, check=True, timeout=30)
        return json.loads(result.stdout)["before"]

    def test_pg_dump_restore_matches_structural_catalog_despite_role_oid_drift(self) -> None:
        first_oid = self.psql_run(0, "SELECT oid FROM pg_roles WHERE rolname='p11owner'")
        second_oid = self.psql_run(1, "SELECT oid FROM pg_roles WHERE rolname='p11owner'")
        self.assertNotEqual(first_oid, second_oid)
        first = self.snapshot(0)
        second = self.snapshot(1)
        self.assertEqual(first["catalog_fingerprint"], second["catalog_fingerprint"])
        self.assertNotEqual(first["identity_fingerprint"], second["identity_fingerprint"])

    def test_column_acl_and_default_acl_drift_are_detected(self) -> None:
        base = self.snapshot(1)["catalog_fingerprint"]
        self.psql_run(1, "REVOKE SELECT(value) ON public.p11_equivalent FROM p11reader")
        self.assertNotEqual(base, self.snapshot(1)["catalog_fingerprint"])
        self.psql_run(1, "GRANT SELECT(value) ON public.p11_equivalent TO p11reader")
        self.assertEqual(base, self.snapshot(1)["catalog_fingerprint"])
        self.psql_run(1, "ALTER DEFAULT PRIVILEGES FOR ROLE p11owner IN SCHEMA public "
                    "REVOKE SELECT ON TABLES FROM p11reader")
        self.assertNotEqual(base, self.snapshot(1)["catalog_fingerprint"])
        self.psql_run(1, "ALTER DEFAULT PRIVILEGES FOR ROLE p11owner IN SCHEMA public "
                    "GRANT SELECT ON TABLES TO p11reader")
        self.assertEqual(base, self.snapshot(1)["catalog_fingerprint"])

    def test_advisory_challenge_distinguishes_separate_clusters(self) -> None:
        _data, sock, port = self.clusters[0]
        env = {"PATH": os.environ["PATH"], "NODE_PATH": str(self.node_modules),
               "DB_HOST": str(sock), "DB_PORT": str(port), "DB_USER": "pgadmin",
               "DB_PASSWORD": "test", "DB_NAME": "phone11_real", "DB_SSL": "false"}
        holder = subprocess.Popen([self.node, "-e", helper.LOCK_PROGRAM, "1977123", "{}"],
                                  env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE)
        try:
            ready, _, _ = select.select([holder.stdout], [], [], 10)
            self.assertTrue(ready)
            self.assertEqual(holder.stdout.readline(), b"held\n")
            self.assertEqual(self.psql_run(0, "SELECT pg_try_advisory_lock(1977123::bigint)"), "f")
            self.assertEqual(self.psql_run(1, "SELECT pg_try_advisory_lock(1977123::bigint)"), "t")
            self.assertIsNone(holder.poll())
        finally:
            holder.stdin.close()
            holder.wait(timeout=5)
            holder.stdout.close()
            holder.stderr.close()
        self.assertEqual(holder.returncode, 0)

    def test_rehearsal_refuses_wrong_postgres_version_before_sql(self) -> None:
        _data, sock, port = self.clusters[0]
        env = {"PATH": os.environ["PATH"], "NODE_PATH": str(self.node_modules),
               "DB_HOST": str(sock), "DB_PORT": str(port), "DB_USER": "pgadmin",
               "DB_PASSWORD": "test", "DB_NAME": "phone11_real", "DB_SSL": "false"}
        sql = b"BEGIN;\nCREATE TABLE public.p11_wrong_version(id integer);\nCOMMIT;\n"
        before = self.snapshot(0)
        contract = {"before_catalog_sha256": before["catalog_fingerprint"],
                    "sql_sha256": helper.migration.sha256_bytes(sql)}
        result = subprocess.run([self.node, "-e", helper.migration.NODE_PROGRAM,
                                 "rehearsal", json.dumps(contract)], input=sql,
                                cwd=ROOT, env=env, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, check=False, timeout=30)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.psql_run(0, "SELECT to_regclass('public.p11_wrong_version') IS NULL"), "t")
        self.assertEqual(before, self.snapshot(0))


if __name__ == "__main__":
    unittest.main()
