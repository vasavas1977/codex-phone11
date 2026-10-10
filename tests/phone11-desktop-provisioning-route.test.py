"""Hermetic checks for the narrow desktop provisioning tRPC route operator."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).parents[1] / "scripts" / "phone11-desktop-provisioning-route.py"
SPEC = importlib.util.spec_from_file_location("phone11_desktop_route", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
route = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = route
SPEC.loader.exec_module(route)


SITE = b"""# untouched recovery routing
location = /api/auth/sign-in/email {
    proxy_pass http://127.0.0.1:3004;
}
location = /api/trpc {
    proxy_pass http://127.0.0.1:3006;
    proxy_http_version 1.1;
    add_header X-Phone11-Api-Candidate channel-meetings-9aab162 always;
}
location ^~ /api/trpc/ {
    proxy_pass http://127.0.0.1:3006;
    proxy_http_version 1.1;
    add_header X-Phone11-Api-Candidate channel-meetings-9aab162 always;
}
location = /api/mobile/config {
    proxy_pass http://127.0.0.1:3004;
}
"""


class RouteTest(unittest.TestCase):
    def test_only_two_trpc_proxy_directives_change(self):
        active = route.rewrite_trpc(SITE, 3006, 3007)
        self.assertEqual(active.count(b"proxy_pass http://127.0.0.1:3007;"), 2)
        self.assertEqual(active.count(b"proxy_pass http://127.0.0.1:3004;"), 2)
        self.assertEqual(active.count(b"channel-meetings-9aab162"), 2)
        self.assertEqual(route.rewrite_trpc(active, 3007, 3006), SITE)

    def test_source_drift_refused(self):
        for altered in (
            SITE.replace(b"127.0.0.1:3006", b"127.0.0.1:3005", 1),
            SITE + b"location = /api/trpc { proxy_pass http://127.0.0.1:3006; }\n",
            SITE.replace(b"location ^~ /api/trpc/", b"location /api/trpc/"),
            SITE.replace(b"    proxy_http_version 1.1;", b"    proxy_pass http://127.0.0.1:3006;", 1),
        ):
            with self.subTest(altered=altered[:50]), self.assertRaises(route.GuardError):
                route.rewrite_trpc(altered, 3006, 3007)

    def test_symlink_refused(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "site").write_bytes(SITE)
            (root / "link").symlink_to(root / "site")
            with self.assertRaises(route.GuardError):
                route.read_regular(root / "link")

    def test_candidate_pins_checked_before_http(self):
        inspect = {
            "Name": "/" + route.TARGET_CONTAINER,
            "Image": "sha256:" + "a" * 64,
            "State": {"Running": True, "Health": {"Status": "healthy"}},
            "NetworkSettings": {"Ports": {"3000/tcp": [{"HostIp": "127.0.0.1", "HostPort": "3007"}]}},
        }
        with patch.object(route, "container_info", return_value=inspect), patch.object(route, "command") as command:
            with self.assertRaises(route.GuardError):
                route.check_candidate("b" * 64, "c" * 64, "test-build")
            command.assert_not_called()

if __name__ == "__main__":
    unittest.main()
