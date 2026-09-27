#!/usr/bin/env python3
"""Stage enabled invitations on loopback 3015, then route only public tRPC.

The guarded 3014 API stays running with invitations off and is the sole route
fallback. This operator never sends mail, creates an invitation/account, applies
SQL, modifies an existing container, or routes auth, voicemail, SIP, or workers.
"""

from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import secrets
import stat
import subprocess
import sys
from types import ModuleType


ROOT = Path(__file__).resolve().parent
ACTIVATION_PATH = ROOT / "phone11-invitations-activate.py"
ACTIVATION_SHA = "b85d8b61ad72e558d635661e857254338417a388e56cf489fa23c85e55d769ed"
STAGE_PATH = ROOT / "phone11-invitations-api-stage.py"
STAGE_SHA = "89e7addf6b7ebe4a20af0ad93bc7e3f92e5bfb330645f9427b76200b10b17ec7"
CATALOG_HELPER = Path("/var/lib/phone11-invitations-release-20260927/rehearsal-operator/scripts/phone11-invitations-clone-check.py")
CATALOG_HELPER_SHA = "8c91535699b156beeda04ee2510fcaaa8651af35688fa8cc1babbb487d999a61"
CATALOG_AFTER = "82fea678a0764f9ba9addc2fa7898d60cc45d37cc6a6ec9593a5cbc076121387"
STATE = Path("/var/lib/phone11-invitations-enable-20260927")
NAME = "cp11-api-candidate-invitations-enabled"
PROJECT = "phone11-invitations-enable-20260927"
SERVICE = "invitations_enabled"
SCHEMA = "phone11-invitations-enable/v1"
PORT = 3015
BUILD = "invitations-on-b3ed0e7"
ORIGIN = "https://1toall.phone11.ai"
ENABLED_SITE_SHA = "29c7be9fc516e3bb495400f1deb2619ff57b3b913d96b40cfb19e2e63b97f6b0"
RECOVERY = {
    "name": "cp11-password-recovery",
    "id": "59cf0b40d96866b46f68bbbb9c4fcfd984c6bae0496efad3310a5730273746d4",
    "image": "sha256:21b31746db0f22295ad5d944d530b2dec4bc70400619cf9e4381bb1011c0fa54",
    "source": "bbd14cfd66f510d3f486fbc2e65794f51889c1b6",
    "bundle": "4d3630a668b4fa2d0538321509cd0beefcb6956baeef3c9cf7c163aa2c48bb22",
    "port": 3004,
    "build": "recovery-bbd14cf",
}
PG_ID = "6ac4827e744d938ee48bb56e0800f2d3cab06a5af47d8466046f671e5c66279a"
PG_IMAGE = "sha256:4e6e670bb069649261c9c18031f0aded7bb249a5b6664ddec29c013a89310d50"
PG_WRAPPER = ('if [ -n "${POSTGRES_PASSWORD:-}" ]; then '
              'PGPASSWORD="$POSTGRES_PASSWORD"; export PGPASSWORD; fi; '
              'PGOPTIONS="-c default_transaction_read_only=on -c lock_timeout=3000 -c statement_timeout=30000"; '
              'export PGOPTIONS; exec "$@"')
