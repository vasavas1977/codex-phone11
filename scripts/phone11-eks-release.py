#!/usr/bin/env python3
"""Manual, digest-pinned Phone11 EKS backend release with guarded rollback."""

from __future__ import annotations

import json
import http.client
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping


REPOSITORY = "cloudphone11/backend"
NAMESPACE = "cloudphone11"
DEPLOYMENT = "backend"
DIGEST = re.compile(r"sha256:[0-9a-f]{64}\Z")
IMMUTABLE_IMAGE = re.compile(r"[^\s@]+@sha256:[0-9a-f]{64}\Z")


class ReleaseError(RuntimeError):
    pass


@dataclass(frozen=True)
class Config:
    region: str
    cluster: str
    tag: str

    @property
    def context(self) -> str:
        return f"phone11-release-{self.cluster}"


@dataclass(frozen=True)
class Backend:
    resource_version: str
    container_index: int
    image: str


def config_from_env(environ: Mapping[str, str]) -> Config:
    region = environ.get("AWS_REGION", "")
    cluster = environ.get("EKS_CLUSTER", "")
    tag = environ.get("IMAGE_TAG_INPUT") or environ.get("GITHUB_SHA", "")
    if not re.fullmatch(r"[a-z]{2}(?:-[a-z]+){1,3}-[0-9]+", region):
        raise ReleaseError("AWS_REGION must be an explicit AWS region")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,99}", cluster):
        raise ReleaseError("EKS_CLUSTER_NAME must be an explicit cluster name")
    if not re.fullmatch(r"[0-9a-f]{40}", tag):
        raise ReleaseError("image_tag must be a 40-character lowercase commit SHA")
    return Config(region, cluster, tag)


