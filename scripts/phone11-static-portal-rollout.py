#!/usr/bin/env python3
"""Publish the reviewed Phone11 static portal without touching the API runtime.

The controller is intentionally host-local.  A root operator copies the reviewed
script, an exact manifest, and an already-built Expo export to the existing
Phone11 edge, then runs ``--prepare`` before ``--activate``.  It never uploads
an artifact, changes DNS, starts containers, or alters the Phone11 API.

Only the dedicated TLS vhost for ``1toall.phone11.ai`` is changed.  The shared
HTTP vhost and every other TLS vhost stay byte-for-byte unchanged.  Two known
historical Nginx backup files are moved (not deleted) outside ``sites-enabled``
for the operation and restored by rollback, preventing duplicate server-name
selection from making the serving generation ambiguous.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable, Sequence


SCHEMA = "phone11-static-portal-rollout/v1"
EXPORT_SCHEMA = "phone11-static-portal-export/v1"
# The candidate is intentionally pinned as a complete export, rather than by
# source SHA alone.  These values are from the clean archive built for this
# controller; the managed predecessor remains generic and is revalidated from
# its own sealed export before a link is changed or restored.
RELEASE_SHA = "0d13ddcba981c6a1dd04fae44dd1f11608f296ca"
LIVE_RELEASE_SHA = "74582b3b16441f4aedbc48de76789035c75ec86b"
RELEASE_EXPORT_MANIFEST_SHA256 = "b8af6c15dc8ffb7de6a6de1e7c1a5b756396e72fdeb18ac405ee3aa20df2c5b6"
RELEASE_MARKER_SHA256 = "4844021e47e3c8c83abe4252fd144776a6f7386929ae3d79156053fc8789d6af"
RELEASE_MAIN_JAVASCRIPT = "_expo/static/js/web/entry-1199509d1048c2b2b9890a2809a40ccd.js"
RELEASE_MAIN_JAVASCRIPT_SHA256 = "3a555ef115006b014b2ae37748644babc86752132a804b11d0484b1709632240"
HOSTNAME = "1toall.phone11.ai"
EDGE_IP = "43.209.112.208"
API_ORIGIN = "https://api.phone11.ai"
PUBLIC_ORIGIN = f"https://{HOSTNAME}"
CERTIFICATE = Path("/etc/letsencrypt/live/phone11.ai/fullchain.pem")
CERTIFICATE_KEY = Path("/etc/letsencrypt/live/phone11.ai/privkey.pem")
LEGACY_INCLUDE_NAMES = (
    "phone11ai.v93-backup-20260527T011922Z",
    "phone11ai.v93-backup-20260527T011922Z.v93-backup-20260527T012115Z",
)
MAX_MANIFEST_BYTES = 256 * 1024
MAX_REQUIRED_FILE_BYTES = 16 * 1024 * 1024
MAX_ORIGIN_SCAN_BYTES = 64 * 1024 * 1024
RELEASE_MARKER = "phone11-static-portal-release.json"
EXPORT_MANIFEST_NAME = "export-manifest.json"
INITIAL_CONVERSION = "initial"
MANAGED_UPDATE = "managed"
# A reload briefly leaves both generations of workers accepting connections.
# Bound probe retries give the old workers time to drain without masking a
# persistent bad configuration or a wrong release marker.
HTTP_PROBE_ATTEMPTS = 5
HTTP_PROBE_RETRY_SECONDS = 1.0


class RolloutError(RuntimeError):
    def __init__(
        self,
        stage: str,
        *,
        original_stage: str | None = None,
        rollback_stage: str | None = None,
    ):
        super().__init__(stage)
        self.stage = stage
        self.original_stage = original_stage
        self.rollback_stage = rollback_stage


def require(condition: bool, stage: str) -> None:
    if not condition:
        raise RolloutError(stage)


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def is_sha256(value: object) -> bool:
    return isinstance(value, str) and bool(re.fullmatch(r"[0-9a-f]{64}", value))


def exact_keys(value: Any, keys: set[str], stage: str) -> None:
    require(isinstance(value, dict) and set(value) == keys, stage)


def absolute(value: object, stage: str) -> Path:
    require(isinstance(value, str) and bool(value), stage)
    path = Path(value)
    require(path.is_absolute(), stage)
    return path


def read_regular(path: Path, stage: str, maximum: int = MAX_MANIFEST_BYTES) -> bytes:
    try:
        before = path.lstat()
        require(stat.S_ISREG(before.st_mode) and not stat.S_ISLNK(before.st_mode), stage)
        require(before.st_size <= maximum, stage)
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        try:
            opened = os.fstat(descriptor)
            require(
                (opened.st_dev, opened.st_ino, opened.st_size)
                == (before.st_dev, before.st_ino, before.st_size),
                stage,
            )
            chunks: list[bytes] = []
            remaining = maximum + 1
            while remaining:
                chunk = os.read(descriptor, min(65_536, remaining))
                if not chunk:
                    break
                chunks.append(chunk)
                remaining -= len(chunk)
            value = b"".join(chunks)
            require(len(value) == opened.st_size and len(value) <= maximum, stage)
            return value
        finally:
            os.close(descriptor)
    except RolloutError:
        raise
    except OSError as error:
        raise RolloutError(stage) from error


def require_protected_chain(path: Path, stage: str, *, final_is_file: bool) -> None:
    """Require a root-owned, non-writable serving path when run as root.

    This closes the gap between final release-tree hashing and switching
    ``current``: an unprivileged account cannot replace a checked file after
    validation or modify it after the portal becomes reachable.
    """
    if os.geteuid() != 0:
        return
    current = path if not final_is_file else path.parent
    if final_is_file:
        info = path.lstat()
        require(stat.S_ISREG(info.st_mode) and not stat.S_ISLNK(info.st_mode), stage)
        require(info.st_uid == 0 and not (stat.S_IMODE(info.st_mode) & 0o022), stage)
    while True:
        info = current.lstat()
        require(stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode), stage)
        require(info.st_uid == 0 and not (stat.S_IMODE(info.st_mode) & 0o022), stage)
        if current == current.parent:
            return
        current = current.parent


def read_json(path: Path, stage: str, maximum: int = MAX_MANIFEST_BYTES) -> dict[str, Any]:
    try:
        parsed = json.loads(read_regular(path, stage, maximum))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RolloutError(stage) from error
    require(isinstance(parsed, dict), stage)
    return parsed


def fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def atomic_write(path: Path, value: bytes, mode: int, uid: int, gid: int) -> None:
    """Atomically replace one file and persist the parent directory entry."""
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        os.fchmod(descriptor, mode)
        os.fchown(descriptor, uid, gid)
        view = memoryview(value)
        while view:
            written = os.write(descriptor, view)
            view = view[written:]
        os.fsync(descriptor)
        os.close(descriptor)
        descriptor = -1
        os.replace(temporary, path)
        fsync_directory(path.parent)
    finally:
        if descriptor != -1:
            os.close(descriptor)
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def atomic_symlink(path: Path, target: str) -> None:
    require(not path.exists() or path.is_symlink(), "current_link")
    temporary = path.parent / f".{path.name}.{os.getpid()}.new"
    try:
        temporary.unlink()
    except FileNotFoundError:
        pass
    os.symlink(target, temporary)
    os.replace(temporary, path)
    fsync_directory(path.parent)


def remove_link(path: Path) -> None:
    require(path.is_symlink(), "current_link")
    path.unlink()
    fsync_directory(path.parent)


def create_root_directory(path: Path, stage: str) -> None:
    path.mkdir(parents=True, exist_ok=False, mode=0o700)
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode), stage)
    if os.geteuid() == 0:
        require(info.st_uid == 0 and stat.S_IMODE(info.st_mode) == 0o700, stage)


@dataclass(frozen=True)
class LegacyInclude:
    path: Path
    sha256: str


@dataclass(frozen=True)
class Release:
    source_sha: str
    directory: Path
    export_manifest: Path
    export_manifest_sha256: str
    current_link: Path


@dataclass(frozen=True)
class NginxPins:
    # ``site`` is the regular file that is atomically replaced.  ``enabled_site``
    # remains Nginx's included symlink and is pinned separately.
    site: Path
    enabled_site: Path
    enabled_site_link: str
    site_sha256: str
    dump_sha256: str
    certificate: Path
    certificate_key: Path
    legacy_includes: tuple[LegacyInclude, ...]


@dataclass(frozen=True)
class Manifest:
    release: Release
    nginx: NginxPins
    state_dir: Path


@dataclass(frozen=True)
class Prepared:
    before: bytes
    active: bytes
    mode: str


def parse_manifest(path: Path) -> Manifest:
    require_protected_chain(path, "manifest", final_is_file=True)
    document = read_json(path, "manifest")
    exact_keys(document, {"schema", "release", "origins", "nginx", "state_dir"}, "manifest")
    require(document["schema"] == SCHEMA, "manifest")
    exact_keys(document["origins"], {"public", "api"}, "manifest")
    require(document["origins"] == {"public": PUBLIC_ORIGIN, "api": API_ORIGIN}, "manifest")

    release_raw = document["release"]
    exact_keys(release_raw, {"source_sha", "directory", "manifest", "manifest_sha256", "current_link"}, "manifest")
    source_sha = release_raw["source_sha"]
    require(source_sha == RELEASE_SHA, "manifest")
    directory = absolute(release_raw["directory"], "manifest")
    export_manifest = absolute(release_raw["manifest"], "manifest")
    current_link = absolute(release_raw["current_link"], "manifest")
    require(release_raw["manifest_sha256"] == RELEASE_EXPORT_MANIFEST_SHA256, "manifest")
    require(directory.name == source_sha and export_manifest.parent == directory, "manifest")
    require(current_link.parent == directory.parent.parent and current_link.name == "current", "manifest")

    nginx_raw = document["nginx"]
    exact_keys(
        nginx_raw,
        {
            "site", "enabled_site", "enabled_site_link", "site_sha256", "dump_sha256",
            "certificate", "certificate_key", "legacy_includes",
        },
        "manifest",
    )
    site = absolute(nginx_raw["site"], "manifest")
    enabled_site = absolute(nginx_raw["enabled_site"], "manifest")
    enabled_site_link = nginx_raw["enabled_site_link"]
    require(isinstance(enabled_site_link, str) and bool(enabled_site_link) and "\x00" not in enabled_site_link, "manifest")
    require(site.name == enabled_site.name and site.parent.parent == enabled_site.parent.parent, "manifest")
    certificate = absolute(nginx_raw["certificate"], "manifest")
    certificate_key = absolute(nginx_raw["certificate_key"], "manifest")
    require(certificate == CERTIFICATE and certificate_key == CERTIFICATE_KEY, "manifest")
    require(is_sha256(nginx_raw["site_sha256"]) and is_sha256(nginx_raw["dump_sha256"]), "manifest")
    legacy_raw = nginx_raw["legacy_includes"]
    require(isinstance(legacy_raw, list) and len(legacy_raw) == len(LEGACY_INCLUDE_NAMES), "manifest")
    legacy: list[LegacyInclude] = []
    for item in legacy_raw:
        exact_keys(item, {"path", "sha256"}, "manifest")
        item_path = absolute(item["path"], "manifest")
        require(item_path.parent == enabled_site.parent and is_sha256(item["sha256"]), "manifest")
        legacy.append(LegacyInclude(item_path, item["sha256"]))
    require(tuple(sorted(item.path.name for item in legacy)) == LEGACY_INCLUDE_NAMES, "manifest")
    state_dir = absolute(document["state_dir"], "manifest")
    require(state_dir.parent == enabled_site.parent.parent and state_dir.name == "phone11-static-portal-rollout", "manifest")

    return Manifest(
        release=Release(source_sha, directory, export_manifest, release_raw["manifest_sha256"], current_link),
        nginx=NginxPins(
            site, enabled_site, enabled_site_link, nginx_raw["site_sha256"], nginx_raw["dump_sha256"],
            certificate, certificate_key, tuple(legacy),
        ),
        state_dir=state_dir,
    )


def validate_release(release: Release) -> None:
    try:
        info = release.directory.lstat()
        require(stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode), "release")
        require_protected_chain(release.directory, "release", final_is_file=False)
        require_protected_chain(release.current_link.parent, "release", final_is_file=False)
    except OSError as error:
        raise RolloutError("release") from error
    manifest_raw = read_regular(release.export_manifest, "release")
    require(sha256_bytes(manifest_raw) == release.export_manifest_sha256, "release")
    try:
        export = json.loads(manifest_raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RolloutError("release") from error
    exact_keys(export, {"schema", "source_sha", "api_origin", "files"}, "release")
    require(export["schema"] == EXPORT_SCHEMA and export["source_sha"] == release.source_sha, "release")
    require(export["api_origin"] == API_ORIGIN and isinstance(export["files"], dict), "release")
    required = {"index.html", "portal/index.html", RELEASE_MARKER}
    files = export["files"]
    require(required.issubset(files) and all(is_sha256(value) for value in files.values()), "release")
    actual_files: set[str] = set()
    try:
        for candidate in release.directory.rglob("*"):
            relative = candidate.relative_to(release.directory).as_posix()
            if candidate == release.export_manifest:
                continue
            if candidate.is_symlink():
                raise RolloutError("release")
            if candidate.is_dir():
                require_protected_chain(candidate, "release", final_is_file=False)
                continue
            require(candidate.is_file(), "release")
            require_protected_chain(candidate, "release", final_is_file=True)
            actual_files.add(relative)
            raw = read_regular(candidate, "release", MAX_REQUIRED_FILE_BYTES)
            require(sha256_bytes(raw) == files.get(relative), "release")
        require(set(files) == actual_files, "release")
    except RolloutError:
        raise
    except OSError as error:
        raise RolloutError("release") from error

    try:
        marker = json.loads(read_regular(release.directory / RELEASE_MARKER, "release", MAX_REQUIRED_FILE_BYTES))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RolloutError("release") from error
    exact_keys(marker, {"schema", "source_sha", "public_origin", "api_origin"}, "release")
    require(
        marker == {
            "schema": "phone11-static-portal-release/v1",
            "source_sha": release.source_sha,
            "public_origin": PUBLIC_ORIGIN,
            "api_origin": API_ORIGIN,
        },
        "release",
    )

    scanned = 0
    found_api_origin = False
    try:
        for candidate in release.directory.rglob("*"):
            if candidate.is_symlink():
                raise RolloutError("release")
            if not candidate.is_file() or candidate.suffix not in {".html", ".js"}:
                continue
            size = candidate.stat().st_size
            require(scanned + size <= MAX_ORIGIN_SCAN_BYTES, "release")
            scanned += size
            with candidate.open("rb") as handle:
                if API_ORIGIN.encode() in handle.read():
                    found_api_origin = True
        require(found_api_origin, "release")
    except RolloutError:
        raise
    except OSError as error:
        raise RolloutError("release") from error


def validate_target_release(release: Release) -> None:
    """Validate the exact reviewed candidate without constraining rollback.

    ``validate_release`` deliberately remains generic because a managed
    rollback needs to validate the sealed release selected by the existing
    ``current`` link.  Only the candidate supplied by this operator is pinned
    to the exact export manifest, marker, and browser entry bundle.
    """
    validate_release(release)
    require(
        release.source_sha == RELEASE_SHA
        and release.export_manifest_sha256 == RELEASE_EXPORT_MANIFEST_SHA256,
        "release",
    )
    require(
        sha256_bytes(read_regular(release.directory / RELEASE_MARKER, "release", MAX_REQUIRED_FILE_BYTES))
        == RELEASE_MARKER_SHA256,
        "release",
    )
    require(
        sha256_bytes(
            read_regular(
                release.directory / RELEASE_MAIN_JAVASCRIPT,
                "release",
                MAX_REQUIRED_FILE_BYTES,
            )
        )
        == RELEASE_MAIN_JAVASCRIPT_SHA256,
        "release",
    )


def _lexical_blocks(text: str, keyword: str) -> list[tuple[int, int, str]]:
    """Find keyword blocks while ignoring Nginx comments and quoted strings."""
    result: list[tuple[int, int, str]] = []
    length = len(text)

    def skip_string_or_comment(index: int) -> int:
        if text[index] == "#":
            newline = text.find("\n", index + 1)
            return length if newline == -1 else newline + 1
        quote = text[index]
        index += 1
        while index < length:
            if text[index] == "\\":
                index += 2
            elif text[index] == quote:
                return index + 1
            else:
                index += 1
        raise RolloutError("nginx_parse")

    index = 0
    while index < length:
        current = text[index]
        if current == "#" or current in {"'", '"'}:
            index = skip_string_or_comment(index)
            continue
        if text.startswith(keyword, index):
            before = text[index - 1] if index else " "
            after_index = index + len(keyword)
            after = text[after_index] if after_index < length else " "
            if not (before.isalnum() or before in "_-") and not (after.isalnum() or after in "_-"):
                cursor = after_index
                while cursor < length and text[cursor].isspace():
                    cursor += 1
                header_start = cursor
                while cursor < length and text[cursor] != "{":
                    if text[cursor] == ";":
                        break
                    if text[cursor] == "#" or text[cursor] in {"'", '"'}:
                        cursor = skip_string_or_comment(cursor)
                    else:
                        cursor += 1
                if cursor < length and text[cursor] == "{":
                    depth = 1
                    body = cursor + 1
                    end = body
                    while end < length and depth:
                        if text[end] == "#" or text[end] in {"'", '"'}:
                            end = skip_string_or_comment(end)
                            continue
                        if text[end] == "{":
                            depth += 1
                        elif text[end] == "}":
                            depth -= 1
                        end += 1
                    require(depth == 0, "nginx_parse")
                    result.append((index, end, text[header_start:cursor].strip()))
                    index = end
                    continue
        index += 1
    return result


def _remove_comments(text: str) -> str:
    output: list[str] = []
    index = 0
    quote: str | None = None
    while index < len(text):
        current = text[index]
        if quote:
            output.append(current)
            if current == "\\" and index + 1 < len(text):
                output.append(text[index + 1])
                index += 2
                continue
            if current == quote:
                quote = None
            index += 1
            continue
        if current in {"'", '"'}:
            quote = current
            output.append(current)
        elif current == "#":
            while index < len(text) and text[index] != "\n":
                output.append(" ")
                index += 1
            continue
        else:
            output.append(current)
        index += 1
    return "".join(output)


def _server_names(block: str) -> set[str]:
    clean = _remove_comments(block)
    values = re.findall(r"(?m)^\s*server_name\s+([^;{}]+);", clean)
    return {name for value in values for name in value.split()}


def _is_tls(block: str) -> bool:
    clean = _remove_comments(block)
    return bool(re.search(r"(?m)^\s*listen\s+[^;]*\b443\b[^;]*\bssl\b[^;]*;", clean))


def _has_exact_directive(block: str, directive: str, expected: str) -> bool:
    clean = _remove_comments(block)
    pattern = rf"(?m)^\s*{re.escape(directive)}\s+{re.escape(expected)}\s*;"
    return bool(re.search(pattern, clean))


def static_locations(current_link: Path) -> str:
    root = str(current_link)
    return (
        "    # Phone11 static portal: API traffic is intentionally never proxied here.\n"
        "    location = / {\n"
        f"        root {root};\n"
        "        try_files /portal/index.html /index.html =404;\n"
        "    }\n\n"
        "    location = /api { return 404; }\n"
        "    location ^~ /api/ { return 404; }\n\n"
        "    location / {\n"
        f"        root {root};\n"
        "        try_files $uri $uri.html $uri/index.html /index.html =404;\n"
        "    }"
    )


def target_tls_server(text: str) -> tuple[int, int, str]:
    candidates: list[tuple[int, int, str]] = []
    for start, end, _header in _lexical_blocks(text, "server"):
        block = text[start:end]
        if HOSTNAME in _server_names(block) and _is_tls(block):
            candidates.append((start, end, block))
    require(len(candidates) == 1, "nginx_target")
    server_start, server_end, server = candidates[0]
    require(_server_names(server) == {HOSTNAME}, "nginx_target")
    require(_has_exact_directive(server, "ssl_certificate", str(CERTIFICATE)), "nginx_target")
    require(_has_exact_directive(server, "ssl_certificate_key", str(CERTIFICATE_KEY)), "nginx_target")
    return server_start, server_end, server


def decode_nginx_site(source: bytes) -> str:
    try:
        return source.decode("utf-8")
    except UnicodeDecodeError as error:
        raise RolloutError("nginx_encoding") from error


def is_exact_managed_static_site(source: bytes, current_link: Path) -> bool:
    """Recognize only the controller's byte-exact static location contract."""
    text = decode_nginx_site(source)
    _server_start, _server_end, server = target_tls_server(text)
    expected = static_locations(current_link)
    if expected not in server:
        # A current-link root or API-denial location means someone attempted a
        # static configuration.  It must be byte-exact rather than being
        # mistaken for the initial proxied vhost.
        clean = _remove_comments(server)
        if str(current_link) in clean or re.search(r"(?m)^\s*location\s+(?:=\s*)?/api", clean):
            raise RolloutError("nginx_target")
        return False

    require(server.count(expected) == 1, "nginx_target")
    locations = _lexical_blocks(server, "location")
    require(
        [header for _start, _end, header in locations]
        == ["= /", "= /api", "^~ /api/", "/"],
        "nginx_target",
    )
    clean = _remove_comments(server)
    require(
        "proxy_pass" not in clean and "fastcgi_pass" not in clean and "uwsgi_pass" not in clean,
        "nginx_target",
    )
    return True


