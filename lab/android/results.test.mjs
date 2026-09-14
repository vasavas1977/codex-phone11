import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectAttempts } from './results.mjs';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'phone11-results-'));
  const lab = path.join(directory, '.lab'); fs.mkdirSync(lab);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const write = (name, data = 'evidence') => {
    const file = path.join(lab, name); fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data));
  };
  write('proof.log');
  return { lab, write };
}
function standard(id, extra = {}) {
  return { test_id: id, run_id: 'run-one', attempt: 1, result: 'PASS',
    mode: 'real', assertions: ['Observed expected native callback'], artifacts: ['proof.log'],
    cleanup_result: 'completed', apk_sha256: 'a'.repeat(64), commit_sha: 'b'.repeat(40),
    start: '2026-09-14T00:00:00Z', ...extra };
}
function media(write, attempt, mode = 'positive', extra = {}) {
  const run = `${mode}-${attempt}`;
  const artifacts = [['siprix_duplex', 'duplex.mp3'], ['pbx_rx', 'rx.wav'], ['analysis', 'analysis.json']]
    .map(([kind, filename]) => { write(`${run}/${filename}`); return { kind, path: `.lab/${run}/${filename}` }; });
  write(`${run}/result.json`);
  const fault = mode === 'downlink_drop';
  return { run_id: run, attempt, mode, result: 'PASS', execution_started: true,
    started_at: '2026-09-14T01:00:00Z', artifacts, apk_sha256: 'a'.repeat(64),
    apk_build_commit: 'b'.repeat(40), apk_source_dirty: false,
    cleanup: { status: 'completed', errors: [] },
    checks: fault ? { 'MEDIA-04': 'PASS' } : { 'MEDIA-01': 'PASS', 'MEDIA-02': 'PASS' },
    analysis: { decodedDownlink440: fault ? 'FAIL' : 'PASS', localSyntheticSend: 'PASS',
      independentPeerUplinkDtmf1: 'PASS', local: { channels: 2 },
      empiricalChannelMapping: fault ? null : { received440Channel: 2, syntheticSendChannel: 1 } },
    ...(fault ? { fault: { counters: { packets: 24 }, cleanup: 'removed_and_absence_verified' } } : {}), ...extra };
}

test('includes every ledger, normalizes reserved rows and accepts baseline no-mutation cleanup', t => {
  const { lab, write } = fixture(t);
  write('attempts.json', [standard('SIP-01')]);
  write('baseline-attempts.json', [standard('BASE-01', { run_id: undefined, cleanup_result: 'No runtime mutation by evidence aggregation' })]);
  write('error-attempts/SIP-02/attempt-1.json', standard('SIP-02'));
  write('network-attempts/NET-01/attempt-1.json', standard('NET-01', { result: 'NOT_RUN', assertions: [], artifacts: [], mode: undefined, execution_started: false, reason: 'Reserved' }));
  write('media-attempts.json', [media(write, 1)]);
  const rows = collectAttempts(lab);
  assert.deepEqual(rows.map(r => r.test_id), ['BASE-01', 'MEDIA-01', 'MEDIA-02', 'NET-01', 'SIP-01', 'SIP-02']);
  assert.equal(rows.find(r => r.test_id === 'NET-01').result, 'NOT_RUN');
  assert.equal(rows.find(r => r.test_id === 'NET-01').evidence_level, 'L2');
  assert.equal(rows.find(r => r.test_id === 'BASE-01').result, 'PASS');
  assert.equal(rows.find(r => r.test_id === 'MEDIA-01').mode, 'real');
});

test('keeps error attempts scoped to the exact APK candidate', t => {
  const { lab, write } = fixture(t);
  const apk = 'a'.repeat(64);
  write(`error-attempts/${apk.slice(0, 12)}/LIFE-01/attempt-1.json`, standard('LIFE-01', { apk_sha256: apk }));
  const [row] = collectAttempts(lab);
  assert.equal(row.result, 'PASS');
  assert.equal(row.source_ledgers[0], 'error-attempts/aaaaaaaaaaaa/LIFE-01/attempt-1.json');
  write(`error-attempts/${apk.slice(0, 12)}/LIFE-01/attempt-1.json`, standard('LIFE-01', { apk_sha256: 'b'.repeat(64) }));
  assert.throws(() => collectAttempts(lab), /APK attempt namespace mismatch/);
});

test('accepts a reserved per-APK attempt that never reached device execution', t => {
  const { lab, write } = fixture(t);
  write('error-attempts/aaaaaaaaaaaa/SIP-11/attempt-1.json', {
    test_id: 'SIP-11', run_id: 'preflight', attempt: 1, result: 'NOT_RUN',
    reason: 'Reserved before device preflight', execution_started: false,
  });
  const [row] = collectAttempts(lab);
  assert.equal(row.result, 'NOT_RUN');
  assert.equal(row.execution_started, false);
});

test('keeps separately named SIP campaigns without consuming an earlier attempt budget', t => {
  const { lab, write } = fixture(t);
  write('attempts.json', [standard('SIP-01', { run_id: 'original', attempt: 3 })]);
  write('attempts-fb26c8e.json', [standard('SIP-01', { run_id: 'candidate', attempt: 1 })]);
  write('attempts-INVALID.json', [standard('SIP-01', { run_id: 'ignored' })]);
  const rows = collectAttempts(lab).filter(row => row.test_id === 'SIP-01');
  assert.deepEqual(rows.map(row => [row.run_id, row.attempt]), [['candidate', 1], ['original', 3]]);
});

