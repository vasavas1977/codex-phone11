#!/usr/bin/env python3
"""Fail-closed blue/green replacement for Phone11's workerless API candidate.

This operator never stops or recreates ``cp11-backend`` or the current
``cp11-api-candidate``.  It clones the current candidate's rendered service and
effective environment in memory, starts one reviewed image on loopback 3003,
and atomically moves only the two tRPC locations from 3002 to 3003.  Protected
values are written only to a root-only temporary Compose file and are never
printed.  Profile-photo HTTP routes and migrations are deliberately out of
scope; the protected probe set must prove that photo capability is unavailable.
"""

from __future__ import annotations

import argparse
import copy
from dataclasses import dataclass
import importlib.util
import json
import os
from pathlib import Path
import re
import socket
import stat
import sys
import time
from typing import Any, Mapping, Sequence
from urllib.parse import quote


HERE = Path(__file__).resolve().parent
PILOT_PATH = HERE / "phone11-parallel-api-pilot.py"
SPEC = importlib.util.spec_from_file_location("phone11_parallel_api_pilot_shared", PILOT_PATH)
if SPEC is None or SPEC.loader is None:  # pragma: no cover - packaging failure
    raise RuntimeError("parallel operator unavailable")
pilot = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = pilot
SPEC.loader.exec_module(pilot)

SCHEMA = "phone11-candidate-bluegreen/v1"
BASELINE_CONTAINER = "cp11-backend"
CURRENT_CONTAINER = "cp11-api-candidate"
TARGET_CONTAINER = "cp11-api-candidate-next"
TARGET_SERVICE = "candidate_next"
TARGET_PORT = 3003
CURRENT_PORT = 3002
ROLE = "api-candidate"
PUBLIC_ORIGIN = "https://api.phone11.ai"
SOURCE_PROBES = {"existing_phone", "existing_chat", "conference", "mixed_batch", "denied_tenant"}
EXPECTED_PROBES = {
    "existing_phone", "existing_chat", "mixed_batch", "management_self_service",
    "management_tenant", "profile_photo_unavailable", "denied_tenant",
}
STATE_ROOT = Path("/var/lib/phone11-candidate-bluegreen")
ROLLBACK_SITE = STATE_ROOT / "nginx.before"
ROLLBACK_RECEIPT = STATE_ROOT / "receipt.json"
LOCK_FILE = pilot.LOCK_FILE
PHOTO_CATALOG_NODE = r'''const pg=require("pg");function first(...k){for(const x of k)if(process.env[x])return process.env[x]}function config(){const d={host:first("PG_HOST","DB_HOST","POSTGRES_HOST"),port:Number(first("PG_PORT","DB_PORT","POSTGRES_PORT")||5432),user:first("PG_USER","DB_USER","POSTGRES_USER"),password:first("PG_PASSWORD","DB_PASSWORD","POSTGRES_PASSWORD"),database:first("PG_DATABASE","DB_NAME","DB_DATABASE","POSTGRES_DB")};const complete=d.host&&d.user&&d.password&&d.database,cs=process.env.PG_CONNECTION_STRING||(!complete?process.env.DATABASE_URL:undefined),mode=(first("PG_SSL","DB_SSL","POSTGRES_SSL","DATABASE_SSL")||"").toLowerCase(),ssl=mode==="false"||mode==="0"||mode==="disable"||(cs||"").includes("sslmode=disable")?false:{rejectUnauthorized:first("PG_SSL_REJECT_UNAUTHORIZED","DB_SSL_REJECT_UNAUTHORIZED")==="true"};return cs?{connectionString:cs,ssl,connectionTimeoutMillis:5000}:{...d,ssl,connectionTimeoutMillis:5000}}(async()=>{const c=new pg.Client(config());await c.connect();try{await c.query("BEGIN TRANSACTION READ ONLY");await c.query("SET LOCAL statement_timeout='5000ms'");const r=await c.query("SELECT to_regclass('public.phone11_workspace_profile_photos') IS NOT NULL photos,to_regclass('public.phone11_profile_photo_deletions') IS NOT NULL deletions");await c.query("ROLLBACK");process.stdout.write(JSON.stringify(r.rows[0]))}finally{await c.end()}})().catch(()=>process.exit(1));'''

GuardError = pilot.GuardError
AtomicWriteError = pilot.AtomicWriteError
System = pilot.System
sha256_bytes = pilot.sha256_bytes
canonical_hash = pilot.canonical_hash
secure_read = pilot.secure_read
strict_json = pilot.strict_json
exact_keys = pilot.exact_keys
guarded = pilot.guarded
is_sha256 = pilot.is_sha256
is_image_digest = pilot.is_image_digest
require_sha256 = pilot.require_sha256
environment = pilot.environment
runtime_shape = pilot.runtime_shape
candidate_runtime_shape = pilot.candidate_runtime_shape
one_inspect = pilot.one_inspect
atomic_write = pilot.atomic_write
frozen_candidate_config = pilot.frozen_candidate_config
operator_lock = pilot.operator_lock
request_result = pilot.request_result


@dataclass(frozen=True)
class RuntimePin:
    container_id: str
    image: str
    runtime_sha256: str
    build: str


