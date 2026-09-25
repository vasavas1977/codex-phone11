#!/usr/bin/env python3
"""Fail-closed Phone11 profile/DND baseline and API-candidate rollout operator.

The operator consumes only a separately reviewed, root-owned mode-0600 manifest
and pinned artifacts.  ``--prepare`` is read-only.  Mutating phases re-run the
relevant live pins immediately before their one bounded mutation.  Command
output is never relayed to the terminal, so container environments, protected
probe headers, database settings, and customer data cannot enter diagnostics.

This source prepares an operator; it does not build an image, generate live
pins, contact a provider, or authorize a production rollout.
"""

from __future__ import annotations

import argparse
import base64
from contextlib import contextmanager
from dataclasses import dataclass
import errno
import fcntl
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import socket
import stat
import subprocess
import sys
import tempfile
import time
from typing import Any, Mapping, Sequence
from urllib.parse import urlsplit


SCHEMA = "phone11-profile-dnd-rollout/v2"
RECEIPT_SCHEMA = "phone11-migration-receipt/v1"
INTENT_SCHEMA = "phone11-runtime-mutation-intent/v1"
SHUTDOWN_RECEIPT_SCHEMA = "phone11-runtime-shutdown-receipt/v1"
GUARD_SCHEMA = "phone11-profile-dnd-guard/v1"
PROBE_SCHEMA = "phone11-profile-dnd-probes/v1"
BASELINE_CONTAINER = "cp11-backend"
CANDIDATE_CONTAINER = "cp11-api-candidate"
BASELINE_PORT = 3000
CANDIDATE_PORT = 3002
WAKE_URL = "http://127.0.0.1:3000/api/phone11/wake"
PUBLIC_ORIGIN = "https://api.phone11.ai"
LOCK_FILE = Path("/run/phone11-profile-dnd-rollout.lock")
STATE_ROOT = Path("/var/lib/phone11-profile-dnd-rollout")
ROUTE_SITE = STATE_ROOT / "nginx-site.before"
ROUTE_RECEIPT = STATE_ROOT / "route-receipt.json"
BASELINE_RECEIPT = STATE_ROOT / "baseline-receipt.json"
BASELINE_INTENT = STATE_ROOT / "baseline-intent.json"
BASELINE_SHUTDOWN_RECEIPT = STATE_ROOT / "baseline-shutdown-receipt.json"
CANDIDATE_RECEIPT = STATE_ROOT / "candidate-receipt.json"
DISABLED_ROLLBACK_RECEIPT = STATE_ROOT / "disabled-rollback-receipt.json"
MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_OUTPUT_BYTES = 2 * 1024 * 1024
DOCKER_STOP_SECONDS = 35
EXPECTED_PROBES = {
    "existing_phone", "existing_chat", "mixed_batch", "profile_self",
    "colleague_presence", "notification_readiness", "denied_tenant",
    "revoked_membership",
}
EXPECTED_GUARD_COVERAGE = {
    "freeswitch_channels", "kamailio_dialogs", "relay_calls",
    "sip_transactions_active", "active_conference_jobs",
    "active_recording_jobs", "active_media_jobs", "active_worker_jobs",
}
EXPECTED_FENCE_COVERAGE = {
    "sip_invite_admission", "conference_job_admission",
    "media_job_admission", "recording_job_admission",
    "worker_job_admission", "notification_dispatch_admission",
}


class GuardError(RuntimeError):
    def __init__(self, stage: str) -> None:
        super().__init__(stage)
        self.stage = stage


class AtomicWriteError(GuardError):
    def __init__(self, *, committed: bool) -> None:
        super().__init__("atomic_write")
        self.committed = committed


def guarded(condition: bool, stage: str) -> None:
    if not condition:
        raise GuardError(stage)


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def canonical_hash(value: Any) -> str:
    return sha256_bytes(canonical_bytes(value))


def is_sha256(value: Any) -> bool:
    return isinstance(value, str) and bool(re.fullmatch(r"[0-9a-f]{64}", value))


def is_digest(value: Any) -> bool:
    return isinstance(value, str) and bool(re.fullmatch(r"sha256:[0-9a-f]{64}", value))


def exact_keys(value: Mapping[str, Any], keys: set[str], stage: str = "manifest") -> None:
    guarded(set(value) == keys, stage)


def strict_json(raw: bytes, stage: str) -> Mapping[str, Any]:
    def no_duplicates(pairs: Sequence[tuple[str, Any]]) -> Mapping[str, Any]:
        value: dict[str, Any] = {}
        for key, item in pairs:
            if key in value:
                raise GuardError(stage)
            value[key] = item
        return value
    try:
        value = json.loads(raw, object_pairs_hook=no_duplicates)
    except GuardError:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise GuardError(stage) from error
    guarded(isinstance(value, Mapping), stage)
    return value


def secure_read(path: Path, *, mode: int | None = 0o600) -> bytes:
    """Read one immutable-by-identity root-owned regular file."""
    try:
        before = path.lstat()
        guarded(
            stat.S_ISREG(before.st_mode) and not stat.S_ISLNK(before.st_mode)
            and before.st_uid == 0 and before.st_gid == 0 and before.st_nlink == 1
            and (mode is None or stat.S_IMODE(before.st_mode) == mode)
            and before.st_size <= MAX_FILE_BYTES,
            "secure_file",
        )
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        try:
            opened = os.fstat(descriptor)
            guarded(
                (opened.st_dev, opened.st_ino, opened.st_uid, opened.st_gid, opened.st_size)
                == (before.st_dev, before.st_ino, before.st_uid, before.st_gid, before.st_size),
                "secure_file",
            )
            chunks: list[bytes] = []
            remaining = MAX_FILE_BYTES + 1
            while remaining:
                chunk = os.read(descriptor, min(65_536, remaining))
                if not chunk:
                    break
                chunks.append(chunk)
                remaining -= len(chunk)
            raw = b"".join(chunks)
            guarded(len(raw) <= MAX_FILE_BYTES and os.fstat(descriptor).st_size == len(raw), "secure_file")
            return raw
        finally:
            os.close(descriptor)
    except GuardError:
        raise
    except OSError as error:
        raise GuardError("secure_file") from error


def pinned_read(path: Path, digest: str, stage: str, *, mode: int | None = 0o600) -> bytes:
    raw = secure_read(path, mode=mode)
    guarded(sha256_bytes(raw) == digest, stage)
    return raw


def ensure_private_directory(path: Path, *, create: bool) -> None:
    try:
        if create and not path.exists():
            os.mkdir(path, 0o700)
        info = path.lstat()
        guarded(
            stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode)
            and info.st_uid == 0 and info.st_gid == 0 and stat.S_IMODE(info.st_mode) == 0o700,
            "private_directory",
        )
    except GuardError:
        raise
    except OSError as error:
        raise GuardError("private_directory") from error


def atomic_write(path: Path, content: bytes, *, mode: int = 0o600, uid: int = 0, gid: int = 0) -> None:
    descriptor: int | None = None
    directory_descriptor: int | None = None
    temporary: str | None = None
    committed = False
    try:
        descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
        os.fchmod(descriptor, mode)
        os.fchown(descriptor, uid, gid)
        view = memoryview(content)
        while view:
            written = os.write(descriptor, view)
            if written <= 0:
                raise OSError(errno.EIO, "short write")
            view = view[written:]
        os.fsync(descriptor)
        os.close(descriptor)
        descriptor = None
        os.replace(temporary, path)
        temporary = None
        committed = True
        directory_descriptor = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        os.fsync(directory_descriptor)
        os.close(directory_descriptor)
        directory_descriptor = None
    except OSError as error:
        raise AtomicWriteError(committed=committed) from error
    finally:
        if descriptor is not None:
            os.close(descriptor)
        if directory_descriptor is not None:
            os.close(directory_descriptor)
        if temporary is not None:
            try:
                Path(temporary).unlink(missing_ok=True)
            except OSError:
                pass


def atomic_write_exclusive(path: Path, content: bytes, *, mode: int = 0o600, uid: int = 0, gid: int = 0) -> None:
    """Durably publish complete bytes without replacing an existing path."""
    descriptor: int | None = None
    directory_descriptor: int | None = None
    temporary: str | None = None
    published = False
    try:
        descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
        os.fchmod(descriptor, mode)
        os.fchown(descriptor, uid, gid)
        view = memoryview(content)
        while view:
            written = os.write(descriptor, view)
            if written <= 0:
                raise OSError(errno.EIO, "short write")
            view = view[written:]
        os.fsync(descriptor)
        os.close(descriptor)
        descriptor = None
        os.link(temporary, path, follow_symlinks=False)
        published = True
        os.unlink(temporary)
        temporary = None
        directory_descriptor = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        os.fsync(directory_descriptor)
        os.close(directory_descriptor)
        directory_descriptor = None
    except OSError as error:
        raise AtomicWriteError(committed=published) from error
    finally:
        if descriptor is not None:
            os.close(descriptor)
        if directory_descriptor is not None:
            os.close(directory_descriptor)
        if temporary is not None:
            try:
                Path(temporary).unlink(missing_ok=True)
            except OSError:
                pass


