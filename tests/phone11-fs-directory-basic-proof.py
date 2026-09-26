#!/usr/bin/env python3
"""Synthetic mod_xml_curl Basic proof in a network-none FreeSWITCH clone.

No host mounts, published ports, SIP profile, production account, or production
credential enters the clone. The responder and FreeSWITCH share only loopback.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import time
import uuid
from xml.etree import ElementTree


IMAGE = "sha256:b31c743f4c911a19687c61e3214968f2a24f93f9d3d667cc26284192e158ffc6"
HTTP_PORT = 18080
ESL_PORT = 18021
USER = "phone11-freeswitch"
PASSWORD = "synthetic-directory-proof-only"
ROTATED_PASSWORD = "synthetic-directory-proof-rotated"
ESL_PASSWORD = "synthetic-esl-proof-only"
DOMAIN = "probe.invalid"
PROBE_TMPFS = "rw,nosuid,nodev,size=64m,exec"


class Blocked(Exception):
    pass


def need(condition: bool, stage: str) -> None:
    if not condition:
        raise Blocked(stage)


def run(args: list[str], *, data: bytes | None = None, timeout: int = 30,
        check: bool = True, stage: str | None = None) -> bytes:
    result = subprocess.run(args, input=data, capture_output=True, timeout=timeout,
                            check=False)
    if check:
        # Never include argv or stderr: fs_cli and the HTTP probe carry only
        # synthetic credentials today, but this evidence must remain safe if
        # the fixture is reused with a different caller later.
        need(result.returncode == 0, "command_failed:" + (stage or args[0]))
    return result.stdout


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def validate_probe_tmpfs(host_config: dict) -> None:
    tmpfs = host_config.get("Tmpfs") or {}
    options = tmpfs.get("/probe", "")
    need(set(options.split(",")) == set(PROBE_TMPFS.split(",")) and
         len(options.split(",")) == len(PROBE_TMPFS.split(",")), "probe_tmpfs")


def fixture() -> dict[str, tuple[bytes, int]]:
    modules = """<configuration name="modules.conf"><modules>
<load module="mod_console"/><load module="mod_logfile"/>
<load module="mod_commands"/><load module="mod_dptools"/>
<load module="mod_event_socket"/><load module="mod_xml_curl"/>
</modules></configuration>
"""
    fs = """<?xml version="1.0"?>
<document type="freeswitch/xml">
<X-PRE-PROCESS cmd="include" data="vars.xml"/>
<section name="configuration">
<X-PRE-PROCESS cmd="include" data="autoload_configs/*.xml"/>
</section>
<section name="dialplan"></section>
<section name="directory"></section>
</document>
"""
    xmlcurl = f"""<configuration name="xml_curl.conf"><bindings><binding name="directory">