test('retains original media failure despite successful recovered checks and a later pass', t => {
  const { lab, write } = fixture(t);
  write('media-attempts.json', [media(write, 3), media(write, 1, 'positive', { mode: undefined, result: 'FAIL', reason: 'Original export failure' })]);
  for (const id of ['MEDIA-01', 'MEDIA-02']) {
    const rows = collectAttempts(lab).filter(r => r.test_id === id);
    assert.deepEqual(rows.map(r => [r.attempt, r.result]), [[1, 'FAIL'], [3, 'PASS']]);
    assert.equal(rows[0].reason, 'Original export failure');
  }
});

test('positive attempt three and fault attempt one are distinct fixed cases', t => {
  const { lab, write } = fixture(t);
  write('media-attempts.json', [media(write, 3), media(write, 1, 'downlink_drop')]);
  const rows = collectAttempts(lab);
  assert.deepEqual(rows.map(r => [r.test_id, r.attempt, r.result]), [
    ['MEDIA-01', 3, 'PASS'], ['MEDIA-02', 3, 'PASS'], ['MEDIA-04', 1, 'PASS']]);
});

test('missing PASS artifacts, assertions, cleanup and real identity downgrade to BLOCKED', t => {
  const { lab, write } = fixture(t);
  for (const extra of [{ artifacts: ['missing.wav'] }, { artifacts: [] }, { assertions: [] },
    { cleanup_result: 'pending' }, { cleanup_result: 'No runtime mutation by evidence aggregation' },
    { mode: 'fake' }, { apk_sha256: undefined }, { execution_started: false }]) {
    write('attempts.json', [standard('SIP-01', extra)]);
    const [row] = collectAttempts(lab);
    assert.equal(row.result, 'BLOCKED'); assert.equal(row.original_result, 'PASS');
  }
  write('media-attempts.json', [media(write, 1)]);
  fs.unlinkSync(path.join(lab, 'positive-1/analysis.json'));
  assert.equal(collectAttempts(lab).find(r => r.test_id === 'MEDIA-01').result, 'BLOCKED');
});

test('deduplicates exact identities conservatively and preserves distinct runs', t => {
  const { lab, write } = fixture(t);
  write('attempts.json', [standard('SIP-02'), standard('SIP-02', { run_id: 'other' })]);
  write('error-attempts/SIP-02/attempt-1.json', standard('SIP-02', { result: 'FAIL', reason: 'Observed failure' }));
  const rows = collectAttempts(lab);
  assert.equal(rows.length, 2);
  const row = rows.find(r => r.run_id === 'run-one');
  assert.equal(row.result, 'FAIL'); assert.equal(row.source_ledgers.length, 2);
});

test('rejects unknown IDs and invalid fixed media cases or budgets', t => {
  const { lab, write } = fixture(t);
  write('attempts.json', [standard('CUSTOM-01')]);
  assert.throws(() => collectAttempts(lab), /Unknown matrix ID/);
  write('attempts.json', []);
  for (const extra of [{ mode: 'custom' }, { case_ids: ['SIP-01'] }, { checks: { 'CUSTOM-01': 'PASS' } }, { attempt: 4 }]) {
    write('media-attempts.json', [media(write, 1, 'positive', extra)]);
    assert.throws(() => collectAttempts(lab));
  }
});

test('artifact validation never opens evidence contents and blocks files outside workspace', t => {
  const { lab, write } = fixture(t);
  write('proof.log', '{invalid JSON is fine for a declared artifact');
  write('attempts.json', [standard('SIP-01')]);
  assert.equal(collectAttempts(lab)[0].result, 'PASS');
  write('attempts.json', [standard('SIP-01', { artifacts: ['/etc/hosts'] })]);
  assert.equal(collectAttempts(lab)[0].result, 'BLOCKED');
});


test('MEDIA-01 means peer uplink and MEDIA-02 means decoded downlink', t => {
  const { lab, write } = fixture(t);
  const row = media(write, 1);
  row.analysis.independentPeerUplinkDtmf1 = 'FAIL';
  write('media-attempts.json', [row]);
  let rows = collectAttempts(lab);
  assert.equal(rows.find(r => r.test_id === 'MEDIA-01').result, 'BLOCKED');
  assert.equal(rows.find(r => r.test_id === 'MEDIA-02').result, 'PASS');
  row.analysis.independentPeerUplinkDtmf1 = 'PASS';
  row.analysis.decodedDownlink440 = 'FAIL';
  write('media-attempts.json', [row]);
  rows = collectAttempts(lab);
  assert.equal(rows.find(r => r.test_id === 'MEDIA-01').result, 'PASS');
  assert.equal(rows.find(r => r.test_id === 'MEDIA-02').result, 'BLOCKED');
  row.analysis.decodedDownlink440 = 'PASS';
  row.analysis.empiricalChannelMapping = null;
  write('media-attempts.json', [row]);
  assert.ok(collectAttempts(lab).every(r => r.result === 'BLOCKED'));
});
