"""Hermetic safety checks for the candidate-only blue/green operator."""

from __future__ import annotations

from dataclasses import replace
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

RECOVERY_SCRIPT = Path(__file__).parents[1] / "scripts" / "phone11-recovery-rollout.py"
RECOVERY_SPEC = importlib.util.spec_from_file_location("phone11_recovery_rollout_fixture", RECOVERY_SCRIPT)
assert RECOVERY_SPEC is not None and RECOVERY_SPEC.loader is not None
recovery = importlib.util.module_from_spec(RECOVERY_SPEC)
sys.modules[RECOVERY_SPEC.name] = recovery
RECOVERY_SPEC.loader.exec_module(recovery)

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


def settings_manifest():
    return {
        "schema": blue.SETTINGS_SCHEMA,
        "topology": blue.settings_topology_document(),
        "baseline": {"container_id": "a" * 64, "image": BASE_IMAGE, "runtime_sha256": SHA, "build": "baseline-a131764"},
        "retained_candidate": {"container_id": "b" * 64, "image": CURRENT_IMAGE, "runtime_sha256": SHA, "build": "retained-a0f5c46"},
        "active_candidate": {
            "container_id": "c" * 64, "image": "sha256:" + "5" * 64, "runtime_sha256": SHA,
            "build": "management-39523ae", "compose_file": "/root/active-3003.json",
            "compose_sha256": SHA, "rendered_sha256": SHA,
        },
        "recovery_candidate": {"container_id": "d" * 64, "image": "sha256:" + "6" * 64, "runtime_sha256": SHA, "build": "recovery-bbd14cf"},
        "release": {"image": RELEASE_IMAGE, "build": "settings-9804c2f", "source_sha": "7" * 40, "bundle_sha256": SHA, "lock_sha256": SHA},
        "target": {"project": blue.SETTINGS_TARGET_PROJECT, "tenant_id": 1, "denied_tenant_id": 2_147_483_647},
        "probes": {"file": "/root/probes.json", "sha256": SHA},
        "nginx": {"site": "/etc/nginx/sites-enabled/phone11ai", "site_sha256": SHA, "dump_sha256": SHA,
                  "marker": "# PHONE11_PARALLEL_API_INSERT read-receipts-a0f5c46-0c3c4e227148"},
        "kamailio": {"config_path": "/etc/kamailio/kamailio.cfg", "config_sha256": SHA, "wake_occurrences": 4},
        "public_origin": blue.PUBLIC_ORIGIN,
    }


def settings_pins():
    return blue.parse_manifest(settings_manifest())


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


def settings_inspect(current_pins):
    return {
        "Id": current_pins.current.container_id,
        "Image": current_pins.current.image,
        "Config": {
            "Image": "phone11-backend:management-39523ae",
            "Env": [
                "PHONE11_RUNTIME_ROLE=api-candidate", "PORT=3003",
                f"PHONE11_BUILD_SHA={current_pins.current.build}", "DATABASE_URL=postgres://user:pa$$word@db/live",
            ],
        },
    }


def settings_inventory_arguments():
    return blue.parse_args([
        "--inventory", "--settings-topology", "--output", "/root/settings.json",
        "--current-compose-file", "/root/active-3003.json", "--probes-file", "/root/probes.json",
        "--nginx-site", "/etc/nginx/sites-enabled/phone11ai", "--release-image", RELEASE_IMAGE,
        "--release-build", "settings-9804c2f", "--release-source-sha", "7" * 40,
        "--tenant-id", "1", "--denied-tenant-id", "2147483647",
    ])


def settings_inventory_runtimes(document):
    active = settings_inspect(settings_pins())
    return [
        ({"Id": "a" * 64}, document["baseline"]),
        ({"Id": "b" * 64}, document["retained_candidate"]),
        (active, {key: value for key, value in document["active_candidate"].items()
                  if key in {"container_id", "image", "runtime_sha256", "build"}}),
        ({"Id": "d" * 64}, document["recovery_candidate"]),
    ]


