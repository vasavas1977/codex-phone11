#!/usr/bin/env python3
"""Inspect debug, foreground, native or wake APK candidates; never install, sign or activate calling."""
import argparse
import hashlib
import hmac
import io
import json
import os
from pathlib import Path
import re
import stat
import struct
import subprocess
import tempfile
import xml.etree.ElementTree as ET
import zlib
from urllib.parse import urlsplit
from zipfile import ZipFile

PACKAGE = "ai.phone11.mobile"
TRIAL_PACKAGE = PACKAGE + ".foregroundtrial"
NATIVE_PACKAGE = PACKAGE + ".androidcandidate"
WAKE_PACKAGE = PACKAGE + ".staging"
NATIVE_GATE = "ai.phone11.siprix.NATIVE_CANDIDATE_ENABLED"
WAKE_GATE = "ai.phone11.siprix.WAKE_CANDIDATE_ENABLED"
GATE = "ai.phone11.siprix.FOREGROUND_SOURCE_ENABLED"
ANDROID = "{http://schemas.android.com/apk/res/android}"
ABIS = {"arm64-v8a", "armeabi-v7a"}
LIBRARIES = {"libsiprix.so", "libsiprixMedia.so"}
SDK_LOCK_PATH = Path(__file__).resolve().parents[1] / "modules/phone11-siprix/android/sdk-lock.json"
EAS_PATH = Path(__file__).resolve().parents[1] / "eas.json"
WAKE_PROFILE = "preview-android-wake-candidate"
# Android ServiceInfo constants, including the compiled apkanalyzer representation.
PHONE_CALL_SERVICE_TYPE = 4
MICROPHONE_SERVICE_TYPE = 128
WAKE_SERVICES = {"ai.phone11.siprix." + name for name in (
    "Phone11FirebaseMessagingService", "Phone11IncomingCallService", "Phone11ConnectionService")}
WAKE_CLASSES = {("Lai/phone11/siprix/" + name + ";").encode("ascii") for name in (
    "Phone11FirebaseMessagingService", "Phone11IncomingCallService", "Phone11ConnectionService",
    "Phone11WakeProvider", "Phone11AndroidWakeCoordinator", "Phone11AndroidWakeState", "Phone11WakeHttp")} | {
        b"Lcom/google/firebase/FirebaseApp;", b"Lcom/google/firebase/messaging/FirebaseMessaging;"}
WAKE_PERMISSIONS = {"android.permission." + name for name in (
    "INTERNET", "ACCESS_NETWORK_STATE", "RECORD_AUDIO", "MODIFY_AUDIO_SETTINGS", "POST_NOTIFICATIONS",
    "FOREGROUND_SERVICE", "FOREGROUND_SERVICE_PHONE_CALL", "FOREGROUND_SERVICE_MICROPHONE", "MANAGE_OWN_CALLS", "WAKE_LOCK")}
MAX_AAR_BYTES = 64 * 1024 * 1024
MAX_APK_BYTES = 512 * 1024 * 1024
MAX_NATIVE_BYTES = 32 * 1024 * 1024
MAX_DEX_BYTES = 64 * 1024 * 1024
MAX_DEX_TOTAL_BYTES = 256 * 1024 * 1024
MAX_ARCHIVE_ENTRIES = 100_000
MAX_BUNDLE_BYTES = 64 * 1024 * 1024
BUNDLE_ENTRY = "assets/index.android.bundle"
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


def manifest_component_name(package: str, name: str) -> str:
    # Android resolves leading-dot and bare component names against the manifest
    # package. Namespace policy must inspect that effective class name.
    if name.startswith("."):
        return package + name
    if name and "." not in name:
        return package + "." + name
    return name


def foreground_service_type_mask(value: str) -> int | None:
    if re.fullmatch(r"0[xX][0-9a-fA-F]+|[0-9]+", value):
        return int(value, 16 if value.lower().startswith("0x") else 10)
    symbols = value.split("|")
    relevant = {"phoneCall": PHONE_CALL_SERVICE_TYPE, "microphone": MICROPHONE_SERVICE_TYPE}
    if not all(symbol in relevant for symbol in symbols):
        return None
    mask = 0
    for symbol in symbols:
        mask |= relevant[symbol]
    return mask


def has_phone_call_service_type(service) -> bool:
    value = service.get(ANDROID + "foregroundServiceType", "")
    mask = foreground_service_type_mask(value)
    return bool(mask & PHONE_CALL_SERVICE_TYPE) if mask is not None else "phoneCall" in value.split("|")


