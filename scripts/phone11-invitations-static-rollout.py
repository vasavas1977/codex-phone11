#!/usr/bin/env python3
"""Release-specific, pinned wrapper for the Phone11 invitations web UI.

The build-host ``--package-export`` mode seals the exact Expo export into the
directory layout consumed by the existing static-portal controller. On the
portal host, the usual ``--prepare``, ``--activate`` and ``--rollback`` modes
delegate to that controller only after its bytes and this release's pins have
been verified. The wrapper never uploads files, sends invitations, changes API
configuration, or enables the invitation capability.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import stat
import sys
import tempfile
from pathlib import Path
from types import ModuleType
from typing import Sequence


CONTROLLER_NAME = "phone11-static-portal-rollout.py"
CONTROLLER_SHA256 = "3530ce85a14d7b335153b2d0a6cc1e135e5c8cbb2a377944e24f4983a01cf4ba"

# Exact frontend source and the currently published static predecessor.
RELEASE_SHA = "63203c8910ff09ba59eeb6dfcba1f58c769bface"
LIVE_RELEASE_SHA = "2b1c2b1d28753f17ab05e2030c1950fc696c32f4"

# These export pins are filled from the deterministic packaged tree below.
RELEASE_EXPORT_MANIFEST_SHA256 = "c1703bdc9512a28e473df03a96a6ed9707c7178cab38e88ffd68305437718501"
RELEASE_MARKER_SHA256 = "a06e91ed6bf4b2e1d721ff9858b2da57394f717df3413ff6b8ec9cf35d99c13c"
RELEASE_MAIN_JAVASCRIPT = "_expo/static/js/web/entry-b059c5949c120cf13e3c0ad004f62b8a.js"
RELEASE_MAIN_JAVASCRIPT_SHA256 = "08be2823d632c4f153b8cfc8714b71deb171a91397840af27c8947f099d5f49a"

PUBLIC_ORIGIN = "https://1toall.phone11.ai"
API_ORIGIN = "https://api.phone11.ai"
RELEASE_MARKER = "phone11-static-portal-release.json"
EXPORT_MANIFEST_NAME = "export-manifest.json"
EXPORT_SCHEMA = "phone11-static-portal-export/v1"
RELEASE_SCHEMA = "phone11-static-portal-release/v1"
MAX_CONTROLLER_BYTES = 256 * 1024
MAX_SOURCE_FILES = 2048
MAX_SOURCE_BYTES = 128 * 1024 * 1024
FORBIDDEN_ORIGIN = re.compile(
    rb"https?://(?:[a-z0-9.-]*phone11\.test|[a-z0-9.-]*fixture[a-z0-9.-]*|"
    rb"localhost|127\.0\.0\.1|\[?::1\])(?::\d+)?(?:[/\"'?#]|$)",
    re.IGNORECASE,
)


class ReleasePinError(RuntimeError):
    pass


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _require_sha(value: str, length: int, label: str) -> None:
    if not re.fullmatch(rf"[0-9a-f]{{{length}}}", value):
        raise ReleasePinError(f"unsealed_{label}")


def validate_pins() -> None:
    _require_sha(CONTROLLER_SHA256, 64, "controller")
    _require_sha(RELEASE_SHA, 40, "source")
    _require_sha(LIVE_RELEASE_SHA, 40, "predecessor")
    _require_sha(RELEASE_EXPORT_MANIFEST_SHA256, 64, "manifest")
    _require_sha(RELEASE_MARKER_SHA256, 64, "marker")
    _require_sha(RELEASE_MAIN_JAVASCRIPT_SHA256, 64, "entry")
    if RELEASE_SHA == LIVE_RELEASE_SHA:
        raise ReleasePinError("candidate_equals_predecessor")
    if not re.fullmatch(r"_expo/static/js/web/entry-[0-9a-f]+\.js", RELEASE_MAIN_JAVASCRIPT):
        raise ReleasePinError("unsealed_entry_path")


def _read_controller(path: Path) -> bytes:
    try:
        before = path.lstat()
        if not stat.S_ISREG(before.st_mode) or before.st_size > MAX_CONTROLLER_BYTES:
            raise ReleasePinError("controller_file")
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        try:
            opened = os.fstat(fd)
            if (opened.st_dev, opened.st_ino, opened.st_size) != (
                before.st_dev,
                before.st_ino,
                before.st_size,
            ):
                raise ReleasePinError("controller_changed")
            chunks: list[bytes] = []
            while True:
                chunk = os.read(fd, 65536)
                if not chunk:
                    break
                chunks.append(chunk)
            source = b"".join(chunks)
            if len(source) != opened.st_size or sha256_bytes(source) != CONTROLLER_SHA256:
                raise ReleasePinError("controller_hash")
            return source
        finally:
            os.close(fd)
    except OSError as error:
        raise ReleasePinError("controller_file") from error


def load_controller(path: Path | None = None) -> ModuleType:
    validate_pins()
    controller_path = path or Path(__file__).with_name(CONTROLLER_NAME)
    source = _read_controller(controller_path)
    module = ModuleType("phone11_invitations_static_controller")
    module.__file__ = str(controller_path)
    sys.modules[module.__name__] = module
    try:
        exec(compile(source, str(controller_path), "exec"), module.__dict__)
    except BaseException:
        sys.modules.pop(module.__name__, None)
        raise

    for name in (
        "RELEASE_SHA",
        "LIVE_RELEASE_SHA",
        "RELEASE_EXPORT_MANIFEST_SHA256",
        "RELEASE_MARKER_SHA256",
        "RELEASE_MAIN_JAVASCRIPT",
        "RELEASE_MAIN_JAVASCRIPT_SHA256",
    ):
        setattr(module, name, globals()[name])

    def require_predecessor(release: object, stage: str) -> object:
        if getattr(release, "source_sha", None) != LIVE_RELEASE_SHA:
            raise module.RolloutError(stage)
        return release

    original_validate = module.validate_managed_predecessor
    original_receipt = module.receipt_predecessor_release

    def pinned_validate(manifest: object, site: bytes) -> object:
        return require_predecessor(original_validate(manifest, site), "managed_state")

    def pinned_receipt(manifest: object, receipt: dict[str, object]) -> object:
        return require_predecessor(original_receipt(manifest, receipt), "rollback")

    module.validate_managed_predecessor = pinned_validate
    module.receipt_predecessor_release = pinned_receipt
    module.require_predecessor_pin = require_predecessor
    return module


def _export_files(source: Path) -> dict[str, bytes]:
    try:
        root_info = source.lstat()
    except OSError as error:
        raise ReleasePinError("export_source") from error
    if not stat.S_ISDIR(root_info.st_mode) or stat.S_ISLNK(root_info.st_mode):
        raise ReleasePinError("export_source")

    files: dict[str, bytes] = {}
    total = 0
    try:
        for candidate in sorted(source.rglob("*")):
            rel = candidate.relative_to(source).as_posix()
            if candidate.is_symlink():
                raise ReleasePinError("export_symlink")
            if candidate.is_dir():
                continue
            if not candidate.is_file() or rel in {EXPORT_MANIFEST_NAME, RELEASE_MARKER}:
                raise ReleasePinError("export_file")
            if rel.startswith("/") or ".." in Path(rel).parts or "\x00" in rel:
                raise ReleasePinError("export_path")
            if len(files) >= MAX_SOURCE_FILES:
                raise ReleasePinError("export_size")
            data = candidate.read_bytes()
            total += len(data)
            if total > MAX_SOURCE_BYTES:
                raise ReleasePinError("export_size")
            files[rel] = data
    except OSError as error:
        raise ReleasePinError("export_source") from error

    if not {
        "index.html",
        "portal/index.html",
        "auth/accept-invitation.html",
        RELEASE_MAIN_JAVASCRIPT,
    }.issubset(files):
        raise ReleasePinError("export_routes")
    if not any(API_ORIGIN.encode() in data for name, data in files.items() if Path(name).suffix in {".html", ".js"}):
        raise ReleasePinError("export_api_origin")
    for name, data in files.items():
        if Path(name).suffix in {".html", ".js"} and FORBIDDEN_ORIGIN.search(data):
            raise ReleasePinError("export_forbidden_origin")
    return files


def _canonical_json(document: dict[str, object]) -> bytes:
    return (json.dumps(document, sort_keys=True, separators=(",", ":")) + "\n").encode()


def _build_package(source: Path, release_dir: Path, source_sha: str) -> tuple[str, str, str]:
    """Create an atomic sealed release tree; used by tests and package mode."""
    _require_sha(source_sha, 40, "source")
    files = _export_files(source)
    release_dir = release_dir.absolute()
    if release_dir.name != source_sha or release_dir.exists() or release_dir.is_symlink():
        raise ReleasePinError("release_destination")
    parent = release_dir.parent
    parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{source_sha}.", dir=parent))
    try:
        for relative, data in files.items():
            target = staging / relative
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
            target.write_bytes(data)
            target.chmod(0o644)
        marker = _canonical_json({
            "schema": RELEASE_SCHEMA,
            "source_sha": source_sha,
            "public_origin": PUBLIC_ORIGIN,
            "api_origin": API_ORIGIN,
        })
        (staging / RELEASE_MARKER).write_bytes(marker)
        (staging / RELEASE_MARKER).chmod(0o644)

        manifest_document = {
            "schema": EXPORT_SCHEMA,
            "source_sha": source_sha,
            "api_origin": API_ORIGIN,
            "files": {
                name: sha256_bytes(data)
                for name, data in sorted({**files, RELEASE_MARKER: marker}.items())
            },
        }
        manifest = _canonical_json(manifest_document)
        (staging / EXPORT_MANIFEST_NAME).write_bytes(manifest)
        (staging / EXPORT_MANIFEST_NAME).chmod(0o644)
        # Expo/package staging starts private. Make the immutable release root
        # traversable only after every byte has been written and hashed.
        staging.chmod(0o755)
        os.replace(staging, release_dir)
        entry_sha = sha256_bytes(files[RELEASE_MAIN_JAVASCRIPT])
        return sha256_bytes(manifest), sha256_bytes(marker), entry_sha
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def package_export(source: Path, releases_dir: Path, source_sha: str = RELEASE_SHA) -> Path:
    validate_pins()
    if source_sha != RELEASE_SHA:
        raise ReleasePinError("source_sha")
    release_dir = releases_dir / RELEASE_SHA
    manifest_sha, marker_sha, entry_sha = _build_package(source, release_dir, source_sha)
    if (
        manifest_sha != RELEASE_EXPORT_MANIFEST_SHA256
        or marker_sha != RELEASE_MARKER_SHA256
        or entry_sha != RELEASE_MAIN_JAVASCRIPT_SHA256
    ):
        shutil.rmtree(release_dir, ignore_errors=True)
        raise ReleasePinError("export_pin")
    return release_dir


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package-export", type=Path, help="Seal a static Expo export into a new release tree.")
    parser.add_argument("--releases-dir", type=Path, help="Parent of the source-SHA-named release directory.")
    arguments, controller_args = parser.parse_known_args(argv)
    try:
        if arguments.package_export is not None:
            if arguments.releases_dir is None or controller_args:
                raise ReleasePinError("package_arguments")
            path = package_export(arguments.package_export, arguments.releases_dir)
            print(f"package=PASS release={path}")
            print(f"export_manifest_sha256={RELEASE_EXPORT_MANIFEST_SHA256}")
            print(f"release_marker_sha256={RELEASE_MARKER_SHA256}")
            print(f"entry_sha256={RELEASE_MAIN_JAVASCRIPT_SHA256}")
            return 0
        if arguments.releases_dir is not None:
            raise ReleasePinError("controller_arguments")
        controller = load_controller()
    except ReleasePinError as error:
        print(f"invitations_static_rollout=FAIL stage={error}", file=sys.stderr)
        return 1
    return controller.main(controller_args)


if __name__ == "__main__":
    raise SystemExit(main())
