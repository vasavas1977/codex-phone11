"""Fixed-start diagnostics with owned public Python children, never Docker."""
import importlib.util
import json
from pathlib import Path
import sys
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).absolute().parent.parent
spec = importlib.util.spec_from_file_location('owned_smoke_fixtures', ROOT / 'tests/phone11-backend-smoke.test.py')
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)
m = fixtures.smoke


class DiagnosticDocker(m.Docker):
    def __init__(self, foreign=False):
        with patch.object(m.shutil, 'which', return_value='/owned/docker'):
            super().__init__('/owned/empty-config', diagnose_start=True)
        self.fixture = fixtures.FakeDocker('foreign-owner' if foreign else 'pass')
        self.native = []

    def synthetic_values(self, values):
        super().synthetic_values(values)
        self.values = values
        program = ('import os,sys\n'
                   'if sys.argv[2]=="start":\n'
                   ' os.write(2,' + repr(('runc: permission denied ' + values['PHONE11_AUTH_SECRET']).encode()) + ')\n'
                   ' sys.exit(128)\n'
                   'else:\n'
                   ' os.write(1,' + repr(('OCI rlimit: ' + values['SIP_DEK_SECRET'] + '\n').encode()) + ')\n')
        self.prefix = [sys.executable, '-I', '-B', '-c', program]

    def capture_diagnostic(self, args, *limits):
        self.native.append(args)
        assert args[:2] == ['container', 'start'] or args[:4] == ['container', 'inspect', '--format', '{{.State.Error}}']
        return super().capture_diagnostic(args, *limits)

    def __call__(self, args, timeout=15):
        if args[:2] == ['container', 'start']:
            return super().__call__(args, timeout)
        raw = self.fixture(args, timeout)
        if args[:2] == ['container', 'inspect']:
            value = json.loads(raw)
            value['exitCode'] = 128
            return json.dumps(value)
        return raw

    def logs(self, _cid):
        raise AssertionError('Application logs are outside diagnostic scope')


