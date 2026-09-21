"""Hermetic safety checks for the candidate-only blue/green operator."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch


SCRIPT = Path(__file__).parents[1] / "scripts" / "phone11-candidate-bluegreen.py"
SPEC = importlib.util.spec_from_file_location("phone11_candidate_bluegreen", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
blue = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = blue
SPEC.loader.exec_module(blue)

SHA = "1" * 64
BASE_IMAGE = "sha256:" + "2" * 64
CURRENT_IMAGE = "sha256:" + "3" * 64
RELEASE_IMAGE = "sha256:" + "4" * 64


def manifest(**changes):
    value = {
        "schema": blue.SCHEMA,
        "baseline": {"container_id": "a" * 64, "image": BASE_IMAGE, "runtime_sha256": SHA, "build": "baseline-a131764"},
        "current_candidate": {
            "container_id": "b" * 64, "image": CURRENT_IMAGE, "runtime_sha256": SHA,
            "build": "read-receipts-a0f5c46-0c3c4e227148", "compose_file": "/root/current.json",
            "compose_sha256": SHA, "rendered_sha256": SHA,
        },
        "release": {"image": RELEASE_IMAGE, "build": "release-44815d1", "source_sha": "5" * 40, "bundle_sha256": SHA, "lock_sha256": SHA},
        "target": {"project": "phone11-api-candidate-next", "tenant_id": 1, "denied_tenant_id": 2_147_483_647},
        "probes": {"file": "/root/probes.json", "sha256": SHA},
        "nginx": {"site": "/etc/nginx/sites-enabled/phone11ai", "site_sha256": SHA, "dump_sha256": SHA,
                  "marker": "# PHONE11_PARALLEL_API_INSERT reviewed-123"},
        "kamailio": {"config_path": "/etc/kamailio/kamailio.cfg", "config_sha256": SHA, "wake_occurrences": 4},
        "public_origin": blue.PUBLIC_ORIGIN,
    }
    for dotted, replacement in changes.items():
        section, key = dotted.split("__", 1)
        value[section][key] = replacement
    return value


def pins(**changes):
    return blue.parse_manifest(manifest(**changes))


def inspect(current_pins):
    return {
        "Id": current_pins.current.container_id,
        "Image": current_pins.current.image,
        "Config": {
            "Image": "phone11-backend:read-receipts",
            "Env": [
                "PHONE11_RUNTIME_ROLE=api-candidate", "PORT=3002",
                f"PHONE11_BUILD_SHA={current_pins.current.build}", "DATABASE_URL=postgres://user:pa$$word@db/live",
            ],
        },
    }


def rendered():
    return {
        "name": "phone11-api-candidate",
        "services": {
            "candidate": {
                "container_name": blue.CURRENT_CONTAINER,
                "image": "phone11-backend:read-receipts",
                "environment": {"PHONE11_RUNTIME_ROLE": "api-candidate", "PORT": "3002"},
                "ports": [{"host_ip": "127.0.0.1", "published": 3002, "target": 3002, "protocol": "tcp"}],
                "command": ["node", "dist/index.js"],
                "volumes": [{"type": "bind", "source": "/tmp", "target": "/mnt"}],
                "healthcheck": {"test": ["CMD-SHELL", "curl http://127.0.0.1:3002/api/health && test read-receipts-a0f5c46-0c3c4e227148"]},
                "restart": "unless-stopped",
            },
        },
        "networks": {"default": {"name": "phone11-owned-auth_default"}},
    }


def probe_document():
    probes = []
    for label in sorted(blue.SOURCE_PROBES):
        path, method = "/api/trpc/chat.typingPublish", "POST"
        if label == "existing_phone":
            path, method = "/api/trpc/phone.getConfig?input=%7B%22json%22%3Anull%7D", "GET"
        elif label == "mixed_batch":
            path = "/api/trpc/phone.getConfig,chat.list?batch=1&input=%7B%7D"
        probes.append({"label": label, "method": method, "path": path,
                       "headers": {"Authorization": "Bearer protected"}, "body": "" if method == "GET" else "{}",
                       "status": 200, "required": ["result"], "forbidden": ["credential"]})
    return {"schema": "phone11-parallel-api-probes/v1", "probes": probes}


class BlueGreenTests(unittest.TestCase):
    def test_manifest_pins_distinct_release_and_literal_origin(self):
        self.assertEqual(pins().release_image, RELEASE_IMAGE)
        with self.assertRaises(blue.GuardError):
            pins(release__image=CURRENT_IMAGE)
        changed = manifest()
        changed["public_origin"] = "https://evil.example"
        with self.assertRaises(blue.GuardError):
            blue.parse_manifest(changed)

    def test_clone_keeps_secret_environment_in_memory_and_changes_only_candidate_identity(self):
        current = pins()
        target = blue.cloned_config(rendered(), inspect(current), current)
        service = target["services"][blue.TARGET_SERVICE]
        self.assertEqual(service["container_name"], blue.TARGET_CONTAINER)
        self.assertEqual(service["image"], RELEASE_IMAGE)
        self.assertEqual(service["environment"]["DATABASE_URL"], "postgres://user:pa$$$$word@db/live")
        self.assertEqual(service["environment"]["PHONE11_RUNTIME_ROLE"], "api-candidate")
        self.assertEqual(service["environment"]["PORT"], "3003")
        self.assertEqual(service["ports"], [{
            "host_ip": "127.0.0.1", "published": "3003", "target": 3003,
            "protocol": "tcp", "mode": "ingress",
        }])
        self.assertIn(":3003", service["healthcheck"]["test"][1])
        self.assertIn(current.release_build, service["healthcheck"]["test"][1])
        self.assertNotIn(current.current.build, service["healthcheck"]["test"][1])
        self.assertEqual(target["networks"], rendered()["networks"])

    def test_compose_roundtrip_requires_exact_env_mount_command_and_health_model(self):
        current = pins()
        target = blue.cloned_config(rendered(), inspect(current), current)
        blue.validate_target_roundtrip(target, json.loads(json.dumps(target)))
        for key in ("environment", "healthcheck", "ports", "command", "volumes"):
            changed = json.loads(json.dumps(target))
            changed["services"][blue.TARGET_SERVICE][key] = {} if key in {"environment", "healthcheck"} else []
            with self.assertRaises(blue.GuardError):
                blue.validate_target_roundtrip(target, changed)

    def test_proxy_changes_only_exact_and_prefix_trpc(self):
        fragment = blue.proxy_fragment("# PHONE11_PARALLEL_API_INSERT reviewed-123", "release-44815d1", 3003)
        self.assertEqual(fragment.count(b"proxy_pass http://127.0.0.1:3003;"), 2)
        self.assertEqual(fragment.count(b"location = /api/trpc"), 1)
        self.assertEqual(fragment.count(b"location ^~ /api/trpc/"), 1)
        self.assertNotIn(b"/api/profile", fragment)
        self.assertNotIn(b"/api/chat/media", fragment)

    def test_photo_catalog_check_uses_application_database_config_read_only(self):
        self.assertIn("process.env.DATABASE_URL", blue.PHOTO_CATALOG_NODE)
        self.assertIn("BEGIN TRANSACTION READ ONLY", blue.PHOTO_CATALOG_NODE)
        self.assertNotIn("new pg.Client()", blue.PHOTO_CATALOG_NODE)

    def test_probe_contract_derives_seven_read_only_checks_from_existing_auth(self):
        raw = json.dumps(probe_document(), separators=(",", ":")).encode()
        current = pins(probes__sha256=blue.sha256_bytes(raw))
        loaded = blue.load_probes(raw, current)
        self.assertEqual({item["label"] for item in loaded}, blue.EXPECTED_PROBES)
        self.assertTrue(all(item["method"] == "GET" and item["body"] == "" for item in loaded))
        self.assertEqual({item["headers"]["Authorization"] for item in loaded}, {"Bearer protected"})
        photo = next(item for item in loaded if item["label"] == "profile_photo_unavailable")
        tenant = next(item for item in loaded if item["label"] == "management_tenant")
        denied = next(item for item in loaded if item["label"] == "denied_tenant")
        self.assertIn('"available":false', photo["required"])
        self.assertEqual(
            (tenant["path"].split("?", 1)[0], tenant["status"]),
            ("/api/trpc/pbx.tenant.get", 200),
        )
        self.assertIn('"settingsAvailable":false', tenant["required"])
        self.assertEqual((denied["status"], denied["required"]), (403, ["FORBIDDEN"]))
        changed = probe_document()
        phone = next(item for item in changed["probes"] if item["label"] == "existing_phone")
        phone["method"], phone["body"] = "POST", "{}"
        bad = json.dumps(changed, separators=(",", ":")).encode()
        with self.assertRaises(blue.GuardError):
            blue.load_probes(bad, pins(probes__sha256=blue.sha256_bytes(bad)))

    def test_inventory_mode_requires_all_inputs_and_exact_source_sha(self):
        with self.assertRaises(SystemExit):
            blue.parse_args(["--inventory"])
        arguments = blue.parse_args([
            "--inventory", "--output", "/root/manifest.json",
            "--current-compose-file", "/root/candidate.compose.json",
            "--probes-file", "/root/probes.json", "--nginx-site", "/etc/nginx/sites-enabled/phone11ai",
            "--release-image", RELEASE_IMAGE, "--release-build", "release-e7270a6",
            "--release-source-sha", "5" * 40, "--tenant-id", "1", "--denied-tenant-id", "2147483647",
        ])
        self.assertTrue(arguments.inventory)
        self.assertEqual(arguments.release_source_sha, "5" * 40)

    def test_target_absence_checks_dedicated_name_and_port(self):
        operator = blue.Operator(pins(), Mock())
        operator.system.command.return_value = b"cp11-backend\ncp11-api-candidate\n"
        fake_socket = Mock()
        with patch.object(blue.socket, "socket", return_value=fake_socket):
            operator.target_absent()
        fake_socket.bind.assert_called_once_with(("127.0.0.1", 3003))

    def test_target_start_wait_tolerates_transient_unhealthy_state(self):
        operator = blue.Operator(pins(), Mock())
        ready = {"Id": "ready"}
        operator.target = Mock(side_effect=[blue.GuardError("target_runtime"), ready])
        with patch.object(blue.time, "sleep"):
            self.assertEqual(operator.wait_target(), ready)
        self.assertEqual(operator.target.call_count, 2)

    def test_restore_proves_local_and_public_routes_return_current_marker(self):
        with tempfile.TemporaryDirectory() as directory:
            site = Path(directory) / "phone11ai"
            original, active = b"old nginx", b"new nginx"
            site.write_bytes(active)
            raw_probes = json.dumps(probe_document(), separators=(",", ":")).encode()
            current = pins(
                nginx__site=str(site), nginx__site_sha256=blue.sha256_bytes(original),
                probes__sha256=blue.sha256_bytes(raw_probes),
            )
            receipt = json.dumps({
                "schema": blue.SCHEMA, "site": str(site), "before": blue.sha256_bytes(original),
                "active": blue.sha256_bytes(active), "target_container": blue.TARGET_CONTAINER,
                "target_build": current.release_build,
            }, sort_keys=True, separators=(",", ":")).encode()
            operator = blue.Operator(current, Mock())
            operator.probes = blue.load_probes(raw_probes, current)
            operator.runtime = Mock()
            operator.wake = Mock()

            def protected_read(path, **_kwargs):
                if path == blue.ROLLBACK_RECEIPT:
                    return receipt
                if path == blue.ROLLBACK_SITE:
                    return original
                if path == site:
                    return active
                raise AssertionError(path)

            with patch.object(blue, "secure_read", side_effect=protected_read), \
                 patch.object(blue, "atomic_write"), \
                 patch.object(blue, "wait_for_route") as wait:
                operator.restore(expected=active)
            self.assertEqual(wait.call_count, 2)
            self.assertEqual(wait.call_args_list[0].args[1], "http://127.0.0.1")
            self.assertEqual(wait.call_args_list[1].args[1], blue.PUBLIC_ORIGIN)
            self.assertTrue(all(call.args[3] == current.current.build for call in wait.call_args_list))

    def test_activation_failure_after_route_restores_exact_old_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            site = Path(directory) / "phone11ai"
            site.write_bytes(b"placeholder")
            current = pins(nginx__site=str(site))
            operator = blue.Operator(current, Mock())
            operator.prepare = Mock()
            operator.target_config = rendered()
            operator.probes = []
            operator.target = Mock()
            operator.photos_absent = Mock()
            operator.wake = Mock()
            operator.runtime = Mock(side_effect=lambda name, *_args: {
                "Id": current.baseline.container_id if name == blue.BASELINE_CONTAINER else current.current.container_id,
            })
            original = b"server {\n" + blue.proxy_fragment(current.nginx_marker, current.current.build, 3002) + b"}\n"
            routed = original.replace(
                blue.proxy_fragment(current.nginx_marker, current.current.build, 3002).rstrip(b"\n"),
                blue.proxy_fragment(current.nginx_marker, current.release_build, 3003).rstrip(b"\n"),
            )
            operator.nginx = Mock(return_value=original)
            operator.save_rollback = Mock()
            operator.restore = Mock()
            operator.system.command.return_value = b""
            operator.system.request.side_effect = blue.GuardError("readiness")
            context = Mock()
            context.__enter__ = Mock(return_value=Path("/root/frozen.json"))
            context.__exit__ = Mock(return_value=False)
            with patch.object(blue, "frozen_candidate_config", return_value=context), \
                 patch.object(blue, "atomic_write"), \
                 patch.object(blue, "secure_read", return_value=routed), \
                 self.assertRaises(blue.GuardError):
                operator.activate()
            operator.restore.assert_called_once_with(expected=routed)


if __name__ == "__main__":
    unittest.main()
