#!/usr/bin/env python3
"""Sealed 3016 tRPC route switch; requires a separately prepared workerless candidate."""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys
import time
from typing import Any
from urllib.parse import urlsplit

HERE = Path(__file__).resolve().parent

def sibling(filename: str, name: str):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    if spec is None or spec.loader is None:
        raise RuntimeError("helper_missing")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module

start = sibling("phone11-mainline-release-start.py", "phone11_mainline_start")
old = sibling("phone11-chat-inbox-release-route.py", "phone11_old_route")
pilot = sibling("phone11-parallel-api-pilot.py", "phone11_pilot")
SCHEMA = "phone11-mainline-ec2-route/v1"
ROOT = Path("/var/lib/phone11-mainline-release-route")
PROBE_LABELS = {"existing_phone", "existing_chat", "conference", "mixed_batch", "denied_tenant"}
READ_PATHS = {"existing_phone": {"/api/trpc/phone.getConfig"},
              "existing_chat": {"/api/trpc/chat.list"},
              "conference": {"/api/trpc/conference.capabilities", "/api/trpc/conference.list"},
              "mixed_batch": {"/api/trpc/phone.getConfig,chat.list"},
              "denied_tenant": {"/api/trpc/phone.getConfig", "/api/trpc/chat.list"}}


def require(condition: bool, stage: str) -> None:
    start.require(condition, stage)


def encoded(value: dict[str, Any]) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def root_dir() -> None:
    ROOT.mkdir(mode=0o700, exist_ok=True)
    info = ROOT.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and info.st_gid == 0 and stat.S_IMODE(info.st_mode) == 0o700, "route_root")


def root_file(path: Path) -> bytes:
    info = path.lstat()
    require(info.st_uid == 0 and info.st_gid == 0 and stat.S_IMODE(info.st_mode) == 0o600, "receipt_owner")
    return start.secure_file(path)


def site(expected: bytes | None = None) -> tuple[bytes, os.stat_result]:
    raw, info = old.read_regular(start.SITE_ENABLED)
    require(info.st_uid == 0 and info.st_gid == 0 and stat.S_ISREG(info.st_mode), "site_owner")
    if expected is not None:
        require(raw == expected, "site_drift")
    return raw, info


def protected(pins: dict[str, Any], candidate_id: str | None = None) -> None:
    source = start.source_runtime(pins)
    start.pinned_container(start.BASELINE, pins["baseline"], port=3000, build=pins["baseline"]["build"], role=pins["baseline"]["role"])
    start.pinned_container(start.RECOVERY, pins["recovery"], port=3004, build=pins["recovery"]["build"], role=pins["recovery"]["role"])
    if candidate_id is not None:
        start.check_candidate(pins, source, candidate_id)
    wake = start.secure_file(start.WAKE_CONFIG)
    require(start.digest(wake) == pins["wake"]["config_sha256"] and wake.count(start.WAKE_URL) == pins["wake"]["reference_count"], "wake_drift")
    require(start.command("docker", "exec", "p11-kamailio", "sha256sum", str(start.WAKE_CONFIG)).decode().split()[0] == pins["wake"]["config_sha256"], "wake_runtime_drift")


def start_receipt(path: Path, pins: dict[str, Any]) -> str:
    require(path.parent == start.STATE_ROOT and path.name.endswith(".json"), "start_receipt_path")
    record = json.loads(root_file(path))
    candidate = pins["candidate"]
    require(record == {"schema": start.SCHEMA, "container_id": path.stem,
        "image": candidate["image"], "source_sha": candidate["source_sha"],
        "bundle_sha256": candidate["bundle_sha256"], "build": candidate["build"],
        "name": candidate["name"], "port": candidate["port"]}, "start_receipt")
    require(start.SHA.fullmatch(path.stem) is not None, "start_receipt")
    return path.stem


def probes(path: Path, expected_sha: str, origin: str) -> None:
    require(start.SHA.fullmatch(expected_sha) is not None and start.digest(root_file(path)) == expected_sha, "probe_fixture")
    # Reuse the reviewed five-probe authenticated fixture parser and direct HTTP client.
    class Pins:
        probes_sha256 = expected_sha
    values = pilot.load_probes(root_file(path), Pins())
    require({probe["label"] for probe in values} == PROBE_LABELS, "probe_fixture")
    for probe in values:
        parsed = urlsplit(probe["path"])
        require(probe["method"] == "GET" and probe["body"] == ""
                and parsed.path in READ_PATHS[probe["label"]]
                and parsed.scheme == parsed.netloc == parsed.fragment == ""
                and probe["status"] == (403 if probe["label"] == "denied_tenant" else 200), "probe_read_only")
    pilot.run_probes(pilot.System(), origin, values)


