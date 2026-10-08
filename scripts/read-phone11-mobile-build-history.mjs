import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const PROJECT = 'e354ffd3-485c-49f1-9e6f-aebe571d8dfb';
export const PRIOR_ANDROID_SOURCE = '04f80dfa5c501df7a6aae10249cbb8e510a4898c';
export const REPOSITORY = 'vasavas1977/codex-phone11';
export const REF = 'refs/heads/codex/phone11-zoom-mainline-integration-20260928';
export const MAX_BYTES = 262144;
export const TIMEOUT_MS = 15000;
const HASH = /^[a-f0-9]{40}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const STATUSES = new Set(['NEW', 'IN_QUEUE', 'IN_PROGRESS', 'PENDING_CANCEL', 'ERRORED', 'FINISHED', 'CANCELED']);
const FAILURES = new Set(['INVOCATION_REFUSED', 'TOKEN_UNAVAILABLE', 'TRANSPORT_FAILED', 'TIMEOUT', 'HTTP_REFUSED', 'AUTH_REFUSED', 'RESPONSE_TOO_LARGE', 'RESPONSE_INVALID', 'IDENTITY_REFUSED', 'OUTPUT_REFUSED']);
const codes = new WeakMap();
function refuse(code) { const error = new Error('HISTORY_REFUSED'); codes.set(error, code); throw error; }
export function failureReceipt(error) {
  const code = codes.get(error);
  return { outcome: 'REFUSED', failureCode: FAILURES.has(code) ? code : 'RESPONSE_INVALID', readOnly: true, authVerified: false, artifactVerified: false, installed: false, physicalAcceptance: false, retryAuthorized: false };
}
export const SCOPES = Object.freeze([
  Object.freeze({ alias: 'priorAndroid', limit: 20, platform: 'ANDROID', buildProfile: 'preview-android-siprix-foreground-trial', appIdentifier: 'ai.phone11.mobile.foregroundtrial', source: PRIOR_ANDROID_SOURCE }),
  Object.freeze({ alias: 'recentAndroid', limit: 10, platform: 'ANDROID', buildProfile: 'preview-android-siprix-foreground-trial', appIdentifier: 'ai.phone11.mobile.foregroundtrial', source: null }),
  Object.freeze({ alias: 'dailyPilotIos', limit: 10, platform: 'IOS', buildProfile: 'preview-ios-siprix-daily-pilot', appIdentifier: 'space.manus.phone11ai.t20260425073427', source: null }),
]);
// Fixed query derived from Expo eas-cli v23.2.0 BuildQuery and BuildFragment.
// No user-controlled query, filter, endpoint, pagination or selected fields.
export const QUERY = `query Phone11MobileBuildHistory($appId: String!) {
  app { byId(appId: $appId) {
    id slug ownerAccount { name }
    ${SCOPES.map(s => `${s.alias}: builds(offset: 0, limit: ${s.limit}, filter: { platform: ${s.platform}, distribution: INTERNAL, buildProfile: "${s.buildProfile}", appIdentifier: "${s.appIdentifier}"${s.source ? `, gitCommitHash: "${s.source}"` : ''} }) {
      id status platform distribution buildProfile appIdentifier appVersion appBuildVersion gitCommitHash
      app { id slug ownerAccount { name } }
    }`).join('\n')}
  } }
}`;
export const REQUEST_BODY = JSON.stringify({ operationName: 'Phone11MobileBuildHistory', query: QUERY, variables: { appId: PROJECT } });

function keys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).length !== expected.length || Object.keys(value).some(key => !expected.includes(key))) refuse('RESPONSE_INVALID');
}
function identity(app) {
  keys(app, ['id', 'slug', 'ownerAccount']); keys(app.ownerAccount, ['name']);
  if (app.id !== PROJECT || app.slug !== 'phone11ai' || app.ownerAccount.name !== 'vasavas') refuse('IDENTITY_REFUSED');
}

