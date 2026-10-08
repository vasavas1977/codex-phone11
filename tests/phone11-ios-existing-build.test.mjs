import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { captureChild, validateResult, run, STDERR_LIMIT } from '../scripts/request-phone11-ios-existing-build.mjs';
const guard = createRequire(import.meta.url)('../scripts/run-phone11-ios-existing-build.cjs');
const SHA = 'abca59139b856b8612d652906e73e4d913ca49c2';
const SECRET = 'FIXTURE_PRIVATE_VALUE_NEVER_PUBLISHED';
const env = () => ({ GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REPOSITORY: guard.REPOSITORY,
  GITHUB_REF: guard.REF, GITHUB_WORKFLOW: 'Phone11 Siprix iOS internal build', GITHUB_SHA: SHA,
  PHONE11_IOS_BUILD_SOURCE: SHA, PHONE11_BUILD_PROFILE: guard.PROFILE, EXPO_TOKEN: SECRET });
const exp = () => ({ slug: 'phone11ai', version: '1.0.0', runtimeVersion: '1.0.0-siprix-daily-pilot-chat-media-2', newArchEnabled: false,
  updates: { enabled: false }, ios: { bundleIdentifier: guard.BUNDLE, entitlements: { 'aps-environment': 'production' } },
  extra: { eas: { projectId: guard.PROJECT }, buildInfo: { sipEngine: 'siprix', sipSdkVersion: '1.0.40-trial', appStoreBuild: false },
    phone11ChatNotificationsEnabled: true, phone11ApnsEnvironment: 'production' } });
const row = () => ({ id: '05486dfc-cb37-46b6-aaca-b46a0ac33246', status: 'FINISHED', platform: 'IOS', distribution: 'INTERNAL',
  buildProfile: guard.PROFILE, appIdentifier: guard.BUNDLE, appVersion: '1.0.0', appBuildVersion: '122', gitCommitHash: SHA,
  app: { id: guard.PROJECT, slug: 'phone11ai', ownerAccount: { name: 'vasavas' } }, error: null,
  artifacts: { buildUrl: 'https://invalid.test/'+SECRET }, logFiles: [SECRET] });
