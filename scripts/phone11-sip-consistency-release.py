#!/usr/bin/env python3
"""Guarded Phone11 SIP-admin API release from invited-users 3015 to 3016.

Stage a bundle-only overlay without changing the active container. Activation
changes exactly the two public tRPC Nginx locations. Rollback restores those
locations to the healthy, invitation-enabled 3015 API. No SQL or SIP credential
mutation is performed by this operator.
"""
from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from types import ModuleType
from typing import Any


ROOT = Path(__file__).resolve().parent
STAGE_PATH = ROOT / "phone11-voicemail-api-stage.py"
STAGE_SHA256 = "71ce816947f8e6c6eb24a8ecf95dd7b5e3837029dd8a355a1b03328996616eb7"
ROUTE_PATH = ROOT / "phone11-invitations-activate.py"
ROUTE_SHA256 = "b85d8b61ad72e558d635661e857254338417a388e56cf489fa23c85e55d769ed"

SCHEMA = "phone11-sip-consistency-release/v1"
NAME = "cp11-api-candidate-sip-consistency"
PREDECESSOR = "cp11-api-candidate-invitations-enabled"
PROJECT = "phone11-sip-consistency-release-20260927"
SERVICE = "sip_consistency_api"
PORT = 3016
OLD_PORT = 3015
STATE = Path("/var/lib/phone11-sip-consistency-release-20260927")
LOCK = Path("/run/phone11-sip-consistency-release.lock")
SOURCE_SHA = "6180658cfcef558a7f198bcd53aa4da68e3d7cd1"
BUILD = "sip-admin-6180658"
EXPECTED_BUNDLE_SHA256 = "d489be90000d3cdc1c40088c6efb5048d65d44db6a3084ffebb9461ac87f682c"
OLD_SOURCE_SHA = "b3ed0e71e1683cd3eca503bee902a221b2c3e3ca"
OLD_CONTAINER_ID = "2d3627f9dc6354ce34f69d9c7dad31493cd04441cb44e5ae86d8f76ea52d28d6"
OLD_IMAGE = "sha256:0942f8a6dd17f2919e6631adbc55318e2e8693ff9f869f90fa26d8327950b47d"
OLD_BUNDLE_SHA256 = "f06dcd6044a4a8b50ec35571834d7f82170efdd1d86b7559a2e3315fddd416a2"
LOCK_SHA256 = "24a72aa60f0b43fe3afdad41f2e0f0f348f75ac065172627913fe72d43f2c801"
OLD_BUILD = "invitations-on-b3ed0e7"
OLD_IMAGE_BUILD = "invitations-off-b3ed0e7"
SITE_SHA256 = "29c7be9fc516e3bb495400f1deb2619ff57b3b913d96b40cfb19e2e63b97f6b0"
OWNER_LABEL = "com.phone11.sip-consistency-release.owner"
MANIFEST_LABEL = "com.phone11.sip-consistency-release.manifest-sha256"


class Refused(Exception):
    pass


def need(ok: bool, reason: str) -> None:
    if not ok:
        raise Refused(reason)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def pinned_module(path: Path, expected: str, name: str) -> ModuleType:
    raw = path.read_bytes()
    need(sha(raw) == expected, "dependency_pin")
    module = ModuleType(name)
    module.__file__ = str(path)
    exec(compile(raw, str(path), "exec"), module.__dict__)
    need(sha(path.read_bytes()) == expected, "dependency_race")
    return module


stage = pinned_module(STAGE_PATH, STAGE_SHA256, "sip_release_stage")
route = pinned_module(ROUTE_PATH, ROUTE_SHA256, "sip_release_route")
stage.SCHEMA, stage.NAME, stage.PREDECESSOR = SCHEMA, NAME, PREDECESSOR
stage.PORT, stage.OLD_PORT = PORT, OLD_PORT
stage.STATE, stage.LOCK = STATE, LOCK
stage.PROJECT, stage.SERVICE = PROJECT, SERVICE

_original_manifest = stage.manifest
_original_check_old = stage.check_old
_original_healthcheck = stage.healthcheck
_original_compose = stage.compose
_original_labels = stage.labels
_original_candidate_ok = stage.candidate_ok


