"""Hermetic failure and lifecycle checks for the guarded 3011 -> 3012 route."""
from __future__ import annotations

from contextlib import nullcontext
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).parents[1] / "scripts/phone11-status-only-release-route.py"
spec = importlib.util.spec_from_file_location("phone11_status_only_release_route", SCRIPT)
assert spec is not None and spec.loader is not None
route = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = route
spec.loader.exec_module(route)

SITE = b"""location = /api/trpc {
    proxy_pass http://127.0.0.1:3011;
    add_header X-Preserved yes;
}
location ^~ /api/trpc/ {
    proxy_pass http://127.0.0.1:3011;
}
location = /api/mobile/config {
    proxy_pass http://127.0.0.1:3004;
}
"""
INFO = SimpleNamespace(st_uid=0, st_gid=0, st_mode=0o100644)
PINS = {"container_id": "a" * 64, "image": "sha256:" + "b" * 64,
        "source_sha": "c" * 40, "bundle_sha256": "d" * 64,
        "lock_sha256": route.CURRENT_LOCK_SHA, "build": "status-only-20260926"}


def manifest():
    return {"schema": route.GATE_SCHEMA, "candidate": dict(PINS)}

class StatusOnlyRouteTest(unittest.TestCase):
    def test_verified_python_executes_reviewed_bytes_after_path_replacement(self):
        with TemporaryDirectory() as root:
            probe_path = Path(root) / "probe.py"
            probe_path.write_bytes(b'print("reviewed")\n')
            reviewed = probe_path.read_bytes()
            probe_path.write_bytes(b'print("replaced")\n')
            with patch.object(route, "PYTHON_EXECUTABLE", sys.executable):
                self.assertEqual(route.run_verified_python(reviewed, ["--inventory"]), b"reviewed\n")
            self.assertEqual(probe_path.read_bytes(), b'print("replaced")\n')

    def test_verified_python_excludes_poisoned_imports_from_cwd_and_pythonpath(self):
        with TemporaryDirectory() as root:
            poisoned = Path(root) / "argparse.py"
            poisoned.write_text('raise RuntimeError("poisoned argparse imported")\n')
            script = b"import argparse\nprint(argparse.__file__)\n"
            with patch.object(route, "PYTHON_EXECUTABLE", sys.executable), \
                 patch.object(route, "VERIFIED_CWD", root), \
                 patch.dict(os.environ, {"PYTHONPATH": root}):
                output = route.run_verified_python(script, ["--inventory"])
            self.assertNotIn(root.encode(), output)
            self.assertIn(b"argparse.py", output)

    def test_verified_python_uses_isolated_interpreter_and_sanitized_process(self):
        result = subprocess.CompletedProcess([], 0, b"ok\n", b"")
        with patch.object(route.subprocess, "run", return_value=result) as run:
            self.assertEqual(route.run_verified_python(b"print('ok')\n", ["--inventory"]), b"ok\n")
        self.assertEqual(run.call_args.args[0], [route.PYTHON_EXECUTABLE, "-I", "-", "--inventory"])
        self.assertEqual(run.call_args.kwargs["cwd"], "/")
        self.assertEqual(run.call_args.kwargs["env"], route.VERIFIED_ENV)
        self.assertNotIn("PYTHONPATH", run.call_args.kwargs["env"])
        self.assertEqual(run.call_args.kwargs["input"], b"print('ok')\n")

    def test_status_migration_operator_imports_under_isolation(self):
        source = (SCRIPT.parent / "phone11-profile-status-migrate.py").read_bytes()
        with patch.object(route, "PYTHON_EXECUTABLE", sys.executable):
            help_text = route.run_verified_python(source, ["--help"])
        self.assertIn(b"--inventory", help_text)

    def test_direct_migration_inventory_executes_verified_operator_bytes(self):
        operator, sql = b"reviewed migration operator", b"reviewed SQL"
        manifest_value = {
            "schema": "phone11.direct-meetings-migration-manifest/v1",
            "target": {"container_id": route.DIRECT_CONTAINER_ID,
                       "container_name": route.DIRECT_CONTAINER, "image": route.DIRECT_IMAGE,
                       "container_port": route.DIRECT_PORT, "host_port": route.DIRECT_PORT},
            "release": {"source_sha": route.DIRECT_SOURCE_SHA,
                        "bundle_sha256": route.DIRECT_BUNDLE,
                        "lock_sha256": route.CURRENT_LOCK_SHA},
            "database_identity_sha256": "1" * 64,
            "before_catalog_sha256": "2" * 64,
            "after_catalog_sha256": "3" * 64,
            "sql_sha256": route.digest(sql),
        }
        manifest_raw = json.dumps(manifest_value).encode()
        verification = {key: manifest_value[key] for key in (
            "database_identity_sha256", "before_catalog_sha256",
            "after_catalog_sha256", "sql_sha256")}
        receipt_value = {
            "schema": "phone11.direct-meetings-migration-journal/v1",
            "manifest_sha256": route.digest(manifest_raw),
            "sql_sha256": route.digest(sql),
            "database_identity_sha256": "1" * 64,
            "before_catalog_sha256": "2" * 64,
            "after_catalog_sha256": "3" * 64,
            "container_id": route.DIRECT_CONTAINER_ID,
            "image": route.DIRECT_IMAGE,
            "source_sha": route.DIRECT_SOURCE_SHA,
            "bundle_sha256": route.DIRECT_BUNDLE,
            "lock_sha256": route.CURRENT_LOCK_SHA,
            "backup_proof_sha256": "4" * 64,
            "restore_proof_sha256": "5" * 64,
            "status": "applied",
            "verification_sha256": route.digest(json.dumps(
                verification, sort_keys=True, separators=(",", ":")).encode()),
        }
        data = {route.MIGRATION_OPERATOR: operator, route.MIGRATION_SQL: sql,
                route.MIGRATION_MANIFEST: manifest_raw,
                route.MIGRATION_RECEIPT: json.dumps(receipt_value).encode()}
        inventory = {"schema": "phone11.direct-meetings-migration-inventory/v1",
                     "target": manifest_value["target"], "release": manifest_value["release"],
                     "sql_sha256": route.digest(sql),
                     "database_identity_sha256": "1" * 64,
                     "before_catalog_sha256": "3" * 64}
        with patch.object(route, "_protected_directory"), \
             patch.object(route, "read_regular", side_effect=lambda path, **_: (data[path], INFO)), \
             patch.object(route, "MIGRATION_OPERATOR_SHA256", route.digest(operator)), \
             patch.object(route, "MIGRATION_SQL_SHA256", route.digest(sql)), \
             patch.object(route, "run_verified_python", return_value=json.dumps(inventory).encode()) as run:
            self.assertEqual(route.check_migration_applied(), "1" * 64)
            self.assertEqual(run.call_args.args[0], operator)
            self.assertEqual(run.call_args.args[1][0], "--inventory")
            self.assertNotIn(str(route.MIGRATION_OPERATOR), run.call_args.args[1])

    def test_status_migration_inventory_executes_verified_operator_bytes(self):
        operator, sql = b"reviewed migration operator", b"reviewed SQL"
        manifest_value = {
            "schema": "phone11.profile-status-migration-manifest/v1",
            "target": {"container_id": route.CURRENT_CONTAINER_ID,
                       "container_name": route.CURRENT_CONTAINER, "image": route.CURRENT_IMAGE,
                       "container_port": route.CURRENT_PORT, "host_port": route.CURRENT_PORT},
            "release": {"source_sha": route.CURRENT_SOURCE_SHA,
                        "bundle_sha256": route.CURRENT_BUNDLE,
                        "lock_sha256": route.CURRENT_LOCK_SHA},
            "database_identity_sha256": "1" * 64,
            "before_catalog_sha256": "2" * 64,
            "after_catalog_sha256": "3" * 64,
            "sql_sha256": route.digest(sql),
        }
        manifest_raw = json.dumps(manifest_value).encode()
        verification = {key: manifest_value[key] for key in (
            "database_identity_sha256", "before_catalog_sha256",
            "after_catalog_sha256", "sql_sha256")}
        receipt_value = {
            "schema": "phone11.profile-status-migration-journal/v1",
            "manifest_sha256": route.digest(manifest_raw),
            "sql_sha256": route.digest(sql),
            "database_identity_sha256": "1" * 64,
            "before_catalog_sha256": "2" * 64,
            "after_catalog_sha256": "3" * 64,
            "container_id": route.CURRENT_CONTAINER_ID,
            "image": route.CURRENT_IMAGE,
            "source_sha": route.CURRENT_SOURCE_SHA,
            "bundle_sha256": route.CURRENT_BUNDLE,
            "lock_sha256": route.CURRENT_LOCK_SHA,
            "backup_proof_sha256": "4" * 64,
            "restore_proof_sha256": "5" * 64,
            "status": "applied",
            "verification_sha256": route.digest(json.dumps(
                verification, sort_keys=True, separators=(",", ":")).encode()),
        }
        data = {route.STATUS_OPERATOR: operator, route.STATUS_SQL: sql,
                route.STATUS_MANIFEST: manifest_raw,
                route.STATUS_RECEIPT: json.dumps(receipt_value).encode()}
        inventory = {"schema": "phone11.profile-status-migration-inventory/v1",
                     "target": manifest_value["target"], "release": manifest_value["release"],
                     "sql_sha256": route.digest(sql),
                     "database_identity_sha256": "1" * 64,
                     "before_catalog_sha256": "3" * 64}
        with patch.object(route, "_protected_directory"), \
             patch.object(route, "read_regular", side_effect=lambda path, **_: (data[path], INFO)), \
             patch.object(route, "STATUS_OPERATOR_SHA", route.digest(operator)), \
             patch.object(route, "STATUS_SQL_SHA", route.digest(sql)), \
             patch.object(route, "run_verified_python", return_value=json.dumps(inventory).encode()) as run:
            self.assertIsNone(route.check_status_migration_applied("1" * 64))
            self.assertEqual(run.call_args.args[0], operator)
            self.assertEqual(run.call_args.args[1][0], "--inventory")
            self.assertNotIn(str(route.STATUS_OPERATOR), run.call_args.args[1])
            drifted = dict(inventory, before_catalog_sha256="9" * 64)
            with patch.object(route, "run_verified_python", return_value=json.dumps(drifted).encode()):
                with self.assertRaisesRegex(route.GuardError, "status_catalog"):
                    route.check_status_migration_applied("1" * 64)
            receipt_value["status"] = "intent"
            data[route.STATUS_RECEIPT] = json.dumps(receipt_value).encode()
            with self.assertRaisesRegex(route.GuardError, "status_receipt"):
                route.check_status_migration_applied("1" * 64)

    def test_live_pins_and_exact_two_location_roundtrip(self):
        self.assertEqual((route.CURRENT_PORT, route.TARGET_PORT), (3011, 3012))
        self.assertEqual(route.ORIGINAL_SHA256,
                         "2f744bb0df277cd4cbe7a50c2a6f9122530821d7bfa56f32d1fdb2ac64c59520")
        self.assertEqual(route.LOCK, Path("/run/phone11-desktop-provisioning-route.lock"))
        active = route.rewrite_trpc(SITE, 3011, 3012)
        self.assertEqual(active.count(b"proxy_pass http://127.0.0.1:3012;"), 2)
        self.assertIn(b"X-Preserved yes", active)
        self.assertIn(b"proxy_pass http://127.0.0.1:3004;", active)
        self.assertEqual(route.rewrite_trpc(active, 3012, 3011), SITE)
        for changed in (SITE.replace(b":3011", b":3010", 1),
                        SITE.replace(b"location = /api/trpc", b"location /api/trpc", 1)):
            with self.subTest(changed=changed), self.assertRaises(route.GuardError):
                route.rewrite_trpc(changed, 3011, 3012)

    def test_manifest_refuses_missing_or_unreviewed_pins(self):
        path = route.GATE_ROOT / "manifest.json"
        value = manifest()
        with patch.object(route, "_protected_directory"), \
             patch.object(route, "read_regular", return_value=(json.dumps(value).encode(), INFO)):
            loaded, _ = route.load_gate_manifest(path)
            self.assertEqual(loaded["candidate"], PINS)
        value["candidate"]["lock_sha256"] = "0" * 64
        with patch.object(route, "_protected_directory"), \
             patch.object(route, "read_regular", return_value=(json.dumps(value).encode(), INFO)):
            with self.assertRaisesRegex(route.GuardError, "gate_candidate"):
                route.load_gate_manifest(path)
        value = manifest()
        del value["candidate"]["source_sha"]
        with patch.object(route, "_protected_directory"), \
             patch.object(route, "read_regular", return_value=(json.dumps(value).encode(), INFO)):
            with self.assertRaisesRegex(route.GuardError, "gate_manifest"):
                route.load_gate_manifest(path)

    def test_gate_rechecks_direct_and_status_catalogs_and_dnd_off(self):
        value = manifest()
        with patch.object(route, "check_migration_applied", return_value="1" * 64) as direct, \
             patch.object(route, "check_status_migration_applied") as status, \
             patch.object(route, "command", return_value=b"0") as command:
            route.check_gate_manifest(value)
            direct.assert_called_once_with()
            status.assert_called_once_with("1" * 64)
            self.assertEqual(command.call_args.args[0][0:2], ["docker", "exec"])
            self.assertIn(route.CURRENT_CONTAINER, command.call_args.args[0])
            for response in (b"1", b"", b"0\n"):
                with patch.object(route, "command", return_value=response):
                    with self.assertRaisesRegex(route.GuardError, "dnd_off"):
                        route.check_gate_manifest(value)

    def test_candidate_rejects_hook_enabled_before_health(self):
        info = {"Id": PINS["container_id"], "Image": PINS["image"],
                "Config": {"Labels": {
                    "com.phone11.source-sha": PINS["source_sha"],
                    "com.phone11.bundle-sha256": PINS["bundle_sha256"],
                    "com.phone11.lock-sha256": PINS["lock_sha256"],
                    "com.phone11.candidate-build": PINS["build"],
                    "com.phone11.overlay-parent-image-id": route.CURRENT_IMAGE,
                    "com.phone11.overlay-kind": "bundle-only"},
                    "Env": ["PHONE11_VOICEMAIL_HOOK_READY=true"]}}
        with patch.object(route, "container_info", return_value=info), \
             patch.object(route, "command") as command:
            with self.assertRaisesRegex(route.GuardError, "voicemail_hook_off"):
                route.check_candidate(PINS)
            command.assert_not_called()

    def test_prepare_refuses_missing_gate_without_site_write(self):
        with patch.object(route.os, "geteuid", return_value=0), \
             patch.object(route, "lock", return_value=nullcontext()), \
             patch.object(route, "read_regular", return_value=(SITE, INFO)), \
             patch.object(route, "ORIGINAL_SHA256", route.digest(SITE)), \
             patch.object(route, "load_gate_manifest", return_value=(manifest(), b"manifest")), \
             patch.object(route, "check_predecessor"), \
             patch.object(route, "check_current_route_receipt"), \
             patch.object(route, "check_gate_manifest", side_effect=route.GuardError("gate_artifact")), \
             patch.object(route, "atomic_write") as write:
            with self.assertRaisesRegex(route.GuardError, "gate_artifact"):
                route.prepare(route.GATE_ROOT / "manifest.json")
            write.assert_not_called()

    def test_activation_failure_restores_3011_and_keeps_prepared_receipt(self):
        active = route.rewrite_trpc(SITE, 3011, 3012)
        with TemporaryDirectory() as root:
            site_path = Path(root) / "site"
            site_path.write_bytes(SITE)
            record = {"candidate": dict(PINS), "gate_manifest_sha256": route.digest(b"manifest"),
                      "state": "prepared"}
            def read(path, **_):
                return path.read_bytes(), INFO
            def write(path, data, **_):
                path.write_bytes(data)
            with patch.object(route, "SITE", site_path), \
                 patch.object(route.os, "geteuid", return_value=0), \
                 patch.object(route, "lock", return_value=nullcontext()), \
                 patch.object(route, "ensure_state_root"), \
                 patch.object(route, "load_receipt", return_value=(record, SITE, active)), \
                 patch.object(route, "load_gate_manifest", return_value=(manifest(), b"manifest")), \
                 patch.object(route, "read_regular", side_effect=read), \
                 patch.object(route, "atomic_write", side_effect=write), \
                 patch.object(route, "check_predecessor"), \
                 patch.object(route, "check_current_route_receipt"), \
                 patch.object(route, "check_gate_manifest"), \
                 patch.object(route, "check_candidate", side_effect=[None, route.GuardError("candidate_http")]), \
                 patch.object(route, "nginx_validate_and_reload") as reload:
                with self.assertRaisesRegex(route.GuardError, "candidate_http"):
                    route.activate(Path(root) / "receipt")
                self.assertEqual(site_path.read_bytes(), SITE)
                self.assertEqual(record["state"], "prepared")
                self.assertEqual(reload.call_count, 2)

    def test_rollback_and_interrupted_recovery_restore_sealed_3011_site(self):
        active = route.rewrite_trpc(SITE, 3011, 3012)
        with TemporaryDirectory() as root:
            (Path(root) / "receipt").mkdir()
            site_path = Path(root) / "site"
            site_path.write_bytes(active)
            record = {"state": "active"}
            def read(path, **_):
                return path.read_bytes(), INFO
            def write(path, data, **_):
                path.write_bytes(data)
            with patch.object(route, "SITE", site_path), \
                 patch.object(route.os, "geteuid", return_value=0), \
                 patch.object(route, "lock", return_value=nullcontext()), \
                 patch.object(route, "ensure_state_root"), \
                 patch.object(route, "load_receipt", return_value=(record, SITE, active)), \
                 patch.object(route, "read_regular", side_effect=read), \
                 patch.object(route, "atomic_write", side_effect=write), \
                 patch.object(route, "check_predecessor"), \
                 patch.object(route, "nginx_validate_and_reload") as reload:
                route.rollback(Path(root) / "receipt")
                self.assertEqual(site_path.read_bytes(), SITE)
                self.assertEqual(record["state"], "rolled_back")
                self.assertEqual(reload.call_count, 1)
                record["state"] = "prepared"  # Interrupted activation after site write.
                site_path.write_bytes(active)
                route.recover(Path(root) / "receipt")
                self.assertEqual(site_path.read_bytes(), SITE)
                self.assertEqual(record["state"], "rolled_back")
                self.assertEqual(reload.call_count, 2)
                record["state"] = "active"  # Interrupted rollback after file restore.
                route.recover(Path(root) / "receipt")
                self.assertEqual(site_path.read_bytes(), SITE)
                self.assertEqual(reload.call_count, 3)


if __name__ == "__main__":
    unittest.main()
