import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import tempfile
import types
import unittest
from contextlib import nullcontext
from datetime import datetime, timezone
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("phone11-status-cookie-canary.py")
SPEC = importlib.util.spec_from_file_location("phone11_status_cookie_canary", SCRIPT)
canary = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(canary)


def fixture_site():
    return b'''server {
    listen 80;
    server_name phone11.ai 1toall.phone11.ai api.phone11.ai;
    location = /api/trpc {
        proxy_pass http://127.0.0.1:3011;
    }
    location ^~ /api/trpc/ {
        proxy_pass http://127.0.0.1:3011;
        proxy_http_version 1.1;
        proxy_pass_request_headers on;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
'''


class FakeHelper:
    class GuardError(RuntimeError):
        pass

    GATE_ROOT = Path("/tmp/gates")

    def __init__(self, owner):
        self.owner = owner
        self.reloads = 0
        self.fail_first_reload = False
        self.commands = []
        self.candidate_checks = 0
        self.predecessor_checks = 0

    def lock(self):
        return nullcontext()

    def read_regular(self, path, *, root_only=False):
        p = Path(path)
        data = p.read_bytes()
        st = p.stat()
        # The harness models protected production ownership while using a temp file.
        owner = types.SimpleNamespace(st_uid=0, st_gid=0, st_mode=st.st_mode)
        return data, owner

    def atomic_write(self, path, data, *, mode, uid=0, gid=0):
        p = Path(path)
        temp = p.with_name("." + p.name + ".tmp")
        temp.write_bytes(data)
        os.chmod(temp, mode)
        os.replace(temp, p)

    def _protected_directory(self, path):
        return None

    def load_gate_manifest(self, path):
        self.manifest_path = path
        return {"candidate": {"build": "pinned"}}, b"manifest"

    def check_candidate(self, pins):
        self.candidate_checks += 1

    def check_predecessor(self):
        self.predecessor_checks += 1

    def command(self, args, *, timeout=15):
        self.commands.append(list(args))
        return b""

    def nginx_validate_and_reload(self):
        self.reloads += 1
        if self.fail_first_reload and self.reloads == 1:
            raise RuntimeError("simulated nginx validation failure")


class CanaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.site = self.root / "phone11ai"
        self.original = fixture_site()
        self.site.write_bytes(self.original)
        self.state = self.root / "state"
        self.state.mkdir(mode=0o700)
        self.systemd = self.root / "systemd"
        self.systemd.mkdir(mode=0o700)
        self.sentinel = self.root / "sentinel"
        self.helper = FakeHelper(self)
        self.patches = [
            patch.object(canary, "SITE", self.site),
            patch.object(canary, "STATE_ROOT", self.state),
            patch.object(canary, "SYSTEMD_UNIT_DIR", self.systemd),
            patch.object(canary, "SENTINEL", self.sentinel),
            patch.object(canary, "ORIGINAL_SHA256", hashlib.sha256(self.original).hexdigest()),
            patch.object(canary, "shared", return_value=self.helper),
            patch.object(canary, "_ensure_installed_operator", return_value=None),
            patch.object(canary, "_ensure_state_root", return_value=None),
            patch.object(canary, "_check_systemd_unit_dir", return_value=None),
            patch.object(canary.os, "geteuid", return_value=0),
        ]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.temp.cleanup()

    def test_exact_cookie_canary_policy_and_fixed_upstream(self):
        proposed = canary.render_site(self.original)
        insertion = self.original.index(b"\n") + 1
        added = len(proposed) - len(self.original)
        self.assertEqual(proposed[:insertion] + proposed[insertion + added:], self.original)
        self.assertIn(b"location = /api/phone11-status-canary/admin-settings", proposed)
        self.assertIn(b"if (!-f " + str(self.sentinel).encode() + b") { return 404; }", proposed)
        self.assertIn(b"if ($host != api.phone11.ai) { return 404; }", proposed)
        self.assertIn(b"if ($request_method != GET) { return 405; }", proposed)
        self.assertIn(b"proxy_pass_request_body off;", proposed)
        self.assertIn(b'proxy_set_header Content-Length "";', proposed)
        self.assertIn(b"proxy_pass_request_headers on;", proposed)
        self.assertIn(b"proxy_pass http://127.0.0.1:3012/api/trpc/profile.adminSettings;", proposed)
        self.assertNotIn(b"proxy_set_header Cookie", proposed)  # Default request-header forwarding preserves Cookie.
        self.assertNotRegex(proposed, rb"(?im)^\s*proxy_set_header\s+(?:Cookie|Authorization)\s+\"\"\s*;")
        self.assertIn(b"proxy_cache off;", proposed)
        self.assertIn(b'add_header Cache-Control "no-store, private" always;', proposed)
        self.assertIn(b"access_log off;", proposed)
        self.assertEqual(proposed.count(b"proxy_pass http://127.0.0.1:3011;"), 2)
        self.assertNotIn(b"$http_cookie", proposed.lower())
        self.assertNotIn(b"$arg_", proposed.lower())

    def test_unknown_site_refused_without_mutation(self):
        drifted = self.original + b"# operator drift\n"
        self.site.write_bytes(drifted)
        with self.assertRaises(canary.Refusal):
            canary.install()
        self.assertEqual(self.site.read_bytes(), drifted)
        self.assertEqual(self.helper.commands, [])

    def test_install_then_manual_rollback_restores_exact_original_bytes(self):
        run = canary.install()
        active = self.site.read_bytes()
        self.assertNotEqual(active, self.original)
        self.assertEqual(hashlib.sha256(active).hexdigest(), canary.sha(active))
        self.assertEqual(self.helper.reloads, 1)
        self.assertEqual(self.helper.predecessor_checks, 1)
        self.assertEqual(self.helper.candidate_checks, 2)
        self.assertTrue(any(cmd[:3] == ["systemctl", "enable", "--now"] for cmd in self.helper.commands))
        record = json.loads((run / "receipt.json").read_text())
        timer_unit = (self.systemd / (record["timer_unit"] + ".timer")).read_text()
        service_unit = (self.systemd / (record["timer_unit"] + ".service")).read_text()
        self.assertIn("OnCalendar=", timer_unit)
        self.assertIn("Persistent=true", timer_unit)
        self.assertIn("Before=nginx.service", service_unit)
        self.assertIn(str(canary.INSTALLED_OPERATOR), service_unit)
        self.assertTrue(self.sentinel.exists())
        canary.rollback(run)
        self.assertEqual(self.site.read_bytes(), self.original)
        self.assertEqual(hashlib.sha256(self.site.read_bytes()).hexdigest(), canary.ORIGINAL_SHA256)
        self.assertEqual(self.helper.reloads, 2)
        self.assertTrue(any(cmd[:3] == ["systemctl", "disable", "--now"] for cmd in self.helper.commands))

    def test_failed_activation_reload_restores_original_and_disarms_timer(self):
        self.helper.fail_first_reload = True
        with self.assertRaises(RuntimeError):
            canary.install()
        self.assertEqual(self.site.read_bytes(), self.original)
        self.assertEqual(hashlib.sha256(self.site.read_bytes()).hexdigest(), canary.ORIGINAL_SHA256)
        self.assertEqual(self.helper.reloads, 2)
        self.assertFalse(self.sentinel.exists())
        self.assertTrue(any(cmd[:3] == ["systemctl", "disable", "--now"] for cmd in self.helper.commands))

    def test_auth_directive_inside_trpc_location_is_refused(self):
        altered = self.original.replace(
            b"        proxy_pass http://127.0.0.1:3011;\n        proxy_http_version",
            b"        auth_request /verify;\n        proxy_pass http://127.0.0.1:3011;\n        proxy_http_version",
        )
        with patch.object(canary, "ORIGINAL_SHA256", hashlib.sha256(altered).hexdigest()):
            with self.assertRaisesRegex(canary.Refusal, "trpc_auth_policy_unmodeled"):
                canary.render_site(altered)


if __name__ == "__main__":
    unittest.main()
