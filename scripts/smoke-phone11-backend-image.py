#!/usr/bin/env python3
"""Start only an owned, isolated CI image and request its process health."""
import argparse
import json
import os
import re
import secrets
import selectors
import shutil
import signal
import subprocess
import sys
import tempfile
import time

IMAGE_FORMAT = '{"id":"{{.Id}}","os":"{{.Os}}","arch":"{{.Architecture}}","revision":"{{index .Config.Labels "org.opencontainers.image.revision"}}","volumes":{{json .Config.Volumes}},"cmd":{{json .Config.Cmd}}}'
CONTAINER_FORMAT = '{"id":"{{.Id}}","name":"{{.Name}}","image":"{{.Image}}","nonce":"{{index .Config.Labels "ai.phone11.smoke"}}","revision":"{{index .Config.Labels "org.opencontainers.image.revision"}}","user":"{{.Config.User}}","network":"{{.HostConfig.NetworkMode}}","readOnly":{{.HostConfig.ReadonlyRootfs}},"privileged":{{.HostConfig.Privileged}},"caps":{{json .HostConfig.CapDrop}},"security":{{json .HostConfig.SecurityOpt}},"ports":{{json .HostConfig.PortBindings}},"binds":{{json .HostConfig.Binds}},"tmpfs":{{json .HostConfig.Tmpfs}},"pids":{{.HostConfig.PidsLimit}},"memory":{{.HostConfig.Memory}},"swap":{{.HostConfig.MemorySwap}},"cpus":{{.HostConfig.NanoCpus}},"restart":"{{.HostConfig.RestartPolicy.Name}}","logging":"{{.HostConfig.LogConfig.Type}}","logOptions":{{json .HostConfig.LogConfig.Config}},"running":{{.State.Running}},"exitCode":{{.State.ExitCode}},"oom":{{.State.OOMKilled}}}'
TMPFS = 'rw,noexec,nosuid,nodev,size=64m,uid=1001,gid=1001,mode=1777'
HEALTH_PROBE = r'''
const commit = process.argv[1];
async function probe() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    let response;
    try { response = await fetch('http://127.0.0.1:3000/api/health', { signal: AbortSignal.timeout(1000), redirect: 'error' }); }
    catch { await new Promise(resolve => setTimeout(resolve, 200)); continue; }
    if (response.status !== 200) throw Error('health status');
    const raw = await response.text();
    if (raw.length > 1024) throw Error('health size');
    const value = JSON.parse(raw);
    if (Object.keys(value).sort().join() !== 'build,ok,runtimeRole,service,timestamp'
      || value.ok !== true || value.build !== commit || value.runtimeRole !== 'api-candidate'
      || value.service !== 'phone11-backend' || !Number.isFinite(value.timestamp) || value.timestamp <= 0) throw Error('health shape');
    process.stdout.write(JSON.stringify({ healthy: true, build: commit, runtimeRole: 'api-candidate', service: 'phone11-backend' }));
    return;
  }
  throw Error('health deadline');
}
probe().catch(() => { process.stderr.write('Health probe failed\n'); process.exitCode = 1; });
'''


class Refused(Exception):
    pass


def need(value):
    if not value:
        raise Refused()


