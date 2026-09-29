#!/usr/bin/env python3
"""Offline command fakes for the manual EKS release boundary."""

import importlib.util
import json
import sys
import unittest
from pathlib import Path
from subprocess import TimeoutExpired
from unittest.mock import Mock, patch


SOURCE = Path(__file__).resolve().parents[1] / "scripts" / "phone11-eks-release.py"
SPEC = importlib.util.spec_from_file_location("phone11_eks_release", SOURCE)
release = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = release
SPEC.loader.exec_module(release)

ACCOUNT = "326786006484"
REGION = "ap-southeast-7"
CLUSTER = "phone11-test"
TAG = "a" * 40
OLD = f"{ACCOUNT}.dkr.ecr.{REGION}.amazonaws.com/cloudphone11/backend@sha256:{'1' * 64}"
NEW = f"{ACCOUNT}.dkr.ecr.{REGION}.amazonaws.com/cloudphone11/backend@sha256:{'2' * 64}"
OTHER = f"{ACCOUNT}.dkr.ecr.{REGION}.amazonaws.com/cloudphone11/backend@sha256:{'3' * 64}"


class FakeRunner:
    def __init__(self, image=OLD, patch_behavior="normal", health_behavior="normal"):
        self.image = image
        self.version = 1
        self.patch_behavior = patch_behavior
        self.health_behavior = health_behavior
        self.commands = []
        self.patches = []

    def run(self, *args):
        self.commands.append(args)
        if args[:3] == ("aws", "eks", "describe-cluster"):
            return json.dumps({"cluster": {"status": "ACTIVE", "arn": f"arn:aws:eks:{REGION}:{ACCOUNT}:cluster/{CLUSTER}"}})
        if args[:3] == ("aws", "ecr", "describe-repositories"):
            return json.dumps({"repositories": [{"repositoryUri": f"{ACCOUNT}.dkr.ecr.{REGION}.amazonaws.com/cloudphone11/backend"}]})
        if args[:3] == ("aws", "ecr", "describe-images"):
            return json.dumps({"imageDetails": [{"imageDigest": f"sha256:{'2' * 64}"}]})
        if args[:3] == ("aws", "eks", "update-kubeconfig"):
            return ""
        if args[0] == "kubectl":
            verb = args[3]
            if verb == "get" and args[4] == "deployment/backend":
                return json.dumps({"metadata": {"resourceVersion": str(self.version)}, "spec": {"template": {"spec": {"containers": [{"name": "sidecar", "image": OTHER}, {"name": "backend", "image": self.image}]}}}})
            if verb == "get" and args[4] == "svc/backend":
                return "service/backend"
            if verb == "patch":
                patch = json.loads(args[args.index("-p") + 1])
                self.patches.append(patch)
                self._patch(patch)
                return "deployment.apps/backend patched"
            if verb == "rollout":
                return "deployment successfully rolled out"
        raise AssertionError(f"unexpected command: {args}")

    def _patch(self, patch):
        if self.patch_behavior == "reject-once":
            self.patch_behavior = "normal"
            raise release.ReleaseError("patch request rejected")
        if self.patch_behavior == "concurrent-before-patch":
            self.image = OTHER
            self.version += 1
            self.patch_behavior = "normal"
        if patch[0] != {"op": "test", "path": "/metadata/resourceVersion", "value": str(self.version)}:
            raise release.ReleaseError("atomic resourceVersion test failed")
        if patch[1] != {"op": "test", "path": "/spec/template/spec/containers/1/image", "value": self.image}:
            raise release.ReleaseError("atomic image test failed")
        assert patch[2]["path"] == "/spec/template/spec/containers/1/image"
        self.image = patch[2]["value"]
        self.version += 1
        if self.patch_behavior == "ambiguous-once":
            self.patch_behavior = "normal"
            raise release.ReleaseError("patch response lost")

    def health(self, context):
        assert context == f"phone11-release-{CLUSTER}"
        if self.health_behavior == "fail":
            raise release.ReleaseError("health failed")
        if self.health_behavior == "drift":
            self.image = OTHER
            self.version += 1
            raise release.ReleaseError("health failed after concurrent change")
        if self.health_behavior == "drift-success":
            self.image = OTHER
            self.version += 1


