#!/usr/bin/env python3
"""Promote the invitation-disabled, pilot-guarded 3014 API to public tRPC.

This is the safety baseline for a later invitation release. It edits only the
two tRPC proxy targets. It has no 3013 rollback command: after invitations are
ever enabled, 3013 is not a safe fallback for newly admitted tenant-1 users.
It does not apply SQL, enable invitations, send mail, or start containers.
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager
import fcntl
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
from typing import Iterator


SITE = Path("/etc/nginx/sites-enabled/phone11ai")
STATE = Path("/var/lib/phone11-invitations-route-20260927")
LOCK = Path("/run/phone11-desktop-provisioning-route.lock")
SITE_SHA256 = "9bb3907e3b1865260c995be1eab25e4451180e2d9debb375b7f47d2ecb210fe3"
TARGET_SITE_SHA256 = "bf4a12523f3cacb8c24dde74948271d95773edac3fe3217baefb0104ca562b2c"
LOCK_SHA256 = "24a72aa60f0b43fe3afdad41f2e0f0f348f75ac065172627913fe72d43f2c801"
OLD = {
    "name": "cp11-api-candidate-voicemail",
    "id": "4ff2de8f0f0e247fc8511c7355ea61d024a063ccff969a1a8e20bc0352451210",
    "image": "sha256:a357b1b1003caa462ce96a0606a0c3406541056ce86d351e1f21912f55f622be",
    "source": "1a6154d875db87692331b660322fb4545df8b028",
    "bundle": "829c8b9a73d152cdc7df1dd57b1066960ddec223b33cdccfe89df7f8b6dfaeb3",
    "port": 3013,
}
GUARDED = {
    "name": "cp11-api-candidate-invitations",
    "id": "3507bfb214e7e76bcf18172dca4b1573491b6a1ec9bce7acc379c7fd5247a229",
    "image": "sha256:0942f8a6dd17f2919e6631adbc55318e2e8693ff9f869f90fa26d8327950b47d",
    "source": "b3ed0e71e1683cd3eca503bee902a221b2c3e3ca",
    "bundle": "f06dcd6044a4a8b50ec35571834d7f82170efdd1d86b7559a2e3315fddd416a2",
    "build": "invitations-off-b3ed0e7",
    "port": 3014,
}
SCHEMA = "phone11-invitations-guarded-route/v1"
MAX_BYTES = 2 * 1024 * 1024


class Refused(RuntimeError):
    pass


def need(ok: bool, stage: str) -> None:
    if not ok:
        raise Refused(stage)


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def command(argv: list[str], timeout: int = 20) -> bytes:
    result = subprocess.run(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, timeout=timeout,
                            env={"PATH": "/usr/local/bin:/usr/bin:/bin", "LANG": "C", "LC_ALL": "C"})
    need(result.returncode == 0 and len(result.stdout) <= MAX_BYTES, "command")
    return result.stdout


def inspect(pin: dict[str, object]) -> dict[str, object]:
    rows = json.loads(command(["/usr/bin/docker", "inspect", str(pin["id"])]))
    need(isinstance(rows, list) and len(rows) == 1 and isinstance(rows[0], dict), "inspect")
    item = rows[0]
    need(item.get("Id") == pin["id"] and item.get("Image") == pin["image"]
         and item.get("Name") == "/" + str(pin["name"])
         and item.get("State", {}).get("Running") is True
         and item.get("State", {}).get("Health", {}).get("Status") == "healthy", "identity")
    labels = item.get("Config", {}).get("Labels") or {}
    need(labels.get("com.phone11.source-sha") == pin["source"]
         and labels.get("com.phone11.bundle-sha256") == pin["bundle"]
         and labels.get("com.phone11.lock-sha256") == LOCK_SHA256, "release")
    actual = command(["/usr/bin/docker", "exec", str(pin["id"]), "sha256sum",
                      "/app/dist/index.mjs"]).split()
    need(len(actual) == 2 and actual[0] == str(pin["bundle"]).encode()
         and actual[1] == b"/app/dist/index.mjs", "bundle")
    port = str(pin["port"])
    expected = {port + "/tcp": [{"HostIp": "127.0.0.1", "HostPort": port}]}
    need(item.get("HostConfig", {}).get("PortBindings") == expected, "loopback")
    return item


def env_map(item: dict[str, object]) -> dict[str, str]:
    values = item.get("Config", {}).get("Env")
    need(isinstance(values, list), "environment")
    result: dict[str, str] = {}
    for value in values:
        need(isinstance(value, str) and "=" in value, "environment")
        key, content = value.split("=", 1)
        need(bool(re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key)) and key not in result,
             "environment")
        result[key] = content
    return result


def check_apis(*, require_old: bool = True) -> None:
    guarded = inspect(GUARDED)
    guarded_env = env_map(guarded)
    need(guarded_env.get("PORT") == "3014"
         and guarded_env.get("PHONE11_RUNTIME_ROLE") == "api-candidate"
         and guarded_env.get("PHONE11_VOICEMAIL_HOOK_READY") == "false"
         and guarded_env.get("PHONE11_INVITATIONS_ENABLED") == "false"
         and guarded_env.get("PHONE11_BUILD_SHA") == GUARDED["build"], "api_role")
    labels = guarded["Config"].get("Labels") or {}
    need(labels.get("com.phone11.invitations-stage.owner") ==
         "phone11-invitations-api-stage/v1" and
         bool(re.fullmatch(r"[0-9a-f]{64}",
                           labels.get("com.phone11.invitations-stage.manifest-sha256", ""))),
         "stage_owner")
    conn = http.client.HTTPConnection("127.0.0.1", 3014, timeout=5)
    try:
        conn.request("GET", "/api/health")
        reply = conn.getresponse()
        body = reply.read(16_385)
        need(reply.status == 200 and len(body) <= 16_384, "candidate_health")
        health = json.loads(body)
        need(health.get("ok") is True and health.get("runtimeRole") == "api-candidate"
             and health.get("build") == GUARDED["build"], "candidate_health")
    finally:
        conn.close()
    if require_old:
        old = inspect(OLD)
        old_env = env_map(old)
        need(old_env.get("PORT") == "3013"
             and old_env.get("PHONE11_RUNTIME_ROLE") == "api-candidate"
             and old_env.get("PHONE11_VOICEMAIL_HOOK_READY", "false") == "false",
             "old_api_role")
        expected_env = dict(old_env)
        expected_env.update({"PORT": "3014", "PHONE11_RUNTIME_ROLE": "api-candidate",
                             "PHONE11_VOICEMAIL_HOOK_READY": "false",
                             "PHONE11_BUILD_SHA": str(GUARDED["build"]),
                             "PHONE11_INVITATIONS_ENABLED": "false"})
        need(guarded_env == expected_env, "api_environment_drift")
        for key in ("User", "WorkingDir", "Entrypoint", "Cmd"):
            need(old["Config"].get(key) == guarded["Config"].get(key), "process_shape")
        for key in ("NetworkMode", "Memory", "ReadonlyRootfs", "PidsLimit", "SecurityOpt",
                    "CapDrop", "CapAdd", "Privileged", "RestartPolicy"):
            need(old["HostConfig"].get(key) == guarded["HostConfig"].get(key), "host_shape")
        need(set(old["NetworkSettings"]["Networks"]) ==
             set(guarded["NetworkSettings"]["Networks"]), "network_shape")
        mounts = lambda item: {(m["Type"], m["Source"], m["Destination"], m["RW"])
                               for m in item["Mounts"]}
        need(mounts(old) == mounts(guarded), "mount_shape")


def read_file(path: Path, *, mode: int | None = None) -> tuple[bytes, os.stat_result]:
    before = path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and
         before.st_uid == 0 and before.st_gid == 0 and 0 < before.st_size <= MAX_BYTES,
         "file_shape")
    if mode is not None:
        need(stat.S_IMODE(before.st_mode) == mode, "file_mode")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        opened = os.fstat(fd)
        need((before.st_dev, before.st_ino, before.st_size, before.st_uid, before.st_gid) ==
             (opened.st_dev, opened.st_ino, opened.st_size, opened.st_uid, opened.st_gid),
             "file_identity")
        data = os.read(fd, MAX_BYTES + 1)
        need(len(data) == before.st_size, "file_size")
        return data, before
    finally:
        os.close(fd)


def secure_directory(path: Path, *, private: bool = False) -> None:
    info = path.lstat()
    need(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and info.st_gid == 0
         and (stat.S_IMODE(info.st_mode) == 0o700 if private else
              stat.S_IMODE(info.st_mode) & 0o022 == 0), "directory")


def rewrite_trpc(site: bytes, source: int = 3013, target: int = 3014) -> bytes:
    text = site.decode("utf-8")
    edits: list[tuple[int, int, str]] = []
    for selector in ("= /api/trpc", "^~ /api/trpc/"):
        header = re.compile(r"(?m)^[ \t]*location[ \t]+" + re.escape(selector) + r"[ \t]*\{")
        found = list(header.finditer(text))
        need(len(found) == 1, "trpc_location")
        start = found[0].end()
        end = text.find("}", start)
        need(end > start and "{" not in text[start:end], "trpc_location")
        block = text[start:end]
        passes = list(re.finditer(r"(?m)^[ \t]*proxy_pass[ \t]+[^;\n]+;[ \t]*$", block))
        need(len(passes) == 1, "trpc_proxy")
        before = f"proxy_pass http://127.0.0.1:{source};"
        need(passes[0].group().strip() == before, "trpc_proxy")
        replacement = passes[0].group().replace(before,
                                                  f"proxy_pass http://127.0.0.1:{target};")
        edits.append((start + passes[0].start(), start + passes[0].end(), replacement))
    need(edits[0][1] <= edits[1][0] or edits[1][1] <= edits[0][0], "trpc_location")
    for start, end, replacement in sorted(edits, reverse=True):
        text = text[:start] + replacement + text[end:]
    result = text.encode("utf-8")
    need(result != site, "route_no_change")
    return result


def write_once(path: Path, data: bytes) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def replace_site(data: bytes, info: os.stat_result) -> None:
    secure_directory(SITE.parent)
    temporary = SITE.parent / ("." + SITE.name + "." + secrets.token_hex(8))
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        os.fchown(fd, info.st_uid, info.st_gid)
        os.fchmod(fd, stat.S_IMODE(info.st_mode))
        with os.fdopen(fd, "wb", closefd=False) as stream:
            stream.write(data)
            stream.flush()
        os.fsync(fd)
        os.close(fd)
        fd = -1
        os.replace(temporary, SITE)
        directory = os.open(SITE.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if fd >= 0:
            os.close(fd)
        temporary.unlink(missing_ok=True)


@contextmanager
def locked() -> Iterator[None]:
    fd = os.open(LOCK, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and
             stat.S_IMODE(info.st_mode) == 0o600, "lock")
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        os.close(fd)


def receipt() -> tuple[dict[str, object], bytes, bytes]:
    info = STATE.lstat()
    need(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and info.st_gid == 0
         and stat.S_IMODE(info.st_mode) == 0o700, "state")
    raw, _ = read_file(STATE / "receipt.json", mode=0o600)
    record = json.loads(raw)
    need(record == {"schema": SCHEMA, "before_sha256": SITE_SHA256,
                    "target_sha256": TARGET_SITE_SHA256,
                    "guarded_id": GUARDED["id"], "state": record.get("state")}
         and record["state"] in ("prepared", "active"), "receipt")
    before, _ = read_file(STATE / "site.before", mode=0o600)
    after, _ = read_file(STATE / "site.guarded", mode=0o600)
    need(sha(before) == SITE_SHA256 and sha(after) == record["target_sha256"]
         and rewrite_trpc(before) == after and rewrite_trpc(after, 3014, 3013) == before,
         "receipt_integrity")
    return record, before, after


def save_receipt(record: dict[str, object]) -> None:
    raw = (json.dumps(record, sort_keys=True, separators=(",", ":")) + "\n").encode()
    path = STATE / "receipt.json"
    temporary = STATE / (".receipt." + secrets.token_hex(8))
    write_once(temporary, raw)
    os.replace(temporary, path)
    directory = os.open(STATE, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def prepare() -> None:
    with locked():
        secure_directory(SITE.parent)
        secure_directory(STATE.parent)
        site, _ = read_file(SITE)
        need(sha(site) == SITE_SHA256, "site_drift")
        guarded = rewrite_trpc(site)
        need(sha(guarded) == TARGET_SITE_SHA256, "target_drift")
        need(rewrite_trpc(guarded, 3014, 3013) == site, "route_roundtrip")
        check_apis()
        STATE.mkdir(mode=0o700)
        secure_directory(STATE, private=True)
        write_once(STATE / "site.before", site)
        write_once(STATE / "site.guarded", guarded)
        save_receipt({"schema": SCHEMA, "before_sha256": SITE_SHA256,
                      "target_sha256": sha(guarded), "guarded_id": GUARDED["id"],
                      "state": "prepared"})
        print(json.dumps({"state": "prepared", "before_sha256": SITE_SHA256,
                          "target_sha256": sha(guarded)}, sort_keys=True))


def promote() -> None:
    with locked():
        record, before, guarded = receipt()
        site, info = read_file(SITE)
        need(site in (before, guarded), "site_drift")
        check_apis(require_old=site == before)
        if site == before:
            replace_site(guarded, info)
        try:
            command(["/usr/sbin/nginx", "-t"])
        except Exception:
            # No reload was attempted. The running server still uses its old
            # configuration; restore only the on-disk bytes for this failure.
            if site == before and read_file(SITE)[0] == guarded:
                replace_site(before, info)
            raise
        # An uncertain reload keeps the safe 3014 file. Recovery only moves
        # toward guarded 3014; there is deliberately no public 3013 rollback.
        command(["/usr/bin/systemctl", "reload", "nginx"])
        need(read_file(SITE)[0] == guarded, "site_drift")
        check_apis(require_old=False)
        record["state"] = "active"
        save_receipt(record)
        print(json.dumps({"state": "active", "target_sha256": sha(guarded)}, sort_keys=True))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=("prepare", "promote", "recover"))
    args = parser.parse_args()
    try:
        need(os.geteuid() == 0, "root")
        if args.phase == "prepare":
            prepare()
        else:
            promote()  # Recovery has the same guarded, forward-only target.
        return 0
    except (Refused, OSError, ValueError, KeyError, TypeError,
            subprocess.TimeoutExpired) as error:
        stage = str(error) if isinstance(error, Refused) else type(error).__name__
        print(json.dumps({"state": "blocked", "stage": stage}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
