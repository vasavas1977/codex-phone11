from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("phone11_profile_photo_route", ROOT / "scripts/phone11-profile-photo-route.py")
assert SPEC and SPEC.loader
route = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(route)

OPERATION = "11111111-1111-4111-8111-111111111111"
BUILD = "channel-meetings-9aab162"
CONTAINER_ID = "a" * 64
IMAGE = "sha256:" + "b" * 64
SITE = b"""server {
    listen 80;
    server_name phone11.ai 1toall.phone11.ai api.phone11.ai;
    location = /api/trpc {
        proxy_pass http://127.0.0.1:3006;
        add_header X-Phone11-Api-Candidate channel-meetings-9aab162 always;
    }
    location ^~ /api/trpc/ {
        proxy_pass http://127.0.0.1:3006;
        add_header X-Phone11-Api-Candidate channel-meetings-9aab162 always;
    }
    # PHONE11_PARALLEL_API_INSERT read-receipts-a0f5c46-0c3c4e227148
    location = /api/auth/sign-in/email { proxy_pass http://127.0.0.1:3004; }
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
"""


class FakeSystem:
    def __init__(self, site: Path):
        self.site = site
        self.workers = [100]
        self.reloads = 0
        self.fail_config_once = False
        self.fail_reload_once = False
        self.fail_probe_once = False
        self.fail_release_probe_once = False
        self.fail_marked_502_once = False
        self.fail_baseline_502_once = False
        self.requests = []
        self.container_id = CONTAINER_ID
        self.linger_polls = 0
        self.master_pid = 9
        self.master_start_ticks = 12
        self.served_active = False
        self.legacy_baseline_health = False

    def container(self, name):
        assert name == "cp11-api-candidate-channel"
        return self.container_id, IMAGE, "true", "healthy"

    def command(self, args):
        if args[-1] == "-T":
            raw = self.site.read_bytes()
            return (b"dump-active\n" if route.BEGIN.encode() in raw else b"dump-original\n") + raw
        if args[-1] == "-t":
            if self.fail_config_once:
                self.fail_config_once = False
                raise route.edge.ControlError("command")
            return b""
        if args[-2:] == ["-s", "reload"]:
            if self.fail_reload_once:
                self.fail_reload_once = False
                raise route.edge.ControlError("command")
            self.reloads += 1
            self.workers = [100 + self.reloads]
            self.served_active = route.BEGIN.encode() in self.site.read_bytes()
            return b""
        raise AssertionError(args)

    def probe(self, port, path):
        assert port == 3006
        if path == "/api/health":
            return 200, {}, json.dumps({"ok": True, "build": BUILD, "runtimeRole": "api-candidate"}).encode()
        return 401, {}, b'{"error":"Sign in to access profile photos"}'

    def public_probe(self, method, path):
        self.requests.append((method, path))
        if self.fail_probe_once and route.BEGIN.encode() in self.site.read_bytes():
            self.fail_probe_once = False
            raise route.edge.ControlError("route_probe")
        active = self.served_active
        if self.fail_release_probe_once and not active:
            self.fail_release_probe_once = False
            return 503, {route.MARKER: "stale"}, b"failure"
        selected = active and route.route_kind(method, path) == "candidate"
        if self.fail_marked_502_once and selected:
            self.fail_marked_502_once = False
            return 502, {route.MARKER: BUILD}, b"bad gateway"
        if self.fail_baseline_502_once and not active:
            self.fail_baseline_502_once = False
            return 502, {}, b"bad gateway"
        if path == "/api/health":
            if self.legacy_baseline_health:
                return 200, {}, b'{"ok":true,"build":"team-chat-media-d41fc504","service":"phone11-backend"}'
            return 200, {}, b'{"ok":true,"runtimeRole":"default"}'
        if selected:
            return 401, {route.MARKER: BUILD}, b'{"error":"Sign in to access profile photos"}'
        return 404, {}, b"not found"

    def authenticated_get(self, path, headers):
        assert path.startswith("/api/trpc/profile.photoCapability?input=")
        assert headers["Authorization"] == "Bearer test-credential"
        return 200, b'{"result":{"data":{"json":{"available":false}}}}'


