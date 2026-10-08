"""Real Xcode native build regression, empty/synthetic input only; no app launch."""
from pathlib import Path
import argparse
import json
import os
import stat
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def run_regression(sdk, evidence):
    evidence = evidence.resolve()
    evidence.mkdir(mode=0o700, parents=True, exist_ok=False)
    # Forward only nonsecret tooling PATH; never inherit the caller's license,
    # tokens, credentials or account environment into Xcode.
    environment = {"PATH": os.environ.get("PATH", os.defpath)}
    records = []

    def run(label, command, value=None, success=True):
        env = dict(environment)
        if value is not None:
            env["PHONE11_SIPRIX_LICENSE"] = value
        result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=120)
        streams = result.stdout + result.stderr
        assert not value or value not in streams, "Synthetic input appeared in build streams"
        (evidence / (label + ".txt")).write_text(streams)
        records.append({"label": label, "command": command, "exitCode": result.returncode,
                        "expectedSuccess": success, "input": "unset" if value is None else "synthetic"})
        print(label, result.returncode, flush=True)
        assert (result.returncode == 0) == success, "Unexpected build result; retained local compile evidence"

    for layout in ("canonical", "symlink"):
        if layout == "canonical":
            build = evidence / "canonical-build"
        else:
            target = evidence / "symlink-target"
            target.mkdir(mode=0o700)
            alias = evidence / "symlink-alias"
            alias.symlink_to(target, target_is_directory=True)
            build = alias / "build"
        run(layout + "-configure", ["cmake", "-S", str(ROOT / "desktop/native"), "-B", str(build),
            "-G", "Xcode", "-DSIPRIX_SDK_ROOT=" + str(sdk)])
        directory = build.resolve() / "phone11-native-license"
        header = directory / "Phone11SiprixBuildLicense.h"
        assert not directory.exists(), "Xcode/configure precreated private directory"
        full = ["cmake", "--build", str(build), "--config", "Release"]
        run(layout + "-full-unset", full)
        assert stat.S_IMODE(directory.stat().st_mode) == 0o700
        assert stat.S_IMODE(header.stat().st_mode) == 0o600
        assert 'return ""' in header.read_text()
        assert (build / "Release/phone11_siprix_helper.app/Contents/MacOS/phone11_siprix_helper").is_file()
        # Only the input target runs with a synthetic marker; never initialize SDK.
        run(layout + "-synthetic-generator", ["cmake", "--build", str(build), "--config", "Release",
            "--target", "phone11_native_license_input"], "SYNTHETIC-ONLY-XCODE-REGRESSION")
        assert 'return ""' not in header.read_text()
        run(layout + "-removed-full", full)
        assert 'return ""' in header.read_text()
        run(layout + "-clean", ["cmake", "--build", str(build), "--config", "Release", "--target", "clean"])
        # Emulate complete generated-output deletion after clean, not chmod repair.
        header.unlink(missing_ok=True)
        directory.rmdir()
        run(layout + "-deleted-output-full", full)
        assert stat.S_IMODE(directory.stat().st_mode) == 0o700
        assert stat.S_IMODE(header.stat().st_mode) == 0o600
        assert 'return ""' in header.read_text()
    (evidence / "RESULTS.json").write_text(json.dumps({"checks": records,
        "environment": "Nonsecret tooling PATH only; synthetic value only for generator targets; no real license or secrets inherited",
        "helperLaunched": False, "providerOrDeviceAcceptance": False}, indent=2) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--sdk-root", type=Path, required=True)
    parser.add_argument("--evidence", type=Path, required=True)
    arguments = parser.parse_args()
    run_regression(arguments.sdk_root.resolve(), arguments.evidence)