def manifest(path: Path) -> tuple[dict[str, Any], str]:
    data, digest = _original_manifest(path)
    old, new = data["predecessor"], data["release"]
    need(old == {"container_id": OLD_CONTAINER_ID, "image": OLD_IMAGE,
                 "source_sha": OLD_SOURCE_SHA, "bundle_sha256": OLD_BUNDLE_SHA256,
                 "lock_sha256": LOCK_SHA256, "build": OLD_BUILD}, "predecessor_pin")
    need(new["source_sha"] == SOURCE_SHA
         and new["bundle_sha256"] == EXPECTED_BUNDLE_SHA256
         and new["lock_sha256"] == LOCK_SHA256
         and new["build"] == BUILD,
         "release_pin")
    return data, digest


def health(port: int, build: str) -> None:
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    try:
        conn.request("GET", "/api/health")
        response = conn.getresponse()
        body = response.read(16_385)
        need(response.status == 200 and len(body) <= 16_384, "api_health")
        data = json.loads(body)
        need(data.get("ok") is True and data.get("runtimeRole") == "api-candidate"
             and data.get("build") == build, "api_health")
    finally:
        conn.close()


def check_old(data: dict[str, Any]) -> dict[str, Any]:
    # 3015 reused the reviewed 3014 image and enabled invitations only through
    # runtime environment. The immutable image label therefore records the
    # earlier image build while the live environment and health record 3015.
    image_pin = {**data, "predecessor": {**data["predecessor"],
                                         "build": OLD_IMAGE_BUILD}}
    old = _original_check_old(image_pin)
    need(stage.labels(old).get("com.phone11.candidate-build") == OLD_IMAGE_BUILD,
         "predecessor_image_build")
    env = stage.env_map(old)
    need(env.get("PHONE11_INVITATIONS_ENABLED") == "true"
         and env.get("PHONE11_INVITATIONS_PROVIDER") == "resend"
         and env.get("PHONE11_INVITATIONS_RESEND_API_KEY", "").startswith("re_")
         and env.get("PHONE11_INVITATIONS_FROM") == "Phone11 <noreply@phone11.ai>"
         and env.get("PHONE11_RUNTIME_ROLE") == "api-candidate"
         and env.get("PHONE11_VOICEMAIL_HOOK_READY", "false") == "false"
         and env.get("PHONE11_BUILD_SHA") == OLD_BUILD, "predecessor_capability")
    health(OLD_PORT, OLD_BUILD)
    return old


def healthcheck(old: dict[str, Any], build: str) -> dict[str, Any]:
    result = _original_healthcheck(old, build)
    test = result.get("test")
    need(isinstance(test, list) and len(test) == 4 and isinstance(test[3], str),
         "healthcheck_shape")
    prior = "http://127.0.0.1:3013/api/health"
    target = f"http://127.0.0.1:{PORT}/api/health"
    need(test[3].count(prior) == 1, "healthcheck_pin")
    test[3] = test[3].replace(prior, target)
    return result


def compose(old: dict[str, Any], image: str, digest: str,
            build: str) -> tuple[bytes, bytes, dict[str, str]]:
    raw, _env, expected = _original_compose(old, image, digest, build)
    old_env = stage.env_map(old)
    unchanged = dict(old_env)
    unchanged.update({"PORT": str(PORT), "PHONE11_BUILD_SHA": build})
    need(expected == unchanged, "environment_drift")
    model = stage.document(raw, "compose_shape")
    model["services"][SERVICE]["labels"] = {OWNER_LABEL: SCHEMA,
                                               MANIFEST_LABEL: digest}
    env_bytes = "".join(k + "=" + v + "\n" for k, v in sorted(expected.items())).encode()
    need(len(env_bytes) <= 64 * 1024, "environment_size")
    return stage.canonical(model), env_bytes, expected


def labels(info: dict[str, Any]) -> dict[str, str]:
    result = _original_labels(info)
    if result.get(OWNER_LABEL) == SCHEMA:
        result = dict(result)
        result["com.phone11.voicemail-stage.owner"] = SCHEMA
        result["com.phone11.voicemail-stage.manifest-sha256"] = result.get(MANIFEST_LABEL, "")
    return result


def candidate_ok(data: dict[str, Any], digest: str, image: str,
                 old: dict[str, Any], expected: dict[str, str]) -> bool:
    if not _original_candidate_ok(data, digest, image, old, expected):
        return False
    info = stage.inspect(NAME)
    need(info is not None and _original_labels(info).get(OWNER_LABEL) == SCHEMA
         and _original_labels(info).get(MANIFEST_LABEL) == digest,
         "candidate_owner")
    need(expected.get("PHONE11_INVITATIONS_ENABLED") == "true", "candidate_invitations")
    return True


