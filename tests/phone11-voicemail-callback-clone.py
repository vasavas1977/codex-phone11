#!/usr/bin/env python3
"""Run four synthetic voicemail calls in a disposable, exact-image FS clone.

This is an operator test, never a production deployment. No host volumes,
network, provider credentials, or production configuration enter the clone.
The evidence is intentionally incomplete until the real image has run and an
independent reviewer has inspected the unmodified capture.
"""

from __future__ import annotations

import argparse
from datetime import datetime
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
import tarfile
import time
import uuid
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
ACTIVE_IMAGE = "sha256:b31c743f4c911a19687c61e3214968f2a24f93f9d3d667cc26284192e158ffc6"
LUA = ROOT / "infra/configs/freeswitch/scripts/phone11_voicemail_deposit.lua"
RUNNER = ROOT / "tests/phone11-voicemail-probe-runner.sh"
LUA_SHA = "bbd3d515ead48e327b5b5010c0bd5bc331b920182b32d49355869c9a8def51ae"
RUNNER_SHA = "a0bdaeabbae7d5918bc0f4872108f404bf27e2cccddc0899ebe8180da8228a93"
CASES = ("answered", "no_answer_dtmf", "caller_hangup", "early_abandon")
PROBE_NOTICE = re.compile(
    r"^[0-9a-f-]{36} \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+ "
    r"\S+ \[NOTICE\] mod_dptools\.c:\d+ PHONE11_VM_PROBE case=")
PORT = "18021"
PASS = "phone11-disposable-probe-only"


class CloneError(RuntimeError):
    pass


def require(value: bool, message: str) -> None:
    if not value:
        raise CloneError(message)


def run(args: list[str], *, timeout: int = 30, check: bool = True) -> str:
    return run_raw(args, timeout=timeout, check=check).decode("utf8").strip()


def run_raw(args: list[str], *, timeout: int = 30, check: bool = True) -> bytes:
    result = subprocess.run(args, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=timeout, check=False)
    if check and result.returncode != 0:
        # Never echo command arguments; they can include the fixture socket password.
        raise CloneError(f"command_failed:{args[0]}:{result.returncode}")
    return result.stdout


def private_write(path: Path, data: bytes) -> None:
    with path.open("xb") as output:
        os.fchmod(output.fileno(), 0o600)
        output.write(data)
        output.flush()
        os.fsync(output.fileno())


def xml_bytes(root: ET.Element) -> bytes:
    return ET.tostring(root, encoding="utf-8", xml_declaration=True) + b"\n"


