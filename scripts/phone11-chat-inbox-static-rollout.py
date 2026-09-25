#!/usr/bin/env python3
"""Release-specific entry point for the Phone11 Team Chat inbox web export.

Keep the historical static-portal operator immutable.  This entry point loads
that reviewed operator only when its bytes match the pin below, then replaces
its *candidate* pins with the sealed chat-inbox export.  The underlying
operator still validates the complete export, the live predecessor and its
receipt, and the exact rollback state before changing the ``current`` link.

The hashes below are from a clean export of the named committed source.
"""

from __future__ import annotations

import hashlib
import os
import re
import stat
import sys
from pathlib import Path
from types import ModuleType
from typing import Sequence


CONTROLLER_NAME = "phone11-static-portal-rollout.py"
CONTROLLER_SHA256 = "b275e75d48f39e671c19ea9b5969c10d580b243a58c701b5fba05120a6e051b5"

# Keep the predecessor pin alongside the candidate to make release intent
# reviewable.  The controller independently validates its sealed receipt.
RELEASE_SHA = "8b567c74c0c88d2d6ef285e9b0977ea797fc8ba1"
LIVE_RELEASE_SHA = "47d48a697921fc20f7b638f6b00447072b9fe7b7"
RELEASE_EXPORT_MANIFEST_SHA256 = "4003ee267e152b5b977b8779f4754df1f047cb667ce2460a8478775b30be3511"
RELEASE_MARKER_SHA256 = "7be682f3f97d28808ea7d8e458b89a19d8d973597d06686717434140838ee7c3"
RELEASE_MAIN_JAVASCRIPT = "_expo/static/js/web/entry-871141f21bd5b03c167420d44523226e.js"
RELEASE_MAIN_JAVASCRIPT_SHA256 = "9c5cc377551f7b420e1376498d4832d3da59b53f3a0c36bfbd6e744310d8f5f4"

MAX_CONTROLLER_BYTES = 256 * 1024


class ReleasePinError(RuntimeError):
    pass


def _require_sha(value: str, length: int, name: str) -> None:
    if not re.fullmatch(rf"[0-9a-f]{{{length}}}", value):
        raise ReleasePinError(f"unsealed_{name}")


def validate_pins() -> None:
    _require_sha(CONTROLLER_SHA256, 64, "controller")
    _require_sha(RELEASE_SHA, 40, "source")
    _require_sha(LIVE_RELEASE_SHA, 40, "predecessor")
    _require_sha(RELEASE_EXPORT_MANIFEST_SHA256, 64, "manifest")
    _require_sha(RELEASE_MARKER_SHA256, 64, "marker")
    _require_sha(RELEASE_MAIN_JAVASCRIPT_SHA256, 64, "entry")
    if not re.fullmatch(r"_expo/static/js/web/entry-[0-9a-f]+\.js", RELEASE_MAIN_JAVASCRIPT):
        raise ReleasePinError("unsealed_entry_path")
    if RELEASE_SHA == LIVE_RELEASE_SHA:
        raise ReleasePinError("candidate_equals_predecessor")


def _read_controller(path: Path) -> bytes:
    """Read one regular controller without following a replaced symlink."""
    try:
        before = path.lstat()
        if not stat.S_ISREG(before.st_mode) or before.st_size > MAX_CONTROLLER_BYTES:
            raise ReleasePinError("controller_file")
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        try:
            opened = os.fstat(descriptor)
            if (opened.st_dev, opened.st_ino, opened.st_size) != (
                before.st_dev,
                before.st_ino,
                before.st_size,
            ):
                raise ReleasePinError("controller_changed")
            contents = os.read(descriptor, MAX_CONTROLLER_BYTES + 1)
            if len(contents) != opened.st_size or len(contents) > MAX_CONTROLLER_BYTES:
                raise ReleasePinError("controller_size")
            if hashlib.sha256(contents).hexdigest() != CONTROLLER_SHA256:
                raise ReleasePinError("controller_hash")
            return contents
        finally:
            os.close(descriptor)
    except OSError as error:
        raise ReleasePinError("controller_file") from error


def load_controller(path: Path | None = None) -> ModuleType:
    validate_pins()
    controller_path = path or Path(__file__).with_name(CONTROLLER_NAME)
    source = _read_controller(controller_path)
    # Compile verified bytes instead of opening the path a second time after
    # verification.  The code never executes a changed inode or symlink target.
    module = ModuleType("phone11_sealed_static_portal")
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

    # The original controller validates a managed predecessor by its sealed
    # receipt, but historically permits any such release.  This specific
    # rollout also pins the currently observed live generation, including the
    # restoration path if activation must roll back.
    def require_predecessor(release: object, stage: str) -> object:
        if getattr(release, "source_sha", None) != LIVE_RELEASE_SHA:
            raise module.RolloutError(stage)
        return release

    original_validate_predecessor = module.validate_managed_predecessor
    original_receipt_predecessor = module.receipt_predecessor_release

    def pinned_validate_predecessor(manifest: object, site: bytes) -> object:
        return require_predecessor(original_validate_predecessor(manifest, site), "managed_state")

    def pinned_receipt_predecessor(manifest: object, receipt: dict[str, object]) -> object:
        return require_predecessor(original_receipt_predecessor(manifest, receipt), "rollback")

    module.validate_managed_predecessor = pinned_validate_predecessor
    module.receipt_predecessor_release = pinned_receipt_predecessor
    module.require_predecessor_pin = require_predecessor
    return module


def main(argv: Sequence[str] | None = None) -> int:
    try:
        controller = load_controller()
    except ReleasePinError as error:
        print(f"chat_inbox_static_rollout=FAIL stage={error}", file=sys.stderr)
        return 1
    return controller.main(argv)


if __name__ == "__main__":
    raise SystemExit(main())
