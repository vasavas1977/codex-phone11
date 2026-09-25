#!/usr/bin/env python3
"""Build and audit a one-file meeting-title image from the pinned live image.

Run on the VoIP host after staging the reviewed bundle. This does not start a
container or change the live route. It prints only the resulting image ID.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile
import uuid


PARENT_IMAGE = "sha256:d23a97bd859bb2788802fe50debc0d5551a1125d3b879d62277016f41fa0bd22"
PARENT_BUNDLE = "97770ec21c24ec80f235545ffd66371eb9dd8fd756444578a6af09a5640c2d3b"
SOURCE_SHA = "d67be349fbedbda0d4d441c3e0d958ae1481611a"
BUNDLE_SHA = "870fdad722679a67575a57c27fee5131c2128aa75d97d201064588c76cb0292e"
BUILD = "meeting-title-20260925"
SOURCE_CONTAINER = "cp11-api-candidate-meetings"
IMAGE_ID_RE = re.compile(r"sha256:[0-9a-f]{64}\Z")
PROVENANCE = {
    "com.phone11.archive-sha256": "",
    "com.phone11.base-source-sha": "",
    "com.phone11.source-sha": SOURCE_SHA,
    "com.phone11.bundle-sha256": BUNDLE_SHA,
    "com.phone11.candidate-build": BUILD,
    "com.phone11.overlay-parent-image-id": PARENT_IMAGE,
    "com.phone11.overlay-kind": "bundle-only",
}
INHERITED_FIELDS = (
    "User", "Entrypoint", "Cmd", "WorkingDir", "Env", "ExposedPorts",
    "Volumes", "StopSignal", "Shell", "OnBuild",
)


def run(*args: str, env: dict[str, str] | None = None) -> str:
    result = subprocess.run(args, capture_output=True, text=True, check=False, env=env)
    if result.returncode:
        # Docker output may contain image or environment details. Keep it private.
        raise RuntimeError(f"{args[0]} {args[1]} failed with exit {result.returncode}")
    return result.stdout.strip()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def inspect_image(reference: str) -> dict:
    records = json.loads(run("docker", "image", "inspect", reference))
    if not isinstance(records, list) or len(records) != 1 or not isinstance(records[0], dict):
        raise RuntimeError("ambiguous image inspection")
    return records[0]


def inspect_container(reference: str) -> dict:
    records = json.loads(run("docker", "container", "inspect", reference))
    if not isinstance(records, list) or len(records) != 1 or not isinstance(records[0], dict):
        raise RuntimeError("ambiguous container inspection")
    return records[0]


def check_parent(image: dict, container: dict) -> None:
    if image.get("Id") != PARENT_IMAGE or container.get("Image") != PARENT_IMAGE:
        raise RuntimeError("active parent image changed")
    if container.get("State", {}).get("Status") != "running":
        raise RuntimeError("active parent container is not running")
    if image.get("Os") != "linux" or image.get("Architecture") != "amd64":
        raise RuntimeError("active parent platform changed")
    image_config = image.get("Config") or {}
    runtime_config = container.get("Config") or {}
    if image_config.get("User") != "cloudphone" or runtime_config.get("User") != "cloudphone":
        raise RuntimeError("active parent user changed")
    if runtime_config.get("Image") is None:
        raise RuntimeError("active parent container config is incomplete")
    labels = image_config.get("Labels") or {}
    if labels.get("com.phone11.bundle-sha256") != PARENT_BUNDLE:
        raise RuntimeError("active parent bundle label changed")
    live_hash = run("docker", "exec", SOURCE_CONTAINER, "sha256sum", "/app/dist/index.mjs")
    if live_hash.split()[0] != PARENT_BUNDLE:
        raise RuntimeError("active parent bundle changed")


def dockerfile(parent_tag: str) -> str:
    if not re.fullmatch(r"phone11-meeting-title-parent:[0-9a-f]{32}", parent_tag):
        raise ValueError("invalid temporary parent tag")
    labels = " \\\n    ".join(f'{key}="{value}"' for key, value in PROVENANCE.items())
    return (
        f"FROM --platform=linux/amd64 {parent_tag}\n"
        "COPY --chown=1001:1001 index.mjs /app/dist/index.mjs\n"
        f"LABEL {labels}\n"
        # The 3009 start operator supplies its own health check; do not retain
        # the parent's 3000/3008 health probe in the candidate image.
        "HEALTHCHECK NONE\n"
    )


def check_image(parent: dict, candidate: dict) -> None:
    if not IMAGE_ID_RE.fullmatch(str(candidate.get("Id", ""))):
        raise RuntimeError("candidate image ID is invalid")
    if candidate["Id"] == PARENT_IMAGE or candidate.get("Os") != "linux" or candidate.get("Architecture") != "amd64":
        raise RuntimeError("candidate image identity or platform is invalid")
    parent_config, candidate_config = parent["Config"], candidate["Config"]
    for field in INHERITED_FIELDS:
        if parent_config.get(field) != candidate_config.get(field):
            raise RuntimeError(f"candidate inherited runtime field changed: {field}")
    labels = candidate_config.get("Labels") or {}
    parent_labels = parent_config.get("Labels") or {}
    if labels != {**parent_labels, **PROVENANCE}:
        raise RuntimeError("candidate provenance labels changed")
    if (candidate_config.get("Healthcheck") or {}).get("Test") != ["NONE"]:
        raise RuntimeError("candidate inherited healthcheck was not disabled")
    parent_layers = parent.get("RootFS", {}).get("Layers") or []
    candidate_layers = candidate.get("RootFS", {}).get("Layers") or []
    if not parent_layers or candidate_layers[:-1] != parent_layers or len(candidate_layers) != len(parent_layers) + 1:
        raise RuntimeError("candidate layers do not extend the exact parent by one layer")


def check_history(parent_id: str, candidate_id: str) -> None:
    def entries(image_id: str) -> list[tuple[str, str]]:
        raw = run("docker", "image", "history", "--no-trunc", "--format", "{{json .}}", image_id)
        result = []
        for line in raw.splitlines():
            item = json.loads(line)
            result.append((item["CreatedBy"], item["Size"]))
        if not result:
            raise RuntimeError("Docker image history is empty")
        return result

    before, after = entries(parent_id), entries(candidate_id)
    if len(after) <= len(before) or after[-len(before):] != before:
        raise RuntimeError("candidate history does not extend the exact parent")


def check_added_layer(saved_image: Path, expected_layer: str) -> None:
    """Read Docker-save metadata and only the last layer; extract no files."""
    with tarfile.open(saved_image, "r:") as outer:
        manifest_file = outer.extractfile("manifest.json")
        if manifest_file is None:
            raise RuntimeError("candidate image manifest missing")
        manifest = json.load(manifest_file)
        if not isinstance(manifest, list) or len(manifest) != 1:
            raise RuntimeError("candidate image manifest is ambiguous")
        layers = manifest[0].get("Layers")
        if not isinstance(layers, list) or not layers:
            raise RuntimeError("candidate image layers missing")
        added = outer.extractfile(layers[-1])
        if added is None:
            raise RuntimeError("candidate added layer missing")
        layer_bytes = added.read(8_000_001)
        if len(layer_bytes) > 8_000_000:
            raise RuntimeError("candidate added layer is unexpectedly large")
        if "sha256:" + hashlib.sha256(layer_bytes).hexdigest() != expected_layer:
            raise RuntimeError("candidate saved layer does not match image RootFS")
        files = []
        with tarfile.open(fileobj=io.BytesIO(layer_bytes), mode="r:*") as layer:
            for entry in layer:
                path = entry.name.removeprefix("./").rstrip("/")
                if entry.isdir():
                    if path not in {"app", "app/dist"}:
                        raise RuntimeError("candidate layer has an unexpected directory")
                    continue
                if not entry.isfile() or path != "app/dist/index.mjs":
                    raise RuntimeError("candidate layer contains an unexpected entry")
                if entry.uid != 1001 or entry.gid != 1001 or entry.mode & 0o777 != 0o644:
                    raise RuntimeError("candidate bundle ownership or mode changed")
                content = layer.extractfile(entry)
                if content is None:
                    raise RuntimeError("candidate layer bundle missing")
                digest = hashlib.sha256()
                for chunk in iter(lambda: content.read(1 << 20), b""):
                    digest.update(chunk)
                files.append(digest.hexdigest())
        if files != [BUNDLE_SHA]:
            raise RuntimeError("candidate layer bundle hash or file count changed")


def build(bundle_path: Path) -> str:
    if sha256_file(bundle_path) != BUNDLE_SHA:
        raise RuntimeError("candidate bundle does not match the reviewed SHA-256")
    parent = inspect_image(PARENT_IMAGE)
    check_parent(parent, inspect_container(SOURCE_CONTAINER))
    temporary_tag = f"phone11-meeting-title-parent:{uuid.uuid4().hex}"
    context_dir = Path(tempfile.mkdtemp(prefix="phone11-meeting-title-build-"))
    os.chmod(context_dir, 0o700)
    tagged = False
    try:
        staged = context_dir / "index.mjs"
        shutil.copyfile(bundle_path, staged)
        os.chmod(staged, 0o644)
        if sha256_file(staged) != BUNDLE_SHA:
            raise RuntimeError("staged candidate bundle changed")
        dockerfile_path = context_dir / "Dockerfile"
        dockerfile_path.write_text(dockerfile(temporary_tag), encoding="utf-8")
        os.chmod(dockerfile_path, 0o600)
        run("docker", "tag", PARENT_IMAGE, temporary_tag)
        tagged = True
        if inspect_image(temporary_tag)["Id"] != PARENT_IMAGE:
            raise RuntimeError("temporary parent tag points at another image")
        iidfile = context_dir / "image-id"
        build_env = {**os.environ, "DOCKER_BUILDKIT": "1"}
        run("docker", "build", "--pull=false", "--no-cache", "--network=none",
            "--platform=linux/amd64", "--iidfile", str(iidfile), "--quiet", str(context_dir), env=build_env)
        image_id = iidfile.read_text(encoding="ascii").strip()
        if not IMAGE_ID_RE.fullmatch(image_id):
            raise RuntimeError("Docker did not return a valid image ID")
        if inspect_image(temporary_tag)["Id"] != PARENT_IMAGE:
            raise RuntimeError("temporary parent tag changed during build")
        candidate = inspect_image(image_id)
        check_image(parent, candidate)
        check_history(PARENT_IMAGE, image_id)
        saved_image = context_dir / "candidate.tar"
        run("docker", "image", "save", "-o", str(saved_image), image_id)
        check_added_layer(saved_image, candidate["RootFS"]["Layers"][-1])
        if (sha256_file(bundle_path) != BUNDLE_SHA
                or inspect_container(SOURCE_CONTAINER).get("Image") != PARENT_IMAGE
                or run("docker", "exec", SOURCE_CONTAINER, "sha256sum", "/app/dist/index.mjs").split()[0] != PARENT_BUNDLE):
            raise RuntimeError("bundle or active parent changed during build")
        return image_id
    finally:
        if tagged:
            subprocess.run(["docker", "image", "rm", temporary_tag], capture_output=True, check=False)
        shutil.rmtree(context_dir)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle-path", type=Path, required=True,
                        help="path to the reviewed backend-title-candidate.mjs")
    print(build(parser.parse_args().bundle_path))
