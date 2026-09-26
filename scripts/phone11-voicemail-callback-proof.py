#!/usr/bin/env python3
"""Validate private, raw same-image FreeSWITCH callback evidence; never enable a hook."""

from __future__ import annotations

import argparse
from datetime import datetime
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import sys
import time
import wave
import xml.etree.ElementTree as ET


SCHEMA = "phone11.fs-callback-proof/v1"
LUA_SHA256 = "bbd3d515ead48e327b5b5010c0bd5bc331b920182b32d49355869c9a8def51ae"
PROBE_RUNNER_SHA256 = "a0bdaeabbae7d5918bc0f4872108f404bf27e2cccddc0899ebe8180da8228a93"
CLONE_HARNESS_SHA256 = "c6e5b5a7997b7981f4335755bf543a061512e0b0839618769be8a5bc4307788f"
FS_VERSION = "1.10.12-release-10222002881-a88d069"
MAX_AGE_SECONDS = 24 * 60 * 60
SHA256 = re.compile(r"[0-9a-f]{64}\Z")
SOURCE_SHA = re.compile(r"[0-9a-f]{40}\Z")
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\Z", re.I)
CASES = {
    "answered": (0, 0, False),
    "no_answer_dtmf": (1, 1, True),
    "caller_hangup": (1, 1, True),
    "early_abandon": (1, 0, False),
}
PROBE_NOTICE = re.compile(
    r"^[0-9a-f-]{36} \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+ "
    r"\S+ \[NOTICE\] mod_dptools\.c:\d+ PHONE11_VM_PROBE case=")


def emitted_probe_notice(line: str, name: str | None = None) -> bool:
    return (PROBE_NOTICE.match(line) is not None and
            (name is None or f"PHONE11_VM_PROBE case={name} " in line))


class ProofError(ValueError):
    pass


def require(condition: bool, stage: str) -> None:
    if not condition:
        raise ProofError(stage)


def private_directory(path: Path) -> None:
    try:
        info = path.lstat()
    except OSError as error:
        raise ProofError("callback_directory_privacy") from error
    require(stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode) and
            info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) == 0o700,
            "callback_directory_privacy")


def private_bytes(path: Path, max_size: int, proof_time: int | None = None) -> bytes:
    try:
        before = path.lstat()
    except OSError as error:
        raise ProofError("callback_file_privacy") from error
    require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and
            before.st_uid == os.getuid() and stat.S_IMODE(before.st_mode) == 0o600 and
            0 < before.st_size <= max_size, "callback_file_privacy")
    if proof_time is not None:
        require(proof_time - MAX_AGE_SECONDS <= before.st_mtime <= proof_time + 60,
                "callback_artifact_freshness")
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        data = bytearray()
        while len(data) <= max_size:
            chunk = os.read(fd, min(65536, max_size + 1 - len(data)))
            if not chunk:
                break
            data.extend(chunk)
        after = os.fstat(fd)
        require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) ==
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns) and
                len(data) == before.st_size, "callback_file_changed")
        return bytes(data)
    finally:
        os.close(fd)


def exact_keys(value: object, keys: set[str], stage: str) -> dict:
    require(type(value) is dict and set(value) == keys, stage)
    return value


def validate_inspect(raw: bytes, image_id: str) -> None:
    document = json.loads(raw)
    if type(document) is list:
        require(len(document) == 1, "callback_clone_inspect")
        document = document[0]
    require(type(document) is dict and document.get("Image") == image_id and
            isinstance(document.get("Id"), str) and
            re.fullmatch(r"[0-9a-f]{64}", document["Id"]) is not None,
            "callback_clone_identity")
    host = document.get("HostConfig")
    require(type(host) is dict and host.get("NetworkMode") == "none" and
            host.get("Binds") in (None, []) and host.get("Mounts") in (None, []) and
            host.get("PortBindings") in (None, {}) and
            host.get("PublishAllPorts") in (None, False) and
            host.get("Privileged") in (None, False) and
            type(host.get("Tmpfs")) is dict and set(host["Tmpfs"]) == {"/probe"} and
            document.get("Mounts") == [], "callback_clone_isolation")
    config = document.get("Config")
    env = config.get("Env") if type(config) is dict else None
    require(type(env) is list and all(type(item) is str and "=" in item for item in env),
            "callback_clone_environment")
    names = {item.split("=", 1)[0].upper() for item in env}
    require(not any(name.startswith(("PHONE11_", "FS_SHARED", "PG_", "DB_", "AWS_")) or
                    any(word in name for word in ("SECRET", "TOKEN", "PASSWORD", "CREDENTIAL", "DATABASE_URL"))
                    for name in names), "callback_clone_credentials")