def cleanup_owned(digest: str, image: str) -> None:
    info = stage.inspect(NAME)
    if info is None:
        return
    lab = _original_labels(info)
    need(info.get("Name") == "/" + NAME and info.get("Image") == image
         and lab.get(OWNER_LABEL) == SCHEMA and lab.get(MANIFEST_LABEL) == digest
         and lab.get("com.docker.compose.project") == PROJECT
         and lab.get("com.docker.compose.service") == SERVICE,
         "cleanup_identity")
    stage.run(["docker", "rm", "-f", info["Id"]], timeout=30)


stage.manifest = manifest
stage.check_old = check_old
stage.healthcheck = healthcheck
stage.compose = compose
stage.labels = labels
stage.candidate_ok = candidate_ok
stage.cleanup_owned = cleanup_owned


def private_state() -> None:
    route.secure_directory(STATE.parent)
    route.secure_directory(STATE, private=True)


def same_compose_with_mount_order_ignored(expected: bytes, stored: bytes) -> bool:
    """Docker inspect may enumerate identical bind mounts in a different order."""
    models = [stage.document(raw, "stage_files") for raw in (expected, stored)]
    for model in models:
        try:
            mounts = model["services"][SERVICE]["volumes"]
        except (KeyError, TypeError) as error:
            raise Refused("stage_files") from error
        need(isinstance(mounts, list) and 0 < len(mounts) <= 32 and
             all(isinstance(mount, dict) and isinstance(mount.get("source"), str) and
                 isinstance(mount.get("target"), str) and
                 type(mount.get("read_only")) is bool for mount in mounts),
             "stage_files")
        encoded = [stage.canonical(mount) for mount in mounts]
        need(len(set(encoded)) == len(encoded) and
             len({mount["target"] for mount in mounts}) == len(mounts),
             "stage_files")
        model["services"][SERVICE]["volumes"] = sorted(mounts, key=stage.canonical)
    return stage.canonical(models[0]) == stage.canonical(models[1])


def staged(path: Path) -> tuple[dict[str, Any], str, dict[str, Any], str]:
    data, digest = manifest(path)
    stage.clean_source(data)
    stage.bundle(data)
    old = check_old(data)
    private_state()
    image_record = stage.document(stage.private_read(STATE / "image.json"), "image_receipt")
    need(image_record.get("schema") == SCHEMA
         and image_record.get("manifest_sha256") == digest, "image_receipt")
    image = image_record.get("image")
    stage.check_image(data, image)
    config, env_bytes, expected = compose(old, image, digest, data["release"]["build"])
    need(same_compose_with_mount_order_ignored(
            config, stage.private_read(STATE / "compose.json"))
         and stage.private_read(STATE / "runtime.env") == env_bytes,
         "stage_files")
    need(candidate_ok(data, digest, image, old, expected), "candidate_health")
    health(PORT, data["release"]["build"])
    return data, digest, old, image


def route_bytes() -> tuple[bytes, bytes]:
    route.secure_directory(route.SITE.parent)
    original, _ = route.read_file(route.SITE)
    need(sha(original) == SITE_SHA256, "site_pin")
    promoted = route.rewrite_trpc(original, OLD_PORT, PORT)
    need(route.rewrite_trpc(promoted, PORT, OLD_PORT) == original, "site_roundtrip")
    return original, promoted


def receipt(data: dict[str, Any], digest: str, image: str,
            original: bytes, promoted: bytes) -> dict[str, Any]:
    info = stage.inspect(NAME)
    need(info is not None, "candidate_missing")
    return {"schema": SCHEMA, "manifest_sha256": digest,
            "source_sha": data["release"]["source_sha"],
            "candidate_id": info["Id"], "candidate_image": image,
            "before_sha256": sha(original), "after_sha256": sha(promoted),
            "state": "prepared"}


def receipt_file() -> Path:
    return STATE / "route-receipt.json"