def fixture_files() -> dict[str, bytes]:
    """Small config with loopback only; never use a live SIP profile."""
    files = {
        "freeswitch.xml": b'''<?xml version="1.0"?>
<document type="freeswitch/xml">
  <X-PRE-PROCESS cmd="include" data="vars.xml"/>
  <section name="configuration" description="Probe configuration">
    <X-PRE-PROCESS cmd="include" data="autoload_configs/*.xml"/>
  </section>
  <section name="dialplan" description="Probe dialplan">
    <X-PRE-PROCESS cmd="include" data="dialplan/*.xml"/>
  </section>
  <section name="directory" description="Probe directory">
    <X-PRE-PROCESS cmd="include" data="directory/*.xml"/>
  </section>
  <section name="languages" description="Synthetic probe language">
    <X-PRE-PROCESS cmd="include" data="lang/*.xml"/>
  </section>
</document>\n''',
        "vars.xml": b'''<include>
  <X-PRE-PROCESS cmd="set" data="domain=probe.invalid"/>
  <X-PRE-PROCESS cmd="set" data="local_ip_v4=127.0.0.1"/>
  <X-PRE-PROCESS cmd="set" data="default_language=en"/>
</include>\n''',
        "autoload_configs/modules.conf.xml": b'''<configuration name="modules.conf" description="Probe">
<modules><load module="mod_console"/><load module="mod_logfile"/>
<load module="mod_commands"/>
<load module="mod_dptools"/><load module="mod_dialplan_xml"/>
<load module="mod_event_socket"/><load module="mod_loopback"/>
<load module="mod_lua"/><load module="mod_voicemail"/>
<load module="mod_tone_stream"/><load module="mod_sndfile"/></modules></configuration>\n''',
        "autoload_configs/event_socket.conf.xml": (
            '<configuration name="event_socket.conf" description="Probe"><settings>'
            '<param name="listen-ip" value="127.0.0.1"/>'
            f'<param name="listen-port" value="{PORT}"/>'
            f'<param name="password" value="{PASS}"/>'
            '</settings></configuration>\n').encode(),
        "autoload_configs/console.conf.xml": b'''<configuration name="console.conf" description="Probe">
<mappings><map name="all" value="debug"/></mappings>
<settings><param name="colorize" value="false"/></settings></configuration>\n''',
        "autoload_configs/logfile.conf.xml": b'''<configuration name="logfile.conf" description="Probe">
<profiles><profile name="default"><settings>
<param name="logfile" value="/probe/log/freeswitch.log"/>
<param name="rollover" value="0"/>
</settings><mappings><map name="all" value="debug,info,notice,warning,err,crit,alert"/>
</mappings></profile></profiles></configuration>\n''',
        "autoload_configs/switch.conf.xml": b'''<configuration name="switch.conf" description="Probe">
<settings><param name="colorize-console" value="false"/></settings></configuration>\n''',
    }
    voicemail = (ROOT / "infra/configs/freeswitch/autoload_configs/voicemail.conf.xml").read_text()
    require(voicemail.count('value="/var/lib/freeswitch/voicemail"') == 1,
            "voicemail_storage_source_changed")
    files["autoload_configs/voicemail.conf.xml"] = voicemail.replace(
        'value="/var/lib/freeswitch/voicemail"', 'value="/probe/mailbox"').encode()
    directory = ET.Element("include")
    domain = ET.SubElement(directory, "domain", {"name": "probe.invalid"})
    users = ET.SubElement(domain, "users")
    user = ET.SubElement(users, "user", {"id": "9001"})
    params = ET.SubElement(user, "params")
    ET.SubElement(params, "param", {"name": "vm-password", "value": "9001"})
    # FreeSWITCH preprocesses include files line by line. Keep the include
    # wrapper and domain on separate lines so the domain survives expansion.
    ET.indent(directory, space="  ")
    files["directory/probe.xml"] = xml_bytes(directory)
    language_file = ET.Element("include")
    language = ET.SubElement(language_file, "language", {"name": "en"})
    phrases = ET.SubElement(language, "phrases")
    macros = ET.SubElement(phrases, "macros")
    # Prompt media is intentionally local and silent. Only the greeting and
    # recording prompt execute; post-record menus are bypassed below.
    for macro_name in ("voicemail_play_greeting", "voicemail_record_message"):
        macro = ET.SubElement(macros, "macro", {"name": macro_name})
        match = ET.SubElement(ET.SubElement(macro, "input", {"pattern": "(.*)"}), "match")
        ET.SubElement(match, "action", {"function": "execute", "data": "sleep(100)"})
    ET.indent(language_file, space="  ")
    files["lang/en.xml"] = xml_bytes(language_file)
    dialplan = ET.Element("context", {"name": "default"})
    for number, case in enumerate(CASES, 9901):
        extension = ET.SubElement(dialplan, "extension", {"name": f"phone11_probe_{case}"})
        condition = ET.SubElement(extension, "condition", {
            "field": "destination_number", "expression": f"^{number}$"})
        cause = "NORMAL_CLEARING" if case == "answered" else "NO_ANSWER"
        actions = [
            ("answer", ""), ("set", "language=en"),
            ("set", "skip_record_check=true"),
            ("set", "skip_record_urgent_check=true"),
            ("set", "voicemail_skip_goodbye=true"),
            ("set", f"bridge_hangup_cause={cause}"),
            ("log", f"NOTICE PHONE11_VM_PROBE case={case} uuid=${{uuid}} "
                    "cause=${bridge_hangup_cause} stage=before_lua"),
            ("lua", "/etc/freeswitch/scripts/phone11_voicemail_deposit.lua "
                    "1 9001 9001 probe.invalid"),
            ("log", f"NOTICE PHONE11_VM_PROBE case={case} uuid=${{uuid}} "
                    "cause=${bridge_hangup_cause} stage=after_lua"),
            ("hangup", "NORMAL_CLEARING"),
        ]
        for application, data in actions:
            ET.SubElement(condition, "action", {"application": application, "data": data})
    files["dialplan/probe.xml"] = xml_bytes(dialplan)
    return files