def validate_wav(raw: bytes, seconds: int) -> None:
    require(raw[:4] == b"RIFF" and raw[8:12] == b"WAVE" and
            int.from_bytes(raw[4:8], "little") + 8 <= len(raw), "callback_wav_header")
    try:
        with wave.open(io.BytesIO(raw), "rb") as recording:
            rate = recording.getframerate()
            duration = recording.getnframes() / rate if rate else 0
            channels = recording.getnchannels()
    except (EOFError, ValueError, wave.Error) as error:
        raise ProofError("callback_wav_parse") from error
    require(rate >= 8000 and channels in (1, 2) and duration >= 1 and
            abs(duration - seconds) <= 2, "callback_wav_duration")


def validate_trace(raw: bytes, name: str) -> str:
    lines = raw.decode("utf8").splitlines()
    if name == "caller_hangup":
        evidence = caller_hangup_evidence(lines)
        require(evidence is not None and lines == evidence,
                "callback_hangup_outcome")
        return evidence[0].split(" ", 1)[0].lower()
    if name == "early_abandon":
        evidence = early_abandon_evidence(lines)
        require(evidence is not None and lines == evidence,
                "callback_abandon_outcome")
        return evidence[0].split(" ", 1)[0].lower()
    require(len(lines) == 2 and all(emitted_probe_notice(line, name) for line in lines),
            "callback_trace_count")
    identities = []
    for stage, line in zip(("before_lua", "after_lua"), lines):
        match = re.search(r"PHONE11_VM_PROBE case=([a-z_]+) uuid=([0-9a-f-]+) "
                          r"cause=([A-Z_]+) stage=([a-z_]+)(?:\s|$)", line)
        require(match is not None and match.group(1) == name and
                UUID.fullmatch(match.group(2)) and match.group(4) == stage and
                match.group(3) == ("NORMAL_CLEARING" if name == "answered" else "NO_ANSWER"),
                "callback_trace_outcome")
        identities.append(match.group(2).lower())
    require(identities[0] == identities[1], "callback_trace_identity")
    return identities[0]


def caller_hangup_evidence(lines: list[str]) -> list[str] | None:
    notices = [(i, line) for i, line in enumerate(lines)
               if emitted_probe_notice(line, "caller_hangup")]
    if len(notices) != 1 or "cause=NO_ANSWER stage=before_lua" not in notices[0][1]:
        return None
    before_index, before = notices[0]
    leg = before.split(" ", 1)[0].lower()
    if not UUID.fullmatch(leg) or f"uuid={leg} " not in before:
        return None
    hangups = [(i, line) for i, line in enumerate(lines)
               if line.startswith(leg + " ") and
               re.search(r"\[NOTICE\] mod_loopback\.c:\d+ Hangup "
                         r"loopback/9903-b \[CS_EXECUTE\] \[NORMAL_CLEARING\]$", line)]
    ends = [(i, line) for i, line in enumerate(lines)
            if line.startswith(leg + " ") and
            re.search(r"\[NOTICE\] switch_core_session\.c:\d+ Session \d+ "
                      r"\(loopback/9903-b\) Ended$", line)]
    if len(hangups) != 1 or len(ends) != 1:
        return None
    hangup_index, hangup = hangups[0]
    end_index, ended = ends[0]
    if not before_index < hangup_index < end_index:
        return None
    interval = lines[hangup_index + 1:end_index]
    deliveries = [line for line in interval if "Deliver VM to " in line]
    if len(deliveries) != 1 or not re.search(
            r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+ \S+ "
            r"\[DEBUG\] mod_voicemail\.c:\d+ Deliver VM to "
            r"9001@probe\.invalid$", deliveries[0]):
        return None
    delivery = deliveries[0]
    if any(emitted_probe_notice(line, case) for line in
           lines[before_index + 1:end_index] for case in CASES):
        return None
    try:
        hangup_time = datetime.fromisoformat(" ".join(hangup.split()[1:3]))
        delivery_time = datetime.fromisoformat(" ".join(delivery.split()[:2]))
    except ValueError:
        return None
    if not 0 <= (delivery_time - hangup_time).total_seconds() <= 1:
        return None
    return [before, hangup, delivery, ended]