def settings_inventory_system():
    document = settings_manifest()
    system = Mock()
    system.json_command.side_effect = [settings_rendered(), [{
        "Id": RELEASE_IMAGE,
        "Config": {"Labels": {
            "com.phone11.source-sha": "7" * 40,
            "com.phone11.bundle-sha256": SHA,
            "com.phone11.lock-sha256": SHA,
        }},
    }]]
    system.command.side_effect = [
        b"cp11-backend\ncp11-api-candidate\ncp11-api-candidate-next\ncp11-password-recovery\n",
        blue.pilot.WAKE_URL.encode(),
        b"nginx dump",
    ]
    return document, system


def settings_inventory_reader(arguments, site):
    raw_probes = json.dumps(probe_document(), separators=(",", ":")).encode()

    def protected_read(path, **_kwargs):
        if path == arguments.current_compose_file:
            return b"active compose"
        if path == arguments.probes_file:
            return raw_probes
        if path == arguments.nginx_site:
            return site
        raise AssertionError(path)

    return protected_read


def settings_inventory_site(document):
    marker = document["nginx"]["marker"]
    original = f"server {{\n    {marker}\n}}\n".encode()
    with_trpc = original.replace(
        marker.encode(),
        blue.proxy_fragment(
            marker, document["active_candidate"]["build"], 3003, {3003, 3005}
        ).rstrip(b"\n"),
    )
    return with_trpc.replace(
        marker.encode(),
        recovery.proxy_fragment(marker, document["recovery_candidate"]["build"]).rstrip(b"\n"),
    )


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


