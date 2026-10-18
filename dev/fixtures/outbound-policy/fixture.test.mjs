/** Prepared inert checks: no listener, bundle, application transport or browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureModel } from './model.mjs';
import { CSP, HOST, PORT, classifyRequest } from './server-policy.mjs';
import { EXPECTED_ASSETS, makeHandler, validateAssetBytes, validateAssets } from './serve.mjs';
const immediate = async () => {};
const flags = (tenantId, internationalEnabled = true, premiumRateEnabled = false) => ({ tenantId, internationalEnabled, premiumRateEnabled });
function gate() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
test('generated null/default policy is off and loading never creates a row', async () => {
  const m = createFixtureModel(immediate); const before = m.snapshot();
  assert.equal(before.query.isLoading, true);
  const result = await m.load();
  assert.equal(result.data.configured, false);
  assert.equal(result.data.internationalEnabled, false);
  assert.equal(result.data.premiumRateEnabled, false);
});
test('actual component transport contract acknowledges then reads back two booleans in selected scope', async () => {
  const m = createFixtureModel(immediate); await m.load();
  assert.deepEqual(await m.mutate(flags(801)), { success: true });
  const result = await m.load();
  assert.equal(result.isError, false); assert.equal(result.data.configured, true);
  assert.equal(result.data.internationalEnabled, true); assert.equal(result.data.premiumRateEnabled, false);
  assert.equal(result.data.tenantId, 801); assert.equal(result.data.ownerId, 101);
  assert.equal(result.data.authIdentity, m.snapshot().authIdentity);
});
test('two generated workspaces and accounts keep separate in-memory policy', async () => {
  const m = createFixtureModel(immediate); await m.mutate(flags(801));
  m.chooseTenant(802); assert.equal((await m.load()).data.configured, false);
  await m.mutate(flags(802, false, true));
  m.chooseTenant(801); assert.equal((await m.load()).data.internationalEnabled, true);
  m.chooseAccount('B'); assert.equal((await m.load()).data.configured, false);
  m.chooseAccount('A'); assert.equal((await m.load()).data.internationalEnabled, true);
});
test('same-ID generated reauthentication changes identity and clears old query before fresh read', async () => {
  const m = createFixtureModel(immediate); await m.load();
  const old = m.snapshot(), seen = [];
  m.subscribeAuth(() => seen.push(m.snapshot().user)); m.reauthenticate();
  assert.equal(m.snapshot().user.id, old.user.id); assert.notEqual(m.snapshot().user, old.user);
  assert.notEqual(m.snapshot().authIdentity, old.authIdentity); assert.equal(m.snapshot().query.data, undefined);
  assert.equal(seen.length, 1);
  assert.equal((await m.load()).data.authIdentity, m.snapshot().authIdentity);
});
test('generated stale read cannot populate another workspace', async () => {
  const wait = gate(); const m = createFixtureModel(() => wait.promise);
  const oldRead = m.load(); m.chooseTenant(802); wait.resolve();
  assert.equal((await oldRead).isError, true); assert.equal(m.snapshot().query.data, undefined);
});
test('delayed generated save retires on account/workspace/access changes', async () => {
  for (const action of [m => m.chooseTenant(802), m => m.reauthenticate(), m => m.setRevoked(true)]) {
    const wait = gate(); const m = createFixtureModel(() => wait.promise);
    const pending = m.mutate(flags(801)); const refused = assert.rejects(pending, /FIXTURE_WRITE_REFUSED/);
    action(m); wait.resolve(); await refused; assert.equal(m.snapshot().mutationPending, false);
  }
});
test('one-shot failure and mismatching readback do not fabricate confirmation', async () => {
  const m = createFixtureModel(immediate);
  m.arm('nextReadFails'); assert.equal((await m.load()).isError, true);
  assert.equal((await m.load()).isError, false);
  m.arm('nextSaveFails'); await assert.rejects(m.mutate(flags(801)), /FIXTURE_WRITE_REFUSED/);
  assert.equal((await m.load()).data.configured, false);
  m.arm('nextReadbackMismatch'); await m.mutate(flags(801));
  assert.equal((await m.load()).data.internationalEnabled, false);
});
test('old API, revoked access, unknown tenant/account/scenario and extra write fields refuse', async () => {
  const m = createFixtureModel(immediate);
  assert.throws(() => m.chooseTenant(1), /FIXTURE_TENANT_REFUSED/);
  assert.throws(() => m.chooseAccount('constructor'), /FIXTURE_ACCOUNT_REFUSED/);
  assert.throws(() => m.arm('arbitrary'), /FIXTURE_SCENARIO_REFUSED/);
  await assert.rejects(m.mutate({ ...flags(801), private: 'not accepted' }), /FIXTURE_WRITE_REFUSED/);
  await assert.rejects(m.mutate(flags(802)), /FIXTURE_WRITE_REFUSED/);
  m.setSupported(false); await assert.rejects(m.mutate(flags(801)), /FIXTURE_WRITE_REFUSED/);
  m.setSupported(true); m.setRevoked(true); assert.equal((await m.load()).isError, true);
});
test('server uses a fixed loopback origin and only three asset paths; no traversal/API routes', () => {
  assert.equal(HOST, '127.0.0.1'); assert.equal(PORT, 8106);
  const h = { host: '127.0.0.1:8106' };
  for (const [url, asset] of [['/', 'html'], ['/fixture.js', 'js'], ['/fixture.css', 'css']])
    assert.deepEqual(classifyRequest('GET', url, h), { status: 200, asset });
  for (const url of ['/api/trpc', '/../secret', '/%2e%2e/file', '/fixture.js?path=/etc/passwd', '/favicon.ico/other'])
    assert.equal(classifyRequest('GET', url, h).status, 404);
  assert.equal(classifyRequest('POST', '/', h).status, 405);
  for (const headers of [{ host: 'localhost:8106' }, { host: 'example.test:8106' },
    { ...h, origin: 'https://example.test' }, { ...h, cookie: 'synthetic' }, { ...h, 'sec-fetch-site': 'cross-site' }])
    assert.equal(classifyRequest('GET', '/', headers).status, 403);
});
test('fixed asset response enforces CSP/no-store/no-CORS without reflecting request data', () => {
  const handler = makeHandler({ html: Buffer.from('generated'), js: Buffer.from('js'), css: Buffer.from('css') });
  let status, headers, body;
  const response = { writeHead(s, h) { status = s; headers = h; }, end(b) { body = b; } };
  handler({ method: 'GET', url: '/', headers: { host: '127.0.0.1:8106' } }, response);
  assert.equal(status, 200); assert.equal(body.toString(), 'generated');
  assert.equal(headers['Content-Security-Policy'], CSP); assert.match(CSP, /connect-src 'none'/);
  assert.equal(headers['Cache-Control'], 'no-store'); assert.equal(headers['Access-Control-Allow-Origin'], undefined);
  assert.equal(headers['Set-Cookie'], undefined);
  handler({ method: 'HEAD', url: '/', headers: { host: '127.0.0.1:8106' } }, response);
  assert.equal(body, undefined);
});
test('exact compiled artifact pins are immutable and wrong content/length/type/extra assets refuse', () => {
  assert.equal(EXPECTED_ASSETS.js.bytes, 288865);
  assert.equal(EXPECTED_ASSETS.js.sha256, 'fbc3e16d84a901ace1349ebb4baed5480a0d704e7f9ddccdb8ee2efddde8f1e6');
  assert.ok(Object.isFrozen(EXPECTED_ASSETS));
  assert.ok(Object.values(EXPECTED_ASSETS).every(Object.isFrozen));
  for (const [name, pin] of Object.entries(EXPECTED_ASSETS)) {
    // Test each asset's hash branch directly rather than failing on HTML first.
    assert.throws(() => validateAssetBytes(name, Buffer.alloc(pin.bytes)), /FIXTURE_ASSET_PIN_REFUSED/);
    assert.throws(() => validateAssetBytes(name, Buffer.alloc(pin.bytes - 1)), /FIXTURE_ASSET_PIN_REFUSED/);
    assert.throws(() => validateAssetBytes(name, 'not a buffer'), /FIXTURE_ASSET_PIN_REFUSED/);
  }
  assert.throws(() => validateAssetBytes('constructor', Buffer.alloc(0)), /FIXTURE_ASSET_PIN_REFUSED/);
  const wrong = Object.fromEntries(Object.entries(EXPECTED_ASSETS).map(([name, pin]) => [name, Buffer.alloc(pin.bytes)]));
  assert.throws(() => validateAssets(wrong), /FIXTURE_ASSET_PIN_REFUSED/);
  for (const patch of [{ js: Buffer.alloc(288864) }, { html: 'not a buffer' }, { secret: Buffer.from('extra') }])
    assert.throws(() => validateAssets({ ...wrong, ...patch }), /FIXTURE_ASSET_PIN_REFUSED/);
  assert.throws(() => validateAssets(null), /FIXTURE_ASSET_PIN_REFUSED/);
  // The positive exact-artifact path is Root's separate compile-only check;
  // this inert test never invokes a bundler or opens a listener.
});