def early_abandon_evidence(lines: list[str]) -> list[str] | None:
    notices = [(i, line) for i, line in enumerate(lines)
               if emitted_probe_notice(line, "early_abandon")]
    if len(notices) != 1 or "cause=NO_ANSWER stage=before_lua" not in notices[0][1]:
        return None
    before_index, before = notices[0]
    leg = before.split(" ", 1)[0].lower()
    if not UUID.fullmatch(leg) or f"uuid={leg} " not in before:
        return None
    hangups = [(i, line) for i, line in enumerate(lines)
               if line.startswith(leg + " ") and
               re.search(r"\[NOTICE\] mod_loopback\.c:\d+ Hangup "
                         r"loopback/9904-b \[CS_EXECUTE\] \[NORMAL_CLEARING\]$", line)]
    ends = [(i, line) for i, line in enumerate(lines)
            if line.startswith(leg + " ") and
            re.search(r"\[NOTICE\] switch_core_session\.c:\d+ Session \d+ "
                      r"\(loopback/9904-b\) Ended$", line)]
    if len(hangups) != 1 or len(ends) != 1:
        return None
    hangup_index, hangup = hangups[0]
    end_index, ended = ends[0]
    if not before_index < hangup_index < end_index or any(
            "Deliver VM to " in line for line in lines[before_index:]):
        return None
    if any(emitted_probe_notice(line, case) for line in
           lines[before_index + 1:] for case in CASES):
        return None
    try:
        before_time = datetime.fromisoformat(" ".join(before.split()[1:3]))
        hangup_time = datetime.fromisoformat(" ".join(hangup.split()[1:3]))
    except ValueError:
        return None
    if not 0 <= (hangup_time - before_time).total_seconds() <= 2:
        return None
    return [before, hangup, ended]


