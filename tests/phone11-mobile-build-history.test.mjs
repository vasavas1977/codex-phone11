import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PROJECT, PRIOR_ANDROID_SOURCE, REPOSITORY, REF, SCOPES, QUERY, REQUEST_BODY, MAX_BYTES, TIMEOUT_MS, parseResponse, sanitizeResponse, failureReceipt, assertInvocation, fetchResponse, run } from '../scripts/read-phone11-mobile-build-history.mjs';

const HEAD = '4431596b2f3160005eb50b21b760c3ccf3915540';
const TOKEN = 'synthetic-token-never-a-real-secret';
const env = () => ({ GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REPOSITORY: REPOSITORY, GITHUB_REF: REF, GITHUB_WORKFLOW: 'Phone11 mobile build history', GITHUB_SHA: HEAD, EXPO_TOKEN: TOKEN });
const app = () => ({ id: PROJECT, slug: 'phone11ai', ownerAccount: { name: 'vasavas' } });
function row(scope, index = 1) { return { id: `aabbccdd-1234-5678-abcd-${String(index).padStart(12, '0')}`, status: 'ERRORED', platform: scope.platform, distribution: 'INTERNAL', buildProfile: scope.buildProfile, appIdentifier: scope.appIdentifier, appVersion: '1.0.0', appBuildVersion: '120', gitCommitHash: scope.source ?? HEAD, app: app() }; }
function fixture() { return { data: { app: { byId: { ...app(), priorAndroid: [row(SCOPES[0])], recentAndroid: [row(SCOPES[1], 2)], dailyPilotIos: [row(SCOPES[2], 3)] } } } }; }
function refusal(fn, code) { assert.throws(fn, error => { assert.equal(failureReceipt(error).failureCode, code); assert.equal(error.message, 'HISTORY_REFUSED'); return true; }); }
function mockResponse({ body = JSON.stringify(fixture()), status = 200, headers = { 'content-type': 'application/json' }, complete = true, event, chunks, hang = false, requestError = false } = {}) {
  const observed = { calls: 0, destroyed: false };
  const request = (options, callback) => {
    observed.calls++; observed.options = options;
    const req = new EventEmitter(); req.destroy = () => { observed.destroyed = true; }; req.end = sent => {
      observed.body = sent;
      queueMicrotask(() => {
        if (requestError) return req.emit('error', new Error(`private ${TOKEN}`));
        if (hang) return;
        const response = new EventEmitter(); response.statusCode = status; response.headers = headers; response.complete = complete;
        callback(response);
        if (event) { response.emit(event, new Error(`private ${TOKEN}`)); return; }
        for (const chunk of chunks ?? [Buffer.from(body)]) response.emit('data', chunk);
        response.emit('end');
      });
    }; return req;
  }; return { request, observed };
}

test('fixed query selects metadata only at the actual official read-only path', async () => {
  assert.match(QUERY, /^query Phone11MobileBuildHistory\(\$appId: String!\)/);
  assert.doesNotMatch(QUERY, /\b(?:mutation|error|artifacts|logFiles|message|initiatingActor|credentials|create|cancel)\b/);
  for (const s of SCOPES) assert.ok(QUERY.includes(`limit: ${s.limit}`) && QUERY.includes(s.buildProfile) && QUERY.includes(s.appIdentifier));
  assert.equal(JSON.parse(REQUEST_BODY).variables.appId, PROJECT);
  const { request, observed } = mockResponse(); await fetchResponse(TOKEN, request);
  assert.equal(observed.calls, 1); assert.equal(observed.options.hostname, 'api.expo.dev'); assert.equal(observed.options.path, '/graphql'); assert.equal(observed.options.method, 'POST');
  assert.equal(observed.options.agent, false); assert.equal(observed.options.rejectUnauthorized, true); assert.equal(observed.options.headers.authorization, `Bearer ${TOKEN}`); assert.equal(observed.body, REQUEST_BODY);
});

