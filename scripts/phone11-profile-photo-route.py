#!/usr/bin/env python3
"""Pin and reversibly route only Phone11 profile-photo REST calls on the VoIP host.

This is a separate, default-off route. It does not change either tRPC location,
the baseline container, or the Connect11/SIP maintenance fence. An operator
must supply recent, root-protected service-readiness evidence before activation.
"""

from __future__ import annotations

import argparse
import contextlib
import fcntl
import hashlib
import http.client
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import time
from typing import Any, Mapping, Protocol, Sequence
from urllib.parse import quote
import uuid


EDGE_PATH = Path(__file__).with_name("phone11-edge-maintenance-controller.py")
SPEC = importlib.util.spec_from_file_location("phone11_photo_route_edge_helpers", EDGE_PATH)
assert SPEC and SPEC.loader
edge = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(edge)

SCHEMA = "phone11-profile-photo-route/v1"
PREFLIGHT_SCHEMA = "phone11-profile-photo-preflight/v1"
BEGIN = "# PHONE11_PROFILE_PHOTO_ROUTE_BEGIN"
END = "# PHONE11_PROFILE_PHOTO_ROUTE_END"
MARKER = "x-phone11-photo-candidate"
LEGACY_BASELINE_BUILD = "team-chat-media-d41fc504"
LOCK = Path("/run/phone11-parallel-api.lock")
SUPPORTED_PORTS = {3002, 3003, 3005, 3006}
_SHA = re.compile(r"[0-9a-f]{64}\Z")
_BUILD = re.compile(r"[a-zA-Z0-9_.-]{7,128}\Z")


def require(condition: bool, stage: str) -> None:
    if not condition:
        raise edge.ControlError(stage)


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical(value: Mapping[str, Any]) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def route_kind(method: str, path: str) -> str:
    """Mirror Nginx's case-insensitive, normalized-path selector for probes."""
    path = path.split("?", 1)[0]
    if method == "POST" and re.fullmatch(r"/api/profile/photo/?", path, re.I):
        return "candidate"
    if method == "GET" and re.fullmatch(r"/api/profile/photo/[^/]+/[^/]+/?", path, re.I):
        return "candidate"
    if method == "DELETE" and re.fullmatch(r"/api/profile/photo/[^/]+/?", path, re.I):
        return "candidate"
    return "baseline"


def api_server(text: str) -> tuple[int, str]:
    matches: list[tuple[int, str]] = []
    for found in re.finditer(r"(?m)^\s*server\s*\{", text):
        closing = edge._matching_brace(text, text.index("{", found.start()))
        server = text[found.start():closing + 1]
        names = re.findall(r"(?m)^\s*server_name\s+([^;]+);", server)
        if len(names) == 1 and "api.phone11.ai" in names[0].split():
            matches.append((found.start(), server))
    require(len(matches) == 1, "site_contract")
    return matches[0]


