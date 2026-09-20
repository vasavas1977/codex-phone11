"""Hermetic safety tests for the parallel API operator."""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from contextlib import contextmanager
from unittest.mock import Mock, patch


SCRIPT = Path(__file__).parents[1] / "scripts" / "phone11-parallel-api-pilot.py"
SPEC = importlib.util.spec_from_file_location("phone11_parallel_api_pilot", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
pilot = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = pilot
SPEC.loader.exec_module(pilot)


SHA = "1" * 64
DIGEST = "sha256:" + "2" * 64


def manifest(**changes: object) -> dict[str, object]:
    value: dict[str, object] = {
        "schema": pilot.SCHEMA,
        "active": {
            "container_id": "a" * 64,
            "image": pilot.ACTIVE_IMAGE,
            "runtime_sha256": SHA,
            "health_build": "live-build",
        },
        "candidate": {
            "image": DIGEST,
            "build": "reviewed-build-123",
            "config_sha256": SHA,
            "compose_file": "/root/candidate.json",
            "compose_sha256": SHA,
        },
        "credentials": {"config_sha256": SHA, "metadata_sha256": SHA},
        "migration": {"receipt_file": "/root/migration.json", "receipt_sha256": SHA},
        "probes": {"file": "/root/probes.json", "sha256": SHA},
        "nginx": {
            "site": "/etc/nginx/sites-enabled/api.phone11.ai",
            "site_sha256": SHA,
            "dump_sha256": SHA,
            "insert_marker": "# PHONE11_PARALLEL_API_INSERT reviewed-123",
        },
        "kamailio": {"config_path": "/etc/kamailio/kamailio.cfg", "config_sha256": SHA, "wake_occurrences": 4},
        "public_origin": "https://api.phone11.ai",
    }
    for dotted, replacement in changes.items():
        section, key = dotted.split("__", 1)
        assert isinstance(value[section], dict)
        value[section][key] = replacement
    return value


def pins(**changes: object):
    return pilot.parse_manifest(manifest(**changes))


def rendered_config(current_pins) -> dict[str, object]:
    document: dict[str, object] = {
        "name": "phone11-api-candidate",
        "services": {
            "candidate": {
                "container_name": pilot.CANDIDATE_CONTAINER,
                "image": current_pins.candidate_image,
                "environment": {
                    "PHONE11_RUNTIME_ROLE": pilot.CANDIDATE_ROLE,
                    "PORT": "3002",
                    "PHONE11_BUILD_SHA": current_pins.candidate_build,
                },
                "ports": [{"host_ip": "127.0.0.1", "published": 3002, "target": 3002, "protocol": "tcp"}],
                "restart": "unless-stopped",
            },
        },
    }
    return document


def probe_document() -> dict[str, object]:
    probes = []
    for label in sorted(pilot.EXPECTED_PROBES):
        path = "/api/trpc/phone.route"
        if label == "mixed_batch":
            path = "/api/trpc/phone.route,chat.route?batch=1&input=%7B%7D"
        probes.append(
            {
                "label": label,
                "method": "POST",
                "path": path,
                "headers": {"Authorization": "Bearer protected", "Cookie": "session=protected"},
                "body": '{"kept":true}',
                "status": 200 if label != "denied_tenant" else 403,
                "required": ["ok"],
                "forbidden": ["credential"],
            },
        )
    return {"schema": "phone11-parallel-api-probes/v1", "probes": probes}


class FakeSystem(pilot.System):
    def __init__(self) -> None:
        self.commands: list[list[str]] = []
        self.requests: list[tuple[str, dict[str, object]]] = []
        self.responses: list[tuple[int, bytes]] = []

    def command(self, args, *, timeout=30):
        self.commands.append(list(args))
        return b""

    def request(self, origin, probe):
        self.requests.append((origin, dict(probe)))
        return self.responses.pop(0) if self.responses else (200, b'{"ok":true}')


class ParallelApiPilotTests(unittest.TestCase):
    def test_manifest_requires_exact_audited_public_origin(self) -> None:
        self.assertEqual(pins().public_origin, pilot.PUBLIC_ORIGIN)
        for origin in (
            "https://evil.example",
            "https://api.phone11.ai.evil.example",
            "https://user@api.phone11.ai",
            "https://api.phone11.ai:444",
            "https://api.phone11.ai/",
            "https://api.phone11.ai/path",
            "https://api.phone11.ai?next=evil",
            "https://api.phone11.ai#fragment",
            "http://api.phone11.ai",
        ):
            changed = manifest()
            changed["public_origin"] = origin
            with self.subTest(origin=origin), self.assertRaises(pilot.GuardError):
                pilot.parse_manifest(changed)

    def test_manifest_requires_real_immutable_candidate_and_every_hash(self) -> None:
        for changes in (
            {"candidate__image": "pending"},
            {"candidate__build": ""},
            {"candidate__config_sha256": "pending"},
            {"active__image": DIGEST},
        ):
            with self.subTest(changes=changes), self.assertRaises(pilot.GuardError):
                pilot.parse_manifest(manifest(**changes))

    def test_candidate_config_pins_loopback_role_port_build_and_rendered_hash(self) -> None:
        initial = pins()
        document = rendered_config(initial)
        valid = pins(candidate__config_sha256=pilot.canonical_hash(document))
        pilot.validate_candidate_config(document, valid)
        for field, bad in (("PHONE11_RUNTIME_ROLE", "default"), ("PORT", "3001"), ("PHONE11_BUILD_SHA", "other")):
            changed = rendered_config(valid)
            changed["services"]["candidate"]["environment"][field] = bad
            with self.subTest(field=field), self.assertRaises(pilot.GuardError):
                pilot.validate_candidate_config(changed, valid)
        changed = rendered_config(valid)
        changed["services"]["candidate"]["ports"][0]["host_ip"] = "0.0.0.0"
        with self.assertRaises(pilot.GuardError):
            pilot.validate_candidate_config(changed, valid)

    def test_compose_change_after_prepare_aborts_before_up(self) -> None:
        original = b"reviewed compose"
        current = pins(candidate__compose_sha256=pilot.sha256_bytes(original))
        system = FakeSystem()
        operator = pilot.Operator(current, system)
        operator.prepare = Mock()
        with patch.object(pilot, "secure_read", return_value=original + b" changed"), \
             self.assertRaises(pilot.GuardError) as error:
            operator.activate()
        self.assertEqual(error.exception.stage, "candidate_config")
        self.assertFalse(any("up" in command for command in system.commands))

    def test_activation_uses_frozen_rendered_config_with_explicit_project_semantics(self) -> None:
        current = pins()
        system = FakeSystem()
        operator = pilot.Operator(current, system)
        document = rendered_config(current)
        operator.prepare = Mock()
        operator.candidate_config = Mock(return_value=document)
        operator.candidate = Mock()
        operator.active = Mock(return_value={"Id": current.active_container_id})
        operator.pinned_nginx = Mock(side_effect=pilot.GuardError("stop_after_start"))
        frozen_path = Path("/protected/frozen-compose.json")

        @contextmanager
        def frozen(_document):
            yield frozen_path

        with patch.object(pilot, "frozen_candidate_config", frozen), \
             self.assertRaises(pilot.GuardError):
            operator.activate()
        command = system.commands[0]
        self.assertEqual(command[:7], [
            "docker", "compose", "--project-name", document["name"],
            "--project-directory", str(current.compose_file.parent), "-f",
        ])
        self.assertEqual(command[7], str(frozen_path))
        self.assertEqual(command[8:], ["up", "-d", "--no-deps", pilot.CANDIDATE_SERVICE])
        self.assertNotIn(str(current.compose_file), command)

    def test_frozen_config_preserves_compose_canonical_dollar_values_exactly(self) -> None:
        document = rendered_config(pins())
        service = document["services"]["candidate"]
        service["environment"].update({
            "PLAIN_DOLLAR": "price$5",
            "LITERAL_NAME": "$$NAME",
            "LITERAL_BRACED": "$${NAME}",
            "TWO_LITERAL_DOLLARS": "$$$$NAME",
        })
        service["command"] = ["sh", "-c", "price$5 $$NAME $${NAME} $$$$NAME"]
        captured: list[bytes] = []

        def capture(_path, content, **_metadata):
            captured.append(content)

        with patch.object(pilot, "atomic_write", side_effect=capture):
            with pilot.frozen_candidate_config(document):
                pass
        self.assertEqual(len(captured), 1)
        self.assertEqual(json.loads(captured[0]), document)
        frozen_service = json.loads(captured[0])["services"]["candidate"]
        self.assertEqual(frozen_service["environment"], service["environment"])
        self.assertEqual(frozen_service["command"], service["command"])

    def test_atomic_write_retries_short_writes_and_fsyncs_file_and_directory(self) -> None:
        content = b"abcdefghijklmnopqrstuvwxyz"
        real_write = os.write
        real_fsync = os.fsync
        writes: list[int] = []
        fsyncs: list[int] = []

        def short_write(descriptor, value):
            size = max(1, len(value) // 2)
            writes.append(size)
            return real_write(descriptor, value[:size])

        def tracked_fsync(descriptor):
            fsyncs.append(descriptor)
            return real_fsync(descriptor)

        with tempfile.TemporaryDirectory() as directory, \
             patch.object(pilot.os, "write", side_effect=short_write), \
             patch.object(pilot.os, "fsync", side_effect=tracked_fsync):
            target = Path(directory) / "result"
            pilot.atomic_write(target, content, mode=0o600, uid=os.getuid(), gid=os.getgid())
            self.assertEqual(target.read_bytes(), content)
        self.assertGreater(len(writes), 1)
        self.assertEqual(len(fsyncs), 2)

    def test_atomic_write_zero_write_fails_and_cleans_temporary(self) -> None:
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(pilot.os, "write", return_value=0):
            target = Path(directory) / "result"
            with self.assertRaises(pilot.GuardError) as error:
                pilot.atomic_write(target, b"content", mode=0o600, uid=os.getuid(), gid=os.getgid())
            self.assertEqual(error.exception.stage, "atomic_write")
            self.assertFalse(target.exists())
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_atomic_write_reports_directory_fsync_failure(self) -> None:
        real_fsync = os.fsync
        calls = 0

        def fail_directory_fsync(descriptor):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError("directory fsync failed")
            return real_fsync(descriptor)

        with tempfile.TemporaryDirectory() as directory, \
             patch.object(pilot.os, "fsync", side_effect=fail_directory_fsync):
            target = Path(directory) / "result"
            with self.assertRaises(pilot.GuardError) as error:
                pilot.atomic_write(target, b"content", mode=0o600, uid=os.getuid(), gid=os.getgid())
            self.assertEqual(error.exception.stage, "atomic_write")
            self.assertEqual(calls, 2)
            self.assertEqual(list(Path(directory).glob(".result.*")), [])

    def test_stale_nginx_configuration_fingerprint_is_rejected(self) -> None:
        reviewed = b"server { reviewed; }"
        pilot.require_sha256(reviewed, pilot.sha256_bytes(reviewed), "nginx_config")
        with self.assertRaises(pilot.GuardError) as context:
            pilot.require_sha256(b"server { drifted; }", pilot.sha256_bytes(reviewed), "nginx_config")
        self.assertEqual(context.exception.stage, "nginx_config")

    def test_wake_target_pins_full_config_and_all_four_references(self) -> None:
        content = (pilot.WAKE_URL + "\n").encode() * 4
        current = pins(kamailio__config_sha256=pilot.sha256_bytes(content))
        system = FakeSystem()
        system.command = Mock(return_value=content)
        pilot.Operator(current, system).wake_target()
        for changed in (content + b"# drift", content.replace(b"3000", b"3002", 1)):
            system.command = Mock(return_value=changed)
            with self.assertRaises(pilot.GuardError):
                pilot.Operator(current, system).wake_target()
        system.command = Mock(return_value=content)
        with self.assertRaises(pilot.GuardError):
            pilot.Operator(pins(kamailio__config_sha256=pilot.sha256_bytes(content), kamailio__wake_occurrences=1), system).wake_target()

    def test_intervening_nginx_edit_aborts_before_any_proxy_write(self) -> None:
        original = b"server {\n# PHONE11_PARALLEL_API_INSERT reviewed-123\n}\n"
        dump = b"reviewed full nginx configuration"
        current = pins(nginx__site_sha256=pilot.sha256_bytes(original), nginx__dump_sha256=pilot.sha256_bytes(dump))
        system = FakeSystem()
        system.command = Mock(return_value=dump)
        operator = pilot.Operator(current, system)
        operator.prepare = Mock()
        operator.candidate_config = Mock(return_value=rendered_config(current))
        operator.candidate = Mock()
        operator.active = Mock(return_value={"Id": current.active_container_id})
        operator.save_rollback = Mock()
        with patch.object(pilot, "secure_read", side_effect=[original, original + b"# external edit"]), \
             patch.object(pilot, "frozen_candidate_config") as frozen, \
             patch.object(pilot, "atomic_write") as write, \
             patch.object(Path, "stat", return_value=Mock(st_mode=0o100644, st_uid=0, st_gid=0)), \
             self.assertRaises(pilot.GuardError) as error:
            frozen.return_value.__enter__.return_value = Path("/protected/frozen.json")
            operator.activate()
        self.assertEqual(error.exception.stage, "nginx_config")
        write.assert_not_called()
        self.assertNotIn(["nginx", "-s", "reload"], [call.args[0] for call in system.command.call_args_list])

    def test_operator_lock_rejects_competing_process_before_mutation(self) -> None:
        info = Mock(st_mode=0o100600, st_uid=0, st_gid=0, st_nlink=1)
        with patch.object(pilot.os, "open", return_value=7), patch.object(pilot.os, "fstat", return_value=info), \
             patch.object(pilot.os, "close") as close, \
             patch.object(pilot.fcntl, "flock", side_effect=BlockingIOError), \
             self.assertRaises(pilot.GuardError) as error:
            with pilot.operator_lock():
                self.fail("A competing operator entered the mutation phase")
        self.assertEqual(error.exception.stage, "operator_lock")
        close.assert_called_once_with(7)

    def test_migration_receipt_rejects_failure_or_unreviewed_artifact(self) -> None:
        receipt = {
            "schema": "phone11-migration-receipt/v1",
            "status": "applied",
            "artifact_sha256": "3" * 64,
            "database_fingerprint": "4" * 64,
            "verification_sha256": "5" * 64,
        }
        raw = json.dumps(receipt, separators=(",", ":")).encode()
        valid = pins(migration__receipt_sha256=pilot.sha256_bytes(raw))
        pilot.validate_migration_receipt(raw, valid)
        receipt["status"] = "failed"
        failed = json.dumps(receipt, separators=(",", ":")).encode()
        with self.assertRaises(pilot.GuardError):
            pilot.validate_migration_receipt(failed, pins(migration__receipt_sha256=pilot.sha256_bytes(failed)))

    def test_credentials_bind_exact_customer_namespace_scopes_and_secret_prefixes(self) -> None:
        metadata = {
            "status": {
                "id": "status-id", "customer_id": pilot.CONNECT11_CUSTOMER_ID,
                "tenant_namespace": pilot.CONNECT11_TENANT_NAMESPACE, "name": "Phone11 status",
                "key_prefix": "c11_live_1234abcd", "scopes": ["realtime:plain-video:status"],
                "environment": "live", "product_code": "connect11",
                "phone11_credential_type": "status", "status": "active",
            },
            "join_evict": {
                "id": "join-id", "customer_id": pilot.CONNECT11_CUSTOMER_ID,
                "tenant_namespace": pilot.CONNECT11_TENANT_NAMESPACE, "name": "Phone11 join",
                "key_prefix": "c11_live_5678efab", "scopes": ["realtime:plain-video:join", "realtime:plain-video:evict"],
                "environment": "live", "product_code": "connect11",
                "phone11_credential_type": "join_evict", "status": "active",
            },
        }
        mapping = {
            "enabled": True,
            "tenants": [{
                "tenantId": 1, "customerKey": pilot.CONNECT11_CUSTOMER_ID,
                "apiBaseUrl": pilot.CONNECT11_API_URL, "rtcUrl": pilot.CONNECT11_RTC_URL,
                "statusCredential": "c11_live_1234abcd_" + "s" * 43, "joinCredential": "c11_live_5678efab_" + "j" * 43,
            }],
        }
        config = ("PHONE11_CONNECT11_PLAIN_VIDEO_TENANTS=" + json.dumps(mapping, separators=(",", ":")) + "\n").encode()
        pilot.validate_credentials(config, json.dumps(metadata).encode())
        valid_join = mapping["tenants"][0]["joinCredential"]
        for malformed in (valid_join * 2, valid_join + " ", valid_join[:-1], valid_join + "j"):
            mapping["tenants"][0]["joinCredential"] = malformed
            malformed_config = ("PHONE11_CONNECT11_PLAIN_VIDEO_TENANTS=" + json.dumps(mapping) + "\n").encode()
            with self.subTest(malformed_length=len(malformed)), self.assertRaises(pilot.GuardError):
                pilot.validate_credentials(malformed_config, json.dumps(metadata).encode())
        mapping["tenants"][0]["joinCredential"] = valid_join
        metadata["join_evict"]["tenant_namespace"] = "wrong"
        with self.assertRaises(pilot.GuardError):
            pilot.validate_credentials(config, json.dumps(metadata).encode())

    def test_probes_require_a_mixed_batch_and_preserve_path_auth_cookie_method_and_body(self) -> None:
        document = probe_document()
        raw = json.dumps(document, separators=(",", ":")).encode()
        current = pins(probes__sha256=pilot.sha256_bytes(raw))
        probes = pilot.load_probes(raw, current)
        system = FakeSystem()
        system.responses = [(probe["status"], b'{"ok":true}') for probe in probes]
        pilot.run_probes(system, "http://127.0.0.1:3002", probes)
        mixed = next(request for _origin, request in system.requests if request["label"] == "mixed_batch")
        self.assertEqual(mixed["method"], "POST")
        self.assertIn("phone.route,chat.route?batch=1&", mixed["path"])
        self.assertEqual(mixed["headers"]["Authorization"], "Bearer protected")
        self.assertEqual(mixed["headers"]["Cookie"], "session=protected")
        self.assertEqual(mixed["body"], '{"kept":true}')

        document["probes"] = [probe for probe in document["probes"] if probe["label"] != "mixed_batch"]
        bad = json.dumps(document, separators=(",", ":")).encode()
        with self.assertRaises(pilot.GuardError):
            pilot.load_probes(bad, pins(probes__sha256=pilot.sha256_bytes(bad)))

    def test_health_rejects_wrong_role_build_or_failed_status(self) -> None:
        for response in (
            (200, b'{"ok":true,"service":"phone11-backend","build":"wrong","runtimeRole":"api-candidate"}'),
            (200, b'{"ok":true,"service":"phone11-backend","build":"reviewed-build-123","runtimeRole":"default"}'),
            (503, b'{"ok":false}'),
        ):
            system = FakeSystem()
            system.responses = [response]
            with (
                patch.object(pilot.time, "monotonic", side_effect=[0, 31]),
                patch.object(pilot.time, "sleep"),
                self.assertRaises(pilot.GuardError),
            ):
                pilot.health(system, "http://127.0.0.1:3002", "reviewed-build-123", "api-candidate")

    def test_active_runtime_rejects_unexpected_container_before_health(self) -> None:
        current = pins()
        system = FakeSystem()
        system.json_command = Mock(return_value=[{
            "Id": "b" * 64,
            "Image": pilot.ACTIVE_IMAGE,
            "State": {"Running": True, "Health": {"Status": "healthy"}},
            "Config": {}, "HostConfig": {}, "NetworkSettings": {}, "Mounts": [],
        }])
        with self.assertRaises(pilot.GuardError) as context:
            pilot.Operator(current, system).active()
        self.assertEqual(context.exception.stage, "active_runtime")
        self.assertEqual(system.requests, [])

    def test_candidate_runtime_rejects_wrong_role_without_stopping_any_service(self) -> None:
        current = pins()
        system = FakeSystem()
        system.json_command = Mock(return_value=[{
            "Image": current.candidate_image,
            "State": {"Running": True},
            "Config": {"Env": ["PHONE11_RUNTIME_ROLE=default", "PHONE11_BUILD_SHA=reviewed-build-123", "PORT=3002"]},
            "HostConfig": {"PortBindings": {"3002/tcp": [{"HostIp": "127.0.0.1", "HostPort": "3002"}]}},
        }])
        with self.assertRaises(pilot.GuardError):
            pilot.Operator(current, system).candidate()
        flattened = [word for command in system.commands for word in command]
        self.assertNotIn("stop", flattened)
        self.assertNotIn("down", flattened)
        self.assertNotIn("rm", flattened)

    def test_port_occupied_fails_closed(self) -> None:
        system = FakeSystem()
        fake_socket = Mock()
        fake_socket.bind.side_effect = OSError("occupied")
        with patch.object(pilot.socket, "socket", return_value=fake_socket), self.assertRaises(pilot.GuardError) as context:
            pilot.Operator(pins(), system).candidate_absent_and_port_free()
        self.assertEqual(context.exception.stage, "candidate_port")

    def test_proxy_has_only_exact_and_prefix_trpc_routes_and_preserves_uri(self) -> None:
        fragment = pilot.proxy_fragment("# PHONE11_PARALLEL_API_INSERT reviewed").decode()
        self.assertEqual(fragment.count("location = /api/trpc"), 1)
        self.assertEqual(fragment.count("location ^~ /api/trpc/"), 1)
        self.assertEqual(fragment.count("proxy_pass http://127.0.0.1:3002;"), 2)
        self.assertNotIn("proxy_pass http://127.0.0.1:3002/;", fragment)
        self.assertIn("proxy_pass_request_headers on", fragment)

    def test_failed_reload_rolls_back_proxy_and_never_stops_a_backend(self) -> None:
        current = pins()
        system = FakeSystem()
        original = b"server {\n    # PHONE11_PARALLEL_API_INSERT reviewed-123\n}\n"

        class Harness(pilot.Operator):
            def __init__(self):
                super().__init__(current, system)
                self.probes = []
                self.restored = False
            def prepare(self):
                return None
            def candidate_config(self):
                return rendered_config(current)
            def pinned_nginx(self):
                return original
            def active(self):
                return {"Id": current.active_container_id}
            def candidate(self):
                return None
            def save_rollback(self, before, active):
                self.saved = (before, active)
            def restore_proxy(self, expected_current=None):
                self.restored = True

        operator = Harness()
        real_command = system.command
        def fail_reload(args, *, timeout=30):
            if list(args) == ["nginx", "-s", "reload"]:
                raise pilot.GuardError("command")
            return real_command(args, timeout=timeout)
        system.command = fail_reload
        fake_stat = Mock(st_mode=0o100644, st_uid=0, st_gid=0)
        with (
            patch.object(pilot, "secure_read", return_value=original),
            patch.object(pilot, "frozen_candidate_config") as frozen,
            patch.object(pilot, "atomic_write"),
            patch.object(Path, "stat", return_value=fake_stat),
            self.assertRaises(pilot.GuardError),
        ):
            frozen.return_value.__enter__.return_value = Path("/protected/frozen.json")
            operator.activate()
        self.assertTrue(operator.restored)
        flattened = [word for command in system.commands for word in command]
        self.assertNotIn("stop", flattened)
        self.assertNotIn("down", flattened)
        self.assertNotIn("rm", flattened)


if __name__ == "__main__":
    unittest.main()