def rewrite_site(source: bytes, current_link: Path) -> bytes:
    text = decode_nginx_site(source)
    server_start, _server_end, server = target_tls_server(text)
    locations = _lexical_blocks(server, "location")
    roots = [(start, end) for start, end, header in locations if header == "/"]
    require(len(roots) == 1, "nginx_target")
    require(not any(header == "/api" or header.startswith("/api/") for _start, _end, header in locations), "nginx_target")
    root_start, root_end = roots[0]
    root_location = server[root_start:root_end]
    require(root_location.count("proxy_pass") == 1, "nginx_target")
    require(bool(re.search(r"\bproxy_pass\s+http://127\.0\.0\.1:3000\s*;", _remove_comments(root_location))), "nginx_target")
    require(server.count("proxy_pass") == 1, "nginx_target")

    replacement = static_locations(current_link)
    changed_server = server[:root_start] + replacement + server[root_end:]
    require("proxy_pass" not in changed_server and "fastcgi_pass" not in changed_server and "uwsgi_pass" not in changed_server, "nginx_target")
    require(_server_names(changed_server) == _server_names(server), "nginx_target")
    require(_has_exact_directive(changed_server, "ssl_certificate", str(CERTIFICATE)), "nginx_target")
    require(_has_exact_directive(changed_server, "ssl_certificate_key", str(CERTIFICATE_KEY)), "nginx_target")
    return (text[:server_start] + changed_server + text[server_start + len(server):]).encode("utf-8")


