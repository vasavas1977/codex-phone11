import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { state, tap, waitFor, enterPassword, openLab, screenshot, serial } from './ui.mjs';
import { validateAttempt, sha256, sanitize } from './core.mjs';
import { validateState } from './fixture.mjs';

const fixture = validateState(JSON.parse(fs.readFileSync('.lab/fixture.json')));
const apk = JSON.parse(fs.readFileSync('.lab/apk.json'));
const previous = fs.existsSync('.lab/attempts.json') ? JSON.parse(fs.readFileSync('.lab/attempts.json')) : [];
const selected = ['SIP-01', 'SIP-04', 'SIP-05', 'SIP-06', 'SIP-07', 'SIP-09', 'SIP-10', 'CTRL-01', 'CTRL-02', 'CTRL-03'];
const sampleCount = Number(process.env.LAB_SIP_SAMPLES || 20);
if (!Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > 20) throw new Error('LAB_SIP_SAMPLES must be 1 through 20; fewer than 20 cannot pass SIP04/05');
const attempts = Object.fromEntries(selected.map(id => [id, 1 + Math.max(0, ...previous.filter(row => row.test_id === id && (row.result !== 'NOT_RUN' || row.execution_started)).map(row => row.attempt || 0))]));
if (Object.values(attempts).some(attempt => attempt > 3)) throw new Error('At most three diagnostic executions per test; earlier results preserved. Start a separately reviewed evidence campaign rather than overwrite them.');
if (!/^[a-f0-9]{48}$/.test(fixture.accounts['7101'].password)) throw new Error('Unexpected fixture password format');
if (fs.existsSync(apk.apk) && sha256(fs.readFileSync(apk.apk)) !== apk.sha256) throw new Error('APK identity changed');
const runId = `sip-${Date.now()}`;
const directory = `.lab/${runId}`;
const lock = fs.openSync('.lab/sip-run.lock', 'wx', 0o600);
fs.writeFileSync(lock, JSON.stringify({ runId, pid: process.pid }));
fs.closeSync(lock);
fs.mkdirSync(directory, { mode: 0o700 });
const secrets = Object.values(fixture.accounts).map(account => account.password);
const results = [];
const dtmfFile = `/tmp/phone11-${runId}-dtmf.log`;
let historyEnabled = false, collectorEnabled = false, abortReason = '', currentRow, runtimeSdk = 'not-observed', lastMark = -1;
const clean = value => sanitize(value, secrets);
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(clean(value), null, 2), { mode: 0o600 });
const persist = () => {
  write(`${directory}/results.json`, results);
  const latest = fs.existsSync('.lab/attempts.json') ? JSON.parse(fs.readFileSync('.lab/attempts.json')) : previous;
  write('.lab/attempts.json.tmp', [...latest.filter(result => result.run_id !== runId), ...results]);
  fs.renameSync('.lab/attempts.json.tmp', '.lab/attempts.json');
};
const ensure = (condition, message) => { if (!condition) throw new Error(message); };
class ProofGap extends Error {}
const gap = (condition, message) => { if (!condition) throw new ProofGap(message); };
const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] });
const pbx = command => docker(['exec', fixture.container, 'asterisk', '-rx', command]);
const control = command => JSON.parse(execFileSync(process.execPath, ['lab/android/fixture.mjs', command], { encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] }));
function snapshot(value) {
  return clean(Object.fromEntries(['initialized', 'sdk', 'generation', 'sequence', 'registration', 'call', 'callId', 'callCount', 'muted', 'held', 'ended', 'error', 'events', 'recentEvents'].filter(key => value[key] !== undefined).map(key => [key, value[key]])));
}
const history = value => value.events || value.recentEvents || [];
function nativeEvents(samples, sequence = -1) {
  const events = samples.flatMap(value => history(value).filter(event => typeof event === 'object' && event.generation === value.generation && Number(event.sequence) <= Number(value.sequence)));
  return [...new Map(events.filter(event => typeof event === 'object' && Number(event.sequence) > sequence).map(event => [`${event.sequence}:${event.type}`, event])).values()];
}
function channels() {
  return pbx('core show channels concise').split('\n').map(line => line.split('!')).filter(parts => /^PJSIP\/7101-[a-f0-9]+$/.test(parts[0])).map(parts => ({ name: parts[0], context: parts[1], extension: parts[2], state: parts[4], application: parts[5] }));
}
async function noChannels(timeout = 5000) {
  const until = Date.now() + timeout;
  let latest;
  do { latest = channels(); if (!latest.length) return latest; await new Promise(resolve => setTimeout(resolve, 200)); } while (Date.now() < until);
  throw new Error('PBX still has a synthetic7101 channel');
}
function traceNumbers() {
  return [...pbx('pjsip show history').matchAll(/^\s*(\d+)\s+\d+\s+\*\s+[<=>]+/gm)].map(match => Number(match[1]));
}
const mark = () => (lastMark = Math.max(-1, ...traceNumbers()));
function trace(since) {
  const numbers = traceNumbers().filter(number => number > since);
  ensure(numbers.length <= 160, 'SIP capture exceeded bounded sample size');
  return numbers.map(number => {
    // Full headers exist only in this local process memory. Persist an explicit allowlist.
    const raw = pbx(`pjsip show history entry ${number}`);
    const first = raw.split(/\r?\n/).find(line => /^(?:SIP\/2.0|[A-Z]+ sip:)/.test(line)) || '';
    const cseq = raw.match(/^CSeq:\s*(\d+)\s+(\w+)/im);
    const callId = raw.match(/^Call-ID:\s*(.+)/im)?.[1]?.trim();
    return { number, direction: raw.includes('Sent to') ? 'TX' : 'RX', method: cseq?.[2] || first.match(/^([A-Z]+)\s/)?.[1], cseq: Number(cseq?.[1]), status: Number(first.match(/^SIP\/2.0 (\d+)/)?.[1]) || null, dialog: callId ? sha256(callId).slice(0, 20) : null, sdpDirection: raw.match(/^a=(sendrecv|sendonly|recvonly|inactive)/im)?.[1] || null };
  });
}
function requestAndReply(messages, method, direction, status = 200) {
  return messages.some(message => message.direction === direction && message.method === method && message.status === null && messages.some(reply => reply.dialog === message.dialog && reply.cseq === message.cseq && reply.method === method && reply.direction !== direction && reply.status === status));
}
function row(id, executionStarted = true) {
  const value = { test_id: id, run_id: runId, attempt: attempts[id], commit_sha: apk.commit, apk_sha256: apk.sha256, evidence_level: 'L2', emulator_serial: serial, system_image: 'system-images;android-35;google_apis;arm64-v8a', api_level: 35, abi: 'arm64-v8a', sdk_version: runtimeSdk, mode: 'real', preconditions: ['dedicated AVD', 'isolated PBX', 'synthetic7101', `fixture_run:${fixture.runId}`], start: new Date().toISOString(), end: new Date().toISOString(), result: 'NOT_RUN', assertions: [], artifacts: [], reason: 'Scenario started; final result pending', cleanup_result: 'pending', samples: [] };
  value.execution_started = executionStarted; results.push(value); persist(); return value;
}
async function sample(number, body) {
  const value = { sample: number, start: new Date().toISOString(), end: null, result: 'NOT_RUN', assertions: [], events: [] };
  currentRow.samples.push(value);
  try {
    value.assertions = await body(value.events);
    value.result = 'PASS';
  } catch (error) {
    try { value.events.push({ sipAtFailure: trace(lastMark), stateAtFailure: snapshot(state()), pbxChannelsAtFailure: channels() }); } catch {}
    value.result = error instanceof ProofGap ? 'BLOCKED' : 'FAIL'; value.reason = clean(String(error.message));
    currentRow.result = value.result; currentRow.reason = value.reason; throw error;
  } finally {
    value.end = new Date().toISOString();
    const artifact = `${runId}/${currentRow.test_id}-sample-${number}.json`;
    write(`.lab/${artifact}`, value); currentRow.artifacts.push(artifact); persist();
  }
}
async function scenario(id, body) {
  currentRow = row(id);
  try {
    currentRow.assertions = await body(); currentRow.result = 'PASS'; currentRow.reason = '';
  } catch (error) {
    currentRow.result = error instanceof ProofGap ? 'BLOCKED' : 'FAIL'; currentRow.reason = clean(String(error.message));
    if (!(error instanceof ProofGap)) throw error;
    // A proof gap must not leave its still-connected call contaminating later scenarios.
    if (state().call !== 'none') { tap('Hang up'); await waitFor(value => value.call === 'none'); await noChannels(); }
  } finally {
    currentRow.end = new Date().toISOString();
    const artifact = `${runId}/${id}.json`; currentRow.artifacts.push(artifact); write(`.lab/${artifact}`, currentRow); validateAttempt(currentRow); persist();
    console.log(JSON.stringify({ test: id, attempt: currentRow.attempt, result: currentRow.result, samples: currentRow.samples.length }));
  }
}
async function observed(events, predicate, timeout) {
  const value = snapshot(await waitFor(predicate, timeout)); events.push(value); return value;
}
async function outgoing(events) {
  const before = snapshot(state()); events.push(before);
  tap('Call tone');
  const connected = await observed(events, value => value.call === 'connected');
  const peer = channels(); events.push({ pbxChannels: peer });
  ensure(peer.length === 1 && peer[0].state === 'Up', 'PBX must have exactly one answered7101 channel');
  return { before, connected };
}
async function localEnd(events) {
  tap('Hang up'); await observed(events, value => value.call === 'none'); events.push({ pbxChannels: await noChannels() });
}
function terminateOnce(before, after, events) {
  ensure(after.ended === before.ended + 1, 'Exactly one native termination callback required');
  gap(nativeEvents(events, before.sequence).filter(event => event.type === 'callTerminated').length === 1, 'Native termination event history missing or duplicated');
}
try {
  const inspected = JSON.parse(docker(['inspect', fixture.container]))[0];
  ensure(inspected.Config.Labels['com.phone11.android-lab.owner'] === fixture.owner && inspected.Config.Labels['com.phone11.android-lab.run'] === fixture.runId, 'Fixture Docker ownership mismatch');
  pbx('pjsip set history clear'); ensure(pbx('pjsip set history on').includes('enabled'), 'PBX SIP history unavailable'); historyEnabled = true;
  // Keep the already foreground lab screen. Only open its deep link when absent.
  try { state(); } catch { openLab(); await waitFor(() => true); }
  if (state().initialized) { tap('Destroy'); await waitFor(value => !value.initialized); }
  tap('Initialize'); runtimeSdk = String((await waitFor(value => value.initialized)).sdk || 'not-reported');
  tap('Microphone'); try { tap('While using the app'); } catch {}
  const registerMark = mark();
  enterPassword(fixture.accounts['7101'].password); tap('Register');
  await scenario('SIP-01', async () => {
    await sample(1, async events => {
      await observed(events, value => value.registration === 'registered');
      const messages = trace(registerMark); events.push({ sip: messages });
      ensure(requestAndReply(messages, 'REGISTER', 'RX'), 'Actual REGISTER200 exchange missing');
      ensure(pbx('pjsip show contacts').includes('7101/'), 'PBX contact7101 missing');
      return ['Native registered state agrees with correlated REGISTER200 and PBX contact7101'];
    }); return ['Actual registration verified on SDK/UI and PBX'];
  });
  await scenario('SIP-04', async () => {
    for (let number = 1; number <= sampleCount; number++) await sample(number, async events => {
      const since = mark(), { before } = await outgoing(events); await localEnd(events);
      const messages = trace(since); events.push({ sip: messages });
      ensure(requestAndReply(messages, 'INVITE', 'RX') && requestAndReply(messages, 'BYE', 'RX'), 'Correlated outgoing INVITE200/BYE200 missing');
      const changes = nativeEvents(events, before.sequence);
      for (const type of ['callDialing', 'callProceeding', 'callConnected', 'callTerminated']) gap(changes.some(event => event.type === type), `Missing actual native ${type} event`);
      const ordered = ['callDialing', 'callProceeding', 'callConnected', 'callTerminated'].map(type => changes.findIndex(event => event.type === type));
      ensure(ordered.every((index, i) => i === 0 || index > ordered[i - 1]), 'Native call transitions out of order');
      terminateOnce(before, events.filter(value => value.ended !== undefined).at(-1), events);
      return ['Actual dialing/proceeding/connected/terminated callbacks in order', 'PBX INVITE200 and local BYE200', 'No remaining PBX channel'];
    });
    gap(sampleCount === 20, `${sampleCount} diagnostic samples completed; matrix requires20`); return ['20 real outgoing samples with transitions and PBX correlation'];
  });
  await scenario('SIP-05', async () => {
    for (let number = 1; number <= sampleCount; number++) await sample(number, async events => {
      const since = mark(), before = snapshot(state()); events.push(before, control('incoming'));
      await observed(events, value => value.call === 'ringing'); tap('Answer'); await observed(events, value => value.call === 'connected');
      const peer = channels(); events.push({ pbxChannels: peer }); ensure(peer.length === 1 && peer[0].state === 'Up', 'Incoming answer did not reach PBX');
      await localEnd(events); const messages = trace(since); events.push({ sip: messages });
      ensure(requestAndReply(messages, 'INVITE', 'TX') && requestAndReply(messages, 'BYE', 'RX'), 'Inbound INVITE200 and local BYE200 missing');
      const changes = nativeEvents(events, before.sequence);
      gap(changes.filter(event => event.type === 'callIncoming').length === 1, 'Exactly one actual incoming callback required');
      terminateOnce(before, events.filter(value => value.ended !== undefined).at(-1), events);
      return ['One native incoming callback, real ringing/answer/termination', 'PBX received answer200 and BYE', 'Exactly one termination callback; no PBX channel remains'];
    });
    gap(sampleCount === 20, `${sampleCount} diagnostic samples completed; matrix requires20`); return ['20 foreground inbound samples with PBX answer proof'];
  });
  await scenario('SIP-06', async () => {
    await sample(1, async events => {
      const since = mark(), before = snapshot(state()); events.push(before, control('incoming'));
      await observed(events, value => value.call === 'ringing'); tap('Hang up'); const after = await observed(events, value => value.call === 'none');
      events.push({ pbxChannels: await noChannels() }); const messages = trace(since); events.push({ sip: messages });
      ensure(requestAndReply(messages, 'INVITE', 'TX', 486), 'PBX did not receive actual486 rejection'); terminateOnce(before, after, events);
      return ['Actual486 rejection at peer', 'No lingering native call or PBX channel', 'One termination callback'];
    });
    throw new ProofGap('Foreground reject signaling passed; product history/service/notification reconciliation is not instrumented by this lab screen');
  });
  await scenario('SIP-07', async () => {
    await sample(1, async events => {
      const since = mark(), before = snapshot(state()); events.push(before, control('incoming'));
      await observed(events, value => value.call === 'ringing'); events.push(control('incoming-cancel'));
      const after = await observed(events, value => value.call === 'none'); events.push({ pbxChannels: await noChannels() });
      const messages = trace(since); events.push({ sip: messages });
      ensure(requestAndReply(messages, 'CANCEL', 'TX') && messages.some(message => message.method === 'INVITE' && message.direction === 'RX' && message.status === 487), 'Actual caller CANCEL200/INVITE487 missing');
      terminateOnce(before, after, events); return ['Actual CANCEL/200 and INVITE487', 'Ringing cleared; peer channel gone; one termination callback'];
    });
    throw new ProofGap('Caller cancellation signaling passed; product canceled/missed history outcome is not instrumented');
  });
  await scenario('SIP-09', async () => {
    for (const [index, remote] of [false, true, false].entries()) await sample(index + 1, async events => {
      const since = mark(), { before } = await outgoing(events);
      if (remote) { events.push(control('remote-hangup')); await observed(events, value => value.call === 'none'); events.push({ pbxChannels: await noChannels() }); } else await localEnd(events);
      const messages = trace(since); events.push({ sip: messages });
      ensure(requestAndReply(messages, 'BYE', remote ? 'TX' : 'RX'), `Actual ${remote ? 'remote' : 'local'} BYE200 missing`);
      terminateOnce(before, events.filter(value => value.ended !== undefined).at(-1), events);
      return [`${remote ? 'Remote' : 'Local'} termination synchronized with PBX`, 'One native termination; no active PBX channel'];
    }); return ['Local then remote hangup verified; subsequent call works without app restart'];
  });
  await scenario('SIP-10', async () => {
    await sample(1, async events => {
      const { connected } = await outgoing(events); const active = channels()[0].name;
      const since = mark(); events.push(control('incoming'));
      let messages = [], end = Date.now() + 10000;
      do { messages = trace(since); if (requestAndReply(messages, 'INVITE', 'TX', 486)) break; await new Promise(resolve => setTimeout(resolve, 250)); } while (Date.now() < end);
      events.push({ sip: messages }); ensure(requestAndReply(messages, 'INVITE', 'TX', 486), 'Second incoming did not receive486 busy');
      const after = snapshot(state()); events.push(after, { pbxChannels: channels() });
      ensure(after.call === 'connected' && after.callCount === 1 && after.ended === connected.ended, 'Second incoming corrupted single-call native state');
      ensure(channels().length === 1 && channels()[0].name === active, 'Original PBX call changed after busy rejection');
      gap(!nativeEvents([after], connected.sequence).some(event => event.type === 'callIncoming'), 'Rejected second call created a phantom incoming surface');
      await localEnd(events); return ['Second actual INVITE rejected486', 'Original native/PBX call retained; exactly one call; no phantom incoming callback'];
    }); return ['Single-call busy policy verified at PBX and native/UI'];
  });
  await scenario('CTRL-01', async () => {
    await sample(1, async events => {
      const { connected } = await outgoing(events);
      tap('Mute');
      await observed(events, value => value.muted === true && value.call === 'connected');
      tap('Mute');
      await observed(events, value => value.muted === false && value.call === 'connected');
      const changes = nativeEvents(events, connected.sequence).filter(event => event.type === 'callMuted');
      gap(changes.length === 2, 'Expected one native mute and one native unmute callback');
      ensure(changes[0].state === 'connected' && changes[1].state === 'connected', 'Mute controls changed connected call state');
      await localEnd(events);
      return ['Native mute/unmute callbacks and snapshot state agree', 'Call remained connected and cleaned up normally'];
    });
    throw new ProofGap('Mute/unmute native command and state passed; peer-observed microphone audio remains unavailable with host microphone disabled');
  });
  await scenario('CTRL-02', async () => {
    await sample(1, async events => {
      const { connected } = await outgoing(events); const since = mark();
      tap('Hold'); await observed(events, value => value.held && value.call === 'held');
      tap('Hold'); await observed(events, value => !value.held && value.call === 'connected');
      const messages = trace(since); events.push({ sip: messages });
      const reinvites = messages.filter(message => message.direction === 'RX' && message.method === 'INVITE' && message.status === null);
      ensure(reinvites.some(message => ['sendonly', 'inactive'].includes(message.sdpDirection)) && reinvites.some(message => message.sdpDirection === 'sendrecv'), 'Peer did not receive hold/resume SDP directions');
      ensure(reinvites.every(message => messages.some(reply => reply.dialog === message.dialog && reply.cseq === message.cseq && reply.method === 'INVITE' && reply.status === 200 && reply.direction === 'TX')), 'Hold/resume reINVITE200 missing');
      gap(nativeEvents(events, connected.sequence).filter(event => event.type === 'callHeld').length >= 2, 'Actual hold/resume callbacks not observed');
      await localEnd(events); return ['Native hold/resume callbacks match received SDP reINVITEs and200 responses'];
    });
    throw new ProofGap('Hold/resume signaling verified; resumed client-decoded audio not measured, so CTRL02 media acceptance remains blocked');
  });
  await scenario('CTRL-03', async () => {
    await sample(1, async events => {
      const response = pbx(`logger add channel ${dtmfFile} dtmf`);
      gap(!/failed|unable|No such command/i.test(response), 'PBX receiver DTMF collector unavailable'); collectorEnabled = true;
      await outgoing(events); tap('DTMF');
      let digits = [], end = Date.now() + 6000;
      do {
        const raw = docker(['exec', fixture.container, 'cat', dtmfFile]);
        digits = [...raw.matchAll(/DTMF end '([0-9*#A-D])' received on (PJSIP\/7101-[a-f0-9]+)/g)].map(match => ({ digit: match[1], channel: match[2] }));
        if (digits.length >= 4) break; await new Promise(resolve => setTimeout(resolve, 200));
      } while (Date.now() < end);
      events.push({ receiverDigits: digits }); ensure(digits.map(value => value.digit).join('') === '123#', 'Receiving PBX did not observe123# exactly in order');
      await localEnd(events); return ['PBX channel receiver observed actual DTMF123# in order'];
    }); return ['DTMF pass uses peer-received digits, not a UI command'];
  });
  screenshot(`${directory}/completed.png`);
} catch (error) {
  abortReason = clean(String(error.message)); console.error('SIP run stopped; first failed sample is preserved in private evidence.'); process.exitCode = 1;
} finally {
  let cleanup = 'completed';
  try { const current = state(); if (current.call !== 'none') { tap('Hang up'); await waitFor(value => value.call === 'none'); } tap('Destroy'); await waitFor(value => !value.initialized); await noChannels(); } catch { cleanup = 'failed; inspect dedicated emulator and synthetic PBX before another run'; }
  try { if (collectorEnabled) { pbx(`logger remove channel ${dtmfFile}`); docker(['exec', fixture.container, 'rm', '-f', dtmfFile]); } if (historyEnabled) { pbx('pjsip set history off'); pbx('pjsip set history clear'); } } catch { cleanup = 'failed; fixture trace cleanup incomplete'; }
  for (const id of selected.filter(id => !results.some(result => result.test_id === id))) { const value = row(id, false); value.reason = `Not executed after prerequisite/scenario failure: ${abortReason || 'setup did not complete'}`; }
  for (const result of results) { result.cleanup_result = cleanup; result.end = result.end || new Date().toISOString(); validateAttempt(result); write(`${directory}/${result.test_id}.json`, result); }
  persist(); fs.rmSync('.lab/sip-run.lock');
  console.log(JSON.stringify({ runId, results: results.map(result => ({ id: result.test_id, attempt: result.attempt, result: result.result })), cleanup }));
  if (results.some(result => result.result === 'FAIL') || cleanup !== 'completed') process.exitCode = 1;
}
