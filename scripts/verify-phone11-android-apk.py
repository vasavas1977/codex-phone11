#!/usr/bin/env python3
"""Inspect debug APK packaging only; never install, sign or activate calling."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import xml.etree.ElementTree as ET
from zipfile import ZipFile

PACKAGE = "ai.phone11.mobile"
TRIAL_PACKAGE = PACKAGE + ".foregroundtrial"
GATE = "ai.phone11.siprix.FOREGROUND_SOURCE_ENABLED"
ANDROID = "{http://schemas.android.com/apk/res/android}"
ABIS = {"arm64-v8a", "armeabi-v7a"}
LIBRARIES = {"libsiprix.so", "libsiprixMedia.so"}
CLASSES = (b"Lai/phone11/siprix/Phone11SiprixModule;", b"Lai/phone11/siprix/Phone11SiprixPackage;",
           b"Lcom/siprix/voip/SiprixCore;")


def inspect_apk(apk: Path, manifest_xml: str, *, trial: bool) -> dict:
    root = ET.fromstring(manifest_xml)
    if root.tag != "manifest" or root.get("package") != (TRIAL_PACKAGE if trial else PACKAGE):
        raise ValueError("unexpected_apk_identity")
    applications = root.findall("application")
    if len(applications) != 1:
        raise ValueError("unexpected_apk_application")
    app = applications[0]
    if app.get(ANDROID + "debuggable") != "true":
        raise ValueError("debug_trial_apk_required")
    gates = [item.get(ANDROID + "value") for item in app.findall("meta-data")
             if item.get(ANDROID + "name") == GATE]
    if (trial and gates != ["true"]) or (not trial and gates not in ([], ["false"])):
        raise ValueError("unexpected_apk_runtime_gate")
    if trial:
        permissions = {item.get(ANDROID + "name") for item in root.findall("uses-permission")}
        if not {"android.permission.RECORD_AUDIO", "android.permission.INTERNET",
                "android.permission.MODIFY_AUDIO_SETTINGS"} <= permissions:
            raise ValueError("trial_audio_permissions_missing")
    with ZipFile(apk) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError("duplicate_apk_entries")
        siprix = {name for name in names if re.fullmatch(r"lib/[^/]+/libsiprix(?:Media)?\.so", name)}
        expected = {f"lib/{abi}/{library}" for abi in ABIS for library in LIBRARIES}
        dex_names = [name for name in names if re.fullmatch(r"classes(?:[2-9]|[1-9][0-9]+)?\.dex", name)]
        if not dex_names:
            raise ValueError("apk_dex_missing")
        # DEX class descriptors establish packaging, not runtime execution.
        dex = b"\n".join(archive.read(name) for name in dex_names)
        if trial:
            if siprix != expected or any(archive.getinfo(name).file_size == 0 for name in siprix):
                raise ValueError("trial_native_sdk_packaging_missing")
            if not all(descriptor in dex for descriptor in CLASSES):
                raise ValueError("trial_bridge_or_sdk_classes_missing")
        elif siprix or any(descriptor in dex for descriptor in CLASSES):
            raise ValueError("ordinary_apk_contains_uncommissioned_runtime")
    return {"schema": "phone11.android.debug-packaging.v1", "package": root.get("package"),
            "trial": trial, "apk_sha256": hashlib.sha256(apk.read_bytes()).hexdigest(),
            "packaged_sdk_libraries": sorted(siprix), "dex_files": sorted(dex_names),
            "limits": "Packaging only; no installation, calling, background wake or production acceptance"}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apk", type=Path, required=True)
    parser.add_argument("--apkanalyzer", required=True)
    parser.add_argument("--trial", action="store_true")
    args = parser.parse_args()
    result = subprocess.run([args.apkanalyzer, "manifest", "print", str(args.apk)],
                            check=True, capture_output=True, text=True, timeout=60)
    print(json.dumps(inspect_apk(args.apk, result.stdout, trial=args.trial), sort_keys=True))


if __name__ == "__main__":
    main()
