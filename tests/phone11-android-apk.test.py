#!/usr/bin/env python3
"""Synthetic APK parser failure cases; not native build or device evidence."""
import importlib.util
import hashlib
import io
import json
import os
from pathlib import Path
import struct
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
import warnings
import zlib
from zipfile import BadZipFile, ZipFile, ZipInfo, ZIP_DEFLATED

spec = importlib.util.spec_from_file_location("apk_check", Path(__file__).resolve().parents[1] / "scripts/verify-phone11-android-apk.py")
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)
STAGED_AAR = os.environ.get("PHONE11_SIPRIX_ANDROID_AAR")
INSTALLED_APKSIGNER = os.environ.get("PHONE11_TEST_APKSIGNER")
SDK_ABIS = ("arm64-v8a", "armeabi-v7a", "x86", "x86_64")
SDK_LIBRARIES = ("libsiprix.so", "libsiprixMedia.so")

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
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.directory = Path(directory.name)
        self.aar = self.directory / "synthetic.aar"
        self.lock = self.directory / "sdk-lock.json"
        self.sdk_bytes = {f"jni/{abi}/{library}": f"synthetic {abi} {library}".encode()
                          for abi in SDK_ABIS for library in SDK_LIBRARIES}
        self.write_aar()
        for patch in (mock.patch.object(check, "SDK_LOCK_PATH", self.lock),
                      mock.patch.dict(os.environ, {"PHONE11_SIPRIX_ANDROID_AAR": str(self.aar)})):
            patch.start()
            self.addCleanup(patch.stop)

    def write_aar(self, entries=None):
        with ZipFile(self.aar, "w", compression=ZIP_DEFLATED) as archive:
            for name, data in (self.sdk_bytes if entries is None else entries).items():
                archive.writestr(name, data)
        self.pin_fixture()

    def pin_fixture(self):
        # Synthetic unit pins never change the repository SDK lock or CLI gate.
        self.lock.write_text(json.dumps({"sha256": hashlib.sha256(self.aar.read_bytes()).hexdigest(),
                                         "abis": list(SDK_ABIS)}))

    def test_explicitly_staged_pinned_sdk_contains_the_expected_core_class(self):
        aar = STAGED_AAR
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

        # Actual pinned SDK bytes in a synthetic APK establish byte comparison,
        # not the identity of any historical CI APK or ELF/runtime acceptance.
        apk, xml = self.fixture()
        with ZipFile(io.BytesIO(data)) as source:
            self.rewrite_apk(apk, {f"lib/{abi}/{library}": source.read(f"jni/{abi}/{library}")
                                  for abi in ("arm64-v8a", "armeabi-v7a") for library in SDK_LIBRARIES})
        real_lock = Path(__file__).resolve().parents[1] / "modules/phone11-siprix/android/sdk-lock.json"
        with mock.patch.object(check, "SDK_LOCK_PATH", real_lock):
            receipt = check.inspect_apk(apk, xml, trial=True, sdk_aar=Path(aar))
        self.assertEqual(receipt["pinned_sdk_aar_sha256"], sdk_lock["sha256"])
        self.assertEqual(len(receipt["packaged_sdk_library_sha256"]), 4)
        analyzer = self.directory / "apkanalyzer"
        analyzer.write_text("#!/usr/bin/env python3\nprint(" + repr(xml) + ")\n")
        analyzer.chmod(0o700)
        script = str(Path(__file__).resolve().parents[1] / "scripts/verify-phone11-android-apk.py")
        common = [sys.executable, script, "--trial", "--apk", str(apk), "--apkanalyzer", str(analyzer)]
        for arguments, env in ((common, {**os.environ, "PHONE11_SIPRIX_ANDROID_AAR": aar}),
                               (common + ["--sdk-aar", aar], {**os.environ, "PHONE11_SIPRIX_ANDROID_AAR": "wrong-env.aar"})):
            with self.subTest(explicit=arguments != common):
                result = subprocess.run(arguments, env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(json.loads(result.stdout)["packaged_sdk_library_sha256"], receipt["packaged_sdk_library_sha256"])

    def rewrite_apk(self, apk, replacements):
        with ZipFile(apk) as source:
            entries = {name: source.read(name) for name in source.namelist()}
        entries.update(replacements)
        with ZipFile(apk, "w") as archive:
            for name, data in entries.items():
                archive.writestr(name, data)

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
                            archive.writestr(name, self.sdk_bytes[f"jni/{abi}/{library}"])
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
                if trial:
                    self.assertEqual(receipt["pinned_sdk_aar_sha256"], json.loads(self.lock.read_text())["sha256"])
                    self.assertEqual(receipt["packaged_sdk_library_sha256"], {
                        f"lib/{abi}/{library}": hashlib.sha256(self.sdk_bytes[f"jni/{abi}/{library}"]).hexdigest()
                        for abi in ("arm64-v8a", "armeabi-v7a") for library in SDK_LIBRARIES})

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

    def standalone_fixture(self):
        apk, xml = self.fixture()
        self.rewrite_apk(apk, {"assets/index.android.bundle": bytes.fromhex("c61fbc03c103191f") + b"synthetic-parser-bytecode" * 4})
        return apk, xml.replace('debuggable="true"', 'debuggable="false"')

    def test_standalone_byte_inspection_never_claims_a_verified_signature(self):
        apk, xml = self.standalone_fixture()
        receipt = check.inspect_apk(apk, xml, trial=True, standalone=True)
        self.assertEqual(receipt["schema"], "phone11.android.standalone-inspection.v1")
        self.assertFalse(receipt["signature_verified"])
        self.assertEqual(receipt["embedded_bundle_format"], "hermes")
        with ZipFile(apk) as archive:
            self.assertEqual(receipt["embedded_bundle_sha256"], hashlib.sha256(
                archive.read("assets/index.android.bundle")).hexdigest())
        self.assertNotIn("signer_certificate_sha256", receipt)
        with self.assertRaisesRegex(ValueError, "standalone_foreground_trial_required"):
            check.inspect_apk(apk, xml, trial=False, standalone=True)

    def test_standalone_rejects_debuggable_testonly_and_nonliteral_release_values(self):
        apk, xml = self.standalone_fixture()
        for changed in (xml.replace('debuggable="false"', 'debuggable="true"'),
                        xml.replace('debuggable="false"', 'debuggable="@bool/unknown"'),
                        xml.replace('debuggable="false"', 'debuggable="false" android:testOnly="true"')):
            with self.subTest(manifest=changed):
                with self.assertRaisesRegex(ValueError, "standalone_release_manifest_required"):
                    check.inspect_apk(apk, changed, trial=True, standalone=True)
        receipt = check.inspect_apk(apk, xml.replace('android:debuggable="false"', ''), trial=True, standalone=True)
        self.assertFalse(receipt["signature_verified"])

    def test_standalone_requires_bounded_embedded_hermes_asset(self):
        apk, xml = self.fixture()
        xml = xml.replace('debuggable="true"', 'debuggable="false"')
        with self.assertRaisesRegex(ValueError, "standalone_embedded_bundle_required"):
            check.inspect_apk(apk, xml, trial=True, standalone=True)
        for blob in (b"", b"invalid JavaScript asset", b"wrong-header" * 20):
            self.rewrite_apk(apk, {"assets/index.android.bundle": blob})
            with self.assertRaisesRegex(ValueError, "standalone_(?:embedded_bundle_size_or_kind|hermes_bundle_required)"):
                check.inspect_apk(apk, xml, trial=True, standalone=True)
        apk, xml = self.standalone_fixture()
        with mock.patch.object(check, "MAX_BUNDLE_BYTES", 16):
            with self.assertRaisesRegex(ValueError, "standalone_embedded_bundle_size_or_kind"):
                check.inspect_apk(apk, xml, trial=True, standalone=True)

    def test_standalone_rejects_any_non_arm_library_not_only_siprix(self):
        apk, xml = self.standalone_fixture()
        self.rewrite_apk(apk, {"lib/x86_64/libother.so": b"uncommissioned ABI"})
        with self.assertRaisesRegex(ValueError, "standalone_non_arm_native_inventory"):
            check.inspect_apk(apk, xml, trial=True, standalone=True)

    def test_standalone_rejects_ota_configuration_or_runtime(self):
        apk, xml = self.standalone_fixture()
        metadata = '<meta-data android:name="expo.modules.updates.ENABLED" android:value="true"/>'
        with self.assertRaisesRegex(ValueError, "standalone_ota_updates_enabled"):
            check.inspect_apk(apk, xml.replace('</application>', metadata + '</application>'), trial=True, standalone=True)
        self.rewrite_apk(apk, {"classes2.dex": synthetic_dex((b"Lexpo/modules/updates/UpdatesController;",))})
        with self.assertRaisesRegex(ValueError, "standalone_ota_updates_runtime_present"):
            check.inspect_apk(apk, xml, trial=True, standalone=True)

    def test_standalone_rejects_phone11_wake_and_screen_activation(self):
        apk, xml = self.standalone_fixture()
        for element, error in [
            ('<service android:name="ai.phone11.siprix.Phone11WakeService"/>', "service"),
            ('<receiver android:name="ai.phone11.siprix.Phone11PushReceiver"/>', "service"),
            ('<service android:name="com.oney.WebRTCModule.Phone11ScreenProjectionService"/>', "service"),
            ('<meta-data android:name="ai.phone11.meeting.SCREEN_TRANSACTION" android:value="true"/>', "gate"),
        ]:
            with self.subTest(element=element):
                with self.assertRaisesRegex(ValueError, "standalone_(?:uncommissioned_service|screen_capture_gate)"):
                    check.inspect_apk(apk, xml.replace('</application>', element + '</application>'), trial=True, standalone=True)
        permission = '<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION"/>'
        with self.assertRaisesRegex(ValueError, "standalone_screen_capture_permission"):
            check.inspect_apk(apk, xml.replace('<application ', permission + '<application '), trial=True, standalone=True)

    def test_standalone_cli_rejects_missing_independent_certificate_before_tools(self):
        script = str(Path(__file__).resolve().parents[1] / "scripts/verify-phone11-android-apk.py")
        for flags in ([], ["--expected-signer-sha256", "bad"], ["--expected-signer-sha256", "0" * 64]):
            result = subprocess.run([sys.executable, script, "--standalone-trial", "--apk", "/absent.apk",
                                     "--apkanalyzer", "/absent-analyzer", *flags], capture_output=True, text=True)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(result.stdout, "")
            self.assertIn("independent expected signer", result.stderr)

    def test_standalone_resolves_relative_and_bare_phone11_service_and_receiver_names(self):
        for tag, short_name in (("service", "Phone11WakeService"), ("receiver", "Phone11PushReceiver")):
            full_name = "ai.phone11.mobile.foregroundtrial." + short_name
            for name in (full_name, "." + short_name, short_name):
                with self.subTest(tag=tag, name=name):
                    apk, xml = self.standalone_fixture()
                    descriptor = ("L" + full_name.replace(".", "/") + ";").encode("ascii")
                    self.rewrite_apk(apk, {"classes2.dex": synthetic_dex((descriptor,))})
                    element = f'<{tag} android:name="{name}"/>'
                    changed = xml.replace('</application>', element + '</application>')
                    with self.assertRaisesRegex(ValueError, "standalone_uncommissioned_service"):
                        check.inspect_apk(apk, changed, trial=True, standalone=True)
                    # Preserve the existing debug inspection contract even when
                    # the same component is present in the debug manifest.
                    debug_receipt = check.inspect_apk(apk, changed.replace('debuggable="false"', 'debuggable="true"'), trial=True)
                    self.assertEqual(debug_receipt["schema"], "phone11.android.debug-packaging.v1")

    def test_standalone_keeps_fully_qualified_generic_expo_components(self):
        apk, xml = self.standalone_fixture()
        elements = ('<service android:name="expo.modules.notifications.service.ExpoFirebaseMessagingService"/>'
                    '<receiver android:name="expo.modules.notifications.service.NotificationsService"/>')
        self.rewrite_apk(apk, {"classes2.dex": synthetic_dex((
            b"Lexpo/modules/notifications/service/ExpoFirebaseMessagingService;",
            b"Lexpo/modules/notifications/service/NotificationsService;"))})
        receipt = check.inspect_apk(apk, xml.replace('</application>', elements + '</application>'), trial=True, standalone=True)
        self.assertEqual(receipt["schema"], "phone11.android.standalone-inspection.v1")
        self.assertFalse(receipt["signature_verified"])

    def test_signature_failures_never_emit_or_accept_a_success_receipt(self):
        apk, _ = self.standalone_fixture()
        with self.assertRaisesRegex(ValueError, "standalone_independent_signer_required"):
            check.verify_signature("/absent-tool", apk, "not a fingerprint")
        with self.assertRaisesRegex(ValueError, "standalone_apksigner_required"):
            check.verify_signature("relative-apksigner", apk, "a" * 64)
        # Negative tool-boundary cases only. No mocked cryptographic success is
        # accepted anywhere in this suite; the real unsigned fixture is rejected
        # by the installed Android SDK tool in the separate test below.
        for error in (subprocess.CalledProcessError(1, "apksigner"), subprocess.TimeoutExpired("apksigner", 60)):
            with mock.patch.object(check.subprocess, "run", side_effect=error):
                with self.assertRaisesRegex(ValueError, "standalone_signature_verification_failed"):
                    check.verify_signature(str(self.aar), apk, "a" * 64)
        output = "Verified using v2 scheme (APK Signature Scheme v2): true\nNumber of signers: 1\nSigner #1 certificate SHA-256 digest: " + "b" * 64 + "\n"
        cases = [(output, "standalone_signer_mismatch"),
                 (output.replace("Number of signers: 1", "Number of signers: 2"), "inventory_invalid"),
                 (output + "Signer #2 certificate SHA-256 digest: " + "b" * 64 + "\n", "inventory_invalid"),
                 (output.replace("v2 scheme", "v1 scheme"), "inventory_invalid"), ("", "inventory_invalid")]
        for diagnostic, error in cases:
            with mock.patch.object(check.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, diagnostic, "")):
                with self.assertRaisesRegex(ValueError, error):
                    check.verify_signature(str(self.aar), apk, "a" * 64)

    @unittest.skipUnless(INSTALLED_APKSIGNER, "Explicit installed apksigner path required; no tool installation")
    def test_actual_apksigner_rejects_unsigned_fixture(self):
        apk, _ = self.standalone_fixture()
        with self.assertRaisesRegex(ValueError, "standalone_signature_verification_failed"):
            check.verify_signature(INSTALLED_APKSIGNER, apk, "a" * 64)

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

    def test_each_nonempty_native_byte_mutation_is_refused(self):
        for abi in ("arm64-v8a", "armeabi-v7a"):
            for library in SDK_LIBRARIES:
                with self.subTest(abi=abi, library=library):
                    apk, xml = self.fixture()
                    name = f"lib/{abi}/{library}"
                    self.rewrite_apk(apk, {name: self.sdk_bytes[f"jni/{abi}/{library}"] + b"changed"})
                    with self.assertRaisesRegex(ValueError, "^trial_native_sdk_checksum_mismatch: ") as caught:
                        check.inspect_apk(apk, xml, trial=True)
                    self.assertEqual(json.loads(str(caught.exception).split(": ", 1)[1]), {"mismatched": [name]})

    def test_swapped_abi_and_library_bytes_are_refused(self):
        for replacement in ("jni/armeabi-v7a/libsiprix.so", "jni/arm64-v8a/libsiprixMedia.so"):
            with self.subTest(replacement=replacement):
                apk, xml = self.fixture()
                self.rewrite_apk(apk, {"lib/arm64-v8a/libsiprix.so": self.sdk_bytes[replacement]})
                with self.assertRaisesRegex(ValueError, "trial_native_sdk_checksum_mismatch"):
                    check.inspect_apk(apk, xml, trial=True)

    def test_corrupt_native_zip_crc_refuses_without_success_receipt(self):
        apk, xml = self.fixture()
        with ZipFile(apk) as archive:
            entry = archive.getinfo("lib/arm64-v8a/libsiprix.so")
        raw = bytearray(apk.read_bytes())
        name_size, extra_size = struct.unpack_from("<HH", raw, entry.header_offset + 26)
        position = entry.header_offset + 30 + name_size + extra_size
        raw[position] ^= 1
        apk.write_bytes(raw)
        with self.assertRaisesRegex(BadZipFile, "Bad CRC"):
            check.inspect_apk(apk, xml, trial=True)

    def test_trial_requires_absolute_available_checksum_pinned_source_aar(self):
        apk, xml = self.fixture()
        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(ValueError, "trial_pinned_sdk_aar_required"):
                check.inspect_apk(apk, xml, trial=True)
        with self.assertRaisesRegex(ValueError, "trial_pinned_sdk_aar_required"):
            check.inspect_apk(apk, xml, trial=True, sdk_aar=Path("relative.aar"))
        with self.assertRaises(FileNotFoundError):
            check.inspect_apk(apk, xml, trial=True, sdk_aar=self.directory / "missing.aar")
        self.aar.write_bytes(self.aar.read_bytes() + b"changed source")
        with self.assertRaisesRegex(ValueError, "trial_pinned_sdk_aar_checksum_mismatch"):
            check.inspect_apk(apk, xml, trial=True)

    def test_ordinary_never_needs_or_consumes_sdk_path(self):
        apk, xml = self.fixture(trial=False)
        receipt = check.inspect_apk(apk, xml, trial=False, sdk_aar=self.directory / "absent")
        self.assertNotIn("pinned_sdk_aar_sha256", receipt)

    def test_duplicate_apk_or_source_aar_entries_refuse(self):
        for target, name in (("apk", "lib/arm64-v8a/libsiprix.so"), ("aar", "jni/arm64-v8a/libsiprix.so")):
            with self.subTest(target=target):
                apk, xml = self.fixture()
                self.write_aar()
                path = apk if target == "apk" else self.aar
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore", UserWarning)
                    with ZipFile(path, "a") as archive:
                        archive.writestr(name, b"duplicate")
                if target == "aar":
                    self.pin_fixture()
                with self.assertRaisesRegex(ValueError, f"duplicate_{'apk' if target == 'apk' else 'sdk_aar'}_entries"):
                    check.inspect_apk(apk, xml, trial=True)

    def test_pinned_source_missing_or_extra_abi_inventory_refuses(self):
        for missing in (True, False):
            with self.subTest(missing=missing):
                entries = dict(self.sdk_bytes)
                if missing:
                    del entries["jni/arm64-v8a/libsiprix.so"]
                else:
                    entries["jni/mips/libsiprix.so"] = b"extra"
                self.write_aar(entries)
                with self.assertRaisesRegex(ValueError, "pinned_sdk_native_inventory_mismatch"):
                    check.verified_sdk_libraries(self.aar)

    def test_archive_traversal_backslash_and_symlink_entries_refuse(self):
        for name in ("../outside", "lib/../arm64-v8a/libsiprix.so", "lib\\arm64-v8a\\libsiprix.so", "/absolute"):
            with self.subTest(name=name):
                apk, xml = self.fixture()
                with ZipFile(apk, "a") as archive:
                    archive.writestr(name, b"unsafe")
                with self.assertRaisesRegex(ValueError, "unsafe_apk_entry"):
                    check.inspect_apk(apk, xml, trial=True)
        apk, xml = self.fixture(exclude="lib/arm64-v8a/libsiprix.so")
        entry = ZipInfo("lib/arm64-v8a/libsiprix.so")
        entry.create_system = 3
        entry.external_attr = (stat.S_IFLNK | 0o777) << 16
        with ZipFile(apk, "a") as archive:
            archive.writestr(entry, self.sdk_bytes["jni/arm64-v8a/libsiprix.so"])
        with self.assertRaisesRegex(ValueError, "sdk_native_entry_not_regular"):
            check.inspect_apk(apk, xml, trial=True)

    def test_file_archive_dex_and_inflated_native_size_limits_refuse(self):
        apk, xml = self.fixture()
        for limit, value, expected in (("MAX_APK_BYTES", 1, "apk_size_limit"),
                                       ("MAX_AAR_BYTES", 1, "sdk_aar_size_limit"),
                                       ("MAX_ARCHIVE_ENTRIES", 1, "entry_limit"),
                                       ("MAX_DEX_BYTES", 1, "apk_dex_size_limit"),
                                       ("MAX_DEX_TOTAL_BYTES", 1, "apk_dex_size_limit"),
                                       ("MAX_NATIVE_BYTES", 1, "sdk_native_entry_size_limit")):
            with self.subTest(limit=limit), mock.patch.object(check, limit, value):
                with self.assertRaisesRegex(ValueError, expected):
                    check.inspect_apk(apk, xml, trial=True)
        # Small compressed bytes cannot evade the declared inflated-native bound.
        self.write_aar({**self.sdk_bytes, "jni/arm64-v8a/libsiprix.so": b"x" * 4096})
        with mock.patch.object(check, "MAX_NATIVE_BYTES", 1024):
            with self.assertRaisesRegex(ValueError, "sdk_native_entry_size_limit"):
                check.verified_sdk_libraries(self.aar)

    def test_existing_trial_cli_env_refuses_missing_and_unpinned_source(self):
        apk, xml = self.fixture()
        analyzer = self.directory / "apkanalyzer"
        analyzer.write_text("#!/usr/bin/env python3\nprint(" + repr(xml) + ")\n")
        analyzer.chmod(0o700)
        script = str(Path(__file__).resolve().parents[1] / "scripts/verify-phone11-android-apk.py")
        # Synthetic AAR cannot satisfy the production repository pin in a fresh
        # process even when every APK descriptor/library name is present.
        result = subprocess.run([sys.executable, script, "--trial", "--apk", str(apk),
                                 "--apkanalyzer", str(analyzer)], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("trial_pinned_sdk_aar_checksum_mismatch", result.stderr)
        self.assertEqual(result.stdout, "")
        env = {**os.environ, "PHONE11_SIPRIX_ANDROID_AAR": ""}
        result = subprocess.run([sys.executable, script, "--trial", "--apk", str(apk),
                                 "--apkanalyzer", str(analyzer)], env=env, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("trial_pinned_sdk_aar_required", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_cli_manifest_and_receipt_use_one_snapshot_despite_path_replacement(self):
        apk, xml = self.fixture(trial=False)
        initial = apk.read_bytes()
        replacement, _ = self.fixture(trial=False, package="unexpected.replacement")
        replacement_bytes = replacement.read_bytes() + b"replacement marker"
        observed = self.directory / "analyzer-observed.json"
        analyzer = self.directory / "replacing-apkanalyzer"
        analyzer.write_text("#!/usr/bin/env python3\n"
                            "import hashlib, json, sys\nfrom pathlib import Path\n"
                            "tool_input = Path(sys.argv[-1])\n"
                            "observed = {'path': str(tool_input), 'sha256': hashlib.sha256(tool_input.read_bytes()).hexdigest()}\n"
                            "Path(" + repr(str(observed)) + ").write_text(json.dumps(observed))\n"
                            "Path(" + repr(str(apk)) + ").write_bytes(" + repr(replacement_bytes) + ")\n"
                            "print(" + repr(xml) + ")\n")
        analyzer.chmod(0o700)
        script = str(Path(__file__).resolve().parents[1] / "scripts/verify-phone11-android-apk.py")
        result = subprocess.run([sys.executable, script, "--apk", str(apk), "--apkanalyzer", str(analyzer)],
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        receipt = json.loads(result.stdout)
        observation = json.loads(observed.read_text())
        self.assertEqual(apk.read_bytes(), replacement_bytes)
        self.assertEqual(receipt["apk_sha256"], hashlib.sha256(initial).hexdigest())
        self.assertEqual(receipt["apk_sha256"], observation["sha256"])
        self.assertNotEqual(observation["path"], str(apk))
        self.assertFalse(Path(observation["path"]).exists())

    def test_cli_refuses_changed_analyzer_snapshot_and_cleans_up_on_failure(self):
        apk, xml = self.fixture(trial=False)
        observed = self.directory / "tool-path"
        analyzer = self.directory / "corrupting-apkanalyzer"
        analyzer.write_text("#!/usr/bin/env python3\n"
                            "import sys\nfrom pathlib import Path\n"
                            "tool_input = Path(sys.argv[-1])\n"
                            "Path(" + repr(str(observed)) + ").write_text(str(tool_input))\n"
                            "tool_input.chmod(0o600)\n"
                            "tool_input.write_bytes(b'corrupt tool input')\n"
                            "print(" + repr(xml) + ")\n")
        analyzer.chmod(0o700)
        script = str(Path(__file__).resolve().parents[1] / "scripts/verify-phone11-android-apk.py")
        result = subprocess.run([sys.executable, script, "--apk", str(apk), "--apkanalyzer", str(analyzer)],
                                capture_output=True, text=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("apk_analyzer_snapshot_changed", result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertFalse(Path(observed.read_text()).exists())

    def test_empty_and_nonregular_source_or_packaged_native_entries_refuse(self):
        self.write_aar({**self.sdk_bytes, "jni/arm64-v8a/libsiprix.so": b""})
        with self.assertRaisesRegex(ValueError, "sdk_native_entry_size_limit"):
            check.verified_sdk_libraries(self.aar)
        self.write_aar()
        with self.assertRaisesRegex(ValueError, "sdk_aar_not_regular"):
            check.verified_sdk_libraries(self.directory)
        # Source checksum alone does not turn a symlink ZIP entry into a file.
        entries = dict(self.sdk_bytes)
        del entries["jni/arm64-v8a/libsiprix.so"]
        self.write_aar(entries)
        entry = ZipInfo("jni/arm64-v8a/libsiprix.so")
        entry.create_system = 3
        entry.external_attr = (stat.S_IFLNK | 0o777) << 16
        with ZipFile(self.aar, "a") as archive:
            archive.writestr(entry, self.sdk_bytes[entry.filename])
        self.pin_fixture()
        with self.assertRaisesRegex(ValueError, "sdk_native_entry_not_regular"):
            check.verified_sdk_libraries(self.aar)


if __name__ == "__main__":
    unittest.main()
