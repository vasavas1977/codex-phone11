"""Hermetic safety tests for the additive password-recovery rollout."""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch


SCRIPT = Path(__file__).parents[1] / "scripts" / "phone11-recovery-rollout.py"
SPEC = importlib.util.spec_from_file_location("phone11_recovery_rollout", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
recovery = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = recovery
SPEC.loader.exec_module(recovery)

SHA = "1" * 64
BASE_IMAGE = "sha256:" + "2" * 64
LIVE_IMAGE = "sha256:" + "3" * 64
RELEASE_IMAGE = "sha256:" + "4" * 64
ORIGINAL = b"server {\n    # PHONE11_PARALLEL_API_INSERT reviewed-123\n}\n"
ORIGINAL_DUMP = b"original-dump"
SIGNIN_DUMP = b"signin-dump"
ROUTED_DUMP = b"routed-dump"


def manifest(**changes):
    value = {
        "schema": recovery.SCHEMA,
        "baseline": {"container_id": "a" * 64, "image": BASE_IMAGE, "runtime_sha256": SHA, "build": "baseline-a131764"},
        "live_candidate": {"container_id": "b" * 64, "image": LIVE_IMAGE, "runtime_sha256": SHA, "build": "web-39523ae"},
        "release": {"image": RELEASE_IMAGE, "build": "recovery-1234567", "source_sha": "5" * 40, "bundle_sha256": SHA, "lock_sha256": SHA},
        "secrets": {"file": "/root/recovery.json", "sha256": SHA},
        "nginx": {"site": "/etc/nginx/sites-enabled/api.phone11.ai", "site_sha256": SHA, "dump_sha256": SHA,
                  "marker": "# PHONE11_PARALLEL_API_INSERT reviewed-123"},
        "target": {"project": "phone11-password-recovery"}, "public_origin": recovery.PUBLIC_ORIGIN,
    }
    for dotted, replacement in changes.items():
        section, key = dotted.split("__", 1)
        value[section][key] = replacement
    return value


def live_inspect(pins):
    return {
        "Id": pins.live.container_id, "Image": pins.live.image,
        "State": {"Running": True, "Health": {"Status": "healthy"}},
        "Config": {"Image": pins.live.image, "Entrypoint": ["/entrypoint"], "Cmd": ["node", "dist/index.mjs"],
                   "User": "", "WorkingDir": "/app", "Env": [f"PHONE11_RUNTIME_ROLE={recovery.ROLE}", f"PHONE11_BUILD_SHA={pins.live.build}", f"PORT={recovery.LIVE_PORT}", "PHONE11_AUTH_SECRET=kept", "DATABASE_URL=kept"],
                   "Healthcheck": {"Test": ["CMD", "health", ":3003", pins.live.build]}, "Labels": {}},
        "HostConfig": {"NetworkMode": "phone11", "PortBindings": {"3003/tcp": [{"HostIp": "127.0.0.1", "HostPort": "3003"}]},
                       "RestartPolicy": {"Name": "unless-stopped"}, "ReadonlyRootfs": False, "Privileged": False, "CapAdd": None, "Devices": None},
        "NetworkSettings": {"Networks": {"phone11": {}}}, "Mounts": [],
    }


def target_inspect(pins):
    value = live_inspect(pins)
    value["Id"] = "c" * 64
    value["Image"] = pins.release_image
    value["Config"]["Image"] = pins.release_image
    value["Config"]["Env"] = [
        f"PHONE11_RUNTIME_ROLE={recovery.ROLE}",
        f"PHONE11_BUILD_SHA={pins.release_build}",
        f"PORT={recovery.TARGET_PORT}",
        "PHONE11_AUTH_SECRET=kept",
        "DATABASE_URL=kept",
        f"PHONE11_AUTH_TRUSTED_ORIGINS={recovery.RESET_UI_ORIGIN}",
        "PHONE11_PASSWORD_RESET_PROVIDER=resend",
        "PHONE11_PASSWORD_RESET_RESEND_API_KEY=re_secret",
        "PHONE11_PASSWORD_RESET_FROM=noreply@phone11.ai",
    ]
    value["Config"]["Labels"] = {
        "com.docker.compose.project": pins.target_project,
        "com.docker.compose.service": recovery.TARGET_SERVICE,
        "com.phone11.source-sha": pins.release_source_sha,
        "com.phone11.bundle-sha256": pins.release_bundle_sha256,
        "com.phone11.lock-sha256": pins.release_lock_sha256,
        "com.phone11.candidate-build": pins.release_build,
        "com.phone11.recovery-only": "true",
    }
    value["HostConfig"]["PortBindings"] = {
        f"{recovery.TARGET_PORT}/tcp": [{"HostIp": "127.0.0.1", "HostPort": str(recovery.TARGET_PORT)}],
    }
    return value


def phase_receipt(pins, phase):
    marker = manifest()["nginx"]["marker"]
    signin = ORIGINAL.replace(marker.encode(), recovery.signin_proxy_fragment(marker, pins.release_build).rstrip(b"\n"))
    routed = ORIGINAL.replace(marker.encode(), recovery.proxy_fragment(marker, pins.release_build).rstrip(b"\n"))
    target = target_inspect(pins)
    signin_dump = recovery.sha256_bytes(SIGNIN_DUMP) if phase not in {
        recovery.PHASE_PRE_CONTAINER,
        recovery.PHASE_PRE_SIGNIN,
    } else None
    routed_dump = recovery.sha256_bytes(ROUTED_DUMP) if phase in {
        recovery.PHASE_ROUTED_DRAINED,
        recovery.PHASE_ACTIVE,
        recovery.PHASE_POST_ORIGINAL,
        recovery.PHASE_ROLLED_BACK,
    } else None
    return {
        "schema": recovery.SCHEMA,
        "phase": phase,
        "manifest_sha256": SHA,
        "original_sha256": recovery.sha256_bytes(ORIGINAL),
        "signin_sha256": recovery.sha256_bytes(signin),
        "routed_sha256": recovery.sha256_bytes(routed),
        "original_dump_sha256": recovery.sha256_bytes(ORIGINAL_DUMP),
        "signin_dump_sha256": signin_dump,
        "routed_dump_sha256": routed_dump,
        "baseline_snapshot_sha256": SHA,
        "target_container_id": None if phase == recovery.PHASE_PRE_CONTAINER else target["Id"],
        "target_runtime_sha256": None if phase == recovery.PHASE_PRE_CONTAINER else recovery.canonical_hash(recovery.candidate_runtime_shape(target)),
    }


class RecoveryRolloutTests(unittest.TestCase):
    def test_manifest_rejects_mutable_images_origins_and_existing_projects(self):
        recovery.parse_manifest(manifest())
        for changes in ({"release__image": "latest"}, {"release__image": LIVE_IMAGE}, {"target__project": "phone11-api-candidate-next"}):
            with self.subTest(changes=changes), self.assertRaises(recovery.GuardError):
                recovery.parse_manifest(manifest(**changes))
        changed = manifest(); changed["public_origin"] = "https://evil.example"
        with self.assertRaises(recovery.GuardError): recovery.parse_manifest(changed)

    def test_secret_file_is_exact_and_never_part_of_manifest(self):
        raw = json.dumps({"schema": recovery.SECRET_SCHEMA, "provider": "resend", "resend_api_key": "re_secret", "from": "Phone11 <noreply@phone11.ai>"}).encode()
        values = recovery.load_secrets(raw, recovery.sha256_bytes(raw))
        self.assertEqual(values["PHONE11_PASSWORD_RESET_RESEND_API_KEY"], "re_secret")
        self.assertNotIn("re_secret", json.dumps(manifest()))
        for changed in ({**json.loads(raw), "extra": True}, {**json.loads(raw), "provider": "other"}, {**json.loads(raw), "resend_api_key": "bad key"}):
            encoded = json.dumps(changed).encode()
            with self.assertRaises(recovery.GuardError): recovery.load_secrets(encoded, recovery.sha256_bytes(encoded))

    def test_nginx_fragment_routes_only_four_exact_paths(self):
        marker = manifest()["nginx"]["marker"]
        text = recovery.proxy_fragment(marker, "recovery-1234567").decode()
        self.assertEqual(text.count("location = "), 4)
        self.assertEqual(text.count("127.0.0.1:3004"), 4)
        for path in ("/api/auth/sign-in/email", "/api/mobile/config", "/api/auth/request-password-reset", "/api/auth/reset-password"):
            self.assertIn(f"location = {path} {{", text)
        signin = recovery.signin_proxy_fragment(marker, "recovery-1234567").decode()
        self.assertEqual(signin.count("location = "), 1)
        self.assertIn("location = /api/auth/sign-in/email {", signin)
        for protected in ("/api/auth/sign-out", "/api/auth/me", "/api/trpc"):
            self.assertNotIn(protected, text)

    def test_clone_preserves_identity_environment_and_adds_only_recovery_config(self):
        pins = recovery.parse_manifest(manifest())
        source = live_inspect(pins)
        source["Config"]["Env"].append(f"PHONE11_AUTH_TRUSTED_ORIGINS={recovery.RESET_UI_ORIGIN}")
        secret = {"PHONE11_PASSWORD_RESET_PROVIDER": "resend", "PHONE11_PASSWORD_RESET_RESEND_API_KEY": "re_secret", "PHONE11_PASSWORD_RESET_FROM": "Phone11 <noreply@phone11.ai>"}
        rendered = recovery.cloned_config(source, pins, secret)
        service = rendered["services"][recovery.TARGET_SERVICE]
        self.assertEqual(service["image"], RELEASE_IMAGE)
        self.assertEqual(service["ports"], [{"host_ip": "127.0.0.1", "published": "3004", "target": 3004, "protocol": "tcp", "mode": "ingress"}])
        self.assertEqual(service["environment"]["PHONE11_AUTH_SECRET"], "kept")
        self.assertEqual(service["environment"]["DATABASE_URL"], "kept")
        self.assertEqual(service["environment"]["PHONE11_PASSWORD_RESET_RESEND_API_KEY"], "re_secret")
        self.assertEqual(service["environment"]["PORT"], "3004")
        self.assertEqual(service["healthcheck"], {
            "test": ["CMD", "health", ":3004", pins.release_build],
        })
        self.assertNotIn("depends_on", service)

    def test_healthcheck_roundtrip_preserves_docker_timing_and_rewrites_identity(self):
        raw = {
            "Test": ["CMD", "health", ":3003", "management-1234567"],
            "Interval": 10_000_000_000,
            "Timeout": 3_000_000_000,
            "Retries": 3,
            "StartPeriod": 10_000_000_000,
        }
        compose = recovery.compose_healthcheck(raw, "management-1234567", "recovery-1234567")
        self.assertEqual(compose, {
            "test": ["CMD", "health", ":3004", "recovery-1234567"],
            "interval": "10000000000ns",
            "timeout": "3000000000ns",
            "retries": 3,
            "start_period": "10000000000ns",
        })
        self.assertEqual(recovery.docker_healthcheck(compose), recovery._rewrite(
            raw, "management-1234567", "recovery-1234567",
        ))
        with self.assertRaises(recovery.GuardError):
            recovery.compose_healthcheck({**raw, "Unexpected": 1}, "management-1234567", "recovery-1234567")

    def test_target_wait_tolerates_starting_health_then_requires_full_readiness(self):
        pins = recovery.parse_manifest(manifest())
        operator = recovery.Operator(pins, Mock(), SHA)
        ready = target_inspect(pins)
        operator.target = Mock(side_effect=[recovery.GuardError("target_runtime"), ready])
        with patch.object(recovery.time, "sleep"):
            self.assertEqual(operator.wait_target(), ready)
        self.assertEqual(operator.target.call_count, 2)

    def test_clone_strips_reserved_compose_labels(self):
        pins = recovery.parse_manifest(manifest())
        source = live_inspect(pins)
        source["Config"]["Env"].append(f"PHONE11_AUTH_TRUSTED_ORIGINS={recovery.RESET_UI_ORIGIN}")
        source["Config"]["Labels"] = {
            "com.docker.compose.project": "phone11-api-candidate-next",
            "com.docker.compose.service": "candidate",
            "com.phone11.source-sha": "0" * 40,
            "com.phone11.bundle-sha256": "0" * 64,
            "com.example.retained": "yes",
        }
        rendered = recovery.cloned_config(source, pins, {})
        labels = rendered["services"][recovery.TARGET_SERVICE]["labels"]
        self.assertEqual(labels["com.example.retained"], "yes")
        self.assertFalse(any(key.startswith("com.docker.compose.") for key in labels))
        self.assertNotIn("com.phone11.source-sha", labels)
        self.assertNotIn("com.phone11.bundle-sha256", labels)

    def test_clone_refuses_overwriting_existing_recovery_settings(self):
        pins = recovery.parse_manifest(manifest())
        source = live_inspect(pins)
        source["Config"]["Env"].append(f"PHONE11_AUTH_TRUSTED_ORIGINS={recovery.RESET_UI_ORIGIN}")
        source["Config"]["Env"].append("PHONE11_PASSWORD_RESET_PROVIDER=old")
        with self.assertRaises(recovery.GuardError):
            recovery.cloned_config(source, pins, {"PHONE11_PASSWORD_RESET_PROVIDER": "resend"})

    def test_clone_accepts_mounted_live_source_but_never_inherits_volumes(self):
        pins = recovery.parse_manifest(manifest())
        source = live_inspect(pins)
        source["Config"]["Env"].append(f"PHONE11_AUTH_TRUSTED_ORIGINS={recovery.RESET_UI_ORIGIN}")
        source["Mounts"] = [{
            "Type": "bind", "Source": "/source/runtime-data",
            "Destination": "/var/lib/phone11", "RW": True,
        }]
        rendered = recovery.cloned_config(source, pins, {})
        service = rendered["services"][recovery.TARGET_SERVICE]
        self.assertNotIn("volumes", service)
        self.assertNotIn("mounts", service)

    def test_clone_requires_the_verified_public_reset_ui_origin(self):
        pins = recovery.parse_manifest(manifest())
        with self.assertRaises(recovery.GuardError) as raised:
            recovery.cloned_config(live_inspect(pins), pins, {})
        self.assertEqual(raised.exception.stage, "trusted_origin")

    def test_config_readiness_preserves_every_existing_field(self):
        baseline = {"authProvider": "phone11", "emailPasswordEnabled": True, "registrationEnabled": False, "futureField": "kept"}
        ready = {**baseline, "passwordResetEnabled": True, "passwordResetAvailability": "general"}
        system = Mock()
        system.request.return_value = recovery.pilot.HttpResult(
            200, json.dumps(ready).encode(), {"cache-control": ("no-store",), recovery.RECOVERY_HEADER: ("recovery-1234567",)},
        )
        recovery.config_ready(system, recovery.PUBLIC_ORIGIN, baseline, "recovery-1234567")
        for incompatible in ({**ready, "futureField": "changed"}, {**ready, "unexpected": True}):
            system.request.return_value = recovery.pilot.HttpResult(200, json.dumps(incompatible).encode(), {"cache-control": ("no-store",)})
            with self.assertRaises(recovery.GuardError) as raised:
                recovery.config_ready(system, "http://127.0.0.1:3004", baseline)
            self.assertEqual(raised.exception.stage, "config_compatibility")

    def test_baseline_mobile_config_accepts_disabled_or_legacy_recovery(self):
        system = Mock()
        headers = {"cache-control": ("no-store",)}
        for body in (
            {"authProvider": "phone11", "emailPasswordEnabled": True, "registrationEnabled": False,
             "passwordResetEnabled": False, "passwordResetAvailability": "disabled"},
            {"authProvider": "phone11", "emailPasswordEnabled": True, "registrationEnabled": False},
        ):
            with self.subTest(body=body):
                system.request.return_value = recovery.pilot.HttpResult(200, json.dumps(body).encode(), headers)
                self.assertEqual(recovery.read_baseline_mobile_config(system, "http://127.0.0.1:3003"), body)

    def test_target_rejects_wrong_compose_ownership_or_runtime(self):
        pins = recovery.parse_manifest(manifest())
        operator = recovery.Operator(pins, Mock(), SHA)
        expected = target_inspect(pins)
        operator.expected_env = recovery.environment(expected, "test")
        operator.target_config = {
            "services": {
                recovery.TARGET_SERVICE: {
                    "networks": ["phone11"], "restart": "unless-stopped", "read_only": False,
                    "entrypoint": ["/entrypoint"], "command": ["node", "dist/index.mjs"],
                    "working_dir": "/app",
                },
            },
        }
        for drift in ("project", "privileged", "mount"):
            target = target_inspect(pins)
            if drift == "project":
                target["Config"]["Labels"]["com.docker.compose.project"] = "wrong-project"
            elif drift == "privileged":
                target["HostConfig"]["Privileged"] = True
            else:
                target["Mounts"] = [{"Type": "bind", "Source": "/tmp", "Destination": "/host"}]
            with self.subTest(drift=drift), patch.object(recovery, "one_inspect", return_value=target):
                with self.assertRaises(recovery.GuardError) as raised:
                    operator.target()
                self.assertEqual(raised.exception.stage, "target_runtime")

    def test_post_validation_uses_options_and_never_sends_reset_data(self):
        system = Mock()
        system.request.return_value = recovery.pilot.HttpResult(204, b"", {
            "access-control-allow-origin": (recovery.RESET_UI_ORIGIN,),
            "access-control-allow-methods": ("GET, POST, OPTIONS",),
            recovery.RECOVERY_HEADER: ("recovery-1234567",),
        })
        recovery.recovery_preflights(system, recovery.PUBLIC_ORIGIN, "recovery-1234567")
        self.assertEqual(system.request.call_count, 2)
        for call in system.request.call_args_list:
            probe = call.args[1]
            self.assertEqual(probe["method"], "OPTIONS")
            self.assertEqual(probe["body"], "")
            self.assertEqual(probe["headers"]["Access-Control-Request-Method"], "POST")

    def test_prepare_never_starts_or_changes_services(self):
        pins = recovery.parse_manifest(manifest())
        system = Mock()
        operator = recovery.Operator(pins, system, SHA)
        live = live_inspect(pins)
        live["Config"]["Env"].append(f"PHONE11_AUTH_TRUSTED_ORIGINS={recovery.RESET_UI_ORIGIN}")
        operator.pinned_runtime = Mock(side_effect=[{}, live])
        operator.image = Mock(); operator.nginx = Mock(return_value=b"site")
        system.command.side_effect = [b"", b""]
        secret_raw = json.dumps({"schema": recovery.SECRET_SCHEMA, "provider": "resend", "resend_api_key": "re_secret", "from": "noreply@phone11.ai"}).encode()
        operator.pins = recovery.parse_manifest(manifest(secrets__sha256=recovery.sha256_bytes(secret_raw)))
        with patch.object(recovery, "secure_read", return_value=secret_raw), patch.object(recovery, "baseline_snapshot", return_value=[]):
            operator.prepare()
        flattened = [item for call in system.command.call_args_list for item in call.args[0]]
        self.assertNotIn("up", flattened); self.assertNotIn("reload", flattened); self.assertNotIn("rm", flattened)

    def test_secret_compose_cleanup_failure_is_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            snapshot = Path(directory) / "snapshot"
            snapshot.mkdir()
            compose = snapshot / "compose.json"

            def write(path, content, **_kwargs):
                path.write_bytes(content)

            original_unlink = Path.unlink

            def fail_snapshot_unlink(path, *args, **kwargs):
                if path == compose:
                    raise OSError("injected cleanup failure")
                return original_unlink(path, *args, **kwargs)

            with patch.object(recovery.tempfile, "mkdtemp", return_value=str(snapshot)), \
                 patch.object(recovery, "atomic_write", side_effect=write), \
                 patch.object(Path, "unlink", fail_snapshot_unlink):
                with self.assertRaises(recovery.GuardError) as raised:
                    with recovery.frozen_recovery_config({"environment": {"SECRET": "kept"}}):
                        pass
            self.assertEqual(raised.exception.stage, "candidate_config_cleanup")
            self.assertTrue(compose.exists())
            compose.unlink()
            snapshot.rmdir()

    def test_transition_rechecks_site_and_dump_before_mutation(self):
        pins = recovery.parse_manifest(manifest())
        operator = recovery.Operator(pins, Mock(), SHA)
        with patch.object(recovery, "secure_read", return_value=b"drifted"), \
             patch.object(recovery, "atomic_write") as writer:
            with self.assertRaises(recovery.GuardError) as raised:
                operator.transition(b"expected", b"replacement", SHA, "signin_cutover")
        self.assertEqual(raised.exception.stage, "signin_cutover")
        writer.assert_not_called()

    def test_transition_completes_reload_and_drain_after_committed_rename_error(self):
        with tempfile.TemporaryDirectory() as directory:
            site = Path(directory) / "site"
            site.write_bytes(b"expected")
            before_dump = b"before-dump"
            pins = recovery.parse_manifest(manifest(nginx__site=str(site), nginx__dump_sha256=recovery.sha256_bytes(before_dump)))
            system = Mock()

            def command(args, **_kwargs):
                if args == ["nginx", "-T"]:
                    return before_dump if site.read_bytes() == b"expected" else b"after-dump"
                if args == ["ps", "-eo", "pid=,args="]:
                    return b"10 nginx: worker process\n" if site.read_bytes() == b"expected" else b"20 nginx: worker process\n"
                return b""

            system.command.side_effect = command
            operator = recovery.Operator(pins, system, SHA)

            def committed_write(path, content, **_kwargs):
                path.write_bytes(content)
                raise recovery.AtomicWriteError(committed=True)

            with patch.object(recovery, "secure_read", side_effect=lambda path, **_kwargs: Path(path).read_bytes()), \
                 patch.object(recovery, "atomic_write", side_effect=committed_write), \
                 patch.object(recovery, "wait_for_nginx_worker_drain") as drain:
                with self.assertRaises(recovery.AtomicWriteError):
                    operator.transition(b"expected", b"replacement", recovery.sha256_bytes(before_dump), "signin_cutover")
            self.assertEqual(site.read_bytes(), b"replacement")
            drain.assert_called_once_with(system, {10})
            self.assertIn(["systemctl", "reload", "nginx"], [call.args[0] for call in system.command.call_args_list])

    def test_nginx_worker_drain_waits_for_every_old_worker(self):
        system = Mock()
        system.command.side_effect = [
            b"10 nginx: worker process\n11 nginx: worker process\n12 nginx: worker process\n",
            b"11 nginx: worker process\n12 nginx: worker process\n",
            b"20 nginx: worker process\n21 nginx: worker process\n",
        ]
        with patch.object(recovery.time, "monotonic", return_value=0.0), \
             patch.object(recovery.time, "sleep"):
            recovery.wait_for_nginx_worker_drain(system, {10, 11})
        self.assertEqual(system.command.call_count, 3)

    def test_nginx_worker_drain_timeout_is_fail_closed(self):
        system = Mock()
        system.command.return_value = b"10 nginx: worker process is shutting down\n20 nginx: worker process\n"
        with patch.object(recovery, "NGINX_DRAIN_TIMEOUT_SECONDS", 1.0), \
             patch.object(recovery.time, "monotonic", side_effect=[0.0, 0.0, 0.5, 1.0]), \
             patch.object(recovery.time, "sleep"):
            with self.assertRaises(recovery.GuardError) as raised:
                recovery.wait_for_nginx_worker_drain(system, {10})
        self.assertEqual(raised.exception.stage, "nginx_drain")

    def test_restore_hides_recovery_and_drains_before_restoring_signin(self):
        pins = recovery.parse_manifest(manifest())
        operator = recovery.Operator(pins, Mock(), SHA)
        original, signin, routed = b"original", b"signin", b"routed"
        current = [routed]
        transitions = []

        def read(_path, **_kwargs):
            return current[0]

        def transition(expected, replacement, dump, stage):
            self.assertEqual(current[0], expected)
            transitions.append((expected, replacement, dump, stage))
            current[0] = replacement
            return "signin-dump" if replacement == signin else "original-dump"

        operator.transition = Mock(side_effect=transition)
        operator.nginx = Mock(return_value=original)
        with patch.object(recovery, "secure_read", side_effect=read):
            operator.restore(original, signin, routed, "routed-dump")
        self.assertEqual(
            transitions,
            [
                (routed, signin, "routed-dump", "rollback_hide_recovery"),
                (signin, original, "signin-dump", "rollback_restore_signin"),
            ],
        )

    def _continue_from_phase(self, phase):
        pins = recovery.parse_manifest(manifest())
        system = Mock()
        operator = recovery.Operator(pins, system, SHA)
        receipt = phase_receipt(pins, phase)
        signin, routed = operator.route_bytes(ORIGINAL)
        current = [
            ORIGINAL if phase == recovery.PHASE_PRE_SIGNIN
            else signin if phase == recovery.PHASE_SIGNIN_DRAINED
            else routed
        ]
        transitions = []

        def transition(expected, replacement, dump, stage):
            self.assertEqual(current[0], expected)
            transitions.append((stage, dump))
            current[0] = replacement
            return recovery.sha256_bytes(SIGNIN_DUMP if replacement == signin else ROUTED_DUMP)

        def command(args, **_kwargs):
            if args == ["nginx", "-T"]:
                return SIGNIN_DUMP if current[0] == signin else ROUTED_DUMP
            return b""

        operator.transition = Mock(side_effect=transition)
        operator.receipt_routes = Mock(return_value=(ORIGINAL, signin, routed))
        operator.write_receipt = Mock(side_effect=lambda value: operator.validate_receipt(value))
        operator.pinned_runtime = Mock()
        operator.target = Mock(return_value=target_inspect(pins))
        system.command.side_effect = command
        with patch.object(recovery, "secure_read", side_effect=lambda *_args, **_kwargs: current[0]), \
             patch.object(recovery, "baseline_snapshot_sha256", return_value=SHA), \
             patch.object(recovery, "credential_serialization_ready"), \
             patch.object(recovery, "read_baseline_mobile_config", return_value={}), \
             patch.object(recovery, "config_ready"), patch.object(recovery, "recovery_preflights"):
            completed = operator.continue_activation(receipt)
        return completed, transitions

    def _continue_from_precontainer(self, target_present):
        pins = recovery.parse_manifest(manifest())
        system = Mock()
        operator = recovery.Operator(pins, system, SHA)
        receipt = phase_receipt(pins, recovery.PHASE_PRE_CONTAINER)
        signin, routed = operator.route_bytes(ORIGINAL)
        current = [ORIGINAL]
        compose_starts = []

        def command(args, **_kwargs):
            if args[:3] == ["docker", "ps", "-a"]:
                return (recovery.TARGET_CONTAINER + "\n").encode() if target_present else b""
            if args[:2] == ["docker", "compose"]:
                compose_starts.append(args)
                return b""
            if args == ["nginx", "-T"]:
                return {
                    ORIGINAL: ORIGINAL_DUMP,
                    signin: SIGNIN_DUMP,
                    routed: ROUTED_DUMP,
                }[current[0]]
            return b""

        def transition(expected, replacement, _dump, _stage):
            self.assertEqual(current[0], expected)
            current[0] = replacement
            return recovery.sha256_bytes(SIGNIN_DUMP if replacement == signin else ROUTED_DUMP)

        operator.target_config = {"name": pins.target_project, "services": {recovery.TARGET_SERVICE: {}}}
        operator.expected_env = {}
        operator.target = Mock(return_value=target_inspect(pins))
        operator.transition = Mock(side_effect=transition)
        operator.receipt_routes = Mock(return_value=(ORIGINAL, signin, routed))
        operator.write_receipt = Mock(side_effect=lambda value: operator.validate_receipt(value))
        operator.pinned_runtime = Mock()
        system.command.side_effect = command
        with patch.object(recovery, "secure_read", side_effect=lambda *_args, **_kwargs: current[0]), \
             patch.object(recovery, "baseline_snapshot_sha256", return_value=SHA), \
             patch.object(recovery, "credential_serialization_ready"), \
             patch.object(recovery, "read_baseline_mobile_config", return_value={}), \
             patch.object(recovery, "config_ready"), patch.object(recovery, "recovery_preflights"), \
             patch.object(recovery, "frozen_recovery_config") as frozen:
            frozen.return_value.__enter__.return_value = Path("/tmp/frozen-recovery")
            completed = operator.continue_activation(receipt)
        return completed, compose_starts, operator.target.call_count

    def test_precontainer_reentry_starts_target_when_absent(self):
        completed, compose_starts, target_checks = self._continue_from_precontainer(False)
        self.assertEqual(completed["phase"], recovery.PHASE_ACTIVE)
        self.assertEqual(len(compose_starts), 1)
        self.assertGreaterEqual(target_checks, 3)

    def test_precontainer_reentry_adopts_exact_existing_target(self):
        completed, compose_starts, target_checks = self._continue_from_precontainer(True)
        self.assertEqual(completed["phase"], recovery.PHASE_ACTIVE)
        self.assertEqual(compose_starts, [])
        self.assertGreaterEqual(target_checks, 3)

    def test_pre_signin_receipt_resumes_both_drained_phases(self):
        completed, transitions = self._continue_from_phase(recovery.PHASE_PRE_SIGNIN)
        self.assertEqual(completed["phase"], recovery.PHASE_ACTIVE)
        self.assertEqual([stage for stage, _dump in transitions], ["signin_cutover", "recovery_publish"])

    def test_signin_drained_receipt_resumes_only_recovery_publish(self):
        completed, transitions = self._continue_from_phase(recovery.PHASE_SIGNIN_DRAINED)
        self.assertEqual(completed["phase"], recovery.PHASE_ACTIVE)
        self.assertEqual([stage for stage, _dump in transitions], ["recovery_publish"])

    def test_routed_drained_receipt_resumes_only_final_validation(self):
        completed, transitions = self._continue_from_phase(recovery.PHASE_ROUTED_DRAINED)
        self.assertEqual(completed["phase"], recovery.PHASE_ACTIVE)
        self.assertEqual(transitions, [])

    def test_active_receipt_reentry_is_idempotent(self):
        completed, transitions = self._continue_from_phase(recovery.PHASE_ACTIVE)
        self.assertEqual(completed["phase"], recovery.PHASE_ACTIVE)
        self.assertEqual(transitions, [])

    def test_ambiguous_advanced_route_rolls_back_instead_of_resuming(self):
        pins = recovery.parse_manifest(manifest())
        operator = recovery.Operator(pins, Mock(), SHA)
        receipt = phase_receipt(pins, recovery.PHASE_SIGNIN_DRAINED)
        signin, routed = operator.route_bytes(ORIGINAL)
        operator.receipt_routes = Mock(return_value=(ORIGINAL, signin, routed))
        operator.rollback_receipt = Mock()
        with patch.object(recovery, "secure_read", return_value=routed):
            with self.assertRaises(recovery.GuardError) as raised:
                operator.continue_activation(receipt)
        self.assertEqual(raised.exception.stage, "activation_recovered")
        operator.rollback_receipt.assert_called_once_with(receipt)

    def test_post_original_receipt_resumes_cleanup_without_route_mutation(self):
        pins = recovery.parse_manifest(manifest())
        system = Mock()
        operator = recovery.Operator(pins, system, SHA)
        receipt = phase_receipt(pins, recovery.PHASE_POST_ORIGINAL)
        signin, routed = operator.route_bytes(ORIGINAL)
        operator.receipt_routes = Mock(return_value=(ORIGINAL, signin, routed))
        operator.nginx = Mock(return_value=ORIGINAL)
        operator.public_rollback_absent = Mock()
        operator.pinned_runtime = Mock()
        operator.cleanup_target = Mock()
        operator.transition = Mock()
        operator.write_receipt = Mock(side_effect=lambda value: operator.validate_receipt(value))
        system.command.return_value = b""
        with patch.object(recovery, "secure_read", return_value=ORIGINAL):
            completed = operator.rollback_receipt(receipt)
        self.assertEqual(completed["phase"], recovery.PHASE_ROLLED_BACK)
        operator.transition.assert_not_called()
        operator.cleanup_target.assert_not_called()
        self.assertEqual(operator.pinned_runtime.call_count, 2)

    def test_precontainer_rollback_handles_absent_or_strict_owned_orphan(self):
        pins = recovery.parse_manifest(manifest())
        for target_present in (False, True):
            with self.subTest(target_present=target_present):
                system = Mock()
                operator = recovery.Operator(pins, system, SHA)
                receipt = phase_receipt(pins, recovery.PHASE_PRE_CONTAINER)
                signin, routed = operator.route_bytes(ORIGINAL)
                target = target_inspect(pins)
                operator.expected_env = {}
                operator.receipt_routes = Mock(return_value=(ORIGINAL, signin, routed))
                operator.nginx = Mock(return_value=ORIGINAL)
                operator.public_rollback_absent = Mock()
                operator.pinned_runtime = Mock()
                operator.owned_target = Mock(return_value=target)
                operator.cleanup_target = Mock()
                operator.restore = Mock()
                operator.transition = Mock()
                operator.write_receipt = Mock(side_effect=lambda value: operator.validate_receipt(value))

                def command(args, **_kwargs):
                    if args[:3] == ["docker", "ps", "-a"]:
                        return (recovery.TARGET_CONTAINER + "\n").encode() if target_present else b""
                    return ORIGINAL_DUMP if args == ["nginx", "-T"] else b""

                system.command.side_effect = command
                with patch.object(recovery, "secure_read", return_value=ORIGINAL):
                    completed = operator.rollback_receipt(receipt)

                self.assertEqual(completed["phase"], recovery.PHASE_ROLLED_BACK)
                operator.restore.assert_not_called()
                operator.transition.assert_not_called()
                self.assertEqual(operator.pinned_runtime.call_count, 2)
                if target_present:
                    operator.owned_target.assert_called_once_with()
                    operator.cleanup_target.assert_called_once_with(target["Id"])
                else:
                    operator.owned_target.assert_not_called()
                    operator.cleanup_target.assert_not_called()

    def test_rollback_journals_post_original_before_target_cleanup(self):
        pins = recovery.parse_manifest(manifest())
        system = Mock()
        operator = recovery.Operator(pins, system, SHA)
        receipt = phase_receipt(pins, recovery.PHASE_ACTIVE)
        signin, routed = operator.route_bytes(ORIGINAL)
        target = target_inspect(pins)
        current = [routed]
        events = []
        operator.receipt_routes = Mock(return_value=(ORIGINAL, signin, routed))
        operator.public_rollback_absent = Mock()
        operator.pinned_runtime = Mock()

        def restore(*_args):
            events.append("restore")
            current[0] = ORIGINAL

        def advance(value, phase, **updates):
            events.append(f"receipt:{phase}")
            return operator.validate_receipt({**dict(value), **updates, "phase": phase})

        def cleanup(_target_id):
            events.append("cleanup")

        def command(args, **_kwargs):
            if args[:3] == ["docker", "ps", "-a"]:
                return (recovery.TARGET_CONTAINER + "\n").encode()
            if args == ["nginx", "-T"]:
                return ROUTED_DUMP
            return b""

        operator.restore = Mock(side_effect=restore)
        operator.advance_receipt = Mock(side_effect=advance)
        operator.cleanup_target = Mock(side_effect=cleanup)
        system.command.side_effect = command
        with patch.object(recovery, "secure_read", side_effect=lambda *_args, **_kwargs: current[0]), \
             patch.object(recovery, "one_inspect", return_value=target):
            completed = operator.rollback_receipt(receipt)
        self.assertEqual(completed["phase"], recovery.PHASE_ROLLED_BACK)
        self.assertEqual(
            events,
            ["restore", f"receipt:{recovery.PHASE_POST_ORIGINAL}", "cleanup", f"receipt:{recovery.PHASE_ROLLED_BACK}"],
        )

    def test_old_phase_with_original_bytes_forces_a_confirming_drain(self):
        pins = recovery.parse_manifest(manifest())
        system = Mock()
        operator = recovery.Operator(pins, system, SHA)
        receipt = phase_receipt(pins, recovery.PHASE_ACTIVE)
        signin, routed = operator.route_bytes(ORIGINAL)
        target = target_inspect(pins)
        operator.receipt_routes = Mock(return_value=(ORIGINAL, signin, routed))
        operator.nginx = Mock(return_value=ORIGINAL)
        operator.public_rollback_absent = Mock()
        operator.pinned_runtime = Mock()
        operator.cleanup_target = Mock()
        operator.write_receipt = Mock(side_effect=lambda value: operator.validate_receipt(value))
        operator.transition = Mock(return_value=recovery.sha256_bytes(ORIGINAL_DUMP))

        def command(args, **_kwargs):
            if args[:3] == ["docker", "ps", "-a"]:
                return (recovery.TARGET_CONTAINER + "\n").encode()
            if args == ["nginx", "-T"]:
                return ORIGINAL_DUMP
            return b""

        system.command.side_effect = command
        with patch.object(recovery, "secure_read", return_value=ORIGINAL), \
             patch.object(recovery, "one_inspect", return_value=target):
            operator.rollback_receipt(receipt)
        operator.transition.assert_called_once_with(
            ORIGINAL, ORIGINAL, recovery.sha256_bytes(ORIGINAL_DUMP), "rollback_confirm_original",
        )

    def test_rollback_reentry_matrix_restores_routes_before_target_cleanup(self):
        pins = recovery.parse_manifest(manifest())
        cases = (
            (recovery.PHASE_PRE_SIGNIN, "original", "confirm"),
            (recovery.PHASE_PRE_SIGNIN, "signin", "restore"),
            (recovery.PHASE_SIGNIN_DRAINED, "signin", "restore"),
            (recovery.PHASE_SIGNIN_DRAINED, "routed", "restore"),
            (recovery.PHASE_ROUTED_DRAINED, "routed", "restore"),
            (recovery.PHASE_POST_ORIGINAL, "original", "none"),
        )
        for phase, route_name, expected_route_action in cases:
            with self.subTest(phase=phase, route=route_name):
                system = Mock()
                operator = recovery.Operator(pins, system, SHA)
                receipt = phase_receipt(pins, phase)
                signin, routed = operator.route_bytes(ORIGINAL)
                routes = {"original": ORIGINAL, "signin": signin, "routed": routed}
                current = [routes[route_name]]
                target = target_inspect(pins)
                operator.receipt_routes = Mock(return_value=(ORIGINAL, signin, routed))
                operator.nginx = Mock(return_value=ORIGINAL)
                operator.public_rollback_absent = Mock()
                operator.pinned_runtime = Mock()
                operator.cleanup_target = Mock()
                operator.write_receipt = Mock(side_effect=lambda value: operator.validate_receipt(value))

                def command(args, **_kwargs):
                    if args[:3] == ["docker", "ps", "-a"]:
                        return (recovery.TARGET_CONTAINER + "\n").encode()
                    if args == ["nginx", "-T"]:
                        return {
                            ORIGINAL: ORIGINAL_DUMP,
                            signin: SIGNIN_DUMP,
                            routed: ROUTED_DUMP,
                        }[current[0]]
                    return b""

                def restore(*_args):
                    current[0] = ORIGINAL

                def confirm(*_args):
                    current[0] = ORIGINAL
                    return recovery.sha256_bytes(ORIGINAL_DUMP)

                system.command.side_effect = command
                operator.restore = Mock(side_effect=restore)
                operator.transition = Mock(side_effect=confirm)
                with patch.object(recovery, "secure_read", side_effect=lambda *_args, **_kwargs: current[0]), \
                     patch.object(recovery, "one_inspect", return_value=target):
                    completed = operator.rollback_receipt(receipt)

                self.assertEqual(completed["phase"], recovery.PHASE_ROLLED_BACK)
                self.assertEqual(operator.pinned_runtime.call_count, 2)
                operator.cleanup_target.assert_called_once_with(receipt["target_container_id"])
                if expected_route_action == "restore":
                    operator.restore.assert_called_once()
                    operator.transition.assert_not_called()
                elif expected_route_action == "confirm":
                    operator.restore.assert_not_called()
                    operator.transition.assert_called_once()
                else:
                    operator.restore.assert_not_called()
                    operator.transition.assert_not_called()

    def test_initial_receipt_is_durable_before_target_start(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "state"; site = Path(directory) / "site"
            root.mkdir(mode=0o700); os.chmod(root, 0o700); site.write_bytes(ORIGINAL)
            pins = recovery.parse_manifest(manifest(nginx__site=str(site)))
            operator = recovery.Operator(pins, Mock(), SHA)
            operator.prepare = Mock()
            operator.target_config = {"name": "x", "services": {"recovery": {}}}
            operator.expected_env = {}
            operator.nginx = Mock(return_value=ORIGINAL)
            operator.target = Mock(return_value=target_inspect(pins))
            operator.ensure_state_root = Mock()
            events = []

            def write_receipt(value):
                events.append(("receipt", value["phase"]))
                return operator.validate_receipt(value)

            def continue_activation(value):
                events.append(("continue", value["phase"]))
                return {**value, "phase": recovery.PHASE_ACTIVE}

            operator.write_receipt = Mock(side_effect=write_receipt)
            operator.continue_activation = Mock(side_effect=continue_activation)

            def read(path, **_kwargs):
                return ORIGINAL if path in {site, root / "nginx.before"} else b""

            with patch.object(recovery, "STATE_ROOT", root), patch.object(recovery, "ROLLBACK_SITE", root / "nginx.before"), \
                 patch.object(recovery, "RECEIPT_FILE", root / "receipt.json"), \
                 patch.object(recovery, "baseline_snapshot_sha256", return_value=SHA), \
                 patch.object(recovery, "atomic_write"), patch.object(recovery, "secure_read", side_effect=read), \
                 patch.object(recovery, "frozen_recovery_config") as frozen:
                frozen.return_value.__enter__.return_value = Path("/tmp/frozen")
                operator.activate()
        self.assertEqual(events, [("receipt", recovery.PHASE_PRE_CONTAINER), ("continue", recovery.PHASE_PRE_CONTAINER)])


if __name__ == "__main__":
    unittest.main()