def validate_provenance(root: Path, receipt: dict, proof_time: int) -> bytes:
    files = {
        "clone-console.log": (8 * 1024 * 1024, "clone_console_sha256"),
        "loaded-dialplan.xml": (1024 * 1024, "loaded_dialplan_sha256"),
        "harness-transcript.log": (1024 * 1024, "harness_transcript_sha256"),
        "clone-harness.py": (128 * 1024, "clone_harness_sha256"),
    }
    raw = {}
    for name, (limit, field) in files.items():
        raw[name] = private_bytes(root / name, limit, proof_time)
        require(type(receipt[field]) is str and SHA256.fullmatch(receipt[field]) and
                hashlib.sha256(raw[name]).hexdigest() == receipt[field],
                "callback_provenance_pin")
    require(receipt["clone_harness_sha256"] == CLONE_HARNESS_SHA256,
            "callback_harness_source_pin")
    console = raw["clone-console.log"]
    lines = console.decode("utf8").splitlines()
    markers = [line for line in lines if emitted_probe_notice(line)]
    require(len(markers) == 2 * len(CASES) - 2, "callback_console_marker_count")
    for name in CASES:
        case_lines = [line for line in markers if emitted_probe_notice(line, name)]
        actual_trace = raw_case_trace(root, name, proof_time).decode("utf8").splitlines()
        if name == "caller_hangup":
            expected = caller_hangup_evidence(lines)
            require(len(case_lines) == 1 and expected is not None and
                    actual_trace == expected, "callback_console_trace_binding")
        elif name == "early_abandon":
            expected = early_abandon_evidence(lines)
            require(len(case_lines) == 1 and expected is not None and
                    actual_trace == expected, "callback_console_trace_binding")
        else:
            require(len(case_lines) == 2 and actual_trace == case_lines,
                    "callback_console_trace_binding")
    try:
        xml = ET.fromstring(raw["loaded-dialplan.xml"])
    except ET.ParseError as error:
        raise ProofError("callback_loaded_dialplan") from error
    extensions = xml.findall(".//extension")
    for name in CASES:
        matches = [extension for extension in extensions
                   if extension.get("name") == f"phone11_probe_{name}"]
        require(len(matches) == 1, "callback_loaded_dialplan")
        actions = [(action.get("application"), action.get("data", ""))
                   for action in matches[0].findall("./condition/action")]
        sentinel = f"PHONE11_VM_PROBE case={name} uuid=${{uuid}} cause=${{bridge_hangup_cause}}"
        expected = [("log", f"NOTICE {sentinel} stage=before_lua"),
                    ("lua", "/etc/freeswitch/scripts/phone11_voicemail_deposit.lua "
                     "1 9001 9001 probe.invalid"),
                    ("log", f"NOTICE {sentinel} stage=after_lua")]
        require(any(actions[index:index + 3] == expected
                    for index in range(len(actions) - 2)), "callback_loaded_dialplan")
    transcript = raw["harness-transcript.log"].decode("utf8")
    require(all(f"case={name} caller_uuid=" in transcript for name in CASES) and
            "network=none mounts=none" in transcript, "callback_harness_transcript")
    require(len(re.findall(r"^case=early_abandon "
                           r"mailbox_inventory_unchanged_sha256=[0-9a-f]{64}$",
                           transcript, re.M)) == 1,
            "callback_abandon_mailbox_inventory")
    return console


def raw_case_trace(root: Path, name: str, proof_time: int) -> bytes:
    return private_bytes(root / name / "fs-trace.log", 65536, proof_time)


def media_for_completion(directory: Path, complete: dict, snapshot_sha: str,
                         proof_time: int) -> bytes:
    raw = private_bytes(directory / "complete-media.txt", 8192, proof_time)
    require(type(snapshot_sha) is str and SHA256.fullmatch(snapshot_sha) and
            hashlib.sha256(raw).hexdigest() == snapshot_sha, "callback_media_snapshot_pin")
    lines = raw.decode("utf8").splitlines()
    require(len(lines) == 6 and [line.split("=", 1)[0] for line in lines] ==
            ["path", "sha256", "size", "mtime", "complete_mtime", "observed"] and
            all("=" in line for line in lines), "callback_media_snapshot")
    values = dict(line.split("=", 1) for line in lines)
    completed_path = complete["voicemailFilePath"]
    require(values["path"] == completed_path and
            SHA256.fullmatch(values["sha256"]) and
            all(re.fullmatch(r"[0-9]+", values[key]) for key in
                ("size", "mtime", "complete_mtime", "observed")),
            "callback_media_identity")
    relative = Path(completed_path.removeprefix("/probe/"))
    media_root = directory / "media"
    private_directory(media_root)
    target = media_root / relative
    expected = {relative}
    parent = relative.parent
    while parent != Path("."):
        expected.add(parent)
        private_directory(media_root / parent)
        parent = parent.parent
    require({entry.relative_to(media_root) for entry in media_root.rglob("*")} == expected,
            "callback_media_files")
    wav = private_bytes(target, 25 * 1024 * 1024, proof_time)
    info = target.stat()
    observed = int(values["observed"])
    mtime = int(values["mtime"])
    complete_mtime = int(values["complete_mtime"])
    require(len(wav) == int(values["size"]) and int(info.st_mtime) == mtime and
            mtime <= complete_mtime <= observed <= complete_mtime + 60 and
            observed <= mtime + 120,
            "callback_media_order")
    require(hashlib.sha256(wav).hexdigest() == values["sha256"],
            "callback_media_content")
    return wav