<param name="gateway-url" value="http://127.0.0.1:{HTTP_PORT}/cgi-bin/directory.cgi" bindings="directory"/>
<param name="gateway-credentials" value="{USER}:{PASSWORD}"/>
<param name="auth-scheme" value="=basic"/>
<param name="method" value="post"/>
<param name="timeout" value="3"/>
</binding></bindings></configuration>
"""
    cgi = '''#!/bin/sh
read_body=$(dd bs=1 count="${CONTENT_LENGTH:-0}" 2>/dev/null)
user=$(printf '%s' "$read_body" | tr '&' '\\n' | sed -n 's/^user=//p' | head -1)
domain=$(printf '%s' "$read_body" | tr '&' '\\n' | sed -n 's/^domain=//p' | head -1)
case "$user" in 3001|1020) user_shape=expected;; *) user_shape=missing_or_unexpected;; esac
case "$domain" in probe.invalid) domain_shape=expected;; *) domain_shape=missing_or_unexpected;; esac
printf 'method=%s content_type=%s declared_length=%s observed_length=%s user_shape=%s domain_shape=%s\n' \
  "${REQUEST_METHOD:-missing}" "${CONTENT_TYPE:-missing}" "${CONTENT_LENGTH:-missing}" \
  "$(printf '%s' "$read_body" | wc -c | tr -d ' ')" "$user_shape" "$domain_shape" \
  >>"${PROBE_DIAGNOSTIC_PATH:-/probe/cgi-diagnostic.log}"
if [ "$REQUEST_METHOD" != POST ] || [ "$CONTENT_TYPE" != application/x-www-form-urlencoded ] || [ "$domain" != probe.invalid ]; then
  printf 'decision=bad_form\n' >>"${PROBE_DIAGNOSTIC_PATH:-/probe/cgi-diagnostic.log}"
  printf 'Status: 400 Bad Request\\r\\nContent-Type: text/plain\\r\\n\\r\\ninvalid form'
  exit 0
fi
case "$user" in 3001|1020) ;; *)
  printf 'decision=unknown_user\n' >>"${PROBE_DIAGNOSTIC_PATH:-/probe/cgi-diagnostic.log}"
  printf 'Status: 404 Not Found\\r\\nContent-Type: text/plain\\r\\n\\r\\nunknown user'
  exit 0;;
esac
printf 'decision=ok\n' >>"${PROBE_DIAGNOSTIC_PATH:-/probe/cgi-diagnostic.log}"
printf 'method=POST user=%s domain=%s auth_user=%s\\n' "$user" "$domain" "${REMOTE_USER:-unknown}" >>/probe/request-metadata.log
printf 'Content-Type: text/xml\\r\\n\\r\\n'
printf '<?xml version="1.0" encoding="UTF-8"?>\\n<document type="freeswitch/xml"><section name="directory"><domain name="probe.invalid"><user id="%s"><params><param name="probe-marker" value="synthetic-%s"/><param name="a1-hash" value="00000000000000000000000000000000"/></params></user></domain></section></document>\\n' "$user" "$user"
'''
    values = {
        "conf/freeswitch.xml": (fs.encode(), 0o600),
        "conf/vars.xml": (b'<include>\n<X-PRE-PROCESS cmd="set" data="domain=probe.invalid"/>\n<X-PRE-PROCESS cmd="set" data="local_ip_v4=127.0.0.1"/>\n</include>\n', 0o600),
        "conf/autoload_configs/modules.conf.xml": (modules.encode(), 0o600),
        "conf/autoload_configs/xml_curl.conf.xml": (xmlcurl.encode(), 0o600),
        "conf/autoload_configs/event_socket.conf.xml": (f'<configuration name="event_socket.conf"><settings><param name="listen-ip" value="127.0.0.1"/><param name="listen-port" value="{ESL_PORT}"/><param name="password" value="{ESL_PASSWORD}"/></settings></configuration>\n'.encode(), 0o600),
        "conf/autoload_configs/console.conf.xml": (b'<configuration name="console.conf"><mappings><map name="all" value="debug"/></mappings><settings><param name="colorize" value="false"/></settings></configuration>\n', 0o600),
        "conf/autoload_configs/logfile.conf.xml": (b'<configuration name="logfile.conf"><profiles><profile name="default"><settings><param name="logfile" value="/probe/log/freeswitch.log"/><param name="rollover" value="0"/></settings><mappings><map name="all" value="debug,info,notice,warning,err,crit,alert"/></mappings></profile></profiles></configuration>\n', 0o600),
        "conf/autoload_configs/switch.conf.xml": (b'<configuration name="switch.conf"><settings><param name="colorize-console" value="false"/></settings></configuration>\n', 0o600),
        "www/httpd.conf": (f"/:{USER}:{PASSWORD}\n".encode(), 0o600),
        "www/cgi-bin/directory.cgi": (cgi.encode(), 0o700),
    }
    return values


def validate_effective_xml(raw: str) -> None:
    try:
        root = ElementTree.fromstring(raw)
    except ElementTree.ParseError as error:
        raise Blocked("effective_xml_parse") from error
    need(root.tag == "document" and root.get("type") == "freeswitch/xml",
         "effective_xml_root")
    configurations = root.findall("./section[@name='configuration']")
    need(len(configurations) == 1, "effective_configuration_section")
    module_configs = configurations[0].findall("./configuration[@name='modules.conf']")
    need(len(module_configs) == 1, "effective_modules_conf")
    loaded = [item.attrib.get("module") for item in module_configs[0].findall("./modules/load")]
    need(loaded == ["mod_console", "mod_logfile", "mod_commands", "mod_dptools",
                    "mod_event_socket", "mod_xml_curl"], "effective_module_list")


def archive(files: dict[str, tuple[bytes, int]]) -> bytes:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w", format=tarfile.USTAR_FORMAT) as tar:
        directories = {"conf", "conf/autoload_configs", "www", "www/cgi-bin", "log", "db"}
        for directory in sorted(directories, key=lambda item: (item.count("/"), item)):
            entry = tarfile.TarInfo(directory)
            entry.type, entry.mode, entry.mtime = tarfile.DIRTYPE, 0o700, 0
            tar.addfile(entry)
        for path, (content, mode) in sorted(files.items()):
            need(not path.startswith("/") and ".." not in path.split("/"), "fixture_path")
            entry = tarfile.TarInfo(path)
            entry.mode, entry.mtime, entry.size = mode, 0, len(content)
            tar.addfile(entry, io.BytesIO(content))
    return buffer.getvalue()


def api(name: str, command: str) -> str:
    return run(["docker", "exec", name, "fs_cli", "-H", "127.0.0.1",
                "-P", str(ESL_PORT), "-p", ESL_PASSWORD, "-x", command], timeout=10).decode().strip()


def synthetic_http_post(name: str, authorization: str | None) -> bytes:
    body = b"user=3001&domain=probe.invalid"
    headers = (b"POST /cgi-bin/directory.cgi HTTP/1.0\r\nHost: 127.0.0.1\r\n"
               b"Content-Type: application/x-www-form-urlencoded\r\n"
               + f"Content-Length: {len(body)}\r\n".encode())
    if authorization:
        headers += f"Authorization: {authorization}\r\n".encode()
    return run(["docker", "exec", "-i", name, "busybox", "nc", "-w", "3",
                "127.0.0.1", str(HTTP_PORT)], data=headers + b"\r\n" + body,
               timeout=5)


def http_status(response: bytes) -> int:
    match = re.match(rb"HTTP/1\.[01] ([0-9]{3})\b", response)
    need(match is not None, "http_status")
    return int(match.group(1))


def basic_authorization(password: str) -> str:
    return "Basic " + base64.b64encode(f"{USER}:{password}".encode()).decode()


def write_clone_file(name: str, path: str, content: bytes) -> None:
    need(path in ("/probe/www/httpd.conf",
                  "/probe/conf/autoload_configs/xml_curl.conf.xml"), "clone_write_path")
    label = "httpd_config" if path == "/probe/www/httpd.conf" else "xml_curl_config"
    run(["docker", "exec", "-i", name, "sh", "-c", "cat > " + path],
        data=content, stage="write_" + label)
    need(run(["docker", "exec", name, "cat", path],
             stage="read_" + label) == content, "clone_write_bytes")


def start_httpd(name: str) -> None:
    # BusyBox launched as `busybox httpd` has comm=busybox in the pinned
    # image; `killall httpd` then cannot rotate the synthetic responder.
    # Invoking its applet through this private tmpfs symlink gives comm=httpd.
    run(["docker", "exec", "-d", name, "/probe/httpd", "-f", "-p",
         f"127.0.0.1:{HTTP_PORT}", "-h", "/probe/www", "-c",
         "/probe/www/httpd.conf"], stage="start_httpd")


def response_paths(name: str) -> list[str]:
    command = ('for root in /tmp /probe /var/tmp /usr/local/freeswitch/tmp; do '
               'if [ -d "$root" ]; then find "$root" -type f -name "*.tmp.xml"; fi; done')
    output = run(["docker", "exec", name, "sh", "-c", command], check=False)
    paths = sorted(set(output.decode().splitlines()))
    need(len(paths) <= 8 and all(path.startswith(("/tmp/", "/probe/", "/var/tmp/",
                                                "/usr/local/freeswitch/tmp/")) and
                                 path.endswith(".tmp.xml") and ".." not in path.split("/")
                                 for path in paths), "response_paths")
    return paths


def wait_for(fn, stage: str, seconds: int = 30) -> str:
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        try:
            value = fn()
            if value:
                return value
        except (Blocked, subprocess.TimeoutExpired):
            pass
        time.sleep(.2)
    raise Blocked("timeout:" + stage)


def private_write(path: Path, content: bytes) -> None:
    with path.open("xb") as output:
        os.fchmod(output.fileno(), 0o600)
        output.write(content)
        output.flush()
        os.fsync(output.fileno())


def execute(output: Path, diagnose_startup: bool = False,
            diagnose_http: bool = False, diagnose_xml: bool = False) -> None:
    need(os.geteuid() == 0, "root_required")
    need(json.loads(run(["docker", "image", "inspect", IMAGE]))[0]["Id"] == IMAGE,
         "image_mismatch")
    output.mkdir(mode=0o700)
    need(output.lstat().st_uid == 0 and output.stat().st_mode & 0o777 == 0o700,
         "private_output")
    name = "phone11-fs-basic-" + uuid.uuid4().hex[:12]
    files = fixture()
    transcript = [f"image={IMAGE} clone={name} network=none mounts=none ports=none"]
    try:
        run(["docker", "run", "-d", "--pull", "never", "--name", name,
             "--network", "none", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
             "--tmpfs", "/probe:" + PROBE_TMPFS, "--entrypoint", "/bin/sh",
             IMAGE, "-c", "sleep 600"])
        inspect = json.loads(run(["docker", "inspect", name]))[0]
        need(inspect["Image"] == IMAGE and inspect["HostConfig"]["NetworkMode"] == "none" and
             not inspect["Mounts"] and not inspect["HostConfig"].get("PortBindings") and
             inspect["HostConfig"].get("Privileged") is False, "clone_isolation")
        validate_probe_tmpfs(inspect["HostConfig"])
        transcript.append("container_id=" + inspect["Id"])
        packed = archive(files)
        run(["docker", "exec", "-i", name, "tar", "-xf", "-", "-C", "/probe"], data=packed)
        for path, (content, mode) in files.items():
            actual = run(["docker", "exec", name, "cat", "/probe/" + path])
            need(actual == content and run(["docker", "exec", name, "stat", "-c", "%a", "/probe/" + path]).strip() == format(mode, "o").encode(), "fixture_staging")
        transcript.append("fixture_archive_sha256=" + digest(packed))
        run(["docker", "exec", name, "ln", "-s", "/bin/busybox", "/probe/httpd"],
            stage="link_httpd")
        need(run(["docker", "exec", name, "readlink", "/probe/httpd"],
                 stage="readlink_httpd").strip() == b"/bin/busybox", "httpd_link")
        start_httpd(name)
        def httpd_ready() -> bool:
            result = subprocess.run(["docker", "exec", name, "sh", "-c",
                                     f"busybox nc -w 1 127.0.0.1 {HTTP_PORT} </dev/null >/dev/null"],
                                    capture_output=True, timeout=3, check=False)
            return result.returncode == 0
        wait_for(httpd_ready, "httpd_start", 10)
        if diagnose_http:
            response = synthetic_http_post(name, basic_authorization(PASSWORD))
            status = response.split(b"\r\n", 1)[0]
            need(re.fullmatch(rb"HTTP/1\.[01] [0-9]{3} .*", status) is not None,
                 "diagnostic_http_status")
            transcript.append("synthetic_basic_http_status=" + status.decode())
            diagnostic = run(["docker", "exec", name, "cat", "/probe/cgi-diagnostic.log"],
                             check=False)
            if diagnostic:
                private_write(output / "cgi-diagnostic.log", diagnostic)
                transcript.append("cgi_diagnostic_sha256=" + digest(diagnostic))
            else:
                transcript.append("cgi_diagnostic=absent")
            private_write(output / "transcript.log", ("\n".join(transcript) + "\n").encode())
            return
        # A missing or bad credential may not reach CGI. No response body or
        # credential bytes are retained in evidence.
        if diagnose_startup:
            command = ["docker", "exec", name, "/usr/bin/freeswitch", "-nf", "-nonat",
                       "-conf", "/probe/conf", "-log", "/probe/log", "-db", "/probe/db"]
            try:
                attempt = subprocess.run(command, capture_output=True, timeout=10,
                                         check=False)
                raw = attempt.stdout + attempt.stderr
                transcript.append("foreground_exit=" + str(attempt.returncode))
            except subprocess.TimeoutExpired as error:
                raw = (error.stdout or b"") + (error.stderr or b"")
                transcript.append("foreground_exit=timeout_after_10s")
            if raw:
                private_write(output / "foreground.log", raw)
                transcript.append("foreground_sha256=" + digest(raw))
            private_write(output / "transcript.log", ("\n".join(transcript) + "\n").encode())
            return
        run(["docker", "exec", "-d", name, "/usr/bin/freeswitch", "-nf", "-nonat",
             "-conf", "/probe/conf", "-log", "/probe/log", "-db", "/probe/db"])
        wait_for(lambda: api(name, "status") if api(name, "status").startswith("UP ") else "",
                 "fs_start")
        validate_effective_xml(api(name, "xml_locate root"))
        need(api(name, "module_exists mod_xml_curl") == "true" and
             api(name, "module_exists mod_sofia") == "false", "module_shape")
        if diagnose_xml:
            prior = set(response_paths(name))
            need(api(name, "xml_curl debug_on") == "OK", "xml_curl_debug_on")
            marker = api(name, f"user_data 3001@{DOMAIN} param probe-marker")
            paths = [path for path in response_paths(name) if path not in prior]
            need(1 <= len(paths) <= 4, "xml_response_count")
            transcript.append("directory_lookup_matched=" + str(marker == "synthetic-3001").lower())
            for index, path in enumerate(paths, start=1):
                raw = run(["docker", "exec", name, "cat", path])
                need(0 < len(raw) <= 1024 * 1024, "xml_response_size")
                private_write(output / f"response-{index}.xml", raw)
                try:
                    ElementTree.fromstring(raw)
                    parse_result = "valid"
                except ElementTree.ParseError as error:
                    parse_result = "invalid:" + str(error)
                transcript.append(f"response={index} bytes={len(raw)} sha256={digest(raw)} "
                                  f"parse={parse_result} prefix_hex={raw[:24].hex()}")
            for source, target in (("/probe/cgi-diagnostic.log", "cgi-diagnostic.log"),
                                   ("/probe/request-metadata.log", "request-metadata.log"),
                                   ("/probe/log/freeswitch.log", "freeswitch.log")):
                raw = run(["docker", "exec", name, "cat", source], check=False)
                if raw:
                    private_write(output / target, raw)
                    transcript.append(target + "_sha256=" + digest(raw))
            private_write(output / "transcript.log", ("\n".join(transcript) + "\n").encode())
            return
        for user in ("3001", "1020"):
            marker = api(name, f"user_data {user}@{DOMAIN} param probe-marker")
            need(marker == "synthetic-" + user, "directory_lookup:" + user)
            transcript.append("user=" + user + " basic=accepted form=valid marker=matched")
        metadata = run(["docker", "exec", name, "cat", "/probe/request-metadata.log"])
        lines = metadata.decode().splitlines()
        need(len(lines) == 2 and all(f"user={user} domain={DOMAIN}" in line
                                     for line, user in zip(lines, ("3001", "1020"))),
             "request_metadata")
        transcript.append("request_metadata_sha256=" + digest(metadata))
        # Safe failure probes below are HTTP-only; the live module success was
        # established above and no SIP user or network interface is present.
        for label, authorization in (("none", ""), ("wrong", "Basic d3Jvbmc6d3Jvbmc=")):
            response = synthetic_http_post(name, authorization)
            need(http_status(response) == 401 and
                 b"synthetic-" not in response, "auth_negative:" + label)
            transcript.append("auth_negative=" + label + " denied=true")
        need(run(["docker", "exec", name, "cat", "/probe/request-metadata.log"],
                 stage="post_negative_metadata") == metadata,
             "negative_reached_cgi")
        # The HTTP responder switches to a second synthetic password while the
        # FreeSWITCH process stays up. reloadxml updates compiled XML but must
        # not be mistaken for reloading mod_xml_curl's bound credentials.
        fs_pid = run(["docker", "exec", name, "busybox", "pidof", "freeswitch"],
                     stage="pidof_freeswitch").strip()
        need(bool(fs_pid), "freeswitch_pid")
        write_clone_file(name, "/probe/www/httpd.conf",
                         f"/:{USER}:{ROTATED_PASSWORD}\n".encode())
        run(["docker", "exec", name, "busybox", "killall", "httpd"],
            stage="killall_httpd")
        start_httpd(name)
        wait_for(httpd_ready, "httpd_rotated", 10)
        need(http_status(synthetic_http_post(name, basic_authorization(PASSWORD))) == 401 and
             http_status(synthetic_http_post(name, basic_authorization(ROTATED_PASSWORD))) == 200,
             "http_password_rotation")
        rotated_http_metadata = run(["docker", "exec", name, "cat", "/probe/request-metadata.log"])
        need(rotated_http_metadata.startswith(metadata) and
             len(rotated_http_metadata.decode().splitlines()) == 3,
             "rotated_http_metadata")
        previous_xml = files["conf/autoload_configs/xml_curl.conf.xml"][0]
        rotated_xml = previous_xml.replace(PASSWORD.encode(), ROTATED_PASSWORD.encode())
        need(rotated_xml != previous_xml and PASSWORD.encode() not in rotated_xml,
             "rotated_xml_bytes")
        write_clone_file(name, "/probe/conf/autoload_configs/xml_curl.conf.xml", rotated_xml)
        need("-ERR" not in api(name, "reloadxml"), "reloadxml")
        effective = api(name, "xml_locate root")
        need(ROTATED_PASSWORD in effective and PASSWORD not in effective, "reloadxml_effective")
        need(api(name, f"user_data 3001@{DOMAIN} param probe-marker") != "synthetic-3001",
             "reloadxml_must_not_rotate_binding")
        need(run(["docker", "exec", name, "cat", "/probe/request-metadata.log"]) ==
             rotated_http_metadata, "old_binding_reached_cgi")
        need("-ERR" not in api(name, "reload mod_xml_curl") and
             api(name, "module_exists mod_xml_curl") == "true", "reload_module")
        need(run(["docker", "exec", name, "busybox", "pidof", "freeswitch"]).strip() == fs_pid,
             "freeswitch_process_changed")
        need(api(name, f"user_data 3001@{DOMAIN} param probe-marker") == "synthetic-3001",
             "rotated_directory_lookup")
        rotated_metadata = run(["docker", "exec", name, "cat", "/probe/request-metadata.log"])
        need(rotated_metadata.startswith(rotated_http_metadata) and
             len(rotated_metadata.decode().splitlines()) == 4,
             "rotated_request_metadata")
        transcript.append("module_reload=passed fs_process=unchanged old_basic=401 new_basic=200")
        transcript.append("rotated_request_metadata_sha256=" + digest(rotated_metadata))
        private_write(output / "clone-inspect.json", json.dumps({
            "Id": inspect["Id"], "Image": inspect["Image"],
            "NetworkMode": inspect["HostConfig"]["NetworkMode"],
            "Mounts": inspect["Mounts"], "PortBindings": inspect["HostConfig"].get("PortBindings")},
            sort_keys=True).encode() + b"\n")
        private_write(output / "request-metadata.log", rotated_metadata)
        private_write(output / "transcript.log", ("\n".join(transcript) + "\n").encode())
    except (Blocked, OSError, ValueError, subprocess.TimeoutExpired) as error:
        transcript.append("failure=" + str(error))
        raise
    finally:
        if not (output / "transcript.log").exists():
            for filename, command in (
                ("partial-freeswitch.log", ["docker", "exec", name, "cat", "/probe/log/freeswitch.log"]),
                ("partial-container.log", ["docker", "logs", name]),
                ("partial-request-metadata.log", ["docker", "exec", name, "cat", "/probe/request-metadata.log"]),
                ("partial-cgi-diagnostic.log", ["docker", "exec", name, "cat", "/probe/cgi-diagnostic.log"]),
            ):
                try:
                    content = run(command, timeout=10, check=False)
                    if content:
                        private_write(output / filename, content)
                except (OSError, subprocess.TimeoutExpired):
                    pass
            private_write(output / "partial-transcript.log", ("\n".join(transcript) + "\n").encode())
        subprocess.run(["docker", "rm", "-f", name], capture_output=True, timeout=30,
                       check=False)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--diagnose-startup", action="store_true")
    parser.add_argument("--diagnose-http", action="store_true")
    parser.add_argument("--diagnose-xml", action="store_true")
    args = parser.parse_args()
    try:
        need(sum((args.diagnose_startup, args.diagnose_http, args.diagnose_xml)) <= 1,
             "diagnostic_mode")
        execute(args.output, args.diagnose_startup, args.diagnose_http, args.diagnose_xml)
        result = "diagnostic_capture" if (args.diagnose_startup or args.diagnose_http or
                                          args.diagnose_xml) else "passed"
        print(json.dumps({"result": result, "output": str(args.output), "image": IMAGE}))
        return 0
    except (Blocked, OSError, ValueError, subprocess.TimeoutExpired) as error:
        print(json.dumps({"result": "blocked", "stage": str(error)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