class DiagnosticTests(unittest.TestCase):
    def test_failed_owned_start_captures_only_two_fields_and_emits_finite_redacted_flags(self):
        docker = DiagnosticDocker()
        private = []
        result = m.smoke(fixtures.COMMIT, fixtures.META, docker, private.append)
        self.assertEqual(result['status'], 'REFUSED')
        self.assertEqual(result['phase'], 'start')
        self.assertFalse(result['healthAccepted'])
        self.assertEqual(result['cleanup'], 'OWNED_CONTAINER_REMOVED')
        value = result['startDiagnostics']
        self.assertEqual(value['startExitCode'], 128)
        self.assertTrue(value['stateErrorRead'])
        self.assertTrue(value['tokens']['permissionDenied'])
        self.assertTrue(value['tokens']['ociRuntime'])
        self.assertTrue(value['tokens']['rlimit'])
        self.assertFalse(value['rootCauseEstablished'])
        self.assertEqual(len(private), 1)
        self.assertLessEqual(len(private[0]), 8192)
        for secret in docker.secrets:
            self.assertNotIn(secret, private[0])
            self.assertNotIn(secret.decode(), json.dumps(value))
        # The existing ownership nonce is public; full synthetic credential values
        # must still never occur anywhere in the finite lifecycle receipt.
        for secret in docker.secrets[:-1]:
            self.assertNotIn(secret.decode(), json.dumps(result))
        self.assertNotIn('runc: permission denied', json.dumps(result))
        self.assertEqual(len(docker.native), 2)
        self.assertEqual(docker.native[1][-1], fixtures.CID)
        self.assertEqual(docker.fixture.log_calls, [])

    def test_foreign_identity_prevents_state_error_collection_private_write_and_deletion(self):
        docker = DiagnosticDocker(foreign=True)
        private = []
        result = m.smoke(fixtures.COMMIT, fixtures.META, docker, private.append)
        self.assertEqual(result['cleanup'], 'UNKNOWN')
        self.assertEqual(len(docker.native), 1)
        self.assertEqual(private, [])
        self.assertFalse(any(args[:2] == ['container', 'rm'] for args, _ in docker.fixture.calls))

    def test_diagnostic_mode_preserves_the_exact_container_recipe(self):
        normal = fixtures.FakeDocker()
        diagnostic = DiagnosticDocker()
        with patch.object(m.secrets, 'token_hex', return_value='d' * 32):
            m.smoke(fixtures.COMMIT, fixtures.META, normal)
            m.smoke(fixtures.COMMIT, fixtures.META, diagnostic)
        create = lambda calls: next(args for args, _ in calls if args[:2] == ['container', 'create'])
        self.assertEqual(create(normal.calls), create(diagnostic.fixture.calls))

    def test_capture_caps_and_deadline_are_real_and_unknown_stays_unknown(self):
        with patch.object(m.shutil, 'which', return_value='/owned/docker'):
            for program, expected in [('import os,sys;os.write(2,b"X"*10000);sys.exit(128)', 'limit'),
                                      ('import time;time.sleep(5)', 'timeout')]:
                docker = m.Docker('/owned/config', diagnose_start=True)
                docker.prefix = [sys.executable, '-I', '-B', '-c', program]
                docker.deadline = time.monotonic() + (0.1 if expected == 'timeout' else 5)
                with self.assertRaises(m.Refused):
                    docker(['container', 'start', fixtures.CID])
                value = docker.finite_diagnostic()
                self.assertLessEqual(value['startStderrBytes'], 4096)
                self.assertEqual(value['matchedClass'], 'UNKNOWN')
                self.assertEqual(value['startTimedOut'], expected == 'timeout')
                self.assertEqual(value['startStderrTruncated'], expected == 'limit')

    def test_partial_generated_secret_and_nonce_are_redacted_at_cap_boundary(self):
        docker = DiagnosticDocker()
        docker.secrets = (b'unused-smoke-auth-' + b'd' * 32, b'd' * 32)
        self.assertEqual(docker.redact(b'error unused-smoke-auth-dddddddd'), b'error ***')
        self.assertEqual(docker.redact(b'error ' + b'd' * 32), b'error ***')

    def test_clean_start_ack_is_required_and_cannot_be_replayed(self):
        with patch.object(m.shutil, 'which', return_value='/owned/docker'):
            docker = m.Docker('/owned/config', diagnose_start=True)
        docker.prefix = [sys.executable, '-I', '-B', '-c',
                         'import sys;sys.stdout.write(' + repr(fixtures.CID + '\n') + ')']
        self.assertEqual(docker(['container', 'start', fixtures.CID]).strip(), fixtures.CID)
        self.assertEqual(docker.diagnostic['startExitCode'], 0)
        docker.collect_start_error(fixtures.CID)
        self.assertFalse(docker.diagnostic['stateErrorRead'])
        with self.assertRaises(m.Refused):
            docker(['container', 'start', fixtures.CID])

    def test_state_error_cap_and_inspect_stderr_do_not_escape_or_skip_cleanup(self):
        for program in ('import os;os.write(1,b"X"*10000)',
                        'import os;os.write(2,b"unknown private daemon text")'):
            docker = DiagnosticDocker()
            original = docker.capture_diagnostic
            def capture(args, *limits):
                if args[1] == 'inspect':
                    docker.prefix = [sys.executable, '-I', '-B', '-c', program]
                return original(args, *limits)
            docker.capture_diagnostic = capture
            private = []
            result = m.smoke(fixtures.COMMIT, fixtures.META, docker, private.append)
            self.assertEqual(result['cleanup'], 'OWNED_CONTAINER_REMOVED')
            self.assertFalse(result['startDiagnostics']['stateErrorRead'])
            self.assertEqual(result['startDiagnostics']['stateErrorBytes'], 0)
            self.assertNotIn('unknown private daemon text', json.dumps(result))
            self.assertTrue(all(len(value) <= 8192 for value in private))

    def test_private_output_failure_still_cleans_owned_container(self):
        docker = DiagnosticDocker()
        def unavailable(_raw):
            raise OSError('owned file unavailable')
        result = m.smoke(fixtures.COMMIT, fixtures.META, docker, unavailable)
        self.assertEqual(result['cleanup'], 'OWNED_CONTAINER_REMOVED')
        self.assertFalse(result['privateDiagnosticCaptured'])
        self.assertFalse(result['runtimeAcceptance'])

    def test_public_repository_gets_only_finite_artifact_and_publishing_is_refused(self):
        workflow = (ROOT / '.github/workflows/docker-build.yml').read_text()
        self.assertIn('diagnose_start:', workflow)
        self.assertIn('type: boolean\n        default: false', workflow)
        steps = {part.split('\n', 1)[0]: part for part in workflow.split('      - name: ')[1:]}
        guard = steps['Refuse publishing in diagnostic mode']
        self.assertIn('if: inputs.diagnose_start && inputs.publish', guard)
        self.assertLess(workflow.index('Refuse publishing in diagnostic mode'), workflow.index('Configure AWS credentials'))
        smoke = steps['Smoke the isolated backend process']
        self.assertIn('if: ${{ !inputs.publish }}', smoke)
        self.assertIn('DIAGNOSE_START: ${{ inputs.diagnose_start }}', smoke)
        self.assertIn('--diagnose-start', smoke)
        private = steps['Keep protected fixed-start diagnostics only in a private repository']
        self.assertIn('github.event.repository.private == true', private)
        self.assertIn('inputs.diagnose_start', private)
        self.assertIn('retention-days: 1', private)
        public = steps['Keep finite process smoke evidence']
        self.assertNotIn('private.log', public)


if __name__ == '__main__':
    unittest.main(verbosity=2)
