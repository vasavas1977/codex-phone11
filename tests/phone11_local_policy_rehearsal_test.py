"""Inert guards and owned-child fault paths; no PG/Node/socket/service launch."""
import contextlib
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

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/phone11-local-policy-rehearsal.py'
SPEC = importlib.util.spec_from_file_location('phone11_policy_rehearsal', SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class LauncherGuards(unittest.TestCase):
    def test_default_cli_prints_plan_without_native_socket_or_cluster_effects(self):
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
        self.assertTrue(plan['heldUntilApproval'])
        self.assertEqual((plan['bind'], plan['port'], plan['database']), ('127.0.0.1', 55436, 'phone11_pbx_test'))
        self.assertIn('--manifest-sha256', plan['commandAfterSpecificApproval'])

    def test_root_refuses_before_native_operation(self):
        with patch.object(MODULE.os, 'geteuid', return_value=0), patch.object(MODULE.subprocess, 'Popen') as launch:
            with self.assertRaisesRegex(RuntimeError, 'never root'):
                MODULE.run(None, None)
        launch.assert_not_called()

    def test_external_pin_required_before_native_or_socket_effect(self):
        with patch.object(MODULE.os, 'geteuid', return_value=501), \
                patch.object(MODULE.subprocess, 'Popen') as launch, patch.object(MODULE.socket, 'socket') as sock:
            for path, digest in [(None, None), ('unused', 'bad'), ('unused', 'A' * 64)]:
                with self.assertRaisesRegex(RuntimeError, 'exact reviewed'):
                    MODULE.run(path, digest)
        launch.assert_not_called()
        sock.assert_not_called()

    def test_manifest_hash_refuses_before_loading_or_launching(self):
        with tempfile.TemporaryDirectory(prefix='p11-inert-') as directory:
            manifest = Path(directory) / 'manifest.json'
            manifest.write_text('{}')
            with patch.object(MODULE.os, 'geteuid', return_value=501), patch.object(MODULE.subprocess, 'Popen') as launch:
                with self.assertRaisesRegex(RuntimeError, 'SHA256 does not match'):
                    MODULE.run(str(manifest), '0' * 64)
            launch.assert_not_called()

    def test_implicitly_executed_vitest_and_package_metadata_are_in_approved_source_set(self):
        for name in ('vitest.config.ts', 'package.json', 'pnpm-lock.yaml'):
            self.assertIn(name, MODULE.SOURCES)
        self.assertEqual(len(set(MODULE.SOURCES)), len(MODULE.SOURCES))

    def test_http_scope_is_separate_and_pins_actual_authentication_sources(self):
        self.assertNotIn(MODULE.HTTP_TEST, MODULE.TESTS)
        self.assertIn(MODULE.HTTP_TEST, MODULE.HTTP_SOURCES)
        for name in ('server/_core/context.ts', 'server/_core/sdk.ts',
                     'server/_core/auth-routes.ts', 'server/_core/phone11-auth.ts'):
            self.assertIn(name, MODULE.HTTP_SOURCES)
        self.assertEqual(len(set(MODULE.SOURCES + MODULE.HTTP_SOURCES)),
                         len(MODULE.SOURCES + MODULE.HTTP_SOURCES))
        self.assertIn(MODULE.DONOR / 'better-auth/dist/index.mjs', MODULE.HTTP_DEPENDENCIES)
        self.assertIn(MODULE.DONOR / '@trpc/server/dist/adapters/express.mjs', MODULE.HTTP_DEPENDENCIES)

    def test_http_scope_requires_its_own_external_manifest_before_launch(self):
        with tempfile.TemporaryDirectory(prefix='p11-inert-') as directory:
            manifest = Path(directory) / 'manifest.json'
            manifest.write_text(json.dumps({
                'kind': 'PHONE11_GENERATED_NATIVE_REHEARSAL_SOURCE',
                'root': str(MODULE.ROOT), 'qualificationScope': 'storage-and-handlers',
            }))
            digest = MODULE.pin(manifest)['sha256']
            with patch.object(MODULE.os, 'geteuid', return_value=501), \
                    patch.object(MODULE.subprocess, 'Popen') as launch, \
                    patch.object(MODULE.socket, 'socket') as sock:
                with self.assertRaisesRegex(RuntimeError, 'qualification scope'):
                    MODULE.run(str(manifest), digest, http_auth_only=True)
            launch.assert_not_called()
            sock.assert_not_called()

    def test_unlink_error_is_finite_and_preserves_generated_link(self):
        with tempfile.TemporaryDirectory(prefix='p11-inert-') as directory:
            root = Path(directory)
            link = root / 'node_modules'
            link.symlink_to(MODULE.DONOR)
            st = link.lstat()
            with patch.object(MODULE, 'ROOT', root), patch.object(Path, 'unlink', side_effect=OSError('generated fault')):
                removed, error = MODULE.cleanup_owned_link((st.st_dev, st.st_ino, st.st_uid))
            self.assertFalse(removed)
            self.assertIn('UNCONFIRMED', error)
            self.assertTrue(link.is_symlink())

    def test_replaced_link_is_not_removed(self):
        with tempfile.TemporaryDirectory(prefix='p11-inert-') as directory:
            root = Path(directory)
            link = root / 'node_modules'
            link.symlink_to(MODULE.DONOR)
            st = link.lstat()
            with patch.object(MODULE, 'ROOT', root):
                removed, error = MODULE.cleanup_owned_link((st.st_dev, st.st_ino + 1, st.st_uid))
            self.assertFalse(removed)
            self.assertIn('REPLACED', error)
            self.assertTrue(link.is_symlink())

    def test_cleanup_fault_cannot_skip_owned_child_stop_and_receipt(self):
        with tempfile.TemporaryDirectory(prefix='p11-inert-') as directory:
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
            self.assertEqual(json.loads((lab / 'receipt.json').read_text()), receipt)

    def test_already_exited_child_never_signals_a_reused_pid(self):
        with tempfile.TemporaryDirectory(prefix='p11-inert-') as directory:
            child = Mock()
            child.poll.return_value = 1
            child.wait.return_value = 1
            receipt = {'stopped': False, 'error': None}
            MODULE.finish_resources(child, Path(directory), receipt, False, None)
            child.send_signal.assert_not_called()
            self.assertTrue(receipt['stopped'])
            self.assertEqual(receipt['error'], 'OWNED_CLUSTER_EXITED_UNEXPECTEDLY')

    def test_stop_timeout_preserves_without_kill_or_retry(self):
        with tempfile.TemporaryDirectory(prefix='p11-inert-') as directory:
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
