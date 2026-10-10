import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { Buffer } from 'node:buffer';
import { mkdtempSync, realpathSync, writeFileSync, readFileSync, rmSync, openSync, closeSync,
  symlinkSync, linkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const wrapperPath = fileURLToPath(new URL('../scripts/run-phone11-android-trial-internal-build.cjs', import.meta.url));
const reporterPath = fileURLToPath(new URL('../scripts/report-phone11-android-build-failure.cjs', import.meta.url));
const { createProgressDiagnostics, freezeAndroidProvider, diagnosticCodeFor,
  PROGRESS_MILESTONES: milestones, PROGRESS_MAX_RECORDS: maxRecords } = require(wrapperPath);
const { summarizeProgress, readManagedProgress, classifyDiagnostic, PROGRESS_MILESTONES,
  PROGRESS_MAX_RECORDS, PROGRESS_MAX_BYTES } = require(reporterPath);
const bytes = records => Buffer.from(records.join('\n') + '\n');
const rootDirectory = () => realpathSync(mkdtempSync(join(tmpdir(), 'phone11-progress-')));
const fixedFile = root => join(root, 'phone11-android-build-progress.txt');
const unavailable = { schema: 'phone11.android-build-progress.v1', status: 'UNAVAILABLE', lastObservedMilestone: null };
const malformed = { ...unavailable, status: 'MALFORMED' };
const observation = lastObservedMilestone => ({ ...unavailable, status: 'OBSERVED_PREFIX', lastObservedMilestone });

test('canonical progress permits incomplete observations and sequential read cycles only', () => {
  assert.deepEqual(milestones, PROGRESS_MILESTONES);
  assert.equal(maxRecords, PROGRESS_MAX_RECORDS);
  assert.ok(Object.isFrozen(milestones));
  for (let count = 1; count <= milestones.length; count++) {
    assert.deepEqual(summarizeProgress(bytes(milestones.slice(0, count))), observation(milestones[count - 1]));
  }
  for (let count = 1; count <= 4; count++) {
    const records = [...milestones, ...milestones.slice(3, 3 + count)];
    assert.deepEqual(summarizeProgress(bytes(records)), observation(records.at(-1)));
  }
  assert.deepEqual(summarizeProgress(Buffer.alloc(0)), unavailable);
});

test('malformed, truncated, overlapping and malicious streams expose no earlier milestone', () => {
  const hostile = { toString() { assert.fail('No conversion of untrusted objects'); } };
  for (const value of [undefined, hostile, 'SOURCE_CONFIG_VERIFIED\n', Buffer.from('\n'),
    Buffer.from('SOURCE_CONFIG_VERIFIED'), bytes(['SOURCE_CONFIG_VERIFIED', 'SOURCE_CONFIG_VERIFIED']),
    bytes(milestones.slice(1)), bytes([...milestones, 'GUARD_INSTALLED']),
    bytes([...milestones.slice(0, 4), 'REMOTE_READ_STARTED']),
    bytes([...milestones.slice(0, 5), 'REMOTE_READ_STARTED']),
    bytes([...milestones.slice(0, 5), 'CONVERSION_COMPLETED']),
    bytes([...milestones, 'PROGRESS_UNAVAILABLE']), bytes([...milestones, 'private-sentinel']),
    Buffer.from('SOURCE_CONFIG_VERIFIED\r\n'), Buffer.from([0xff, 10]),
    bytes(['{"message":"private-sentinel"}']), bytes(['\u001b[31mprivate-sentinel']),
    Buffer.alloc(PROGRESS_MAX_BYTES + 1, 65),
    bytes([...milestones.slice(0, 3), ...Array.from({ length: 32 }, () => milestones.slice(3)).flat()])]) {
    assert.deepEqual(summarizeProgress(value), malformed);
    assert.equal(JSON.stringify(summarizeProgress(value)).includes('private-sentinel'), false);
  }
});

test('writer invalidates unknown, short and failed sinks and bounds further output', () => {
  for (const mode of ['unknown', 'short', 'throw', 'limit']) {
    const output = [];
    const progress = createProgressDiagnostics(value => {
      output.push(value);
      if (mode === 'short' && output.length === 1) return 1;
      if (mode === 'throw' && output.length === 1) throw new Error('private-sentinel');
    });
    if (mode === 'unknown') progress.record({ toString() { assert.fail('No arbitrary values'); } });
    else if (mode === 'limit') for (let i = 0; i <= maxRecords; i++) progress.record('SOURCE_CONFIG_VERIFIED');
    else progress.record('SOURCE_CONFIG_VERIFIED');
    const count = output.length;
    assert.doesNotThrow(() => progress.record('GUARD_INSTALLED'));
    assert.equal(output.length, count);
    assert.equal(output.at(-1), 'PROGRESS_UNAVAILABLE\n');
    assert.equal(milestones.includes('PROGRESS_UNAVAILABLE'), false);
    assert.deepEqual(summarizeProgress(Buffer.from(output.join(''))), malformed);
    assert.ok(count <= maxRecords + 1);
  }
  assert.doesNotThrow(() => createProgressDiagnostics(() => { throw new Error('private-sentinel'); }).record('SOURCE_CONFIG_VERIFIED'));
});

function fixture(read, convert = value => value, progress) {
  let writes = 0;
  class Provider {
    constructor() { this.ctx = {}; this.options = {}; }
    getRemoteAsync() { writes++; }
    getLocalAsync() { writes++; }
    toAndroidCredentials(value) { return convert(value); }
  }
  class Setup { getFullySetupBuildCredentialsAsync() { return read(); } }
  class Create { runAsync() { writes++; } provideOrGenerateAsync() { writes++; } }
  freezeAndroidProvider(Provider, Setup, Create, progress);
  return { provider: new Provider(), Create, writes: () => writes };
}
function captureProgress() {
  const records = [];
  const progress = createProgressDiagnostics(value => { records.push(value); });
  milestones.slice(0, 3).forEach(progress.record);
  return { progress, summary: () => summarizeProgress(Buffer.from(records.join(''))) };
}

test('credential-read and conversion boundaries preserve success and owned refusal semantics', async () => {
  let existing = { androidKeystore: {} };
  const capture = captureProgress();
  const { provider, Create, writes } = fixture(async () => existing, value => value, capture.progress);
  assert.equal(await provider.getRemoteAsync(), existing);
  assert.equal(await provider.getRemoteAsync(), existing);
  assert.deepEqual(capture.summary(), observation('CONVERSION_COMPLETED'));
  existing = null;
  await assert.rejects(provider.getRemoteAsync(), error => diagnosticCodeFor(error) === 'E_ANDROID_EXISTING_CREDENTIALS_REQUIRED');
  assert.deepEqual(capture.summary(), observation('REMOTE_READ_COMPLETED'));
  assert.throws(() => provider.getLocalAsync(), error => diagnosticCodeFor(error) === 'E_ANDROID_LOCAL_CREDENTIALS_BLOCKED');
  for (const method of ['runAsync', 'provideOrGenerateAsync']) {
    assert.throws(() => new Create()[method](), error => diagnosticCodeFor(error) === 'E_ANDROID_CREDENTIAL_GENERATION_BLOCKED');
  }
  assert.equal(writes(), 0);
});

test('unknown async read and sync conversion errors remain unknown with literal observations', async () => {
  const hostile = Object.defineProperty({}, 'message', { get() { assert.fail('No provider error text'); } });
  for (const boundary of ['read', 'convert']) {
    const capture = captureProgress();
    const { provider } = fixture(async () => {
      if (boundary === 'read') throw hostile;
      return { androidKeystore: {} };
    }, () => { throw hostile; }, capture.progress);
    await assert.rejects(provider.getRemoteAsync(), error => error === hostile && diagnosticCodeFor(error) === 'UNKNOWN_CLI_FAILURE');
    assert.deepEqual(capture.summary(), observation(boundary === 'read' ? 'REMOTE_READ_STARTED' : 'CONVERSION_STARTED'));
  }
});

test('concurrent reads invalidate lifecycle interpretation without changing credential results', async () => {
  const pending = [], capture = captureProgress(), existing = { androidKeystore: {} };
  const { provider } = fixture(() => new Promise(resolve => pending.push(resolve)), value => value, capture.progress);
  const first = provider.getRemoteAsync(), second = provider.getRemoteAsync();
  pending[1](existing); pending[0](existing);
  assert.deepEqual(await Promise.all([first, second]), [existing, existing]);
  assert.deepEqual(capture.summary(), malformed);
  const broken = fixture(async () => existing, value => value, { record() { throw new Error('private-sentinel'); } });
  assert.equal(await broken.provider.getRemoteAsync(), existing);
});

test('progress sink loss never changes a successful credential result or emits an FD3 failure', () => {
  const root = rootDirectory(), fd3File = join(root, 'fd3'), fd4File = join(root, 'fd4');
  const fd3 = openSync(fd3File, 'w', 0o600), fd4 = openSync(fd4File, 'w', 0o600);
  try {
    const code = `const w=require(${JSON.stringify(wrapperPath)});require('node:fs').closeSync(4);
      w.createFailureDiagnostics();const progress=w.createProgressDiagnostics();
      w.PROGRESS_MILESTONES.slice(0,3).forEach(progress.record);
      class P {constructor(){this.ctx={};this.options={};}getRemoteAsync(){}getLocalAsync(){}toAndroidCredentials(v){return v;}}
      class S {async getFullySetupBuildCredentialsAsync(){return {androidKeystore:{}};}}
      class C {runAsync(){}provideOrGenerateAsync(){}}
      w.freezeAndroidProvider(P,S,C,progress);new P().getRemoteAsync().then(()=>{process.stdout.write('SYNTHETIC_SUCCESS\\n');});`;
    const result = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe', fd3, fd4],
      env: { LANG: 'C', NODE_ENV: 'test' }, timeout: 5000, maxBuffer: 8192 });
    assert.equal(result.error, undefined); assert.equal(result.status, 0);
    assert.equal(result.stdout, 'SYNTHETIC_SUCCESS\n'); assert.equal(result.stderr, '');
    assert.equal(readFileSync(fd3File).length, 0); assert.equal(readFileSync(fd4File).length, 0);
  } finally { closeSync(fd3); closeSync(fd4); rmSync(root, { recursive: true, force: true }); }
});