class System:
    def command(self, arguments: Sequence[str]) -> bytes:
        try:
            result = subprocess.run(
                list(arguments),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                timeout=30,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise RolloutError("command") from error
        if result.returncode != 0:
            raise RolloutError("command")
        return result.stdout

    def pause(self, seconds: float) -> None:
        time.sleep(seconds)


def nginx_dump(system: System) -> bytes:
    raw = system.command(("nginx", "-T"))
    # `nginx -T` emits its configuration dump on stdout. Diagnostics go to
    # stderr and are deliberately excluded so timestamp/PID warnings cannot
    # change the pinned config fingerprint.
    require(raw.startswith(b"# configuration file "), "nginx_dump")
    return raw


def nginx_test(system: System) -> None:
    system.command(("nginx", "-t"))


def nginx_reload(system: System) -> None:
    system.command(("nginx", "-s", "reload"))


def curl_fingerprint(system: System, url: str) -> tuple[int, str]:
    # Every probe uses a new curl process, HTTP/1.1, and Connection: close so
    # the retry cannot reuse a connection held by a pre-reload worker.
    raw = system.command(
        (
            "curl", "-sS", "--http1.1", "-H", "Connection: close",
            "-w", "\n__PHONE11_HTTP_STATUS__:%{http_code}",
            "--connect-timeout", "5", "--max-time", "15",
            "--resolve", f"{HOSTNAME}:443:{EDGE_IP}", url,
        )
    )
    try:
        body, marker = raw.rsplit(b"\n__PHONE11_HTTP_STATUS__:", 1)
        status = int(marker.decode("ascii"))
    except (UnicodeDecodeError, ValueError) as error:
        raise RolloutError("probe") from error
    require(100 <= status <= 599, "probe")
    return status, sha256_bytes(body)


def curl_status(system: System, url: str) -> int:
    return curl_fingerprint(system, url)[0]


def cors_probe(system: System) -> None:
    raw = system.command(
        (
            "curl", "-sS", "--http1.1", "-H", "Connection: close",
            "-D", "-", "-o", "/dev/null", "-X", "OPTIONS",
            "--connect-timeout", "5", "--max-time", "15",
            "--resolve", f"api.phone11.ai:443:{EDGE_IP}",
            "-H", f"Origin: {PUBLIC_ORIGIN}",
            "-H", "Access-Control-Request-Method: GET",
            f"{API_ORIGIN}/api/health",
        )
    ).decode("iso-8859-1")
    lower = raw.lower()
    require(bool(re.search(r"(?m)^http/[^ ]+ 204\b", lower)), "cors_probe")
    require(f"access-control-allow-origin: {PUBLIC_ORIGIN}" in lower, "cors_probe")
    require("access-control-allow-credentials: true" in lower, "cors_probe")


def marker_digest(release: Release) -> str:
    manifest_raw = read_regular(release.export_manifest, "release")
    require(sha256_bytes(manifest_raw) == release.export_manifest_sha256, "release")
    try:
        document = json.loads(manifest_raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RolloutError("release") from error
    require(isinstance(document, dict) and isinstance(document.get("files"), dict), "release")
    value = document["files"].get(RELEASE_MARKER)
    require(is_sha256(value), "release")
    return value


def retry_fresh_connection_probe(system: System, probe: Callable[[], None]) -> None:
    """Retry a complete HTTP proof across fresh, closed connections only."""
    for attempt in range(HTTP_PROBE_ATTEMPTS):
        try:
            probe()
            return
        except RolloutError:
            if attempt + 1 == HTTP_PROBE_ATTEMPTS:
                raise
            system.pause(HTTP_PROBE_RETRY_SECONDS)


def probe_static(manifest: Manifest, system: System) -> None:
    def once() -> None:
        require(curl_status(system, f"{PUBLIC_ORIGIN}/") == 200, "probe")
        require(curl_status(system, f"{PUBLIC_ORIGIN}/portal/") == 200, "probe")
        require(curl_status(system, f"{PUBLIC_ORIGIN}/api/phone11-static-portal-probe") == 404, "probe")
        marker_status, served_marker_digest = curl_fingerprint(system, f"{PUBLIC_ORIGIN}/{RELEASE_MARKER}")
        require(marker_status == 200 and served_marker_digest == marker_digest(manifest.release), "probe")
        cors_probe(system)

    retry_fresh_connection_probe(system, once)


def managed_predecessor_baseline(system: System, predecessor: Release) -> tuple[int, int, str]:
    """Prove the live predecessor before using it as a managed rollback point."""
    root_status = curl_status(system, f"{PUBLIC_ORIGIN}/")
    require(root_status == 200, "managed_probe")
    marker_status, marker_sha256 = curl_fingerprint(system, f"{PUBLIC_ORIGIN}/{RELEASE_MARKER}")
    require(
        marker_status == 200 and marker_sha256 == marker_digest(predecessor),
        "managed_probe",
    )
    return root_status, marker_status, marker_sha256


def operation_directory(manifest: Manifest) -> Path:
    return manifest.state_dir / manifest.release.source_sha


def verify_enabled_site(pins: NginxPins) -> None:
    """Bind the live include symlink to the regular file we will replace."""
    try:
        info = pins.enabled_site.lstat()
        require(stat.S_ISLNK(info.st_mode), "nginx_site")
        require(os.readlink(pins.enabled_site) == pins.enabled_site_link, "nginx_site")
        require(pins.enabled_site.resolve(strict=True) == pins.site.resolve(strict=True), "nginx_site")
    except RolloutError:
        raise
    except OSError as error:
        raise RolloutError("nginx_site") from error


def check_pins(manifest: Manifest, system: System) -> bytes:
    verify_enabled_site(manifest.nginx)
    site = read_regular(manifest.nginx.site, "nginx_site", 4 * 1024 * 1024)
    require(sha256_bytes(site) == manifest.nginx.site_sha256, "nginx_site")
    require(sha256_bytes(nginx_dump(system)) == manifest.nginx.dump_sha256, "nginx_dump")
    if is_exact_managed_static_site(site, manifest.release.current_link):
        # The first conversion preserves these files under its receipt.  A
        # managed update must never reactivate the duplicate enabled includes.
        for legacy in manifest.nginx.legacy_includes:
            require(not legacy.path.exists() and not legacy.path.is_symlink(), "legacy_include")
    else:
        for legacy in manifest.nginx.legacy_includes:
            require(sha256_bytes(read_regular(legacy.path, "legacy_include", 4 * 1024 * 1024)) == legacy.sha256, "legacy_include")
    return site


def prepare(manifest: Manifest, system: System) -> Prepared:
    validate_target_release(manifest.release)
    site = check_pins(manifest, system)
    if is_exact_managed_static_site(site, manifest.release.current_link):
        validate_managed_predecessor(manifest, site)
        nginx_test(system)
        return Prepared(site, site, MANAGED_UPDATE)
    candidate = rewrite_site(site, manifest.release.current_link)
    require(candidate != site, "nginx_target")
    nginx_test(system)
    return Prepared(site, candidate, INITIAL_CONVERSION)


def link_state(path: Path) -> str | None:
    if not path.exists() and not path.is_symlink():
        return None
    require(path.is_symlink(), "current_link")
    return os.readlink(path)


def receipt_mode(receipt: dict[str, Any], stage: str) -> str:
    legacy_keys = {
        "schema", "release_sha", "site", "before_sha256", "active_sha256", "current_link",
        "previous_link", "root_status_before", "marker_status_before", "marker_sha256_before",
        "legacy_includes",
    }
    keys = set(receipt)
    require(keys == legacy_keys or keys == legacy_keys | {"mode"}, stage)
    mode = receipt.get("mode", INITIAL_CONVERSION)
    require(mode in {INITIAL_CONVERSION, MANAGED_UPDATE}, stage)
    legacy = receipt["legacy_includes"]
    require(isinstance(legacy, list), stage)
    if mode == INITIAL_CONVERSION:
        require(len(legacy) == len(LEGACY_INCLUDE_NAMES), stage)
    else:
        require(legacy == [], stage)
    return mode


def sealed_predecessor_release(manifest: Manifest, target: object, stage: str) -> Release:
    require(isinstance(target, str), stage)
    directory = Path(target)
    require(
        directory.is_absolute()
        and directory.parent == manifest.release.directory.parent
        and bool(re.fullmatch(r"[0-9a-f]{40}", directory.name))
        and directory.name != manifest.release.source_sha,
        stage,
    )
    export_manifest = directory / EXPORT_MANIFEST_NAME
    export_manifest_sha256 = sha256_bytes(read_regular(export_manifest, stage))
    return Release(directory.name, directory, export_manifest, export_manifest_sha256, manifest.release.current_link)


def managed_predecessor_release(manifest: Manifest) -> Release:
    return sealed_predecessor_release(manifest, link_state(manifest.release.current_link), "managed_state")


def receipt_predecessor_release(manifest: Manifest, receipt: dict[str, Any]) -> Release:
    return sealed_predecessor_release(manifest, receipt["previous_link"], "rollback")


def validate_managed_predecessor(manifest: Manifest, site: bytes) -> Release:
    """Bind a live static vhost to the preceding controller receipt."""
    try:
        predecessor = managed_predecessor_release(manifest)
        validate_release(predecessor)
        directory = predecessor.directory
        release_info = directory.lstat()
        require(stat.S_ISDIR(release_info.st_mode) and not stat.S_ISLNK(release_info.st_mode), "managed_state")
        operation = manifest.state_dir / directory.name
        operation_info = operation.lstat()
        require(stat.S_ISDIR(operation_info.st_mode) and not stat.S_ISLNK(operation_info.st_mode), "managed_state")
        if os.geteuid() == 0:
            require(operation_info.st_uid == 0 and stat.S_IMODE(operation_info.st_mode) == 0o700, "managed_state")
        receipt = read_json(operation / "receipt.json", "managed_state")
        mode = receipt_mode(receipt, "managed_state")
        require(
            receipt["schema"] == SCHEMA
            and receipt["release_sha"] == directory.name
            and receipt["site"] == str(manifest.nginx.site)
            and receipt["current_link"] == str(manifest.release.current_link)
            and is_sha256(receipt["before_sha256"])
            and is_sha256(receipt["active_sha256"])
            and isinstance(receipt["previous_link"], (str, type(None)))
            and (mode != MANAGED_UPDATE or isinstance(receipt["previous_link"], str))
            and isinstance(receipt["root_status_before"], int)
            and isinstance(receipt["marker_status_before"], int)
            and is_sha256(receipt["marker_sha256_before"])
            and sha256_bytes(site) == receipt["active_sha256"],
            "managed_state",
        )
        before = read_regular(operation / "site.before", "managed_state", 4 * 1024 * 1024)
        require(sha256_bytes(before) == receipt["before_sha256"], "managed_state")
        require(not (operation / "failure.json").exists() and not (operation / "failure.json").is_symlink(), "managed_state")
        legacy = receipt["legacy_includes"]
        if mode == INITIAL_CONVERSION:
            expected_names = set(LEGACY_INCLUDE_NAMES)
            seen_names: set[str] = set()
            for item in legacy:
                exact_keys(item, {"path", "sha256", "saved_as"}, "managed_state")
                original = absolute(item["path"], "managed_state")
                saved_as = item["saved_as"]
                require(
                    original.parent == manifest.nginx.enabled_site.parent
                    and original.name in expected_names
                    and saved_as == f"legacy/{original.name}"
                    and is_sha256(item["sha256"]),
                    "managed_state",
                )
                seen_names.add(original.name)
                saved = operation / saved_as
                require(
                    sha256_bytes(read_regular(saved, "managed_state", 4 * 1024 * 1024)) == item["sha256"],
                    "managed_state",
                )
            require(seen_names == expected_names, "managed_state")
        return predecessor
    except RolloutError:
        raise
    except OSError as error:
        raise RolloutError("managed_state") from error


def write_receipt(
    manifest: Manifest,
    before: bytes,
    active: bytes,
    mode: str,
    previous_link: str | None,
    root_status: int,
    marker_status: int,
    marker_sha256: str,
) -> Path:
    require(mode in {INITIAL_CONVERSION, MANAGED_UPDATE}, "operation")
    require(mode != MANAGED_UPDATE or isinstance(previous_link, str), "operation")
    operation = operation_directory(manifest)
    create_root_directory(operation, "operation")
    try:
        require(operation.stat().st_dev == manifest.nginx.site.parent.stat().st_dev, "operation")
        atomic_write(operation / "site.before", before, 0o600, os.geteuid(), os.getegid())
        receipt = {
            "schema": SCHEMA,
            "release_sha": manifest.release.source_sha,
            "mode": mode,
            "site": str(manifest.nginx.site),
            "before_sha256": sha256_bytes(before),
            "active_sha256": sha256_bytes(active),
            "current_link": str(manifest.release.current_link),
            "previous_link": previous_link,
            "root_status_before": root_status,
            "marker_status_before": marker_status,
            "marker_sha256_before": marker_sha256,
            "legacy_includes": [
                {"path": str(item.path), "sha256": item.sha256, "saved_as": f"legacy/{item.path.name}"}
                for item in manifest.nginx.legacy_includes
            ] if mode == INITIAL_CONVERSION else [],
        }
        atomic_write(
            operation / "receipt.json",
            json.dumps(receipt, sort_keys=True, separators=(",", ":")).encode("utf-8"),
            0o600,
            os.geteuid(),
            os.getegid(),
        )
        if mode == INITIAL_CONVERSION:
            create_root_directory(operation / "legacy", "operation")
        return operation
    except BaseException:
        try:
            operation.rmdir()
        except OSError:
            pass
        raise


def safe_failure_stage(error: BaseException, fallback: str) -> str:
    stage = error.stage if isinstance(error, RolloutError) else fallback
    return stage if isinstance(stage, str) and re.fullmatch(r"[a-z_]+", stage) else fallback


def write_failure_record(
    manifest: Manifest,
    operation: Path,
    *,
    original_stage: str,
    rollback_stage: str | None,
) -> None:
    """Persist safe stage names without letting diagnostics block recovery."""
    document = {
        "schema": SCHEMA,
        "release_sha": manifest.release.source_sha,
        "original_stage": original_stage,
        "rollback_stage": rollback_stage,
    }
    try:
        info = operation.lstat()
        require(stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode), "operation")
        atomic_write(
            operation / "failure.json",
            json.dumps(document, sort_keys=True, separators=(",", ":")).encode("utf-8"),
            0o600,
            os.geteuid(),
            os.getegid(),
        )
    except BaseException:
        # The CLI output still carries both safe stages if this diagnostic file
        # cannot be written.  Do not replace a recoverable rollout failure with
        # a logging failure.
        return


def move_legacy_out(manifest: Manifest, operation: Path) -> None:
    for legacy in manifest.nginx.legacy_includes:
        destination = operation / "legacy" / legacy.path.name
        require(not destination.exists() and legacy.path.exists(), "legacy_include")
        os.replace(legacy.path, destination)
        fsync_directory(legacy.path.parent)
        fsync_directory(destination.parent)


def restore_legacy(receipt: dict[str, Any], operation: Path) -> None:
    legacy_items = receipt["legacy_includes"]
    require(isinstance(legacy_items, list), "rollback")
    for item in legacy_items:
        exact_keys(item, {"path", "sha256", "saved_as"}, "rollback")
        original = absolute(item["path"], "rollback")
        saved = operation / item["saved_as"]
        if saved.exists():
            require(not original.exists() and sha256_bytes(read_regular(saved, "rollback", 4 * 1024 * 1024)) == item["sha256"], "rollback")
            os.replace(saved, original)
            fsync_directory(original.parent)
        else:
            require(sha256_bytes(read_regular(original, "rollback", 4 * 1024 * 1024)) == item["sha256"], "rollback")


def load_receipt(manifest: Manifest) -> tuple[Path, dict[str, Any], bytes]:
    operation = operation_directory(manifest)
    receipt = read_json(operation / "receipt.json", "rollback")
    mode = receipt_mode(receipt, "rollback")
    require(
        receipt["schema"] == SCHEMA
        and receipt["release_sha"] == manifest.release.source_sha
        and receipt["site"] == str(manifest.nginx.site)
        and receipt["current_link"] == str(manifest.release.current_link)
        and isinstance(receipt["previous_link"], (str, type(None)))
        and (mode != MANAGED_UPDATE or isinstance(receipt["previous_link"], str))
        and isinstance(receipt["root_status_before"], int)
        and isinstance(receipt["marker_status_before"], int)
        and is_sha256(receipt["marker_sha256_before"])
        and is_sha256(receipt["before_sha256"])
        and is_sha256(receipt["active_sha256"]),
        "rollback",
    )
    before = read_regular(operation / "site.before", "rollback", 4 * 1024 * 1024)
    require(sha256_bytes(before) == receipt["before_sha256"], "rollback")
    return operation, receipt, before


def probe_rollback_http(manifest: Manifest, system: System, receipt: dict[str, Any]) -> None:
    def once() -> None:
        require(curl_status(system, f"{PUBLIC_ORIGIN}/") == receipt["root_status_before"], "rollback_probe")
        marker_status, marker_sha256 = curl_fingerprint(system, f"{PUBLIC_ORIGIN}/{RELEASE_MARKER}")
        require(
            marker_status == receipt["marker_status_before"]
            and marker_sha256 == receipt["marker_sha256_before"],
            "rollback_probe",
        )

    retry_fresh_connection_probe(system, once)


def validate_failure_record(manifest: Manifest, operation: Path) -> dict[str, Any] | None:
    """Validate a new-controller failure record when one exists.

    The earlier controller did not write this diagnostic.  Its receipt can be
    re-armed only after the same complete restored-host proof below; this path
    never invents a record or derives an unobserved failure stage.
    """
    path = operation / "failure.json"
    if not path.exists() and not path.is_symlink():
        return None
    document = read_json(path, "rearm")
    exact_keys(document, {"schema", "release_sha", "original_stage", "rollback_stage"}, "rearm")
    require(document["schema"] == SCHEMA and document["release_sha"] == manifest.release.source_sha, "rearm")
    require(
        isinstance(document["original_stage"], str)
        and bool(re.fullmatch(r"[a-z_]+", document["original_stage"]))
        and (
            document["rollback_stage"] is None
            or (
                isinstance(document["rollback_stage"], str)
                and bool(re.fullmatch(r"[a-z_]+", document["rollback_stage"]))
            )
        ),
        "rearm",
    )
    return document


def recovered_operation_archive(manifest: Manifest) -> Path:
    # The timestamp makes a repeated, fully recovered attempt preservable too.
    # Refuse the astronomically unlikely collision instead of overwriting an
    # earlier operator record.
    archive = manifest.state_dir / f"{manifest.release.source_sha}.recovered-{time.time_ns()}"
    require(not archive.exists() and not archive.is_symlink(), "rearm")
    return archive


def rearm_recovered_operation(manifest: Manifest, system: System) -> None:
    """Archive only a proved-restored failed attempt before retrying its release."""
    operation = operation_directory(manifest)
    if not operation.exists() and not operation.is_symlink():
        return
    try:
        info = operation.lstat()
        require(stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode), "rearm")
        if os.geteuid() == 0:
            require(info.st_uid == 0 and stat.S_IMODE(info.st_mode) == 0o700, "rearm")
        validate_failure_record(manifest, operation)
        loaded_operation, receipt, before = load_receipt(manifest)
        require(loaded_operation == operation, "rearm")
        restored_site = check_pins(manifest, system)
        require(sha256_bytes(restored_site) == receipt["before_sha256"] == sha256_bytes(before), "rearm")
        require(link_state(manifest.release.current_link) == receipt["previous_link"], "rearm")
        for legacy in manifest.nginx.legacy_includes:
            require(not (operation / "legacy" / legacy.path.name).exists(), "rearm")
        nginx_test(system)
        probe_rollback_http(manifest, system, receipt)
        archive = recovered_operation_archive(manifest)
        os.replace(operation, archive)
        fsync_directory(manifest.state_dir)
    except RolloutError:
        raise
    except OSError as error:
        raise RolloutError("rearm") from error


