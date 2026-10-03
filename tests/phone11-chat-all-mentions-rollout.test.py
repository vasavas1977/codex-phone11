"""Focused guards for the migration-only @all production operator."""

import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock


SOURCE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "phone11_chat_all_mentions_rollout",
    SOURCE / "scripts/phone11-chat-all-mentions-rollout.py",
)
operator = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(operator)


class SqlContractTests(unittest.TestCase):
    def test_inspect_is_read_only_and_apply_rechecks_inside_transaction(self):
        read_only = operator.transaction_sql(pins=None, migration=None)
        self.assertIn("SERIALIZABLE READ ONLY", read_only)
        self.assertIn("SET LOCAL search_path=public,pg_temp;", read_only)
        self.assertNotIn("search_path=public,pg_catalog", read_only)
        self.assertNotIn("CREATE TABLE", read_only)
        self.assertIn("pg_advisory_xact_lock", read_only)
        pins = {"identity_sha256": "a" * 64, "before_catalog_sha256": "b" * 64}
        apply = operator.transaction_sql(pins=pins, migration="CREATE TABLE test_fixture(id integer);")
        self.assertIn("SET LOCAL search_path=public,pg_temp;", apply)
        self.assertLess(apply.index("phone11_catalog_pin_mismatch"), apply.index("CREATE TABLE test_fixture"))
        self.assertLess(apply.index("CREATE TABLE test_fixture"), apply.index("phone11_target_shape_mismatch"))
        self.assertLess(apply.index("phone11_target_shape_mismatch"), apply.index("COMMIT;"))
        self.assertIn(pins["identity_sha256"], apply)
        self.assertIn(pins["before_catalog_sha256"], apply)

    def test_migration_artifact_is_immutable(self):
        migration = SOURCE / "server/chat/all-mentions-live-delta-20260920.sql"
        self.assertIn("CREATE TABLE", operator.migration_file(migration))
        with tempfile.TemporaryDirectory() as directory:
            altered = Path(directory) / "migration.sql"
            altered.write_bytes(migration.read_bytes() + b"\n")
            with self.assertRaisesRegex(operator.GuardError, "migration_pin"):
                operator.migration_file(altered)

    def test_psql_never_relays_database_stderr_or_pgoptions(self):
        fake = mock.Mock(returncode=1, stdout=b"", stderr=b"password=secret")
        with mock.patch.dict(os.environ, {"PGOPTIONS": "-c search_path=evil", "PGPASSWORD": "secret"}), \
             mock.patch.object(operator.subprocess, "run", return_value=fake) as call:
            with self.assertRaisesRegex(operator.GuardError, "database_transaction"):
                operator.run_psql("SELECT 1;")
        self.assertNotIn("PGOPTIONS", call.call_args.kwargs["env"])
        self.assertIs(call.call_args.kwargs["stderr"], operator.subprocess.DEVNULL)
        self.assertNotIn("secret", str(fake.returncode))


class ReceiptLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.receipts = self.root / "receipts"
        self.receipts.mkdir(mode=0o700)
        self.manifest = self.root / "pins.json"
        self.pins = {
            "schema": operator.MANIFEST_SCHEMA,
            "migration_sha256": operator.MIGRATION_SHA256,
            "identity_sha256": "a" * 64,
            "before_catalog_sha256": "b" * 64,
        }
        self.manifest.write_text(json.dumps(self.pins))
        self.manifest.chmod(0o600)
        self.manifest_sha = operator.digest(self.manifest.read_bytes())
        self.migration = SOURCE / "server/chat/all-mentions-live-delta-20260920.sql"

    def invoke(self, database):
        argv = ["rollout", "apply", "--migration", str(self.migration),
                "--manifest", str(self.manifest), "--manifest-sha256", self.manifest_sha,
                "--receipt-dir", str(self.receipts)]
        with mock.patch.object(sys, "argv", argv), mock.patch.object(operator, "run_psql", side_effect=database):
            return operator.main()

    def before(self, **changed):
        return dict(identity_sha256="a" * 64, catalog_sha256="b" * 64,
                    target_exists=False, target_valid=False, **changed)

    def test_bad_preflight_does_not_publish_intent(self):
        with mock.patch("builtins.print"):
            result = self.invoke([dict(identity_sha256="a" * 64, catalog_sha256="c" * 64,
                                       target_exists=False, target_valid=False)])
        self.assertEqual(result, 2)
        self.assertFalse((self.receipts / "all-mentions-receipt.json").exists())

    def test_commit_publishes_private_receipt(self):
        after = dict(identity_sha256="a" * 64, catalog_sha256="c" * 64,
                     target_exists=True, target_valid=True)
        with mock.patch("builtins.print"):
            self.assertEqual(self.invoke([self.before(), after]), 0)
        receipt = self.receipts / "all-mentions-receipt.json"
        self.assertEqual(json.loads(receipt.read_text())["status"], "applied")
        self.assertEqual(receipt.stat().st_mode & 0o777, 0o600)
        self.assertEqual(json.loads(receipt.read_text())["after_catalog_sha256"], "c" * 64)

    def test_ambiguous_failure_retains_pending_receipt_and_blocks_retry(self):
        with mock.patch("builtins.print"):
            self.assertEqual(self.invoke([self.before(), operator.GuardError("database_transaction")]), 2)
            self.assertEqual(self.invoke([]), 2)
        receipt = json.loads((self.receipts / "all-mentions-receipt.json").read_text())
        self.assertEqual(receipt["status"], "pending")

    def test_manifest_requires_private_reviewed_hash(self):
        with self.assertRaisesRegex(operator.GuardError, "manifest_pin"):
            operator.manifest_file(self.manifest, "0" * 64)
        self.manifest.chmod(0o644)
        with self.assertRaisesRegex(operator.GuardError, "file_guard"):
            operator.manifest_file(self.manifest, self.manifest_sha)


if __name__ == "__main__":
    unittest.main()
