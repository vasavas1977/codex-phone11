#!/usr/bin/env python3
"""Stage a workerless invitations API candidate on loopback 3014.

This is a narrow, hash-pinned adaptation of phone11-voicemail-api-stage.py.
It never routes traffic, applies migrations, configures secrets, or enables the
invitations capability. All staging/recovery operations remain opt-in phases.
"""
from __future__ import annotations

import hashlib
from pathlib import Path
from types import ModuleType
from typing import Any

UPSTREAM = Path(__file__).with_name("phone11-voicemail-api-stage.py")
UPSTREAM_SHA256 = "71ce816947f8e6c6eb24a8ecf95dd7b5e3837029dd8a355a1b03328996616eb7"


def verify_upstream_pin(path: Path = UPSTREAM, expected: str = UPSTREAM_SHA256) -> bytes:
    try:
        source = path.read_bytes()
    except OSError as error:
        raise RuntimeError("pinned voicemail stage unavailable") from error
    if hashlib.sha256(source).hexdigest() != expected:
        raise RuntimeError("pinned voicemail stage hash mismatch")
    return source


def load_pinned_upstream():
    source = verify_upstream_pin()
    module = ModuleType("pinned_voicemail_stage")
    module.__file__ = str(UPSTREAM)
    exec(compile(source, str(UPSTREAM), "exec"), module.__dict__)
    if hashlib.sha256(UPSTREAM.read_bytes()).hexdigest() != UPSTREAM_SHA256:
        raise RuntimeError("pinned voicemail stage changed while loading")
    return module


stage = load_pinned_upstream()

# Unique operator-owned resources. The predecessor is the existing 3013
# voicemail candidate; only its inherited runtime is cloned.
stage.SCHEMA = "phone11-invitations-api-stage/v1"
stage.NAME = "cp11-api-candidate-invitations"
stage.PREDECESSOR = "cp11-api-candidate-voicemail"
stage.PORT = 3014
stage.OLD_PORT = 3013
stage.STATE = Path("/var/lib/phone11-invitations-api-stage")
stage.LOCK = Path("/run/phone11-invitations-api-stage.lock")
stage.PROJECT = "phone11-invitations-api-stage"
stage.SERVICE = "invitations_api"

_original_healthcheck = stage.healthcheck
_original_compose = stage.compose
_original_run = stage.run
_original_labels = stage.labels
_original_candidate_ok = stage.candidate_ok
_original_cleanup_owned = stage.cleanup_owned


def invitations_healthcheck(old: dict[str, Any], build: str) -> dict[str, Any]:
    result = _original_healthcheck(old, build)
    test = result.get("test")
    stage.need(isinstance(test, list) and len(test) == 4 and isinstance(test[3], str),
               "healthcheck_shape")
    old_url = "http://127.0.0.1:3013/api/health"
    new_url = f"http://127.0.0.1:{stage.PORT}/api/health"
    stage.need(test[3].count(old_url) == 1, "healthcheck_pin")
    test[3] = test[3].replace(old_url, new_url)
    stage.need(old_url not in test[3] and new_url in test[3], "healthcheck_pin")
    return result


def invitations_compose(old: dict[str, Any], image: str, manifest_sha: str,
                        build: str) -> tuple[bytes, bytes, dict[str, str]]:
    data, _env_file, expected_env = _original_compose(old, image, manifest_sha, build)
    model = stage.document(data, "compose_model")
    expected_env["PHONE11_INVITATIONS_ENABLED"] = "false"
    env_file = "".join(key + "=" + value + "\n"
                        for key, value in sorted(expected_env.items())).encode()
    service = model["services"][stage.SERVICE]
    service["labels"] = {
        "com.phone11.invitations-stage.manifest-sha256": manifest_sha,
        "com.phone11.invitations-stage.owner": stage.SCHEMA,
    }
    return stage.canonical(model), env_file, expected_env


def invitations_run(args: list[str], *, input_data: bytes | None = None,
                    timeout: int = 30) -> bytes:
    command = list(args)
    prefix = "phone11-voicemail-stage:"
    new_prefix = "phone11-invitations-stage:"
    if command[:2] == ["docker", "build"]:
        try:
            tag_index = command.index("-t") + 1
            tag = command[tag_index]
        except (ValueError, IndexError) as error:
            raise stage.Refused("image_tag") from error
        stage.need(tag.startswith(prefix), "image_tag")
        command[tag_index] = new_prefix + tag[len(prefix):]
    elif command[:3] == ["docker", "image", "inspect"] and len(command) == 4:
        tag = command[3]
        if tag.startswith(prefix):
            command[3] = new_prefix + tag[len(prefix):]
    return _original_run(command, input_data=input_data, timeout=timeout)


def invitations_labels(info: dict[str, Any]) -> dict[str, str]:
    result = _original_labels(info)
    if result.get("com.phone11.invitations-stage.owner") == stage.SCHEMA:
        # The pinned upstream checker understands only its own key names. Map
        # the unique invitation labels in-memory for validation; container labels
        # and cleanup ownership remain invitations-specific on disk.
        result = dict(result)
        result["com.phone11.voicemail-stage.owner"] = stage.SCHEMA
        result["com.phone11.voicemail-stage.manifest-sha256"] = result.get(
            "com.phone11.invitations-stage.manifest-sha256", "")
    return result


def invitations_candidate_ok(m: dict[str, Any], manifest_sha: str, image: str,
                             old: dict[str, Any], expected_env: dict[str, str]) -> bool:
    if not _original_candidate_ok(m, manifest_sha, image, old, expected_env):
        return False
    info = stage.inspect(stage.NAME)
    stage.need(info is not None and
               stage.labels(info).get("com.phone11.invitations-stage.owner") == stage.SCHEMA and
               stage.labels(info).get("com.phone11.invitations-stage.manifest-sha256") == manifest_sha,
               "candidate_owner")
    stage.need(stage.env_map(info).get("PHONE11_INVITATIONS_ENABLED") == "false",
               "candidate_invitation_flag")
    return True


def invitations_cleanup_owned(manifest_sha: str, image: str) -> None:
    """Remove only a container with actual invitation-stage ownership labels."""
    info = stage.inspect(stage.NAME)
    if info is None:
        return
    actual = _original_labels(info)
    stage.need(info.get("Name") == "/" + stage.NAME and info.get("Image") == image and
               actual.get("com.phone11.invitations-stage.owner") == stage.SCHEMA and
               actual.get("com.phone11.invitations-stage.manifest-sha256") == manifest_sha and
               actual.get("com.docker.compose.project") == stage.PROJECT and
               actual.get("com.docker.compose.service") == stage.SERVICE and
               isinstance(info.get("Id"), str), "cleanup_identity")
    stage.run(["docker", "rm", "-f", info["Id"]], timeout=30)


stage.healthcheck = invitations_healthcheck
stage.compose = invitations_compose
stage.run = invitations_run
stage.labels = invitations_labels
stage.candidate_ok = invitations_candidate_ok
stage.cleanup_owned = invitations_cleanup_owned

# Re-export stable public operations for focused tests and operator introspection.
Refused = stage.Refused
manifest = stage.manifest
clean_source = stage.clean_source
check_old = stage.check_old
healthcheck = invitations_healthcheck
compose = invitations_compose
candidate_ok = invitations_candidate_ok
cleanup_owned = invitations_cleanup_owned
main = stage.main


if __name__ == "__main__":
    try:
        main()
    except Refused as error:
        import sys
        print("BLOCKED stage=" + str(error), file=sys.stderr)
        raise SystemExit(2)
