#!/usr/bin/env python3
"""Read-only active handoff check for a validated voicemail clone receipt.

This is a deployment gate, not a migration or feature-enable command. Run on
the pinned VoIP host after reviewing the clone receipt and before any rollout.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import stat
import subprocess
import sys
import time
from pathlib import Path


SOURCE = Path(__file__).with_name("phone11-voicemail-clone-validate.py")
SPEC = importlib.util.spec_from_file_location("phone11_voicemail_clone_validate", SOURCE)
assert SPEC is not None and SPEC.loader is not None
clone = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(clone)

PROOF_SOURCE = Path(__file__).with_name("phone11-voicemail-callback-proof.py")
PROOF_SPEC = importlib.util.spec_from_file_location("phone11_voicemail_callback_proof", PROOF_SOURCE)
assert PROOF_SPEC is not None and PROOF_SPEC.loader is not None
proof = importlib.util.module_from_spec(PROOF_SPEC)
PROOF_SPEC.loader.exec_module(proof)

DOCKER = "/usr/bin/docker"
MAX_RECEIPT_AGE = 24 * 60 * 60
FS_STATIC_HOOK_CHECK = (
    "test -d /etc/freeswitch/dialplan || exit 1; "
    "test ! -e /etc/freeswitch/scripts/phone11_voicemail_deposit.lua || exit 1; "
    "grep -R -q -E 'phone11_voicemail_deposit|/opt/phone11ai/voicemail' "
    "/etc/freeswitch/dialplan; code=$?; test \"$code\" -eq 1"
)
FS_EFFECTIVE_HOOK_CHECK = r'''
pw=$(sed -n 's/.*name="password" value="\([^"]*\)".*/\1/p' /etc/freeswitch/autoload_configs/event_socket.conf.xml | head -1)
test -n "$pw" || exit 30
/usr/bin/fs_cli -H 127.0.0.1 -P 8021 -p "$pw" -x status >/dev/null 2>&1 || exit 31
xml=$(/usr/bin/fs_cli -H 127.0.0.1 -P 8021 -p "$pw" -x 'xml_locate dialplan' 2>/dev/null) || exit 32
test ${#xml} -gt 100 || exit 33
printf '%s' "$xml" | grep -q '<section name="dialplan"' || exit 34
if printf '%s' "$xml" | grep -E -q 'phone11_voicemail_deposit|/opt/phone11ai/voicemail'; then exit 35; fi
lua=$(/usr/bin/fs_cli -H 127.0.0.1 -P 8021 -p "$pw" -x 'module_exists mod_lua' 2>/dev/null) || exit 36
voicemail=$(/usr/bin/fs_cli -H 127.0.0.1 -P 8021 -p "$pw" -x 'module_exists mod_voicemail' 2>/dev/null) || exit 37
test "$lua" = true && test "$voicemail" = true || exit 38
printf 'loaded_xml_no_hook modules_loaded\n'
'''

NODE_CATALOG = r"""
const pg=require('pg');
const first=(...keys)=>keys.map(k=>process.env[k]).find(Boolean);
const d={host:first('PG_HOST','DB_HOST','POSTGRES_HOST'),port:first('PG_PORT','DB_PORT','POSTGRES_PORT'),user:first('PG_USER','DB_USER','POSTGRES_USER'),password:first('PG_PASSWORD','DB_PASSWORD','POSTGRES_PASSWORD'),database:first('PG_DATABASE','DB_NAME','DB_DATABASE','POSTGRES_DB')};
const complete=!!(d.host&&d.user&&d.password&&d.database);
const connectionString=process.env.PG_CONNECTION_STRING||(complete?undefined:process.env.DATABASE_URL);
const mode=(first('PG_SSL','DB_SSL','POSTGRES_SSL','DATABASE_SSL')||'').toLowerCase();
const ssl=(['false','0','disable'].includes(mode)||connectionString?.includes('sslmode=disable'))?false:{rejectUnauthorized:first('PG_SSL_REJECT_UNAUTHORIZED','DB_SSL_REJECT_UNAUTHORIZED')==='true'};
const cfg=connectionString?{connectionString,ssl}:{...d,port:Number(d.port||5432),ssl};
(async()=>{const client=new pg.Client(cfg);try{await client.connect();await client.query('BEGIN READ ONLY');
const q=await client.query("SELECT to_regclass('public.voicemail_deposit_admissions') IS NOT NULL AS admissions, to_regclass('public.voicemail_messages') IS NOT NULL AS messages, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='extensions' AND column_name='voicemail_owner_epoch') AS owner_epoch, EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='phone11_voicemail_owner_epoch_rotate' AND NOT tgisinternal) AS owner_trigger, EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='phone11_voicemail_extension_tenant_guard' AND NOT tgisinternal) AS guard_trigger, to_regprocedure('public.phone11_voicemail_owner_epoch_rotate()') IS NOT NULL AS owner_function, to_regprocedure('public.phone11_voicemail_extension_tenant_guard()') IS NOT NULL AS guard_function, to_regclass('public.phone11_voicemail_admissions_tenant') IS NOT NULL AS admissions_index, to_regclass('public.phone11_voicemail_inbox') IS NOT NULL AS inbox_index");
await client.query('ROLLBACK');console.log(JSON.stringify(q.rows[0]));}
catch(e){console.log(JSON.stringify({error:e.code||e.name}));process.exitCode=1;}
finally{await client.end().catch(()=>{});}})();
"""


def private_receipt(path: Path) -> dict[str, object]:
    before = path.lstat()
    clone.require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and
                  before.st_uid == os.getuid() and stat.S_IMODE(before.st_mode) == 0o600 and
                  before.st_size < 16384, "receipt_privacy")
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        data = os.read(fd, 16385)
        after = os.fstat(fd)
        clone.require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) ==
                      (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns), "receipt_changed")
    finally:
        os.close(fd)
    receipt = json.loads(data)
    clone.require(isinstance(receipt, dict), "receipt_format")
    pins = {
        "schema": clone.RECEIPT_SCHEMA,
        "source_base_sha": clone.SOURCE_BASE_SHA,
        "migration_sha256": clone.MIGRATION_SHA256,
        "backend_id": clone.ACTIVE_BACKEND_ID,
        "backend_image": clone.ACTIVE_BACKEND_IMAGE,
        "freeswitch_id": clone.ACTIVE_FREESWITCH_ID,
        "freeswitch_image": clone.ACTIVE_FREESWITCH_IMAGE,
        "hook_ready": False,
    }
    clone.require(all(receipt.get(k) == v for k, v in pins.items()), "receipt_pins")
    clone.require(receipt.get("restored_to") in
                  ("isolated_local_postgresql_cluster", "isolated_no_network_postgresql_16_container"),
                  "receipt_restore_mode")
    clone.require(isinstance(receipt.get("backup_sha256"), str) and len(receipt["backup_sha256"]) == 64 and
                  all(c in "0123456789abcdef" for c in receipt["backup_sha256"]), "receipt_backup")
    expected_keys = {"extensions", "admissions", "messages", "owner_epoch", "owner_trigger",
                     "guard_trigger", "owner_function", "guard_function", "admissions_index", "inbox_index"}
    before_catalog = receipt.get("pre_catalog")
    after_catalog = receipt.get("post_catalog")
    clone.require(isinstance(before_catalog, dict) and isinstance(after_catalog, dict) and
                  set(before_catalog) == expected_keys and set(after_catalog) == expected_keys and
                  before_catalog["extensions"] is True and
                  all(v is False for k, v in before_catalog.items() if k != "extensions") and
                  all(v is True for v in after_catalog.values()) and
                  type(receipt.get("extension_rows_before")) is int and
                  receipt["extension_rows_before"] == receipt.get("extension_rows_after"), "receipt_clone")
    now = int(time.time())
    stamp = receipt.get("validated_at_unix")
    clone.require(type(stamp) is int and now - MAX_RECEIPT_AGE <= stamp <= now + 60, "receipt_freshness")
    return receipt


def docker_json(name: str) -> dict[str, object]:
    raw = clone.run([DOCKER, "inspect", name], timeout=20)
    document = json.loads(raw)
    clone.require(isinstance(document, list) and len(document) == 1, "container_document")
    return document[0]


def check_handoff(receipt_path: Path, callback_path: Path | None = None,
                  callback_sha256: str | None = None,
                  callback_source_sha: str | None = None,
                  review_path: Path | None = None,
                  review_sha256: str | None = None) -> dict[str, object]:
    private_receipt(receipt_path)
    backend = docker_json("cp11-backend")
    freeswitch = docker_json("p11-freeswitch")
    for item, expected_id, expected_image in (
        (backend, clone.ACTIVE_BACKEND_ID, clone.ACTIVE_BACKEND_IMAGE),
        (freeswitch, clone.ACTIVE_FREESWITCH_ID, clone.ACTIVE_FREESWITCH_IMAGE),
    ):
        clone.require(item.get("Id") == expected_id and item.get("Image") == expected_image and
                      item.get("State", {}).get("Running") is True and
                      item.get("State", {}).get("Health", {}).get("Status") == "healthy", "active_container_pin")
    env = backend.get("Config", {}).get("Env", [])
    clone.require(not any(v == "PHONE11_VOICEMAIL_HOOK_READY=true" for v in env), "hook_enabled")
    mounts = freeswitch.get("Mounts", [])
    clone.require(any(m.get("Name") == "phone11ai-voip_fs_voicemail" and
                      m.get("Destination") == "/var/lib/freeswitch/voicemail" and m.get("RW") is True
                      for m in mounts), "voicemail_volume_pin")
    raw = clone.run([DOCKER, "exec", "cp11-backend", "node", "-e", NODE_CATALOG], timeout=20)
    catalog = json.loads(raw)
    clone.require(catalog == {key: False for key in (
        "admissions", "messages", "owner_epoch", "owner_trigger", "guard_trigger",
        "owner_function", "guard_function", "admissions_index", "inbox_index")},
        "active_catalog_changed")
    clone.run([DOCKER, "exec", "p11-freeswitch", "sh", "-c", FS_STATIC_HOOK_CHECK], timeout=20)
    effective = clone.run([DOCKER, "exec", "p11-freeswitch", "sh", "-c", FS_EFFECTIVE_HOOK_CHECK],
                          timeout=20)
    clone.require(effective == "loaded_xml_no_hook modules_loaded", "fs_effective_dialplan_evidence")
    # Loaded XML proves this exact hook is absent; it cannot establish the
    # callback lifecycle. Require separate raw, private, same-image evidence.
    clone.require(callback_path is not None and callback_sha256 is not None and
                  callback_source_sha is not None, "fs_voicemail_callback_unverified")
    result = proof.validate_callback_proof(callback_path, callback_sha256,
                                           callback_source_sha, freeswitch["Image"])
    # Structural checks alone cannot establish that the transcript came from
    # FreeSWITCH. An operator records an independent human review with an
    # independently supplied digest; this is not a cryptographic reviewer ID.
    clone.require(review_path is not None and review_sha256 is not None,
                  "callback_independent_review_pending")
    proof.private_directory(review_path.parent)
    review_raw = proof.private_bytes(review_path, 8192)
    clone.require(proof.SHA256.fullmatch(review_sha256) is not None and
                  hashlib.sha256(review_raw).hexdigest() == review_sha256,
                  "callback_review_pin")
    review = proof.exact_keys(json.loads(review_raw), {
        "schema", "callback_proof_sha256", "clone_console_sha256",
        "loaded_dialplan_sha256", "harness_transcript_sha256",
        "clone_harness_sha256", "source_sha", "freeswitch_image",
        "reviewed_at_unix", "reviewer", "finding"}, "callback_review_format")
    callback = json.loads(proof.private_bytes(callback_path, 65536))
    for key in ("clone_console_sha256", "loaded_dialplan_sha256",
                "harness_transcript_sha256", "clone_harness_sha256"):
        clone.require(review[key] == callback[key], "callback_review_artifact_pin")
    clock = int(time.time())
    clone.require(review["schema"] == "phone11.fs-callback-independent-review/v1" and
                  review["callback_proof_sha256"] == callback_sha256 and
                  review["source_sha"] == callback_source_sha and
                  review["freeswitch_image"] == freeswitch["Image"] and
                  review["finding"] == "approved" and
                  type(review["reviewer"]) is str and
                  bool(re.fullmatch(r"[A-Za-z0-9 ._-]{3,80}", review["reviewer"])) and
                  type(review["reviewed_at_unix"]) is int and
                  callback["validated_at_unix"] <= review["reviewed_at_unix"] <= clock + 60 and
                  clock - MAX_RECEIPT_AGE <= review["reviewed_at_unix"],
                  "callback_independent_review_pending")
    return {"result": "hook_off_handoff_ready", "callback": result["result"],
            "review": "operator_recorded_independent_review",
            "freeswitch_image": freeswitch["Image"], "source_sha": result["source_sha"]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--clone-receipt", required=True, type=Path)
    parser.add_argument("--callback-proof", required=True, type=Path)
    parser.add_argument("--callback-proof-sha256", required=True)
    parser.add_argument("--callback-source-sha", required=True)
    parser.add_argument("--callback-review", type=Path)
    parser.add_argument("--callback-review-sha256")
    args = parser.parse_args()
    try:
        print(json.dumps(check_handoff(args.clone_receipt, args.callback_proof,
                                       args.callback_proof_sha256,
                                       args.callback_source_sha,
                                       args.callback_review,
                                       args.callback_review_sha256), sort_keys=True))
        return 0
    except (clone.ValidationError, proof.ProofError, OSError, ValueError, json.JSONDecodeError,
            subprocess.TimeoutExpired) as error:
        stage = str(error) if isinstance(error, clone.ValidationError) else type(error).__name__
        print(json.dumps({"result": "blocked", "stage": stage}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
