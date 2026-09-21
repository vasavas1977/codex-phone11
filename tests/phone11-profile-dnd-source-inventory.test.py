#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/phone11-profile-dnd-source-inventory.py"
RELEASE = "d05a32ab4e80db25d681a75a08d124e3819c295b"
OLD = "50b6c3b62298b21baa778053d08ce1054422c608"


class SourceInventoryTest(unittest.TestCase):
    def run_inventory(self, release: str = RELEASE, baseline: str = OLD):
        return subprocess.run(
            [
                "python3", str(SCRIPT), "--repo", str(ROOT),
                "--release-sha", release, "--baseline-sha", baseline,
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
        )

    def test_reports_release_drain_and_old_baseline_gap_without_host_claim(self):
        result = self.run_inventory()
        self.assertEqual(result.returncode, 0, result.stderr)
        value = json.loads(result.stdout)
        self.assertEqual(value["schema"], "phone11-profile-dnd-source-inventory/v1")
        self.assertTrue(value["source_only"])
        self.assertFalse(value["host_admission_ready"])
        self.assertTrue(value["release"]["lifecycle"]["candidate_workerless"])
        self.assertTrue(value["release"]["lifecycle"]["http_admission_closes_before_worker_stop"])
        self.assertTrue(value["release"]["lifecycle"]["worker_ticks_are_awaited"])
        self.assertFalse(value["baseline"]["lifecycle"]["http_admission_closes_before_worker_stop"])
        self.assertFalse(value["baseline"]["lifecycle"]["worker_ticks_are_awaited"])
        self.assertEqual(
            value["required_external_controls"],
            ["edge_http_mutation_admission", "initial_sip_invite_admission"],
        )
        self.assertIn("/api/phone11/wake", value["http_admission_roots"])
        self.assertIn("chat_notification_dispatcher", value["default_workers"])

    def test_rejects_abbreviated_or_unknown_commit_identity(self):
        for value in ("d05a32a", "0" * 40):
            with self.subTest(value=value):
                result = self.run_inventory(release=value)
                self.assertEqual(result.returncode, 2)
                self.assertEqual(result.stdout, "")
                self.assertEqual(result.stderr, "source_inventory=BLOCKED\n")


if __name__ == "__main__":
    unittest.main()
