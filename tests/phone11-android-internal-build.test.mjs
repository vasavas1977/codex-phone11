import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, openSync, closeSync, statSync, symlinkSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { Buffer } from 'node:buffer';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateBuildResult } from '../scripts/check-phone11-android-trial-build-result.mjs';

const require = createRequire(import.meta.url);
const { requireManagedInvocation, freezeAndroidProvider, diagnosticCodeFor,
  createFailureDiagnostics, installGuard } = require('../scripts/run-phone11-android-trial-internal-build.cjs');
const { classifyDiagnostic, readManagedDiagnostic } = require('../scripts/report-phone11-android-build-failure.cjs');
const diagnostic = code => Buffer.from(JSON.stringify({ schema: 'phone11.android-build-diagnostic.v1', failureCode: code }) + '\n');
const sha = 'a'.repeat(40);
const invocation = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REPOSITORY: 'vasavas1977/codex-phone11',
  GITHUB_REF: 'refs/heads/codex/phone11-zoom-mainline-integration-20260928', GITHUB_SHA: sha };
const build = () => ({ id: '05486dfc-cb37-46b6-aaca-b46a0ac33246', status: 'FINISHED',
  gitCommitHash: sha, platform: 'ANDROID', distribution: 'INTERNAL',
  buildProfile: 'preview-android-siprix-foreground-trial',
  app: { id: 'e354ffd3-485c-49f1-9e6f-aebe571d8dfb', slug: 'phone11ai', ownerAccount: { name: 'vasavas' } },
  appIdentifier: 'ai.phone11.mobile.foregroundtrial', appVersion: '1.0.0', appBuildVersion: '1', error: null,
  artifacts: { buildUrl: 'https://expo.dev/artifacts/eas/example.apk' } });

test('fork, PR, different ref, dirty head and arbitrary preloads refuse before EAS', () => {
  assert.doesNotThrow(() => requireManagedInvocation(invocation, sha));
  for (const [key, value] of [ ['GITHUB_ACTIONS', 'false'], ['GITHUB_EVENT_NAME', 'pull_request'],
    ['GITHUB_REPOSITORY', 'fork/codex-phone11'], ['GITHUB_REF', 'refs/heads/main'],
    ['GITHUB_SHA', 'bad'], ['NODE_OPTIONS', '--require untrusted.cjs'],
    ['EAS_BUILD_PROFILE', 'production'], ['PHONE11_SIPRIX_LICENSE', 'sentinel'] ]) {
    assert.throws(() => requireManagedInvocation({ ...invocation, [key]: value }, sha), /E_ANDROID_TRIAL_INVOCATION/);
  }
  assert.throws(() => requireManagedInvocation(invocation, 'b'.repeat(40)), /E_ANDROID_TRIAL_INVOCATION/);
});

test('remote credential absence or revocation never reaches generation or assignment', async () => {
  let reads = 0, writes = 0, existing = { androidKeystore: { id: 'opaque-existing-id' } };
  class Provider {
    constructor() { this.ctx = {}; this.options = { app: 'synthetic', name: undefined }; }
    getRemoteAsync() { writes++; }
    getLocalAsync() { writes++; }
    toAndroidCredentials(value) { return value; }
  }
  class Setup {
    async getFullySetupBuildCredentialsAsync(args) { assert.equal(args.app, 'synthetic'); reads++; return existing; }
  }
  class Create { runAsync() { writes++; } provideOrGenerateAsync() { writes++; } }
  freezeAndroidProvider(Provider, Setup, Create);
  const provider = new Provider();
  assert.equal(await provider.getRemoteAsync(), existing);
  existing = null; // A credential disappears after an earlier read.
  await assert.rejects(provider.getRemoteAsync(), /E_ANDROID_EXISTING_CREDENTIALS_REQUIRED/);
  existing = {}; // A credential configuration exists without a keystore.
  await assert.rejects(provider.getRemoteAsync(), /E_ANDROID_EXISTING_CREDENTIALS_REQUIRED/);
  assert.throws(() => provider.getLocalAsync(), /E_ANDROID_EXISTING_CREDENTIALS_REQUIRED/);
  assert.throws(() => new Create().runAsync(), /E_ANDROID_EXISTING_CREDENTIALS_REQUIRED/);
  assert.throws(() => new Create().provideOrGenerateAsync(), /E_ANDROID_EXISTING_CREDENTIALS_REQUIRED/);
  assert.equal(reads, 3); assert.equal(writes, 0);
  assert.throws(() => freezeAndroidProvider(class {}, Setup, Create), /E_ANDROID_TRIAL_CLI_CONTRACT/);
});