// Parse the bounded JSON ourselves to reject duplicate keys before JSON.parse can
// silently replace them, including escaped equivalents. No provider text escapes.
export function parseResponse(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length > MAX_BYTES) refuse('RESPONSE_TOO_LARGE');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer); } catch { refuse('RESPONSE_INVALID'); }
  let i = 0;
  function white() { while (/^[ \t\r\n]$/.test(text[i] ?? '') && i < text.length) i++; }
  function string() {
    const start = i++;
    while (i < text.length) { const c = text[i++]; if (c === '\\') i++; else if (c === '"') return JSON.parse(text.slice(start, i)); }
    refuse('RESPONSE_INVALID');
  }
  function value(depth) {
    if (depth > 20) refuse('RESPONSE_INVALID'); white();
    if (text[i] === '{') {
      i++; white(); const seen = new Set(); if (text[i] === '}') { i++; return; }
      for (;;) { white(); if (text[i] !== '"') refuse('RESPONSE_INVALID'); const key = string(); if (seen.has(key)) refuse('RESPONSE_INVALID'); seen.add(key); white(); if (text[i++] !== ':') refuse('RESPONSE_INVALID'); value(depth + 1); white(); const end = text[i++]; if (end === '}') return; if (end !== ',') refuse('RESPONSE_INVALID'); }
    }
    if (text[i] === '[') {
      i++; white(); if (text[i] === ']') { i++; return; }
      for (;;) { value(depth + 1); white(); const end = text[i++]; if (end === ']') return; if (end !== ',') refuse('RESPONSE_INVALID'); }
    }
    if (text[i] === '"') { string(); return; }
    const match = /^(?:null|true|false|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(i));
    if (!match) refuse('RESPONSE_INVALID'); i += match[0].length;
  }
  try { value(0); white(); if (i !== text.length) refuse('RESPONSE_INVALID'); return JSON.parse(text); } catch (error) { if (codes.has(error)) throw error; refuse('RESPONSE_INVALID'); }
}

export function sanitizeResponse(response, readerSource) {
  if (typeof readerSource !== 'string' || !HASH.test(readerSource)) refuse('INVOCATION_REFUSED');
  keys(response, ['data']); keys(response.data, ['app']); keys(response.data.app, ['byId']);
  const project = response.data.app.byId;
  keys(project, ['id', 'slug', 'ownerAccount', ...SCOPES.map(s => s.alias)]);
  identity({ id: project.id, slug: project.slug, ownerAccount: project.ownerAccount });
  const scopes = SCOPES.map(scope => {
    const rows = project[scope.alias];
    if (!Array.isArray(rows) || rows.length > scope.limit) refuse('RESPONSE_INVALID');
    const seen = new Set();
    const builds = rows.map(row => {
      keys(row, ['id', 'status', 'platform', 'distribution', 'buildProfile', 'appIdentifier', 'appVersion', 'appBuildVersion', 'gitCommitHash', 'app']);
      identity(row.app);
      if (typeof row.id !== 'string' || !UUID.test(row.id) || seen.has(row.id) || !STATUSES.has(row.status)) refuse('RESPONSE_INVALID'); seen.add(row.id);
      if (row.platform !== scope.platform || (row.distribution !== null && row.distribution !== 'INTERNAL') || row.buildProfile !== scope.buildProfile || (row.appIdentifier !== null && row.appIdentifier !== scope.appIdentifier) || (row.appVersion !== null && row.appVersion !== '1.0.0')) refuse('IDENTITY_REFUSED');
      if (row.gitCommitHash !== null && (typeof row.gitCommitHash !== 'string' || !HASH.test(row.gitCommitHash))) refuse('RESPONSE_INVALID');
      if (scope.source && row.gitCommitHash !== null && row.gitCommitHash !== scope.source) refuse('IDENTITY_REFUSED');
      if (row.appBuildVersion !== null && (typeof row.appBuildVersion !== 'string' || !/^[1-9][0-9]{0,17}$/.test(row.appBuildVersion))) refuse('RESPONSE_INVALID');
      const complete = [row.distribution, row.appIdentifier, row.appVersion, row.appBuildVersion, row.gitCommitHash].every(v => v !== null);
      return { id: row.id, status: row.status, platform: scope.platform, ...(row.distribution === null ? {} : { distribution: 'INTERNAL' }), buildProfile: scope.buildProfile,
        ...(row.appIdentifier === null ? {} : { appIdentifier: scope.appIdentifier }), ...(row.appVersion === null ? {} : { appVersion: '1.0.0' }),
        ...(row.appBuildVersion === null ? {} : { appBuildVersion: row.appBuildVersion }), ...(row.gitCommitHash === null ? {} : { gitCommitHash: row.gitCommitHash }),
        sourceMatch: row.gitCommitHash === null ? 'UNAVAILABLE' : row.gitCommitHash === (scope.source ?? readerSource) ? 'MATCH' : 'OTHER_SOURCE',
        metadataState: complete ? 'AVAILABLE' : 'METADATA_INCOMPLETE', buildDetailsUrl: `https://expo.dev/accounts/vasavas/projects/phone11ai/builds/${row.id}` };
    });
    return { scope: scope.alias, limit: scope.limit, offset: 0, requestedSource: scope.source, sourceComparison: scope.source ?? readerSource, exactSourceMatchCount: builds.filter(b => b.sourceMatch === 'MATCH').length, exhaustive: false, absenceEstablished: false, builds };
  });
  // Overlapping Android scopes may repeat IDs, but must agree byte-for-byte.
  const union = new Map();
  for (const scope of scopes) for (const build of scope.builds) { const { sourceMatch, ...metadata } = build; const previous = union.get(build.id); const serialized = JSON.stringify(metadata); if (previous && previous !== serialized) refuse('RESPONSE_INVALID'); union.set(build.id, serialized); }
  return { outcome: 'METADATA_ONLY', readOnly: true, authVerified: true, projectId: PROJECT, readerSource, scopes,
    firstDailyPilotIos: scopes[2].builds[0] ?? null, orderBasis: 'EXPO_FIRST_RESULT_OFFSET_ZERO', aliasesMayOverlap: true, artifactVerified: false, installed: false, physicalAcceptance: false, retryAuthorized: false };
}

