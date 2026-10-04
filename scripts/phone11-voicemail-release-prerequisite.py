#!/usr/bin/env python3
"""File-only release prerequisite validation. Caller evidence is never authority."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import xml.etree.ElementTree as ET
from typing import Any

SCHEMA = "phone11-voicemail-release-prerequisite/v1"
REVIEWED_REVISION = "b13fd44014152378bbf6b100144b8035bb0b7cb5"
HELPERS = {
    "phone11_legacy_voicemail.lua": "6883384f279e1e8876f8b312c8783b3101c18b65d190275fbb870c0bba6dcfad",
    "phone11_voicemail_deposit.lua": "9552b2c6692c70387fec4eb6f3b13487e2f0f2b69c713a928294670dd86a629b",
}
HASH = re.compile(r"[a-f0-9]{64}\Z")
FREESWITCH = "p11-freeswitch"
MAX_SIZE = 1_048_576


class Refused(RuntimeError):
    """Only fixed codes, never imported data or private paths."""


def require(ok: bool, code: str) -> None:
    if not ok:
        raise Refused(code)


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def protected_file(path: Path, *, private: bool, uid: int = 0, gid: int = 0) -> bytes:
    """Walk with no-follow directory descriptors; do not open a FIFO or symlink."""
    require(path.is_absolute() and ".." not in path.parts, "prerequisite_file_path")
    directory = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    try:
        for component in path.parts[1:-1]:
            next_dir = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            os.close(directory)
            directory = next_dir
            info = os.fstat(directory)
            require(not stat.S_IMODE(info.st_mode) & 0o022, "prerequisite_directory_unsafe")
        parent = os.fstat(directory)
        require((parent.st_uid, parent.st_gid) == (uid, gid), "prerequisite_directory_owner")
        if private:
            require(stat.S_IMODE(parent.st_mode) == 0o700, "prerequisite_directory_private")
        fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        try:
            before = os.fstat(fd)
            require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1, "prerequisite_file_shape")
            require((before.st_uid, before.st_gid) == (uid, gid), "prerequisite_file_owner")
            require(stat.S_IMODE(before.st_mode) == 0o600 if private else not before.st_mode & 0o022,
                    "prerequisite_file_mode")
            require(before.st_size <= MAX_SIZE, "prerequisite_file_size")
            raw = bytearray()
            while len(raw) <= MAX_SIZE:
                chunk = os.read(fd, min(65_536, MAX_SIZE + 1 - len(raw)))
                if not chunk:
                    break
                raw.extend(chunk)
            after = os.fstat(fd)
            fields = ("st_dev", "st_ino", "st_size", "st_uid", "st_gid", "st_mode", "st_nlink", "st_mtime_ns", "st_ctime_ns")
            require(all(getattr(before, key) == getattr(after, key) for key in fields)
                    and len(raw) == before.st_size and len(raw) <= MAX_SIZE, "prerequisite_file_drift")
            return bytes(raw)
        finally:
            os.close(fd)
    except (OSError, ValueError) as error:
        raise Refused("prerequisite_file_unavailable") from error
    finally:
        os.close(directory)


def no_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "prerequisite_duplicate_key")
        result[key] = value
    return result


def exact(value: Any, keys: set[str]) -> None:
    require(isinstance(value, dict) and set(value) == keys, "prerequisite_shape")


def identity(value: Any) -> None:
    exact(value, {"name", "container_id", "image", "runtime_sha256", "hook_ready"})
    require(isinstance(value["name"], str) and re.fullmatch(r"[a-zA-Z0-9_.-]{1,128}", value["name"]) is not None,
            "prerequisite_identity")
    require(all(isinstance(value[key], str) and HASH.fullmatch(value[key]) for key in ("container_id", "runtime_sha256"))
            and isinstance(value["image"], str) and re.fullmatch(r"sha256:[a-f0-9]{64}", value["image"]),
            "prerequisite_identity")
    require(value["hook_ready"] is False, "prerequisite_flag_not_off")


def validate(value: Any, pins: dict[str, Any], now: float) -> None:
    exact(value, {"schema", "evidence_source", "observed_at", "reviewed_helper_revision", "candidate", "backend", "freeswitch", "helpers", "lua"})
    require(value["schema"] == SCHEMA and value["evidence_source"] == "caller_attestation"
            and value["reviewed_helper_revision"] == REVIEWED_REVISION, "prerequisite_scope")
    require(value["candidate"] == pins["candidate"], "prerequisite_candidate_mismatch")
    identity(value["backend"])
    identity(value["freeswitch"])
    require(value["backend"]["name"] == "cp11-api-candidate-sip-consistency"
            and all(value["backend"][key] == pins["predecessor"][key] for key in ("container_id", "image", "runtime_sha256")),
            "prerequisite_backend_mismatch")
    require(value["freeswitch"]["name"] == FREESWITCH
            and value["freeswitch"]["container_id"] != value["backend"]["container_id"], "prerequisite_freeswitch_mismatch")
    observed = value["observed_at"]
    require(isinstance(observed, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})", observed) is not None,
            "prerequisite_time")
    try:
        captured = datetime.fromisoformat(observed.replace("Z", "+00:00")).timestamp()
    except ValueError as error:
        raise Refused("prerequisite_time") from error
    require(0 <= now - captured <= 15 * 60, "prerequisite_stale_or_future")
    exact(value["helpers"], set(HELPERS))
    for name, expected in HELPERS.items():
        item = value["helpers"][name]
        exact(item, {"readable", "sha256"})
        require(item["readable"] is True and item["sha256"] == expected, "prerequisite_helper_mismatch")
    exact(value["lua"], {"module_probe_exit", "module_exists", "modules_config_sha256"})
    require(type(value["lua"]["module_probe_exit"]) is int and value["lua"]["module_probe_exit"] == 0
            and value["lua"]["module_exists"] is True, "prerequisite_lua_unknown_or_missing")
    require(isinstance(value["lua"]["modules_config_sha256"], str)
            and HASH.fullmatch(value["lua"]["modules_config_sha256"]), "prerequisite_configuration")


def modules_config(raw: bytes) -> None:
    # Parse the exact decoded text that was scanned. Passing raw bytes to Expat
    # would allow UTF-16/32 auto-detection to bypass ASCII directive checks.
    try:
        text = raw.decode("utf-8", errors="strict")
    except UnicodeError as error:
        raise Refused("prerequisite_configuration") from error
    require("\x00" not in text, "prerequisite_configuration")
    declaration = re.match(r'\ufeff?<\?xml\s+[^?]*\?>', text)
    if declaration:
        encoding = re.search(r'''\bencoding\s*=\s*(["'])([^"']+)\1''', declaration.group())
        if encoding:
            require(encoding.group(2).lower() in {"utf-8", "us-ascii", "ascii"}, "prerequisite_configuration")
            require(encoding.group(2).lower() == "utf-8" or text.isascii(), "prerequisite_configuration")
    require("<!DOCTYPE" not in text.upper() and "<!ENTITY" not in text.upper(), "prerequisite_configuration")
    require(re.search(r"\bxmlns\s*[:=]|<\?(?!xml\s)", text, re.IGNORECASE) is None,
            "prerequisite_configuration")
    try:
        root = ET.fromstring(text)
    except (ET.ParseError, ValueError) as error:
        raise Refused("prerequisite_configuration") from error
    require(root.tag == "configuration" and root.attrib.get("name") == "modules.conf", "prerequisite_configuration")
    for item in root.iter():
        require(isinstance(item.tag, str) and not item.tag.startswith("X-") and ":" not in item.tag and "{" not in item.tag
                and all(":" not in key and "{" not in key for key in item.attrib), "prerequisite_configuration")
        if item.tag == "modules":
            require(not item.attrib, "prerequisite_configuration")
    loads = [item for modules in root.findall("modules") for item in modules.findall("load") if item.attrib.get("module") == "mod_lua"]
    require(len(loads) == 1 and set(loads[0].attrib) == {"module"}, "prerequisite_configuration")


def read_prerequisite(path: Path, source_root: Path, pins: dict[str, Any], *, now: float,
                      uid: int = 0, gid: int = 0) -> tuple[dict[str, Any], str]:
    raw = protected_file(path, private=True, uid=uid, gid=gid)
    try:
        value = json.loads(raw, object_pairs_hook=no_duplicate_keys)
    except (ValueError, UnicodeError, RecursionError) as error:
        raise Refused("prerequisite_json") from error
    validate(value, pins, now)
    require(source_root.is_absolute(), "prerequisite_source_path")
    for name, expected in HELPERS.items():
        for tree in ("deploy/freeswitch/scripts", "infra/configs/freeswitch/scripts"):
            require(sha(protected_file(source_root / tree / name, private=False, uid=uid, gid=gid)) == expected,
                    "prerequisite_source_helper_mismatch")
        require(sha(protected_file(path.parent / "snapshot" / name, private=True, uid=uid, gid=gid)) == expected,
                "prerequisite_snapshot_helper_mismatch")
    config = protected_file(path.parent / "snapshot" / "modules.conf.xml", private=True, uid=uid, gid=gid)
    require(sha(config) == value["lua"]["modules_config_sha256"], "prerequisite_configuration_mismatch")
    modules_config(config)
    return value, sha(raw)
