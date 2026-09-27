"""Source-only safety checks for the guarded, invitation-off tRPC promotion."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch


PATH = Path(__file__).resolve().parents[1] / "scripts/phone11-invitations-activate.py"
SPEC = importlib.util.spec_from_file_location("invitation_activation", PATH)
activation = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(activation)

SITE = b"""server {
    location = /api/recordings/voicemail {
        proxy_pass http://127.0.0.1:3013;
    }
    location = /api/trpc {
        proxy_pass http://127.0.0.1:3013;
        proxy_pass_request_headers on;
    }
    location ^~ /api/trpc/ {
        proxy_pass http://127.0.0.1:3013;
        proxy_pass_request_headers on;
    }
    location = /api/auth/sign-in/email {
        proxy_pass http://127.0.0.1:3004;
    }
    location / {
        proxy_pass http://127.0.0.1:3000;
    }
}
"""


class ActivationTests(unittest.TestCase):
    def test_guarded_candidate_is_off_and_preserves_inherited_runtime(self):
        old = {
            "Config": {"Env": ["PORT=3013", "PHONE11_RUNTIME_ROLE=api-candidate",
                               "PHONE11_VOICEMAIL_HOOK_READY=false", "PHONE11_BUILD_SHA=old",
                               "SECRET=held-in-memory"],
                       "User": "cloudphone", "WorkingDir": "/app",
                       "Entrypoint": ["docker-entrypoint.sh"], "Cmd": ["node", "dist/index.mjs"]},
            "HostConfig": {"NetworkMode": "existing", "Memory": 1024,
                           "RestartPolicy": {"Name": "unless-stopped"}},
            "NetworkSettings": {"Networks": {"existing": {}}},
            "Mounts": [{"Type": "bind", "Source": "/data", "Destination": "/data", "RW": True}],
        }
        guarded = json.loads(json.dumps(old))
        guarded["Config"]["Env"] = ["PORT=3014", "PHONE11_RUNTIME_ROLE=api-candidate",
                                    "PHONE11_VOICEMAIL_HOOK_READY=false",
                                    "PHONE11_BUILD_SHA=invitations-off-b3ed0e7",
                                    "PHONE11_INVITATIONS_ENABLED=false", "SECRET=held-in-memory"]
        guarded["Config"]["Labels"] = {
            "com.phone11.invitations-stage.owner": "phone11-invitations-api-stage/v1",
            "com.phone11.invitations-stage.manifest-sha256": "f" * 64,
        }

        class Connection:
            def request(self, method, path):
                self.method, self.path = method, path

            def getresponse(self):
                payload = json.dumps({"ok": True, "runtimeRole": "api-candidate",
                                      "build": "invitations-off-b3ed0e7"}).encode()
                return SimpleNamespace(status=200, read=lambda _limit: payload)

            def close(self):
                pass

        def inspected(pin):
            return guarded if pin is activation.GUARDED else old

        with patch.object(activation, "inspect", side_effect=inspected) as check, \
             patch.object(activation.http.client, "HTTPConnection", return_value=Connection()):
            activation.check_apis()
            self.assertEqual(check.call_count, 2)
            guarded["Config"]["Env"][4] = "PHONE11_INVITATIONS_ENABLED=true"
            with self.assertRaisesRegex(activation.Refused, "api_role"):
                activation.check_apis(require_old=False)
            self.assertIs(check.call_args.args[0], activation.GUARDED)

    def test_only_both_trpc_targets_change_and_roundtrip_preserves_all_bytes(self):
        target = activation.rewrite_trpc(SITE)
        expected = SITE.replace(b"location = /api/trpc {\n        proxy_pass http://127.0.0.1:3013;",
                                b"location = /api/trpc {\n        proxy_pass http://127.0.0.1:3014;")
        expected = expected.replace(b"location ^~ /api/trpc/ {\n        proxy_pass http://127.0.0.1:3013;",
                                    b"location ^~ /api/trpc/ {\n        proxy_pass http://127.0.0.1:3014;")
        self.assertEqual(target, expected)
        self.assertEqual(activation.rewrite_trpc(target, 3014, 3013), SITE)
        self.assertIn(b"/api/recordings/voicemail {\n        proxy_pass http://127.0.0.1:3013;", target)
        self.assertIn(b"/api/auth/sign-in/email {\n        proxy_pass http://127.0.0.1:3004;", target)
        self.assertIn(b"location / {\n        proxy_pass http://127.0.0.1:3000;", target)

    def test_exact_live_site_bytes_have_a_pinned_two_directive_result_when_available(self):
        snapshot = Path("/tmp/phone11-invitations-nginx-live-before.conf")
        if not snapshot.is_file():
            self.skipTest("local read-only Nginx snapshot unavailable")
        raw = snapshot.read_bytes()
        self.assertEqual(activation.sha(raw), activation.SITE_SHA256)
        target = activation.rewrite_trpc(raw)
        self.assertEqual(activation.sha(target), activation.TARGET_SITE_SHA256)
        self.assertEqual(activation.rewrite_trpc(target, 3014, 3013), raw)

    def test_unmodeled_or_wrong_trpc_locations_refuse(self):
        for changed in (
            SITE.replace(b"location = /api/trpc {", b"location = /api/other {"),
            SITE.replace(b"location = /api/trpc {", b"location = /api/trpc {\n        proxy_pass http://127.0.0.1:3013;"),
            SITE.replace(b"location ^~ /api/trpc/ {\n        proxy_pass http://127.0.0.1:3013;",
                         b"location ^~ /api/trpc/ {\n        proxy_pass http://127.0.0.1:3000;"),
            SITE.replace(b"location ^~ /api/trpc/ {", b"location ^~ /api/trpc/ {\n        if ($x) { return 403; }"),
        ):
            with self.subTest(changed=changed[:45]), self.assertRaises(activation.Refused):
                activation.rewrite_trpc(changed)

    def test_no_operator_rollback_to_old_unguarded_3013(self):
        with patch("sys.argv", [str(PATH), "rollback"]), self.assertRaises(SystemExit) as raised:
            activation.main()
        self.assertEqual(raised.exception.code, 2)

    def test_syntax_failure_restores_disk_before_any_reload(self):
        guarded = activation.rewrite_trpc(SITE)
        current = [SITE]
        calls = []

        def read(_path):
            return current[0], SimpleNamespace(st_uid=0, st_gid=0, st_mode=0o100644)

        def replace(value, _info):
            current[0] = value
            calls.append(("replace", value))

        def command(argv):
            calls.append(("command", argv))
            raise activation.Refused("nginx_syntax")

        with patch.object(activation, "locked"), \
             patch.object(activation, "receipt", return_value=({"state": "prepared"}, SITE, guarded)), \
             patch.object(activation, "read_file", side_effect=read), \
             patch.object(activation, "check_apis"), \
             patch.object(activation, "replace_site", side_effect=replace), \
             patch.object(activation, "command", side_effect=command):
            with self.assertRaisesRegex(activation.Refused, "nginx_syntax"):
                activation.promote()
        self.assertEqual(current[0], SITE)
        self.assertEqual([call[0] for call in calls], ["replace", "command", "replace"])
        self.assertEqual(calls[1][1], ["/usr/sbin/nginx", "-t"])

    def test_uncertain_reload_keeps_guarded_file_and_never_restores_3013(self):
        guarded = activation.rewrite_trpc(SITE)
        current = [SITE]
        calls = []

        def read(_path):
            return current[0], SimpleNamespace(st_uid=0, st_gid=0, st_mode=0o100644)

        def replace(value, _info):
            current[0] = value
            calls.append(("replace", value))

        def command(argv):
            calls.append(("command", argv))
            if argv[0] == "/usr/bin/systemctl":
                raise activation.Refused("reload_uncertain")
            return b""

        with patch.object(activation, "locked"), \
             patch.object(activation, "receipt", return_value=({"state": "prepared"}, SITE, guarded)), \
             patch.object(activation, "read_file", side_effect=read), \
             patch.object(activation, "check_apis"), \
             patch.object(activation, "replace_site", side_effect=replace), \
             patch.object(activation, "command", side_effect=command):
            with self.assertRaisesRegex(activation.Refused, "reload_uncertain"):
                activation.promote()
        self.assertEqual(current[0], guarded)
        self.assertEqual([call[0] for call in calls], ["replace", "command", "command"])


if __name__ == "__main__":
    unittest.main()
