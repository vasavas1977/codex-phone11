/** Run only after parent approval: LAB_EMULATOR_SERIAL=emulator-... LAB_EXPECTED_APK_SHA256=... node lab/android/error-test.mjs --execute
 * No UI module is imported unless --execute is present. --self-test is entirely offline.
 * Writes its own immutable attempt files, never .lab/attempts.json. No automatic reruns.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { sha256, sanitize, matrix, validateAttempt } from './core.mjs';
import { validateState, validateRuntime } from './fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pkg = 'ai.phone11.mobile.lab';
const permission = 'android.permission.RECORD_AUDIO';
const supported = ['SIP-02', 'PERM-01', 'LIFE-02', 'SIP-11'];
class Gap extends Error {}
const check = (condition, message) => { if (!condition) throw new Error(message); };
const proof = (condition, message) => { if (!condition) throw new Gap(message); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const select = text => {
  const ids = (text || 'SIP-02,PERM-01,LIFE-02').split(',');
  check(ids.length > 0 && new Set(ids).size === ids.length && ids.every(id => supported.includes(id)), 'Unsupported or repeated test selection');
  return ids;
};
const nextAttempt = (names, previous = []) => {
  const numbers = names.map(name => /^attempt-([1-3])\.json$/.exec(name)).filter(Boolean).map(match => Number(match[1]));
  const prior = previous.filter(row => row.execution_started || row.result !== 'NOT_RUN').map(row => Number(row.attempt || 0));
  const next = 1 + Math.max(0, ...numbers, ...prior);
  check(next <= 3, 'Three attempts already recorded; earlier failures must be preserved');
  return next;
};
const safeSnapshot = value => Object.fromEntries(['initialized', 'sdk', 'generation', 'sequence', 'registration', 'call', 'callCount', 'muted', 'held', 'ended', 'error', 'events'].filter(key => value[key] !== undefined).map(key => [key, value[key]]));

async function main() {
  if (process.argv.includes('--self-test')) {
    const assert = (await import('node:assert/strict')).default;
    assert.deepEqual(select(), ['SIP-02', 'PERM-01', 'LIFE-02']);
    assert.throws(() => select('SIP-02,SIP-02'));
    assert.throws(() => select('FCM-01'));
    assert.equal(nextAttempt([]), 1);
    assert.equal(nextAttempt(['attempt-1.json', 'attempt-2.json']), 3);
    assert.throws(() => nextAttempt(['attempt-1.json', 'attempt-2.json', 'attempt-3.json']));
    assert.equal(safeSnapshot({ call: 'none', password: 'private' }).password, undefined);
    assert.equal(nextAttempt([], [{ attempt: 2, result: 'FAIL' }]), 3);
    console.log('8 offline harness assertions passed; no ADB, emulator, PBX, or fixture mutation');
    return;
  }
  if (!process.argv.includes('--execute')) {
    console.log('Prepared only. After approval, set LAB_EMULATOR_SERIAL and LAB_EXPECTED_APK_SHA256, then run with --execute. Optional LAB_ERROR_TESTS=SIP-02,PERM-01,LIFE-02,SIP-11. --self-test is offline.');
    return;
  }
  process.chdir(root);
  const ids = select(process.env.LAB_ERROR_TESTS);
  const expected = process.env.LAB_EXPECTED_APK_SHA256;
  check(/^[a-f0-9]{64}$/.test(expected || ''), 'Pin the final reviewed APK using LAB_EXPECTED_APK_SHA256');
  const fixture = validateState(JSON.parse(fs.readFileSync('.lab/fixture.json')));
  const apk = JSON.parse(fs.readFileSync('.lab/apk.json'));
  check(apk.sha256 === expected && fs.existsSync(apk.apk) && sha256(fs.readFileSync(apk.apk)) === expected, 'Reviewed local APK does not match final hash');
  const correct = fixture.accounts?.['7101']?.password;
  check(/^[a-f0-9]{48}$/.test(correct || ''), 'Fixture7101 password missing or invalid');
  const wrong = (correct[0] === '0' ? '1' : '0') + correct.slice(1);
  const clean = value => sanitize(value, [correct, wrong, ...Object.values(fixture.accounts).map(account => account.password)]);
  const runId = `errors-${Date.now()}`;
  const directory = `.lab/${runId}`;
  const heldLocks = [];
  let ui, historyOn = false, touched = false, permissionChanged = false, row, ownedCall = false, cleanup = 'not_started';
  const rows = [];
  const attempts = new Map();
  const priorGlobal = fs.existsSync('.lab/attempts.json') ? JSON.parse(fs.readFileSync('.lab/attempts.json')) : [];
  const write = (file, value) => fs.writeFileSync(file, JSON.stringify(clean(value), null, 2), { mode: 0o600 });
  const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] });
  const pbx = command => docker(['exec', fixture.container, 'asterisk', '-rx', command]);
  const assertFixture = () => {
    const container = JSON.parse(docker(['inspect', fixture.container]))[0];
    const network = JSON.parse(docker(['network', 'inspect', fixture.network]))[0];
    for (const labels of [container.Config?.Labels, network.Labels]) check(labels?.['com.phone11.android-lab.owner'] === fixture.owner && labels?.['com.phone11.android-lab.run'] === fixture.runId, 'Fixture runtime ownership mismatch');
    validateRuntime(container, network);
    check(/TIMEOUT\(absolute\)=20/.test(pbx('dialplan show 7190@lab')), 'Tone fixture lacks the independent20-second call cap');
  };
  const channels = () => pbx('core show channels concise').split('\n').map(line => line.split('!')).filter(parts => /^PJSIP\/7101-[a-f0-9]+$/.test(parts[0])).map(parts => ({ name: parts[0], extension: parts[2], state: parts[4] }));
  async function noChannels() {
    const deadline = Date.now() + 5000;
    do { const current = channels(); if (!current.length) return current; await delay(200); } while (Date.now() < deadline);
    throw new Error('A synthetic7101 PBX channel remains');
  }
  const observe = value => { const snapshot = safeSnapshot(value); row?.observations.push({ at: new Date().toISOString(), native: snapshot }); return snapshot; };
  const wait = async (predicate, timeout = 10000) => observe(await ui.waitFor(predicate, timeout));
  const processIdentity = () => {
    const pid = ui.shell('pidof', pkg).trim();
    proof(/^\d+$/.test(pid), 'Exactly one app process could not be identified');
    // /proc starttime prevents a recycled PID from being called process continuity.
    const stat = ui.shell('cat', `/proc/${pid}/stat`).trim();
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(/\s+/);
    proof(/^\d+$/.test(fields[19] || ''), 'App process starttime is unavailable');
    return { pid: Number(pid), startTicks: fields[19] };
  };
  const hasMicrophone = () => {
    const result = ui.shell('dumpsys', 'package', pkg).match(/android\.permission\.RECORD_AUDIO:\s*granted=(true|false)/);
    proof(Boolean(result), 'Runtime microphone permission is not observable');
    return result[1] === 'true';
  };
  async function visiblePermissionRecovery() {
    if (hasMicrophone()) return;
    ui.tap('Microphone');
    const visible = ui.nodes();
    const allow = visible.find(node => /permission_allow_foreground_only_button$/.test(node['resource-id'] || '') || node.text === 'While using the app');
    proof(Boolean(allow?.text), 'Android did not offer a visible foreground microphone grant; no shell grant or settings bypass used');
    ui.tap(allow.text);
    proof(hasMicrophone(), 'Visible microphone permission recovery was not confirmed');
    permissionChanged = false;
  }
  async function resetAndRegister(password = correct) {
    const current = ui.state();
    check(current.call === 'none' && channels().length === 0, 'Refusing to reset a call not created by this scenario');
    if (current.initialized) { ui.tap('Destroy'); await wait(value => !value.initialized); }
    ui.tap('Initialize'); await wait(value => value.initialized);
    ui.enterPassword(password); ui.tap('Register');
  }
  function historyNumbers() { return [...pbx('pjsip show history').matchAll(/^\s*(\d+)\s+\d+\s+\*\s+[<=>]+/gm)].map(match => Number(match[1])); }
  const mark = () => Math.max(-1, ...historyNumbers());
  function trace(since) {
    const numbers = historyNumbers().filter(number => number > since);
    check(numbers.length <= 120, 'SIP evidence exceeded bounded size');
    return numbers.map(number => {
      const raw = pbx(`pjsip show history entry ${number}`);
      const first = raw.split(/\r?\n/).find(line => /^(?:SIP\/2.0|[A-Z]+ sip:)/.test(line)) || '';
      const cseq = raw.match(/^CSeq:\s*(\d+)\s+(\w+)/im);
      const dialog = raw.match(/^Call-ID:\s*(.+)/im)?.[1]?.trim();
      return { number, direction: raw.includes('Sent to') ? 'TX' : 'RX', method: cseq?.[2], cseq: Number(cseq?.[1]), status: Number(first.match(/^SIP\/2.0 (\d+)/)?.[1]) || null, dialog: dialog ? sha256(dialog).slice(0, 20) : null, authorizationPresent: /^(?:Proxy-)?Authorization:/mi.test(raw) };
    });
  }
  const exchange = (messages, method, status) => messages.some(request => request.direction === 'RX' && request.method === method && request.status === null && messages.some(reply => reply.direction === 'TX' && reply.method === method && reply.status === status && reply.cseq === request.cseq && reply.dialog === request.dialog));
  async function callTone() {
    check(ui.state().call === 'none' && !channels().length, 'Call precondition is not idle');
    ownedCall = true;
    ui.tap('Call tone'); const connected = await wait(value => value.call === 'connected', 8000);
    const peer = channels(); row.observations.push({ pbx: peer });
    check(peer.length === 1 && peer[0].state === 'Up' && peer[0].extension === '7190', 'One actual answered synthetic tone channel required');
    return connected;
  }
  async function endOwnedCall() {
    if (!ownedCall) return;
    if (ui.state().call !== 'none') { ui.tap('Hang up'); await wait(value => value.call === 'none', 5000); }
    await noChannels(); ownedCall = false;
  }
  const persist = () => {
    if (row) write(attempts.get(row.test_id).file, row);
    write(`${directory}/results.json`, { runId, results: rows, firstFailurePreserved: true, globalAttemptsModified: false, cleanup });
  };
  async function scenario(id, body) {
    const record = attempts.get(id);
    row = { test_id: id, run_id: runId, attempt: record.number, commit_sha: apk.commit, apk_sha256: expected, evidence_level: matrix.find(test => test.id === id).level, mode: 'real', emulator_serial: ui.serial, api_level: 35, abi: 'arm64-v8a', start: new Date().toISOString(), result: 'NOT_RUN', reason: 'Execution started', execution_started: true, assertions: [], observations: [], artifacts: [record.file.slice(5)], cleanup_result: 'pending', scope: id === 'LIFE-02' ? 'HOME/background/foreground only; not process-death, rotation, FCM or background wake acceptance' : 'Dedicated synthetic lab runtime only' };
    rows.push(row); persist();
    try { row.assertions = await body(); row.result = 'PASS'; row.reason = ''; }
    catch (error) { row.result = error instanceof Gap ? 'BLOCKED' : 'FAIL'; row.reason = clean(error instanceof Error && !('stdout' in error) && !('stderr' in error) ? error.message : 'Harness operation failed; raw command output withheld'); }
    finally {
      try {
        if (ownedCall) { ui.openLab(); await ui.waitFor(() => true, 8000); }
        await endOwnedCall(); row.cleanup_result = 'completed';
      }
      catch { row.cleanup_result = 'failed'; if (row.result === 'PASS') { row.result = 'FAIL'; row.reason = 'Scenario cleanup failed'; } }
      row.end = new Date().toISOString(); validateAttempt(row); persist();
      console.log(JSON.stringify({ test: id, attempt: row.attempt, result: row.result, artifact: record.file }));
    }
    if (row.result === 'FAIL' || row.cleanup_result === 'failed') throw new Error('Stopped after first failure; evidence retained');
  }
  try {
    // Also take the SIP lock so the existing SIP runner cannot start concurrently.
    const conflicts = fs.readdirSync('.lab').filter(name => /^(?:sip|media|error).*\.lock$/.test(name));
    check(!conflicts.length, 'Another SIP/media/error run owns the lab; no device touched');
    for (const name of ['sip-run.lock', 'media-run.lock', 'error-run.lock']) {
      const file = `.lab/${name}`; const fd = fs.openSync(file, 'wx', 0o600);
      fs.writeFileSync(fd, JSON.stringify({ runId, pid: process.pid })); fs.closeSync(fd); heldLocks.push(file);
    }
    fs.mkdirSync(directory, { mode: 0o700 });
    for (const id of ids) {
      const base = `.lab/error-attempts/${id}`; fs.mkdirSync(base, { recursive: true, mode: 0o700 });
      const number = nextAttempt(fs.readdirSync(base), priorGlobal.filter(row => row.test_id === id)); const file = `${base}/attempt-${number}.json`;
      fs.writeFileSync(file, JSON.stringify({ test_id: id, attempt: number, run_id: runId, result: 'NOT_RUN', reason: 'Reserved before device preflight', execution_started: false }), { flag: 'wx', mode: 0o600 });
      attempts.set(id, { number, file });
    }
    assertFixture();
    ui = await import('./ui.mjs'); // First possible ADB access; only under --execute and locks.
    const packagePaths = ui.shell('pm', 'path', pkg).trim().split(/\r?\n/);
    check(packagePaths.length === 1 && /^package:\/data\/app\/[A-Za-z0-9_/.+=~-]+\/base\.apk$/.test(packagePaths[0]), 'Installed lab APK path is unexpected');
    const installedHash = ui.shell('sha256sum', packagePaths[0].slice(8)).trim().split(/\s+/)[0];
    check(installedHash === expected, 'Installed APK differs from final reviewed APK');
    write(`${directory}/identity.json`, { apk_sha256: expected, installed_apk_sha256: installedHash, source_sha: apk.commit, source_dirty: apk.sourceDirty, fixture_run: fixture.runId, serial: ui.serial });
    check(!channels().length, 'Existing synthetic call found; refusing takeover');
    ui.openLab(); await ui.waitFor(() => true, 8000);
    check(ui.state().call === 'none' && !ui.state().labMedia?.active, 'Existing native call or media capture found; refusing takeover');
    touched = true;
    check(pbx('pjsip set history on').includes('enabled'), 'PBX sanitized SIP history unavailable'); historyOn = true;
    for (const id of ids) {
      if (id === 'SIP-02') await scenario(id, async () => {
        const before = mark(); await resetAndRegister(wrong);
        const failed = await wait(value => value.registration === 'failed', 15000);
        check(failed.call === 'none' && !channels().length, 'Bad registration created a call');
        const rejected = trace(before); row.observations.push({ rejectedSip: rejected });
        proof(rejected.some(message => message.method === 'REGISTER' && message.authorizationPresent) && (exchange(rejected, 'REGISTER', 401) || exchange(rejected, 'REGISTER', 403)), 'Authenticated bad REGISTER rejection not observed');
        check(!exchange(rejected, 'REGISTER', 200), 'Bad credentials were accepted');
        const recovery = mark(); await resetAndRegister(); await wait(value => value.registration === 'registered');
        const restored = trace(recovery); row.observations.push({ recoverySip: restored });
        proof(exchange(restored, 'REGISTER', 200), 'Correct registration recovery lacks actual200');
        return ['SDK visibly failed bad authentication without false registered state', 'Correlated authenticated REGISTER rejection; no raw credentials persisted', 'Visible Destroy/Initialize/Register recovery received REGISTER200; retry observation is bounded, not proof about infinite future behavior'];
      });
      if (id === 'PERM-01') await scenario(id, async () => {
        await visiblePermissionRecovery();
        row.observations.push({ processBeforeRevoke: processIdentity(), permissionBefore: hasMicrophone() });
        ui.shell('pm', 'revoke', pkg, permission); permissionChanged = true;
        check(!hasMicrophone(), 'Microphone revoke did not take effect');
        // Android may kill this lab app on permission revocation. Record, do not hide it.
        ui.openLab(); await ui.waitFor(() => true, 8000);
        row.observations.push({ processAfterRevoke: processIdentity(), permissionAfterRevoke: false });
        await resetAndRegister(); await wait(value => value.registration === 'registered');
        const deniedMark = mark(); ui.tap('Call tone');
        const denied = await wait(value => Boolean(value.error), 5000);
        check(denied.call === 'none' && denied.callCount === 0, 'Denied microphone still created a native call');
        row.observations.push({ deniedSip: trace(deniedMark), pbxAfterDenied: await noChannels() });
        check(!trace(deniedMark).some(message => message.method === 'INVITE' && message.direction === 'RX' && message.status === null), 'Denied microphone sent INVITE');
        const clearDenial = /MICROPHONE|PERMISSION|RECORD_AUDIO/.test(denied.error || '');
        await visiblePermissionRecovery();
        row.observations.push({ permissionRecoveredVisibly: hasMicrophone() });
        await callTone(); await endOwnedCall();
        row.assertions = ['Microphone permission was actually revoked', 'Denied call produced no native call, INVITE, or PBX channel', 'Visible Android permission dialog restored access and an actual synthetic call connected'];
        proof(clearDenial, 'Recovery works, but denial lacks a microphone-specific actionable message (generic E_LAB_SCOPE is not permission clarity)');
        return row.assertions;
      });
      if (id === 'LIFE-02') await scenario(id, async () => {
        await visiblePermissionRecovery(); await resetAndRegister(); await wait(value => value.registration === 'registered');
        const active = await callTone(); const before = processIdentity();
        ui.shell('input', 'keyevent', 'KEYCODE_HOME');
        // HOME delivery is asynchronous. Observe only the system activity
        // manager until the launcher resumes; never dump/poll the app UI here.
        let home = []; const transitionDeadline = Date.now() + 3000;
        do {
          home = ui.shell('dumpsys', 'activity', 'activities').split('\n').filter(line => /mResumedActivity|topResumedActivity/.test(line));
          if (home.length > 0 && home.every(line => !line.includes(pkg))) break;
          await delay(150);
        } while (Date.now() < transitionDeadline);
        row.observations.push({ homeTransition: { resumedActivities: home.map(line => line.trim()), observation: 'bounded system dumpsys only; no background app UI polling' } });
        proof(home.length > 0 && home.every(line => !line.includes(pkg)), 'HOME did not produce an observed background transition');
        // One quiet background interval begins only after HOME is confirmed.
        // No ADB query, UI dump, tap, poll, or process query during these3seconds.
        await delay(3000);
        ui.openLab(); const after = await wait(() => true, 8000); const returned = processIdentity();
        row.observations.push({ lifecycle: { before, after: returned, homeObserved: true, quietBackgroundMs: 3000, sameProcess: before.pid === returned.pid && before.startTicks === returned.startTicks, sameGeneration: active.generation === after.generation, callBefore: active.call, callAfter: after.call }, pbxAfterForeground: channels() });
        if (after.call === 'none') await noChannels();
        else check(after.call === 'connected' && after.callCount === 1 && channels().length === 1, 'Foreground native/PBX call state diverged');
        await endOwnedCall();
        proof(before.pid === returned.pid && before.startTicks === returned.startTicks, 'App process changed during HOME transition; no same-process lifecycle claim');
        return ['Actual HOME/background followed by foreground; three seconds with zero background UI polling', `Native call outcome on return: ${after.call}; peer state recorded and cleanup verified`, 'PID and process starttime unchanged; no process-death, FCM, or rotation acceptance claimed'];
      });
      if (id === 'SIP-11') await scenario(id, async () => {
        await visiblePermissionRecovery(); await resetAndRegister(); await wait(value => value.registration === 'registered');
        const active = await callTone(); ui.tap('Call tone'); const rejected = await wait(value => Boolean(value.error), 5000);
        check(rejected.call === 'connected' && rejected.callCount === 1 && channels().length === 1, 'Duplicate dial corrupted active call');
        await endOwnedCall();
        row.assertions = ['Visible second dial during connected call was rejected without a second native/PBX call', 'Hangup cleaned the one call'];
        row.observations.push({ duplicateDial: { firstSequence: active.sequence, rejection: rejected.error, requestsDeliveredToNative: 'not_instrumented' } });
        throw new Gap('Sequential duplicate-dial guard observed; rapid answer/hangup delivery counts are not instrumented, so full SIP11 is not proven');
      });
    }
  } finally {
    if (touched && ui) {
      cleanup = 'completed';
      try {
        ui.openLab(); await ui.waitFor(() => true, 8000);
        await endOwnedCall();
        if (permissionChanged) await visiblePermissionRecovery();
        if (ui.state().initialized && ui.state().call === 'none') { ui.tap('Destroy'); await ui.waitFor(value => !value.initialized, 5000); }
        await noChannels();
      } catch {
        cleanup = 'failed';
        // Only this run's call on this owned fixture may be forcibly ended.
        if (ownedCall) try { for (const channel of channels()) pbx(`channel request hangup ${channel.name}`); await noChannels(); } catch {}
      }
    }
    if (historyOn) try { pbx('pjsip set history off'); } catch { cleanup = 'failed'; }
    if (fs.existsSync(directory)) persist();
    for (const file of heldLocks.reverse()) {
      try { if (JSON.parse(fs.readFileSync(file)).runId === runId) fs.unlinkSync(file); } catch {}
    }
    if (rows.some(result => result.result !== 'PASS') || cleanup === 'failed') process.exitCode = 1;
  }
}
main().catch(error => { console.error(error instanceof Gap ? 'Runtime proof blocked; inspect the private per-test evidence.' : 'Error harness stopped; no raw command output printed. Inspect private per-test evidence and lab locks.'); process.exitCode = 1; });
