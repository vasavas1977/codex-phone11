import importlib.util
from contextlib import ExitStack
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch


PATH = Path(__file__).resolve().parents[1] / "scripts/phone11-voicemail-api-stage.py"
SPEC = importlib.util.spec_from_file_location("voicemail_stage", PATH)
stage = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(stage)

H = "a" * 64
I = "sha256:" + "b" * 64
OLD = {
    "Id": H, "Image": I, "Name": "/" + stage.PREDECESSOR,
    "State": {"Running": True, "Health": {"Status": "healthy"}},
    "Config": {"User": "cloudphone", "WorkingDir": "/app",
               "Entrypoint": ["docker-entrypoint.sh"], "Cmd": ["node", "dist/index.mjs"],
               "Healthcheck": {"Test": ["CMD-SHELL", "node -e 'old 3012'"],
                               "Interval": 10_000_000_000, "Timeout": 3_000_000_000,
                               "StartPeriod": 10_000_000_000, "Retries": 3},
               "Env": ["PORT=3012", "PHONE11_RUNTIME_ROLE=api-candidate", "SECRET=abc$word",
                       "PHONE11_BUILD_SHA=old-build", "PHONE11_VOICEMAIL_HOOK_READY=false"],
               "Labels": {"com.phone11.source-sha": "1" * 40,
                          "com.phone11.bundle-sha256": "c" * 64,
                          "com.phone11.lock-sha256": "d" * 64,
                          "com.phone11.candidate-build": "old-build"}},
    "HostConfig": {"PortBindings": {"3012/tcp": [{"HostIp": "127.0.0.1", "HostPort": "3012"}]},
                   "NetworkMode": "exact-net", "RestartPolicy": {"Name": "unless-stopped"},
                   "Memory": 2147483648, "Privileged": False, "ReadonlyRootfs": False},
    "NetworkSettings": {"Networks": {"exact-net": {}}},
    "Mounts": [{"Type": "bind", "Source": "/private/mount", "Destination": "/data", "RW": True}],
}
MANIFEST = {
    "schema": stage.SCHEMA,
    "predecessor": {"container_id": H, "image": I, "source_sha": "1" * 40,
                    "bundle_sha256": "c" * 64, "lock_sha256": "d" * 64, "build": "old-build"},
    "release": {"source_sha": "2" * 40, "bundle_sha256": "e" * 64,
                "lock_sha256": "d" * 64, "build": "new-build"},
    "source_checkout": "/private/source", "bundle_file": "/private/bundle.mjs",
}


