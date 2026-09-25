#!/usr/bin/env python3
"""Build and audit a one-file direct-meeting image from the pinned live image.

Run on the VoIP host after staging the reviewed bundle. This does not start a
container or change the live route. It prints only the resulting image ID.
"""

from __future__ import annotations

import argparse
import gzip
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


PARENT_IMAGE = "sha256:55b593f0c392c67bc74589dcae4cb0e36b2f2e6dcd8a3552be781429ed0e2d77"
PARENT_BUNDLE = "75381c01555e1d924eddc2da2c97a1f1e44224dec5c4f03947518e24f6148b5b"
SOURCE_SHA = "2bbb1ed2e49fb6c1ede1e1aa443eba4fc98238f1"
BUNDLE_SHA = "b42e1b4a88cf063b69aa2faa66fcd944224f5f2f66f4302fdee36513afe3aa74"
BUILD = "direct-meeting-20260926"
SOURCE_CONTAINER = "cp11-api-candidate-chat-inbox"
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
    if not re.fullmatch(r"phone11-direct-meeting-parent:[0-9a-f]{32}", parent_tag):
        raise ValueError("invalid temporary parent tag")
    labels = " \\\n    ".join(f'{key}="{value}"' for key, value in PROVENANCE.items())
    return (
        f"FROM --platform=linux/amd64 {parent_tag}\n"
        "COPY --chown=1001:1001 index.mjs /app/dist/index.mjs\n"
        f"LABEL {labels}\n"
        # The 3011 start operator supplies its own health check; do not retain
        # the parent's 3000/3010 health probe in the candidate image.
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


def read_small_json_member(archive: tarfile.TarFile, name: str) -> tuple[bytes, dict]:
    member = archive.extractfile(name)
    if member is None:
        raise RuntimeError("candidate OCI manifest member missing")
    contents = member.read(1_000_001)
    if len(contents) > 1_000_000:
        raise RuntimeError("candidate OCI manifest member is unexpectedly large")
    parsed = json.loads(contents)
    if not isinstance(parsed, dict):
        raise RuntimeError("candidate OCI manifest member is invalid")
    return contents, parsed


def check_oci_layer_descriptor(archive: tarfile.TarFile, layer_path: str, blob_size: int) -> None:
    _, index = read_small_json_member(archive, "index.json")
    manifests = index.get("manifests")
    if not isinstance(manifests, list) or len(manifests) != 1:
        raise RuntimeError("candidate OCI image index is ambiguous")
    descriptor = manifests[0]
    if not isinstance(descriptor, dict) or descriptor.get("mediaType") != "application/vnd.oci.image.manifest.v1+json":
        raise RuntimeError("candidate OCI image manifest type is unsupported")
    digest = descriptor.get("digest")
    if not isinstance(digest, str) or not IMAGE_ID_RE.fullmatch(digest):
        raise RuntimeError("candidate OCI image manifest digest is invalid")
    manifest_bytes, image_manifest = read_small_json_member(
        archive, "blobs/sha256/" + digest.removeprefix("sha256:"))
    if (hashlib.sha256(manifest_bytes).hexdigest() != digest.removeprefix("sha256:")
            or descriptor.get("size") != len(manifest_bytes)):
        raise RuntimeError("candidate OCI image manifest hash changed")
    layers = image_manifest.get("layers")
    if not isinstance(layers, list) or not layers or not isinstance(layers[-1], dict):
        raise RuntimeError("candidate OCI layer descriptor is missing")
    added = layers[-1]
    if added.get("mediaType") not in {
        "application/vnd.docker.image.rootfs.diff.tar.gzip",
        "application/vnd.oci.image.layer.v1.tar+gzip",
    }:
        raise RuntimeError("candidate OCI layer codec is unsupported")
    if (added.get("digest") != "sha256:" + layer_path.rsplit("/", 1)[-1]
            or added.get("size") != blob_size):
        raise RuntimeError("candidate OCI layer descriptor changed")


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
        layer_path = layers[-1]
        if not isinstance(layer_path, str):
            raise RuntimeError("candidate added layer path is invalid")
        added = outer.extractfile(layer_path)
        if added is None:
            raise RuntimeError("candidate added layer missing")
        layer_bytes = added.read(8_000_001)
        if len(layer_bytes) > 8_000_000:
            raise RuntimeError("candidate added layer is unexpectedly large")
        # Docker 29's classic builder exports an OCI gzip blob. Its blob hash
        # names the compressed bytes, while RootFS.Layers contains the hash of
        # the uncompressed tar (diffID). Older Docker saves use raw layer.tar.
        if re.fullmatch(r"blobs/sha256/[0-9a-f]{64}", layer_path):
            check_oci_layer_descriptor(outer, layer_path, len(layer_bytes))
            if hashlib.sha256(layer_bytes).hexdigest() != layer_path.rsplit("/", 1)[-1]:
                raise RuntimeError("candidate OCI layer blob hash changed")
            if not layer_bytes.startswith(b"\x1f\x8b"):
                raise RuntimeError("candidate OCI layer is not gzip")
            try:
                with gzip.GzipFile(fileobj=io.BytesIO(layer_bytes)) as compressed:
                    layer_bytes = compressed.read(8_000_001)
            except (OSError, EOFError) as error:
                raise RuntimeError("candidate OCI layer gzip is invalid") from error
            if len(layer_bytes) > 8_000_000:
                raise RuntimeError("candidate uncompressed layer is unexpectedly large")
        elif not layer_path.endswith("/layer.tar"):
            raise RuntimeError("candidate added layer format is unsupported")
        if "sha256:" + hashlib.sha256(layer_bytes).hexdigest() != expected_layer:
            raise RuntimeError("candidate saved layer does not match image RootFS")
        files = []
        with tarfile.open(fileobj=io.BytesIO(layer_bytes), mode="r:") as layer:
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


def build_with_classic_builder(context_dir: Path, iidfile: Path) -> None:
    # The protected VoIP host has Docker's classic builder, but no buildx
    # plugin. Select it explicitly rather than inheriting a caller setting or
    # silently allowing a different builder. The post-build layer audit below
    # remains the authority for accepting the image.
    build_env = {**os.environ, "DOCKER_BUILDKIT": "0"}
    try:
        run("docker", "build", "--pull=false", "--no-cache", "--network=none",
            "--platform=linux/amd64", "--iidfile", str(iidfile), "--quiet", str(context_dir),
            env=build_env)
    except RuntimeError as error:
        raise RuntimeError(
            "classic Docker builder is unavailable or failed; candidate image not accepted"
        ) from error


def build(bundle_path: Path) -> str:
    if os.geteuid() != 0:
        raise RuntimeError("root is required for the protected host image build")
    if sha256_file(bundle_path) != BUNDLE_SHA:
        raise RuntimeError("candidate bundle does not match the reviewed SHA-256")
    parent = inspect_image(PARENT_IMAGE)
    check_parent(parent, inspect_container(SOURCE_CONTAINER))
    temporary_tag = f"phone11-direct-meeting-parent:{uuid.uuid4().hex}"
    context_dir = Path(tempfile.mkdtemp(prefix="phone11-direct-meeting-build-"))
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
        build_with_classic_builder(context_dir, iidfile)
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
                        help="path to the reviewed direct-meeting backend bundle")
    print(build(parser.parse_args().bundle_path))