def fixture_archive(files: dict[str, bytes]) -> bytes:
    """Construct a root-private archive with only the generated /probe/conf files."""
    archive = io.BytesIO()
    directories = {"conf"}
    for relative in files:
        path = PurePosixPath(relative)
        require(not path.is_absolute() and str(path) == relative and
                all(part not in ("", ".", "..") for part in path.parts) and
                relative.endswith(".xml"), "unsafe_fixture_path")
        directories.update("conf/" + str(parent) for parent in path.parents
                           if str(parent) != ".")
    with tarfile.open(fileobj=archive, mode="w", format=tarfile.USTAR_FORMAT) as tar:
        for directory in sorted(directories, key=lambda value: (value.count("/"), value)):
            info = tarfile.TarInfo(directory)
            info.type = tarfile.DIRTYPE
            info.mode = 0o700
            info.mtime = 0
            tar.addfile(info)
        for relative, data in sorted(files.items()):
            info = tarfile.TarInfo("conf/" + relative)
            info.size = len(data)
            info.mode = 0o600
            info.mtime = 0
            tar.addfile(info, io.BytesIO(data))
    return archive.getvalue()


def stage_fixture(container: str, files: dict[str, bytes], transcript: list[str]) -> None:
    """Docker cp cannot reliably address a container tmpfs; stream via tar."""
    archive = fixture_archive(files)
    result = subprocess.run(["docker", "exec", "-i", container, "tar", "-xf", "-",
                             "-C", "/probe"], input=archive, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=30, check=False)
    require(result.returncode == 0, "fixture_tar_failed")
    for relative, data in sorted(files.items()):
        path = "/probe/conf/" + relative
        require(run_raw(["docker", "exec", container, "cat", path]) == data and
                run(["docker", "exec", container, "stat", "-c", "%a", path]) == "600",
                "fixture_staging_mismatch:" + relative)
    directories = {"/probe/conf"}
    for relative in files:
        directories.update("/probe/conf/" + str(parent) for parent in
                           PurePosixPath(relative).parents if str(parent) != ".")
    for directory in sorted(directories):
        require(run(["docker", "exec", container, "stat", "-c", "%a", directory]) == "700",
                "fixture_directory_mode:" + directory)
    transcript.append("copy=fixture_config into=/probe/conf "
                      f"archive_sha256={hashlib.sha256(archive).hexdigest()} "
                      f"dialplan_sha256={hashlib.sha256(files['dialplan/probe.xml']).hexdigest()}")


def verify_effective_config(effective: str, files: dict[str, bytes]) -> None:
    """Reject FreeSWITCH's unsafe load-all fallback before any synthetic call."""
    try:
        root = ET.fromstring(effective)
    except ET.ParseError as error:
        raise CloneError("effective_xml_unparseable") from error
    require(root.tag == "document" and root.get("type") == "freeswitch/xml",
            "effective_xml_root")
    for name in ("configuration", "dialplan", "directory", "languages"):
        require(len(root.findall(f"./section[@name='{name}']")) == 1,
                "effective_xml_section:" + name)
    configuration = root.find("./section[@name='configuration']")
    modules = configuration.findall("./configuration[@name='modules.conf']")
    require(len(modules) == 1, "effective_modules_config")
    expected = [item.get("module") for item in
                ET.fromstring(files["autoload_configs/modules.conf.xml"])
                .findall("./modules/load")]
    observed = [item.get("module") for item in modules[0].findall("./modules/load")]
    require(observed == expected and len(observed) == len(set(observed)) and
            "mod_sofia" not in observed, "effective_modules_list")
    logger = configuration.findall("./configuration[@name='logfile.conf']")
    require(len(logger) == 1 and len(logger[0].findall(
                "./profiles/profile[@name='default']/settings/param"
                "[@name='logfile'][@value='/probe/log/freeswitch.log']")) == 1,
            "effective_file_logger")
    domains = root.findall("./section[@name='directory']/domain")
    require(len(root.findall("./section[@name='dialplan']/context")) == 1 and
            len(domains) == 1 and domains[0].get("name") == "probe.invalid" and
            len(domains[0].findall("./users/user[@id='9001']")) == 1,
            "effective_call_sections")
    languages = root.findall("./section[@name='languages']/language")
    require(len(languages) == 1 and languages[0].get("name") == "en" and
            {macro.get("name") for macro in
             languages[0].findall("./phrases/macros/macro")} ==
            {"voicemail_play_greeting", "voicemail_record_message"} and
            all(macro.find("./input/match/action[@function='execute']"
                           "[@data='sleep(100)']") is not None for macro in
                languages[0].findall("./phrases/macros/macro")),
            "effective_probe_language")


