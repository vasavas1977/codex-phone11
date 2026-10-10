// One fixed request. Raw CLI streams remain bounded in this process, never files/logs.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { parseResponse, MAX_BYTES } from './read-phone11-mobile-build-history.mjs';
const guard = createRequire(import.meta.url)('./run-phone11-ios-existing-build.cjs');
const CODES = new Set([...guard.FAILURE_CODES, 'TOKEN_UNAVAILABLE', 'TIMEOUT', 'INTERRUPTED', 'OUTPUT_LIMIT', 'RESULT_REFUSED', 'CHILD_FAILED']);
export const TIMEOUT_MS = 119 * 60 * 1000;
export const STDERR_LIMIT = 4 * 1024 * 1024;
// Retained signed daily-pilot Build123 (source237); metadata must be newer.
// Pinned in source, never lowered by request input or runtime configuration.
export const RETAINED_SIGNED_PILOT_BUILD = 123n;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function failureReceipt(code, mayHaveOccurred = false) {
  return { outcome: 'REFUSED', failureCode: CODES.has(code) ? code : 'CHILD_FAILED',
    requestMayHaveOccurred: mayHaveOccurred === true, absenceEstablished: false, retryAuthorized: false,
    artifactVerified: false, installed: false, physicalAcceptance: false };
}
export function validateResult(bytes, source) {
  const rows = parseResponse(bytes);
  if (!/^[a-f0-9]{40}$/.test(source ?? '') || !Array.isArray(rows) || rows.length !== 1) throw new Error('RESULT_REFUSED');
  const b = rows[0];
  if (!b || !UUID.test(b.id ?? '') || b.status !== 'FINISHED' || b.platform !== 'IOS'
      || b.gitCommitHash !== source || b.distribution !== 'INTERNAL' || b.buildProfile !== guard.PROFILE
      || b.app?.id !== guard.PROJECT || b.app.slug !== 'phone11ai' || b.app.ownerAccount?.name !== 'vasavas'
      || b.appIdentifier !== guard.BUNDLE || b.appVersion !== '1.0.0'
      || typeof b.appBuildVersion !== 'string' || !/^[1-9][0-9]{0,17}$/.test(b.appBuildVersion)
      || BigInt(b.appBuildVersion) <= RETAINED_SIGNED_PILOT_BUILD || b.error != null) throw new Error('RESULT_REFUSED');
  // Only typed literals, validated UUID/decimal/SHA survive; private fragment fields do not.
  return { outcome: 'FINISHED_METADATA_ONLY', id: b.id, status: 'FINISHED', projectId: guard.PROJECT,
    platform: 'IOS', distribution: 'INTERNAL', buildProfile: guard.PROFILE, appIdentifier: guard.BUNDLE,
    appVersion: '1.0.0', appBuildVersion: b.appBuildVersion, gitCommitHash: source,
    buildDetailsUrl: `https://expo.dev/accounts/vasavas/projects/phone11ai/builds/${b.id}`,
    existingRemoteAdHocOnly: true, credentialMutationBlocked: true, trialOnly: true, trialSeconds: 60,
    artifactVerified: false, installed: false, physicalAcceptance: false, retryAuthorized: false };
}
function diagnostic(bytes) {
  try {
    const d = parseResponse(bytes);
    if (!d || Object.keys(d).length !== 2 || !guard.FAILURE_CODES.includes(d.failureCode)
        || typeof d.requestMayHaveOccurred !== 'boolean') return null;
    return d;
  } catch { return null; }
}
export function captureChild({ env, head, spawnChild = spawn, timers = { setTimeout, clearTimeout },
  signals = process, killGroup = (pid, signal) => process.kill(-pid, signal), timeoutMs = TIMEOUT_MS }) {
  return new Promise(resolveResult => {
    let child, timer, hardTimer, stopped = false, reason, stderrBytes = 0, stdoutBytes = 0, diagBytes = 0;
    const stdout = [], diag = [];
    const cancel = () => stop('INTERRUPTED');
    const kill = signal => { try { killGroup(child.pid, signal); } catch { try { child.kill(signal); } catch { /* Still wait for close. */ } } };
    const stop = code => {
      if (stopped || reason) return; reason = code; kill('SIGTERM');
      hardTimer = timers.setTimeout(() => { kill('SIGKILL'); finish(failureReceipt(code, true)); }, 5000);
    };
    const finish = report => {
      if (stopped) return; stopped = true;
      timers.clearTimeout(timer); timers.clearTimeout(hardTimer);
      signals.removeListener('SIGTERM', cancel); signals.removeListener('SIGINT', cancel);
      for (const bytes of [...stdout, ...diag]) bytes.fill(0);
      stdout.length = 0; diag.length = 0;
      resolveResult(report);
    };
    try {
      const childEnv = { ...env, EXPO_NO_TELEMETRY: '1', PHONE11_APP_STORE_BUILD: '0',
        PHONE11_ANDROID_FOREGROUND_TRIAL: '0', EXPO_PUBLIC_PHONE11_ANDROID_FOREGROUND_TRIAL: '0',
        PHONE11_ANDROID_SCREEN_TRANSACTION: '0', EXPO_PUBLIC_PHONE11_ANDROID_SCREEN_TRANSACTION: '0' };
      child = spawnChild(process.execPath, [fileURLToPath(new URL('./run-phone11-ios-existing-build.cjs', import.meta.url))],
        { cwd: fileURLToPath(new URL('..', import.meta.url)), env: childEnv, detached: true, stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
      if (!child.stdout || !child.stderr || !child.stdio?.[3]) throw new Error('CHILD_FAILED');
      signals.once('SIGTERM', cancel); signals.once('SIGINT', cancel);
      timer = timers.setTimeout(() => stop('TIMEOUT'), timeoutMs);
      child.stdout.on('data', chunk => {
        if (stopped || reason) return;
        if (!Buffer.isBuffer(chunk) || (stdoutBytes += chunk.length) > MAX_BYTES) return stop('OUTPUT_LIMIT');
        stdout.push(Buffer.from(chunk));
      });
      // Never store or relay stderr, including private identifiers and provider errors.
      child.stderr.on('data', chunk => { if (!stopped && !reason && (stderrBytes += chunk.length) > STDERR_LIMIT) stop('OUTPUT_LIMIT'); });
      child.stdio[3].on('data', chunk => {
        if (stopped || reason) return;
        if (!Buffer.isBuffer(chunk) || (diagBytes += chunk.length) > 1024) return stop('OUTPUT_LIMIT');
        diag.push(Buffer.from(chunk));
      });
      for (const stream of [child.stdout, child.stderr, child.stdio[3]]) stream.on('error', () => stop('CHILD_FAILED'));
      child.on('error', () => { if (child.pid) kill('SIGKILL'); finish(failureReceipt('CHILD_FAILED', true)); });
      child.on('close', (code, signal) => {
        if (stopped) return;
        if (reason || signal || code !== 0) {
          const d = diagnostic(Buffer.concat(diag));
          return finish(failureReceipt(reason ?? d?.failureCode ?? 'UNKNOWN_CLI_FAILURE', reason ? true : d?.requestMayHaveOccurred ?? true));
        }
        if (diagBytes) return finish(failureReceipt('CHILD_FAILED', true));
        try { finish(validateResult(Buffer.concat(stdout), head)); }
        catch { finish(failureReceipt('RESULT_REFUSED', true)); }
      });
    } catch { if (child?.pid) kill('SIGKILL'); finish(failureReceipt('CHILD_FAILED', Boolean(child))); }
  });
}
export async function run({ env, args = [], execArgs = [], checkSource = guard.checkSource, capture = captureChild }) {
  let started = false;
  try {
    const checkOnly = args.length === 1 && args[0] === '--check-source';
    const head = checkSource(env, checkOnly ? [] : args, execArgs);
    if (checkOnly) return { outcome: 'SOURCE_READY_ONLY', sourceSha: head, buildRequested: false };
    const token = env.EXPO_TOKEN;
    if (typeof token !== 'string' || !/^[!-~]{1,4096}$/.test(token)) return failureReceipt('TOKEN_UNAVAILABLE', false);
    started = true;
    const report = await capture({ env, head });
    if (JSON.stringify(report).includes(token)) return failureReceipt('RESULT_REFUSED', true);
    return report;
  } catch { return failureReceipt(started ? 'CHILD_FAILED' : 'INVOCATION_REFUSED', started); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await run({ env: process.env, args: process.argv.slice(2), execArgs: process.execArgv });
  process.stdout.write(JSON.stringify(report) + '\n');
  if (report.outcome === 'REFUSED') process.exitCode = 1;
}
