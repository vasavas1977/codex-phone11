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
from dataclasses import replace
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
MARKER = b'{"api_origin":"https://api.phone11.ai","public_origin":"https://1toall.phone11.ai","schema":"phone11-static-portal-release/v1","source_sha":"076ddac068dd6efbca91a152f75886127a22c0b2"}'


class FakeSystem(portal.System):
    def __init__(
        self,
        dump: bytes,
        *,
        fail_static_probe: bool = False,
        activation_stale_curls: int = 0,
        rollback_stale_curls: int = 0,
        fail_rollback_probe: bool = False,
        current_link: Path | None = None,
        markers: dict[str, bytes] | None = None,
        predecessor_root_status: int | None = None,
    ):
        self.dump = dump
        self.reloads = 0
        self.fail_static_probe = fail_static_probe
        self.activation_stale_curls = activation_stale_curls
        self.rollback_stale_curls = rollback_stale_curls
        self.fail_rollback_probe = fail_rollback_probe
        self.current_link = current_link
        self.markers = markers or {portal.RELEASE_SHA: MARKER}
        self.predecessor_root_status = predecessor_root_status
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
            active_target = (
                os.readlink(self.current_link)
                if self.current_link and self.current_link.is_symlink()
                else None
            )
            active_marker = self.markers.get(Path(active_target).name) if active_target else None
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
            elif self.fail_static_probe and active_target and url.endswith("/portal/"):
                status, body = 500, b"probe-failure"
            elif active_target and active_marker is not None:
                if (
                    self.predecessor_root_status is not None
                    and Path(active_target).name != portal.RELEASE_SHA
                    and url == f"{portal.PUBLIC_ORIGIN}/"
                ):
                    status, body = self.predecessor_root_status, b"unexpected-predecessor-root"
                elif url.endswith("/api/phone11-static-portal-probe"):
                    status, body = 404, b"api-denied"
                elif url.endswith(portal.RELEASE_MARKER):
                    status, body = 200, active_marker
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
        export_path = release_dir / "export-manifest.json"
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

    def create_managed_update_manifest(
        self,
        temp: Path,
    ) -> tuple[portal.Manifest, Path, Path, bytes, str, dict[str, bytes]]:
        manifest, site, current, _initial_dump = self.create_manifest(temp)
        predecessor_sha = "a" * 40
        predecessor_marker = (
            b'{"api_origin":"https://api.phone11.ai","public_origin":"https://1toall.phone11.ai",'
            b'"schema":"phone11-static-portal-release/v1","source_sha":"'
            + predecessor_sha.encode()
            + b'"}'
        )
        predecessor_release = manifest.release.directory.parent / predecessor_sha
        (predecessor_release / "portal").mkdir(parents=True)
        predecessor_index = b"<script src=\"/_expo/static/app.js\"></script>"
        predecessor_portal_index = b"<script>const api='https://api.phone11.ai'</script>"
        predecessor_app = b"const api='https://api.phone11.ai';"
        (predecessor_release / "index.html").write_bytes(predecessor_index)
        (predecessor_release / "portal" / "index.html").write_bytes(predecessor_portal_index)
        (predecessor_release / "_expo" / "static").mkdir(parents=True)
        (predecessor_release / "_expo" / "static" / "app.js").write_bytes(predecessor_app)
        (predecessor_release / portal.RELEASE_MARKER).write_bytes(predecessor_marker)
        predecessor_export = {
            "schema": portal.EXPORT_SCHEMA,
            "source_sha": predecessor_sha,
            "api_origin": portal.API_ORIGIN,
            "files": {
                "index.html": digest(predecessor_index),
                "portal/index.html": digest(predecessor_portal_index),
                "_expo/static/app.js": digest(predecessor_app),
                portal.RELEASE_MARKER: digest(predecessor_marker),
            },
        }
        (predecessor_release / portal.EXPORT_MANIFEST_NAME).write_bytes(
            json.dumps(predecessor_export, sort_keys=True, separators=(",", ":")).encode()
        )

        static_site = portal.rewrite_site(SITE, current)
        site.write_bytes(static_site)
        current.symlink_to(predecessor_release)
        static_dump = b"# configuration file /etc/nginx/nginx.conf:\n" + static_site
        update_pins = replace(
            manifest.nginx,
            site_sha256=digest(static_site),
            dump_sha256=digest(static_dump),
        )
        update_manifest = replace(manifest, nginx=update_pins)

        predecessor_operation = manifest.state_dir / predecessor_sha
        predecessor_operation.mkdir(parents=True, mode=0o700)
        (predecessor_operation / "legacy").mkdir(mode=0o700)
        (predecessor_operation / "site.before").write_bytes(SITE)
        legacy_receipt = []
        for item in manifest.nginx.legacy_includes:
            saved_as = f"legacy/{item.path.name}"
            os.replace(item.path, predecessor_operation / saved_as)
            legacy_receipt.append(
                {"path": str(item.path), "sha256": item.sha256, "saved_as": saved_as}
            )
        predecessor_receipt = {
            "schema": portal.SCHEMA,
            "release_sha": predecessor_sha,
            "site": str(manifest.nginx.site),
            "before_sha256": digest(SITE),
            "active_sha256": digest(static_site),
            "current_link": str(current),
            "previous_link": None,
            "root_status_before": 404,
            "marker_status_before": 404,
            "marker_sha256_before": digest(b"old-backend"),
            "legacy_includes": legacy_receipt,
        }
        (predecessor_operation / "receipt.json").write_text(json.dumps(predecessor_receipt))
        return (
            update_manifest,
            site,
            current,
            static_dump,
            predecessor_sha,
            {predecessor_sha: predecessor_marker, portal.RELEASE_SHA: MARKER},
        )

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

    def test_managed_static_update_switches_only_current_and_rolls_back_to_predecessor(self):
        with tempfile.TemporaryDirectory() as directory:
            (
                manifest,
                site,
                current,
                dump,
                predecessor_sha,
                markers,
            ) = self.create_managed_update_manifest(Path(directory))
            system = FakeSystem(dump, current_link=current, markers=markers)
            static_before = site.read_bytes()

            prepared = portal.prepare(manifest, system)
            self.assertEqual(prepared.mode, portal.MANAGED_UPDATE)
            self.assertEqual(prepared.before, static_before)
            self.assertEqual(prepared.active, static_before)

            portal.activate(manifest, system, require_root=False)
            self.assertEqual(site.read_bytes(), static_before)
            self.assertEqual(os.readlink(current), str(manifest.release.directory))
            self.assertEqual(system.reloads, 0)
            operation = portal.operation_directory(manifest)
            receipt = json.loads((operation / "receipt.json").read_text())
            self.assertEqual(receipt["mode"], portal.MANAGED_UPDATE)
            self.assertEqual(receipt["legacy_includes"], [])
            self.assertFalse((operation / "legacy").exists())

            portal.restore(manifest, system, require_root=False)
            self.assertEqual(site.read_bytes(), static_before)
            self.assertEqual(os.readlink(current), str(manifest.release.directory.parent / predecessor_sha))
            self.assertEqual(system.reloads, 0)

    def test_managed_update_rejects_a_non_200_predecessor_root_baseline(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest, site, current, dump, predecessor_sha, markers = self.create_managed_update_manifest(Path(directory))
            with self.assertRaisesRegex(portal.RolloutError, "managed_probe"):
                portal.activate(
                    manifest,
                    FakeSystem(
                        dump,
                        current_link=current,
                        markers=markers,
                        predecessor_root_status=503,
                    ),
                    require_root=False,
                )
            self.assertEqual(site.read_bytes(), portal.rewrite_site(SITE, current))
            self.assertEqual(os.readlink(current), str(manifest.release.directory.parent / predecessor_sha))
            self.assertFalse(portal.operation_directory(manifest).exists())

    def test_managed_rollback_rejects_a_missing_receipt_bound_predecessor_before_link_change(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest, site, current, dump, predecessor_sha, markers = self.create_managed_update_manifest(Path(directory))
            system = FakeSystem(dump, current_link=current, markers=markers)
            static_before = site.read_bytes()
            portal.activate(manifest, system, require_root=False)
            (manifest.release.directory.parent / predecessor_sha / "portal" / "index.html").unlink()

            with self.assertRaisesRegex(portal.RolloutError, "rollback"):
                portal.restore(manifest, system, dry_run=True, require_root=False)

            self.assertEqual(site.read_bytes(), static_before)
            self.assertEqual(os.readlink(current), str(manifest.release.directory))
            self.assertEqual(system.reloads, 0)

            with self.assertRaisesRegex(portal.RolloutError, "rollback"):
                portal.restore(manifest, system, require_root=False)

            self.assertEqual(site.read_bytes(), static_before)
            self.assertEqual(os.readlink(current), str(manifest.release.directory))
            self.assertEqual(system.reloads, 0)

    def test_managed_rollback_rejects_a_drifted_receipt_bound_predecessor_before_link_change(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest, site, current, dump, predecessor_sha, markers = self.create_managed_update_manifest(Path(directory))
            system = FakeSystem(dump, current_link=current, markers=markers)
            static_before = site.read_bytes()
            portal.activate(manifest, system, require_root=False)
            (manifest.release.directory.parent / predecessor_sha / "_expo" / "static" / "app.js").write_bytes(
                b"const api='https://api.phone11.ai'; alert('drift');"
            )

            with self.assertRaisesRegex(portal.RolloutError, "rollback"):
                portal.restore(manifest, system, dry_run=True, require_root=False)

            self.assertEqual(site.read_bytes(), static_before)
            self.assertEqual(os.readlink(current), str(manifest.release.directory))
            self.assertEqual(system.reloads, 0)

            with self.assertRaisesRegex(portal.RolloutError, "rollback"):
                portal.restore(manifest, system, require_root=False)

            self.assertEqual(site.read_bytes(), static_before)
            self.assertEqual(os.readlink(current), str(manifest.release.directory))
            self.assertEqual(system.reloads, 0)

    def test_managed_update_rejects_a_marker_not_matching_the_predecessor_export(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest, site, current, dump, predecessor_sha, markers = self.create_managed_update_manifest(Path(directory))
            markers[predecessor_sha] = b'{"source_sha":"wrong"}'
            with self.assertRaisesRegex(portal.RolloutError, "managed_probe"):
                portal.activate(
                    manifest,
                    FakeSystem(dump, current_link=current, markers=markers),
                    require_root=False,
                )
            self.assertEqual(site.read_bytes(), portal.rewrite_site(SITE, current))
            self.assertEqual(os.readlink(current), str(manifest.release.directory.parent / predecessor_sha))
            self.assertFalse(portal.operation_directory(manifest).exists())

    def test_managed_link_fsync_failure_restores_the_verified_predecessor_link(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest, site, current, dump, predecessor_sha, markers = self.create_managed_update_manifest(Path(directory))
            system = FakeSystem(dump, current_link=current, markers=markers)
            static_before = site.read_bytes()
            original_fsync = portal.fsync_directory

            def fail_only_after_new_current(path: Path) -> None:
                if (
                    path == current.parent
                    and current.is_symlink()
                    and os.readlink(current) == str(manifest.release.directory)
                ):
                    raise OSError("injected current-link fsync failure")
                original_fsync(path)

            portal.fsync_directory = fail_only_after_new_current
            try:
                with self.assertRaisesRegex(portal.RolloutError, "activation"):
                    portal.activate(manifest, system, require_root=False)
            finally:
                portal.fsync_directory = original_fsync

            self.assertEqual(site.read_bytes(), static_before)
            self.assertEqual(os.readlink(current), str(manifest.release.directory.parent / predecessor_sha))
            self.assertTrue((portal.operation_directory(manifest) / "failure.json").is_file())

    def test_rejects_drifted_managed_static_locations(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest, site, current, dump, _predecessor_sha, markers = self.create_managed_update_manifest(Path(directory))
            drifted = site.read_bytes().replace(
                b"try_files $uri $uri.html $uri/index.html /index.html =404;",
                b"try_files $uri $uri.html $uri/index.html /portal/index.html =404;",
            )
            self.assertNotEqual(drifted, site.read_bytes())
            site.write_bytes(drifted)
            drifted_dump = b"# configuration file /etc/nginx/nginx.conf:\n" + drifted
            drifted_manifest = replace(
                manifest,
                nginx=replace(
                    manifest.nginx,
                    site_sha256=digest(drifted),
                    dump_sha256=digest(drifted_dump),
                ),
            )
            with self.assertRaisesRegex(portal.RolloutError, "nginx_target"):
                portal.prepare(
                    drifted_manifest,
                    FakeSystem(drifted_dump, current_link=current, markers=markers),
                )

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
