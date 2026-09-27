from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "phone11-invitations-static-rollout.py"
SPEC = importlib.util.spec_from_file_location("phone11_invitations_static_rollout", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
rollout = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(rollout)


class InvitationStaticRolloutTests(unittest.TestCase):
    def make_export(self, root: Path) -> Path:
        export = root / "export"
        (export / "portal").mkdir(parents=True)
        (export / "auth").mkdir()
        (export / "_expo/static/js/web").mkdir(parents=True)
        (export / "index.html").write_text("<html>Phone11</html>")
        (export / "portal/index.html").write_text("<html>Portal</html>")
        (export / "auth/accept-invitation.html").write_text("<html>Accept</html>")
        (export / rollout.RELEASE_MAIN_JAVASCRIPT).write_text(
            f'const api="{rollout.API_ORIGIN}";'
        )
        return export

    def test_pins_are_sealed_and_predecessor_is_exact(self) -> None:
        rollout.validate_pins()
        controller = rollout.load_controller()
        actual = SimpleNamespace(source_sha=rollout.LIVE_RELEASE_SHA)
        self.assertIs(controller.require_predecessor_pin(actual, "managed_state"), actual)
        with self.assertRaises(controller.RolloutError):
            controller.require_predecessor_pin(
                SimpleNamespace(source_sha="009ce8abc2e0f3f8f070fd922abbcd802bb7718b"),
                "managed_state",
            )

    def test_unsealed_predecessor_fails_closed(self) -> None:
        original = rollout.LIVE_RELEASE_SHA
        try:
            rollout.LIVE_RELEASE_SHA = ""
            with self.assertRaisesRegex(rollout.ReleasePinError, "unsealed_predecessor"):
                rollout.validate_pins()
        finally:
            rollout.LIVE_RELEASE_SHA = original

    def test_verified_controller_bytes_are_required(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            changed = Path(tmp) / rollout.CONTROLLER_NAME
            changed.write_text("# substituted controller\n")
            with self.assertRaisesRegex(rollout.ReleasePinError, "controller_hash"):
                rollout.load_controller(changed)

    def test_wrong_source_sha_is_rejected_before_output_creation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = self.make_export(root)
            releases = root / "releases"
            with self.assertRaisesRegex(rollout.ReleasePinError, "source_sha"):
                rollout.package_export(source, releases, "a" * 40)
            self.assertFalse(releases.exists())

    def test_export_requires_acceptance_route_and_production_origin(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = self.make_export(root)
            (source / "auth/accept-invitation.html").unlink()
            with self.assertRaisesRegex(rollout.ReleasePinError, "export_routes"):
                rollout._export_files(source)

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = self.make_export(root)
            (source / rollout.RELEASE_MAIN_JAVASCRIPT).write_text(
                'const api="https://api.phone11.ai"; const fixture="http://localhost:3000";'
            )
            with self.assertRaisesRegex(rollout.ReleasePinError, "export_forbidden_origin"):
                rollout._export_files(source)

    def test_sealed_tree_validation_rejects_changed_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = self.make_export(root)
            release_dir = root / "releases" / rollout.RELEASE_SHA
            manifest_sha, _, _ = rollout._build_package(
                source, release_dir, rollout.RELEASE_SHA
            )
            self.assertEqual(release_dir.stat().st_mode & 0o777, 0o755)
            for packaged_file in release_dir.rglob("*"):
                if packaged_file.is_file():
                    self.assertEqual(packaged_file.stat().st_mode & 0o777, 0o644)
            controller = rollout.load_controller()
            release = controller.Release(
                rollout.RELEASE_SHA,
                release_dir,
                release_dir / rollout.EXPORT_MANIFEST_NAME,
                manifest_sha,
                root / "current",
            )
            controller.validate_release(release)
            (release_dir / "portal/index.html").write_text("<html>changed</html>")
            with self.assertRaisesRegex(controller.RolloutError, "release"):
                controller.validate_release(release)


if __name__ == "__main__":
    unittest.main()