class Runner:
    def run(self, *args: str) -> str:
        timeout = 330 if args[-1:] == ("--timeout=300s",) else 150 if args[-1:] == ("--timeout=120s",) else 60
        try:
            result = subprocess.run(args, capture_output=True, text=True, check=False, timeout=timeout)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise ReleaseError(f"{args[0]} {args[1]} did not complete") from error
        if result.returncode:
            raise ReleaseError(f"{args[0]} {args[1]} failed (exit {result.returncode})")
        return result.stdout

    def health(self, context: str) -> None:
        forward = subprocess.Popen(
            ["kubectl", "--context", context, "port-forward", "svc/backend", "3000:3000", "-n", NAMESPACE],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        try:
            time.sleep(5)
            if forward.poll() is not None:
                raise ReleaseError("backend port-forward exited before health check")
            connection = http.client.HTTPConnection("127.0.0.1", 3000, timeout=10)
            try:
                connection.request("GET", "/health")
                response = connection.getresponse()
                if response.status != 200:
                    raise ReleaseError("backend health check failed")
            finally:
                connection.close()
        finally:
            forward.terminate()
            try:
                forward.wait(timeout=5)
            except subprocess.TimeoutExpired:
                forward.kill()
                forward.wait(timeout=5)


def object_from_command(runner: Runner, *args: str) -> dict:
    try:
        value = json.loads(runner.run(*args))
    except (json.JSONDecodeError, TypeError) as error:
        raise ReleaseError("cloud or Kubernetes response was not valid JSON") from error
    if not isinstance(value, dict):
        raise ReleaseError("cloud or Kubernetes response was not a JSON object")
    return value


def kubectl(config: Config, *args: str) -> tuple[str, ...]:
    return ("kubectl", "--context", config.context, *args)


def backend(runner: Runner, config: Config) -> Backend:
    item = object_from_command(runner, *kubectl(config, "get", "deployment/backend", "-n", NAMESPACE, "-o", "json"))
    try:
        version = item["metadata"]["resourceVersion"]
        containers = item["spec"]["template"]["spec"]["containers"]
        matches = [(i, c["image"]) for i, c in enumerate(containers) if c["name"] == DEPLOYMENT]
    except (KeyError, TypeError) as error:
        raise ReleaseError("backend deployment has unexpected shape") from error
    if not isinstance(version, str) or not version or len(matches) != 1:
        raise ReleaseError("backend deployment identity is ambiguous")
    index, image = matches[0]
    if not isinstance(image, str) or not image:
        raise ReleaseError("backend image is missing")
    return Backend(version, index, image)


def patch_image(runner: Runner, config: Config, current: Backend, desired: str) -> None:
    path = f"/spec/template/spec/containers/{current.container_index}/image"
    patch = [
        {"op": "test", "path": "/metadata/resourceVersion", "value": current.resource_version},
        {"op": "test", "path": path, "value": current.image},
        {"op": "replace", "path": path, "value": desired},
    ]
    runner.run(*kubectl(config, "patch", "deployment/backend", "-n", NAMESPACE, "--type=json", "-p", json.dumps(patch, separators=(",", ":"))))


def desired_image(runner: Runner, config: Config) -> str:
    cluster = object_from_command(runner, "aws", "eks", "describe-cluster", "--name", config.cluster, "--region", config.region, "--output", "json").get("cluster", {})
    if cluster.get("status") != "ACTIVE":
        raise ReleaseError("target EKS cluster is not active")
    arn = cluster.get("arn", "")
    match = re.fullmatch(rf"arn:aws:eks:{re.escape(config.region)}:([0-9]{{12}}):cluster/{re.escape(config.cluster)}", arn)
    if not match:
        raise ReleaseError("target EKS cluster ARN does not match the explicit target")
    repo = object_from_command(runner, "aws", "ecr", "describe-repositories", "--repository-names", REPOSITORY, "--region", config.region, "--output", "json")
    repositories = repo.get("repositories", [])
    if not isinstance(repositories, list) or len(repositories) != 1:
        raise ReleaseError("backend ECR repository is missing or ambiguous")
    uri = repositories[0].get("repositoryUri", "")
    expected_uri = f"{match.group(1)}.dkr.ecr.{config.region}.amazonaws.com/{REPOSITORY}"
    if uri != expected_uri:
        raise ReleaseError("backend ECR repository is outside the target account or region")
    images = object_from_command(runner, "aws", "ecr", "describe-images", "--repository-name", REPOSITORY, "--image-ids", f"imageTag={config.tag}", "--region", config.region, "--output", "json")
    details = images.get("imageDetails", [])
    if not isinstance(details, list) or len(details) != 1 or not DIGEST.fullmatch(details[0].get("imageDigest", "")):
        raise ReleaseError("backend image tag has no unique immutable digest")
    return f"{uri}@{details[0]['imageDigest']}"


def rollback(runner: Runner, config: Config, previous: str, desired: str) -> None:
    current = backend(runner, config)
    if current.image == previous:
        runner.run(*kubectl(config, "rollout", "status", "deployment/backend", "-n", NAMESPACE, "--timeout=120s"))
        return  # The attempted patch did not take effect, or rollback already completed.
    if current.image != desired:
        raise ReleaseError("backend image drifted; refusing automatic rollback")
    try:
        patch_image(runner, config, current, previous)
    except ReleaseError:
        if backend(runner, config).image != previous:
            raise  # A failed response is ambiguous; re-read before declaring failure.
    runner.run(*kubectl(config, "rollout", "status", "deployment/backend", "-n", NAMESPACE, "--timeout=120s"))


def deploy(runner: Runner, config: Config) -> str:
    desired = desired_image(runner, config)
    runner.run("aws", "eks", "update-kubeconfig", "--name", config.cluster, "--region", config.region, "--alias", config.context)
    previous = backend(runner, config)
    if not IMMUTABLE_IMAGE.fullmatch(previous.image):
        raise ReleaseError("current backend image is not digest-pinned; refusing release")
    if previous.image == desired:
        raise ReleaseError("requested backend image is already deployed")
    try:
        # Any error response may follow an applied API patch. Re-read and guard rollback.
        patch_image(runner, config, previous, desired)
        runner.run(*kubectl(config, "rollout", "status", "deployment/backend", "-n", NAMESPACE, "--timeout=300s"))
        runner.run(*kubectl(config, "get", "svc/backend", "-n", NAMESPACE, "-o", "name"))
        runner.health(config.context)
        if backend(runner, config).image != desired:
            raise ReleaseError("backend image changed after health check")
    except Exception as error:
        try:
            rollback(runner, config, previous.image, desired)
        except Exception as rollback_error:
            raise ReleaseError(f"deployment failed; guarded rollback needs operator review: {rollback_error}") from error
        raise ReleaseError(f"deployment failed; previous digest restored: {error}") from error
    return desired


def main() -> int:
    try:
        if len(sys.argv) != 2 or sys.argv[1] not in {"validate", "deploy"}:
            raise ReleaseError("usage: phone11-eks-release.py validate|deploy")
        config = config_from_env(os.environ)
        if sys.argv[1] == "deploy":
            image = deploy(Runner(), config)
            print(f"Backend deployed and healthy: {image}")
            summary = os.environ.get("GITHUB_STEP_SUMMARY")
            if summary:
                with Path(summary).open("a") as output:
                    output.write(f"Backend deployed in {config.cluster} ({config.region}): `{image}`\n")
        return 0
    except ReleaseError as error:
        print(f"Phone11 EKS release stopped: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
