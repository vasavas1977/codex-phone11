import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest import mock


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / file)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


builder = load("phone11_mainline_fixture_builder", "phone11-mainline-fixture-builder.py")
pilot = load("phone11_fixture_pilot", "phone11-parallel-api-pilot.py")
IMAGE = "sha256:" + "a" * 64
DB_ID = "b" * 64
CONTAINER_ID = "c" * 64
PIN_ARGS = ["--manifest", "/root/phone11-mainline-release-start.manifest",
            "--start-receipt", f"/var/lib/phone11-mainline-release-start/{CONTAINER_ID}.json",
            "--database-container-id", DB_ID]


class FixtureBuilderTests(unittest.TestCase):
    def test_document_matches_reviewed_parser_and_exact_get_allowlist(self):
        raw = builder.document("fake-test-token", 73, 74)
        digest = hashlib.sha256(raw).hexdigest()
        values = pilot.load_probes(raw, type("Pins", (), {"probes_sha256": digest})())
        self.assertEqual({probe["label"] for probe in values},
                         {"existing_phone", "existing_chat", "conference", "mixed_batch", "denied_tenant"})
        self.assertTrue(all(probe["method"] == "GET" and probe["body"] == "" for probe in values))
        denied = next(probe for probe in values if probe["label"] == "denied_tenant")
        self.assertEqual(denied["status"], 403)
        self.assertIn("chat.list", denied["path"])
        self.assertNotIn("X-Phone11-Read-Only-Probe", denied["headers"])

    def test_file_is_exclusive_root_equivalent_0600_and_no_follow(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "private"
            owner = (os.getuid(), os.getgid())
            raw = builder.document("fake-test-token", 73, 74)
            digest = builder.secure_write(root, "candidate-test.json", raw, owner=owner)
            target = root / "candidate-test.json"
            self.assertEqual(digest, hashlib.sha256(raw).hexdigest())
            self.assertEqual(stat.S_IMODE(root.stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
            self.assertEqual(target.read_bytes(), raw)
            with self.assertRaises(FileExistsError):
                builder.secure_write(root, "candidate-test.json", b"replacement", owner=owner)
            (root / "candidate-link.json").symlink_to(target)
            with self.assertRaises(FileExistsError):
                builder.secure_write(root, "candidate-link.json", b"replacement", owner=owner)
            self.assertEqual(target.read_bytes(), raw)

    def test_dry_run_never_reads_credentials_or_contacts_host(self):
        argv = ["builder", "--dry-run", "--output-name", "candidate-test.json",
                "--user-id", "1", "--extension", "3001", "--tenant-id", "73",
                "--denied-tenant-id", "74", "--user-role", "user", "--tenant-role", "user"] + PIN_ARGS
        output = io.StringIO()
        with mock.patch.object(sys, "argv", argv), mock.patch.object(builder.getpass, "getpass") as secret, \
             mock.patch.object(builder, "request") as http, contextlib.redirect_stdout(output):
            self.assertEqual(builder.main(), 0)
        secret.assert_not_called()
        http.assert_not_called()
        self.assertIn("network=NOT_RUN", output.getvalue())

    def test_http_target_is_allowlisted_loopback_and_uses_manifest_port(self):
        for port in (3019, 3020):
            connection = mock.Mock()
            response = mock.Mock(status=200, read=mock.Mock(return_value=b"ok"))
            response.getheaders.return_value = []
            connection.getresponse.return_value = response
            with self.subTest(port=port), \
                 mock.patch.object(builder.http.client, "HTTPConnection", return_value=connection) as http:
                self.assertEqual(builder.request("GET", "/health", port=port),
                                 (200, {}, b"ok"))
            http.assert_called_once_with("127.0.0.1", port, timeout=5)
        with self.assertRaisesRegex(builder.Refused, "candidate_port"):
            builder.request("GET", "/health", port=3016)

    def test_http_rechecks_candidate_before_opening_connection(self):
        events = []
        connection = mock.Mock()
        connection.getresponse.return_value = mock.Mock(
            status=200, read=mock.Mock(return_value=b"ok"), getheaders=mock.Mock(return_value=[]))
        def connect(*args, **kwargs):
            events.append("connect")
            self.assertEqual(events[0], "verified")
            return connection
        with mock.patch.object(builder.http.client, "HTTPConnection", side_effect=connect):
            builder.request("POST", "/api/auth/sign-in/email", b"{}", port=3020,
                            before_request=lambda: events.append("verified"))
        self.assertEqual(events, ["verified", "connect"])

    def test_start_receipt_binds_exact_candidate_id_and_manifest_fields(self):
        candidate = {"image": IMAGE, "source_sha": "d" * 40,
                     "bundle_sha256": "e" * 64, "build": "zoom-test",
                     "name": "cp11-api-candidate-test", "port": 3020}
        pins = {"candidate": candidate}
        record = {"schema": "phone11-test-schema", "container_id": CONTAINER_ID,
                  **candidate}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "receipts"
            root.mkdir(mode=0o700)
            receipt = root / f"{CONTAINER_ID}.json"
            start = mock.Mock(STATE_ROOT=root, SCHEMA="phone11-test-schema")
            start.secure_file.return_value = json.dumps(record).encode()
            real_lstat = Path.lstat

            def lstat(path):
                if path == root:
                    return type("Stat", (), {"st_mode": stat.S_IFDIR | 0o700,
                                               "st_uid": 0, "st_gid": 0})()
                return real_lstat(path)

            with mock.patch.object(Path, "lstat", autospec=True, side_effect=lstat):
                self.assertEqual(builder.start_receipt(receipt, pins, start), CONTAINER_ID)
                start.secure_file.assert_called_once_with(receipt, exact_mode=0o600)
                start.secure_file.reset_mock()
                start.secure_file.return_value = json.dumps(
                    dict(record, build="other-build")).encode()
                with self.assertRaisesRegex(builder.Refused, "start_receipt"):
                    builder.start_receipt(receipt, pins, start)

    def test_unproved_identity_fails_before_password_or_sign_in_without_secret_output(self):
        argv = ["builder", "--apply", "--output-name", "candidate-test.json",
                "--user-id", "1", "--extension", "3001", "--tenant-id", "73",
                "--denied-tenant-id", "74", "--user-role", "user", "--tenant-role", "user"] + PIN_ARGS
        error = io.StringIO()
        with mock.patch.object(sys, "argv", argv), mock.patch.object(builder.os, "geteuid", return_value=0), \
             mock.patch.object(builder.os, "getegid", return_value=0), \
             mock.patch.object(builder.sys, "stdin") as stdin, \
             mock.patch("builtins.input", return_value="fixture@example.test"), \
             mock.patch.object(builder.getpass, "getpass", return_value="postgresql://fixture:secret@127.0.0.1:5432/phone11ai") as secret, \
             mock.patch.object(builder, "pinned_runtime", return_value=(IMAGE, DB_ID, 3019, CONTAINER_ID)), \
             mock.patch.object(builder, "verify_identity", side_effect=builder.Refused("identity_mapping")), \
             mock.patch.object(builder, "sign_in") as login, contextlib.redirect_stderr(error):
            stdin.isatty.return_value = True
            self.assertEqual(builder.main(), 1)
        self.assertEqual(secret.call_count, 1)
        login.assert_not_called()
        self.assertEqual(error.getvalue(), "FAIL: identity_mapping\n")
        self.assertNotIn("secret", error.getvalue())

    def test_sign_in_mismatch_blocks_output_and_redacts_token(self):
        argv = ["builder", "--apply", "--output-name", "candidate-test.json",
                "--user-id", "1", "--extension", "3001", "--tenant-id", "73",
                "--denied-tenant-id", "74", "--user-role", "user", "--tenant-role", "user"] + PIN_ARGS
        error = io.StringIO()
        with mock.patch.object(sys, "argv", argv), mock.patch.object(builder.os, "geteuid", return_value=0), \
             mock.patch.object(builder.os, "getegid", return_value=0), \
             mock.patch.object(builder.sys, "stdin") as stdin, \
             mock.patch("builtins.input", return_value="fixture@example.test"), \
             mock.patch.object(builder.getpass, "getpass", side_effect=["postgresql://fixture:db-secret@127.0.0.1:5432/phone11ai", "password-secret"]), \
             mock.patch.object(builder, "pinned_runtime", return_value=(IMAGE, DB_ID, 3019, CONTAINER_ID)), \
             mock.patch.object(builder, "verify_identity", return_value="expected-auth"), \
             mock.patch.object(builder, "sign_in", return_value=("bearer-secret", "wrong-auth")), \
             mock.patch.object(builder, "secure_write") as write, contextlib.redirect_stderr(error):
            stdin.isatty.return_value = True
            self.assertEqual(builder.main(), 1)
        write.assert_not_called()
        self.assertEqual(error.getvalue(), "FAIL: sign_in_identity\n")
        for secret in ("db-secret", "password-secret", "bearer-secret"):
            self.assertNotIn(secret, error.getvalue())

    def test_database_proof_requires_exact_roles_and_never_places_url_in_argv(self):
        proof = {"ok": True, "database": "phone11ai", "authId": "auth-test", "email": "fixture@example.test",
                 "canonicalEmail": "fixture@example.test", "userId": 1, "userRole": "user",
                 "tenantRole": "user", "tenantId": 73, "extension": "3001"}
        completed = mock.Mock(returncode=0, stdout=json.dumps(proof))
        database_url = "postgresql://fixture:database-secret@127.0.0.1:5432/phone11ai"
        with mock.patch.object(builder.subprocess, "run", return_value=completed) as run:
            self.assertEqual(builder.verify_identity(database_url, IMAGE, DB_ID, 1, "fixture@example.test",
                                                     "user", "user", 73, 74, "3001"), "auth-test")
        self.assertNotIn(database_url, repr(run.call_args.args[0]))
        self.assertIn(database_url, run.call_args.kwargs["input"])
        proof["tenantRole"] = "admin"
        with mock.patch.object(builder.subprocess, "run",
                               return_value=mock.Mock(returncode=0, stdout=json.dumps(proof))):
            with self.assertRaisesRegex(builder.Refused, "identity_mapping"):
                builder.verify_identity(database_url, IMAGE, DB_ID, 1, "fixture@example.test",
                                        "user", "user", 73, 74, "3001")

    def test_database_runtime_is_manifest_pinned_and_container_id_scoped(self):
        for port in (3019, 3020):
            database = mock.Mock(returncode=0, stdout=f"{DB_ID}|/cp11-postgres|true|phone11ai_default\n")
            with self.subTest(port=port), \
                 mock.patch.object(builder, "pinned_candidate",
                                   return_value=(IMAGE, port, CONTAINER_ID)) as candidate, \
                 mock.patch.object(builder.subprocess, "run", return_value=database) as run:
                self.assertEqual(builder.pinned_runtime(Path("/root/pins.json"), DB_ID,
                                                        Path(PIN_ARGS[3])),
                                 (IMAGE, DB_ID, port, CONTAINER_ID))
            candidate.assert_called_once_with(Path("/root/pins.json"), Path(PIN_ARGS[3]))
            self.assertEqual(run.call_args.args[0][-1], "cp11-postgres")
        database.stdout = f"{'c' * 64}|/cp11-postgres|true|phone11ai_default\n"
        with mock.patch.object(builder, "pinned_candidate", return_value=(IMAGE, 3019, CONTAINER_ID)), \
             mock.patch.object(builder.subprocess, "run", return_value=database):
            with self.assertRaisesRegex(builder.Refused, "database_container"):
                builder.pinned_runtime(Path("/root/pins.json"), DB_ID, Path(PIN_ARGS[3]))
        database.stdout = f"{DB_ID}|/cp11-postgres|true|host\n"
        with mock.patch.object(builder, "pinned_candidate", return_value=(IMAGE, 3019, CONTAINER_ID)), \
             mock.patch.object(builder.subprocess, "run", return_value=database):
            with self.assertRaisesRegex(builder.Refused, "database_container"):
                builder.pinned_runtime(Path("/root/pins.json"), DB_ID, Path(PIN_ARGS[3]))

    def test_candidate_runtime_rejects_unapproved_port_and_delegates_full_runtime_pin(self):
        start = mock.Mock()
        for port in (3019, 3020):
            pins = {"candidate": {"image": IMAGE, "port": port}}
            start.manifest.return_value = pins
            source = object()
            with self.subTest(port=port), \
                 mock.patch.object(builder, "release_start", return_value=start), \
                 mock.patch.object(builder, "start_receipt", return_value=CONTAINER_ID) as receipt:
                self.assertEqual(builder.pinned_candidate(Path("/root/pins.json"),
                                                           Path(PIN_ARGS[3])),
                                 (IMAGE, port, CONTAINER_ID))
            receipt.assert_called_once_with(Path(PIN_ARGS[3]), pins, start)
            start.source_runtime.assert_called_with(pins)
            start.candidate_image.assert_called_with(pins, start.source_runtime.return_value)
            start.check_candidate.assert_called_with(pins, start.source_runtime.return_value,
                                                     CONTAINER_ID)

        for port in (3016, 3021):
            start.manifest.return_value = {"candidate": {"image": IMAGE, "port": port}}
            start.source_runtime.reset_mock()
            with self.subTest(port=port), \
                 mock.patch.object(builder, "release_start", return_value=start), \
                 self.assertRaisesRegex(builder.Refused, "candidate_port"):
                builder.pinned_candidate(Path("/root/pins.json"), Path(PIN_ARGS[3]))
            start.source_runtime.assert_not_called()

    def test_database_command_has_no_secret_or_host_network_and_drops_privileges(self):
        command = builder.database_command(IMAGE, DB_ID)
        self.assertIn("--network=container:" + DB_ID, command)
        self.assertIn("--read-only", command)
        self.assertIn("--cap-drop=ALL", command)
        self.assertIn("--security-opt=no-new-privileges", command)
        self.assertIn("--user=65534:65534", command)
        self.assertIn("--log-driver=none", command)
        self.assertIn("--pull=never", command)
        self.assertNotIn("--network=host", command)
        self.assertNotIn("database-secret", repr(command))
        self.assertEqual(command[-3:], [IMAGE, "-e", builder.IDENTITY_QUERY])

    def test_database_origin_rejects_remote_and_query_host_override(self):
        for url in ("postgresql://fixture:secret@example.com:5432/phone11ai",
                    "postgresql://fixture:secret@localhost:5432/phone11ai",
                    "postgresql://fixture:secret@127.0.0.1:5432/other",
                    "postgresql://fixture:secret@127.0.0.1:5432/phone11ai?host=example.com"):
            with self.subTest(url=url), self.assertRaisesRegex(builder.Refused, "database_origin"):
                builder.local_database_url(url)
        builder.local_database_url("postgresql://fixture:secret@127.0.0.1:5432/phone11ai")
        with self.assertRaisesRegex(builder.Refused, "database_origin"):
            builder.local_database_url("postgresql://fixture:secret@/phone11ai?host=/var/run/postgresql")

    def test_embedded_database_helper_is_valid_node_source(self):
        result = __import__("subprocess").run(["node", "--check"], input=builder.IDENTITY_QUERY,
                                              text=True, capture_output=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_success_reports_only_path_and_hash(self):
        argv = ["builder", "--apply", "--output-name", "candidate-test.json",
                "--user-id", "1", "--extension", "3001", "--tenant-id", "73",
                "--denied-tenant-id", "74", "--user-role", "user", "--tenant-role", "user"] + PIN_ARGS
        output = io.StringIO()
        with mock.patch.object(sys, "argv", argv), mock.patch.object(builder.os, "geteuid", return_value=0), \
             mock.patch.object(builder.os, "getegid", return_value=0), \
             mock.patch.object(builder.sys, "stdin") as stdin, \
             mock.patch("builtins.input", return_value="fixture@example.test"), \
             mock.patch.object(builder.getpass, "getpass", side_effect=[
                 "postgresql://fixture:db-secret@127.0.0.1:5432/phone11ai", "password-secret"]), \
             mock.patch.object(builder, "pinned_runtime", return_value=(IMAGE, DB_ID, 3020, CONTAINER_ID)), \
             mock.patch.object(builder, "pinned_candidate",
                               return_value=(IMAGE, 3020, CONTAINER_ID)) as recheck, \
             mock.patch.object(builder, "verify_identity", return_value="auth-test"), \
             mock.patch.object(builder, "sign_in", return_value=("bearer-secret", "auth-test")) as sign_in, \
             mock.patch.object(builder, "verify_session") as verify_session, \
             mock.patch.object(builder, "secure_write", return_value="a" * 64) as write, \
             contextlib.redirect_stdout(output):
            stdin.isatty.return_value = True
            self.assertEqual(builder.main(), 0)
            sign_in.call_args.kwargs["before_request"]()
            verify_session.call_args.kwargs["before_request"]()
            self.assertEqual(recheck.call_count, 2)
            self.assertEqual(recheck.call_args.args,
                             (Path(PIN_ARGS[1]), Path(PIN_ARGS[3])))
        sign_in.assert_called_once()
        self.assertEqual(sign_in.call_args.args,
                         ("fixture@example.test", "password-secret"))
        self.assertEqual(sign_in.call_args.kwargs["port"], 3020)
        verify_session.assert_called_once_with("bearer-secret", "auth-test",
                                               "fixture@example.test", port=3020,
                                               before_request=sign_in.call_args.kwargs["before_request"])
        self.assertIn(b"bearer-secret", write.call_args.args[2])
        self.assertEqual(output.getvalue(),
                         f"fixture={builder.ROOT / 'candidate-test.json'} sha256={'a' * 64}\n")


if __name__ == "__main__":
    unittest.main()
