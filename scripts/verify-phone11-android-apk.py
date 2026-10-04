#!/usr/bin/env python3
"""Inspect debug APK packaging only; never install, sign or activate calling."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import subprocess
import xml.etree.ElementTree as ET
import zlib
from zipfile import ZipFile

PACKAGE = "ai.phone11.mobile"
TRIAL_PACKAGE = PACKAGE + ".foregroundtrial"
GATE = "ai.phone11.siprix.FOREGROUND_SOURCE_ENABLED"
ANDROID = "{http://schemas.android.com/apk/res/android}"
ABIS = {"arm64-v8a", "armeabi-v7a"}
LIBRARIES = {"libsiprix.so", "libsiprixMedia.so"}
CLASSES = (b"Lai/phone11/siprix/Phone11SiprixModule;", b"Lai/phone11/siprix/Phone11SiprixPackage;",
           b"Lai/phone11/siprix/Phone11ForegroundTrial;", b"Lai/phone11/siprix/Phone11CallRuntime;",
           b"Lai/phone11/siprix/SiprixAndroidAdapter;",
           b"Lcom/siprix/voip/SiprixCore;")


def defined_classes(dex: bytes) -> set[bytes]:
    """Read class definitions, not descriptor references elsewhere in DEX."""
    if len(dex) < 112 or not re.fullmatch(rb"dex\n0(?:35|37|38|39|40)\x00", dex[:8]):
        raise ValueError("invalid_dex_header")
    if (struct.unpack_from("<I", dex, 32)[0] != len(dex)
            or struct.unpack_from("<I", dex, 36)[0] != 112
            or struct.unpack_from("<I", dex, 40)[0] != 0x12345678
            or dex[12:32] != hashlib.sha1(dex[32:]).digest()
            or struct.unpack_from("<I", dex, 8)[0] != zlib.adler32(dex[12:]) & 0xFFFFFFFF):
        raise ValueError("invalid_dex_integrity")
    tables = []
    for header, width in ((56, 4), (64, 4), (96, 32)):
        count, offset = struct.unpack_from("<II", dex, header)
        if offset < 112 or count > len(dex) // width or offset + count * width > len(dex):
            raise ValueError("invalid_dex_table")
        tables.append((count, offset))
    (strings, string_offset), (types, type_offset), (classes, class_offset) = tables
    definitions = set()
    for row in range(classes):
        type_index = struct.unpack_from("<I", dex, class_offset + row * 32)[0]
        if type_index >= types:
            raise ValueError("invalid_dex_class_type")
        string_index = struct.unpack_from("<I", dex, type_offset + type_index * 4)[0]
        if string_index >= strings:
            raise ValueError("invalid_dex_descriptor_index")
        position = struct.unpack_from("<I", dex, string_offset + string_index * 4)[0]
        # Descriptor strings have a ULEB128 UTF-16 length then MUTF-8 bytes.
        for _ in range(5):
            if position >= len(dex):
                raise ValueError("invalid_dex_string")
            value = dex[position]
            position += 1
            if value < 128:
                break
        else:
            raise ValueError("invalid_dex_string_length")
        end = dex.find(b"\x00", position)
        if end < 0:
            raise ValueError("invalid_dex_string")
        definitions.add(dex[position:end])
    return definitions


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
        # Actual DEX definitions establish packaging, not runtime execution.
        definitions = set().union(*(defined_classes(archive.read(name)) for name in dex_names))
        if trial:
            empty = {name for name in siprix if archive.getinfo(name).file_size == 0}
            if siprix != expected or empty:
                # Log safe ZIP entry names, not SDK bytes, so a strict ABI mismatch
                # cannot be mistaken for an absent library or silently relaxed.
                inventory = {"missing": sorted(expected - siprix),
                             "unexpected": sorted(siprix - expected), "empty": sorted(empty)}
                raise ValueError("trial_native_sdk_packaging_missing: " + json.dumps(inventory, sort_keys=True))
            if not set(CLASSES) <= definitions:
                raise ValueError("trial_bridge_or_sdk_classes_missing")
        elif siprix or set(CLASSES) & definitions:
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