def fs_api(container: str, command: str, *, timeout: int = 30) -> str:
    return run(["docker", "exec", container, "/usr/bin/fs_cli", "-H", "127.0.0.1",
                "-P", PORT, "-p", PASS, "-x", command], timeout=timeout)


def fs_ready(container: str) -> bool:
    try:
        return fs_api(container, "status", timeout=5).startswith("UP ")
    except CloneError:
        return False


def wait_for(predicate, label: str, seconds: float = 25) -> None:
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        try:
            if predicate():
                return
        except (CloneError, subprocess.TimeoutExpired):
            pass
        time.sleep(.2)
    raise CloneError(f"timeout:{label}")


def exists(container: str, path: str) -> bool:
    result = subprocess.run(["docker", "exec", container, "test", "-f", path],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                            timeout=10, check=False)
    return result.returncode == 0


def call_case(container: str, name: str, transcript: list[str]) -> None:
    number = 9901 + CASES.index(name)
    caller = str(uuid.uuid4())
    mailbox_before = mailbox_inventory(container) if name == "early_abandon" else None
    run(["docker", "exec", container, "sh", "-c",
         f"printf '%s' '{name}' > /probe/current-case"], timeout=10)
    command = (f"bgapi originate {{origination_uuid={caller},"
               "origination_caller_id_number=1020}"
               f"loopback/{number}/default "
               "&playback(tone_stream://%(30000,0,440))")
    response = fs_api(container, command)
    require(response.startswith("+OK Job-UUID:"), f"originate_rejected:{name}")
    transcript.append(f"case={name} caller_uuid={caller} bgapi=accepted")
    if name == "answered":
        wait_for(lambda: "stage=after_lua" in read_log(container, name), "answered_trace")
    else:
        wait_for(lambda: exists(container, f"/probe/{name}/admit.json"), f"{name}_admit")
    if name == "no_answer_dtmf":
        time.sleep(8)
        require(fs_api(container, f"uuid_send_dtmf {caller} #").startswith("+OK"),
                "dtmf_rejected")
        transcript.append(f"case={name} action=uuid_send_dtmf accepted")
        wait_for(lambda: exists(container, f"/probe/{name}/complete-media.txt"), "dtmf_complete")
    elif name == "caller_hangup":
        time.sleep(8)
        require(fs_api(container, f"uuid_kill {caller}").startswith("+OK"), "hangup_rejected")
        transcript.append(f"case={name} action=uuid_kill accepted")
        wait_for(lambda: exists(container, f"/probe/{name}/complete-media.txt"), "hangup_complete")
    elif name == "early_abandon":
        require(fs_api(container, f"uuid_kill {caller}").startswith("+OK"), "abandon_rejected")
        transcript.append(f"case={name} action=uuid_kill accepted")
    else:
        fs_api(container, f"uuid_kill {caller}", timeout=10)
    if name == "caller_hangup":
        wait_for(lambda: caller_hangup_evidence(read_console(container)) is not None,
                 "caller_hangup_outcome")
    elif name == "early_abandon":
        wait_for(lambda: early_abandon_evidence(read_console(container)) is not None,
                 "early_abandon_outcome")
    else:
        wait_for(lambda: "stage=after_lua" in read_log(container, name), f"{name}_trace")
    time.sleep(.3)
    if name == "early_abandon":
        mailbox_after = mailbox_inventory(container)
        require(mailbox_after == mailbox_before, "early_abandon_wav_created")
        transcript.append("case=early_abandon mailbox_inventory_unchanged_sha256=" +
                          hashlib.sha256(mailbox_after).hexdigest())


def read_log(container: str, case: str) -> str:
    raw = run(["docker", "exec", container, "cat", "/probe/log/freeswitch.log"],
              timeout=10, check=False)
    return "\n".join(line for line in raw.splitlines()
                     if emitted_probe_notice(line, case))


def emitted_probe_notice(line: str, case: str) -> bool:
    """Ignore planned dialplan actions and EXECUTE echoes in FreeSWITCH logs."""
    return (PROBE_NOTICE.match(line) is not None and
            f"PHONE11_VM_PROBE case={case} " in line)


