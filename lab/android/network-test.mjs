/** Prepared bounded fixture-network test. No ADB/Docker/UI access without --execute.
 * LAB_EMULATOR_SERIAL=emulator-5580 LAB_EXPECTED_APK_SHA256=<reviewed hash>
 * node lab/android/network-test.mjs --execute
 * Only this checkout's PBX container is paused. No host firewall or network setting changes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { sha256, sanitize, validateAttempt } from './core.mjs';
import { validateState, validateRuntime } from './fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pkg = 'ai.phone11.mobile.lab';
const ids = ['SIP-03', 'NET-01'];
const ensure = (condition, message) => { if (!condition) throw new Error(message); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const safeState = value => Object.fromEntries(['initialized', 'sdk', 'generation', 'sequence', 'registration', 'call', 'callCount', 'ended', 'error', 'events'].filter(key => value[key] !== undefined).map(key => [key, value[key]]));
function nextAttempt(names, previous) {
  const existing = names.map(name => /^attempt-([1-3])\.json$/.exec(name)).filter(Boolean).map(match => Number(match[1]));
  const prior = previous.filter(row => row.execution_started || row.result !== 'NOT_RUN').map(row => Number(row.attempt || 0));
  const result = 1 + Math.max(0, ...existing, ...prior);
  ensure(result <= 3, 'Three network diagnostic attempts already exist; preserve them');
  return result;
}
function registrationExchange(raw) {
  // Parse an explicit allowlist. Never serialize complete SIP headers.
  const first = raw.split(/\r?\n/).find(line => /^(?:SIP\/2.0|[A-Z]+ sip:)/.test(line)) || '';
  const cseq = raw.match(/^CSeq:\s*(\d+)\s+(\w+)/im);
  const callId = raw.match(/^Call-ID:\s*(.+)/im)?.[1]?.trim();
  return { direction: raw.includes('Sent to') ? 'TX' : 'RX', method: cseq?.[2], cseq: Number(cseq?.[1]), status: Number(first.match(/^SIP\/2.0 (\d+)/)?.[1]) || null, dialog: callId ? sha256(callId).slice(0, 20) : null };
}
async function main() {
  if (process.argv.includes('--self-test')) {
    const assert = (await import('node:assert/strict')).default;
    assert.equal(nextAttempt([], []), 1);
    assert.equal(nextAttempt(['attempt-1.json'], []), 2);
    assert.equal(nextAttempt([], [{ attempt: 2, result: 'FAIL' }]), 3);
    assert.throws(() => nextAttempt(['attempt-3.json'], []));
    assert.equal(safeState({ registration: 'failed', password: 'private' }).password, undefined);
    const parsed = registrationExchange('<--- Received from local --->\nREGISTER sip:fixture SIP/2.0\nCall-ID: synthetic\nCSeq: 4 REGISTER\nAuthorization: secret-value\n');
    assert.equal(parsed.method, 'REGISTER'); assert.equal(parsed.direction, 'RX'); assert(!JSON.stringify(parsed).includes('secret-value'));
    console.log('8 offline network-harness assertions passed; no emulator/PBX access'); return;
  }
  if (!process.argv.includes('--execute')) {
    console.log('Prepared only. Set LAB_EMULATOR_SERIAL and LAB_EXPECTED_APK_SHA256 then --execute when the emulator is assigned to this runner. --self-test is offline.'); return;
  }
  process.chdir(root);
  const expected = process.env.LAB_EXPECTED_APK_SHA256;
  ensure(/^[a-f0-9]{64}$/.test(expected || ''), 'Expected final APK SHA256 is required');
  const fixture = validateState(JSON.parse(fs.readFileSync('.lab/fixture.json')));
  const apk = JSON.parse(fs.readFileSync('.lab/apk.json'));
  ensure(apk.sha256 === expected && sha256(fs.readFileSync(apk.apk)) === expected, 'Local APK identity mismatch');
  const secret = fixture.accounts?.['7101']?.password;
  ensure(/^[a-f0-9]{48}$/.test(secret || ''), 'Synthetic7101 credential format invalid');
  const clean = value => sanitize(value, Object.values(fixture.accounts).map(account => account.password));
  const write = (file, value, flag = 'w') => fs.writeFileSync(file, JSON.stringify(clean(value), null, 2), { mode: 0o600, flag });
  const runId = `network-${Date.now()}`, directory = `.lab/${runId}`, heldLocks = [], rows = [], attemptFiles = new Map();
  const prior = fs.existsSync('.lab/attempts.json') ? JSON.parse(fs.readFileSync('.lab/attempts.json')) : [];
  const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] });
  const pbx = command => docker(['exec', fixture.container, 'asterisk', '-rx', command]);
  let ui, touched = false, pauseRequested = false, historyOn = false, cleanup = 'not_started', outageTimer, interrupted = false, failureReason = '';
  const observations = [];
  const inspectOwned = () => {
    const container = JSON.parse(docker(['inspect', fixture.container]))[0];
    ensure(container.Config?.Labels?.['com.phone11.android-lab.owner'] === fixture.owner && container.Config?.Labels?.['com.phone11.android-lab.run'] === fixture.runId, 'Fixture container ownership changed');
    return container;
  };
  const unpause = () => {
    const container = inspectOwned();
    if (container.State.Paused && pauseRequested) docker(['unpause', fixture.container]);
    ensure(!inspectOwned().State.Paused, 'Fixture did not unpause');
    pauseRequested = false;
  };
  const signal = () => { interrupted = true; try { if (pauseRequested) unpause(); } catch {} };
  const persist = () => {
    if (!fs.existsSync(directory)) return;
    write(`${directory}/observations.json`, observations);
    write(`${directory}/results.json`, { runId, rows, cleanup, failureReason });
    for (const row of rows) if (attemptFiles.has(row.test_id)) write(attemptFiles.get(row.test_id), row);
  };
  const observe = value => { const current = safeState(value); observations.push({ at: new Date().toISOString(), native: current }); persist(); return current; };
  const historyNumbers = () => [...pbx('pjsip show history').matchAll(/^\s*(\d+)\s+\d+\s+\*\s+[<=>]+/gm)].map(match => Number(match[1]));
  const capture = since => {
    const numbers = historyNumbers().filter(number => number > since); ensure(numbers.length <= 128, 'Bounded SIP history exceeded');
    return numbers.map(number => ({ number, ...registrationExchange(pbx(`pjsip show history entry ${number}`)) }));
  };
  const has200 = messages => messages.some(request => request.direction === 'RX' && request.method === 'REGISTER' && !request.status && messages.some(reply => reply.direction === 'TX' && reply.method === 'REGISTER' && reply.status === 200 && reply.dialog === request.dialog && reply.cseq === request.cseq));
  const channels = () => pbx('core show channels concise').split('\n').filter(line => /^PJSIP\/7101-/.test(line));
  async function reset() {
    ensure(ui.state().call === 'none', 'Refusing to destroy an active call');
    if (ui.state().initialized) { ui.tap('Destroy'); await ui.waitFor(value => !value.initialized, 8000); }
    ui.tap('Initialize'); return observe(await ui.waitFor(value => value.initialized, 8000));
  }
  const register = () => { ui.enterPassword(secret); ui.tap('Register'); };
  try {
    ensure(!fs.readdirSync('.lab').some(name => /^(?:sip|media|error|network).*\.lock$/.test(name)), 'Another lab runner owns the emulator');
    for (const name of ['sip-run.lock', 'media-run.lock', 'error-run.lock', 'network-run.lock']) {
      const file = `.lab/${name}`, fd = fs.openSync(file, 'wx', 0o600); fs.writeFileSync(fd, JSON.stringify({ runId, pid: process.pid })); fs.closeSync(fd); heldLocks.push(file);
    }
    fs.mkdirSync(directory, { mode: 0o700 });
    for (const id of ids) {
      const base = `.lab/network-attempts/${id}`; fs.mkdirSync(base, { recursive: true, mode: 0o700 });
      const attempt = nextAttempt(fs.readdirSync(base), prior.filter(row => row.test_id === id));
      const file = `${base}/attempt-${attempt}.json`; attemptFiles.set(id, file);
      const row = { test_id: id, run_id: runId, attempt, commit_sha: apk.commit, apk_sha256: expected, evidence_level: 'L2', emulator_serial: process.env.LAB_EMULATOR_SERIAL, system_image: 'system-images;android-35;google_apis;arm64-v8a', api_level: 35, abi: 'arm64-v8a', sdk_version: 'not_observed', mode: 'real', preconditions: ['owned isolated PBX', 'reviewed final APK', 'no active synthetic call', 'fresh registration while PBX paused'], start: new Date().toISOString(), end: new Date().toISOString(), result: 'NOT_RUN', reason: 'Reserved; runtime preflight pending', execution_started: false, assertions: [], artifacts: [`${runId}/observations.json`, `${runId}/identity.json`], cleanup_result: 'pending' };
      write(file, row, 'wx'); rows.push(row);
    }
    const container = inspectOwned(), network = JSON.parse(docker(['network', 'inspect', fixture.network]))[0];
    ensure(network.Labels?.['com.phone11.android-lab.owner'] === fixture.owner && network.Labels?.['com.phone11.android-lab.run'] === fixture.runId, 'Fixture network ownership changed');
    validateRuntime(container, network); ensure(container.State.Running && !container.State.Paused, 'Fixture must already be running and unpaused');
    ensure(!channels().length, 'Existing synthetic call found; no takeover');
    ui = await import('./ui.mjs'); // First possible ADB interaction: explicitly gated and locked.
    const installed = ui.shell('pm', 'path', pkg).trim();
    ensure(/^package:\/data\/app\/[A-Za-z0-9_/.+=~-]+\/base\.apk$/.test(installed), 'Unexpected installed lab APK path');
    const installedHash = ui.shell('sha256sum', installed.slice(8)).split(/\s+/)[0]; ensure(installedHash === expected, 'Installed final APK hash mismatch');
    write(`${directory}/identity.json`, { at: new Date().toISOString(), source: apk.commit, apk_sha256: expected, installed_apk_sha256: installedHash, emulator: ui.serial, fixtureRun: fixture.runId, scope: 'Only synthetic7101 and owned container pause' });
    ui.openLab(); await ui.waitFor(() => true, 8000); ensure(ui.state().call === 'none' && !ui.state().labMedia?.active, 'Native call/media already active'); touched = true;
    process.on('SIGINT', signal); process.on('SIGTERM', signal);
    const initialized = await reset();
    for (const row of rows) { row.execution_started = true; row.sdk_version = initialized.sdk; row.reason = 'Fresh unreachable-server registration in progress'; }
    rows[1].result = 'BLOCKED'; rows[1].reason = 'This controlled pause precedes registration; mid-transaction loss and automatic same-account recovery are not exposed by the existing UI. Partial observations will be attached without claiming NET01 acceptance.';
    persist();
    ensure(pbx('pjsip set history on').includes('enabled'), 'PBX SIP history unavailable'); historyOn = true;
    // The existing app control creates and registers together; a pause before it is a
    // deterministic unreachable-server test, not a claimed mid-transaction failure.
    pauseRequested = true; docker(['pause', fixture.container]); ensure(inspectOwned().State.Paused, 'Owned PBX did not pause');
    const started = Date.now(); observations.push({ phase: 'PBX paused', at: new Date().toISOString(), fixtureRun: fixture.runId }); persist();
    outageTimer = setTimeout(() => { interrupted = true; try { if (pauseRequested) unpause(); } catch {} }, 60000);
    register();
    let failed;
    while (Date.now() - started < 45000) {
      ensure(!interrupted, 'Bounded outage interrupted'); const current = observe(ui.state());
      ensure(current.registration !== 'registered', 'False registered state while fresh PBX registration is unreachable');
      ensure(current.call === 'none' && current.callCount === 0, 'Registration outage created a phantom call');
      if (current.registration === 'failed') { failed = current; break; }
      await delay(250);
    }
    ensure(failed, 'No actual failed registration callback within45-second fixture outage');
    observations.push({ phase: 'bounded registration failure', durationMs: Date.now() - started, actualNativeState: failed.registration }); persist();
    unpause(); clearTimeout(outageTimer); observations.push({ phase: 'PBX unpaused', at: new Date().toISOString() }); persist();
    ensure(!interrupted, 'Run interrupted before recovery');
    const before = Math.max(-1, ...historyNumbers());
    await reset(); register(); const recovered = observe(await ui.waitFor(value => value.registration === 'registered', 15000));
    const sip = capture(before); observations.push({ recoverySip: sip, recoveryPolicy: 'Visible Destroy/Initialize/Register recreates the native account using the same synthetic identity; automatic same-account recovery is not asserted' });
    ensure(has200(sip), 'Recreated account recovery lacks correlated PBX REGISTER200');
    const contactCount = [...pbx('pjsip show contacts').matchAll(/^\s*Contact:\s+7101\//gm)].length;
    observations.push({ peer7101ContactCount: contactCount }); ensure(contactCount === 1 && recovered.callCount === 0, 'Recovery left duplicate PBX contacts or native calls');
    rows[0].result = 'PASS'; rows[0].reason = ''; rows[0].assertions = ['Owned PBX pause made a fresh registration unreachable; UI never falsely registered', 'Actual failed native registration observed within45seconds', 'Always-unpaused fixture recovered through visible account recreation with correlated REGISTER200 and one PBX contact'];
    rows[1].result = 'BLOCKED'; rows[1].reason = 'Unreachable-start registration and manual account-recreation recovery were verified. Mid-registration network loss, same-account automatic recovery, and native account-count inspection are not exposed by this UI; do not infer NET01 acceptance.'; rows[1].assertions = ['No false registered state or phantom call during bounded fixture outage', 'Same synthetic identity recovered by documented Destroy/Initialize/Register policy'];
    persist(); console.log(JSON.stringify({ runId, reachableAgain: true, SIP03: rows[0].result, NET01: rows[1].result }));
  } catch (error) {
    failureReason = clean(error instanceof Error && !('stdout' in error) && !('stderr' in error) ? error.message : 'Runtime operation failed; raw command output withheld');
    for (const row of rows.filter(row => row.execution_started && row.result === 'NOT_RUN')) { row.result = 'FAIL'; row.reason = failureReason; }
    persist(); process.exitCode = 1;
  } finally {
    clearTimeout(outageTimer); cleanup = 'completed';
    // Unpause first, before any UI/PBX cleanup that could otherwise time out.
    if (pauseRequested) try { unpause(); observations.push({ phase: 'finally unpaused owned PBX', at: new Date().toISOString() }); } catch { cleanup = 'failed: owned PBX unpause not verified; locks retained'; }
    if (touched && ui && cleanup === 'completed') {
      try { if (ui.state().call !== 'none') throw new Error('Unexpected active native call'); if (ui.state().initialized) { ui.tap('Destroy'); await ui.waitFor(value => !value.initialized, 8000); } ensure(!channels().length, 'Residual PBX call'); } catch { cleanup = 'failed: native cleanup incomplete'; }
    }
    if (historyOn && !pauseRequested) try { pbx('pjsip set history off'); pbx('pjsip set history clear'); } catch { cleanup = 'failed: trace cleanup incomplete'; }
    process.off('SIGINT', signal); process.off('SIGTERM', signal);
    for (const row of rows) { row.cleanup_result = cleanup; row.end = new Date().toISOString(); if (row.result === 'NOT_RUN') row.reason = failureReason || 'Preflight did not complete'; validateAttempt(row); }
    persist();
    if (!pauseRequested) for (const file of heldLocks.reverse()) try { const owner = JSON.parse(fs.readFileSync(file)); if (owner.runId === runId && owner.pid === process.pid) fs.unlinkSync(file); } catch {}
    console.log(JSON.stringify({ runId, results: rows.map(row => ({ id: row.test_id, attempt: row.attempt, result: row.result })), cleanup, ledger: '.lab/network-attempts/' }));
    if (rows.some(row => row.result !== 'PASS') || cleanup !== 'completed') process.exitCode = 1;
  }
}
main().catch(() => { console.error('Network harness preflight stopped; no raw command output printed. Inspect the private evidence and owned locks.'); process.exitCode = 1; });