def render(original: bytes, *, operation_id: str, build: str, port: int) -> bytes:
    edge.valid_uuid(operation_id)
    require(bool(_BUILD.fullmatch(build)) and port in SUPPORTED_PORTS, "route_target")
    try:
        text = original.decode("utf-8", "strict")
    except UnicodeDecodeError as error:
        raise edge.ControlError("site_encoding") from error
    require(BEGIN not in text and END not in text, "already_active")
    server_start, server = api_server(text)
    # A pre-existing photo location, even one with a broader prefix, could
    # shadow one of the three routes. Require an exact known baseline shape.
    require(not re.search(r"(?im)^\s*location\s+[^\n{]*profile(?:/|\\/)?photo", server), "route_conflict")
    matches = list(re.finditer(r"(?m)^([ \t]*)location\s+/\s*\{", server))
    require(len(matches) == 1, "site_contract")
    match = matches[0]
    opening = server.index("{", match.start())
    closing = edge._matching_brace(server, opening)
    body = server[opening + 1:closing]
    passes = list(re.finditer(r"(?m)^\s*proxy_pass\s+(http://(?:127\.0\.0\.1:[0-9]+|[0-9.]+(?::[0-9]+)?))\s*;\s*$", body))
    require(len(passes) == 1 and "proxy_set_header Host " in body, "site_contract")
    baseline = passes[0].group(1)
    require(baseline != f"http://127.0.0.1:{port}", "route_target")
    # A variable upstream preserves the original request URI, including the
    # photo version query. Unsupported methods keep the original upstream.
    proxied = body[:passes[0].start()] + body[passes[0].end():]
    indent = match.group(1)
    blocks = [f"{indent}{BEGIN} {operation_id} {build} {port}\n"]
    for selector, method in (
        ("~* ^/api/profile/photo/?$", "POST"),
        ("~* ^/api/profile/photo/[^/]+/[^/]+/?$", "GET"),
        ("~* ^/api/profile/photo/[^/]+/?$", "DELETE"),
    ):
        blocks += [
            f"{indent}location {selector} {{\n",
            f"{indent}    set $phone11_photo_target {baseline};\n",
            f'{indent}    set $phone11_photo_build "";\n',
            f"{indent}    if ($request_method = {method}) {{\n",
            f"{indent}        set $phone11_photo_target http://127.0.0.1:{port};\n",
            f"{indent}        set $phone11_photo_build {build};\n",
            f"{indent}    }}\n",
            f"{indent}    proxy_pass $phone11_photo_target;\n",
            proxied,
            "\n" if not proxied.endswith("\n") else "",
            f"{indent}    add_header X-Phone11-Photo-Candidate $phone11_photo_build always;\n",
            f"{indent}}}\n",
        ]
    blocks.append(f"{indent}{END} {operation_id}\n")
    insert = server_start + match.start()
    return (text[:insert] + "".join(blocks) + text[insert:]).encode()


def validate_preflight(value: Any, *, build: str, port: int,
                       container_id: str, image: str, now_ms: int) -> None:
    require(isinstance(value, dict) and set(value) == {
        "schema", "checked_at_epoch_ms", "candidate_build", "candidate_port",
        "candidate_container_id", "candidate_image",
        "schema_absent", "private_storage_ready", "cleanup_worker_ready",
        "candidate_auth_ready",
    }, "preflight")
    require(value["schema"] == PREFLIGHT_SCHEMA and value["candidate_build"] == build
            and value["candidate_port"] == port
            and value["candidate_container_id"] == container_id
            and value["candidate_image"] == image, "preflight")
    checked = value["checked_at_epoch_ms"]
    require(type(checked) is int and 0 <= now_ms - checked <= 300_000, "preflight_age")
    require(all(value[key] is True for key in (
        "schema_absent", "private_storage_ready", "cleanup_worker_ready",
        "candidate_auth_ready",
    )), "preflight")


class System(Protocol):
    def command(self, args: Sequence[str]) -> bytes: ...
    def container(self, name: str) -> tuple[str, str, str, str]: ...
    def probe(self, port: int, path: str) -> tuple[int, Mapping[str, str], bytes]: ...
    def public_probe(self, method: str, path: str) -> tuple[int, Mapping[str, str], bytes]: ...
    def authenticated_get(self, path: str, headers: Mapping[str, str]) -> tuple[int, bytes]: ...


