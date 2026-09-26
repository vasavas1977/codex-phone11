#!/usr/bin/env python3
"""Install and automatically expire a short-lived Phone11 admin-settings GET canary."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import stat
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from types import ModuleType
from typing import Any


SITE = Path("/etc/nginx/sites-enabled/phone11ai")
ORIGINAL_SHA256 = "2f744bb0df277cd4cbe7a50c2a6f9122530821d7bfa56f32d1fdb2ac64c59520"
SHARED_OPERATOR = Path("/opt/phone11ai/status-only-release-20260926/phone11-status-only-release-route.py")
SHARED_OPERATOR_SHA256 = "ebb5b6461512836630dab78252303517c63d00521b5ca4f67e408eb41e4dae28"
INSTALLED_OPERATOR = Path("/var/lib/phone11-status-cookie-canary-operator.py")
STATE_ROOT = Path("/var/lib/phone11-status-cookie-canary")
LOCK = Path("/run/phone11-desktop-provisioning-route.lock")
SYSTEMD_UNIT_DIR = Path("/etc/systemd/system")
SENTINEL = Path("/run/phone11-status-cookie-canary.enabled")
LOCATION = b"/api/phone11-status-canary/admin-settings"
UPSTREAM = b"http://127.0.0.1:3012/api/trpc/profile.adminSettings;"
SCHEMA = "phone11-status-cookie-canary/v1"
MAX_BYTES = 2 * 1024 * 1024
EXPIRY_SECONDS = 600


class Refusal(RuntimeError):
    pass


def require(ok: bool, reason: str) -> None:
    if not ok:
        raise Refusal(reason)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _read_pinned_shared_source(path: Path) -> bytes:
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1
            and before.st_uid == 0 and before.st_gid == 0
            and not (stat.S_IMODE(before.st_mode) & 0o022), "shared_operator_shape")
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        opened = os.fstat(fd)
        require((opened.st_dev, opened.st_ino, opened.st_size, opened.st_uid, opened.st_gid)
                == (before.st_dev, before.st_ino, before.st_size, before.st_uid, before.st_gid),
                "shared_operator_identity")
        with os.fdopen(fd, "rb", closefd=False) as stream:
            raw = stream.read(MAX_BYTES + 1)
    finally:
        os.close(fd)
    require(0 < len(raw) <= MAX_BYTES and sha(raw) == SHARED_OPERATOR_SHA256,
            "shared_operator_hash")
    return raw


def shared() -> ModuleType:
    source = _read_pinned_shared_source(SHARED_OPERATOR)
    module = ModuleType("phone11_verified_status_route")
    module.__file__ = str(SHARED_OPERATOR)
    exec(compile(source, str(SHARED_OPERATOR), "exec"), module.__dict__)
    return module


def _extract_location(site: bytes, location: bytes) -> bytes:
    pattern = rb"(?m)^[ \t]*location[ \t]+" + re.escape(location) + rb"[ \t]*\{"
    matches = list(re.finditer(pattern, site))
    require(len(matches) == 1, "trpc_location_shape")
    start = matches[0].end()
    end = site.find(b"}", start)
    require(end > start and b"{" not in site[start:end], "trpc_location_shape")
    return site[start:end]


def render_site(site: bytes) -> bytes:
    """Insert the one exact URI while preserving the pinned production routes."""
    require(sha(site) == ORIGINAL_SHA256, "site_drift")
    for loc in (b"= /api/trpc", b"^~ /api/trpc/"):
        block = _extract_location(site, loc)
        passes = re.findall(rb"(?m)^[ \t]*proxy_pass[ \t]+([^;]+);", block)
        require(passes == [b"http://127.0.0.1:3011"], "trpc_upstream_drift")
        # Any local Nginx auth policy must be reviewed and copied deliberately.
        require(not re.search(rb"(?m)^[ \t]*(?:auth_[A-Za-z0-9_]*|satisfy|allow|deny)\b", block),
                "trpc_auth_policy_unmodeled")
    marker = list(re.finditer(rb"(?m)^[ \t]*server[ \t]*\{[ \t]*$", site))
    require(len(marker) == 1, "server_marker_shape")
    require(LOCATION not in site, "canary_location_exists")
    newline = b"\r\n" if b"\r\n" in site else b"\n"
    line_end = site.find(b"\n", marker[0].end())
    require(line_end >= 0, "server_marker_shape")
    body = newline.join((
        b"    location = " + LOCATION + b" {",
        b"        if (!-f " + str(SENTINEL).encode() + b") { return 404; }",
        b"        if ($host != api.phone11.ai) { return 404; }",
        b"        if ($request_method != GET) { return 405; }",
        b"        proxy_pass_request_body off;",
        b'        proxy_set_header Content-Length "";',
        b"        proxy_pass_request_headers on;",
        b"        proxy_http_version 1.1;",
        b"        proxy_set_header Host $host;",
        b"        proxy_set_header X-Real-IP $remote_addr;",
        b"        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
        b"        proxy_set_header X-Forwarded-Proto $scheme;",
        b"        proxy_cache off;",
        b"        proxy_no_cache 1;",
        b"        proxy_cache_bypass 1;",
        b"        proxy_hide_header Cache-Control;",
        b'        add_header Cache-Control "no-store, private" always;',
        b'        add_header Pragma "no-cache" always;',
        b'        add_header Expires "0" always;',
        b"        access_log off;",
        b"        proxy_pass " + UPSTREAM,
        b"    }",
        b""))
    insertion = line_end + 1
    proposed = site[:insertion] + body + newline + site[insertion:]
    require(proposed != site and proposed.replace(body + newline, b"", 1) == site,
            "site_rewrite_integrity")
    return proposed


def _ensure_state_root(path: Path) -> None:
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and info.st_gid == 0
            and stat.S_IMODE(info.st_mode) == 0o700, "state_directory")


def _ensure_installed_operator(path: Path) -> None:
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1
            and info.st_uid == 0 and info.st_gid == 0
            and stat.S_IMODE(info.st_mode) == 0o700, "installed_operator_shape")
    running = Path(__file__)
    running_info = running.lstat()
    require(running.resolve(strict=True) == path
            and (running_info.st_dev, running_info.st_ino) == (info.st_dev, info.st_ino),
            "timer_operator_not_running_copy")
    parent = path.parent
    while parent != parent.parent:
        parent_info = parent.lstat()
        require(stat.S_ISDIR(parent_info.st_mode) and parent_info.st_uid == 0
                and not (stat.S_IMODE(parent_info.st_mode) & 0o022), "installed_operator_parent")
        parent = parent.parent


def _receipt_bytes(record: dict[str, Any]) -> bytes:
    return (json.dumps(record, sort_keys=True, separators=(",", ":")) + "\n").encode()


def _write_receipt(helper: ModuleType, run: Path, record: dict[str, Any]) -> None:
    helper.atomic_write(run / "receipt.json", _receipt_bytes(record), mode=0o600)


def _load_receipt(helper: ModuleType, run: Path) -> tuple[dict[str, Any], bytes, bytes]:
    require(run.parent == STATE_ROOT
            and re.fullmatch(r"20[0-9]{6}T[0-9]{6}Z-[0-9a-f]{16}", run.name) is not None,
            "receipt_path")
    helper._protected_directory(STATE_ROOT)
    helper._protected_directory(run)
    raw, _ = helper.read_regular(run / "receipt.json", root_only=True)
    record = json.loads(raw)
    require(isinstance(record, dict) and set(record) == {
        "schema", "site", "before_sha256", "active_sha256", "state", "timer_unit",
        "site_mode", "site_uid", "site_gid",
    } and record["schema"] == SCHEMA and record["site"] == str(SITE)
            and record["state"] in {"prepared", "active", "rolled_back"}
            and type(record["site_mode"]) is int and 0 <= record["site_mode"] <= 0o7777
            and not (record["site_mode"] & 0o022)
            and type(record["site_uid"]) is int and record["site_uid"] == 0
            and type(record["site_gid"]) is int and record["site_gid"] == 0
            and re.fullmatch(r"phone11-status-cookie-canary-[0-9a-f]{16}", record["timer_unit"]),
            "receipt_shape")
    before, _ = helper.read_regular(run / "site.before", root_only=True)
    active, _ = helper.read_regular(run / "site.active", root_only=True)
    require(sha(before) == record["before_sha256"] == ORIGINAL_SHA256
            and sha(active) == record["active_sha256"] and active != before,
            "receipt_integrity")
    return record, before, active


def _expiry_unit_contents(unit: str, run: Path, deadline: datetime) -> tuple[bytes, bytes]:
    service = (
        "[Unit]\n"
        "Description=Restore Phone11 status cookie canary site\n"
        "Before=nginx.service\n\n"
        "[Service]\n"
        "Type=oneshot\n"
        "User=root\n"
        "Group=root\n"
        "WorkingDirectory=/\n"
        "UMask=0077\n"
        f"ExecStart=/usr/bin/python3 {INSTALLED_OPERATOR} rollback --receipt-dir {run}\n"
    ).encode()
    calendar = deadline.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    timer = (
        "[Unit]\n"
        "Description=Ten-minute Phone11 status cookie canary expiry\n\n"
        "[Timer]\n"
        f"OnCalendar={calendar}\n"
        "Persistent=true\n"
        "AccuracySec=1s\n"
        f"Unit={unit}.service\n\n"
        "[Install]\n"
        "WantedBy=timers.target\n"
    ).encode()
    return service, timer


def _check_systemd_unit_dir() -> None:
    info = SYSTEMD_UNIT_DIR.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and info.st_gid == 0
            and not (stat.S_IMODE(info.st_mode) & 0o022), "systemd_unit_directory")


def _arm_expiry(helper: ModuleType, unit: str, run: Path) -> None:
    require(re.fullmatch(r"phone11-status-cookie-canary-[0-9a-f]{16}", unit) is not None,
            "timer_unit")
    _check_systemd_unit_dir()
    service_path = SYSTEMD_UNIT_DIR / (unit + ".service")
    timer_path = SYSTEMD_UNIT_DIR / (unit + ".timer")
    for path in (service_path, timer_path):
        try:
            path.lstat()
        except FileNotFoundError:
            continue
        raise Refusal("timer_unit_exists")
    service, timer = _expiry_unit_contents(
        unit, run, datetime.now(timezone.utc) + timedelta(seconds=EXPIRY_SECONDS))
    helper.atomic_write(service_path, service, mode=0o644)
    helper.atomic_write(timer_path, timer, mode=0o644)
    for path, expected in ((service_path, service), (timer_path, timer)):
        actual, info = helper.read_regular(path)
        require(actual == expected and info.st_uid == 0 and info.st_gid == 0
                and stat.S_IMODE(info.st_mode) == 0o644, "timer_unit_write")
    helper.command(["systemctl", "daemon-reload"], timeout=20)
    helper.command(["systemctl", "enable", "--now", unit + ".timer"], timeout=20)
    helper.command(["systemctl", "is-enabled", "--quiet", unit + ".timer"], timeout=10)
    helper.command(["systemctl", "is-active", "--quiet", unit + ".timer"], timeout=10)


def _stop_expiry(helper: ModuleType, record: dict[str, Any]) -> None:
    helper.command(["systemctl", "disable", "--now", record["timer_unit"] + ".timer"], timeout=20)


def _create_sentinel(helper: ModuleType) -> None:
    try:
        SENTINEL.lstat()
    except FileNotFoundError:
        pass
    else:
        raise Refusal("sentinel_exists")
    helper.atomic_write(SENTINEL, b"armed\n", mode=0o600)
    data, info = helper.read_regular(SENTINEL, root_only=True)
    require(data == b"armed\n" and info.st_uid == 0 and info.st_gid == 0
            and stat.S_IMODE(info.st_mode) == 0o600, "sentinel_write")


def _remove_sentinel(helper: ModuleType) -> None:
    try:
        data, info = helper.read_regular(SENTINEL, root_only=True)
    except FileNotFoundError:
        return
    require(data == b"armed\n" and info.st_uid == 0 and info.st_gid == 0
            and stat.S_IMODE(info.st_mode) == 0o600, "sentinel_drift")
    SENTINEL.unlink()


def _lock(helper: ModuleType):
    return helper.lock()


def install() -> Path:
    require(os.geteuid() == 0, "root_required")
    helper = shared()
    with _lock(helper):
        current, info = helper.read_regular(SITE)
        require(info.st_uid == 0 and info.st_gid == 0
                and not (stat.S_IMODE(info.st_mode) & 0o022)
                and sha(current) == ORIGINAL_SHA256,
                "site_drift")
        active = render_site(current)
        _ensure_installed_operator(INSTALLED_OPERATOR)
        gates, _ = helper.load_gate_manifest(helper.GATE_ROOT / "manifest.json")
        helper.check_predecessor()
        helper.check_candidate(gates["candidate"])
        _ensure_state_root(STATE_ROOT)
        run = STATE_ROOT / (time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()) + "-" + secrets.token_hex(8))
        run.mkdir(mode=0o700)
        helper.atomic_write(run / "site.before", current, mode=0o600)
        helper.atomic_write(run / "site.active", active, mode=0o600)
        unit = "phone11-status-cookie-canary-" + secrets.token_hex(8)
        record = {"schema": SCHEMA, "site": str(SITE), "before_sha256": sha(current),
                  "active_sha256": sha(active), "state": "prepared", "timer_unit": unit,
                  "site_mode": stat.S_IMODE(info.st_mode), "site_uid": info.st_uid,
                  "site_gid": info.st_gid}
        _write_receipt(helper, run, record)
        # The fixed protected executable and live timer are mandatory before changing Nginx.
        _arm_expiry(helper, unit, run)
        try:
            site_now, site_info = helper.read_regular(SITE)
            require(site_now == current and site_info.st_uid == info.st_uid
                    and site_info.st_gid == info.st_gid
                    and stat.S_IMODE(site_info.st_mode) == stat.S_IMODE(info.st_mode),
                    "site_drift")
            _create_sentinel(helper)
            helper.atomic_write(SITE, active, mode=stat.S_IMODE(info.st_mode),
                                uid=info.st_uid, gid=info.st_gid)
            helper.nginx_validate_and_reload()
            require(helper.read_regular(SITE)[0] == active, "site_drift")
            helper.check_candidate(gates["candidate"])
            record["state"] = "active"
            _write_receipt(helper, run, record)
            return run
        except Exception as original_error:
            try:
                _remove_sentinel(helper)
                now, now_info = helper.read_regular(SITE)
                require(now in (current, active), "site_drift")
                if (now != current or stat.S_IMODE(now_info.st_mode) != stat.S_IMODE(info.st_mode)
                        or now_info.st_uid != info.st_uid or now_info.st_gid != info.st_gid):
                    helper.atomic_write(SITE, current, mode=stat.S_IMODE(info.st_mode),
                                        uid=info.st_uid, gid=info.st_gid)
                helper.nginx_validate_and_reload()
                require(sha(helper.read_regular(SITE)[0]) == ORIGINAL_SHA256, "restore_hash")
                record["state"] = "rolled_back"
                _write_receipt(helper, run, record)
                _stop_expiry(helper, record)
            except Exception as restore_error:
                raise Refusal("restore_requires_operator; expiry timer remains armed") from restore_error
            raise original_error


def rollback(run: Path) -> None:
    require(os.geteuid() == 0, "root_required")
    helper = shared()
    with _lock(helper):
        record, before, active = _load_receipt(helper, run)
        _remove_sentinel(helper)
        current, info = helper.read_regular(SITE)
        require(current in (before, active) and info.st_uid == record["site_uid"]
                and info.st_gid == record["site_gid"], "site_drift")
        if (current != before or stat.S_IMODE(info.st_mode) != record["site_mode"]):
            helper.atomic_write(SITE, before, mode=record["site_mode"],
                                uid=record["site_uid"], gid=record["site_gid"])
        # Validate, reload independently, and re-read the exact restored bytes.
        helper.nginx_validate_and_reload()
        restored, _ = helper.read_regular(SITE)
        require(sha(restored) == record["before_sha256"] == ORIGINAL_SHA256, "restore_hash")
        record["state"] = "rolled_back"
        _write_receipt(helper, run, record)
        _stop_expiry(helper, record)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_subparsers(dest="action", required=True)
    actions.add_parser("install", help="install the ten-minute GET-only cookie canary")
    restore = actions.add_parser("rollback", help="restore the sealed original Nginx site bytes")
    restore.add_argument("--receipt-dir", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.action == "install":
            run = install()
            print(json.dumps({"state": "active", "receipt_dir": str(run)}, sort_keys=True))
        else:
            rollback(args.receipt_dir)
            print(json.dumps({"state": "rolled_back", "receipt_dir": str(args.receipt_dir)}, sort_keys=True))
        return 0
    except Exception:
        # Do not include command output: it may contain request or environment data.
        print("Phone11 cookie canary refused or failed; inspect the protected receipt and site before retrying.",
              file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
