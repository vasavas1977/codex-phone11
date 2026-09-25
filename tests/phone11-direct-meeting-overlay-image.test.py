"""Offline checks for the guarded one-file backend image overlay."""

from __future__ import annotations

import copy
import gzip
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / "scripts/phone11-direct-meeting-overlay-image.py"
spec = importlib.util.spec_from_file_location("direct_meeting_overlay", SCRIPT)
assert spec and spec.loader
overlay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(overlay)


class OverlayTests(unittest.TestCase):
    def test_build_selects_classic_builder_and_preserves_offline_pins(self):
        with patch.dict(overlay.os.environ, {"DOCKER_BUILDKIT": "1"}):
            with patch.object(overlay, "run") as command:
                overlay.build_with_classic_builder(Path("/private/context"), Path("/private/image-id"))
        args = command.call_args.args
        self.assertEqual(args[:2], ("docker", "build"))
        self.assertIn("--pull=false", args)
        self.assertIn("--network=none", args)
        self.assertIn("--platform=linux/amd64", args)
        self.assertEqual(args[args.index("--iidfile") + 1], "/private/image-id")
        self.assertEqual(args[-1], "/private/context")
        self.assertEqual(command.call_args.kwargs["env"]["DOCKER_BUILDKIT"], "0")

    def test_unavailable_classic_builder_rejects_candidate(self):
        with patch.object(overlay, "run", side_effect=RuntimeError("docker build failed with exit 1")):
            with self.assertRaisesRegex(RuntimeError, "classic Docker builder is unavailable.*not accepted"):
                overlay.build_with_classic_builder(Path("/private/context"), Path("/private/image-id"))

    def test_build_requires_root_before_reading_any_bundle(self):
        with patch.object(overlay.os, "geteuid", return_value=501):
            with self.assertRaisesRegex(RuntimeError, "root is required"):
                overlay.build(Path("/does/not/exist"))

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
        source = overlay.dockerfile("phone11-direct-meeting-parent:" + "a" * 32)
        self.assertIn("FROM --platform=linux/amd64 phone11-direct-meeting-parent:", source)
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
        broken["Config"]["Env"] = ["PORT=3011"]
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

    def saved_oci_image(
        self, entries: list[tuple[str, bytes, int, int, int]], *,
        codec: str = "application/vnd.docker.image.rootfs.diff.tar.gzip",
        corrupt_blob_name: bool = False,
        blob_override: bytes | None = None,
    ) -> tuple[Path, str]:
        layer_bytes = io.BytesIO()
        with tarfile.open(fileobj=layer_bytes, mode="w") as layer:
            for name, data, uid, gid, mode in entries:
                info = tarfile.TarInfo(name)
                info.size, info.uid, info.gid, info.mode = len(data), uid, gid, mode
                layer.addfile(info, io.BytesIO(data))
        raw = layer_bytes.getvalue()
        blob = blob_override if blob_override is not None else gzip.compress(raw, mtime=0)
        blob_hash = hashlib.sha256(blob).hexdigest()
        blob_name = "0" * 64 if corrupt_blob_name else blob_hash
        blob_path = "blobs/sha256/" + blob_name
        image_manifest = json.dumps({"layers": [{
            "mediaType": codec, "digest": "sha256:" + blob_name, "size": len(blob),
        }]}).encode()
        manifest_hash = hashlib.sha256(image_manifest).hexdigest()
        index = json.dumps({"manifests": [{
            "mediaType": "application/vnd.oci.image.manifest.v1+json",
            "digest": "sha256:" + manifest_hash, "size": len(image_manifest),
        }]}).encode()
        manifest = json.dumps([{"Layers": ["old/layer.tar", blob_path]}]).encode()
        target = Path(self.temp.name) / "saved-oci.tar"
        with tarfile.open(target, "w") as archive:
            for name, data in (
                ("manifest.json", manifest), ("index.json", index),
                ("blobs/sha256/" + manifest_hash, image_manifest), (blob_path, blob),
            ):
                info = tarfile.TarInfo(name)
                info.size = len(data)
                archive.addfile(info, io.BytesIO(data))
        return target, "sha256:" + hashlib.sha256(raw).hexdigest()

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

    def test_oci_gzip_layer_checks_blob_descriptor_diffid_and_one_file(self):
        original = overlay.BUNDLE_SHA
        try:
            overlay.BUNDLE_SHA = hashlib.sha256(b"reviewed bundle").hexdigest()
            good, diffid = self.saved_oci_image([
                ("app/dist/index.mjs", b"reviewed bundle", 1001, 1001, 0o644),
            ])
            overlay.check_added_layer(good, diffid)
            with self.assertRaisesRegex(RuntimeError, "does not match image RootFS"):
                overlay.check_added_layer(good, "sha256:" + "0" * 64)
            wrong_file, wrong_diffid = self.saved_oci_image([
                ("app/dist/index.mjs", b"reviewed bundle", 1001, 1001, 0o644),
                ("app/secret", b"no", 1001, 1001, 0o644),
            ])
            with self.assertRaisesRegex(RuntimeError, "unexpected entry"):
                overlay.check_added_layer(wrong_file, wrong_diffid)
        finally:
            overlay.BUNDLE_SHA = original

    def test_oci_gzip_layer_rejects_tampering_codec_and_decompression_bomb(self):
        entries = [("app/dist/index.mjs", b"reviewed bundle", 1001, 1001, 0o644)]
        tampered, diffid = self.saved_oci_image(entries, corrupt_blob_name=True)
        with self.assertRaisesRegex(RuntimeError, "blob hash changed"):
            overlay.check_added_layer(tampered, diffid)
        unsupported, diffid = self.saved_oci_image(entries, codec="application/vnd.oci.image.layer.v1.tar+zstd")
        with self.assertRaisesRegex(RuntimeError, "codec is unsupported"):
            overlay.check_added_layer(unsupported, diffid)
        invalid, diffid = self.saved_oci_image(entries, blob_override=b"not gzip")
        with self.assertRaisesRegex(RuntimeError, "not gzip"):
            overlay.check_added_layer(invalid, diffid)
        bomb, diffid = self.saved_oci_image([
            ("app/dist/index.mjs", b"x" * 8_000_001, 1001, 1001, 0o644),
        ])
        with self.assertRaisesRegex(RuntimeError, "uncompressed layer is unexpectedly large"):
            overlay.check_added_layer(bomb, diffid)


if __name__ == "__main__":
    unittest.main()
