#!/usr/bin/env python3
"""Synthetic APK parser failure cases; not native build or device evidence."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile

spec = importlib.util.spec_from_file_location("apk_check", Path(__file__).resolve().parents[1] / "scripts/verify-phone11-android-apk.py")
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


class PackagingChecks(unittest.TestCase):
    def fixture(self, trial=True, exclude=None, missing_descriptor=False, package=None, gate=None):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        apk = Path(directory.name) / "app.apk"
        with ZipFile(apk, "w") as archive:
            descriptors = check.CLASSES[:-1] if missing_descriptor else check.CLASSES
            archive.writestr("classes.dex", b"\n".join(descriptors) if trial else b"ordinary")
            if trial:
                for abi in check.ABIS:
                    for library in check.LIBRARIES:
                        name = f"lib/{abi}/{library}"
                        if name != exclude:
                            archive.writestr(name, b"synthetic-parser-fixture")
        pkg = package or (check.TRIAL_PACKAGE if trial else check.PACKAGE)
        value = gate or ("true" if trial else "false")
        permissions = ''.join(f'<uses-permission android:name="android.permission.{name}"/>' for name in ("RECORD_AUDIO", "INTERNET", "MODIFY_AUDIO_SETTINGS"))
        xml = f'<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="{pkg}">{permissions}<application android:debuggable="true"><meta-data android:name="{check.GATE}" android:value="{value}"/></application></manifest>'
        return apk, xml

    def test_complete_trial_inventory_and_ordinary_absence(self):
        for trial in (False, True):
            with self.subTest(trial=trial):
                apk, xml = self.fixture(trial)
                receipt = check.inspect_apk(apk, xml, trial=trial)
                self.assertEqual(len(receipt["packaged_sdk_libraries"]), 4 if trial else 0)

    def test_wrong_identity_gate_or_non_debug_build_refuses(self):
        for args in ({"package": check.PACKAGE}, {"gate": "false"}):
            apk, xml = self.fixture(**args)
            with self.assertRaises(ValueError):
                check.inspect_apk(apk, xml, trial=True)
        apk, xml = self.fixture()
        with self.assertRaisesRegex(ValueError, "debug_trial"):
            check.inspect_apk(apk, xml.replace('debuggable="true"', 'debuggable="false"'), trial=True)

    def test_missing_sdk_library_or_bridge_class_refuses(self):
        for args in ({"exclude": "lib/arm64-v8a/libsiprix.so"}, {"missing_descriptor": True}):
            apk, xml = self.fixture(**args)
            with self.assertRaises(ValueError):
                check.inspect_apk(apk, xml, trial=True)

    def test_ordinary_runtime_leak_and_duplicate_gate_refuse(self):
        apk, xml = self.fixture()
        with self.assertRaises(ValueError):
            check.inspect_apk(apk, xml.replace(check.TRIAL_PACKAGE, check.PACKAGE).replace('value="true"', 'value="false"'), trial=False)
        apk, xml = self.fixture()
        duplicate = f'<meta-data android:name="{check.GATE}" android:value="true"/>'
        with self.assertRaisesRegex(ValueError, "runtime_gate"):
            check.inspect_apk(apk, xml.replace("</application>", duplicate + "</application>"), trial=True)

    def test_missing_audio_permission_refuses(self):
        apk, xml = self.fixture()
        with self.assertRaisesRegex(ValueError, "audio_permissions"):
            check.inspect_apk(apk, xml.replace('<uses-permission android:name="android.permission.RECORD_AUDIO"/>', ''), trial=True)


if __name__ == "__main__":
    unittest.main()
