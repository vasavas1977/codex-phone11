#!/usr/bin/env python3
"""Synthetic APK parser failure cases; not native build or device evidence."""
import importlib.util
import hashlib
import io
import json
import os
from pathlib import Path
import struct
import tempfile
import unittest
import zlib
from zipfile import ZipFile

spec = importlib.util.spec_from_file_location("apk_check", Path(__file__).resolve().parents[1] / "scripts/verify-phone11-android-apk.py")
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)

# Independent exact source/pinned AAR names; do not generate fixtures from the
# verifier constants, which previously hid a nonexistent SDK package name.
PINNED_TRIAL_DEFINITIONS = (
    b"Lai/phone11/siprix/Phone11SiprixModule;", b"Lai/phone11/siprix/Phone11SiprixPackage;",
    b"Lai/phone11/siprix/Phone11ForegroundTrial;", b"Lai/phone11/siprix/Phone11CallRuntime;",
    b"Lai/phone11/siprix/Phone11ConsultationRuntime;",
    b"Lai/phone11/siprix/SiprixAndroidAdapter;", b"Lcom/siprix/SiprixCore;",
)


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
    def test_explicitly_staged_pinned_sdk_contains_the_expected_core_class(self):
        aar = os.environ.get("PHONE11_SIPRIX_ANDROID_AAR")
        if not aar:
            self.skipTest("No explicitly staged SDK; synthetic checks perform no download")
        sdk_lock = json.loads((Path(__file__).resolve().parents[1] / "modules/phone11-siprix/android/sdk-lock.json").read_text())
        data = Path(aar).read_bytes()
        self.assertEqual(hashlib.sha256(data).hexdigest(), sdk_lock["sha256"])
        with ZipFile(io.BytesIO(data)) as archive:
            with ZipFile(io.BytesIO(archive.read("classes.jar"))) as classes:
                names = set(classes.namelist())
        self.assertIn("com/siprix/SiprixCore.class", names)
        self.assertNotIn("com/siprix/voip/SiprixCore.class", names)
        self.assertIn(b"Lcom/siprix/SiprixCore;", check.CLASSES)

    def fixture(self, trial=True, exclude=None, missing_descriptor=False, package=None, gate=None, descriptors=None, define=True):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        apk = Path(directory.name) / "app.apk"
        with ZipFile(apk, "w") as archive:
            if descriptors is None:
                descriptors = PINNED_TRIAL_DEFINITIONS[:-1] if missing_descriptor else PINNED_TRIAL_DEFINITIONS
            archive.writestr("classes.dex", synthetic_dex(descriptors if trial else (b"Lordinary/App;",), define=define))
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
        self.assertEqual(set(check.CLASSES), set(PINNED_TRIAL_DEFINITIONS))
        for trial in (False, True):
            with self.subTest(trial=trial):
                apk, xml = self.fixture(trial)
                receipt = check.inspect_apk(apk, xml, trial=trial)
                self.assertEqual(len(receipt["packaged_sdk_libraries"]), 4 if trial else 0)

    def class_failure(self, apk, xml):
        with self.assertRaisesRegex(ValueError, "^trial_bridge_or_sdk_classes_missing: ") as caught:
            check.inspect_apk(apk, xml, trial=True)
        return json.loads(str(caught.exception).split(": ", 1)[1])

    def test_each_exact_bridge_and_sdk_definition_is_required(self):
        for descriptor in PINNED_TRIAL_DEFINITIONS:
            with self.subTest(descriptor=descriptor):
                apk, xml = self.fixture(descriptors=tuple(d for d in PINNED_TRIAL_DEFINITIONS if d != descriptor))
                self.assertEqual(self.class_failure(apk, xml), {"missing": [descriptor.decode("ascii")]})

    def test_wrong_sdk_namespace_and_similarly_named_class_cannot_satisfy_gate(self):
        for impostor in (b"Lcom/siprix/voip/SiprixCore;", b"Lcom/siprix/SiprixCoreFake;"):
            with self.subTest(impostor=impostor):
                apk, xml = self.fixture(descriptors=PINNED_TRIAL_DEFINITIONS[:-1] + (impostor,))
                self.assertEqual(self.class_failure(apk, xml), {"missing": ["Lcom/siprix/SiprixCore;"]})

    def test_reference_only_dex_cannot_satisfy_trial_class_gate(self):
        apk, xml = self.fixture(define=False)
        self.assertEqual(self.class_failure(apk, xml),
                         {"missing": sorted(d.decode("ascii") for d in PINNED_TRIAL_DEFINITIONS)})

    def test_exact_definitions_can_be_split_across_multiple_dex_files(self):
        apk, xml = self.fixture(descriptors=PINNED_TRIAL_DEFINITIONS[:3])
        with ZipFile(apk, "a") as archive:
            archive.writestr("classes2.dex", synthetic_dex(PINNED_TRIAL_DEFINITIONS[3:]))
        self.assertEqual(check.inspect_apk(apk, xml, trial=True)["dex_files"], ["classes.dex", "classes2.dex"])

    def test_ordinary_each_class_only_runtime_leak_refuses(self):
        for descriptor in PINNED_TRIAL_DEFINITIONS:
            with self.subTest(descriptor=descriptor):
                apk, xml = self.fixture(trial=False)
                with ZipFile(apk, "a") as archive:
                    archive.writestr("classes2.dex", synthetic_dex((descriptor,)))
                with self.assertRaisesRegex(ValueError, "ordinary_apk_contains_uncommissioned_runtime"):
                    check.inspect_apk(apk, xml, trial=False)

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

    def packaging_failure(self, apk, xml):
        with self.assertRaisesRegex(ValueError, "^trial_native_sdk_packaging_missing: ") as caught:
            check.inspect_apk(apk, xml, trial=True)
        return json.loads(str(caught.exception).split(": ", 1)[1])

    def test_full_four_abi_sdk_is_rejected_with_exact_unexpected_inventory(self):
        # Literal pinned AAR names: a full AAR must be filtered by the host build.
        apk, xml = self.fixture()
        extra = [f"lib/{abi}/{library}" for abi in ("x86", "x86_64")
                 for library in ("libsiprix.so", "libsiprixMedia.so")]
        with ZipFile(apk, "a") as archive:
            for name in extra:
                archive.writestr(name, b"synthetic-parser-fixture")
        self.assertEqual(self.packaging_failure(apk, xml),
                         {"missing": [], "unexpected": sorted(extra), "empty": []})

    def test_missing_and_empty_libraries_have_distinct_diagnostics(self):
        missing = "lib/arm64-v8a/libsiprix.so"
        apk, xml = self.fixture(exclude=missing)
        self.assertEqual(self.packaging_failure(apk, xml),
                         {"missing": [missing], "unexpected": [], "empty": []})
        apk, xml = self.fixture(exclude=missing)
        with ZipFile(apk, "a") as archive:
            archive.writestr(missing, b"")
        self.assertEqual(self.packaging_failure(apk, xml),
                         {"missing": [], "unexpected": [], "empty": [missing]})

    def test_ordinary_native_only_runtime_leak_refuses(self):
        apk, xml = self.fixture(trial=False)
        with ZipFile(apk, "a") as archive:
            archive.writestr("lib/x86/libsiprixMedia.so", b"synthetic-parser-fixture")
        with self.assertRaisesRegex(ValueError, "ordinary_apk_contains_uncommissioned_runtime"):
            check.inspect_apk(apk, xml, trial=False)

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
        self.assertEqual(check.defined_classes(synthetic_dex(PINNED_TRIAL_DEFINITIONS, define=False)), set())

    def test_corrupt_or_out_of_bounds_dex_refuses(self):
        dex = synthetic_dex(PINNED_TRIAL_DEFINITIONS)
        for raw in (b"not dex", dex[:-1], dex[:8] + b"x" + dex[9:]):
            with self.assertRaises(ValueError):
                check.defined_classes(raw)


if __name__ == "__main__":
    unittest.main()
