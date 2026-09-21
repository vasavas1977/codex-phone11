#!/usr/bin/env python3
"""Strictly owned, reversible Phone11 HTTP mutation maintenance gate.

This source is default-off. It changes an edge Nginx site only when explicitly
invoked as root with exact configuration and process pins. Commissioning and
production activation are separate operations.
"""

from __future__ import annotations

import argparse
import contextlib
import fcntl
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import socket
import ssl
import stat
import subprocess
import sys
import tempfile
import time
from typing import Any, Callable, Mapping, Protocol, Sequence
import uuid


SCHEMA = "phone11-edge-maintenance/v1"
SERVER_NAME = "api.phone11.ai"
LOCK_PATH = Path("/run/lock/phone11-edge-maintenance-controller.lock")
BEGIN = "# PHONE11_PROFILE_DND_EDGE_GATE_BEGIN"
END = "# PHONE11_PROFILE_DND_EDGE_GATE_END"
FENCE_HEADER = "x-phone11-maintenance-fence"
CONFIG_HEADER = "x-phone11-maintenance-config"
WORKER_HEADER = "x-phone11-maintenance-worker"
MIN_DURATION_SECONDS = 180
MAX_DURATION_SECONDS = 1800


class ControlError(RuntimeError):
    def __init__(self, stage: str):
        super().__init__(stage)
        self.stage = stage


class System(Protocol):
    def command(self, args: Sequence[str], timeout: int = 20) -> bytes: ...
    def request(self, method: str, path: str) -> tuple[int, Mapping[str, str]]: ...


def guarded(value: bool, stage: str) -> None:
    if not value:
        raise ControlError(stage)


def canonical_bytes(value: Mapping[str, Any]) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def valid_sha(value: str, stage: str) -> str:
    guarded(bool(re.fullmatch(r"[0-9a-f]{64}", value)), stage)
    return value


def valid_uuid(value: str, stage: str = "operation_id") -> str:
    try:
        parsed = uuid.UUID(value)
    except ValueError as error:
        raise ControlError(stage) from error
    guarded(parsed.version == 4 and str(parsed) == value.lower(), stage)
    return str(parsed)


def secure_file(path: Path, *, mode: int | None = None, expected_uid: int = 0) -> bytes:
    guarded(path.is_absolute() and not path.is_symlink(), "file_identity")
    before = path.stat()
    guarded(
        stat.S_ISREG(before.st_mode) and before.st_uid == expected_uid and before.st_nlink == 1
        and before.st_mode & 0o022 == 0 and before.st_size <= 4 * 1024 * 1024,
        "file_identity",
    )
    if mode is not None:
        guarded(stat.S_IMODE(before.st_mode) == mode, "file_identity")
    fd = os.open(path, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW)
    try:
        opened = os.fstat(fd)
        guarded(
            (opened.st_dev, opened.st_ino, opened.st_size)
            == (before.st_dev, before.st_ino, before.st_size),
            "file_identity",
        )
        raw = b""
        while len(raw) <= 4 * 1024 * 1024:
            block = os.read(fd, 65536)
            if not block:
                break
            raw += block
        guarded(len(raw) == before.st_size, "file_identity")
        after = os.fstat(fd)
        guarded(
            (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)
            == (opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns),
            "file_identity",
        )
        return raw
    finally:
        os.close(fd)


def _matching_brace(text: str, opening: int) -> int:
    depth, quote, escaped, comment = 0, "", False, False
    for index in range(opening, len(text)):
        char = text[index]
        following = text[index + 1] if index + 1 < len(text) else ""
        if comment:
            if char == "\n":
                comment = False
            continue
        if quote:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = ""
            continue
        if char == "#":
            comment = True
        elif char in {"'", '"'}:
            quote = char
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return index
        if char == "\\" and following:
            continue
    raise ControlError("config_contract")


def _api_server(text: str) -> tuple[int, int, str]:
    matches: list[tuple[int, int, str]] = []
    for found in re.finditer(r"(?m)^\s*server\s*\{", text):
        opening = text.index("{", found.start())
        closing = _matching_brace(text, opening)
        block = text[found.start():closing + 1]
        if re.search(r"(?m)^\s*server_name\s+api\.phone11\.ai\s*;\s*$", block):
            matches.append((found.start(), closing + 1, block))
    guarded(len(matches) == 1, "config_contract")
    return matches[0]


