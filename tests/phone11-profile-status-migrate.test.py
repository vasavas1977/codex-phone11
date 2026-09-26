"""Hermetic checks for the guarded profile-status migration operator."""

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
from types import SimpleNamespace
import unittest
from unittest.mock import patch


ROOT = Path(__file__).parents[1]
SCRIPT = ROOT / "scripts" / "phone11-profile-status-migrate.py"
SPEC = importlib.util.spec_from_file_location("phone11_profile_status_operator", SCRIPT)
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


class ProfileStatusMigrationOperatorTests(unittest.TestCase):
    def test_distinct_receipt_and_shared_schema_advisory_key(self) -> None:
        self.assertEqual(operator.RECEIPT_PATH, Path("/var/lib/phone11-profile-status/receipt-role-rehearsal-v2.json"))
        self.assertEqual(operator.LOCK_PATH, Path("/run/lock/phone11-profile-status-migrate.lock"))
        self.assertIn("phone11-profile-status-live-delta-v1", operator.NODE_PROGRAM)
        self.assertEqual(operator.MANIFEST_SCHEMA, "phone11.profile-status-migration-manifest/v1")

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

    def test_proved_backup_archive_must_exist_and_match_private_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "backup.dump"
            proof = root / "backup-proof.json"
            original = b"PGDMPvalid-private-archive"
            expected = operator.sha256_bytes(original)
            proof_raw = operator.canonical_bytes({"backup_sha256": expected})
            proof.write_bytes(proof_raw)
            os.chmod(proof, 0o600)
            proof_hash = operator.sha256_bytes(proof_raw)
            with self.assertRaisesRegex(operator.MigrationError, "backup_archive"):
                operator.verify_backup_archive(proof, proof_hash, archive_path=archive,
                                               uid=os.getuid(), gid=os.getgid())
            archive.write_bytes(original)
            os.chmod(archive, 0o600)
            self.assertEqual(operator.verify_backup_archive(
                proof, proof_hash, archive_path=archive,
                uid=os.getuid(), gid=os.getgid()), expected)
            archive.write_bytes(b"PGDMPcorrupt-private-archive")
            with self.assertRaisesRegex(operator.MigrationError, "backup_archive"):
                operator.verify_backup_archive(proof, proof_hash, archive_path=archive,
                                               uid=os.getuid(), gid=os.getgid())
            archive.write_bytes(original)
            os.chmod(archive, 0o644)
            with self.assertRaisesRegex(operator.MigrationError, "backup_archive"):
                operator.verify_backup_archive(proof, proof_hash, archive_path=archive,
                                               uid=os.getuid(), gid=os.getgid())

    def test_missing_archive_blocks_before_intent_or_database_call(self) -> None:
        sql = b"reviewed sql"
        manifest = manifest_document(operator.sha256_bytes(sql))
        arguments = argparse.Namespace(
            prepare=False, apply=True, recover=False, inventory=False,
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
            patch.object(operator, "verify_backup_archive",
                         side_effect=operator.MigrationError("backup_archive")),
            patch.object(operator, "reserve_receipt") as intent,
            patch.object(operator, "run_database") as database,
        ):
            self.assertEqual(operator.run(arguments), 1)
        intent.assert_not_called()
        database.assert_not_called()

    def test_pending_clone_cleanup_blocks_before_archive_or_database_call(self) -> None:
        sql = b"reviewed sql"
        manifest = manifest_document(operator.sha256_bytes(sql))
        arguments = argparse.Namespace(
            prepare=False, apply=True, recover=False, inventory=False,
            manifest=Path("/manifest"), sql=Path("/sql"),
            backup_proof=Path("/backup"), restore_proof=Path("/restore"),
            receipt=operator.RECEIPT_PATH,
            container_id=None, container_name=None, container_port=None, host_port=None,
        )
        with tempfile.TemporaryDirectory() as directory:
            pending = Path(directory) / "cleanup-pending"
            pending.mkdir(mode=0o700)
            with (
                patch.object(operator.os, "geteuid", return_value=0),
                patch.object(operator, "read_manifest", return_value=(manifest, "6" * 64)),
                patch.object(operator, "secure_read", return_value=sql),
                patch.object(operator, "read_proofs", return_value=("7" * 64, "8" * 64)),
                patch.object(operator, "operator_lock", return_value=contextlib.nullcontext()),
                patch.object(operator, "PENDING_CLEANUP_DIR", pending),
                patch.object(operator, "verify_backup_archive") as archive,
                patch.object(operator, "reserve_receipt") as intent,
                patch.object(operator, "run_database") as database,
            ):
                self.assertEqual(operator.run(arguments), 1)
            archive.assert_not_called()
            intent.assert_not_called()
            database.assert_not_called()

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
        class Holder:
            def poll(self) -> None:
                return None

        @contextlib.contextmanager
        def hold(_manifest: dict):
            events.append("lock_held")
            yield Holder()
            events.append("lock_released")

        arguments = argparse.Namespace(
            prepare=False, apply=True, recover=False, inventory=False,
            manifest=Path("/manifest"), sql=Path("/sql"),
            backup_proof=Path("/backup"), restore_proof=Path("/restore"),
            receipt=operator.RECEIPT_PATH,
            container_id=None, container_name=None, container_port=None, host_port=None,
        )
        with (
            patch.object(operator.os, "geteuid", return_value=0),
            patch.object(operator, "read_manifest", return_value=(manifest, "6" * 64)),
            patch.object(operator, "secure_read", return_value=b"sql"),
            patch.object(operator, "sha256_bytes", side_effect=lambda value: "d" * 64 if value == b"sql" else __import__("hashlib").sha256(value).hexdigest()),
            patch.object(operator, "read_proofs", return_value=("7" * 64, "8" * 64)),
            patch.object(operator, "verify_backup_archive", return_value="e" * 64),
            patch.object(operator, "operator_lock", return_value=contextlib.nullcontext()),
            patch.object(operator, "PENDING_CLEANUP_DIR", Path("/nonexistent-phone11-test-cleanup-pending")),
            patch.object(operator, "validate_v2_retry", side_effect=lambda *_: events.append("v1_bound")),
            patch.object(operator, "no_old_status_worker", side_effect=lambda *_, **_kwargs: events.append("no_old_worker")),
            patch.object(operator, "held_retry_guard", side_effect=hold),
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
        self.assertEqual(events, ["v1_bound", "no_old_worker", "lock_held",
                                  "no_old_worker", "v1_bound", "intent", "lock_released"])
        self.assertEqual([call.args[1] for call in database.call_args_list], ["snapshot", "apply"])

    def test_pending_v1_evidence_must_be_exact_and_immutable(self) -> None:
        old = manifest_document(operator.FAILED_V1_SQL)
        old["target"]["container_id"] = operator.FAILED_V1_API_CONTAINER
        old["database_identity_sha256"] = operator.FAILED_V1_IDENTITY
        old["before_catalog_sha256"] = operator.FAILED_V1_BEFORE
        old["after_catalog_sha256"] = operator.FAILED_V1_AFTER
        raw = {name: name.encode() for name in operator.FAILED_V1_PINS}
        raw["backup.dump"] = b"PGDMPtest"
        pins = {name: operator.sha256_bytes(value) for name, value in raw.items()}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            migration = root / "migration"
            migration.mkdir()
            receipt = root / "receipt.json"
            receipt.write_bytes(raw["receipt.json"])
            for name, value in raw.items():
                if name != "receipt.json":
                    (migration / name).write_bytes(value)
            with (
                patch.object(operator, "FAILED_V1_RECEIPT", receipt),
                patch.object(operator, "BACKUP_ARCHIVE_PATH", migration / "backup.dump"),
                patch.object(operator, "FAILED_V1_ARCHIVE", root / "archived"),
                patch.object(operator, "FAILED_V1_PINS", pins),
                patch.object(operator, "secure_read", side_effect=lambda path: path.read_bytes()),
                patch.object(operator, "read_manifest", return_value=(old, pins["manifest.json"])),
                patch.object(operator, "read_proofs", return_value=(pins["backup-proof.json"], pins["restore-proof.json"])),
                patch.object(operator, "verify_backup_archive", return_value=pins["backup.dump"]),
                patch.object(operator, "receipt_base", return_value={}),
                patch.object(operator, "read_receipt", return_value={"status": "intent"}),
            ):
                self.assertEqual(operator.failed_v1_evidence(archived=False), old)
                receipt.write_bytes(b"changed")
                with self.assertRaisesRegex(operator.MigrationError, "failed_v1"):
                    operator.failed_v1_evidence(archived=False)

    def test_retry_requires_old_target_release_and_distinct_after_catalog(self) -> None:
        old = manifest_document(operator.FAILED_V1_SQL)
        old["database_identity_sha256"] = operator.FAILED_V1_IDENTITY
        old["before_catalog_sha256"] = operator.FAILED_V1_BEFORE
        old["after_catalog_sha256"] = operator.FAILED_V1_AFTER
        new = json.loads(json.dumps(old))
        new["after_catalog_sha256"] = "f" * 64
        with (
            patch.object(operator, "failed_v1_evidence", return_value=old),
            patch.object(operator.os.path, "lexists", return_value=False),
        ):
            operator.validate_v2_retry(new)
            new["release"]["source_sha"] = "e" * 40
            with self.assertRaisesRegex(operator.MigrationError, "retry_precondition"):
                operator.validate_v2_retry(new)
            new["release"] = old["release"]
            new["after_catalog_sha256"] = old["after_catalog_sha256"]
            with self.assertRaisesRegex(operator.MigrationError, "retry_precondition"):
                operator.validate_v2_retry(new)

    def test_old_api_worker_blocks_before_archive_or_retry_reservation(self) -> None:
        active = subprocess.CompletedProcess([], 0, b"PID ARGS\n123 node -e phone11-profile-status-live-delta-v1 apply\n", b"")
        holder = subprocess.CompletedProcess([], 0, b"PID ARGS\n123 node -e retry_guard\n", b"")
        with patch.object(operator.subprocess, "run", return_value=active):
            with self.assertRaisesRegex(operator.MigrationError, "old_worker"):
                operator.no_old_status_worker(operator.FAILED_V1_API_CONTAINER)
        with patch.object(operator.subprocess, "run", return_value=holder):
            operator.no_old_status_worker(operator.FAILED_V1_API_CONTAINER, expected_holders=1)
        both = subprocess.CompletedProcess([], 0, holder.stdout + b"124 node -e apply\n", b"")
        with patch.object(operator.subprocess, "run", return_value=both):
            with self.assertRaisesRegex(operator.MigrationError, "old_worker"):
                operator.no_old_status_worker(operator.FAILED_V1_API_CONTAINER, expected_holders=1)

        with (
            patch.object(operator.os, "geteuid", return_value=0),
            patch.object(operator.os.path, "lexists", return_value=False),
            patch.object(operator, "operator_lock", return_value=contextlib.nullcontext()),
            patch.object(operator, "failed_v1_evidence", return_value=manifest_document()),
            patch.object(operator, "no_old_status_worker", side_effect=operator.MigrationError("old_worker")),
            patch.object(operator, "held_retry_guard") as hold,
        ):
            with self.assertRaisesRegex(operator.MigrationError, "old_worker"):
                operator.archive_failed_v1()
        hold.assert_not_called()

    def test_failed_archive_moves_only_pinned_files_and_preserves_v1_receipt(self) -> None:
        class Holder:
            def poll(self) -> None:
                return None

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            os.chmod(root, 0o700)
            migration = root / "migration"
            migration.mkdir(mode=0o700)
            archive = root / "failed-status-apply-v1"
            receipt = root / "receipt.json"
            receipt.write_bytes(b"original intent")
            samples = {name: name.encode() for name in operator.FAILED_V1_PINS
                       if name != "receipt.json"}
            samples["backup.dump"] = b"PGDMP" + b"x" * operator.MAX_ARTIFACT_BYTES
            self.assertGreater(len(samples["backup.dump"]), operator.MAX_ARTIFACT_BYTES)
            samples["backup-proof.json"] = operator.canonical_bytes({
                "backup_sha256": operator.sha256_bytes(samples["backup.dump"]),
            })
            for name, value in samples.items():
                write_protected(migration / name, value)
            pins = {name: operator.sha256_bytes(value) for name, value in samples.items()}
            pins["receipt.json"] = operator.sha256_bytes(receipt.read_bytes())
            real_lstat = Path.lstat
            real_verify = operator.verify_backup_archive

            def root_lstat(path: Path):
                info = real_lstat(path)
                if path in (root, archive):
                    return SimpleNamespace(st_mode=info.st_mode, st_uid=0, st_gid=0)
                return info

            @contextlib.contextmanager
            def hold(_manifest: dict):
                yield Holder()

            def read_small(path: Path, **_kwargs: object) -> bytes:
                if path.name == "backup.dump":
                    raise AssertionError("large backup reached bounded secure_read")
                return path.read_bytes()

            def verify_local(proof: Path, proof_sha: str, *, archive_path: Path) -> str:
                return real_verify(proof, proof_sha, archive_path=archive_path,
                                   uid=os.getuid(), gid=os.getgid())

            with (
                patch.object(operator.os, "geteuid", return_value=0),
                patch.object(operator, "RECEIPT_PATH", root / "v2-receipt.json"),
                patch.object(operator, "PENDING_CLEANUP_DIR", root / "cleanup-pending"),
                patch.object(operator, "BACKUP_ARCHIVE_PATH", migration / "backup.dump"),
                patch.object(operator, "FAILED_V1_ARCHIVE", archive),
                patch.object(operator, "FAILED_V1_PINS", pins),
                patch.object(operator, "operator_lock", return_value=contextlib.nullcontext()),
                patch.object(operator, "failed_v1_evidence", return_value=manifest_document()),
                patch.object(operator, "no_old_status_worker"),
                patch.object(operator, "held_retry_guard", side_effect=hold),
                patch.object(operator, "secure_read", side_effect=read_small),
                patch.object(operator, "verify_backup_archive", side_effect=verify_local),
                patch.object(Path, "lstat", root_lstat),
            ):
                self.assertEqual(operator.failed_v1_file("backup.dump", archived=False),
                                 migration / "backup.dump")
                operator.archive_failed_v1()
                operator.archive_failed_v1()  # A completed move is safe to resume.
            self.assertEqual(receipt.read_bytes(), b"original intent")
            self.assertEqual({item.name for item in archive.iterdir()}, set(samples))
            self.assertEqual(list(migration.iterdir()), [])

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
            patch.object(operator, "verify_backup_archive", return_value="e" * 64),
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
            patch.object(operator, "verify_backup_archive", return_value="e" * 64),
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
        cls.psql_command("CREATE TABLE phone11_workspace_profile_status(id integer);"
                         "CREATE TABLE phone11_workspace_profile_status_settings(id integer);")

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
            "NODE_PATH": os.environ.get("NODE_PATH", ""),
            "DB_HOST": "127.0.0.1",
            "DB_PORT": str(cls.port),
            "DB_USER": "phone11ai",
            "DB_PASSWORD": "test-only",
            "DB_NAME": "postgres",
            "DB_SSL": "false",
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

    def test_default_select_grant_rolls_back_status_tables(self) -> None:
        self.psql_command("DROP TABLE phone11_workspace_profile_status, phone11_workspace_profile_status_settings;"
                          "CREATE ROLE phone11_status_reader;"
                          "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO phone11_status_reader;")
        sql = ("BEGIN;\nCREATE TABLE phone11_workspace_profile_status(id integer);\n"
               "CREATE TABLE phone11_workspace_profile_status_settings(id integer);\nCOMMIT;\n")
        try:
            before = self.snapshot()
            self.psql_command(sql)
            after = self.snapshot()
            grants = self.psql_command("SELECT has_table_privilege('phone11_status_reader', 'phone11_workspace_profile_status', 'SELECT');")
            self.assertEqual(grants.stdout.strip(), "t")
            self.psql_command("DROP TABLE phone11_workspace_profile_status, phone11_workspace_profile_status_settings;")
            self.assertEqual(self.snapshot()["catalog_fingerprint"], before["catalog_fingerprint"])
            contract = {
                "database_identity_sha256": before["identity_fingerprint"],
                "before_catalog_sha256": before["catalog_fingerprint"],
                "after_catalog_sha256": after["catalog_fingerprint"],
                "sql_sha256": operator.sha256_bytes(sql.encode()),
            }
            result = self.node_action("apply", contract, sql)
            self.assertNotEqual(result.returncode, 0, "unsafe default SELECT grant was committed")
            absent = self.psql_command("SELECT to_regclass('public.phone11_workspace_profile_status') IS NULL"
                                       " AND to_regclass('public.phone11_workspace_profile_status_settings') IS NULL;")
            self.assertEqual(absent.stdout.strip(), "t")
        finally:
            self.psql_command("DROP TABLE IF EXISTS phone11_workspace_profile_status, phone11_workspace_profile_status_settings;"
                              "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM phone11_status_reader;"
                              "DROP ROLE phone11_status_reader;"
                              "CREATE TABLE phone11_workspace_profile_status(id integer);"
                              "CREATE TABLE phone11_workspace_profile_status_settings(id integer);")

    def test_acl_and_row_security_changes_affect_catalog_fingerprint(self) -> None:
        before = self.snapshot()["catalog_fingerprint"]
        self.psql_command("ALTER TABLE phone11_workspace_profile_status ENABLE ROW LEVEL SECURITY;")
        self.assertNotEqual(self.snapshot()["catalog_fingerprint"], before)
        self.psql_command("ALTER TABLE phone11_workspace_profile_status DISABLE ROW LEVEL SECURITY;")
        self.assertEqual(self.snapshot()["catalog_fingerprint"], before)

    def test_probe_uses_pbx_discrete_settings_before_database_url(self) -> None:
        production = self.snapshot()["identity_fingerprint"]
        alternate = self.environment()
        alternate["DATABASE_URL"] = f"postgresql://phone11ai@127.0.0.1:{self.port}/template1"
        result = subprocess.run(
            [self.node, "-e", operator.NODE_PROGRAM, "snapshot", "{}"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            cwd=ROOT, env=alternate, check=False, timeout=15,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["before"]["identity_fingerprint"], production)

    def test_probe_uses_pbx_connection_string_before_discrete_settings(self) -> None:
        production = self.snapshot()["identity_fingerprint"]
        alternate = self.environment()
        alternate["PG_CONNECTION_STRING"] = f"postgresql://phone11ai@127.0.0.1:{self.port}/template1?sslmode=disable"
        result = subprocess.run(
            [self.node, "-e", operator.NODE_PROGRAM, "snapshot", "{}"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            cwd=ROOT, env=alternate, check=False, timeout=15,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotEqual(json.loads(result.stdout)["before"]["identity_fingerprint"], production)

    def test_probe_uses_pbx_partial_pg_override_of_db_settings(self) -> None:
        production = self.snapshot()["identity_fingerprint"]
        alternate = self.environment()
        alternate["PG_DATABASE"] = "template1"
        alternate["DATABASE_URL"] = f"postgresql://phone11ai@127.0.0.1:{self.port}/postgres"
        result = subprocess.run(
            [self.node, "-e", operator.NODE_PROGRAM, "snapshot", "{}"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            cwd=ROOT, env=alternate, check=False, timeout=15,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotEqual(json.loads(result.stdout)["before"]["identity_fingerprint"], production)

    def test_column_select_grant_changes_fingerprint_and_rolls_back(self) -> None:
        self.psql_command("DROP TABLE phone11_workspace_profile_status, phone11_workspace_profile_status_settings;"
                          "CREATE ROLE phone11_status_column_reader;")
        sql = ("BEGIN;\nCREATE TABLE phone11_workspace_profile_status(status_text text);\n"
               "CREATE TABLE phone11_workspace_profile_status_settings(id integer);\n"
               "GRANT SELECT(status_text) ON phone11_workspace_profile_status TO phone11_status_column_reader;\nCOMMIT;\n")
        try:
            before = self.snapshot()
            self.psql_command(sql)
            after = self.snapshot()
            column_access = self.psql_command(
                "SELECT has_column_privilege('phone11_status_column_reader', "
                "'phone11_workspace_profile_status', 'status_text', 'SELECT');")
            self.assertEqual(column_access.stdout.strip(), "t")
            self.assertNotEqual(before["catalog_fingerprint"], after["catalog_fingerprint"])
            self.psql_command("DROP TABLE phone11_workspace_profile_status, phone11_workspace_profile_status_settings;")
            self.assertEqual(self.snapshot()["catalog_fingerprint"], before["catalog_fingerprint"])
            contract = {
                "database_identity_sha256": before["identity_fingerprint"],
                "before_catalog_sha256": before["catalog_fingerprint"],
                "after_catalog_sha256": after["catalog_fingerprint"],
                "sql_sha256": operator.sha256_bytes(sql.encode()),
            }
            result = self.node_action("apply", contract, sql)
            self.assertNotEqual(result.returncode, 0, "unsafe column SELECT grant was committed")
            absent = self.psql_command("SELECT to_regclass('public.phone11_workspace_profile_status') IS NULL"
                                       " AND to_regclass('public.phone11_workspace_profile_status_settings') IS NULL;")
            self.assertEqual(absent.stdout.strip(), "t")
        finally:
            self.psql_command("DROP TABLE IF EXISTS phone11_workspace_profile_status, phone11_workspace_profile_status_settings;"
                              "DROP ROLE phone11_status_column_reader;"
                              "CREATE TABLE phone11_workspace_profile_status(id integer);"
                              "CREATE TABLE phone11_workspace_profile_status_settings(id integer);")

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
        self.psql_command("DROP TABLE IF EXISTS profile_status_delayed;")
        before = self.snapshot()
        self.psql_command("CREATE TABLE profile_status_delayed(id integer PRIMARY KEY);")
        after_catalog = self.snapshot()["catalog_fingerprint"]
        self.psql_command("DROP TABLE profile_status_delayed;")
        sql = "BEGIN;\nCREATE TABLE profile_status_delayed(id integer PRIMARY KEY);\nCOMMIT;\n"
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
        self.psql_command("DROP TABLE profile_status_delayed;")


if __name__ == "__main__":
    unittest.main()