def validate_case(root: Path, name: str, marker: dict, source_sha: str,
                  image_id: str, proof_time: int) -> str:
    admissions, completions, has_wav = CASES[name]
    expected_files = {"fs-trace.log"} | ({"admit.json"} if admissions else set()) | \
                     ({"complete.json", "complete-media.txt", "media"} if completions else set())
    directory = root / name
    private_directory(directory)
    require({entry.name for entry in directory.iterdir()} == expected_files,
            "callback_case_files")
    exact_keys(marker, {"admissions", "completions", "admit_sha256",
                        "complete_sha256", "wav_sha256", "media_snapshot_sha256",
                        "trace_sha256", "call_uuid", "source_sha", "image_id"},
               "callback_case_marker")
    require(type(marker["admissions"]) is int and marker["admissions"] == admissions and
            type(marker["completions"]) is int and marker["completions"] == completions and
            marker["source_sha"] == source_sha and marker["image_id"] == image_id,
            "callback_case_count")
    trace_raw = private_bytes(directory / "fs-trace.log", 65536, proof_time)
    require(type(marker["trace_sha256"]) is str and
            SHA256.fullmatch(marker["trace_sha256"]) and
            hashlib.sha256(trace_raw).hexdigest() == marker["trace_sha256"],
            "callback_trace_pin")
    call_uuid = validate_trace(trace_raw, name)
    require(marker["call_uuid"] == call_uuid, "callback_trace_identity")
    if not admissions:
        require(marker["admit_sha256"] is None and marker["complete_sha256"] is None and
                marker["wav_sha256"] is None and marker["media_snapshot_sha256"] is None,
                "callback_case_wav")
        return call_uuid
    admit_raw = private_bytes(directory / "admit.json", 8192, proof_time)
    require(type(marker["admit_sha256"]) is str and
            SHA256.fullmatch(marker["admit_sha256"]) and
            hashlib.sha256(admit_raw).hexdigest() == marker["admit_sha256"],
            "callback_admission_pin")
    admit = exact_keys(json.loads(admit_raw), {"channelUuid", "tenantId", "extension"},
                       "callback_admission")
    require(type(admit["channelUuid"]) is str and UUID.fullmatch(admit["channelUuid"]) and
            type(admit["tenantId"]) is int and admit["tenantId"] > 0 and
            type(admit["extension"]) is str and
            re.fullmatch(r"[1-9][0-9]{0,15}", admit["extension"]),
            "callback_admission_identity")
    require(admit["channelUuid"].lower() == call_uuid, "callback_trace_identity")
    if not has_wav:
        require(marker["complete_sha256"] is None and marker["wav_sha256"] is None and
                marker["media_snapshot_sha256"] is None,
                "callback_case_wav")
        return call_uuid
    complete_raw = private_bytes(directory / "complete.json", 8192, proof_time)
    require(type(marker["complete_sha256"]) is str and
            SHA256.fullmatch(marker["complete_sha256"]) and
            hashlib.sha256(complete_raw).hexdigest() == marker["complete_sha256"],
            "callback_completion_pin")
    complete = exact_keys(json.loads(complete_raw),
                          {"channelUuid", "voicemailFilePath", "callerNumber", "durationSeconds"},
                          "callback_completion")
    require(complete["channelUuid"] == admit["channelUuid"] and
            type(complete["voicemailFilePath"]) is str and
            complete["voicemailFilePath"].startswith("/probe/") and
            os.path.normpath(complete["voicemailFilePath"]) == complete["voicemailFilePath"] and
            complete["voicemailFilePath"].endswith(".wav") and
            type(complete["callerNumber"]) is str and len(complete["callerNumber"]) <= 64 and
            type(complete["durationSeconds"]) is int and
            1 <= complete["durationSeconds"] <= 86400, "callback_completion_identity")
    wav = media_for_completion(directory, complete, marker["media_snapshot_sha256"],
                               proof_time)
    require(type(marker["wav_sha256"]) is str and SHA256.fullmatch(marker["wav_sha256"]) and
            hashlib.sha256(wav).hexdigest() == marker["wav_sha256"], "callback_wav_pin")
    validate_wav(wav, complete["durationSeconds"])
    return call_uuid