def save_receipt(value: dict[str, Any]) -> None:
    raw = stage.canonical(value)
    path = receipt_file()
    temp = STATE / (".route-receipt-" + os.urandom(8).hex())
    stage.create_once(temp, raw)
    os.replace(temp, path)
    directory = os.open(STATE, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def pinned_receipt(data: dict[str, Any], digest: str) -> tuple[dict[str, Any], bytes, bytes]:
    private_state()
    record = stage.document(stage.private_read(receipt_file()), "route_receipt")
    original = stage.private_read(STATE / "nginx.before")
    promoted = route.rewrite_trpc(original, OLD_PORT, PORT)
    candidate_id = record.get("candidate_id")
    candidate_image = record.get("candidate_image")
    need(sha(original) == SITE_SHA256
         and route.rewrite_trpc(promoted, PORT, OLD_PORT) == original
         and isinstance(candidate_id, str) and re.fullmatch(r"[0-9a-f]{64}", candidate_id) is not None
         and isinstance(candidate_image, str) and re.fullmatch(r"sha256:[0-9a-f]{64}", candidate_image) is not None
         and record == {"schema": SCHEMA, "manifest_sha256": digest,
                        "source_sha": data["release"]["source_sha"],
                        "candidate_id": candidate_id, "candidate_image": candidate_image,
                        "before_sha256": sha(original), "after_sha256": sha(promoted),
                        "state": record.get("state")}
         and record["state"] in {"prepared", "active", "rolled_back"},
         "route_receipt")
    return record, original, promoted


def change_route(before: bytes, after: bytes) -> None:
    route.secure_directory(route.SITE.parent)
    current, info = route.read_file(route.SITE)
    need(current in (before, after), "site_drift")
    if current == before:
        route.replace_site(after, info)
    try:
        route.command(["/usr/sbin/nginx", "-t"])
    except Exception:
        if current == before and route.read_file(route.SITE)[0] == after:
            route.replace_site(before, info)
        raise
    route.command(["/usr/bin/systemctl", "reload", "nginx"])
    need(route.read_file(route.SITE)[0] == after, "site_drift")


def activate(path: Path) -> None:
    with route.locked():
        lock_fd = stage.locked()
        try:
            data, digest, _old, image = staged(path)
            route.secure_directory(route.SITE.parent)
            current, _ = route.read_file(route.SITE)
            need(sha(current) == SITE_SHA256 or receipt_file().exists(), "site_drift")
            if receipt_file().exists():
                record, original, promoted = pinned_receipt(data, digest)
                candidate = stage.inspect(NAME)
                need(candidate is not None and candidate.get("Id") == record["candidate_id"]
                     and candidate.get("Image") == record["candidate_image"] == image,
                     "candidate_drift")
                need(current in (original, promoted), "site_drift")
            else:
                original, promoted = route_bytes()
                record = receipt(data, digest, image, original, promoted)
                stage.create_once(STATE / "nginx.before", original)
                save_receipt(record)
            change_route(original, promoted)
            record["state"] = "active"
            save_receipt(record)
            print(json.dumps({"state": "active", "site_sha256": sha(promoted)}, sort_keys=True))
        finally:
            os.close(lock_fd)


def rollback(path: Path) -> None:
    with route.locked():
        lock_fd = stage.locked()
        try:
            data, digest = manifest(path)
            check_old(data)
            record, original, promoted = pinned_receipt(data, digest)
            route.secure_directory(route.SITE.parent)
            need(route.read_file(route.SITE)[0] in (original, promoted), "site_drift")
            # Recheck the invitation-enabled fallback immediately before reload.
            check_old(data)
            change_route(promoted, original)
            record["state"] = "rolled_back"
            save_receipt(record)
            print(json.dumps({"state": "rolled_back", "site_sha256": SITE_SHA256}, sort_keys=True))
        finally:
            os.close(lock_fd)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=("prepare", "build", "start", "recover",
                                          "activate", "rollback"))
    parser.add_argument("--manifest", required=True, type=Path)
    args = parser.parse_args()
    try:
        need(os.geteuid() == 0, "root")
        if args.phase in {"prepare", "build", "start", "recover"}:
            original, _promoted = route_bytes()
            need(sha(original) == SITE_SHA256, "site_pin")
            prior = sys.argv
            try:
                sys.argv = [prior[0], args.phase, "--manifest", str(args.manifest)]
                stage.main()
            finally:
                sys.argv = prior
        elif args.phase == "activate":
            activate(args.manifest)
        else:
            rollback(args.manifest)
        return 0
    except (Refused, stage.Refused, route.Refused, OSError, ValueError, KeyError,
            TypeError, json.JSONDecodeError, subprocess.TimeoutExpired) as error:
        reason = str(error) if isinstance(error, (Refused, stage.Refused, route.Refused)) else type(error).__name__
        print(json.dumps({"state": "blocked", "stage": reason}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