def wake_profile() -> dict:
    """Independent current source expectations; not proof of a build's environment."""
    profiles = json.loads(EAS_PATH.read_text())["build"]
    seen = set()
    def inherited(name):
        if name in seen or name not in profiles:
            raise ValueError("wake_candidate_profile_inheritance_invalid")
        seen.add(name)
        profile = profiles[name]
        return {**(inherited(profile["extends"]) if "extends" in profile else {}), **profile.get("env", {})}
    flags = inherited(WAKE_PROFILE)
    required = {name: "1" for name in (
        "PHONE11_ANDROID_FOREGROUND_TRIAL", "EXPO_PUBLIC_PHONE11_ANDROID_FOREGROUND_TRIAL",
        "PHONE11_ANDROID_NATIVE_CANDIDATE", "EXPO_PUBLIC_PHONE11_ANDROID_NATIVE_CANDIDATE",
        "PHONE11_ANDROID_WAKE_CANDIDATE", "EXPO_PUBLIC_PHONE11_ANDROID_WAKE_CANDIDATE",
        "PHONE11_ANDROID_CHAT_NOTIFICATIONS")}
    required.update({name: "0" for name in (
        "PHONE11_APP_STORE_BUILD", "PHONE11_VOIP_WAKE_COMMISSIONED", "PHONE11_CHAT_NOTIFICATIONS_COMMISSIONED",
        "PHONE11_ANDROID_SCREEN_TRANSACTION", "EXPO_PUBLIC_PHONE11_ANDROID_SCREEN_TRANSACTION")})
    required["EXPO_PUBLIC_SIP_ENGINE"] = "siprix"
    origin = flags.get("EXPO_PUBLIC_API_BASE_URL", "")
    parsed = urlsplit(origin)
    if (any(flags.get(name) != value for name, value in required.items()) or parsed.scheme != "https"
            or not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment
            or origin != parsed.geturl()):
        raise ValueError("wake_candidate_source_profile_invalid")
    return {"profile": WAKE_PROFILE, "origin": origin,
            "flags_sha256": hashlib.sha256(json.dumps(flags, sort_keys=True).encode()).hexdigest()}


def wake_manifest(root, app) -> None:
    if app.get(ANDROID + "enabled") not in (None, "true"):
        raise ValueError("wake_candidate_application_disabled")
    services = {manifest_component_name(WAKE_PACKAGE, item.get(ANDROID + "name", "")): item
                for item in app.findall("service")}
    if len(services) != len(app.findall("service")):
        raise ValueError("wake_candidate_duplicate_service")
    for name in WAKE_SERVICES:
        service = services.get(name)
        if service is None or service.get(ANDROID + "enabled") not in (None, "true"):
            raise ValueError("wake_candidate_service_missing_or_disabled")
        expected_exported = "true" if name.endswith("Phone11ConnectionService") else "false"
        if service.get(ANDROID + "exported") != expected_exported:
            raise ValueError("wake_candidate_service_export_boundary")
    def actions(service):
        return [action.get(ANDROID + "name") for intent in service.findall("intent-filter")
                for action in intent.findall("action")]
    fcm = services["ai.phone11.siprix.Phone11FirebaseMessagingService"]
    if (actions(fcm) != ["com.google.firebase.MESSAGING_EVENT"]
            or "expo.modules.notifications.service.ExpoFirebaseMessagingService" in services):
        raise ValueError("wake_candidate_fcm_ingress_invalid")
    incoming = services["ai.phone11.siprix.Phone11IncomingCallService"]
    if (foreground_service_type_mask(incoming.get(ANDROID + "foregroundServiceType", ""))
            != PHONE_CALL_SERVICE_TYPE | MICROPHONE_SERVICE_TYPE
            or incoming.get(ANDROID + "stopWithTask") != "false"):
        raise ValueError("wake_candidate_incoming_service_lifecycle")
    connection = services["ai.phone11.siprix.Phone11ConnectionService"]
    if (connection.get(ANDROID + "permission") != "android.permission.BIND_TELECOM_CONNECTION_SERVICE"
            or actions(connection) != ["android.telecom.ConnectionService"]):
        raise ValueError("wake_candidate_telecom_service_boundary")
    for name, service in services.items():
        if name in WAKE_SERVICES:
            continue
        if (service.get(ANDROID + "permission") == "android.permission.BIND_TELECOM_CONNECTION_SERVICE"
                or has_phone_call_service_type(service)
                or "android.telecom.ConnectionService" in actions(service)):
            raise ValueError("wake_candidate_unexpected_telecom_service")
    permissions = {item.get(ANDROID + "name"): item for item in root.findall("uses-permission")}
    if (not WAKE_PERMISSIONS <= permissions.keys()
            or any(permissions[name].get(ANDROID + "maxSdkVersion") is not None for name in WAKE_PERMISSIONS)):
        raise ValueError("wake_candidate_permissions_missing_or_limited")