@contextmanager
def operator_lock(path: Path = LOCK_FILE):
    descriptor: int | None = None
    try:
        descriptor = os.open(path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
        info = os.fstat(descriptor)
        guarded(
            stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_gid == 0
            and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o600,
            "operator_lock",
        )
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    except OSError as error:
        raise GuardError("operator_lock") from error
    finally:
        if descriptor is not None:
            os.close(descriptor)


@dataclass(frozen=True)
class RuntimePin:
    container_id: str
    image: str
    runtime_sha256: str
    build: str
    replacement_receipt_sha256: str | None


@dataclass(frozen=True)
class ComposePin:
    path: Path
    sha256: str
    rendered_sha256: str
    service: str


@dataclass(frozen=True)
class MigrationArtifact:
    name: str
    path: Path
    sha256: str


@dataclass(frozen=True)
class Pins:
    release_sha: str
    release_build: str
    image: str
    bundle_sha256: str
    lock_sha256: str
    baseline: RuntimePin
    candidate: RuntimePin
    baseline_compose: ComposePin
    candidate_compose: ComposePin
    rollback_compose: ComposePin
    rollback_disabled_compose: ComposePin
    rollback_image: str
    rollback_build: str
    rollback_normalized_runtime_sha256: str
    baseline_operation_id: str
    baseline_intent_sha256: str
    migration_artifacts: tuple[MigrationArtifact, ...]
    migration_verify: Path
    migration_verify_sha256: str
    database_sha256: str
    before_catalog_sha256: str
    after_catalog_sha256: str
    migration_receipt: Path
    migration_receipt_sha256: str | None
    probes_file: Path
    probes_sha256: str
    guard_program: Path
    guard_sha256: str
    guard_fence_id: str
    guard_fence_evidence_sha256: str
    nginx_site: Path
    nginx_site_sha256: str
    nginx_dump_sha256: str
    nginx_marker: str
    route: str
    profile_gate_committed: bool
    kamailio_path: str
    kamailio_sha256: str
    wake_occurrences: int
    public_origin: str


def _runtime(value: Any) -> RuntimePin:
    guarded(isinstance(value, Mapping), "manifest")
    exact_keys(value, {"container_id", "image", "runtime_sha256", "build", "replacement_receipt_sha256"})
    guarded(isinstance(value.get("container_id"), str) and bool(re.fullmatch(r"[0-9a-f]{64}", value["container_id"])), "manifest")
    guarded(is_digest(value.get("image")) and is_sha256(value.get("runtime_sha256")), "manifest")
    guarded(isinstance(value.get("build"), str) and bool(re.fullmatch(r"[A-Za-z0-9_.-]{7,128}", value["build"])), "manifest")
    receipt_sha = value.get("replacement_receipt_sha256")
    guarded(receipt_sha is None or is_sha256(receipt_sha), "manifest")
    return RuntimePin(value["container_id"], value["image"], value["runtime_sha256"], value["build"], receipt_sha)


def _compose(value: Any) -> ComposePin:
    guarded(isinstance(value, Mapping), "manifest")
    exact_keys(value, {"file", "sha256", "rendered_sha256", "service"})
    guarded(isinstance(value.get("file"), str) and value["file"].startswith("/"), "manifest")
    guarded(is_sha256(value.get("sha256")) and is_sha256(value.get("rendered_sha256")), "manifest")
    guarded(isinstance(value.get("service"), str) and bool(re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,62}", value["service"])), "manifest")
    return ComposePin(Path(value["file"]), value["sha256"], value["rendered_sha256"], value["service"])


def parse_manifest(document: Mapping[str, Any]) -> Pins:
    exact_keys(document, {"schema", "release", "current", "compose", "rollback", "migration", "probes", "guard", "nginx", "kamailio", "public_origin"})
    guarded(document.get("schema") == SCHEMA and document.get("public_origin") == PUBLIC_ORIGIN, "manifest")
    for key in ("release", "current", "compose", "rollback", "migration", "probes", "guard", "nginx", "kamailio"):
        guarded(isinstance(document.get(key), Mapping), "manifest")
    release, current, compose = document["release"], document["current"], document["compose"]
    rollback, migration = document["rollback"], document["migration"]
    probes, guard, nginx, kamailio = document["probes"], document["guard"], document["nginx"], document["kamailio"]
    exact_keys(release, {"sha", "build", "image", "bundle_sha256", "lock_sha256"})
    exact_keys(current, {"baseline", "candidate"})
    exact_keys(compose, {"baseline", "candidate"})
    exact_keys(rollback, {"image", "build", "normalized_runtime_sha256", "baseline_operation_id", "baseline_intent_sha256", "compose", "disabled_compose"})
    exact_keys(migration, {"artifacts", "verify", "verify_sha256", "database_sha256", "before_catalog_sha256", "after_catalog_sha256", "receipt", "receipt_sha256"})
    exact_keys(probes, {"file", "sha256"})
    exact_keys(guard, {"program", "sha256", "fence_id", "fence_evidence_sha256"})
    exact_keys(nginx, {"site", "site_sha256", "dump_sha256", "marker", "route", "profile_gate_committed"})
    exact_keys(kamailio, {"config_path", "config_sha256", "wake_occurrences"})
    guarded(isinstance(release.get("sha"), str) and bool(re.fullmatch(r"[0-9a-f]{40}", release["sha"])), "manifest")
    guarded(isinstance(release.get("build"), str) and bool(re.fullmatch(r"[A-Za-z0-9_.-]{7,128}", release["build"])), "manifest")
    guarded(is_digest(release.get("image")), "manifest")
    for value in (release.get("bundle_sha256"), release.get("lock_sha256"), migration.get("verify_sha256"), migration.get("database_sha256"), migration.get("before_catalog_sha256"), migration.get("after_catalog_sha256"), probes.get("sha256"), guard.get("sha256"), nginx.get("site_sha256"), nginx.get("dump_sha256"), kamailio.get("config_sha256")):
        guarded(is_sha256(value), "manifest")
    guarded(is_digest(rollback.get("image")) and isinstance(rollback.get("build"), str) and bool(re.fullmatch(r"[A-Za-z0-9_.-]{7,128}", rollback["build"])), "manifest")
    guarded(is_sha256(rollback.get("normalized_runtime_sha256")), "manifest")
    guarded(isinstance(rollback.get("baseline_operation_id"), str) and bool(re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", rollback["baseline_operation_id"])), "manifest")
    guarded(is_sha256(rollback.get("baseline_intent_sha256")), "manifest")
    guarded(release["image"] != rollback["image"], "manifest")
    for section, name in ((migration, "verify"), (migration, "receipt"), (probes, "file"), (guard, "program"), (nginx, "site")):
        guarded(isinstance(section.get(name), str) and section[name].startswith("/"), "manifest")
    artifacts = migration.get("artifacts")
    guarded(isinstance(artifacts, list) and 1 <= len(artifacts) <= 2, "manifest")
    parsed_artifacts: list[MigrationArtifact] = []
    for index, artifact in enumerate(artifacts):
        guarded(isinstance(artifact, Mapping), "manifest")
        exact_keys(artifact, {"name", "file", "sha256"})
        expected_name = "profile" if index == 0 else "all_mentions"
        guarded(artifact.get("name") == expected_name and isinstance(artifact.get("file"), str) and artifact["file"].startswith("/") and is_sha256(artifact.get("sha256")), "manifest")
        parsed_artifacts.append(MigrationArtifact(expected_name, Path(artifact["file"]), artifact["sha256"]))
    receipt_sha = migration.get("receipt_sha256")
    guarded(receipt_sha is None or is_sha256(receipt_sha), "manifest")
    guarded(isinstance(guard.get("fence_id"), str) and bool(re.fullmatch(r"[A-Za-z0-9_.:-]{16,128}", guard["fence_id"])), "manifest")
    guarded(is_sha256(guard.get("fence_evidence_sha256")), "manifest")
    guarded(
        isinstance(nginx.get("marker"), str)
        and (nginx["marker"].startswith("# PHONE11_PROFILE_DND_INSERT ") or nginx["marker"].startswith("# PHONE11_PARALLEL_API_INSERT "))
        and "\n" not in nginx["marker"] and "\r" not in nginx["marker"],
        "manifest",
    )
    guarded(nginx.get("route") in {"candidate", "baseline"}, "manifest")
    guarded(type(nginx.get("profile_gate_committed")) is bool, "manifest")
    guarded(nginx.get("profile_gate_committed") == (receipt_sha is not None), "manifest")
    guarded(isinstance(kamailio.get("config_path"), str) and kamailio["config_path"].startswith("/"), "manifest")
    guarded(type(kamailio.get("wake_occurrences")) is int and 1 <= kamailio["wake_occurrences"] <= 100, "manifest")
    baseline, candidate = _runtime(current["baseline"]), _runtime(current["candidate"])
    guarded(baseline.image != release["image"] or baseline.build == release["build"], "manifest")
    guarded(candidate.image != release["image"] or candidate.build == release["build"], "manifest")
    return Pins(
        release["sha"], release["build"], release["image"], release["bundle_sha256"], release["lock_sha256"],
        baseline, candidate, _compose(compose["baseline"]), _compose(compose["candidate"]),
        _compose(rollback["compose"]), _compose(rollback["disabled_compose"]), rollback["image"], rollback["build"], rollback["normalized_runtime_sha256"], rollback["baseline_operation_id"], rollback["baseline_intent_sha256"],
        tuple(parsed_artifacts), Path(migration["verify"]), migration["verify_sha256"],
        migration["database_sha256"], migration["before_catalog_sha256"], migration["after_catalog_sha256"],
        Path(migration["receipt"]), receipt_sha, Path(probes["file"]), probes["sha256"],
        Path(guard["program"]), guard["sha256"], guard["fence_id"], guard["fence_evidence_sha256"], Path(nginx["site"]), nginx["site_sha256"], nginx["dump_sha256"],
        nginx["marker"], nginx["route"], nginx["profile_gate_committed"], kamailio["config_path"], kamailio["config_sha256"], kamailio["wake_occurrences"], document["public_origin"],
    )


def load_pins(path: Path) -> Pins:
    guarded(os.geteuid() == 0, "root")
    return parse_manifest(strict_json(secure_read(path), "manifest"))


class System:
    def command(self, args: Sequence[str], *, timeout: int = 30, stdin: bytes | None = None) -> bytes:
        try:
            result = subprocess.run(
                list(args), input=stdin, stdin=subprocess.DEVNULL if stdin is None else None,
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=timeout, check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise GuardError("command") from error
        guarded(result.returncode == 0 and len(result.stdout) <= MAX_OUTPUT_BYTES, "command")
        return result.stdout

    def json_command(self, args: Sequence[str], stage: str, *, timeout: int = 30, stdin: bytes | None = None) -> Any:
        try:
            return json.loads(self.command(args, timeout=timeout, stdin=stdin))
        except GuardError as error:
            raise GuardError(stage) from error
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise GuardError(stage) from error

    def request(self, origin: str, probe: Mapping[str, Any]) -> tuple[int, bytes, Mapping[str, tuple[str, ...]]]:
        parsed = urlsplit(origin)
        guarded(parsed.scheme in {"http", "https"} and parsed.hostname is not None, "probe")
        connection_type = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
        connection = connection_type(parsed.hostname, parsed.port, timeout=10)
        try:
            connection.request(probe["method"], probe["path"], body=probe["body"].encode(), headers=probe["headers"])
            response = connection.getresponse()
            body = response.read(1_048_577)
            guarded(len(body) <= 1_048_576, "probe")
            headers: dict[str, list[str]] = {}
            for name, value in response.getheaders():
                headers.setdefault(name.lower(), []).append(value)
            return response.status, body, {key: tuple(values) for key, values in headers.items()}
        except (OSError, http.client.HTTPException, socket.timeout) as error:
            raise GuardError("probe") from error
        finally:
            connection.close()


def one_inspect(system: System, name: str, stage: str) -> Mapping[str, Any]:
    value = system.json_command(["docker", "inspect", name], stage)
    guarded(isinstance(value, list) and len(value) == 1 and isinstance(value[0], Mapping), stage)
    return value[0]


def environment(inspect: Mapping[str, Any], stage: str) -> Mapping[str, str]:
    raw = inspect.get("Config", {}).get("Env")
    guarded(isinstance(raw, list), stage)
    result: dict[str, str] = {}
    for item in raw:
        guarded(isinstance(item, str) and "=" in item, stage)
        key, value = item.split("=", 1)
        guarded(bool(key) and key not in result, stage)
        result[key] = value
    return result


def runtime_shape(inspect: Mapping[str, Any]) -> Mapping[str, Any]:
    config, host, network = inspect.get("Config"), inspect.get("HostConfig"), inspect.get("NetworkSettings")
    mounts = inspect.get("Mounts")
    guarded(all(isinstance(value, Mapping) for value in (config, host, network)) and isinstance(mounts, list), "runtime")
    env = environment(inspect, "runtime")
    return {
        "Id": inspect.get("Id"), "Image": inspect.get("Image"),
        "Config": {key: config.get(key) for key in ("Image", "Entrypoint", "Cmd", "User", "WorkingDir", "Healthcheck", "Labels")},
        "HostConfig": {key: host.get(key) for key in ("NetworkMode", "PortBindings", "RestartPolicy", "ReadonlyRootfs", "Memory", "NanoCpus")},
        "Mounts": sorted(({key: item.get(key) for key in ("Type", "Source", "Destination", "RW", "Propagation")} for item in mounts), key=lambda item: str(item.get("Destination"))),
        "Networks": sorted((network.get("Networks") or {}).keys()),
        "Environment": sorted(env.items()),
    }


def normalized_runtime_release(inspect: Mapping[str, Any], *, normalize_notifications: bool = False) -> Mapping[str, Any]:
    shape = json.loads(canonical_bytes(runtime_shape(inspect)))
    shape["Id"] = "<CONTAINER_ID>"
    shape["Image"] = "<IMAGE>"
    shape["Config"]["Image"] = "<IMAGE_REFERENCE>"
    shape["Environment"] = [
        [key, "<BUILD>"] if key == "PHONE11_BUILD_SHA"
        else [key, "<NOTIFICATIONS>"] if normalize_notifications and key == "PHONE11_CHAT_NOTIFICATIONS_ENABLED"
        else [key, value]
        for key, value in shape["Environment"]
    ]
    labels = shape["Config"].get("Labels")
    if isinstance(labels, dict):
        for key in list(labels):
            if key in {
                "com.phone11.source-sha", "com.phone11.bundle-sha256",
                "com.phone11.lock-sha256", "com.phone11.candidate-build",
                "com.docker.compose.config-hash",
                "com.docker.compose.project.config_files",
            }:
                labels.pop(key)
    return shape


def validate_runtime(
    system: System,
    name: str,
    pin: RuntimePin,
    *,
    role: str,
    port: int,
    require_healthy: bool = True,
    compose_project: str | None = None,
    compose_service: str | None = None,
) -> Mapping[str, Any]:
    inspect = one_inspect(system, name, f"{role}_runtime")
    state = inspect.get("State")
    guarded(inspect.get("Id") == pin.container_id and inspect.get("Image") == pin.image, f"{role}_runtime")
    guarded(isinstance(state, Mapping), f"{role}_runtime")
    if require_healthy:
        guarded(state.get("Running") is True and state.get("OOMKilled") is not True and state.get("Health", {}).get("Status") == "healthy", f"{role}_runtime")
    guarded(canonical_hash(runtime_shape(inspect)) == pin.runtime_sha256, f"{role}_runtime")
    env = environment(inspect, f"{role}_runtime")
    actual_role = env.get("PHONE11_RUNTIME_ROLE", "default")
    guarded(actual_role == role and env.get("PHONE11_BUILD_SHA") == pin.build and env.get("PORT", str(port)) == str(port), f"{role}_runtime")
    bindings = inspect.get("HostConfig", {}).get("PortBindings", {}).get(f"{port}/tcp")
    guarded(bindings == [{"HostIp": "127.0.0.1", "HostPort": str(port)}], f"{role}_runtime")
    labels = inspect.get("Config", {}).get("Labels")
    if compose_project is not None or compose_service is not None:
        guarded(
            isinstance(labels, Mapping)
            and labels.get("com.docker.compose.project") == compose_project
            and labels.get("com.docker.compose.service") == compose_service,
            f"{role}_runtime",
        )
    if require_healthy:
        health(system, port, pin.build, role)
    return inspect


def health(system: System, port: int, build: str, role: str) -> None:
    status_code, body, _headers = system.request(
        f"http://127.0.0.1:{port}",
        {"method": "GET", "path": "/api/health", "headers": {"Connection": "close"}, "body": ""},
    )
    try:
        value = json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise GuardError("health") from error
    guarded(
        status_code == 200 and isinstance(value, Mapping) and value.get("ok") is True
        and value.get("service") == "phone11-backend" and value.get("build") == build
        and value.get("runtimeRole", "default") == role,
        "health",
    )


def validate_compose(document: Any, pin: ComposePin, *, container: str, image: str, build: str, role: str, port: int, notifications: str | None) -> None:
    guarded(isinstance(document, Mapping) and set(document.get("services", {})) == {pin.service}, "compose")
    service = document["services"][pin.service]
    guarded(isinstance(service, Mapping) and service.get("container_name") == container and service.get("image") == image, "compose")
    guarded(service.get("restart") == "unless-stopped" and not service.get("privileged") and not service.get("devices") and not service.get("cap_add"), "compose")
    env = service.get("environment")
    guarded(isinstance(env, Mapping) and env.get("PHONE11_RUNTIME_ROLE", "default") == role and str(env.get("PORT", port)) == str(port), "compose")
    guarded(env.get("PHONE11_BUILD_SHA") == build, "compose")
    if notifications is not None:
        guarded(str(env.get("PHONE11_CHAT_NOTIFICATIONS_ENABLED")) == notifications, "compose")
    ports = service.get("ports")
    guarded(isinstance(ports, list) and len(ports) == 1 and isinstance(ports[0], Mapping), "compose")
    binding = ports[0]
    guarded(binding.get("host_ip") == "127.0.0.1" and int(binding.get("published")) == port and int(binding.get("target")) == port and binding.get("protocol", "tcp") == "tcp", "compose")
    guarded(canonical_hash(document) == pin.rendered_sha256, "compose")


def normalized_release_compose(document: Mapping[str, Any], service_name: str, *, disabled: bool = False) -> Mapping[str, Any]:
    """Normalize only the reviewed image/build (and emergency gate) deltas."""
    clone = json.loads(canonical_bytes(document))
    service = clone["services"][service_name]
    service["image"] = "<IMAGE>"
    service["environment"]["PHONE11_BUILD_SHA"] = "<BUILD>"
    if disabled:
        service["environment"]["PHONE11_CHAT_NOTIFICATIONS_ENABLED"] = "1"
    return clone


def render_compose(system: System, pin: ComposePin, **expected: Any) -> Mapping[str, Any]:
    pinned_read(pin.path, pin.sha256, "compose")
    document = system.json_command(["docker", "compose", "--project-directory", str(pin.path.parent), "-f", str(pin.path), "config", "--format", "json"], "compose")
    validate_compose(document, pin, **expected)
    return document


@contextmanager
def frozen_compose(document: Mapping[str, Any]):
    directory = Path(tempfile.mkdtemp(prefix="phone11-profile-dnd."))
    path = directory / "compose.json"
    try:
        os.chmod(directory, 0o700)
        atomic_write(path, canonical_bytes(document))
        yield path
    finally:
        try:
            path.unlink(missing_ok=True)
            directory.rmdir()
        except OSError:
            pass


def load_probes(raw: bytes) -> list[Mapping[str, Any]]:
    document = strict_json(raw, "probes")
    exact_keys(document, {"schema", "probes"}, "probes")
    guarded(document.get("schema") == PROBE_SCHEMA and isinstance(document.get("probes"), list), "probes")
    labels: set[str] = set()
    for probe in document["probes"]:
        guarded(isinstance(probe, Mapping), "probes")
        exact_keys(probe, {"label", "method", "path", "headers", "body", "status", "required", "forbidden"}, "probes")
        label, path, headers = probe.get("label"), probe.get("path"), probe.get("headers")
        guarded(label in EXPECTED_PROBES and label not in labels, "probes")
        labels.add(label)
        guarded(probe.get("method") in {"GET", "POST"} and isinstance(path, str) and path.startswith("/api/trpc/") and "\r" not in path and "\n" not in path, "probes")
        guarded(isinstance(headers, Mapping) and ("Authorization" in headers or "Cookie" in headers), "probes")
        guarded(all(isinstance(key, str) and isinstance(item, str) and "\r" not in key + item and "\n" not in key + item for key, item in headers.items()), "probes")
        guarded(isinstance(probe.get("body"), str) and len(probe["body"].encode()) <= 1_048_576 and isinstance(probe.get("status"), int), "probes")
        guarded(all(isinstance(values, list) and all(isinstance(item, str) for item in values) for values in (probe.get("required"), probe.get("forbidden"))), "probes")
    guarded(labels == EXPECTED_PROBES, "probes")
    return list(document["probes"])


def run_probes(system: System, origin: str, probes: Sequence[Mapping[str, Any]], *, candidate_build: str | None = None, require_no_candidate_header: bool = False) -> None:
    for probe in probes:
        status_code, body, headers = system.request(origin, probe)
        guarded(status_code == probe["status"], "probes")
        marker = headers.get("x-phone11-api-candidate")
        if candidate_build is not None:
            guarded(marker == (candidate_build,), "route_readiness")
        if require_no_candidate_header:
            guarded(marker is None, "route_readiness")
        try:
            text = body.decode("utf-8", errors="strict")
        except UnicodeDecodeError as error:
            raise GuardError("probes") from error
        guarded(all(value in text for value in probe["required"]) and all(value not in text for value in probe["forbidden"]), "probes")


def proxy_fragment(marker: str, *, port: int, build: str, candidate: bool) -> bytes:
    guarded(port in {BASELINE_PORT, CANDIDATE_PORT} and bool(re.fullmatch(r"[A-Za-z0-9_.-]{7,128}", build)), "nginx_route")
    header = f"        add_header X-Phone11-Api-Candidate {build} always;\n" if candidate else ""
    block = []
    for location in ("location = /api/trpc", "location ^~ /api/trpc/"):
        block.append(
            f"    {location} {{\n        proxy_pass http://127.0.0.1:{port};\n"
            "        proxy_http_version 1.1;\n        proxy_pass_request_headers on;\n"
            "        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n"
            "        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n"
            "        proxy_set_header X-Forwarded-Proto $scheme;\n" + header + "    }\n"
        )
    return ("".join(block) + f"    {marker}\n").encode()


MIGRATION_NODE = r'''
const fs=require("node:fs"),crypto=require("node:crypto"),pg=require("pg");
const input=JSON.parse(fs.readFileSync(0,"utf8"));
function canonical(v){if(Array.isArray(v))return "["+v.map(canonical).join(",")+"]";if(v&&typeof v==="object")return "{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+canonical(v[k])).join(",")+"}";return JSON.stringify(v)}
function sha(v){return crypto.createHash("sha256").update(canonical(v)).digest("hex")}
function first(...ks){for(const k of ks)if(process.env[k])return process.env[k]}
function config(){const d={host:first("PG_HOST","DB_HOST","POSTGRES_HOST"),port:Number(first("PG_PORT","DB_PORT","POSTGRES_PORT")||5432),user:first("PG_USER","DB_USER","POSTGRES_USER"),password:first("PG_PASSWORD","DB_PASSWORD","POSTGRES_PASSWORD"),database:first("PG_DATABASE","DB_NAME","DB_DATABASE","POSTGRES_DB")};const connectionString=process.env.PG_CONNECTION_STRING||process.env.DATABASE_URL;return connectionString?{connectionString,connectionTimeoutMillis:5000}:{...d,connectionTimeoutMillis:5000}}
(async()=>{const c=new pg.Client(config());await c.connect();try{await c.query(input.action==="inspect"?"BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY":"BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");await c.query("SET LOCAL lock_timeout='2000ms'");await c.query("SET LOCAL statement_timeout='30000ms'");await c.query("SELECT pg_advisory_xact_lock(hashtextextended('phone11-profile-dnd-rollout-20260920',0))");const identity=(await c.query("SELECT current_database() db,current_user usr,current_setting('server_version_num') version_num,inet_server_addr()::text addr,inet_server_port() port,(SELECT oid FROM pg_database WHERE datname=current_database()) db_oid")).rows[0];if(sha(identity)!==input.database_sha256)throw Error("identity");let rows=(await c.query(Buffer.from(input.verify_b64,"base64").toString("utf8"))).rows;if(sha(rows)!==(input.action==="apply"?input.before_catalog_sha256:input.expected_catalog_sha256))throw Error("catalog");if(input.action==="apply"){await c.query(Buffer.from(input.migration_b64,"base64").toString("utf8"));rows=(await c.query(Buffer.from(input.verify_b64,"base64").toString("utf8"))).rows;if(sha(rows)!==input.after_catalog_sha256)throw Error("post_catalog")}await c.query("COMMIT");process.stdout.write(JSON.stringify({database_sha256:sha(identity),catalog_sha256:sha(rows)}))}catch(e){try{await c.query("ROLLBACK")}catch(_){}process.exitCode=1}finally{await c.end()}})();
'''


def split_sql_statements(text: str) -> list[str]:
    statements: list[str] = []
    current: list[str] = []
    index = 0
    state = "normal"
    block_depth = 0
    dollar_tag = ""
    while index < len(text):
        char = text[index]
        following = text[index + 1] if index + 1 < len(text) else ""
        current.append(char)
        if state == "normal":
            if char == "'":
                state = "single"
            elif char == '"':
                state = "double"
            elif char == "-" and following == "-":
                current.append(following)
                index += 1
                state = "line_comment"
            elif char == "/" and following == "*":
                current.append(following)
                index += 1
                state = "block_comment"
                block_depth = 1
            elif char == "$":
                match = re.match(r"\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$", text[index:])
                if match:
                    tag = match.group(0)
                    current.extend(tag[1:])
                    index += len(tag) - 1
                    state = "dollar"
                    dollar_tag = tag
            elif char == ";":
                statements.append("".join(current))
                current = []
        elif state == "single":
            if char == "'" and following == "'":
                current.append(following)
                index += 1
            elif char == "'":
                state = "normal"
        elif state == "double":
            if char == '"' and following == '"':
                current.append(following)
                index += 1
            elif char == '"':
                state = "normal"
        elif state == "line_comment":
            if char == "\n":
                state = "normal"
        elif state == "block_comment":
            if char == "/" and following == "*":
                current.append(following)
                index += 1
                block_depth += 1
            elif char == "*" and following == "/":
                current.append(following)
                index += 1
                block_depth -= 1
                if block_depth == 0:
                    state = "normal"
        elif state == "dollar" and text.startswith(dollar_tag, index):
            current.extend(dollar_tag[1:])
            index += len(dollar_tag) - 1
            state = "normal"
            dollar_tag = ""
        index += 1
    guarded(state in {"normal", "line_comment"} and block_depth == 0, "migration_artifact")
    if "".join(current).strip():
        statements.append("".join(current))
    return statements


def sql_top_level_mask(text: str) -> str:
    """Mask comments and quoted bodies while retaining top-level SQL words."""
    output: list[str] = []
    index = 0
    state = "normal"
    block_depth = 0
    dollar_tag = ""
    while index < len(text):
        char = text[index]
        following = text[index + 1] if index + 1 < len(text) else ""
        if state == "normal":
            if char == "'":
                state = "single"
                output.append(" ")
            elif char == '"':
                state = "double"
                output.append(" ")
            elif char == "-" and following == "-":
                output.extend("  ")
                index += 1
                state = "line_comment"
            elif char == "/" and following == "*":
                output.extend("  ")
                index += 1
                state = "block_comment"
                block_depth = 1
            elif char == "$":
                match = re.match(r"\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$", text[index:])
                if match:
                    dollar_tag = match.group(0)
                    output.extend(" " * len(dollar_tag))
                    index += len(dollar_tag) - 1
                    state = "dollar"
                else:
                    output.append(char)
            else:
                output.append(char)
        elif state == "single":
            output.append(" ")
            if char == "'" and following == "'":
                output.append(" ")
                index += 1
            elif char == "'":
                state = "normal"
        elif state == "double":
            output.append(" ")
            if char == '"' and following == '"':
                output.append(" ")
                index += 1
            elif char == '"':
                state = "normal"
        elif state == "line_comment":
            output.append("\n" if char == "\n" else " ")
            if char == "\n":
                state = "normal"
        elif state == "block_comment":
            output.append(" ")
            if char == "/" and following == "*":
                output.append(" ")
                index += 1
                block_depth += 1
            elif char == "*" and following == "/":
                output.append(" ")
                index += 1
                block_depth -= 1
                if block_depth == 0:
                    state = "normal"
        elif state == "dollar":
            if text.startswith(dollar_tag, index):
                output.extend(" " * len(dollar_tag))
                index += len(dollar_tag) - 1
                state = "normal"
                dollar_tag = ""
            else:
                output.append(" ")
        index += 1
    return "".join(output)


def dollar_quoted_bodies(text: str) -> list[str]:
    bodies: list[str] = []
    pattern = re.compile(r"\$([A-Za-z_][A-Za-z0-9_]*)?\$")
    position = 0
    while True:
        match = pattern.search(text, position)
        if match is None:
            break
        tag = match.group(0)
        end = text.find(tag, match.end())
        guarded(end >= 0, "migration_artifact")
        bodies.append(text[match.end():end])
        position = end + len(tag)
    return bodies


def normalize_migration_sql(raw: bytes) -> bytes:
    try:
        text = raw.decode("utf-8", errors="strict")
    except UnicodeDecodeError as error:
        raise GuardError("migration_artifact") from error
    statements = [statement for statement in split_sql_statements(text) if sql_top_level_mask(statement).strip(" ;\n\t")]
    guarded(bool(statements), "migration_artifact")

    def normalized_head(statement: str) -> str:
        return re.sub(r"\s+", " ", sql_top_level_mask(statement).strip(" ;\n\t")).upper()

    heads = [normalized_head(statement) for statement in statements]
    if heads[0] == "BEGIN" and heads[-1] == "COMMIT":
        statements, heads = statements[1:-1], heads[1:-1]
    guarded(bool(statements), "migration_artifact")
    transaction = re.compile(r"^(BEGIN|START\s+TRANSACTION|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE|SET\s+TRANSACTION)\b", re.I)
    allowed = re.compile(r"^(CREATE\s+TABLE|CREATE\s+(?:UNIQUE\s+)?INDEX|GRANT\b|COMMENT\s+ON\b|SET\s+LOCAL\s+(?:lock_timeout|statement_timeout)\b|SELECT\s+pg_advisory_xact_lock\b|DO\b|ALTER\s+TABLE\b.*\b(?:ADD|OWNER\s+TO)\b)", re.I | re.S)
    forbidden_ddl = re.compile(r"\b(DROP|TRUNCATE|REVOKE|CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE|TRIGGER|POLICY))\b", re.I)
    for statement, head in zip(statements, heads, strict=True):
        guarded(not transaction.match(head), "migration_transaction")
        guarded(allowed.match(head) is not None and forbidden_ddl.search(head) is None, "migration_artifact")
        guarded(not re.match(r"^(INSERT|UPDATE|DELETE|MERGE|COPY|CALL|EXECUTE)\b", head, re.I), "migration_artifact")
        if re.match(r"^DO\b", head, re.I):
            bodies = dollar_quoted_bodies(statement)
            guarded(len(bodies) == 1, "migration_artifact")
            body = sql_top_level_mask(bodies[0])
            guarded(not re.search(r"\b(INSERT|UPDATE|DELETE|MERGE|COPY|CALL|EXECUTE|PERFORM|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|COMMIT|ROLLBACK|SAVEPOINT|START\s+TRANSACTION|SET\s+TRANSACTION)\b", body, re.I), "migration_artifact")
    return ("\n".join(statement.rstrip().rstrip(";") + ";" for statement in statements) + "\n").encode()


def validate_migration_sql(raw: bytes) -> None:
    normalize_migration_sql(raw)


def validate_verification_sql(raw: bytes) -> None:
    try:
        text = raw.decode("utf-8", errors="strict").strip()
    except UnicodeDecodeError as error:
        raise GuardError("migration_verify") from error
    guarded(
        bool(re.match(r"^(select|with)\b", text, re.I))
        and not re.search(r"\b(insert|update|delete|merge|copy|call|execute|create|alter|drop|truncate|grant|revoke)\b", text, re.I),
        "migration_verify",
    )


class Operator:
    def __init__(self, pins: Pins, system: System) -> None:
        self.pins, self.system = pins, system
        self.probes: list[Mapping[str, Any]] = []
        self.baseline_config: Mapping[str, Any] | None = None
        self.candidate_config: Mapping[str, Any] | None = None

    def image(self) -> None:
        value = self.system.json_command(["docker", "image", "inspect", self.pins.image], "image")
        guarded(isinstance(value, list) and len(value) == 1 and value[0].get("Id") == self.pins.image, "image")
        labels = value[0].get("Config", {}).get("Labels", {})
        guarded(isinstance(labels, Mapping) and labels.get("com.phone11.source-sha") == self.pins.release_sha and labels.get("com.phone11.bundle-sha256") == self.pins.bundle_sha256 and labels.get("com.phone11.lock-sha256") == self.pins.lock_sha256, "image")

    def wake(self) -> None:
        raw = self.system.command(["docker", "exec", "p11-kamailio", "cat", self.pins.kamailio_path])
        guarded(sha256_bytes(raw) == self.pins.kamailio_sha256 and raw.count(WAKE_URL.encode()) == self.pins.wake_occurrences, "wake_target")

    def nginx(self) -> bytes:
        raw = pinned_read(self.pins.nginx_site, self.pins.nginx_site_sha256, "nginx", mode=None)
        guarded(raw.count(self.pins.nginx_marker.encode()) == 1, "nginx")
        current_port = CANDIDATE_PORT if self.pins.route == "candidate" else BASELINE_PORT
        current_build = self.pins.candidate.build if self.pins.route == "candidate" else self.pins.baseline.build
        current_fragment = proxy_fragment(
            self.pins.nginx_marker,
            port=current_port,
            build=current_build,
            candidate=self.pins.route == "candidate",
        ).rstrip(b"\n")
        guarded(raw.count(current_fragment) == 1, "nginx")
        guarded(raw.count(b"location = /api/trpc") == 1 and raw.count(b"location ^~ /api/trpc/") == 1, "nginx")
        guarded(sha256_bytes(self.system.command(["nginx", "-T"])) == self.pins.nginx_dump_sha256, "nginx")
        self.system.command(["nginx", "-t"])
        return raw

    def guard(
        self,
        phase: str,
        *,
        since_ms: int | None = None,
        require_readiness: bool = True,
        require_wake: bool | None = None,
        require_fence: bool = False,
        expected_fence_id: str | None = None,
        min_fence_remaining_ms: int = 0,
    ) -> Mapping[str, Any]:
        pinned_read(self.pins.guard_program, self.pins.guard_sha256, "guard_program", mode=0o700)
        command = [str(self.pins.guard_program), "--phase", phase]
        if since_ms is not None:
            guarded(type(since_ms) is int and since_ms > 0, "idle_guard")
            command.extend(["--since-epoch-ms", str(since_ms)])
        value = self.system.json_command(command, "idle_guard", timeout=30)
        exact_keys(value, {"schema", "sampled_at_epoch_ms", "coverage", "admission_fence_id", "admission_fence_active", "admission_fence_expires_at_epoch_ms", "admission_fence_coverage", "admission_fence_evidence_sha256", "idle", "freeswitch_channels", "kamailio_dialogs", "relay_calls", "sip_transactions_active", "active_conference_jobs", "active_recording_jobs", "active_media_jobs", "active_worker_jobs", "attempted_notifications", "new_attempted_notifications", "failed_notifications", "pending_notifications", "wake_ready", "notifications_ready"}, "idle_guard")
        guarded(value.get("schema") == GUARD_SCHEMA and value.get("idle") is True, "idle_guard")
        coverage = value.get("coverage")
        guarded(isinstance(coverage, list) and set(coverage) == EXPECTED_GUARD_COVERAGE and len(coverage) == len(EXPECTED_GUARD_COVERAGE), "idle_guard")
        sampled = value.get("sampled_at_epoch_ms")
        now = int(time.time() * 1000)
        guarded(type(sampled) is int and now - 60_000 <= sampled <= now + 5_000, "idle_guard")
        fence_id = value.get("admission_fence_id")
        fence_active = value.get("admission_fence_active")
        fence_expires = value.get("admission_fence_expires_at_epoch_ms")
        fence_coverage = value.get("admission_fence_coverage")
        fence_evidence = value.get("admission_fence_evidence_sha256")
        guarded(
            isinstance(fence_id, str) and type(fence_active) is bool and type(fence_expires) is int
            and isinstance(fence_coverage, list) and set(fence_coverage) == EXPECTED_FENCE_COVERAGE
            and len(fence_coverage) == len(EXPECTED_FENCE_COVERAGE)
            and is_sha256(fence_evidence),
            "admission_fence",
        )
        if require_fence:
            expected = expected_fence_id or self.pins.guard_fence_id
            guarded(
                fence_active is True and fence_id == expected == self.pins.guard_fence_id
                and fence_evidence == self.pins.guard_fence_evidence_sha256
                and fence_expires >= now + min_fence_remaining_ms,
                "admission_fence",
            )
        guarded(all(value.get(key) == 0 for key in EXPECTED_GUARD_COVERAGE), "idle_guard")
        wake_required = require_readiness if require_wake is None else require_wake
        guarded(not wake_required or value.get("wake_ready") is True, "idle_guard")
        guarded(not require_readiness or value.get("notifications_ready") is True, "idle_guard")
        for key in ("attempted_notifications", "new_attempted_notifications", "failed_notifications", "pending_notifications"):
            guarded(type(value.get(key)) is int and value[key] >= 0, "idle_guard")
        guarded(since_ms is None or value["new_attempted_notifications"] == 0, "stranded_notification")
        return value

    def migration_files(self) -> tuple[bytes, bytes]:
        migrations: list[bytes] = []
        for artifact in self.pins.migration_artifacts:
            raw = pinned_read(artifact.path, artifact.sha256, "migration_artifact")
            migrations.append(normalize_migration_sql(raw))
        verify = pinned_read(self.pins.migration_verify, self.pins.migration_verify_sha256, "migration_verify")
        validate_verification_sql(verify)
        return b"\n".join(migrations), verify

    def migration_artifact_contract(self) -> list[Mapping[str, str]]:
        return [{"name": artifact.name, "sha256": artifact.sha256} for artifact in self.pins.migration_artifacts]

    def migration_bundle_sha256(self) -> str:
        return canonical_hash(self.migration_artifact_contract())

    def database(self, action: str, *, expected_catalog: str | None = None) -> Mapping[str, Any]:
        migration, verify = self.migration_files()
        expected = expected_catalog or (self.pins.after_catalog_sha256 if self.pins.migration_receipt_sha256 else self.pins.before_catalog_sha256)
        payload = canonical_bytes({
            "action": action, "database_sha256": self.pins.database_sha256,
            "expected_catalog_sha256": expected, "before_catalog_sha256": self.pins.before_catalog_sha256,
            "after_catalog_sha256": self.pins.after_catalog_sha256,
            "migration_b64": base64.b64encode(migration).decode(), "verify_b64": base64.b64encode(verify).decode(),
        })
        value = self.system.json_command(["docker", "exec", "-i", BASELINE_CONTAINER, "node", "-e", MIGRATION_NODE], "migration", timeout=45, stdin=payload)
        guarded(isinstance(value, Mapping) and value.get("database_sha256") == self.pins.database_sha256, "migration")
        expected_result = self.pins.after_catalog_sha256 if action == "apply" else expected
        guarded(value.get("catalog_sha256") == expected_result, "migration")
        return value

    def receipt(self) -> None:
        if self.pins.migration_receipt_sha256 is None:
            guarded(not os.path.lexists(self.pins.migration_receipt), "migration_receipt")
            return
        raw = pinned_read(self.pins.migration_receipt, self.pins.migration_receipt_sha256, "migration_receipt")
        value = strict_json(raw, "migration_receipt")
        exact_keys(value, {"schema", "status", "artifact_sha256", "artifacts", "database_sha256", "catalog_sha256", "verification_sha256"}, "migration_receipt")
        guarded(value == {"schema": RECEIPT_SCHEMA, "status": "applied", "artifact_sha256": self.migration_bundle_sha256(), "artifacts": self.migration_artifact_contract(), "database_sha256": self.pins.database_sha256, "catalog_sha256": self.pins.after_catalog_sha256, "verification_sha256": self.pins.migration_verify_sha256}, "migration_receipt")

    def current(self, baseline_config: Mapping[str, Any], candidate_config: Mapping[str, Any], *, require_baseline_healthy: bool = True) -> None:
        validate_runtime(
            self.system, BASELINE_CONTAINER, self.pins.baseline,
            role="default", port=BASELINE_PORT, require_healthy=require_baseline_healthy,
            compose_project=baseline_config["name"], compose_service=self.pins.baseline_compose.service,
        )
        validate_runtime(
            self.system, CANDIDATE_CONTAINER, self.pins.candidate,
            role="api-candidate", port=CANDIDATE_PORT,
            compose_project=candidate_config["name"], compose_service=self.pins.candidate_compose.service,
        )
        self.require_worker_topology(baseline_config, candidate_config, require_default_running=True if require_baseline_healthy else None)

    def require_worker_topology(self, baseline_config: Mapping[str, Any], candidate_config: Mapping[str, Any], *, require_default_running: bool | None = True) -> None:
        names = self.system.command(["docker", "ps", "-a", "--format", "{{.Names}}"])
        try:
            inventory = [line.decode() for line in names.splitlines() if line]
        except UnicodeDecodeError as error:
            raise GuardError("runtime_count") from error
        defaults = 0
        expected_images = {self.pins.baseline.image, self.pins.candidate.image, self.pins.image, self.pins.rollback_image}
        projects = {baseline_config["name"], candidate_config["name"]}
        services = {self.pins.baseline_compose.service, self.pins.candidate_compose.service}
        for name in inventory:
            inspect = one_inspect(self.system, name, "runtime_count")
            env = environment(inspect, "runtime_count")
            labels = inspect.get("Config", {}).get("Labels")
            state = inspect.get("State")
            guarded(isinstance(labels, Mapping) and isinstance(state, Mapping), "runtime_count")
            phone11_like = (
                name in {BASELINE_CONTAINER, CANDIDATE_CONTAINER}
                or inspect.get("Image") in expected_images
                or labels.get("com.docker.compose.project") in projects
                or labels.get("com.docker.compose.service") in services
                or any(key in env for key in ("PHONE11_RUNTIME_ROLE", "PHONE11_WAKE_ENABLED", "PHONE11_CHAT_NOTIFICATIONS_ENABLED", "PHONE11_BUILD_SHA"))
            )
            if not phone11_like:
                continue
            role = env.get("PHONE11_RUNTIME_ROLE", "default")
            if name == BASELINE_CONTAINER:
                guarded(role == "default", "runtime_count")
                if state.get("Running") is True:
                    defaults += 1
            elif name == CANDIDATE_CONTAINER:
                guarded(role == "api-candidate", "runtime_count")
            else:
                raise GuardError("unknown_worker")
        guarded(defaults <= 1 and (require_default_running is None or defaults == (1 if require_default_running else 0)), "runtime_count")

    def compose_inputs(self) -> tuple[Mapping[str, Any], Mapping[str, Any]]:
        baseline = render_compose(self.system, self.pins.baseline_compose, container=BASELINE_CONTAINER, image=self.pins.image, build=self.pins.release_build, role="default", port=BASELINE_PORT, notifications="1")
        candidate = render_compose(self.system, self.pins.candidate_compose, container=CANDIDATE_CONTAINER, image=self.pins.image, build=self.pins.release_build, role="api-candidate", port=CANDIDATE_PORT, notifications=None)
        rollback = render_compose(self.system, self.pins.rollback_compose, container=BASELINE_CONTAINER, image=self.pins.rollback_image, build=self.pins.rollback_build, role="default", port=BASELINE_PORT, notifications="1")
        disabled = render_compose(self.system, self.pins.rollback_disabled_compose, container=BASELINE_CONTAINER, image=self.pins.rollback_image, build=self.pins.rollback_build, role="default", port=BASELINE_PORT, notifications="0")
        guarded(canonical_hash(normalized_release_compose(baseline, self.pins.baseline_compose.service)) == canonical_hash(normalized_release_compose(rollback, self.pins.rollback_compose.service)), "baseline_delta")
        guarded(canonical_hash(normalized_release_compose(disabled, self.pins.rollback_disabled_compose.service, disabled=True)) == canonical_hash(normalized_release_compose(rollback, self.pins.rollback_compose.service)), "rollback_delta")
        self.baseline_config, self.candidate_config = baseline, candidate
        return baseline, candidate

    def prepare(self) -> None:
        guarded(self.pins.profile_gate_committed == (self.pins.migration_receipt_sha256 is not None), "migration_receipt")
        self.image()
        baseline_config, candidate_config = self.compose_inputs()
        self.current(baseline_config, candidate_config)
        self.receipt()
        self.database("inspect")
        self.probes = load_probes(pinned_read(self.pins.probes_file, self.pins.probes_sha256, "probes"))
        self.nginx()
        self.wake()
        self.guard("prepare")

    def rollback_preflight(self) -> tuple[Mapping[str, Any], Mapping[str, Any], RuntimePin | None, tuple[str, str] | None]:
        """Validate rollback inputs without requiring either service healthy."""
        guarded(self.pins.profile_gate_committed and self.pins.migration_receipt_sha256 is not None, "dnd_exposure")
        self.image()
        baseline_config, candidate_config = self.compose_inputs()
        self.receipt()
        self.probes = load_probes(pinned_read(self.pins.probes_file, self.pins.probes_sha256, "probes"))
        self.nginx()
        self.wake()
        before_pin, stop = self.rollback_baseline_identity(baseline_config)
        validate_runtime(
            self.system, CANDIDATE_CONTAINER, self.pins.candidate,
            role="api-candidate", port=CANDIDATE_PORT, require_healthy=False,
            compose_project=candidate_config["name"], compose_service=self.pins.candidate_compose.service,
        )
        self.require_worker_topology(baseline_config, candidate_config, require_default_running=None)
        return baseline_config, candidate_config, before_pin, stop

    def apply_migration(self) -> None:
        guarded(self.pins.route == "baseline" and not self.pins.profile_gate_committed, "migration_order")
        guarded(self.pins.migration_receipt_sha256 is None, "migration_receipt")
        self.image()
        baseline_config, candidate_config = self.compose_inputs()
        self.current(baseline_config, candidate_config)
        self.validate_replacement_receipt(
            action="replace_baseline", pin=self.pins.baseline,
            path=BASELINE_RECEIPT, notifications="enabled",
        )
        self.validate_replacement_receipt(
            action="replace_candidate", pin=self.pins.candidate,
            path=CANDIDATE_RECEIPT, notifications=None,
        )
        self.receipt()
        self.probes = load_probes(pinned_read(self.pins.probes_file, self.pins.probes_sha256, "probes"))
        self.nginx()
        self.wake()
        self.guard("apply-migration")
        try:
            self.database("inspect", expected_catalog=self.pins.before_catalog_sha256)
            result = self.database("apply")
        except GuardError as before_error:
            # Receipt publication may fail after the transaction commits.  A
            # retry recovers only when the exact reviewed post-state is present.
            try:
                result = self.database("inspect", expected_catalog=self.pins.after_catalog_sha256)
            except GuardError:
                raise before_error
        receipt = canonical_bytes({"schema": RECEIPT_SCHEMA, "status": "applied", "artifact_sha256": self.migration_bundle_sha256(), "artifacts": self.migration_artifact_contract(), "database_sha256": self.pins.database_sha256, "catalog_sha256": result["catalog_sha256"], "verification_sha256": self.pins.migration_verify_sha256})
        guarded(not os.path.lexists(self.pins.migration_receipt), "migration_receipt")
        ensure_private_directory(self.pins.migration_receipt.parent, create=False)
        atomic_write(self.pins.migration_receipt, receipt)

    def stop_gracefully(self, name: str, container_id: str) -> Mapping[str, Any]:
        self.system.command(
            ["docker", "stop", "--time", str(DOCKER_STOP_SECONDS), name],
            timeout=DOCKER_STOP_SECONDS + 10,
        )
        stopped = one_inspect(self.system, container_id, "graceful_stop")
        state = stopped.get("State")
        guarded(
            stopped.get("Id") == container_id and isinstance(state, Mapping)
            and state.get("Running") is False and state.get("OOMKilled") is not True
            and state.get("ExitCode") == 0,
            "graceful_stop",
        )
        return stopped

    def save_shutdown_receipt(
        self,
        path: Path,
        *,
        action: str,
        before: RuntimePin,
        stopped: Mapping[str, Any],
        stopped_guard: Mapping[str, Any],
    ) -> None:
        state = stopped.get("State")
        finished_at = state.get("FinishedAt") if isinstance(state, Mapping) else None
        guarded(
            path == BASELINE_SHUTDOWN_RECEIPT
            and action == "replace_baseline"
            and before == self.pins.baseline
            and stopped.get("Id") == before.container_id
            and isinstance(state, Mapping)
            and state.get("Running") is False
            and state.get("OOMKilled") is False
            and state.get("ExitCode") == 0
            and isinstance(finished_at, str)
            and bool(re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[^\r\n]{1,64}Z", finished_at)),
            "shutdown_receipt",
        )
        guarded(
            stopped_guard.get("admission_fence_id") == self.pins.guard_fence_id
            and type(stopped_guard.get("sampled_at_epoch_ms")) is int,
            "shutdown_receipt",
        )
        ensure_private_directory(STATE_ROOT, create=True)
        guarded(not os.path.lexists(path), "shutdown_receipt")
        atomic_write_exclusive(path, canonical_bytes({
            "schema": SHUTDOWN_RECEIPT_SCHEMA,
            "operation_id": self.pins.baseline_operation_id,
            "action": action,
            "baseline_intent_sha256": self.pins.baseline_intent_sha256,
            "container_name": BASELINE_CONTAINER,
            "container_id": before.container_id,
            "image": before.image,
            "build": before.build,
            "runtime_sha256": before.runtime_sha256,
            "exit_code": 0,
            "oom_killed": False,
            "finished_at": finished_at,
            "stopped_guard_sha256": canonical_hash(stopped_guard),
            "stopped_sampled_at_epoch_ms": stopped_guard["sampled_at_epoch_ms"],
            "admission_fence_id": self.pins.guard_fence_id,
        }))

    def named_container_id(self, name: str) -> str | None:
        raw = self.system.command(["docker", "ps", "-aq", "--no-trunc", "--filter", f"name=^/{name}$"])
        try:
            values = [line.decode("ascii") for line in raw.splitlines() if line]
        except UnicodeDecodeError as error:
            raise GuardError("container_identity") from error
        guarded(len(values) <= 1 and all(re.fullmatch(r"[0-9a-f]{64}", value) for value in values), "container_identity")
        return values[0] if values else None

    def _up(
        self,
        document: Mapping[str, Any],
        pin: ComposePin,
        *,
        stop: tuple[str, str] | None = None,
        fence_id: str | None = None,
        since_ms: int | None = None,
        stopped_phase: str = "runtime-stopped",
        shutdown_receipt: tuple[Path, str, RuntimePin] | None = None,
    ) -> Mapping[str, Any] | None:
        stopped_guard: Mapping[str, Any] | None = None
        if shutdown_receipt is not None:
            receipt_path, receipt_action, before = shutdown_receipt
            guarded(
                receipt_path == BASELINE_SHUTDOWN_RECEIPT
                and receipt_action == "replace_baseline"
                and before == self.pins.baseline
                and not os.path.lexists(receipt_path),
                "shutdown_receipt",
            )
        with frozen_compose(document) as frozen:
            if fence_id is not None:
                self.guard(
                    f"{stopped_phase}-before-stop" if stop is not None else f"{stopped_phase}-before-start",
                    since_ms=since_ms,
                    require_readiness=False,
                    require_fence=True,
                    expected_fence_id=fence_id,
                    min_fence_remaining_ms=150_000,
                )
            if stop is not None:
                stopped_runtime = self.stop_gracefully(*stop)
            if fence_id is not None:
                stopped_guard = self.guard(
                    stopped_phase,
                    since_ms=since_ms,
                    require_readiness=False,
                    require_fence=True,
                    expected_fence_id=fence_id,
                    min_fence_remaining_ms=100_000,
                )
            if shutdown_receipt is not None:
                guarded(stop is not None and stopped_guard is not None, "shutdown_receipt")
                self.save_shutdown_receipt(
                    receipt_path,
                    action=receipt_action,
                    before=before,
                    stopped=stopped_runtime,
                    stopped_guard=stopped_guard,
                )
            self.system.command(["docker", "compose", "--project-name", document["name"], "--project-directory", str(pin.path.parent), "-f", str(frozen), "up", "-d", "--no-deps", pin.service], timeout=90)
        return stopped_guard

    def save_runtime_receipt(
        self,
        path: Path,
        *,
        action: str,
        before: RuntimePin | None,
        after: Mapping[str, Any],
        after_image: str,
        after_build: str,
        notifications: str | None,
        before_attempted_notifications: int | None = None,
    ) -> None:
        ensure_private_directory(STATE_ROOT, create=True)
        guarded(not os.path.lexists(path), "runtime_receipt")
        atomic_write(path, canonical_bytes({
            "schema": SCHEMA, "action": action,
            "before_container_id": before.container_id if before is not None else None,
            "before_image": before.image if before is not None else None,
            "before_runtime_sha256": before.runtime_sha256 if before is not None else None,
            "before_build": before.build if before is not None else None,
            "after_container_id": after.get("Id"), "after_image": after_image,
            "after_build": after_build, "after_runtime_sha256": canonical_hash(runtime_shape(after)),
            "ordinary_chat_notifications": notifications,
            "before_attempted_notifications": before_attempted_notifications,
        }))

    def baseline_intent_document(self, baseline_config: Mapping[str, Any]) -> Mapping[str, Any]:
        def runtime_contract(pin: RuntimePin) -> Mapping[str, Any]:
            return {
                "container_id": pin.container_id, "image": pin.image,
                "runtime_sha256": pin.runtime_sha256, "build": pin.build,
                "replacement_receipt_sha256": pin.replacement_receipt_sha256,
            }

        def compose_contract(pin: ComposePin) -> Mapping[str, Any]:
            return {
                "file": str(pin.path), "sha256": pin.sha256,
                "rendered_sha256": pin.rendered_sha256, "service": pin.service,
            }

        manifest_contract = {
            "schema": SCHEMA,
            "release": {
                "sha": self.pins.release_sha, "build": self.pins.release_build,
                "image": self.pins.image, "bundle_sha256": self.pins.bundle_sha256,
                "lock_sha256": self.pins.lock_sha256,
            },
            "current": {
                "baseline": runtime_contract(self.pins.baseline),
                "candidate": runtime_contract(self.pins.candidate),
            },
            "compose": {
                "baseline": compose_contract(self.pins.baseline_compose),
                "candidate": compose_contract(self.pins.candidate_compose),
            },
            "rollback": {
                "image": self.pins.rollback_image, "build": self.pins.rollback_build,
                "normalized_runtime_sha256": self.pins.rollback_normalized_runtime_sha256,
                "baseline_operation_id": self.pins.baseline_operation_id,
                "compose": compose_contract(self.pins.rollback_compose),
                "disabled_compose": compose_contract(self.pins.rollback_disabled_compose),
            },
            "migration": {
                "artifacts": [
                    {"name": item.name, "file": str(item.path), "sha256": item.sha256}
                    for item in self.pins.migration_artifacts
                ],
                "verify": str(self.pins.migration_verify),
                "verify_sha256": self.pins.migration_verify_sha256,
                "database_sha256": self.pins.database_sha256,
                "before_catalog_sha256": self.pins.before_catalog_sha256,
                "after_catalog_sha256": self.pins.after_catalog_sha256,
                "receipt": str(self.pins.migration_receipt),
                "receipt_sha256": self.pins.migration_receipt_sha256,
            },
            "probes": {"file": str(self.pins.probes_file), "sha256": self.pins.probes_sha256},
            "guard": {
                "program": str(self.pins.guard_program), "sha256": self.pins.guard_sha256,
                "fence_id": self.pins.guard_fence_id,
                "fence_evidence_sha256": self.pins.guard_fence_evidence_sha256,
            },
            "nginx": {
                "site": str(self.pins.nginx_site), "site_sha256": self.pins.nginx_site_sha256,
                "dump_sha256": self.pins.nginx_dump_sha256, "marker": self.pins.nginx_marker,
                "route": self.pins.route, "profile_gate_committed": self.pins.profile_gate_committed,
            },
            "kamailio": {
                "config_path": self.pins.kamailio_path,
                "config_sha256": self.pins.kamailio_sha256,
                "wake_occurrences": self.pins.wake_occurrences,
            },
            "public_origin": self.pins.public_origin,
        }
        return {
            "schema": INTENT_SCHEMA,
            "operation_id": self.pins.baseline_operation_id,
            "phase": "replace_baseline",
            "profile_gate_committed": self.pins.profile_gate_committed,
            "manifest_contract_sha256": canonical_hash(manifest_contract),
            "before_container_id": self.pins.baseline.container_id,
            "desired": {
                "container_name": BASELINE_CONTAINER,
                "image": self.pins.image,
                "build": self.pins.release_build,
                "normalized_runtime_sha256": self.pins.rollback_normalized_runtime_sha256,
                "compose_sha256": self.pins.baseline_compose.sha256,
                "compose_rendered_sha256": self.pins.baseline_compose.rendered_sha256,
                "compose_project": baseline_config["name"],
                "compose_service": self.pins.baseline_compose.service,
                "runtime_role": "default",
                "port": BASELINE_PORT,
                "ordinary_chat_notifications": "1",
            },
        }

    def write_baseline_intent(self, baseline_config: Mapping[str, Any]) -> None:
        ensure_private_directory(STATE_ROOT, create=True)
        raw = canonical_bytes(self.baseline_intent_document(baseline_config))
        guarded(sha256_bytes(raw) == self.pins.baseline_intent_sha256, "baseline_intent")
        atomic_write_exclusive(BASELINE_INTENT, raw)

    def validate_baseline_intent(self, baseline_config: Mapping[str, Any]) -> Mapping[str, Any]:
        raw = pinned_read(BASELINE_INTENT, self.pins.baseline_intent_sha256, "baseline_intent")
        intent = strict_json(raw, "baseline_intent")
        guarded(intent == self.baseline_intent_document(baseline_config), "baseline_intent")
        return intent

    def validate_desired_baseline_identity(
        self,
        inspect: Mapping[str, Any],
        *,
        before_container_id: str,
        baseline_config: Mapping[str, Any],
    ) -> RuntimePin:
        container_id = inspect.get("Id")
        state = inspect.get("State")
        labels = inspect.get("Config", {}).get("Labels")
        env = environment(inspect, "baseline_identity")
        bindings = inspect.get("HostConfig", {}).get("PortBindings", {}).get(f"{BASELINE_PORT}/tcp")
        guarded(
            isinstance(container_id, str) and bool(re.fullmatch(r"[0-9a-f]{64}", container_id))
            and container_id != before_container_id and inspect.get("Image") == self.pins.image
            and isinstance(state, Mapping) and isinstance(labels, Mapping)
            and labels.get("com.docker.compose.project") == baseline_config["name"]
            and labels.get("com.docker.compose.service") == self.pins.baseline_compose.service
            and env.get("PHONE11_RUNTIME_ROLE", "default") == "default"
            and env.get("PHONE11_BUILD_SHA") == self.pins.release_build
            and env.get("PORT", str(BASELINE_PORT)) == str(BASELINE_PORT)
            and env.get("PHONE11_CHAT_NOTIFICATIONS_ENABLED") == "1"
            and bindings == [{"HostIp": "127.0.0.1", "HostPort": str(BASELINE_PORT)}],
            "baseline_identity",
        )
        normalized_sha = canonical_hash(normalized_runtime_release(inspect, normalize_notifications=True))
        guarded(normalized_sha == self.pins.rollback_normalized_runtime_sha256, "baseline_identity")
        return RuntimePin(container_id, self.pins.image, canonical_hash(runtime_shape(inspect)), self.pins.release_build, None)

    def rollback_baseline_identity(self, baseline_config: Mapping[str, Any]) -> tuple[RuntimePin | None, tuple[str, str] | None]:
        current_id = self.named_container_id(BASELINE_CONTAINER)
        if current_id is None:
            return None, None
        if current_id == self.pins.baseline.container_id:
            pin = self.pins.baseline
            inspect = validate_runtime(
                self.system, BASELINE_CONTAINER, pin,
                role="default", port=BASELINE_PORT, require_healthy=False,
                compose_project=baseline_config["name"], compose_service=self.pins.baseline_compose.service,
            )
        else:
            self.validate_baseline_intent(baseline_config)
            inspect = one_inspect(self.system, BASELINE_CONTAINER, "baseline_identity")
            pin = self.validate_desired_baseline_identity(
                inspect,
                before_container_id=self.pins.baseline.container_id,
                baseline_config=baseline_config,
            )
            guarded(pin.container_id == current_id, "baseline_identity")
        env = environment(inspect, "baseline_identity")
        guarded(env.get("PHONE11_CHAT_NOTIFICATIONS_ENABLED") == "1", "baseline_identity")
        guarded(
            canonical_hash(normalized_runtime_release(inspect, normalize_notifications=True))
            == self.pins.rollback_normalized_runtime_sha256,
            "baseline_identity",
        )
        return pin, (BASELINE_CONTAINER, current_id)

    def validate_replacement_receipt(self, *, action: str, pin: RuntimePin, path: Path, notifications: str | None) -> None:
        guarded(pin.image == self.pins.image and pin.build == self.pins.release_build, "release_target")
        guarded(pin.replacement_receipt_sha256 is not None, "replacement_receipt")
        raw = pinned_read(path, pin.replacement_receipt_sha256, "replacement_receipt")
        receipt = strict_json(raw, "replacement_receipt")
        exact_keys(receipt, {"schema", "action", "before_container_id", "before_image", "before_runtime_sha256", "before_build", "after_container_id", "after_image", "after_build", "after_runtime_sha256", "ordinary_chat_notifications", "before_attempted_notifications"}, "replacement_receipt")
        guarded(
            receipt.get("schema") == SCHEMA and receipt.get("action") == action
            and receipt.get("after_container_id") == pin.container_id
            and receipt.get("after_image") == pin.image == self.pins.image
            and receipt.get("after_build") == pin.build == self.pins.release_build
            and receipt.get("after_runtime_sha256") == pin.runtime_sha256
            and receipt.get("ordinary_chat_notifications") == notifications,
            "replacement_receipt",
        )

    def replace_baseline(self) -> None:
        self.prepare()
        self.receipt()
        guarded(not os.path.lexists(BASELINE_INTENT), "baseline_intent")
        before = self.guard("replace-baseline-before", require_fence=True, min_fence_remaining_ms=150_000)
        old = validate_runtime(self.system, BASELINE_CONTAINER, self.pins.baseline, role="default", port=BASELINE_PORT)
        document = render_compose(self.system, self.pins.baseline_compose, container=BASELINE_CONTAINER, image=self.pins.image, build=self.pins.release_build, role="default", port=BASELINE_PORT, notifications="1")
        self.wake()
        self.write_baseline_intent(document)
        try:
            stopped = self._up(
                document,
                self.pins.baseline_compose,
                stop=(BASELINE_CONTAINER, self.pins.baseline.container_id),
                fence_id=before["admission_fence_id"],
                since_ms=before["sampled_at_epoch_ms"],
                stopped_phase="replace-baseline-stopped",
                shutdown_receipt=(BASELINE_SHUTDOWN_RECEIPT, "replace_baseline", self.pins.baseline),
            )
            guarded(stopped is not None, "admission_fence")
            replacement = one_inspect(self.system, BASELINE_CONTAINER, "baseline_replacement")
            self.validate_desired_baseline_identity(
                replacement,
                before_container_id=self.pins.baseline.container_id,
                baseline_config=document,
            )
            state = replacement.get("State", {})
            guarded(replacement.get("Id") != old.get("Id") and replacement.get("Image") == self.pins.image and state.get("Running") is True and state.get("OOMKilled") is not True and state.get("ExitCode", 0) == 0, "baseline_replacement")
            env = environment(replacement, "baseline_replacement")
            guarded(env.get("PHONE11_RUNTIME_ROLE", "default") == "default" and env.get("PHONE11_BUILD_SHA") == self.pins.release_build and env.get("PHONE11_CHAT_NOTIFICATIONS_ENABLED") == "1", "baseline_replacement")
            guarded(canonical_hash(normalized_runtime_release(replacement)) == canonical_hash(normalized_runtime_release(old)), "baseline_runtime_delta")
            guarded(self.baseline_config is not None and self.candidate_config is not None, "runtime_count")
            self.require_worker_topology(self.baseline_config, self.candidate_config)
            health(self.system, BASELINE_PORT, self.pins.release_build, "default")
            after = self.guard("replace-baseline-after", since_ms=stopped["sampled_at_epoch_ms"], require_fence=True, expected_fence_id=before["admission_fence_id"])
            self.wake()
            self.save_runtime_receipt(BASELINE_RECEIPT, action="replace_baseline", before=self.pins.baseline, after=replacement, after_image=self.pins.image, after_build=self.pins.release_build, notifications="enabled", before_attempted_notifications=before["attempted_notifications"])
        except GuardError as error:
            # Before profile/DND exposure, the pinned ordinary-alert rollback is
            # safe.  After exposure, operators must use the explicit disabled
            # rollback phase; an automatic old dispatcher restart is forbidden.
            if not self.pins.profile_gate_committed:
                try:
                    rollback = render_compose(self.system, self.pins.rollback_compose, container=BASELINE_CONTAINER, image=self.pins.rollback_image, build=self.pins.rollback_build, role="default", port=BASELINE_PORT, notifications="1")
                    rollback_guard = self.guard("baseline-auto-rollback", require_readiness=False, require_fence=True, expected_fence_id=before["admission_fence_id"], min_fence_remaining_ms=150_000)
                    current_id = self.named_container_id(BASELINE_CONTAINER)
                    stop = (BASELINE_CONTAINER, current_id) if current_id is not None else None
                    rollback_stopped = self._up(rollback, self.pins.rollback_compose, stop=stop, fence_id=rollback_guard["admission_fence_id"], since_ms=rollback_guard["sampled_at_epoch_ms"], stopped_phase="baseline-auto-rollback-stopped")
                    restored = one_inspect(self.system, BASELINE_CONTAINER, "baseline_auto_rollback")
                    restored_env = environment(restored, "baseline_auto_rollback")
                    guarded(restored.get("Image") == self.pins.rollback_image and restored_env.get("PHONE11_CHAT_NOTIFICATIONS_ENABLED") == "1", "baseline_auto_rollback")
                    guarded(canonical_hash(normalized_runtime_release(restored)) == canonical_hash(normalized_runtime_release(old)), "baseline_auto_rollback")
                    health(self.system, BASELINE_PORT, self.pins.rollback_build, "default")
                    guarded(self.baseline_config is not None and self.candidate_config is not None, "runtime_count")
                    self.require_worker_topology(self.baseline_config, self.candidate_config)
                    since = rollback_stopped["sampled_at_epoch_ms"] if rollback_stopped is not None else rollback_guard["sampled_at_epoch_ms"]
                    self.guard("baseline-auto-rollback-after", since_ms=since, require_fence=True, expected_fence_id=before["admission_fence_id"])
                    self.wake()
                except GuardError as rollback_error:
                    raise GuardError("rollback_failed") from rollback_error
            raise error

    def replace_candidate(self) -> None:
        self.prepare()
        guarded(self.pins.route == "baseline" and not self.pins.profile_gate_committed and self.pins.migration_receipt_sha256 is None, "route_state")
        self.validate_replacement_receipt(
            action="replace_baseline", pin=self.pins.baseline,
            path=BASELINE_RECEIPT, notifications="enabled",
        )
        document = render_compose(self.system, self.pins.candidate_compose, container=CANDIDATE_CONTAINER, image=self.pins.image, build=self.pins.release_build, role="api-candidate", port=CANDIDATE_PORT, notifications=None)
        old = validate_runtime(self.system, CANDIDATE_CONTAINER, self.pins.candidate, role="api-candidate", port=CANDIDATE_PORT)
        self._up(document, self.pins.candidate_compose, stop=(CANDIDATE_CONTAINER, self.pins.candidate.container_id))
        inspect = one_inspect(self.system, CANDIDATE_CONTAINER, "candidate_replacement")
        env = environment(inspect, "candidate_replacement")
        guarded(inspect.get("Id") != old.get("Id") and inspect.get("Image") == self.pins.image and inspect.get("State", {}).get("Running") is True and env.get("PHONE11_RUNTIME_ROLE") == "api-candidate" and env.get("PORT") == str(CANDIDATE_PORT), "candidate_replacement")
        guarded(canonical_hash(normalized_runtime_release(inspect)) == canonical_hash(normalized_runtime_release(old)), "candidate_runtime_delta")
        guarded(self.baseline_config is not None and self.candidate_config is not None, "runtime_count")
        self.require_worker_topology(self.baseline_config, self.candidate_config)
        health(self.system, CANDIDATE_PORT, self.pins.release_build, "api-candidate")
        run_probes(self.system, "http://127.0.0.1:3002", self.probes)
        self.wake()
        self.save_runtime_receipt(CANDIDATE_RECEIPT, action="replace_candidate", before=self.pins.candidate, after=inspect, after_image=self.pins.image, after_build=self.pins.release_build, notifications=None)

    def _route(self, target: str) -> None:
        self.prepare()
        if target == "baseline":
            validate_runtime(self.system, BASELINE_CONTAINER, self.pins.baseline, role="default", port=BASELINE_PORT)
            self.validate_replacement_receipt(action="replace_baseline", pin=self.pins.baseline, path=BASELINE_RECEIPT, notifications="enabled")
        else:
            validate_runtime(self.system, CANDIDATE_CONTAINER, self.pins.candidate, role="api-candidate", port=CANDIDATE_PORT)
            self.validate_replacement_receipt(action="replace_candidate", pin=self.pins.candidate, path=CANDIDATE_RECEIPT, notifications=None)
        target_port = BASELINE_PORT if target == "baseline" else CANDIDATE_PORT
        target_build = self.pins.release_build
        candidate = target == "candidate"
        original = self.nginx()
        current_port = CANDIDATE_PORT if self.pins.route == "candidate" else BASELINE_PORT
        current_build = self.pins.candidate.build if self.pins.route == "candidate" else self.pins.baseline.build
        current_fragment = proxy_fragment(self.pins.nginx_marker, port=current_port, build=current_build, candidate=self.pins.route == "candidate").rstrip(b"\n")
        target_fragment = proxy_fragment(self.pins.nginx_marker, port=target_port, build=target_build, candidate=candidate).rstrip(b"\n")
        routed = original.replace(current_fragment, target_fragment, 1)
        guarded(routed != original and routed.count(b"location = /api/trpc") == 1 and routed.count(b"location ^~ /api/trpc/") == 1, "nginx_route")
        ensure_private_directory(STATE_ROOT, create=True)
        atomic_write(ROUTE_SITE, original)
        atomic_write(ROUTE_RECEIPT, canonical_bytes({"schema": SCHEMA, "site": str(self.pins.nginx_site), "before": sha256_bytes(original), "active": sha256_bytes(routed), "target": target}))
        info = self.pins.nginx_site.stat()
        guarded(self.nginx() == original, "nginx")
        try:
            atomic_write(self.pins.nginx_site, routed, mode=stat.S_IMODE(info.st_mode), uid=info.st_uid, gid=info.st_gid)
            self.system.command(["nginx", "-t"])
            self.system.command(["nginx", "-s", "reload"])
            run_probes(
                self.system,
                self.pins.public_origin,
                self.probes,
                candidate_build=self.pins.release_build if candidate else None,
                require_no_candidate_header=not candidate,
            )
            self.wake()
        except GuardError as error:
            try:
                current = secure_read(self.pins.nginx_site, mode=None)
                if current == routed:
                    self._restore_route(expected=routed)
                else:
                    guarded(current == original, "rollback_route")
            except GuardError as rollback_error:
                raise GuardError("rollback_failed") from rollback_error
            raise error

    def route_baseline(self) -> None:
        guarded(self.pins.route == "candidate" and not self.pins.profile_gate_committed, "route_state")
        self._route("baseline")

    def route_candidate(self) -> None:
        guarded(self.pins.route == "baseline" and self.pins.profile_gate_committed, "route_state")
        self._route("candidate")

    def _restore_route(self, *, expected: bytes | None = None) -> None:
        receipt = strict_json(secure_read(ROUTE_RECEIPT), "rollback_route")
        exact_keys(receipt, {"schema", "site", "before", "active", "target"}, "rollback_route")
        original = secure_read(ROUTE_SITE)
        current = secure_read(self.pins.nginx_site, mode=None)
        guarded(receipt.get("schema") == SCHEMA and receipt.get("site") == str(self.pins.nginx_site) and sha256_bytes(original) == receipt.get("before"), "rollback_route")
        if expected is None:
            guarded(receipt.get("target") == "candidate", "rollback_route")
        guarded(current == expected if expected is not None else sha256_bytes(current) == receipt.get("active"), "rollback_route")
        info = self.pins.nginx_site.stat()
        atomic_write(self.pins.nginx_site, original, mode=stat.S_IMODE(info.st_mode), uid=info.st_uid, gid=info.st_gid)
        self.system.command(["nginx", "-t"])
        self.system.command(["nginx", "-s", "reload"])
        self.wake()

    def rollback_route(self) -> None:
        guarded(self.pins.route == "candidate" and self.pins.profile_gate_committed, "route_state")
        validate_runtime(self.system, BASELINE_CONTAINER, self.pins.baseline, role="default", port=BASELINE_PORT)
        self.validate_replacement_receipt(action="replace_baseline", pin=self.pins.baseline, path=BASELINE_RECEIPT, notifications="enabled")
        self._restore_route()

    def rollback_baseline_disabled(self) -> None:
        guarded(self.pins.profile_gate_committed, "dnd_exposure")
        baseline_config, candidate_config, before_pin, stop = self.rollback_preflight()
        before_guard = self.guard("rollback-baseline-disabled-before", require_readiness=False, require_fence=True, min_fence_remaining_ms=150_000)
        document = render_compose(self.system, self.pins.rollback_disabled_compose, container=BASELINE_CONTAINER, image=self.pins.rollback_image, build=self.pins.rollback_build, role="default", port=BASELINE_PORT, notifications="0")
        self.wake()
        stopped = self._up(document, self.pins.rollback_disabled_compose, stop=stop, fence_id=before_guard["admission_fence_id"], since_ms=before_guard["sampled_at_epoch_ms"], stopped_phase="rollback-baseline-disabled-stopped")
        guarded(stopped is not None, "admission_fence")
        inspect = one_inspect(self.system, BASELINE_CONTAINER, "rollback_baseline_disabled")
        env = environment(inspect, "rollback_baseline_disabled")
        labels = inspect.get("Config", {}).get("Labels")
        guarded(
            isinstance(inspect.get("Id"), str) and bool(re.fullmatch(r"[0-9a-f]{64}", inspect["Id"]))
            and (before_pin is None or inspect.get("Id") != before_pin.container_id)
            and inspect.get("Image") == self.pins.rollback_image
            and inspect.get("State", {}).get("Running") is True
            and isinstance(labels, Mapping)
            and labels.get("com.docker.compose.project") == baseline_config["name"]
            and labels.get("com.docker.compose.service") == self.pins.rollback_disabled_compose.service
            and env.get("PHONE11_RUNTIME_ROLE", "default") == "default"
            and env.get("PHONE11_BUILD_SHA") == self.pins.rollback_build
            and env.get("PORT", str(BASELINE_PORT)) == str(BASELINE_PORT)
            and env.get("PHONE11_CHAT_NOTIFICATIONS_ENABLED") == "0",
            "rollback_baseline_disabled",
        )
        guarded(canonical_hash(normalized_runtime_release(inspect, normalize_notifications=True)) == self.pins.rollback_normalized_runtime_sha256, "rollback_runtime_delta")
        self.require_worker_topology(baseline_config, candidate_config)
        health(self.system, BASELINE_PORT, self.pins.rollback_build, "default")
        self.guard("rollback-baseline-disabled-after", since_ms=stopped["sampled_at_epoch_ms"], require_fence=True, expected_fence_id=before_guard["admission_fence_id"], require_readiness=False, require_wake=True)
        self.wake()
        self.save_runtime_receipt(DISABLED_ROLLBACK_RECEIPT, action="rollback_baseline_disabled", before=before_pin, after=inspect, after_image=self.pins.rollback_image, after_build=self.pins.rollback_build, notifications="disabled")


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    for name in ("prepare", "apply-migration", "replace-baseline", "route-baseline", "replace-candidate", "route-candidate", "rollback-route", "rollback-baseline-disabled"):
        modes.add_argument(f"--{name}", action="store_true", dest=name.replace("-", "_"))
    parser.add_argument("--manifest", required=True, type=Path)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    arguments = parse_args(argv)
    mode = next(name for name in ("prepare", "apply_migration", "replace_baseline", "route_baseline", "replace_candidate", "route_candidate", "rollback_route", "rollback_baseline_disabled") if getattr(arguments, name))
    try:
        operator = Operator(load_pins(arguments.manifest), System())
        with operator_lock():
            getattr(operator, mode)()
        if mode == "prepare":
            print("prepare=READY activation=NOT_RUN")
        elif mode == "rollback_route":
            print("rollback_route=PASS candidate=RUNNING")
        elif mode == "rollback_baseline_disabled":
            print("rollback_baseline_disabled=PASS ordinary_chat_notifications=DISABLED")
        else:
            print(f"{mode}=PASS")
        return 0
    except GuardError as error:
        print(f"{mode}=BLOCKED stage={error.stage}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
