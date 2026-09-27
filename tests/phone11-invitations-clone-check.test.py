"""Fail-closed checks for the invitation clone rehearsal operator."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "invitation_clone", ROOT / "scripts/phone11-invitations-clone-check.py")
assert spec is not None and spec.loader is not None
clone = importlib.util.module_from_spec(spec)
spec.loader.exec_module(clone)


def inventory(*, collision: bool = False) -> dict[str, object]:
    return {
        "identity": {"database": "phone11ai", "role": "phone11ai",
                     "schema": "public", "version": "160013"},
        "permissions": {"schema_create": True, "users_owner": True,
                        "tenants_owner": True},
        "role_attributes": {"superuser": True, "createdb": True,
                            "createrole": True, "replication": True,
                            "bypassrls": True, "inherit": True, "login": True,
                            "connection_limit": -1, "valid_until": True,
                            "membership_count": 0},
        "required": {name: True for name in (
            "users", "tenants", "tenant_memberships", "phone11_auth_user",
            "phone11_auth_account", "phone11_auth_identity", "phone11_auth_session")},
        "collisions": {name: collision for name in (
            "phone11_users_normalized_email_unique",
            "phone11_workspace_invitations", "phone11_workspace_invitations_pkey",
            "phone11_workspace_invitations_token_digest_key",
            "phone11_workspace_invitations_one_pending_email",
            "phone11_workspace_invitations_tenant_recent",
            "phone11_workspace_invitation_events",
            "phone11_workspace_invitation_events_pkey",
            "phone11_workspace_invitation_events_tenant_recent")},
    }


def counts() -> dict[str, int]:
    return {"canonical_duplicate_groups": 0, "canonical_duplicate_rows": 0,
            "auth_duplicate_groups": 0, "active_bridge_email_mismatches": 0}


class InvitationCloneRefusalTests(unittest.TestCase):
    def test_duplicate_collision_identity_and_missing_table_refuse(self):
        good = inventory()
        clean = counts()
        clone.preflight(good, clean, role="phone11ai", database="phone11ai", version="160013")
        for field, value, stage in (
            ("canonical_duplicate_groups", 1, "canonical_duplicates"),
            ("canonical_duplicate_rows", 2, "canonical_duplicates"),
            ("auth_duplicate_groups", 1, "auth_identity"),
            ("active_bridge_email_mismatches", 1, "auth_identity"),
        ):
            changed = dict(clean, **{field: value})
            with self.subTest(field=field), self.assertRaisesRegex(clone.Blocked, stage):
                clone.preflight(good, changed, role="phone11ai", database="phone11ai", version="160013")
        changed = inventory(collision=True)
        with self.assertRaisesRegex(clone.Blocked, "object_collision"):
            clone.preflight(changed, clean, role="phone11ai", database="phone11ai", version="160013")
        changed = inventory()
        changed["required"]["phone11_auth_session"] = False
        with self.assertRaisesRegex(clone.Blocked, "prerequisites"):
            clone.preflight(changed, clean, role="phone11ai", database="phone11ai", version="160013")
        changed = inventory()
        changed["identity"]["schema"] = "other"
        with self.assertRaisesRegex(clone.Blocked, "db_identity"):
            clone.preflight(changed, clean, role="phone11ai", database="phone11ai", version="160013")
        changed = inventory()
        changed["role_attributes"]["superuser"] = False
        with self.assertRaisesRegex(clone.Blocked, "role_attributes"):
            clone.preflight(changed, clean, role="phone11ai", database="phone11ai", version="160013")

    def test_collision_stops_before_backup_or_clone(self):
        sql_sha = hashlib.sha256(clone.MIGRATION.read_bytes()).hexdigest()
        with tempfile.TemporaryDirectory() as folder:
            args = SimpleNamespace(output_dir=Path(folder), sql_sha=sql_sha,
                                   role="phone11ai", database="phone11ai",
                                   server_version_num="160013")
            with patch.object(clone, "private_directory"), patch.object(clone, "verify_source"), \
                 patch.object(clone, "live_json", return_value=inventory(collision=True)) as live, \
                 patch.object(clone, "backup") as backup, patch.object(clone, "rehearse") as rehearse:
                with self.assertRaisesRegex(clone.Blocked, "object_collision"):
                    clone.run(args)
                self.assertEqual(live.call_count, 1)
                backup.assert_not_called()
                rehearse.assert_not_called()
                self.assertFalse((Path(folder) / "backup.dump").exists())

    def test_source_pin_refuses_before_docker_inspect(self):
        args = SimpleNamespace(api_id="bad", pg_id="a" * 64, api_bundle_sha="b" * 64,
                               sql_sha="c" * 64, api_image="sha256:" + "d" * 64,
                               pg_image="sha256:" + "e" * 64,
                               api_source_sha="f" * 40, role="phone11ai", database="phone11ai",
                               api_bundle_path="/app/dist/index.mjs", clone_data_mib=4096)
        with patch.object(clone.os, "geteuid", return_value=0), \
             patch.object(clone.Path, "is_file", return_value=True), \
             patch.object(clone, "inspect") as inspect:
            with self.assertRaisesRegex(clone.Blocked, "pin"):
                clone.verify_source(args)
            inspect.assert_not_called()

    def test_source_bundle_mismatch_refuses_before_database_read(self):
        args = SimpleNamespace(api_id="a" * 64, api_name="api", api_image="sha256:" + "b" * 64,
                               api_source_sha="c" * 40, api_bundle_sha="d" * 64,
                               api_bundle_path="/app/dist/index.mjs", pg_id="e" * 64,
                               pg_name="pg", pg_image="sha256:" + "f" * 64,
                               role="phone11ai", database="phone11ai", server_version_num="160013",
                               sql_sha="1" * 64, clone_data_mib=4096)
        api = {"Id": args.api_id, "Image": args.api_image, "Name": "/api",
               "State": {"Running": True}, "Config": {"Labels": {
                   "com.phone11.source-sha": args.api_source_sha,
                   "com.phone11.bundle-sha256": args.api_bundle_sha}}}
        pg = {"Id": args.pg_id, "Image": args.pg_image, "Name": "/pg",
              "State": {"Running": True}}
        with patch.object(clone.os, "geteuid", return_value=0), \
             patch.object(clone.Path, "is_file", return_value=True), \
             patch.object(clone, "inspect", side_effect=[api, pg]), \
             patch.object(clone, "command", return_value=b"0" * 64 + b"  /app/dist/index.mjs"):
            with self.assertRaisesRegex(clone.Blocked, "api_bundle"):
                clone.verify_source(args)

    def test_private_directory_and_network_isolation_contract(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            os.chmod(directory, 0o755)
            with self.assertRaisesRegex(clone.Blocked, "private_directory"):
                clone.private_directory(directory)
        archive, migration = Path("/private/backup.dump"), Path("/private/migration.sql")
        item = {"Id": "a" * 64, "Image": "sha256:" + "b" * 64,
                "State": {"Running": False},
                "HostConfig": {"NetworkMode": "none", "ReadonlyRootfs": True,
                               "PortBindings": {}, "Memory": 768 * 1024 * 1024,
                               "MemorySwap": 768 * 1024 * 1024,
                               "NanoCpus": 500_000_000, "PidsLimit": 128,
                               "Tmpfs": {
                                   "/var/lib/postgresql/data": {},
                                   "/var/run/postgresql": {}, "/tmp": {}}},
                "Mounts": [
                    {"Type": "bind", "RW": False, "Destination": "/tmp/backup.dump",
                     "Source": str(archive)},
                    {"Type": "bind", "RW": False, "Destination": "/tmp/migration.sql",
                     "Source": str(migration)}]}
        clone.validate_clone_isolation(item, "a" * 64, "sha256:" + "b" * 64,
                                       archive, migration)
        item["HostConfig"]["NetworkMode"] = "bridge"
        with self.assertRaisesRegex(clone.Blocked, "clone_isolation"):
            clone.validate_clone_isolation(item, "a" * 64, "sha256:" + "b" * 64,
                                           archive, migration)

    def test_live_select_is_read_only_and_bounded(self):
        args = SimpleNamespace(pg_id="a" * 64, role="phone11ai", database="phone11ai")
        with patch.object(clone, "pg_live", return_value=b"{}") as call:
            self.assertEqual(clone.live_json(args, "SELECT '{}'::jsonb::text"), {})
            argv = call.call_args.args
            self.assertIn("BEGIN TRANSACTION READ ONLY", argv)
            self.assertIn("SET LOCAL statement_timeout = '30s'", argv)
            self.assertIn("SET LOCAL lock_timeout = '3s'", argv)
            self.assertIn("ROLLBACK", argv)
        self.assertIn("default_transaction_read_only=on", clone.PG_WRAPPER)

    def test_restore_preserves_source_owners_and_acl(self):
        argv = clone.restore_argv("a" * 64, "phone11ai", "phone11ai")
        self.assertEqual(argv[3], "pg_restore")
        self.assertIn("--single-transaction", argv)
        self.assertIn("--exit-on-error", argv)
        self.assertNotIn("--no-owner", argv)
        self.assertNotIn("--no-acl", argv)
        self.assertEqual(argv[-1], "/tmp/backup.dump")

    def test_cleanup_refuses_foreign_name_collision(self):
        foreign = {"Name": "/p11inv-token", "Id": "a" * 64,
                   "Config": {"Labels": {"phone11.invitation.clone-token": "different"}}}
        response = SimpleNamespace(returncode=0, stdout=json.dumps([foreign]).encode(),
                                   stderr=b"")
        with patch.object(clone.subprocess, "run", return_value=response) as process, \
             patch.object(clone, "command") as command:
            with self.assertRaisesRegex(clone.Blocked, "clone_identity"):
                clone.cleanup_clone("p11inv-token", "token")
            process.assert_called_once()
            command.assert_not_called()


if __name__ == "__main__":
    unittest.main()