def firebase_expectations(path: Path | None, project_id: str | None) -> tuple[dict, str]:
    if path is None or not path.is_absolute() or not re.fullmatch(r"[a-z][a-z0-9-]{4,28}[a-z0-9]", project_id or ""):
        raise ValueError("wake_candidate_matching_firebase_input_required")
    data = snapshot(path, 1024 * 1024, "google_services")
    try:
        config = json.loads(data)
        project = config["project_info"]
        clients = [client for client in config["client"]
                   if client["client_info"]["android_client_info"]["package_name"] == WAKE_PACKAGE]
        if len(clients) != 1 or project["project_id"] != project_id:
            raise ValueError()
        sender = str(project["project_number"])
        app_id = clients[0]["client_info"]["mobilesdk_app_id"]
        key = clients[0]["api_key"][0]["current_key"]
        if (not re.fullmatch(r"[0-9]+", sender) or not isinstance(app_id, str)
                or not re.fullmatch(r"1:" + sender + r":android:[0-9a-f]+", app_id)
                or not isinstance(key, str) or not key):
            raise ValueError()
    except (KeyError, IndexError, TypeError, ValueError):
        # Never include Google configuration contents or API key diagnostics.
        raise ValueError("wake_candidate_firebase_configuration_mismatch") from None
    return {"project_id": project_id, "gcm_defaultSenderId": sender, "google_app_id": app_id,
            "google_api_key": key}, hashlib.sha256(data).hexdigest()


def verify_firebase_resources(apkanalyzer: str, apk: Path, expected: dict) -> None:
    for name, value in expected.items():
        try:
            result = subprocess.run([apkanalyzer, "resources", "value", "--config", "default", "--type", "string",
                                     "--name", name, str(apk)], check=True, capture_output=True, text=True, timeout=60)
        except (OSError, subprocess.SubprocessError):
            raise ValueError("wake_candidate_firebase_resource_unavailable") from None
        if not hmac.compare_digest(result.stdout.strip(), value):
            raise ValueError("wake_candidate_firebase_resource_mismatch")


def inspect_apk(apk: Path, manifest_xml: str, *, trial: bool, sdk_aar: Path | None = None,
                standalone: bool = False, native_candidate: bool = False, wake_candidate: bool = False) -> dict:
    return inspect_apk_snapshot(snapshot(apk, MAX_APK_BYTES, "apk"), manifest_xml,
                                trial=trial, sdk_aar=sdk_aar, standalone=standalone, native_candidate=native_candidate,
                                wake_candidate=wake_candidate)


