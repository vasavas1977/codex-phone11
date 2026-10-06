#!/usr/bin/env python3
"""Inspect debug APK packaging only; never install, sign or activate calling."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
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
SDK_LOCK_PATH = Path(__file__).resolve().parents[1] / "modules/phone11-siprix/android/sdk-lock.json"
MAX_AAR_BYTES = 64 * 1024 * 1024
MAX_APK_BYTES = 512 * 1024 * 1024
MAX_NATIVE_BYTES = 32 * 1024 * 1024
MAX_DEX_BYTES = 64 * 1024 * 1024
MAX_DEX_TOTAL_BYTES = 256 * 1024 * 1024
MAX_ARCHIVE_ENTRIES = 100_000
CLASSES = (b"Lai/phone11/siprix/Phone11SiprixModule;", b"Lai/phone11/siprix/Phone11SiprixPackage;",
           b"Lai/phone11/siprix/Phone11ForegroundTrial;", b"Lai/phone11/siprix/Phone11CallRuntime;",
           b"Lai/phone11/siprix/Phone11ConsultationRuntime;",
           b"Lai/phone11/siprix/SiprixAndroidAdapter;",
           b"Lcom/siprix/SiprixCore;")


def snapshot(path: Path, limit: int, label: str) -> bytes:
    # Verify and inspect one bounded byte snapshot, including its final receipt.
    # A later path replacement cannot supply different checksum/ZIP inputs.
    if not stat.S_ISREG(path.stat().st_mode):
        raise ValueError(f"{label}_not_regular")
    # Descriptor validation catches path substitutions; nonblocking open also
    # prevents a replaced FIFO from hanging before that validation.
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NONBLOCK", 0))
    with os.fdopen(descriptor, "rb") as source:
        if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
            raise ValueError(f"{label}_not_regular")
        if os.fstat(source.fileno()).st_size > limit:
            raise ValueError(f"{label}_size_limit")
        data = source.read(limit + 1)
    if len(data) > limit:
        raise ValueError(f"{label}_size_limit")
    return data


def archive_names(archive: ZipFile, label: str) -> list[str]:
    entries = archive.infolist()
    if len(entries) > MAX_ARCHIVE_ENTRIES:
        raise ValueError(f"{label}_entry_limit")
    names = [entry.filename for entry in entries]
    if len(names) != len(set(names)):
        raise ValueError(f"duplicate_{label}_entries")
    for entry in entries:
        name = entry.filename
        parts = name.rstrip("/").split("/")
        if (entry.orig_filename != name or "\\" in name or name.startswith("/")
                or any(part in ("", ".", "..") for part in parts)):
            raise ValueError(f"unsafe_{label}_entry")
    return names


def native_hash(archive: ZipFile, name: str) -> str:
    entry = archive.getinfo(name)
    kind = stat.S_IFMT(entry.external_attr >> 16)
    if entry.is_dir() or kind not in (0, stat.S_IFREG) or entry.flag_bits & 1:
        raise ValueError("sdk_native_entry_not_regular")
    if not 0 < entry.file_size <= MAX_NATIVE_BYTES:
        raise ValueError("sdk_native_entry_size_limit")
    digest = hashlib.sha256()
    size = 0
    with archive.open(entry) as source:
        while chunk := source.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_NATIVE_BYTES:
                raise ValueError("sdk_native_entry_size_limit")
            digest.update(chunk)
    if size != entry.file_size:
        raise ValueError("sdk_native_entry_size_mismatch")
    return digest.hexdigest()


def verified_sdk_libraries(aar: Path | None) -> tuple[str, dict[str, str]]:
    if aar is None or not aar.is_absolute():
        raise ValueError("trial_pinned_sdk_aar_required")
    lock = json.loads(SDK_LOCK_PATH.read_text())
    expected_sha = lock.get("sha256")
    abis = lock.get("abis")
    if (not isinstance(expected_sha, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_sha)
            or not isinstance(abis, list) or len(abis) != 4
            or set(abis) != {"arm64-v8a", "armeabi-v7a", "x86", "x86_64"}):
        raise ValueError("invalid_sdk_lock")
    data = snapshot(aar, MAX_AAR_BYTES, "sdk_aar")
    if hashlib.sha256(data).hexdigest() != expected_sha:
        raise ValueError("trial_pinned_sdk_aar_checksum_mismatch")
    with ZipFile(io.BytesIO(data)) as archive:
        names = archive_names(archive, "sdk_aar")
        natives = {name for name in names if re.fullmatch(r"jni/[^/]+/libsiprix(?:Media)?\.so", name)}
        expected = {f"jni/{abi}/{library}" for abi in abis for library in LIBRARIES}
        if natives != expected:
            raise ValueError("pinned_sdk_native_inventory_mismatch")
        # Full AAR identity/inventory is pinned; the trial APK intentionally keeps
        # only its two ARM ABIs. Hash every retained native entry without loading it.
        hashes = {f"lib/{abi}/{library}": native_hash(archive, f"jni/{abi}/{library}")
                  for abi in ABIS for library in LIBRARIES}
    return expected_sha, hashes


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


def inspect_apk(apk: Path, manifest_xml: str, *, trial: bool, sdk_aar: Path | None = None) -> dict:
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
    if trial:
        if sdk_aar is None and os.environ.get("PHONE11_SIPRIX_ANDROID_AAR"):
            sdk_aar = Path(os.environ["PHONE11_SIPRIX_ANDROID_AAR"])
        sdk_sha, expected_hashes = verified_sdk_libraries(sdk_aar)
    apk_data = snapshot(apk, MAX_APK_BYTES, "apk")
    native_hashes = {}
    with ZipFile(io.BytesIO(apk_data)) as archive:
        names = archive_names(archive, "apk")
        siprix = {name for name in names if re.fullmatch(r"lib/[^/]+/libsiprix(?:Media)?\.so", name)}
        expected = {f"lib/{abi}/{library}" for abi in ABIS for library in LIBRARIES}
        dex_names = [name for name in names if re.fullmatch(r"classes(?:[2-9]|[1-9][0-9]+)?\.dex", name)]
        if not dex_names:
            raise ValueError("apk_dex_missing")
        if (any(archive.getinfo(name).file_size > MAX_DEX_BYTES for name in dex_names)
                or sum(archive.getinfo(name).file_size for name in dex_names) > MAX_DEX_TOTAL_BYTES):
            raise ValueError("apk_dex_size_limit")
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
            native_hashes = {name: native_hash(archive, name) for name in sorted(siprix)}
            mismatched = sorted(name for name in siprix if native_hashes[name] != expected_hashes[name])
            if mismatched:
                raise ValueError("trial_native_sdk_checksum_mismatch: " + json.dumps({"mismatched": mismatched}))
            missing = set(CLASSES) - definitions
            if missing:
                raise ValueError("trial_bridge_or_sdk_classes_missing: " +
                                 json.dumps({"missing": sorted(name.decode("ascii") for name in missing)}, sort_keys=True))
        elif siprix or set(CLASSES) & definitions:
            raise ValueError("ordinary_apk_contains_uncommissioned_runtime")
    receipt = {"schema": "phone11.android.debug-packaging.v1", "package": root.get("package"),
            "trial": trial, "apk_sha256": hashlib.sha256(apk_data).hexdigest(),
            "packaged_sdk_libraries": sorted(siprix), "dex_files": sorted(dex_names),
            "limits": "Packaging only; no installation, calling, background wake or production acceptance"}
    if trial:
        receipt.update({"pinned_sdk_aar_sha256": sdk_sha, "packaged_sdk_library_sha256": native_hashes})
    return receipt


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apk", type=Path, required=True)
    parser.add_argument("--apkanalyzer", required=True)
    parser.add_argument("--trial", action="store_true")
    parser.add_argument("--sdk-aar", type=Path, help="Pinned full SDK AAR; trial defaults to PHONE11_SIPRIX_ANDROID_AAR")
    args = parser.parse_args()
    result = subprocess.run([args.apkanalyzer, "manifest", "print", str(args.apk)],
                            check=True, capture_output=True, text=True, timeout=60)
    print(json.dumps(inspect_apk(args.apk, result.stdout, trial=args.trial, sdk_aar=args.sdk_aar), sort_keys=True))


if __name__ == "__main__":
    main()