@dataclass(frozen=True)
class Pins:
    baseline: RuntimePin
    current: RuntimePin
    current_compose_file: Path
    current_compose_sha256: str
    current_rendered_sha256: str
    release_image: str
    release_build: str
    release_source_sha: str
    release_bundle_sha256: str
    release_lock_sha256: str
    target_project: str
    tenant_id: int
    denied_tenant_id: int
    probes_file: Path
    probes_sha256: str
    nginx_site: Path
    nginx_site_sha256: str
    nginx_dump_sha256: str
    nginx_marker: str
    public_origin: str
    kamailio_config_path: str
    kamailio_config_sha256: str
    kamailio_wake_occurrences: int


def _runtime(value: Any) -> RuntimePin:
    guarded(isinstance(value, Mapping), "manifest")
    exact_keys(value, {"container_id", "image", "runtime_sha256", "build"}, "manifest")
    guarded(isinstance(value.get("container_id"), str) and bool(re.fullmatch(r"[0-9a-f]{64}", value["container_id"])), "manifest")
    guarded(is_image_digest(value.get("image")) and is_sha256(value.get("runtime_sha256")), "manifest")
    guarded(isinstance(value.get("build"), str) and bool(re.fullmatch(r"[A-Za-z0-9_.-]{7,128}", value["build"])), "manifest")
    return RuntimePin(value["container_id"], value["image"], value["runtime_sha256"], value["build"])


def parse_manifest(document: Mapping[str, Any]) -> Pins:
    exact_keys(document, {"schema", "baseline", "current_candidate", "release", "target", "probes", "nginx", "kamailio", "public_origin"}, "manifest")
    guarded(document.get("schema") == SCHEMA, "manifest")
    baseline = _runtime(document.get("baseline"))
    current_raw = document.get("current_candidate")
    release, target = document.get("release"), document.get("target")
    probes, nginx, kamailio = document.get("probes"), document.get("nginx"), document.get("kamailio")
    for value in (current_raw, release, target, probes, nginx, kamailio):
        guarded(isinstance(value, Mapping), "manifest")
    exact_keys(current_raw, {"container_id", "image", "runtime_sha256", "build", "compose_file", "compose_sha256", "rendered_sha256"}, "manifest")
    current = _runtime({key: current_raw[key] for key in ("container_id", "image", "runtime_sha256", "build")})
    exact_keys(release, {"image", "build", "source_sha", "bundle_sha256", "lock_sha256"}, "manifest")
    exact_keys(target, {"project", "tenant_id", "denied_tenant_id"}, "manifest")
    exact_keys(probes, {"file", "sha256"}, "manifest")
    exact_keys(nginx, {"site", "site_sha256", "dump_sha256", "marker"}, "manifest")
    exact_keys(kamailio, {"config_path", "config_sha256", "wake_occurrences"}, "manifest")
    guarded(is_image_digest(release.get("image")) and release.get("image") not in {baseline.image, current.image}, "manifest")
    guarded(isinstance(release.get("build"), str) and bool(re.fullmatch(r"[A-Za-z0-9_.-]{7,128}", release["build"])), "manifest")
    guarded(isinstance(release.get("source_sha"), str) and bool(re.fullmatch(r"[0-9a-f]{40}", release["source_sha"])), "manifest")
    guarded(all(is_sha256(release.get(key)) for key in ("bundle_sha256", "lock_sha256")), "manifest")
    guarded(isinstance(target.get("project"), str) and bool(re.fullmatch(r"[a-z][a-z0-9_-]{7,62}", target["project"])), "manifest")
    guarded(target["project"] != "phone11-api-candidate", "manifest")
    guarded(type(target.get("tenant_id")) is int and 1 <= target["tenant_id"] <= 2_147_483_647, "manifest")
    guarded(type(target.get("denied_tenant_id")) is int and 1 <= target["denied_tenant_id"] <= 2_147_483_647 and target["denied_tenant_id"] != target["tenant_id"], "manifest")
    for value in (current_raw.get("compose_sha256"), current_raw.get("rendered_sha256"), probes.get("sha256"), nginx.get("site_sha256"), nginx.get("dump_sha256"), kamailio.get("config_sha256")):
        guarded(is_sha256(value), "manifest")
    marker = nginx.get("marker")
    guarded(isinstance(marker, str) and marker.startswith("# PHONE11_PARALLEL_API_INSERT ") and "\n" not in marker, "manifest")
    guarded(document.get("public_origin") == PUBLIC_ORIGIN, "manifest")
    paths = (current_raw.get("compose_file"), probes.get("file"), nginx.get("site"), kamailio.get("config_path"))
    guarded(all(isinstance(path, str) and path.startswith("/") and "\x00" not in path for path in paths), "manifest")
    guarded(type(kamailio.get("wake_occurrences")) is int and 1 <= kamailio["wake_occurrences"] <= 100, "manifest")
    return Pins(
        baseline, current, Path(current_raw["compose_file"]), current_raw["compose_sha256"], current_raw["rendered_sha256"],
        release["image"], release["build"], release["source_sha"], release["bundle_sha256"], release["lock_sha256"],
        target["project"], target["tenant_id"], target["denied_tenant_id"], Path(probes["file"]), probes["sha256"], Path(nginx["site"]), nginx["site_sha256"],
        nginx["dump_sha256"], marker, document["public_origin"], kamailio["config_path"], kamailio["config_sha256"], kamailio["wake_occurrences"],
    )


