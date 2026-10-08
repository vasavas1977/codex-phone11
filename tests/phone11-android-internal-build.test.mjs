import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, openSync, closeSync, statSync, symlinkSync, mkdirSync, cpSync, realpathSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { Buffer } from 'node:buffer';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateBuildResult } from '../scripts/check-phone11-android-trial-build-result.mjs';

const require = createRequire(import.meta.url);
const { requireManagedInvocation, freezeAndroidProvider, diagnosticCodeFor,
  createFailureDiagnostics, installGuard, resolveActionCliRoot } = require('../scripts/run-phone11-android-trial-internal-build.cjs');
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

const guardedFiles = ['package.json', 'bin/run',
  'build/credentials/android/AndroidCredentialsProvider.js',
  'build/credentials/android/actions/SetUpBuildCredentials.js',
  'build/credentials/android/actions/CreateKeystore.js'];

function actionSlot(cache) { return join(cache, 'eas-cli', '23.2.0', process.arch); }

test('toolcache location refuses missing roots and slot, package or executable escapes', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'phone11-eas-location-')));
  const cache = join(root, 'cache'), slot = actionSlot(cache), pkg = join(slot, 'node_modules/eas-cli');
  const outside = join(root, 'cache-elsewhere');
  const locationFailure = error => diagnosticCodeFor(error) === 'E_ANDROID_TRIAL_CLI_LOCATION';
  try {
    for (const value of [undefined, '', 'relative', join(root, 'absent')]) {
      assert.throws(() => resolveActionCliRoot({ RUNNER_TOOL_CACHE: value }), locationFailure);
    }
    mkdirSync(cache);
    assert.throws(() => resolveActionCliRoot({ RUNNER_TOOL_CACHE: cache }), locationFailure);
    for (const file of guardedFiles) {
      mkdirSync(dirname(join(pkg, file)), { recursive: true });
      writeFileSync(join(pkg, file), 'synthetic');
    }
    assert.equal(resolveActionCliRoot({ RUNNER_TOOL_CACHE: cache }), pkg);
    mkdirSync(outside);
    const bin = join(pkg, 'bin/run'), externalBin = join(outside, 'run');
    writeFileSync(externalBin, 'synthetic'); rmSync(bin); symlinkSync(externalBin, bin);
    assert.throws(() => resolveActionCliRoot({ RUNNER_TOOL_CACHE: cache }), locationFailure);
    rmSync(bin); writeFileSync(bin, 'synthetic');
    rmSync(pkg, { recursive: true }); symlinkSync(outside, pkg, 'dir');
    assert.throws(() => resolveActionCliRoot({ RUNNER_TOOL_CACHE: cache }), locationFailure);
    rmSync(slot, { recursive: true }); symlinkSync(outside, slot, 'dir');
    assert.throws(() => resolveActionCliRoot({ RUNNER_TOOL_CACHE: cache }), locationFailure);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// Opt in with an already-owned package. Never install or query a CLI for tests.
const cachedCli = process.env.PHONE11_TEST_EAS_CLI_ROOT;
test('actual main uses the pinned action pnpm toolcache while global EAS is absent',
  { skip: !cachedCli }, async t => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'phone11-eas-cached-main-')));
    const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const cache = join(root, 'toolcache'), slot = actionSlot(cache);
    const realPackage = join(slot, 'node_modules/.pnpm/eas-cli@23.2.0/node_modules/eas-cli');
    const packageLink = join(slot, 'node_modules/eas-cli');
    const preload = join(root, 'offline-boundary.cjs');
    const diagnosticFile = join(root, 'diagnostic.json');
    const sourcePackage = realpathSync(cachedCli);
    const expectedEntrypoint = '#!/usr/bin/env node\n\n(async () => {\n'
      + "  const oclif = require('@oclif/core');\n  await oclif.execute({ dir: __dirname });\n})();\n";
    const expectedArgs = ['build', '--platform', 'android', '--profile',
      'preview-android-siprix-foreground-trial', '--non-interactive', '--freeze-credentials', '--wait', '--json'];
    try {
      assert.equal(JSON.parse(readFileSync(join(sourcePackage, 'package.json'))).version, '23.2.0');
      mkdirSync(dirname(realPackage), { recursive: true });
      cpSync(sourcePackage, realPackage, { recursive: true });
      // Verify the complete entrypoint before any child can execute it. Its only
      // dependency is the execute boundary intercepted below.
      assert.equal(readFileSync(join(realPackage, 'bin/run'), 'utf8'), expectedEntrypoint);
      symlinkSync('.pnpm/eas-cli@23.2.0/node_modules/eas-cli', packageLink, 'dir');
      // This is the action's local pnpm symlink layout. Global root is empty.
      mkdirSync(join(root, 'global/node_modules'), { recursive: true });
      const home = join(root, 'synthetic-home'), config = join(root, 'synthetic-config');
      mkdirSync(home); mkdirSync(config);
      writeFileSync(preload, `
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const originalLoad = Module._load;
const failNetwork = () => assert.fail('Offline fixture must never contact a provider');
require('node:http').request = failNetwork;
require('node:https').request = failNetwork;
require('node:net').Socket.prototype.connect = failNetwork;
require('node:tls').connect = failNetwork;
global.fetch = failNetwork;
const subprocess = require('node:child_process');
for (const method of ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork']) {
  subprocess[method] = () => assert.fail('Offline fixture must never launch a provider subprocess');
}
const expectedBin = ${JSON.stringify(join(realPackage, 'bin/run'))};
const expectedBinBytes = ${JSON.stringify(expectedEntrypoint)};
Module._load = function(request, parent, isMain) {
  if (request.endsWith('/bin/run')) {
    assert.equal(request, expectedBin, 'Unexpected CLI entrypoint refused before loading');
    assert.equal(fs.realpathSync(request), expectedBin);
    assert.equal(fs.readFileSync(request, 'utf8'), expectedBinBytes);
  }
  if (request === 'node:child_process' && parent?.filename === ${JSON.stringify(join(repo, 'scripts/run-phone11-android-trial-internal-build.cjs'))}) {
    return { execFileSync(command, args) {
      if (command === 'git' && args.join(' ') === 'rev-parse HEAD') return ${JSON.stringify(sha)};
      if (command === 'git' && ['diff --quiet', 'diff --cached --quiet'].includes(args.join(' '))) return '';
      assert.fail('No pnpm/global lookup or other subprocess is permitted');
    }};
  }
  if (request === '@oclif/core' && parent?.filename === ${JSON.stringify(join(realPackage, 'bin/run'))}) {
    return { async execute(options) {
      assert.equal(options.dir, ${JSON.stringify(join(realPackage, 'bin'))});
      assert.deepEqual(process.argv.slice(2), ${JSON.stringify(expectedArgs)});
      await new Promise(resolve => setImmediate(resolve));
      if (process.env.PHONE11_TEST_CLI_ASYNC_FAILURE === '1') throw new Error('synthetic CLI failure');
      console.log(JSON.stringify({ fixedArgv: true, asyncCompleted: true, accountQueries: 0, buildRequests: 0 }));
    }};
  }
  if (request === '@oclif/core' && parent?.filename.endsWith('/bin/run')) {
    assert.fail('Unrecognized CLI entrypoint must not load the real execute boundary');
  }
  return originalLoad.call(this, request, parent, isMain);
};
`);
      function run(overrides = {}) {
        const descriptor = openSync(diagnosticFile, 'w', 0o600);
        // No inherited Expo/EAS/provider/license tokens or user config. Only
        // the already-owned dependency directory and synthetic runner inputs.
        const env = { PATH: process.env.PATH, HOME: home, USERPROFILE: home,
          APPDATA: config, XDG_CONFIG_HOME: config, TMPDIR: root, EXPO_NO_TELEMETRY: '1',
          ...invocation, RUNNER_TOOL_CACHE: cache, NODE_PATH: dirname(sourcePackage),
          NODE_OPTIONS: '', ...overrides };
        if (overrides.RUNNER_TOOL_CACHE === undefined && Object.hasOwn(overrides, 'RUNNER_TOOL_CACHE')) delete env.RUNNER_TOOL_CACHE;
        try {
          const result = spawnSync(process.execPath, ['--require', preload,
            'scripts/run-phone11-android-trial-internal-build.cjs'], {
            cwd: repo, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe', descriptor],
            timeout: 30_000, killSignal: 'SIGKILL',
          });
          assert.ifError(result.error);
          assert.equal(result.signal, null, 'Offline CLI fixture must finish within its bound');
          return { ...result, diagnostic: readFileSync(diagnosticFile) };
        } finally { closeSync(descriptor); }
      }
      function refuses(code, overrides) {
        const result = run(overrides);
        assert.equal(result.status, 1); assert.equal(result.stdout, '');
        assert.equal(classifyDiagnostic(result.diagnostic), code);
        assert.equal(result.diagnostic.includes(root), false);
        // Asynchronous CLI stacks belong to private stderr; the workflow shell
        // tests above prove those streams never become public failure output.
        if (code !== 'UNKNOWN_CLI_FAILURE') assert.equal(result.stderr.includes(root), false);
      }
      await t.test('real pinned package accepts internal pnpm symlink with exact fixed argv', () => {
        const result = run();
        assert.equal(result.status, 0, result.stderr); assert.equal(result.diagnostic.length, 0);
        assert.deepEqual(JSON.parse(result.stdout), { fixedArgv: true, asyncCompleted: true, accountQueries: 0, buildRequests: 0 });
      });
      await t.test('managed root absence, relative path and missing cached package refuse safely', () => {
        for (const value of [undefined, 'relative', join(root, 'missing')]) {
          refuses('E_ANDROID_TRIAL_CLI_LOCATION', { RUNNER_TOOL_CACHE: value });
        }
        rmSync(packageLink);
        refuses('E_ANDROID_TRIAL_CLI_LOCATION');
        symlinkSync('.pnpm/eas-cli@23.2.0/node_modules/eas-cli', packageLink, 'dir');
      });
      await t.test('package symlink outside action cache refuses before CLI or credential loads', () => {
        rmSync(packageLink); symlinkSync(sourcePackage, packageLink, 'dir');
        refuses('E_ANDROID_TRIAL_CLI_LOCATION');
        rmSync(packageLink); symlinkSync('.pnpm/eas-cli@23.2.0/node_modules/eas-cli', packageLink, 'dir');
      });
      await t.test('wrong version refuses before CLI execution', () => {
        const pkgFile = join(realPackage, 'package.json'), bytes = readFileSync(pkgFile);
        try {
          writeFileSync(pkgFile, JSON.stringify({ ...JSON.parse(bytes), version: '23.2.1' }));
          refuses('E_ANDROID_TRIAL_CLI_VERSION');
        } finally { writeFileSync(pkgFile, bytes); }
      });
      await t.test('changed credential module bytes refuse before CLI execution', () => {
        const file = join(realPackage, guardedFiles[2]), bytes = readFileSync(file);
        try {
          writeFileSync(file, Buffer.concat([bytes, Buffer.from('\n// synthetic drift\n')]));
          refuses('E_ANDROID_TRIAL_CLI_BYTES');
        } finally { writeFileSync(file, bytes); }
      });
      await t.test('asynchronous CLI failure remains private and unknown', () => {
        refuses('UNKNOWN_CLI_FAILURE', { PHONE11_TEST_CLI_ASYNC_FAILURE: '1' });
      });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