def sealed(directory: Path, state: str, pins: dict[str, Any]) -> tuple[dict[str, Any], bytes, bytes]:
    require(directory.parent == ROOT and not directory.is_symlink(), "receipt_path")
    info = directory.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and info.st_gid == 0 and stat.S_IMODE(info.st_mode) == 0o700, "receipt_dir")
    record = json.loads(root_file(directory / "receipt.json"))
    before, active = root_file(directory / "site.before"), root_file(directory / "site.active")
    require(isinstance(record, dict) and set(record) == {"schema", "state", "manifest_sha256",
        "before_sha256", "active_sha256", "candidate_id", "active_dump_sha256",
        "fixture_sha256", "rollback_fixture_sha256"}, "receipt_integrity")
    require(start.SHA.fullmatch(record["fixture_sha256"]) is not None
        and start.SHA.fullmatch(record["rollback_fixture_sha256"]) is not None
        and (record["active_dump_sha256"] is None if state == "prepared"
             else start.SHA.fullmatch(record["active_dump_sha256"]) is not None), "receipt_integrity")
    require(record.get("schema") == SCHEMA and record.get("state") == state
        and record.get("manifest_sha256") == start.digest(encoded(pins))
        and record.get("before_sha256") == start.digest(before)
        and record.get("active_sha256") == start.digest(active)
        and record.get("candidate_id") == (directory.name.split("-")[-1])
        and old.rewrite_trpc(before, 3016, pins["candidate"]["port"]) == active
        and old.rewrite_trpc(active, pins["candidate"]["port"], 3016) == before, "receipt_integrity")
    return record, before, active


def write_site(expected: bytes, replacement: bytes, info: os.stat_result) -> None:
    site(expected)
    old.atomic_write(start.SITE_ENABLED, replacement, mode=stat.S_IMODE(info.st_mode), uid=info.st_uid, gid=info.st_gid)
    site(replacement)


def reload() -> None:
    start.command("nginx", "-t")
    start.command("systemctl", "reload", "nginx")


def prepare(pins: dict[str, Any], receipt: Path, fixture: Path, fixture_sha: str,
            rollback_fixture: Path, rollback_sha: str) -> Path:
    start.site_and_wake(pins, pins["candidate"]["port"])
    candidate_id = start_receipt(receipt, pins)
    protected(pins, candidate_id)
    probes(fixture, fixture_sha, f"http://127.0.0.1:{pins['candidate']['port']}")
    probes(rollback_fixture, rollback_sha, "http://127.0.0.1:3016")
    before, _ = site()
    require(start.digest(before) == pins["nginx"]["site_sha256"], "site_drift")
    after = old.rewrite_trpc(before, 3016, pins["candidate"]["port"])
    root_dir()
    directory = ROOT / (time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()) + "-" + candidate_id)
    directory.mkdir(mode=0o700)
    old.atomic_write(directory / "site.before", before, mode=0o600)
    old.atomic_write(directory / "site.active", after, mode=0o600)
    record = {"schema": SCHEMA, "state": "prepared", "manifest_sha256": start.digest(encoded(pins)),
        "before_sha256": start.digest(before), "active_sha256": start.digest(after),
        "candidate_id": candidate_id, "active_dump_sha256": None, "fixture_sha256": fixture_sha,
        "rollback_fixture_sha256": rollback_sha}
    old.atomic_write(directory / "receipt.json", encoded(record), mode=0o600)
    return directory


def activate(pins: dict[str, Any], directory: Path, fixture: Path, public_origin: str) -> None:
    record, before, after = sealed(directory, "prepared", pins)
    require(public_origin == "https://api.phone11.ai", "public_origin")
    before_dump = start.command("nginx", "-T")
    require(start.digest(before_dump) == pins["nginx"]["dump_sha256"], "nginx_dump_drift")
    current, info = site(before)
    protected(pins, record["candidate_id"])
    probes(fixture, record["fixture_sha256"], f"http://127.0.0.1:{pins['candidate']['port']}")
    site(current)
    try:
        write_site(before, after, info)
        reload()
        probes(fixture, record["fixture_sha256"], public_origin)
        site(after)
        protected(pins, record["candidate_id"])
        after_dump = start.command("nginx", "-T")
        require(after_dump.count(after) == 1 and after_dump.replace(after, before, 1) == before_dump,
                "nginx_generation_drift")
        record["active_dump_sha256"] = start.digest(after_dump)
        record["state"] = "active"
        old.atomic_write(directory / "receipt.json", encoded(record), mode=0o600)
    except Exception:
        # An ambiguous reload never authorizes overwriting a third party's site.
        current, now = site()
        if current == after:
            write_site(after, before, now)
            reload()
            site(before)
        elif current != before:
            raise start.Refused("restore_requires_operator")
        raise