function descriptorChild(mode, unknown = false) {
  const root = rootDirectory(), diagnosticFile = join(root, 'fd3'), progressFile = join(root, 'fd4');
  const fd3 = openSync(diagnosticFile, 'w', 0o600), fd4 = openSync(progressFile, 'w', 0o600);
  try {
    const code = `const w=require(${JSON.stringify(wrapperPath)}); const fs=require('node:fs');
      const diagnostic=w.createFailureDiagnostics(); const progress=w.createProgressDiagnostics();
      ${mode === 'closed' ? 'fs.closeSync(4);' : ''}
      w.PROGRESS_MILESTONES.slice(0,3).forEach(progress.record);
      class P { constructor(){this.ctx={};this.options={};} getRemoteAsync(){} getLocalAsync(){} toAndroidCredentials(v){return v;} }
      class S { async getFullySetupBuildCredentialsAsync(){${unknown ? "throw new Error('private-sentinel');" : 'return null;'}} }
      class C {runAsync(){} provideOrGenerateAsync(){}}
      w.freezeAndroidProvider(P,S,C,progress);
      new P().getRemoteAsync().catch(error=>{diagnostic.record(error);process.exitCode=1;});`;
    const result = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8',
      stdio: mode === 'missing' ? ['ignore', 'pipe', 'pipe', fd3] : ['ignore', 'pipe', 'pipe', fd3, fd4],
      env: { LANG: 'C', NODE_ENV: 'test' }, timeout: 5000, maxBuffer: 8192 });
    assert.equal(result.error, undefined); assert.equal(result.status, 1);
    assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
    assert.equal(classifyDiagnostic(readFileSync(diagnosticFile)), unknown ? 'UNKNOWN_CLI_FAILURE' : 'E_ANDROID_EXISTING_CREDENTIALS_REQUIRED');
    assert.deepEqual(summarizeProgress(readFileSync(progressFile)), mode === 'normal'
      ? observation(unknown ? 'REMOTE_READ_STARTED' : 'REMOTE_READ_COMPLETED') : unavailable);
  } finally { closeSync(fd3); closeSync(fd4); rmSync(root, { recursive: true, force: true }); }
}