READINESS_SQL = r"""
SELECT jsonb_build_object(
 'invitations',to_regclass('public.phone11_workspace_invitations') IS NOT NULL,
 'events',to_regclass('public.phone11_workspace_invitation_events') IS NOT NULL,
 'column_count',(SELECT count(*) FROM information_schema.columns
   WHERE table_schema='public' AND table_name='phone11_workspace_invitations'
   AND column_name=ANY(ARRAY['id','tenant_id','email','role','issuer_user_id',
     'token_digest','expires_at','status','accepted_user_id','accepted_at','revoked_at',
     'delivery_status','delivery_error','provider_message_id','created_at','updated_at'])),
 'index_count',(SELECT count(*) FROM pg_index ix JOIN pg_class idx ON idx.oid=ix.indexrelid
   JOIN pg_class tbl ON tbl.oid=ix.indrelid JOIN pg_namespace ns ON ns.oid=tbl.relnamespace
   WHERE ns.nspname='public' AND ix.indisunique AND ix.indisvalid AND ix.indisready AND
   ((idx.relname='phone11_users_normalized_email_unique' AND tbl.relname='users'
     AND ix.indnkeyatts=1 AND ix.indnatts=1
     AND pg_get_indexdef(ix.indexrelid,1,true)='lower(TRIM(BOTH FROM email))'
     AND (pg_get_expr(ix.indpred,ix.indrelid)='(email IS NOT NULL)' OR ix.indpred IS NULL))
   OR (idx.relname='phone11_workspace_invitations_one_pending_email'
     AND tbl.relname='phone11_workspace_invitations' AND ix.indnkeyatts=2 AND ix.indnatts=2
     AND pg_get_indexdef(ix.indexrelid,1,true)='tenant_id'
     AND pg_get_indexdef(ix.indexrelid,2,true)='email'
     AND pg_get_expr(ix.indpred,ix.indrelid)='(status = ''pending''::text)')
   OR (idx.relname='phone11_workspace_invitations_token_digest_key'
     AND tbl.relname='phone11_workspace_invitations' AND ix.indnkeyatts=1 AND ix.indnatts=1
     AND pg_get_indexdef(ix.indexrelid,1,true)='token_digest' AND ix.indpred IS NULL)))
)::text;
"""


class Refused(RuntimeError):
    pass


def need(ok: bool, stage: str) -> None:
    if not ok:
        raise Refused(stage)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def verified_module(path: Path, expected: str, name: str) -> ModuleType:
    raw = path.read_bytes()
    need(sha(raw) == expected, "dependency_pin")
    module = ModuleType(name)
    module.__file__ = str(path)
    exec(compile(raw, str(path), "exec"), module.__dict__)
    need(sha(path.read_bytes()) == expected, "dependency_race")
    return module


act = verified_module(ACTIVATION_PATH, ACTIVATION_SHA, "invitations_guarded_route")
stage = verified_module(STAGE_PATH, STAGE_SHA, "invitations_stage_shared")


def recovery_settings() -> tuple[str, str]:
    item = act.inspect(RECOVERY)
    labels = item["Config"].get("Labels") or {}
    need(labels.get("com.phone11.recovery-only") == "true"
         and labels.get("com.phone11.candidate-build") == RECOVERY["build"],
         "recovery_authority")
    env = act.env_map(item)
    key = env.get("PHONE11_PASSWORD_RESET_RESEND_API_KEY", "")
    sender = env.get("PHONE11_PASSWORD_RESET_FROM", "")
    need(env.get("PORT") == "3004"
         and env.get("PHONE11_RUNTIME_ROLE") == "api-candidate"
         and env.get("PHONE11_PASSWORD_RESET_PROVIDER") == "resend"
         and 3 <= len(key) <= 256 and key.startswith("re_")
         and re.search(r"\s", key) is None
         and sender == "Phone11 <noreply@phone11.ai>", "recovery_configuration")
    return key, sender


def parent() -> dict[str, object]:
    act.check_apis(require_old=False)
    item = act.inspect(act.GUARDED)
    env = act.env_map(item)
    origins = [value.strip() for value in env.get("PHONE11_AUTH_TRUSTED_ORIGINS", "").split(",")]
    need(ORIGIN in origins, "trusted_origin")
    return item


