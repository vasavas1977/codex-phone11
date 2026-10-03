"""Focused fail-closed checks for the source-only photo migration operator."""

import importlib.util
import json
from contextlib import nullcontext
from pathlib import Path
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "phone11_profile_photo_migrate", ROOT / "scripts/phone11-profile-photo-migrate.py"
)
assert SPEC and SPEC.loader
migrate = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(migrate)


class PhotoMigrationTests(unittest.TestCase):
    def test_catalog_requires_both_tables_absent_before_apply(self):
        absent = {"database": "phone11ai", "server_version": 160000,
                  "tenants": True, "users": True, "photos": False,
                  "deletions": False, "columns": [], "constraints": [], "indexes": []}
        migrate.validate_catalog(absent, present=False)
        for changed in ({"photos": True}, {"deletions": True},
                        {"columns": ["unexpected"]}, {"users": False}):
            with self.subTest(changed=changed), self.assertRaises(migrate.MigrationError):
                migrate.validate_catalog({**absent, **changed}, present=False)

    def test_catalog_rejects_partial_or_unreviewed_after_schema(self):
        constraints = ["photos.PRIMARY KEY", "deletions.PRIMARY KEY",
                       "photos.FOREIGN KEY REFERENCES tenants(id)",
                       "photos.FOREIGN KEY REFERENCES users(id)",
                       "deletions.FOREIGN KEY REFERENCES tenants(id)",
                       "deletions.FOREIGN KEY REFERENCES users(id)"] + ["CHECK (x)" for _ in range(6)]
        # The SQL also declares the version uniqueness constraint.
        constraints.append("photos.UNIQUE (tenant_id, user_id, version)")
        good = {"database": "postgres", "server_version": 160000,
                "tenants": True, "users": True, "photos": True,
                "deletions": True, "columns": sorted(migrate.EXPECTED_COLUMNS),
                "constraints": constraints, "indexes": sorted(migrate.EXPECTED_INDEXES)}
        migrate.validate_catalog(good, present=True)
        for changed in ({"columns": good["columns"][:-1]},
                        {"indexes": good["indexes"][:-1]},
                        {"constraints": constraints[:-1]},
                        {"server_version": 170000}):
            with self.subTest(changed=changed), self.assertRaises(migrate.MigrationError):
                migrate.validate_catalog({**good, **changed}, present=True)

    def test_connection_settings_are_private_and_removed(self):
        values = {"PG_HOST": "db.internal", "PG_PORT": "5432", "PG_USER": "phone11ai",
                  "PG_PASSWORD": "secret-example", "PG_DATABASE": "phone11ai",
                  "PG_SSL": "false", "PG_SSL_REJECT_UNAUTHORIZED": "false"}
        with tempfile.TemporaryDirectory() as folder:
            with migrate.connection_env(values, Path(folder)) as env_file:
                raw = env_file.read_text()
                self.assertIn("PGPASSWORD=secret-example", raw)
                self.assertIn("PGSSLMODE=disable", raw)
                self.assertEqual(env_file.stat().st_mode & 0o777, 0o600)
            self.assertFalse(env_file.exists())
            with self.assertRaises(migrate.MigrationError):
                with migrate.connection_env({**values, "PG_PASSWORD": "a\nB"}, Path(folder)):
                    pass

    def test_candidate_must_match_exact_routed_container(self):
        class Args:
            candidate_id = "a" * 64
            candidate_image = "sha256:" + "b" * 64
            network = "cloudphone11-prod_cp11-net"

        candidate = [{"Id": Args.candidate_id, "Name": "/cp11-api-candidate-channel",
                      "Image": Args.candidate_image,
                      "State": {"Running": True, "Health": {"Status": "healthy"}},
                      "NetworkSettings": {"Networks": {Args.network: {}}},
                      "Config": {"Env": ["PG_HOST=db", "PG_PORT=5432", "PG_USER=phone11ai",
                                         "PG_PASSWORD=secret-example", "PG_DATABASE=phone11ai"]}}]
        with mock.patch.object(migrate, "run", return_value=json.dumps(candidate).encode()):
            self.assertEqual(migrate.inspect_candidate(Args())["PG_HOST"], "db")
            bad = json.loads(json.dumps(candidate))
            bad[0]["Image"] = "sha256:" + "c" * 64
            with mock.patch.object(migrate, "run", return_value=json.dumps(bad).encode()):
                with self.assertRaises(migrate.MigrationError):
                    migrate.inspect_candidate(Args())
            overridden = json.loads(json.dumps(candidate))
            overridden[0]["Config"]["Env"].append("PG_CONNECTION_STRING=postgres://other")
            with mock.patch.object(migrate, "run", return_value=json.dumps(overridden).encode()):
                with self.assertRaises(migrate.MigrationError):
                    migrate.inspect_candidate(Args())

    def test_failed_command_does_not_expose_stderr_secret(self):
        result = mock.Mock(returncode=1, stdout=b"", stderr=b"PGPASSWORD=do-not-print")
        with mock.patch.object(migrate.subprocess, "run", return_value=result):
            with self.assertRaises(migrate.MigrationError) as failure:
                migrate.run("false")
        self.assertEqual(str(failure.exception), "command_failed")
        self.assertNotIn("do-not-print", str(failure.exception))

    def test_psql_json_database_oid_is_a_decimal_string(self):
        class Args:
            network = "private"
            pg16_image = "sha256:" + "a" * 64

        identity = {"database": "phone11ai", "user": "phone11ai",
                    "server_addr": "127.0.0.1", "server_port": 5432,
                    "database_oid": "16384"}
        with mock.patch.object(migrate, "run", return_value=json.dumps(identity).encode()):
            self.assertEqual(migrate.live_identity(Args(), Path("/tmp/env"), Path("/tmp/evidence")), identity)
        identity["database_oid"] = "bad"
        with mock.patch.object(migrate, "run", return_value=json.dumps(identity).encode()):
            with self.assertRaises(migrate.MigrationError):
                migrate.live_identity(Args(), Path("/tmp/env"), Path("/tmp/evidence"))

    def test_live_catalog_assertion_precedes_the_only_commit(self):
        source = (ROOT / "server/profile/photo-migration.sql").read_bytes()
        expected = {"photos": True, "deletions": True}
        generated = migrate.transactional_sql(source, expected).decode()
        self.assertEqual(generated.count("COMMIT;"), 1)
        self.assertLess(generated.index("photo_catalog_mismatch"), generated.index("COMMIT;"))
        self.assertIn("SET LOCAL lock_timeout='2s'", generated)
        self.assertIn("CREATE TABLE IF NOT EXISTS phone11_workspace_profile_photos", generated)
        with self.assertRaises(migrate.MigrationError):
            migrate.transactional_sql(b"BEGIN;\nSELECT 1;\nCOMMIT;\n", expected)

    def test_client_image_requires_immutable_digest(self):
        class Args:
            network = "private"
            pg16_image = "postgres:16"

        with self.assertRaises(migrate.MigrationError):
            migrate.client_args(Args(), Path("/tmp/env"), Path("/tmp/evidence"))
        Args.pg16_image = "sha256:" + "a" * 64
        command = migrate.client_args(Args(), Path("/tmp/env"), Path("/tmp/evidence"))
        self.assertEqual(command[-1], Args.pg16_image)
        self.assertTrue(any(part.endswith(",readonly") for part in command))

    def test_prepare_requires_second_independent_restore_of_exact_apply_script(self):
        source = (ROOT / "server/profile/photo-migration.sql").read_bytes()
        before = {"database": "phone11ai", "server_version": 160000,
                  "tenants": True, "users": True, "photos": False,
                  "deletions": False, "columns": [], "constraints": [], "indexes": []}
        after = {**before, "database": "postgres", "photos": True, "deletions": True}

        class Args:
            candidate_id = "a" * 64
            candidate_image = "sha256:" + "b" * 64
            network = "private"
            pg16_image = "sha256:" + "c" * 64
            sql_sha256 = migrate.sha(source)

        for second_fails in (False, True):
            with self.subTest(second_fails=second_fails), tempfile.TemporaryDirectory() as folder:
                evidence = Path(folder)
                Args.evidence = evidence
                Args.sql = evidence / "source.sql"
                Args.sql.write_bytes(source)

                def fake_run(*parts, **_kwargs):
                    if "pg_dump" in " ".join(parts):
                        (evidence / ".backup.dump.tmp").write_bytes(b"backup")
                    return b""

                def fake_secure(path, limit):
                    if path == evidence / ".backup.dump.tmp":
                        return b"backup"
                    return path.read_bytes()

                result = [after, migrate.MigrationError("exact_rehearsal_failed") if second_fails else after]
                with mock.patch.object(migrate, "secure_directory"), \
                     mock.patch.object(migrate, "secure_file", side_effect=fake_secure), \
                     mock.patch.object(migrate, "inspect_candidate", return_value={}), \
                     mock.patch.object(migrate, "probe_route"), \
                     mock.patch.object(migrate, "connection_env", return_value=nullcontext(evidence / "env")), \
                     mock.patch.object(migrate, "live_identity", return_value={"database": "phone11ai"}), \
                     mock.patch.object(migrate, "live_catalog", return_value=before), \
                     mock.patch.object(migrate, "client_args", return_value=["docker"]), \
                     mock.patch.object(migrate, "run", side_effect=fake_run), \
                     mock.patch.object(migrate, "isolated_rehearsal", side_effect=result) as rehearsal:
                    if second_fails:
                        with self.assertRaises(migrate.MigrationError):
                            migrate.prepare(Args())
                        self.assertFalse((evidence / "proof.json").exists())
                    else:
                        migrate.prepare(Args())
                        proof = json.loads((evidence / "proof.json").read_text())
                        exact = (evidence / "rehearsed-apply.sql").read_bytes()
                        self.assertEqual(proof["apply_sql_sha256"], migrate.sha(exact))
                        self.assertEqual(exact, migrate.transactional_sql(source, proof["restored_shape"]))
                    self.assertEqual(rehearsal.call_count, 2)
                    self.assertEqual(rehearsal.call_args_list[0].args[2], "photo.sql")
                    self.assertEqual(rehearsal.call_args_list[1].args[2], "rehearsed-apply.sql")


if __name__ == "__main__":
    unittest.main()
