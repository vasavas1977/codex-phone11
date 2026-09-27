"""Offline guards for the 3015 -> 3016 SIP-admin API release operator."""
import contextlib
import importlib.util
import json
import os
from pathlib import Path
import unittest
from unittest import mock


PATH = Path(__file__).resolve().parents[1] / "scripts/phone11-sip-consistency-release.py"
SPEC = importlib.util.spec_from_file_location("sip_consistency_release", PATH)
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


class ReleaseGuards(unittest.TestCase):
    def predecessor(self):
        return {"container_id": release.OLD_CONTAINER_ID, "image": release.OLD_IMAGE,
                "source_sha": release.OLD_SOURCE_SHA,
                "bundle_sha256": release.OLD_BUNDLE_SHA256,
                "lock_sha256": release.LOCK_SHA256, "build": release.OLD_BUILD}

    def manifest(self):
        return {"predecessor": self.predecessor(),
                "release": {"source_sha": release.SOURCE_SHA,
                            "bundle_sha256": release.EXPECTED_BUNDLE_SHA256,
                            "lock_sha256": release.LOCK_SHA256,
                            "build": "sip-admin-6180658"}}

    def test_manifest_refuses_previous_container_drift(self):
        data = self.manifest()
        data["predecessor"]["container_id"] = "b" * 64
        with mock.patch.object(release, "_original_manifest", return_value=(data, "c" * 64)):
            with self.assertRaisesRegex(release.Refused, "predecessor_pin"):
                release.manifest(Path("/private/manifest.json"))

    def test_manifest_refuses_unreviewed_source(self):
        data = self.manifest()
        data["release"]["source_sha"] = "d" * 40
        with mock.patch.object(release, "_original_manifest", return_value=(data, "c" * 64)):
            with self.assertRaisesRegex(release.Refused, "release_pin"):
                release.manifest(Path("/private/manifest.json"))

    def test_manifest_refuses_unreviewed_build_label(self):
        data = self.manifest()
        data["release"]["build"] = "unreviewed-build"
        with mock.patch.object(release, "_original_manifest", return_value=(data, "c" * 64)):
            with self.assertRaisesRegex(release.Refused, "release_pin"):
                release.manifest(Path("/private/manifest.json"))

    def test_manifest_refuses_alternate_bundle_even_when_self_declared(self):
        data = self.manifest()
        data["release"]["bundle_sha256"] = "a" * 64
        with mock.patch.object(release, "_original_manifest", return_value=(data, "c" * 64)):
            with self.assertRaisesRegex(release.Refused, "release_pin"):
                release.manifest(Path("/private/manifest.json"))

    def test_compose_preserves_invitation_secret_and_other_environment(self):
        previous = {"PORT": "3015", "PHONE11_BUILD_SHA": release.OLD_BUILD,
                    "PHONE11_RUNTIME_ROLE": "api-candidate",
                    "PHONE11_VOICEMAIL_HOOK_READY": "false",
                    "PHONE11_INVITATIONS_ENABLED": "true",
                    "PHONE11_INVITATIONS_RESEND_API_KEY": "re_test_secret_not_printed",
                    "PHONE11_INVITATIONS_FROM": "Phone11 <noreply@phone11.ai>",
                    "SOME_UNRELATED_SETTING": "a$b"}
        expected = dict(previous, PORT="3016", PHONE11_BUILD_SHA="sip-admin-6180658")
        model = {"services": {release.SERVICE: {"labels": {"old": "label"}}}}
        with mock.patch.object(release.stage, "env_map", return_value=previous), \
             mock.patch.object(release, "_original_compose",
                               return_value=(release.stage.canonical(model), b"ignored", expected)):
            config, env_bytes, result = release.compose({}, "sha256:" + "b" * 64,
                                                       "c" * 64, "sip-admin-6180658")
        self.assertEqual(result, expected)
        self.assertIn(b"PHONE11_INVITATIONS_RESEND_API_KEY=re_test_secret_not_printed\n", env_bytes)
        self.assertIn(b"SOME_UNRELATED_SETTING=a$b\n", env_bytes)
        self.assertEqual(json.loads(config)["services"][release.SERVICE]["labels"],
                         {release.OWNER_LABEL: release.SCHEMA,
                          release.MANIFEST_LABEL: "c" * 64})

    def test_compose_refuses_capability_change(self):
        previous = {"PORT": "3015", "PHONE11_BUILD_SHA": release.OLD_BUILD,
                    "PHONE11_INVITATIONS_ENABLED": "true"}
        changed = dict(previous, PORT="3016", PHONE11_BUILD_SHA="sip-admin-6180658",
                       PHONE11_INVITATIONS_ENABLED="false")
        with mock.patch.object(release.stage, "env_map", return_value=previous), \
             mock.patch.object(release, "_original_compose",
                               return_value=(b"{}", b"", changed)):
            with self.assertRaisesRegex(release.Refused, "environment_drift"):
                release.compose({}, "sha256:" + "b" * 64, "c" * 64, "sip-admin-6180658")

    def test_predecessor_pins_image_build_separately_from_live_build(self):
        data = self.manifest()
        old = {"Config": {"Labels": {"com.phone11.candidate-build": release.OLD_IMAGE_BUILD}}}
        env = {"PHONE11_INVITATIONS_ENABLED": "true",
               "PHONE11_INVITATIONS_PROVIDER": "resend",
               "PHONE11_INVITATIONS_RESEND_API_KEY": "re_test",
               "PHONE11_INVITATIONS_FROM": "Phone11 <noreply@phone11.ai>",
               "PHONE11_RUNTIME_ROLE": "api-candidate",
               "PHONE11_VOICEMAIL_HOOK_READY": "false",
               "PHONE11_BUILD_SHA": release.OLD_BUILD}
        with mock.patch.object(release, "_original_check_old", return_value=old) as predecessor, \
             mock.patch.object(release.stage, "labels", return_value=old["Config"]["Labels"]), \
             mock.patch.object(release.stage, "env_map", return_value=env), \
             mock.patch.object(release, "health") as health:
            self.assertIs(release.check_old(data), old)
        checked = predecessor.call_args.args[0]
        self.assertEqual(checked["predecessor"]["build"], release.OLD_IMAGE_BUILD)
        self.assertEqual(data["predecessor"]["build"], release.OLD_BUILD)
        health.assert_called_once_with(release.OLD_PORT, release.OLD_BUILD)

    def test_predecessor_refuses_unexpected_image_build(self):
        data = self.manifest()
        old = {"Config": {"Labels": {"com.phone11.candidate-build": "unexpected"}}}
        with mock.patch.object(release, "_original_check_old", return_value=old), \
             mock.patch.object(release.stage, "labels", return_value=old["Config"]["Labels"]):
            with self.assertRaisesRegex(release.Refused, "predecessor_image_build"):
                release.check_old(data)

    def test_healthcheck_targets_isolated_port(self):
        raw = {"test": ["CMD", "node", "-e",
                        "fetch('http://127.0.0.1:3013/api/health')"]}
        with mock.patch.object(release, "_original_healthcheck", return_value=raw):
            result = release.healthcheck({}, "sip-admin-6180658")
        self.assertIn("127.0.0.1:3016/api/health", result["test"][3])
        self.assertNotIn("127.0.0.1:3013", result["test"][3])

    def test_staged_compose_accepts_only_bind_mount_order_change(self):
        mounts = [
            {"type": "bind", "source": "/private/a", "target": "/app/a", "read_only": True},
            {"type": "bind", "source": "/private/b", "target": "/app/b", "read_only": False},
        ]
        base = {"services": {release.SERVICE: {"image": "pinned", "volumes": mounts}}}
        reordered = {"services": {release.SERVICE: {"image": "pinned", "volumes": mounts[::-1]}}}
        self.assertTrue(release.same_compose_with_mount_order_ignored(
            release.stage.canonical(base), release.stage.canonical(reordered)))
        changed = {"services": {release.SERVICE: {"image": "pinned", "volumes": [
            mounts[0], {**mounts[1], "read_only": True}]}}}
        self.assertFalse(release.same_compose_with_mount_order_ignored(
            release.stage.canonical(base), release.stage.canonical(changed)))
        duplicate = {"services": {release.SERVICE: {"image": "pinned", "volumes": [
            mounts[0], mounts[0]]}}}
        with self.assertRaisesRegex(release.Refused, "stage_files"):
            release.same_compose_with_mount_order_ignored(
                release.stage.canonical(base), release.stage.canonical(duplicate))

    def test_rollback_does_not_need_healthy_or_present_candidate(self):
        data = self.manifest()
        original, promoted = b"old-site", b"new-site"
        record = {"state": "active"}
        fd = os.open(os.devnull, os.O_RDONLY)
        try:
            with mock.patch.object(release.route, "locked", return_value=contextlib.nullcontext()), \
                 mock.patch.object(release.stage, "locked", return_value=fd), \
                 mock.patch.object(release, "manifest", return_value=(data, "c" * 64)), \
                 mock.patch.object(release, "check_old", return_value={}), \
                 mock.patch.object(release, "pinned_receipt", return_value=(record, original, promoted)), \
                 mock.patch.object(release.route, "secure_directory"), \
                 mock.patch.object(release.route, "read_file", return_value=(promoted, None)), \
                 mock.patch.object(release, "change_route") as change, \
                 mock.patch.object(release, "save_receipt") as save, \
                 mock.patch.object(release.stage, "inspect", side_effect=AssertionError("candidate read")):
                release.rollback(Path("/private/manifest.json"))
            change.assert_called_once_with(promoted, original)
            self.assertEqual(record["state"], "rolled_back")
            save.assert_called_once()
        finally:
            # rollback closes the descriptor; do not close it a second time.
            pass

    def test_route_rewrites_only_pinned_site(self):
        with mock.patch.object(release.route, "secure_directory"), \
             mock.patch.object(release.route, "read_file", return_value=(b"modified", None)):
            with self.assertRaisesRegex(release.Refused, "site_pin"):
                release.route_bytes()

    def test_rewrite_changes_only_two_trpc_locations(self):
        before = (b"location = /api/trpc {\n  proxy_pass http://127.0.0.1:3015;\n}\n"
                  b"location ^~ /api/trpc/ {\n  proxy_pass http://127.0.0.1:3015;\n}\n"
                  b"location /api/auth/ {\n  proxy_pass http://127.0.0.1:3004;\n}\n")
        after = release.route.rewrite_trpc(before, 3015, 3016)
        self.assertEqual(after.count(b"proxy_pass http://127.0.0.1:3016"), 2)
        self.assertIn(b"proxy_pass http://127.0.0.1:3004", after)
        self.assertEqual(release.route.rewrite_trpc(after, 3016, 3015), before)


if __name__ == "__main__":
    unittest.main()
