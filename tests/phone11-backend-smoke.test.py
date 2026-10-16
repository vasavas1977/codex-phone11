#!/usr/bin/env python3
"""Owned subprocess seams only: no Docker endpoint, image or application."""
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

ROOT = Path(__file__).absolute().parent.parent
spec = importlib.util.spec_from_file_location('backend_smoke', ROOT / 'scripts/smoke-phone11-backend-image.py')
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)
COMMIT = 'a' * 40
IMAGE = 'sha256:' + 'b' * 64
CID = 'c' * 64
META = {'sourceCommit': COMMIT, 'platform': 'linux/amd64', 'imageId': IMAGE,
        'localTag': 'phone11-backend-check:' + COMMIT, 'published': False, 'applicationStarted': False}


class FakeDocker:
    def __init__(self, mode='pass'):
        self.mode = mode
        self.calls = []
        self.running = False
        self.exists = False
        self.inspect_count = 0
        self.cleanup_began = False
        self.log_calls = []

    def begin_cleanup(self):
        self.cleanup_began = True

    def logs(self, cid):
        self.log_calls.append(cid)
        return b'ReferenceError: OWNED_PRIVATE_DETAIL\n'

    def __call__(self, args, timeout=15):
        self.calls.append((args, timeout))
        command = args[:2]
        if command == ['image', 'inspect']:
            return json.dumps({'id': IMAGE, 'os': 'linux', 'arch': 'amd64', 'revision': COMMIT,
                               'volumes': {'/unexpected': {}} if self.mode == 'image-volume' else None,
                               'cmd': ['node', 'dist/index.mjs']})
        if command == ['container', 'create']:
            self.name = args[args.index('--name') + 1]
            self.nonce = next(value.split('=', 1)[1] for value in args if value.startswith('ai.phone11.smoke='))
            self.exists = self.mode != 'create-absent'
            if self.mode.startswith('create-'):
                raise subprocess.TimeoutExpired('OWNED_FAKE_CREATE', 15)
            return CID + '\n'
        if command == ['container', 'inspect']:
            if not self.exists:
                raise smoke.Refused()
            self.inspect_count += 1
            value = {'id': CID, 'name': '/' + self.name, 'image': IMAGE, 'nonce': self.nonce,
                     'revision': COMMIT, 'user': '1001:1001', 'network': 'none', 'readOnly': True,
                     'privileged': False, 'caps': ['ALL'], 'security': ['no-new-privileges'],
                     'ports': None, 'binds': None, 'tmpfs': {'/tmp': smoke.TMPFS}, 'pids': 128,
                     'memory': 536870912, 'swap': 536870912, 'cpus': 1000000000, 'restart': 'no',
                     'logging': 'local', 'logOptions': {'max-size': '16k', 'max-file': '1', 'compress': 'false'},
                     'running': self.running, 'exitCode': 1 if self.mode == 'exit-failure' else 0,
                     'oom': self.mode == 'oom'}
            if self.mode == 'foreign-owner' and self.inspect_count >= 2:
                value['nonce'] = 'OTHER_NONCE'
            if self.mode == 'network-policy':
                value['network'] = 'bridge'
            if self.mode == 'unbounded-logs':
                value['logOptions'] = {}
            if self.mode == 'compression-enabled':
                value['logOptions']['compress'] = 'true'
            if self.mode == 'compression-absent':
                value['logOptions'].pop('compress')
            if self.mode == 'restarted' and self.inspect_count >= 5:
                value['running'] = True
            return json.dumps(value)
        if command == ['container', 'start']:
            self.running = True
            return CID
        if command == ['container', 'exec']:
            if self.mode == 'health-timeout':
                raise subprocess.TimeoutExpired('OWNED_FAKE_EXEC', 35)
            return json.dumps({'healthy': True, 'build': 'wrong' if self.mode == 'wrong-health' else COMMIT,
                               'runtimeRole': 'api-candidate', 'service': 'phone11-backend'})
        if command == ['container', 'stop']:
            if self.mode == 'stop-failure':
                raise smoke.Refused()
            self.running = False
            return CID
        if command == ['container', 'rm']:
            if self.mode == 'remove-failure':
                raise smoke.Refused()
            self.exists = False
            return CID
        raise AssertionError('Unexpected fake command')


