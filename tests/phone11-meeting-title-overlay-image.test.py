"""Offline checks for the guarded one-file backend image overlay."""

from __future__ import annotations

import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / "scripts/phone11-meeting-title-overlay-image.py"
spec = importlib.util.spec_from_file_location("meeting_title_overlay", SCRIPT)
assert spec and spec.loader
overlay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(overlay)


class OverlayTests(unittest.TestCase):
    def test_history_requires_exact_parent_suffix(self):
        def encode(values):
            return "\n".join(json.dumps({"CreatedBy": command, "Size": size})
                             for command, size in values)
        parent = encode([("parent command", "1MB")])
        candidate = encode([("COPY bundle", "756kB"), ("parent command", "1MB")])
        with patch.object(overlay, "run", side_effect=[parent, candidate]):
            overlay.check_history("parent", "candidate")
        wrong = encode([("COPY bundle", "756kB"), ("different parent", "1MB")])
        with patch.object(overlay, "run", side_effect=[parent, wrong]):
            with self.assertRaisesRegex(RuntimeError, "history"):
                overlay.check_history("parent", "candidate")

    def test_dockerfile_keeps_one_file_copy_and_disables_inherited_healthcheck(self):
        source = overlay.dockerfile("phone11-meeting-title-parent:" + "a" * 32)
        self.assertIn("FROM --platform=linux/amd64 phone11-meeting-title-parent:", source)
        self.assertEqual(source.count("COPY "), 1)
        self.assertIn("COPY --chown=1001:1001 index.mjs /app/dist/index.mjs", source)
        self.assertIn('com.phone11.archive-sha256=""', source)
        self.assertIn('com.phone11.base-source-sha=""', source)
        self.assertIn("com.phone11.overlay-parent-image-id=", source)
        self.assertIn("HEALTHCHECK NONE", source)
        self.assertNotIn("\n+    ", source)
        with self.assertRaises(ValueError):
            overlay.dockerfile("not-an-immutable-parent")

    def test_image_verification_requires_exact_parent_layers_and_runtime(self):
        parent = {
            "Id": overlay.PARENT_IMAGE, "Os": "linux", "Architecture": "amd64",
            "RootFS": {"Layers": ["sha256:" + "a" * 64]},
            "Config": {"User": "cloudphone", "Cmd": ["node", "/app/dist/index.mjs"],
                       "Env": ["PORT=3008"], "Labels": {"com.phone11.lock-sha256": "old"}},
        }
        candidate = copy.deepcopy(parent)
        candidate["Id"] = "sha256:" + "b" * 64
        candidate["RootFS"]["Layers"].append("sha256:" + "c" * 64)
        candidate["Config"]["Labels"].update(overlay.PROVENANCE)
        candidate["Config"]["Healthcheck"] = {"Test": ["NONE"]}
        overlay.check_image(parent, candidate)
        broken = copy.deepcopy(candidate)
        broken["Config"]["Env"] = ["PORT=3009"]
        with self.assertRaisesRegex(RuntimeError, "runtime field changed"):
            overlay.check_image(parent, broken)
        broken = copy.deepcopy(candidate)
        broken["Config"]["Labels"]["com.phone11.archive-sha256"] = "stale"
        with self.assertRaisesRegex(RuntimeError, "provenance labels"):
            overlay.check_image(parent, broken)
        broken = copy.deepcopy(candidate)
        broken["RootFS"]["Layers"][0] = "sha256:" + "d" * 64
        with self.assertRaisesRegex(RuntimeError, "layers"):
            overlay.check_image(parent, broken)

    def saved_image(self, entries: list[tuple[str, bytes, int, int, int]]) -> tuple[Path, str]:
        layer_bytes = io.BytesIO()
        with tarfile.open(fileobj=layer_bytes, mode="w") as layer:
            for name, data, uid, gid, mode in entries:
                info = tarfile.TarInfo(name)
                info.size, info.uid, info.gid, info.mode = len(data), uid, gid, mode
                layer.addfile(info, io.BytesIO(data))
        target = Path(self.temp.name) / "saved.tar"
        with tarfile.open(target, "w") as archive:
            manifest = json.dumps([{"Layers": ["old/layer.tar", "new/layer.tar"]}]).encode()
            for name, data in (("manifest.json", manifest), ("new/layer.tar", layer_bytes.getvalue())):
                info = tarfile.TarInfo(name)
                info.size = len(data)
                archive.addfile(info, io.BytesIO(data))
        return target, "sha256:" + hashlib.sha256(layer_bytes.getvalue()).hexdigest()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.temp.cleanup()

    def test_added_layer_requires_only_pinned_bundle(self):
        # Use an injected digest to test the archive logic without embedding
        # the production JavaScript bundle in this test.
        original = overlay.BUNDLE_SHA
        try:
            overlay.BUNDLE_SHA = hashlib.sha256(b"reviewed bundle").hexdigest()
            good, layer_hash = self.saved_image([("app/dist/index.mjs", b"reviewed bundle", 1001, 1001, 0o644)])
            overlay.check_added_layer(good, layer_hash)
            with self.assertRaisesRegex(RuntimeError, "does not match image RootFS"):
                overlay.check_added_layer(good, "sha256:" + "0" * 64)
            extra, extra_hash = self.saved_image([
                ("app/dist/index.mjs", b"reviewed bundle", 1001, 1001, 0o644),
                ("app/secret", b"no", 1001, 1001, 0o644),
            ])
            with self.assertRaisesRegex(RuntimeError, "unexpected entry"):
                overlay.check_added_layer(extra, extra_hash)
            wrong_owner, owner_hash = self.saved_image([("app/dist/index.mjs", b"reviewed bundle", 0, 0, 0o644)])
            with self.assertRaisesRegex(RuntimeError, "ownership"):
                overlay.check_added_layer(wrong_owner, owner_hash)
        finally:
            overlay.BUNDLE_SHA = original


if __name__ == "__main__":
    unittest.main()