def validate_callback_proof(path: Path, independent_sha256: str, source_sha: str,
                            image_id: str, now: int | None = None) -> dict[str, object]:
    require(SHA256.fullmatch(independent_sha256 or "") is not None and
            SOURCE_SHA.fullmatch(source_sha or "") is not None,
            "callback_expected_pin")
    private_directory(path.parent)
    raw = private_bytes(path, 65536)
    require(hashlib.sha256(raw).hexdigest() == independent_sha256, "callback_receipt_pin")
    receipt = exact_keys(json.loads(raw), {"schema", "source_sha", "lua_sha256",
                    "probe_runner_sha256", "freeswitch_image", "freeswitch_version",
                    "validated_at_unix", "clone_inspect_sha256", "fs_version_sha256",
                    "clone_console_sha256", "loaded_dialplan_sha256",
                    "harness_transcript_sha256", "clone_harness_sha256",
                    "cases"}, "callback_receipt_format")
    require(receipt["schema"] == SCHEMA and receipt["source_sha"] == source_sha and
            receipt["lua_sha256"] == LUA_SHA256 and
            receipt["probe_runner_sha256"] == PROBE_RUNNER_SHA256 and
            receipt["freeswitch_image"] == image_id and
            receipt["freeswitch_version"] == FS_VERSION, "callback_source_image_pin")
    stamp = receipt["validated_at_unix"]
    clock = int(time.time()) if now is None else now
    require(type(stamp) is int and clock - MAX_AGE_SECONDS <= stamp <= clock + 60,
            "callback_receipt_freshness")
    require({entry.name for entry in path.parent.iterdir()} ==
            set(CASES) | {"callback.json", "clone-inspect.json", "fs-version.txt",
                          "probe-runner.sh", "clone-console.log", "loaded-dialplan.xml",
                          "harness-transcript.log", "clone-harness.py"},
            "callback_root_files")
    inspect_raw = private_bytes(path.parent / "clone-inspect.json", 1024 * 1024, stamp)
    require(type(receipt["clone_inspect_sha256"]) is str and
            SHA256.fullmatch(receipt["clone_inspect_sha256"]) and
            hashlib.sha256(inspect_raw).hexdigest() == receipt["clone_inspect_sha256"],
            "callback_clone_inspect_pin")
    validate_inspect(inspect_raw, image_id)
    runner_raw = private_bytes(path.parent / "probe-runner.sh", 8192, stamp)
    require(hashlib.sha256(runner_raw).hexdigest() == PROBE_RUNNER_SHA256,
            "callback_probe_runner")
    version_raw = private_bytes(path.parent / "fs-version.txt", 1024, stamp)
    require(version_raw.decode("utf8").strip() == FS_VERSION and
            type(receipt["fs_version_sha256"]) is str and
            SHA256.fullmatch(receipt["fs_version_sha256"]) and
            hashlib.sha256(version_raw).hexdigest() == receipt["fs_version_sha256"],
            "callback_fs_version")
    validate_provenance(path.parent, receipt, stamp)
    cases = exact_keys(receipt["cases"], set(CASES), "callback_cases")
    identities = [validate_case(path.parent, name, cases[name], source_sha,
                                image_id, stamp) for name in CASES]
    require(len(identities) == len(set(identities)), "callback_case_reused_call")
    return {"result": "isolated_callback_verified", "source_sha": source_sha,
            "freeswitch_image": image_id}


