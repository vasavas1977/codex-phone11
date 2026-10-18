#!/usr/bin/env python3
"""Plan by default; Root dispatches one generated-data PostgreSQL 16.13 qualification.

No configured app database or app environment file is loaded. Generated cluster
and logs remain private and preserved. No production or provider access is permitted.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import signal
import socket
import subprocess
import tempfile
import time
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
TOOLCHAIN = Path('/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/review/pg16-policy-qualification-20261017-v1/toolchain/install')
PG = TOOLCHAIN / 'bin'
VERSION = '16.13'
TARBALL_SHA256 = 'dc2ddbbd245c0265a689408e3d2f2f3f9ba2da96bd19318214b313cdd9797287'
SCOPE = 'pg16-storage-handlers-http'
EXPECTED_TESTS = 85
NODE = Path('/Users/vasavas16macbookpro/.local/bin/node')
PYTHON = Path('/usr/bin/python3')
DONOR = Path('/Users/vasavas16macbookpro/Documents/ChatGPT/supernumber/work/phone11-publish-pbx-20261014/review/pbx-pg16-commissioning-20261017-v1/source-release/dependency-candidate-v1/project/node_modules')
HOST, PORT = '127.0.0.1', 55436
DATABASE, OWNER = 'phone11_pbx_test', 'phone11_fixture_owner'
TESTS = (
    'tests/phone11-fraud-controls-migration.test.ts',
    'tests/phone11-audit-storage-migration.test.ts',
    'tests/phone11-audit-runtime-permissions.test.ts',
    'tests/phone11-fraud-policy-native-api.test.ts',
    'tests/phone11-pbx-core-postgres-atomicity.test.ts',
)
HTTP_TEST = 'tests/phone11-fraud-policy-http.test.ts'
HTTP_SOURCES = (
    HTTP_TEST, 'server/_core/context.ts', 'server/_core/sdk.ts',
    'server/_core/auth-routes.ts', 'server/_core/phone11-auth.ts',
    'server/_core/phone11-auth-admin.ts', 'server/_core/phone11-auth-readiness.ts',
    'server/_core/phone11-password-reset-resend.ts', 'shared/_core/errors.ts',
    'server/_core/pbx-readiness-http.ts', 'server/_core/phone11-invitation-http.ts',
)
SOURCES = TESTS + (
    'server/pbx/fraud-controls-migration.sql', 'server/pbx/audit-storage-migration.sql',
    'server/pbx/audit-runtime-permissions.sql', 'scripts/phone11-pg16-policy-qualification.py',
    'package.json', 'pnpm-lock.yaml', 'vitest.config.ts',
    'server/pbx/fraud-policy-db.ts', 'server/pbx/pbx-router.ts',
    'server/pbx/js-postgres-driver.ts', 'server/pbx/js-postgres-driver-types.d.ts',
    'server/pbx/audit.ts', 'server/pbx/db.ts', 'server/pbx/tenant-middleware.ts',
    'server/_core/trpc.ts', 'shared/const.ts',
    'server/pbx/freeswitch-routes.ts', 'server/pbx/protected-outbound-routing.ts',
    'server/pbx/integration-auth.ts',
    'server/pbx/e164.ts',
)
TOOLS = tuple(PG / name for name in ('postgres', 'initdb', 'createdb', 'pg_isready', 'psql', 'pg_config', 'pg_dump', 'pg_restore')) + (NODE, PYTHON)
DEPENDENCIES = tuple(DONOR / name for name in (
    'vitest/vitest.mjs', 'vitest/dist/cli.js', 'pg/package.json',
    'pg/lib/index.js', 'pg/lib/client.js', 'pg/lib/connection.js')) + (
        (DONOR / 'vitest').resolve().parent / 'vite/dist/node/index.js',)
HTTP_DEPENDENCIES = tuple(DONOR / name for name in (
    'better-auth/package.json', 'better-auth/dist/index.mjs',
    'better-auth/dist/integrations/node.mjs', 'better-auth/dist/crypto/index.mjs',
    'better-auth/dist/db/get-migration.mjs',
    'express/package.json', 'express/index.js',
    '@trpc/server/package.json', '@trpc/server/dist/index.mjs',
    '@trpc/server/dist/adapters/express.mjs',
    'superjson/package.json', 'superjson/dist/index.js',
))


def pin(path):
    digest = hashlib.sha256()
    size = 0
    with path.open('rb') as stream:
        while True:
            block = stream.read(1024 * 1024)
            if not block:
                break
            digest.update(block)
            size += len(block)
    return {'sha256': digest.hexdigest(), 'bytes': size}


LIBRARIES = (TOOLCHAIN / 'lib/libpq.5.dylib',)


def plan():
    return {
        'mode': 'PLAN_ONLY_NO_LAUNCH', 'heldUntilRootDispatch': True,
        'commandAfterRootDispatch': [str(PYTHON), '-B', str(Path(__file__).resolve()),
            '--run-isolated-generated-pg16', '--manifest', 'EXACT_REVIEWED_MANIFEST_PATH',
            '--manifest-sha256', 'EXACT_REVIEWED_MANIFEST_SHA256'],
        'bind': HOST, 'port': PORT, 'database': DATABASE, 'oneVitestWorker': True,
        'postgresVersion': VERSION, 'toolchain': str(TOOLCHAIN),
        'sourceTarballSha256': TARBALL_SHA256, 'qualificationScope': SCOPE,
        'testFiles': list(TESTS) + [HTTP_TEST], 'expectedPassedTests': EXPECTED_TESTS,
        'estimatedNotMeasured': {'memoryMiB': '200-650 total PG plus Node',
            'diskMiB': '80-160 cluster retained', 'durationSeconds': '15-180'},
        'effects': ['One private generated cluster on fixed loopback and private Unix socket',
            'One test-owned ephemeral 127.0.0.1 HTTP listener in the retained Node process',
            'One threaded Vitest worker; SQL, restricted LOGIN, API and authentication suites serially',
            'Scrubbed environment; no app configuration, credentials, production or provider calls',
            'Stop only the retained unreaped PostgreSQL child; preserve private data and immutable receipt'],
    }


def cleanup_owned_link(identity):
    try:
        link = ROOT / 'node_modules'
        if identity is None or not link.is_symlink() or os.readlink(link) != str(DONOR):
            return False, 'OWNED_LINK_REPLACED_PRESERVE'
        current = link.lstat()
        if (current.st_dev, current.st_ino, current.st_uid) != identity:
            return False, 'OWNED_LINK_REPLACED_PRESERVE'
        link.unlink()
        return True, None
    except OSError:
        return False, 'OWNED_LINK_CLEANUP_UNCONFIRMED_PRESERVE'


def finish_resources(child, lab, receipt, link_created, link_identity):
    # Link errors cannot bypass the independent owned-child stop or receipt.
    if link_created:
        try:
            removed, error = cleanup_owned_link(link_identity)
        except Exception:
            removed, error = False, 'OWNED_LINK_CLEANUP_UNCONFIRMED_PRESERVE'
        receipt['temporaryLinkRemoved'] = removed
        if error:
            receipt['linkError'] = error
    if child is not None:
        try:
            # This exact Popen object is retained from foreground creation.
            # A live/unreaped direct child cannot have its PID reused. There is
            # no ps/PID-file lookup, pg_ctl discovery, process-group kill or
            # other waiter/reaper. Popen.send_signal also polls its own child.
            premature = child.poll() is not None
            if not premature:
                child.send_signal(signal.SIGINT)  # PG fast shutdown of this child only.
            code = child.wait(timeout=15)
            receipt['stopped'] = True
            receipt['clusterExitCode'] = code
            if premature or code != 0:
                receipt['error'] = 'OWNED_CLUSTER_EXITED_UNEXPECTEDLY'
        except Exception:
            receipt['stopError'] = 'OWNED_CHILD_STOP_UNCONFIRMED_PRESERVE_DO_NOT_RETRY_BLINDLY'
    receipt['finishedUtc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    receipt['artifacts'] = {name: pin(lab / name) for name in ('operations.log', 'postgres.log', 'vitest.log', 'vitest-result.json') if (lab / name).is_file()}
    # Exclusive creation and read-only final receipt prevent accidental reuse.
    content = (json.dumps(receipt, indent=2) + '\n').encode()
    fd = os.open(lab / 'receipt.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o400)
    with os.fdopen(fd, 'wb') as output:
        output.write(content)


def run(manifest_path, expected_manifest_sha):
    if os.geteuid() == 0:
        raise RuntimeError('Run as the ordinary Mac user, never root')
    if not manifest_path or not re.fullmatch('[a-f0-9]{64}', expected_manifest_sha or ''):
        raise RuntimeError('An exact reviewed manifest and external SHA256 pin are required')
    manifest_file = Path(manifest_path)
    if manifest_file.is_symlink() or manifest_file.stat().st_size > 65536:
        raise RuntimeError('Manifest custody or size refused')
    manifest_bytes = manifest_file.read_bytes()
    if hashlib.sha256(manifest_bytes).hexdigest() != expected_manifest_sha:
        raise RuntimeError('Reviewed manifest SHA256 does not match')
    manifest = json.loads(manifest_bytes)
    if manifest.get('kind') != 'PHONE11_GENERATED_PG16_QUALIFICATION_SOURCE' or manifest.get('root') != str(ROOT):
        raise RuntimeError('Wrong reviewed manifest target')
    scope = SCOPE
    selected_tests = TESTS + (HTTP_TEST,)
    selected_sources = SOURCES + HTTP_SOURCES
    selected_dependencies = DEPENDENCIES + HTTP_DEPENDENCIES
    if manifest.get('postgresVersion') != VERSION or manifest.get('sourceTarballSha256') != TARBALL_SHA256:
        raise RuntimeError('Reviewed PostgreSQL source/version pin does not match')
    if manifest.get('qualificationScope') != scope:
        raise RuntimeError('Reviewed qualification scope does not match')
    if set(manifest.get('source', {})) != set(selected_sources) or set(manifest.get('tools', {})) != {str(tool) for tool in TOOLS + LIBRARIES}:
        raise RuntimeError('Reviewed source/toolchain set is not exact')
    if set(manifest.get('dependencies', {})) != {str(path) for path in selected_dependencies}:
        raise RuntimeError('Reviewed donor entry set is not exact')
    for name, expected in manifest['source'].items():
        if pin(ROOT / name) != expected:
            raise RuntimeError('Reviewed source drift; do not launch')
    for name, expected in manifest['tools'].items():
        if pin(Path(name)) != expected:
            raise RuntimeError('Reviewed toolchain drift; do not launch')
    for name, expected in manifest['dependencies'].items():
        if pin(Path(name)) != expected:
            raise RuntimeError('Reviewed donor entry drift; do not launch')
    for name in ('package.json', 'pnpm-lock.yaml', 'vitest.config.ts'):
        if pin(ROOT / name) != pin(DONOR.parent / name):
            raise RuntimeError('Dependency donor differs from reviewed checkout')
    if any(path.name != '.env.example' for path in ROOT.glob('.env*')):
        raise RuntimeError('Preserve app environment files; this lab refuses to load them')
    if os.path.lexists(ROOT / 'node_modules'):
        raise RuntimeError('Preserve existing node_modules; only a new temporary link is permitted')
    version = subprocess.check_output([str(PG / 'postgres'), '--version'], text=True,
        env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'}, timeout=5)
    if version.strip() != 'postgres (PostgreSQL) ' + VERSION:
        raise RuntimeError('Only the reviewed PostgreSQL 16.13 toolchain is supported')
    configure = subprocess.check_output([str(PG / 'pg_config'), '--configure'], text=True,
        env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'}, timeout=5).strip()
    configure_flags = shlex.split(configure)
    if any(flag not in configure_flags for flag in ('--without-readline', '--without-icu', '--prefix=' + str(TOOLCHAIN))) or '--without-zlib' in configure_flags:
        raise RuntimeError('Reviewed PostgreSQL build feature contract does not match')
    with socket.socket() as probe:
        probe.bind((HOST, PORT))  # Approved-run contention preflight only; never reused.
    lab = Path(tempfile.mkdtemp(prefix='p11-policy-pg16-', dir='/tmp')).resolve()
    lab.chmod(0o700)
    sock = lab / 'sock'
    sock.mkdir(mode=0o700)
    data = lab / 'data'
    password = secrets.token_urlsafe(32)
    fd = os.open(lab / 'generated-password', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as output:
        output.write(password + '\n')
    env = {'PATH': '/opt/homebrew/bin:/usr/bin:/bin', 'TZ': 'UTC', 'LC_ALL': 'C', 'NO_COLOR': '1'}
    receipt = {'kind': 'PHONE11_GENERATED_LOCAL_POLICY_PG16_QUALIFICATION',
        'startedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'lab': str(lab),
        'generatedDataOnly': True, 'productionAccess': False, 'bind': HOST, 'port': PORT,
        'database': DATABASE, 'postgresMajor': 16, 'postgresVersion': VERSION, 'matchesObservedProductionVersion': True,
        'productionParityLimit': 'Version-matching generated macOS/C-locale qualification only; not deployed Linux/TLS/ICU acceptance',
        'postgresConfigure': configure, 'tools': manifest['tools'], 'dependencies': manifest['dependencies'],
        'manifestSha256': expected_manifest_sha, 'source': manifest['source'],
        'qualificationScope': scope, 'testFiles': list(selected_tests),
        'started': False, 'stopped': False, 'temporaryLinkRemoved': False,
        'testExitCode': None, 'dataPreserved': True, 'error': None}
    child, log_stream = None, None
    link_created, link_identity = False, None

    def invoke(argv, timeout=30):
        with (lab / 'operations.log').open('ab') as log:
            return subprocess.run([str(item) for item in argv], cwd=ROOT, env=env,
                stdout=log, stderr=log, timeout=timeout, check=True)

    try:
        invoke([PG / 'initdb', '-D', data, '--username=' + OWNER, '--auth-local=trust',
            '--auth-host=scram-sha-256', '--pwfile=' + str(lab / 'generated-password'), '--encoding=UTF8', '--no-locale'])
        options = ['-c', 'listen_addresses=' + HOST, '-p', str(PORT), '-c', 'unix_socket_directories=' + str(sock),
            '-c', 'max_connections=8', '-c', 'shared_buffers=16MB', '-c', 'max_worker_processes=0',
            '-c', 'max_parallel_workers=0', '-c', 'autovacuum=off', '-c', 'min_wal_size=32MB',
            '-c', 'max_wal_size=64MB', '-c', 'log_statement=none']
        log_stream = (lab / 'postgres.log').open('ab')
        child = subprocess.Popen([str(PG / 'postgres'), '-D', str(data), *options], cwd=lab,
            env=env, stdout=log_stream, stderr=subprocess.STDOUT, start_new_session=True)
        receipt.update(started=True, postmasterPid=child.pid, ownership='RETAINED_FOREGROUND_POPEN_CHILD')
        deadline = time.monotonic() + 15
        while True:
            if child.poll() is not None:
                raise RuntimeError('Owned PostgreSQL child exited before readiness')
            ready = subprocess.run([str(PG / 'pg_isready'), '-h', str(sock), '-p', str(PORT),
                '-U', OWNER, '-d', 'postgres', '-t', '1'], env=env, stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL, timeout=2)
            if ready.returncode == 0:
                break
            if time.monotonic() >= deadline:
                raise RuntimeError('Owned PostgreSQL child readiness timed out')
            time.sleep(0.1)
        invoke([PG / 'createdb', '-h', sock, '-p', PORT, '-U', OWNER, DATABASE])
        identity = subprocess.check_output([str(PG / 'psql'), '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
            '-h', str(sock), '-p', str(PORT), '-U', OWNER, '-d', DATABASE,
            '-c', "SELECT current_setting('server_version_num'),current_database(),session_user,current_user"],
            cwd=ROOT, env=env, stderr=subprocess.DEVNULL, text=True, timeout=5).strip()
        if identity != '160013|' + DATABASE + '|' + OWNER + '|' + OWNER:
            raise RuntimeError('Owned server/database/session identity does not match')
        receipt['runtimeIdentity'] = {'serverVersionNum': 160013, 'database': DATABASE,
            'operatorSessionUser': OWNER, 'operatorCurrentUser': OWNER}
        os.symlink(DONOR, ROOT / 'node_modules')
        link_created = True
        st = (ROOT / 'node_modules').lstat()
        link_identity = (st.st_dev, st.st_ino, st.st_uid)
        test_env = dict(env)
        test_env.update(CI='true', TMPDIR=str(lab), PHONE11_PBX_TEST_SERVER_MAJOR='16',
            PHONE11_PBX_TEST_DATABASE_URL=f'postgresql://{OWNER}:{quote(password, safe="")}@{HOST}:{PORT}/{DATABASE}')
        argv = [str(NODE), '--max-old-space-size=256', 'node_modules/vitest/vitest.mjs', 'run', *selected_tests,
            '--maxWorkers=1', '--minWorkers=1', '--no-file-parallelism', '--reporter=default',
            '--reporter=json', '--outputFile=' + str(lab / 'vitest-result.json')]
        # HTTP listener lives in this directly owned Node process, never a fork.
        argv.append('--pool=threads')
        with (lab / 'vitest.log').open('wb') as log:
            result = subprocess.run(argv, cwd=ROOT, env=test_env, stdout=log, stderr=subprocess.STDOUT, timeout=180)
        receipt['testExitCode'] = result.returncode
        result_summary = json.loads((lab / 'vitest-result.json').read_text())
        receipt['tests'] = {key: result_summary.get(key) for key in ('numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests')}
        if receipt['tests'] != {'numTotalTests': EXPECTED_TESTS, 'numPassedTests': EXPECTED_TESTS, 'numFailedTests': 0, 'numPendingTests': 0}:
            raise RuntimeError('Reviewed test set did not fully execute')
        receipt['toolchainStable'] = all(pin(Path(name)) == value for name, value in manifest['tools'].items())
        receipt['dependenciesStable'] = all(pin(Path(name)) == value for name, value in manifest['dependencies'].items())
        if not receipt['toolchainStable'] or not receipt['dependenciesStable']:
            raise RuntimeError('Reviewed toolchain/dependencies changed during qualification')
        receipt['sourceStable'] = all(pin(ROOT / name) == value for name, value in receipt['source'].items())
        if not receipt['sourceStable']:
            raise RuntimeError('Reviewed source changed during rehearsal')
    except Exception:
        receipt['error'] = 'LOCAL_REHEARSAL_FAILED_INSPECT_PRIVATE_LOGS'
    finally:
        try:
            finish_resources(child, lab, receipt, link_created, link_identity)
        finally:
            if log_stream is not None:
                log_stream.close()
    print(json.dumps({'receipt': str(lab / 'receipt.json'), 'started': receipt['started'],
        'stopped': receipt['stopped'], 'testExitCode': receipt['testExitCode'], 'error': receipt['error'],
        'receiptSha256': pin(lab / 'receipt.json')['sha256']}))
    return 0 if receipt['testExitCode'] == 0 and receipt['stopped'] and receipt.get('sourceStable') and receipt.get('toolchainStable') and receipt.get('dependenciesStable') and receipt['temporaryLinkRemoved'] and receipt['error'] is None else 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-isolated-generated-pg16', action='store_true', help='Root dispatch only after exact-source review')
    parser.add_argument('--manifest', help='Exact reviewed local source/toolchain manifest')
    parser.add_argument('--manifest-sha256', help='Externally supplied SHA256 of the reviewed manifest')
    args = parser.parse_args()
    if args.run_isolated_generated_pg16:
        raise SystemExit(run(args.manifest, args.manifest_sha256))
    print(json.dumps(plan(), indent=2))