def inspect_apk_snapshot(apk_data: bytes, manifest_xml: str, *, trial: bool, sdk_aar: Path | None = None,
                         standalone: bool = False, native_candidate: bool = False, wake_candidate: bool = False) -> dict:
    if wake_candidate and (native_candidate or not (trial and standalone)):
        raise ValueError("wake_candidate_separate_standalone_mode_required")
    if native_candidate and not (trial and standalone):
        raise ValueError("native_candidate_standalone_required")
    if standalone and not trial:
        raise ValueError("standalone_foreground_trial_required")
    root = ET.fromstring(manifest_xml)
    if root.tag != "manifest" or root.get("package") != (WAKE_PACKAGE if wake_candidate else NATIVE_PACKAGE if native_candidate else TRIAL_PACKAGE if trial else PACKAGE):
        raise ValueError("unexpected_apk_identity")
    applications = root.findall("application")
    if len(applications) != 1:
        raise ValueError("unexpected_apk_application")
    app = applications[0]
    if standalone:
        if any(app.get(ANDROID + key) not in (None, "false") for key in ("debuggable", "testOnly")):
            raise ValueError("standalone_release_manifest_required")
        # Screen capture and Phone11-owned wake/push services are separate,
        # default-off capabilities. Generic Expo notification services do not
        # establish Phone11 wake/chat commissioning and are not rejected here.
        component_names = [(tag, manifest_component_name(root.get("package"), item.get(ANDROID + "name", "")))
                           for tag in ("service", "receiver") for item in app.findall(tag)]
        if any((name.startswith("ai.phone11.") and not (wake_candidate and tag == "service" and name in WAKE_SERVICES))
               or "Phone11ScreenProjectionService" in name for tag, name in component_names):
            raise ValueError("standalone_uncommissioned_service")
        if any(item.get(ANDROID + "name") == "android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION"
               for item in root.findall("uses-permission")):
            raise ValueError("standalone_screen_capture_permission")
        screen = [item.get(ANDROID + "value") for item in app.findall("meta-data")
                  if item.get(ANDROID + "name") == "ai.phone11.meeting.SCREEN_TRANSACTION"]
        if screen not in ([], ["false"]):
            raise ValueError("standalone_screen_capture_gate")
        updates = [item.get(ANDROID + "value") for item in app.findall("meta-data")
                   if item.get(ANDROID + "name") == "expo.modules.updates.ENABLED"]
        if updates not in ([], ["false"]):
            raise ValueError("standalone_ota_updates_enabled")
    elif app.get(ANDROID + "debuggable") != "true":
        raise ValueError("debug_trial_apk_required")
    gates = [item.get(ANDROID + "value") for item in app.findall("meta-data")
             if item.get(ANDROID + "name") == GATE]
    if (trial and gates != ["true"]) or (not trial and gates not in ([], ["false"])):
        raise ValueError("unexpected_apk_runtime_gate")
    if native_candidate:
        native_gates = [item.get(ANDROID + "value") for item in app.findall("meta-data")
                        if item.get(ANDROID + "name") == NATIVE_GATE]
        wake_gates = [item.get(ANDROID + "value") for item in app.findall("meta-data")
                      if item.get(ANDROID + "name") == WAKE_GATE]
        if native_gates != ["true"]:
            raise ValueError("native_candidate_metadata_required")
        if wake_gates not in ([], ["false"]):
            raise ValueError("native_candidate_wake_not_permitted")
        for service in app.findall("service"):
            if (service.get(ANDROID + "permission") == "android.permission.BIND_TELECOM_CONNECTION_SERVICE"
                    or has_phone_call_service_type(service)
                    or any(action.get(ANDROID + "name") == "android.telecom.ConnectionService"
                           for intent in service.findall("intent-filter") for action in intent.findall("action"))):
                raise ValueError("native_candidate_telecom_service_not_permitted")
        if any(item.get(ANDROID + "name") in {
                "android.permission.MANAGE_OWN_CALLS", "android.permission.FOREGROUND_SERVICE_PHONE_CALL",
                "android.permission.USE_FULL_SCREEN_INTENT"}
               for item in root.findall("uses-permission")):
            raise ValueError("native_candidate_wake_permission_not_permitted")
    if wake_candidate:
        profile = wake_profile()
        for name in (NATIVE_GATE, WAKE_GATE):
            if [item.get(ANDROID + "value") for item in app.findall("meta-data")
                    if item.get(ANDROID + "name") == name] != ["true"]:
                raise ValueError("wake_candidate_literal_metadata_required")
        wake_manifest(root, app)
    if trial:
        permissions = {item.get(ANDROID + "name") for item in root.findall("uses-permission")}
        if not {"android.permission.RECORD_AUDIO", "android.permission.INTERNET",
                "android.permission.MODIFY_AUDIO_SETTINGS"} <= permissions:
            raise ValueError("trial_audio_permissions_missing")
    if trial:
        if sdk_aar is None and os.environ.get("PHONE11_SIPRIX_ANDROID_AAR"):
            sdk_aar = Path(os.environ["PHONE11_SIPRIX_ANDROID_AAR"])
        sdk_sha, expected_hashes = verified_sdk_libraries(sdk_aar)
    native_hashes = {}
    with ZipFile(io.BytesIO(apk_data)) as archive:
        names = archive_names(archive, "apk")
        if standalone:
            if any(name.startswith("lib/") and len(name.split("/")) > 1
                   and name.split("/")[1] not in ABIS for name in names):
                raise ValueError("standalone_non_arm_native_inventory")
            if BUNDLE_ENTRY not in names:
                raise ValueError("standalone_embedded_bundle_required")
            entry = archive.getinfo(BUNDLE_ENTRY)
            kind = stat.S_IFMT(entry.external_attr >> 16)
            if (entry.is_dir() or kind not in (0, stat.S_IFREG) or entry.flag_bits & 1
                    or not 0 < entry.file_size <= MAX_BUNDLE_BYTES):
                raise ValueError("standalone_embedded_bundle_size_or_kind")
            bundle = archive.read(entry)
            # RN 0.81/Expo 54 default to Hermes. This is a bounded embedded asset
            # identity check, not execution or bytecode semantic validation.
            if len(bundle) < 32 or bundle[:8] != bytes.fromhex("c61fbc03c103191f"):
                raise ValueError("standalone_hermes_bundle_required")
            bundle_sha = hashlib.sha256(bundle).hexdigest()
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
        if wake_candidate:
            if not WAKE_CLASSES <= definitions:
                raise ValueError("wake_candidate_class_definitions_missing")
            if not any(profile["origin"].encode("ascii") in archive.read(name) for name in dex_names):
                raise ValueError("wake_candidate_current_native_origin_string_missing")
        if standalone and any(name.startswith(b"Lexpo/modules/updates/") for name in definitions):
            raise ValueError("standalone_ota_updates_runtime_present")
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
    if standalone:
        receipt.update({"schema": "phone11.android.standalone-inspection.v1",
                        "signature_verified": False, "embedded_bundle_sha256": bundle_sha,
                        "embedded_bundle_bytes": len(bundle), "embedded_bundle_format": "hermes",
                        "limits": "Unsigned byte inspection only; CLI signature verification and independent expected signer required. No installation, calling, wake or device acceptance."})
    if native_candidate:
        receipt.update({"schema": "phone11.android.native-candidate-inspection.v1",
                        "native_source_candidate": True, "wake_source_candidate": False,
                        "limits": "Unsigned native candidate byte inspection only; CLI signature verification and independent expected signer required. No background wake, provider or device acceptance."})
    if wake_candidate:
        receipt.update({"schema": "phone11.android.wake-candidate-inspection.v1",
                        "native_source_candidate": True, "wake_source_candidate": True,
                        "source_profile": profile, "firebase_resources_verified": False,
                        "origin_evidence": "Current source profile origin string present in DEX; native/JS flag semantics and effective runtime origin require exact build provenance and runtime validation.",
                        "limits": "Unsigned wake candidate byte inspection only; CLI signature and matching Firebase resources required. No installation, runtime wake, provider or physical-device acceptance."})
    return receipt