class Docker:
    def __init__(self, directory):
        executable = shutil.which('docker')
        need(executable)
        self.prefix = [executable, '--host', 'unix:///var/run/docker.sock', '--config', directory]
        self.env = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': directory, 'LANG': 'C'}
        self.cleanup_deadline = time.monotonic() + 120
        self.deadline = self.cleanup_deadline - 30

    def begin_cleanup(self):
        self.deadline = self.cleanup_deadline

    def capture(self, args, timeout):
        remaining = self.deadline - time.monotonic()
        need(remaining > 0)
        result = subprocess.run(self.prefix + args, env=self.env, input=b'', capture_output=True,
                                timeout=min(timeout, remaining), check=False)
        need(result.returncode == 0 and not result.stderr
             and len(result.stdout) + len(result.stderr) <= 16384)
        return result.stdout + result.stderr

    def __call__(self, args, timeout=15):
        return self.capture(args, timeout).decode()

    def logs(self, cid):
        # Only this owned-container diagnostic permits application stderr.
        deadline = min(self.deadline, time.monotonic() + 10)
        need(deadline > time.monotonic())
        with subprocess.Popen(self.prefix + ['container', 'logs', '--tail', '64', cid],
                              env=self.env, stdin=subprocess.DEVNULL,
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT) as child:
            selector = selectors.DefaultSelector()
            raw = bytearray()
            try:
                selector.register(child.stdout, selectors.EVENT_READ)
                while True:
                    remaining = deadline - time.monotonic()
                    need(remaining > 0 and selector.select(remaining))
                    chunk = os.read(child.stdout.fileno(), min(4096, 16385 - len(raw)))
                    if not chunk:
                        break
                    raw.extend(chunk)
                    need(len(raw) <= 16384)
                need(child.wait(timeout=max(0.001, deadline - time.monotonic())) == 0)
                return bytes(raw)
            finally:
                selector.close()
                if child.poll() is None:
                    child.kill()
                child.wait(timeout=2)