def create_callback_receipt(root: Path, source_sha: str, image_id: str,
                            now: int | None = None) -> tuple[Path, str]:
    """Package already-captured raw clone evidence; never run or alter FreeSWITCH."""
    require(SOURCE_SHA.fullmatch(source_sha or "") is not None and
            re.fullmatch(r"sha256:[0-9a-f]{64}", image_id or "") is not None,
            "callback_expected_pin")
    private_directory(root)
    require({entry.name for entry in root.iterdir()} ==
            set(CASES) | {"clone-inspect.json", "fs-version.txt", "probe-runner.sh",
                          "clone-console.log", "loaded-dialplan.xml",
                          "harness-transcript.log", "clone-harness.py"},
            "callback_root_files")
    stamp = int(time.time()) if now is None else now
    inspect_raw = private_bytes(root / "clone-inspect.json", 1024 * 1024, stamp)
    validate_inspect(inspect_raw, image_id)
    runner_raw = private_bytes(root / "probe-runner.sh", 8192, stamp)
    require(hashlib.sha256(runner_raw).hexdigest() == PROBE_RUNNER_SHA256,
            "callback_probe_runner")
    version_raw = private_bytes(root / "fs-version.txt", 1024, stamp)
    require(version_raw.decode("utf8").strip() == FS_VERSION, "callback_fs_version")
    provenance = {
        "clone_console_sha256": hashlib.sha256(private_bytes(
            root / "clone-console.log", 8 * 1024 * 1024, stamp)).hexdigest(),
        "loaded_dialplan_sha256": hashlib.sha256(private_bytes(
            root / "loaded-dialplan.xml", 1024 * 1024, stamp)).hexdigest(),
        "harness_transcript_sha256": hashlib.sha256(private_bytes(
            root / "harness-transcript.log", 1024 * 1024, stamp)).hexdigest(),
        "clone_harness_sha256": hashlib.sha256(private_bytes(
            root / "clone-harness.py", 128 * 1024, stamp)).hexdigest(),
    }
    markers = {}
    for name, (admissions, completions, _) in CASES.items():
        directory = root / name
        trace = private_bytes(directory / "fs-trace.log", 65536, stamp)
        call_uuid = validate_trace(trace, name)
        admit = private_bytes(directory / "admit.json", 8192, stamp) if admissions else None
        complete = private_bytes(directory / "complete.json", 8192, stamp) if completions else None
        snapshot = private_bytes(directory / "complete-media.txt", 8192, stamp) if completions else None
        wav = media_for_completion(directory, json.loads(complete),
                                   hashlib.sha256(snapshot).hexdigest(), stamp) if completions else None
        marker = {"admissions": admissions, "completions": completions,
                  "admit_sha256": hashlib.sha256(admit).hexdigest() if admit else None,
                  "complete_sha256": hashlib.sha256(complete).hexdigest() if complete else None,
                  "media_snapshot_sha256": hashlib.sha256(snapshot).hexdigest() if snapshot else None,
                  "trace_sha256": hashlib.sha256(trace).hexdigest(), "call_uuid": call_uuid,
                  "wav_sha256": hashlib.sha256(wav).hexdigest() if wav else None,
                  "source_sha": source_sha, "image_id": image_id}
        validate_case(root, name, marker, source_sha, image_id, stamp)
        markers[name] = marker
    receipt = {"schema": SCHEMA, "source_sha": source_sha,
               "lua_sha256": LUA_SHA256, "probe_runner_sha256": PROBE_RUNNER_SHA256,
               "freeswitch_image": image_id, "freeswitch_version": FS_VERSION,
               "validated_at_unix": stamp,
               "clone_inspect_sha256": hashlib.sha256(inspect_raw).hexdigest(),
               "fs_version_sha256": hashlib.sha256(version_raw).hexdigest(),
               **provenance,
               "cases": markers}
    validate_provenance(root, receipt, stamp)
    raw = (json.dumps(receipt, sort_keys=True, separators=(",", ":")) + "\n").encode()
    path = root / "callback.json"
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        os.fchmod(fd, 0o600)
        written = 0
        while written < len(raw):
            written += os.write(fd, raw[written:])
        os.fsync(fd)
    finally:
        os.close(fd)
    digest = hashlib.sha256(raw).hexdigest()
    validate_callback_proof(path, digest, source_sha, image_id, now)
    return path, digest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence-dir", required=True, type=Path)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--image-id", required=True)
    args = parser.parse_args()
    try:
        path, digest = create_callback_receipt(args.evidence_dir, args.source_sha,
                                               args.image_id)
        print(json.dumps({"callback_proof": str(path), "sha256": digest,
                          "source_sha": args.source_sha, "image_id": args.image_id},
                         sort_keys=True))
        return 0
    except (ProofError, OSError, ValueError, json.JSONDecodeError) as error:
        stage = str(error) if isinstance(error, ProofError) else type(error).__name__
        print(json.dumps({"result": "blocked", "stage": stage}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
