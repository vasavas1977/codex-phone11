import importlib.util
import json
from pathlib import Path
import unittest
from types import SimpleNamespace
from unittest.mock import patch

PATH = Path(__file__).resolve().parents[1] / "scripts/phone11-invitations-api-stage.py"
SPEC = importlib.util.spec_from_file_location("invitations_stage", PATH)
inv = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(inv)
base = inv.stage

H = "a" * 64
IMAGE = "sha256:" + "b" * 64
OLD = {
    "Id": H,
    "Image": IMAGE,
    "Name": "/cp11-api-candidate-voicemail",
    "State": {"Running": True, "Health": {"Status": "healthy"}},
    "Config": {
        "User": "cloudphone",
        "WorkingDir": "/app",
        "Entrypoint": ["docker-entrypoint.sh"],
        "Cmd": ["node", "dist/index.mjs"],
        "Healthcheck": {
            "Test": ["CMD-SHELL", "node -e 'old 3013'"],
            "Interval": 10_000_000_000,
            "Timeout": 3_000_000_000,
            "StartPeriod": 10_000_000_000,
            "Retries": 3,
        },
        "Env": [
            "PORT=3013",
            "PHONE11_RUNTIME_ROLE=api-candidate",
            "SECRET=abc$word",
            "PHONE11_BUILD_SHA=old-build",
            "PHONE11_VOICEMAIL_HOOK_READY=false",
        ],
        "Labels": {
            "com.phone11.source-sha": "1" * 40,
            "com.phone11.bundle-sha256": "c" * 64,
            "com.phone11.lock-sha256": "d" * 64,
            "com.phone11.candidate-build": "old-build",
        },
    },
    "HostConfig": {
        "PortBindings": {"3013/tcp": [{"HostIp": "127.0.0.1", "HostPort": "3013"}]},
        "NetworkMode": "exact-net",
        "RestartPolicy": {"Name": "unless-stopped"},
        "Memory": 2147483648,
        "Privileged": False,
        "ReadonlyRootfs": False,
    },
    "NetworkSettings": {"Networks": {"exact-net": {}}},
    "Mounts": [{"Type": "bind", "Source": "/private/mount", "Destination": "/data", "RW": True}],
}


