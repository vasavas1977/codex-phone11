"""Offline synthetic configuration/privacy checks; never license/device acceptance."""
import importlib.util
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
GENERATOR = ROOT / "scripts/generate-phone11-native-license.py"
spec = importlib.util.spec_from_file_location("native_license_generator", GENERATOR)
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)
FAILURE = "E_PHONE11_NATIVE_LICENSE_INPUT\n"


class NativeLicenseInputTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="phone11-license-test-")
        self.directory = Path(self.temporary.name).resolve()

    def tearDown(self):
        self.temporary.cleanup()

    def output(self, language):
        name = "Phone11SiprixBuildLicense.java" if language == "java" else "Phone11SiprixBuildLicense.h"
        return self.directory / "phone11-native-license" / name

    def run_generator(self, language, value=None, extra=(), output=None):
        # Deliberately don't inherit license/credential environment values.
        env = {"PATH": os.defpath}
        if value is not None:
            env["PHONE11_SIPRIX_LICENSE"] = value
        return subprocess.run(["python3", str(GENERATOR), "--language", language,
                               "--output", str(output or self.output(language)), *extra],
                              env=env, capture_output=True, text=True, timeout=10)

    def test_unset_and_whitespace_remain_empty_trial(self):
        for language in ("java", "cpp"):
            for value in (None, "", " \t\r\n "):
                result = self.run_generator(language, value)
                self.assertEqual((result.returncode, result.stdout, result.stderr), (0, "", ""))
                text = self.output(language).read_text()
                self.assertIn("new byte[]{}" if language == "java" else 'return ""', text)

    def test_synthetic_utf8_native_input_compiles_without_plaintext(self):
        value = 'SYNTHETIC-ONLY-quote"slash\\-ไทย'
        for language in ("java", "cpp"):
            result = self.run_generator(language, " " + value + " ")
            self.assertEqual((result.returncode, result.stdout, result.stderr), (0, "", ""))
            text = self.output(language).read_text()
            self.assertNotIn(value, text)
            self.assertNotIn("SYNTHETIC", text)
            if language == "java":
                compile_result = subprocess.run(["javac", "-Xlint:all", "-Werror", "-d",
                    str(self.directory / "classes"), str(self.output(language))], capture_output=True, text=True)
            else:
                probe = self.directory / "probe.cpp"
                probe.write_text('#include "Phone11SiprixBuildLicense.h"\nconst char* probe() { return Phone11NativeBuild::license(); }\n')
                compile_result = subprocess.run(["clang++", "-std=c++17", "-Wall", "-Wextra", "-Werror", "-fsyntax-only",
                    "-I", str(self.output(language).parent), str(probe)], capture_output=True, text=True)
            self.assertEqual(compile_result.returncode, 0, "Synthetic generated-language compile failed")

    def test_private_atomic_output_and_removed_input_refresh(self):
        self.assertEqual(self.run_generator("java", "SYNTHETIC-ONLY").returncode, 0)
        if os.name != "nt":
            self.assertEqual(stat.S_IMODE(self.output("java").stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(self.output("java").parent.stat().st_mode), 0o700)
        self.assertEqual(self.run_generator("java").returncode, 0)
        self.assertIn("new byte[]{}", self.output("java").read_text())
        self.assertEqual(list(self.output("java").parent.glob(".license-*")), [])

    def test_failure_is_constant_and_invalidates_old_input(self):
        for value in ("SYNTHETIC\nPRIVATE", "SYNTHETIC\tPRIVATE", "X" * 4097):
            self.assertEqual(self.run_generator("cpp", "SYNTHETIC-OLD").returncode, 0)
            result = self.run_generator("cpp", value)
            self.assertEqual((result.returncode, result.stdout, result.stderr), (1, "", FAILURE))
            self.assertFalse(self.output("cpp").exists())

    def test_unknown_arguments_never_echo_provider_or_key_text(self):
        result = self.run_generator("cpp", extra=("--SYNTHETIC-PRIVATE-ARG",))
        self.assertEqual((result.returncode, result.stdout, result.stderr), (1, "", FAILURE))

    def test_fake_sdk_refuses_nonempty_input_and_windows_needs_acl_proof(self):
        result = self.run_generator("cpp", "SYNTHETIC-ONLY", ("--trial-only",))
        self.assertEqual((result.returncode, result.stdout, result.stderr), (1, "", FAILURE))
        self.assertEqual(self.run_generator("cpp", " \t ", ("--trial-only",)).returncode, 0)
        with self.assertRaises(ValueError):
            generator.native_input("SYNTHETIC-ONLY", False, "nt")
        self.assertEqual(generator.native_input(" \n ", False, "nt"), b"")

    def test_symlink_and_shared_output_refused(self):
        private = self.output("cpp").parent
        private.mkdir(mode=0o700)
        victim = self.directory / "victim"
        victim.write_text("PRESERVE")
        self.output("cpp").symlink_to(victim)
        result = self.run_generator("cpp", "SYNTHETIC-ONLY")
        self.assertEqual((result.returncode, result.stdout, result.stderr), (1, "", FAILURE))
        self.assertEqual(victim.read_text(), "PRESERVE")
        self.output("cpp").unlink()
        if os.name != "nt":
            private.chmod(0o755)
            self.assertEqual(self.run_generator("cpp").stderr, FAILURE)

    def test_private_directory_symlink_and_lexical_root_alias_refused(self):
        target = self.directory / "private-target"
        target.mkdir(mode=0o700)
        self.output("cpp").parent.symlink_to(target, target_is_directory=True)
        result = self.run_generator("cpp", "SYNTHETIC-ONLY")
        self.assertEqual((result.returncode, result.stdout, result.stderr), (1, "", FAILURE))
        self.assertEqual(list(target.iterdir()), [])
        self.output("cpp").parent.unlink()
        alias = self.directory / "builder-alias"
        alias.symlink_to(self.directory, target_is_directory=True)
        result = self.run_generator("cpp", output=alias / "phone11-native-license" / "Phone11SiprixBuildLicense.h")
        self.assertEqual((result.returncode, result.stdout, result.stderr), (1, "", FAILURE))

    def test_native_only_setters_precede_initialization_and_gates_stay(self):
        android = (ROOT / "modules/phone11-siprix/android/src/main/java/ai/phone11/siprix/SiprixAndroidAdapter.java").read_text()
        self.assertLess(android.index("config.setLicense(buildLicense)"), android.index("core.initialize(config)"))
        helper = (ROOT / "desktop/native/phone11_siprix_helper.cpp").read_text()
        self.assertLess(helper.index("Siprix::Ini_SetLicense(ini, buildLicense)"), helper.index("Siprix::Module_Initialize(module_, ini)"))
        self.assertNotIn('getenv("PHONE11_SIPRIX_LICENSE")', helper)
        module = (ROOT / "modules/phone11-siprix/android/src/main/java/ai/phone11/siprix/Phone11SiprixModule.java").read_text()
        self.assertNotIn("buildLicense", module)
        self.assertNotIn("setLicense", module)
        self.assertIn('options==null||options.keySetIterator().hasNextKey()', module)
        self.assertIn('if(!BuildConfig.FOREGROUND_SOURCE_ENABLED)', module)
        trial = (ROOT / "modules/phone11-siprix/android/src/main/java/ai/phone11/siprix/Phone11ForegroundTrial.java").read_text()
        self.assertIn('"trialCallLimitSeconds", 60', trial)
        self.assertIn('"backgroundCalling", false', trial)
        config = (ROOT / "app.config.ts").read_text()
        self.assertIn('Android store distribution is not commissioned', config)
        gradle = (ROOT / "modules/phone11-siprix/android/build.gradle").read_text()
        self.assertIn('dependsOn stageSdkApi, generateNativeLicense', gradle)
        self.assertNotIn("buildConfigField 'String'", gradle)
        cmake = (ROOT / "desktop/native/CMakeLists.txt").read_text()
        self.assertIn('add_dependencies(phone11_siprix_helper phone11_native_license_input)', cmake)
        self.assertNotIn('$ENV{PHONE11_SIPRIX_LICENSE}', cmake)
        self.assertNotIn('CACHE STRING', cmake)


if __name__ == "__main__":
    unittest.main()
