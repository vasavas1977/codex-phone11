"""PG16-only inert gates and fault paths. No native process/socket launch."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import runpy
import signal
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/phone11-pg16-policy-qualification.py'
SPEC = importlib.util.spec_from_file_location('phone11_pg16_qualification', SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class Pg16QualificationGuards(unittest.TestCase):
    def test_default_cli_never_probes_native_tools_socket_or_creates_cluster(self):
        output = io.StringIO()
        with patch.object(sys, 'argv', [str(SCRIPT)]), contextlib.redirect_stdout(output), \
                patch('subprocess.run', side_effect=AssertionError('native run forbidden')), \
                patch('subprocess.Popen', side_effect=AssertionError('child launch forbidden')), \
                patch('subprocess.check_output', side_effect=AssertionError('native probe forbidden')), \
                patch('socket.socket', side_effect=AssertionError('socket forbidden')), \
                patch('tempfile.mkdtemp', side_effect=AssertionError('cluster directory forbidden')):
            runpy.run_path(str(SCRIPT), run_name='__main__')
        plan = json.loads(output.getvalue())
        self.assertEqual(plan['mode'], 'PLAN_ONLY_NO_LAUNCH')
        self.assertTrue(plan['heldUntilRootDispatch'])
        self.assertEqual((plan['bind'], plan['port'], plan['database']), ('127.0.0.1', 55436, 'phone11_pbx_test'))
        self.assertEqual(plan['postgresVersion'], '16.13')
        self.assertEqual(plan['expectedPassedTests'], 67)
        self.assertEqual(plan['testFiles'], list(MODULE.TESTS) + [MODULE.HTTP_TEST])

    def test_root_and_missing_external_pin_refuse_before_effects(self):
        with patch.object(MODULE.os, 'geteuid', return_value=0), patch.object(MODULE.subprocess, 'Popen') as launch:
            with self.assertRaisesRegex(RuntimeError, 'never root'):
                MODULE.run(None, None)
        launch.assert_not_called()
        with patch.object(MODULE.os, 'geteuid', return_value=501), patch.object(MODULE.socket, 'socket') as sock:
            for path, digest in [(None, None), ('unused', 'bad'), ('unused', 'A' * 64)]:
                with self.assertRaisesRegex(RuntimeError, 'exact reviewed'):
                    MODULE.run(path, digest)
        sock.assert_not_called()

    def test_external_manifest_hash_cannot_be_replaced_by_self_assertion(self):
        with tempfile.TemporaryDirectory(prefix='p11-inert-pg16-') as directory:
            path = Path(directory) / 'manifest.json'
            path.write_text('{}')
            with patch.object(MODULE.os, 'geteuid', return_value=501), patch.object(MODULE.subprocess, 'Popen') as launch:
                with self.assertRaisesRegex(RuntimeError, 'SHA256 does not match'):
                    MODULE.run(str(path), '0' * 64)
            launch.assert_not_called()

    def manifest(self, root):
        value = {'sha256': 'a' * 64, 'bytes': 1}
        return {'kind': 'PHONE11_GENERATED_PG16_QUALIFICATION_SOURCE', 'root': str(root),
                'postgresVersion': MODULE.VERSION, 'sourceTarballSha256': MODULE.TARBALL_SHA256,
                'qualificationScope': MODULE.SCOPE,
                'source': {name: value for name in MODULE.SOURCES + MODULE.HTTP_SOURCES},
                'tools': {str(path): value for path in MODULE.TOOLS + MODULE.LIBRARIES},
                'dependencies': {str(path): value for path in MODULE.DEPENDENCIES + MODULE.HTTP_DEPENDENCIES}}

    def check_refusal(self, manifest_change=None, versions=None, message=''):
        with tempfile.TemporaryDirectory(prefix='p11-inert-pg16-') as directory:
            root = Path(directory)
            manifest = self.manifest(root)
            if manifest_change:
                manifest_change(manifest)
            path = root / 'manifest.json'
            content = json.dumps(manifest).encode()
            path.write_bytes(content)
            with patch.object(MODULE, 'ROOT', root), patch.object(MODULE.os, 'geteuid', return_value=501), \
                    patch.object(MODULE, 'pin', return_value={'sha256': 'a' * 64, 'bytes': 1}), \
                    patch.object(MODULE.subprocess, 'check_output', side_effect=versions) as probe, \
                    patch.object(MODULE.subprocess, 'Popen') as launch, patch.object(MODULE.socket, 'socket') as sock:
                with self.assertRaisesRegex(RuntimeError, message):
                    MODULE.run(str(path), hashlib.sha256(content).hexdigest())
            launch.assert_not_called()
            sock.assert_not_called()
            return probe.call_count

    def test_historical_pg17_manifest_and_partial_scope_cannot_launch(self):
        for change, message in [
            (lambda m: m.update(kind='PHONE11_GENERATED_NATIVE_REHEARSAL_SOURCE'), 'Wrong reviewed'),
            (lambda m: m.update(postgresVersion='17.11'), 'source/version pin'),
            (lambda m: m.update(sourceTarballSha256='0' * 64), 'source/version pin'),
            (lambda m: m.update(qualificationScope='generated-http-auth-only'), 'qualification scope'),
            (lambda m: m['source'].pop(MODULE.HTTP_TEST), 'set is not exact'),
            (lambda m: m['source'].pop('server/pbx/protected-outbound-routing.ts'), 'set is not exact'),
            (lambda m: m['tools'].pop(str(MODULE.LIBRARIES[0])), 'set is not exact'),
            (lambda m: m['dependencies'].pop(str(MODULE.HTTP_DEPENDENCIES[0])), 'donor entry set'),
        ]:
            with self.subTest(message=message):
                self.assertEqual(self.check_refusal(change, [], message), 0)

    def test_only_exact_pg16_patch_version_accepted_before_socket(self):
        for version in ['postgres (PostgreSQL) 17.11\n', 'postgres (PostgreSQL) 16.12\n', 'postgres (PostgreSQL) 16.13-custom\n']:
            with self.subTest(version=version):
                self.assertEqual(self.check_refusal(versions=[version], message='16.13 toolchain'), 1)

    def test_build_flags_must_keep_zlib_and_fixed_prefix(self):
        base = '--without-readline --without-icu --prefix=' + str(MODULE.TOOLCHAIN)
        for flags in [base + ' --without-zlib', base.replace('--without-icu', ''), base.replace(str(MODULE.TOOLCHAIN), '/other')]:
            with self.subTest(flags=flags):
                self.assertEqual(self.check_refusal(versions=['postgres (PostgreSQL) 16.13\n', flags], message='build feature contract'), 2)

    def test_all_actual_sql_handler_http_and_auth_sources_are_pinned_once(self):
        names = MODULE.SOURCES + MODULE.HTTP_SOURCES
        self.assertEqual(len(set(names)), len(names))
        for name in ['vitest.config.ts', 'package.json', 'pnpm-lock.yaml', 'server/pbx/fraud-policy-db.ts',
                     'server/pbx/js-postgres-driver.ts', 'server/pbx/js-postgres-driver-types.d.ts',
                     'server/pbx/pbx-router.ts', 'server/_core/phone11-auth.ts', 'server/_core/auth-routes.ts',
                     'server/_core/context.ts', MODULE.HTTP_TEST]:
            self.assertIn(name, names)
        self.assertEqual(len(MODULE.TESTS), 4)
        self.assertIn(MODULE.DONOR / 'better-auth/dist/index.mjs', MODULE.HTTP_DEPENDENCIES)
        self.assertIn(MODULE.DONOR / 'pg/lib/client.js', MODULE.DEPENDENCIES)
        self.assertIn(MODULE.DONOR / 'pg/lib/connection.js', MODULE.DEPENDENCIES)

    def test_http_gate_major_is_strict_and_fixed_endpoint_stays_explicit(self):
        source = (MODULE.ROOT / MODULE.HTTP_TEST).read_text()
        self.assertIn('PHONE11_PBX_TEST_SERVER_MAJOR ?? "17"', source)
        self.assertIn('expectedServerMajor !== "16" && expectedServerMajor !== "17"', source)
        for bound in ['target.hostname !== "127.0.0.1"', 'target.port !== "55436"',
                      'target.pathname !== "/phone11_pbx_test"', 'target.username !== "phone11_fixture_owner"']:
            self.assertIn(bound, source)
        self.assertNotIn('SERVER_MAJOR: "17"', source)
        self.assertIn('major: Number(expectedServerMajor)', source)

    def test_cleanup_failure_still_stops_owned_child_and_exclusively_seals_receipt(self):
        with tempfile.TemporaryDirectory(prefix='p11-inert-pg16-') as directory:
            lab = Path(directory)
            child = Mock()
            child.poll.return_value = None
            child.wait.return_value = 0
            receipt = {'stopped': False, 'error': None}
            with patch.object(MODULE, 'cleanup_owned_link', side_effect=OSError('generated fault')):
                MODULE.finish_resources(child, lab, receipt, True, (1, 2, 501))
            child.send_signal.assert_called_once_with(signal.SIGINT)
            child.wait.assert_called_once_with(timeout=15)
            child.kill.assert_not_called()
            self.assertTrue(receipt['stopped'])
            self.assertFalse(receipt['temporaryLinkRemoved'])
            path = lab / 'receipt.json'
            self.assertEqual(path.stat().st_mode & 0o777, 0o400)
            self.assertEqual(json.loads(path.read_text()), receipt)
            with self.assertRaises(FileExistsError):
                MODULE.finish_resources(None, lab, {'error': None}, False, None)

    def test_exited_owned_child_never_signalled(self):
        with tempfile.TemporaryDirectory(prefix='p11-inert-pg16-') as directory:
            child = Mock()
            child.poll.return_value = child.wait.return_value = 1
            receipt = {'stopped': False, 'error': None}
            MODULE.finish_resources(child, Path(directory), receipt, False, None)
            child.send_signal.assert_not_called()
            self.assertEqual(receipt['error'], 'OWNED_CLUSTER_EXITED_UNEXPECTEDLY')

    def test_stop_timeout_preserves_without_kill_or_blind_retry(self):
        with tempfile.TemporaryDirectory(prefix='p11-inert-pg16-') as directory:
            child = Mock()
            child.poll.return_value = None
            child.wait.side_effect = subprocess.TimeoutExpired('generated', 15)
            receipt = {'stopped': False, 'error': None}
            MODULE.finish_resources(child, Path(directory), receipt, False, None)
            child.send_signal.assert_called_once_with(signal.SIGINT)
            child.wait.assert_called_once_with(timeout=15)
            child.kill.assert_not_called()
            child.terminate.assert_not_called()
            self.assertFalse(receipt['stopped'])
            self.assertIn('stopError', receipt)
            self.assertTrue((Path(directory) / 'receipt.json').is_file())


if __name__ == '__main__':
    unittest.main()
