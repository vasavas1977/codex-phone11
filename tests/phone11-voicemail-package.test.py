import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts/phone11-voicemail-package.py"
SPEC = importlib.util.spec_from_file_location("phone11_voicemail_package", SCRIPT)
assert SPEC and SPEC.loader
package = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(package)


class PackageTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="phone11-vm-package-")
        self.root = Path(self.temp.name)
        self.source = self.root / "source"
        self.source.mkdir(mode=0o700)
        for name, (relative, _) in package.FILES.items():
            file = self.source / relative
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(("candidate " + name).encode())

    def tearDown(self):
        self.temp.cleanup()

    def test_private_exact_package_and_manifest(self):
        output = self.root / "release"
        digest = package.package_files(self.source, output, "a" * 40)
        manifest = json.loads((output / "release.json").read_text())
        self.assertEqual(manifest["source_sha"], "a" * 40)
        self.assertEqual(digest, package.digest((output / "release.json").read_bytes()))
        self.assertEqual(set(manifest["files"]), set(package.FILES))
        self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o700)
        for name, (_, mode) in package.FILES.items():
            self.assertEqual(stat.S_IMODE((output / name).stat().st_mode), mode)
            self.assertEqual(manifest["files"][name], package.digest((output / name).read_bytes()))

    def test_refuses_existing_output_and_public_parent(self):
        output = self.root / "release"
        output.mkdir()
        with self.assertRaisesRegex(ValueError, "output_must_be_new_absolute_path"):
            package.package_files(self.source, output, "a" * 40)
        public = self.root / "public"
        public.mkdir(mode=0o755)
        with self.assertRaisesRegex(ValueError, "invalid_output_parent"):
            package.package_files(self.source, public / "release", "a" * 40)

    def test_missing_or_symlinked_file_does_not_create_output(self):
        file = self.source / package.FILES["producer.mjs"][0]
        file.unlink()
        with self.assertRaises(OSError):
            package.package_files(self.source, self.root / "release", "a" * 40)
        self.assertFalse((self.root / "release").exists())
        file.symlink_to(self.source / package.FILES["relay.mjs"][0])
        with self.assertRaisesRegex(ValueError, "invalid_release_file"):
            package.package_files(self.source, self.root / "release", "a" * 40)


if __name__ == "__main__":
    unittest.main()
