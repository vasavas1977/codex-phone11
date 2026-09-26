#!/usr/bin/env python3
"""Build a private, hash-manifested voicemail runtime bundle from a clean SHA.

This does not deploy, install credentials, change FreeSWITCH, or enable a hook.
Build dist/voicemail/*.mjs first with the reviewed source and lockfile.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[1]
FILES = {
    "producer.mjs": ("dist/voicemail/producer.mjs", 0o600),
    "relay.mjs": ("dist/voicemail/relay.mjs", 0o600),
    "local-fallback-ingress.mjs": ("dist/voicemail/local-fallback-ingress.mjs", 0o600),
    "phone11_voicemail_local_fallback.lua": ("infra/configs/freeswitch/scripts/phone11_voicemail_local_fallback.lua", 0o600),
    "runner.sh": ("scripts/phone11-voicemail-runner.sh", 0o700),
    "runtime-check.mjs": ("scripts/phone11-voicemail-runtime-check.mjs", 0o600),
    "fs-entrypoint.sh": ("scripts/phone11-voicemail-fs-entrypoint.sh", 0o700),
    "relay-entrypoint.sh": ("scripts/phone11-voicemail-relay-entrypoint.sh", 0o700),
    "phone11_voicemail_deposit.lua": ("infra/configs/freeswitch/scripts/phone11_voicemail_deposit.lua", 0o600),
    "voicemail.conf.xml": ("infra/configs/freeswitch/autoload_configs/voicemail.conf.xml", 0o600),
}


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def git_state(root: Path, expected_sha: str) -> None:
    if len(expected_sha) != 40 or any(c not in "0123456789abcdef" for c in expected_sha):
        raise ValueError("invalid_source_sha")
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
    dirty = subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=all"],
                                    cwd=root, text=True).strip()
    if head != expected_sha or dirty:
        raise ValueError("source_not_clean_or_pinned")


def verify_built_workers(root: Path) -> None:
    """Reject a stale or substituted dist artifact by rebuilding all workers."""
    esbuild = root / "node_modules/.bin/esbuild"
    if not esbuild.is_file():
        raise ValueError("esbuild_missing")
    with tempfile.TemporaryDirectory(prefix="phone11-vm-verify-") as temporary:
        for name, source in (("producer", "phone11-voicemail-producer.ts"),
                             ("relay", "phone11-voicemail-relay.ts"),
                             ("local-fallback-ingress", "phone11-voicemail-local-fallback-ingress.ts")):
            rebuilt = Path(temporary) / f"{name}.mjs"
            subprocess.run([str(esbuild), f"scripts/{source}", "--platform=node",
                            "--packages=external", "--bundle", "--format=esm",
                            f"--outfile={rebuilt}"], cwd=root, check=True,
                           capture_output=True)
            built = root / "dist/voicemail" / f"{name}.mjs"
            try:
                existing = built.read_bytes()
            except FileNotFoundError as error:
                raise ValueError("worker_not_built") from error
            if existing != rebuilt.read_bytes():
                raise ValueError("worker_build_mismatch")


def write_private(path: Path, data: bytes, mode: int) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(path, flags, mode)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, "wb", closefd=False) as handle:
            handle.write(data)
            handle.flush()
            os.fsync(fd)
    finally:
        os.close(fd)


def package_files(root: Path, output: Path, source_sha: str) -> str:
    if not output.is_absolute() or output.exists():
        raise ValueError("output_must_be_new_absolute_path")
    parent = output.parent.lstat()
    if (not stat.S_ISDIR(parent.st_mode) or stat.S_ISLNK(parent.st_mode) or
            parent.st_uid != os.getuid() or stat.S_IMODE(parent.st_mode) & 0o077):
        raise ValueError("invalid_output_parent")
    payloads: dict[str, bytes] = {}
    for target, (source, _) in FILES.items():
        file = root / source
        info = file.lstat()
        if not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode) or not 0 < info.st_size < 5_000_000:
            raise ValueError("invalid_release_file")
        payloads[target] = file.read_bytes()
        if len(payloads[target]) != info.st_size:
            raise ValueError("release_file_changed")
    output.mkdir(mode=0o700)
    os.chmod(output, 0o700)
    for target, (_, mode) in FILES.items():
        write_private(output / target, payloads[target], mode)
    manifest = {"schema": "phone11.voicemail-runtime/v1", "source_sha": source_sha,
                "files": {name: digest(data) for name, data in payloads.items()}}
    manifest_bytes = (json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n").encode()
    write_private(output / "release.json", manifest_bytes, 0o600)
    directory = os.open(output, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(directory)
    finally:
        os.close(directory)
    return digest(manifest_bytes)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    git_state(ROOT, args.source_sha)
    verify_built_workers(ROOT)
    manifest_sha = package_files(ROOT, args.output, args.source_sha)
    print(json.dumps({"source_sha": args.source_sha, "manifest_sha256": manifest_sha}, sort_keys=True))


if __name__ == "__main__":
    main()