class InvitationStageTests(unittest.TestCase):
    def test_upstream_hash_is_pinned_and_wrong_pins_fail_closed(self):
        self.assertEqual(len(inv.verify_upstream_pin()), Path(inv.UPSTREAM).stat().st_size)
        with self.assertRaisesRegex(RuntimeError, "hash mismatch"):
            inv.verify_upstream_pin(expected="0" * 64)

    def test_predecessor_is_the_healthy_voicemail_candidate_on_loopback_3013(self):
        self.assertEqual(inv.stage.PREDECESSOR, "cp11-api-candidate-voicemail")
        self.assertEqual(inv.stage.OLD_PORT, 3013)
        with patch.object(base, "inspect", return_value=json.loads(json.dumps(OLD))), \
             patch.object(base, "run", return_value=("c" * 64 + " /app/dist/index.mjs\n").encode()):
            self.assertEqual(inv.check_old({"predecessor": {
                "container_id": H, "image": IMAGE, "source_sha": "1" * 40,
                "bundle_sha256": "c" * 64, "lock_sha256": "d" * 64, "build": "old-build",
            }}), OLD)
        wrong = json.loads(json.dumps(OLD))
        wrong["Name"] = "/cp11-api-candidate-status"
        with patch.object(base, "inspect", return_value=wrong):
            with self.assertRaisesRegex(inv.Refused, "predecessor_identity"):
                inv.check_old({"predecessor": {
                    "container_id": H, "image": IMAGE, "source_sha": "1" * 40,
                    "bundle_sha256": "c" * 64, "lock_sha256": "d" * 64, "build": "old-build",
                }})

    def test_healthcheck_targets_only_3014_and_candidate_labels_are_unique(self):
        health = inv.healthcheck(OLD, "invite-build")
        script = health["test"][3]
        self.assertIn("127.0.0.1:3014/api/health", script)
        self.assertNotIn("127.0.0.1:3013/api/health", script)

        data, _env_file, _env = inv.compose(OLD, IMAGE, "f" * 64, "invite-build")
        model = json.loads(data)
        service = model["services"][inv.stage.SERVICE]
        self.assertEqual(inv.stage.NAME, "cp11-api-candidate-invitations")
        self.assertEqual(inv.stage.PROJECT, "phone11-invitations-api-stage")
        self.assertEqual(inv.stage.SERVICE, "invitations_api")
        self.assertEqual(service["container_name"], inv.stage.NAME)
        self.assertEqual(service["ports"], ["127.0.0.1:3014:3014"])
        self.assertEqual(service["labels"], {
            "com.phone11.invitations-stage.manifest-sha256": "f" * 64,
            "com.phone11.invitations-stage.owner": inv.stage.SCHEMA,
        })
        self.assertNotIn("voicemail-stage", json.dumps(service["labels"]))
        self.assertIn("127.0.0.1:3014/api/health", service["healthcheck"]["test"][3])

    def test_invitation_capability_is_explicitly_off_and_other_predecessor_environment_is_preserved(self):
        data, env_file, expected = inv.compose(OLD, IMAGE, "f" * 64, "invite-build")
        service = json.loads(data)["services"][inv.stage.SERVICE]
        self.assertEqual(expected["PHONE11_INVITATIONS_ENABLED"], "false")
        self.assertIn(b"PHONE11_INVITATIONS_ENABLED=false\n", env_file)
        self.assertEqual(expected["PHONE11_VOICEMAIL_HOOK_READY"], "false")
        self.assertEqual(expected["PORT"], "3014")
        self.assertEqual(expected["PHONE11_BUILD_SHA"], "invite-build")
        self.assertEqual(expected["SECRET"], "abc$word")
        self.assertEqual(expected["PHONE11_RUNTIME_ROLE"], "api-candidate")
        self.assertEqual(service["env_file"][0]["path"], "/var/lib/phone11-invitations-api-stage/runtime.env")
        self.assertEqual(inv.stage.STATE, Path("/var/lib/phone11-invitations-api-stage"))
        self.assertEqual(inv.stage.LOCK, Path("/run/phone11-invitations-api-stage.lock"))

    def test_predecessor_invite_on_value_is_forced_off_without_mutating_other_env(self):
        existing = json.loads(json.dumps(OLD))
        existing["Config"]["Env"].append("PHONE11_INVITATIONS_ENABLED=true")
        _data, env_file, expected = inv.compose(existing, IMAGE, "f" * 64, "invite-build")
        self.assertEqual(expected["PHONE11_INVITATIONS_ENABLED"], "false")
        self.assertIn(b"PHONE11_INVITATIONS_ENABLED=false\n", env_file)
        self.assertEqual(expected["SECRET"], "abc$word")


    def test_cleanup_requires_real_invitation_owner_labels(self):
        impostor = json.loads(json.dumps(OLD))
        impostor["Name"] = "/" + inv.stage.NAME
        impostor["Config"]["Labels"].update({
            "com.phone11.voicemail-stage.owner": inv.stage.SCHEMA,
            "com.phone11.voicemail-stage.manifest-sha256": "f" * 64,
            "com.docker.compose.project": inv.stage.PROJECT,
            "com.docker.compose.service": inv.stage.SERVICE,
        })
        with patch.object(base, "inspect", return_value=impostor), patch.object(base, "run") as command:
            with self.assertRaisesRegex(inv.Refused, "cleanup_identity"):
                inv.cleanup_owned("f" * 64, IMAGE)
            command.assert_not_called()

    def test_image_build_tag_is_also_invitation_specific(self):
        captured = []
        with patch.object(inv, "_original_run", side_effect=lambda args, **kwargs: captured.append(args) or b""):
            inv.invitations_run(["docker", "build", "--network=none", "-t",
                                 "phone11-voicemail-stage:sha", "/private/build"])
            inv.invitations_run(["docker", "image", "inspect", "phone11-voicemail-stage:sha"])
        self.assertIn("phone11-invitations-stage:sha", captured[0])
        self.assertEqual(captured[1], ["docker", "image", "inspect", "phone11-invitations-stage:sha"])
        self.assertNotIn("phone11-voicemail-stage:sha", captured[0] + captured[1])


if __name__ == "__main__":
    unittest.main()
