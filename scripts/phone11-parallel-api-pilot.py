#!/usr/bin/env python3
"""Guarded parallel Phone11 API candidate and tRPC proxy operator.

This program is intentionally unusable without a separately reviewed, root-owned
pin manifest.  ``--prepare`` is read-only.  ``--activate`` starts only the
candidate service and changes only the pinned Nginx site.  ``--rollback``
restores only that site and never stops either backend.

No command output is relayed: Docker environments, HTTP credentials, cookies,
and protected Connect11 configuration must never enter operator diagnostics.
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager
import errno
import fcntl
import hashlib
import http.client
import json
import os
import re
import socket
import stat
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence
from urllib.parse import urlsplit


SCHEMA = "phone11-parallel-api-pilot/v1"
ACTIVE_CONTAINER = "cp11-backend"
CANDIDATE_CONTAINER = "cp11-api-candidate"
CANDIDATE_SERVICE = "candidate"
KAMAILIO_CONTAINER = "p11-kamailio"
ACTIVE_IMAGE = "sha256:d42c70f34d5062bff779c235dd2b6e415bede3b3a86b9de73892acf35b392619"
CANDIDATE_PORT = 3002
CANDIDATE_ROLE = "api-candidate"
WAKE_URL = "http://127.0.0.1:3000/api/phone11/wake"
CONNECT11_CUSTOMER_ID = "cust-2d2ded98a329"
CONNECT11_TENANT_NAMESPACE = "6fa4634ade063138"
CONNECT11_API_URL = "https://api.connect11.ai"
CONNECT11_RTC_URL = "wss://connect11-platform-zm6g4d8f.livekit.cloud"
PUBLIC_ORIGIN = "https://api.phone11.ai"
CONFIG_FILE = Path("/etc/phone11/connect11-plain-video.env")
METADATA_FILE = Path("/etc/phone11/connect11-plain-video-credential-metadata.json")
ROLLBACK_ROOT = Path("/var/lib/phone11-parallel-api")
ROLLBACK_SITE = ROLLBACK_ROOT / "nginx-site.before"
ROLLBACK_RECEIPT = ROLLBACK_ROOT / "rollback.json"
LOCK_FILE = Path("/run/phone11-parallel-api.lock")
EXPECTED_PROBES = {
    "existing_phone",
    "existing_chat",
    "conference",
    "mixed_batch",
    "denied_tenant",
}
CANDIDATE_HEADER = "x-phone11-api-candidate"
READINESS_TIMEOUT_SECONDS = 15.0
READINESS_INTERVAL_SECONDS = 0.25
PUBLIC_READINESS_SUCCESSES = 3


class GuardError(RuntimeError):
    def __init__(self, stage: str) -> None:
        super().__init__(stage)
        self.stage = stage


class AtomicWriteError(GuardError):
    def __init__(self, *, committed: bool) -> None:
        super().__init__("atomic_write")
        self.committed = committed


@dataclass(frozen=True)
class HttpResult:
    status: int
    body: bytes
    headers: Mapping[str, tuple[str, ...]]


def guarded(condition: bool, stage: str) -> None:
    if not condition:
        raise GuardError(stage)


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def canonical_hash(value: Any) -> str:
    return sha256_bytes(json.dumps(value, sort_keys=True, separators=(",", ":")).encode())


def require_sha256(value: bytes, expected: str, stage: str) -> None:
    guarded(sha256_bytes(value) == expected, stage)


def is_sha256(value: Any) -> bool:
    return isinstance(value, str) and bool(re.fullmatch(r"[0-9a-f]{64}", value))


def is_image_digest(value: Any) -> bool:
    return isinstance(value, str) and bool(re.fullmatch(r"sha256:[0-9a-f]{64}", value))


def secure_read(path: Path, *, mode: int | None = None) -> bytes:
    try:
        before = path.lstat()
        guarded(stat.S_ISREG(before.st_mode) and not stat.S_ISLNK(before.st_mode), "secure_file")
        guarded(before.st_uid == 0 and before.st_gid == 0 and before.st_nlink == 1, "secure_file")
        guarded(not bool(before.st_mode & (stat.S_IWGRP | stat.S_IWOTH)), "secure_file")
        if mode is not None:
            guarded(stat.S_IMODE(before.st_mode) == mode, "secure_file")
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        try:
            after = os.fstat(descriptor)
            guarded(
                before.st_dev == after.st_dev
                and before.st_ino == after.st_ino
                and before.st_uid == after.st_uid
                and before.st_gid == after.st_gid,
                "secure_file",
            )
            chunks: list[bytes] = []
            while chunk := os.read(descriptor, 65_536):
                chunks.append(chunk)
            return b"".join(chunks)
        finally:
            os.close(descriptor)
    except GuardError:
        raise
    except OSError as error:
        raise GuardError("secure_file") from error


def strict_json(raw: bytes, stage: str) -> Mapping[str, Any]:
    try:
        value = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise GuardError(stage) from error
    guarded(isinstance(value, Mapping), stage)
    return value


def exact_keys(value: Mapping[str, Any], keys: set[str], stage: str) -> None:
    guarded(set(value) == keys, stage)


@dataclass(frozen=True)
class Pins:
    active_container_id: str
    active_runtime_sha256: str
    active_health_build: str
    candidate_image: str
    candidate_build: str
    candidate_config_sha256: str
    candidate_reuse_container_id: str | None
    candidate_reuse_runtime_sha256: str | None
    compose_file: Path
    compose_sha256: str
    credential_config_sha256: str
    credential_metadata_sha256: str
    migration_receipt: Path
    migration_receipt_sha256: str
    probes_file: Path
    probes_sha256: str
    nginx_site: Path
    nginx_site_sha256: str
    nginx_dump_sha256: str
    nginx_insert_marker: str
    kamailio_config_path: str
    kamailio_config_sha256: str
    kamailio_wake_occurrences: int
    public_origin: str


def parse_manifest(document: Mapping[str, Any]) -> Pins:
    exact_keys(
        document,
        {
            "schema", "active", "candidate", "credentials", "migration",
            "probes", "nginx", "kamailio", "public_origin",
        },
        "manifest",
    )
    guarded(document.get("schema") == SCHEMA, "manifest")
    active = document.get("active")
    candidate = document.get("candidate")
    credentials = document.get("credentials")
    migration = document.get("migration")
    probes = document.get("probes")
    nginx = document.get("nginx")
    kamailio = document.get("kamailio")
    for value in (active, candidate, credentials, migration, probes, nginx, kamailio):
        guarded(isinstance(value, Mapping), "manifest")
    exact_keys(active, {"container_id", "image", "runtime_sha256", "health_build"}, "manifest")
    candidate_keys = {"image", "build", "config_sha256", "compose_file", "compose_sha256"}
    guarded(set(candidate) in (candidate_keys, candidate_keys | {"reuse"}), "manifest")
    exact_keys(credentials, {"config_sha256", "metadata_sha256"}, "manifest")
    exact_keys(migration, {"receipt_file", "receipt_sha256"}, "manifest")
    exact_keys(probes, {"file", "sha256"}, "manifest")
    exact_keys(nginx, {"site", "site_sha256", "dump_sha256", "insert_marker"}, "manifest")
    exact_keys(kamailio, {"config_path", "config_sha256", "wake_occurrences"}, "manifest")
    guarded(is_sha256(kamailio.get("config_sha256")), "manifest")
    guarded(type(kamailio.get("wake_occurrences")) is int and 1 <= kamailio["wake_occurrences"] <= 100, "manifest")
    guarded(active.get("image") == ACTIVE_IMAGE, "manifest")
    guarded(isinstance(active.get("container_id"), str) and len(active["container_id"]) == 64, "manifest")
    guarded(is_sha256(active.get("runtime_sha256")), "manifest")
    guarded(isinstance(active.get("health_build"), str) and bool(active["health_build"]), "manifest")
    guarded(is_image_digest(candidate.get("image")) and candidate.get("image") != ACTIVE_IMAGE, "manifest")
    guarded(isinstance(candidate.get("build"), str) and bool(re.fullmatch(r"[A-Za-z0-9_.-]{7,128}", candidate["build"])), "manifest")
    reuse = candidate.get("reuse")
    if reuse is not None:
        guarded(isinstance(reuse, Mapping), "manifest")
        exact_keys(reuse, {"container_id", "runtime_sha256"}, "manifest")
        guarded(
            isinstance(reuse.get("container_id"), str)
            and bool(re.fullmatch(r"[0-9a-f]{64}", reuse["container_id"])),
            "manifest",
        )
        guarded(is_sha256(reuse.get("runtime_sha256")), "manifest")
    for value in (
        candidate.get("config_sha256"), candidate.get("compose_sha256"),
        credentials.get("config_sha256"), credentials.get("metadata_sha256"),
        migration.get("receipt_sha256"), probes.get("sha256"),
        nginx.get("site_sha256"), nginx.get("dump_sha256"),
    ):
        guarded(is_sha256(value), "manifest")
    marker = nginx.get("insert_marker")
    guarded(isinstance(marker, str) and marker.startswith("# PHONE11_PARALLEL_API_INSERT ") and "\n" not in marker, "manifest")
    public_origin = document.get("public_origin")
    # Protected probes carry real authorization and session headers. Keep their
    # destination a literal audited origin rather than accepting arbitrary HTTPS.
    guarded(public_origin == PUBLIC_ORIGIN, "manifest")
    config_path = kamailio.get("config_path")
    guarded(isinstance(config_path, str) and config_path.startswith("/") and "\x00" not in config_path, "manifest")
    paths = [candidate.get("compose_file"), migration.get("receipt_file"), probes.get("file"), nginx.get("site")]
    guarded(all(isinstance(path, str) and path.startswith("/") for path in paths), "manifest")
    return Pins(
        active_container_id=active["container_id"], active_runtime_sha256=active["runtime_sha256"],
        active_health_build=active["health_build"], candidate_image=candidate["image"],
        candidate_build=candidate["build"], candidate_config_sha256=candidate["config_sha256"],
        candidate_reuse_container_id=reuse["container_id"] if reuse is not None else None,
        candidate_reuse_runtime_sha256=reuse["runtime_sha256"] if reuse is not None else None,
        compose_file=Path(candidate["compose_file"]), compose_sha256=candidate["compose_sha256"],
        credential_config_sha256=credentials["config_sha256"], credential_metadata_sha256=credentials["metadata_sha256"],
        migration_receipt=Path(migration["receipt_file"]), migration_receipt_sha256=migration["receipt_sha256"],
        probes_file=Path(probes["file"]), probes_sha256=probes["sha256"],
        nginx_site=Path(nginx["site"]), nginx_site_sha256=nginx["site_sha256"],
        nginx_dump_sha256=nginx["dump_sha256"], nginx_insert_marker=marker,
        kamailio_config_path=config_path, kamailio_config_sha256=kamailio["config_sha256"],
        kamailio_wake_occurrences=kamailio["wake_occurrences"], public_origin=public_origin,
    )


def load_pins(path: Path) -> Pins:
    guarded(os.geteuid() == 0, "root")
    return parse_manifest(strict_json(secure_read(path, mode=0o600), "manifest"))


@contextmanager
def operator_lock(path: Path = LOCK_FILE):
    """Serialize cooperating operators; the lock is the only prepare artifact."""
    descriptor = None
    try:
        descriptor = os.open(path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
        info = os.fstat(descriptor)
        guarded(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_gid == 0
                and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o600, "operator_lock")
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    except OSError as error:
        raise GuardError("operator_lock") from error
    finally:
        if descriptor is not None:
            os.close(descriptor)


class System:
    def command(self, args: Sequence[str], *, timeout: int = 30) -> bytes:
        try:
            result = subprocess.run(
                list(args), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL, timeout=timeout, check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise GuardError("command") from error
        if result.returncode != 0:
            raise GuardError("command")
        return result.stdout

    def json_command(self, args: Sequence[str], stage: str) -> Any:
        try:
            return json.loads(self.command(args))
        except GuardError as error:
            raise GuardError(stage) from error
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise GuardError(stage) from error

    def request(self, origin: str, probe: Mapping[str, Any]) -> HttpResult:
        parsed = urlsplit(origin)
        connection_type = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
        timeout = probe.get("_timeout", 10)
        guarded(isinstance(timeout, (int, float)) and 0 < timeout <= 10, "probe")
        connection = connection_type(parsed.hostname, parsed.port, timeout=timeout)
        try:
            connection.request(probe["method"], probe["path"], body=probe.get("body", "").encode(), headers=probe["headers"])
            response = connection.getresponse()
            body = response.read(1_048_577)
            guarded(len(body) <= 1_048_576, "probe")
            raw_headers = response.getheaders()
            guarded(len(raw_headers) <= 128, "probe")
            headers: dict[str, list[str]] = {}
            total = 0
            for name, value in raw_headers:
                guarded(isinstance(name, str) and isinstance(value, str), "probe")
                total += len(name) + len(value)
                guarded(total <= 65_536, "probe")
                headers.setdefault(name.lower(), []).append(value)
            return HttpResult(response.status, body, {name: tuple(values) for name, values in headers.items()})
        except (OSError, http.client.HTTPException, socket.timeout) as error:
            raise GuardError("probe") from error
        finally:
            connection.close()


def request_result(value: Any) -> HttpResult:
    """Normalize request doubles while production always returns bounded headers."""

    if isinstance(value, HttpResult):
        return value
    guarded(isinstance(value, tuple) and len(value) == 2, "probe")
    status_code, body = value
    guarded(isinstance(status_code, int) and isinstance(body, bytes), "probe")
    return HttpResult(status_code, body, {})


def runtime_shape(inspect: Mapping[str, Any]) -> Mapping[str, Any]:
    config = inspect.get("Config")
    host = inspect.get("HostConfig")
    network = inspect.get("NetworkSettings")
    guarded(isinstance(config, Mapping) and isinstance(host, Mapping) and isinstance(network, Mapping), "active_runtime")
    mounts = inspect.get("Mounts")
    guarded(isinstance(mounts, list), "active_runtime")
    return {
        "Id": inspect.get("Id"), "Image": inspect.get("Image"),
        "Config": {key: config.get(key) for key in ("Image", "Entrypoint", "Cmd", "User", "WorkingDir")},
        "HostConfig": {key: host.get(key) for key in ("NetworkMode", "PortBindings", "RestartPolicy", "ReadonlyRootfs")},
        "Mounts": sorted(
            ({key: item.get(key) for key in ("Type", "Source", "Destination", "RW", "Propagation")} for item in mounts),
            key=lambda item: str(item.get("Destination")),
        ),
        "Networks": sorted((network.get("Networks") or {}).keys()),
    }


def candidate_runtime_shape(inspect: Mapping[str, Any]) -> Mapping[str, Any]:
    config = inspect.get("Config")
    state = inspect.get("State")
    guarded(isinstance(config, Mapping) and isinstance(state, Mapping), "candidate_runtime")
    return {
        "runtime": runtime_shape(inspect),
        "env": sorted(environment(inspect, "candidate_runtime").items()),
        "healthcheck": config.get("Healthcheck"),
        "labels": config.get("Labels"),
        "health_status": state.get("Health", {}).get("Status") if isinstance(state.get("Health"), Mapping) else None,
    }


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


def health(system: System, origin: str, build: str, role: str | None) -> None:
    probe = {"method": "GET", "path": "/api/health", "headers": {}, "body": ""}
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        try:
            result = request_result(system.request(origin, probe))
            body = json.loads(result.body)
            if (
                result.status == 200 and isinstance(body, Mapping) and body.get("ok") is True
                and body.get("service") == "phone11-backend" and body.get("build") == build
                and (role is None or body.get("runtimeRole") == role)
            ):
                return
        except (GuardError, UnicodeDecodeError, json.JSONDecodeError):
            pass
        time.sleep(0.25)
    raise GuardError("health")


def validate_candidate_config(document: Any, pins: Pins) -> None:
    guarded(isinstance(document, Mapping) and set(document.get("services", {})) == {CANDIDATE_SERVICE}, "candidate_config")
    guarded(isinstance(document.get("name"), str)
            and bool(re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,62}", document["name"])), "candidate_config")
    service = document["services"][CANDIDATE_SERVICE]
    guarded(isinstance(service, Mapping), "candidate_config")
    guarded(service.get("container_name") == CANDIDATE_CONTAINER and service.get("image") == pins.candidate_image, "candidate_config")
    env = service.get("environment")
    guarded(isinstance(env, Mapping), "candidate_config")
    guarded(env.get("PHONE11_RUNTIME_ROLE") == CANDIDATE_ROLE, "candidate_config")
    guarded(str(env.get("PORT")) == str(CANDIDATE_PORT), "candidate_config")
    guarded(env.get("PHONE11_BUILD_SHA") == pins.candidate_build, "candidate_config")
    guarded(not service.get("privileged") and service.get("pid") != "host" and service.get("ipc") != "host", "candidate_config")
    guarded(not service.get("devices") and not service.get("cap_add"), "candidate_config")
    guarded(service.get("restart") == "unless-stopped", "candidate_config")
    ports = service.get("ports")
    guarded(isinstance(ports, list) and len(ports) == 1, "candidate_config")
    port = ports[0]
    guarded(isinstance(port, Mapping), "candidate_config")
    guarded(
        port.get("host_ip") == "127.0.0.1" and int(port.get("published")) == CANDIDATE_PORT
        and int(port.get("target")) == CANDIDATE_PORT and port.get("protocol", "tcp") == "tcp",
        "candidate_config",
    )
    guarded(canonical_hash(document) == pins.candidate_config_sha256, "candidate_config")


def validate_credentials(config_raw: bytes, metadata_raw: bytes) -> None:
    try:
        lines = config_raw.decode("utf-8").splitlines()
        values = [line for line in lines if line and not line.startswith("#")]
        guarded(len(values) == 1 and values[0].startswith("PHONE11_CONNECT11_PLAIN_VIDEO_TENANTS="), "credentials")
        mapping = json.loads(values[0].split("=", 1)[1])
        metadata = json.loads(metadata_raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise GuardError("credentials") from error
    guarded(isinstance(mapping, Mapping) and set(mapping) == {"enabled", "tenants"} and mapping.get("enabled") is True, "credentials")
    tenants = mapping.get("tenants")
    guarded(isinstance(tenants, list) and len(tenants) == 1 and isinstance(tenants[0], Mapping), "credentials")
    tenant = tenants[0]
    exact_keys(
        tenant,
        {"tenantId", "customerKey", "apiBaseUrl", "rtcUrl", "statusCredential", "joinCredential"},
        "credentials",
    )
    guarded(
        tenant.get("tenantId") == 1 and tenant.get("customerKey") == CONNECT11_CUSTOMER_ID
        and tenant.get("apiBaseUrl") == CONNECT11_API_URL and tenant.get("rtcUrl") == CONNECT11_RTC_URL,
        "credentials",
    )
    guarded(isinstance(metadata, Mapping) and set(metadata) == {"status", "join_evict"}, "credentials")
    expected = {
        "status": ("statusCredential", ["realtime:plain-video:status"]),
        "join_evict": ("joinCredential", ["realtime:plain-video:join", "realtime:plain-video:evict"]),
    }
    identities: set[str] = set()
    prefixes: set[str] = set()
    for role, (secret_name, scopes) in expected.items():
        record = metadata.get(role)
        guarded(isinstance(record, Mapping), "credentials")
        exact_keys(
            record,
            {"id", "customer_id", "tenant_namespace", "name", "key_prefix", "scopes", "environment", "product_code", "phone11_credential_type", "status"},
            "credentials",
        )
        identity, prefix, secret = record.get("id"), record.get("key_prefix"), tenant.get(secret_name)
        guarded(isinstance(identity, str) and bool(identity) and identity not in identities, "credentials")
        guarded(isinstance(prefix, str) and bool(re.fullmatch(r"c11_live_[0-9a-f]{8}", prefix)) and prefix not in prefixes, "credentials")
        guarded(isinstance(secret, str) and bool(re.fullmatch(r"c11_live_[0-9a-f]{8}_[A-Za-z0-9_-]{43}", secret))
                and secret.startswith(prefix + "_"), "credentials")
        guarded(record.get("customer_id") == CONNECT11_CUSTOMER_ID and record.get("tenant_namespace") == CONNECT11_TENANT_NAMESPACE, "credentials")
        guarded(record.get("scopes") == scopes and record.get("environment") == "live" and record.get("product_code") == "connect11", "credentials")
        guarded(record.get("phone11_credential_type") == role and record.get("status") == "active", "credentials")
        identities.add(identity)
        prefixes.add(prefix)
    guarded(tenant.get("statusCredential") != tenant.get("joinCredential"), "credentials")


def validate_migration_receipt(raw: bytes, pins: Pins) -> None:
    guarded(sha256_bytes(raw) == pins.migration_receipt_sha256, "migration")
    receipt = strict_json(raw, "migration")
    exact_keys(receipt, {"schema", "status", "artifact_sha256", "database_fingerprint", "verification_sha256"}, "migration")
    guarded(receipt.get("schema") == "phone11-migration-receipt/v1" and receipt.get("status") == "applied", "migration")
    guarded(all(is_sha256(receipt.get(key)) for key in ("artifact_sha256", "database_fingerprint", "verification_sha256")), "migration")


def load_probes(raw: bytes, pins: Pins) -> list[Mapping[str, Any]]:
    guarded(sha256_bytes(raw) == pins.probes_sha256, "probes")
    document = strict_json(raw, "probes")
    exact_keys(document, {"schema", "probes"}, "probes")
    guarded(document.get("schema") == "phone11-parallel-api-probes/v1", "probes")
    probes = document.get("probes")
    guarded(isinstance(probes, list) and len(probes) == len(EXPECTED_PROBES), "probes")
    labels: set[str] = set()
    for probe in probes:
        guarded(isinstance(probe, Mapping), "probes")
        exact_keys(probe, {"label", "method", "path", "headers", "body", "status", "required", "forbidden"}, "probes")
        label, path, headers = probe.get("label"), probe.get("path"), probe.get("headers")
        guarded(label in EXPECTED_PROBES and label not in labels, "probes")
        labels.add(label)
        guarded(probe.get("method") in {"GET", "POST"}, "probes")
        guarded(isinstance(path, str) and path.startswith("/api/trpc/") and "\r" not in path and "\n" not in path, "probes")
        guarded(isinstance(headers, Mapping) and all(isinstance(k, str) and isinstance(v, str) for k, v in headers.items()), "probes")
        guarded("Authorization" in headers or "Cookie" in headers, "probes")
        guarded(isinstance(probe.get("body"), str) and isinstance(probe.get("status"), int), "probes")
        guarded(all(isinstance(values, list) and all(isinstance(v, str) for v in values) for values in (probe.get("required"), probe.get("forbidden"))), "probes")
        if label == "existing_phone":
            parsed_path = urlsplit(path)
            guarded(
                probe.get("method") == "GET" and probe.get("body") == ""
                and parsed_path.scheme == parsed_path.netloc == parsed_path.fragment == ""
                and parsed_path.path == "/api/trpc/phone.getConfig",
                "probes",
            )
        if label == "mixed_batch":
            guarded("," in path and re.search(r"(?:\?|&)batch=1(?:&|$)", path) is not None, "probes")
    guarded(labels == EXPECTED_PROBES, "probes")
    return probes


def run_probes(system: System, origin: str, probes: Sequence[Mapping[str, Any]]) -> None:
    for probe in probes:
        result = request_result(system.request(origin, probe))
        guarded(result.status == probe["status"], "probes")
        try:
            text = result.body.decode("utf-8", errors="strict")
        except UnicodeDecodeError as error:
            raise GuardError("probes") from error
        guarded(all(value in text for value in probe["required"]), "probes")
        guarded(all(value not in text for value in probe["forbidden"]), "probes")


def readiness_probe(probes: Sequence[Mapping[str, Any]], *, host: str | None = None) -> Mapping[str, Any]:
    matches = [probe for probe in probes if probe.get("label") == "existing_phone"]
    guarded(len(matches) == 1, "readiness")
    source = matches[0]
    guarded(source.get("method") == "GET" and source.get("body") == "", "readiness")
    headers = {key: value for key, value in source["headers"].items() if key.lower() not in {"connection", "host"}}
    headers["Connection"] = "close"
    if host is not None:
        headers["Host"] = host
    return {**source, "headers": headers}


def readiness_matches(result: HttpResult, probe: Mapping[str, Any], build: str) -> bool:
    try:
        text = result.body.decode("utf-8", errors="strict")
    except UnicodeDecodeError:
        return False
    return (
        result.status == probe["status"]
        and result.headers.get(CANDIDATE_HEADER) == (build,)
        and all(value in text for value in probe["required"])
        and all(value not in text for value in probe["forbidden"])
    )


def wait_for_candidate_route(
    system: System,
    origin: str,
    probe: Mapping[str, Any],
    build: str,
    deadline: float,
    *,
    consecutive: int,
) -> None:
    guarded(type(consecutive) is int and 1 <= consecutive <= 10, "readiness")
    successes = 0
    while time.monotonic() < deadline:
        try:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            bounded_probe = {**probe, "_timeout": min(10.0, remaining)}
            result = request_result(system.request(origin, bounded_probe))
            successes = successes + 1 if readiness_matches(result, probe, build) else 0
            if successes == consecutive:
                return
        except GuardError:
            successes = 0
        remaining = deadline - time.monotonic()
        if remaining > 0:
            time.sleep(min(READINESS_INTERVAL_SECONDS, remaining))
    raise GuardError("readiness")


def proxy_fragment(marker: str, build: str) -> bytes:
    guarded(bool(re.fullmatch(r"[A-Za-z0-9_.-]{7,128}", build)), "nginx_route")
    return (
        "    location = /api/trpc {\n"
        "        proxy_pass http://127.0.0.1:3002;\n"
        "        proxy_http_version 1.1;\n"
        "        proxy_pass_request_headers on;\n"
        "        proxy_set_header Host $host;\n"
        "        proxy_set_header X-Real-IP $remote_addr;\n"
        "        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n"
        "        proxy_set_header X-Forwarded-Proto $scheme;\n"
        f"        add_header X-Phone11-Api-Candidate {build} always;\n"
        "    }\n"
        "    location ^~ /api/trpc/ {\n"
        "        proxy_pass http://127.0.0.1:3002;\n"
        "        proxy_http_version 1.1;\n"
        "        proxy_pass_request_headers on;\n"
        "        proxy_set_header Host $host;\n"
        "        proxy_set_header X-Real-IP $remote_addr;\n"
        "        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n"
        "        proxy_set_header X-Forwarded-Proto $scheme;\n"
        f"        add_header X-Phone11-Api-Candidate {build} always;\n"
        "    }\n"
        f"    {marker}\n"
    ).encode()


def atomic_write(path: Path, content: bytes, *, mode: int, uid: int, gid: int) -> None:
    descriptor: int | None = None
    directory_descriptor: int | None = None
    temporary: str | None = None
    committed = False
    try:
        descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
        os.fchmod(descriptor, mode)
        os.fchown(descriptor, uid, gid)
        remaining = memoryview(content)
        while remaining:
            written = os.write(descriptor, remaining)
            if written <= 0:
                raise OSError(errno.EIO, "zero-length write")
            remaining = remaining[written:]
        os.fsync(descriptor)
        os.close(descriptor)
        descriptor = None
        os.replace(temporary, path)
        temporary = None
        committed = True
        directory_descriptor = os.open(
            path.parent,
            os.O_RDONLY | getattr(os, "O_DIRECTORY", 0),
        )
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


@contextmanager
def frozen_candidate_config(document: Mapping[str, Any]):
    """Yield a protected immutable-by-name compose input and remove it after use."""
    directory = Path(tempfile.mkdtemp(prefix="phone11-api-candidate."))
    path = directory / "compose.json"
    try:
        os.chmod(directory, 0o700)
        # `docker compose config --format json` emits a round-trippable Compose
        # model: literal dollars are already represented with Compose's `$$`
        # escape. Preserve those strings byte-for-value. Escaping them again
        # would turn one runtime dollar into two when the snapshot is parsed.
        atomic_write(
            path,
            json.dumps(document, sort_keys=True, separators=(",", ":")).encode(),
            mode=0o600,
            uid=0,
            gid=0,
        )
        yield path
    except OSError as error:
        raise GuardError("candidate_config") from error
    finally:
        try:
            path.unlink(missing_ok=True)
            directory.rmdir()
        except OSError:
            pass


class Operator:
    def __init__(self, pins: Pins, system: System) -> None:
        self.pins, self.system = pins, system
        self.probes: list[Mapping[str, Any]] = []

    def candidate_config(self) -> Mapping[str, Any]:
        compose = secure_read(self.pins.compose_file)
        require_sha256(compose, self.pins.compose_sha256, "candidate_config")
        rendered = self.system.json_command(
            [
                "docker", "compose",
                "--project-directory", str(self.pins.compose_file.parent),
                "-f", str(self.pins.compose_file),
                "config", "--format", "json",
            ],
            "candidate_config",
        )
        validate_candidate_config(rendered, self.pins)
        return rendered

    def active(self) -> Mapping[str, Any]:
        inspect = one_inspect(self.system, ACTIVE_CONTAINER, "active_runtime")
        state = inspect.get("State")
        guarded(inspect.get("Id") == self.pins.active_container_id and inspect.get("Image") == ACTIVE_IMAGE, "active_runtime")
        guarded(isinstance(state, Mapping) and state.get("Running") is True and state.get("Health", {}).get("Status") == "healthy", "active_runtime")
        guarded(canonical_hash(runtime_shape(inspect)) == self.pins.active_runtime_sha256, "active_runtime")
        health(self.system, "http://127.0.0.1:3000", self.pins.active_health_build, None)
        return inspect

    def candidate_absent_and_port_free(self) -> None:
        raw_names = self.system.command(["docker", "ps", "-a", "--format", "{{.Names}}"])
        try:
            names = {line.decode("utf-8") for line in raw_names.splitlines() if line}
        except UnicodeDecodeError as error:
            raise GuardError("candidate_absent") from error
        guarded(CANDIDATE_CONTAINER not in names, "candidate_absent")
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind(("127.0.0.1", CANDIDATE_PORT))
        except OSError as error:
            raise GuardError("candidate_port") from error
        finally:
            sock.close()

    def pinned_nginx(self) -> bytes:
        site = secure_read(self.pins.nginx_site)
        require_sha256(site, self.pins.nginx_site_sha256, "nginx_config")
        guarded(site.count(self.pins.nginx_insert_marker.encode()) == 1, "nginx_config")
        guarded(b"location = /api/trpc" not in site and b"location ^~ /api/trpc/" not in site, "nginx_config")
        require_sha256(self.system.command(["nginx", "-T"]), self.pins.nginx_dump_sha256, "nginx_config")
        return site

    def wake_target(self) -> None:
        wake = self.system.command(["docker", "exec", KAMAILIO_CONTAINER, "cat", self.pins.kamailio_config_path])
        require_sha256(wake, self.pins.kamailio_config_sha256, "wake_target")
        guarded(wake.count(WAKE_URL.encode()) == self.pins.kamailio_wake_occurrences, "wake_target")

    def prepare(self) -> None:
        self.active()
        if self.pins.candidate_reuse_container_id is None:
            self.candidate_absent_and_port_free()
        image = self.system.json_command(["docker", "image", "inspect", self.pins.candidate_image], "candidate_image")
        guarded(isinstance(image, list) and len(image) == 1 and image[0].get("Id") == self.pins.candidate_image, "candidate_image")
        self.candidate_config()
        credential_config = secure_read(CONFIG_FILE, mode=0o600)
        credential_metadata = secure_read(METADATA_FILE, mode=0o600)
        require_sha256(credential_config, self.pins.credential_config_sha256, "credentials")
        require_sha256(credential_metadata, self.pins.credential_metadata_sha256, "credentials")
        validate_credentials(credential_config, credential_metadata)
        validate_migration_receipt(secure_read(self.pins.migration_receipt, mode=0o600), self.pins)
        self.probes = load_probes(secure_read(self.pins.probes_file, mode=0o600), self.pins)
        original = self.pinned_nginx()
        if self.pins.candidate_reuse_container_id is not None:
            self.validate_prior_rollback(original)
            self.candidate()
        self.system.command(["nginx", "-t"])
        self.wake_target()

    def candidate(self) -> None:
        inspect = one_inspect(self.system, CANDIDATE_CONTAINER, "candidate_runtime")
        guarded(inspect.get("Image") == self.pins.candidate_image, "candidate_runtime")
        if self.pins.candidate_reuse_container_id is not None:
            guarded(inspect.get("Id") == self.pins.candidate_reuse_container_id, "candidate_runtime")
            guarded(
                canonical_hash(candidate_runtime_shape(inspect)) == self.pins.candidate_reuse_runtime_sha256,
                "candidate_runtime",
            )
        state = inspect.get("State")
        guarded(
            isinstance(state, Mapping) and state.get("Running") is True
            and isinstance(state.get("Health"), Mapping) and state["Health"].get("Status") == "healthy",
            "candidate_runtime",
        )
        env = environment(inspect, "candidate_runtime")
        guarded(env.get("PHONE11_RUNTIME_ROLE") == CANDIDATE_ROLE, "candidate_runtime")
        guarded(env.get("PHONE11_BUILD_SHA") == self.pins.candidate_build and env.get("PORT") == str(CANDIDATE_PORT), "candidate_runtime")
        bindings = inspect.get("HostConfig", {}).get("PortBindings", {}).get(f"{CANDIDATE_PORT}/tcp")
        guarded(bindings == [{"HostIp": "127.0.0.1", "HostPort": str(CANDIDATE_PORT)}], "candidate_runtime")
        labels = inspect.get("Config", {}).get("Labels")
        guarded(isinstance(labels, Mapping) and labels.get("com.phone11.candidate-build") == self.pins.candidate_build, "candidate_runtime")
        guarded(isinstance(inspect.get("Config", {}).get("Healthcheck"), Mapping), "candidate_runtime")
        health(self.system, "http://127.0.0.1:3002", self.pins.candidate_build, CANDIDATE_ROLE)

    def candidate_running(self) -> None:
        inspect = one_inspect(self.system, CANDIDATE_CONTAINER, "candidate_runtime")
        guarded(inspect.get("Image") == self.pins.candidate_image, "candidate_runtime")
        state = inspect.get("State")
        guarded(isinstance(state, Mapping) and state.get("Running") is True, "candidate_runtime")

    def save_rollback(self, original: bytes, active: bytes) -> None:
        ROLLBACK_ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(ROLLBACK_ROOT, 0o700)
        guarded(ROLLBACK_ROOT.lstat().st_uid == 0 and not ROLLBACK_ROOT.is_symlink(), "rollback")
        atomic_write(ROLLBACK_SITE, original, mode=0o600, uid=0, gid=0)
        receipt = json.dumps(
            {"schema": SCHEMA, "site": str(self.pins.nginx_site), "before": sha256_bytes(original), "active": sha256_bytes(active)},
            sort_keys=True, separators=(",", ":"),
        ).encode()
        atomic_write(ROLLBACK_RECEIPT, receipt, mode=0o600, uid=0, gid=0)

    def validate_prior_rollback(self, original: bytes) -> None:
        receipt = strict_json(secure_read(ROLLBACK_RECEIPT, mode=0o600), "rollback")
        exact_keys(receipt, {"schema", "site", "before", "active"}, "rollback")
        guarded(
            receipt.get("schema") == SCHEMA
            and receipt.get("site") == str(self.pins.nginx_site)
            and receipt.get("before") == self.pins.nginx_site_sha256 == sha256_bytes(original)
            and is_sha256(receipt.get("active"))
            and receipt.get("active") != receipt.get("before"),
            "rollback",
        )
        guarded(secure_read(ROLLBACK_SITE, mode=0o600) == original, "rollback")

    def restore_proxy(self, expected_current: bytes | None = None) -> None:
        receipt = strict_json(secure_read(ROLLBACK_RECEIPT, mode=0o600), "rollback")
        exact_keys(receipt, {"schema", "site", "before", "active"}, "rollback")
        guarded(receipt.get("schema") == SCHEMA and receipt.get("site") == str(self.pins.nginx_site), "rollback")
        original = secure_read(ROLLBACK_SITE, mode=0o600)
        guarded(sha256_bytes(original) == receipt.get("before") == self.pins.nginx_site_sha256, "rollback")
        current = secure_read(self.pins.nginx_site)
        if expected_current is not None:
            guarded(current == expected_current, "rollback")
        else:
            guarded(sha256_bytes(current) == receipt.get("active"), "rollback")
        info = self.pins.nginx_site.stat()
        durability_error: AtomicWriteError | None = None
        try:
            atomic_write(self.pins.nginx_site, original, mode=stat.S_IMODE(info.st_mode), uid=info.st_uid, gid=info.st_gid)
        except AtomicWriteError as error:
            if not error.committed:
                raise
            # The rename committed but its directory sync failed. Verify the
            # safe bytes and complete the runtime restore before reporting that
            # durability could not be proven.
            guarded(secure_read(self.pins.nginx_site) == original, "rollback")
            durability_error = error
        self.system.command(["nginx", "-t"])
        self.system.command(["nginx", "-s", "reload"])
        self.active()
        self.candidate_running()
        if durability_error is not None:
            raise durability_error

    def activate(self) -> None:
        self.prepare()
        baseline_id = self.pins.active_container_id
        if self.pins.candidate_reuse_container_id is None:
            # Re-render after prepare, validate the exact pinned model, then run
            # only that protected snapshot. Source Compose/.env edits cannot
            # alter `up`.
            rendered = self.candidate_config()
            with frozen_candidate_config(rendered) as frozen:
                self.system.command([
                    "docker", "compose",
                    "--project-name", rendered["name"],
                    "--project-directory", str(self.pins.compose_file.parent),
                    "-f", str(frozen),
                    "up", "-d", "--no-deps", CANDIDATE_SERVICE,
                ], timeout=90)
        self.candidate()
        guarded(self.active().get("Id") == baseline_id, "active_changed")
        # Exercise the complete candidate surface directly before exposing any
        # public request to it. Fixture mutations are idempotent and scoped.
        run_probes(self.system, "http://127.0.0.1:3002", self.probes)
        original = self.pinned_nginx()
        marker = self.pins.nginx_insert_marker.encode()
        activated = original.replace(
            marker,
            proxy_fragment(self.pins.nginx_insert_marker, self.pins.candidate_build).rstrip(b"\n"),
            1,
        )
        guarded(activated != original and activated.count(b"location = /api/trpc") == 1 and activated.count(b"location ^~ /api/trpc/") == 1, "nginx_route")
        self.save_rollback(original, activated)
        info = self.pins.nginx_site.stat()
        # Candidate startup/probes can take time. Never overwrite an operator's
        # intervening edit, even if the earlier prepare phase passed.
        guarded(self.pinned_nginx() == original, "nginx_config")
        try:
            atomic_write(self.pins.nginx_site, activated, mode=stat.S_IMODE(info.st_mode), uid=info.st_uid, gid=info.st_gid)
            self.system.command(["nginx", "-t"])
            self.system.command(["nginx", "-s", "reload"])
            deadline = time.monotonic() + READINESS_TIMEOUT_SECONDS
            wait_for_candidate_route(
                self.system,
                "http://127.0.0.1",
                readiness_probe(self.probes, host="api.phone11.ai"),
                self.pins.candidate_build,
                deadline,
                consecutive=1,
            )
            wait_for_candidate_route(
                self.system,
                self.pins.public_origin,
                readiness_probe(self.probes),
                self.pins.candidate_build,
                deadline,
                consecutive=PUBLIC_READINESS_SUCCESSES,
            )
            # Public mutation probes cannot run until both route barriers have
            # attested the candidate.
            run_probes(self.system, self.pins.public_origin, self.probes)
            guarded(self.active().get("Id") == baseline_id, "active_changed")
            self.candidate()
            self.wake_target()
        except GuardError as error:
            try:
                current = secure_read(self.pins.nginx_site)
                if current == activated:
                    self.restore_proxy(expected_current=activated)
                else:
                    # A pre-commit write failure leaves the reviewed original
                    # in place and must not trigger an unnecessary reload.
                    guarded(current == original, "rollback")
            except GuardError as rollback_error:
                raise GuardError("rollback_failed") from rollback_error
            raise error


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--prepare", action="store_true")
    modes.add_argument("--activate", action="store_true")
    modes.add_argument("--rollback", action="store_true")
    parser.add_argument("--manifest", required=True, type=Path)
    return parser.parse_args(argv)


def main(argv: Sequence[str]) -> int:
    arguments = parse_args(argv)
    mode = "prepare" if arguments.prepare else "activation" if arguments.activate else "rollback"
    try:
        operator = Operator(load_pins(arguments.manifest), System())
        with operator_lock():
            if arguments.prepare:
                operator.prepare()
                print("prepare=READY activation=NOT_RUN")
            elif arguments.activate:
                operator.activate()
                print("activation=PASS")
            else:
                operator.restore_proxy()
                print("rollback=PASS candidate=RUNNING")
        return 0
    except GuardError as error:
        print(f"{mode}=BLOCKED stage={error.stage}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
