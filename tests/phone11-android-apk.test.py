#!/usr/bin/env python3
"""Synthetic APK parser failure cases; not native build or device evidence."""
import importlib.util
import hashlib
from pathlib import Path
import struct
import tempfile
import unittest
import zlib
from zipfile import ZipFile

spec = importlib.util.spec_from_file_location("apk_check", Path(__file__).resolve().parents[1] / "scripts/verify-phone11-android-apk.py")
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


def synthetic_dex(descriptors, *, define=True):
    count = len(descriptors)
    strings = 112
    types = strings + count * 4
    classes = types + count * 4
    data = classes + count * 32
    raw = bytearray(data)
    raw[:8] = b"dex\n035\x00"
    struct.pack_into("<II", raw, 36, 112, 0x12345678)
    for header, offset, size in ((56, strings, count), (64, types, count), (96, classes, count if define else 0)):
        struct.pack_into("<II", raw, header, size, offset)
    for index, descriptor in enumerate(descriptors):
        struct.pack_into("<I", raw, strings + index * 4, len(raw))
        struct.pack_into("<I", raw, types + index * 4, index)
        struct.pack_into("<I", raw, classes + index * 32, index)
        raw.extend(bytes([len(descriptor)]) + descriptor + b"\x00")
    struct.pack_into("<I", raw, 32, len(raw))
    raw[12:32] = hashlib.sha1(raw[32:]).digest()
    struct.pack_into("<I", raw, 8, zlib.adler32(raw[12:]) & 0xFFFFFFFF)
    return bytes(raw)


class PackagingChecks(unittest.TestCase):
    def fixture(self, trial=True, exclude=None, missing_descriptor=False, package=None, gate=None):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        apk = Path(directory.name) / "app.apk"
        with ZipFile(apk, "w") as archive:
            descriptors = check.CLASSES[:-1] if missing_descriptor else check.CLASSES
            archive.writestr("classes.dex", synthetic_dex(descriptors if trial else (b"Lordinary/App;",)))
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

    def test_descriptor_references_are_not_class_definition_evidence(self):
        self.assertEqual(check.defined_classes(synthetic_dex(check.CLASSES, define=False)), set())

    def test_corrupt_or_out_of_bounds_dex_refuses(self):
        dex = synthetic_dex(check.CLASSES)
        for raw in (b"not dex", dex[:-1], dex[:8] + b"x" + dex[9:]):
            with self.assertRaises(ValueError):
                check.defined_classes(raw)


if __name__ == "__main__":
    unittest.main()
