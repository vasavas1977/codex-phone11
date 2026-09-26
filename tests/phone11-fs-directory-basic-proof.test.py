#!/usr/bin/env python3
"""Local fixture guards; runtime FreeSWITCH proof is a separate gate."""
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from xml.etree import ElementTree


SOURCE = Path(__file__).with_name("phone11-fs-directory-basic-proof.py")
SPEC = importlib.util.spec_from_file_location("basic_proof", SOURCE)
assert SPEC and SPEC.loader
proof = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(proof)


class BasicFixtureTests(unittest.TestCase):
    def test_preprocessor_directives_have_their_own_lines(self):
        files = proof.fixture()
        for path in ("conf/freeswitch.xml", "conf/vars.xml"):
            xml = files[path][0].decode()
            for line in xml.splitlines():
                if "<X-PRE-PROCESS" in line:
                    self.assertTrue(line.strip().startswith("<X-PRE-PROCESS "), path)
                    self.assertTrue(line.strip().endswith("/>"), path)
        self.assertIn("<section name=\"configuration\">\n<X-PRE-PROCESS", 
                      files["conf/freeswitch.xml"][0].decode())

    def test_effective_xml_requires_only_intended_modules(self):
        modules = proof.fixture()["conf/autoload_configs/modules.conf.xml"][0].decode()
        good = f'<document type="freeswitch/xml"><section name="configuration">{modules}</section></document>'
        proof.validate_effective_xml(good)
        for broken in (
            '<document type="freeswitch/xml"><section name="configuration"/></document>',
            f'<document type="freeswitch/xml"><section name="configuration">{modules}</section><section name="configuration"/></document>',
            good.replace("mod_xml_curl", "mod_sofia"),
        ):
            with self.assertRaises(proof.Blocked):
                proof.validate_effective_xml(broken)

    def test_fixture_contains_no_sip_profile_or_host_mount(self):
        files = proof.fixture()
        self.assertFalse(any("sofia" in key or "sip_profiles" in key for key in files))
        self.assertIn(b'auth-scheme" value="=basic"',
                      files["conf/autoload_configs/xml_curl.conf.xml"][0])
        self.assertNotIn(b"?secret=", files["conf/autoload_configs/xml_curl.conf.xml"][0])

    def test_cgi_diagnostic_records_shape_without_body_or_auth(self):
        with tempfile.TemporaryDirectory() as directory:
            cgi = Path(directory) / "directory.cgi"
            diagnostic = Path(directory) / "diagnostic.log"
            cgi.write_bytes(proof.fixture()["www/cgi-bin/directory.cgi"][0])
            cgi.chmod(0o700)
            body = b"section=directory&user=3001&domain=probe.invalid"
            env = dict(os.environ, REQUEST_METHOD="POST",
                       CONTENT_TYPE="application/x-www-form-urlencoded",
                       CONTENT_LENGTH=str(len(body)), PROBE_DIAGNOSTIC_PATH=str(diagnostic))
            result = subprocess.run([str(cgi)], input=body, capture_output=True, env=env)
            self.assertEqual(result.returncode, 0)
            self.assertTrue(result.stdout.startswith(b"Content-Type: text/xml"))
            payload = result.stdout.partition(b"\r\n\r\n")[2]
            self.assertTrue(payload.startswith(
                b'<?xml version="1.0" encoding="UTF-8"?>\n<document '))
            # FreeSWITCH 1.10.12 discards an entire line containing `<?`
            # during preprocessing. Its remaining lines must still be XML.
            compiled = b"\n".join(line for line in payload.splitlines() if b"<?" not in line)
            self.assertEqual(ElementTree.fromstring(compiled).tag, "document")
            recorded = diagnostic.read_text()
            self.assertIn("user_shape=expected domain_shape=expected", recorded)
            self.assertIn("decision=ok", recorded)
            self.assertNotIn("3001", recorded)
            self.assertNotIn("probe.invalid", recorded)

    def test_diagnostic_http_request_has_valid_synthetic_form(self):
        with patch.object(proof, "run", return_value=b"HTTP/1.1 200 OK\r\n") as run:
            proof.synthetic_http_post("synthetic-container", "Basic synthetic-test")
        args, kwargs = run.call_args
        request = kwargs["data"]
        self.assertEqual(args[0][0:4], ["docker", "exec", "-i", "synthetic-container"])
        self.assertIn(b"Content-Length: 30\r\n", request)
        self.assertTrue(request.endswith(b"\r\n\r\nuser=3001&domain=probe.invalid"))
        self.assertIn(b"Authorization: Basic synthetic-test\r\n", request)
        self.assertNotIn(b"?secret=", request)

    def test_probe_tmpfs_requires_exec_for_cgi(self):
        proof.validate_probe_tmpfs({"Tmpfs": {"/probe": proof.PROBE_TMPFS}})
        for options in ("rw,nosuid,nodev,size=64m",
                        "rw,nosuid,nodev,noexec,size=64m",
                        "rw,nosuid,nodev,size=64m,exec,noexec"):
            with self.assertRaisesRegex(proof.Blocked, "probe_tmpfs"):
                proof.validate_probe_tmpfs({"Tmpfs": {"/probe": options}})

    def test_status_and_rotation_fails_closed(self):
        self.assertEqual(proof.http_status(b"HTTP/1.1 401 Unauthorized\r\n"), 401)
        self.assertEqual(proof.http_status(b"HTTP/1.0 200 OK\r\n"), 200)
        with self.assertRaisesRegex(proof.Blocked, "http_status"):
            proof.http_status(b"not an HTTP status")
        self.assertNotEqual(proof.PASSWORD, proof.ROTATED_PASSWORD)
        self.assertNotIn(proof.PASSWORD, proof.ROTATED_PASSWORD)
        with self.assertRaisesRegex(proof.Blocked, "clone_write_path"):
            proof.write_clone_file("synthetic-container", "/probe/other", b"test")

    def test_failed_command_reports_safe_stage_without_arguments(self):
        command = ["docker", "exec", "synthetic-container", "echo", "private-value"]
        failed = subprocess.CompletedProcess(command, 1, b"", b"private-stderr")
        with patch.object(proof.subprocess, "run", return_value=failed):
            with self.assertRaisesRegex(proof.Blocked,
                                        "^command_failed:pidof_freeswitch$") as result:
                proof.run(command, stage="pidof_freeswitch")
        self.assertNotIn("private-value", str(result.exception))
        self.assertNotIn("private-stderr", str(result.exception))

    def test_httpd_starts_through_private_applet_symlink(self):
        with patch.object(proof, "run", return_value=b"") as run:
            proof.start_httpd("synthetic-container")
        args, kwargs = run.call_args
        self.assertEqual(args[0][0:5],
                         ["docker", "exec", "-d", "synthetic-container", "/probe/httpd"])
        self.assertNotIn("busybox", args[0][4:])
        self.assertEqual(kwargs["stage"], "start_httpd")

    def test_response_capture_rejects_outside_or_ambiguous_paths(self):
        with patch.object(proof, "run", return_value=b"/tmp/a.tmp.xml\n"):
            self.assertEqual(proof.response_paths("synthetic-container"), ["/tmp/a.tmp.xml"])
        for value in (b"/etc/passwd.tmp.xml\n", b"/tmp/../etc/a.tmp.xml\n",
                      b"/tmp/not-xml\n", b"".join(
                          f"/tmp/{i}.tmp.xml\n".encode() for i in range(9))):
            with patch.object(proof, "run", return_value=value):
                with self.assertRaisesRegex(proof.Blocked, "response_paths"):
                    proof.response_paths("synthetic-container")


if __name__ == "__main__":
    unittest.main()
