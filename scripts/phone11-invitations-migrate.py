#!/usr/bin/env python3
"""Apply the clone-rehearsed additive invitation schema; never enable or send."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import time
from types import ModuleType, SimpleNamespace

HELPER_SHA = "8c91535699b156beeda04ee2510fcaaa8651af35688fa8cc1babbb487d999a61"
SQL_SHA = "0247663e589bba73d542c6a815ebee7081cc7326cc05b47001bdbc181ccaf93b"
BEFORE = "1089dc2dc4fc1d1ca328f7b02c1cf4b288b1723d51f9fd24bdffeada331212a4"
AFTER = "82fea678a0764f9ba9addc2fa7898d60cc45d37cc6a6ec9593a5cbc076121387"
ROOT = Path("/var/lib/phone11-invitations-release-20260927")
STATE = ROOT / "live-schema"
HELPER = ROOT / "rehearsal-operator/scripts/phone11-invitations-clone-check.py"
SQL = ROOT / "source/server/invitations/migration.sql"
WRITE_WRAPPER = (
    'if [ -n "${POSTGRES_PASSWORD:-}" ]; then '
    'PGPASSWORD="$POSTGRES_PASSWORD"; export PGPASSWORD; fi; '
    'PGOPTIONS="-c default_transaction_read_only=off -c statement_timeout=30000 -c lock_timeout=5000"; '
    'export PGOPTIONS; exec "$@"'
)

def require(ok, stage):
    if not ok:
        raise RuntimeError(stage)

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

def protected(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and
            info.st_nlink == 1 and not info.st_mode & 0o022, "protected_file")
    return path.read_bytes()

def load_helper():
    raw = protected(HELPER)
    require(digest(raw) == HELPER_SHA, "helper_pin")
    module = ModuleType("invitation_migration_helper")
    module.__file__ = str(HELPER)
    sys.modules[module.__name__] = module
    exec(compile(raw, str(HELPER), "exec"), module.__dict__)
    return module

def arguments():
    return SimpleNamespace(
        api_id="3507bfb214e7e76bcf18172dca4b1573491b6a1ec9bce7acc379c7fd5247a229",
        api_name="cp11-api-candidate-invitations",
        api_image="sha256:0942f8a6dd17f2919e6631adbc55318e2e8693ff9f869f90fa26d8327950b47d",
        api_source_sha="b3ed0e71e1683cd3eca503bee902a221b2c3e3ca",
        api_bundle_sha="f06dcd6044a4a8b50ec35571834d7f82170efdd1d86b7559a2e3315fddd416a2",
        api_bundle_path="/app/dist/index.mjs",
        pg_id="6ac4827e744d938ee48bb56e0800f2d3cab06a5af47d8466046f671e5c66279a",
        pg_name="cp11-postgres",
        pg_image="sha256:4e6e670bb069649261c9c18031f0aded7bb249a5b6664ddec29c013a89310d50",
        role="phone11ai", database="phone11ai", server_version_num="160013",
        sql_sha=SQL_SHA, clone_data_mib=256, timeout=120)

def preflight(h, args):
    h.verify_source(args)
    env = dict(v.split("=", 1) for v in h.inspect(args.api_id)["Config"]["Env"])
    require(env.get("PHONE11_INVITATIONS_ENABLED") == "false", "baseline_not_off")
    h.preflight(h.live_json(args, h.PREFLIGHT_SQL), h.live_json(args, h.COUNT_SQL),
                role=args.role, database=args.database, version=args.server_version_num)
    require(h.catalog_hash(h.live_json(args, h.CATALOG_SQL % {"base": "false"})) == BEFORE,
            "rehearsal_catalog_drift")

def run(phase):
    require(os.geteuid() == 0, "root")
    h = load_helper()
    args = arguments()
    raw = protected(SQL)
    require(digest(raw) == SQL_SHA, "sql_pin")
    preflight(h, args)
    if phase == "prepare":
        require(not STATE.exists(), "state_exists")
        h.private_directory(ROOT)
        STATE.mkdir(mode=0o700)
        h.private_directory(STATE)
        backup_sha = h.backup(args, STATE / "backup.dump")
        preflight(h, args)
        h.write_receipt(STATE / "prepared.json", {
            "sql_sha256": SQL_SHA, "backup_sha256": backup_sha,
            "before_catalog_sha256": BEFORE, "created_at_unix": int(time.time())})
        print(json.dumps({"state": "prepared", "backup_sha256": backup_sha}))
        return
    h.private_directory(STATE)
    receipt = json.loads(protected(STATE / "prepared.json"))
    require(isinstance(receipt.get("created_at_unix"), int)
            and 0 <= time.time() - receipt["created_at_unix"] <= 900, "backup_age")
    require(receipt["sql_sha256"] == SQL_SHA and receipt["before_catalog_sha256"] == BEFORE
            and h.digest_private_archive(STATE / "backup.dump") == receipt["backup_sha256"],
            "backup_pin")
    require(not (STATE / "applied.json").exists(), "already_applied")
    started = time.monotonic()
    h.command([h.DOCKER, "exec", args.pg_id, "sh", "-c", WRITE_WRAPPER, "--",
              "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1",
              "-h", "/var/run/postgresql", "-U", args.role, "-d", args.database,
              "-c", raw.decode()], timeout=60)
    post = h.live_json(args, h.POST_SQL)
    require(post == {"invitations": True, "events": True, "column_count": 16, "index_count": 3},
            "postflight_schema")
    after = h.catalog_hash(h.live_json(args, h.CATALOG_SQL % {"base": "false"}))
    base = h.catalog_hash(h.live_json(args, h.CATALOG_SQL % {"base": "true"}))
    require(after == AFTER and base == BEFORE, "postflight_catalog")
    result = {**receipt, "state": "applied", "after_catalog_sha256": after,
              "base_catalog_sha256": base, "elapsed_seconds": round(time.monotonic()-started, 3),
              "postflight": post, "applied_at_unix": int(time.time())}
    h.write_receipt(STATE / "applied.json", result)
    print(json.dumps(result))

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=("prepare", "apply"))
    selected = parser.parse_args().phase
    try:
        fd = os.open("/run/phone11-invitations-schema.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        info = os.fstat(fd)
        require(info.st_uid == 0 and stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600, "lock")
        fcntl.flock(fd, fcntl.LOCK_EX)
        run(selected)
    except Exception as error:
        print(json.dumps({"state": "blocked", "reason": str(error) if type(error) is RuntimeError else type(error).__name__,
                          "note": "Keep invitations off; inspect schema before any retry. No automatic schema rollback."}), file=sys.stderr)
        sys.exit(2)
