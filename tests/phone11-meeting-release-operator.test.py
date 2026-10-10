"""Hermetic checks for the 3007 to 3008 meeting release operators."""

from __future__ import annotations

import argparse
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch


SCRIPTS = Path(__file__).parents[1] / "scripts"


def load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / filename)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


start = load("phone11_meeting_release_start", "phone11-meeting-release-start.py")
route = load("phone11_meeting_release_route", "phone11-meeting-release-route.py")

SITE = b"""# other routes must be byte-identical
location = /api/auth/sign-in/email {
    proxy_pass http://127.0.0.1:3004;
}
location = /api/trpc {
    proxy_pass http://127.0.0.1:3007;
    add_header X-Phone11-Api-Candidate desktop-provisioning always;
}
location ^~ /api/trpc/ {
    proxy_pass http://127.0.0.1:3007;
    add_header X-Phone11-Api-Candidate desktop-provisioning always;
}
location = /api/mobile/config {
    proxy_pass http://127.0.0.1:3004;
}
"""


class MeetingReleaseOperatorTest(unittest.TestCase):
    def test_release_pins_and_shared_lock(self):
        self.assertEqual(start.SOURCE, route.CURRENT_CONTAINER)
        self.assertEqual(start.SOURCE_IMAGE, route.CURRENT_IMAGE)
        self.assertEqual(start.SOURCE_BUNDLE, route.CURRENT_BUNDLE)
        self.assertEqual(start.TARGET, route.TARGET_CONTAINER)
        self.assertEqual(start.TARGET_BUNDLE, route.TARGET_BUNDLE)
        self.assertEqual(start.BUILD, route.TARGET_BUILD)
        self.assertEqual(start.STAGING, Path("/opt/phone11ai/meeting-admin-20260925"))
        self.assertEqual(route.LOCK, Path("/run/phone11-desktop-provisioning-route.lock"))
        self.assertEqual((route.CURRENT_PORT, route.TARGET_PORT), (3007, 3008))

    def test_image_pin_requires_lowercase_full_digest(self):
        self.assertEqual(start.sha256_arg("a" * 64), "sha256:" + "a" * 64)
        self.assertEqual(route.sha256_arg("a" * 64), "a" * 64)
        for bad in ("", "a" * 63, "A" * 64, "sha256:" + "a" * 64, "a" * 64 + "x"):
            with self.subTest(bad=bad), self.assertRaises(argparse.ArgumentTypeError):
                start.sha256_arg(bad)

    def test_only_two_exact_trpc_proxy_directives_change_and_rollback(self):
        active = route.rewrite_trpc(SITE, route.CURRENT_PORT, route.TARGET_PORT)
        self.assertEqual(active.count(b"proxy_pass http://127.0.0.1:3008;"), 2)
        self.assertEqual(active.count(b"proxy_pass http://127.0.0.1:3004;"), 2)
        self.assertEqual(active.count(b"desktop-provisioning"), 2)
        self.assertEqual(route.rewrite_trpc(active, route.TARGET_PORT, route.CURRENT_PORT), SITE)
        with self.assertRaises(route.GuardError):
            route.rewrite_trpc(SITE.replace(b"127.0.0.1:3007", b"127.0.0.1:3006", 1), 3007, 3008)

    def test_incorrect_candidate_bundle_or_build_refused_before_route_lock(self):
        with patch.object(route.os, "geteuid", return_value=0), patch.object(route, "lock") as lock:
            with self.assertRaises(route.GuardError):
                route.activate("a" * 64, "b" * 64, route.TARGET_BUILD)
            with self.assertRaises(route.GuardError):
                route.activate("a" * 64, route.TARGET_BUNDLE, "wrong-build")
            lock.assert_not_called()

    def test_predecessor_image_drift_refused_before_bundle_or_http(self):
        info = {"Image": "sha256:" + "a" * 64}
        with patch.object(route, "container_info", return_value=info), patch.object(route, "command") as command:
            with self.assertRaises(route.GuardError):
                route.check_predecessor()
            command.assert_not_called()


if __name__ == "__main__":
    unittest.main()
