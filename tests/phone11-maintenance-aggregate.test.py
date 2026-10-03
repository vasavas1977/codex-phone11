#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


edge = load("phone11_edge_maintenance", ROOT / "scripts/phone11-edge-maintenance-controller.py")
guard = load("phone11_profile_dnd_guard", ROOT / "scripts/phone11-profile-dnd-guard.py")

OPERATION = "11111111-1111-4111-8111-111111111111"
GENERATION = "22222222-2222-4222-8222-222222222222"
SHA = "a" * 64
ORIGINAL = b"""server {
    listen 443 ssl http2;
    server_name api.phone11.ai;

    location / {
        proxy_pass http://43.210.122.111;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection upgrade;
        proxy_set_header Host api.phone11.ai;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
"""


class FakeEdgeSystem:
    def __init__(self, site: Path):
        self.site = site
        self.workers = [101]
        self.reloads = 0
        self.fail_probe = False
        self.fail_release_probe_once = False
        self.foreign_on_test = False
        self.linger_workers = False
        self.newest_worker = self.workers[0]
        self.requests = []

    def command(self, args, timeout=20):
        if args[-1] == "-T":
            return b"active-dump" if edge.BEGIN.encode() in self.site.read_bytes() else b"original-dump"
        if args[-1] == "-t":
            if self.foreign_on_test and edge.BEGIN.encode() in self.site.read_bytes():
                self.site.write_bytes(b"foreign\n")
                raise edge.ControlError("command")
            return b""
        if args[-2:] == ["-s", "reload"]:
            self.reloads += 1
            self.newest_worker = 101 + self.reloads
            self.workers = self.workers + [self.newest_worker] if self.linger_workers else [self.newest_worker]
            return b""
        raise AssertionError(args)

    def request(self, method, path):
        raw = self.site.read_text()
        self.requests.append((method, path))
        if self.fail_probe and edge.BEGIN in raw:
            raise edge.ControlError("https_probe")
        if edge.BEGIN not in raw and self.fail_release_probe_once:
            self.fail_release_probe_once = False
            return 503, {edge.FENCE_HEADER: "stale"}
        trpc_post = method == "POST" and (path == "/api/trpc" or path.startswith("/api/trpc/"))
        upload_post = method == "POST" and path == "/api/chat/media/upload"
        photo_upload_post = method == "POST" and re.fullmatch(r"/api/profile/photo/?", path, re.IGNORECASE)
        photo_delete = method == "DELETE" and re.fullmatch(r"/api/profile/photo/[^/]+/?", path, re.IGNORECASE)
        if not (trpc_post or upload_post or photo_upload_post or photo_delete) or edge.BEGIN not in raw:
            return 404, {}
        begin = re.search(r"PHONE11_PROFILE_DND_EDGE_GATE_BEGIN ([^ ]+) ([0-9]+) ([^\n]+)", raw)
        contract = re.search(r"X-Phone11-Maintenance-Config \"([0-9a-f]{64})\"", raw)
        assert begin and contract
        return 503, {
            edge.FENCE_HEADER: f"{begin.group(1)}:{begin.group(2)}:{begin.group(3)}",
            edge.CONFIG_HEADER: contract.group(1),
            edge.WORKER_HEADER: str(self.workers[0]),
        }

    def drain_workers(self):
        self.workers = [self.newest_worker]