def read_console(container: str) -> str:
    return run(["docker", "exec", container, "cat", "/probe/log/freeswitch.log"],
               timeout=10, check=False)


def mailbox_inventory(container: str) -> bytes:
    """Stable, private inventory of final WAV paths and bytes already in the clone."""
    names = run_raw(["docker", "exec", container, "find", "/probe/mailbox",
                     "-name", "*.wav", "-print0"], timeout=10)
    paths = [name.decode("utf8") for name in names.split(b"\0") if name]
    require(len(paths) == len(set(paths)) and all(
        path.startswith("/probe/mailbox/") and
        str(PurePosixPath(path)) == path and ".." not in PurePosixPath(path).parts
        for path in paths), "mailbox_inventory_paths")
    entries = []
    for path in sorted(paths):
        plain = subprocess.run(["docker", "exec", container, "test", "-f", path],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                               timeout=10, check=False)
        link = subprocess.run(["docker", "exec", container, "test", "-L", path],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                              timeout=10, check=False)
        require(plain.returncode == 0 and link.returncode != 0,
                "mailbox_inventory_not_plain")
        digest = run(["docker", "exec", container, "sha256sum", "--", path]).split()[0]
        require(re.fullmatch(r"[0-9a-f]{64}", digest) is not None,
                "mailbox_inventory_digest")
        metadata = run(["docker", "exec", container, "stat", "-c", "%s %y %z", path])
        require(bool(metadata), "mailbox_inventory_metadata")
        entries.append(f"{path} {digest} {metadata}")
    return ("\n".join(entries) + "\n").encode() if entries else b""


def caller_hangup_evidence(console: str) -> list[str] | None:
    """Correlate the b-leg hangup and delivery before that session ends."""
    lines = console.splitlines()
    notices = [(i, line) for i, line in enumerate(lines)
               if emitted_probe_notice(line, "caller_hangup")]
    if len(notices) != 1 or "cause=NO_ANSWER stage=before_lua" not in notices[0][1]:
        return None
    before_index, before = notices[0]
    leg = before.split(" ", 1)[0]
    if f"uuid={leg} " not in before:
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
    deliveries = [(i, line) for i, line in enumerate(interval)
                  if "Deliver VM to " in line]
    if len(deliveries) != 1 or not re.search(
            r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+ \S+ "
            r"\[DEBUG\] mod_voicemail\.c:\d+ Deliver VM to "
            r"9001@probe\.invalid$", deliveries[0][1]):
        return None
    delivery = deliveries[0][1]
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


def early_abandon_evidence(console: str) -> list[str] | None:
    """An admitted call ended before voicemail delivery or a final WAV."""
    lines = console.splitlines()
    notices = [(i, line) for i, line in enumerate(lines)
               if emitted_probe_notice(line, "early_abandon")]
    if len(notices) != 1 or "cause=NO_ANSWER stage=before_lua" not in notices[0][1]:
        return None
    before_index, before = notices[0]
    leg = before.split(" ", 1)[0]
    if f"uuid={leg} " not in before:
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


def copy_tmpfs_file(container: str, source: str, target: Path,
                    max_bytes: int, transcript: list[str]) -> None:
    """Copy exact clone bytes from tmpfs and retain the clone-side timestamp."""
    require(source.startswith("/probe/") and str(PurePosixPath(source)) == source and
            all(part not in ("", ".", "..") for part in PurePosixPath(source).parts),
            "unsafe_tmpfs_path")
    check = subprocess.run(
        ["docker", "exec", container, "sh", "-c",
         'test -f "$1" && test ! -L "$1" && '
         '[ "$(readlink -f -- "$1")" = "$1" ]', "sh", source],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10, check=False)
    require(check.returncode == 0, "tmpfs_file_not_plain:" + source)
    def metadata() -> tuple[int, int, str]:
        fields = run(["docker", "exec", container, "stat", "-c", "%s %Y", source]).split()
        require(len(fields) == 2 and all(field.isdigit() for field in fields),
                "tmpfs_metadata:" + source)
        digest = run(["docker", "exec", container, "sha256sum", source]).split()[0]
        require(re.fullmatch(r"[0-9a-f]{64}", digest) is not None,
                "tmpfs_digest:" + source)
        return int(fields[0]), int(fields[1]), digest
    before = metadata()
    require(0 < before[0] <= max_bytes, "tmpfs_size:" + source)
    raw = run_raw(["docker", "exec", container, "cat", source])
    require(before == metadata() and len(raw) == before[0] and
            hashlib.sha256(raw).hexdigest() == before[2],
            "tmpfs_copy_mismatch:" + source)
    private_write(target, raw)
    os.utime(target, (before[1], before[1]))
    transcript.append(f"copy={source} sha256={before[2]} mtime={before[1]}")