def settings_rendered():
    value = rendered()
    service = value["services"]["candidate"]
    service["container_name"] = blue.SETTINGS_CURRENT_CONTAINER
    service["image"] = "phone11-backend:management-39523ae"
    service["environment"]["PORT"] = "3003"
    service["ports"][0].update({"published": 3003, "target": 3003})
    service["healthcheck"]["test"][1] = "curl http://127.0.0.1:3003/api/health && test management-39523ae"
    return value


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

    def test_settings_manifest_requires_the_fixed_four_retained_ports_and_3005_target(self):
        current = settings_pins()
        self.assertEqual(current.schema, blue.SETTINGS_SCHEMA)
        self.assertEqual(
            (current.topology.baseline_port, current.topology.retained_port,
             current.topology.current_port, current.topology.recovery_port,
             current.topology.target_port),
            (3000, 3002, 3003, 3004, 3005),
        )
        self.assertEqual(current.topology.current_container, blue.SETTINGS_CURRENT_CONTAINER)
        self.assertEqual(current.topology.target_container, blue.SETTINGS_TARGET_CONTAINER)
        self.assertEqual(current.topology.target_service, blue.SETTINGS_TARGET_SERVICE)
        self.assertEqual(current.topology.state_root, blue.SETTINGS_STATE_ROOT)
        changed = settings_manifest()
        changed["topology"]["target_candidate"]["port"] = 3006
        with self.assertRaises(blue.GuardError):
            blue.parse_manifest(changed)
        changed = settings_manifest()
        changed["topology"]["recovery_candidate"]["container"] = "cp11-api-candidate-recovery"
        with self.assertRaises(blue.GuardError):
            blue.parse_manifest(changed)

    def test_settings_clone_starts_only_the_explicit_3005_candidate_from_3003(self):
        current = settings_pins()
        target = blue.cloned_config(settings_rendered(), settings_inspect(current), current)
        self.assertEqual(set(target["services"]), {blue.SETTINGS_TARGET_SERVICE})
        service = target["services"][blue.SETTINGS_TARGET_SERVICE]
        self.assertEqual(service["container_name"], blue.SETTINGS_TARGET_CONTAINER)
        self.assertEqual(service["environment"]["PORT"], "3005")
        self.assertEqual(service["ports"], [{
            "host_ip": "127.0.0.1", "published": "3005", "target": 3005,
            "protocol": "tcp", "mode": "ingress",
        }])
        self.assertIn(":3005", service["healthcheck"]["test"][1])
        self.assertNotIn(":3003", service["healthcheck"]["test"][1])
        self.assertEqual(service["environment"]["DATABASE_URL"], "postgres://user:pa$$$$word@db/live")

    def test_settings_target_absence_never_claims_the_live_3003_port(self):
        operator = blue.Operator(settings_pins(), Mock())
        operator.system.command.return_value = b"cp11-backend\ncp11-api-candidate\ncp11-api-candidate-next\ncp11-password-recovery\n"
        fake_socket = Mock()
        with patch.object(blue.socket, "socket", return_value=fake_socket):
            operator.target_absent()
        fake_socket.bind.assert_called_once_with(("127.0.0.1", 3005))

    def test_settings_preservation_rechecks_baseline_retained_active_and_recovery(self):
        operator = blue.Operator(settings_pins(), Mock())
        operator.runtime = Mock(return_value={"Id": "pinned"})
        operator.preserved_runtimes()
        self.assertEqual(
            [call.args[0] for call in operator.runtime.call_args_list],
            [blue.BASELINE_CONTAINER, blue.SETTINGS_CURRENT_CONTAINER,
             blue.SETTINGS_RETAINED_CONTAINER, blue.SETTINGS_RECOVERY_CONTAINER],
        )

    def test_settings_inventory_argument_selects_only_the_fixed_project(self):
        arguments = settings_inventory_arguments()
        self.assertTrue(arguments.settings_topology)
        self.assertEqual(arguments.target_project, blue.SETTINGS_TARGET_PROJECT)

    def test_settings_inventory_seals_all_retained_slots_before_writing_a_v2_manifest(self):
        arguments = settings_inventory_arguments()
        document, system = settings_inventory_system()
        fake_socket = Mock()

        with patch.object(blue, "inventory_runtime", side_effect=settings_inventory_runtimes(document)) as inventory, \
             patch.object(blue, "secure_read", side_effect=settings_inventory_reader(arguments, settings_inventory_site(document))), \
             patch.object(blue, "atomic_write") as write, \
             patch.object(blue.os, "geteuid", return_value=0), \
             patch.object(blue.socket, "socket", return_value=fake_socket):
            blue.emit_settings_inventory(arguments, system)

        fake_socket.bind.assert_called_once_with(("127.0.0.1", 3005))
        self.assertEqual(inventory.call_args_list[1].args[1:4], (blue.SETTINGS_RETAINED_CONTAINER, blue.ROLE, 3002))
        self.assertEqual(inventory.call_args_list[2].args[1:4], (blue.SETTINGS_CURRENT_CONTAINER, blue.ROLE, 3003))
        self.assertEqual(inventory.call_args_list[3].args[1:4], (blue.SETTINGS_RECOVERY_CONTAINER, blue.ROLE, 3004))
        sealed = json.loads(write.call_args.args[1])
        self.assertEqual(sealed["schema"], blue.SETTINGS_SCHEMA)
        self.assertEqual(sealed["topology"], blue.settings_topology_document())
        self.assertEqual(sealed["target"]["project"], blue.SETTINGS_TARGET_PROJECT)

    def test_settings_inventory_blocks_existing_3005_target_before_any_runtime_reads(self):
        arguments = settings_inventory_arguments()
        system = Mock()
        system.command.return_value = b"cp11-api-candidate-settings\n"
        with patch.object(blue, "inventory_runtime") as inventory, \
             patch.object(blue.os, "geteuid", return_value=0):
            with self.assertRaises(blue.GuardError) as error:
                blue.emit_settings_inventory(arguments, system)
        self.assertEqual(error.exception.stage, "target_absent")
        inventory.assert_not_called()

    def test_settings_inventory_blocks_an_occupied_3005_port_before_any_runtime_reads(self):
        arguments = settings_inventory_arguments()
        system = Mock()
        system.command.return_value = b""
        fake_socket = Mock()
        fake_socket.bind.side_effect = OSError("occupied")
        with patch.object(blue, "inventory_runtime") as inventory, \
             patch.object(blue.os, "geteuid", return_value=0), \
             patch.object(blue.socket, "socket", return_value=fake_socket):
            with self.assertRaises(blue.GuardError) as error:
                blue.emit_settings_inventory(arguments, system)
        self.assertEqual(error.exception.stage, "target_port")
        inventory.assert_not_called()

    def test_settings_inventory_rejects_comment_lookalike_and_missing_recovery_fragments(self):
        document = settings_manifest()
        valid = settings_inventory_site(document)
        def additional_route(fragment):
            self.assertTrue(valid.endswith(b"}\n"))
            return valid[:-2] + fragment + b"}\n"

        candidates = {
            "comment": valid.replace(
                b"        proxy_pass http://127.0.0.1:3004;",
                b"        # proxy_pass http://127.0.0.1:3004;", 1,
            ),
            "lookalike": valid.replace(
                b"X-Phone11-Recovery-Candidate recovery-bbd14cf",
                b"X-Phone11-Recovery-Candidate unrelated-recovery", 1,
            ),
            "missing_route": valid.replace(
                b"location = /api/mobile/config {",
                b"location = /api/mobile/config-missing {", 1,
            ),
            "longer_trpc_prefix": additional_route(
                b"    location /api/trpc/special {\n"
                b"        proxy_pass http://127.0.0.1:3003;\n"
                b"    }\n"
            ),
            "fifth_recovery_route": additional_route(
                b"    location = /api/auth/recovery-status {\n"
                b"        proxy_pass http://127.0.0.1:3004$request_uri;\n"
                b"    }\n"
            ),
            "nested_regex_trpc": additional_route(
                b"    location /outer {\n"
                b"        location ~ \"^\\/api\\/(trpc)(?:\\/|$)\" {\n"
                b"            proxy_pass http://127.0.0.1:3000;\n"
                b"        }\n"
                b"    }\n"
            ),
        }
        for name, site in candidates.items():
            with self.subTest(name=name):
                arguments = settings_inventory_arguments()
                inventory_document, system = settings_inventory_system()
                fake_socket = Mock()
                with patch.object(blue, "inventory_runtime", side_effect=settings_inventory_runtimes(inventory_document)), \
                     patch.object(blue, "secure_read", side_effect=settings_inventory_reader(arguments, site)), \
                     patch.object(blue, "atomic_write") as write, \
                     patch.object(blue.os, "geteuid", return_value=0), \
                     patch.object(blue.socket, "socket", return_value=fake_socket):
                    with self.assertRaises(blue.GuardError) as error:
                        blue.emit_settings_inventory(arguments, system)
                self.assertEqual(error.exception.stage, "inventory")
                write.assert_not_called()

    def test_settings_inventory_ignores_comments_and_non_directive_lookalikes(self):
        document = settings_manifest()
        valid = settings_inventory_site(document)
        site = valid[:-2] + (
            b"    # location /api/trpc/special { proxy_pass http://127.0.0.1:3003; }\n"
            b"    # proxy_pass http://127.0.0.1:3004;\n"
            b"    add_header X-Route-Lookalike \"location /api/trpc/special; proxy_pass http://127.0.0.1:3004;\";\n"
            b"}\n"
        )
        arguments = settings_inventory_arguments()
        inventory_document, system = settings_inventory_system()
        fake_socket = Mock()
        with patch.object(blue, "inventory_runtime", side_effect=settings_inventory_runtimes(inventory_document)), \
             patch.object(blue, "secure_read", side_effect=settings_inventory_reader(arguments, site)), \
             patch.object(blue, "atomic_write") as write, \
             patch.object(blue.os, "geteuid", return_value=0), \
             patch.object(blue.socket, "socket", return_value=fake_socket):
            blue.emit_settings_inventory(arguments, system)
        write.assert_called_once()

    def test_settings_inventory_fixture_uses_exact_recovery_operator_generation(self):
        document = settings_manifest()
        marker = document["nginx"]["marker"]
        expected = recovery.proxy_fragment(marker, document["recovery_candidate"]["build"])
        self.assertEqual(
            blue.recovery_route_fragment(marker, document["recovery_candidate"]["build"]),
            expected,
        )
        site = settings_inventory_site(document)
        self.assertLess(site.index(b"location = /api/trpc"), site.index(b"location = /api/auth/sign-in/email"))
        self.assertIn(b"\n        location = /api/trpc {\n", site)
        self.assertIn(b"\n    location ^~ /api/trpc/ {\n", site)
        self.assertIn(b"\n        location = /api/auth/sign-in/email {\n", site)
        self.assertIn(b"\n    location = /api/mobile/config {\n", site)
        self.assertEqual(site.count(b"127.0.0.1:3003"), 2)
        self.assertEqual(site.count(b"127.0.0.1:3004"), 4)
        self.assertEqual(site.count(marker.encode()), 1)

    def test_settings_rollback_receipt_is_separate_and_topology_bound(self):
        legacy = blue.Operator(pins(), Mock())
        settings = blue.Operator(settings_pins(), Mock())
        self.assertEqual(legacy.rollback_site, blue.ROLLBACK_SITE)
        self.assertEqual(settings.rollback_site, blue.SETTINGS_STATE_ROOT / "nginx.before")
        self.assertNotEqual(settings.rollback_receipt, legacy.rollback_receipt)
        receipt = json.loads(settings.rollback_document(b"before", b"active"))
        self.assertEqual(receipt["schema"], blue.SETTINGS_SCHEMA)
        self.assertEqual(receipt["topology"], "settings-3003-to-3005")
        self.assertEqual(receipt["target_container"], blue.SETTINGS_TARGET_CONTAINER)

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
        self.assertNotIn('"settingsAvailable":true', tenant["required"])
        self.assertEqual((denied["status"], denied["required"]), (403, ["FORBIDDEN"]))
        changed = probe_document()
        phone = next(item for item in changed["probes"] if item["label"] == "existing_phone")
        phone["method"], phone["body"] = "POST", "{}"
        bad = json.dumps(changed, separators=(",", ":")).encode()
        with self.assertRaises(blue.GuardError):
            blue.load_probes(bad, pins(probes__sha256=blue.sha256_bytes(bad)))

    def test_settings_v2_management_probe_requires_schema_capability_without_a_saved_timezone(self):
        raw = json.dumps(probe_document(), separators=(",", ":")).encode()
        current = replace(settings_pins(), probes_sha256=blue.sha256_bytes(raw))
        tenant = next(item for item in blue.load_probes(raw, current) if item["label"] == "management_tenant")
        self.assertEqual(
            tenant["required"],
            ['"settingsAvailable":true', '"supportedSettings":["businessHoursTimezone"]', '"userRole"'],
        )
        self.assertFalse(any("business_hours_timezone" in item for item in tenant["required"]))
        system = Mock()
        system.request.return_value = (
            200,
            b'{"result":{"data":{"json":{"settingsAvailable":true,"supportedSettings":["businessHoursTimezone"],"userRole":"admin","business_hours_timezone":null}}}}',
        )
        blue.run_probes(system, "http://127.0.0.1:3005", [tenant])
        for body in (
            b'{"settingsAvailable":false,"supportedSettings":[],"userRole":"admin"}',
            b'{"settingsAvailable":true,"supportedSettings":[],"userRole":"admin"}',
            b'{"settingsAvailable":true,"supportedSettings":["businessHoursTimezone"]}',
        ):
            system.request.return_value = (200, body)
            with self.assertRaises(blue.GuardError) as error:
                blue.run_probes(system, "http://127.0.0.1:3005", [tenant])
            self.assertEqual(error.exception.stage, "probes")

    def test_settings_v2_schema_probe_failure_stops_before_any_nginx_route_change(self):
        raw = json.dumps(probe_document(), separators=(",", ":")).encode()
        current = replace(settings_pins(), probes_sha256=blue.sha256_bytes(raw))
        operator = blue.Operator(current, Mock())
        operator.prepare = Mock()
        operator.target_config = settings_rendered()
        operator.wait_target = Mock()
        operator.probes = blue.load_probes(raw, current)
        operator.nginx = Mock()
        operator.system.request.return_value = (200, b'{"settingsAvailable":false,"supportedSettings":[],"userRole":"admin"}')
        context = Mock()
        context.__enter__ = Mock(return_value=Path("/root/frozen-3005.json"))
        context.__exit__ = Mock(return_value=False)
        with patch.object(blue, "frozen_candidate_config", return_value=context), \
             patch.object(blue, "atomic_write") as write, \
             self.assertRaises(blue.GuardError) as error:
            operator.activate()
        self.assertEqual(error.exception.stage, "probes")
        operator.nginx.assert_not_called()
        write.assert_not_called()
        self.assertFalse(any(command[:2] == ["nginx", "-s"] for command in operator.system.command.call_args_list))

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

    def test_settings_activation_changes_only_trpc_and_keeps_generated_recovery_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            site = Path(directory) / "phone11ai"
            document = settings_manifest()
            original = settings_inventory_site(document)
            site.write_bytes(original)
            current = replace(
                settings_pins(), nginx_site=site,
                nginx_site_sha256=blue.sha256_bytes(original),
            )
            operator = blue.Operator(current, Mock())
            operator.prepare = Mock()
            operator.target_config = settings_rendered()
            operator.probes = []
            operator.wait_target = Mock()
            operator.photos_absent = Mock()
            operator.wake = Mock()
            operator.preserved_runtimes = Mock(return_value=(
                {"Id": current.baseline.container_id}, {"Id": current.current.container_id},
            ))
            operator.target = Mock()
            operator.nginx = Mock(return_value=original)
            operator.save_rollback = Mock()
            operator.restore = Mock()
            operator.system.command.return_value = b""
            context = Mock()
            context.__enter__ = Mock(return_value=Path("/root/frozen-3005.json"))
            context.__exit__ = Mock(return_value=False)
            written = {}

            def capture_write(_path, raw, **_kwargs):
                written["site"] = raw

            with patch.object(blue, "frozen_candidate_config", return_value=context), \
                 patch.object(blue, "atomic_write", side_effect=capture_write), \
                 patch.object(blue, "secure_read", side_effect=lambda _path, **_kwargs: written["site"]), \
                 patch.object(blue, "wait_for_route", side_effect=blue.GuardError("readiness")), \
                 self.assertRaises(blue.GuardError):
                operator.activate()

            current_trpc = blue.trpc_route_fragment(
                current.nginx_marker, current.current.build, 3003, {3003, 3005}
            ).rstrip(b"\n")
            target_trpc = blue.trpc_route_fragment(
                current.nginx_marker, current.release_build, 3005, {3003, 3005}
            ).rstrip(b"\n")
            expected = original.replace(current_trpc, target_trpc, 1)
            self.assertEqual(written["site"], expected)
            self.assertEqual(expected.replace(target_trpc, current_trpc, 1), original)
            recovery_fragment = recovery.proxy_fragment(
                current.nginx_marker, current.recovery.build
            ).rstrip(b"\n")
            self.assertEqual(original.count(recovery_fragment), 1)
            self.assertEqual(expected.count(recovery_fragment), 1)
            operator.restore.assert_called_once_with(expected=expected)


if __name__ == "__main__":
    unittest.main()
