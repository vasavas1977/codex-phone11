#!/usr/bin/env python3
"""Bounded controller for the Phone11 initial-INVITE maintenance gate.

This program is a source prerequisite. It must be installed and pinned by a
separate host commissioning step before it can supply operational evidence.
"""

from __future__ import annotations

import argparse
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import secrets
import select
import stat
import sys
import time
from typing import Any, Callable, Mapping, Protocol
import uuid


SCHEMA = "phone11-kamailio-invite-maintenance/v1"
TABLE = "phone11_maintenance"
KEY = "initial_invite_expires_at"
MIN_DURATION_SECONDS = 180
MAX_DURATION_SECONDS = 1800
SERVER_LOCK_PATH = Path("/run/lock/phone11-kamailio-maintenance-controller.lock")
CONFIG_TABLE = 'modparam("htable", "htable", "phone11_maintenance=>size=3;autoexpire=1800;")'
GATE_BEGIN = "# PHONE11_INITIAL_INVITE_MAINTENANCE_GATE_BEGIN"
GATE_END = "# PHONE11_INITIAL_INVITE_MAINTENANCE_GATE_END"


class ControlError(RuntimeError):
    def __init__(self, stage: str):
        super().__init__(stage)
        self.stage = stage


class RpcFault(ControlError):
    def __init__(self, code: int, message: str):
        super().__init__("rpc_fault")
        self.code = code
        self.message = message


class Rpc(Protocol):
    def call(self, method: str, params: list[Any]) -> Any: ...


def guarded(condition: bool, stage: str) -> None:
    if not condition:
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


def validate_operation_id(value: str) -> str:
    try:
        parsed = uuid.UUID(value)
    except ValueError as error:
        raise ControlError("operation_id") from error
    guarded(str(parsed) == value.lower() and parsed.version == 4, "operation_id")
    return str(parsed)


def validate_sha256(value: str, stage: str) -> str:
    guarded(len(value) == 64 and all(char in "0123456789abcdef" for char in value), stage)
    return value


def validate_config(path: Path, expected_sha256: str) -> dict[str, Any]:
    guarded(path.is_absolute() and path.is_file() and not path.is_symlink(), "config_identity")
    raw = path.read_bytes()
    guarded(sha256_bytes(raw) == validate_sha256(expected_sha256, "config_identity"), "config_identity")
    text = raw.decode("utf-8")
    guarded(text.count(CONFIG_TABLE) == 1, "config_contract")
    guarded(text.count(GATE_BEGIN) == 1 and text.count(GATE_END) == 1, "config_contract")
    begin = text.index(GATE_BEGIN)
    end = text.index(GATE_END)
    gate = text[begin:end]
    guarded(
        'is_method("INVITE") && !has_totag()' in gate
        and "$(sht(phone11_maintenance=>initial_invite_expires_at){s.select,0,:}{s.int}) > $Ts" in gate
        and 'sl_send_reply("503", "Temporarily Unavailable")' in gate,
        "config_contract",
    )
    dialog = text.index("# Handle mid-dialog requests")
    cancel = text.index("# CANCEL processing")
    invite = text.index("# Handle INVITE", end)
    guarded(dialog < cancel < begin < end < invite, "config_contract")
    return {"path": str(path), "sha256": expected_sha256}


def process_identity(pid: int, expected_exe_sha256: str, config_path: Path) -> dict[str, Any]:
    guarded(sys.platform.startswith("linux") and pid > 0, "process_identity")
    proc = Path("/proc") / str(pid)
    guarded(proc.is_dir(), "process_identity")
    try:
        stat_fields = (proc / "stat").read_text().split()
        exe = (proc / "exe").resolve(strict=True)
        status = (proc / "status").read_text().splitlines()
        cmdline_raw = (proc / "cmdline").read_bytes()
    except (OSError, UnicodeError) as error:
        raise ControlError("process_identity") from error
    guarded(len(stat_fields) > 21, "process_identity")
    uid_line = next((line for line in status if line.startswith("Uid:")), "")
    gid_line = next((line for line in status if line.startswith("Gid:")), "")
    guarded(bool(uid_line) and bool(gid_line), "process_identity")
    argv = [part.decode("utf-8") for part in cmdline_raw.split(b"\0") if part]
    config_indexes = [index for index, item in enumerate(argv) if item == "-f"]
    guarded(len(config_indexes) == 1 and config_indexes[0] + 1 < len(argv), "process_config")
    configured_path = Path(argv[config_indexes[0] + 1])
    guarded(
        configured_path.is_absolute()
        and configured_path.resolve(strict=True) == config_path.resolve(strict=True),
        "process_config",
    )
    actual_sha256 = sha256_file(exe)
    guarded(actual_sha256 == validate_sha256(expected_exe_sha256, "process_identity"), "process_identity")
    return {
        "pid": pid,
        "start_ticks": int(stat_fields[21]),
        "uid": int(uid_line.split()[1]),
        "gid": int(gid_line.split()[1]),
        "exe_path": str(exe),
        "exe_sha256": actual_sha256,
        "cmdline_sha256": sha256_bytes(cmdline_raw),
    }