def restore(
    manifest: Manifest,
    system: System,
    *,
    dry_run: bool = False,
    require_active: bool = False,
    require_root: bool = True,
) -> None:
    if not dry_run and require_root:
        require(os.geteuid() == 0, "root")
    operation, receipt, before = load_receipt(manifest)
    mode = receipt_mode(receipt, "rollback")
    verify_enabled_site(manifest.nginx)
    active = read_regular(manifest.nginx.site, "rollback", 4 * 1024 * 1024)
    active_hash = sha256_bytes(active)
    require(
        active_hash == receipt["active_sha256"]
        or (not require_active and active_hash == receipt["before_sha256"]),
        "rollback",
    )
    current_target = link_state(manifest.release.current_link)
    previous = receipt["previous_link"]
    if require_active:
        require(current_target == str(manifest.release.directory), "rollback")
    else:
        require(current_target in {None, str(manifest.release.directory), previous}, "rollback")
    if mode == MANAGED_UPDATE:
        require(
            receipt["before_sha256"] == receipt["active_sha256"] == sha256_bytes(active),
            "rollback",
        )
        require(is_exact_managed_static_site(active, manifest.release.current_link), "rollback")
        require(sha256_bytes(nginx_dump(system)) == manifest.nginx.dump_sha256, "rollback")
        predecessor = receipt_predecessor_release(manifest, receipt)
        try:
            validate_release(predecessor)
        except RolloutError as error:
            raise RolloutError("rollback") from error
        require(
            receipt["root_status_before"] == 200
            and receipt["marker_status_before"] == 200
            and receipt["marker_sha256_before"] == marker_digest(predecessor),
            "rollback",
        )
    if dry_run:
        return
    try:
        verify_enabled_site(manifest.nginx)
        if mode == INITIAL_CONVERSION:
            info = manifest.nginx.site.stat()
            atomic_write(manifest.nginx.site, before, stat.S_IMODE(info.st_mode), info.st_uid, info.st_gid)
            restore_legacy(receipt, operation)
        if previous is None:
            if manifest.release.current_link.is_symlink():
                require(os.readlink(manifest.release.current_link) == str(manifest.release.directory), "rollback")
                remove_link(manifest.release.current_link)
            else:
                require(not manifest.release.current_link.exists(), "rollback")
        else:
            atomic_symlink(manifest.release.current_link, previous)
        if mode == INITIAL_CONVERSION:
            nginx_test(system)
            nginx_reload(system)
        probe_rollback_http(manifest, system, receipt)
        require(sha256_bytes(nginx_dump(system)) == manifest.nginx.dump_sha256, "rollback_probe")
    except RolloutError:
        raise
    except OSError as error:
        raise RolloutError("rollback") from error


