"""Fail-closed voicemail clone and active handoff checks."""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


ROOT = Path(__file__).parents[1]


def module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


clone = module("voicemail_clone", ROOT / "scripts/phone11-voicemail-clone-validate.py")
handoff = module("voicemail_handoff", ROOT / "scripts/phone11-voicemail-handoff-check.py")


class VoicemailCloneUnit(unittest.TestCase):
    def test_docker_inspect_lowercase_not_found_only(self):
        name = "p11vm-" + "a" * 32
        with patch.object(clone.subprocess, "run", return_value=SimpleNamespace(
                returncode=1, stdout="", stderr="error: no such object: " + name)):
            self.assertIsNone(clone.inspect_owned_clone("/usr/bin/docker", name, "a" * 32, {}))
        with patch.object(clone.subprocess, "run", return_value=SimpleNamespace(
                returncode=1, stdout="", stderr="Cannot connect to the Docker daemon")):
            with self.assertRaisesRegex(clone.ValidationError, "clone_inspect_unavailable"):
                clone.inspect_owned_clone("/usr/bin/docker", name, "a" * 32, {})

    def test_sql_pin_and_private_archive_gate(self):
        self.assertEqual(clone.digest_regular_private(clone.MIGRATION, private=False), clone.MIGRATION_SHA256)
        with tempfile.TemporaryDirectory() as d:
            backup = Path(d) / "backup.dump"
            backup.write_bytes(b"PGDMPfixture")
            os.chmod(backup, 0o644)
            with self.assertRaisesRegex(clone.ValidationError, "file_privacy"):
                clone.digest_regular_private(backup, archive=True)
            os.chmod(backup, 0o600)
            self.assertEqual(len(clone.digest_regular_private(backup, archive=True)), 64)
            backup.write_bytes(b"not-custom-format")
            with self.assertRaisesRegex(clone.ValidationError, "archive_format"):
                clone.digest_regular_private(backup, archive=True)

    def test_receipt_rejects_stale_or_hook_enabled(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            receipt = root / "receipt.json"
            good = {
                "schema": clone.RECEIPT_SCHEMA, "source_base_sha": clone.SOURCE_BASE_SHA,
                "migration_sha256": clone.MIGRATION_SHA256, "backup_sha256": "a" * 64,
                "backend_id": clone.ACTIVE_BACKEND_ID, "backend_image": clone.ACTIVE_BACKEND_IMAGE,
                "freeswitch_id": clone.ACTIVE_FREESWITCH_ID,
                "freeswitch_image": clone.ACTIVE_FREESWITCH_IMAGE,
                "restored_to": "isolated_local_postgresql_cluster", "hook_ready": False,
                "pre_catalog": {k: k == "extensions" for k in
                                ("extensions", "admissions", "messages", "owner_epoch", "owner_trigger",
                                 "guard_trigger", "owner_function", "guard_function", "admissions_index", "inbox_index")},
                "post_catalog": {k: True for k in
                                 ("extensions", "admissions", "messages", "owner_epoch", "owner_trigger",
                                  "guard_trigger", "owner_function", "guard_function", "admissions_index", "inbox_index")},
                "extension_rows_before": 2, "extension_rows_after": 2,
                "validated_at_unix": 100000,
            }
            receipt.write_text(json.dumps(good))
            os.chmod(receipt, 0o600)
            with patch.object(handoff.time, "time", return_value=100010):
                self.assertEqual(handoff.private_receipt(receipt)["hook_ready"], False)
            good["hook_ready"] = True
            receipt.write_text(json.dumps(good))
            with patch.object(handoff.time, "time", return_value=100010):
                with self.assertRaisesRegex(handoff.clone.ValidationError, "receipt_pins"):
                    handoff.private_receipt(receipt)
            good["hook_ready"] = False
            receipt.write_text(json.dumps(good))
            with patch.object(handoff.time, "time", return_value=200000):
                with self.assertRaisesRegex(handoff.clone.ValidationError, "receipt_freshness"):
                    handoff.private_receipt(receipt)

    def test_handoff_rejects_active_image_drift_before_database_access(self):
        receipt = Path("/private/receipt")
        backend = {"Id": clone.ACTIVE_BACKEND_ID, "Image": "sha256:changed",
                   "State": {"Running": True, "Health": {"Status": "healthy"}}}
        with patch.object(handoff, "private_receipt"), patch.object(handoff, "docker_json", side_effect=[backend, backend]), \
             patch.object(handoff.clone, "run") as run:
            with self.assertRaisesRegex(handoff.clone.ValidationError, "active_container_pin"):
                handoff.check_handoff(receipt)
            run.assert_not_called()

    def test_handoff_requires_hook_off_and_absent_live_catalog(self):
        backend = {"Id": clone.ACTIVE_BACKEND_ID, "Image": clone.ACTIVE_BACKEND_IMAGE,
                   "State": {"Running": True, "Health": {"Status": "healthy"}},
                   "Config": {"Env": ["PHONE11_VOICEMAIL_HOOK_READY=false"]}}
        freeswitch = {"Id": clone.ACTIVE_FREESWITCH_ID, "Image": clone.ACTIVE_FREESWITCH_IMAGE,
                      "State": {"Running": True, "Health": {"Status": "healthy"}},
                      "Mounts": [{"Name": "phone11ai-voip_fs_voicemail",
                                  "Destination": "/var/lib/freeswitch/voicemail", "RW": True}]}
        absent = {key: False for key in
                  ("admissions", "messages", "owner_epoch", "owner_trigger", "guard_trigger",
                   "owner_function", "guard_function", "admissions_index", "inbox_index")}
        with patch.object(handoff, "private_receipt"), patch.object(handoff, "docker_json", side_effect=[backend, freeswitch]), \
             patch.object(handoff.clone, "run", side_effect=[json.dumps(absent), "",
                 "loaded_xml_no_hook modules_loaded"]) as run:
            with self.assertRaisesRegex(handoff.clone.ValidationError, "fs_voicemail_callback_unverified"):
                handoff.check_handoff(Path("/private/receipt"))
            self.assertIn("p11-freeswitch", run.call_args_list[-1].args[0])
            self.assertIn("xml_locate dialplan", run.call_args_list[-1].args[0][-1])
        with patch.object(handoff, "private_receipt"), patch.object(handoff, "docker_json", side_effect=[backend, freeswitch]), \
             patch.object(handoff.clone, "run", side_effect=[json.dumps(absent), "", "incomplete"]):
            with self.assertRaisesRegex(handoff.clone.ValidationError, "fs_effective_dialplan_evidence"):
                handoff.check_handoff(Path("/private/receipt"))
        backend["Config"]["Env"] = ["PHONE11_VOICEMAIL_HOOK_READY=true"]
        with patch.object(handoff, "private_receipt"), patch.object(handoff, "docker_json", side_effect=[backend, freeswitch]), \
             patch.object(handoff.clone, "run") as run:
            with self.assertRaisesRegex(handoff.clone.ValidationError, "hook_enabled"):
                handoff.check_handoff(Path("/private/receipt"))
            run.assert_not_called()
        backend["Config"]["Env"] = []
        for changed_key in ("messages", "owner_trigger", "owner_function", "guard_function",
                            "admissions_index", "inbox_index"):
            changed = dict(absent, **{changed_key: True})
            with patch.object(handoff, "private_receipt"), patch.object(handoff, "docker_json", side_effect=[backend, freeswitch]), \
                 patch.object(handoff.clone, "run", return_value=json.dumps(changed)):
                with self.assertRaisesRegex(handoff.clone.ValidationError, "active_catalog_changed"):
                    handoff.check_handoff(Path("/private/receipt"))

    def test_docker_clone_is_pinned_to_no_network_read_only_tmpfs(self):
        container_id = "a" * 64
        token = "b" * 32
        inspect = [{"Id": container_id, "Name": "/p11vm-" + token,
                    "Config": {"Labels": {"phone11.voicemail.clone-token": token}},
                    "Image": clone.CLONE_POSTGRES_IMAGE,
                    "State": {"Running": False},
                    "HostConfig": {"NetworkMode": "none", "ReadonlyRootfs": True, "PortBindings": {},
                                   "Tmpfs": {"/var/lib/postgresql/data": "rw,size=4096m",
                                             "/var/run/postgresql": "rw,size=16m", "/tmp": "rw,size=64m"}},
                    "Mounts": [{"Type": "bind", "RW": False, "Destination": "/tmp/backup.dump",
                                "Source": "/private/backup.dump"},
                               {"Type": "bind", "RW": False, "Destination": "/tmp/migration.sql",
                                "Source": "/private/migration.sql"}]}]
        pre = {key: key == "extensions" for key in
               ("extensions", "admissions", "messages", "owner_epoch", "owner_trigger",
                "guard_trigger", "owner_function", "guard_function", "admissions_index", "inbox_index")}
        post = {key: True for key in pre}
        responses = [container_id, container_id, "", "", json.dumps(pre), "1",
                     "", json.dumps(post), "1"]
        process_results = [
            SimpleNamespace(returncode=0, stdout=json.dumps(inspect), stderr=""),
            SimpleNamespace(returncode=0, stdout="", stderr=""),
            SimpleNamespace(returncode=0, stdout=json.dumps(inspect), stderr=""),
            SimpleNamespace(returncode=0, stdout="", stderr=""),
            SimpleNamespace(returncode=1, stdout="", stderr="No such object"),
        ]
        with patch.object(clone.Path, "is_file", return_value=True), \
             patch.object(clone.uuid, "uuid4", return_value=SimpleNamespace(hex=token)), \
             patch.object(clone, "run", side_effect=responses) as run, \
             patch.object(clone.subprocess, "run", side_effect=process_results):
            result = clone.docker_clone(Path("/private/backup.dump"), Path("/private/migration.sql"), 4096)
        self.assertEqual(result[1:], (1, post, 1))
        invocation = run.call_args_list[0].args[0]
        self.assertEqual(invocation[invocation.index("--network") + 1], "none")
        self.assertIn("--read-only", invocation)
        self.assertIn(CLONE_IMAGE := clone.CLONE_POSTGRES_IMAGE, invocation)
        self.assertTrue(CLONE_IMAGE.startswith("sha256:"))
        self.assertNotIn("-p", invocation)
        self.assertEqual(sum("readonly" in arg for arg in invocation), 2)
        with self.assertRaisesRegex(clone.ValidationError, "clone_data_limit"):
            clone.docker_clone(Path("/private/backup.dump"), Path("/private/migration.sql"), 64)

    def test_uncertain_create_timeout_removes_only_owned_clone(self):
        token = "c" * 32
        container_id = "d" * 64
        owned = [{"Id": container_id, "Name": "/p11vm-" + token,
                  "Config": {"Labels": {"phone11.voicemail.clone-token": token}}}]
        process_results = [
            SimpleNamespace(returncode=0, stdout=json.dumps(owned), stderr=""),
            SimpleNamespace(returncode=0, stdout="", stderr=""),
            SimpleNamespace(returncode=1, stdout="", stderr="error: no such object: p11vm-" + token),
        ]
        with patch.object(clone.Path, "is_file", return_value=True), \
             patch.object(clone.uuid, "uuid4", return_value=SimpleNamespace(hex=token)), \
             patch.object(clone, "run", side_effect=subprocess.TimeoutExpired("docker create", 40)), \
             patch.object(clone.subprocess, "run", side_effect=process_results) as process:
            with self.assertRaisesRegex(clone.ValidationError, "clone_create_uncertain:p11vm-" + token):
                clone.docker_clone(Path("/private/backup.dump"), Path("/private/migration.sql"), 4096)
        self.assertEqual(process.call_args_list[1].args[0], ["/usr/bin/docker", "rm", "-f", "-v", container_id])

    def test_uncertain_create_does_not_remove_foreign_name_collision(self):
        token = "1" * 32
        foreign = [{"Id": "2" * 64, "Name": "/p11vm-" + token,
                    "Config": {"Labels": {"phone11.voicemail.clone-token": "different"}}}]
        with patch.object(clone.Path, "is_file", return_value=True), \
             patch.object(clone.uuid, "uuid4", return_value=SimpleNamespace(hex=token)), \
             patch.object(clone, "run", side_effect=subprocess.TimeoutExpired("docker create", 40)), \
             patch.object(clone.subprocess, "run", return_value=SimpleNamespace(
                 returncode=0, stdout=json.dumps(foreign), stderr="")) as process:
            with self.assertRaisesRegex(clone.ValidationError, "clone_identity"):
                clone.docker_clone(Path("/private/backup.dump"), Path("/private/migration.sql"), 4096)
        self.assertEqual(len(process.call_args_list), 1)

    def test_malformed_create_id_removes_only_owned_clone(self):
        token = "e" * 32
        container_id = "f" * 64
        owned = [{"Id": container_id, "Name": "/p11vm-" + token,
                  "Config": {"Labels": {"phone11.voicemail.clone-token": token}}}]
        process_results = [
            SimpleNamespace(returncode=0, stdout=json.dumps(owned), stderr=""),
            SimpleNamespace(returncode=0, stdout="", stderr=""),
            SimpleNamespace(returncode=1, stdout="", stderr="No such object"),
        ]
        with patch.object(clone.Path, "is_file", return_value=True), \
             patch.object(clone.uuid, "uuid4", return_value=SimpleNamespace(hex=token)), \
             patch.object(clone, "run", return_value="malformed"), \
             patch.object(clone.subprocess, "run", side_effect=process_results) as process:
            with self.assertRaisesRegex(clone.ValidationError, "clone_container_id"):
                clone.docker_clone(Path("/private/backup.dump"), Path("/private/migration.sql"), 4096)
        self.assertEqual(process.call_args_list[1].args[0], ["/usr/bin/docker", "rm", "-f", "-v", container_id])

    def test_start_timeout_or_malformed_output_removes_started_clone(self):
        token = "3" * 32
        container_id = "4" * 64
        owned = [{"Id": container_id, "Name": "/p11vm-" + token,
                  "Config": {"Labels": {"phone11.voicemail.clone-token": token}},
                  "Image": clone.CLONE_POSTGRES_IMAGE, "State": {"Running": False},
                  "HostConfig": {"NetworkMode": "none", "ReadonlyRootfs": True,
                                 "PortBindings": {}, "Tmpfs": {key: "rw" for key in
                                     ("/var/lib/postgresql/data", "/var/run/postgresql", "/tmp")}},
                  "Mounts": [{"Type": "bind", "RW": False, "Destination": "/tmp/backup.dump",
                              "Source": "/private/backup.dump"},
                             {"Type": "bind", "RW": False, "Destination": "/tmp/migration.sql",
                              "Source": "/private/migration.sql"}]}]
        for start_result, expected in (
            (subprocess.TimeoutExpired("docker start", 40), subprocess.TimeoutExpired),
            ("malformed", clone.ValidationError),
        ):
            with self.subTest(start_result=type(start_result).__name__):
                process_results = [
                    SimpleNamespace(returncode=0, stdout=json.dumps(owned), stderr=""),
                    SimpleNamespace(returncode=0, stdout=json.dumps(owned), stderr=""),
                    SimpleNamespace(returncode=0, stdout="", stderr=""),
                    SimpleNamespace(returncode=1, stdout="", stderr="No such object"),
                ]
                with patch.object(clone.Path, "is_file", return_value=True), \
                     patch.object(clone.uuid, "uuid4", return_value=SimpleNamespace(hex=token)), \
                     patch.object(clone, "run", side_effect=[container_id, start_result]), \
                     patch.object(clone.subprocess, "run", side_effect=process_results) as process:
                    with self.assertRaises(expected):
                        clone.docker_clone(Path("/private/backup.dump"), Path("/private/migration.sql"), 4096)
                self.assertEqual(process.call_args_list[2].args[0],
                                 ["/usr/bin/docker", "rm", "-f", "-v", container_id])


@unittest.skipUnless(all(shutil.which(name) for name in
                         ("initdb", "pg_ctl", "createdb", "pg_dump", "pg_restore", "psql")),
                     "PostgreSQL binaries unavailable")
class VoicemailClonePostgres(unittest.TestCase):
    def test_real_backup_restore_migration_and_receipt(self):
        with tempfile.TemporaryDirectory(prefix="phone11-vm-test-") as d:
            root = Path(d)
            private = root / "private"
            private.mkdir(mode=0o700)
            data = root / "source-data"
            socket = root / "source-socket"
            socket.mkdir(mode=0o700)
            port = clone.free_port()
            env = os.environ.copy()
            for name in ("PGOPTIONS", "PGHOST", "PGPORT", "PGUSER", "PGDATABASE", "PGPASSWORD"):
                env.pop(name, None)
            def command(args):
                return subprocess.run(args, env=env, check=True, text=True,
                                      stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout
            command(["initdb", "-D", str(data), "-U", "phone11_clone", "--auth-local=trust",
                     "--auth-host=reject", "--no-locale", "-E", "UTF8"])
            command(["pg_ctl", "-D", str(data), "-o", f"-k {socket} -p {port} -c listen_addresses=",
                     "-l", str(root / "source.log"), "start"])
            try:
                command(["createdb", "-h", str(socket), "-p", str(port), "-U", "phone11_clone", "phone11_clone"])
                schema = """
                CREATE TABLE users (id integer PRIMARY KEY);
                CREATE TABLE tenants (id integer PRIMARY KEY);
                CREATE TABLE extensions (id integer PRIMARY KEY, tenant_id integer NOT NULL REFERENCES tenants(id),
                  user_id integer REFERENCES users(id), extension_number text NOT NULL, status text NOT NULL,
                  deleted_at timestamptz, voicemail_enabled boolean NOT NULL DEFAULT false);
                CREATE TABLE user_extensions (user_id integer NOT NULL, extension_id integer NOT NULL);
                CREATE TABLE tenant_memberships (user_id integer NOT NULL, tenant_id integer NOT NULL, status text NOT NULL);
                INSERT INTO users VALUES (17);
                INSERT INTO tenants VALUES (12);
                INSERT INTO extensions VALUES (42,12,17,'3001','active',NULL,false);
                INSERT INTO user_extensions VALUES (17,42);
                INSERT INTO tenant_memberships VALUES (17,12,'active');
                """
                command(["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-h", str(socket),
                         "-p", str(port), "-U", "phone11_clone", "-d", "phone11_clone", "-c", schema])
                backup = private / "backup.dump"
                with backup.open("wb") as stream:
                    subprocess.run(["pg_dump", "-Fc", "-h", str(socket), "-p", str(port),
                                    "-U", "phone11_clone", "-d", "phone11_clone"],
                                   env=env, stdout=stream, stderr=subprocess.PIPE, check=True)
                os.chmod(backup, 0o600)
                digest = clone.digest_regular_private(backup, archive=True)
                receipt = private / "receipt.json"
                with patch.dict(os.environ, {"PGOPTIONS": "-c default_transaction_read_only=on"}):
                    result = clone.validate_clone(backup, digest, receipt)
                self.assertEqual(result["extension_rows_before"], 1)
                self.assertEqual(result["extension_rows_after"], 1)
                self.assertTrue(all(result["post_catalog"].values()))
                self.assertEqual(receipt.stat().st_mode & 0o777, 0o600)
                with self.assertRaisesRegex(clone.ValidationError, "receipt_exists"):
                    clone.validate_clone(backup, digest, receipt)
                with self.assertRaisesRegex(clone.ValidationError, "backup_digest"):
                    clone.validate_clone(backup, "0" * 64, private / "other.json")
                command(["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-h", str(socket),
                         "-p", str(port), "-U", "phone11_clone", "-d", "phone11_clone", "-c",
                         "CREATE FUNCTION phone11_voicemail_owner_epoch_rotate() RETURNS trigger "
                         "LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END'"])
                occupied = private / "occupied.dump"
                with occupied.open("wb") as stream:
                    subprocess.run(["pg_dump", "-Fc", "-h", str(socket), "-p", str(port),
                                    "-U", "phone11_clone", "-d", "phone11_clone"],
                                   env=env, stdout=stream, stderr=subprocess.PIPE, check=True)
                os.chmod(occupied, 0o600)
                with self.assertRaisesRegex(clone.ValidationError, "pre_catalog"):
                    clone.validate_clone(occupied, clone.digest_regular_private(occupied, archive=True),
                                         private / "occupied-receipt.json")
            finally:
                subprocess.run(["pg_ctl", "-D", str(data), "-m", "immediate", "stop"],
                               env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == "__main__":
    unittest.main()
