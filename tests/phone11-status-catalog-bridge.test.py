"""Failure checks for the pre-status backup bridge proof."""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import py_compile
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import sys
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).parents[1] / "scripts/phone11-status-catalog-bridge.py"
spec = importlib.util.spec_from_file_location("phone11_status_catalog_bridge", SCRIPT)
assert spec and spec.loader
bridge = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = bridge
spec.loader.exec_module(bridge)


class CatalogBridgeTest(unittest.TestCase):
    def test_direct_snapshot_uses_pinned_program_inside_clone_network(self):
        calls = []
        restore = SimpleNamespace(
            DOCKER="docker", ProofError=RuntimeError,
            pending_marker=lambda *_: Path("/protected/marker"),
            command=lambda args, **kwargs: calls.append(args) or
                b'{"before":{"catalog_fingerprint":"' + b"2" * 64 + b'"}}',
            json_result=lambda raw, stage: json.loads(raw),
            cleanup_owned=lambda *args: calls.append(("cleanup", *args)),
            clear_pending_marker=lambda marker: calls.append(("clear", marker)))
        direct = SimpleNamespace(NODE_PROGRAM="reviewed-direct-program")
        result = bridge.snapshot_direct(restore, direct, "a" * 64, Path("/protected"))
        self.assertEqual(result["before"]["catalog_fingerprint"], "2" * 64)
        args = calls[0]
        self.assertEqual(args[args.index("--network") + 1], "container:" + "a" * 64)
        self.assertIn(bridge.CURRENT_IMAGE, args)
        self.assertIn("reviewed-direct-program", args)
        self.assertEqual(args[-2:], ["snapshot", "{}"])
        self.assertEqual((calls[-2][0], calls[-1][0]), ("cleanup", "clear"))

    def test_clone_uses_one_network_isolated_restore_and_cleans_it_up(self):
        clone_id = "a" * 64
        operations = []
        def command(args, **_):
            operations.append(args)
            if args[1] in ("create", "start"):
                return (clone_id + "\n").encode()
            return b""
        def owned(name, token):
            return {"Id": clone_id, "Image": "sha256:postgres",
                    "HostConfig": {"NetworkMode": "none", "ReadonlyRootfs": True,
                                   "PortBindings": {}, "Tmpfs": {
                                       "/var/lib/postgresql/data": "", "/var/run/postgresql": "",
                                       "/tmp": ""}},
                    "Mounts": [{"Type": "bind", "RW": False,
                                "Destination": "/tmp/backup.dump", "Source": str(bridge.BACKUP)}]}
        with TemporaryDirectory() as root, \
             patch.object(bridge, "ROOT", Path(root)), \
             patch.object(bridge, "snapshot_direct", return_value={"before": {
                 "catalog_fingerprint": "2" * 64}}) as direct:
            restore = SimpleNamespace(
                DOCKER="docker", POSTGRES_IMAGE="sha256:postgres", ProofError=RuntimeError,
                pending_marker=lambda *_: Path(root) / "marker",
                command=command, inspect_owned=owned,
                quote_identifier=lambda role: '"' + role + '"',
                clone_sql=lambda *args: operations.append(args),
                clone_node=lambda image, cid, action, contract, directory: {
                    "before": {"catalog_fingerprint": "3" * 64}},
                cleanup_owned=lambda name, token: operations.append(("cleanup", name)),
                clear_pending_marker=lambda marker: operations.append(("clear", marker)))
            result = bridge.clone_fingerprints(restore, SimpleNamespace(),
                                               ["postgres", "phone11ai"], "phone11ai",
                                               data_mib=4096)
            self.assertEqual(result, ("2" * 64, "3" * 64))
            self.assertEqual(direct.call_args.args[2], clone_id)
            self.assertIn("--network", operations[0])
            self.assertEqual(operations[0][operations[0].index("--network") + 1], "none")
            self.assertNotIn("--publish", operations[0])
            self.assertEqual(operations[-2][0], "cleanup")
            self.assertEqual(operations[-1][0], "clear")
            with patch.object(restore, "inspect_owned", side_effect=lambda name, token: {
                **owned(name, token), "HostConfig": {**owned(name, token)["HostConfig"],
                                                     "NetworkMode": "bridge"}}):
                with self.assertRaisesRegex(bridge.BridgeError, "clone_isolation"):
                    bridge.clone_fingerprints(restore, SimpleNamespace(),
                                              ["postgres", "phone11ai"], "phone11ai",
                                              data_mib=4096)

    def test_reviewed_modules_execute_verified_bytes(self):
        source = b"VALUE = 3\n"
        with patch.object(bridge, "secure_read", return_value=source):
            module, raw = bridge.load_reviewed(Path("/not-executed.py"), bridge.sha(source), "checked")
            self.assertEqual((module.VALUE, raw), (3, source))
            with self.assertRaisesRegex(bridge.BridgeError, "artifact"):
                bridge.load_reviewed(Path("/not-executed.py"), "0" * 64, "wrong")

    def test_restore_helper_uses_injected_status_despite_replaced_path_and_valid_stale_pyc(self):
        reviewed = (SCRIPT.parent / "phone11-profile-status-restore-proof.py").read_bytes()
        with TemporaryDirectory() as root:
            helper = Path(root) / "phone11-profile-status-restore-proof.py"
            status_path = Path(root) / "phone11-profile-status-migrate.py"
            marker = Path(root) / "unverified-executed"
            helper.write_bytes(reviewed)
            malicious = f"with open({str(marker)!r}, 'w') as evidence: evidence.write('unverified')\n"
            status_path.write_text(malicious)
            observed = status_path.stat()
            py_compile.compile(str(status_path), doraise=True,
                               invalidation_mode=py_compile.PycInvalidationMode.TIMESTAMP)
            status_path.write_text("#" + " " * (len(malicious) - 2) + "\n")
            os.utime(status_path, ns=(observed.st_atime_ns, observed.st_mtime_ns))
            # Confirm this is a valid stale pyc; a normal pathname import runs it.
            stale = importlib.util.spec_from_file_location("stale_status", status_path)
            assert stale and stale.loader
            stale.loader.exec_module(importlib.util.module_from_spec(stale))
            self.assertEqual(marker.read_text(), "unverified")
            marker.unlink()
            verified_status = SimpleNamespace(NODE_PROGRAM="async function identity(client) {")
            with patch.object(bridge, "RESTORE_HELPER", helper), \
                 patch.object(bridge, "secure_read", return_value=reviewed):
                restored = bridge.load_restore_helper(verified_status)
            self.assertIs(restored.migration, verified_status)
            self.assertFalse(marker.exists())
            with patch.object(bridge, "RESTORE_HELPER", helper), \
                 patch.object(bridge, "secure_read", return_value=reviewed.replace(
                     bridge.RESTORE_OPERATOR_IMPORT, b"migration = None\n")):
                with self.assertRaisesRegex(bridge.BridgeError, "restore_artifact"):
                    bridge.load_restore_helper(verified_status)

    def test_proof_requires_both_catalogs_same_backup_and_current_identity(self):
        identity, direct_after = "1" * 64, "2" * 64
        status_before, status_after, archive_sha = "3" * 64, "4" * 64, "5" * 64
        direct_manifest = {"schema": "phone11.direct-meetings-migration-manifest/v1",
                           "database_identity_sha256": identity,
                           "target": {}, "release": {}, "sql_sha256": "6" * 64,
                           "before_catalog_sha256": "7" * 64,
                           "after_catalog_sha256": direct_after}
        status_manifest = {"schema": "phone11.profile-status-migration-manifest/v1",
                           "database_identity_sha256": identity,
                           "target": {}, "release": {}, "sql_sha256": "8" * 64,
                           "before_catalog_sha256": status_before,
                           "after_catalog_sha256": status_after}
        backup = {"schema": "phone11.profile-status-backup-proof/v1",
                  "manifest_sha256": "placeholder",
                  "database_identity_sha256": identity,
                  "before_catalog_sha256": status_before,
                  "backup_sha256": archive_sha,
                  "created_at_unix": 1, "mechanism": "cp11-postgres:pg_dump"}
        status = SimpleNamespace(MANIFEST_SCHEMA=status_manifest["schema"],
            read_proofs=lambda *a, **k: (bridge.sha(data[bridge.STATUS_BACKUP_PROOF]), "restore-proof"),
            verify_backup_archive=lambda *a, **k: None,
            canonical_bytes=lambda value: json.dumps(value, sort_keys=True, separators=(",", ":")).encode())
        direct = SimpleNamespace(MANIFEST_SCHEMA=direct_manifest["schema"])
        written = []
        restore = SimpleNamespace(
            source_action=lambda *_: {"before": {"identity_fingerprint": identity,
                                                  "catalog_fingerprint": status_after},
                                      "details": {"roles": ["postgres", "phone11ai"],
                                                  "database_owner": "phone11ai"}},
            archive_digest=lambda *_: archive_sha,
            private_new=lambda path, content: written.append((path, json.loads(content))),
            migration=None)
        data = {bridge.DIRECT_MANIFEST: json.dumps(direct_manifest).encode(),
                bridge.STATUS_MANIFEST: json.dumps(status_manifest).encode(),
                bridge.STATUS_RESTORE_PROOF: b"restore-proof"}
        backup["manifest_sha256"] = bridge.sha(data[bridge.STATUS_MANIFEST])
        data[bridge.STATUS_BACKUP_PROOF] = json.dumps(backup).encode()
        modules = {bridge.STATUS_OPERATOR: status, bridge.DIRECT_OPERATOR: direct,
                   bridge.RESTORE_HELPER: restore}
        with TemporaryDirectory() as root, \
             patch.object(bridge, "ROOT", Path(root)), \
             patch.object(bridge, "private_directory"), \
             patch.object(bridge.os, "geteuid", return_value=0), \
             patch.object(bridge.os.path, "lexists", return_value=False), \
             patch.object(bridge, "secure_read", side_effect=lambda path: data[path]), \
             patch.object(bridge, "load_reviewed", side_effect=lambda path, *_: (modules[path], b"bytes")), \
             patch.object(bridge, "load_restore_helper", return_value=restore), \
             patch.object(bridge, "clone_fingerprints", return_value=(direct_after, status_before)) as clone:
            proof = bridge.create(4096)
            self.assertEqual(proof["direct_after_catalog_sha256"], direct_after)
            self.assertEqual(proof["status_before_catalog_sha256"], status_before)
            self.assertEqual(proof["backup_sha256"], archive_sha)
            self.assertEqual(written[0][1], proof)
            clone.assert_called_with(restore, direct, ["postgres", "phone11ai"],
                                     "phone11ai", data_mib=4096)
            for fingerprints, error in ((("9" * 64, status_before), "direct_catalog"),
                                        ((direct_after, "9" * 64), "status_catalog")):
                with self.subTest(fingerprints=fingerprints), \
                     patch.object(bridge, "clone_fingerprints", return_value=fingerprints):
                    with self.assertRaisesRegex(bridge.BridgeError, error):
                        bridge.create(4096)
            restore.source_action = lambda *_: {"before": {
                "identity_fingerprint": "9" * 64, "catalog_fingerprint": status_after}}
            with self.assertRaisesRegex(bridge.BridgeError, "live_status"):
                bridge.create(4096)
            status_manifest["schema"] = "phone11.profile-status-migration-manifest/archived-v1"
            data[bridge.STATUS_MANIFEST] = json.dumps(status_manifest).encode()
            backup["manifest_sha256"] = bridge.sha(data[bridge.STATUS_MANIFEST])
            data[bridge.STATUS_BACKUP_PROOF] = json.dumps(backup).encode()
            with self.assertRaisesRegex(bridge.BridgeError, "manifest"):
                bridge.create(4096)


if __name__ == "__main__":
    unittest.main()