def load_pins(path: Path) -> Pins:
    guarded(os.geteuid() == 0, "root")
    return parse_manifest(strict_json(secure_read(path, mode=0o600), "manifest"))


def emit_inventory(arguments: argparse.Namespace, system: System) -> None:
    """Write a complete nonsecret manifest from fresh live pins.

    The protected probe bundle is read only to validate its shape and hash. Its
    authentication headers never enter the manifest or stdout.
    """

    guarded(os.geteuid() == 0, "root")
    guarded(arguments.output is not None and arguments.output.is_absolute(), "inventory")
    guarded(arguments.current_compose_file is not None and arguments.current_compose_file.is_absolute(), "inventory")
    guarded(arguments.probes_file is not None and arguments.probes_file.is_absolute(), "inventory")
    guarded(arguments.nginx_site is not None and arguments.nginx_site.is_absolute(), "inventory")
    guarded(arguments.release_image is not None and is_image_digest(arguments.release_image), "inventory")
    guarded(isinstance(arguments.release_build, str) and bool(re.fullmatch(r"[A-Za-z0-9_.-]{7,128}", arguments.release_build)), "inventory")
    guarded(isinstance(arguments.release_source_sha, str) and bool(re.fullmatch(r"[0-9a-f]{40}", arguments.release_source_sha)), "inventory")
    guarded(type(arguments.tenant_id) is int and type(arguments.denied_tenant_id) is int, "inventory")
    guarded(not os.path.lexists(arguments.output), "inventory")

    baseline = one_inspect(system, BASELINE_CONTAINER, "inventory")
    current = one_inspect(system, CURRENT_CONTAINER, "inventory")
    for inspect, role in ((baseline, "default"), (current, ROLE)):
        state = inspect.get("State")
        guarded(isinstance(state, Mapping) and state.get("Running") is True and state.get("Health", {}).get("Status") == "healthy", "inventory")
        env = environment(inspect, "inventory")
        guarded(env.get("PHONE11_RUNTIME_ROLE", "default") == role and isinstance(env.get("PHONE11_BUILD_SHA"), str), "inventory")

    compose_raw = secure_read(arguments.current_compose_file)
    rendered = system.json_command(["docker", "compose", "-f", str(arguments.current_compose_file), "config", "--format", "json"], "inventory")
    guarded(isinstance(rendered, Mapping), "inventory")
    probe_raw = secure_read(arguments.probes_file, mode=0o600)
    site_raw = secure_read(arguments.nginx_site)
    markers = re.findall(rb"(?m)^\s*(# PHONE11_PARALLEL_API_INSERT [^\r\n]+)\s*$", site_raw)
    guarded(len(markers) == 1, "inventory")
    try:
        marker = markers[0].decode("ascii")
    except UnicodeDecodeError as error:
        raise GuardError("inventory") from error

    release = system.json_command(["docker", "image", "inspect", arguments.release_image], "inventory")
    guarded(isinstance(release, list) and len(release) == 1 and release[0].get("Id") == arguments.release_image, "inventory")
    labels = release[0].get("Config", {}).get("Labels")
    guarded(isinstance(labels, Mapping), "inventory")
    source_sha = labels.get("com.phone11.source-sha")
    bundle_sha = labels.get("com.phone11.bundle-sha256")
    lock_sha = labels.get("com.phone11.lock-sha256")
    guarded(source_sha == arguments.release_source_sha and is_sha256(bundle_sha) and is_sha256(lock_sha), "inventory")

    kam_raw = system.command(["docker", "exec", "p11-kamailio", "cat", arguments.kamailio_config_path])
    wake_count = kam_raw.count(pilot.WAKE_URL.encode())
    guarded(1 <= wake_count <= 100, "inventory")
    document = {
        "schema": SCHEMA,
        "baseline": {
            "container_id": baseline.get("Id"), "image": baseline.get("Image"),
            "runtime_sha256": canonical_hash(candidate_runtime_shape(baseline)),
            "build": environment(baseline, "inventory")["PHONE11_BUILD_SHA"],
        },
        "current_candidate": {
            "container_id": current.get("Id"), "image": current.get("Image"),
            "runtime_sha256": canonical_hash(candidate_runtime_shape(current)),
            "build": environment(current, "inventory")["PHONE11_BUILD_SHA"],
            "compose_file": str(arguments.current_compose_file), "compose_sha256": sha256_bytes(compose_raw),
            "rendered_sha256": canonical_hash(rendered),
        },
        "release": {
            "image": arguments.release_image, "build": arguments.release_build, "source_sha": source_sha,
            "bundle_sha256": bundle_sha, "lock_sha256": lock_sha,
        },
        "target": {"project": arguments.target_project, "tenant_id": arguments.tenant_id, "denied_tenant_id": arguments.denied_tenant_id},
        "probes": {"file": str(arguments.probes_file), "sha256": sha256_bytes(probe_raw)},
        "nginx": {
            "site": str(arguments.nginx_site), "site_sha256": sha256_bytes(site_raw),
            "dump_sha256": sha256_bytes(system.command(["nginx", "-T"])), "marker": marker,
        },
        "kamailio": {
            "config_path": arguments.kamailio_config_path, "config_sha256": sha256_bytes(kam_raw),
            "wake_occurrences": wake_count,
        },
        "public_origin": PUBLIC_ORIGIN,
    }
    parsed = parse_manifest(document)
    load_probes(probe_raw, parsed)
    cloned_config(rendered, current, parsed)
    current_fragment = proxy_fragment(marker, parsed.current.build, CURRENT_PORT).rstrip(b"\n")
    guarded(site_raw.count(current_fragment) == 1 and b"127.0.0.1:3003" not in site_raw, "inventory")
    raw = json.dumps(document, sort_keys=True, separators=(",", ":")).encode()
    atomic_write(arguments.output, raw, mode=0o600, uid=0, gid=0)
    print(f"inventory=READY manifest_sha256={sha256_bytes(raw)}")


