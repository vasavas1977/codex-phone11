#!/usr/bin/env python3
"""Build a sealed candidate-only Phone11 probe bundle for dedicated test users.

No network or credential access occurs in --dry-run. --apply is deliberately
root-only and must be independently reviewed before use on a live host.
"""
from __future__ import annotations

import argparse
import getpass
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
from urllib.parse import parse_qs, quote, urlsplit

ORIGIN = "http://127.0.0.1:3019"
HOST, PORT = "127.0.0.1", 3019
ROOT = Path("/var/lib/phone11-mainline-fixtures")
EXTENSIONS = {"3001", "1020"}
NAME = re.compile(r"candidate-[a-z0-9][a-z0-9-]{0,62}\.json\Z")
SCHEMA = "phone11-parallel-api-probes/v1"
CONTAINER_ID = re.compile(r"[0-9a-f]{64}\Z")


def release_start():
    path = Path(__file__).resolve().with_name("phone11-mainline-release-start.py")
    spec = importlib.util.spec_from_file_location("phone11_fixture_release_start", path)
    require(spec is not None and spec.loader is not None, "release_start")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class Refused(Exception):
    pass


def require(value: bool, stage: str) -> None:
    if not value:
        raise Refused(stage)


def trpc_input(value: object) -> str:
    return quote(json.dumps({"json": value}, separators=(",", ":")), safe="")


def local_database_url(value: str) -> None:
    try:
        parsed = urlsplit(value)
        query = parse_qs(parsed.query, keep_blank_values=True, strict_parsing=True)
        safe = (parsed.scheme in {"postgres", "postgresql"}
                and parsed.path == "/phone11ai" and not parsed.fragment
                and all(len(items) == 1 for items in query.values()))
        safe = safe and parsed.hostname == "127.0.0.1" and parsed.port == 5432
        safe = safe and set(query) <= {"sslmode"}
    except ValueError:
        safe = False
    require(safe, "database_origin")


def document(token: str, tenant_id: int, denied_tenant_id: int) -> bytes:
    require(bool(token) and "\r" not in token and "\n" not in token, "auth_token")
    require(type(tenant_id) is int and type(denied_tenant_id) is int
            and 0 < tenant_id <= 2_147_483_647 and 0 < denied_tenant_id <= 2_147_483_647
            and tenant_id != denied_tenant_id, "tenants")
    tenant = trpc_input({"tenantId": tenant_id})
    denied = trpc_input({"tenantId": denied_tenant_id})
    batch = quote(json.dumps({"0": {"json": {"tenantId": tenant_id}},
                              "1": {"json": {"tenantId": tenant_id}}}, separators=(",", ":")), safe="")
    paths = (
        ("existing_phone", f"/api/trpc/phone.getConfig?input={tenant}", 200),
        ("existing_chat", f"/api/trpc/chat.list?input={tenant}", 200),
        ("conference", "/api/trpc/conference.capabilities", 200),
        ("mixed_batch", f"/api/trpc/phone.getConfig,chat.list?batch=1&input={batch}", 200),
        ("denied_tenant", f"/api/trpc/chat.list?input={denied}", 403),
    )
    probes = [{"label": label, "method": "GET", "path": path,
               "headers": {"Authorization": f"Bearer {token}"}, "body": "", "status": status,
               "required": ["FORBIDDEN"] if status == 403 else ["result"],
               "forbidden": ["DATABASE_URL", "c11_live_", "sip_password"]}
              for label, path, status in paths]
    return (json.dumps({"schema": SCHEMA, "probes": probes}, sort_keys=True,
                       separators=(",", ":")) + "\n").encode()


