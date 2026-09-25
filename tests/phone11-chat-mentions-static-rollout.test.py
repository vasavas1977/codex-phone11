#!/usr/bin/env python3
"""Pin and loader checks for the Team Chat Mentions static release entry point."""

from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "scripts/phone11-chat-mentions-static-rollout.py"
CONTROLLER = ROOT / "scripts/phone11-static-portal-rollout.py"
SPEC = importlib.util.spec_from_file_location("chat_mentions_static_rollout", WRAPPER)
assert SPEC and SPEC.loader
rollout = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = rollout
SPEC.loader.exec_module(rollout)

SEALED = {
    "RELEASE_SHA": "a" * 40,
    "LIVE_RELEASE_SHA": "8b567c74c0c88d2d6ef285e9b0977ea797fc8ba1",
    "RELEASE_EXPORT_MANIFEST_SHA256": "b" * 64,
    "RELEASE_ARCHIVE_SHA256": "e" * 64,
    "RELEASE_MARKER_SHA256": "c" * 64,
    "RELEASE_MAIN_JAVASCRIPT": "_expo/static/js/web/entry-1234abcd.js",
    "RELEASE_MAIN_JAVASCRIPT_SHA256": "d" * 64,
}


class ChatMentionsStaticRolloutTests(unittest.TestCase):
    def test_actual_release_pins_are_sealed_and_controller_loads(self):
        rollout.validate_pins()
        self.assertEqual(rollout.RELEASE_SHA, "60656db3d5d98f59c6f428371061158c8d54deff")
        self.assertEqual(rollout.LIVE_RELEASE_SHA, "8b567c74c0c88d2d6ef285e9b0977ea797fc8ba1")
        self.assertEqual(rollout.RELEASE_ARCHIVE_SHA256, "76c9f70743cf6cea20a2a6c984d0007404b82b71c49f0d829af9eaccaeba633b")
        module = rollout.load_controller(CONTROLLER)
        self.assertEqual(module.RELEASE_SHA, rollout.RELEASE_SHA)
        self.assertEqual(module.RELEASE_EXPORT_MANIFEST_SHA256, rollout.RELEASE_EXPORT_MANIFEST_SHA256)

    def test_exact_controller_bytes_load_with_separate_candidate_pins(self):
        with patch.multiple(rollout, **SEALED):
            module = rollout.load_controller(CONTROLLER)
            for key, value in SEALED.items():
                self.assertEqual(getattr(module, key), value)
            self.assertEqual(module.SCHEMA, "phone11-static-portal-rollout/v1")
            self.assertTrue(callable(module.validate_target_release))
            self.assertTrue(callable(module.validate_managed_predecessor))
            self.assertTrue(callable(module.restore))
            self.assertEqual(
                module.require_predecessor_pin(module.Release(SEALED["LIVE_RELEASE_SHA"], Path("/tmp/p"), Path("/tmp/m"), "b" * 64, Path("/tmp/current")), "managed_state").source_sha,
                SEALED["LIVE_RELEASE_SHA"],
            )
            with self.assertRaisesRegex(module.RolloutError, "managed_state"):
                module.require_predecessor_pin(module.Release("f" * 40, Path("/tmp/p"), Path("/tmp/m"), "b" * 64, Path("/tmp/current")), "managed_state")

    def test_changed_controller_rejected_before_execution(self):
        with tempfile.TemporaryDirectory() as directory:
            altered = Path(directory) / "controller.py"
            altered.write_bytes(CONTROLLER.read_bytes() + b"\n# drift\n")
            with patch.multiple(rollout, **SEALED):
                with self.assertRaisesRegex(rollout.ReleasePinError, "controller_hash"):
                    rollout.load_controller(altered)

    def test_symlinked_controller_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            linked = Path(directory) / "controller.py"
            linked.symlink_to(CONTROLLER)
            with patch.multiple(rollout, **SEALED):
                with self.assertRaisesRegex(rollout.ReleasePinError, "controller_file"):
                    rollout.load_controller(linked)

    def test_bad_entry_path_and_same_predecessor_are_rejected(self):
        with patch.multiple(rollout, **{**SEALED, "RELEASE_MAIN_JAVASCRIPT": "../../entry.js"}):
            with self.assertRaisesRegex(rollout.ReleasePinError, "unsealed_entry_path"):
                rollout.validate_pins()
        with patch.multiple(rollout, **{**SEALED, "RELEASE_SHA": SEALED["LIVE_RELEASE_SHA"]}):
            with self.assertRaisesRegex(rollout.ReleasePinError, "candidate_equals_predecessor"):
                rollout.validate_pins()


if __name__ == "__main__":
    unittest.main()
