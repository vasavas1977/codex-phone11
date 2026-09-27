import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch


PATH = Path(__file__).resolve().parents[1] / "scripts/phone11-invitations-enable.py"
SPEC = importlib.util.spec_from_file_location("invitations_enable", PATH)
op = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(op)

KEY = "re_private_123"
SENDER = "Phone11 <noreply@phone11.ai>"
GUARDED = {
    "Config": {
        "User": "cloudphone", "WorkingDir": "/app",
        "Entrypoint": ["docker-entrypoint.sh"], "Cmd": ["node", "dist/index.mjs"],
        "Healthcheck": {"Test": ["CMD-SHELL", "node -e old"], "Interval": 10_000_000_000,
                        "Timeout": 3_000_000_000, "Retries": 3},
        "Env": ["PORT=3014", "PHONE11_RUNTIME_ROLE=api-candidate",
                "PHONE11_VOICEMAIL_HOOK_READY=false", "PHONE11_INVITATIONS_ENABLED=false",
                "PHONE11_BUILD_SHA=invitations-off-b3ed0e7", "SECRET=abc$word"],
        "Labels": {},
    },
    "HostConfig": {"NetworkMode": "exact-net", "RestartPolicy": {"Name": "unless-stopped"},
                   "Memory": 2147483648, "Privileged": False, "ReadonlyRootfs": False},
    "NetworkSettings": {"Networks": {"exact-net": {}}},
    "Mounts": [{"Type": "bind", "Source": "/private/mount", "Destination": "/data", "RW": True}],
}