test('safe report preserves enum states, exact source scope and no acceptance inference', () => {
  for (const status of ['NEW', 'IN_QUEUE', 'IN_PROGRESS', 'PENDING_CANCEL', 'ERRORED', 'FINISHED', 'CANCELED']) {
    const data = fixture(); data.data.app.byId.priorAndroid[0].status = status;
    const report = sanitizeResponse(parseResponse(Buffer.from(JSON.stringify(data))), HEAD);
    assert.equal(report.scopes[0].builds[0].status, status); assert.equal(report.scopes[0].requestedSource, PRIOR_ANDROID_SOURCE); assert.equal(report.scopes[0].exactSourceMatchCount, 1);
    assert.equal(report.firstDailyPilotIos.id, report.scopes[2].builds[0].id);
    for (const field of ['artifactVerified', 'installed', 'physicalAcceptance', 'retryAuthorized']) assert.equal(report[field], false);
    for (const scope of report.scopes) { assert.equal(scope.exhaustive, false); assert.equal(scope.absenceEstablished, false); }
    assert.doesNotMatch(JSON.stringify(report), /logFiles|buildUrl|errorCode|private|artifactAvailable/);
  }
});

test('nullable unavailable fields are never a source match or release admission', () => {
  const data = fixture(); const build = data.data.app.byId.priorAndroid[0];
  for (const key of ['distribution', 'appIdentifier', 'appVersion', 'appBuildVersion', 'gitCommitHash']) build[key] = null;
  const report = sanitizeResponse(data, HEAD); const sanitized = report.scopes[0].builds[0];
  assert.equal(sanitized.metadataState, 'METADATA_INCOMPLETE'); assert.equal(sanitized.sourceMatch, 'UNAVAILABLE'); assert.equal(report.scopes[0].exactSourceMatchCount, 0);
  assert.equal(Object.hasOwn(sanitized, 'gitCommitHash'), false); assert.equal(Object.hasOwn(sanitized, 'appIdentifier'), false);
  data.data.app.byId.recentAndroid[0].gitCommitHash = PRIOR_ANDROID_SOURCE;
  assert.equal(sanitizeResponse(data, HEAD).scopes[1].builds[0].sourceMatch, 'OTHER_SOURCE');
  for (const scope of SCOPES) data.data.app.byId[scope.alias] = [];
  assert.equal(sanitizeResponse(data, HEAD).firstDailyPilotIos, null);
});

test('each identity, source, status and metadata boundary fails closed', () => {
  const cases = [ ['id', '../private', 'RESPONSE_INVALID'], ['status', 'FINISHED\nsecret@example.com', 'RESPONSE_INVALID'], ['platform', 'IOS', 'IDENTITY_REFUSED'], ['distribution', 'STORE', 'IDENTITY_REFUSED'], ['buildProfile', 'production', 'IDENTITY_REFUSED'], ['appIdentifier', 'private@example.com', 'IDENTITY_REFUSED'], ['appVersion', '2.0.0', 'IDENTITY_REFUSED'], ['appBuildVersion', '1<script>', 'RESPONSE_INVALID'], ['appBuildVersion', '0', 'RESPONSE_INVALID'], ['appBuildVersion', 120, 'RESPONSE_INVALID'], ['gitCommitHash', 'x'.repeat(40), 'RESPONSE_INVALID'], ['gitCommitHash', HEAD, 'IDENTITY_REFUSED'] ];
  for (const [key, value, code] of cases) { const data = fixture(); data.data.app.byId.priorAndroid[0][key] = value; refusal(() => sanitizeResponse(data, HEAD), code); }
  for (const [key, value] of [['id', '11111111-1111-1111-1111-111111111111'], ['slug', 'other'], ['ownerAccount', { name: 'attacker' }]]) { const data = fixture(); data.data.app.byId.priorAndroid[0].app[key] = value; refusal(() => sanitizeResponse(data, HEAD), 'IDENTITY_REFUSED'); }
  const wrongRoot = fixture(); wrongRoot.data.app.byId.ownerAccount.name = 'other'; refusal(() => sanitizeResponse(wrongRoot, HEAD), 'IDENTITY_REFUSED');
  for (const field of Object.keys(row(SCOPES[0]))) { const data = fixture(); delete data.data.app.byId.priorAndroid[0][field]; refusal(() => sanitizeResponse(data, HEAD), 'RESPONSE_INVALID'); }
});

test('unexpected private data, GraphQL errors and arbitrary error objects are never copied', async () => {
  for (const payload of [{ errors: [{ message: TOKEN, extensions: { logUrl: 'https://private.example' } }] }, { data: fixture().data, errors: [{ message: TOKEN }] }]) {
    const { request } = mockResponse({ body: JSON.stringify(payload) }); const result = await run({ env: env(), head: HEAD, request });
    assert.equal(result.code, 1); assert.doesNotMatch(result.output, /synthetic|private\.example|extensions|logUrl/);
  }
  const data = fixture(); data.data.app.byId.priorAndroid[0].error = { message: TOKEN }; refusal(() => sanitizeResponse(data, HEAD), 'RESPONSE_INVALID');
  assert.equal(failureReceipt({ message: TOKEN, failureCode: TOKEN }).failureCode, 'RESPONSE_INVALID');
});