def copy_case(container: str, name: str, output: Path, transcript: list[str]) -> None:
    case = output / name
    case.mkdir(mode=0o700)
    raw = run(["docker", "exec", container, "ls", "-1A", f"/probe/{name}"], timeout=10)
    expected = {"admit.json"} if name == "early_abandon" else set()
    if name in ("no_answer_dtmf", "caller_hangup"):
        expected = {"admit.json", "complete.json", "complete-media.txt"}
    require(set(raw.splitlines()) == expected, f"case_file_set:{name}")
    for filename in sorted(expected):
        copy_tmpfs_file(container, f"/probe/{name}/{filename}", case / filename,
                        8192 if filename == "complete-media.txt" else 65536, transcript)
    if name in ("no_answer_dtmf", "caller_hangup"):
        complete = json.loads((case / "complete.json").read_bytes())
        path = complete.get("voicemailFilePath")
        require(type(path) is str and path.startswith("/probe/") and
                ".." not in path and path.endswith(".wav") and
                re.fullmatch(r"/probe/[A-Za-z0-9_./-]+", path), "unsafe_media_path")
        relative = Path(path.removeprefix("/probe/"))
        target = case / "media" / relative
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        copy_tmpfs_file(container, path, target, 64 * 1024 * 1024, transcript)