def render_active_site(
    original: bytes,
    *,
    operation_id: str,
    expires_at_epoch_ms: int,
    generation_id: str,
    contract_sha256: str,
) -> bytes:
    valid_uuid(operation_id)
    valid_uuid(generation_id, "generation_id")
    valid_sha(contract_sha256, "contract")
    try:
        text = original.decode("utf-8", errors="strict")
    except UnicodeDecodeError as error:
        raise ControlError("config_contract") from error
    guarded(BEGIN not in text and END not in text, "already_active")
    server_start, _server_end, server = _api_server(text)
    location_matches = list(re.finditer(r"(?m)^([ \t]*)location\s+/\s*\{", server))
    guarded(len(location_matches) == 1, "config_contract")
    guarded(not re.search(r"(?m)^\s*location\s+(?:=\s+)?/api/(?:trpc|chat/media/upload)", server), "config_contract")
    location = location_matches[0]
    opening = server.index("{", location.start())
    closing = _matching_brace(server, opening)
    indent = location.group(1)
    body = server[opening + 1:closing]
    guarded("proxy_pass" in body and "proxy_set_header Host api.phone11.ai;" in body, "config_contract")
    attestation = f"{operation_id}:{expires_at_epoch_ms}:{generation_id}"
    blocks: list[str] = [
        f"{indent}{BEGIN} {operation_id} {expires_at_epoch_ms} {generation_id}\n"
    ]
    for selector in ("= /api/trpc", "^~ /api/trpc/", "= /api/chat/media/upload"):
        blocks.append(f"{indent}location {selector} {{\n")
        blocks.append(f"{indent}    if ($request_method = POST) {{\n")
        blocks.append(f'{indent}        add_header X-Phone11-Maintenance-Fence "{attestation}" always;\n')
        blocks.append(f'{indent}        add_header X-Phone11-Maintenance-Config "{contract_sha256}" always;\n')
        blocks.append(f'{indent}        add_header X-Phone11-Maintenance-Worker "$pid" always;\n')
        blocks.append(f"{indent}        return 503;\n")
        blocks.append(f"{indent}    }}\n")
        blocks.append(body)
        if not body.endswith("\n"):
            blocks.append("\n")
        blocks.append(f"{indent}}}\n")
    blocks.append(f"{indent}{END} {operation_id}\n")
    insert = server_start + location.start()
    active = text[:insert] + "".join(blocks) + text[insert:]
    return active.encode()


def contract_digest(
    *, operation_id: str, expires_at_epoch_ms: int, generation_id: str,
    original_sha256: str, controller_sha256: str, nginx_exe_sha256: str,
) -> str:
    return sha256_bytes(canonical_bytes({
        "schema": SCHEMA, "kind": "edge-contract", "operation_id": operation_id,
        "expires_at_epoch_ms": expires_at_epoch_ms, "generation_id": generation_id,
        "original_site_sha256": original_sha256,
        "controller_sha256": controller_sha256,
        "nginx_exe_sha256": nginx_exe_sha256,
    }))


def atomic_write(path: Path, raw: bytes, *, mode: int, uid: int, gid: int) -> None:
    fd, name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(name)
    committed = False
    try:
        os.fchmod(fd, mode)
        os.fchown(fd, uid, gid)
        with os.fdopen(fd, "wb") as output:
            output.write(raw)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        committed = True
        directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except Exception as error:
        with contextlib.suppress(FileNotFoundError):
            temporary.unlink()
        raise ControlError("atomic_write_committed" if committed else "atomic_write") from error


