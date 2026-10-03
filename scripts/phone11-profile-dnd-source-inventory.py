#!/usr/bin/env python3
"""Emit a bounded, source-only inventory for the Phone11 maintenance gate.

This tool reads committed Git objects only. It does not inspect a host, open a
network connection, read an environment file, or establish deployment safety.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
from typing import Mapping


SCHEMA = "phone11-profile-dnd-source-inventory/v1"
SOURCE_PATHS = (
    "server/_core/index.ts",
    "server/_core/runtime-role.ts",
    "server/push/wake-routes.ts",
    "server/chat/media.ts",
    "server/chat-notifications/dispatcher.ts",
    "server/cloud-recordings/worker.ts",
    "server/cloud-recordings/capture-service.ts",
    "server/pbx/fs-event-listener.ts",
    "server/pbx/freeswitch-routes.ts",
    "server/pbx/kamailio-routes.ts",
    "server/pbx/recording-storage.ts",
)

HTTP_ADMISSION_ROOTS = (
    "/api/trpc",
    "/api/chat/media/upload",
    "/api/phone11/wake",
    "/api/freeswitch/cdr",
    "/api/freeswitch",
    "/api/kamailio",
    "/api/recordings",
)

DEFAULT_WORKERS = (
    "chat_notification_dispatcher",
    "chat_media_retention",
    "recording_analysis",
    "recording_retention",
    "recording_capture",
    "freeswitch_event_listener",
    "websocket_shutdown",
)


class InventoryError(RuntimeError):
    pass


def git(repo: Path, *args: str) -> bytes:
    result = subprocess.run(
        ["git", "-C", str(repo), *args],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    if result.returncode != 0 or len(result.stdout) > 4 * 1024 * 1024:
        raise InventoryError("git_read")
    return result.stdout


def commit(repo: Path, value: str) -> str:
    if not re.fullmatch(r"[0-9a-f]{40}", value):
        raise InventoryError("full_commit_sha_required")
    resolved = git(repo, "rev-parse", "--verify", f"{value}^{{commit}}")
    try:
        actual = resolved.decode("ascii").strip()
    except UnicodeDecodeError as error:
        raise InventoryError("git_read") from error
    if actual != value:
        raise InventoryError("commit_identity")
    return actual


def source(repo: Path, sha: str, path: str) -> bytes:
    return git(repo, "show", f"{sha}:{path}")


def text(files: Mapping[str, bytes], path: str) -> str:
    try:
        return files[path].decode("utf-8")
    except UnicodeDecodeError as error:
        raise InventoryError("source_encoding") from error


def require_once(value: str, needle: str) -> None:
    if value.count(needle) != 1:
        raise InventoryError("source_topology_drift")


def inspect(repo: Path, sha: str) -> tuple[dict[str, str], dict[str, bool]]:
    files = {path: source(repo, sha, path) for path in SOURCE_PATHS}
    index = text(files, "server/_core/index.ts")
    runtime = text(files, "server/_core/runtime-role.ts")
    wake = text(files, "server/push/wake-routes.ts")
    media = text(files, "server/chat/media.ts")
    dispatcher = text(files, "server/chat-notifications/dispatcher.ts")
    recording = text(files, "server/cloud-recordings/worker.ts")
    capture = text(files, "server/cloud-recordings/capture-service.ts")
    freeswitch = text(files, "server/pbx/freeswitch-routes.ts")
    kamailio = text(files, "server/pbx/kamailio-routes.ts")

    for needle in (
        'app.use("/api/chat/media", chatMediaRouter)',
        'app.use("/api/freeswitch/cdr", freeswitchCdrRouter)',
        'app.use("/api/freeswitch", freeswitchRouter)',
        'app.use("/api/kamailio", kamailioRouter)',
        'app.use("/api/recordings", storageRouter)',
        '"/api/trpc"',
        "registerWakeRoutes(app)",
    ):
        require_once(index, needle)
    require_once(wake, 'const base="/api/phone11/wake"')
    for route in ('"claim"', '"ready"', '"status"', '"end"', '${base}/offer', '${base}/terminal'):
        if route not in wake:
            raise InventoryError("source_topology_drift")
    require_once(media, 'router.post("/upload"')
    for route in ('"/directory"', '"/dialplan"', '"/event"'):
        if route not in freeswitch:
            raise InventoryError("source_topology_drift")
    for route in ('"/auth"', '"/register"', '"/route"'):
        if route not in kamailio:
            raise InventoryError("source_topology_drift")

    for needle in (
        "services.startChatNotificationDispatcher()",
        "services.startChatMediaRetention()",
        "services.startRecordingAnalysis()",
        "services.startRecordingRetention()",
        "services.startRecordingCapture()",
        "services.startFreeSwitchEventListener()",
        "services.shutdownWebSockets",
    ):
        require_once(runtime, needle)
    candidate_workerless = (
        'if (!plan.startsBackgroundServices)' in runtime
        and (
            "return stoppedBackground" in runtime
            or "return { start: noop, stop: noop }" in runtime
        )
    )
    if not candidate_workerless:
        raise InventoryError("source_topology_drift")

    http_then_workers = (
        "server.close(error =>" in runtime
        and "const drained = httpClosed.then(stopBackground)" in runtime
    )
    worker_ticks_drained = all(
        marker in value
        for marker, value in (
            ("stopPromise=activeTick", dispatcher.replace(" ", "")),
            ("stopPromise=activeTick", media.replace(" ", "")),
            ("stopPromise = activeTick", recording),
            ("stopPromise=activeTick", capture.replace(" ", "")),
        )
    )

    hashes = {
        path: hashlib.sha256(value).hexdigest()
        for path, value in sorted(files.items())
    }
    return hashes, {
        "candidate_workerless": candidate_workerless,
        "http_admission_closes_before_worker_stop": http_then_workers,
        "worker_ticks_are_awaited": worker_ticks_drained,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True)
    parser.add_argument("--release-sha", required=True)
    parser.add_argument("--baseline-sha", required=True)
    args = parser.parse_args(argv)
    try:
        repo = Path(args.repo).resolve(strict=True)
        release_sha = commit(repo, args.release_sha)
        baseline_sha = commit(repo, args.baseline_sha)
        release_files, release_lifecycle = inspect(repo, release_sha)
        baseline_files, baseline_lifecycle = inspect(repo, baseline_sha)
        document = {
            "schema": SCHEMA,
            "source_only": True,
            "host_admission_ready": False,
            "release": {
                "sha": release_sha,
                "files_sha256": release_files,
                "lifecycle": release_lifecycle,
            },
            "baseline": {
                "sha": baseline_sha,
                "files_sha256": baseline_files,
                "lifecycle": baseline_lifecycle,
            },
            "http_admission_roots": list(HTTP_ADMISSION_ROOTS),
            "default_workers": list(DEFAULT_WORKERS),
            "required_external_controls": [
                "edge_http_mutation_admission",
                "initial_sip_invite_admission",
            ],
        }
        sys.stdout.write(json.dumps(document, sort_keys=True, separators=(",", ":")) + "\n")
        return 0
    except (InventoryError, FileNotFoundError, NotADirectoryError):
        sys.stderr.write("source_inventory=BLOCKED\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