def proxy_fragment(marker: str, build: str, port: int) -> bytes:
    guarded(port in {CURRENT_PORT, TARGET_PORT} and bool(re.fullmatch(r"[A-Za-z0-9_.-]{7,128}", build)), "nginx_route")
    return (
        "    location = /api/trpc {\n"
        f"        proxy_pass http://127.0.0.1:{port};\n"
        "        proxy_http_version 1.1;\n"
        "        proxy_pass_request_headers on;\n"
        "        proxy_set_header Host $host;\n"
        "        proxy_set_header X-Real-IP $remote_addr;\n"
        "        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n"
        "        proxy_set_header X-Forwarded-Proto $scheme;\n"
        f"        add_header X-Phone11-Api-Candidate {build} always;\n"
        "    }\n"
        "    location ^~ /api/trpc/ {\n"
        f"        proxy_pass http://127.0.0.1:{port};\n"
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


def load_probes(raw: bytes, pins: Pins) -> list[Mapping[str, Any]]:
    require_sha256(raw, pins.probes_sha256, "probes")
    document = strict_json(raw, "probes")
    exact_keys(document, {"schema", "probes"}, "probes")
    guarded(document.get("schema") == "phone11-parallel-api-probes/v1" and isinstance(document.get("probes"), list), "probes")
    labels: set[str] = set()
    source_probes: list[Mapping[str, Any]] = []
    for probe in document["probes"]:
        guarded(isinstance(probe, Mapping), "probes")
        exact_keys(probe, {"label", "method", "path", "headers", "body", "status", "required", "forbidden"}, "probes")
        label, path, headers = probe.get("label"), probe.get("path"), probe.get("headers")
        guarded(label in SOURCE_PROBES and label not in labels, "probes")
        labels.add(label)
        guarded(probe.get("method") in {"GET", "POST"} and isinstance(path, str) and path.startswith("/api/trpc/") and "\r" not in path and "\n" not in path, "probes")
        guarded(isinstance(headers, Mapping) and ("Authorization" in headers or "Cookie" in headers), "probes")
        guarded(all(isinstance(key, str) and isinstance(value, str) and "\r" not in key + value and "\n" not in key + value for key, value in headers.items()), "probes")
        guarded(isinstance(probe.get("body"), str) and len(probe["body"].encode()) <= 1_048_576 and isinstance(probe.get("status"), int), "probes")
        guarded(all(isinstance(values, list) and all(isinstance(item, str) for item in values) for values in (probe.get("required"), probe.get("forbidden"))), "probes")
        if label == "existing_phone":
            guarded(probe["method"] == "GET" and probe["body"] == "" and path.split("?", 1)[0] == "/api/trpc/phone.getConfig", "probes")
        if label == "mixed_batch":
            guarded("," in path and re.search(r"(?:\?|&)batch=1(?:&|$)", path) is not None, "probes")
        source_probes.append(probe)
    guarded(labels == SOURCE_PROBES, "probes")
    source = next(probe for probe in source_probes if probe["label"] == "existing_phone")
    guarded(source["method"] == "GET" and source["body"] == "" and source["path"].split("?", 1)[0] == "/api/trpc/phone.getConfig", "probes")
    headers = dict(source["headers"])
    forbidden = sorted(set(source["forbidden"]) | {"c11_live_", "DATABASE_URL", "sip_password"})
    tenant = quote(json.dumps({"json": {"tenantId": pins.tenant_id}}, separators=(",", ":")), safe="")
    denied = quote(json.dumps({"json": {"tenantId": pins.denied_tenant_id}}, separators=(",", ":")), safe="")
    empty = quote(json.dumps({"json": None}, separators=(",", ":")), safe="")
    batch = quote(json.dumps({"0": {"json": None}, "1": {"json": {"tenantId": pins.tenant_id}}}, separators=(",", ":")), safe="")
    probes: list[Mapping[str, Any]] = [
        source,
        {
            "label": "existing_chat", "method": "GET",
            "path": f"/api/trpc/chat.list?input={tenant}", "headers": headers,
            "body": "", "status": 200, "required": ["result"], "forbidden": forbidden,
        },
        {
            "label": "mixed_batch", "method": "GET",
            "path": f"/api/trpc/phone.getConfig,chat.list?batch=1&input={batch}", "headers": headers,
            "body": "", "status": 200, "required": ["result"], "forbidden": forbidden,
        },
        {
            "label": "management_self_service", "method": "GET",
            "path": f"/api/trpc/pbx.selfService.overview?input={empty}", "headers": headers,
            "body": "", "status": 200, "required": ["result"], "forbidden": forbidden,
        },
        {
            "label": "management_tenant", "method": "GET",
            "path": f"/api/trpc/pbx.tenant.get?input={empty}", "headers": headers,
            "body": "", "status": 200,
            "required": ['"settingsAvailable":false', '"userRole"'],
            "forbidden": forbidden,
        },
        {
            "label": "profile_photo_unavailable", "method": "GET",
            "path": f"/api/trpc/profile.photoCapability?input={tenant}", "headers": headers,
            "body": "", "status": 200, "required": ['"available":false'], "forbidden": forbidden,
        },
        {
            "label": "denied_tenant", "method": "GET",
            "path": f"/api/trpc/profile.photoCapability?input={denied}", "headers": headers,
            "body": "", "status": 403, "required": ["FORBIDDEN"], "forbidden": forbidden,
        },
    ]
    guarded({probe["label"] for probe in probes} == EXPECTED_PROBES and all(probe["method"] == "GET" and probe["body"] == "" for probe in probes), "probes")
    return probes


def run_probes(system: System, origin: str, probes: Sequence[Mapping[str, Any]]) -> None:
    for probe in probes:
        result = request_result(system.request(origin, probe))
        guarded(result.status == probe["status"], "probes")
        try:
            body = result.body.decode("utf-8", errors="strict")
        except UnicodeDecodeError as error:
            raise GuardError("probes") from error
        guarded(all(value in body for value in probe["required"]) and all(value not in body for value in probe["forbidden"]), "probes")


def readiness_probe(probes: Sequence[Mapping[str, Any]], host: str | None = None) -> Mapping[str, Any]:
    source = [probe for probe in probes if probe.get("label") == "existing_phone"]
    guarded(len(source) == 1, "readiness")
    headers = {key: value for key, value in source[0]["headers"].items() if key.lower() not in {"connection", "host"}}
    headers["Connection"] = "close"
    if host is not None:
        headers["Host"] = host
    return {**source[0], "headers": headers}


def wait_for_route(system: System, origin: str, probe: Mapping[str, Any], build: str, *, consecutive: int) -> None:
    deadline = time.monotonic() + 15
    successes = 0
    while time.monotonic() < deadline:
        try:
            result = request_result(system.request(origin, {**probe, "_timeout": min(10.0, max(0.1, deadline - time.monotonic()))}))
            text = result.body.decode("utf-8", errors="strict")
            matches = result.status == probe["status"] and result.headers.get(pilot.CANDIDATE_HEADER) == (build,) and all(item in text for item in probe["required"])
            successes = successes + 1 if matches else 0
            if successes == consecutive:
                return
        except (GuardError, UnicodeDecodeError):
            successes = 0
        time.sleep(min(0.25, max(0, deadline - time.monotonic())))
    raise GuardError("readiness")


def _rewrite_healthcheck(value: Any, current_build: str, release_build: str) -> Any:
    if isinstance(value, str):
        return value.replace(":3002", ":3003").replace("PORT=3002", "PORT=3003").replace(current_build, release_build)
    if isinstance(value, list):
        return [_rewrite_healthcheck(item, current_build, release_build) for item in value]
    if isinstance(value, Mapping):
        return {key: _rewrite_healthcheck(item, current_build, release_build) for key, item in value.items()}
    return value


def cloned_config(rendered: Mapping[str, Any], inspect: Mapping[str, Any], pins: Pins) -> Mapping[str, Any]:
    services = rendered.get("services")
    guarded(isinstance(services, Mapping) and len(services) == 1, "candidate_config")
    service = copy.deepcopy(next(iter(services.values())))
    guarded(isinstance(service, dict), "candidate_config")
    config = inspect.get("Config")
    guarded(isinstance(config, Mapping), "candidate_config")
    guarded(service.get("container_name") == CURRENT_CONTAINER and service.get("image") == config.get("Image"), "candidate_config")
    current_env = dict(environment(inspect, "candidate_runtime"))
    guarded(current_env.get("PHONE11_RUNTIME_ROLE") == ROLE and current_env.get("PORT") == str(CURRENT_PORT) and current_env.get("PHONE11_BUILD_SHA") == pins.current.build, "candidate_runtime")
    current_env.update({"PHONE11_RUNTIME_ROLE": ROLE, "PORT": str(TARGET_PORT), "PHONE11_BUILD_SHA": pins.release_build})
    service["container_name"] = TARGET_CONTAINER
    service["image"] = pins.release_image
    # Compose interpolates dollar signs even in JSON input. The effective
    # runtime environment came from Docker, so escape each literal dollar once
    # for the frozen Compose document; target validation uses the raw values.
    service["environment"] = {key: value.replace("$", "$$") for key, value in current_env.items()}
    # Compose's canonical JSON model represents published ports as strings.
    service["ports"] = [{
        "host_ip": "127.0.0.1", "published": str(TARGET_PORT), "target": TARGET_PORT,
        "protocol": "tcp", "mode": "ingress",
    }]
    service["healthcheck"] = _rewrite_healthcheck(service.get("healthcheck"), pins.current.build, pins.release_build)
    labels = service.get("labels")
    guarded(labels is None or isinstance(labels, Mapping), "candidate_config")
    service["labels"] = {**dict(labels or {}), "com.phone11.candidate-build": pins.release_build}
    guarded(not service.get("privileged") and service.get("pid") != "host" and service.get("ipc") != "host" and not service.get("devices") and not service.get("cap_add"), "candidate_config")
    result = copy.deepcopy(dict(rendered))
    result["name"] = pins.target_project
    result["services"] = {TARGET_SERVICE: service}
    return result


def validate_target_roundtrip(expected: Mapping[str, Any], actual: Any) -> None:
    guarded(isinstance(actual, Mapping) and canonical_hash(actual) == canonical_hash(expected), "candidate_roundtrip")


class Operator:
    def __init__(self, pins: Pins, system: System) -> None:
        self.pins, self.system = pins, system
        self.probes: list[Mapping[str, Any]] = []
        self.target_config: Mapping[str, Any] | None = None
        self.expected_target_env: Mapping[str, str] | None = None

    def runtime(self, name: str, pin: RuntimePin, role: str, port: int) -> Mapping[str, Any]:
        inspect = one_inspect(self.system, name, f"{role}_runtime")
        state = inspect.get("State")
        guarded(inspect.get("Id") == pin.container_id and inspect.get("Image") == pin.image, f"{role}_runtime")
        guarded(isinstance(state, Mapping) and state.get("Running") is True and state.get("Health", {}).get("Status") == "healthy", f"{role}_runtime")
        guarded(canonical_hash(candidate_runtime_shape(inspect)) == pin.runtime_sha256, f"{role}_runtime")
        env = environment(inspect, f"{role}_runtime")
        guarded(env.get("PHONE11_BUILD_SHA") == pin.build and env.get("PORT", str(port)) == str(port), f"{role}_runtime")
        guarded(env.get("PHONE11_RUNTIME_ROLE", "default") == role, f"{role}_runtime")
        pilot.health(self.system, f"http://127.0.0.1:{port}", pin.build, None if role == "default" else role)
        return inspect

    def rendered_current(self, inspect: Mapping[str, Any]) -> Mapping[str, Any]:
        raw = secure_read(self.pins.current_compose_file)
        require_sha256(raw, self.pins.current_compose_sha256, "candidate_config")
        rendered = self.system.json_command(["docker", "compose", "-f", str(self.pins.current_compose_file), "config", "--format", "json"], "candidate_config")
        guarded(isinstance(rendered, Mapping) and canonical_hash(rendered) == self.pins.current_rendered_sha256, "candidate_config")
        target = cloned_config(rendered, inspect, self.pins)
        expected = dict(environment(inspect, "candidate_config"))
        expected.update({"PHONE11_RUNTIME_ROLE": ROLE, "PORT": str(TARGET_PORT), "PHONE11_BUILD_SHA": self.pins.release_build})
        self.expected_target_env = expected
        with frozen_candidate_config(target) as frozen:
            roundtrip = self.system.json_command([
                "docker", "compose", "--project-name", self.pins.target_project,
                "--project-directory", str(self.pins.current_compose_file.parent),
                "-f", str(frozen), "config", "--format", "json",
            ], "candidate_roundtrip")
        validate_target_roundtrip(target, roundtrip)
        self.target_config = target
        return target

    def target_absent(self) -> None:
        names = self.system.command(["docker", "ps", "-a", "--format", "{{.Names}}"])
        guarded(TARGET_CONTAINER.encode() not in names.splitlines(), "target_absent")
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            sock.bind(("127.0.0.1", TARGET_PORT))
        except OSError as error:
            raise GuardError("target_port") from error
        finally:
            sock.close()

    def image(self) -> None:
        value = self.system.json_command(["docker", "image", "inspect", self.pins.release_image], "image")
        guarded(isinstance(value, list) and len(value) == 1 and value[0].get("Id") == self.pins.release_image, "image")
        labels = value[0].get("Config", {}).get("Labels")
        guarded(isinstance(labels, Mapping), "image")
        guarded(labels.get("com.phone11.source-sha") == self.pins.release_source_sha and labels.get("com.phone11.bundle-sha256") == self.pins.release_bundle_sha256 and labels.get("com.phone11.lock-sha256") == self.pins.release_lock_sha256, "image")

    def nginx(self) -> bytes:
        raw = secure_read(self.pins.nginx_site)
        require_sha256(raw, self.pins.nginx_site_sha256, "nginx")
        current = proxy_fragment(self.pins.nginx_marker, self.pins.current.build, CURRENT_PORT).rstrip(b"\n")
        guarded(raw.count(current) == 1 and b"127.0.0.1:3003" not in raw and b"location = /api/profile" not in current, "nginx")
        require_sha256(self.system.command(["nginx", "-T"]), self.pins.nginx_dump_sha256, "nginx")
        return raw

    def wake(self) -> None:
        raw = self.system.command(["docker", "exec", "p11-kamailio", "cat", self.pins.kamailio_config_path])
        require_sha256(raw, self.pins.kamailio_config_sha256, "wake")
        guarded(raw.count(pilot.WAKE_URL.encode()) == self.pins.kamailio_wake_occurrences, "wake")

    def photos_absent(self, container: str = CURRENT_CONTAINER) -> None:
        value = self.system.json_command(["docker", "exec", container, "node", "-e", PHOTO_CATALOG_NODE], "photo_catalog")
        guarded(value == {"photos": False, "deletions": False}, "photo_catalog")

    def prepare(self) -> None:
        baseline = self.runtime(BASELINE_CONTAINER, self.pins.baseline, "default", 3000)
        current = self.runtime(CURRENT_CONTAINER, self.pins.current, ROLE, CURRENT_PORT)
        self.target_absent()
        self.image()
        self.rendered_current(current)
        self.probes = load_probes(secure_read(self.pins.probes_file, mode=0o600), self.pins)
        # Reuse only the authenticated read probe during prepare. Expired or
        # revoked protected credentials block before a new container is made.
        existing_phone = [probe for probe in self.probes if probe["label"] == "existing_phone"]
        guarded(len(existing_phone) == 1, "probes")
        run_probes(self.system, f"http://127.0.0.1:{CURRENT_PORT}", existing_phone)
        self.photos_absent()
        self.nginx()
        self.system.command(["nginx", "-t"])
        self.wake()
        guarded(baseline.get("Id") == self.pins.baseline.container_id, "baseline_changed")

    def target(self) -> Mapping[str, Any]:
        inspect = one_inspect(self.system, TARGET_CONTAINER, "target_runtime")
        state, config = inspect.get("State"), inspect.get("Config")
        guarded(inspect.get("Image") == self.pins.release_image and isinstance(state, Mapping) and state.get("Running") is True and state.get("Health", {}).get("Status") == "healthy", "target_runtime")
        env = environment(inspect, "target_runtime")
        guarded(self.expected_target_env is not None and env == self.expected_target_env, "target_runtime")
        guarded(env.get("PHONE11_RUNTIME_ROLE") == ROLE and env.get("PORT") == str(TARGET_PORT) and env.get("PHONE11_BUILD_SHA") == self.pins.release_build, "target_runtime")
        bindings = inspect.get("HostConfig", {}).get("PortBindings", {}).get(f"{TARGET_PORT}/tcp")
        guarded(bindings == [{"HostIp": "127.0.0.1", "HostPort": str(TARGET_PORT)}], "target_runtime")
        guarded(isinstance(config, Mapping) and isinstance(config.get("Healthcheck"), Mapping), "target_runtime")
        pilot.health(self.system, f"http://127.0.0.1:{TARGET_PORT}", self.pins.release_build, ROLE)
        return inspect

    def wait_target(self) -> Mapping[str, Any]:
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            try:
                return self.target()
            except GuardError:
                time.sleep(min(0.5, max(0, deadline - time.monotonic())))
        raise GuardError("target_readiness")

    def save_rollback(self, before: bytes, active: bytes) -> None:
        receipt = json.dumps({"schema": SCHEMA, "site": str(self.pins.nginx_site), "before": sha256_bytes(before), "active": sha256_bytes(active), "target_container": TARGET_CONTAINER, "target_build": self.pins.release_build}, sort_keys=True, separators=(",", ":")).encode()
        if os.path.lexists(STATE_ROOT):
            info = STATE_ROOT.lstat()
            guarded(stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode) and info.st_uid == 0 and info.st_gid == 0 and stat.S_IMODE(info.st_mode) == 0o700, "rollback")
        else:
            STATE_ROOT.mkdir(mode=0o700, parents=True)
        site_exists, receipt_exists = os.path.lexists(ROLLBACK_SITE), os.path.lexists(ROLLBACK_RECEIPT)
        guarded(site_exists == receipt_exists, "rollback")
        if site_exists:
            guarded(secure_read(ROLLBACK_SITE, mode=0o600) == before and secure_read(ROLLBACK_RECEIPT, mode=0o600) == receipt, "rollback")
            return
        atomic_write(ROLLBACK_SITE, before, mode=0o600, uid=0, gid=0)
        atomic_write(ROLLBACK_RECEIPT, receipt, mode=0o600, uid=0, gid=0)

    def restore(self, expected: bytes | None = None) -> None:
        receipt = strict_json(secure_read(ROLLBACK_RECEIPT, mode=0o600), "rollback")
        exact_keys(receipt, {"schema", "site", "before", "active", "target_container", "target_build"}, "rollback")
        original = secure_read(ROLLBACK_SITE, mode=0o600)
        current = secure_read(self.pins.nginx_site)
        guarded(receipt.get("schema") == SCHEMA and receipt.get("site") == str(self.pins.nginx_site) and receipt.get("target_container") == TARGET_CONTAINER and receipt.get("target_build") == self.pins.release_build, "rollback")
        guarded(sha256_bytes(original) == receipt.get("before") == self.pins.nginx_site_sha256, "rollback")
        guarded(current == expected if expected is not None else sha256_bytes(current) == receipt.get("active"), "rollback")
        info = self.pins.nginx_site.stat()
        durability_error: AtomicWriteError | None = None
        try:
            atomic_write(self.pins.nginx_site, original, mode=stat.S_IMODE(info.st_mode), uid=info.st_uid, gid=info.st_gid)
        except AtomicWriteError as error:
            if not error.committed:
                raise
            guarded(secure_read(self.pins.nginx_site) == original, "rollback")
            durability_error = error
        self.system.command(["nginx", "-t"])
        self.system.command(["nginx", "-s", "reload"])
        self.runtime(BASELINE_CONTAINER, self.pins.baseline, "default", 3000)
        self.runtime(CURRENT_CONTAINER, self.pins.current, ROLE, CURRENT_PORT)
        if not self.probes:
            self.probes = load_probes(secure_read(self.pins.probes_file, mode=0o600), self.pins)
        route_probe = readiness_probe(self.probes)
        wait_for_route(self.system, "http://127.0.0.1", readiness_probe(self.probes, "api.phone11.ai"), self.pins.current.build, consecutive=1)
        wait_for_route(self.system, self.pins.public_origin, route_probe, self.pins.current.build, consecutive=3)
        self.wake()
        if durability_error is not None:
            raise durability_error

    def activate(self) -> None:
        self.prepare()
        guarded(self.target_config is not None, "candidate_config")
        baseline_id, current_id = self.pins.baseline.container_id, self.pins.current.container_id
        with frozen_candidate_config(self.target_config) as frozen:
            self.system.command(["docker", "compose", "--project-name", self.pins.target_project, "--project-directory", str(self.pins.current_compose_file.parent), "-f", str(frozen), "up", "-d", "--no-deps", TARGET_SERVICE], timeout=90)
        self.wait_target()
        run_probes(self.system, f"http://127.0.0.1:{TARGET_PORT}", self.probes)
        self.photos_absent(TARGET_CONTAINER)
        guarded(self.runtime(BASELINE_CONTAINER, self.pins.baseline, "default", 3000).get("Id") == baseline_id, "baseline_changed")
        guarded(self.runtime(CURRENT_CONTAINER, self.pins.current, ROLE, CURRENT_PORT).get("Id") == current_id, "candidate_changed")
        original = self.nginx()
        current_fragment = proxy_fragment(self.pins.nginx_marker, self.pins.current.build, CURRENT_PORT).rstrip(b"\n")
        target_fragment = proxy_fragment(self.pins.nginx_marker, self.pins.release_build, TARGET_PORT).rstrip(b"\n")
        routed = original.replace(current_fragment, target_fragment, 1)
        guarded(routed != original and routed.count(b"location = /api/trpc") == 1 and routed.count(b"location ^~ /api/trpc/") == 1 and b"/api/profile" not in target_fragment, "nginx_route")
        self.save_rollback(original, routed)
        info = self.pins.nginx_site.stat()
        try:
            guarded(self.nginx() == original, "nginx")
            atomic_write(self.pins.nginx_site, routed, mode=stat.S_IMODE(info.st_mode), uid=info.st_uid, gid=info.st_gid)
            self.system.command(["nginx", "-t"])
            self.system.command(["nginx", "-s", "reload"])
            wait_for_route(self.system, "http://127.0.0.1", readiness_probe(self.probes, "api.phone11.ai"), self.pins.release_build, consecutive=1)
            wait_for_route(self.system, self.pins.public_origin, readiness_probe(self.probes), self.pins.release_build, consecutive=3)
            run_probes(self.system, self.pins.public_origin, self.probes)
            self.photos_absent(TARGET_CONTAINER)
            guarded(self.runtime(BASELINE_CONTAINER, self.pins.baseline, "default", 3000).get("Id") == baseline_id, "baseline_changed")
            guarded(self.runtime(CURRENT_CONTAINER, self.pins.current, ROLE, CURRENT_PORT).get("Id") == current_id, "candidate_changed")
            self.target()
            self.wake()
        except GuardError as error:
            try:
                current = secure_read(self.pins.nginx_site)
                if current == routed:
                    self.restore(expected=routed)
                else:
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
    modes.add_argument("--inventory", action="store_true")
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--current-compose-file", type=Path)
    parser.add_argument("--probes-file", type=Path)
    parser.add_argument("--nginx-site", type=Path)
    parser.add_argument("--release-image")
    parser.add_argument("--release-build")
    parser.add_argument("--release-source-sha")
    parser.add_argument("--target-project", default="phone11-api-candidate-next")
    parser.add_argument("--tenant-id", type=int)
    parser.add_argument("--denied-tenant-id", type=int)
    parser.add_argument("--kamailio-config-path", default="/etc/kamailio/kamailio.cfg")
    arguments = parser.parse_args(argv)
    if arguments.inventory:
        required = (
            arguments.output, arguments.current_compose_file, arguments.probes_file, arguments.nginx_site,
            arguments.release_image, arguments.release_build, arguments.release_source_sha,
            arguments.tenant_id, arguments.denied_tenant_id,
        )
        if any(value is None for value in required):
            parser.error("--inventory requires its inventory inputs")
        if arguments.manifest is not None:
            parser.error("--manifest is not valid with --inventory")
    elif arguments.manifest is None:
        parser.error("--manifest is required")
    return arguments


def main(argv: Sequence[str]) -> int:
    arguments = parse_args(argv)
    mode = "inventory" if arguments.inventory else "prepare" if arguments.prepare else "activation" if arguments.activate else "rollback"
    try:
        with operator_lock(LOCK_FILE):
            if arguments.inventory:
                emit_inventory(arguments, System())
            else:
                operator = Operator(load_pins(arguments.manifest), System())
                if arguments.prepare:
                    operator.prepare()
                    print("prepare=READY activation=NOT_RUN photos=UNAVAILABLE")
                elif arguments.activate:
                    operator.activate()
                    print("activation=PASS route=3003 baseline=UNCHANGED photos=UNAVAILABLE")
                else:
                    operator.restore()
                    print("rollback=PASS route=3002 candidates=RUNNING baseline=UNCHANGED")
        return 0
    except GuardError as error:
        print(f"{mode}=BLOCKED stage={error.stage}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