class LocalSystem:
    def command(self, args: Sequence[str]) -> bytes:
        result = subprocess.run(list(args), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, timeout=20, check=False)
        require(result.returncode == 0 and len(result.stdout) <= 4 * 1024 * 1024, "command")
        return result.stdout

    def container(self, name: str) -> tuple[str, str, str, str]:
        # Output contains identity and health only. Do not print Docker env or
        # mounts, which can contain credentials or customer-specific paths.
        raw = self.command(["docker", "inspect", "--format",
            "{{.Id}} {{.Image}} {{.State.Running}} {{.State.Health.Status}}", name])
        fields = raw.decode("ascii", "strict").strip().split()
        require(len(fields) == 4, "candidate_identity")
        return tuple(fields)  # type: ignore[return-value]

    def probe(self, port: int, path: str) -> tuple[int, Mapping[str, str], bytes]:
        try:
            connection = http.client.HTTPConnection("127.0.0.1", port, timeout=4)
            connection.request("GET", path, headers={"Host": "api.phone11.ai"})
            response = connection.getresponse()
            body = response.read(4096)
            headers = {name.lower(): value for name, value in response.getheaders()}
            connection.close()
            return response.status, headers, body
        except (OSError, http.client.HTTPException) as error:
            raise edge.ControlError("candidate_probe") from error

    def public_probe(self, method: str, path: str) -> tuple[int, Mapping[str, str], bytes]:
        # Probe the local VoIP Nginx with the same Host used by the outer edge.
        try:
            connection = http.client.HTTPConnection("127.0.0.1", 80, timeout=4)
            connection.request(method, path, headers={"Host": "api.phone11.ai", "Content-Length": "0"})
            response = connection.getresponse()
            body = response.read(4096)
            headers = {name.lower(): value for name, value in response.getheaders()}
            connection.close()
            return response.status, headers, body
        except (OSError, http.client.HTTPException) as error:
            raise edge.ControlError("route_probe") from error

    def authenticated_get(self, path: str, headers: Mapping[str, str]) -> tuple[int, bytes]:
        try:
            connection = http.client.HTTPConnection("127.0.0.1", 80, timeout=4)
            connection.request("GET", path, headers={**headers, "Host": "api.phone11.ai"})
            response = connection.getresponse()
            body = response.read(4096)
            connection.close()
            return response.status, body
        except (OSError, http.client.HTTPException) as error:
            raise edge.ControlError("capability_probe") from error