def fifo_identity(path: Path, process: Mapping[str, Any]) -> dict[str, Any]:
    guarded(path.is_absolute() and not path.is_symlink(), "fifo_identity")
    try:
        value = path.stat()
    except OSError as error:
        raise ControlError("fifo_identity") from error
    guarded(stat.S_ISFIFO(value.st_mode), "fifo_identity")
    guarded(value.st_uid == process["uid"] and value.st_gid == process["gid"], "fifo_identity")
    guarded(value.st_mode & 0o007 == 0, "fifo_identity")
    return {
        "path": str(path),
        "device": value.st_dev,
        "inode": value.st_ino,
        "uid": value.st_uid,
        "gid": value.st_gid,
        "mode": stat.S_IMODE(value.st_mode),
    }


class FifoRpc:
    def __init__(
        self,
        fifo: Path,
        reply_dir: Path,
        process_uid: int,
        process_gid: int,
        timeout_seconds: float,
    ) -> None:
        self.fifo = fifo
        self.reply_dir = reply_dir
        self.process_uid = process_uid
        self.process_gid = process_gid
        self.timeout_seconds = timeout_seconds

    def call(self, method: str, params: list[Any]) -> Any:
        guarded(
            self.reply_dir.is_absolute() and self.reply_dir.is_dir() and not self.reply_dir.is_symlink(),
            "reply_dir",
        )
        directory = self.reply_dir.stat()
        guarded(directory.st_uid == self.process_uid and directory.st_mode & 0o002 == 0, "reply_dir")
        reply_name = f"phone11-maint-{os.getpid()}-{secrets.token_hex(12)}.fifo"
        reply_path = self.reply_dir / reply_name
        request_id = secrets.randbits(31)
        request = canonical_bytes({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
            "reply_name": reply_name,
            "id": request_id,
        })
        deadline = time.monotonic() + self.timeout_seconds
        read_fd: int | None = None
        try:
            os.mkfifo(reply_path, 0o600)
            os.chown(reply_path, self.process_uid, self.process_gid)
            read_fd = os.open(reply_path, os.O_RDONLY | os.O_NONBLOCK | os.O_CLOEXEC)
            try:
                write_fd = os.open(self.fifo, os.O_WRONLY | os.O_NONBLOCK | os.O_CLOEXEC)
            except OSError as error:
                raise ControlError("rpc_unavailable") from error
            try:
                offset = 0
                while offset < len(request):
                    written = os.write(write_fd, request[offset:])
                    guarded(written > 0, "rpc_unavailable")
                    offset += written
            finally:
                os.close(write_fd)

            response = b""
            while time.monotonic() < deadline:
                ready, _, _ = select.select([read_fd], [], [], min(0.05, max(0.0, deadline - time.monotonic())))
                if not ready:
                    continue
                chunk = os.read(read_fd, 65536)
                if chunk:
                    response += chunk
                    guarded(len(response) <= 1024 * 1024, "rpc_response")
                    try:
                        value = json.loads(response)
                    except json.JSONDecodeError:
                        continue
                    return self._result(value, request_id)
            raise ControlError("rpc_timeout")
        finally:
            if read_fd is not None:
                os.close(read_fd)
            with contextlib.suppress(FileNotFoundError):
                reply_path.unlink()

    @staticmethod
    def _result(value: Any, request_id: int) -> Any:
        guarded(
            isinstance(value, dict) and value.get("jsonrpc") == "2.0" and value.get("id") == request_id,
            "rpc_response",
        )
        if "error" in value:
            error = value["error"]
            guarded(
                isinstance(error, dict)
                and type(error.get("code")) is int
                and isinstance(error.get("message"), str),
                "rpc_response",
            )
            raise RpcFault(error["code"], error["message"])
        guarded("result" in value, "rpc_response")
        return value["result"]