def schema_ready() -> None:
    rows = json.loads(act.command(["/usr/bin/docker", "inspect", PG_ID]))
    need(isinstance(rows, list) and len(rows) == 1 and rows[0].get("Id") == PG_ID
         and rows[0].get("Image") == PG_IMAGE
         and rows[0].get("State", {}).get("Running") is True, "database_pin")
    raw = act.command(["/usr/bin/docker", "exec", PG_ID, "sh", "-c", PG_WRAPPER, "--",
                       "psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1",
                       "-h", "/var/run/postgresql", "-U", "phone11ai", "-d", "phone11ai",
                       "-c", "BEGIN TRANSACTION READ ONLY",
                       "-c", "SET LOCAL statement_timeout = '30s'",
                       "-c", "SET LOCAL lock_timeout = '3s'",
                       "-c", READINESS_SQL, "-c", "ROLLBACK"], timeout=40)
    need(json.loads(raw) == {"invitations": True, "events": True,
                             "column_count": 16, "index_count": 3}, "schema_readiness")
    helper = verified_module(CATALOG_HELPER, CATALOG_HELPER_SHA, "invitations_catalog_proof")
    catalog_sql = helper.CATALOG_SQL % {"base": "false"}
    catalog_raw = act.command(["/usr/bin/docker", "exec", PG_ID, "sh", "-c", PG_WRAPPER, "--",
                               "psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1",
                               "-h", "/var/run/postgresql", "-U", "phone11ai", "-d", "phone11ai",
                               "-c", "BEGIN TRANSACTION READ ONLY",
                               "-c", "SET LOCAL statement_timeout = '30s'",
                               "-c", "SET LOCAL lock_timeout = '3s'",
                               "-c", catalog_sql, "-c", "ROLLBACK"], timeout=40)
    catalog = json.loads(catalog_raw)
    need(isinstance(catalog, dict) and helper.catalog_hash(catalog) == CATALOG_AFTER,
         "schema_catalog_drift")


def make_compose(guarded: dict[str, object], key: str, sender: str) -> tuple[bytes, bytes, dict[str, str]]:
    base = stage.stage
    base.NAME, base.PORT, base.PROJECT, base.SERVICE = NAME, PORT, PROJECT, SERVICE
    base.STATE, base.SCHEMA = STATE, SCHEMA
    data, _env_file, expected = stage._original_compose(
        guarded, str(act.GUARDED["image"]), sha((NAME + str(act.GUARDED["id"])).encode()), BUILD)
    expected.update({"PHONE11_INVITATIONS_ENABLED": "true",
                     "PHONE11_INVITATIONS_PROVIDER": "resend",
                     "PHONE11_INVITATIONS_RESEND_API_KEY": key,
                     "PHONE11_INVITATIONS_FROM": sender,
                     "PHONE11_INVITATIONS_ORIGIN": ORIGIN})
    model = json.loads(data)
    service = model["services"][SERVICE]
    service["labels"] = {"com.phone11.invitations-enable.owner": SCHEMA,
                         "com.phone11.invitations-enable.parent-id": act.GUARDED["id"]}
    env_bytes = "".join(name + "=" + value + "\n" for name, value in sorted(expected.items())).encode()
    need(len(env_bytes) <= 64 * 1024 and b"\x00" not in env_bytes, "environment_size")
    return base.canonical(model), env_bytes, expected


def enabled(expected_env: dict[str, str]) -> dict[str, object]:
    stage.stage.PORT = PORT  # Fresh activate processes have not built Compose.
    rows = json.loads(act.command(["/usr/bin/docker", "inspect", NAME]))
    need(isinstance(rows, list) and len(rows) == 1 and isinstance(rows[0], dict), "enabled_inspect")
    item = rows[0]
    labels = item.get("Config", {}).get("Labels") or {}
    need(item.get("Name") == "/" + NAME and item.get("Image") == act.GUARDED["image"]
         and item.get("State", {}).get("Running") is True
         and item.get("State", {}).get("Health", {}).get("Status") == "healthy"
         and labels.get("com.phone11.invitations-enable.owner") == SCHEMA
         and labels.get("com.phone11.invitations-enable.parent-id") == act.GUARDED["id"]
         and labels.get("com.phone11.source-sha") == act.GUARDED["source"]
         and labels.get("com.phone11.bundle-sha256") == act.GUARDED["bundle"]
         and labels.get("com.phone11.lock-sha256") == act.LOCK_SHA256,
         "enabled_identity")
    need(item.get("HostConfig", {}).get("PortBindings") ==
         {"3015/tcp": [{"HostIp": "127.0.0.1", "HostPort": "3015"}]}, "enabled_loopback")
    need(act.env_map(item) == expected_env, "enabled_environment")
    guarded = act.inspect(act.GUARDED)
    for field in ("User", "WorkingDir", "Entrypoint", "Cmd"):
        need(item["Config"].get(field) == guarded["Config"].get(field), "enabled_process")
    for field in ("NetworkMode", "Memory", "ReadonlyRootfs", "PidsLimit", "SecurityOpt",
                  "CapDrop", "CapAdd", "Privileged", "RestartPolicy"):
        need(item["HostConfig"].get(field) == guarded["HostConfig"].get(field), "enabled_host")
    need(set(item["NetworkSettings"]["Networks"]) ==
         set(guarded["NetworkSettings"]["Networks"]), "enabled_network")
    mounts = lambda value: {(m["Type"], m["Source"], m["Destination"], m["RW"])
                            for m in value["Mounts"]}
    need(mounts(item) == mounts(guarded), "enabled_mounts")
    need(item["Config"].get("Healthcheck", {}).get("Test") ==
         stage.invitations_healthcheck(guarded, BUILD)["test"], "enabled_healthcheck")
    actual = act.command(["/usr/bin/docker", "exec", item["Id"], "sha256sum", "/app/dist/index.mjs"]).split()
    need(len(actual) == 2 and actual[0] == str(act.GUARDED["bundle"]).encode()
         and actual[1] == b"/app/dist/index.mjs", "enabled_bundle")
    conn = http.client.HTTPConnection("127.0.0.1", PORT, timeout=5)
    try:
        conn.request("GET", "/api/health")
        reply = conn.getresponse()
        body = reply.read(16_385)
        need(reply.status == 200 and len(body) <= 16_384, "enabled_health")
        health = json.loads(body)
        need(health.get("ok") is True and health.get("runtimeRole") == "api-candidate"
             and health.get("build") == BUILD, "enabled_health")
    finally:
        conn.close()
    return item


