"""Hermetic safety tests for the Phone11 profile/DND rollout operator."""

from __future__ import annotations

from contextlib import nullcontext
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import time
import unittest
from unittest.mock import ANY, Mock, call, patch


SCRIPT = Path(__file__).parents[1] / "scripts" / "phone11-profile-dnd-rollout.py"
ROOT = Path(__file__).parents[1]
SPEC = importlib.util.spec_from_file_location("phone11_profile_dnd_rollout", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
rollout = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = rollout
SPEC.loader.exec_module(rollout)


SHA = "1" * 64
SHA2 = "2" * 64
DIGEST = "sha256:" + "3" * 64
OLD_DIGEST = "sha256:" + "4" * 64


def runtime(container: str, image: str, build: str) -> dict[str, object]:
    return {"container_id": container * 64, "image": image, "runtime_sha256": SHA, "build": build, "replacement_receipt_sha256": None}


def compose(path: str, service: str) -> dict[str, object]:
    return {"file": path, "sha256": SHA, "rendered_sha256": SHA2, "service": service}


def manifest(**changes: object) -> dict[str, object]:
    value: dict[str, object] = {
        "schema": rollout.SCHEMA,
        "release": {"sha": "a" * 40, "build": "new-build", "image": DIGEST, "bundle_sha256": SHA, "lock_sha256": SHA2},
        "current": {
            "baseline": runtime("b", OLD_DIGEST, "old-build"),
            "candidate": runtime("c", OLD_DIGEST, "old-candidate"),
        },
        "compose": {
            "baseline": compose("/root/baseline.json", "backend"),
            "candidate": compose("/root/candidate.json", "candidate"),
        },
        "rollback": {
            "image": OLD_DIGEST, "build": "old-build",
            "normalized_runtime_sha256": SHA,
            "baseline_operation_id": "11111111-1111-4111-8111-111111111111",
            "baseline_intent_sha256": SHA2,
            "compose": compose("/root/rollback.json", "backend"),
            "disabled_compose": compose("/root/rollback-disabled.json", "backend"),
        },
        "migration": {
            "artifacts": [{"name": "profile", "file": "/root/profile.sql", "sha256": SHA}],
            "verify": "/root/profile-verify.sql", "verify_sha256": SHA2,
            "database_sha256": SHA, "before_catalog_sha256": SHA,
            "after_catalog_sha256": SHA2, "receipt": "/root/profile-receipt.json",
            "receipt_sha256": None,
        },
        "probes": {"file": "/root/probes.json", "sha256": SHA},
        "guard": {
            "program": "/root/idle-guard", "sha256": SHA,
            "fence_id": "profile-dnd-fence-20260921", "fence_evidence_sha256": SHA2,
        },
        "nginx": {
            "site": "/etc/nginx/sites-enabled/api.phone11.ai", "site_sha256": SHA,
            "dump_sha256": SHA2, "marker": "# PHONE11_PROFILE_DND_INSERT reviewed-123",
            "route": "candidate", "dnd_exposed": False,
        },
        "kamailio": {"config_path": "/etc/kamailio/kamailio.cfg", "config_sha256": SHA, "wake_occurrences": 4},
        "public_origin": rollout.PUBLIC_ORIGIN,
    }
    for dotted, replacement in changes.items():
        section, key = dotted.split("__", 1)
        assert isinstance(value[section], dict)
        value[section][key] = replacement
    return value


def pins(**changes: object):
    return rollout.parse_manifest(manifest(**changes))


def rendered(current, *, container: str, service: str, image: str, role: str, port: int, notifications: str | None) -> dict[str, object]:
    env = {"PHONE11_RUNTIME_ROLE": role, "PHONE11_BUILD_SHA": current.release_build, "PORT": str(port)}
    if notifications is not None:
        env["PHONE11_CHAT_NOTIFICATIONS_ENABLED"] = notifications
    return {
        "name": "phone11-profile-dnd",
        "services": {
            service: {
                "container_name": container,
                "image": image,
                "environment": env,
                "ports": [{"host_ip": "127.0.0.1", "published": port, "target": port, "protocol": "tcp"}],
                "restart": "unless-stopped",
            },
        },
    }


def guard_snapshot(*, attempted: int = 0, new_attempted: int = 0) -> dict[str, object]:
    now = int(time.time() * 1000)
    return {
        "schema": rollout.GUARD_SCHEMA,
        "sampled_at_epoch_ms": now,
        "coverage": sorted(rollout.EXPECTED_GUARD_COVERAGE),
        "admission_fence_id": "profile-dnd-fence-20260921",
        "admission_fence_active": True,
        "admission_fence_expires_at_epoch_ms": now + 300_000,
        "admission_fence_coverage": sorted(rollout.EXPECTED_FENCE_COVERAGE),
        "admission_fence_evidence_sha256": SHA2,
        "idle": True,
        **{key: 0 for key in rollout.EXPECTED_GUARD_COVERAGE},
        "attempted_notifications": attempted,
        "new_attempted_notifications": new_attempted,
        "failed_notifications": 0,
        "pending_notifications": 0,
        "wake_ready": True,
        "notifications_ready": True,
    }


def pin_intent(current, baseline_config: dict[str, object]) -> bytes:
    operator = rollout.Operator(current, FakeSystem())
    raw = rollout.canonical_bytes(operator.baseline_intent_document(baseline_config))
    object.__setattr__(current, "baseline_intent_sha256", rollout.sha256_bytes(raw))
    return raw


class FakeSystem(rollout.System):
    def __init__(self) -> None:
        self.commands: list[list[str]] = []
        self.json_responses: list[object] = []
        self.request_responses: list[tuple[int, bytes, dict[str, tuple[str, ...]]]] = []

    def command(self, args, *, timeout=30, stdin=None):
        self.commands.append(list(args))
        return b""

    def json_command(self, args, stage, *, timeout=30, stdin=None):
        self.commands.append(list(args))
        if not self.json_responses:
            raise AssertionError(f"missing JSON response for {stage}")
        return self.json_responses.pop(0)

    def request(self, origin, probe):
        if self.request_responses:
            return self.request_responses.pop(0)
        return 200, b'{"ok":true}', {}


class ProfileDndRolloutTests(unittest.TestCase):
    def test_manifest_requires_exact_origin_hashes_and_two_distinct_images(self) -> None:
        current = pins()
        self.assertEqual(current.public_origin, rollout.PUBLIC_ORIGIN)
        for changes in (
            {"public_origin__ignored": "x"},
            {"release__image": "mutable:latest"},
            {"release__bundle_sha256": "pending"},
            {"rollback__image": DIGEST},
            {"nginx__route": "unknown"},
        ):
            document = manifest()
            if "public_origin__ignored" in changes:
                document["public_origin"] = "https://evil.example"
            else:
                dotted, replacement = next(iter(changes.items()))
                section, key = dotted.split("__", 1)
                document[section][key] = replacement
            with self.subTest(changes=changes), self.assertRaises(rollout.GuardError):
                rollout.parse_manifest(document)

    def test_profile_migration_lint_rejects_data_writes_and_destructive_sql(self) -> None:
        rollout.validate_migration_sql(b"CREATE TABLE phone11_user_profiles(id bigint); CREATE INDEX profile_idx ON phone11_user_profiles(id);")
        for sql in (b"DROP TABLE users", b"DELETE FROM users", b"UPDATE users SET name='x'", b"INSERT INTO users VALUES(1)", b"ALTER TABLE users DROP COLUMN x"):
            with self.subTest(sql=sql), self.assertRaises(rollout.GuardError):
                rollout.validate_migration_sql(sql)
        rollout.validate_verification_sql(b"SELECT json_build_object('ok', true) AS catalog")
        for sql in (b"DELETE FROM users RETURNING *", b"CREATE TABLE surprise(id int)"):
            with self.subTest(verify=sql), self.assertRaises(rollout.GuardError):
                rollout.validate_verification_sql(sql)

    def test_actual_profile_and_all_mentions_sql_normalize_under_one_outer_transaction(self) -> None:
        paths = (
            ROOT / "server/profile/migration.sql",
            ROOT / "server/chat/all-mentions-migration.sql",
            ROOT / "server/chat/all-mentions-live-delta-20260920.sql",
        )
        for path in paths:
            with self.subTest(path=path.name):
                normalized = rollout.normalize_migration_sql(path.read_bytes()).decode()
                heads = [rollout.sql_top_level_mask(item).strip(" ;\n\t").upper() for item in rollout.split_sql_statements(normalized)]
                self.assertFalse(any(re.match(r"^(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b", head) for head in heads))
        self.assertIn("ON DELETE CASCADE", rollout.normalize_migration_sql(paths[1].read_bytes()).decode())

    def test_migration_normalizer_rejects_nested_transaction_control_and_dml(self) -> None:
        with self.assertRaises(rollout.GuardError) as error:
            rollout.normalize_migration_sql(b"BEGIN; CREATE TABLE safe(id int); COMMIT; COMMIT;")
        self.assertEqual(error.exception.stage, "migration_transaction")
        for sql in (
            b"BEGIN; DELETE FROM users; COMMIT;",
            b"DO $$ BEGIN EXECUTE 'DELETE FROM users'; END $$;",
        ):
            with self.subTest(sql=sql), self.assertRaises(rollout.GuardError):
                rollout.normalize_migration_sql(sql)

    def test_manifest_accepts_only_profile_then_optional_all_mentions_artifacts(self) -> None:
        artifacts = [
            {"name": "profile", "file": "/root/profile.sql", "sha256": SHA},
            {"name": "all_mentions", "file": "/root/all-mentions.sql", "sha256": SHA2},
        ]
        current = pins(migration__artifacts=artifacts)
        self.assertEqual([artifact.name for artifact in current.migration_artifacts], ["profile", "all_mentions"])
        for invalid in ([], list(reversed(artifacts)), [*artifacts, artifacts[1]]):
            with self.subTest(invalid=invalid), self.assertRaises(rollout.GuardError):
                pins(migration__artifacts=invalid)

    def test_migration_runner_holds_advisory_lock_and_bounded_timeouts(self) -> None:
        self.assertIn("pg_advisory_xact_lock", rollout.MIGRATION_NODE)
        self.assertIn("lock_timeout='2000ms'", rollout.MIGRATION_NODE)
        self.assertIn("statement_timeout='30000ms'", rollout.MIGRATION_NODE)
        self.assertIn("SERIALIZABLE", rollout.MIGRATION_NODE)

    def test_baseline_and_disabled_rollback_compose_are_exact_opposites_for_alert_gate(self) -> None:
        current = pins()
        baseline = rendered(current, container=rollout.BASELINE_CONTAINER, service="backend", image=DIGEST, role="default", port=3000, notifications="1")
        disabled = rendered(current, container=rollout.BASELINE_CONTAINER, service="backend", image=OLD_DIGEST, role="default", port=3000, notifications="0")
        baseline_pin = rollout.ComposePin(Path("/root/baseline.json"), SHA, rollout.canonical_hash(baseline), "backend")
        disabled_pin = rollout.ComposePin(Path("/root/rollback-disabled.json"), SHA, rollout.canonical_hash(disabled), "backend")
        rollout.validate_compose(baseline, baseline_pin, container=rollout.BASELINE_CONTAINER, image=DIGEST, build=current.release_build, role="default", port=3000, notifications="1")
        rollout.validate_compose(disabled, disabled_pin, container=rollout.BASELINE_CONTAINER, image=OLD_DIGEST, build=current.release_build, role="default", port=3000, notifications="0")
        disabled["services"]["backend"]["environment"]["PHONE11_CHAT_NOTIFICATIONS_ENABLED"] = "1"
        with self.assertRaises(rollout.GuardError):
            rollout.validate_compose(disabled, disabled_pin, container=rollout.BASELINE_CONTAINER, image=OLD_DIGEST, build=current.release_build, role="default", port=3000, notifications="0")

    def test_prepare_has_no_service_or_proxy_mutation(self) -> None:
        system = FakeSystem()
        operator = rollout.Operator(pins(), system)
        operator.image = Mock()
        operator.current = Mock()
        operator.compose_inputs = Mock(return_value=({"name": "baseline"}, {"name": "candidate"}))
        operator.receipt = Mock()
        operator.database = Mock()
        operator.database = Mock(return_value={})
        operator.nginx = Mock(return_value=b"site")
        operator.wake = Mock()
        operator.guard = Mock(return_value={})
        with patch.object(rollout, "pinned_read", return_value=json.dumps({"schema": rollout.PROBE_SCHEMA, "probes": []}).encode()), \
             patch.object(rollout, "load_probes", return_value=[]):
            operator.prepare()
        operator.database.assert_called_once_with("inspect")
        operator.guard.assert_called_once_with("prepare")
        flattened = [item for command in system.commands for item in command]
        self.assertNotIn("stop", flattened)
        self.assertNotIn("up", flattened)
        self.assertNotIn("reload", flattened)

    def test_replace_baseline_rechecks_idle_immediately_before_stop_and_never_kills(self) -> None:
        normalized = rollout.canonical_hash({"same": True})
        current = pins(nginx__route="candidate", rollback__normalized_runtime_sha256=normalized)
        system = FakeSystem()
        operator = rollout.Operator(current, system)
        events: list[str] = []
        operator.prepare = Mock(side_effect=lambda: events.append("prepare"))
        operator.receipt = Mock(side_effect=lambda: events.append("receipt"))
        operator.guard = Mock(side_effect=lambda phase, **kwargs: events.append(phase) or guard_snapshot(attempted=3))
        operator.wake = Mock(side_effect=lambda: events.append("wake"))
        operator.save_runtime_receipt = Mock()
        operator.write_baseline_intent = Mock(side_effect=lambda *_args: events.append("intent"))
        operator.require_worker_topology = Mock()
        operator.baseline_config, operator.candidate_config = {"name": "baseline"}, {"name": "candidate"}
        replacement = {"Id": "d" * 64, "Image": DIGEST, "State": {"Running": True, "OOMKilled": False, "ExitCode": 0}, "Config": {"Env": ["PHONE11_RUNTIME_ROLE=default", "PHONE11_BUILD_SHA=" + current.release_build, "PHONE11_CHAT_NOTIFICATIONS_ENABLED=1"], "Labels": {"com.docker.compose.project": "phone11", "com.docker.compose.service": "backend"}}, "HostConfig": {"PortBindings": {"3000/tcp": [{"HostIp": "127.0.0.1", "HostPort": "3000"}]}}}
        document = {"name": "phone11", "services": {"backend": {}}}
        with patch.object(rollout, "validate_runtime", return_value={"Id": current.baseline.container_id}), \
             patch.object(rollout, "health"), \
             patch.object(rollout, "runtime_shape", return_value={"runtime": True}), \
             patch.object(rollout, "normalized_runtime_release", return_value={"same": True}), \
             patch.object(rollout, "render_compose", return_value=document), \
             patch.object(rollout, "one_inspect", return_value=replacement):
            operator._up = Mock(side_effect=lambda *_args, **_kwargs: events.append("stop-up") or guard_snapshot(attempted=3))
            operator.replace_baseline()
        self.assertLess(events.index("replace-baseline-before"), events.index("stop-up"))
        operator._up.assert_called_once_with(
            document, current.baseline_compose,
            stop=(rollout.BASELINE_CONTAINER, current.baseline.container_id),
            fence_id=current.guard_fence_id, since_ms=ANY,
            stopped_phase="replace-baseline-stopped",
            shutdown_receipt=(rollout.BASELINE_SHUTDOWN_RECEIPT, "replace_baseline", current.baseline),
        )
        self.assertLess(events.index("intent"), events.index("stop-up"))
        self.assertFalse(any("kill" in command for command in system.commands))

    def test_post_exposure_baseline_failure_never_restarts_old_enabled_dispatcher(self) -> None:
        current = pins(nginx__route="baseline", nginx__dnd_exposed=True)
        operator = rollout.Operator(current, FakeSystem())
        operator.prepare = Mock()
        operator.receipt = Mock()
        operator.guard = Mock(return_value=guard_snapshot(attempted=3))
        operator.wake = Mock()
        operator.write_baseline_intent = Mock()
        operator._up = Mock(return_value=guard_snapshot(attempted=3))
        with patch.object(rollout, "validate_runtime", return_value={"Id": current.baseline.container_id}), \
             patch.object(rollout, "render_compose", return_value={"name": "phone11"}), \
             patch.object(rollout, "one_inspect", side_effect=rollout.GuardError("replacement_failed")), \
             self.assertRaises(rollout.GuardError):
            operator.replace_baseline()
        operator._up.assert_called_once()  # only the new image attempt; no old enabled rollback

    def test_pre_exposure_failure_uses_exact_pinned_enabled_rollback(self) -> None:
        current = pins(nginx__route="candidate")
        operator = rollout.Operator(current, FakeSystem())
        operator.prepare = Mock()
        operator.receipt = Mock()
        operator.guard = Mock(return_value=guard_snapshot(attempted=3))
        operator.wake = Mock()
        operator.write_baseline_intent = Mock()
        operator._up = Mock(return_value=guard_snapshot(attempted=3))
        operator.require_worker_topology = Mock()
        operator.baseline_config, operator.candidate_config = {"name": "baseline"}, {"name": "candidate"}
        new_document, rollback_document = {"name": "new"}, {"name": "rollback"}
        restored = {"Id": "o" * 64, "Image": OLD_DIGEST, "State": {"Running": True}, "Config": {"Env": ["PHONE11_RUNTIME_ROLE=default", "PHONE11_CHAT_NOTIFICATIONS_ENABLED=1"]}}
        with patch.object(rollout, "validate_runtime", return_value={"Id": current.baseline.container_id}), \
             patch.object(rollout, "health"), \
             patch.object(rollout, "normalized_runtime_release", return_value={"same": True}), \
             patch.object(rollout, "render_compose", side_effect=[new_document, rollback_document]), \
             patch.object(rollout, "one_inspect", side_effect=[rollout.GuardError("replacement_failed"), restored]), \
             self.assertRaises(rollout.GuardError):
            operator.replace_baseline()
        self.assertEqual(operator._up.call_args_list, [
            call(
                new_document, current.baseline_compose,
                stop=(rollout.BASELINE_CONTAINER, current.baseline.container_id),
                fence_id=current.guard_fence_id, since_ms=ANY,
                stopped_phase="replace-baseline-stopped",
                shutdown_receipt=(rollout.BASELINE_SHUTDOWN_RECEIPT, "replace_baseline", current.baseline),
            ),
            call(rollback_document, current.rollback_compose, stop=None, fence_id=current.guard_fence_id, since_ms=ANY, stopped_phase="baseline-auto-rollback-stopped"),
        ])
        self.assertTrue(any(item.args == ("baseline-auto-rollback",) for item in operator.guard.call_args_list))

    def _assert_pre_mutation_intent_survives_up_fault(self, stage: str) -> None:
        normalized = rollout.canonical_hash({"same": True})
        current = pins(
            nginx__route="baseline", nginx__dnd_exposed=True,
            migration__receipt_sha256=SHA,
            rollback__normalized_runtime_sha256=normalized,
        )
        document = {"name": "phone11", "services": {"backend": {}}}
        expected_intent = pin_intent(current, document)
        operator = rollout.Operator(current, FakeSystem())
        operator.prepare = Mock()
        operator.receipt = Mock()
        operator.guard = Mock(return_value=guard_snapshot())
        operator.wake = Mock()
        with tempfile.TemporaryDirectory() as directory:
            state_root = Path(directory)
            intent_path = state_root / "baseline-intent.json"

            def fail_after_create(*_args, **_kwargs):
                self.assertEqual(intent_path.read_bytes(), expected_intent)
                raise rollout.GuardError(stage)

            operator._up = Mock(side_effect=fail_after_create)
            with patch.object(rollout, "STATE_ROOT", state_root), \
                 patch.object(rollout, "BASELINE_INTENT", intent_path), \
                 patch.object(rollout, "ensure_private_directory"), \
                 patch.object(rollout.os, "fchown"), \
                 patch.object(rollout, "validate_runtime", return_value={"Id": current.baseline.container_id}), \
                 patch.object(rollout, "render_compose", return_value=document), \
                 self.assertRaises(rollout.GuardError) as error:
                operator.replace_baseline()
            self.assertEqual(error.exception.stage, stage)
            self.assertEqual(intent_path.read_bytes(), expected_intent)

    def test_intent_is_durable_before_up_creates_container_then_errors(self) -> None:
        self._assert_pre_mutation_intent_survives_up_fault("compose_created_then_error")

    def test_intent_is_durable_before_compose_timeout(self) -> None:
        self._assert_pre_mutation_intent_survives_up_fault("command_timeout")

    def test_disabled_rollback_uses_only_disabled_artifact_and_verifies_gate_off(self) -> None:
        normalized = rollout.canonical_hash({"same": True})
        current = pins(nginx__route="baseline", nginx__dnd_exposed=True, migration__receipt_sha256=SHA, rollback__normalized_runtime_sha256=normalized)
        operator = rollout.Operator(current, FakeSystem())
        operator.rollback_preflight = Mock(return_value=({"name": "baseline"}, {"name": "candidate"}, current.baseline, (rollout.BASELINE_CONTAINER, current.baseline.container_id)))
        before_snapshot = guard_snapshot()
        stopped_snapshot = guard_snapshot()
        stopped_snapshot["sampled_at_epoch_ms"] = before_snapshot["sampled_at_epoch_ms"] + 10
        operator.guard = Mock(side_effect=[before_snapshot, guard_snapshot()])
        operator.wake = Mock()
        operator._up = Mock(return_value=stopped_snapshot)
        operator.save_runtime_receipt = Mock()
        operator.require_worker_topology = Mock()
        document = {"name": "rollback-disabled"}
        inspect = {"Id": "e" * 64, "Image": OLD_DIGEST, "State": {"Running": True}, "Config": {"Env": ["PHONE11_RUNTIME_ROLE=default", "PHONE11_BUILD_SHA=old-build", "PHONE11_CHAT_NOTIFICATIONS_ENABLED=0"], "Labels": {"com.docker.compose.project": "baseline", "com.docker.compose.service": "backend"}}}
        with patch.object(rollout, "render_compose", return_value=document) as render_call, \
             patch.object(rollout, "health"), \
             patch.object(rollout, "validate_runtime", return_value={"Id": current.baseline.container_id}), \
             patch.object(rollout, "normalized_runtime_release", return_value={"same": True}), \
             patch.object(rollout, "one_inspect", return_value=inspect):
            operator.rollback_baseline_disabled()
        self.assertIs(render_call.call_args.args[1], current.rollback_disabled_compose)
        self.assertEqual(render_call.call_args.kwargs["notifications"], "0")
        operator._up.assert_called_once_with(document, current.rollback_disabled_compose, stop=(rollout.BASELINE_CONTAINER, current.baseline.container_id), fence_id=current.guard_fence_id, since_ms=ANY, stopped_phase="rollback-baseline-disabled-stopped")
        self.assertEqual(operator.guard.call_count, 2)
        self.assertEqual(operator.guard.call_args_list[1].kwargs["since_ms"], stopped_snapshot["sampled_at_epoch_ms"])
        self.assertIs(operator.guard.call_args_list[1].kwargs["require_wake"], True)

    def test_disabled_rollback_recreates_absent_baseline_without_stop(self) -> None:
        normalized = rollout.canonical_hash({"same": True})
        current = pins(nginx__route="baseline", nginx__dnd_exposed=True, migration__receipt_sha256=SHA, rollback__normalized_runtime_sha256=normalized)
        operator = rollout.Operator(current, FakeSystem())
        configs = ({"name": "baseline"}, {"name": "candidate"})
        operator.rollback_preflight = Mock(return_value=(*configs, None, None))
        before_snapshot, stopped_snapshot = guard_snapshot(), guard_snapshot()
        operator.guard = Mock(side_effect=[before_snapshot, guard_snapshot()])
        operator.wake = Mock()
        operator._up = Mock(return_value=stopped_snapshot)
        operator.save_runtime_receipt = Mock()
        operator.require_worker_topology = Mock()
        document = {"name": "rollback-disabled"}
        restored = {"Id": "e" * 64, "Image": OLD_DIGEST, "State": {"Running": True}, "Config": {"Env": ["PHONE11_RUNTIME_ROLE=default", "PHONE11_BUILD_SHA=old-build", "PHONE11_CHAT_NOTIFICATIONS_ENABLED=0"], "Labels": {"com.docker.compose.project": "baseline", "com.docker.compose.service": "backend"}}}
        with patch.object(rollout, "render_compose", return_value=document), \
             patch.object(rollout, "health"), \
             patch.object(rollout, "normalized_runtime_release", return_value={"same": True}), \
             patch.object(rollout, "one_inspect", return_value=restored):
            operator.rollback_baseline_disabled()
        operator._up.assert_called_once_with(
            document, current.rollback_disabled_compose, stop=None,
            fence_id=current.guard_fence_id, since_ms=ANY,
            stopped_phase="rollback-baseline-disabled-stopped",
        )
        self.assertIsNone(operator.save_runtime_receipt.call_args.kwargs["before"])

    def test_disabled_rollback_preflight_accepts_absent_baseline(self) -> None:
        current = pins(nginx__route="baseline", nginx__dnd_exposed=True, migration__receipt_sha256=SHA)
        operator = rollout.Operator(current, FakeSystem())
        operator.image = Mock()
        configs = ({"name": "baseline"}, {"name": "candidate"})
        operator.compose_inputs = Mock(return_value=configs)
        operator.receipt = Mock()
        operator.nginx = Mock()
        operator.wake = Mock()
        operator.named_container_id = Mock(return_value=None)
        operator.require_worker_topology = Mock()
        with patch.object(rollout, "pinned_read", return_value=b"{}"), \
             patch.object(rollout, "load_probes", return_value=[]), \
             patch.object(rollout, "validate_runtime") as validate:
            self.assertEqual(operator.rollback_preflight(), (*configs, None, None))
        validate.assert_called_once_with(
            operator.system, rollout.CANDIDATE_CONTAINER, current.candidate,
            role="api-candidate", port=rollout.CANDIDATE_PORT, require_healthy=False,
            compose_project="candidate", compose_service=current.candidate_compose.service,
        )

    def test_disabled_rollback_preflight_does_not_require_candidate_health(self) -> None:
        document = manifest(nginx__route="baseline", nginx__dnd_exposed=True, migration__receipt_sha256=SHA)
        candidate_shape = {"candidate": "approved"}
        document["current"]["candidate"]["runtime_sha256"] = rollout.canonical_hash(candidate_shape)
        current = rollout.parse_manifest(document)
        operator = rollout.Operator(current, FakeSystem())
        operator.image = Mock()
        operator.compose_inputs = Mock(return_value=({"name": "baseline"}, {"name": "candidate"}))
        operator.receipt = Mock()
        operator.nginx = Mock()
        operator.wake = Mock()
        operator.named_container_id = Mock(return_value=None)
        operator.require_worker_topology = Mock()
        unhealthy = {
            "Id": current.candidate.container_id, "Image": current.candidate.image,
            "State": {"Running": False, "OOMKilled": False},
            "Config": {
                "Env": ["PHONE11_RUNTIME_ROLE=api-candidate", "PHONE11_BUILD_SHA=old-candidate", "PORT=3002"],
                "Labels": {"com.docker.compose.project": "candidate", "com.docker.compose.service": "candidate"},
            },
            "HostConfig": {"PortBindings": {"3002/tcp": [{"HostIp": "127.0.0.1", "HostPort": "3002"}]}},
        }
        with patch.object(rollout, "pinned_read", return_value=b"{}"), \
             patch.object(rollout, "load_probes", return_value=[]), \
             patch.object(rollout, "one_inspect", return_value=unhealthy), \
             patch.object(rollout, "runtime_shape", return_value=candidate_shape), \
             patch.object(rollout, "health") as health_call:
            operator.rollback_preflight()
        health_call.assert_not_called()

    def test_disabled_rollback_accepts_intended_replacement_without_post_receipt(self) -> None:
        normalized = rollout.canonical_hash({"same": True})
        current = pins(
            nginx__route="baseline", nginx__dnd_exposed=True,
            migration__receipt_sha256=SHA,
            rollback__normalized_runtime_sha256=normalized,
        )
        operator = rollout.Operator(current, FakeSystem())
        failed_id = "f" * 64
        operator.named_container_id = Mock(return_value=failed_id)
        baseline_config = {"name": "baseline"}
        intent = pin_intent(current, baseline_config)
        inspect = {"Id": failed_id, "Image": DIGEST, "State": {"Running": False}, "Config": {"Env": ["PHONE11_RUNTIME_ROLE=default", "PHONE11_BUILD_SHA=new-build", "PHONE11_CHAT_NOTIFICATIONS_ENABLED=1"], "Labels": {"com.docker.compose.project": "baseline", "com.docker.compose.service": "backend"}}, "HostConfig": {"PortBindings": {"3000/tcp": [{"HostIp": "127.0.0.1", "HostPort": "3000"}]}}}
        with patch.object(rollout, "pinned_read", return_value=intent), \
             patch.object(rollout, "one_inspect", return_value=inspect), \
             patch.object(rollout, "runtime_shape", return_value={"runtime": True}), \
             patch.object(rollout, "normalized_runtime_release", return_value={"same": True}):
            before, stop = operator.rollback_baseline_identity({"name": "baseline"})
        self.assertEqual(before.container_id, failed_id)
        self.assertEqual(stop, (rollout.BASELINE_CONTAINER, failed_id))

    def test_disabled_rollback_rejects_intended_container_with_runtime_mismatch(self) -> None:
        normalized = rollout.canonical_hash({"approved": True})
        current = pins(
            nginx__route="baseline", nginx__dnd_exposed=True,
            migration__receipt_sha256=SHA,
            rollback__normalized_runtime_sha256=normalized,
        )
        operator = rollout.Operator(current, FakeSystem())
        failed_id = "f" * 64
        operator.named_container_id = Mock(return_value=failed_id)
        baseline_config = {"name": "baseline"}
        intent = pin_intent(current, baseline_config)
        inspect = {"Id": failed_id, "Image": DIGEST, "State": {"Running": False}, "Config": {"Env": ["PHONE11_RUNTIME_ROLE=default", "PHONE11_BUILD_SHA=new-build", "PHONE11_CHAT_NOTIFICATIONS_ENABLED=1"], "Labels": {"com.docker.compose.project": "baseline", "com.docker.compose.service": "backend"}}, "HostConfig": {"PortBindings": {"3000/tcp": [{"HostIp": "127.0.0.1", "HostPort": "3000"}]}}}
        with patch.object(rollout, "pinned_read", return_value=intent), \
             patch.object(rollout, "one_inspect", return_value=inspect), \
             patch.object(rollout, "normalized_runtime_release", return_value={"tampered": True}), \
             self.assertRaises(rollout.GuardError) as error:
            operator.rollback_baseline_identity(baseline_config)
        self.assertEqual(error.exception.stage, "baseline_identity")

    def test_disabled_rollback_rejects_replayed_stale_intent(self) -> None:
        current = pins(nginx__route="baseline", nginx__dnd_exposed=True, migration__receipt_sha256=SHA)
        operator = rollout.Operator(current, FakeSystem())
        failed_id = "f" * 64
        operator.named_container_id = Mock(return_value=failed_id)
        baseline_config = {"name": "baseline"}
        stale_intent = pin_intent(current, baseline_config)
        object.__setattr__(current, "baseline_operation_id", "22222222-2222-4222-8222-222222222222")
        with patch.object(rollout, "pinned_read", return_value=stale_intent), \
             patch.object(rollout, "one_inspect") as inspect, \
             self.assertRaises(rollout.GuardError) as error:
            operator.rollback_baseline_identity(baseline_config)
        self.assertEqual(error.exception.stage, "baseline_intent")
        inspect.assert_not_called()

    def test_disabled_rollback_rejects_unknown_replacement_container(self) -> None:
        current = pins(nginx__route="baseline", nginx__dnd_exposed=True, migration__receipt_sha256=SHA)
        operator = rollout.Operator(current, FakeSystem())
        operator.named_container_id = Mock(return_value="u" * 64)
        with patch.object(rollout, "pinned_read", side_effect=rollout.GuardError("baseline_intent")), \
             patch.object(rollout, "validate_runtime") as validate, \
             self.assertRaises(rollout.GuardError) as error:
            operator.rollback_baseline_identity({"name": "baseline"})
        self.assertEqual(error.exception.stage, "baseline_intent")
        validate.assert_not_called()

    def test_candidate_replacement_requires_baseline_route_before_stop(self) -> None:
        current = pins(nginx__route="candidate")
        operator = rollout.Operator(current, FakeSystem())
        operator.prepare = Mock()
        operator._up = Mock()
        with self.assertRaises(rollout.GuardError) as error:
            operator.replace_candidate()
        self.assertEqual(error.exception.stage, "route_state")
        operator._up.assert_not_called()

    def test_worker_inventory_rejects_unknown_default_container_without_build_marker(self) -> None:
        current = pins()
        system = FakeSystem()
        unknown = {
            "Id": "u" * 64,
            "Image": OLD_DIGEST,
            "State": {"Running": True},
            "Config": {
                "Env": [],
                "Labels": {
                    "com.docker.compose.project": "phone11-profile-dnd",
                    "com.docker.compose.service": "backend",
                },
            },
        }
        system.json_responses = [[unknown]]

        def command(args, **_kwargs):
            system.commands.append(list(args))
            if args[:3] == ["docker", "ps", "-a"]:
                return b"cp11-shadow-worker\n"
            return b""

        system.command = command
        operator = rollout.Operator(current, system)
        with self.assertRaises(rollout.GuardError) as error:
            operator.require_worker_topology({"name": "phone11-profile-dnd"}, {"name": "phone11-profile-dnd"})
        self.assertEqual(error.exception.stage, "unknown_worker")

    def test_graceful_stop_rejects_every_nonzero_exit_and_never_invokes_docker_kill(self) -> None:
        current = pins()
        for exit_code in (1, 137):
            with self.subTest(exit_code=exit_code):
                system = FakeSystem()
                system.json_responses = [[{
                    "Id": current.baseline.container_id,
                    "State": {"Running": False, "OOMKilled": False, "ExitCode": exit_code},
                }]]
                operator = rollout.Operator(current, system)
                with self.assertRaises(rollout.GuardError) as error:
                    operator.stop_gracefully(rollout.BASELINE_CONTAINER, current.baseline.container_id)
                self.assertEqual(error.exception.stage, "graceful_stop")
                self.assertIn([
                    "docker", "stop", "--time", str(rollout.DOCKER_STOP_SECONDS),
                    rollout.BASELINE_CONTAINER,
                ], system.commands)
                self.assertFalse(any("kill" in command for command in system.commands))

    def test_fresh_guard_rejects_any_new_attempted_notification(self) -> None:
        system = FakeSystem()
        system.json_responses = [{
            "schema": rollout.GUARD_SCHEMA,
            "sampled_at_epoch_ms": int(time.time() * 1000),
            "coverage": sorted(rollout.EXPECTED_GUARD_COVERAGE),
            "admission_fence_id": "profile-dnd-fence-20260921",
            "admission_fence_active": True,
            "admission_fence_expires_at_epoch_ms": int(time.time() * 1000) + 300_000,
            "admission_fence_coverage": sorted(rollout.EXPECTED_FENCE_COVERAGE),
            "admission_fence_evidence_sha256": SHA2,
            "idle": True,
            "freeswitch_channels": 0,
            "kamailio_dialogs": 0,
            "relay_calls": 0,
            "sip_transactions_active": 0,
            "active_conference_jobs": 0,
            "active_recording_jobs": 0,
            "active_media_jobs": 0,
            "active_worker_jobs": 0,
            "attempted_notifications": 1,
            "new_attempted_notifications": 1,
            "failed_notifications": 0,
            "pending_notifications": 2,
            "wake_ready": True,
            "notifications_ready": True,
        }]
        operator = rollout.Operator(pins(), system)
        with patch.object(rollout, "pinned_read", return_value=b"guard"), \
             self.assertRaises(rollout.GuardError) as error:
            operator.guard("after", since_ms=1)
        self.assertEqual(error.exception.stage, "stranded_notification")
        self.assertIn("--since-epoch-ms", system.commands[0])

    def test_baseline_stop_authority_requires_active_matching_admission_fence(self) -> None:
        current = pins()
        system = FakeSystem()
        system.json_responses = [{
            "schema": rollout.GUARD_SCHEMA,
            "sampled_at_epoch_ms": int(time.time() * 1000),
            "coverage": sorted(rollout.EXPECTED_GUARD_COVERAGE),
            "admission_fence_id": current.guard_fence_id,
            "admission_fence_active": False,
            "admission_fence_expires_at_epoch_ms": int(time.time() * 1000) + 300_000,
            "admission_fence_coverage": sorted(rollout.EXPECTED_FENCE_COVERAGE),
            "admission_fence_evidence_sha256": current.guard_fence_evidence_sha256,
            "idle": True,
            **{key: 0 for key in rollout.EXPECTED_GUARD_COVERAGE},
            "attempted_notifications": 0,
            "new_attempted_notifications": 0,
            "failed_notifications": 0,
            "pending_notifications": 0,
            "wake_ready": True,
            "notifications_ready": True,
        }]
        operator = rollout.Operator(current, system)
        with patch.object(rollout, "pinned_read", return_value=b"guard"), \
             self.assertRaises(rollout.GuardError) as error:
            operator.guard("before", require_fence=True, min_fence_remaining_ms=120_000)
        self.assertEqual(error.exception.stage, "admission_fence")

    def test_restart_rechecks_same_pinned_fence_immediately_before_and_after_stop(self) -> None:
        current = pins()
        operator = rollout.Operator(current, FakeSystem())
        events: list[str] = []
        operator.guard = Mock(side_effect=lambda phase, **_kwargs: events.append(phase) or guard_snapshot())
        stopped_runtime = {
            "Id": current.baseline.container_id,
            "State": {
                "Running": False, "OOMKilled": False, "ExitCode": 0,
                "FinishedAt": "2026-09-22T08:00:00.000000000Z",
            },
        }
        operator.stop_gracefully = Mock(side_effect=lambda *_args: events.append("stop") or stopped_runtime)
        operator.save_shutdown_receipt = Mock(side_effect=lambda *_args, **_kwargs: events.append("receipt"))
        operator.system.command = Mock(side_effect=lambda *_args, **_kwargs: events.append("up") or b"")
        with patch.object(rollout, "frozen_compose", return_value=nullcontext(Path("/root/frozen-compose.json"))):
            stopped = operator._up(
                {"name": "phone11-profile-dnd"}, current.baseline_compose,
                stop=(rollout.BASELINE_CONTAINER, current.baseline.container_id),
                fence_id=current.guard_fence_id, since_ms=1,
                stopped_phase="replace-baseline-stopped",
                shutdown_receipt=(rollout.BASELINE_SHUTDOWN_RECEIPT, "replace_baseline", current.baseline),
            )
        self.assertEqual(events, [
            "replace-baseline-stopped-before-stop", "stop",
            "replace-baseline-stopped", "receipt", "up",
        ])
        self.assertEqual(stopped["admission_fence_evidence_sha256"], current.guard_fence_evidence_sha256)

    def test_shutdown_receipt_is_durable_before_failed_replacement_start(self) -> None:
        current = pins()
        events: list[str] = []
        system = FakeSystem()
        operator = rollout.Operator(current, system)
        stopped_guard = guard_snapshot()
        stopped_runtime = {
            "Id": current.baseline.container_id,
            "State": {
                "Running": False, "OOMKilled": False, "ExitCode": 0,
                "FinishedAt": "2026-09-22T08:00:00.000000000Z",
            },
        }
        operator.guard = Mock(side_effect=lambda phase, **_kwargs: events.append(phase) or stopped_guard)
        operator.stop_gracefully = Mock(side_effect=lambda *_args: events.append("stop") or stopped_runtime)

        with tempfile.TemporaryDirectory() as directory:
            state_root = Path(directory)
            receipt_path = state_root / "baseline-shutdown-receipt.json"

            def command(args, **_kwargs):
                events.append("up")
                self.assertTrue(receipt_path.exists())
                raise rollout.GuardError("compose_start")

            system.command = command
            with patch.object(rollout, "STATE_ROOT", state_root), \
                 patch.object(rollout, "BASELINE_SHUTDOWN_RECEIPT", receipt_path), \
                 patch.object(rollout, "ensure_private_directory"), \
                 patch.object(rollout.os, "fchown"), \
                 patch.object(rollout, "frozen_compose", return_value=nullcontext(Path("/root/frozen-compose.json"))), \
                 self.assertRaises(rollout.GuardError) as error:
                operator._up(
                    {"name": "phone11-profile-dnd"}, current.baseline_compose,
                    stop=(rollout.BASELINE_CONTAINER, current.baseline.container_id),
                    fence_id=current.guard_fence_id, since_ms=1,
                    stopped_phase="replace-baseline-stopped",
                    shutdown_receipt=(receipt_path, "replace_baseline", current.baseline),
                )
            self.assertEqual(error.exception.stage, "compose_start")
            receipt = json.loads(receipt_path.read_bytes())
            self.assertEqual(receipt["schema"], rollout.SHUTDOWN_RECEIPT_SCHEMA)
            self.assertEqual(receipt["container_id"], current.baseline.container_id)
            self.assertEqual(receipt["exit_code"], 0)
            self.assertEqual(receipt["baseline_intent_sha256"], current.baseline_intent_sha256)
            self.assertEqual(receipt["stopped_guard_sha256"], rollout.canonical_hash(stopped_guard))
            self.assertEqual(events[-1], "up")

    def test_preexisting_shutdown_receipt_prevents_stop_and_replacement_start(self) -> None:
        current = pins()
        operator = rollout.Operator(current, FakeSystem())
        operator.guard = Mock()
        operator.stop_gracefully = Mock()
        operator.system.command = Mock()
        with tempfile.TemporaryDirectory() as directory:
            receipt_path = Path(directory) / "baseline-shutdown-receipt.json"
            receipt_path.write_bytes(b"stale")
            with patch.object(rollout, "BASELINE_SHUTDOWN_RECEIPT", receipt_path), \
                 self.assertRaises(rollout.GuardError) as error:
                operator._up(
                    {"name": "phone11-profile-dnd"}, current.baseline_compose,
                    stop=(rollout.BASELINE_CONTAINER, current.baseline.container_id),
                    fence_id=current.guard_fence_id, since_ms=1,
                    stopped_phase="replace-baseline-stopped",
                    shutdown_receipt=(receipt_path, "replace_baseline", current.baseline),
                )
        self.assertEqual(error.exception.stage, "shutdown_receipt")
        operator.guard.assert_not_called()
        operator.stop_gracefully.assert_not_called()
        operator.system.command.assert_not_called()

    def test_route_refuses_receipt_that_does_not_prove_actual_release_runtime(self) -> None:
        document = manifest()
        baseline = document["current"]["baseline"]
        baseline.update({
            "image": DIGEST, "build": "new-build",
            "replacement_receipt_sha256": SHA2,
        })
        current = rollout.parse_manifest(document)
        operator = rollout.Operator(current, FakeSystem())
        operator.prepare = Mock()
        operator.nginx = Mock()
        bad_receipt = rollout.canonical_bytes({
            "schema": rollout.SCHEMA, "action": "replace_baseline",
            "before_container_id": "b" * 64, "before_image": OLD_DIGEST,
            "before_runtime_sha256": SHA, "before_build": "old-build",
            "after_container_id": current.baseline.container_id,
            "after_image": DIGEST, "after_build": "wrong-build",
            "after_runtime_sha256": current.baseline.runtime_sha256,
            "ordinary_chat_notifications": "enabled",
            "before_attempted_notifications": 0,
        })
        with patch.object(rollout, "validate_runtime"), \
             patch.object(rollout, "pinned_read", return_value=bad_receipt), \
             self.assertRaises(rollout.GuardError) as error:
            operator.route_baseline()
        self.assertEqual(error.exception.stage, "replacement_receipt")
        operator.nginx.assert_not_called()

    def test_apply_migration_recovers_exact_post_state_after_receipt_failure(self) -> None:
        current = pins()
        operator = rollout.Operator(current, FakeSystem())
        for name in ("image", "current", "compose_inputs", "receipt", "nginx", "wake", "guard"):
            setattr(operator, name, Mock())
        operator.compose_inputs.return_value = ({"name": "baseline"}, {"name": "candidate"})
        post = {"database_sha256": current.database_sha256, "catalog_sha256": current.after_catalog_sha256}
        operator.database = Mock(side_effect=[rollout.GuardError("before_catalog"), post])
        with patch.object(rollout, "pinned_read", return_value=b"{}"), \
             patch.object(rollout, "load_probes", return_value=[]), \
             patch.object(rollout, "ensure_private_directory"), \
             patch.object(rollout, "atomic_write") as writer, \
             patch.object(rollout.os.path, "lexists", return_value=False):
            operator.apply_migration()
        self.assertEqual(operator.database.call_args_list, [
            call("inspect", expected_catalog=current.before_catalog_sha256),
            call("inspect", expected_catalog=current.after_catalog_sha256),
        ])
        writer.assert_called_once()

    def test_route_failure_restores_original_and_keeps_both_backends_running(self) -> None:
        current = pins(nginx__route="candidate")
        operator = rollout.Operator(current, FakeSystem())
        fragment = rollout.proxy_fragment(current.nginx_marker, port=rollout.CANDIDATE_PORT, build=current.candidate.build, candidate=True).rstrip(b"\n")
        original = b"server {\n" + fragment + b"\n}\n"
        operator.prepare = Mock()
        operator.nginx = Mock(return_value=original)
        operator.wake = Mock()
        operator.validate_replacement_receipt = Mock()
        operator.probes = []
        operator._restore_route = Mock()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            site = root / "site"
            site.write_bytes(original)
            object.__setattr__(operator.pins, "nginx_site", site)
            def write(path, content, **_metadata):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(content)

            with patch.object(rollout, "validate_runtime"), \
                 patch.object(rollout, "STATE_ROOT", root / "state"), \
                 patch.object(rollout, "ROUTE_SITE", root / "state" / "before"), \
                 patch.object(rollout, "ROUTE_RECEIPT", root / "state" / "receipt"), \
                 patch.object(rollout, "ensure_private_directory", side_effect=lambda path, **_kwargs: path.mkdir(parents=True, exist_ok=True)), \
                 patch.object(rollout, "atomic_write", side_effect=write), \
                 patch.object(rollout, "secure_read", side_effect=lambda path, **_kwargs: path.read_bytes()), \
                 patch.object(rollout, "run_probes", side_effect=rollout.GuardError("public_probe")), \
                 self.assertRaises(rollout.GuardError):
                operator.route_baseline()
        operator._restore_route.assert_called_once()
        self.assertFalse(any("stop" in command or "kill" in command for command in operator.system.commands))

    def test_atomic_write_handles_partial_writes_and_fsyncs(self) -> None:
        content = b"abcdefghijklmnopqrstuvwxyz"
        real_write, real_fsync = os.write, os.fsync
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
             patch.object(rollout.os, "write", side_effect=short_write), \
             patch.object(rollout.os, "fsync", side_effect=tracked_fsync), \
             patch.object(rollout.os, "fchown"):
            target = Path(directory) / "receipt"
            rollout.atomic_write(target, content, uid=os.getuid(), gid=os.getgid())
            self.assertEqual(target.read_bytes(), content)
        self.assertGreater(len(writes), 1)
        self.assertEqual(len(fsyncs), 2)

    def test_atomic_intent_publish_is_exclusive_and_fsyncs_file_and_directory(self) -> None:
        fsyncs: list[int] = []
        real_fsync = os.fsync

        def tracked_fsync(descriptor):
            fsyncs.append(descriptor)
            return real_fsync(descriptor)

        with tempfile.TemporaryDirectory() as directory, \
             patch.object(rollout.os, "fchown"), \
             patch.object(rollout.os, "fsync", side_effect=tracked_fsync):
            target = Path(directory) / "baseline-intent.json"
            rollout.atomic_write_exclusive(target, b"first", uid=os.getuid(), gid=os.getgid())
            with self.assertRaises(rollout.AtomicWriteError) as error:
                rollout.atomic_write_exclusive(target, b"second", uid=os.getuid(), gid=os.getgid())
            self.assertFalse(error.exception.committed)
            self.assertEqual(target.read_bytes(), b"first")
        self.assertGreaterEqual(len(fsyncs), 3)

    def test_cli_exposes_only_the_eight_reviewed_modes(self) -> None:
        modes = (
            "--prepare", "--apply-migration", "--replace-baseline", "--route-baseline",
            "--replace-candidate", "--route-candidate", "--rollback-route",
            "--rollback-baseline-disabled",
        )
        for mode in modes:
            with self.subTest(mode=mode):
                arguments = rollout.parse_args([mode, "--manifest", "/root/pins.json"])
                self.assertTrue(getattr(arguments, mode[2:].replace("-", "_")))


if __name__ == "__main__":
    unittest.main()