test('real child FD3 and FD4 remain independent for normal, closed and missing progress sinks', () => {
  for (const mode of ['normal', 'closed', 'missing']) for (const unknown of [false, true]) descriptorChild(mode, unknown);
});

test('managed progress reader restricts filename and rejects unsafe file shapes without blocking', () => {
  const root = rootDirectory(), fixed = fixedFile(root), other = join(root, 'other');
  const read = () => summarizeProgress(readManagedProgress({ RUNNER_TEMP: root, PHONE11_ANDROID_PROGRESS_PATH: other }));
  try {
    assert.deepEqual(read(), unavailable);
    writeFileSync(other, bytes(milestones));
    writeFileSync(fixed, bytes(milestones));
    assert.deepEqual(read(), observation('CONVERSION_COMPLETED'));
    writeFileSync(fixed, ''); assert.deepEqual(read(), unavailable);
    writeFileSync(fixed, Buffer.alloc(PROGRESS_MAX_BYTES + 1)); assert.deepEqual(read(), malformed);
    rmSync(fixed); symlinkSync(other, fixed); assert.deepEqual(read(), unavailable);
    rmSync(fixed); linkSync(other, fixed); assert.deepEqual(read(), malformed);
    rmSync(fixed); mkdirSync(fixed); assert.deepEqual(read(), malformed); rmSync(fixed, { recursive: true });
    const fifo = spawnSync('/usr/bin/mkfifo', [fixed], { encoding: 'utf8', timeout: 5000 });
    assert.equal(fifo.status, 0);
    const result = spawnSync(process.execPath, ['-e', `const r=require(${JSON.stringify(reporterPath)});process.stdout.write(JSON.stringify(r.summarizeProgress(r.readManagedProgress({RUNNER_TEMP:${JSON.stringify(root)}}))));`],
      { encoding: 'utf8', env: { LANG: 'C' }, timeout: 5000, maxBuffer: 8192 });
    assert.equal(result.error, undefined); assert.equal(result.status, 0); assert.deepEqual(JSON.parse(result.stdout), malformed);
    assert.deepEqual(summarizeProgress(readManagedProgress({ RUNNER_TEMP: 'relative' })), unavailable);
    const alias = join(root, 'alias'); symlinkSync(root, alias);
    assert.deepEqual(summarizeProgress(readManagedProgress({ RUNNER_TEMP: alias })), unavailable);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('actual reporter outputs fixed failure and canonical progress only, including malformed input', () => {
  const root = rootDirectory();
  try {
    writeFileSync(join(root, 'phone11-android-build-diagnostic.json'), '{"schema":"phone11.android-build-diagnostic.v1","failureCode":"E_ANDROID_TRIAL_PROJECT"}\n');
    for (const records of [milestones.slice(0, 4), [...milestones, 'private-sentinel']]) {
      writeFileSync(fixedFile(root), bytes(records));
      const result = spawnSync(process.execPath, [reporterPath], { encoding: 'utf8', env: { RUNNER_TEMP: root, LANG: 'C' }, timeout: 5000 });
      assert.equal(result.status, 0); assert.equal(result.stdout, '');
      const lines = result.stderr.trim().split('\n'); assert.equal(lines.length, 2);
      assert.equal(lines[0], 'Phone11 Android internal build failed (E_ANDROID_TRIAL_PROJECT). The fixed Phone11 Expo project did not match. Signing remains restricted to existing credentials.');
      assert.deepEqual(JSON.parse(lines[1]), records.length === 4 ? observation('REMOTE_READ_STARTED') : malformed);
      assert.equal(result.stderr.includes('private-sentinel'), false); assert.equal(result.stderr.includes(root), false);
    }
    const unexpected = spawnSync(process.execPath, [reporterPath, 'private-sentinel'], { encoding: 'utf8', env: { RUNNER_TEMP: root }, timeout: 5000 });
    assert.match(unexpected.stderr, /UNKNOWN_CLI_FAILURE/); assert.equal(unexpected.stderr.includes('private-sentinel'), false);
    assert.deepEqual(JSON.parse(unexpected.stderr.trim().split('\n')[1]), unavailable);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