test('duplicates, oversized buckets and inconsistent overlapping records refuse', () => {
  const data = fixture(); data.data.app.byId.priorAndroid.push(structuredClone(data.data.app.byId.priorAndroid[0])); refusal(() => sanitizeResponse(data, HEAD), 'RESPONSE_INVALID');
  for (const scope of SCOPES) { const over = fixture(); over.data.app.byId[scope.alias] = Array.from({ length: scope.limit + 1 }, (_, i) => row(scope, i + 1)); refusal(() => sanitizeResponse(over, HEAD), 'RESPONSE_INVALID'); }
  const overlap = fixture(); overlap.data.app.byId.recentAndroid = [structuredClone(overlap.data.app.byId.priorAndroid[0])];
  assert.equal(sanitizeResponse(overlap, HEAD).aliasesMayOverlap, true);
  overlap.data.app.byId.recentAndroid[0].status = 'FINISHED'; refusal(() => sanitizeResponse(overlap, HEAD), 'RESPONSE_INVALID');
});

test('bounded JSON rejects escaped duplicate keys, malformed UTF-8, depth and trailing data', () => {
  for (const text of ['{"data":1,"data":2}', '{"data":1,"\\u0064ata":2}', '{"a":{"id":1,"id":2}}', '{', '{} garbage', '\ufeff{}', '[1,]', '['.repeat(22) + '0' + ']'.repeat(22)]) refusal(() => parseResponse(Buffer.from(text)), 'RESPONSE_INVALID');
  refusal(() => parseResponse(Buffer.from([0xff])), 'RESPONSE_INVALID'); refusal(() => parseResponse(Buffer.alloc(MAX_BYTES + 1)), 'RESPONSE_TOO_LARGE');
  assert.deepEqual(parseResponse(Buffer.from('{"a":"escaped \\" quote","b":[true,null,-1.2e3]}')), { a: 'escaped " quote', b: [true, null, -1200] });
});