def request(method: str, path: str, body: bytes | None = None,
            token: str | None = None) -> tuple[int, dict[str, str], bytes]:
    require(path.startswith("/") and not path.startswith("//"), "http_path")
    headers = {"Accept": "application/json", "X-Phone11-Client": "native"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    connection = http.client.HTTPConnection(HOST, PORT, timeout=5)
    try:
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse()
        raw = response.read(65537)
        require(len(raw) <= 65536, "http_body")
        return response.status, {key.lower(): value for key, value in response.getheaders()}, raw
    finally:
        connection.close()


def sign_in(email: str, password: str) -> tuple[str, str]:
    body = json.dumps({"email": email, "password": password, "rememberMe": False},
                      separators=(",", ":")).encode()
    status, headers, raw = request("POST", "/api/auth/sign-in/email", body)
    require(status == 200, "sign_in")
    token = headers.get("set-auth-token", "")
    require(bool(token) and len(token) <= 4096 and "\r" not in token and "\n" not in token, "sign_in")
    response = json.loads(raw)
    auth_id = response.get("user", {}).get("id") if isinstance(response, dict) else None
    require(isinstance(auth_id, str) and bool(auth_id), "sign_in_identity")
    return token, auth_id


def verify_session(token: str, auth_id: str, email: str) -> None:
    status, _, raw = request("GET", "/api/auth/get-session?disableRefresh=true", token=token)
    require(status == 200, "session")
    session = json.loads(raw)
    require(isinstance(session, dict) and isinstance(session.get("session"), dict)
            and isinstance(session.get("user"), dict)
            and session["user"].get("id") == auth_id
            and session["user"].get("email") == email, "session_identity")


# This child receives the prompted DB URL over stdin, not argv or environment.
# Its sole output is a small, allowlisted identity verdict. It never reads sessions.
IDENTITY_QUERY = r"""
const pg=require('pg');
void (async()=>{
let data=''; process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) data+=chunk;
const x=JSON.parse(data); const client=new pg.Client({connectionString:x.url,connectionTimeoutMillis:5000});
try {
 await client.connect(); await client.query('BEGIN TRANSACTION READ ONLY');
 await client.query("SET LOCAL statement_timeout = '5000ms'");
 const db=await client.query('SELECT current_database() AS name');
 const q=await client.query(`SELECT au.id AS auth_id,au.email AS auth_email,u.id AS user_id,
   u.email AS canonical_email,u.role AS user_role,tm.role AS tenant_role,
   t.id AS tenant_id,e.extension_number
   FROM phone11_auth_user au
   JOIN phone11_auth_identity ai ON ai.auth_user_id=au.id AND ai.disabled_at IS NULL
   JOIN phone11_auth_account a ON a."userId"=au.id AND a."providerId"='credential'
   JOIN users u ON u.id=ai.legacy_user_id
   JOIN tenant_memberships tm ON tm.user_id=u.id AND tm.status='active'
   JOIN tenants t ON t.id=tm.tenant_id AND t.status='active'
   JOIN user_extensions ue ON ue.user_id=u.id
   JOIN extensions e ON e.id=ue.extension_id AND e.tenant_id=t.id
     AND e.status='active' AND e.deleted_at IS NULL
   WHERE u.id=$1 AND lower(trim(au.email))=$2
     AND lower(trim(u.email))=$2 AND t.id=$3 AND e.extension_number=$4`,
   [x.userId,x.email,x.tenantId,x.extension]);
 const denied=await client.query(`SELECT t.id FROM tenants t
   WHERE t.id=$1 AND t.status='active' AND NOT EXISTS
   (SELECT 1 FROM tenant_memberships tm WHERE tm.tenant_id=t.id
    AND tm.user_id=$2 AND tm.status='active')`,[x.deniedTenantId,x.userId]);
 await client.query('ROLLBACK');
 const r=q.rows;
 process.stdout.write(JSON.stringify({ok:r.length===1&&denied.rows.length===1,
   database:db.rows[0]?.name,
   authId:r[0]?.auth_id,email:r[0]?.auth_email,userId:r[0]?.user_id,
   canonicalEmail:r[0]?.canonical_email,userRole:r[0]?.user_role,
   tenantRole:r[0]?.tenant_role,tenantId:r[0]?.tenant_id,
   extension:r[0]?.extension_number}));
} catch { process.exitCode=1; } finally { await client.end().catch(()=>{}); }
})().catch(()=>{process.exitCode=1});
"""


def pinned_runtime(manifest: Path, database_container_id: str) -> tuple[str, str]:
    require(CONTAINER_ID.fullmatch(database_container_id) is not None, "database_container_id")
    pins = release_start().manifest(manifest)
    candidate = pins["candidate"]
    require(candidate["port"] == PORT, "candidate_port")
    image = candidate["image"]
    inspected_image = subprocess.run(["docker", "image", "inspect", "--format", "{{.Id}}", image],
                                     capture_output=True, text=True, timeout=10, check=False)
    require(inspected_image.returncode == 0 and inspected_image.stdout.strip() == image,
            "candidate_image")
    inspected_database = subprocess.run(
        ["docker", "inspect", "--type", "container", "--format",
         "{{.Id}}|{{.Name}}|{{.State.Running}}|{{.HostConfig.NetworkMode}}", "cp11-postgres"],
        capture_output=True, text=True, timeout=10, check=False)
    fields = inspected_database.stdout.strip().split("|")
    require(inspected_database.returncode == 0 and len(fields) == 4
            and fields[:3] == [database_container_id, "/cp11-postgres", "true"]
            and fields[3] not in {"", "host", "none"}
            and not fields[3].startswith("container:"), "database_container")
    return image, database_container_id


def database_command(image: str, database_container_id: str) -> list[str]:
    require(re.fullmatch(r"sha256:[0-9a-f]{64}", image) is not None
            and CONTAINER_ID.fullmatch(database_container_id) is not None, "runtime_pin")
    return ["docker", "run", "--rm", "-i", "--pull=never", "--platform=linux/amd64",
            "--log-driver=none",
            "--network=container:" + database_container_id,
            "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges",
            "--user=65534:65534", "--pids-limit=64", "--memory=128m", "--cpus=0.5",
            "--workdir=/app", "--entrypoint=node", image, "-e", IDENTITY_QUERY]


def verify_identity(database_url: str, image: str, database_container_id: str,
                    user_id: int, email: str,
                    role: str, tenant_role: str, tenant_id: int,
                    denied_tenant_id: int, extension: str) -> str:
    local_database_url(database_url)
    payload = {"url": database_url, "userId": user_id,
               "email": email, "tenantId": tenant_id,
               "deniedTenantId": denied_tenant_id, "extension": extension}
    result = subprocess.run(database_command(image, database_container_id),
                            input=json.dumps(payload), text=True, capture_output=True,
                            timeout=25, check=False)
    require(result.returncode == 0 and len(result.stdout) <= 4096, "identity_query")
    proof = json.loads(result.stdout)
    require(proof.get("ok") is True and proof.get("database") == "phone11ai"
            and isinstance(proof.get("authId"), str)
            and bool(proof["authId"]) and proof.get("email") == email
            and proof.get("canonicalEmail") == email
            and proof.get("userId") == user_id and proof.get("userRole") == role
            and proof.get("tenantRole") == tenant_role and proof.get("tenantId") == tenant_id
            and proof.get("extension") == extension, "identity_mapping")
    return proof["authId"]


def secure_write(root: Path, name: str, raw: bytes,
                 owner: tuple[int, int] = (0, 0)) -> str:
    require(NAME.fullmatch(name) is not None, "output_name")
    root.mkdir(mode=0o700, exist_ok=True)
    parent = root.lstat()
    require(stat.S_ISDIR(parent.st_mode) and parent.st_uid == owner[0] and parent.st_gid == owner[1]
            and stat.S_IMODE(parent.st_mode) == 0o700, "output_root")
    path = root / name
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    completed = False
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == owner[0] and info.st_gid == owner[1]
                and stat.S_IMODE(info.st_mode) == 0o600, "output_file")
        with os.fdopen(fd, "wb", closefd=False) as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(fd)
        dir_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)
        completed = True
    finally:
        os.close(fd)
        if not completed:
            path.unlink(missing_ok=True)
    return hashlib.sha256(raw).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--apply", action="store_true")
    parser.add_argument("--output-name", required=True)
    parser.add_argument("--user-id", type=int, required=True)
    parser.add_argument("--extension", required=True, choices=sorted(EXTENSIONS))
    parser.add_argument("--tenant-id", type=int, required=True)
    parser.add_argument("--denied-tenant-id", type=int, required=True)
    parser.add_argument("--user-role", required=True, choices=("user", "admin"))
    parser.add_argument("--tenant-role", required=True, choices=("user", "admin", "owner"))
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--database-container-id", required=True)
    args = parser.parse_args()
    try:
        require(NAME.fullmatch(args.output_name) is not None and args.user_id > 0, "arguments")
        require(0 < args.tenant_id <= 2_147_483_647 and 0 < args.denied_tenant_id <= 2_147_483_647
                and args.tenant_id != args.denied_tenant_id, "tenants")
        if args.dry_run:
            print("dry_run=READY network=NOT_RUN credentials=NOT_READ output=NOT_WRITTEN")
            return 0
        require(os.geteuid() == 0 and os.getegid() == 0, "root_required")
        require(not os.path.lexists(ROOT / args.output_name), "output_exists")
        image, database_container_id = pinned_runtime(args.manifest, args.database_container_id)
        require(sys.stdin.isatty(), "tty_required")
        email = input("Dedicated Phone11 test account email: ").strip().lower()
        require(bool(re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email)), "email")
        database_url = getpass.getpass("Read-only Phone11 database URL: ")
        require(bool(database_url), "credentials")
        local_database_url(database_url)
        expected_auth_id = verify_identity(database_url, image, database_container_id,
                                           args.user_id, email, args.user_role,
                                           args.tenant_role, args.tenant_id,
                                           args.denied_tenant_id, args.extension)
        password = getpass.getpass("Dedicated Phone11 test account password: ")
        require(bool(password), "credentials")
        token, auth_id = sign_in(email, password)
        require(auth_id == expected_auth_id, "sign_in_identity")
        verify_session(token, auth_id, email)
        raw = document(token, args.tenant_id, args.denied_tenant_id)
        digest = secure_write(ROOT, args.output_name, raw)
        print(f"fixture={ROOT / args.output_name} sha256={digest}")
        return 0
    except Exception as error:
        stage = str(error) if isinstance(error, Refused) else "failed"
        print(f"FAIL: {stage}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