def smoke(commit, metadata, run, private_log=None):
    nonce = secrets.token_hex(16)
    name = 'phone11-smoke-' + commit[:12] + '-' + nonce
    result = {'sourceCommit': commit, 'platform': 'linux/amd64', 'nonce': nonce,
              'status': 'REFUSED', 'phase': 'metadata', 'startDispatched': False,
              'healthAccepted': False, 'cleanup': 'NOT_NEEDED', 'runtimeAcceptance': False,
              'failureLogClass': 'NOT_COLLECTED', 'privateDiagnosticCaptured': False,
              'gracefulShutdownAccepted': False}
    cid = None
    image = None
    create_attempted = False

    def inspect_container(policy=True):
        value = json.loads(run(['container', 'inspect', '--format', CONTAINER_FORMAT, cid or name]))
        expected = {'name': '/' + name, 'image': image, 'nonce': nonce, 'revision': commit,
                    'user': '1001:1001', 'network': 'none', 'readOnly': True,
                    'privileged': False, 'caps': ['ALL'], 'security': ['no-new-privileges'],
                    'tmpfs': {'/tmp': TMPFS}, 'pids': 128, 'memory': 536870912,
                    'swap': 536870912, 'cpus': 1000000000, 'restart': 'no', 'logging': 'local',
                    'logOptions': {'max-size': '16k', 'max-file': '1'}}
        need(set(value) == set(expected) | {'id', 'ports', 'binds', 'running', 'exitCode', 'oom'})
        keys = expected if policy else ('name', 'image', 'nonce', 'revision')
        need(all(value[k] == expected[k] for k in keys))
        need(re.fullmatch('[a-f0-9]{64}', value['id']) and (cid is None or value['id'] == cid))
        if policy:
            need(value['ports'] in (None, {}) and value['binds'] in (None, []))
        need(type(value['running']) is bool and type(value['oom']) is bool and type(value['exitCode']) is int)
        return value

    try:
        need(re.fullmatch('[a-f0-9]{40}', commit))
        need(set(metadata) == {'sourceCommit', 'platform', 'imageId', 'localTag', 'published', 'applicationStarted'})
        need(metadata['sourceCommit'] == commit and metadata['platform'] == 'linux/amd64'
             and metadata['localTag'] == 'phone11-backend-check:' + commit
             and metadata['published'] is False and metadata['applicationStarted'] is False)
        image = metadata['imageId']
        need(isinstance(image, str) and re.fullmatch('sha256:[a-f0-9]{64}', image))
        result['imageId'] = image
        result['phase'] = 'image'
        actual = json.loads(run(['image', 'inspect', '--format', IMAGE_FORMAT, image]))
        need(actual == {'id': image, 'os': 'linux', 'arch': 'amd64', 'revision': commit,
                        'volumes': None, 'cmd': ['node', 'dist/index.mjs']}
             or actual == {'id': image, 'os': 'linux', 'arch': 'amd64', 'revision': commit,
                           'volumes': {}, 'cmd': ['node', 'dist/index.mjs']})
        synthetic = {
            'NODE_ENV': 'production', 'PHONE11_RUNTIME_ROLE': 'api-candidate', 'PORT': '3000',
            'PHONE11_BUILD_SHA': commit, 'PHONE11_AUTH_BASE_URL': 'https://smoke.invalid',
            'PHONE11_AUTH_TRUSTED_ORIGINS': 'https://smoke.invalid',
            'PHONE11_AUTH_SECRET': 'unused-smoke-auth-' + nonce,
            'SIP_DEK_SECRET': 'unused-smoke-sip-' + nonce,
            'PG_CONNECTION_STRING': 'postgresql://smoke:unused@127.0.0.1:1/phone11_smoke?sslmode=disable',
            'DATABASE_URL': 'postgresql://smoke:unused@127.0.0.1:1/phone11_smoke?sslmode=disable',
            'REDIS_URL': 'redis://127.0.0.1:1', 'FREESWITCH_ESL_HOST': '127.0.0.1',
            'FREESWITCH_ESL_PORT': '1', 'FREESWITCH_ESL_PASSWORD': 'unused-smoke-esl-' + nonce,
            'PHONE11_CLOUD_RECORDING_CAPTURE_ENABLED': 'false',
            'PHONE11_RECORDING_AI_ENABLED': 'false', 'PHONE11_RECORDING_RETENTION_ENABLED': 'false',
        }
        args = ['container', 'create', '--pull=never', '--platform', 'linux/amd64', '--name', name, '--label', 'ai.phone11.smoke=' + nonce,
                '--label', 'org.opencontainers.image.revision=' + commit,
                '--network', 'none', '--read-only', '--user', '1001:1001', '--cap-drop', 'ALL',
                '--security-opt', 'no-new-privileges', '--pids-limit', '128',
                '--memory', '512m', '--memory-swap', '512m', '--cpus', '1',
                '--ulimit', 'nofile=256:256', '--tmpfs', '/tmp:' + TMPFS,
                '--stop-timeout', '10', '--restart', 'no', '--log-driver', 'local',
                '--log-opt', 'max-size=16k', '--log-opt', 'max-file=1', '--no-healthcheck']
        for key, value in synthetic.items():
            args += ['--env', key + '=' + value]
        args.append(image)
        result['phase'] = 'create'
        create_attempted = True
        cid = run(args).strip()
        need(re.fullmatch('[a-f0-9]{64}', cid))
        result['containerId'] = cid
        need(inspect_container()['running'] is False)
        result['phase'] = 'start'
        result['startDispatched'] = True
        run(['container', 'start', cid])
        need(inspect_container()['running'] is True)
        result['phase'] = 'health'
        health = json.loads(run(['container', 'exec', '--user', '1001:1001', cid, 'node',
                                 '--input-type=module', '-e', HEALTH_PROBE, commit], timeout=35))
        need(health == {'healthy': True, 'build': commit, 'runtimeRole': 'api-candidate', 'service': 'phone11-backend'})
        result['healthAccepted'] = True
        result['phase'] = 'stop'
        need(inspect_container()['running'] is True)
        run(['container', 'stop', '--time', '10', cid])
        stopped = inspect_container()
        need(not stopped['running'] and not stopped['oom'] and stopped['exitCode'] == 0)
        result['gracefulShutdownAccepted'] = True
        result['status'] = 'PROCESS_SMOKE_PASSED'
        result['phase'] = 'complete'
    except (Refused, OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError):
        pass
    finally:
        if create_attempted:
            result['cleanup'] = 'UNKNOWN'
            try:
                if hasattr(run, 'begin_cleanup'):
                    run.begin_cleanup()
                # Even an ambiguous create/stop must prove this exact nonce/image/name
                # before removal. A mismatched object is retained, never adopted.
                owned = inspect_container(policy=False)
                result.setdefault('containerId', owned['id'])
                result['observedRunning'] = owned['running']
                result['observedExitCode'] = owned['exitCode']
                result['observedOOM'] = owned['oom']
                if result['status'] == 'PROCESS_SMOKE_PASSED' and (owned['running'] or owned['oom'] or owned['exitCode'] != 0):
                    result['status'] = 'REFUSED'
                    result['phase'] = 'cleanup'
                if result['status'] != 'PROCESS_SMOKE_PASSED':
                    try:
                        need(owned['logging'] == 'local' and owned['logOptions'] == {'max-size': '16k', 'max-file': '1'})
                        raw = run.logs(owned['id'])
                        need(type(raw) is bytes and len(raw) <= 16384)
                        text = raw.decode(errors='replace')
                        result['failureLogClass'] = 'UNCLASSIFIED'
                        for pattern, category in [
                            (r'ERR_REQUIRE_ESM|require is not defined|Dynamic require', 'MODULE_FORMAT_ERROR'),
                            (r'Cannot find (?:module|package)|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND', 'MODULE_RESOLUTION_FAILED'),
                            (r'ReferenceError|SyntaxError|TypeError', 'JAVASCRIPT_STARTUP_ERROR'),
                            (r'EADDRINUSE|EACCES.*listen', 'LISTENER_FAILED'),
                        ]:
                            if re.search(pattern, text):
                                result['failureLogClass'] = category
                                break
                        if private_log:
                            try:
                                private_log(raw)
                                result['privateDiagnosticCaptured'] = True
                            except (OSError, ValueError):
                                result['privateDiagnosticCaptured'] = False
                    except (Refused, OSError, ValueError, TypeError, subprocess.SubprocessError):
                        result['failureLogClass'] = 'UNAVAILABLE'
                need(run(['container', 'rm', '--force', owned['id']]).strip() == owned['id'])
                result['cleanup'] = 'OWNED_CONTAINER_REMOVED'
            except (Refused, OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError):
                result['status'] = 'REFUSED'
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--commit', required=True)
    parser.add_argument('--metadata', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--private-diagnostics')
    args = parser.parse_args()
    need(re.fullmatch('[a-f0-9]{40}', args.commit) and os.path.isabs(args.output))
    if args.private_diagnostics:
        need(os.path.isabs(args.private_diagnostics) and not os.path.lexists(args.private_diagnostics))
    def private_log(raw):
        fd = os.open(args.private_diagnostics, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'wb') as target:
            target.write(raw)
            target.flush()
            os.fsync(target.fileno())
    with open(args.metadata, 'rb') as source:
        raw = source.read(2049)
    need(len(raw) <= 2048)
    metadata = json.loads(raw)
    # A replay/output collision refuses before creating any container.
    fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as output:
        def terminate(_number, _frame):
            signal.signal(signal.SIGTERM, signal.SIG_IGN)
            raise Refused()
        signal.signal(signal.SIGTERM, terminate)
        with tempfile.TemporaryDirectory(prefix='phone11-smoke-config-') as directory:
            os.chmod(directory, 0o700)
            with open(os.path.join(directory, 'config.json'), 'x') as config:
                config.write('{}\n')
            result = smoke(args.commit, metadata, Docker(directory), private_log if args.private_diagnostics else None)
        raw = (json.dumps(result, sort_keys=True) + '\n').encode()
        output.write(raw)
        output.flush()
        os.fsync(output.fileno())
    print(raw.decode(), end='')
    return 0 if result['status'] == 'PROCESS_SMOKE_PASSED' else 1


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (Refused, OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError):
        print('Isolated backend process smoke refused', file=sys.stderr)
        raise SystemExit(1)