class RecordStore:
    def __init__(
        self,
        directory: Path,
        expected_uid: int = 0,
        lock_path: Path | None = None,
    ) -> None:
        self.directory = directory
        self.lock_path = lock_path or (directory / "controller.lock")
        self.expected_uid = expected_uid
        guarded(directory.is_absolute() and directory.is_dir() and not directory.is_symlink(), "evidence_dir")
        identity = directory.stat()
        guarded(identity.st_uid == expected_uid and stat.S_IMODE(identity.st_mode) == 0o700, "evidence_dir")
        guarded(self.lock_path.is_absolute() and not self.lock_path.is_symlink(), "controller_lock")

    def path(self, operation_id: str, kind: str) -> Path:
        guarded(kind in {"activation", "release"}, "record_kind")
        return self.directory / f"{operation_id}.{kind}.json"

    def write(self, operation_id: str, kind: str, value: Mapping[str, Any]) -> tuple[Path, str]:
        raw = canonical_bytes(value)
        final = self.path(operation_id, kind)
        temporary = self.directory / f".{operation_id}.{kind}.{secrets.token_hex(12)}.tmp"
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC, 0o600)
        linked = False
        try:
            with os.fdopen(fd, "wb", closefd=True) as output:
                output.write(raw)
                output.flush()
                os.fsync(output.fileno())
            os.link(temporary, final, follow_symlinks=False)
            linked = True
            self._fsync_directory()
        except Exception as error:
            with contextlib.suppress(FileNotFoundError):
                temporary.unlink()
            if linked:
                try:
                    final.unlink()
                    self._fsync_directory()
                except OSError as cleanup_error:
                    raise ControlError("evidence_record_ambiguous") from cleanup_error
            raise error
        temporary.unlink()
        return final, sha256_bytes(raw)

    def _fsync_directory(self) -> None:
        directory_fd = os.open(self.directory, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)

    def read(self, operation_id: str, kind: str, expected_sha256: str) -> Mapping[str, Any]:
        path = self.path(operation_id, kind)
        guarded(path.is_file() and not path.is_symlink(), "activation_record")
        identity = path.stat()
        guarded(identity.st_nlink == 1 and stat.S_IMODE(identity.st_mode) == 0o600, "activation_record")
        raw = path.read_bytes()
        guarded(sha256_bytes(raw) == validate_sha256(expected_sha256, "activation_record"), "activation_record")
        try:
            value = json.loads(raw)
        except json.JSONDecodeError as error:
            raise ControlError("activation_record") from error
        guarded(isinstance(value, dict) and canonical_bytes(value) == raw, "activation_record")
        return value

    @contextlib.contextmanager
    def locked(self):
        fd = os.open(self.lock_path, os.O_RDWR | os.O_CREAT | os.O_CLOEXEC | os.O_NOFOLLOW, 0o600)
        try:
            identity = os.fstat(fd)
            guarded(
                stat.S_ISREG(identity.st_mode)
                and identity.st_uid == self.expected_uid
                and identity.st_nlink == 1
                and stat.S_IMODE(identity.st_mode) == 0o600,
                "controller_lock",
            )
            fcntl.flock(fd, fcntl.LOCK_EX)
            yield
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
            os.close(fd)


def get_value(rpc: Rpc) -> str | None:
    try:
        result = rpc.call("htable.get", [TABLE, KEY])
    except RpcFault as error:
        if "doesn't exist" in error.message or "not found" in error.message.lower():
            return None
        raise

    def find_item(value: Any) -> Mapping[str, Any] | None:
        if isinstance(value, dict):
            item = value.get("item")
            if isinstance(item, dict):
                return item
            for nested in value.values():
                found = find_item(nested)
                if found is not None:
                    return found
        if isinstance(value, list):
            for nested in value:
                found = find_item(nested)
                if found is not None:
                    return found
        return None

    item = find_item(result)
    guarded(item is not None and item.get("name") == KEY and isinstance(item.get("value"), str), "rpc_state")
    value = str(item["value"])
    parts = value.split(":")
    guarded(len(parts) == 2 and parts[0].isdigit(), "rpc_state")
    validate_operation_id(parts[1])
    return value


def state_expiry(value: str) -> int:
    return int(value.split(":", 1)[0])