def verify_signature(apksigner: str, apk: Path, expected_signer: str) -> str:
    # The expected fingerprint comes from an independent signing custody receipt,
    # never from the APK/tool output being accepted. No keystore is opened here.
    if not re.fullmatch(r"[0-9a-fA-F]{64}", expected_signer or ""):
        raise ValueError("standalone_independent_signer_required")
    if not Path(apksigner).is_absolute() or not Path(apksigner).is_file():
        raise ValueError("standalone_apksigner_required")
    try:
        result = subprocess.run([apksigner, "verify", "--verbose", "--print-certs", str(apk)],
                                check=True, capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.SubprocessError):
        # Tool diagnostics may include local paths; emit no successful receipt or
        # raw external output when cryptographic verification fails.
        raise ValueError("standalone_signature_verification_failed") from None
    fingerprints = re.findall(r"^Signer #\d+ certificate SHA-256 digest: ([0-9a-fA-F]{64})\s*$",
                              result.stdout, re.MULTILINE)
    if (len(fingerprints) != 1 or not re.search(r"^Number of signers: 1\s*$", result.stdout, re.MULTILINE)
            or not re.search(r"^Verified using v[23](?:\.1)? scheme [^\n]+: true\s*$", result.stdout, re.MULTILINE)):
        raise ValueError("standalone_signature_inventory_invalid")
    if not hmac.compare_digest(fingerprints[0].lower(), expected_signer.lower()):
        raise ValueError("standalone_signer_mismatch")
    return fingerprints[0].lower()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apk", type=Path, required=True)
    parser.add_argument("--apkanalyzer", required=True)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--trial", action="store_true", help="Existing debug foreground trial inspection")
    mode.add_argument("--standalone-trial", action="store_true", help="Release foreground trial plus signature verification")
    mode.add_argument("--native-candidate", action="store_true", help="Release native candidate without wake; separate package, metadata and signature verification")
    mode.add_argument("--wake-candidate", action="store_true", help="Release staging wake candidate; exact services, current source origin, Firebase resources and signature verification")
    parser.add_argument("--apksigner", help="Installed Android SDK apksigner; required for all standalone candidate modes")
    parser.add_argument("--expected-signer-sha256", help="Independent trusted signing receipt fingerprint, not read from this APK")
    parser.add_argument("--sdk-aar", type=Path, help="Pinned full SDK AAR; trial defaults to PHONE11_SIPRIX_ANDROID_AAR")
    parser.add_argument("--google-services-file", type=Path, help="Matching private Google services input; wake defaults to PHONE11_ANDROID_GOOGLE_SERVICES_FILE")
    parser.add_argument("--expected-fcm-project-id", help="Independent expected Firebase project; wake defaults to PHONE11_ANDROID_FCM_PROJECT_ID")
    args = parser.parse_args()
    if args.standalone_trial and (not args.apksigner or not re.fullmatch(r"[0-9a-fA-F]{64}", args.expected_signer_sha256 or "")):
        parser.error("standalone trial requires installed apksigner and independent expected signer SHA-256")
    if args.native_candidate and (not args.apksigner or not re.fullmatch(r"[0-9a-fA-F]{64}", args.expected_signer_sha256 or "")):
        parser.error("native candidate requires installed apksigner and independent expected signer SHA-256")
    if args.wake_candidate and (not args.apksigner or not re.fullmatch(r"[0-9a-fA-F]{64}", args.expected_signer_sha256 or "")):
        parser.error("wake candidate requires installed apksigner and independent expected signer SHA-256")
    if args.wake_candidate:
        google_path = args.google_services_file or (Path(os.environ["PHONE11_ANDROID_GOOGLE_SERVICES_FILE"])
                         if os.environ.get("PHONE11_ANDROID_GOOGLE_SERVICES_FILE") else None)
        expected_firebase, google_sha = firebase_expectations(google_path, args.expected_fcm_project_id
                                                               or os.environ.get("PHONE11_ANDROID_FCM_PROJECT_ID"))
    # The analyzer and ZIP/DEX/hash gate must describe the same bounded bytes,
    # even if the caller's original path is replaced while the tool runs.
    apk_data = snapshot(args.apk, MAX_APK_BYTES, "apk")
    with tempfile.TemporaryDirectory(prefix="phone11-apk-verification-") as directory:
        tool_input = Path(directory) / "snapshot.apk"
        tool_input.write_bytes(apk_data)
        tool_input.chmod(0o400)
        result = subprocess.run([args.apkanalyzer, "manifest", "print", str(tool_input)],
                                check=True, capture_output=True, text=True, timeout=60)
        if snapshot(tool_input, MAX_APK_BYTES, "apk") != apk_data:
            raise ValueError("apk_analyzer_snapshot_changed")
        receipt = inspect_apk_snapshot(apk_data, result.stdout, trial=args.trial or args.standalone_trial or args.native_candidate or args.wake_candidate,
                                       sdk_aar=args.sdk_aar, standalone=args.standalone_trial or args.native_candidate or args.wake_candidate,
                                       native_candidate=args.native_candidate, wake_candidate=args.wake_candidate)
        if args.wake_candidate:
            verify_firebase_resources(args.apkanalyzer, tool_input, expected_firebase)
        if args.standalone_trial or args.native_candidate or args.wake_candidate:
            signer = verify_signature(args.apksigner, tool_input, args.expected_signer_sha256)
            if snapshot(tool_input, MAX_APK_BYTES, "apk") != apk_data:
                raise ValueError("apk_signature_snapshot_changed")
            receipt.update({"schema": "phone11.android.standalone-packaging.v1", "signature_verified": True,
                            "signer_certificate_sha256": signer,
                            "limits": "Signature and standalone trial packaging only; authenticate exact source/profile/build receipt separately. No installation, calling, wake or device acceptance."})
            if args.native_candidate:
                receipt.update({"schema": "phone11.android.native-candidate-packaging.v1",
                                "limits": "Signature and native candidate packaging only; verify exact source/profile/build separately. Wake disabled; no calling, provider or device acceptance."})
            if args.wake_candidate:
                receipt.update({"schema": "phone11.android.wake-candidate-packaging.v1",
                                "firebase_resources_verified": True, "google_services_sha256": google_sha,
                                "firebase_project_id": expected_firebase["project_id"],
                                "limits": "Signature, staging wake package and matching Firebase resources only; verify exact source/profile/build provenance separately. Native/JS flags are checked in current source profile, not proven as compiled semantics. No installation, runtime wake, provider or physical-device acceptance."})
    print(json.dumps(receipt, sort_keys=True))


if __name__ == "__main__":
    main()