def activate(
    manifest: Manifest,
    system: System,
    *,
    dry_run: bool = False,
    require_root: bool = True,
) -> None:
    if not dry_run and require_root:
        require(os.geteuid() == 0, "root")
    prepared = prepare(manifest, system)
    if dry_run:
        return
    rearm_recovered_operation(manifest, system)
    previous_link = link_state(manifest.release.current_link)
    if prepared.mode == MANAGED_UPDATE:
        predecessor = validate_managed_predecessor(manifest, prepared.before)
        root_status, marker_status, marker_sha256 = managed_predecessor_baseline(system, predecessor)
    else:
        root_status = curl_status(system, f"{PUBLIC_ORIGIN}/")
        marker_status, marker_sha256 = curl_fingerprint(system, f"{PUBLIC_ORIGIN}/{RELEASE_MARKER}")
    operation = write_receipt(
        manifest,
        prepared.before,
        prepared.active,
        prepared.mode,
        previous_link,
        root_status,
        marker_status,
        marker_sha256,
    )
    changed = False
    try:
        # Re-hash the complete regular-file export tree at the last safe point,
        # immediately before making it reachable through ``current``.
        validate_target_release(manifest.release)
        if prepared.mode == INITIAL_CONVERSION:
            move_legacy_out(manifest, operation)
            verify_enabled_site(manifest.nginx)
            info = manifest.nginx.site.stat()
        else:
            managed_site = check_pins(manifest, system)
            require(sha256_bytes(managed_site) == sha256_bytes(prepared.before), "nginx_site")
            validate_managed_predecessor(manifest, managed_site)
        # Arm rollback before os.replace() can change current but fsync fails.
        changed = True
        atomic_symlink(manifest.release.current_link, str(manifest.release.directory))
        if prepared.mode == INITIAL_CONVERSION:
            atomic_write(manifest.nginx.site, prepared.active, stat.S_IMODE(info.st_mode), info.st_uid, info.st_gid)
        if prepared.mode == INITIAL_CONVERSION:
            nginx_test(system)
            nginx_reload(system)
        probe_static(manifest, system)
    except BaseException as error:
        original_stage = safe_failure_stage(error, "activation")
        write_failure_record(
            manifest,
            operation,
            original_stage=original_stage,
            rollback_stage=None,
        )
        if changed or (
            prepared.mode == INITIAL_CONVERSION
            and any((operation / "legacy" / item.path.name).exists() for item in manifest.nginx.legacy_includes)
        ):
            try:
                restore(manifest, system, require_active=False, require_root=False)
            except BaseException as rollback_error:
                rollback_stage = safe_failure_stage(rollback_error, "rollback")
                write_failure_record(
                    manifest,
                    operation,
                    original_stage=original_stage,
                    rollback_stage=rollback_stage,
                )
                raise RolloutError(
                    "rollback_failed",
                    original_stage=original_stage,
                    rollback_stage=rollback_stage,
                ) from rollback_error
        if isinstance(error, RolloutError):
            raise
        raise RolloutError("activation") from error


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--prepare", action="store_true", help="Validate exact pins and the generated Nginx replacement without writing.")
    modes.add_argument("--activate", action="store_true", help="Atomically publish the pre-uploaded export on the edge host.")
    modes.add_argument("--rollback", action="store_true", help="Restore the recorded Nginx file, legacy includes, and current symlink.")
    parser.add_argument("--manifest", required=True, type=Path, help="Root-owned exact manifest for this release.")
    parser.add_argument("--dry-run", action="store_true", help="Validate the selected operation without modifying the host.")
    return parser.parse_args(argv)


def run(arguments: argparse.Namespace, system: System | None = None) -> int:
    manifest = parse_manifest(arguments.manifest)
    runner = system or System()
    if arguments.prepare:
        prepare(manifest, runner)
        print(f"prepare=PASS release={RELEASE_SHA[:7]} origin={PUBLIC_ORIGIN}")
    elif arguments.activate:
        activate(manifest, runner, dry_run=arguments.dry_run)
        print("activate=DRY_RUN" if arguments.dry_run else f"activate=PASS release={RELEASE_SHA[:7]} origin={PUBLIC_ORIGIN}")
    else:
        restore(manifest, runner, dry_run=arguments.dry_run)
        print("rollback=DRY_RUN" if arguments.dry_run else f"rollback=PASS release={RELEASE_SHA[:7]}")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    try:
        return run(parse_args(argv))
    except RolloutError as error:
        details = [f"static_portal_rollout=FAIL", f"stage={error.stage}"]
        if error.original_stage is not None:
            details.append(f"original_stage={error.original_stage}")
        if error.rollback_stage is not None:
            details.append(f"rollback_stage={error.rollback_stage}")
        print(" ".join(details), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