class TestEdgeController(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.site = self.root / "phone11ai"
        self.site.write_bytes(ORIGINAL); self.site.chmod(0o644)
        self.evidence = self.root / "evidence"; self.evidence.mkdir(mode=0o700)
        self.lock = self.root / "edge.lock"
        self.system = FakeEdgeSystem(self.site)
        self.controller_id = {"path": "/controller", "sha256": SHA,
                              "interpreter_path": "/python", "interpreter_sha256": "b" * 64}
        self.store = edge.RecordStore(self.evidence, self.lock, expected_uid=os.getuid())

        class TestController(edge.Controller):
            def _identity(inner):
                raw = self.site.read_bytes()
                return {"site_path": str(self.site), "site_sha256": edge.sha256_bytes(raw),
                        "nginx_dump_sha256": edge.sha256_bytes(self.system.command(["nginx", "-T"])),
                        "process": {"pid": 10, "start_ticks": 20, "exe_path": "/nginx",
                                    "exe_sha256": "c" * 64, "worker_pids": list(self.system.workers)},
                        "controller": self.controller_id}

        self.controller = TestController(self.system, self.store, site=self.site, nginx=Path("/nginx"),
            pid_file=self.root / "pid", expected_nginx_exe_sha256="c" * 64,
            expected_original_sha256=edge.sha256_bytes(ORIGINAL),
            expected_original_dump_sha256=edge.sha256_bytes(b"original-dump"),
            controller_identity=self.controller_id, clock=lambda: 1_700_000_000_000,
            sleeper=lambda _seconds: self.system.drain_workers())

    def tearDown(self): self.temp.cleanup()

    def test_renderer_covers_mutation_routes_and_preserves_photo_reads(self):
        active = edge.render_active_site(ORIGINAL, operation_id=OPERATION,
            expires_at_epoch_ms=1_700_000_600_000, generation_id=GENERATION, contract_sha256=SHA)
        text = active.decode()
        self.assertEqual(text.count("if ($request_method = POST)"), 4)
        self.assertEqual(text.count("if ($request_method = DELETE)"), 1)
        self.assertEqual(text.count("return 503;"), 5)
        self.assertEqual(text.count("location = /api/trpc {"), 1)
        self.assertEqual(text.count("location ^~ /api/trpc/ {"), 1)
        self.assertEqual(text.count("location = /api/chat/media/upload {"), 1)
        self.assertEqual(text.count("location ~* ^/api/profile/photo/?$ {"), 1)
        self.assertEqual(text.count("location ~* ^/api/profile/photo/[^/]+/?$ {"), 1)
        self.assertEqual(text.count("location / {"), 1)
        self.assertEqual(text.count("proxy_pass http://43.210.122.111;"), 6)
        self.assertNotIn("/api/phone11/wake", text)

    def test_active_probe_covers_photo_mutations_batch_path_and_method_bypasses(self):
        self.controller.activate(OPERATION, GENERATION, 600)
        expected = {
            ("POST", "/api/trpc/a,b"),
            ("POST", "/api/profile/photo"),
            ("POST", "/api/profile/photo/"),
            ("POST", "/API/PROFILE/PHOTO"),
            ("POST", "/API/PROFILE/PHOTO/"),
            ("DELETE", "/api/profile/photo/10"),
            ("DELETE", "/API/PROFILE/PHOTO/10/"),
            ("DELETE", "/api/profile/photo/+10"),
            ("DELETE", "/api/profile/photo/10/"),
            ("GET", "/api/profile/photo/10/20?v=11111111-1111-4111-8111-111111111111"),
            ("GET", "/API/PROFILE/PHOTO/10/20?v=11111111-1111-4111-8111-111111111111"),
            ("POST", "/api/profile/photo/10"),
            ("POST", "/api/profile/photo/10/"),
            ("DELETE", "/api/profile/photo"),
        }
        self.assertTrue(expected.issubset(set(self.system.requests)))

    def test_process_start_parser_handles_parenthesized_names_with_spaces(self):
        tail = ["S"] + [str(field) for field in range(4, 23)]
        self.assertEqual(edge._proc_start_ticks(f"42 (nginx: worker (old)) {' '.join(tail)}"), 22)

    def test_activate_status_and_release_exact_owned_generation(self):
        activated = self.controller.activate(OPERATION, GENERATION, 600)
        self.assertTrue(activated["active"])
        self.assertEqual(activated["expires_at_epoch_ms"], 1_700_000_600_000)
        self.assertEqual(activated["worker_pids"], [102])
        self.assertTrue(self.controller.status(OPERATION, GENERATION, activated["activation_sha256"])["active"])
        released = self.controller.release(OPERATION, GENERATION, activated["activation_sha256"])
        self.assertFalse(released["active"])
        self.assertEqual(self.site.read_bytes(), ORIGINAL)
        self.assertEqual(self.system.reloads, 2)

    def test_failed_probe_restores_exact_original(self):
        self.system.fail_probe = True
        with self.assertRaisesRegex(edge.ControlError, "https_probe"):
            self.controller.activate(OPERATION, GENERATION, 600)
        self.assertEqual(self.site.read_bytes(), ORIGINAL)
        self.assertEqual(self.system.reloads, 2)

    def test_failed_activation_never_overwrites_competing_writer(self):
        self.system.foreign_on_test = True
        with self.assertRaisesRegex(edge.ControlError, "activation_restore_ambiguous"):
            self.controller.activate(OPERATION, GENERATION, 600)
        self.assertEqual(self.site.read_bytes(), b"foreign\n")

    def test_status_rejects_reloaded_worker_generation(self):
        activated = self.controller.activate(OPERATION, GENERATION, 600)
        self.system.workers = [999]
        with self.assertRaisesRegex(edge.ControlError, "identity_drift"):
            self.controller.status(OPERATION, GENERATION, activated["activation_sha256"])

    def test_release_failure_restores_gate_and_wrong_generation_cannot_release(self):
        activated = self.controller.activate(OPERATION, GENERATION, 600)
        with self.assertRaisesRegex(edge.ControlError, "generation_id"):
            self.controller.release(OPERATION, "33333333-3333-4333-8333-333333333333", activated["activation_sha256"])
        self.system.fail_release_probe_once = True
        with self.assertRaisesRegex(edge.ControlError, "release_failed"):
            self.controller.release(OPERATION, GENERATION, activated["activation_sha256"])
        self.assertIn(edge.BEGIN.encode(), self.site.read_bytes())

    def test_release_and_failed_release_restore_drain_exact_predecessor_workers(self):
        activated = self.controller.activate(OPERATION, GENERATION, 600)
        self.system.linger_workers = True
        released = self.controller.release(OPERATION, GENERATION, activated["activation_sha256"])
        self.assertFalse(released["active"])
        self.assertEqual(self.system.workers, [103])

        # A separate operation exercises the failed-release restoration path.
        other = "44444444-4444-4444-8444-444444444444"
        generation = "55555555-5555-4555-8555-555555555555"
        activated = self.controller.activate(other, generation, 600)
        self.system.fail_release_probe_once = True
        with self.assertRaisesRegex(edge.ControlError, "release_failed"):
            self.controller.release(other, generation, activated["activation_sha256"])
        self.assertIn(edge.BEGIN.encode(), self.site.read_bytes())
        self.assertEqual(self.system.workers, [106])

    def test_release_receipt_failure_restores_gate_and_retry_reconciles(self):
        activated = self.controller.activate(OPERATION, GENERATION, 600)
        original_write = self.store.write
        failed = False

        def fail_release_once(operation_id, kind, raw):
            nonlocal failed
            if kind == "release" and not failed:
                failed = True
                raise OSError("receipt unavailable")
            return original_write(operation_id, kind, raw)

        self.store.write = fail_release_once
        with self.assertRaisesRegex(edge.ControlError, "release_failed"):
            self.controller.release(OPERATION, GENERATION, activated["activation_sha256"])
        self.assertIn(edge.BEGIN.encode(), self.site.read_bytes())
        released = self.controller.release(OPERATION, GENERATION, activated["activation_sha256"])
        self.assertFalse(released["active"])
        self.assertEqual(self.site.read_bytes(), ORIGINAL)

    def test_crash_after_gate_removal_is_reconciled_from_durable_release_intent(self):
        activated = self.controller.activate(OPERATION, GENERATION, 600)
        original_write = self.store.write
        crashed = False

        def crash_before_receipt(operation_id, kind, raw):
            nonlocal crashed
            if kind == "release" and not crashed:
                crashed = True
                raise KeyboardInterrupt()
            return original_write(operation_id, kind, raw)

        self.store.write = crash_before_receipt
        with self.assertRaises(KeyboardInterrupt):
            self.controller.release(OPERATION, GENERATION, activated["activation_sha256"])
        self.assertEqual(self.site.read_bytes(), ORIGINAL)
        released = self.controller.release(OPERATION, GENERATION, activated["activation_sha256"])
        self.assertFalse(released["active"])

    def test_status_never_claims_active_after_expiry(self):
        activated = self.controller.activate(OPERATION, GENERATION, 600)
        self.controller.clock = lambda: activated["expires_at_epoch_ms"]
        self.assertFalse(self.controller.status(OPERATION, GENERATION, activated["activation_sha256"])["active"])


class FakeEdgeProof:
    def __init__(self): self.calls = 0; self.fail = False
    def verify(self, _edge):
        self.calls += 1
        if self.fail: raise guard.GuardError("edge_https")


class FakeRunner:
    def __init__(self, plan, now):
        self.plan, self.now = plan, now
        self.calls = []
        self.snapshots = []
        self.sip_active = False

    def snapshot(self, **changes):
        value = {"schema": guard.SNAPSHOT_SCHEMA, "sampled_at_epoch_ms": self.now,
                 **{key: 0 for key in guard.COVERAGE}, "attempted_notifications": 4,
                 "new_attempted_notifications": 0, "failed_notifications": 0,
                 "pending_notifications": 0, "wake_ready": True, "notifications_ready": True}
        value.update(changes); return value

    def json_command(self, args, timeout=10):
        self.calls.append(list(args))
        if args[0] == self.plan["snapshot"]["program"]:
            return self.snapshots.pop(0) if self.snapshots else self.snapshot()
        action = args[1]
        if action == "activate":
            self.sip_active = True
            return {"schema": "phone11-kamailio-invite-maintenance/v1", "action": "activate",
                    "active": True, "operation_id": OPERATION,
                    "expires_at_epoch_ms": self.plan["expires_at_epoch_ms"],
                    "activation_record": "/evidence/sip.json", "activation_sha256": "d" * 64}
        if action == "status":
            return {"schema": "phone11-kamailio-invite-maintenance/v1", "action": "status",
                    "active": self.sip_active, "operation_id": OPERATION,
                    "expires_at_epoch_ms": self.plan["expires_at_epoch_ms"],
                    "activation_sha256": "d" * 64, "state_matches": self.sip_active}
        if action == "release":
            self.sip_active = False
            record = {"schema": "phone11-kamailio-invite-maintenance/v1", "kind": "release",
                      "operation_id": OPERATION, "released_at_epoch_ms": self.now,
                      "activation_sha256": "d" * 64, "was_active": True,
                      "identity": {}, "restored_state": {"present": False}}
            raw = guard.canonical_bytes(record)
            path = Path(self.plan["sip"]["evidence_dir"]) / f"{OPERATION}.release.json"
            if not path.exists():
                path.write_bytes(raw); path.chmod(0o600)
            return {"schema": "phone11-kamailio-invite-maintenance/v1", "action": "release",
                    "active": False, "operation_id": OPERATION, "activation_sha256": "d" * 64,
                    "release_record": str(path), "release_sha256": guard.sha256_bytes(raw)}
        raise AssertionError(args)


class TestAggregateGuard(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
        self.evidence = self.root / "evidence"; self.evidence.mkdir(mode=0o700)
        self.sip_evidence = self.root / "sip-evidence"; self.sip_evidence.mkdir(mode=0o700)
        self.sip = self.root / "sip"; self.sip.write_bytes(b"sip"); self.sip.chmod(0o700)
        self.snapshot_program = self.root / "snapshot"; self.snapshot_program.write_bytes(b"snapshot"); self.snapshot_program.chmod(0o700)
        self.now = 1_700_000_000_000
        self.plan = {
            "schema": guard.PLAN_SCHEMA, "fence_id": OPERATION,
            "expires_at_epoch_ms": self.now + 600_000,
            "edge": {"origin": "https://api.phone11.ai", "operation_id": OPERATION,
                "generation_id": GENERATION, "expires_at_epoch_ms": self.now + 600_000,
                "contract_sha256": "1" * 64, "active_site_sha256": "2" * 64,
                "activation_sha256": "3" * 64, "controller_sha256": "4" * 64,
                "original_site_sha256": "7" * 64, "nginx_exe_sha256": "8" * 64,
                "worker_pids": [101, 102]},
            "sip": {"program": str(self.sip), "sha256": guard.sha256_bytes(b"sip"),
                "config": "/etc/kamailio/kamailio.cfg", "config_sha256": "5" * 64,
                "pid": 42, "process_exe_sha256": "6" * 64,
                "fifo": "/run/kamailio/rpc", "reply_dir": "/run/kamailio",
                "evidence_dir": str(self.sip_evidence)},
            "snapshot": {"program": str(self.snapshot_program), "sha256": guard.sha256_bytes(b"snapshot")},
            "stability_seconds": 15, "evidence_dir": str(self.evidence),
        }
        self.plan["edge"]["contract_sha256"] = guard.edge_contract_digest(self.plan["edge"])
        self.plan_sha = guard.sha256_bytes(guard.canonical_bytes(self.plan))
        self.runner = FakeRunner(self.plan, self.now); self.edge = FakeEdgeProof(); self.sleeps = []
        self.store = guard.RecordStore(self.evidence, self.root / "guard.lock", expected_uid=os.getuid())
        self.controller = guard.GuardController(self.plan, self.plan_sha, self.runner, self.edge,
            self.store, clock=lambda: self.now, sleeper=self.sleeps.append)

    def tearDown(self): self.temp.cleanup()

    def test_plan_contract_is_exact_and_shared_expiry(self):
        parsed = guard.parse_plan(guard.canonical_bytes(self.plan))
        self.assertEqual(parsed["edge"]["operation_id"], parsed["fence_id"])
        changed = json.loads(json.dumps(self.plan)); changed["edge"]["expires_at_epoch_ms"] += 1000
        with self.assertRaisesRegex(guard.GuardError, "plan"):
            guard.parse_plan(guard.canonical_bytes(changed))

    def test_prepare_is_read_only_and_reports_inactive(self):
        value = self.controller.phase("prepare", None)
        self.assertFalse(value["admission_fence_active"])
        self.assertEqual(self.edge.calls, 0)
        self.assertFalse(self.runner.sip_active)

    def test_uncommissioned_provider_fence_blocks_before_edge_sip_or_evidence(self):
        with self.assertRaisesRegex(guard.GuardError, "provider_fence_uncommissioned"):
            self.controller.phase("replace-baseline-before", None)
        self.assertEqual(self.edge.calls, 0)
        self.assertEqual(self.runner.calls, [])
        self.assertFalse(self.runner.sip_active)
        self.assertEqual(self.sleeps, [])
        self.assertFalse(self.store.path(OPERATION, "activation").exists())
        self.assertFalse(self.store.path(OPERATION, "ready").exists())
        self.assertFalse((self.root / "guard.lock").exists())

    def test_sip_activation_uses_the_exact_shared_expiry_at_minimum_boundary(self):
        self.now = self.plan["expires_at_epoch_ms"] - 180_000
        command = self.controller._sip_command("activate")
        self.assertNotIn("--duration-seconds", command)
        position = command.index("--expires-at-epoch-seconds")
        self.assertEqual(
            command[position + 1],
            str(self.plan["expires_at_epoch_ms"] // 1000),
        )

    def test_provider_blocker_precedes_edge_failure_and_expiry(self):
        self.edge.fail = True
        self.now = self.plan["expires_at_epoch_ms"]
        self.sip.chmod(0o600)
        with self.assertRaisesRegex(guard.GuardError, "provider_fence_uncommissioned"):
            self.controller.phase("replace-baseline-before", None)
        self.assertEqual(self.edge.calls, 0)
        self.assertFalse(self.runner.sip_active)

    def test_recovery_release_keeps_edge_active_for_separate_owner_step(self):
        sip = self.controller.activate_sip()
        self.store.write(OPERATION, "activation", {
            "schema": guard.RECORD_SCHEMA,
            "kind": "activation",
            "fence_id": OPERATION,
            "plan_sha256": self.plan_sha,
            "expires_at_epoch_ms": self.plan["expires_at_epoch_ms"],
            "edge_activation_sha256": self.plan["edge"]["activation_sha256"],
            "sip_activation_sha256": sip["activation_sha256"],
            "created_at_epoch_ms": self.now,
        })
        result = self.controller.release_local_sip()
        self.assertFalse(result["active"])
        self.assertTrue(result["edge_still_active"])
        self.assertFalse(self.runner.sip_active)

    def test_local_sip_release_receipt_failure_reconciles_without_second_release(self):
        sip = self.controller.activate_sip()
        self.store.write(OPERATION, "activation", {
            "schema": guard.RECORD_SCHEMA, "kind": "activation", "fence_id": OPERATION,
            "plan_sha256": self.plan_sha, "expires_at_epoch_ms": self.plan["expires_at_epoch_ms"],
            "edge_activation_sha256": self.plan["edge"]["activation_sha256"],
            "sip_activation_sha256": sip["activation_sha256"], "created_at_epoch_ms": self.now,
        })
        original_write = self.store.write
        failed = False

        def fail_aggregate_release_once(operation_id, kind, value):
            nonlocal failed
            if kind == "release" and not failed:
                failed = True
                raise OSError("aggregate receipt unavailable")
            return original_write(operation_id, kind, value)

        self.store.write = fail_aggregate_release_once
        with self.assertRaises(OSError):
            self.controller.release_local_sip()
        release_calls = [call for call in self.runner.calls if call[1] == "release"]
        self.assertEqual(len(release_calls), 1)
        result = self.controller.release_local_sip()
        self.assertFalse(result["active"])
        release_calls = [call for call in self.runner.calls if call[1] == "release"]
        self.assertEqual(len(release_calls), 1)


if __name__ == "__main__":
    unittest.main()