class SmokeTests(unittest.TestCase):
    def test_exact_lifecycle_and_isolation_with_synthetic_explicit_settings(self):
        docker = FakeDocker()
        result = smoke.smoke(COMMIT, META, docker)
        self.assertEqual(result['status'], 'PROCESS_SMOKE_PASSED')
        self.assertEqual(result['cleanup'], 'OWNED_CONTAINER_REMOVED')
        self.assertTrue(result['gracefulShutdownAccepted'])
        self.assertFalse(docker.exists)
        self.assertTrue(docker.cleanup_began)
        create = next(args for args, _ in docker.calls if args[:2] == ['container', 'create'])
        for flag in ['--pull=never', '--read-only', '--no-healthcheck', '--cap-drop', '--security-opt', '--memory-swap', '--pids-limit']:
            self.assertIn(flag, create)
        self.assertEqual(create[-1], IMAGE)
        self.assertEqual(create[create.index('--network') + 1], 'none')
        self.assertFalse(any(value in create for value in ['--publish', '-p', '--volume', '-v', '--env-file']))
        envs = [create[i + 1] for i, value in enumerate(create) if value == '--env']
        self.assertTrue(all('=' in value for value in envs))
        self.assertIn('PHONE11_RUNTIME_ROLE=api-candidate', envs)
        self.assertIn('PORT=3000', envs)
        self.assertTrue(any(value.startswith('PG_CONNECTION_STRING=postgresql://smoke:unused@127.0.0.1:1/') for value in envs))
        commands = [args[:2] for args, _ in docker.calls]
        self.assertEqual(commands.count(['container', 'exec']), 1)
        self.assertEqual(commands[commands.index(['container', 'exec']) - 1], ['container', 'inspect'])
        self.assertEqual(commands[-2:], [['container', 'inspect'], ['container', 'rm']])
        self.assertEqual(docker.log_calls, [])

    def test_canonical_stop_timeout_keeps_ten_seconds_and_refuses_even_successful_stderr(self):
        docker = FakeDocker()
        result = smoke.smoke(COMMIT, META, docker)
        self.assertEqual(result['status'], 'PROCESS_SMOKE_PASSED')
        stop = [args for args, _ in docker.calls if args[:2] == ['container', 'stop']]
        self.assertEqual(stop, [['container', 'stop', '--timeout', '10', CID]])
        with patch.object(smoke.shutil, 'which', return_value='/owned/docker'):
            client = smoke.Docker('/owned/private-config')
        # A zero-exit CLI warning still refuses; no deprecation allowlist or
        # stderr suppression is introduced by selecting the canonical option.
        warning = subprocess.CompletedProcess([], 0, (CID + '\n').encode(), b'Flag --time has been deprecated, use --timeout instead\n')
        with patch.object(smoke.subprocess, 'run', return_value=warning) as child:
            with self.assertRaises(smoke.Refused):
                client(stop[0])
        self.assertEqual(child.call_args.args[0], client.prefix + stop[0])

    def test_single_file_logger_disables_compression_and_requires_exact_observed_options(self):
        docker = FakeDocker()
        result = smoke.smoke(COMMIT, META, docker)
        self.assertEqual(result['status'], 'PROCESS_SMOKE_PASSED')
        create = next(args for args, _ in docker.calls if args[:2] == ['container', 'create'])
        options = [create[i + 1] for i, value in enumerate(create) if value == '--log-opt']
        self.assertEqual(options, ['max-size=16k', 'max-file=1', 'compress=false'])
        self.assertEqual(create[create.index('--log-driver') + 1], 'local')
        # The known Moby configuration conflict must not be reintroduced by
        # accepting omitted/default or explicitly true observed compression.
        for mode in ('compression-enabled', 'compression-absent'):
            docker = FakeDocker(mode)
            result = smoke.smoke(COMMIT, META, docker)
            self.assertEqual(result['status'], 'REFUSED')
            self.assertEqual(result['cleanup'], 'OWNED_CONTAINER_REMOVED')
            self.assertFalse(any(args[:2] == ['container', 'start'] for args, _ in docker.calls))
            self.assertEqual(docker.log_calls, [])

    def test_unbound_or_wrong_image_refuses_before_creation(self):
        for metadata, mode in [({**META, 'sourceCommit': 'd' * 40}, 'pass'),
                               ({**META, 'published': True}, 'pass'), (META, 'image-volume')]:
            docker = FakeDocker(mode)
            result = smoke.smoke(COMMIT, metadata, docker)
            self.assertEqual(result['status'], 'REFUSED')
            self.assertFalse(any(args[:2] == ['container', 'create'] for args, _ in docker.calls))

    def test_policy_refusal_removes_only_owned_object_but_foreign_identity_is_retained(self):
        docker = FakeDocker('network-policy')
        result = smoke.smoke(COMMIT, META, docker)
        self.assertEqual(result['status'], 'REFUSED')
        self.assertEqual(result['cleanup'], 'OWNED_CONTAINER_REMOVED')
        self.assertFalse(any(args[:2] == ['container', 'exec'] for args, _ in docker.calls))
        docker = FakeDocker('foreign-owner')
        result = smoke.smoke(COMMIT, META, docker)
        self.assertEqual(result['cleanup'], 'UNKNOWN')
        self.assertTrue(docker.exists)
        self.assertFalse(any(args[:2] in (['container', 'exec'], ['container', 'rm']) for args, _ in docker.calls))
        self.assertEqual(docker.log_calls, [])

    def test_health_stop_exit_oom_and_remove_failures_cannot_pass(self):
        for mode in ['health-timeout', 'wrong-health', 'stop-failure', 'exit-failure', 'oom', 'restarted', 'remove-failure']:
            with self.subTest(mode=mode):
                docker = FakeDocker(mode)
                private = []
                result = smoke.smoke(COMMIT, META, docker, private.append)
                self.assertEqual(result['status'], 'REFUSED')
                self.assertFalse(result['runtimeAcceptance'])
                self.assertNotIn('OWNED_PRIVATE_DETAIL', json.dumps(result))
                if mode != 'remove-failure':
                    self.assertEqual(result['cleanup'], 'OWNED_CONTAINER_REMOVED')
                    self.assertEqual(result['failureLogClass'], 'JAVASCRIPT_STARTUP_ERROR')
                    self.assertEqual(private, [b'ReferenceError: OWNED_PRIVATE_DETAIL\n'])

    def test_ambiguous_create_is_not_retried_and_cleanup_requires_owned_identity(self):
        for mode, expected in [('create-timeout', 'OWNED_CONTAINER_REMOVED'), ('create-absent', 'UNKNOWN')]:
            docker = FakeDocker(mode)
            result = smoke.smoke(COMMIT, META, docker)
            self.assertEqual(result['status'], 'REFUSED')
            self.assertEqual(result['cleanup'], expected)
            self.assertEqual(sum(args[:2] == ['container', 'create'] for args, _ in docker.calls), 1)

    def test_no_diagnostic_read_when_log_bound_is_not_verified(self):
        docker = FakeDocker('unbounded-logs')
        result = smoke.smoke(COMMIT, META, docker)
        self.assertEqual(result['status'], 'REFUSED')
        self.assertEqual(result['cleanup'], 'OWNED_CONTAINER_REMOVED')
        self.assertEqual(result['failureLogClass'], 'UNAVAILABLE')
        self.assertEqual(docker.log_calls, [])

    def test_docker_client_cleans_environment_and_reserves_cleanup_time(self):
        completed = subprocess.CompletedProcess([], 0, b'owned', b'')
        with patch.object(smoke.shutil, 'which', return_value='/owned/docker'), patch.object(smoke.subprocess, 'run', return_value=completed) as child:
            docker = smoke.Docker('/owned/empty-config')
            self.assertEqual(docker(['image', 'inspect', 'owned']), 'owned')
            argv = child.call_args.args[0]
            self.assertEqual(argv[:5], ['/owned/docker', '--host', 'unix:///var/run/docker.sock', '--config', '/owned/empty-config'])
            self.assertEqual(child.call_args.kwargs['env'], {'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': '/owned/empty-config', 'LANG': 'C'})
            deadline = docker.deadline
            docker.begin_cleanup()
            self.assertEqual(docker.deadline - deadline, 30)
            completed.stderr = b'OWNED_DRIVER_ERROR'
            with self.assertRaises(smoke.Refused):
                docker(['image', 'inspect', 'owned'])

    def test_output_collision_refuses_before_docker_construction(self):
        with tempfile.TemporaryDirectory(prefix='.backend-smoke-fixture-', dir=ROOT / 'tests') as directory:
            root = Path(directory)
            (root / 'metadata.json').write_text(json.dumps(META))
            output = root / 'receipt.json'
            output.write_text('OWNED_EXISTING')
            argv = ['smoke', '--commit', COMMIT, '--metadata', str(root / 'metadata.json'), '--output', str(output)]
            with patch.object(smoke.sys, 'argv', argv), patch.object(smoke, 'Docker') as docker:
                with self.assertRaises(FileExistsError):
                    smoke.main()
                docker.assert_not_called()
            self.assertEqual(output.read_text(), 'OWNED_EXISTING')

    def test_failure_receipt_and_private_diagnostic_are_separate_and_exclusive(self):
        with tempfile.TemporaryDirectory(prefix='.backend-smoke-fixture-', dir=ROOT / 'tests') as directory:
            root = Path(directory)
            (root / 'metadata.json').write_text(json.dumps(META))
            output, private = root / 'receipt.json', root / 'private.log'
            argv = ['smoke', '--commit', COMMIT, '--metadata', str(root / 'metadata.json'),
                    '--output', str(output), '--private-diagnostics', str(private)]
            config_paths = []
            def construct(directory):
                config = Path(directory)
                self.assertEqual([p.name for p in config.iterdir()], ['config.json'])
                self.assertEqual((config / 'config.json').read_text(), '{}\n')
                self.assertEqual(config.stat().st_mode & 0o777, 0o700)
                config_paths.append(config)
                return FakeDocker('wrong-health')
            captured = io.StringIO()
            with patch.object(smoke.sys, 'argv', argv), patch.object(smoke, 'Docker', side_effect=construct), patch.object(smoke.signal, 'signal'), redirect_stdout(captured):
                self.assertEqual(smoke.main(), 1)
            self.assertEqual(output.stat().st_mode & 0o777, 0o600)
            self.assertEqual(private.stat().st_mode & 0o777, 0o600)
            self.assertIn(b'OWNED_PRIVATE_DETAIL', private.read_bytes())
            self.assertNotIn('OWNED_PRIVATE_DETAIL', captured.getvalue())
            self.assertNotIn('OWNED_PRIVATE_DETAIL', output.read_text())
            self.assertEqual(json.loads(output.read_bytes())['cleanup'], 'OWNED_CONTAINER_REMOVED')
            self.assertTrue(all(not p.exists() for p in config_paths))

    def test_actual_bounded_private_log_reader_handles_bytes_overflow_and_deadline(self):
        with patch.object(smoke.shutil, 'which', return_value='/owned/docker'):
            for program, expected in [('import os;os.write(1,b"owned")', b'owned'),
                                      ('import os;os.write(1,b"X"*20000)', None),
                                      ('import time;time.sleep(5)', None)]:
                docker = smoke.Docker('/owned/empty-config')
                # Only an owned public Python child runs; Docker itself is substituted.
                docker.prefix = [sys.executable, '-I', '-B', '-c', program]
                docker.deadline = time.monotonic() + (0.1 if 'sleep' in program else 5)
                if expected is None:
                    with self.assertRaises(smoke.Refused):
                        docker.logs(CID)
                else:
                    self.assertEqual(docker.logs(CID), expected)

    def test_workflow_runs_smoke_only_after_metadata_and_never_uploads_private_log(self):
        workflow = (ROOT / '.github/workflows/docker-build.yml').read_text()
        steps = {part.split('\n', 1)[0]: part for part in workflow.split('      - name: ')[1:]}
        block = steps['Smoke the isolated backend process']
        self.assertIn('if: ${{ !inputs.publish }}', block)
        self.assertIn('timeout-minutes: 3', block)
        self.assertIn('--metadata "$RUNNER_TEMP/phone11-backend-build.json"', block)
        self.assertLess(workflow.index('Record finite local image metadata'), workflow.index('Smoke the isolated backend process'))
        artifact = steps['Keep finite process smoke evidence']
        self.assertIn('if: ${{ always() && !inputs.publish }}', artifact)
        self.assertIn('path: ${{ runner.temp }}/phone11-backend-smoke.json', artifact)
        self.assertNotIn('private.log', artifact)

    def test_actual_health_javascript_in_vm_with_no_network_or_app(self):
        # The exact probe executes in a VM that has only substituted fetch/time/process.
        driver = r'''
const vm = require('node:vm'), fs = require('node:fs');
const { probe, commit } = JSON.parse(fs.readFileSync(0, 'utf8'));
(async () => {
  const base = { ok: true, build: commit, runtimeRole: 'api-candidate', service: 'phone11-backend', timestamp: 1 };
  for (const change of [null, { build: 'wrong' }, { runtimeRole: 'default' }, { service: 'wrong' }, { ok: false }, { timestamp: 'wrong' }, { extra: true }]) {
    let out = '', err = '', calls = 0;
    const process = { argv: ['node', commit], stdout: { write: x => { out += x; } }, stderr: { write: x => { err += x; } }, exitCode: 0 };
    await vm.runInNewContext(probe, { process, AbortSignal: { timeout: x => { if (x !== 1000) throw Error('timeout'); } }, Date, Number, JSON, Object,
      fetch: async url => { calls++; if (url !== 'http://127.0.0.1:3000/api/health') throw Error('url'); return { status: 200, text: async () => JSON.stringify({ ...base, ...change }) }; } });
    if (calls !== 1 || (change === null ? !(JSON.parse(out).healthy && !err && process.exitCode === 0) : !(out === '' && err === 'Health probe failed\n' && process.exitCode === 1))) throw Error('probe case');
  }
  let ticks = 0, calls = 0, err = '';
  const process = { argv: ['node', commit], stdout: { write: () => { throw Error('unexpected success'); } }, stderr: { write: x => { err += x; } }, exitCode: 0 };
  await vm.runInNewContext(probe, { process, AbortSignal: { timeout: () => undefined }, Date: { now: () => { ticks += 10001; return ticks; } },
    setTimeout: callback => callback(), fetch: async () => { calls++; throw Error('owned connection refusal'); } });
  if (calls !== 2 || err !== 'Health probe failed\n' || process.exitCode !== 1) throw Error('deadline case');
  console.log('8 exact-probe cases passed; substituted fetch only');
})().catch(() => process.exitCode = 1);
'''
        result = subprocess.run(['node', '-e', driver], input=json.dumps({'probe': smoke.HEALTH_PROBE, 'commit': COMMIT}),
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('8 exact-probe cases passed', result.stdout)


if __name__ == '__main__':
    unittest.main(verbosity=2)