def site_bytes() -> tuple[bytes, os.stat_result]:
    act.secure_directory(act.SITE.parent)
    return act.read_file(act.SITE)


def route(source: int, target: int, expected_sha: str, result_sha: str) -> None:
    current, info = site_bytes()
    digest = sha(current)
    need(digest in (expected_sha, result_sha), "site_drift")
    changed = current if digest == result_sha else act.rewrite_trpc(current, source, target)
    if digest == expected_sha:
        need(sha(changed) == result_sha
             and act.rewrite_trpc(changed, target, source) == current, "route_bytes")
        act.replace_site(changed, info)
    try:
        act.command(["/usr/sbin/nginx", "-t"])
    except Exception:
        # Nginx was not reloaded. Restore disk bytes only, leaving the loaded
        # route unchanged; an uncertain reload is never auto-reversed.
        if digest == expected_sha and site_bytes()[0] == changed:
            act.replace_site(current, info)
        raise
    act.command(["/usr/bin/systemctl", "reload", "nginx"])
    need(site_bytes()[0] == changed, "site_drift")


def stage_enabled() -> None:
    with act.locked():
        need(sha(site_bytes()[0]) == act.TARGET_SITE_SHA256, "site_drift")
        guarded = parent()
        schema_ready()
        key, sender = recovery_settings()
        data, env_bytes, expected = make_compose(guarded, key, sender)
        act.secure_directory(STATE.parent)
        existing = stage.stage.inspect(NAME)
        if existing is None:
            need(not act.command(["/usr/bin/ss", "-H", "-ltn", f"sport = :{PORT}"]).strip(),
                 "enabled_port_occupied")
        else:
            labels = existing.get("Config", {}).get("Labels") or {}
            need(existing.get("Name") == "/" + NAME
                 and existing.get("Image") == act.GUARDED["image"]
                 and labels.get("com.phone11.invitations-enable.owner") == SCHEMA
                 and labels.get("com.phone11.invitations-enable.parent-id") == act.GUARDED["id"]
                 and labels.get("com.docker.compose.project") == PROJECT
                 and labels.get("com.docker.compose.service") == SERVICE
                 and existing.get("HostConfig", {}).get("PortBindings") ==
                 {"3015/tcp": [{"HostIp": "127.0.0.1", "HostPort": "3015"}]}
                 and act.env_map(existing) == expected, "enabled_ownership")
        if not STATE.exists() and not STATE.is_symlink():
            need(existing is None, "enabled_state_missing")
            STATE.mkdir(mode=0o700)
        act.secure_directory(STATE, private=True)
        for path, content in ((STATE / "runtime.env", env_bytes),
                              (STATE / "compose.json", data)):
            if path.exists() or path.is_symlink():
                need(act.read_file(path, mode=0o600)[0] == content, "stage_state_drift")
            else:
                need(existing is None, "stage_state_missing")
                act.write_once(path, content)
        need(not (STATE / "receipt.json").exists(), "already_staged")
        act.command(["/usr/bin/docker", "compose", "-p", PROJECT, "-f", str(STATE / "compose.json"),
                     "config", "--quiet"])
        act.command(["/usr/bin/docker", "compose", "-p", PROJECT, "-f", str(STATE / "compose.json"),
                     "up", "-d", "--wait", "--wait-timeout", "60", "--no-deps", "--no-build",
                     "--no-recreate", SERVICE], timeout=90)
        item = enabled(expected)
        act.write_once(STATE / "receipt.json", (json.dumps({
            "schema": SCHEMA, "state": "staged", "parent_id": act.GUARDED["id"],
            "enabled_id": item["Id"], "enabled_image": item["Image"],
            "compose_sha256": sha(data), "site_before_sha256": act.TARGET_SITE_SHA256,
            "site_enabled_sha256": ENABLED_SITE_SHA,
        }, sort_keys=True, separators=(",", ":")) + "\n").encode())
        print(json.dumps({"state": "staged", "enabled_id": item["Id"]}, sort_keys=True))


