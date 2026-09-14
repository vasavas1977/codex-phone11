import fs from 'node:fs';
import path from 'node:path';
import { matrix, safeAttempt, sanitize } from './core.mjs';

const specs = new Map(matrix.map(row => [row.id, row]));
const statuses = new Set(['PASS', 'FAIL', 'BLOCKED', 'NOT_RUN', 'NOT_APPLICABLE']);
const noMutation = 'No runtime mutation by evidence aggregation';
const mediaCases = { positive: ['MEDIA-01', 'MEDIA-02'], downlink_drop: ['MEDIA-04'] };
const fields = ['commit_sha', 'apk_sha256', 'apk_source_dirty', 'harness_base_commit',
  'harness_sha256', 'harness_source_dirty', 'harness_commit', 'emulator_serial',
  'system_image', 'api_level', 'abi', 'sdk_version', 'preconditions', 'scope'];
const validMapping = mapping => [1, 2].includes(mapping?.received440Channel)
  && [1, 2].includes(mapping?.syntheticSendChannel) && mapping.received440Channel !== mapping.syntheticSendChannel;
const inside = (root, file) => file === root || file.startsWith(root + path.sep);

// Only these ledgers are opened. Evidence files are checked with stat, never read.
export function collectAttempts(labDirectory = '.lab') {
  const requested = path.resolve(labDirectory);
  if (!fs.existsSync(requested)) return [];
  const root = fs.realpathSync(requested);
  const workspace = fs.realpathSync(path.dirname(root));
  const realRoot = fs.realpathSync(root);
  const collected = [];
  function read(relative, array) {
    const file = path.join(root, relative);
    if (!fs.existsSync(file)) return [];
    if (!inside(realRoot, fs.realpathSync(file)) || !fs.lstatSync(file).isFile()) {
      throw new Error(`Unsafe ledger: ${relative}`);
    }
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (array && !Array.isArray(value)) throw new Error(`Expected ledger array: ${relative}`);
    return array ? value : [value];
  }
  function artifact(raw) {
    const value = typeof raw === 'string' ? raw : raw?.path;
    if (typeof value !== 'string' || !value || value.includes('\0')) return null;
    // The media harness writes .lab-prefixed paths; other harnesses use lab-relative paths.
    const file = path.isAbsolute(value) ? value : path.resolve(root, value.replace(/^\.lab\//, ''));
    if (!inside(workspace, file)) return null;
    return path.relative(root, file).split(path.sep).join('/');
  }
  function exists(relative) {
    try {
      const file = path.resolve(root, relative);
      return inside(workspace, fs.realpathSync(file)) && fs.statSync(file).isFile() && fs.statSync(file).size > 0;
    } catch { return false; }
  }
  function normalize(raw, source, testId = raw.test_id, mediaMode) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Invalid row: ${source}`);
    const spec = specs.get(testId);
    if (!spec) throw new Error(`Unknown matrix ID: ${testId}`);
    safeAttempt(raw.attempt);
    if (!statuses.has(raw.result)) throw new Error(`Invalid result: ${source}`);
    if (raw.evidence_level && raw.evidence_level !== spec.level) throw new Error(`Wrong evidence level: ${testId}`);
    const runId = raw.run_id ?? `ledger:${source}`;
    if (typeof runId !== 'string' || !runId || (mediaMode && !/^[a-zA-Z0-9_-]+$/.test(runId))) throw new Error(`Invalid run ID: ${source}`);
    const declared = Array.isArray(raw.artifacts) ? raw.artifacts : [];
    const paths = declared.map(artifact);
    const row = {
      ...Object.fromEntries(fields.filter(key => raw[key] !== undefined).map(key => [key, raw[key]])),
      test_id: testId, run_id: runId, attempt: raw.attempt,
      evidence_level: spec.level, mode: mediaMode ? 'real' : (raw.mode ?? 'real'),
      start: raw.start ?? raw.started_at ?? null, end: raw.end ?? raw.ended_at ?? null,
      result: raw.result, reason: raw.reason || (raw.result === 'NOT_RUN' ? 'Reserved; execution not completed' : ''),
      execution_started: raw.execution_started ?? null,
      assertions: Array.isArray(raw.assertions) ? raw.assertions.filter(a => typeof a === 'string' && a.trim()) : [],
      artifacts: [...new Set(paths.filter(Boolean))], source_ledgers: [source],
      cleanup_result: raw.cleanup_result ?? raw.cleanup?.status ?? 'unknown',
    };
    const problems = [];
    if (paths.some(p => !p)) problems.push('invalid artifact path');
    if (mediaMode) {
      row.media_mode = mediaMode;
      row.commit_sha = raw.apk_build_commit ?? raw.commit_sha;
      row.apk_build_commit = raw.apk_build_commit;
      row.checks = raw.checks ?? {};
      row.cleanup = raw.cleanup;
      row.analysis = raw.analysis;
      row.fault = raw.fault;
      row.artifact_metadata = declared.map(a => ({ kind: a.kind, path: artifact(a), sha256: a.sha256, bytes: a.bytes }));
      row.artifacts.push(`${runId}/result.json`);
      if (raw.analysis || raw.result === 'PASS') row.artifacts.push(`${runId}/analysis.json`);
      const analysis = raw.analysis ?? {};
      const checks = {
        'MEDIA-01': analysis.localSyntheticSend === 'PASS' && analysis.independentPeerUplinkDtmf1 === 'PASS' && validMapping(analysis.empiricalChannelMapping),
        'MEDIA-02': analysis.decodedDownlink440 === 'PASS' && validMapping(analysis.empiricalChannelMapping),
        'MEDIA-04': analysis.decodedDownlink440 === 'FAIL' && analysis.localSyntheticSend === 'PASS'
          && analysis.independentPeerUplinkDtmf1 === 'PASS' && analysis.local?.channels === 2
          && raw.fault?.counters?.packets > 0 && raw.fault?.cleanup === 'removed_and_absence_verified',
      };
      if (row.checks[testId] === 'PASS' && checks[testId]) row.assertions.push(`${testId}: recorded analyzer and case checks agree (${mediaMode})`);
      else problems.push('media case checks or decoded analysis missing/inconsistent');
      for (const kind of ['siprix_duplex', ...(testId === 'MEDIA-02' ? [] : ['pbx_rx'])]) {
        if (!declared.some(a => a.kind === kind && artifact(a))) problems.push(`missing ${kind} artifact`);
      }
      if (raw.cleanup?.errors?.length) problems.push('cleanup errors recorded');
    }
    row.artifacts = [...new Set(row.artifacts)];
    if (row.result === 'PASS') {
      if (!row.artifacts.length) problems.push('no artifacts');
      const missing = row.artifacts.filter(p => !exists(p));
      if (missing.length) problems.push(`missing or empty artifacts: ${missing.join(', ')}`);
      if (!row.assertions.length) problems.push('no assertions');
      const clean = row.cleanup_result === 'completed'
        || (source === 'baseline-attempts.json' && row.cleanup_result === noMutation);
      if (!clean) problems.push('cleanup not completed');
      if (row.execution_started === false) problems.push('execution never started');
      if (spec.level !== 'L0' && row.mode !== 'real') problems.push('runtime evidence is not real');
      if (spec.level !== 'L0' && (!/^[a-f0-9]{64}$/i.test(row.apk_sha256 ?? '') || !/^[a-f0-9]{40}$/i.test(row.commit_sha ?? ''))) problems.push('APK hash/source identity missing');
      if (problems.length) {
        row.original_result = 'PASS'; row.result = 'BLOCKED';
        row.reason = `Evidence validation: ${problems.join('; ')}`;
      }
    }
    if (row.result !== 'PASS' && !row.reason) row.reason = `Ledger reported ${row.result}`;
    collected.push(sanitize(row));
  }
  const campaignLedgers = fs.readdirSync(root)
    .filter(source => /^attempts(?:-[a-z0-9][a-z0-9-]{0,63})?\.json$/.test(source))
    .sort((a, b) => a.localeCompare(b));
  for (const source of [...campaignLedgers, 'baseline-attempts.json']) {
    for (const raw of read(source, true)) normalize(raw, source);
  }
  for (const directory of ['error-attempts', 'network-attempts']) {
    const full = path.join(root, directory);
    if (!fs.existsSync(full)) continue;
    for (const entry of fs.readdirSync(full, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      if (!specs.has(entry.name)) throw new Error(`Unknown matrix ID directory: ${entry.name}`);
      for (const file of fs.readdirSync(path.join(full, entry.name)).sort()) {
        const match = /^attempt-([1-3])\.json$/.exec(file);
        if (!match) { if (/^attempt-.*\.json$/.test(file)) throw new Error('Invalid attempt filename'); continue; }
        const source = `${directory}/${entry.name}/${file}`;
        for (const raw of read(source, false)) {
          if (raw.test_id !== entry.name || raw.attempt !== Number(match[1])) throw new Error(`Attempt identity mismatch: ${source}`);
          normalize(raw, source);
        }
      }
    }
  }
  for (const raw of read('media-attempts.json', true)) {
    const mode = raw.mode ?? 'positive';
    const ids = Object.hasOwn(mediaCases, mode) ? mediaCases[mode] : null;
    if (!ids) throw new Error('Unknown media mode');
    if (raw.case_ids && (!Array.isArray(raw.case_ids) || raw.case_ids.length !== ids.length || ids.some(id => !raw.case_ids.includes(id)))) throw new Error('Invalid fixed media case IDs');
    if (Object.keys(raw.checks ?? {}).some(id => !ids.includes(id))) throw new Error('Unknown media check ID');
    for (const id of ids) normalize(raw, 'media-attempts.json', id, mode);
  }
  const unique = new Map();
  // Conservative dedup: a duplicate success must never erase failure or missing evidence.
  const priority = { FAIL: 5, BLOCKED: 4, PASS: 3, NOT_APPLICABLE: 2, NOT_RUN: 1 };
  for (const row of collected) {
    const key = JSON.stringify([row.test_id, row.run_id, row.attempt]);
    const previous = unique.get(key);
    if (!previous) { unique.set(key, row); continue; }
    const winner = priority[row.result] > priority[previous.result] ? row : previous;
    winner.source_ledgers = [...new Set([...previous.source_ledgers, ...row.source_ledgers])];
    unique.set(key, winner);
  }
  return [...unique.values()].sort((a, b) => a.test_id.localeCompare(b.test_id)
    || a.attempt - b.attempt || String(a.start ?? '').localeCompare(String(b.start ?? '')) || a.run_id.localeCompare(b.run_id));
}
