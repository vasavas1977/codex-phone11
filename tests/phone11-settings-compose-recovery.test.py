"""Hermetic tests for recovering a protected settings-candidate Compose source."""

from __future__ import annotations

import copy
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch


SCRIPT = Path(__file__).parents[1] / "scripts" / "phone11-settings-compose-recovery.py"
SPEC = importlib.util.spec_from_file_location("phone11_settings_compose_recovery", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
recovery = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = recovery
SPEC.loader.exec_module(recovery)


CONTAINER_ID = "e927176b48887d62d7ebdcb934b60366f6e41ca2951df8a47d784fbca57b12b6"
IMAGE = "sha256:2669c5032ebda82381c2e1c947cbd804132457355bb05931f1e921d064f1c8a9"
BUILD = "settings-9804c2f"


def source_inspect():
    mounts = [
        {
            "Type": "bind", "Source": source, "Destination": destination,
            "RW": writable, "Propagation": propagation,
        }
        for source, destination, writable, propagation in recovery.EXPECTED_MOUNTS
    ]
    return {
        "Id": CONTAINER_ID,
        "Image": IMAGE,
        "State": {"Running": True, "OOMKilled": False, "Health": {"Status": "healthy"}},
        "Config": {
            "Image": IMAGE,
            "Entrypoint": ["docker-entrypoint.sh"],
            "Cmd": ["node", "dist/index.mjs"],
            "User": "cloudphone",
            "WorkingDir": "/app",
            "StopSignal": None,
            "ExposedPorts": {"3000/tcp": {}, "3005/tcp": {}},
            "Env": [
                "PHONE11_RUNTIME_ROLE=api-candidate", "PORT=3005",
                f"PHONE11_BUILD_SHA={BUILD}", "DATABASE_URL=postgres://user:pa$$word@db/live",
                "PHONE11_LITERAL_DOLLAR=$kept",
            ],
            "Healthcheck": {
                "Test": [
                    "CMD", "node", "-e",
                    "fetch('http://127.0.0.1:3005/api/health').then(r=>r.json()).then(b=>{if(b.runtimeRole!=='api-candidate'||b.build!=='settings-9804c2f')process.exit(1)})",
                ],
                "Interval": 10_000_000_000,
                "Timeout": 3_000_000_000,
                "StartPeriod": 10_000_000_000,
                "Retries": 3,
            },
            "Labels": {
                "com.docker.compose.project": recovery.CURRENT_PROJECT,
                "com.docker.compose.service": recovery.CURRENT_SERVICE,
                "com.docker.compose.config-hash": "transient",
                "com.docker.compose.project.config_files": "/tmp/deleted-source.json",
                "com.phone11.application-label": "preserved",
            },
        },
        "HostConfig": {
            "NetworkMode": recovery.NETWORK,
            "PortBindings": {"3005/tcp": [{"HostIp": "127.0.0.1", "HostPort": "3005"}]},
            "RestartPolicy": {"Name": "unless-stopped", "MaximumRetryCount": 0},
            "ReadonlyRootfs": False,
            "Privileged": False,
            "CapAdd": None,
            "CapDrop": None,
            "SecurityOpt": None,
            "Devices": None,
            "DeviceRequests": None,
            "IpcMode": "private",
            "Init": None,
            "PidsLimit": None,
            "Memory": recovery.EXPECTED_MEMORY,
            "NanoCpus": 0,
            "LogConfig": {"Type": "json-file", "Config": {}},
        },
        "NetworkSettings": {"Networks": {recovery.NETWORK: {}}},
        "Mounts": mounts,
    }


def arguments(output: Path):
    return recovery.parse_args([
        "--output", str(output), "--expected-container-id", CONTAINER_ID,
        "--expected-image", IMAGE, "--expected-build", BUILD,
    ])


class SettingsComposeRecoveryTests(unittest.TestCase):
    def test_recovered_compose_preserves_effective_environment_and_runtime_model(self):
        source = source_inspect()
        document = recovery.recovered_compose(
            source, expected_id=CONTAINER_ID, expected_image=IMAGE, expected_build=BUILD,
        )
        self.assertEqual(document["name"], recovery.CURRENT_PROJECT)
        self.assertEqual(set(document["services"]), {recovery.CURRENT_SERVICE})
        service = document["services"][recovery.CURRENT_SERVICE]
        self.assertEqual(service["container_name"], recovery.CURRENT_CONTAINER)
        self.assertEqual(service["image"], IMAGE)
        self.assertEqual(service["environment"]["DATABASE_URL"], "postgres://user:pa$$$$word@db/live")
        self.assertEqual(service["environment"]["PHONE11_LITERAL_DOLLAR"], "$$kept")
        self.assertEqual(service["entrypoint"], ["docker-entrypoint.sh"])
        self.assertEqual(service["command"], ["node", "dist/index.mjs"])
        self.assertEqual(service["ports"], [{
            "host_ip": "127.0.0.1", "published": "3005", "target": 3005,
            "protocol": "tcp", "mode": "ingress",
        }])
        self.assertEqual(service["expose"], ["3000/tcp", "3005/tcp"])
        self.assertEqual(service["networks"], [recovery.NETWORK])
        self.assertEqual(service["restart"], "unless-stopped")
        self.assertFalse(service["read_only"])
        self.assertEqual(service["ipc"], "private")
        self.assertEqual(service["mem_limit"], "2147483648b")
        self.assertEqual(service["logging"], {"driver": "json-file", "options": {}})
        self.assertEqual(len(service["volumes"]), 5)
        self.assertFalse(any(key.startswith("com.docker.compose.") for key in service["labels"]))
        self.assertEqual(document["networks"], {
            recovery.NETWORK: {"external": True, "name": recovery.NETWORK},
        })

    def test_rendered_compose_must_match_the_inspected_effective_runtime(self):
        source = source_inspect()
        rendered = recovery.recovered_compose(
            source, expected_id=CONTAINER_ID, expected_image=IMAGE, expected_build=BUILD,
        )
        recovery.validate_rendered(
            rendered, source,
            expected_id=CONTAINER_ID, expected_image=IMAGE, expected_build=BUILD,
        )
        for mutate in (
            lambda value: value["services"][recovery.CURRENT_SERVICE]["environment"].__setitem__("DATABASE_URL", "changed"),
            lambda value: value["services"][recovery.CURRENT_SERVICE]["ports"][0].__setitem__("published", "3006"),
            lambda value: next(
                item for item in value["services"][recovery.CURRENT_SERVICE]["volumes"]
                if item["target"] == "/var/lib/phone11/recordings"
            ).__setitem__("read_only", True),
            lambda value: value["services"][recovery.CURRENT_SERVICE].__setitem__("mem_limit", "1g"),
            lambda value: value["services"][recovery.CURRENT_SERVICE]["logging"].__setitem__("driver", "local"),
            lambda value: value["networks"][recovery.NETWORK].__setitem__("external", False),
        ):
            with self.subTest(mutate=mutate):
                changed = copy.deepcopy(rendered)
                mutate(changed)
                with self.assertRaises(recovery.GuardError):
                    recovery.validate_rendered(
                        changed, source,
                        expected_id=CONTAINER_ID, expected_image=IMAGE, expected_build=BUILD,
                    )

    def test_source_rejects_wrong_identity_or_unsupported_security_and_runtime_features(self):
        changes = (
            ("identity", lambda value: value.__setitem__("Id", "f" * 64)),
            ("compose_service", lambda value: value["Config"]["Labels"].__setitem__("com.docker.compose.service", "candidate")),
            ("privileged", lambda value: value["HostConfig"].__setitem__("Privileged", True)),
            ("capability", lambda value: value["HostConfig"].__setitem__("CapAdd", ["NET_ADMIN"])),
            ("security_opt", lambda value: value["HostConfig"].__setitem__("SecurityOpt", ["seccomp=unconfined"])),
            ("memory", lambda value: value["HostConfig"].__setitem__("Memory", 1)),
            ("extra_port", lambda value: value["HostConfig"]["PortBindings"].__setitem__("3000/tcp", [{"HostIp": "127.0.0.1", "HostPort": "3000"}])),
            ("mount", lambda value: value["Mounts"][0].__setitem__("Propagation", "shared")),
        )
        for name, mutate in changes:
            with self.subTest(name=name):
                source = source_inspect()
                mutate(source)
                with self.assertRaises(recovery.GuardError):
                    recovery.recovered_compose(
                        source, expected_id=CONTAINER_ID, expected_image=IMAGE, expected_build=BUILD,
                    )

    def test_healthcheck_roundtrip_retains_the_exact_docker_timing_model(self):
        source = source_inspect()
        original = source["Config"]["Healthcheck"]
        compose = recovery._health_to_compose(original, BUILD)
        self.assertEqual(compose, {
            "test": original["Test"], "interval": "10000000000ns",
            "timeout": "3000000000ns", "start_period": "10000000000ns", "retries": 3,
        })
        self.assertEqual(recovery._health_from_compose(compose), original)

    def test_recovery_uses_only_inspect_and_compose_config_then_publishes_once(self):
        source = source_inspect()
        rendered = recovery.recovered_compose(
            source, expected_id=CONTAINER_ID, expected_image=IMAGE, expected_build=BUILD,
        )
        system = Mock()
        system.json_command.side_effect = [[source], rendered]
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "recovered.json"
            args = arguments(output)
            with patch.object(recovery.os, "geteuid", return_value=0), \
                 patch.object(recovery, "secure_output_parent"), \
                 patch.object(recovery.os, "fchown"), \
                 patch.object(recovery, "validate_published"):
                output_sha, source_sha, rendered_sha = recovery.recover(args, system)
            self.assertEqual(json.loads(output.read_bytes()), rendered)
            self.assertEqual(output_sha, recovery.sha256_bytes(recovery.canonical_bytes(rendered)))
            self.assertEqual(source_sha, recovery.canonical_hash(recovery.candidate_runtime_shape(source)))
            self.assertEqual(rendered_sha, recovery.canonical_hash(rendered))
        self.assertEqual(system.command.call_count, 0)
        self.assertEqual(system.json_command.call_args_list[0].args[0], ["docker", "inspect", recovery.CURRENT_CONTAINER])
        self.assertIn("config", system.json_command.call_args_list[1].args[0])
        self.assertNotIn("up", system.json_command.call_args_list[1].args[0])

    def test_render_failure_never_publishes_the_unverified_secret_bearing_config(self):
        source = source_inspect()
        rendered = recovery.recovered_compose(
            source, expected_id=CONTAINER_ID, expected_image=IMAGE, expected_build=BUILD,
        )
        rendered["services"][recovery.CURRENT_SERVICE]["environment"]["DATABASE_URL"] = "drifted"
        system = Mock()
        system.json_command.side_effect = [[source], rendered]
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "recovered.json"
            with patch.object(recovery.os, "geteuid", return_value=0), \
                 patch.object(recovery, "secure_output_parent"), \
                 patch.object(recovery.os, "fchown"):
                with self.assertRaises(recovery.GuardError) as error:
                    recovery.recover(arguments(output), system)
            self.assertEqual(error.exception.stage, "compose_render")
            self.assertFalse(output.exists())

    def test_existing_or_non_root_output_name_is_refused_before_inspection(self):
        with patch.object(recovery.os.path, "lexists", return_value=True):
            with self.assertRaises(recovery.GuardError) as error:
                recovery.secure_output_parent(Path("/root/recovered.json"))
        self.assertEqual(error.exception.stage, "output")
        with self.assertRaises(recovery.GuardError):
            recovery.secure_output_parent(Path("/tmp/recovered.json"))


if __name__ == "__main__":
    unittest.main()
