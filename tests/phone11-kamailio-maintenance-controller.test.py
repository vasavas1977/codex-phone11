from __future__ import annotations

import io
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch
import uuid


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "phone11-kamailio-maintenance-controller.py"
CONFIG = ROOT / "infra" / "configs" / "kamailio" / "kamailio.cfg"
SPEC = importlib.util.spec_from_file_location("phone11_kamailio_maintenance", SCRIPT)
assert SPEC and SPEC.loader
controller = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(controller)


class Clock:
    def __init__(self, now: int = 2_000_000_000) -> None:
        self.now = now

    def __call__(self) -> int:
        return self.now


class FakeRpc:
    def __init__(self, clock: Clock) -> None:
        self.clock = clock
        self.value: str | None = None
        self.expires_at: int | None = None
        self.calls: list[tuple[str, list[object]]] = []
        self.fail_set_after_commit = False
        self.fail_delete = False
        self.competing_value: str | None = None
        self.replace_on_next_get = False

    def call(self, method: str, params: list[object]):
        self.calls.append((method, params))
        if method == "htable.get":
            if self.replace_on_next_get:
                self.value = self.competing_value
                self.replace_on_next_get = False
            if self.value is None:
                raise controller.RpcFault(500, "Key name doesn't exist in htable.")
            return {"item": {"name": controller.KEY, "value": self.value, "expire": "bounded"}}
        if method == "htable.setxs":
            self.value = str(params[2])
            self.expires_at = self.clock() + int(params[3])
            if self.fail_set_after_commit:
                self.replace_on_next_get = self.competing_value is not None
                raise controller.ControlError("rpc_timeout")
            return "Ok. Key set to new value."
        if method == "htable.delete":
            if self.fail_delete:
                raise controller.ControlError("rpc_unavailable")
            if self.value is None:
                raise controller.RpcFault(404, "Key not found in htable.")
            self.value = None
            self.expires_at = None
            return "Ok. Key deleted."
        raise AssertionError(method)


def gate_blocks(method: str, has_totag: bool, expires_at: int | None, now: int) -> bool:
    return method == "INVITE" and not has_totag and expires_at is not None and expires_at > now


class MaintenanceControllerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.evidence = Path(self.temp.name) / "evidence"
        self.evidence.mkdir(mode=0o700)
        self.clock = Clock()
        self.rpc = FakeRpc(self.clock)
        self.identity_value = {
            "config": {"path": "/etc/kamailio/kamailio.cfg", "sha256": "a" * 64},
            "process": {"pid": 19, "start_ticks": 123, "exe_sha256": "b" * 64},
            "fifo": {"path": "/var/run/kamailio/kamailio_rpc.fifo", "inode": 42},
            "controller": {"sha256": "c" * 64},
        }
        self.store = controller.RecordStore(self.evidence, expected_uid=os.geteuid())
        self.control = controller.Controller(self.rpc, self.store, lambda: dict(self.identity_value), self.clock)
        self.operation_id = str(uuid.uuid4())

    def tearDown(self) -> None:
        self.temp.cleanup()

    def activate(self, duration: int = 600):
        return self.control.activate(self.operation_id, duration)

    def test_activation_stays_active_until_exact_expiry_then_restores(self) -> None:
        result = self.activate()
        expected_expiry = (self.clock.now + 600) * 1000
        self.assertTrue(result["active"])
        self.assertEqual(result["expires_at_epoch_ms"], expected_expiry)
        activation = Path(result["activation_record"])
        self.assertEqual(stat.S_IMODE(activation.stat().st_mode), 0o600)
        record = json.loads(activation.read_text())
        self.assertEqual(record["restore_state"], {"present": False})
        self.assertEqual(record["state"]["value"], f"{expected_expiry // 1000}:{self.operation_id}")

        self.clock.now += 599
        status = self.control.status(self.operation_id, result["activation_sha256"])
        self.assertTrue(status["active"])
        self.assertFalse(any(method == "htable.delete" for method, _ in self.rpc.calls))

        self.clock.now += 1
        status = self.control.status(self.operation_id, result["activation_sha256"])
        self.assertFalse(status["active"])
        self.assertTrue(status["state_matches"])
        released = self.control.release(self.operation_id, result["activation_sha256"])
        self.assertFalse(released["active"])
        self.assertIsNone(self.rpc.value)
        self.assertFalse(json.loads(Path(released["release_record"]).read_text())["was_active"])

    def test_absolute_expiry_is_preserved_and_enforces_remaining_lifetime_bounds(self) -> None:
        with self.assertRaises(controller.ControlError) as below:
            self.control.activate(
                self.operation_id,
                expires_at_epoch_seconds=self.clock.now + controller.MIN_DURATION_SECONDS - 1,
            )
        self.assertEqual(below.exception.stage, "duration")
        with self.assertRaises(controller.ControlError) as above:
            self.control.activate(
                self.operation_id,
                expires_at_epoch_seconds=self.clock.now + controller.MAX_DURATION_SECONDS + 1,
            )
        self.assertEqual(above.exception.stage, "duration")

        requested_expiry = self.clock.now + controller.MIN_DURATION_SECONDS
        result = self.control.activate(
            self.operation_id,
            expires_at_epoch_seconds=requested_expiry,
        )
        self.assertEqual(result["expires_at_epoch_ms"], requested_expiry * 1000)
        self.assertEqual(self.rpc.value, f"{requested_expiry}:{self.operation_id}")
        self.assertEqual(self.rpc.calls[-2], (
            "htable.setxs",
            [controller.TABLE, controller.KEY, self.rpc.value, controller.MIN_DURATION_SECONDS],
        ))

    def test_activation_requires_exactly_one_relative_or_absolute_lifetime(self) -> None:
        with self.assertRaises(controller.ControlError) as neither:
            self.control.activate(self.operation_id)
        self.assertEqual(neither.exception.stage, "duration")
        with self.assertRaises(controller.ControlError) as both:
            self.control.activate(
                self.operation_id,
                600,
                expires_at_epoch_seconds=self.clock.now + 600,
            )
        self.assertEqual(both.exception.stage, "duration")

    def test_duplicate_activation_is_rejected_without_shortening_existing_gate(self) -> None:
        first = self.activate(900)
        expiry = self.rpc.value
        with self.assertRaises(controller.ControlError) as error:
            self.control.activate(str(uuid.uuid4()), 180)
        self.assertEqual(error.exception.stage, "already_active")
        self.assertEqual(self.rpc.value, expiry)
        self.assertTrue(self.control.status(self.operation_id, first["activation_sha256"])["active"])

    def test_explicit_release_before_expiry_records_exact_restore(self) -> None:
        active = self.activate()
        released = self.control.release(self.operation_id, active["activation_sha256"])
        record = json.loads(Path(released["release_record"]).read_text())
        self.assertTrue(record["was_active"])
        self.assertEqual(record["restored_state"], {"present": False})
        self.assertEqual(record["activation_sha256"], active["activation_sha256"])
        self.assertIsNone(self.rpc.value)

    def test_stale_receipt_cannot_claim_or_release_same_expiry_new_operation(self) -> None:
        first = self.activate()
        first_state = self.rpc.value
        self.control.release(self.operation_id, first["activation_sha256"])

        second_operation = str(uuid.uuid4())
        second = self.control.activate(second_operation, 600)
        second_state = self.rpc.value
        self.assertNotEqual(self.rpc.value, first_state)
        self.assertEqual(controller.state_expiry(str(self.rpc.value)), controller.state_expiry(str(first_state)))
        stale = self.control.status(self.operation_id, first["activation_sha256"])
        self.assertFalse(stale["active"])
        self.assertFalse(stale["state_matches"])
        with self.assertRaises(controller.ControlError) as error:
            self.control.release(self.operation_id, first["activation_sha256"])
        self.assertEqual(error.exception.stage, "state_drift")
        self.assertEqual(self.rpc.value, second_state)
        self.assertTrue(self.control.status(second_operation, second["activation_sha256"])["active"])

    def test_timeout_after_possible_set_restores_and_emits_no_evidence(self) -> None:
        self.rpc.fail_set_after_commit = True
        with self.assertRaises(controller.ControlError) as error:
            self.activate()
        self.assertEqual(error.exception.stage, "rpc_timeout")
        self.assertIsNone(self.rpc.value)
        self.assertFalse(self.store.path(self.operation_id, "activation").exists())

    def test_ambiguous_restore_fails_closed_without_false_activation_evidence(self) -> None:
        self.rpc.fail_set_after_commit = True
        self.rpc.fail_delete = True
        with self.assertRaises(controller.ControlError) as error:
            self.activate()
        self.assertEqual(error.exception.stage, "activation_restore_ambiguous")
        self.assertIsNotNone(self.rpc.value)
        self.assertFalse(self.store.path(self.operation_id, "activation").exists())

    def test_competing_writer_state_is_never_deleted_after_activation_timeout(self) -> None:
        competitor = str(uuid.uuid4())
        self.rpc.fail_set_after_commit = True
        self.rpc.competing_value = f"{self.clock.now + 900}:{competitor}"
        with self.assertRaises(controller.ControlError) as error:
            self.activate()
        self.assertEqual(error.exception.stage, "activation_restore_ambiguous")
        self.assertEqual(self.rpc.value, self.rpc.competing_value)
        self.assertFalse(any(method == "htable.delete" for method, _ in self.rpc.calls))

    def test_identity_drift_during_activation_restores_gate(self) -> None:
        calls = 0

        def identity():
            nonlocal calls
            calls += 1
            value = dict(self.identity_value)
            if calls > 1:
                value["process"] = {"pid": 20, "start_ticks": 999, "exe_sha256": "b" * 64}
            return value

        control = controller.Controller(self.rpc, self.store, identity, self.clock)
        with self.assertRaises(controller.ControlError) as error:
            control.activate(self.operation_id, 600)
        self.assertEqual(error.exception.stage, "identity_drift")
        self.assertIsNone(self.rpc.value)

    def test_evidence_write_failure_restores_gate_and_emits_no_record(self) -> None:
        with patch.object(self.store, "write", side_effect=OSError("injected")), \
             self.assertRaises(controller.ControlError) as error:
            self.activate()
        self.assertEqual(error.exception.stage, "activation")
        self.assertIsNone(self.rpc.value)
        self.assertFalse(self.store.path(self.operation_id, "activation").exists())

    def test_release_refuses_foreign_state_without_deleting_it(self) -> None:
        result = self.activate()
        self.rpc.value = f"{self.clock.now + 600}:{uuid.uuid4()}"
        with self.assertRaises(controller.ControlError) as error:
            self.control.release(self.operation_id, result["activation_sha256"])
        self.assertEqual(error.exception.stage, "state_drift")
        self.assertIsNotNone(self.rpc.value)

    def test_tampered_activation_record_cannot_authorize_status_or_release(self) -> None:
        result = self.activate()
        path = Path(result["activation_record"])
        path.write_bytes(path.read_bytes().replace(b'"duration_seconds":600', b'"duration_seconds":601'))
        with self.assertRaises(controller.ControlError) as error:
            self.control.status(self.operation_id, result["activation_sha256"])
        self.assertEqual(error.exception.stage, "activation_record")

    def test_route_rejects_every_new_invite_class_before_auth_or_routing(self) -> None:
        text = CONFIG.read_text()
        validated = controller.validate_config(CONFIG, controller.sha256_file(CONFIG))
        self.assertEqual(validated["path"], str(CONFIG))
        begin = text.index(controller.GATE_BEGIN)
        end = text.index(controller.GATE_END)
        gate = text[begin:end]
        self.assertEqual(text.count(controller.CONFIG_TABLE), 1)
        self.assertIn('is_method("INVITE") && !has_totag()', gate)
        self.assertIn(
            "$(sht(phone11_maintenance=>initial_invite_expires_at){s.select,0,:}{s.int}) > $Ts",
            gate,
        )
        self.assertIn('sl_send_reply("503", "Temporarily Unavailable")', gate)
        self.assertLess(text.index("# CANCEL processing"), begin)
        self.assertLess(end, text.index("# Handle INVITE", end))
        self.assertLess(end, text.index("route(AUTH);", end))

        targets = {
            "carrier_pstn": '^\\+?[0-9]{9,15}$',
            "registered_extension": '^[1-9][0-9]{3}$',
            "did": "route(DID_ROUTE);",
            "ring_group": '^\\*7[0-9]+$',
            "queue": '^\\*8[0-9]+$',
            "ivr": '^\\*9[0-9]+$',
            "conference": '^\\*85',
            "voicemail": '^\\*97$',
            "emergency": '^(191|199|1669)$',
        }
        for name, route_marker in targets.items():
            with self.subTest(name=name):
                self.assertIn(route_marker, text)
                self.assertTrue(gate_blocks("INVITE", False, self.clock.now + 600, self.clock.now))

    def test_default_expired_and_non_invite_paths_are_unchanged(self) -> None:
        self.assertFalse(gate_blocks("INVITE", False, None, self.clock.now))
        self.assertFalse(gate_blocks("INVITE", False, self.clock.now, self.clock.now))
        self.assertFalse(gate_blocks("INVITE", True, self.clock.now + 600, self.clock.now))
        for method in ("ACK", "BYE", "CANCEL", "REGISTER", "OPTIONS", "SUBSCRIBE", "PUBLISH", "MESSAGE"):
            with self.subTest(method=method):
                self.assertFalse(gate_blocks(method, False, self.clock.now + 600, self.clock.now))

    def test_main_wires_runtime_identity_into_controller_and_emits_activation(self) -> None:
        output = type("Output", (), {"buffer": io.BytesIO()})()
        errors = io.StringIO()
        process = {
            "pid": 1,
            "start_ticks": 123,
            "uid": os.geteuid(),
            "gid": os.getegid(),
            "exe_path": "/usr/sbin/kamailio",
            "exe_sha256": "b" * 64,
            "cmdline_sha256": "c" * 64,
        }
        fifo = {
            "path": "/var/run/kamailio/kamailio_rpc.fifo",
            "device": 1,
            "inode": 2,
            "uid": os.geteuid(),
            "gid": os.getegid(),
            "mode": 0o660,
        }
        config = {"path": str(CONFIG), "sha256": "a" * 64}
        with patch.object(controller.os, "geteuid", return_value=0), \
             patch.object(controller.time, "time", return_value=self.clock.now), \
             patch.object(controller, "validate_config", return_value=config), \
             patch.object(controller, "process_identity", return_value=process), \
             patch.object(controller, "fifo_identity", return_value=fifo), \
             patch.object(controller, "sha256_file", return_value="d" * 64), \
             patch.object(controller, "FifoRpc", return_value=self.rpc), \
             patch.object(controller, "RecordStore", return_value=self.store), \
             patch.object(controller.sys, "stdout", output), \
             patch.object(controller.sys, "stderr", errors):
            result = controller.main([
                "activate",
                "--operation-id", self.operation_id,
                "--config", str(CONFIG),
                "--expected-config-sha256", "a" * 64,
                "--pid", "1",
                "--expected-process-exe-sha256", "b" * 64,
                "--evidence-dir", str(self.evidence),
            ])
        self.assertEqual(result, 0, errors.getvalue())
        value = json.loads(output.buffer.getvalue())
        self.assertTrue(value["active"])
        self.assertEqual(value["operation_id"], self.operation_id)
        self.assertEqual(value["expires_at_epoch_ms"], (self.clock.now + 600) * 1000)

    def test_main_accepts_absolute_expiry_without_recomputing_it(self) -> None:
        output = type("Output", (), {"buffer": io.BytesIO()})()
        errors = io.StringIO()
        process = {
            "pid": 1,
            "start_ticks": 123,
            "uid": os.geteuid(),
            "gid": os.getegid(),
            "exe_path": "/usr/sbin/kamailio",
            "exe_sha256": "b" * 64,
            "cmdline_sha256": "c" * 64,
        }
        fifo = {
            "path": "/var/run/kamailio/kamailio_rpc.fifo",
            "device": 1,
            "inode": 2,
            "uid": os.geteuid(),
            "gid": os.getegid(),
            "mode": 0o660,
        }
        config = {"path": str(CONFIG), "sha256": "a" * 64}
        requested_expiry = self.clock.now + controller.MIN_DURATION_SECONDS
        with patch.object(controller.os, "geteuid", return_value=0), \
             patch.object(controller.time, "time", return_value=self.clock.now), \
             patch.object(controller, "validate_config", return_value=config), \
             patch.object(controller, "process_identity", return_value=process), \
             patch.object(controller, "fifo_identity", return_value=fifo), \
             patch.object(controller, "sha256_file", return_value="d" * 64), \
             patch.object(controller, "FifoRpc", return_value=self.rpc), \
             patch.object(controller, "RecordStore", return_value=self.store), \
             patch.object(controller.sys, "stdout", output), \
             patch.object(controller.sys, "stderr", errors):
            result = controller.main([
                "activate",
                "--operation-id", self.operation_id,
                "--expires-at-epoch-seconds", str(requested_expiry),
                "--config", str(CONFIG),
                "--expected-config-sha256", "a" * 64,
                "--pid", "1",
                "--expected-process-exe-sha256", "b" * 64,
                "--evidence-dir", str(self.evidence),
            ])
        self.assertEqual(result, 0, errors.getvalue())
        value = json.loads(output.buffer.getvalue())
        self.assertEqual(value["expires_at_epoch_ms"], requested_expiry * 1000)

    def test_cli_rejects_relative_and_absolute_lifetime_together(self) -> None:
        with patch.object(controller.sys, "stderr", io.StringIO()), self.assertRaises(SystemExit):
            controller.parser().parse_args([
                "activate",
                "--operation-id", self.operation_id,
                "--duration-seconds", "600",
                "--expires-at-epoch-seconds", str(self.clock.now + 600),
                "--config", str(CONFIG),
                "--expected-config-sha256", "a" * 64,
                "--pid", "1",
                "--expected-process-exe-sha256", "b" * 64,
                "--evidence-dir", str(self.evidence),
            ])


if __name__ == "__main__":
    unittest.main()