const bytes = value => Buffer.from(JSON.stringify(value));
function providerFixture() {
  let reads = 0, mutationCalls = 0;
  const credential = { iosDistributionType: 'AD_HOC', distributionCertificate: {
    certificateP12: SECRET, certificatePassword: SECRET, validityNotBefore: '2026-01-01', validityNotAfter: '2099-01-01' },
    provisioningProfile: { provisioningProfile: SECRET } };
  const plist = { ExpirationDate: '2099-01-01', TeamIdentifier: ['ABCDEFGHIJ'], ProvisionedDevices: ['a'.repeat(40)],
    Entitlements: { 'application-identifier': 'ABCDEFGHIJ.'+guard.BUNDLE, 'com.apple.developer.team-identifier': 'ABCDEFGHIJ',
      'get-task-allow': false, 'aps-environment': 'production' } };
  class Provider { getRemoteAsync() { mutationCalls++; } getLocalAsync() { mutationCalls++; } getPushKeyAsync() { mutationCalls++; } }
  class Context { bestEffortAppStoreAuthenticateAsync() { mutationCalls++; } }
  class AppleApi { ensureAuthenticatedAsync() { mutationCalls++; } }
  class Setup { runAsync() { mutationCalls++; } }
  const Api = { getIosAppCredentialsWithBuildCredentialsAsync: async () => { reads++; return { iosAppBuildCredentialsList: [credential] }; },
    createOrGetExistingAppleAppIdentifierAsync: () => mutationCalls++, createOrUpdateIosAppBuildCredentialsAsync: () => mutationCalls++,
    getDistributionCertificateForAppAsync: () => mutationCalls++ };
  const Utils = { getBuildCredentialsAsync: async (ctx, app, type) =>
    (await ctx.ios.getIosAppCredentialsWithBuildCredentialsAsync(ctx.graphqlClient, app, { iosDistributionType: type })).iosAppBuildCredentialsList[0],
    assignBuildCredentialsAsync: () => mutationCalls++ };
  let validation = true;
  guard.freezeIosProvider({ Provider, Utils, Api, Context, AppleApi, Setup, validate: async () => validation,
    parse: () => plist, adHoc: 'AD_HOC' });
  const provider = new Provider();
  provider.ctx = { nonInteractive: true, freezeCredentials: true, refreshAdHocProvisioningProfile: false, appStore: { authCtx: null },
    ios: Api, graphqlClient: {}, getProjectIdAsync: async () => guard.PROJECT, getExpoConfigAsync: async () => exp() };
  provider.options = { app: { account: { name: 'vasavas' }, projectName: 'phone11ai' }, distribution: 'internal',
    targets: [{ targetName: 'Phone11', bundleIdentifier: guard.BUNDLE }] };
  return { provider, credential, plist, Api, Utils, Context, AppleApi, Setup, counters: () => ({ reads, mutationCalls }), invalidate: () => { validation = false; } };
}
test('guard is a read-only ad-hoc lookup and preserves exact target credential bytes', async () => {
  const f = providerFixture(); const got = await f.provider.getRemoteAsync();
  assert.deepEqual(got, { Phone11: { distributionCertificate: { certificateP12: SECRET, certificatePassword: SECRET }, provisioningProfile: SECRET } });
  assert.deepEqual(f.counters(), { reads: 1, mutationCalls: 0 });
  assert.equal(await f.provider.getPushKeyAsync(f.provider.ctx), null);
});
test('all alternate local/setup/auth/identifier/certificate/assignment paths refuse without calling originals', async () => {
  const f = providerFixture();
  for (const attempt of [() => f.provider.getLocalAsync(), () => new f.Setup().runAsync(),
    () => new f.Context().bestEffortAppStoreAuthenticateAsync(), () => new f.AppleApi().ensureAuthenticatedAsync(),
    () => f.Utils.assignBuildCredentialsAsync(), () => f.Api.createOrGetExistingAppleAppIdentifierAsync(),
    () => f.Api.createOrUpdateIosAppBuildCredentialsAsync(), () => f.Api.getDistributionCertificateForAppAsync()]) assert.throws(attempt);
  assert.deepEqual(f.counters(), { reads: 0, mutationCalls: 0 });
});
test('unknown CLI API/export layout refuses before any provider action', () => {
  assert.throws(() => guard.freezeIosProvider({}));
  assert.throws(() => guard.installGuard('/missing/fixed-test-cli'));
  assert.throws(() => guard.resolveCliRoot({ RUNNER_TOOL_CACHE: 'relative' }));
  assert.equal(Object.keys(guard.CLI_FILES).length, 14);
});
test('noninteractive, freeze, exact app/project, single target and trial config are required before read', async () => {
  const changes = [f => f.provider.ctx.freezeCredentials = false, f => f.provider.ctx.nonInteractive = false,
    f => f.provider.ctx.refreshAdHocProvisioningProfile = true, f => f.provider.ctx.appStore.authCtx = {},
    f => f.provider.options.enterpriseProvisioning = 'universal', f => f.provider.options.distribution = 'store',
    f => f.provider.options.targets.push({}), f => f.provider.options.targets[0].bundleIdentifier = 'wrong.app',
    f => f.provider.options.app.account.name = 'wrong', f => f.provider.ctx.getProjectIdAsync = async () => 'wrong',
    f => f.provider.ctx.ios = {}, f => f.provider.ctx.getExpoConfigAsync = async () => ({ ...exp(), updates: { enabled: true } })];
  for (const change of changes) { const f = providerFixture(); change(f); await assert.rejects(f.provider.getRemoteAsync()); assert.equal(f.counters().reads, 0); }
});
test('existing credentials/profile validity refuse without generation or fallback', async () => {
  const changes = [f => f.credential.iosDistributionType = 'ENTERPRISE', f => f.credential.distributionCertificate = null,
    f => f.credential.distributionCertificate.validityNotAfter = '2020-01-01', f => f.credential.provisioningProfile = null,
    f => f.credential.distributionCertificate.certificateP12 = 'x'.repeat(1048577),
    f => f.plist.ExpirationDate = '2020-01-01', f => f.plist.ProvisionsAllDevices = true,
    f => f.plist.ProvisionedDevices = [], f => f.plist.ProvisionedDevices.push('invalid'),
    f => f.plist.ProvisionedDevices.push(f.plist.ProvisionedDevices[0]), f => f.plist.Entitlements['get-task-allow'] = true,
    f => f.plist.Entitlements['aps-environment'] = 'development', f => f.plist.Entitlements['application-identifier'] = 'wrong',
    f => f.plist.Entitlements['com.apple.developer.team-identifier'] = 'wrong', f => f.invalidate()];
  for (const change of changes) { const f = providerFixture(); change(f); await assert.rejects(f.provider.getRemoteAsync()); assert.equal(f.counters().mutationCalls, 0); }
});
test('source guards precede token use; no CLI arguments or injection flags admitted', async () => {
  guard.assertInvocation(env(), SHA);
  for (const key of ['GITHUB_SHA', 'PHONE11_IOS_BUILD_SOURCE', 'GITHUB_REF', 'GITHUB_REPOSITORY', 'GITHUB_EVENT_NAME', 'PHONE11_BUILD_PROFILE', 'NODE_OPTIONS', 'EAS_NO_VCS', 'EXPO_ASC_API_KEY_PATH', 'PHONE11_SIPRIX_LICENSE']) {
    assert.throws(() => guard.assertInvocation({ ...env(), [key]: 'wrong' }, SHA));
  }
  assert.throws(() => guard.assertInvocation(env(), SHA, ['anything']));
  assert.throws(() => guard.assertInvocation(env(), SHA, [], ['--import=x']));
  let tokenReads = 0, requests = 0;
  const bad = { get EXPO_TOKEN() { tokenReads++; throw new Error(SECRET); } };
  const got = await run({ env: bad, checkSource: () => guard.assertInvocation(bad, SHA), capture: () => requests++ });
  assert.equal(got.failureCode, 'INVOCATION_REFUSED'); assert.equal(tokenReads, 0); assert.equal(requests, 0);
  assert.equal((await run({ env: {}, checkSource: () => SHA })).failureCode, 'TOKEN_UNAVAILABLE');
});
test('resolved profile and evaluated config retain standalone daily pilot and trial', () => {
  const eas = JSON.parse(readFileSync(new URL('../eas.json', import.meta.url)));
  const src = readFileSync(new URL('../app.config.ts', import.meta.url), 'utf8');
  guard.assertSourceConfig(eas, src); guard.assertExpoConfig(exp());
  for (const change of [p => p.distribution = 'store', p => p.credentialsSource = 'local', p => p.ios = { enterpriseProvisioning: 'universal' },
    p => p.ios = { withoutCredentials: true }, p => p.ios = { buildConfiguration: 'Debug' }, p => p.env.PHONE11_SIPRIX_LICENSE = SECRET]) {
    const changed = structuredClone(eas); change(changed.build[guard.PROFILE]); assert.throws(() => guard.assertSourceConfig(changed, src));
  }
  assert.throws(() => guard.assertExpoConfig({ ...exp(), extra: { ...exp().extra, buildInfo: { ...exp().extra.buildInfo, sipSdkVersion: '1.0.40-licensed' } } }));
});
test('result allowlist strips provider private fields and binds exact release source/identity/newer number', () => {
  const result = validateResult(bytes([row()]), SHA);
  assert.equal(JSON.stringify(result).includes(SECRET), false);
  assert.equal(result.artifactVerified, false); assert.equal(result.retryAuthorized, false);
  for (const change of [b => b.gitCommitHash = 'a'.repeat(40), b => b.id = SECRET, b => b.status = 'ERRORED',
    b => b.platform = 'ANDROID', b => b.distribution = 'STORE', b => b.app.id = 'wrong', b => b.app.ownerAccount.name = 'wrong',
    b => b.buildProfile = 'preview-ios-siprix', b => b.appIdentifier = 'wrong', b => b.appVersion = null,
    b => b.appBuildVersion = '121', b => b.appBuildVersion = '00122', b => b.error = { message: SECRET }]) {
    const bad = row(); change(bad); assert.throws(() => validateResult(bytes([bad]), SHA));
  }
  for (const bad of [[], [row(), row()], {}, Buffer.alloc(262145)]) assert.throws(() => validateResult(Buffer.isBuffer(bad) ? bad : bytes(bad), SHA));
  assert.throws(() => validateResult(Buffer.from('[{"id":"x","\\u0069d":"y"}]'), SHA));
});
function childFixture() {
  const child = new EventEmitter(); child.pid = 12345; child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  child.stdio = [null, child.stdout, child.stderr, new EventEmitter()];
  const signals = new EventEmitter(), killed = [], callbacks = [];
  const promise = captureChild({ env: env(), head: SHA, signals, spawnChild: (cmd, args, opts) => {
    assert.equal(opts.detached, true); assert.deepEqual(opts.stdio, ['ignore','pipe','pipe','pipe']); return child;
  }, killGroup: (pid, signal) => killed.push([pid, signal]),
  timers: { setTimeout: (cb, ms) => { callbacks.push({ cb, ms }); return callbacks.length; }, clearTimeout: () => {} } });
  return { child, signals, killed, callbacks, promise };
}
test('privacy regression: provider stderr and raw artifact/error fields never reach the parent receipt', async () => {
  const legacy = readFileSync(new URL('../.github/workflows/phone11-siprix-ios-build.yml', import.meta.url), 'utf8');
  assert.equal(legacy.includes('buildUrl'), false); assert.equal(legacy.includes('upload-artifact'), false);
  const f = childFixture(); f.child.stderr.emit('data', bytes({ credential: SECRET }));
  f.child.stdout.emit('data', bytes([row()])); f.child.emit('close', 0, null);
  const got = await f.promise; assert.equal(got.outcome, 'FINISHED_METADATA_ONLY');
  assert.equal(JSON.stringify(got).includes(SECRET), false); assert.equal(f.signals.listenerCount('SIGTERM'), 0);
});
test('offline legacy stderr leak is reproduced and a real synthetic child is contained by the parent', async () => {
  // Expo's pinned enableJsonOutput redirects ordinary writes to stderr.
  // This synthetic child models that documented execution boundary, with no CLI/provider.
  const fixture = `const original=process.stdout.write.bind(process.stdout);process.stdout.write=process.stderr.write.bind(process.stderr);console.log(${JSON.stringify(SECRET)});original(${JSON.stringify(JSON.stringify([row()]))});`;
  const legacy = spawnSync(process.execPath, ['-e', fixture], { env: {}, encoding: 'utf8' });
  assert.equal(legacy.status, 0); assert.ok(legacy.stderr.includes(SECRET));
  assert.ok(legacy.stdout.includes(SECRET)); // The raw default fragment also carries private fields.
  const got = await captureChild({ env: env(), head: SHA,
    spawnChild: (node, args, options) => spawn(node, ['-e', fixture], { ...options, env: {} }) });
  assert.equal(got.outcome, 'FINISHED_METADATA_ONLY'); assert.equal(JSON.stringify(got).includes(SECRET), false);
});
test('unknown/malformed CLI failure never copies private text or establishes absence/retry', async () => {
  for (const diagnostic of [null, bytes({ failureCode: SECRET, requestMayHaveOccurred: false }), Buffer.from(SECRET)]) {
    const f = childFixture(); f.child.stderr.emit('data', Buffer.from(SECRET));
    if (diagnostic) f.child.stdio[3].emit('data', diagnostic); f.child.emit('close', 1, null);
    const got = await f.promise; assert.equal(got.failureCode, 'UNKNOWN_CLI_FAILURE'); assert.equal(got.requestMayHaveOccurred, true);
    assert.equal(got.absenceEstablished, false); assert.equal(got.retryAuthorized, false); assert.equal(JSON.stringify(got).includes(SECRET), false);
  }
  const f = childFixture(); f.child.stdio[3].emit('data', bytes({ failureCode: 'CREDENTIALS_REQUIRED', requestMayHaveOccurred: false }));
  f.child.emit('close', 1, null); assert.equal((await f.promise).requestMayHaveOccurred, false);
});
test('timeout/cancel and either-stream limits terminate child group and clean listeners', async () => {
  for (const trigger of [f => f.callbacks[0].cb(), f => f.signals.emit('SIGTERM'),
    f => f.child.stdout.emit('data', Buffer.alloc(262145)), f => f.child.stderr.emit('data', Buffer.alloc(STDERR_LIMIT+1)),
    f => f.child.stdio[3].emit('data', Buffer.alloc(1025))]) {
    const f = childFixture(); trigger(f); f.callbacks[1].cb(); const got = await f.promise;
    assert.deepEqual(f.killed.map(k => k[1]), ['SIGTERM','SIGKILL']); assert.equal(got.requestMayHaveOccurred, true);
    assert.equal(got.retryAuthorized, false); assert.equal(f.signals.listenerCount('SIGTERM'), 0); assert.equal(f.signals.listenerCount('SIGINT'), 0);
  }
});
test('child failures, truncated output, and interruption cannot become success or auto-retry', async () => {
  const f = childFixture(); f.child.stdout.emit('data', Buffer.from('[')); f.child.emit('close', 0, null);
  assert.equal((await f.promise).failureCode, 'RESULT_REFUSED');
  const g = childFixture(); g.child.emit('error', new Error(SECRET)); assert.equal((await g.promise).failureCode, 'CHILD_FAILED');
  const thrown = await run({ env: env(), checkSource: () => SHA, capture: () => { throw new Error(SECRET); } });
  assert.equal(thrown.requestMayHaveOccurred, true); assert.equal(JSON.stringify(thrown).includes(SECRET), false);
});
test('actual unmanaged entrypoint refuses with one safe line and no stderr/provider child', () => {
  const result = spawnSync(process.execPath, ['scripts/request-phone11-ios-existing-build.mjs'], { env: { PATH: process.env.PATH }, encoding: 'utf8' });
  assert.equal(result.status, 1); assert.equal(result.stderr, '');
  const got = JSON.parse(result.stdout); assert.equal(got.failureCode, 'INVOCATION_REFUSED'); assert.equal(got.requestMayHaveOccurred, false);
});
test('workflow has only manual fixed daily profile, owned source guard, token only on reader, no raw upload', () => {
  const w = readFileSync(new URL('../.github/workflows/phone11-siprix-ios-build.yml', import.meta.url), 'utf8');
  assert.equal(w.includes('  push:'), false); assert.equal(w.includes('preview-ios-siprix-wake-pilot'), false);
  assert.match(w, /source_sha:/); assert.match(w, /needs: \[native-check, daily-use-check, signing-guard-check\]/);
  assert.match(w, /persist-credentials: false/); assert.match(w, /permissions:\s+contents: read/);
  assert.equal((w.match(/secrets.EXPO_TOKEN/g) ?? []).length, 1);
  assert.ok(w.indexOf('--check-source') < w.indexOf('expo\/expo-github-action@'));
  assert.equal(w.includes('eas build'), false); assert.equal(w.includes('upload-artifact'), false);
});