def staged_receipt() -> tuple[dict[str, object], dict[str, str]]:
    act.secure_directory(STATE, private=True)
    record = json.loads(act.read_file(STATE / "receipt.json", mode=0o600)[0])
    data = act.read_file(STATE / "compose.json", mode=0o600)[0]
    env_bytes = act.read_file(STATE / "runtime.env", mode=0o600)[0]
    need(record == {"schema": SCHEMA, "state": "staged",
                    "parent_id": act.GUARDED["id"], "enabled_id": record.get("enabled_id"),
                    "enabled_image": act.GUARDED["image"], "compose_sha256": sha(data),
                    "site_before_sha256": act.TARGET_SITE_SHA256,
                    "site_enabled_sha256": ENABLED_SITE_SHA}
         and bool(re.fullmatch(r"[0-9a-f]{64}", str(record["enabled_id"]))), "stage_receipt")
    expected: dict[str, str] = {}
    for row in env_bytes.decode().splitlines():
        need("=" in row, "stage_environment")
        name, value = row.split("=", 1)
        need(name not in expected, "stage_environment")
        expected[name] = value
    key, sender = recovery_settings()
    need(expected.get("PHONE11_INVITATIONS_RESEND_API_KEY") == key
         and expected.get("PHONE11_INVITATIONS_FROM") == sender, "recovery_secret_drift")
    return record, expected


def activate() -> None:
    with act.locked():
        need(sha(site_bytes()[0]) in (act.TARGET_SITE_SHA256, ENABLED_SITE_SHA), "site_drift")
        parent()
        schema_ready()
        record, expected = staged_receipt()
        item = enabled(expected)
        need(item["Id"] == record["enabled_id"], "enabled_id_drift")
        route(3014, PORT, act.TARGET_SITE_SHA256, ENABLED_SITE_SHA)
        print(json.dumps({"state": "active", "enabled_id": item["Id"]}, sort_keys=True))


def disable() -> None:
    with act.locked():
        parent()  # The destination must be the healthy, invitation-off guard.
        route(PORT, 3014, ENABLED_SITE_SHA, act.TARGET_SITE_SHA256)
        print(json.dumps({"state": "disabled", "site_sha256": act.TARGET_SITE_SHA256}, sort_keys=True))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=("stage", "activate", "disable"))
    phase = parser.parse_args().phase
    try:
        need(os.geteuid() == 0, "root")
        if phase == "stage":
            stage_enabled()
        elif phase == "activate":
            activate()
        else:
            disable()
        return 0
    except (Refused, act.Refused, OSError, ValueError, KeyError, TypeError,
            subprocess.TimeoutExpired) as error:
        reason = str(error) if isinstance(error, (Refused, act.Refused)) else type(error).__name__
        print(json.dumps({"state": "blocked", "stage": reason}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