test('only one successful exact-project Android internal foreground build is accepted', () => {
  const receipt = validateBuildResult([build()], sha);
  assert.equal(receipt.artifactVerified, false); assert.equal(receipt.physicalAcceptance, false);
  assert.equal(receipt.trialOnly, true); assert.equal(receipt.foregroundOnly, true);
  assert.equal(receipt.buildDetailsUrl, 'https://expo.dev/accounts/vasavas/projects/phone11ai/builds/05486dfc-cb37-46b6-aaca-b46a0ac33246');
  assert.equal(JSON.stringify(receipt).includes('artifacts/eas'), false);
  for (const value of [undefined, {}, [], [build(), build()], [null]])
    assert.throws(() => validateBuildResult(value, sha), /E_ANDROID_TRIAL_BUILD_RESULT/);
  for (const [key, value] of [['id', 'bad'], ['status', 'IN_PROGRESS'], ['status', 'ERRORED'],
    ['gitCommitHash', 'b'.repeat(40)], ['platform', 'IOS'], ['distribution', 'STORE'],
    ['buildProfile', 'production'], ['appIdentifier', 'ai.phone11.mobile'],
    ['appVersion', '2.0.0'], ['appBuildVersion', '0'], ['error', { message: 'private' }]])
    assert.throws(() => validateBuildResult([{ ...build(), [key]: value }], sha), /E_ANDROID_TRIAL_BUILD_RESULT/);
  for (const app of [{}, { ...build().app, id: 'other' }, { ...build().app, slug: 'other' },
    { ...build().app, ownerAccount: { name: 'other' } }])
    assert.throws(() => validateBuildResult([{ ...build(), app }], sha), /E_ANDROID_TRIAL_BUILD_RESULT/);
});