class StageTests(unittest.TestCase):
    def test_inspect_accepts_only_exact_absent_candidate_error(self):
        for stderr in (
            b"error: no such object: cp11-api-candidate-voicemail\n",
            b"Error: No such container: cp11-api-candidate-voicemail\n",
            b"Error response from daemon: No such object: cp11-api-candidate-voicemail\n",
        ):
            with patch.object(stage.subprocess, "run", return_value=SimpleNamespace(
                    returncode=1, stdout=b"", stderr=stderr)):
                self.assertIsNone(stage.inspect(stage.NAME))
        for stdout, stderr in (
            (b"", b"error: no such object: unrelated\n"),
            (b"", b"permission denied: no such object: cp11-api-candidate-voicemail\n"),
            (b"secret", b"error: no such object: cp11-api-candidate-voicemail\n"),
        ):
            with patch.object(stage.subprocess, "run", return_value=SimpleNamespace(
                    returncode=1, stdout=stdout, stderr=stderr)):
                with self.assertRaisesRegex(stage.Refused, "inspect_failed"):
                    stage.inspect(stage.NAME)

    def test_manifest_rejects_pin_or_shape_drift(self):
        with patch.object(stage, "private_read", return_value=stage.canonical(MANIFEST)):
            self.assertEqual(stage.manifest(Path("/private/manifest"))[0], MANIFEST)
        bad = json.loads(json.dumps(MANIFEST))
        bad["predecessor"]["container_id"] = "short"
        with patch.object(stage, "private_read", return_value=stage.canonical(bad)):
            with self.assertRaisesRegex(stage.Refused, "manifest"):
                stage.manifest(Path("/private/manifest"))
        bad = json.loads(json.dumps(MANIFEST))
        bad["release"]["lock_sha256"] = "f" * 64
        with patch.object(stage, "private_read", return_value=stage.canonical(bad)):
            with self.assertRaisesRegex(stage.Refused, "lock_change"):
                stage.manifest(Path("/private/manifest"))

    def test_clean_source_rejects_dirty_worktree(self):
        with patch.object(stage, "run", side_effect=[b"2" * 40 + b"\n", b" M file\n"]):
            with self.assertRaisesRegex(stage.Refused, "dirty_source"):
                stage.clean_source(MANIFEST)

    def test_predecessor_requires_api_role_loopback_and_hook_off(self):
        def check(value):
            with patch.object(stage, "inspect", return_value=value), patch.object(stage, "run", return_value=("c" * 64 + " /app/dist/index.mjs\n").encode()):
                stage.check_old(MANIFEST)
        check(json.loads(json.dumps(OLD)))
        for edit in (
            lambda x: x["Config"]["Env"].append("PHONE11_RUNTIME_ROLE=default"),
            lambda x: x["Config"]["Env"].append("PHONE11_VOICEMAIL_HOOK_READY=true"),
            lambda x: x["HostConfig"]["PortBindings"].update({"3012/tcp": [{"HostIp": "0.0.0.0", "HostPort": "3012"}]}),
        ):
            bad = json.loads(json.dumps(OLD)); edit(bad)
            with self.assertRaises(stage.Refused):
                check(bad)

    def test_compose_preserves_private_env_and_mounts_with_explicit_workerless_role(self):
        data, env_file, expected_env = stage.compose(OLD, I, "f" * 64, "new-build")
        model = json.loads(data)
        svc = model["services"][stage.SERVICE]
        self.assertEqual(svc["container_name"], stage.NAME)
        self.assertEqual(svc["image"], I)
        self.assertEqual(svc["ports"], ["127.0.0.1:3013:3013"])
        self.assertEqual(svc["env_file"][0]["format"], "raw")
        self.assertIn(b"PHONE11_RUNTIME_ROLE=api-candidate\n", env_file)
        self.assertIn(b"PHONE11_VOICEMAIL_HOOK_READY=false\n", env_file)
        self.assertIn(b"SECRET=abc$word\n", env_file)
        self.assertEqual(expected_env["SECRET"], "abc$word")
        self.assertEqual(svc["volumes"][0]["source"], "/private/mount")
        self.assertEqual(svc["healthcheck"]["test"][:3], ["CMD", "node", "-e"])
        self.assertIn("127.0.0.1:3013/api/health", svc["healthcheck"]["test"][3])
        self.assertNotIn("3012", svc["healthcheck"]["test"][3])
        self.assertIn("new-build", svc["healthcheck"]["test"][3])
        self.assertEqual(svc["healthcheck"]["interval"], "10000000000ns")
        self.assertEqual(model["networks"]["existing"], {"external": True, "name": "exact-net"})

    def test_compose_rejects_duplicate_mount_and_network(self):
        for edit in (
            lambda x: x["Mounts"].append(dict(x["Mounts"][0])),
            lambda x: x["NetworkSettings"]["Networks"].update({"extra": {}}),
            lambda x: x["Mounts"].append({"Type": "bind", "Source": "/private/shadow",
                                           "Destination": "/app/dist", "RW": True}),
        ):
            bad = json.loads(json.dumps(OLD)); edit(bad)
            with self.assertRaises(stage.Refused):
                stage.compose(bad, I, "f" * 64, "new-build")

    def test_cleanup_never_removes_unowned_container(self):
        bad = json.loads(json.dumps(OLD))
        bad["Name"] = "/" + stage.NAME
        with patch.object(stage, "inspect", return_value=bad), patch.object(stage, "run") as command:
            with self.assertRaisesRegex(stage.Refused, "cleanup_identity"):
                stage.cleanup_owned("f" * 64, I)
            command.assert_not_called()

    def test_cleanup_removes_only_exact_owned_identity(self):
        owned = json.loads(json.dumps(OLD))
        owned["Name"] = "/" + stage.NAME
        owned["Config"]["Labels"].update({
            "com.phone11.voicemail-stage.owner": stage.SCHEMA,
            "com.phone11.voicemail-stage.manifest-sha256": "f" * 64,
            "com.docker.compose.project": stage.PROJECT,
            "com.docker.compose.service": stage.SERVICE,
        })
        with patch.object(stage, "inspect", return_value=owned), patch.object(stage, "run", return_value=b"") as command:
            stage.cleanup_owned("f" * 64, I)
            command.assert_called_once_with(["docker", "rm", "-f", H], timeout=30)

    def test_command_failure_does_not_print_secret(self):
        failed = type("Result", (), {"returncode": 1, "stdout": b"", "stderr": b"SECRET=unsafe"})()
        output = io.StringIO()
        with patch.object(stage.subprocess, "run", return_value=failed), patch("sys.stderr", output):
            with self.assertRaisesRegex(stage.Refused, "command_failed"):
                stage.run(["docker", "compose", "config"])
        self.assertNotIn("unsafe", output.getvalue())

    def test_existing_image_receipt_is_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            receipt = Path(directory) / "image.json"
            receipt.write_bytes(stage.canonical({"schema": stage.SCHEMA,
                "manifest_sha256": "f" * 64, "image": I}))
            with patch.object(stage, "STATE", Path(directory)), \
                 patch.object(stage, "private_read", return_value=receipt.read_bytes()), \
                 patch.object(stage, "check_image") as check, \
                 patch.object(stage, "run") as command:
                self.assertEqual(stage.overlay_image(MANIFEST, "f" * 64), I)
                check.assert_called_once_with(MANIFEST, I)
                command.assert_not_called()

    def test_start_health_failure_cleans_only_owned_candidate(self):
        with tempfile.TemporaryDirectory() as directory:
            model = (b'{"services":{}}', b"PORT=3013\n", {"PORT": "3013", "PHONE11_RUNTIME_ROLE": "api-candidate",
                                                               "PHONE11_VOICEMAIL_HOOK_READY": "false"})
            image_receipt = stage.canonical({"schema": stage.SCHEMA,
                "manifest_sha256": "f" * 64, "image": I})
            fd = os.open("/dev/null", os.O_RDONLY)
            try:
                with ExitStack() as stack:
                    for name, value in (("STATE", Path(directory)), ("locked", lambda: fd),
                                        ("manifest", lambda _: (MANIFEST, "f" * 64)),
                                        ("clean_source", lambda _: None), ("bundle", lambda _: b""),
                                        ("check_old", lambda _: OLD), ("private_state", lambda: None),
                                        ("check_image", lambda *_: None),
                                        ("private_read", lambda *_: image_receipt),
                                        ("compose", lambda *_: model), ("create_once", lambda *_: None),
                                        ("inspect", lambda _: None), ("port_free", lambda: True),
                                        ("candidate_ok", lambda *_: (_ for _ in ()).throw(stage.Refused("candidate_http"))),
                                        ("run", lambda *_args, **_kwargs: b"")):
                        stack.enter_context(patch.object(stage, name, value))
                    stack.enter_context(patch.object(stage.os, "geteuid", return_value=0))
                    stack.enter_context(patch.object(stage.time, "sleep"))
                    stack.enter_context(patch.object(sys, "argv", ["operator", "start", "--manifest", "/private/manifest"]))
                    cleanup = stack.enter_context(patch.object(stage, "cleanup_owned"))
                    with self.assertRaisesRegex(stage.Refused, "candidate_start_or_health"):
                        stage.main()
                    cleanup.assert_called_once_with("f" * 64, I)
            finally:
                try: os.close(fd)
                except OSError: pass


if __name__ == "__main__":
    unittest.main()