class EksReleaseTests(unittest.TestCase):
    def setUp(self):
        self.config = release.config_from_env({"AWS_REGION": REGION, "EKS_CLUSTER": CLUSTER, "GITHUB_SHA": TAG})

    def test_missing_or_bad_config_fails_before_any_command(self):
        for bad in ({"EKS_CLUSTER": CLUSTER, "GITHUB_SHA": TAG}, {"AWS_REGION": REGION, "GITHUB_SHA": TAG}, {"AWS_REGION": REGION, "EKS_CLUSTER": CLUSTER, "IMAGE_TAG_INPUT": "x;echo unsafe", "GITHUB_SHA": TAG}):
            runner = FakeRunner()
            with self.assertRaises(release.ReleaseError):
                release.deploy(runner, release.config_from_env(bad))
            self.assertEqual(runner.commands, [])

    def test_runner_bounds_cloud_and_rollout_commands(self):
        with patch.object(release.subprocess, "run", side_effect=TimeoutExpired(["aws"], 60)) as command:
            with self.assertRaisesRegex(release.ReleaseError, "did not complete"):
                release.Runner().run("aws", "eks", "describe-cluster")
            self.assertEqual(command.call_args.kwargs["timeout"], 60)
        with patch.object(release.subprocess, "run", side_effect=TimeoutExpired(["kubectl"], 330)) as command:
            with self.assertRaisesRegex(release.ReleaseError, "did not complete"):
                release.Runner().run("kubectl", "rollout", "status", "--timeout=300s")
            self.assertEqual(command.call_args.kwargs["timeout"], 330)
        with patch.object(release.subprocess, "run", side_effect=TimeoutExpired(["kubectl"], 150)) as command:
            with self.assertRaisesRegex(release.ReleaseError, "did not complete"):
                release.Runner().run("kubectl", "rollout", "status", "--timeout=120s")
            self.assertEqual(command.call_args.kwargs["timeout"], 150)

    def test_health_uses_direct_loopback_and_rejects_redirect(self):
        forward = Mock()
        forward.poll.return_value = None
        connection = Mock()
        connection.getresponse.return_value.status = 302
        with patch.object(release.subprocess, "Popen", return_value=forward), patch.object(release.time, "sleep"), patch.object(release.http.client, "HTTPConnection", return_value=connection) as constructor:
            with self.assertRaisesRegex(release.ReleaseError, "health check failed"):
                release.Runner().health(self.config.context)
        constructor.assert_called_once_with("127.0.0.1", 3000, timeout=10)
        connection.request.assert_called_once_with("GET", "/health")
        connection.close.assert_called_once()
        forward.terminate.assert_called_once()

    def test_success_uses_resolved_digest_and_atomic_patch(self):
        runner = FakeRunner()
        self.assertEqual(release.deploy(runner, self.config), NEW)
        self.assertEqual(runner.image, NEW)
        self.assertEqual(len(runner.patches), 1)
        self.assertEqual(runner.patches[0][2]["value"], NEW)
        self.assertNotIn(":", NEW.split("@", 1)[0].rsplit("/", 1)[-1])

    def test_mutable_predecessor_refused_before_patch(self):
        runner = FakeRunner(image=f"{ACCOUNT}.dkr.ecr.{REGION}.amazonaws.com/cloudphone11/backend:latest")
        with self.assertRaisesRegex(release.ReleaseError, "not digest-pinned"):
            release.deploy(runner, self.config)
        self.assertEqual(runner.patches, [])

    def test_ambiguous_applied_patch_is_guardedly_rolled_back(self):
        runner = FakeRunner(patch_behavior="ambiguous-once")
        with self.assertRaisesRegex(release.ReleaseError, "previous digest restored"):
            release.deploy(runner, self.config)
        self.assertEqual(runner.image, OLD)
        self.assertEqual([p[2]["value"] for p in runner.patches], [NEW, OLD])

    def test_rejected_patch_still_verifies_predecessor_rollout(self):
        runner = FakeRunner(patch_behavior="reject-once")
        with self.assertRaisesRegex(release.ReleaseError, "previous digest restored"):
            release.deploy(runner, self.config)
        self.assertEqual(runner.image, OLD)
        self.assertTrue(any(command[-1:] == ("--timeout=120s",) for command in runner.commands))

    def test_concurrent_drift_before_patch_is_not_overwritten(self):
        runner = FakeRunner(patch_behavior="concurrent-before-patch")
        with self.assertRaisesRegex(release.ReleaseError, "drifted"):
            release.deploy(runner, self.config)
        self.assertEqual(runner.image, OTHER)
        self.assertEqual(len(runner.patches), 1)

    def test_concurrent_drift_before_rollback_is_not_overwritten(self):
        runner = FakeRunner(health_behavior="drift")
        with self.assertRaisesRegex(release.ReleaseError, "drifted"):
            release.deploy(runner, self.config)
        self.assertEqual(runner.image, OTHER)
        self.assertEqual(len(runner.patches), 1)

    def test_final_image_read_rejects_post_health_drift(self):
        runner = FakeRunner(health_behavior="drift-success")
        with self.assertRaisesRegex(release.ReleaseError, "drifted"):
            release.deploy(runner, self.config)
        self.assertEqual(runner.image, OTHER)
        self.assertEqual(len(runner.patches), 1)

    def test_health_failure_restores_previous_digest(self):
        runner = FakeRunner(health_behavior="fail")
        with self.assertRaisesRegex(release.ReleaseError, "previous digest restored"):
            release.deploy(runner, self.config)
        self.assertEqual(runner.image, OLD)


if __name__ == "__main__":
    unittest.main()