def execute(output: Path, source_sha: str) -> None:
    require(sys.platform == "linux" and os.geteuid() == 0, "linux_root_required")
    require(not output.exists(), "output_must_not_exist")
    parent = output.parent.lstat()
    require(stat.S_ISDIR(parent.st_mode) and not stat.S_ISLNK(parent.st_mode) and
            parent.st_uid == 0 and stat.S_IMODE(parent.st_mode) == 0o700,
            "private_output_parent_required")
    os.umask(0o077)
    require(re.fullmatch(r"[0-9a-f]{40}", source_sha) is not None and
            run(["git", "rev-parse", "HEAD"]) == source_sha and
            not run(["git", "status", "--porcelain", "--untracked-files=no"]),
            "source_checkout_not_pinned_clean")
    for path, expected in ((LUA, LUA_SHA), (RUNNER, RUNNER_SHA)):
        require(hashlib.sha256(path.read_bytes()).hexdigest() == expected,
                f"source_changed:{path.name}")
    require(json.loads(run(["docker", "image", "inspect", ACTIVE_IMAGE]))[0]["Id"] ==
            ACTIVE_IMAGE, "exact_image_missing")
    output.mkdir(mode=0o700)
    name = "phone11-vm-probe-" + uuid.uuid4().hex[:12]
    transcript = [f"clone={name} image={ACTIVE_IMAGE} network=none mounts=none"]
    try:
        files = fixture_files()
        run(["docker", "run", "-d", "--pull", "never", "--name", name,
             "--network", "none", "--cap-drop", "ALL", "--security-opt",
             "no-new-privileges", "--tmpfs", "/probe:rw,nosuid,nodev,size=128m",
             "--entrypoint", "/bin/sh", ACTIVE_IMAGE, "-c", "sleep 600"])
        inspect_raw = run_raw(["docker", "inspect", name])
        inspect = json.loads(inspect_raw)
        require(len(inspect) == 1 and inspect[0]["Image"] == ACTIVE_IMAGE and
                inspect[0]["HostConfig"]["NetworkMode"] == "none" and
                not inspect[0]["Mounts"] and not inspect[0]["HostConfig"]["Binds"],
                "clone_isolation")
        transcript.append(f"clone_id={inspect[0]['Id']}")
        stage_fixture(name, files, transcript)
        run(["docker", "exec", name, "mkdir", "-p", "/etc/freeswitch/scripts",
             "/opt/phone11ai/voicemail", "/probe/log", "/probe/db"])
        run(["docker", "cp", str(LUA),
             f"{name}:/etc/freeswitch/scripts/phone11_voicemail_deposit.lua"])
        run(["docker", "cp", str(RUNNER), f"{name}:/opt/phone11ai/voicemail/runner.sh"])
        transcript.append(f"copy=reviewed_lua sha256={LUA_SHA}")
        transcript.append(f"copy=reviewed_probe_runner sha256={RUNNER_SHA}")
        run(["docker", "exec", name, "chmod", "0700",
             "/opt/phone11ai/voicemail/runner.sh"])
        for case in CASES:
            run(["docker", "exec", name, "mkdir", "-m", "0700", f"/probe/{case}"])
        run(["docker", "exec", "-d", name, "/usr/bin/freeswitch", "-nf", "-nonat",
             "-conf", "/probe/conf", "-log", "/probe/log", "-db", "/probe/db"])
        wait_for(lambda: fs_ready(name), "fs_start", 30)
        verify_effective_config(fs_api(name, "xml_locate root"), files)
        require(fs_api(name, "module_exists mod_sofia") == "false",
                "unexpected_sip_module")
        require(fs_api(name, "module_exists mod_logfile") == "true" and
                exists(name, "/probe/log/freeswitch.log") and
                bool(run_raw(["docker", "exec", name, "cat", "/probe/log/freeswitch.log"])),
                "file_logger_not_ready")
        version_output = fs_api(name, "version")
        version_match = re.search(r"1\.10\.12-release-10222002881-a88d069", version_output)
        require(version_match is not None, "fs_version_changed")
        version = version_match.group(0)
        loaded = fs_api(name, "xml_locate dialplan")
        require(all(f"phone11_probe_{case}" in loaded for case in CASES) and
                loaded.count("phone11_voicemail_deposit.lua") == 4,
                "loaded_dialplan_missing")
        for module in ("mod_lua", "mod_voicemail", "mod_loopback"):
            require(fs_api(name, f"module_exists {module}") == "true",
                    f"module_missing:{module}")
        private_write(output / "clone-inspect.json", inspect_raw)
        private_write(output / "fs-version.txt", (version + "\n").encode())
        private_write(output / "loaded-dialplan.xml", (loaded + "\n").encode())
        transcript.append(f"loaded_xml_sha256={hashlib.sha256((loaded + chr(10)).encode()).hexdigest()}")
        private_write(output / "clone-harness.py", Path(__file__).read_bytes())
        run(["docker", "cp", f"{name}:/opt/phone11ai/voicemail/runner.sh",
             str(output / "probe-runner.sh")])
        os.chmod(output / "probe-runner.sh", 0o600)
        for case in CASES:
            call_case(name, case, transcript)
        console_raw = run_raw(["docker", "exec", name, "cat", "/probe/log/freeswitch.log"],
                              timeout=30)
        require(console_raw, "missing_clone_console")
        private_write(output / "clone-console.log", console_raw)
        console = console_raw.decode("utf8")
        for case in CASES:
            copy_case(name, case, output, transcript)
            if case == "caller_hangup":
                lines = caller_hangup_evidence(console)
                require(lines is not None, "caller_hangup_evidence")
            elif case == "early_abandon":
                lines = early_abandon_evidence(console)
                require(lines is not None, "early_abandon_evidence")
            else:
                lines = [line for line in console.splitlines()
                         if emitted_probe_notice(line, case)]
                require(len(lines) == 2, f"trace_count:{case}")
            private_write(output / case / "fs-trace.log",
                          ("\n".join(lines) + "\n").encode())
        private_write(output / "harness-transcript.log",
                      ("\n".join(transcript) + "\n").encode())
    finally:
        if not (output / "harness-transcript.log").exists():
            if not (output / "clone-console.log").exists():
                partial = run_raw(["docker", "exec", name, "cat",
                                   "/probe/log/freeswitch.log"], timeout=10, check=False)
                if partial:
                    private_write(output / "partial-console.log", partial)
            private_write(output / "partial-transcript.log",
                          ("\n".join(transcript) + "\n").encode())
        subprocess.run(["docker", "rm", "-f", name], stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, timeout=30, check=False)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute-clone", action="store_true", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--source-sha", required=True)
    args = parser.parse_args()
    try:
        execute(args.output, args.source_sha)
        print(json.dumps({"result": "raw_clone_capture_created",
                          "path": str(args.output), "image_id": ACTIVE_IMAGE}, sort_keys=True))
        return 0
    except (CloneError, OSError, ValueError, subprocess.TimeoutExpired) as error:
        print(json.dumps({"result": "blocked", "stage": str(error)}, sort_keys=True),
              file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