test('network failures, redirects, encoded and truncated responses are symbolic with one request', async () => {
  const cases = [[{ status: 401 }, 'AUTH_REFUSED'], [{ status: 403 }, 'AUTH_REFUSED'], [{ status: 302, headers: { location: 'https://private.example' } }, 'HTTP_REFUSED'], [{ status: 500 }, 'HTTP_REFUSED'], [{ headers: { 'content-type': 'text/plain' } }, 'RESPONSE_INVALID'], [{ headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' } }, 'RESPONSE_INVALID'], [{ headers: { 'content-type': 'application/json', 'content-length': String(MAX_BYTES + 1) } }, 'RESPONSE_TOO_LARGE'], [{ chunks: [Buffer.alloc(MAX_BYTES), Buffer.alloc(1)] }, 'RESPONSE_TOO_LARGE'], [{ complete: false }, 'RESPONSE_INVALID'], [{ headers: { 'content-type': 'application/json', 'content-length': '1' } }, 'RESPONSE_INVALID'], [{ event: 'aborted' }, 'TRANSPORT_FAILED'], [{ event: 'error' }, 'TRANSPORT_FAILED'], [{ requestError: true }, 'TRANSPORT_FAILED']];
  for (const [input, code] of cases) { const { request, observed } = mockResponse(input); const result = await run({ env: env(), head: HEAD, request }); assert.equal(JSON.parse(result.output).failureCode, code); assert.equal(observed.calls, 1); assert.equal(observed.destroyed, true); assert.doesNotMatch(result.output, /synthetic|private/); }
});

test('absolute deadline destroys a stalled request without retry', async () => {
  let timeout; let cleared = false;
  const timers = { setTimeout(callback, ms) { assert.equal(ms, TIMEOUT_MS); timeout = callback; return 1; }, clearTimeout() { cleared = true; } };
  const { request, observed } = mockResponse({ hang: true }); const pending = run({ env: env(), head: HEAD, request, timers }); timeout(); const result = await pending;
  assert.equal(JSON.parse(result.output).failureCode, 'TIMEOUT'); assert.equal(observed.calls, 1); assert.equal(observed.destroyed, true); assert.equal(cleared, true);
});

test('invocation guards reject unmanaged runs before any token transport', async () => {
  const changes = { GITHUB_ACTIONS: 'false', GITHUB_EVENT_NAME: 'push', GITHUB_REPOSITORY: 'attacker/fork', GITHUB_REF: 'refs/heads/main', GITHUB_WORKFLOW: 'other', GITHUB_SHA: PRIOR_ANDROID_SOURCE, NODE_OPTIONS: '--require private', NODE_EXTRA_CA_CERTS: '/private', NODE_TLS_REJECT_UNAUTHORIZED: '0', NODE_USE_ENV_PROXY: '1' };
  for (const [key, value] of Object.entries(changes)) { let calls = 0; const result = await run({ env: { ...env(), [key]: value }, head: HEAD, request: () => { calls++; } }); assert.equal(calls, 0); assert.equal(JSON.parse(result.output).failureCode, 'INVOCATION_REFUSED'); }
  refusal(() => assertInvocation(env(), HEAD, ['query']), 'INVOCATION_REFUSED'); refusal(() => assertInvocation(env(), HEAD, [], ['--inspect']), 'INVOCATION_REFUSED');
  for (const token of [undefined, '', 'bad\r\nheader', ' '.repeat(10), 'x'.repeat(4097)]) { let calls = 0; const result = await run({ env: { ...env(), EXPO_TOKEN: token }, head: HEAD, request: () => { calls++; } }); assert.equal(calls, 0); assert.equal(JSON.parse(result.output).failureCode, 'TOKEN_UNAVAILABLE'); }
});

test('valid-looking provider values cannot echo a synthetic credential', async () => {
  const { request } = mockResponse(); const result = await run({ env: { ...env(), EXPO_TOKEN: HEAD }, head: HEAD, request });
  assert.equal(JSON.parse(result.output).failureCode, 'OUTPUT_REFUSED'); assert.equal(result.output.includes(HEAD), false);
});

test('actual unmanaged entrypoint prints one literal refusal and no stderr without a token', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/read-phone11-mobile-build-history.mjs', import.meta.url))], { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 1); assert.equal(result.stderr, '');
  assert.equal(result.stdout.trim().split('\n').length, 1); assert.equal(JSON.parse(result.stdout).failureCode, 'INVOCATION_REFUSED');
});

test('workflow offline checks auto-run while token-bearing job is manual and owned-ref only', () => {
  const workflow = readFileSync(new URL('../.github/workflows/phone11-mobile-build-history.yml', import.meta.url), 'utf8');
  assert.match(workflow, /on:\n  workflow_dispatch:\n  pull_request:\n    paths:/); assert.match(workflow, /  push:\n    branches:\n      - 'codex\/phone11-zoom-mainline-integration-20260928'/);
  assert.match(workflow, /permissions:\n  contents: read/); assert.match(workflow, /metadata:\n    needs: offline\n    if: github\.event_name == 'workflow_dispatch' && github\.repository == 'vasavas1977\/codex-phone11' && github\.ref == 'refs\/heads\/codex\/phone11-zoom-mainline-integration-20260928'/);
  const [offline, metadata] = workflow.split('  metadata:'); assert.doesNotMatch(offline, /EXPO_TOKEN|secrets\./); assert.match(offline, /node --test tests\/phone11-mobile-build-history\.test\.mjs/);
  assert.equal((metadata.match(/secrets\.EXPO_TOKEN/g) ?? []).length, 1); assert.match(metadata, /run: node scripts\/read-phone11-mobile-build-history\.mjs/);
  assert.equal((workflow.match(/ref: \$\{\{ github\.sha \}\}/g) ?? []).length, 2); assert.equal((workflow.match(/persist-credentials: false/g) ?? []).length, 2);
  assert.doesNotMatch(workflow, /workflow_call|schedule:|upload-artifact|expo-github-action|npm |pnpm |eas |build --|run:.*credentials|continue-on-error|pull_request_target/);
  const source = readFileSync(new URL('../scripts/read-phone11-mobile-build-history.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /execFileSync\(['"](?:eas|npm|pnpm)|writeFile|appendFile|readFile|from ['"]dotenv|fetch\(/); assert.match(source, /hostname: 'api\.expo\.dev'/);
});