class EnableOperatorTests(unittest.TestCase):
    def test_dependencies_are_hash_pinned_and_compiled_from_verified_bytes(self):
        self.assertEqual(op.sha(op.ACTIVATION_PATH.read_bytes()), op.ACTIVATION_SHA)
        self.assertEqual(op.sha(op.STAGE_PATH.read_bytes()), op.STAGE_SHA)
        with self.assertRaisesRegex(op.Refused, "dependency_pin"):
            op.verified_module(op.STAGE_PATH, "0" * 64, "wrong")

    def test_compose_clones_same_image_workerless_with_only_private_env_secret(self):
        model_bytes, env_bytes, expected = op.make_compose(copy.deepcopy(GUARDED), KEY, SENDER)
        service = json.loads(model_bytes)["services"][op.SERVICE]
        self.assertEqual(service["image"], op.act.GUARDED["image"])
        self.assertEqual(service["pull_policy"], "never")
        self.assertEqual(service["ports"], ["127.0.0.1:3015:3015"])
        self.assertEqual(service["env_file"], [{"path": str(op.STATE / "runtime.env"), "format": "raw"}])
        self.assertEqual(service["labels"]["com.phone11.invitations-enable.owner"], op.SCHEMA)
        self.assertIn("127.0.0.1:3015/api/health", service["healthcheck"]["test"][3])
        self.assertNotIn(KEY, model_bytes.decode())
        self.assertIn(("PHONE11_INVITATIONS_RESEND_API_KEY=" + KEY).encode(), env_bytes)
        self.assertEqual(expected["PHONE11_VOICEMAIL_HOOK_READY"], "false")
        self.assertEqual(expected["PHONE11_RUNTIME_ROLE"], "api-candidate")
        self.assertEqual(expected["PHONE11_INVITATIONS_ENABLED"], "true")
        self.assertEqual(expected["SECRET"], "abc$word")

    def test_recovery_requires_exact_authority_and_approved_sender(self):
        item = {"Config": {"Labels": {
            "com.phone11.recovery-only": "true", "com.phone11.candidate-build": op.RECOVERY["build"]},
            "Env": ["PORT=3004", "PHONE11_RUNTIME_ROLE=api-candidate",
                    "PHONE11_PASSWORD_RESET_PROVIDER=resend",
                    "PHONE11_PASSWORD_RESET_RESEND_API_KEY=" + KEY,
                    "PHONE11_PASSWORD_RESET_FROM=" + SENDER]}}
        with patch.object(op.act, "inspect", return_value=item):
            self.assertEqual(op.recovery_settings(), (KEY, SENDER))
            item["Config"]["Env"][-1] = "PHONE11_PASSWORD_RESET_FROM=attacker@example.org"
            with self.assertRaisesRegex(op.Refused, "recovery_configuration"):
                op.recovery_settings()
            item["Config"]["Env"][-1] = "PHONE11_PASSWORD_RESET_FROM=" + SENDER
            item["Config"]["Labels"]["com.phone11.recovery-only"] = "false"
            with self.assertRaisesRegex(op.Refused, "recovery_authority"):
                op.recovery_settings()

    def test_schema_check_is_pinned_read_only_and_exact(self):
        seen = []
        inspect = json.dumps([{"Id": op.PG_ID, "Image": op.PG_IMAGE,
                               "State": {"Running": True}}]).encode()
        ready = json.dumps({"invitations": True, "events": True,
                            "column_count": 16, "index_count": 3}).encode()
        def command(argv, timeout=20):
            seen.append(argv)
            return inspect if argv[1] == "inspect" else (ready if len(seen) == 2 else b"{}")
        helper = SimpleNamespace(CATALOG_SQL="SELECT '{}'::text WHERE %(base)s IS false",
                                 catalog_hash=lambda _: op.CATALOG_AFTER)
        with patch.object(op.act, "command", side_effect=command), \
             patch.object(op, "verified_module", return_value=helper) as loader:
            op.schema_ready()
            self.assertIn("default_transaction_read_only=on", seen[1][5])
            self.assertIn("BEGIN TRANSACTION READ ONLY", seen[1])
            self.assertIn("ROLLBACK", seen[1])
            self.assertIn("BEGIN TRANSACTION READ ONLY", seen[2])
            loader.assert_called_once_with(op.CATALOG_HELPER, op.CATALOG_HELPER_SHA,
                                           "invitations_catalog_proof")
        with patch.object(op.act, "command", side_effect=[inspect, b'{"invitations":true,"events":true,"column_count":16,"index_count":2}']), \
             patch.object(op, "verified_module", return_value=helper):
            with self.assertRaisesRegex(op.Refused, "schema_readiness"):
                op.schema_ready()
        drifted = SimpleNamespace(CATALOG_SQL=helper.CATALOG_SQL,
                                  catalog_hash=lambda _: "0" * 64)
        with patch.object(op.act, "command", side_effect=[inspect, ready, b"{}"]), \
             patch.object(op, "verified_module", return_value=drifted):
            with self.assertRaisesRegex(op.Refused, "schema_catalog_drift"):
                op.schema_ready()

    def test_route_only_two_exact_trpc_ports_and_preserves_other_paths(self):
        original = (b"location = /api/trpc {\n proxy_pass http://127.0.0.1:3014;\n}\n"
                    b"location ^~ /api/trpc/ {\n proxy_pass http://127.0.0.1:3014;\n}\n"
                    b"location /api/voicemail/ {\n proxy_pass http://127.0.0.1:3013;\n}\n")
        changed = op.act.rewrite_trpc(original, 3014, 3015)
        self.assertEqual(changed.count(b"127.0.0.1:3015"), 2)
        self.assertIn(b"127.0.0.1:3013", changed)
        self.assertEqual(op.act.rewrite_trpc(changed, 3015, 3014), original)
        current = [original]
        commands = []
        with patch.object(op, "site_bytes", side_effect=lambda: (current[0], object())), \
             patch.object(op.act, "replace_site", side_effect=lambda data, _info: current.__setitem__(0, data)), \
             patch.object(op.act, "command", side_effect=lambda argv: commands.append(argv) or b""):
            op.route(3014, 3015, op.sha(original), op.sha(changed))
            self.assertEqual(current[0], changed)
            op.route(3015, 3014, op.sha(changed), op.sha(original))
            self.assertEqual(current[0], original)
        self.assertEqual(commands.count(["/usr/sbin/nginx", "-t"]), 2)
        self.assertEqual(commands.count(["/usr/bin/systemctl", "reload", "nginx"]), 2)

    def test_stage_waits_for_health_and_retries_only_exact_private_state(self):
        with tempfile.TemporaryDirectory() as root:
            state = Path(root) / "private"
            calls = []
            fail_first = [True]
            def command(argv, timeout=20):
                calls.append(argv)
                if "up" in argv and fail_first[0]:
                    fail_first[0] = False
                    raise op.act.Refused("command")
                return b""
            def read(path, mode=None):
                self.assertEqual(mode, 0o600)
                return path.read_bytes(), object()
            with patch.object(op, "STATE", state), patch.object(op, "site_bytes", return_value=(b"site", object())), \
                 patch.object(op.act, "TARGET_SITE_SHA256", op.sha(b"site")), \
                 patch.object(op.act, "locked", return_value=contextlib.nullcontext()), \
                 patch.object(op.act, "secure_directory"), patch.object(op.act, "read_file", side_effect=read), \
                 patch.object(op.act, "command", side_effect=command), \
                 patch.object(op.stage.stage, "inspect", return_value=None), \
                 patch.object(op, "parent", return_value=GUARDED), patch.object(op, "schema_ready"), \
                 patch.object(op, "recovery_settings", return_value=(KEY, SENDER)), \
                 patch.object(op, "make_compose", return_value=(b'{}', b'SECRET=x\n', {"SECRET": "x"})), \
                 patch.object(op, "enabled", return_value={"Id": "f" * 64, "Image": op.act.GUARDED["image"]}):
                with self.assertRaises(op.act.Refused):
                    op.stage_enabled()
                self.assertTrue((state / "runtime.env").exists())
                self.assertEqual((state / "runtime.env").stat().st_mode & 0o777, 0o600)
                op.stage_enabled()
                self.assertTrue((state / "receipt.json").exists())
                up = next(argv for argv in calls if "up" in argv)
                self.assertIn("--wait", up)
                self.assertIn("--no-recreate", up)
                self.assertIn("--no-build", up)
                (state / "runtime.env").write_bytes(b"drift")
                with self.assertRaisesRegex(op.Refused, "stage_state_drift"):
                    op.stage_enabled()

    def test_disable_targets_guarded_3014_without_touching_recovery_or_schema(self):
        with patch.object(op.act, "locked", return_value=contextlib.nullcontext()), \
             patch.object(op, "parent"), patch.object(op, "route") as route, \
             patch.object(op, "schema_ready", side_effect=AssertionError("schema accessed")), \
             patch.object(op, "recovery_settings", side_effect=AssertionError("recovery accessed")):
            op.disable()
        route.assert_called_once_with(3015, 3014, op.ENABLED_SITE_SHA, op.act.TARGET_SITE_SHA256)


if __name__ == "__main__":
    unittest.main()