def delete_value(rpc: Rpc) -> None:
    try:
        rpc.call("htable.delete", [TABLE, KEY])
    except RpcFault as error:
        if "not found" not in error.message.lower() and "doesn't exist" not in error.message:
            raise


def restore_expected(rpc: Rpc, expected: str) -> None:
    current = get_value(rpc)
    if current is None:
        return
    guarded(current == expected, "restore_state_drift")
    delete_value(rpc)
    guarded(get_value(rpc) is None, "restore_verify")


class Controller:
    def __init__(
        self,
        rpc: Rpc,
        store: RecordStore,
        identity: Callable[[], Mapping[str, Any]],
        clock: Callable[[], int] = lambda: int(time.time()),
    ) -> None:
        self.rpc = rpc
        self.store = store
        self.identity = identity
        self.clock = clock

    def activate(self, operation_id: str, duration_seconds: int) -> Mapping[str, Any]:
        operation_id = validate_operation_id(operation_id)
        guarded(MIN_DURATION_SECONDS <= duration_seconds <= MAX_DURATION_SECONDS, "duration")
        with self.store.locked():
            now = self.clock()
            current = get_value(self.rpc)
            guarded(current is None or state_expiry(current) <= now, "already_active")
            if current is not None:
                restore_expected(self.rpc, current)
            before = dict(self.identity())
            expires = now + duration_seconds
            state_value = f"{expires}:{operation_id}"
            mutation_started = False
            try:
                mutation_started = True
                self.rpc.call("htable.setxs", [TABLE, KEY, state_value, duration_seconds])
                guarded(get_value(self.rpc) == state_value, "activation_verify")
                guarded(dict(self.identity()) == before, "identity_drift")
                verified_at = self.clock()
                guarded(verified_at < expires, "activation_expired")
                created_ms = verified_at * 1000
                record = {
                    "schema": SCHEMA,
                    "kind": "activation",
                    "operation_id": operation_id,
                    "created_at_epoch_ms": created_ms,
                    "expires_at_epoch_ms": expires * 1000,
                    "duration_seconds": duration_seconds,
                    "identity": before,
                    "state": {
                        "table": TABLE,
                        "key": KEY,
                        "value": state_value,
                        "ttl_seconds": duration_seconds,
                    },
                    "restore_state": {"present": False},
                }
                path, digest = self.store.write(operation_id, "activation", record)
            except Exception as error:
                if mutation_started:
                    try:
                        restore_expected(self.rpc, state_value)
                    except Exception as restore_error:
                        raise ControlError("activation_restore_ambiguous") from restore_error
                if isinstance(error, ControlError):
                    raise
                raise ControlError("activation") from error
            return {
                "schema": SCHEMA,
                "action": "activate",
                "active": True,
                "operation_id": operation_id,
                "expires_at_epoch_ms": expires * 1000,
                "activation_record": str(path),
                "activation_sha256": digest,
            }

    def _activation(self, operation_id: str, digest: str) -> Mapping[str, Any]:
        operation_id = validate_operation_id(operation_id)
        value = self.store.read(operation_id, "activation", digest)
        guarded(
            value.get("schema") == SCHEMA
            and value.get("kind") == "activation"
            and value.get("operation_id") == operation_id,
            "activation_record",
        )
        state = value.get("state")
        expires_ms = value.get("expires_at_epoch_ms")
        guarded(type(expires_ms) is int and expires_ms % 1000 == 0, "activation_record")
        guarded(
            isinstance(state, dict)
            and state.get("table") == TABLE
            and state.get("key") == KEY
            and state.get("value") == f"{expires_ms // 1000}:{operation_id}",
            "activation_record",
        )
        return value

    def status(self, operation_id: str, digest: str) -> Mapping[str, Any]:
        with self.store.locked():
            activation = self._activation(operation_id, digest)
            guarded(dict(self.identity()) == activation["identity"], "identity_drift")
            current = get_value(self.rpc)
            expires_ms = activation["expires_at_epoch_ms"]
            active = current == activation["state"]["value"] and self.clock() * 1000 < expires_ms
            return {
                "schema": SCHEMA,
                "action": "status",
                "active": active,
                "operation_id": operation_id,
                "expires_at_epoch_ms": expires_ms,
                "activation_sha256": digest,
                "state_matches": current == activation["state"]["value"],
            }

    def release(self, operation_id: str, digest: str) -> Mapping[str, Any]:
        with self.store.locked():
            activation = self._activation(operation_id, digest)
            before = dict(self.identity())
            guarded(before == activation["identity"], "identity_drift")
            expected = activation["state"]["value"]
            current = get_value(self.rpc)
            guarded(current is None or current == expected, "state_drift")
            restore_expected(self.rpc, expected)
            guarded(dict(self.identity()) == before, "identity_drift")
            released_at = self.clock() * 1000
            record = {
                "schema": SCHEMA,
                "kind": "release",
                "operation_id": operation_id,
                "released_at_epoch_ms": released_at,
                "activation_sha256": digest,
                "was_active": current == expected and released_at < activation["expires_at_epoch_ms"],
                "identity": before,
                "restored_state": {"present": False},
            }
            path, release_digest = self.store.write(operation_id, "release", record)
            return {
                "schema": SCHEMA,
                "action": "release",
                "active": False,
                "operation_id": operation_id,
                "activation_sha256": digest,
                "release_record": str(path),
                "release_sha256": release_digest,
            }


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    value.add_argument("action", choices=("activate", "status", "release"))
    value.add_argument("--operation-id", required=True)
    value.add_argument("--duration-seconds", type=int, default=600)
    value.add_argument("--activation-sha256")
    value.add_argument("--config", type=Path, required=True)
    value.add_argument("--expected-config-sha256", required=True)
    value.add_argument("--pid", type=int, required=True)
    value.add_argument("--expected-process-exe-sha256", required=True)
    value.add_argument("--fifo", type=Path, default=Path("/var/run/kamailio/kamailio_rpc.fifo"))
    value.add_argument("--reply-dir", type=Path, default=Path("/var/run/kamailio"))
    value.add_argument("--evidence-dir", type=Path, required=True)
    value.add_argument("--rpc-timeout-seconds", type=float, default=2.0)
    return value


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        guarded(os.geteuid() == 0, "root_required")
        operation_id = validate_operation_id(args.operation_id)
        config = validate_config(args.config, args.expected_config_sha256)
        process = process_identity(args.pid, args.expected_process_exe_sha256, args.config)
        fifo = fifo_identity(args.fifo, process)
        controller_path = Path(__file__).resolve(strict=True)
        interpreter_path = Path(sys.executable).resolve(strict=True)

        def identity() -> Mapping[str, Any]:
            current_config = validate_config(args.config, args.expected_config_sha256)
            current_process = process_identity(args.pid, args.expected_process_exe_sha256, args.config)
            current_fifo = fifo_identity(args.fifo, current_process)
            guarded(sha256_file(controller_path) == controller_sha256, "controller_identity")
            guarded(sha256_file(interpreter_path) == interpreter_sha256, "controller_identity")
            return {
                "config": current_config,
                "process": current_process,
                "fifo": current_fifo,
                "controller": {
                    "path": str(controller_path),
                    "sha256": controller_sha256,
                    "interpreter_path": str(interpreter_path),
                    "interpreter_sha256": interpreter_sha256,
                },
            }

        controller_sha256 = sha256_file(controller_path)
        interpreter_sha256 = sha256_file(interpreter_path)
        initial_identity = identity()
        guarded(
            initial_identity["config"] == config
            and initial_identity["process"] == process
            and initial_identity["fifo"] == fifo,
            "identity_drift",
        )
        rpc = FifoRpc(args.fifo, args.reply_dir, process["uid"], process["gid"], args.rpc_timeout_seconds)
        controller = Controller(
            rpc,
            RecordStore(args.evidence_dir, lock_path=SERVER_LOCK_PATH),
            identity,
        )
        if args.action == "activate":
            guarded(args.activation_sha256 is None, "arguments")
            result = controller.activate(operation_id, args.duration_seconds)
        else:
            guarded(args.activation_sha256 is not None, "arguments")
            digest = validate_sha256(args.activation_sha256, "arguments")
            result = (
                controller.status(operation_id, digest)
                if args.action == "status"
                else controller.release(operation_id, digest)
            )
        sys.stdout.buffer.write(canonical_bytes(result))
        return 0
    except ControlError as error:
        sys.stderr.write(
            json.dumps({"schema": SCHEMA, "ok": False, "stage": error.stage}, separators=(",", ":"))
            + "\n"
        )
        return 2
    except (OSError, ValueError, UnicodeError, json.JSONDecodeError):
        sys.stderr.write(
            json.dumps(
                {"schema": SCHEMA, "ok": False, "stage": "controller_failure"},
                separators=(",", ":"),
            )
            + "\n"
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