class RecordStore:
    def __init__(self, directory: Path, lock_path: Path = LOCK_PATH, expected_uid: int = 0):
        self.directory, self.lock_path, self.expected_uid = directory, lock_path, expected_uid
        guarded(directory.is_absolute() and directory.is_dir() and not directory.is_symlink(), "evidence_dir")
        info = directory.stat()
        guarded(info.st_uid == expected_uid and stat.S_IMODE(info.st_mode) == 0o700, "evidence_dir")

    def path(self, operation_id: str, kind: str) -> Path:
        guarded(kind in {"before", "intent", "activation", "release-intent", "release"}, "record_kind")
        suffix = "nginx" if kind == "before" else "json"
        return self.directory / f"{operation_id}.{kind}.{suffix}"

    def write(self, operation_id: str, kind: str, raw: bytes) -> tuple[Path, str]:
        final = self.path(operation_id, kind)
        fd = os.open(final, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC | os.O_NOFOLLOW, 0o600)
        try:
            with os.fdopen(fd, "wb") as output:
                output.write(raw)
                output.flush()
                os.fsync(output.fileno())
            directory_fd = os.open(self.directory, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        except Exception:
            with contextlib.suppress(FileNotFoundError):
                final.unlink()
            raise
        return final, sha256_bytes(raw)

    def read_json(self, operation_id: str, kind: str, digest: str) -> Mapping[str, Any]:
        raw = secure_file(self.path(operation_id, kind), mode=0o600, expected_uid=self.expected_uid)
        guarded(sha256_bytes(raw) == valid_sha(digest, "record"), "record")
        try:
            value = json.loads(raw)
        except json.JSONDecodeError as error:
            raise ControlError("record") from error
        guarded(isinstance(value, dict) and canonical_bytes(value) == raw, "record")
        return value

    def read_owned_json(self, operation_id: str, kind: str) -> tuple[Mapping[str, Any], str]:
        raw = secure_file(self.path(operation_id, kind), mode=0o600, expected_uid=self.expected_uid)
        try:
            value = json.loads(raw)
        except json.JSONDecodeError as error:
            raise ControlError("record") from error
        guarded(isinstance(value, dict) and canonical_bytes(value) == raw, "record")
        return value, sha256_bytes(raw)

    def replace_json(
        self,
        operation_id: str,
        kind: str,
        value: Mapping[str, Any],
        expected_digest: str,
    ) -> str:
        path = self.path(operation_id, kind)
        _current, current_digest = self.read_owned_json(operation_id, kind)
        guarded(current_digest == valid_sha(expected_digest, "record"), "record")
        raw = canonical_bytes(value)
        atomic_write(path, raw, mode=0o600, uid=self.expected_uid, gid=path.parent.stat().st_gid)
        guarded(secure_file(path, mode=0o600, expected_uid=self.expected_uid) == raw, "record")
        return sha256_bytes(raw)

    @contextlib.contextmanager
    def locked(self):
        fd = os.open(self.lock_path, os.O_RDWR | os.O_CREAT | os.O_CLOEXEC | os.O_NOFOLLOW, 0o600)
        try:
            info = os.fstat(fd)
            guarded(stat.S_ISREG(info.st_mode) and info.st_uid == self.expected_uid and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o600, "controller_lock")
            fcntl.flock(fd, fcntl.LOCK_EX)
            yield
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
            os.close(fd)


class LocalSystem:
    def __init__(self, nginx: Path, host: str = SERVER_NAME, address: str = "127.0.0.1"):
        self.nginx, self.host, self.address = nginx, host, address

    def command(self, args: Sequence[str], timeout: int = 20) -> bytes:
        try:
            result = subprocess.run(list(args), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                    stderr=subprocess.DEVNULL, timeout=timeout, check=False)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise ControlError("command") from error
        guarded(result.returncode == 0 and len(result.stdout) <= 4 * 1024 * 1024, "command")
        return result.stdout

    def request(self, method: str, path: str) -> tuple[int, Mapping[str, str]]:
        context = ssl.create_default_context()
        raw_socket = None
        tls_socket = None
        try:
            raw_socket = socket.create_connection((self.address, 443), timeout=4)
            tls_socket = context.wrap_socket(raw_socket, server_hostname=self.host)
            request = (
                f"{method} {path} HTTP/1.1\r\nHost: {self.host}\r\n"
                "Connection: close\r\nContent-Length: 0\r\n\r\n"
            ).encode("ascii")
            tls_socket.sendall(request)
            response = http.client.HTTPResponse(tls_socket)
            response.begin()
            response.read(4096)
            headers = {key.lower(): value for key, value in response.getheaders()}
            return response.status, headers
        except (OSError, ssl.SSLError, http.client.HTTPException) as error:
            raise ControlError("https_probe") from error
        finally:
            if tls_socket is not None:
                tls_socket.close()
            elif raw_socket is not None:
                raw_socket.close()


def _proc_start_ticks(raw: str) -> int:
    # Field 2 is parenthesized and may contain spaces or closing parentheses.
    # Parse from its final delimiter; starttime is field 22, index 19 after it.
    delimiter = raw.rfind(") ")
    guarded(delimiter > 0, "process_identity")
    fields = raw[delimiter + 2:].split()
    guarded(len(fields) > 19, "process_identity")
    try:
        return int(fields[19])
    except ValueError as error:
        raise ControlError("process_identity") from error


def process_identity(pid_file: Path, nginx: Path, expected_exe_sha256: str, expected_uid: int = 0) -> Mapping[str, Any]:
    raw = secure_file(pid_file, mode=None, expected_uid=expected_uid).decode().strip()
    guarded(raw.isdigit() and int(raw) > 0, "process_identity")
    pid = int(raw)
    proc = Path("/proc") / str(pid)
    try:
        start_ticks = _proc_start_ticks((proc / "stat").read_text())
        exe = (proc / "exe").resolve(strict=True)
    except (OSError, UnicodeError) as error:
        raise ControlError("process_identity") from error
    guarded(exe == nginx.resolve(strict=True), "process_identity")
    guarded(sha256_file(exe) == valid_sha(expected_exe_sha256, "process_identity"), "process_identity")
    children: list[int] = []
    worker_start_ticks: dict[str, int] = {}
    for _attempt in range(3):
        try:
            first = sorted(int(item) for item in (proc / "task" / str(pid) / "children").read_text().split())
            starts = {
                str(child): _proc_start_ticks((Path("/proc") / str(child) / "stat").read_text())
                for child in first
            }
            second = sorted(int(item) for item in (proc / "task" / str(pid) / "children").read_text().split())
        except (OSError, UnicodeError, IndexError, ValueError):
            continue
        if first == second and first:
            children, worker_start_ticks = first, starts
            break
    guarded(bool(children), "process_identity")
    return {"pid": pid, "start_ticks": start_ticks, "exe_path": str(exe),
            "exe_sha256": expected_exe_sha256, "worker_pids": children,
            "worker_start_ticks": worker_start_ticks}


class Controller:
    def __init__(self, system: System, store: RecordStore, *, site: Path, nginx: Path,
                 pid_file: Path, expected_nginx_exe_sha256: str,
                 expected_original_sha256: str, expected_original_dump_sha256: str,
                 controller_identity: Mapping[str, str], clock: Callable[[], int] = lambda: int(time.time() * 1000),
                 monotonic: Callable[[], float] = time.monotonic,
                 sleeper: Callable[[float], None] = time.sleep):
        self.system, self.store, self.site, self.nginx, self.pid_file = system, store, site, nginx, pid_file
        self.exe_sha, self.original_sha, self.original_dump_sha = expected_nginx_exe_sha256, expected_original_sha256, expected_original_dump_sha256
        self.controller_identity, self.clock = dict(controller_identity), clock
        self.monotonic, self.sleeper = monotonic, sleeper

    def _identity(self) -> Mapping[str, Any]:
        guarded(
            sha256_file(Path(self.controller_identity["path"])) == self.controller_identity["sha256"]
            and sha256_file(Path(self.controller_identity["interpreter_path"])) == self.controller_identity["interpreter_sha256"],
            "controller_identity",
        )
        raw = secure_file(self.site, mode=None, expected_uid=self.store.expected_uid)
        process = process_identity(self.pid_file, self.nginx, self.exe_sha, self.store.expected_uid)
        dump = self.system.command([str(self.nginx), "-T"])
        return {"site_path": str(self.site), "site_sha256": sha256_bytes(raw),
                "nginx_dump_sha256": sha256_bytes(dump), "process": process,
                "controller": self.controller_identity}

    def _probe_active(self, *, operation_id: str, expires_ms: int, generation_id: str,
                      contract_sha: str, workers: Sequence[int]) -> None:
        fence = f"{operation_id}:{expires_ms}:{generation_id}"
        expected_workers = {str(item) for item in workers}
        guarded(bool(expected_workers), "https_probe")
        for path in ("/api/trpc", "/api/trpc/example", "/api/chat/media/upload"):
            for _ in range(3):
                status, headers = self.system.request("POST", path)
                guarded(status == 503 and headers.get(FENCE_HEADER) == fence
                        and headers.get(CONFIG_HEADER) == contract_sha
                        and headers.get(WORKER_HEADER) in expected_workers, "https_probe")
        status, headers = self.system.request("GET", "/api/trpc")
        guarded(headers.get(FENCE_HEADER) is None and headers.get(CONFIG_HEADER) is None
                and headers.get(WORKER_HEADER) is None, "https_probe")

    def _probe_released(self) -> None:
        _status, headers = self.system.request("POST", "/api/trpc")
        guarded(headers.get(FENCE_HEADER) is None and headers.get(CONFIG_HEADER) is None
                and headers.get(WORKER_HEADER) is None, "restore_probe")

    def _install(self, raw: bytes, info: os.stat_result) -> None:
        atomic_write(self.site, raw, mode=stat.S_IMODE(info.st_mode), uid=info.st_uid, gid=info.st_gid)
        self.system.command([str(self.nginx), "-t"])
        self.system.command([str(self.nginx), "-s", "reload"])

    def _wait_transition(
        self,
        predecessor: Mapping[str, Any],
        *,
        expected_site_sha256: str,
        expected_dump_sha256: str,
        stage: str,
    ) -> Mapping[str, Any]:
        predecessor_process = predecessor["process"]
        predecessor_workers = set(predecessor_process["worker_pids"])
        deadline = self.monotonic() + 10
        current = self._identity()
        while predecessor_workers.intersection(current["process"]["worker_pids"]) and self.monotonic() < deadline:
            self.sleeper(0.1)
            current = self._identity()
        guarded(
            current["site_sha256"] == expected_site_sha256
            and current["nginx_dump_sha256"] == expected_dump_sha256
            and current["process"]["pid"] == predecessor_process["pid"]
            and current["process"]["start_ticks"] == predecessor_process["start_ticks"]
            and not predecessor_workers.intersection(current["process"]["worker_pids"]),
            stage,
        )
        return current

    def activate(self, operation_id: str, generation_id: str, duration_seconds: int) -> Mapping[str, Any]:
        operation_id, generation_id = valid_uuid(operation_id), valid_uuid(generation_id, "generation_id")
        guarded(MIN_DURATION_SECONDS <= duration_seconds <= MAX_DURATION_SECONDS, "duration")
        with self.store.locked():
            now = self.clock()
            expires = (now // 1000 + duration_seconds) * 1000
            guarded(expires > now, "duration")
            original = secure_file(self.site, mode=None, expected_uid=self.store.expected_uid)
            guarded(sha256_bytes(original) == valid_sha(self.original_sha, "config_identity"), "config_identity")
            before = self._identity()
            guarded(before["nginx_dump_sha256"] == valid_sha(self.original_dump_sha, "config_identity"), "config_identity")
            contract = contract_digest(operation_id=operation_id, expires_at_epoch_ms=expires,
                generation_id=generation_id, original_sha256=self.original_sha,
                controller_sha256=self.controller_identity["sha256"], nginx_exe_sha256=self.exe_sha)
            active = render_active_site(original, operation_id=operation_id, expires_at_epoch_ms=expires,
                                        generation_id=generation_id, contract_sha256=contract)
            active_sha = sha256_bytes(active)
            before_path, before_sha = self.store.write(operation_id, "before", original)
            intent = {"schema": SCHEMA, "kind": "intent", "operation_id": operation_id,
                      "generation_id": generation_id, "created_at_epoch_ms": now,
                      "expires_at_epoch_ms": expires, "contract_sha256": contract,
                      "before_path": str(before_path), "before_sha256": before_sha,
                      "active_site_sha256": active_sha, "identity_before": before}
            _intent_path, intent_sha = self.store.write(operation_id, "intent", canonical_bytes(intent))
            info = self.site.stat()
            mutation = False
            try:
                mutation = True
                self._install(active, info)
                after = self._identity()
                deadline = self.monotonic() + 10
                before_workers = set(before["process"]["worker_pids"])
                while before_workers.intersection(after["process"]["worker_pids"]) and self.monotonic() < deadline:
                    self.sleeper(0.1)
                    after = self._identity()
                guarded(after["site_sha256"] == active_sha and after["process"]["pid"] == before["process"]["pid"]
                        and after["process"]["start_ticks"] == before["process"]["start_ticks"]
                        and not before_workers.intersection(after["process"]["worker_pids"]), "activation_verify")
                self._probe_active(operation_id=operation_id, expires_ms=expires, generation_id=generation_id,
                                   contract_sha=contract, workers=after["process"]["worker_pids"])
                guarded(self.clock() < expires, "activation_expired")
                record = {"schema": SCHEMA, "kind": "activation", "operation_id": operation_id,
                          "generation_id": generation_id, "expires_at_epoch_ms": expires,
                          "contract_sha256": contract, "intent_sha256": intent_sha,
                          "before_sha256": before_sha, "active_site_sha256": active_sha,
                          "identity_before": before, "identity_after": after}
                path, digest = self.store.write(operation_id, "activation", canonical_bytes(record))
            except Exception as error:
                if mutation:
                    try:
                        current = secure_file(self.site, mode=None, expected_uid=self.store.expected_uid)
                        guarded(current == active, "restore_state_drift")
                        self._install(original, self.site.stat())
                        guarded(secure_file(self.site, mode=None, expected_uid=self.store.expected_uid) == original, "restore_verify")
                        self._probe_released()
                    except Exception as restore_error:
                        raise ControlError("activation_restore_ambiguous") from restore_error
                if isinstance(error, ControlError):
                    raise
                raise ControlError("activation") from error
            return {"schema": SCHEMA, "action": "activate", "active": True,
                    "operation_id": operation_id, "generation_id": generation_id,
                    "expires_at_epoch_ms": expires, "contract_sha256": contract,
                    "active_site_sha256": active_sha, "worker_pids": after["process"]["worker_pids"],
                    "activation_record": str(path), "activation_sha256": digest}

    def _activation(self, operation_id: str, digest: str) -> Mapping[str, Any]:
        value = self.store.read_json(valid_uuid(operation_id), "activation", digest)
        guarded(value.get("schema") == SCHEMA and value.get("kind") == "activation"
                and value.get("operation_id") == operation_id, "activation_record")
        return value

    def _release_intent(
        self,
        operation_id: str,
        activation: Mapping[str, Any],
        activation_digest: str,
        active_identity: Mapping[str, Any] | None,
    ) -> tuple[Mapping[str, Any], str]:
        path = self.store.path(operation_id, "release-intent")
        if not path.exists():
            guarded(active_identity == activation["identity_after"], "identity_drift")
            value = {
                "schema": SCHEMA,
                "kind": "release-intent",
                "operation_id": operation_id,
                "activation_sha256": activation_digest,
                "active_site_sha256": activation["active_site_sha256"],
                "original_site_sha256": self.original_sha,
                "attempt": 1,
                "created_at_epoch_ms": self.clock(),
                "active_identity": active_identity,
            }
            _path, digest = self.store.write(operation_id, "release-intent", canonical_bytes(value))
            return value, digest
        value, digest = self.store.read_owned_json(operation_id, "release-intent")
        guarded(
            value.get("schema") == SCHEMA
            and value.get("kind") == "release-intent"
            and value.get("operation_id") == operation_id
            and value.get("activation_sha256") == activation_digest
            and value.get("active_site_sha256") == activation["active_site_sha256"]
            and value.get("original_site_sha256") == self.original_sha
            and type(value.get("attempt")) is int
            and value["attempt"] >= 1
            and type(value.get("created_at_epoch_ms")) is int
            and isinstance(value.get("active_identity"), Mapping),
            "release_intent",
        )
        if active_identity is not None:
            predecessor = value["active_identity"]["process"]
            current = active_identity["process"]
            guarded(
                active_identity["site_sha256"] == activation["active_site_sha256"]
                and active_identity["nginx_dump_sha256"] == activation["identity_after"]["nginx_dump_sha256"]
                and current["pid"] == predecessor["pid"]
                and current["start_ticks"] == predecessor["start_ticks"],
                "release_intent",
            )
            self._probe_active(
                operation_id=operation_id,
                expires_ms=activation["expires_at_epoch_ms"],
                generation_id=activation["generation_id"],
                contract_sha=activation["contract_sha256"],
                workers=current["worker_pids"],
            )
            replacement = dict(value)
            replacement.update({
                "attempt": value["attempt"] + 1,
                "active_identity": active_identity,
            })
            digest = self.store.replace_json(operation_id, "release-intent", replacement, digest)
            value = replacement
        return value, digest

    def _release_record(
        self,
        operation_id: str,
        activation_digest: str,
        intent_digest: str,
    ) -> tuple[Mapping[str, Any], str] | None:
        path = self.store.path(operation_id, "release")
        if not path.exists():
            return None
        value, digest = self.store.read_owned_json(operation_id, "release")
        guarded(
            value.get("schema") == SCHEMA
            and value.get("kind") == "release"
            and value.get("operation_id") == operation_id
            and value.get("activation_sha256") == activation_digest
            and value.get("release_intent_sha256") == intent_digest
            and value.get("restored_site_sha256") == self.original_sha
            and isinstance(value.get("identity_after_release"), Mapping),
            "release_record",
        )
        return value, digest

    def status(self, operation_id: str, generation_id: str, digest: str) -> Mapping[str, Any]:
        with self.store.locked():
            value = self._activation(operation_id, digest)
            guarded(value.get("generation_id") == valid_uuid(generation_id, "generation_id"), "generation_id")
            identity = self._identity()
            guarded(identity == value["identity_after"], "identity_drift")
            self._probe_active(operation_id=operation_id, expires_ms=value["expires_at_epoch_ms"],
                generation_id=value["generation_id"], contract_sha=value["contract_sha256"],
                workers=value["identity_after"]["process"]["worker_pids"])
            active = self.clock() < value["expires_at_epoch_ms"]
            return {"schema": SCHEMA, "action": "status", "active": active,
                    "operation_id": operation_id, "generation_id": value["generation_id"],
                    "expires_at_epoch_ms": value["expires_at_epoch_ms"],
                    "contract_sha256": value["contract_sha256"],
                    "active_site_sha256": value["active_site_sha256"],
                    "worker_pids": value["identity_after"]["process"]["worker_pids"],
                    "activation_sha256": digest}

    def release(self, operation_id: str, generation_id: str, digest: str) -> Mapping[str, Any]:
        with self.store.locked():
            value = self._activation(operation_id, digest)
            guarded(value.get("generation_id") == valid_uuid(generation_id, "generation_id"), "generation_id")
            current_site = secure_file(self.site, mode=None, expected_uid=self.store.expected_uid)
            before = secure_file(self.store.path(operation_id, "before"), mode=0o600, expected_uid=self.store.expected_uid)
            guarded(sha256_bytes(before) == value["before_sha256"] == self.original_sha, "state_drift")
            active = render_active_site(
                before,
                operation_id=operation_id,
                expires_at_epoch_ms=value["expires_at_epoch_ms"],
                generation_id=value["generation_id"],
                contract_sha256=value["contract_sha256"],
            )
            guarded(sha256_bytes(active) == value["active_site_sha256"], "activation_record")
            current_identity = self._identity()
            if current_site == before:
                intent, intent_digest = self._release_intent(operation_id, value, digest, None)
            else:
                guarded(current_site == active, "state_drift")
                intent, intent_digest = self._release_intent(operation_id, value, digest, current_identity)
            existing = self._release_record(operation_id, digest, intent_digest)
            if existing is not None:
                record, release_sha = existing
                guarded(current_site == before and current_identity == record["identity_after_release"], "identity_drift")
                return {"schema": SCHEMA, "action": "release", "active": False,
                        "operation_id": operation_id, "activation_sha256": digest,
                        "release_record": str(self.store.path(operation_id, "release")),
                        "release_sha256": release_sha}
            mutation = current_site != before
            try:
                if mutation:
                    self._install(before, self.site.stat())
                released_identity = self._wait_transition(
                    intent["active_identity"],
                    expected_site_sha256=self.original_sha,
                    expected_dump_sha256=self.original_dump_sha,
                    stage="release_verify",
                )
                self._probe_released()
                record = {"schema": SCHEMA, "kind": "release", "operation_id": operation_id,
                          "activation_sha256": digest, "release_intent_sha256": intent_digest,
                          "released_at_epoch_ms": self.clock(),
                          "restored_site_sha256": self.original_sha,
                          "identity_after_release": released_identity}
                path, release_sha = self.store.write(operation_id, "release", canonical_bytes(record))
            except Exception as error:
                try:
                    current = secure_file(self.site, mode=None, expected_uid=self.store.expected_uid)
                    if current == before:
                        ungated = self._identity()
                        self._install(active, self.site.stat())
                        restored = self._wait_transition(
                            ungated,
                            expected_site_sha256=value["active_site_sha256"],
                            expected_dump_sha256=value["identity_after"]["nginx_dump_sha256"],
                            stage="restore_verify",
                        )
                    else:
                        guarded(current == active, "restore_state_drift")
                        restored = self._identity()
                        guarded(
                            restored["site_sha256"] == value["active_site_sha256"]
                            and restored["nginx_dump_sha256"] == value["identity_after"]["nginx_dump_sha256"],
                            "restore_verify",
                        )
                    self._probe_active(operation_id=operation_id, expires_ms=value["expires_at_epoch_ms"],
                        generation_id=value["generation_id"], contract_sha=value["contract_sha256"],
                        workers=restored["process"]["worker_pids"])
                    replacement = dict(intent)
                    replacement.update({"attempt": intent["attempt"] + 1, "active_identity": restored})
                    self.store.replace_json(operation_id, "release-intent", replacement, intent_digest)
                except Exception as restore_error:
                    raise ControlError("release_restore_ambiguous") from restore_error
                raise ControlError("release_failed") from error
            return {"schema": SCHEMA, "action": "release", "active": False,
                    "operation_id": operation_id, "activation_sha256": digest,
                    "release_record": str(path), "release_sha256": release_sha}


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    value.add_argument("action", choices=("activate", "status", "release"))
    value.add_argument("--operation-id", required=True)
    value.add_argument("--generation-id", required=True)
    value.add_argument("--duration-seconds", type=int, default=600)
    value.add_argument("--activation-sha256")
    value.add_argument("--site", type=Path, required=True)
    value.add_argument("--expected-original-sha256", required=True)
    value.add_argument("--expected-original-dump-sha256", required=True)
    value.add_argument("--nginx", type=Path, default=Path("/usr/sbin/nginx"))
    value.add_argument("--expected-nginx-exe-sha256", required=True)
    value.add_argument("--pid-file", type=Path, default=Path("/run/nginx.pid"))
    value.add_argument("--evidence-dir", type=Path, required=True)
    value.add_argument("--probe-address", default=SERVER_NAME)
    return value


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        guarded(os.geteuid() == 0, "root_required")
        controller_path = Path(__file__).resolve(strict=True)
        interpreter_path = Path(sys.executable).resolve(strict=True)
        controller_identity = {"path": str(controller_path), "sha256": sha256_file(controller_path),
                               "interpreter_path": str(interpreter_path), "interpreter_sha256": sha256_file(interpreter_path)}
        controller = Controller(LocalSystem(args.nginx, address=args.probe_address), RecordStore(args.evidence_dir),
            site=args.site, nginx=args.nginx, pid_file=args.pid_file,
            expected_nginx_exe_sha256=valid_sha(args.expected_nginx_exe_sha256, "arguments"),
            expected_original_sha256=valid_sha(args.expected_original_sha256, "arguments"),
            expected_original_dump_sha256=valid_sha(args.expected_original_dump_sha256, "arguments"),
            controller_identity=controller_identity)
        if args.action == "activate":
            guarded(args.activation_sha256 is None, "arguments")
            result = controller.activate(args.operation_id, args.generation_id, args.duration_seconds)
        else:
            guarded(args.activation_sha256 is not None, "arguments")
            result = controller.status(args.operation_id, args.generation_id, args.activation_sha256) if args.action == "status" else controller.release(args.operation_id, args.generation_id, args.activation_sha256)
        sys.stdout.buffer.write(canonical_bytes(result))
        return 0
    except ControlError as error:
        sys.stderr.write(json.dumps({"schema": SCHEMA, "ok": False, "stage": error.stage}, separators=(",", ":")) + "\n")
        return 2
    except (OSError, UnicodeError, ValueError, json.JSONDecodeError):
        sys.stderr.write(json.dumps({"schema": SCHEMA, "ok": False, "stage": "controller_failure"}, separators=(",", ":")) + "\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
