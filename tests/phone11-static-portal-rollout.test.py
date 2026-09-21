#!/usr/bin/env python3
"""Focused local checks for the Phone11 static-portal edge controller."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("static_portal", ROOT / "scripts/phone11-static-portal-rollout.py")
assert SPEC and SPEC.loader
portal = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = portal
SPEC.loader.exec_module(portal)


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


SITE = b"""server {
    listen 80;
    server_name phone11.ai 1toall.phone11.ai api.phone11.ai;
    location / { proxy_pass http://127.0.0.1:3000; }
}

server {
    listen 443 ssl http2;
    server_name 1toall.phone11.ai;
    ssl_certificate /etc/letsencrypt/live/phone11.ai/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/phone11.ai/privkey.pem;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
    }
}
"""
MARKER = b'{"api_origin":"https://api.phone11.ai","public_origin":"https://1toall.phone11.ai","schema":"phone11-static-portal-release/v1","source_sha":"f386ae58dd04f486cdfa2a5e265998cbe1de89b3"}'


class FakeSystem(portal.System):
    def __init__(
        self,
        dump: bytes,
        *,
        fail_static_probe: bool = False,
        activation_stale_curls: int = 0,
        rollback_stale_curls: int = 0,
        fail_rollback_probe: bool = False,
    ):
        self.dump = dump
        self.reloads = 0
        self.fail_static_probe = fail_static_probe
        self.activation_stale_curls = activation_stale_curls
        self.rollback_stale_curls = rollback_stale_curls
        self.fail_rollback_probe = fail_rollback_probe
        self.pauses: list[float] = []
        self.curl_calls: list[tuple[str, ...]] = []

    def pause(self, seconds: float) -> None:  # type: ignore[override]
        self.pauses.append(seconds)

    def command(self, arguments):  # type: ignore[override]
        args = tuple(arguments)
        if args == ("nginx", "-T"):
            return self.dump
        if args == ("nginx", "-t"):
            return b""
        if args == ("nginx", "-s", "reload"):
            self.reloads += 1
            return b""
        if args[0] == "curl":
            self.curl_calls.append(args)
            url = args[-1]
            if url.startswith(portal.API_ORIGIN):
                return (
                    b"HTTP/2 204 \r\n"
                    b"Access-Control-Allow-Origin: https://1toall.phone11.ai\r\n"
                    b"Access-Control-Allow-Credentials: true\r\n\r\n"
                )
            if self.reloads == 1 and self.activation_stale_curls:
                self.activation_stale_curls -= 1
                status, body = 404, b"old-backend"
            elif self.reloads >= 2 and (self.fail_rollback_probe or self.rollback_stale_curls):
                if self.rollback_stale_curls:
                    self.rollback_stale_curls -= 1
                if url.endswith(portal.RELEASE_MARKER):
                    status, body = 200, MARKER
                else:
                    status, body = 200, b"static-portal"
            elif self.reloads == 0 or self.reloads >= 2:
                status, body = 404, b"old-backend"
            elif self.fail_static_probe and url.endswith("/portal/"):
                status, body = 500, b"probe-failure"
            elif url.endswith("/api/phone11-static-portal-probe"):
                status, body = 404, b"api-denied"
            elif url.endswith(portal.RELEASE_MARKER):
                status, body = 200, MARKER
            else:
                status, body = 200, b"static-portal"
            return body + f"\n__PHONE11_HTTP_STATUS__:{status}".encode()
        raise AssertionError(args)


class StaticPortalRolloutTests(unittest.TestCase):
    def create_manifest(self, temp: Path) -> tuple[portal.Manifest, Path, Path, bytes]:
        nginx_dir = temp / "etc" / "nginx"
        enabled = nginx_dir / "sites-enabled"
        available = nginx_dir / "sites-available"
        enabled.mkdir(parents=True)
        available.mkdir()
        site = available / "phone11ai"
        site.write_bytes(SITE)
        enabled_site = enabled / "phone11ai"
        enabled_site.symlink_to(site)
        legacy = []
        for name in portal.LEGACY_INCLUDE_NAMES:
            item = enabled / name
            item.write_bytes(SITE)
            legacy.append(item)

        release_dir = temp / "srv" / "phone11-static-portal" / "releases" / portal.RELEASE_SHA
        (release_dir / "portal").mkdir(parents=True)
        index = b"<script src=\"/_expo/static/app.js\"></script>"
        portal_index = b"<script>const api='https://api.phone11.ai'</script>"
        (release_dir / "index.html").write_bytes(index)
        (release_dir / "portal" / "index.html").write_bytes(portal_index)
        (release_dir / "_expo" / "static").mkdir(parents=True)
        (release_dir / "_expo" / "static" / "app.js").write_text("const api='https://api.phone11.ai';")
        (release_dir / portal.RELEASE_MARKER).write_bytes(MARKER)
        export = {
            "schema": portal.EXPORT_SCHEMA,
            "source_sha": portal.RELEASE_SHA,
            "api_origin": portal.API_ORIGIN,
            "files": {
                "index.html": digest(index),
                "portal/index.html": digest(portal_index),
                "_expo/static/app.js": digest(b"const api='https://api.phone11.ai';"),
                portal.RELEASE_MARKER: digest(MARKER),
            },
        }
        export_path = release_dir / "phone11-static-portal-export.json"
        export_raw = json.dumps(export, sort_keys=True, separators=(",", ":")).encode()
        export_path.write_bytes(export_raw)
        current_link = release_dir.parents[1] / "current"
        state_dir = nginx_dir / "phone11-static-portal-rollout"
        manifest_raw = {
            "schema": portal.SCHEMA,
            "release": {
                "source_sha": portal.RELEASE_SHA,
                "directory": str(release_dir),
                "manifest": str(export_path),
                "manifest_sha256": digest(export_raw),
                "current_link": str(current_link),
            },
            "origins": {"public": portal.PUBLIC_ORIGIN, "api": portal.API_ORIGIN},
            "nginx": {
                "site": str(site),
                "enabled_site": str(enabled_site),
                "enabled_site_link": os.readlink(enabled_site),
                "site_sha256": digest(SITE),
                "dump_sha256": digest(SITE + b"".join(item.read_bytes() for item in legacy)),
                "certificate": str(portal.CERTIFICATE),
                "certificate_key": str(portal.CERTIFICATE_KEY),
                "legacy_includes": [{"path": str(item), "sha256": digest(item.read_bytes())} for item in legacy],
            },
            "state_dir": str(state_dir),
        }
        manifest_path = temp / "manifest.json"
        manifest_path.write_text(json.dumps(manifest_raw))
        normalized_dump = b"# configuration file /etc/nginx/nginx.conf:\n" + SITE + b"".join(item.read_bytes() for item in legacy)
        manifest_raw["nginx"]["dump_sha256"] = digest(normalized_dump)
        manifest_path.write_text(json.dumps(manifest_raw))
        return portal.parse_manifest(manifest_path), site, current_link, normalized_dump

    def test_rewrites_only_the_dedicated_tls_root_location(self):
        with tempfile.TemporaryDirectory() as directory:
            current = Path(directory) / "current"
            rewritten = portal.rewrite_site(SITE, current).decode()
        self.assertIn("server_name phone11.ai 1toall.phone11.ai api.phone11.ai;", rewritten)
        self.assertIn("try_files /portal/index.html /index.html =404;", rewritten)
        self.assertIn("try_files $uri $uri.html $uri/index.html /index.html =404;", rewritten)
        self.assertIn("location ^~ /api/ { return 404; }", rewritten)
        self.assertNotIn("proxy_pass", rewritten.split("server_name 1toall.phone11.ai;", 1)[1])
        self.assertIn("ssl_certificate /etc/letsencrypt/live/phone11.ai/fullchain.pem;", rewritten)

    def test_activation_and_manual_rollback_restore_every_pinned_file(self):
        with tempfile.TemporaryDirectory() as directory:
            temp = Path(directory)
            manifest, site, current, dump = self.create_manifest(temp)
            system = FakeSystem(dump)
            original = site.read_bytes()
            original_legacy = [item.path.read_bytes() for item in manifest.nginx.legacy_includes]
            portal.activate(manifest, system, require_root=False)
            self.assertTrue(current.is_symlink())
            self.assertEqual(os.readlink(current), str(manifest.release.directory))
            self.assertIn(b"location ^~ /api/ { return 404; }", site.read_bytes())
            self.assertTrue(all(not item.path.exists() for item in manifest.nginx.legacy_includes))
            portal.restore(manifest, system, require_root=False)
            self.assertEqual(site.read_bytes(), original)
            self.assertFalse(current.exists() or current.is_symlink())
            self.assertEqual([item.path.read_bytes() for item in manifest.nginx.legacy_includes], original_legacy)
            self.assertEqual(system.reloads, 2)

    def test_activation_retries_post_reload_probes_on_fresh_connections(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest, _site, current, dump = self.create_manifest(Path(directory))
            system = FakeSystem(dump, activation_stale_curls=1)
            portal.activate(manifest, system, require_root=False)
            self.assertTrue(current.is_symlink())
            self.assertEqual(system.reloads, 1)
            self.assertEqual(system.pauses, [portal.HTTP_PROBE_RETRY_SECONDS])
            self.assertTrue(any("--http1.1" in call for call in system.curl_calls))
            self.assertTrue(any("Connection: close" in call for call in system.curl_calls))

    def test_rollback_retries_post_reload_probes_on_fresh_connections(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest, site, current, dump = self.create_manifest(Path(directory))
            system = FakeSystem(dump)
            portal.activate(manifest, system, require_root=False)
            system.rollback_stale_curls = 1
            portal.restore(manifest, system, require_root=False)
            self.assertEqual(site.read_bytes(), SITE)
            self.assertFalse(current.exists() or current.is_symlink())
            self.assertEqual(system.reloads, 2)
            self.assertEqual(system.pauses, [portal.HTTP_PROBE_RETRY_SECONDS])

    def test_probe_failure_restores_the_original_site_and_legacy_includes(self):
        with tempfile.TemporaryDirectory() as directory:
            temp = Path(directory)
            manifest, site, current, dump = self.create_manifest(temp)
            system = FakeSystem(dump, fail_static_probe=True)
            original_legacy = [item.path.read_bytes() for item in manifest.nginx.legacy_includes]
            with self.assertRaisesRegex(portal.RolloutError, "probe"):
                portal.activate(manifest, system, require_root=False)
            self.assertEqual(site.read_bytes(), SITE)
            self.assertFalse(current.exists() or current.is_symlink())
            self.assertEqual([item.path.read_bytes() for item in manifest.nginx.legacy_includes], original_legacy)
            self.assertEqual(system.reloads, 2)

    def test_failed_rollback_records_the_original_activation_stage(self):
        with tempfile.TemporaryDirectory() as directory:
            temp = Path(directory)
            manifest, _site, _current, dump = self.create_manifest(temp)
            system = FakeSystem(dump, fail_static_probe=True, fail_rollback_probe=True)
            with self.assertRaises(portal.RolloutError) as caught:
                portal.activate(manifest, system, require_root=False)
            self.assertEqual(caught.exception.stage, "rollback_failed")
            self.assertEqual(caught.exception.original_stage, "probe")
            self.assertEqual(caught.exception.rollback_stage, "rollback_probe")
            record = json.loads(
                (portal.operation_directory(manifest) / "failure.json").read_text()
            )
            self.assertEqual(
                record,
                {
                    "schema": portal.SCHEMA,
                    "release_sha": portal.RELEASE_SHA,
                    "original_stage": "probe",
                    "rollback_stage": "rollback_probe",
                },
            )

    def test_same_release_rearms_only_after_a_failed_activation_fully_restored(self):
        with tempfile.TemporaryDirectory() as directory:
            temp = Path(directory)
            manifest, site, current, dump = self.create_manifest(temp)
            failed_system = FakeSystem(dump, fail_static_probe=True)
            with self.assertRaisesRegex(portal.RolloutError, "probe"):
                portal.activate(manifest, failed_system, require_root=False)

            operation = portal.operation_directory(manifest)
            self.assertTrue((operation / "receipt.json").is_file())
            self.assertTrue((operation / "site.before").is_file())
            self.assertTrue((operation / "failure.json").is_file())
            self.assertEqual(site.read_bytes(), SITE)
            self.assertFalse(current.exists() or current.is_symlink())

            retry_system = FakeSystem(dump)
            portal.activate(manifest, retry_system, require_root=False)

            self.assertTrue(current.is_symlink())
            self.assertIn(b"location ^~ /api/ { return 404; }", site.read_bytes())
            self.assertTrue(operation.is_dir())
            self.assertFalse((operation / "failure.json").exists())
            archives = list(
                manifest.state_dir.glob(f"{manifest.release.source_sha}.recovered-*")
            )
            self.assertEqual(len(archives), 1)
            self.assertTrue((archives[0] / "receipt.json").is_file())
            self.assertTrue((archives[0] / "site.before").is_file())
            self.assertTrue((archives[0] / "failure.json").is_file())

    def test_same_release_rearms_a_legacy_restored_operation_without_fabricating_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            temp = Path(directory)
            manifest, site, current, dump = self.create_manifest(temp)
            failed_system = FakeSystem(dump, fail_static_probe=True)
            with self.assertRaisesRegex(portal.RolloutError, "probe"):
                portal.activate(manifest, failed_system, require_root=False)

            operation = portal.operation_directory(manifest)
            # Model the pre-error-record controller: the receipt and before
            # image exist, but it never wrote a diagnostic failure record.
            (operation / "failure.json").unlink()
            self.assertEqual(site.read_bytes(), SITE)
            self.assertFalse(current.exists() or current.is_symlink())

            portal.activate(manifest, FakeSystem(dump), require_root=False)

            archives = list(
                manifest.state_dir.glob(f"{manifest.release.source_sha}.recovered-*")
            )
            self.assertEqual(len(archives), 1)
            self.assertTrue((archives[0] / "receipt.json").is_file())
            self.assertTrue((archives[0] / "site.before").is_file())
            self.assertFalse((archives[0] / "failure.json").exists())
            self.assertTrue(current.is_symlink())
            self.assertIn(b"location ^~ /api/ { return 404; }", site.read_bytes())

    def test_rollback_recovers_from_a_prefix_that_already_restored_one_legacy_file(self):
        with tempfile.TemporaryDirectory() as directory:
            temp = Path(directory)
            manifest, site, current, dump = self.create_manifest(temp)
            system = FakeSystem(dump)
            portal.activate(manifest, system, require_root=False)
            operation = portal.operation_directory(manifest)
            first = manifest.nginx.legacy_includes[0]
            os.replace(operation / "legacy" / first.path.name, first.path)
            site.write_bytes(SITE)
            portal.restore(manifest, system, require_root=False)
            self.assertEqual(site.read_bytes(), SITE)
            self.assertFalse(current.exists() or current.is_symlink())
            self.assertTrue(all(item.path.exists() for item in manifest.nginx.legacy_includes))

    def test_release_requires_the_portal_entry_and_baked_api_origin(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest, _site, _current, _dump = self.create_manifest(Path(directory))
            (manifest.release.directory / "portal" / "index.html").unlink()
            with self.assertRaisesRegex(portal.RolloutError, "release"):
                portal.validate_release(manifest.release)

    def test_release_rejects_an_unpinned_static_asset(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest, _site, _current, _dump = self.create_manifest(Path(directory))
            (manifest.release.directory / "_expo" / "static" / "unexpected.js").write_text("alert('drift')")
            with self.assertRaisesRegex(portal.RolloutError, "release"):
                portal.validate_release(manifest.release)

    def test_refuses_a_tls_vhost_that_shares_1toall_with_another_name(self):
        combined = SITE.replace(b"server_name 1toall.phone11.ai;", b"server_name phone11.ai 1toall.phone11.ai;")
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(portal.RolloutError, "nginx_target"):
                portal.rewrite_site(combined, Path(directory) / "current")

    def test_refuses_a_changed_enabled_site_symlink_even_if_it_resolves_to_the_target(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest, _site, _current, dump = self.create_manifest(Path(directory))
            manifest.nginx.enabled_site.unlink()
            manifest.nginx.enabled_site.symlink_to(
                os.path.relpath(manifest.nginx.site, start=manifest.nginx.enabled_site.parent)
            )
            with self.assertRaisesRegex(portal.RolloutError, "nginx_site"):
                portal.check_pins(manifest, FakeSystem(dump))


if __name__ == "__main__":
    unittest.main()
