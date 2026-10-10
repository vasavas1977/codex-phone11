#!/usr/bin/env python3
"""Prepare the protected Phone11 chat candidate inputs without starting it.

The script is intended to run as root on the reviewed Phone11 host.  It copies
the active service's protected Compose inputs in memory, writes a candidate
Compose file and authenticated pilot probes, and records the pins that are
known before migration.  It never prints credentials, HTTP bodies, or Docker
environment values and deliberately cannot create the activation manifest.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import http.client
import json
import os
import re
import stat
import subprocess
import tempfile
import uuid
from pathlib import Path
from typing import Any, Mapping, Sequence
from urllib.parse import parse_qs, quote, unquote, urlsplit


ACTIVE_CONTAINER = "cp11-backend"
ACTIVE_IMAGE = "sha256:d42c70f34d5062bff779c235dd2b6e415bede3b3a86b9de73892acf35b392619"
CANDIDATE_IMAGE = "sha256:cfea5fb61b244bec980211aab4f9d27320f8fd5e2deec2c5d4ae89c3f0f16e91"
CANDIDATE_BUILD = "read-receipts-a0f5c46-0c3c4e227148"
CANDIDATE_NAME = "cp11-api-candidate"
CANDIDATE_PROJECT = "phone11-read-receipts-candidate"
PUBLIC_ORIGIN = "https://api.phone11.ai"
BASE_COMPOSE = Path("/opt/phone11ai/team-chat-media-20260920T000000Z/activation/candidate.json")
CONFERENCE_ENV = "/etc/phone11/connect11-plain-video.env"
STAGE = Path("/opt/phone11ai/read-receipts-api-candidate-20260920T092516Z")
COMPOSE = STAGE / "candidate.compose.json"
PROBES = STAGE / "candidate.probes.json"
CHECKPOINT = STAGE / "pilot-fixture.json"
PREP_EVIDENCE = STAGE / "candidate-preparation.json"
NGINX_SITE = Path("/etc/nginx/sites-enabled/phone11ai")
KAMAILIO_CONTAINER = "p11-kamailio"
KAMAILIO_CONFIG = "/etc/kamailio/kamailio.cfg"
WAKE_URL = "http://127.0.0.1:3000/api/phone11/wake"
EXPECTED_NETWORK = "cloudphone11-prod_cp11-net"
EXPECTED_PILOTS = {1: "3001", 2: "1020"}
FIXTURE_PREFIX = "Phone11 rollout receipt fixture "
MESSAGE_TEXT = "Phone11 rollout read receipt fixture"
NGINX_MARKER = "# PHONE11_PARALLEL_API_INSERT read-receipts-a0f5c46-0c3c4e227148"
CANDIDATE_PGOPTIONS = "-c lock_timeout=2000ms -c statement_timeout=30000ms"


class PrepError(RuntimeError):
    def __init__(self, stage: str) -> None:
        super().__init__(stage)
        self.stage = stage


def guarded(condition: bool, stage: str) -> None:
    if not condition:
        raise PrepError(stage)


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def canonical_hash(value: Any) -> str:
    return sha256_bytes(canonical_bytes(value))


def command(args: Sequence[str], *, stdin: bytes | None = None, timeout: int = 30) -> bytes:
    try:
        result = subprocess.run(
            list(args), input=stdin, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            timeout=timeout, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise PrepError("command") from error
    if result.returncode:
        raise PrepError("command")
    return result.stdout


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
            guarded((before.st_dev, before.st_ino) == (after.st_dev, after.st_ino), "secure_file")
            chunks: list[bytes] = []
            while chunk := os.read(descriptor, 65_536):
                chunks.append(chunk)
            return b"".join(chunks)
        finally:
            os.close(descriptor)
    except PrepError:
        raise
    except OSError as error:
        raise PrepError("secure_file") from error


def atomic_write(path: Path, raw: bytes, *, mode: int = 0o600) -> None:
    descriptor: int | None = None
    temporary: str | None = None
    directory_descriptor: int | None = None
    try:
        descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
        os.fchmod(descriptor, mode)
        os.fchown(descriptor, 0, 0)
        remaining = memoryview(raw)
        while remaining:
            written = os.write(descriptor, remaining)
            guarded(written > 0, "atomic_write")
            remaining = remaining[written:]
        os.fsync(descriptor)
        os.close(descriptor)
        descriptor = None
        os.replace(temporary, path)
        temporary = None
        directory_descriptor = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        os.fsync(directory_descriptor)
    except PrepError:
        raise
    except OSError as error:
        raise PrepError("atomic_write") from error
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


def strict_json(raw: bytes, stage: str) -> Mapping[str, Any]:
    try:
        value = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise PrepError(stage) from error
    guarded(isinstance(value, Mapping), stage)
    return value


def build_candidate_compose(base: Mapping[str, Any]) -> dict[str, Any]:
    services = base.get("services")
    networks = base.get("networks")
    guarded(isinstance(services, Mapping) and set(services) == {"backend"}, "base_compose")
    guarded(isinstance(networks, Mapping) and networks.get("existing", {}).get("name") == EXPECTED_NETWORK, "base_compose")
    original = services["backend"]
    guarded(isinstance(original, Mapping), "base_compose")
    guarded(original.get("container_name") == ACTIVE_CONTAINER, "base_compose")
    guarded(isinstance(original.get("environment"), Mapping), "base_compose")
    guarded(isinstance(original.get("volumes"), list) and bool(original["volumes"]), "base_compose")
    env_files = original.get("env_file")
    guarded(isinstance(env_files, list) and all(isinstance(item, str) for item in env_files), "base_compose")

    candidate = copy.deepcopy(dict(original))
    candidate["image"] = CANDIDATE_IMAGE
    candidate["container_name"] = CANDIDATE_NAME
    candidate["restart"] = "unless-stopped"
    candidate["ports"] = [{"host_ip": "127.0.0.1", "target": 3002, "published": "3002", "protocol": "tcp"}]
    candidate["environment"].update({
        "PHONE11_RUNTIME_ROLE": "api-candidate",
        "PHONE11_BUILD_SHA": CANDIDATE_BUILD,
        "PORT": "3002",
        "PGOPTIONS": CANDIDATE_PGOPTIONS,
    })
    candidate["env_file"] = [*env_files, CONFERENCE_ENV] if CONFERENCE_ENV not in env_files else list(env_files)
    candidate["networks"] = {"existing": {}}
    candidate["labels"] = {"com.phone11.candidate-build": CANDIDATE_BUILD}
    candidate["healthcheck"] = {
        "test": [
            "CMD", "node", "-e",
            "fetch('http://127.0.0.1:3002/api/health').then(async r=>{const b=await r.json();if(!r.ok||b.runtimeRole!=='api-candidate'||b.build!=='read-receipts-a0f5c46-0c3c4e227148')process.exit(1)}).catch(()=>process.exit(1))",
        ],
        "interval": "10s", "timeout": "3s", "retries": 3, "start_period": "10s",
    }
    return {"name": CANDIDATE_PROJECT, "services": {"candidate": candidate}, "networks": copy.deepcopy(networks)}


def render_compose(path: Path) -> Mapping[str, Any]:
    raw = command([
        "docker", "compose", "--project-directory", str(path.parent), "-f", str(path),
        "config", "--format", "json",
    ])
    return strict_json(raw, "compose_render")


def validate_rendered(document: Mapping[str, Any]) -> None:
    guarded(document.get("name") == CANDIDATE_PROJECT, "compose_render")
    services = document.get("services")
    guarded(isinstance(services, Mapping) and set(services) == {"candidate"}, "compose_render")
    service = services["candidate"]
    guarded(isinstance(service, Mapping), "compose_render")
    guarded(service.get("image") == CANDIDATE_IMAGE and service.get("container_name") == CANDIDATE_NAME, "compose_render")
    env = service.get("environment")
    guarded(isinstance(env, Mapping), "compose_render")
    guarded(env.get("PHONE11_RUNTIME_ROLE") == "api-candidate" and str(env.get("PORT")) == "3002", "compose_render")
    guarded(env.get("PHONE11_BUILD_SHA") == CANDIDATE_BUILD, "compose_render")
    guarded(service.get("restart") == "unless-stopped", "compose_render")
    health_test = service.get("healthcheck", {}).get("test")
    guarded(isinstance(health_test, list) and any("127.0.0.1:3002" in str(item) for item in health_test), "compose_render")
    guarded(document.get("networks", {}).get("existing", {}).get("name") == EXPECTED_NETWORK, "compose_render")


def validate_render_roundtrip(rendered: Mapping[str, Any], directory: Path) -> None:
    frozen = directory / ".candidate.rendered.roundtrip.json"
    atomic_write(frozen, canonical_bytes(rendered))
    try:
        rerendered = render_compose(frozen)
        guarded(canonical_hash(rerendered) == canonical_hash(rendered), "compose_roundtrip")
    finally:
        frozen.unlink(missing_ok=True)


def environment_map(raw: Any, stage: str) -> dict[str, str]:
    guarded(isinstance(raw, list), stage)
    result: dict[str, str] = {}
    for item in raw:
        guarded(isinstance(item, str) and "=" in item, stage)
        key, value = item.split("=", 1)
        guarded(bool(key) and key not in result, stage)
        result[key] = value
    return result


def validate_runtime_environment(active: Mapping[str, Any], candidate_image: Mapping[str, Any],
                                 rendered: Mapping[str, Any]) -> list[str]:
    active_env = environment_map(active.get("Config", {}).get("Env"), "runtime_environment")
    effective = environment_map(candidate_image.get("Config", {}).get("Env"), "runtime_environment")
    service_env = rendered.get("services", {}).get("candidate", {}).get("environment")
    guarded(isinstance(service_env, Mapping) and all(isinstance(key, str) and isinstance(value, str)
                                                     for key, value in service_env.items()), "runtime_environment")
    effective.update(service_env)
    guarded("PGOPTIONS" not in active_env, "runtime_environment")
    database_url = active_env.get("DATABASE_URL")
    guarded(isinstance(database_url, str) and "options" not in parse_qs(urlsplit(database_url).query), "runtime_environment")
    intended = {"PHONE11_RUNTIME_ROLE", "PORT", "PHONE11_BUILD_SHA", "PGOPTIONS", "PHONE11_CONNECT11_PLAIN_VIDEO_TENANTS"}
    differing = sorted(key for key, value in active_env.items() if key not in intended and effective.get(key) != value)
    unexpected = sorted(key for key in effective if key not in active_env and key not in intended)
    return sorted(set(differing + unexpected))


TOKEN_BROKER = r"""
import pg from 'pg';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const rootRequire=createRequire(import.meta.url);
const betterCallPath=createRequire(rootRequire.resolve('better-auth')).resolve('better-call');
const {serializeSignedCookie}=await import(pathToFileURL(betterCallPath).href);
const {Pool}=pg;
const secret=process.env.PHONE11_AUTH_SECRET||'';
if(Buffer.byteLength(secret)<32)process.exit(2);
const databaseUrl=process.env.DATABASE_URL||'';
if(!databaseUrl)process.exit(2);
const pool=new Pool({connectionString:databaseUrl});
try {
 const result=await pool.query(`SELECT i.legacy_user_id AS user_id,s.token
   FROM phone11_auth_session s JOIN phone11_auth_identity i ON i.auth_user_id=s."userId" AND i.disabled_at IS NULL
   JOIN tenant_memberships tm ON tm.user_id=i.legacy_user_id AND tm.tenant_id=1 AND tm.status='active'
   JOIN user_extensions ue ON ue.user_id=i.legacy_user_id
   JOIN extensions e ON e.id=ue.extension_id AND e.tenant_id=1 AND e.status='active' AND e.deleted_at IS NULL
  WHERE i.legacy_user_id=ANY($1::int[]) AND s."expiresAt">clock_timestamp()
  ORDER BY i.legacy_user_id,s."createdAt" DESC`,[[1,2]]);
 const by=new Map(); for(const row of result.rows){if(!by.has(Number(row.user_id)))by.set(Number(row.user_id),row.token)}
 if(by.size!==2||!by.has(1)||!by.has(2))process.exit(3);
 const signed={}; for(const [id,token] of by){signed[id]=(await serializeSignedCookie('',token,secret)).replace('=','')}
 process.stdout.write(JSON.stringify(signed));
} finally {await pool.end()}
"""


def active_pilot_tokens() -> dict[int, str]:
    document = strict_json(command(
        ["docker", "exec", "-i", ACTIVE_CONTAINER, "node", "--input-type=module"],
        stdin=TOKEN_BROKER.encode(), timeout=30,
    ), "pilot_sessions")
    guarded(set(document) == {"1", "2"}, "pilot_sessions")
    tokens = {int(key): value for key, value in document.items()}
    for value in tokens.values():
        guarded(isinstance(value, str), "pilot_sessions")
        # Better Call emits a URI-encoded signed cookie. Validate a decoded copy
        # but send the exact encoded value so Better Auth follows its own decode
        # and HMAC verification path.
        decoded = unquote(value)
        parts = decoded.split(".")
        guarded(len(parts) == 2 and bool(re.fullmatch(r"[^.\s]+", parts[0]))
                and bool(re.fullmatch(r"[A-Za-z0-9+/]{43}=", parts[1])), "pilot_sessions")
    return tokens


def request(method: str, path: str, headers: Mapping[str, str], body: bytes | None = None) -> tuple[int, bytes]:
    parsed = urlsplit(PUBLIC_ORIGIN)
    connection = http.client.HTTPSConnection(parsed.hostname, parsed.port, timeout=10)
    try:
        connection.request(method, path, body=body, headers=dict(headers))
        response = connection.getresponse()
        raw = response.read(1_048_577)
        guarded(len(raw) <= 1_048_576, "http")
        return response.status, raw
    except (OSError, http.client.HTTPException) as error:
        raise PrepError("http") from error
    finally:
        connection.close()


def auth_headers(user_id: int, token: str, *, chat: bool = False) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {token}"}
    if chat:
        headers["X-Phone11-Chat-Owner"] = str(user_id)
    return headers


def trpc_path(procedures: Sequence[str], inputs: Sequence[Any], *, batch: bool = False) -> str:
    guarded(len(procedures) == len(inputs) and bool(procedures), "trpc")
    encoded = {str(index): {"json": value} for index, value in enumerate(inputs)} if batch else {"json": inputs[0]}
    suffix = "batch=1&" if batch else ""
    return f"/api/trpc/{','.join(procedures)}?{suffix}input={quote(json.dumps(encoded, separators=(',', ':')))}"


def trpc_query(procedure: str, value: Any, headers: Mapping[str, str]) -> Any:
    status, raw = request("GET", trpc_path([procedure], [value]), headers)
    guarded(status == 200, "trpc")
    try:
        return json.loads(raw)["result"]["data"]["json"]
    except (UnicodeDecodeError, json.JSONDecodeError, KeyError, TypeError) as error:
        raise PrepError("trpc") from error


def trpc_mutation(procedure: str, value: Any, headers: Mapping[str, str]) -> Any:
    body = json.dumps({"json": value}, separators=(",", ":")).encode()
    status, raw = request("POST", f"/api/trpc/{procedure}", {**headers, "Content-Type": "application/json"}, body)
    guarded(status == 200, "trpc")
    try:
        return json.loads(raw)["result"]["data"]["json"]
    except (UnicodeDecodeError, json.JSONDecodeError, KeyError, TypeError) as error:
        raise PrepError("trpc") from error


def verify_auth(tokens: Mapping[int, str]) -> None:
    for user_id, token in tokens.items():
        status, raw = request("GET", "/api/auth/me", auth_headers(user_id, token))
        guarded(status == 200, "auth_me")
        try:
            body = json.loads(raw)
            observed = body["user"]["id"]
        except (UnicodeDecodeError, json.JSONDecodeError, KeyError, TypeError) as error:
            raise PrepError("auth_me") from error
        guarded(observed == user_id, "auth_me")


def prepare_fixture(tokens: Mapping[int, str]) -> Mapping[str, Any]:
    if CHECKPOINT.exists():
        checkpoint = strict_json(secure_read(CHECKPOINT, mode=0o600), "fixture")
        guarded(checkpoint.get("schema") == "phone11-chat-pilot-fixture/v1", "fixture")
        guarded(checkpoint.get("pilotUserIds") == [1, 2] and checkpoint.get("tenantId") == 1, "fixture")
        guarded(isinstance(checkpoint.get("conversationId"), str) and isinstance(checkpoint.get("messageId"), str), "fixture")
        return checkpoint

    fixture_id, client_id = str(uuid.uuid4()), str(uuid.uuid4())
    checkpoint: dict[str, Any] = {
        "schema": "phone11-chat-pilot-fixture/v1", "fixtureId": fixture_id,
        "tenantId": 1, "pilotUserIds": [1, 2], "clientId": client_id,
        "state": "allocated",
    }
    atomic_write(CHECKPOINT, canonical_bytes(checkpoint))
    headers = auth_headers(1, tokens[1], chat=True)
    created = trpc_mutation("chat.create", {
        "tenantId": 1, "kind": "group", "name": FIXTURE_PREFIX + fixture_id, "memberIds": [2],
    }, headers)
    guarded(isinstance(created, Mapping) and isinstance(created.get("id"), str), "fixture")
    checkpoint.update({"conversationId": created["id"], "state": "group-created"})
    atomic_write(CHECKPOINT, canonical_bytes(checkpoint))
    sent = trpc_mutation("chat.send", {
        "tenantId": 1, "id": created["id"], "clientId": client_id, "content": MESSAGE_TEXT,
    }, headers)
    guarded(isinstance(sent, Mapping) and isinstance(sent.get("id"), str), "fixture")
    checkpoint.update({"messageId": sent["id"], "state": "ready"})
    atomic_write(CHECKPOINT, canonical_bytes(checkpoint))
    return checkpoint


def probe(label: str, method: str, path: str, headers: Mapping[str, str], body: str, status: int,
          required: Sequence[str], forbidden: Sequence[str]) -> dict[str, Any]:
    return {"label": label, "method": method, "path": path, "headers": dict(headers), "body": body,
            "status": status, "required": list(required), "forbidden": list(forbidden)}


def build_probes(tokens: Mapping[int, str], fixture: Mapping[str, Any]) -> Mapping[str, Any]:
    conversation_id, message_id = fixture["conversationId"], fixture["messageId"]
    h1, h2 = auth_headers(1, tokens[1], chat=True), auth_headers(2, tokens[2], chat=True)
    common_forbidden = ["access_token", "joinCredential", "statusCredential", "sipPassword", "PHONE11_AUTH_SECRET"]
    typing = {"tenantId": 1, "id": conversation_id, "sessionId": str(uuid.uuid4()),
              "generation": str(uuid.uuid4()), "sequence": 1, "active": False}
    receipt = {"tenantId": 1, "id": conversation_id, "messageIds": [message_id]}
    mutation_inputs = {"0": {"json": typing}, "1": {"json": receipt}}
    mutation_body = json.dumps(mutation_inputs, separators=(",", ":"))
    mixed_path = trpc_path(
        ["phone.getConfig", "chat.presenceCapability", "chat.readReceiptSummaries", "chat.readReceiptDetails", "chat.typing"],
        [None, {"tenantId": 1}, receipt, {"tenantId": 1, "id": conversation_id, "messageId": message_id},
         {"tenantId": 1, "id": conversation_id}], batch=True,
    )
    probes = [
        # getConfig initializes the legacy provisioning schema on first use. It
        # is prepared here, then first runs after the migration/lock decision
        # and before any proxy change. The operator never logs its response.
        probe("existing_phone", "GET", trpc_path(["phone.getConfig"], [None]), h1, "", 200,
              ['"configured":true', '"tenantId":1', '"extension"', '"sip"', '"organization"'], common_forbidden),
        probe("existing_chat", "POST", "/api/trpc/chat.typingPublish,chat.publishReadReceipts?batch=1",
              {**h2, "Content-Type": "application/json"}, mutation_body, 200,
              ['"accepted"', '"expiresAt"', '"recorded":1'], common_forbidden),
        probe("conference", "GET", trpc_path(["meetings.capabilities"], [None]), h1, "", 200,
              ['"available":false', '"video":false', '"interpretation":false', '"reason"'], common_forbidden),
        probe("mixed_batch", "GET", mixed_path, h1, "", 200,
              ['"tenantId":1', '"version":2', '"count":1', '"userId":2', '"readAt"',
               '{"result":{"data":{"json":[]}}}'], common_forbidden),
        probe("denied_tenant", "GET", trpc_path(["chat.presenceCapability"], [{"tenantId": 2147483647}]), h2, "", 403,
              ['"code":"FORBIDDEN"'], common_forbidden),
    ]
    return {"schema": "phone11-parallel-api-probes/v1", "probes": probes}


def selected_active_runtime(inspect: Mapping[str, Any]) -> Mapping[str, Any]:
    config, host, network = inspect.get("Config"), inspect.get("HostConfig"), inspect.get("NetworkSettings")
    mounts = inspect.get("Mounts")
    guarded(all(isinstance(value, Mapping) for value in (config, host, network)) and isinstance(mounts, list), "active")
    return {
        "Id": inspect.get("Id"), "Image": inspect.get("Image"),
        "Config": {key: config.get(key) for key in ("Image", "Entrypoint", "Cmd", "User", "WorkingDir")},
        "HostConfig": {key: host.get(key) for key in ("NetworkMode", "PortBindings", "RestartPolicy", "ReadonlyRootfs")},
        "Mounts": sorted(({key: item.get(key) for key in ("Type", "Source", "Destination", "RW", "Propagation")} for item in mounts), key=lambda item: str(item.get("Destination"))),
        "Networks": sorted((network.get("Networks") or {}).keys()),
    }


def active_health_build() -> str:
    status, raw = request("GET", "/api/health", {})
    guarded(status == 200, "active_health")
    try:
        body = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise PrepError("active_health") from error
    guarded(body.get("ok") is True and body.get("service") == "phone11-backend", "active_health")
    build = body.get("build")
    guarded(isinstance(build, str) and bool(build), "active_health")
    return build


def prepare() -> Mapping[str, Any]:
    guarded(os.geteuid() == 0, "root")
    guarded(STAGE.is_dir() and stat.S_IMODE(STAGE.stat().st_mode) == 0o700 and STAGE.stat().st_uid == 0, "stage")
    inspect_value = json.loads(command(["docker", "inspect", ACTIVE_CONTAINER]))
    guarded(isinstance(inspect_value, list) and len(inspect_value) == 1, "active")
    inspect = inspect_value[0]
    guarded(inspect.get("Image") == ACTIVE_IMAGE and inspect.get("State", {}).get("Running") is True
            and inspect.get("State", {}).get("Health", {}).get("Status") == "healthy", "active")
    image = json.loads(command(["docker", "image", "inspect", CANDIDATE_IMAGE]))
    guarded(isinstance(image, list) and len(image) == 1 and image[0].get("Id") == CANDIDATE_IMAGE, "candidate_image")
    names = set(command(["docker", "ps", "-a", "--format", "{{.Names}}"]).decode().splitlines())
    guarded(CANDIDATE_NAME not in names, "candidate_absent")

    base = strict_json(secure_read(BASE_COMPOSE, mode=0o600), "base_compose")
    compose = build_candidate_compose(base)
    atomic_write(COMPOSE, canonical_bytes(compose))
    rendered = render_compose(COMPOSE)
    validate_rendered(rendered)
    validate_render_roundtrip(rendered, STAGE)
    differing_environment_keys = validate_runtime_environment(inspect, image[0], rendered)
    guarded(not differing_environment_keys, "runtime_environment")

    tokens = active_pilot_tokens()
    verify_auth(tokens)
    fixture = prepare_fixture(tokens)
    probes = build_probes(tokens, fixture)
    atomic_write(PROBES, canonical_bytes(probes))

    wake = command(["docker", "exec", KAMAILIO_CONTAINER, "cat", KAMAILIO_CONFIG])
    nginx = secure_read(NGINX_SITE)
    guarded(nginx.count(("    " + NGINX_MARKER + "\n").encode()) == 1, "nginx_marker")
    nginx_dump = command(["nginx", "-T"])
    command(["nginx", "-t"])
    evidence = {
        "schema": "phone11-chat-candidate-preparation/v1", "status": "ready-deferred-finalization",
        "activation": "NOT_RUN", "migration": "NOT_APPLIED",
        "active": {"containerId": inspect["Id"], "image": inspect["Image"],
                   "runtimeSha256": canonical_hash(selected_active_runtime(inspect)), "healthBuild": active_health_build()},
        "candidate": {"image": CANDIDATE_IMAGE, "build": CANDIDATE_BUILD,
                      "composeFile": str(COMPOSE), "composeSha256": sha256_bytes(secure_read(COMPOSE, mode=0o600)),
                      "renderedConfigSha256": canonical_hash(rendered), "healthPort": 3002,
                      "containerAbsent": True, "activeEnvironmentEquivalent": True,
                      "differingEnvironmentKeys": differing_environment_keys},
        "probes": {"file": str(PROBES), "sha256": sha256_bytes(secure_read(PROBES, mode=0o600)),
                   "labels": sorted(item["label"] for item in probes["probes"]), "authMeVerifiedUserIds": [1, 2]},
        "fixture": {"checkpoint": str(CHECKPOINT), "sha256": sha256_bytes(secure_read(CHECKPOINT, mode=0o600)),
                    "tenantId": 1, "pilotUserIds": [1, 2]},
        "nginx": {"site": str(NGINX_SITE), "siteSha256": sha256_bytes(nginx),
                  "fullDumpSha256": sha256_bytes(nginx_dump), "marker": NGINX_MARKER,
                  "markerPresent": True, "syntax": "pass", "reload": "NOT_RUN"},
        "kamailio": {"configPath": KAMAILIO_CONFIG, "configSha256": sha256_bytes(wake),
                     "wakeOccurrences": wake.count(WAKE_URL.encode())},
        "deferred": ["migrationReceipt", "operatorManifest"],
    }
    atomic_write(PREP_EVIDENCE, canonical_bytes(evidence))
    return {"status": evidence["status"], "activation": "NOT_RUN", "evidence": str(PREP_EVIDENCE),
            "evidenceSha256": sha256_bytes(secure_read(PREP_EVIDENCE, mode=0o600))}


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--prepare", action="store_true", required=True)
    return parser.parse_args(argv)


def main(argv: Sequence[str]) -> int:
    parse_args(argv)
    try:
        print(json.dumps(prepare(), sort_keys=True))
        return 0
    except PrepError as error:
        print(f"prepare=BLOCKED stage={error.stage}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main(os.sys.argv[1:]))
