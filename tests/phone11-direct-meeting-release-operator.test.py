"""Hermetic checks for the source-only 3010 -> 3011 direct meeting operators."""
from __future__ import annotations

from contextlib import nullcontext
import importlib.util
import json
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory, TemporaryFile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).parents[1] / "scripts"


def load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / filename)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


start = load("phone11_direct_meeting_release_start", "phone11-direct-meeting-release-start.py")
route = load("phone11_direct_meeting_release_route", "phone11-direct-meeting-release-route.py")
overlay = load("phone11_direct_meeting_overlay_image_for_route", "phone11-direct-meeting-overlay-image.py")
SITE = b"""location = /api/trpc {
    proxy_pass http://127.0.0.1:3010;
    add_header X-Preserved yes;
}
location ^~ /api/trpc/ {
    proxy_pass http://127.0.0.1:3010;
}
location = /api/mobile/config {
    proxy_pass http://127.0.0.1:3004;
}
"""
INFO = SimpleNamespace(st_uid=0, st_gid=0, st_mode=0o100644)


class DirectMeetingOperatorTest(unittest.TestCase):
    def test_protected_environment_uses_inherited_memory_fd(self):
        with TemporaryFile() as backing:
            with patch.object(start.os, "memfd_create", return_value=os.dup(backing.fileno()), create=True), \
                 patch.object(start.os, "MFD_CLOEXEC", 1, create=True), \
                 patch.object(start.subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout="a" * 64)) as command:
                result = start.create_with_memory_environment(
                    ["docker", "create", "--name", start.TARGET], {"PRIVATE_TEST_VALUE": "sentinel"}, "sha256:" + "b" * 64)
            self.assertEqual(result, "a" * 64)
            args = command.call_args.args[0]
            self.assertIn("--env-file", args)
            self.assertTrue(args[args.index("--env-file") + 1].startswith("/proc/self/fd/"))
            self.assertNotIn("sentinel", " ".join(args))
            self.assertEqual(len(command.call_args.kwargs["pass_fds"]), 1)

    def test_pins_and_shared_lock(self):
        self.assertEqual((route.CURRENT_PORT, route.TARGET_PORT), (3010, 3011))
        self.assertEqual(start.SOURCE, route.CURRENT_CONTAINER)
        self.assertEqual(start.SOURCE_IMAGE, route.CURRENT_IMAGE)
        self.assertEqual(start.SOURCE_BUNDLE, route.CURRENT_BUNDLE)
        self.assertEqual(start.TARGET, route.TARGET_CONTAINER)
        self.assertEqual(start.TARGET_BUNDLE, route.TARGET_BUNDLE)
        self.assertEqual(start.TARGET_SOURCE_SHA, route.TARGET_SOURCE_SHA)
        self.assertEqual(start.BUILD, route.TARGET_BUILD)
        self.assertEqual(overlay.PARENT_IMAGE, route.CURRENT_IMAGE)
        self.assertEqual(overlay.PARENT_BUNDLE, route.CURRENT_BUNDLE)
        self.assertEqual(overlay.SOURCE_CONTAINER, route.CURRENT_CONTAINER)
        self.assertEqual(overlay.SOURCE_SHA, route.TARGET_SOURCE_SHA)
        self.assertEqual(overlay.BUNDLE_SHA, route.TARGET_BUNDLE)
        self.assertEqual(overlay.BUILD, route.TARGET_BUILD)
        self.assertEqual(route.TARGET_SOURCE_SHA, "00b2ef21518c092819c95ae956963f5f191543e4")
        self.assertEqual(route.TARGET_BUNDLE, "1f5abb9e19da7a6040d26634d64f8ea139049c61840884477afafc097ae14bbe")
        self.assertEqual(route.LOCK, Path("/run/phone11-desktop-provisioning-route.lock"))
        self.assertEqual(route.ORIGINAL_SHA256, "1b9b4c7d89d2c65c6bf8b730decd57513c46194fe21b5470981c7525d0b0ed26")

    def test_two_locations_only_and_roundtrip(self):
        active = route.rewrite_trpc(SITE, 3010, 3011)
        self.assertEqual(active.count(b"proxy_pass http://127.0.0.1:3011;"), 2)
        self.assertIn(b"X-Preserved yes", active)
        self.assertIn(b"proxy_pass http://127.0.0.1:3004;", active)
        self.assertEqual(route.rewrite_trpc(active, 3011, 3010), SITE)
        for drift in (SITE.replace(b":3010", b":3007", 1), SITE.replace(b"location = /api/trpc", b"location /api/trpc", 1)):
            with self.subTest(drift=drift), self.assertRaises(route.GuardError):
                route.rewrite_trpc(drift, 3011, 3011)

    def test_only_exact_loopback_host_binding_is_accepted(self):
        for port in (3010, 3011):
            with self.subTest(port=port):
                binding = {f"{port}/tcp": [{"HostIp": "127.0.0.1", "HostPort": str(port)}]}
                info = {"HostConfig": {"PortBindings": binding},
                        "NetworkSettings": {"Ports": {**binding, "3000/tcp": None}}}
                route.require_loopback_binding(info, port, "binding")
                extra = {"3000/tcp": [{"HostIp": "0.0.0.0", "HostPort": "3000"}]}
                for field in ("HostConfig", "NetworkSettings"):
                    exposed = {"HostConfig": {"PortBindings": dict(binding)},
                               "NetworkSettings": {"Ports": {**binding, "3000/tcp": None}}}
                    key = "PortBindings" if field == "HostConfig" else "Ports"
                    exposed[field][key].update(extra)
                    with self.assertRaisesRegex(route.GuardError, "binding"):
                        route.require_loopback_binding(exposed, port, "binding")

    def test_start_refuses_candidate_source_label_drift_before_container_creation(self):
        source = {"Image": start.SOURCE_IMAGE, "State": {"Status": "running"}}
        image = {"Id": "sha256:" + "a" * 64, "Config": {"Labels": {
            "com.phone11.source-sha": "1" * 40, "com.phone11.bundle-sha256": start.TARGET_BUNDLE}}}
        with patch.object(start.os, "geteuid", return_value=0), patch.object(start, "file_hash", return_value=start.TARGET_BUNDLE), \
             patch.object(start, "inspect", side_effect=[source, image]), patch.object(start, "run") as run:
            with self.assertRaisesRegex(RuntimeError, "candidate image changed"):
                start.main(image["Id"])
            run.assert_not_called()

    def test_prepare_seals_snapshots_without_rewriting_site(self):
        active = route.rewrite_trpc(SITE, 3010, 3011)
        with TemporaryDirectory() as root:
            state = Path(root)
            site_path = state / "site"
            site_path.write_bytes(SITE)
            def read(path, **_):
                return path.read_bytes(), INFO
            def write(path, data, **_):
                path.write_bytes(data)
            with patch.object(route, "STATE_ROOT", state), patch.object(route, "SITE", site_path), \
                 patch.object(route, "ORIGINAL_SHA256", route.digest(SITE)), \
                 patch.object(route.os, "geteuid", return_value=0), \
                 patch.object(route, "lock", return_value=nullcontext()), \
                 patch.object(route, "ensure_state_root"), \
                 patch.object(route, "check_predecessor") as predecessor, \
                 patch.object(route, "check_candidate") as candidate, \
                 patch.object(route, "read_regular", side_effect=read), \
                 patch.object(route, "atomic_write", side_effect=write):
                route.prepare("a" * 64)
            receipt_dir, = [p for p in state.iterdir() if p.is_dir()]
            self.assertEqual(site_path.read_bytes(), SITE)
            self.assertEqual((receipt_dir / "site.before").read_bytes(), SITE)
            self.assertEqual((receipt_dir / "site.active").read_bytes(), active)
            self.assertIn(b'"state":"prepared"', (receipt_dir / "receipt.json").read_bytes())
            predecessor.assert_called_once()
            candidate.assert_called_once_with("a" * 64, route.TARGET_BUNDLE, route.TARGET_BUILD)

    def test_activate_rechecks_and_can_rollback_exact_snapshot(self):
        active = route.rewrite_trpc(SITE, 3010, 3011)
        record = {"state": "prepared", "target_image": "sha256:" + "a" * 64}
        with TemporaryDirectory() as root:
            state = Path(root)
            receipt_dir = state / "receipt"
            receipt_dir.mkdir()
            site_path = state / "site"
            site_path.write_bytes(SITE)
            def read(path, **_):
                return path.read_bytes(), INFO
            def write(path, data, **_):
                path.write_bytes(data)
            with patch.object(route, "STATE_ROOT", state), patch.object(route, "SITE", site_path), \
                 patch.object(route.os, "geteuid", return_value=0), patch.object(route, "lock", return_value=nullcontext()), \
                 patch.object(route, "ensure_state_root"), patch.object(route, "load_receipt", return_value=(record, SITE, active)) as load_receipt, \
                 patch.object(route, "check_predecessor"), patch.object(route, "check_candidate") as candidate, \
                 patch.object(route, "read_regular", side_effect=read), patch.object(route, "atomic_write", side_effect=write), \
                 patch.object(route, "nginx_validate_and_reload") as reload:
                route.activate(receipt_dir)
                self.assertEqual(site_path.read_bytes(), active)
                self.assertEqual(record["state"], "active")
                self.assertIn(b'"state":"active"', (receipt_dir / "receipt.json").read_bytes())
                route.rollback(receipt_dir)
                self.assertEqual(site_path.read_bytes(), SITE)
                self.assertEqual(record["state"], "rolled_back")
                self.assertIn(b'"state":"rolled_back"', (receipt_dir / "receipt.json").read_bytes())
                self.assertEqual(load_receipt.call_count, 2)
                candidate.assert_called_once_with("a" * 64, route.TARGET_BUNDLE, route.TARGET_BUILD)
                self.assertEqual(reload.call_count, 2)

    def test_activation_refuses_site_drift_before_candidate_check(self):
        active = route.rewrite_trpc(SITE, 3010, 3011)
        record = {"state": "prepared", "target_image": "sha256:" + "a" * 64}
        with TemporaryDirectory() as root:
            site_path = Path(root) / "site"
            site_path.write_bytes(SITE + b"# changed\n")
            with patch.object(route, "SITE", site_path), patch.object(route.os, "geteuid", return_value=0), \
                 patch.object(route, "lock", return_value=nullcontext()), patch.object(route, "ensure_state_root"), \
                 patch.object(route, "load_receipt", return_value=(record, SITE, active)), \
                 patch.object(route, "read_regular", return_value=(site_path.read_bytes(), INFO)), \
                 patch.object(route, "check_candidate") as candidate, patch.object(route, "atomic_write") as write:
                with self.assertRaisesRegex(route.GuardError, "site_drift"):
                    route.activate(Path(root) / "receipt")
                candidate.assert_not_called()
                write.assert_not_called()

    def test_rollback_refuses_site_drift(self):
        active = route.rewrite_trpc(SITE, 3010, 3011)
        with TemporaryDirectory() as root:
            site_path = Path(root) / "site"
            site_path.write_bytes(SITE)
            with patch.object(route, "SITE", site_path), patch.object(route.os, "geteuid", return_value=0), \
                 patch.object(route, "lock", return_value=nullcontext()), patch.object(route, "ensure_state_root"), \
                 patch.object(route, "load_receipt", return_value=({"state": "active"}, SITE, active)), \
                 patch.object(route, "read_regular", return_value=(SITE, INFO)), \
                 patch.object(route, "atomic_write") as write:
                with self.assertRaisesRegex(route.GuardError, "site_drift"):
                    route.rollback(Path(root) / "receipt")
                write.assert_not_called()

    def test_receipt_integrity_rejects_tampered_snapshot(self):
        active = route.rewrite_trpc(SITE, 3010, 3011)
        with TemporaryDirectory() as root:
            state = Path(root)
            receipt_dir = state / "receipt"
            receipt_dir.mkdir()
            record = {"schema": route.SCHEMA, "site": str(route.SITE),
                      "before_sha256": route.digest(SITE), "active_sha256": route.digest(active),
                      "target_container": route.TARGET_CONTAINER, "target_image": "sha256:" + "a" * 64,
                      "target_source_sha": route.TARGET_SOURCE_SHA,
                      "target_bundle_sha256": route.TARGET_BUNDLE,
                      "target_build": route.TARGET_BUILD, "state": "prepared"}
            def read(path, **_):
                if path.name == "receipt.json":
                    return json.dumps(record).encode(), INFO
                if path.name == "site.before":
                    return SITE, INFO
                return active + b"# tampered\n", INFO
            directory = SimpleNamespace(st_mode=0o040700, st_uid=0, st_gid=0)
            with patch.object(route, "STATE_ROOT", state), patch.object(route, "ORIGINAL_SHA256", route.digest(SITE)), \
                 patch.object(Path, "lstat", return_value=directory), \
                 patch.object(route, "read_regular", side_effect=read):
                with self.assertRaisesRegex(route.GuardError, "receipt_integrity"):
                    route.load_receipt(receipt_dir, "prepared")

    def test_failed_nginx_reload_restores_original_site(self):
        active = route.rewrite_trpc(SITE, 3010, 3011)
        record = {"state": "prepared", "target_image": "sha256:" + "a" * 64}
        with TemporaryDirectory() as root:
            site_path = Path(root) / "site"
            site_path.write_bytes(SITE)
            def read(path, **_):
                return path.read_bytes(), INFO
            def write(path, data, **_):
                path.write_bytes(data)
            reload_calls = 0
            def reload():
                nonlocal reload_calls
                reload_calls += 1
                if reload_calls == 1:
                    raise route.GuardError("nginx_failed")
            with patch.object(route, "SITE", site_path), patch.object(route.os, "geteuid", return_value=0), \
                 patch.object(route, "lock", return_value=nullcontext()), patch.object(route, "ensure_state_root"), \
                 patch.object(route, "load_receipt", return_value=(record, SITE, active)), \
                 patch.object(route, "check_predecessor"), patch.object(route, "check_candidate"), \
                 patch.object(route, "read_regular", side_effect=read), patch.object(route, "atomic_write", side_effect=write), \
                 patch.object(route, "nginx_validate_and_reload", side_effect=reload):
                with self.assertRaisesRegex(route.GuardError, "nginx_failed"):
                    route.activate(Path(root) / "receipt")
                self.assertEqual(site_path.read_bytes(), SITE)
                self.assertEqual(record["state"], "prepared")
                self.assertEqual(reload_calls, 2)


if __name__ == "__main__":
    unittest.main()