class PhotoRouteTests(unittest.TestCase):
    def test_render_preserves_existing_routes_and_only_photo_methods_switch(self):
        active = route.render(SITE, operation_id=OPERATION, build=BUILD, port=3006)
        text = active.decode()
        self.assertEqual(text.count("location ~* ^/api/profile/photo/"), 3)
        self.assertEqual(text.count("location ~* ^/api/profile/photo/?$"), 1)
        self.assertEqual(text.count("set $phone11_photo_target http://127.0.0.1:3006;"), 3)
        self.assertEqual(text.count("set $phone11_photo_target http://127.0.0.1:3000;"), 3)
        self.assertEqual(text.count("add_header X-Phone11-Photo-Candidate"), 3)
        self.assertEqual(text.count("location = /api/trpc"), 1)
        self.assertEqual(text.count("location ^~ /api/trpc/"), 1)
        self.assertIn("# PHONE11_PARALLEL_API_INSERT read-receipts-a0f5c46-0c3c4e227148", text)
        self.assertIn("location = /api/auth/sign-in/email { proxy_pass http://127.0.0.1:3004; }", text)
        self.assertEqual(route.route_kind("POST", "/api/profile/photo"), "candidate")
        self.assertEqual(route.route_kind("POST", "/API/PROFILE/PHOTO/"), "candidate")
        self.assertEqual(route.route_kind("GET", "/api/profile/photo/1/2?v=abc"), "candidate")
        self.assertEqual(route.route_kind("DELETE", "/api/profile/photo/+1/"), "candidate")
        for method, path in (("GET", "/api/profile/photo"), ("POST", "/api/profile/photo/1"),
                             ("GET", "/api/trpc/profile.photoCapability"),
                             ("POST", "/api/trpc/profile.photoCapability,chat.list?batch=1"),
                             ("GET", "/api/health"), ("DELETE", "/api/profile/photo/1/2")):
            self.assertEqual(route.route_kind(method, path), "baseline")

    def test_renderer_rejects_conflicting_photo_location(self):
        conflicted = SITE.replace(b"    location / {", b"    location ^~ /api/profile/photo { return 200; }\n    location / {")
        with self.assertRaises(route.edge.ControlError):
            route.render(conflicted, operation_id=OPERATION, build=BUILD, port=3006)

    def test_preflight_requires_fresh_complete_assertions(self):
        proof = self.proof()
        route.validate_preflight(proof, build=BUILD, port=3006,
                                 container_id=CONTAINER_ID, image=IMAGE, now_ms=1_700_000_000_000)
        for key in ("schema_absent", "private_storage_ready", "cleanup_worker_ready",
                    "candidate_auth_ready"):
            changed = dict(proof, **{key: False})
            with self.assertRaises(route.edge.ControlError):
                route.validate_preflight(changed, build=BUILD, port=3006,
                                         container_id=CONTAINER_ID, image=IMAGE, now_ms=1_700_000_000_000)
        with self.assertRaises(route.edge.ControlError):
            route.validate_preflight(proof, build=BUILD, port=3006,
                                     container_id=CONTAINER_ID, image=IMAGE, now_ms=1_700_000_400_000)

    @staticmethod
    def proof():
        return {"schema": route.PREFLIGHT_SCHEMA, "checked_at_epoch_ms": 1_700_000_000_000,
                "candidate_build": BUILD, "candidate_port": 3006,
                "candidate_container_id": CONTAINER_ID, "candidate_image": IMAGE,
                "schema_absent": True, "private_storage_ready": True,
                "cleanup_worker_ready": True, "candidate_auth_ready": True,
                }


class PhotoRouteControllerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.site = self.root / "phone11ai"
        self.site.write_bytes(SITE)
        self.site.chmod(0o644)
        self.evidence = self.root / "evidence"
        self.evidence.mkdir(mode=0o700)
        self.preflight = self.root / "preflight.json"
        self.preflight.write_bytes(route.canonical(PhotoRouteTests.proof()))
        self.preflight.chmod(0o600)
        self.probes = self.root / "probes.json"
        self.probes.write_bytes(route.canonical({"schema": "phone11-parallel-api-probes/v1",
            "probes": [{"label": "existing_phone", "method": "GET",
                        "headers": {"Authorization": "Bearer test-credential"}}]}))
        self.probes.chmod(0o600)
        self.system = FakeSystem(self.site)
        self.old_identity = route.edge.process_identity
        self.old_lock = route.LOCK
        route.LOCK = self.root / "operator.lock"
        route.edge.process_identity = lambda *_args: {
            "pid": self.system.master_pid, "start_ticks": self.system.master_start_ticks,
            "worker_pids": self.worker_pids()}
        self.addCleanup(self.restore)
        self.controller = route.Controller(self.system, site=self.site, nginx=Path("/nginx"),
            pid_file=self.root / "pid", evidence_dir=self.evidence,
            expected_site_sha=route.digest(SITE), expected_dump_sha=route.digest(b"dump-original\n" + SITE),
            expected_exe_sha="a" * 64, candidate_build=BUILD, candidate_port=3006,
            candidate_name="cp11-api-candidate-channel", candidate_id=CONTAINER_ID,
            candidate_image=IMAGE,
            preflight=self.preflight, probes_file=self.probes,
            expected_probes_sha=route.digest(self.probes.read_bytes()), tenant_id=1,
            clock=lambda: 1_700_000_000_000, sleeper=lambda _seconds: None)

    def worker_pids(self):
        if self.system.reloads and self.system.linger_polls > 0:
            self.system.linger_polls -= 1
            return [100, *self.system.workers]
        return list(self.system.workers)

    def restore(self):
        route.edge.process_identity = self.old_identity
        route.LOCK = self.old_lock

    def leave_active_without_activation_record(self):
        original_record = self.controller._record

        def interrupted(operation_id, name, raw):
            if name == "activation.json":
                raise SystemExit("simulated power loss before activation evidence")
            return original_record(operation_id, name, raw)

        self.controller._record = interrupted
        with self.assertRaises(SystemExit):
            self.controller.activate(OPERATION)
        self.controller._record = original_record
        self.assertIn(route.BEGIN.encode(), self.site.read_bytes())

    def test_activate_and_rollback_preserve_trpc_and_other_routes(self):
        active = self.controller.activate(OPERATION)
        self.assertTrue(active["active"])
        self.assertIn(route.BEGIN.encode(), self.site.read_bytes())
        self.assertIn(("POST", "/api/trpc/profile.photoCapability,chat.list?batch=1"), self.system.requests)
        result = self.controller.rollback(OPERATION)
        self.assertFalse(result["active"])
        self.assertEqual(self.site.read_bytes(), SITE)
        self.assertEqual(self.system.reloads, 2)

    def test_exact_legacy_baseline_health_allows_activation(self):
        self.system.legacy_baseline_health = True
        self.assertTrue(self.controller.activate(OPERATION)["active"])
        self.assertFalse(self.controller.rollback(OPERATION)["active"])

    def test_activation_probe_failure_restores_previous_site(self):
        self.system.fail_probe_once = True
        with self.assertRaises(route.edge.ControlError) as error:
            self.controller.activate(OPERATION)
        self.assertEqual(error.exception.stage, "activation_failed")
        self.assertEqual(self.site.read_bytes(), SITE)
        self.assertEqual(self.system.reloads, 2)

    def test_nginx_config_failure_restores_previous_site(self):
        self.system.fail_config_once = True
        with self.assertRaises(route.edge.ControlError) as error:
            self.controller.activate(OPERATION)
        self.assertEqual(error.exception.stage, "activation_failed")
        self.assertEqual(self.site.read_bytes(), SITE)

    def test_rollback_probe_failure_restores_active_route(self):
        self.controller.activate(OPERATION)
        self.system.fail_release_probe_once = True
        with self.assertRaises(route.edge.ControlError) as error:
            self.controller.rollback(OPERATION)
        self.assertEqual(error.exception.stage, "rollback_failed")
        self.assertIn(route.BEGIN.encode(), self.site.read_bytes())
        self.assertEqual(self.system.reloads, 3)

    def test_marked_bad_gateway_fails_activation_and_restores_baseline(self):
        self.system.fail_marked_502_once = True
        with self.assertRaises(route.edge.ControlError) as error:
            self.controller.activate(OPERATION)
        self.assertEqual(error.exception.stage, "activation_failed")
        self.assertEqual(self.site.read_bytes(), SITE)

    def test_baseline_bad_gateway_fails_rollback_and_restores_active_route(self):
        self.controller.activate(OPERATION)
        self.system.fail_baseline_502_once = True
        with self.assertRaises(route.edge.ControlError) as error:
            self.controller.rollback(OPERATION)
        self.assertEqual(error.exception.stage, "rollback_failed")
        self.assertIn(route.BEGIN.encode(), self.site.read_bytes())

    def test_old_nginx_workers_can_drain_beyond_four_seconds(self):
        self.system.linger_polls = 45
        result = self.controller.activate(OPERATION)
        self.assertTrue(result["active"])
        self.assertEqual(self.system.linger_polls, 0)

    def test_candidate_identity_change_prevents_activation(self):
        self.system.container_id = "c" * 64
        with self.assertRaises(route.edge.ControlError) as error:
            self.controller.activate(OPERATION)
        self.assertEqual(error.exception.stage, "candidate_identity")
        self.assertEqual(self.site.read_bytes(), SITE)
        self.assertEqual(self.system.reloads, 0)

    def test_foreign_site_change_prevents_rollback(self):
        self.controller.activate(OPERATION)
        self.site.write_bytes(self.site.read_bytes() + b"# foreign\n")
        with self.assertRaises(route.edge.ControlError) as error:
            self.controller.rollback(OPERATION)
        self.assertEqual(error.exception.stage, "config_drift")
        self.assertIn(b"# foreign\n", self.site.read_bytes())
        self.assertEqual(self.system.reloads, 1)

    def test_interruption_after_route_reload_recovers_from_exact_intent(self):
        self.leave_active_without_activation_record()
        result = self.controller.rollback(OPERATION)
        self.assertFalse(result["active"])
        self.assertTrue(result["recovered_from_intent"])
        self.assertEqual(self.site.read_bytes(), SITE)
        self.assertEqual(self.system.reloads, 2)
        # Recovery is idempotent after a second operator process starts.
        self.assertFalse(self.controller.rollback(OPERATION)["active"])

    def test_host_reboot_after_interrupted_activation_can_restore_exact_route(self):
        self.leave_active_without_activation_record()
        self.system.master_pid = 42
        self.system.master_start_ticks = 99
        self.system.workers = [900]
        result = self.controller.rollback(OPERATION)
        self.assertTrue(result["recovered_from_intent"])
        self.assertEqual(self.site.read_bytes(), SITE)

    def test_reboot_recovery_rejects_changed_candidate_identity(self):
        self.leave_active_without_activation_record()
        self.system.master_pid = 42
        self.system.master_start_ticks = 99
        self.system.container_id = "c" * 64
        with self.assertRaises(route.edge.ControlError) as error:
            self.controller.rollback(OPERATION)
        self.assertEqual(error.exception.stage, "reboot_candidate_identity")
        self.assertIn(route.BEGIN.encode(), self.site.read_bytes())

    def test_recovery_config_failure_restores_staged_route(self):
        self.leave_active_without_activation_record()
        self.system.fail_config_once = True
        with self.assertRaises(route.edge.ControlError) as error:
            self.controller.rollback(OPERATION)
        self.assertEqual(error.exception.stage, "recovery_failed")
        self.assertIn(route.BEGIN.encode(), self.site.read_bytes())
        self.assertEqual(self.system.reloads, 2)

    def test_recovery_reload_failure_restores_staged_route(self):
        self.leave_active_without_activation_record()
        self.system.fail_reload_once = True
        with self.assertRaises(route.edge.ControlError) as error:
            self.controller.rollback(OPERATION)
        self.assertEqual(error.exception.stage, "recovery_failed")
        self.assertIn(route.BEGIN.encode(), self.site.read_bytes())
        self.assertEqual(self.system.reloads, 2)

    def test_recovery_baseline_probe_failure_restores_staged_route(self):
        self.leave_active_without_activation_record()
        self.system.fail_baseline_502_once = True
        with self.assertRaises(route.edge.ControlError) as error:
            self.controller.rollback(OPERATION)
        self.assertEqual(error.exception.stage, "recovery_failed")
        self.assertIn(route.BEGIN.encode(), self.site.read_bytes())
        self.assertEqual(self.system.reloads, 3)

    def test_interruption_before_route_install_recovers_original_intent(self):
        original_install = self.controller._install
        self.controller._install = lambda *_args: (_ for _ in ()).throw(SystemExit("simulated power loss"))
        with self.assertRaises(SystemExit):
            self.controller.activate(OPERATION)
        self.controller._install = original_install
        result = self.controller.rollback(OPERATION)
        self.assertTrue(result["recovered_from_intent"])
        self.assertEqual(self.site.read_bytes(), SITE)
        self.assertEqual(self.system.reloads, 0)

    def test_completed_rollback_is_idempotent_after_record_write(self):
        self.controller.activate(OPERATION)
        self.controller.rollback(OPERATION)
        self.assertFalse(self.controller.rollback(OPERATION)["active"])
        self.assertEqual(self.system.reloads, 2)

    def test_interrupted_rollback_after_backup_write_reloads_original_workers(self):
        self.controller.activate(OPERATION)
        original_install = self.controller._install

        def interrupted(raw, _info):
            self.site.write_bytes(raw)
            raise SystemExit("simulated SIGKILL before Nginx reload")

        self.controller._install = interrupted
        with self.assertRaises(SystemExit):
            self.controller.rollback(OPERATION)
        self.controller._install = original_install
        self.assertEqual(self.site.read_bytes(), SITE)
        self.assertTrue(self.system.served_active)
        result = self.controller.rollback(OPERATION)
        self.assertFalse(result["active"])
        self.assertFalse(self.system.served_active)
        self.assertEqual(self.system.reloads, 2)


if __name__ == "__main__":
    unittest.main()