export function assertInvocation(env, head, args = [], execArgs = []) {
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_REPOSITORY !== REPOSITORY || env.GITHUB_REF !== REF || env.GITHUB_WORKFLOW !== 'Phone11 mobile build history' || !HASH.test(env.GITHUB_SHA ?? '') || env.GITHUB_SHA !== head || args.length || execArgs.length) refuse('INVOCATION_REFUSED');
  for (const key of ['NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS', 'NODE_TLS_REJECT_UNAUTHORIZED', 'NODE_USE_ENV_PROXY']) if (env[key]) refuse('INVOCATION_REFUSED');
}

export function fetchResponse(token, request = https.request, timers = { setTimeout, clearTimeout }) {
  if (typeof token !== 'string' || !/^[!-~]{1,4096}$/.test(token)) return Promise.resolve().then(() => refuse('TOKEN_UNAVAILABLE'));
  return new Promise((resolveResult, reject) => {
    let req, timer, settled = false;
    const finish = (code, buffer) => {
      if (settled) return; settled = true; timers.clearTimeout(timer);
      if (code) { try { refuse(code); } catch (error) { reject(error); } req?.destroy(); } else resolveResult(buffer);
    };
    timer = timers.setTimeout(() => finish('TIMEOUT'), TIMEOUT_MS);
    try {
      req = request({ protocol: 'https:', hostname: 'api.expo.dev', port: 443, path: '/graphql', method: 'POST', agent: false, rejectUnauthorized: true, minVersion: 'TLSv1.2',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json', 'accept-encoding': 'identity', 'content-length': Buffer.byteLength(REQUEST_BODY) } }, response => {
        response.on('error', () => finish('TRANSPORT_FAILED')); response.on('aborted', () => finish('TRANSPORT_FAILED'));
        const status = response.statusCode;
        if (status === 401 || status === 403) return finish('AUTH_REFUSED');
        if (status !== 200) return finish('HTTP_REFUSED');
        const type = response.headers['content-type']; const encoding = response.headers['content-encoding']; const length = response.headers['content-length'];
        if (typeof type !== 'string' || !/^application\/(?:json|graphql-response\+json)(?:;\s*charset=utf-8)?$/i.test(type) || (encoding !== undefined && encoding !== 'identity') || (length !== undefined && (typeof length !== 'string' || !/^[0-9]+$/.test(length)))) return finish('RESPONSE_INVALID');
        if (length !== undefined && Number(length) > MAX_BYTES) return finish('RESPONSE_TOO_LARGE');
        let bytes = 0; const chunks = [];
        response.on('data', chunk => { if (settled) return; if (!Buffer.isBuffer(chunk)) return finish('RESPONSE_INVALID'); if (!chunk.length) return; bytes += chunk.length; if (bytes > MAX_BYTES) return finish('RESPONSE_TOO_LARGE'); chunks.push(chunk); });
        response.on('end', () => { if (!response.complete || (length !== undefined && Number(length) !== bytes)) return finish('RESPONSE_INVALID'); finish(null, Buffer.concat(chunks)); });
      });
      req.on('error', () => finish('TRANSPORT_FAILED')); req.end(REQUEST_BODY);
    } catch { finish('TRANSPORT_FAILED'); }
  });
}

export async function run({ env, head, args = [], execArgs = [], request, timers }) {
  let token;
  try {
    assertInvocation(env, head, args, execArgs);
    token = env.EXPO_TOKEN;
    const report = sanitizeResponse(parseResponse(await fetchResponse(token, request, timers)), head);
    const output = JSON.stringify(report);
    if (output.includes(token)) refuse('OUTPUT_REFUSED');
    return { code: 0, output };
  } catch (error) { return { code: 1, output: JSON.stringify(failureReceipt(error)) }; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let result;
  try {
    // Git is local/read-only. No shell, app config, dotenv, CLI or provider setup.
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: resolve(fileURLToPath(new URL('..', import.meta.url))), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 3000, maxBuffer: 128 }).trim();
    result = await run({ env: process.env, head, args: process.argv.slice(2), execArgs: process.execArgv });
  } catch { result = { code: 1, output: JSON.stringify(failureReceipt(null)) }; }
  process.stdout.write(result.output + '\n'); process.exitCode = result.code;
}