test('artifact receipt rejects wrong destinations and never echoes credential or provider values', () => {
  for (const url of [null, 'http://expo.dev/artifacts/eas/test.apk', 'https://evil.invalid/test.apk',
    'https://expo.dev/artifacts/eas/test.ipa', 'https://private:sentinel@expo.dev/artifacts/eas/test.apk',
    'https://expo.dev:444/artifacts/eas/test.apk', 'https://expo.dev/artifacts/eas/test.apk?token=sentinel']) {
    assert.throws(() => validateBuildResult([{ ...build(), artifacts: { buildUrl: url } }], sha),
      error => error.message === 'E_ANDROID_TRIAL_BUILD_RESULT');
  }
  const root = mkdtempSync(join(tmpdir(), 'phone11-android-result-'));
  try {
    const file = join(root, 'input.json'); writeFileSync(file, '{"private":"sentinel", malformed');
    const result = spawnSync(process.execPath, ['scripts/check-phone11-android-trial-build-result.mjs', file, sha], { encoding: 'utf8' });
    assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.equal(result.stderr.includes('sentinel'), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('manual workflow has no arbitrary build inputs and withholds raw EAS results', () => {
  const workflow = readFileSync(new URL('../.github/workflows/phone11-android-trial-internal-build.yml', import.meta.url), 'utf8');
  assert.match(workflow, /on:\s*\n\s+workflow_dispatch:\s*\n/);
  assert.doesNotMatch(workflow, /\n\s+(push|pull_request|inputs):/);
  assert.match(workflow, /needs: daily-use-check/);
  assert.match(workflow, /phone11-android-build-receipt\.json\n\s+if-no-files-found: error/);
  assert.doesNotMatch(workflow, /path: .*build-private|--auto-submit|--refresh-ad-hoc|credentials configure/);
  assert.match(workflow, /2> "\$RUNNER_TEMP\/phone11-android-build-private\.stderr"/);
  assert.doesNotMatch(workflow, /cat .*build-private/);
  assert.match(workflow, /workflow_call:\n    secrets:\n      EXPO_TOKEN:\n        required: true/);
  assert.doesNotMatch(workflow, /secrets: inherit/);
});

test('registered native-check entry defaults signing off and requires all native checks', () => {
  const workflow = readFileSync(new URL('../.github/workflows/phone11-mobile-cloud-check.yml', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_dispatch:\n    inputs:\n      request_internal_android_trial:\n        description: [^\n]+\n        type: boolean\n        required: false\n        default: false/);
  const caller = workflow.match(/  internal-android-trial:\n([\s\S]+?)\n  install-test-config:/)?.[1];
  assert.ok(caller, 'Fixed optional build caller must exist');
  assert.match(caller, /needs: \[install-test-config, native-dev-client-prebuild, android-gradle-assemble, android-screen-transaction-compile, android-foreground-trial-assemble, siprix-bridge-regressions\]/);
  assert.match(caller, /if: github\.event_name == 'workflow_dispatch' && inputs\.request_internal_android_trial == true && github\.repository == 'vasavas1977\/codex-phone11' && github\.ref == 'refs\/heads\/codex\/phone11-zoom-mainline-integration-20260928'/);
  assert.match(caller, /uses: \.\/\.github\/workflows\/phone11-android-trial-internal-build\.yml\n    secrets:\n      EXPO_TOKEN: \$\{\{ secrets\.EXPO_TOKEN \}\}/);
  assert.doesNotMatch(caller, /secrets: inherit|with:|runs-on:|environment:/);
  const checkoutRefs = [...workflow.matchAll(/^\s+ref: (.+)$/gm)].map(match => match[1]);
  assert.equal(checkoutRefs.length, 6, 'All six prerequisites must have a source pin');
  for (const ref of checkoutRefs) {
    assert.equal(ref, "${{ github.event_name == 'workflow_dispatch' && github.sha || github.head_ref || github.ref_name }}",
      'Branch movement after dispatch must not change the checked source');
  }
});

test('actual workflow shell keeps asynchronous CLI stdout and stderr private on failure', () => {
  const workflow = readFileSync(new URL('../.github/workflows/phone11-android-trial-internal-build.yml', import.meta.url), 'utf8');
  const step = workflow.match(/          umask 077\n([\s\S]+?)\n      - uses: actions\/upload-artifact/);
  assert.ok(step, 'Expected build step must exist');
  const commands = 'umask 077\n' + step[1].split('\n').map(line => line.slice(10)).join('\n');
  const root = mkdtempSync(join(tmpdir(), 'phone11-android-private-log-'));
  try {
    const mock = "node() { if [ \"$1\" = scripts/run-phone11-android-trial-internal-build.cjs ]; then printf '%s\\n' 'synthetic-private-stdout'; printf '%s\\n' 'synthetic-private-stderr' >&2; return 1; else command node \"$@\"; fi; }\n";
    const result = spawnSync('bash', ['-e', '-c', mock + commands], {
      encoding: 'utf8', env: { ...process.env, RUNNER_TEMP: root, GITHUB_SHA: sha },
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout.includes('synthetic-private'), false);
    assert.equal(result.stderr.includes('synthetic-private'), false);
    assert.match(result.stderr, /Signing remains restricted to existing credentials/);
    assert.match(result.stderr, /UNKNOWN_CLI_FAILURE/);
    assert.equal(readFileSync(join(root, 'phone11-android-build-private.json'), 'utf8'), 'synthetic-private-stdout\n');
    assert.equal(readFileSync(join(root, 'phone11-android-build-private.stderr'), 'utf8'), 'synthetic-private-stderr\n');
    assert.equal(statSync(join(root, 'phone11-android-build-diagnostic.json')).mode & 0o777, 0o600);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('only wrapper-owned errors are classified; forged codes and error getters are never read', () => {
  let owned;
  try { requireManagedInvocation({}, sha); } catch (error) { owned = error; }
  assert.equal(diagnosticCodeFor(owned), 'E_ANDROID_TRIAL_INVOCATION');
  const malicious = Object.defineProperty({}, 'message', { get() { throw new Error('private-sentinel'); } });
  for (const error of [new Error('E_ANDROID_TRIAL_INVOCATION'), { code: 'E_ANDROID_EXISTING_CREDENTIALS_REQUIRED' },
    malicious, undefined, null, 'E_ANDROID_TRIAL_CLI_BYTES']) {
    assert.equal(diagnosticCodeFor(error), 'UNKNOWN_CLI_FAILURE');
  }
});

test('absent and revoked keystores, local access and generation have distinct owned diagnostics without mutation', async () => {
  let existing = { androidKeystore: {} }, writes = 0;
  class Provider {
    constructor() { this.ctx = {}; this.options = {}; }
    getRemoteAsync() { writes++; }
    getLocalAsync() { writes++; }
    toAndroidCredentials(value) { return value; }
  }
  class Setup { async getFullySetupBuildCredentialsAsync() { return existing; } }
  class Create { runAsync() { writes++; } provideOrGenerateAsync() { writes++; } }
  freezeAndroidProvider(Provider, Setup, Create);
  const provider = new Provider();
  assert.equal(await provider.getRemoteAsync(), existing);
  for (const value of [null, {}]) {
    existing = value;
    await assert.rejects(provider.getRemoteAsync(), error => diagnosticCodeFor(error) === 'E_ANDROID_EXISTING_CREDENTIALS_REQUIRED');
  }
  assert.throws(() => provider.getLocalAsync(), error => diagnosticCodeFor(error) === 'E_ANDROID_LOCAL_CREDENTIALS_BLOCKED');
  for (const method of ['runAsync', 'provideOrGenerateAsync']) {
    assert.throws(() => new Create()[method](), error => diagnosticCodeFor(error) === 'E_ANDROID_CREDENTIAL_GENERATION_BLOCKED');
  }
  assert.equal(writes, 0);
});

test('diagnostics retain a first owned failure and fall back safely on unknown asynchronous exit', () => {
  const events = new EventEmitter(), output = [];
  const recorder = createFailureDiagnostics(bytes => output.push(bytes), events);
  let owned;
  try { requireManagedInvocation({}, sha); } catch (error) { owned = error; }
  recorder.record(owned); events.emit('exit', 1);
  assert.equal(output.length, 1); assert.equal(classifyDiagnostic(Buffer.from(output[0])), 'E_ANDROID_TRIAL_INVOCATION');
  const unknownEvents = new EventEmitter(), unknownOutput = [];
  createFailureDiagnostics(bytes => unknownOutput.push(bytes), unknownEvents);
  unknownEvents.emit('exit', 9);
  assert.equal(unknownOutput.length, 1); assert.equal(classifyDiagnostic(Buffer.from(unknownOutput[0])), 'UNKNOWN_CLI_FAILURE');
  const success = new EventEmitter();
  createFailureDiagnostics(() => assert.fail('Success must not write a diagnostic'), success);
  success.emit('exit', 0);
  const unavailable = new EventEmitter();
  createFailureDiagnostics(() => { throw new Error('private-write-error'); }, unavailable);
  assert.doesNotThrow(() => unavailable.emit('exit', 1));
});

test('malformed, oversized, duplicate, extra-field and prototype diagnostic inputs never echo data', () => {
  assert.equal(classifyDiagnostic(diagnostic('E_ANDROID_EXISTING_CREDENTIALS_REQUIRED')), 'E_ANDROID_EXISTING_CREDENTIALS_REQUIRED');
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(513, 65), Buffer.from('private-sentinel'), Buffer.from('[]'),
    Buffer.from('{"schema":"phone11.android-build-diagnostic.v1","failureCode":"UNKNOWN_CLI_FAILURE","extra":"private-sentinel"}\n'),
    Buffer.from('{"schema":"phone11.android-build-diagnostic.v1","failureCode":"private-sentinel","failureCode":"UNKNOWN_CLI_FAILURE"}\n'),
    diagnostic('__proto__'), diagnostic('constructor'), diagnostic('private-sentinel'), 'not-bytes']) {
    assert.equal(classifyDiagnostic(bytes), 'UNKNOWN_CLI_FAILURE');
  }
});

test('reader uses only the fixed regular file and rejects relative roots, symlinks and oversized files', () => {
  const root = mkdtempSync(join(tmpdir(), 'phone11-android-diagnostic-file-'));
  const fixed = join(root, 'phone11-android-build-diagnostic.json'), other = join(root, 'private.json');
  try {
    writeFileSync(fixed, diagnostic('E_ANDROID_TRIAL_PROJECT'));
    assert.equal(classifyDiagnostic(readManagedDiagnostic({ RUNNER_TEMP: root })), 'E_ANDROID_TRIAL_PROJECT');
    assert.equal(readManagedDiagnostic({ RUNNER_TEMP: 'relative/path' }).length, 0);
    writeFileSync(fixed, Buffer.alloc(513));
    assert.equal(readManagedDiagnostic({ RUNNER_TEMP: root }).length, 0);
    rmSync(fixed); writeFileSync(other, diagnostic('E_ANDROID_TRIAL_PROJECT')); symlinkSync(other, fixed);
    assert.equal(readManagedDiagnostic({ RUNNER_TEMP: root }).length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('actual wrapper emits a bounded owned failure on FD3 without a path override or changing stdout', () => {
  const root = mkdtempSync(join(tmpdir(), 'phone11-android-diagnostic-fd-'));
  const fixed = join(root, 'diagnostic.json'), injection = join(root, 'should-not-exist');
  const descriptor = openSync(fixed, 'w', 0o600);
  try {
    const result = spawnSync(process.execPath, ['scripts/run-phone11-android-trial-internal-build.cjs', '--unexpected'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe', descriptor],
      env: { ...process.env, PHONE11_ANDROID_DIAGNOSTIC_PATH: injection },
    });
    assert.equal(result.status, 1); assert.equal(result.stdout, '');
    assert.equal(classifyDiagnostic(readFileSync(fixed)), 'E_ANDROID_TRIAL_ARGUMENTS');
    assert.throws(() => statSync(injection), { code: 'ENOENT' });
    assert.equal(result.stderr.includes('diagnostic.json'), false);
    const pkg = join(root, 'package.json'); writeFileSync(pkg, JSON.stringify({ name: 'wrong', version: '23.2.0' }));
    assert.throws(() => installGuard(root), error => diagnosticCodeFor(error) === 'E_ANDROID_TRIAL_CLI_VERSION');
  } finally { closeSync(descriptor); rmSync(root, { recursive: true, force: true }); }
});

test('workflow publishes only fixed known diagnostics and preserves successful receipt JSON', () => {
  const workflow = readFileSync(new URL('../.github/workflows/phone11-android-trial-internal-build.yml', import.meta.url), 'utf8');
  assert.match(workflow, /3> "\$RUNNER_TEMP\/phone11-android-build-diagnostic\.json"/);
  assert.doesNotMatch(workflow, /cat .*diagnostic\.json|PHONE11_ANDROID_DIAGNOSTIC_PATH|--diagnostic/);
  const step = workflow.match(/          umask 077\n([\s\S]+?)\n      - uses: actions\/upload-artifact/);
  const commands = 'umask 077\n' + step[1].split('\n').map(line => line.slice(10)).join('\n');
  const root = mkdtempSync(join(tmpdir(), 'phone11-android-diagnostic-shell-'));
  try {
    const known = "node() { if [ \"$1\" = scripts/run-phone11-android-trial-internal-build.cjs ]; then printf '%s\\n' 'private-stdout'; printf '%s\\n' 'private-stderr' >&2; printf '%s\\n' '{\"schema\":\"phone11.android-build-diagnostic.v1\",\"failureCode\":\"E_ANDROID_EXISTING_CREDENTIALS_REQUIRED\"}' >&3; return 1; else command node \"$@\"; fi; }\n";
    const failed = spawnSync('bash', ['-e', '-c', known + commands], { encoding: 'utf8', env: { ...process.env, RUNNER_TEMP: root, GITHUB_SHA: sha } });
    assert.equal(failed.status, 1); assert.match(failed.stderr, /E_ANDROID_EXISTING_CREDENTIALS_REQUIRED/);
    assert.equal(failed.stdout, ''); assert.equal(failed.stderr.includes('private-'), false);
    const good = "node() { if [ \"$1\" = scripts/run-phone11-android-trial-internal-build.cjs ]; then printf '%s\\n' '" + JSON.stringify([build()]) + "'; return 0; else command node \"$@\"; fi; }\n";
    const passed = spawnSync('bash', ['-e', '-c', good + commands], { encoding: 'utf8', env: { ...process.env, RUNNER_TEMP: root, GITHUB_SHA: sha } });
    assert.equal(passed.status, 0); assert.equal(passed.stderr, '');
    assert.deepEqual(JSON.parse(passed.stdout), validateBuildResult([build()], sha));
    assert.equal(passed.stdout.includes('artifacts/eas'), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