class Controller:
    def __init__(self, system: System, *, site: Path, nginx: Path, pid_file: Path,
                 evidence_dir: Path, expected_site_sha: str, expected_dump_sha: str,
                 expected_exe_sha: str, candidate_build: str, candidate_port: int,
                 candidate_name: str, candidate_id: str, candidate_image: str,
                 preflight: Path, probes_file: Path, expected_probes_sha: str, tenant_id: int,
                 clock=lambda: int(time.time() * 1000),
                 monotonic=time.monotonic, sleeper=time.sleep):
        self.system, self.site, self.nginx, self.pid_file = system, site, nginx, pid_file
        self.evidence_dir, self.expected_site_sha, self.expected_dump_sha = evidence_dir, expected_site_sha, expected_dump_sha
        self.expected_exe_sha, self.candidate_build, self.candidate_port = expected_exe_sha, candidate_build, candidate_port
        self.candidate_name, self.candidate_id, self.candidate_image = candidate_name, candidate_id, candidate_image
        self.preflight, self.clock = preflight, clock
        self.probes_file, self.expected_probes_sha, self.tenant_id = probes_file, expected_probes_sha, tenant_id
        self.monotonic, self.sleeper = monotonic, sleeper
        require(bool(_SHA.fullmatch(expected_probes_sha))
                and type(tenant_id) is int and 0 < tenant_id < 2_147_483_648, "probes")
        require(bool(re.fullmatch(r"[a-zA-Z0-9_.-]{1,128}", candidate_name))
                and bool(_SHA.fullmatch(candidate_id))
                and bool(re.fullmatch(r"sha256:[0-9a-f]{64}", candidate_image)), "candidate_identity")
        require(evidence_dir.is_absolute() and evidence_dir.is_dir() and not evidence_dir.is_symlink()
                and evidence_dir.stat().st_uid == os.geteuid()
                and stat.S_IMODE(evidence_dir.stat().st_mode) == 0o700, "evidence_dir")

    def _identity(self) -> dict[str, Any]:
        raw = edge.secure_file(self.site, expected_uid=os.geteuid())
        process = edge.process_identity(self.pid_file, self.nginx, self.expected_exe_sha, os.geteuid())
        return {"site_sha256": digest(raw), "dump_sha256": digest(self.system.command([str(self.nginx), "-T"])),
                "process": process}

    def _candidate(self) -> None:
        require(self.system.container(self.candidate_name) ==
                (self.candidate_id, self.candidate_image, "true", "healthy"), "candidate_identity")
        status, _headers, raw = self.system.probe(self.candidate_port, "/api/health")
        require(status == 200, "candidate_probe")
        try:
            health = json.loads(raw)
        except (ValueError, UnicodeDecodeError) as error:
            raise edge.ControlError("candidate_probe") from error
        require(isinstance(health, dict) and health.get("ok") is True
                and health.get("build") == self.candidate_build
                and health.get("runtimeRole") == "api-candidate", "candidate_probe")
        # GET without credentials must be rejected by the app, not by an old
        # baseline 404. The current candidate has authenticated photo routes.
        status, _headers, raw = self.system.probe(self.candidate_port,
            "/api/profile/photo/1/1?v=11111111-1111-4111-8111-111111111111")
        require(status == 401 and b"Sign in to access profile photos" in raw, "candidate_auth")

    def _preflight(self) -> None:
        raw = edge.secure_file(self.preflight, mode=0o600, expected_uid=os.geteuid())
        try:
            value = json.loads(raw)
        except ValueError as error:
            raise edge.ControlError("preflight") from error
        require(canonical(value) == raw, "preflight")
        validate_preflight(value, build=self.candidate_build, port=self.candidate_port,
                           container_id=self.candidate_id, image=self.candidate_image,
                           now_ms=self.clock())

    def _capability_unavailable(self) -> None:
        raw = edge.secure_file(self.probes_file, mode=0o600, expected_uid=os.geteuid())
        require(digest(raw) == self.expected_probes_sha, "probes")
        try:
            document = json.loads(raw)
        except ValueError as error:
            raise edge.ControlError("probes") from error
        require(isinstance(document, dict) and document.get("schema") == "phone11-parallel-api-probes/v1"
                and isinstance(document.get("probes"), list), "probes")
        existing = [item for item in document["probes"]
                    if isinstance(item, dict) and item.get("label") == "existing_phone"]
        require(len(existing) == 1 and existing[0].get("method") == "GET"
                and isinstance(existing[0].get("headers"), dict), "probes")
        headers = existing[0]["headers"]
        require(any(key.lower() in {"authorization", "cookie"} for key in headers)
                and all(isinstance(key, str) and isinstance(value, str)
                        and "\r" not in key + value and "\n" not in key + value
                        for key, value in headers.items()), "probes")
        encoded = quote(json.dumps({"json": {"tenantId": self.tenant_id}}, separators=(",", ":")), safe="")
        status, body = self.system.authenticated_get(
            f"/api/trpc/profile.photoCapability?input={encoded}", headers)
        try:
            document = json.loads(body)
        except ValueError as error:
            raise edge.ControlError("capability_probe") from error
        result = document.get("result") if isinstance(document, dict) else None
        data = result.get("data") if isinstance(result, dict) else None
        payload = data.get("json") if isinstance(data, dict) else None
        require(status == 200 and isinstance(payload, dict)
                and payload.get("available") is False, "capability_probe")

    def _probe_routes(self, *, active: bool) -> None:
        for method, path in (
            ("POST", "/api/profile/photo"),
            ("POST", "/API/PROFILE/PHOTO/"),
            ("GET", "/api/profile/photo/1/1?v=11111111-1111-4111-8111-111111111111"),
            ("DELETE", "/api/profile/photo/1"),
            ("GET", "/api/profile/photo"),
            ("POST", "/api/profile/photo/1"),
            ("GET", "/api/trpc/profile.photoCapability"),
            ("POST", "/api/trpc/profile.photoCapability,chat.list?batch=1"),
            ("GET", "/api/health"),
        ):
            status, headers, body = self.system.public_probe(method, path)
            expected = self.candidate_build if active and route_kind(method, path) == "candidate" else None
            require(headers.get(MARKER) == expected, "route_probe")
            require(status < 500, "route_probe")
            if active and route_kind(method, path) == "candidate":
                # All three REST handlers authenticate before any data or
                # commissioning check. A marked gateway failure is not proof
                # that this candidate actually served the request.
                require(status == 401 and b"Sign in to access profile photos" in body, "route_probe")
            elif not active and route_kind(method, path) == "candidate":
                require(status == 404, "route_probe")
            elif method == "GET" and path == "/api/health":
                try:
                    health = json.loads(body)
                except (ValueError, UnicodeDecodeError) as error:
                    raise edge.ControlError("baseline_health") from error
                require(status == 200 and isinstance(health, dict)
                        and health.get("ok") is True
                        and (health.get("runtimeRole") == "default"
                             or (health.get("runtimeRole") is None
                                 and health.get("service") == "phone11-backend"
                                 and health.get("build") == LEGACY_BASELINE_BUILD)),
                        "baseline_health")

    def _install(self, raw: bytes, info: os.stat_result) -> None:
        edge.atomic_write(self.site, raw, mode=stat.S_IMODE(info.st_mode), uid=info.st_uid, gid=info.st_gid)
        self.system.command([str(self.nginx), "-t"])
        self.system.command([str(self.nginx), "-s", "reload"])

    def _wait_generation(self, previous: Mapping[str, Any], expected_sha: str) -> dict[str, Any]:
        old = set(previous["process"]["worker_pids"])
        # A graceful Nginx reload may keep old workers alive for in-flight
        # keep-alive, WebSocket, or media streams. Use the existing candidate
        # operator's bounded 60-second drain rather than a four-second guess.
        deadline = self.monotonic() + 60
        while True:
            current = self._identity()
            if (not old.intersection(current["process"]["worker_pids"])
                    and current["process"]["pid"] == previous["process"]["pid"]
                    and current["process"]["start_ticks"] == previous["process"]["start_ticks"]
                    and current["site_sha256"] == expected_sha):
                return current
            if self.monotonic() >= deadline:
                break
            self.sleeper(0.1)
        raise edge.ControlError("nginx_generation")

    @contextlib.contextmanager
    def _lock(self):
        fd = os.open(LOCK, os.O_CREAT | os.O_RDWR | os.O_CLOEXEC | os.O_NOFOLLOW, 0o600)
        try:
            info = os.fstat(fd)
            require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid()
                    and stat.S_IMODE(info.st_mode) == 0o600, "operator_lock")
            fcntl.flock(fd, fcntl.LOCK_EX)
            yield
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
            os.close(fd)

    def _record(self, operation_id: str, name: str, raw: bytes) -> Path:
        path = self.evidence_dir / f"{operation_id}.{name}"
        fd, staged = tempfile.mkstemp(prefix=f".{operation_id}.{name}.", dir=self.evidence_dir)
        try:
            with os.fdopen(fd, "wb") as output:
                os.fchmod(output.fileno(), 0o600)
                output.write(raw)
                output.flush()
                os.fsync(output.fileno())
            # Linking a fully synced inode publishes the final record without
            # replacing an earlier operation record. Crash debris remains only
            # in a hidden temporary file, never a partial authoritative JSON.
            os.link(staged, path, follow_symlinks=False)
            directory_fd = os.open(self.evidence_dir, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        finally:
            with contextlib.suppress(FileNotFoundError):
                os.unlink(staged)
        return path

    def activate(self, operation_id: str) -> Mapping[str, Any]:
        edge.valid_uuid(operation_id)
        with self._lock():
            self._preflight()
            self._candidate()
            self._capability_unavailable()
            before = self._identity()
            require(before["site_sha256"] == self.expected_site_sha
                    and before["dump_sha256"] == self.expected_dump_sha, "config_identity")
            original = edge.secure_file(self.site, expected_uid=os.geteuid())
            active = render(original, operation_id=operation_id,
                            build=self.candidate_build, port=self.candidate_port)
            self._probe_routes(active=False)
            backup = self._record(operation_id, "before.nginx", original)
            intent = {"schema": SCHEMA, "operation_id": operation_id,
                      "before_sha256": digest(original), "active_sha256": digest(active),
                      "before_dump_sha256": before["dump_sha256"], "candidate_build": self.candidate_build,
                      "candidate_port": self.candidate_port, "candidate_id": self.candidate_id,
                      "candidate_image": self.candidate_image, "site": str(self.site),
                      "before_master_pid": before["process"]["pid"],
                      "before_master_start_ticks": before["process"]["start_ticks"],
                      "backup": str(backup), "created_at_epoch_ms": self.clock()}
            self._record(operation_id, "intent.json", canonical(intent))
            info = self.site.stat()
            try:
                require(self._identity()["site_sha256"] == self.expected_site_sha, "config_drift")
                self._install(active, info)
                after = self._wait_generation(before, digest(active))
                self._candidate()
                self._probe_routes(active=True)
                self._capability_unavailable()
                self._record(operation_id, "activation.json", canonical({
                    **intent, "active_dump_sha256": after["dump_sha256"],
                    "activated_at_epoch_ms": self.clock(),
                }))
                return {"schema": SCHEMA, "active": True, "operation_id": operation_id,
                        "site_sha256": digest(active), "dump_sha256": after["dump_sha256"]}
            except Exception as error:
                # Restore only our exact bytes. Foreign changes require an
                # operator investigation instead of overwriting them.
                if edge.secure_file(self.site, expected_uid=os.geteuid()) == active:
                    try:
                        failed_identity = self._identity()
                        self._install(original, info)
                        self._wait_generation(failed_identity, digest(original))
                        self._probe_routes(active=False)
                    except Exception as restore_error:
                        raise edge.ControlError("rollback_ambiguous") from restore_error
                raise edge.ControlError("activation_failed") from error

    def _recover_intent(self, operation_id: str) -> Mapping[str, Any]:
        """Restore an exact staged generation after interruption before activation record."""
        intent_raw = edge.secure_file(self.evidence_dir / f"{operation_id}.intent.json",
                                      mode=0o600, expected_uid=os.geteuid())
        intent = json.loads(intent_raw)
        require(canonical(intent) == intent_raw and intent.get("schema") == SCHEMA
                and intent.get("operation_id") == operation_id and intent.get("site") == str(self.site)
                and intent.get("candidate_build") == self.candidate_build
                and intent.get("candidate_port") == self.candidate_port
                and intent.get("candidate_id") == self.candidate_id
                and intent.get("candidate_image") == self.candidate_image, "intent_record")
        backup_path = self.evidence_dir / f"{operation_id}.before.nginx"
        require(intent.get("backup") == str(backup_path), "intent_record")
        backup = edge.secure_file(backup_path, mode=0o600, expected_uid=os.geteuid())
        require(digest(backup) == intent["before_sha256"] == self.expected_site_sha
                and intent["before_dump_sha256"] == self.expected_dump_sha, "backup_identity")
        active = render(backup, operation_id=operation_id,
                        build=self.candidate_build, port=self.candidate_port)
        require(digest(active) == intent["active_sha256"], "route_identity")
        current_raw = edge.secure_file(self.site, expected_uid=os.geteuid())
        require(current_raw in {active, backup}, "config_drift")
        before = self._identity()
        same_master = (before["process"]["pid"] == intent["before_master_pid"]
                       and before["process"]["start_ticks"] == intent["before_master_start_ticks"])
        if not same_master and current_raw == active:
            # A host reboot can change the master PID after Nginx starts
            # serving the staged route but before activation.json is written.
            # The exact owned site and backup are already pinned above; also
            # require the running config to include this one route and the
            # same candidate image/ID before restoring it.
            dump = self.system.command([str(self.nginx), "-T"])
            require(dump.count(BEGIN.encode()) == 1 and dump.count(END.encode()) == 1,
                    "reboot_config_identity")
            candidate = self.system.container(self.candidate_name)
            require(candidate[0] == self.candidate_id and candidate[1] == self.candidate_image,
                    "reboot_candidate_identity")
        elif not same_master:
            require(before["dump_sha256"] == intent["before_dump_sha256"], "reboot_config_identity")
        info = self.site.stat()
        try:
            if current_raw == active:
                self._install(backup, info)
                after = self._wait_generation(before, digest(backup))
            else:
                after = before
            require(after["site_sha256"] == intent["before_sha256"]
                    and after["dump_sha256"] == intent["before_dump_sha256"], "recovery_identity")
            self._probe_routes(active=False)
        except Exception as error:
            # A failed nginx -t/reload after writing the backup can leave the
            # disk on baseline bytes while old workers still serve the photo
            # route. Restore the exact staged bytes and prove that generation.
            if current_raw != active:
                raise edge.ControlError("recovery_ambiguous") from error
            current = edge.secure_file(self.site, expected_uid=os.geteuid())
            if current not in {backup, active}:
                raise edge.ControlError("recovery_ambiguous") from error
            try:
                failed_identity = self._identity()
                if current == backup:
                    self._install(active, info)
                    restored = self._wait_generation(failed_identity, digest(active))
                else:
                    restored = failed_identity
                require(restored["site_sha256"] == intent["active_sha256"], "recovery_restore")
                self._probe_routes(active=True)
            except Exception as restore_error:
                raise edge.ControlError("recovery_ambiguous") from restore_error
            raise edge.ControlError("recovery_failed") from error
        recovery = self.evidence_dir / f"{operation_id}.recovery.json"
        if not recovery.exists():
            self._record(operation_id, "recovery.json", canonical({
                "schema": SCHEMA, "operation_id": operation_id,
                "intent_sha256": digest(intent_raw), "restored_site_sha256": digest(backup),
                "restored_dump_sha256": after["dump_sha256"],
                "recovered_at_epoch_ms": self.clock(),
            }))
        return {"schema": SCHEMA, "active": False, "operation_id": operation_id,
                "recovered_from_intent": True}

    def rollback(self, operation_id: str) -> Mapping[str, Any]:
        edge.valid_uuid(operation_id)
        with self._lock():
            try:
                record_raw = edge.secure_file(self.evidence_dir / f"{operation_id}.activation.json",
                                            mode=0o600, expected_uid=os.geteuid())
            except FileNotFoundError:
                return self._recover_intent(operation_id)
            record = json.loads(record_raw)
            require(canonical(record) == record_raw and record.get("schema") == SCHEMA
                    and record.get("operation_id") == operation_id and record.get("site") == str(self.site)
                    and record.get("candidate_build") == self.candidate_build
                    and record.get("candidate_port") == self.candidate_port
                    and record.get("candidate_id") == self.candidate_id
                    and record.get("candidate_image") == self.candidate_image, "activation_record")
            backup = edge.secure_file(self.evidence_dir / f"{operation_id}.before.nginx",
                                      mode=0o600, expected_uid=os.geteuid())
            require(digest(backup) == record["before_sha256"] == self.expected_site_sha, "backup_identity")
            active = render(backup, operation_id=operation_id,
                            build=self.candidate_build, port=self.candidate_port)
            require(digest(active) == record["active_sha256"], "route_identity")
            before = self._identity()
            if before["site_sha256"] == record["before_sha256"]:
                require(before["dump_sha256"] == record["before_dump_sha256"], "config_drift")
                try:
                    self._probe_routes(active=False)
                except Exception:
                    # A crash between atomic file replacement and Nginx
                    # reload leaves baseline bytes on disk with old workers
                    # still serving the photo route. Reload those exact bytes
                    # and only declare rollback after a fresh generation and
                    # baseline health are proved.
                    info = self.site.stat()
                    try:
                        self._install(backup, info)
                        after = self._wait_generation(before, digest(backup))
                        require(after["dump_sha256"] == record["before_dump_sha256"], "rollback_dump")
                        self._probe_routes(active=False)
                        before = after
                    except Exception as error:
                        if edge.secure_file(self.site, expected_uid=os.geteuid()) != backup:
                            raise edge.ControlError("rollback_ambiguous") from error
                        try:
                            failed_identity = self._identity()
                            self._install(active, info)
                            restored = self._wait_generation(failed_identity, digest(active))
                            require(restored["dump_sha256"] == record["active_dump_sha256"], "restore_dump")
                            self._probe_routes(active=True)
                        except Exception as restore_error:
                            raise edge.ControlError("rollback_ambiguous") from restore_error
                        raise edge.ControlError("rollback_failed") from error
                if not (self.evidence_dir / f"{operation_id}.rollback.json").exists():
                    self._record(operation_id, "rollback.json", canonical({
                        "schema": SCHEMA, "operation_id": operation_id, "site_sha256": digest(backup),
                        "dump_sha256": before["dump_sha256"], "rolled_back_at_epoch_ms": self.clock(),
                    }))
                return {"schema": SCHEMA, "active": False, "operation_id": operation_id}
            require(before["site_sha256"] == record["active_sha256"]
                    and before["dump_sha256"] == record["active_dump_sha256"], "config_drift")
            require(edge.secure_file(self.site, expected_uid=os.geteuid()) == active, "route_identity")
            info = self.site.stat()
            try:
                self._install(backup, info)
                after = self._wait_generation(before, digest(backup))
                require(after["dump_sha256"] == record["before_dump_sha256"], "rollback_dump")
                self._probe_routes(active=False)
            except Exception as error:
                # A failed release leaves the known active route in place.
                # Restoring a foreign generation would hide its actual state.
                if edge.secure_file(self.site, expected_uid=os.geteuid()) != backup:
                    raise edge.ControlError("rollback_ambiguous") from error
                try:
                    failed_identity = self._identity()
                    self._install(active, info)
                    restored = self._wait_generation(failed_identity, digest(active))
                    require(restored["dump_sha256"] == record["active_dump_sha256"], "restore_dump")
                    self._probe_routes(active=True)
                except Exception as restore_error:
                    raise edge.ControlError("rollback_ambiguous") from restore_error
                raise edge.ControlError("rollback_failed") from error
            self._record(operation_id, "rollback.json", canonical({
                "schema": SCHEMA, "operation_id": operation_id, "site_sha256": digest(backup),
                "dump_sha256": after["dump_sha256"], "rolled_back_at_epoch_ms": self.clock(),
            }))
            return {"schema": SCHEMA, "active": False, "operation_id": operation_id}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("activate", "rollback"))
    parser.add_argument("--operation-id", required=True)
    parser.add_argument("--site", type=Path, required=True)
    parser.add_argument("--nginx", type=Path, default=Path("/usr/sbin/nginx"))
    parser.add_argument("--pid-file", type=Path, default=Path("/run/nginx.pid"))
    parser.add_argument("--evidence-dir", type=Path, required=True)
    parser.add_argument("--preflight", type=Path, required=True)
    parser.add_argument("--expected-site-sha256", required=True)
    parser.add_argument("--expected-dump-sha256", required=True)
    parser.add_argument("--expected-nginx-exe-sha256", required=True)
    parser.add_argument("--candidate-build", required=True)
    parser.add_argument("--candidate-port", required=True, type=int)
    parser.add_argument("--candidate-name", required=True)
    parser.add_argument("--candidate-id", required=True)
    parser.add_argument("--candidate-image", required=True)
    parser.add_argument("--probes-file", type=Path, required=True)
    parser.add_argument("--expected-probes-sha256", required=True)
    parser.add_argument("--tenant-id", type=int, required=True)
    args = parser.parse_args(argv)
    try:
        require(os.geteuid() == 0, "root_required")
        require(all(_SHA.fullmatch(item) for item in (
            args.expected_site_sha256, args.expected_dump_sha256, args.expected_nginx_exe_sha256,
        )), "arguments")
        controller = Controller(LocalSystem(), site=args.site, nginx=args.nginx,
            pid_file=args.pid_file, evidence_dir=args.evidence_dir,
            expected_site_sha=args.expected_site_sha256, expected_dump_sha=args.expected_dump_sha256,
            expected_exe_sha=args.expected_nginx_exe_sha256,
            candidate_build=args.candidate_build, candidate_port=args.candidate_port,
            candidate_name=args.candidate_name, candidate_id=args.candidate_id,
            candidate_image=args.candidate_image,
            preflight=args.preflight, probes_file=args.probes_file,
            expected_probes_sha=args.expected_probes_sha256, tenant_id=args.tenant_id)
        result = controller.activate(args.operation_id) if args.action == "activate" else controller.rollback(args.operation_id)
        sys.stdout.buffer.write(canonical(result))
        return 0
    except (edge.ControlError, OSError, ValueError, KeyError, TypeError) as error:
        stage = error.stage if isinstance(error, edge.ControlError) else "controller_failure"
        sys.stderr.write(json.dumps({"schema": SCHEMA, "ok": False, "stage": stage}, separators=(",", ":")) + "\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
