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


def candidate_inspect(current_pins, *, container_id: str = "c" * 64) -> dict[str, object]:
    return {
        "Id": container_id,
        "Image": current_pins.candidate_image,
        "State": {"Running": True, "Health": {"Status": "healthy"}},
        "Config": {
            "Image": current_pins.candidate_image,
            "Entrypoint": ["/entrypoint"],
            "Cmd": ["node", "dist/index.mjs"],
            "User": "",
            "WorkingDir": "/app",
            "Env": [
                f"PHONE11_RUNTIME_ROLE={pilot.CANDIDATE_ROLE}",
                f"PHONE11_BUILD_SHA={current_pins.candidate_build}",
                "PORT=3002",
            ],
            "Healthcheck": {"Test": ["CMD", "healthcheck"]},
            "Labels": {"com.phone11.candidate-build": current_pins.candidate_build},
        },
        "HostConfig": {
            "NetworkMode": "phone11",
            "PortBindings": {"3002/tcp": [{"HostIp": "127.0.0.1", "HostPort": "3002"}]},
            "RestartPolicy": {"Name": "unless-stopped"},
            "ReadonlyRootfs": False,
        },
        "NetworkSettings": {"Networks": {"phone11": {}}},
        "Mounts": [],
    }


def probe_document() -> dict[str, object]:
    probes = []
    for label in sorted(pilot.EXPECTED_PROBES):
        path = "/api/trpc/phone.route"
        if label == "existing_phone":
            path = "/api/trpc/phone.getConfig?input=%7B%7D"
        if label == "mixed_batch":
            path = "/api/trpc/phone.route,chat.route?batch=1&input=%7B%7D"
        probes.append(
            {
                "label": label,
                "method": "GET" if label == "existing_phone" else "POST",
                "path": path,
                "headers": {"Authorization": "Bearer protected", "Cookie": "session=protected"},
                "body": "" if label == "existing_phone" else '{"kept":true}',
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
    def test_system_request_returns_bounded_case_insensitive_headers_and_closes(self) -> None:
        response = Mock(status=200)
        response.read.return_value = b'{"ok":true}'
        response.getheaders.return_value = [
            ("X-Phone11-Api-Candidate", "reviewed-build-123"),
            ("X-Trace", "one"),
            ("x-trace", "two"),
        ]
        connection = Mock()
        connection.getresponse.return_value = response
        with patch.object(pilot.http.client, "HTTPConnection", return_value=connection) as constructor:
            result = pilot.System().request("http://127.0.0.1", {
                "method": "GET", "path": "/api/trpc/phone.getConfig",
                "headers": {"Connection": "close"}, "body": "", "_timeout": 1.25,
            })
        constructor.assert_called_once_with("127.0.0.1", None, timeout=1.25)
        self.assertEqual(result.status, 200)
        self.assertEqual(result.headers[pilot.CANDIDATE_HEADER], ("reviewed-build-123",))
        self.assertEqual(result.headers["x-trace"], ("one", "two"))
        connection.close.assert_called_once_with()

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

    def test_manifest_reuse_contract_is_optional_but_exact(self) -> None:
        self.assertIsNone(pins().candidate_reuse_container_id)
        reuse = {"container_id": "c" * 64, "runtime_sha256": "d" * 64}
        current = pins(candidate__reuse=reuse)
        self.assertEqual(current.candidate_reuse_container_id, "c" * 64)
        self.assertEqual(current.candidate_reuse_runtime_sha256, "d" * 64)
        for invalid in (
            {"container_id": "short", "runtime_sha256": "d" * 64},
            {"container_id": "c" * 64, "runtime_sha256": "bad"},
            {"container_id": "c" * 64, "runtime_sha256": "d" * 64, "extra": True},
        ):
            with self.subTest(invalid=invalid), self.assertRaises(pilot.GuardError):
                pins(candidate__reuse=invalid)

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
            self.assertFalse(error.exception.committed)
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
            self.assertTrue(error.exception.committed)
            self.assertEqual(calls, 2)
            self.assertEqual(list(Path(directory).glob(".result.*")), [])

    def test_activation_postreplace_fsync_failure_restores_original_before_safe_reload(self) -> None:
        original = b"server {\n    # PHONE11_PARALLEL_API_INSERT reviewed-123\n}\n"
        activated = original.replace(
            b"# PHONE11_PARALLEL_API_INSERT reviewed-123",
            pilot.proxy_fragment("# PHONE11_PARALLEL_API_INSERT reviewed-123", "reviewed-build-123").rstrip(b"\n"),
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            site = root / "site"
            rollback_site = root / "before"
            rollback_receipt = root / "receipt"
            site.write_bytes(original)
            rollback_site.write_bytes(original)
            rollback_receipt.write_text(json.dumps({
                "schema": pilot.SCHEMA,
                "site": str(site),
                "before": pilot.sha256_bytes(original),
                "active": pilot.sha256_bytes(activated),
            }, sort_keys=True, separators=(",", ":")))
            current = pins(
                nginx__site=str(site),
                nginx__site_sha256=pilot.sha256_bytes(original),
            )
            system = FakeSystem()
            reload_bytes: list[bytes] = []

            def command(args, *, timeout=30):
                system.commands.append(list(args))
                if list(args) == ["nginx", "-s", "reload"]:
                    reload_bytes.append(site.read_bytes())
                return b""

            system.command = command
            operator = pilot.Operator(current, system)
            operator.prepare = Mock()
            operator.candidate_config = Mock(return_value=rendered_config(current))
            operator.candidate = Mock()
            operator.candidate_running = Mock()
            operator.active = Mock(return_value={"Id": current.active_container_id})
            operator.pinned_nginx = Mock(return_value=original)
            operator.save_rollback = Mock()
            real_fsync = os.fsync
            calls = 0

            def fail_live_directory_fsync(descriptor):
                nonlocal calls
                calls += 1
                if calls == 2:
                    raise OSError("live directory fsync failed")
                return real_fsync(descriptor)

            @contextmanager
            def frozen(_document):
                yield root / "frozen.json"

            with patch.object(pilot, "ROLLBACK_SITE", rollback_site), \
                 patch.object(pilot, "ROLLBACK_RECEIPT", rollback_receipt), \
                 patch.object(pilot, "secure_read", side_effect=lambda path, mode=None: Path(path).read_bytes()), \
                 patch.object(pilot, "frozen_candidate_config", frozen), \
                 patch.object(pilot.os, "fsync", side_effect=fail_live_directory_fsync), \
                 self.assertRaises(pilot.AtomicWriteError) as error:
                operator.activate()
            self.assertTrue(error.exception.committed)
            self.assertEqual(site.read_bytes(), original)
            self.assertEqual(reload_bytes, [original])

    def test_restore_postreplace_fsync_failure_reloads_verified_original_then_reports(self) -> None:
        original = b"server { original; }"
        activated = b"server { candidate; }"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            site = root / "site"
            rollback_site = root / "before"
            rollback_receipt = root / "receipt"
            site.write_bytes(activated)
            rollback_site.write_bytes(original)
            rollback_receipt.write_text(json.dumps({
                "schema": pilot.SCHEMA,
                "site": str(site),
                "before": pilot.sha256_bytes(original),
                "active": pilot.sha256_bytes(activated),
            }, sort_keys=True, separators=(",", ":")))
            current = pins(
                nginx__site=str(site),
                nginx__site_sha256=pilot.sha256_bytes(original),
            )
            system = FakeSystem()
            reload_bytes: list[bytes] = []

            def command(args, *, timeout=30):
                system.commands.append(list(args))
                if list(args) == ["nginx", "-s", "reload"]:
                    reload_bytes.append(site.read_bytes())
                return b""

            system.command = command
            operator = pilot.Operator(current, system)
            operator.active = Mock()
            operator.candidate_running = Mock()
            real_fsync = os.fsync
            calls = 0

            def fail_directory_fsync(descriptor):
                nonlocal calls
                calls += 1
                if calls == 2:
                    raise OSError("restore directory fsync failed")
                return real_fsync(descriptor)

            with patch.object(pilot, "ROLLBACK_SITE", rollback_site), \
                 patch.object(pilot, "ROLLBACK_RECEIPT", rollback_receipt), \
                 patch.object(pilot, "secure_read", side_effect=lambda path, mode=None: Path(path).read_bytes()), \
                 patch.object(pilot.os, "fsync", side_effect=fail_directory_fsync), \
                 self.assertRaises(pilot.AtomicWriteError) as error:
                operator.restore_proxy(expected_current=activated)
            self.assertTrue(error.exception.committed)
            self.assertEqual(site.read_bytes(), original)
            self.assertEqual(reload_bytes, [original])

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

        document = probe_document()
        phone = next(probe for probe in document["probes"] if probe["label"] == "existing_phone")
        phone["path"] = "/api/trpc/phone.unrelated"
        bad = json.dumps(document, separators=(",", ":")).encode()
        with self.assertRaises(pilot.GuardError):
            pilot.load_probes(bad, pins(probes__sha256=pilot.sha256_bytes(bad)))

    def test_readiness_waits_for_marker_and_resets_public_consecutive_count(self) -> None:
        source = next(probe for probe in probe_document()["probes"] if probe["label"] == "existing_phone")
        probe = pilot.readiness_probe([source])
        system = FakeSystem()
        good = pilot.HttpResult(200, b'{"ok":true}', {pilot.CANDIDATE_HEADER: ("reviewed-build-123",)})
        wrong = pilot.HttpResult(200, b'{"ok":true}', {pilot.CANDIDATE_HEADER: ("wrong-build",)})
        system.responses = [wrong, good, wrong, good, good, good]
        with patch.object(pilot.time, "sleep"):
            pilot.wait_for_candidate_route(
                system, pilot.PUBLIC_ORIGIN, probe, "reviewed-build-123",
                pilot.time.monotonic() + 1, consecutive=3,
            )
        self.assertEqual(len(system.requests), 6)
        self.assertTrue(all(request["headers"]["Connection"] == "close" for _origin, request in system.requests))
        self.assertTrue(all(0 < request["_timeout"] <= 1 for _origin, request in system.requests))

    def test_readiness_timeout_is_bounded_and_fails_closed(self) -> None:
        source = next(probe for probe in probe_document()["probes"] if probe["label"] == "existing_phone")
        probe = pilot.readiness_probe([source])
        system = FakeSystem()
        system.responses = [pilot.HttpResult(200, b'{"ok":true}', {})] * 4
        with patch.object(pilot.time, "monotonic", side_effect=[0.0, 0.0, 0.4, 0.4, 0.8, 0.8, 1.1]), \
             patch.object(pilot.time, "sleep"), \
             self.assertRaises(pilot.GuardError) as error:
            pilot.wait_for_candidate_route(system, pilot.PUBLIC_ORIGIN, probe, "reviewed-build-123", 1.0, consecutive=3)
        self.assertEqual(error.exception.stage, "readiness")
        self.assertTrue(all(request["_timeout"] <= 1.0 for _origin, request in system.requests))

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

    def test_exact_reuse_runtime_passes_and_any_pinned_drift_fails(self) -> None:
        initial = pins()
        inspected = candidate_inspect(initial)
        runtime_sha = pilot.canonical_hash(pilot.candidate_runtime_shape(inspected))
        current = pins(candidate__reuse={"container_id": inspected["Id"], "runtime_sha256": runtime_sha})
        system = FakeSystem()
        system.json_command = Mock(return_value=[inspected])
        system.responses = [(200, json.dumps({
            "ok": True, "service": "phone11-backend", "build": current.candidate_build,
            "runtimeRole": pilot.CANDIDATE_ROLE,
        }).encode())]
        pilot.Operator(current, system).candidate()

        drifted = json.loads(json.dumps(inspected))
        drifted["Config"]["Labels"]["unreviewed"] = "drift"
        system.json_command = Mock(return_value=[drifted])
        with self.assertRaises(pilot.GuardError) as error:
            pilot.Operator(current, system).candidate()
        self.assertEqual(error.exception.stage, "candidate_runtime")

    def test_reuse_skips_compose_up_and_never_recreates_existing_candidate(self) -> None:
        current = pins(candidate__reuse={"container_id": "c" * 64, "runtime_sha256": "d" * 64})
        system = FakeSystem()
        operator = pilot.Operator(current, system)
        operator.prepare = Mock()
        operator.candidate = Mock()
        operator.active = Mock(return_value={"Id": current.active_container_id})
        operator.pinned_nginx = Mock(side_effect=pilot.GuardError("stop_after_reuse"))
        with self.assertRaises(pilot.GuardError) as error:
            operator.activate()
        self.assertEqual(error.exception.stage, "stop_after_reuse")
        self.assertFalse(any(command[:2] == ["docker", "compose"] for command in system.commands))
        operator.candidate.assert_called_once_with()

    def test_reuse_requires_matching_original_proxy_and_prior_rollback_receipt(self) -> None:
        original = b"server { original; }"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            site = root / "site"
            rollback_site = root / "before"
            receipt = root / "receipt"
            site.write_bytes(original)
            rollback_site.write_bytes(original)
            current = pins(
                candidate__reuse={"container_id": "c" * 64, "runtime_sha256": "d" * 64},
                nginx__site=str(site), nginx__site_sha256=pilot.sha256_bytes(original),
            )
            receipt.write_text(json.dumps({
                "schema": pilot.SCHEMA, "site": str(site),
                "before": pilot.sha256_bytes(original), "active": "e" * 64,
            }, sort_keys=True, separators=(",", ":")))
            with patch.object(pilot, "ROLLBACK_SITE", rollback_site), \
                 patch.object(pilot, "ROLLBACK_RECEIPT", receipt), \
                 patch.object(pilot, "secure_read", side_effect=lambda path, mode=None: Path(path).read_bytes()):
                pilot.Operator(current, FakeSystem()).validate_prior_rollback(original)
                receipt.write_text(json.dumps({
                    "schema": pilot.SCHEMA, "site": str(site),
                    "before": pilot.sha256_bytes(original), "active": pilot.sha256_bytes(original),
                }, sort_keys=True, separators=(",", ":")))
                with self.assertRaises(pilot.GuardError):
                    pilot.Operator(current, FakeSystem()).validate_prior_rollback(original)

    def test_port_occupied_fails_closed(self) -> None:
        system = FakeSystem()
        fake_socket = Mock()
        fake_socket.bind.side_effect = OSError("occupied")
        with patch.object(pilot.socket, "socket", return_value=fake_socket), self.assertRaises(pilot.GuardError) as context:
            pilot.Operator(pins(), system).candidate_absent_and_port_free()
        self.assertEqual(context.exception.stage, "candidate_port")

    def test_proxy_has_only_exact_and_prefix_trpc_routes_and_preserves_uri(self) -> None:
        fragment = pilot.proxy_fragment("# PHONE11_PARALLEL_API_INSERT reviewed", "reviewed-build-123").decode()
        self.assertEqual(fragment.count("location = /api/trpc"), 1)
        self.assertEqual(fragment.count("location ^~ /api/trpc/"), 1)
        self.assertEqual(fragment.count("proxy_pass http://127.0.0.1:3002;"), 2)
        self.assertNotIn("proxy_pass http://127.0.0.1:3002/;", fragment)
        self.assertIn("proxy_pass_request_headers on", fragment)
        self.assertEqual(fragment.count("add_header X-Phone11-Api-Candidate reviewed-build-123 always;"), 2)

    def test_activation_attests_delayed_local_and_three_public_generations_before_mutations(self) -> None:
        current = pins(candidate__reuse={"container_id": "c" * 64, "runtime_sha256": "d" * 64})
        system = FakeSystem()
        original = b"server {\n    # PHONE11_PARALLEL_API_INSERT reviewed-123\n}\n"
        probes = probe_document()["probes"]
        good = pilot.HttpResult(200, b'{"ok":true}', {pilot.CANDIDATE_HEADER: (current.candidate_build,)})
        wrong = pilot.HttpResult(200, b'{"ok":true}', {pilot.CANDIDATE_HEADER: ("old-generation",)})
        local_results = [wrong, good]
        public_results = [good, wrong, good, good, good]

        def request(origin, probe):
            system.requests.append((origin, dict(probe)))
            if "_timeout" in probe:
                values = local_results if origin == "http://127.0.0.1" else public_results
                return values.pop(0)
            return probe["status"], b'{"ok":true}'

        system.request = request
        operator = pilot.Operator(current, system)
        operator.prepare = Mock(side_effect=lambda: setattr(operator, "probes", probes))
        operator.candidate = Mock()
        operator.active = Mock(return_value={"Id": current.active_container_id})
        operator.pinned_nginx = Mock(return_value=original)
        operator.save_rollback = Mock()
        operator.wake_target = Mock()
        fake_stat = Mock(st_mode=0o100644, st_uid=0, st_gid=0)
        with patch.object(pilot, "atomic_write"), patch.object(Path, "stat", return_value=fake_stat), \
             patch.object(pilot.time, "sleep"):
            operator.activate()

        first_mutation = next(index for index, (_origin, probe) in enumerate(system.requests) if probe["method"] == "POST")
        self.assertTrue(all(probe["label"] == "existing_phone" for _origin, probe in system.requests[:first_mutation]))
        local_gate = [probe for origin, probe in system.requests if origin == "http://127.0.0.1" and "_timeout" in probe]
        public_gate = [probe for origin, probe in system.requests if origin == pilot.PUBLIC_ORIGIN and "_timeout" in probe]
        self.assertEqual(len(local_gate), 2)
        self.assertEqual(len(public_gate), 5)
        self.assertTrue(all(probe["headers"].get("Host") == "api.phone11.ai" for probe in local_gate))
        self.assertTrue(all(probe["headers"].get("Connection") == "close" for probe in local_gate + public_gate))
        self.assertEqual(len(system.requests), 2 + 5 + len(probes) * 2)
        self.assertFalse(any(command[:2] == ["docker", "compose"] for command in system.commands))

    def test_readiness_timeout_rolls_back_and_never_runs_a_mutating_probe(self) -> None:
        current = pins(candidate__reuse={"container_id": "c" * 64, "runtime_sha256": "d" * 64})
        system = FakeSystem()
        original = b"server {\n    # PHONE11_PARALLEL_API_INSERT reviewed-123\n}\n"
        probes = probe_document()["probes"]

        def request(origin, probe):
            system.requests.append((origin, dict(probe)))
            return pilot.HttpResult(200, b'{"ok":true}', {})

        system.request = request

        class Harness(pilot.Operator):
            def __init__(self):
                super().__init__(current, system)
                self.restored = False
            def prepare(self):
                self.probes = probes
            def candidate(self):
                return None
            def active(self):
                return {"Id": current.active_container_id}
            def pinned_nginx(self):
                return original
            def save_rollback(self, before, active):
                return None
            def restore_proxy(self, expected_current=None):
                self.restored = True

        operator = Harness()
        fake_stat = Mock(st_mode=0o100644, st_uid=0, st_gid=0)
        activated = original.replace(
            current.nginx_insert_marker.encode(),
            pilot.proxy_fragment(current.nginx_insert_marker, current.candidate_build).rstrip(b"\n"),
        )
        with patch.object(pilot, "READINESS_TIMEOUT_SECONDS", 0.001), \
             patch.object(pilot.time, "sleep"), patch.object(pilot, "atomic_write"), \
             patch.object(pilot, "secure_read", return_value=activated), \
             patch.object(Path, "stat", return_value=fake_stat), \
             self.assertRaises(pilot.GuardError) as error:
            operator.activate()
        self.assertEqual(error.exception.stage, "readiness")
        self.assertTrue(operator.restored)
        self.assertTrue(system.requests)
        self.assertTrue(all(probe["method"] == "GET" and probe["label"] == "existing_phone" for _origin, probe in system.requests))

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
        activated = original.replace(
            current.nginx_insert_marker.encode(),
            pilot.proxy_fragment(current.nginx_insert_marker, current.candidate_build).rstrip(b"\n"),
        )
        with (
            patch.object(pilot, "secure_read", return_value=activated),
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
