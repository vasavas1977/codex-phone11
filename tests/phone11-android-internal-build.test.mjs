import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateBuildResult } from '../scripts/check-phone11-android-trial-build-result.mjs';

const require = createRequire(import.meta.url);
const { requireManagedInvocation, freezeAndroidProvider } = require('../scripts/run-phone11-android-trial-internal-build.cjs');
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
});

test('actual workflow shell keeps asynchronous CLI stdout and stderr private on failure', () => {
  const workflow = readFileSync(new URL('../.github/workflows/phone11-android-trial-internal-build.yml', import.meta.url), 'utf8');
  const step = workflow.match(/          umask 077\n([\s\S]+?)\n      - uses: actions\/upload-artifact/);
  assert.ok(step, 'Expected build step must exist');
  const commands = 'umask 077\n' + step[1].split('\n').map(line => line.slice(10)).join('\n');
  const root = mkdtempSync(join(tmpdir(), 'phone11-android-private-log-'));
  try {
    const mock = "node() { printf '%s\\n' 'synthetic-private-stdout'; printf '%s\\n' 'synthetic-private-stderr' >&2; return 1; }\n";
    const result = spawnSync('bash', ['-e', '-c', mock + commands], {
      encoding: 'utf8', env: { ...process.env, RUNNER_TEMP: root, GITHUB_SHA: sha },
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout.includes('synthetic-private'), false);
    assert.equal(result.stderr.includes('synthetic-private'), false);
    assert.match(result.stderr, /Signing remains restricted to existing credentials/);
    assert.equal(readFileSync(join(root, 'phone11-android-build-private.json'), 'utf8'), 'synthetic-private-stdout\n');
    assert.equal(readFileSync(join(root, 'phone11-android-build-private.stderr'), 'utf8'), 'synthetic-private-stderr\n');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
