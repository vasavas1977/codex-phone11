"""Hermetic tests for the one-shot Connect11 credential installer."""

from __future__ import annotations

import contextlib
import importlib.util
import io
import json
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).parents[1] / "scripts" / "phone11-install-connect11-keys.py"
SPEC = importlib.util.spec_from_file_location("phone11_install_connect11_keys", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
installer = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = installer
SPEC.loader.exec_module(installer)

STATUS_PREFIX = "c11_live_0123abcd"
JOIN_PREFIX = "c11_live_fedcba98"
STATUS_TOKEN = STATUS_PREFIX + "_" + "A" * 43
JOIN_TOKEN = JOIN_PREFIX + "_" + "B" * 43


def valid_metadata(**overrides: object) -> dict[str, dict[str, object]]:
    document: dict[str, dict[str, object]] = {
        "status": {
            "id": "key-status-01",
            "customer_id": installer.CUSTOMER_ID,
            "tenant_namespace": installer.TENANT_NAMESPACE,
            "name": "Phone11 status",
            "key_prefix": STATUS_PREFIX,
            "scopes": ["realtime:plain-video:status"],
            "environment": "live",
            "product_code": "connect11",
            "phone11_credential_type": "status",
            "status": "active",
        },
        "join_evict": {
            "id": "key-join-01",
            "customer_id": installer.CUSTOMER_ID,
            "tenant_namespace": installer.TENANT_NAMESPACE,
            "name": "Phone11 join and evict",
            "key_prefix": JOIN_PREFIX,
            "scopes": ["realtime:plain-video:join", "realtime:plain-video:evict"],
            "environment": "live",
            "product_code": "connect11",
            "phone11_credential_type": "join_evict",
            "status": "active",
        },
    }
    for path, value in overrides.items():
        role, field = path.split("__", 1)
        document[role][field] = value
    return document


class Connect11InstallerTests(unittest.TestCase):
    def test_payload_is_exactly_compatible_with_guard_contract(self) -> None:
        payload = installer.build_payload(
            valid_metadata(),
            STATUS_TOKEN,
            JOIN_TOKEN,
        )
        self.assertTrue(payload["env"].startswith(installer.CONFIG_VARIABLE + "={"))
        mapping = json.loads(payload["env"].split("=", 1)[1])
        self.assertEqual(mapping["tenants"][0]["tenantId"], 1)
        self.assertEqual(mapping["tenants"][0]["customerKey"], installer.CUSTOMER_ID)
        self.assertEqual(mapping["tenants"][0]["apiBaseUrl"], installer.CONNECT11_API_URL)
        self.assertEqual(mapping["tenants"][0]["rtcUrl"], installer.CONNECT11_RTC_URL)
        self.assertEqual(json.loads(payload["metadata"]), valid_metadata())

    def test_metadata_rejects_wrong_scope_namespace_and_non_distinct_identity(self) -> None:
        invalid = (
            valid_metadata(status__scopes=["realtime:plain-video:join"]),
            valid_metadata(join_evict__tenant_namespace="Phone11tenant1"),
            valid_metadata(join_evict__id="key-status-01"),
            valid_metadata(join_evict__key_prefix=STATUS_PREFIX),
            valid_metadata(status__key_prefix="c11_live_0123abcg"),
            valid_metadata(status__status="revoked"),
        )
        for metadata in invalid:
            with self.subTest(metadata=metadata):
                with self.assertRaises(installer.InstallerError):
                    installer.build_payload(metadata, STATUS_TOKEN, JOIN_TOKEN)

    def test_tokens_must_bind_to_their_role_prefix_and_be_distinct(self) -> None:
        metadata = valid_metadata()
        for status, join in (
            (JOIN_TOKEN, JOIN_TOKEN),
            (STATUS_TOKEN, STATUS_TOKEN),
            (" " + STATUS_TOKEN, JOIN_TOKEN),
        ):
            with self.subTest(status=status, join=join):
                with self.assertRaises(installer.InstallerError):
                    installer.build_payload(metadata, status, join)

    def test_tokens_require_exact_canonical_generator_shape(self) -> None:
        metadata = installer.validate_metadata(valid_metadata())
        self.assertEqual(metadata["status"]["key_prefix"], STATUS_PREFIX)
        self.assertEqual(installer.validate_token(STATUS_TOKEN, prefix=STATUS_PREFIX), STATUS_TOKEN)
        invalid = (
            STATUS_TOKEN + " " + STATUS_TOKEN,
            STATUS_TOKEN + STATUS_TOKEN,
            STATUS_PREFIX + "A" * 42,
            STATUS_PREFIX + "A" * 44,
            "c11_live_0123abcg_" + "A" * 43,
            "c11_live_0123ABCD_" + "A" * 43,
            STATUS_TOKEN + "\n",
            STATUS_TOKEN + "\x00",
        )
        for token in invalid:
            with self.subTest(token_length=len(token)):
                with self.assertRaises(installer.InstallerError):
                    installer.validate_token(token, prefix=STATUS_PREFIX)

    def writer_namespace(self, directory: Path) -> dict[str, object]:
        namespace: dict[str, object] = {"__name__": "phone11_remote_writer_test"}
        exec(installer.REMOTE_WRITER, namespace)
        namespace["CONFIG_FILE"] = directory / "connect11-plain-video.env"
        namespace["METADATA_FILE"] = directory / "connect11-plain-video-credential-metadata.json"
        # The writer must run as root in production.  These hermetic tests keep
        # host ownership untouched while exercising its link/create/rollback logic.
        namespace["root_owned"] = lambda _info: True
        return namespace

    def writer_main(self, namespace: dict[str, object], payload: dict[str, str]) -> int:
        stdin = io.TextIOWrapper(io.BytesIO(json.dumps(payload).encode("utf-8")), encoding="utf-8")
        with patch.object(namespace["os"], "geteuid", return_value=0), patch.object(sys, "stdin", stdin):
            return namespace["main"]()

    def test_writer_creates_both_files_once_with_strict_modes(self) -> None:
        with tempfile.TemporaryDirectory() as raw_directory:
            directory = Path(raw_directory)
            namespace = self.writer_namespace(directory)
            payload = installer.build_payload(valid_metadata(), STATUS_TOKEN, JOIN_TOKEN)
            self.assertEqual(self.writer_main(namespace, payload), 0)
            config = namespace["CONFIG_FILE"]
            metadata = namespace["METADATA_FILE"]
            self.assertEqual(config.read_text(), payload["env"])
            self.assertEqual(metadata.read_text(), payload["metadata"])
            self.assertEqual(config.stat().st_mode & 0o777, 0o600)
            self.assertEqual(metadata.stat().st_mode & 0o777, 0o600)

    def test_writer_refuses_existing_file_or_symlink(self) -> None:
        with tempfile.TemporaryDirectory() as raw_directory:
            directory = Path(raw_directory)
            config = directory / "connect11-plain-video.env"
            config.write_text("keep")
            namespace = self.writer_namespace(directory)
            payload = installer.build_payload(valid_metadata(), STATUS_TOKEN, JOIN_TOKEN)
            self.assertEqual(self.writer_main(namespace, payload), 1)
            self.assertEqual(config.read_text(), "keep")

        with tempfile.TemporaryDirectory() as raw_directory:
            directory = Path(raw_directory)
            target = directory / "target"
            target.write_text("keep")
            (directory / "connect11-plain-video.env").symlink_to(target)
            namespace = self.writer_namespace(directory)
            payload = installer.build_payload(valid_metadata(), STATUS_TOKEN, JOIN_TOKEN)
            self.assertEqual(self.writer_main(namespace, payload), 1)
            self.assertEqual(target.read_text(), "keep")

    def test_writer_rolls_back_only_the_new_first_file_on_partial_failure(self) -> None:
        with tempfile.TemporaryDirectory() as raw_directory:
            directory = Path(raw_directory)
            namespace = self.writer_namespace(directory)
            original = namespace["write_new_file"]
            calls = 0

            def fail_second(path: Path, content: bytes) -> None:
                nonlocal calls
                calls += 1
                if calls == 2:
                    raise namespace["WriterError"]()
                original(path, content)

            namespace["write_new_file"] = fail_second
            payload = installer.build_payload(valid_metadata(), STATUS_TOKEN, JOIN_TOKEN)
            self.assertEqual(self.writer_main(namespace, payload), 1)
            self.assertFalse((directory / "connect11-plain-video.env").exists())
            self.assertFalse((directory / "connect11-plain-video-credential-metadata.json").exists())

    def test_writer_removes_its_own_partial_output(self) -> None:
        with tempfile.TemporaryDirectory() as raw_directory:
            directory = Path(raw_directory)
            namespace = self.writer_namespace(directory)
            original_write = namespace["os"].write
            namespace["os"].write = lambda _descriptor, _content: (_ for _ in ()).throw(OSError())
            try:
                payload = installer.build_payload(valid_metadata(), STATUS_TOKEN, JOIN_TOKEN)
                self.assertEqual(self.writer_main(namespace, payload), 1)
            finally:
                namespace["os"].write = original_write
            self.assertFalse((directory / "connect11-plain-video.env").exists())

    def test_dry_run_never_calls_transport_and_errors_are_redacted(self) -> None:
        with tempfile.TemporaryDirectory() as raw_directory:
            metadata_path = Path(raw_directory) / "metadata.json"
            metadata_path.write_text(json.dumps(valid_metadata()))
            args = installer.parse_args(["--metadata-json", str(metadata_path), "--dry-run"])
            output = io.StringIO()
            with contextlib.redirect_stdout(output), patch.object(installer, "authorize_and_install") as transport:
                self.assertEqual(
                    installer.run(args, prompt=lambda _prompt: STATUS_TOKEN if "status" in _prompt else JOIN_TOKEN),
                    0,
                )
            transport.assert_not_called()
            self.assertEqual(output.getvalue(), "installer=DRY_RUN_VALID\n")

        stderr = io.StringIO()
        args = installer.parse_args(["--metadata-json", "/missing.json", "--dry-run"])
        with contextlib.redirect_stderr(stderr):
            self.assertEqual(installer.run(args, prompt=lambda _prompt: "leaked-secret"), 1)
        self.assertNotIn("leaked-secret", stderr.getvalue())
        self.assertEqual(stderr.getvalue(), "installer=FAILED stage=metadata\n")

    def test_transport_uses_strict_host_verification_and_ephemeral_instance_connect(self) -> None:
        calls: list[tuple[list[str], bytes | None]] = []

        def fake_command(args: list[str], *, stdin: bytes | None = None, timeout: int = 30) -> None:
            calls.append((args, stdin))

        with tempfile.TemporaryDirectory() as raw_directory:
            known_hosts = Path(raw_directory) / "known_hosts"
            known_hosts.write_text("43.210.122.111 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEvidenceOnly\n")
            payload = installer.build_payload(valid_metadata(), STATUS_TOKEN, JOIN_TOKEN)
            with (
                patch.object(installer, "require_aws_target"),
                patch.object(installer, "require_known_host"),
                patch.object(installer, "command", side_effect=fake_command),
            ):
                installer.authorize_and_install(payload, known_hosts)
        flattened = [argument for args, _stdin in calls for argument in args]
        self.assertIn("ec2-instance-connect", flattened)
        self.assertIn(installer.INSTANCE_ID, flattened)
        self.assertIn(installer.AVAILABILITY_ZONE, flattened)
        self.assertIn("StrictHostKeyChecking=yes", flattened)
        self.assertIn("GlobalKnownHostsFile=/dev/null", flattened)
        writer_calls = [(args, stdin) for args, stdin in calls if stdin is not None]
        self.assertEqual(len(writer_calls), 1)
        self.assertTrue(any(installer.REMOTE_WRITER in argument for argument in writer_calls[0][0]))
        self.assertIn(STATUS_TOKEN.encode("utf-8"), writer_calls[0][1])
        self.assertFalse(any("/tmp/" in argument for args, _stdin in calls for argument in args))

    def test_prepare_is_credential_free_and_uses_only_the_remote_read_check(self) -> None:
        calls: list[tuple[list[str], bytes | None]] = []

        def fake_command(args: list[str], *, stdin: bytes | None = None, timeout: int = 30) -> None:
            calls.append((args, stdin))

        with tempfile.TemporaryDirectory() as raw_directory:
            known_hosts = Path(raw_directory) / "known_hosts"
            known_hosts.write_text("43.210.122.111 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEvidenceOnly\n")
            with (
                patch.object(installer, "require_aws_target"),
                patch.object(installer, "require_known_host"),
                patch.object(installer, "command", side_effect=fake_command),
            ):
                installer.authorize_prepare(known_hosts)
        self.assertEqual(len(calls), 3)  # keygen, Instance Connect, preflight SSH; no writer transfer
        self.assertTrue(any(installer.REMOTE_PREPARE in argument for args, _stdin in calls for argument in args))
        self.assertFalse(any(stdin for _args, stdin in calls))

    def prepare_namespace(self, directory: Path) -> dict[str, object]:
        namespace: dict[str, object] = {"__name__": "phone11_remote_prepare_test"}
        exec(installer.REMOTE_PREPARE, namespace)
        namespace["PHONE11_DIRECTORY"] = directory
        namespace["root_owned"] = lambda _info: True
        return namespace

    def test_prepare_accepts_missing_install_directory_without_creating_it(self) -> None:
        with tempfile.TemporaryDirectory() as raw_directory:
            directory = Path(raw_directory) / "phone11"
            namespace = self.prepare_namespace(directory)
            self.assertEqual(namespace["main"](), 0)
            self.assertFalse(directory.exists())

    def test_prepare_rejects_insecure_ancestor_and_symlink_directory(self) -> None:
        with tempfile.TemporaryDirectory() as raw_directory:
            parent = Path(raw_directory)
            parent.chmod(0o777)
            try:
                namespace = self.prepare_namespace(parent / "phone11")
                self.assertEqual(namespace["main"](), 1)
            finally:
                parent.chmod(0o700)

        with tempfile.TemporaryDirectory() as raw_directory:
            parent = Path(raw_directory)
            target = parent / "target"
            target.mkdir()
            child = parent / "phone11"
            child.symlink_to(target, target_is_directory=True)
            namespace = self.prepare_namespace(child)
            self.assertEqual(namespace["main"](), 1)

    def test_default_getpass_rejects_non_tty_fallback(self) -> None:
        with patch.object(sys.stdin, "isatty", return_value=False), patch.object(sys.stderr, "isatty", return_value=False):
            with self.assertRaises(installer.InstallerError) as context:
                installer.read_secret(installer.getpass.getpass, "credential: ")
        self.assertEqual(context.exception.stage, "input")

    def test_aws_target_pins_account_instance_zone_and_public_ip(self) -> None:
        identity = {"Account": installer.EXPECTED_ACCOUNT_ID}
        instance = {
            "Reservations": [
                {
                    "Instances": [
                        {
                            "InstanceId": installer.INSTANCE_ID,
                            "State": {"Name": "running"},
                            "Placement": {"AvailabilityZone": installer.AVAILABILITY_ZONE},
                            "PublicIpAddress": installer.HOST,
                        },
                    ],
                },
            ],
        }
        with patch.object(installer, "json_command", side_effect=[identity, instance]):
            installer.require_aws_target()
        instance["Reservations"][0]["Instances"][0]["PublicIpAddress"] = "43.210.122.112"
        with patch.object(installer, "json_command", side_effect=[identity, instance]):
            with self.assertRaises(installer.InstallerError) as context:
                installer.require_aws_target()
        self.assertEqual(context.exception.stage, "aws_instance")


if __name__ == "__main__":
    unittest.main()