def rollback(pins: dict[str, Any], directory: Path, fixture: Path, public_origin: str) -> None:
    record, before, after = sealed(directory, "active", pins)
    require(public_origin == "https://api.phone11.ai", "public_origin")
    require(start.digest(start.command("nginx", "-T")) == record["active_dump_sha256"], "nginx_dump_drift")
    _, info = site(after)
    protected(pins)
    try:
        write_site(after, before, info)
        reload()
        site(before)
        require(start.digest(start.command("nginx", "-T")) == pins["nginx"]["dump_sha256"], "nginx_dump_drift")
        probes(fixture, record["rollback_fixture_sha256"], public_origin)
        site(before)
        protected(pins)
        record["state"] = "rolled_back"
        old.atomic_write(directory / "receipt.json", encoded(record), mode=0o600)
    except Exception:
        # Keep the predecessor routed if it was restored, even when a later
        # probe fails. Never automatically send traffic back to a bad candidate.
        current, _ = site()
        if current not in {before, after}:
            raise start.Refused("restore_requires_operator")
        raise


def recover(pins: dict[str, Any], directory: Path, rollback_fixture: Path, public_origin: str) -> None:
    """Reconcile only interrupted writes toward the pinned 3016 predecessor."""
    require(public_origin == "https://api.phone11.ai", "public_origin")
    require(directory.parent == ROOT and not directory.is_symlink(), "receipt_path")
    raw = json.loads(root_file(directory / "receipt.json"))
    require(raw.get("state") in {"prepared", "active"}, "recovery_state")
    record, before, after = sealed(directory, raw["state"], pins)
    current, info = site()
    protected(pins)  # Candidate health is deliberately irrelevant to recovery.
    if current == after and record["state"] == "prepared":
        dump = start.command("nginx", "-T")
        require(dump.count(after) == 1
                and start.digest(dump.replace(after, before, 1)) == pins["nginx"]["dump_sha256"], "nginx_generation_drift")
        write_site(after, before, info)
        reload()
    else:
        require(current == before, "site_drift")
        # Disk state alone cannot prove which Nginx generation serves traffic:
        # a process could have died between atomic site write and reload.
        reload()
    require(start.digest(start.command("nginx", "-T")) == pins["nginx"]["dump_sha256"], "nginx_dump_drift")
    probes(rollback_fixture, record["rollback_fixture_sha256"], public_origin)
    site(before)
    protected(pins)
    record["state"] = "aborted" if raw["state"] == "prepared" else "rolled_back"
    old.atomic_write(directory / "receipt.json", encoded(record), mode=0o600)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "activate", "rollback", "recover"))
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--start-receipt", type=Path)
    parser.add_argument("--receipt-dir", type=Path)
    parser.add_argument("--probes-file", type=Path, required=True)
    parser.add_argument("--probes-sha256", type=str)
    parser.add_argument("--rollback-probes-file", type=Path)
    parser.add_argument("--rollback-probes-sha256", type=str)
    parser.add_argument("--public-origin", default="https://api.phone11.ai")
    args = parser.parse_args()
    fd = None
    try:
        require(os.geteuid() == 0, "root_required")
        fd = start.lock()
        pins = start.manifest(args.manifest)
        if args.action == "prepare":
            require(args.start_receipt is not None and args.probes_sha256 is not None
                    and args.rollback_probes_file is not None and args.rollback_probes_sha256 is not None, "arguments")
            print(prepare(pins, args.start_receipt, args.probes_file, args.probes_sha256,
                          args.rollback_probes_file, args.rollback_probes_sha256))
        else:
            require(args.receipt_dir is not None, "arguments")
            if args.action == "activate":
                activate(pins, args.receipt_dir, args.probes_file, args.public_origin)
            elif args.action == "rollback":
                require(args.rollback_probes_file is not None, "arguments")
                rollback(pins, args.receipt_dir, args.rollback_probes_file, args.public_origin)
            else:
                require(args.rollback_probes_file is not None, "arguments")
                recover(pins, args.receipt_dir, args.rollback_probes_file, args.public_origin)
        return 0
    except (start.Refused, old.GuardError, pilot.GuardError, OSError, ValueError, KeyError, TypeError, json.JSONDecodeError):
        print("Phone11 route operation refused; inspect host state and sealed receipt.", file=sys.stderr)
        return 1
    finally:
        if fd is not None:
            os.close(fd)


if __name__ == "__main__":
    raise SystemExit(main())
