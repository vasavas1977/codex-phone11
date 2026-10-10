#!/usr/bin/env python3
"""Aggregate Phone11 profile/DND admission fence and drain guard.

The public edge gate is activated separately through the existing temporary
operator-to-host access path. This program freshly verifies its HTTPS serving
generation, owns the local SIP gate, and returns the bounded JSON contract
consumed by phone11-profile-dnd-rollout.py. It never provisions transport or
changes the public edge.
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
import time
from typing import Any, Callable, Mapping, Sequence
import uuid


SCHEMA = "phone11-profile-dnd-guard/v1"
PLAN_SCHEMA = "phone11-profile-dnd-guard-plan/v1"
SNAPSHOT_SCHEMA = "phone11-profile-dnd-snapshot/v1"
RECORD_SCHEMA = "phone11-profile-dnd-aggregate-record/v1"
PLAN_PATH = Path("/etc/phone11/profile-dnd-guard-plan.json")
LOCK_PATH = Path("/run/lock/phone11-profile-dnd-guard.lock")
ACTIVATING_PHASES = {"replace-baseline-before", "rollback-baseline-disabled-before"}
COVERAGE = {
    "freeswitch_channels", "kamailio_dialogs", "relay_calls",
    "sip_transactions_active", "active_conference_jobs",
    "active_recording_jobs", "active_media_jobs", "active_worker_jobs",
}
FENCE_COVERAGE = {
    "sip_invite_admission", "conference_job_admission", "media_job_admission",
    "recording_job_admission", "worker_job_admission", "notification_dispatch_admission",
}
SNAPSHOT_KEYS = COVERAGE | {
    "schema", "sampled_at_epoch_ms", "attempted_notifications",
    "new_attempted_notifications", "failed_notifications", "pending_notifications",
    "wake_ready", "notifications_ready",
}
OUTPUT_KEYS = SNAPSHOT_KEYS | {
    "coverage", "admission_fence_id", "admission_fence_active",
    "admission_fence_expires_at_epoch_ms", "admission_fence_coverage",
    "admission_fence_evidence_sha256", "idle",
}


class GuardError(RuntimeError):
    def __init__(self, stage: str):
        super().__init__(stage)
        self.stage = stage


def guarded(value: bool, stage: str) -> None:
    if not value:
        raise GuardError(stage)


def canonical_bytes(value: Mapping[str, Any]) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def valid_sha(value: Any, stage: str = "plan") -> str:
    guarded(isinstance(value, str) and bool(re.fullmatch(r"[0-9a-f]{64}", value)), stage)
    return value


def valid_uuid(value: Any, stage: str = "plan") -> str:
    guarded(isinstance(value, str), stage)
    try:
        parsed = uuid.UUID(value)
    except ValueError as error:
        raise GuardError(stage) from error
    guarded(parsed.version == 4 and str(parsed) == value.lower(), stage)
    return str(parsed)


def edge_contract_digest(edge: Mapping[str, Any]) -> str:
    return sha256_bytes(canonical_bytes({
        "schema": "phone11-edge-maintenance/v1", "kind": "edge-contract",
        "operation_id": edge["operation_id"],
        "expires_at_epoch_ms": edge["expires_at_epoch_ms"],
        "generation_id": edge["generation_id"],
        "original_site_sha256": edge["original_site_sha256"],
        "controller_sha256": edge["controller_sha256"],
        "nginx_exe_sha256": edge["nginx_exe_sha256"],
    }))


def exact_keys(value: Mapping[str, Any], keys: set[str], stage: str) -> None:
    guarded(set(value) == keys, stage)


def secure_read(path: Path, *, mode: int | None = 0o600, expected_uid: int = 0) -> bytes:
    guarded(path.is_absolute() and not path.is_symlink(), "file_identity")
    before = path.stat()
    guarded(stat.S_ISREG(before.st_mode) and before.st_uid == expected_uid and before.st_nlink == 1
            and before.st_size <= 2 * 1024 * 1024, "file_identity")
    if mode is not None:
        guarded(stat.S_IMODE(before.st_mode) == mode, "file_identity")
    fd = os.open(path, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW)
    try:
        opened = os.fstat(fd)
        guarded((opened.st_dev, opened.st_ino, opened.st_size) ==
                (before.st_dev, before.st_ino, before.st_size), "file_identity")
        raw = b""
        while len(raw) <= 2 * 1024 * 1024:
            block = os.read(fd, 65536)
            if not block:
                break
            raw += block
        guarded(len(raw) == before.st_size, "file_identity")
        return raw
    finally:
        os.close(fd)


def strict_json(raw: bytes, stage: str) -> Mapping[str, Any]:
    def unique(pairs: Sequence[tuple[str, Any]]) -> Mapping[str, Any]:
        value: dict[str, Any] = {}
        for key, item in pairs:
            guarded(key not in value, stage)
            value[key] = item
        return value
    try:
        value = json.loads(raw, object_pairs_hook=unique)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise GuardError(stage) from error
    guarded(isinstance(value, Mapping), stage)
    return value


class Runner:
    def json_command(self, args: Sequence[str], timeout: int = 10) -> Mapping[str, Any]:
        try:
            result = subprocess.run(list(args), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                    stderr=subprocess.DEVNULL, timeout=timeout, check=False)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise GuardError("dependency") from error
        guarded(result.returncode == 0 and len(result.stdout) <= 1024 * 1024, "dependency")
        return strict_json(result.stdout, "dependency")


def pinned_program(path: Path, digest: str, expected_uid: int = 0) -> None:
    raw = secure_read(path, mode=0o700, expected_uid=expected_uid)
    guarded(sha256_bytes(raw) == valid_sha(digest), "program_identity")


def parse_plan(raw: bytes) -> Mapping[str, Any]:
    plan = strict_json(raw, "plan")
    exact_keys(plan, {"schema", "fence_id", "expires_at_epoch_ms", "edge", "sip",
                      "snapshot", "stability_seconds", "evidence_dir"}, "plan")
    guarded(plan.get("schema") == PLAN_SCHEMA, "plan")
    fence_id = valid_uuid(plan.get("fence_id"))
    guarded(type(plan.get("expires_at_epoch_ms")) is int and plan["expires_at_epoch_ms"] % 1000 == 0, "plan")
    guarded(plan.get("stability_seconds") == 15, "plan")
    guarded(isinstance(plan.get("edge"), Mapping) and isinstance(plan.get("sip"), Mapping)
            and isinstance(plan.get("snapshot"), Mapping), "plan")
    edge, sip, snapshot = plan["edge"], plan["sip"], plan["snapshot"]
    exact_keys(edge, {"origin", "operation_id", "generation_id", "expires_at_epoch_ms",
                      "contract_sha256", "active_site_sha256", "activation_sha256",
                      "controller_sha256", "original_site_sha256", "nginx_exe_sha256",
                      "worker_pids"}, "plan")
    guarded(edge.get("origin") == "https://api.phone11.ai" and edge.get("operation_id") == fence_id
            and edge.get("expires_at_epoch_ms") == plan["expires_at_epoch_ms"], "plan")
    valid_uuid(edge.get("generation_id"))
    for key in ("contract_sha256", "active_site_sha256", "activation_sha256", "controller_sha256",
                "original_site_sha256", "nginx_exe_sha256"):
        valid_sha(edge.get(key))
    guarded(edge_contract_digest(edge) == edge["contract_sha256"], "plan")
    workers = edge.get("worker_pids")
    guarded(isinstance(workers, list) and 1 <= len(workers) <= 64 and len(set(workers)) == len(workers)
            and all(type(item) is int and item > 1 for item in workers), "plan")
    exact_keys(sip, {"program", "sha256", "config", "config_sha256", "pid", "process_exe_sha256",
                     "fifo", "reply_dir", "evidence_dir"}, "plan")
    exact_keys(snapshot, {"program", "sha256"}, "plan")
    for section in (sip, snapshot):
        guarded(isinstance(section.get("program"), str) and section["program"].startswith("/"), "plan")
        valid_sha(section.get("sha256"))
    guarded(isinstance(sip.get("config"), str) and sip["config"].startswith("/")
            and isinstance(sip.get("fifo"), str) and sip["fifo"].startswith("/")
            and isinstance(sip.get("reply_dir"), str) and sip["reply_dir"].startswith("/")
            and isinstance(sip.get("evidence_dir"), str) and sip["evidence_dir"].startswith("/")
            and type(sip.get("pid")) is int and sip["pid"] > 0, "plan")
    valid_sha(sip.get("config_sha256")); valid_sha(sip.get("process_exe_sha256"))
    guarded(isinstance(plan.get("evidence_dir"), str) and plan["evidence_dir"].startswith("/"), "plan")
    return plan


class HttpsProof:
    def __init__(self, address: str = "api.phone11.ai", requester: Callable[[str, str], tuple[int, Mapping[str, str]]] | None = None):
        self.address, self.requester = address, requester

    def request(self, method: str, path: str) -> tuple[int, Mapping[str, str]]:
        if self.requester is not None:
            return self.requester(method, path)
        context = ssl.create_default_context()
        raw_socket = None
        try:
            raw_socket = socket.create_connection((self.address, 443), timeout=4)
            with context.wrap_socket(raw_socket, server_hostname="api.phone11.ai") as connection:
                connection.sendall((f"{method} {path} HTTP/1.1\r\nHost: api.phone11.ai\r\n"
                                    "Connection: close\r\nContent-Length: 0\r\n\r\n").encode("ascii"))
                response = http.client.HTTPResponse(connection); response.begin(); response.read(4096)
                return response.status, {key.lower(): value for key, value in response.getheaders()}
        except (OSError, ssl.SSLError, http.client.HTTPException) as error:
            raise GuardError("edge_https") from error
        finally:
            if raw_socket is not None:
                raw_socket.close()

    def verify(self, edge: Mapping[str, Any]) -> None:
        fence = f'{edge["operation_id"]}:{edge["expires_at_epoch_ms"]}:{edge["generation_id"]}'
        workers = {str(item) for item in edge["worker_pids"]}
        for path in ("/api/trpc", "/api/trpc/guard", "/api/chat/media/upload"):
            for _ in range(3):
                status, headers = self.request("POST", path)
                guarded(status == 503 and headers.get("x-phone11-maintenance-fence") == fence
                        and headers.get("x-phone11-maintenance-config") == edge["contract_sha256"]
                        and headers.get("x-phone11-maintenance-worker") in workers, "edge_https")
        _status, headers = self.request("GET", "/api/trpc")
        guarded(all(headers.get(name) is None for name in ("x-phone11-maintenance-fence",
                "x-phone11-maintenance-config", "x-phone11-maintenance-worker")), "edge_https")


class RecordStore:
    def __init__(self, directory: Path, lock_path: Path = LOCK_PATH, expected_uid: int = 0):
        self.directory, self.lock_path, self.expected_uid = directory, lock_path, expected_uid
        guarded(directory.is_absolute() and directory.is_dir() and not directory.is_symlink(), "evidence_dir")
        info = directory.stat()
        guarded(info.st_uid == expected_uid and stat.S_IMODE(info.st_mode) == 0o700, "evidence_dir")

    def path(self, operation_id: str, kind: str) -> Path:
        guarded(kind in {"activation", "ready", "release-intent", "release"}, "record")
        return self.directory / f"{operation_id}.aggregate-{kind}.json"

    def write(self, operation_id: str, kind: str, value: Mapping[str, Any]) -> tuple[Path, str]:
        raw, path = canonical_bytes(value), self.path(operation_id, kind)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC | os.O_NOFOLLOW, 0o600)
        try:
            with os.fdopen(fd, "wb") as output:
                output.write(raw); output.flush(); os.fsync(output.fileno())
            dfd = os.open(self.directory, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
            try: os.fsync(dfd)
            finally: os.close(dfd)
        except Exception:
            with contextlib.suppress(FileNotFoundError): path.unlink()
            raise
        return path, sha256_bytes(raw)

    def read(self, operation_id: str, kind: str) -> tuple[Mapping[str, Any], str]:
        raw = secure_read(self.path(operation_id, kind), mode=0o600, expected_uid=self.expected_uid)
        value = strict_json(raw, "record")
        return value, sha256_bytes(raw)

    @contextlib.contextmanager
    def locked(self):
        fd = os.open(self.lock_path, os.O_RDWR | os.O_CREAT | os.O_CLOEXEC | os.O_NOFOLLOW, 0o600)
        try:
            info = os.fstat(fd)
            guarded(stat.S_ISREG(info.st_mode) and info.st_uid == self.expected_uid and info.st_nlink == 1
                    and stat.S_IMODE(info.st_mode) == 0o600, "controller_lock")
            fcntl.flock(fd, fcntl.LOCK_EX); yield
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN); os.close(fd)


class GuardController:
    def __init__(self, plan: Mapping[str, Any], plan_sha: str, runner: Runner, edge: HttpsProof,
                 store: RecordStore, clock: Callable[[], int] = lambda: int(time.time() * 1000),
                 sleeper: Callable[[float], None] = time.sleep):
        self.plan, self.plan_sha, self.runner, self.edge, self.store = plan, plan_sha, runner, edge, store
        self.clock, self.sleeper = clock, sleeper

    def programs(self) -> None:
        pinned_program(Path(self.plan["sip"]["program"]), self.plan["sip"]["sha256"], self.store.expected_uid)
        pinned_program(Path(self.plan["snapshot"]["program"]), self.plan["snapshot"]["sha256"], self.store.expected_uid)

    def snapshot(self, since_ms: int | None) -> Mapping[str, Any]:
        command = [self.plan["snapshot"]["program"]]
        if since_ms is not None:
            guarded(type(since_ms) is int and since_ms > 0, "snapshot")
            command += ["--since-epoch-ms", str(since_ms)]
        value = self.runner.json_command(command, timeout=8)
        exact_keys(value, SNAPSHOT_KEYS, "snapshot")
        guarded(value.get("schema") == SNAPSHOT_SCHEMA, "snapshot")
        sampled, now = value.get("sampled_at_epoch_ms"), self.clock()
        guarded(type(sampled) is int and now - 30_000 <= sampled <= now + 5_000, "snapshot")
        for key in COVERAGE | {"attempted_notifications", "new_attempted_notifications",
                               "failed_notifications", "pending_notifications"}:
            guarded(type(value.get(key)) is int and value[key] >= 0, "snapshot")
        guarded(type(value.get("wake_ready")) is bool and type(value.get("notifications_ready")) is bool, "snapshot")
        return value

    def _sip_command(self, action: str, activation_sha: str | None = None) -> list[str]:
        sip = self.plan["sip"]
        command = [sip["program"], action, "--operation-id", self.plan["fence_id"],
            "--config", sip["config"], "--expected-config-sha256", sip["config_sha256"],
            "--pid", str(sip["pid"]), "--expected-process-exe-sha256", sip["process_exe_sha256"],
            "--fifo", sip["fifo"], "--reply-dir", sip["reply_dir"], "--evidence-dir", sip["evidence_dir"]]
        if action == "activate":
            expires_at_epoch_seconds = self.plan["expires_at_epoch_ms"] // 1000
            remaining = expires_at_epoch_seconds - self.clock() // 1000
            guarded(180 <= remaining <= 1800, "fence_expiry")
            command += ["--expires-at-epoch-seconds", str(expires_at_epoch_seconds)]
        else:
            guarded(activation_sha is not None, "sip_record")
            command += ["--activation-sha256", activation_sha]
        return command

    def activate_sip(self) -> Mapping[str, Any]:
        result = self.runner.json_command(self._sip_command("activate"), timeout=8)
        exact_keys(result, {"schema", "action", "active", "operation_id", "expires_at_epoch_ms",
                            "activation_record", "activation_sha256"}, "sip_activation")
        guarded(result.get("schema") == "phone11-kamailio-invite-maintenance/v1"
                and result.get("action") == "activate" and result.get("active") is True
                and result.get("operation_id") == self.plan["fence_id"]
                and result.get("expires_at_epoch_ms") == self.plan["expires_at_epoch_ms"], "sip_activation")
        valid_sha(result.get("activation_sha256"), "sip_activation")
        return result

    def sip_status(self, activation_sha: str) -> Mapping[str, Any]:
        result = self.runner.json_command(self._sip_command("status", activation_sha), timeout=8)
        exact_keys(result, {"schema", "action", "active", "operation_id", "expires_at_epoch_ms",
                            "activation_sha256", "state_matches"}, "sip_status")
        guarded(result.get("schema") == "phone11-kamailio-invite-maintenance/v1"
                and result.get("action") == "status" and type(result.get("active")) is bool
                and type(result.get("state_matches")) is bool
                and result.get("operation_id") == self.plan["fence_id"]
                and result.get("expires_at_epoch_ms") == self.plan["expires_at_epoch_ms"]
                and result.get("activation_sha256") == activation_sha, "sip_status")
        return result

    def status_sip(self, activation_sha: str) -> Mapping[str, Any]:
        result = self.sip_status(activation_sha)
        guarded(result["active"] is True and result["state_matches"] is True, "sip_status")
        return result

    def sip_release_record(self, activation_sha: str) -> tuple[Mapping[str, Any], str] | None:
        directory = Path(self.plan["sip"]["evidence_dir"])
        path = directory / f'{self.plan["fence_id"]}.release.json'
        if not path.exists():
            return None
        raw = secure_read(path, mode=0o600, expected_uid=self.store.expected_uid)
        value = strict_json(raw, "sip_release")
        exact_keys(value, {"schema", "kind", "operation_id", "released_at_epoch_ms",
                           "activation_sha256", "was_active", "identity", "restored_state"}, "sip_release")
        guarded(canonical_bytes(value) == raw
                and value.get("schema") == "phone11-kamailio-invite-maintenance/v1"
                and value.get("kind") == "release"
                and value.get("operation_id") == self.plan["fence_id"]
                and value.get("activation_sha256") == activation_sha
                and type(value.get("released_at_epoch_ms")) is int
                and type(value.get("was_active")) is bool
                and isinstance(value.get("identity"), Mapping)
                and value.get("restored_state") == {"present": False}, "sip_release")
        return value, sha256_bytes(raw)

    def activation(self) -> tuple[Mapping[str, Any], str]:
        value, digest = self.store.read(self.plan["fence_id"], "activation")
        exact_keys(value, {"schema", "kind", "fence_id", "plan_sha256", "expires_at_epoch_ms",
                           "edge_activation_sha256", "sip_activation_sha256", "created_at_epoch_ms"}, "record")
        guarded(value.get("schema") == RECORD_SCHEMA and value.get("kind") == "activation"
                and value.get("fence_id") == self.plan["fence_id"] and value.get("plan_sha256") == self.plan_sha
                and value.get("expires_at_epoch_ms") == self.plan["expires_at_epoch_ms"]
                and value.get("edge_activation_sha256") == self.plan["edge"]["activation_sha256"], "record")
        valid_sha(value.get("sip_activation_sha256"), "record")
        return value, digest

    def ready(self, activation_digest: str) -> Mapping[str, Any]:
        value, _digest = self.store.read(self.plan["fence_id"], "ready")
        exact_keys(value, {"schema", "kind", "fence_id", "plan_sha256",
                           "aggregate_activation_sha256", "verified_at_epoch_ms"}, "record")
        guarded(value.get("schema") == RECORD_SCHEMA and value.get("kind") == "ready"
                and value.get("fence_id") == self.plan["fence_id"]
                and value.get("plan_sha256") == self.plan_sha
                and value.get("aggregate_activation_sha256") == activation_digest, "record")
        return value

    def _require_idle(self, value: Mapping[str, Any], *, since_ms: int | None) -> None:
        guarded(all(value[key] == 0 for key in COVERAGE), "not_idle")
        guarded(value["pending_notifications"] == 0, "not_idle")
        guarded(since_ms is None or value["new_attempted_notifications"] == 0, "new_notification_attempt")

    def output(self, snapshot: Mapping[str, Any], active: bool) -> Mapping[str, Any]:
        value = dict(snapshot)
        value.update({"schema": SCHEMA, "coverage": sorted(COVERAGE),
            "admission_fence_id": self.plan["fence_id"], "admission_fence_active": active,
            "admission_fence_expires_at_epoch_ms": self.plan["expires_at_epoch_ms"],
            "admission_fence_coverage": sorted(FENCE_COVERAGE),
            "admission_fence_evidence_sha256": self.plan_sha,
            "idle": all(snapshot[key] == 0 for key in COVERAGE) and snapshot["pending_notifications"] == 0})
        guarded(set(value) == OUTPUT_KEYS, "output")
        return value

    def require_provider_fence(self) -> None:
        # No independently reviewed mechanism currently fences already-issued
        # provider tokens, reconnects, and sessions. Aggregate zero counts are
        # observation only, so they cannot authorize baseline replacement.
        raise GuardError("provider_fence_uncommissioned")

    def phase(self, phase: str, since_ms: int | None) -> Mapping[str, Any]:
        guarded(bool(re.fullmatch(r"[a-z0-9-]{3,64}", phase)), "phase")
        if phase not in {"prepare", "apply-migration"}:
            self.require_provider_fence()
        with self.store.locked():
            self.programs()
            if phase in {"prepare", "apply-migration"}:
                snapshot = self.snapshot(since_ms)
                self._require_idle(snapshot, since_ms=since_ms)
                return self.output(snapshot, False)
            self.edge.verify(self.plan["edge"])
            guarded(self.clock() < self.plan["expires_at_epoch_ms"], "fence_expiry")
            activation_path = self.store.path(self.plan["fence_id"], "activation")
            if phase in ACTIVATING_PHASES and not activation_path.exists():
                sip = self.activate_sip()
                record = {"schema": RECORD_SCHEMA, "kind": "activation", "fence_id": self.plan["fence_id"],
                          "plan_sha256": self.plan_sha, "expires_at_epoch_ms": self.plan["expires_at_epoch_ms"],
                          "edge_activation_sha256": self.plan["edge"]["activation_sha256"],
                          "sip_activation_sha256": sip["activation_sha256"], "created_at_epoch_ms": self.clock()}
                _path, activation_digest = self.store.write(self.plan["fence_id"], "activation", record)
                first = self.snapshot(None); self._require_idle(first, since_ms=None)
                self.sleeper(15)
                self.edge.verify(self.plan["edge"]); self.status_sip(sip["activation_sha256"])
                second = self.snapshot(first["sampled_at_epoch_ms"])
                self._require_idle(second, since_ms=first["sampled_at_epoch_ms"])
                self.store.write(self.plan["fence_id"], "ready", {
                    "schema": RECORD_SCHEMA, "kind": "ready", "fence_id": self.plan["fence_id"],
                    "plan_sha256": self.plan_sha, "aggregate_activation_sha256": activation_digest,
                    "verified_at_epoch_ms": second["sampled_at_epoch_ms"],
                })
                return self.output(second, True)
            activation, activation_digest = self.activation()
            self.status_sip(activation["sip_activation_sha256"])
            ready_path = self.store.path(self.plan["fence_id"], "ready")
            if phase in ACTIVATING_PHASES and not ready_path.exists():
                first = self.snapshot(None); self._require_idle(first, since_ms=None)
                self.sleeper(15)
                self.edge.verify(self.plan["edge"]); self.status_sip(activation["sip_activation_sha256"])
                snapshot = self.snapshot(first["sampled_at_epoch_ms"])
                self._require_idle(snapshot, since_ms=first["sampled_at_epoch_ms"])
                self.store.write(self.plan["fence_id"], "ready", {
                    "schema": RECORD_SCHEMA, "kind": "ready", "fence_id": self.plan["fence_id"],
                    "plan_sha256": self.plan_sha, "aggregate_activation_sha256": activation_digest,
                    "verified_at_epoch_ms": snapshot["sampled_at_epoch_ms"],
                })
                return self.output(snapshot, True)
            self.ready(activation_digest)
            snapshot = self.snapshot(since_ms)
            self._require_idle(snapshot, since_ms=since_ms)
            return self.output(snapshot, True)

    def release_local_sip(self) -> Mapping[str, Any]:
        with self.store.locked():
            self.programs(); self.edge.verify(self.plan["edge"])
            activation, activation_digest = self.activation()
            operation_id = self.plan["fence_id"]
            intent_path = self.store.path(operation_id, "release-intent")
            if intent_path.exists():
                intent, intent_digest = self.store.read(operation_id, "release-intent")
                exact_keys(intent, {"schema", "kind", "fence_id", "plan_sha256",
                                    "aggregate_activation_sha256", "sip_activation_sha256",
                                    "edge_activation_sha256", "created_at_epoch_ms"}, "record")
                guarded(intent.get("schema") == RECORD_SCHEMA and intent.get("kind") == "release-intent"
                        and intent.get("fence_id") == operation_id
                        and intent.get("plan_sha256") == self.plan_sha
                        and intent.get("aggregate_activation_sha256") == activation_digest
                        and intent.get("sip_activation_sha256") == activation["sip_activation_sha256"]
                        and intent.get("edge_activation_sha256") == self.plan["edge"]["activation_sha256"]
                        and type(intent.get("created_at_epoch_ms")) is int, "record")
            else:
                status = self.sip_status(activation["sip_activation_sha256"])
                guarded(status["state_matches"] is True, "sip_status")
                intent = {"schema": RECORD_SCHEMA, "kind": "release-intent", "fence_id": operation_id,
                          "plan_sha256": self.plan_sha, "aggregate_activation_sha256": activation_digest,
                          "sip_activation_sha256": activation["sip_activation_sha256"],
                          "edge_activation_sha256": self.plan["edge"]["activation_sha256"],
                          "created_at_epoch_ms": self.clock()}
                _path, intent_digest = self.store.write(operation_id, "release-intent", intent)

            release_path = self.store.path(operation_id, "release")
            if release_path.exists():
                record, digest = self.store.read(operation_id, "release")
                exact_keys(record, {"schema", "kind", "fence_id", "plan_sha256",
                                    "aggregate_activation_sha256", "release_intent_sha256",
                                    "sip_release_sha256", "released_at_epoch_ms", "edge_still_active"}, "record")
                guarded(record.get("schema") == RECORD_SCHEMA and record.get("kind") == "release"
                        and record.get("fence_id") == operation_id and record.get("plan_sha256") == self.plan_sha
                        and record.get("aggregate_activation_sha256") == activation_digest
                        and record.get("release_intent_sha256") == intent_digest
                        and record.get("edge_still_active") is True, "record")
                sip_record = self.sip_release_record(activation["sip_activation_sha256"])
                guarded(sip_record is not None and sip_record[1] == record.get("sip_release_sha256"), "sip_release")
                status = self.sip_status(activation["sip_activation_sha256"])
                guarded(status["active"] is False and status["state_matches"] is False, "sip_status")
                return {"schema": RECORD_SCHEMA, "action": "release-local-sip", "active": False,
                        "fence_id": operation_id, "edge_still_active": True,
                        "release_record": str(release_path), "release_sha256": digest}

            status = self.sip_status(activation["sip_activation_sha256"])
            sip_record = self.sip_release_record(activation["sip_activation_sha256"])
            if status["state_matches"] is True:
                guarded(sip_record is None, "sip_release")
            elif sip_record is not None:
                result = {"release_sha256": sip_record[1]}
            else:
                guarded(status["active"] is False, "sip_status")
                result = {}
            if status["state_matches"] is True or sip_record is None:
                result = self.runner.json_command(self._sip_command("release", activation["sip_activation_sha256"]), timeout=8)
                exact_keys(result, {"schema", "action", "active", "operation_id", "activation_sha256",
                                    "release_record", "release_sha256"}, "sip_release")
                guarded(result.get("schema") == "phone11-kamailio-invite-maintenance/v1"
                        and result.get("action") == "release" and result.get("active") is False
                        and result.get("operation_id") == operation_id
                        and result.get("activation_sha256") == activation["sip_activation_sha256"], "sip_release")
            sip_release_sha = valid_sha(result.get("release_sha256"), "sip_release")
            published_sip_release = self.sip_release_record(activation["sip_activation_sha256"])
            guarded(published_sip_release is not None and published_sip_release[1] == sip_release_sha, "sip_release")
            released = self.sip_status(activation["sip_activation_sha256"])
            guarded(released["active"] is False and released["state_matches"] is False, "sip_status")
            record = {"schema": RECORD_SCHEMA, "kind": "release", "fence_id": self.plan["fence_id"],
                      "plan_sha256": self.plan_sha, "aggregate_activation_sha256": activation_digest,
                      "release_intent_sha256": intent_digest,
                      "sip_release_sha256": sip_release_sha, "released_at_epoch_ms": self.clock(),
                      "edge_still_active": True}
            path, digest = self.store.write(operation_id, "release", record)
            return {"schema": RECORD_SCHEMA, "action": "release-local-sip", "active": False,
                    "fence_id": self.plan["fence_id"], "edge_still_active": True,
                    "release_record": str(path), "release_sha256": digest}


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    actions = value.add_mutually_exclusive_group(required=True)
    actions.add_argument("--phase")
    actions.add_argument("--release-local-sip", action="store_true")
    value.add_argument("--since-epoch-ms", type=int)
    value.add_argument("--plan", type=Path, default=PLAN_PATH)
    return value


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        guarded(os.geteuid() == 0, "root_required")
        raw = secure_read(args.plan, mode=0o600)
        plan, plan_sha = parse_plan(raw), sha256_bytes(raw)
        store = RecordStore(Path(plan["evidence_dir"]))
        controller = GuardController(plan, plan_sha, Runner(), HttpsProof(), store)
        result = controller.release_local_sip() if args.release_local_sip else controller.phase(args.phase, args.since_epoch_ms)
        sys.stdout.buffer.write(canonical_bytes(result)); return 0
    except GuardError as error:
        sys.stderr.write(json.dumps({"schema": SCHEMA, "ok": False, "stage": error.stage}, separators=(",", ":")) + "\n"); return 2
    except (OSError, UnicodeError, ValueError, json.JSONDecodeError):
        sys.stderr.write(json.dumps({"schema": SCHEMA, "ok": False, "stage": "guard_failure"}, separators=(",", ":")) + "\n"); return 2


if __name__ == "__main__":
    raise SystemExit(main())
