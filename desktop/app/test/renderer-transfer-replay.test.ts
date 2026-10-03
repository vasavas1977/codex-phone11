import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { buildSync } from 'esbuild';

const root = join(__dirname, '..');
const bundle = buildSync({ entryPoints: [join(root, 'src/renderer.ts')], bundle: true, write: false,
  platform: 'browser', target: 'chrome128', format: 'iife' }).outputFiles[0].text;
const ids = [...readFileSync(join(root, 'src/index.html'), 'utf8').matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function element() {
  return { hidden: false, disabled: false, textContent: '', value: '', dataset: {} as Record<string, string>,
    children: [] as unknown[], className: '', attributes: {} as Record<string, string>,
    listeners: new Map<string, (event: any) => void>(),
    addEventListener(type: string, fn: (event: any) => void) { this.listeners.set(type, fn); },
    setAttribute(name: string, value: string) { this.attributes[name] = value; },
    removeAttribute(name: string) { delete this.attributes[name]; },
    append(...children: unknown[]) { this.children.push(...children); },
    replaceChildren() { this.children = []; }, focus() {}, pause() {}, load() {} };
}
const idle = { version: 1 as const, registered: true, call: null, dialState: 'idle' as const,
  callActionState: 'idle' as const, holdMessage: null };
function snapshot(id: string, state = 'connected', transfer: string | undefined = 'ready') {
  return { ...idle, call: { id, state, muted: false }, ...(transfer === undefined ? {} : { transfer }) };
}
function legacySnapshot(id: string) { return { ...idle, call: { id, state: 'connected', muted: false } }; }
async function fixture(capability = true) {
  const elements = new Map(ids.map(id => [id, element()]));
  const pending: { input: any; resolve: (value: unknown) => void; reject: (error: Error) => void }[] = [];
  let update!: (value: unknown) => void;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const initial = { signedIn: true, sessionRevision: 'session-a', generation: 'generation-a', tenantId: 1,
    extensionNumber: '1020', calling: capability ? snapshot('81') : legacySnapshot('81') };
  runInNewContext(bundle, {
    console, document: { getElementById: (id: string) => elements.get(id) ?? null, createElement: element },
    window: { phone11: {
      state: async () => initial,
      signIn: async () => initial,
      signOut: async () => ({ ...initial, signedIn: false, sessionRevision: null, generation: null, calling: idle }),
      onUpdate: (fn: (value: unknown) => void) => { update = fn; },
      action: (input: unknown) => new Promise((resolve, reject) => { pending.push({ input, resolve, reject }); }),
      historyList: async () => ({ sessionRevision: 'session-a', items: [], nextCursor: null }),
      directoryList: async () => ({ sessionRevision: 'session-a', tenantId: 1, items: [], nextOffset: null }),
    } },
    setTimeout: (fn: () => void, ms: number) => { const timer = setTimeout(fn, ms); timers.add(timer); return timer; },
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => { timers.delete(timer); clearTimeout(timer); },
  });
  await tick();
  const get = (id: string) => { const value = elements.get(id); assert.ok(value, id); return value; };
  const click = (id: string) => { get(id).listeners.get('click')!({}); };
  const emit = (calling: unknown, sessionRevision = 'session-a', generation = 'generation-a') =>
    update({ sessionRevision, generation, snapshot: calling });
  const reply = (index: number, calling: unknown) => pending[index].resolve({ sessionRevision: 'session-a', generation: 'generation-a', snapshot: calling });
  const transfer = () => { get('transfer-destination').value = '3002'; click('transfer'); };
  return { get, click, emit, reply, transfer, pending, cleanup: () => { for (const timer of timers) clearTimeout(timer); } };
}

test('confirmed callback outranks an older accepted transfer reply', async () => {
  const f = await fixture();
  try {
    f.transfer(); f.emit(snapshot('81', 'connected', 'confirmed'));
    f.reply(0, snapshot('81', 'connected', 'pending')); await tick();
    assert.match(f.get('transfer-message').textContent, /^Transfer confirmed/);
    assert.equal(f.get('transfer').disabled, true);
  } finally { f.cleanup(); }
});
test('confirmed callback outranks a late request error', async () => {
  const f = await fixture();
  try {
    f.transfer(); f.emit(snapshot('81', 'connected', 'confirmed'));
    f.pending[0].reject(new Error('private')); await tick();
    assert.match(f.get('transfer-message').textContent, /^Transfer confirmed/);
    assert.equal(f.get('message').textContent, '');
  } finally { f.cleanup(); }
});
test('late transfer reply after termination/new incoming call cannot hide Answer or retarget End', async () => {
  const f = await fixture();
  try {
    f.transfer(); f.emit({ ...idle, transfer: 'ready' }); f.emit(snapshot('43', 'incoming'));
    assert.equal(f.get('answer').hidden, false);
    f.reply(0, snapshot('81', 'connected', 'pending')); await tick();
    assert.equal(f.get('answer').hidden, false);
    assert.match(f.get('status').textContent, /^Incoming/);
    f.click('end'); assert.equal(f.pending[1].input.callId, '43');
    f.reply(1, { ...idle, transfer: 'ready' }); await tick();
  } finally { f.cleanup(); }
});
test('terminated call stays ended after a late accepted reply', async () => {
  const f = await fixture();
  try {
    f.transfer(); f.emit({ ...idle, transfer: 'ready' });
    f.reply(0, snapshot('81', 'connected', 'pending')); await tick();
    assert.equal(f.get('end').hidden, true);
    assert.equal(f.get('transfer-controls').hidden, true);
  } finally { f.cleanup(); }
});
test('new call stays usable after an old transfer error', async () => {
  const f = await fixture();
  try {
    f.transfer(); f.emit({ ...idle, transfer: 'ready' }); f.emit(snapshot('43', 'incoming'));
    f.pending[0].reject(new Error('private')); await tick();
    assert.equal(f.get('answer').hidden, false); assert.equal(f.get('message').textContent, '');
    f.click('answer'); assert.equal(f.pending[1].input.callId, '43');
    f.reply(1, snapshot('43')); await tick();
  } finally { f.cleanup(); }
});
for (const outcome of ['reply', 'error']) test(`parallel Mute and End remain usable; older action ${outcome} cannot overwrite newer End`, async () => {
  const f = await fixture();
  try {
    f.transfer(); f.click('mute'); f.click('end');
    assert.deepEqual(f.pending.map(item => item.input.operation), ['transfer', 'mute', 'end']);
    f.reply(2, { ...idle, transfer: 'ready' }); await tick();
    if (outcome === 'error') f.pending[1].reject(new Error('private'));
    else f.reply(1, { ...snapshot('81', 'connected', 'pending'), call: { id: '81', state: 'connected', muted: true } });
    f.reply(0, snapshot('81', 'connected', 'pending')); await tick();
    assert.equal(f.get('end').hidden, true); assert.equal(f.get('transfer-controls').hidden, true);
    assert.equal(f.get('message').textContent, '');
  } finally { f.cleanup(); }
});
test('older completion cannot unlock a newer command, and ignored foreign events do not fence valid replies', async () => {
  const f = await fixture();
  try {
    f.transfer(); f.click('mute');
    f.emit({ ...idle, transfer: 'ready' }); f.emit(snapshot('43'));
    f.reply(0, snapshot('81', 'connected', 'pending')); await tick();
    f.emit(snapshot('43'));
    assert.equal(f.get('transfer').disabled, true, 'newer Mute still owns the busy slot');
    f.reply(1, snapshot('81', 'connected', 'pending')); await tick();
    assert.equal(f.get('transfer').disabled, false);
    f.transfer(); f.emit(snapshot('999', 'connected', 'confirmed'), 'foreign-session', 'foreign-generation');
    f.reply(2, snapshot('43', 'connected', 'pending')); await tick();
    assert.match(f.get('transfer-message').textContent, /^Waiting for transfer confirmation/);
  } finally { f.cleanup(); }
});
test('old helper keeps normal Mute and End controls without exposing transfer', async () => {
  const f = await fixture(false);
  try {
    assert.equal(f.get('transfer-controls').hidden, true);
    f.click('mute'); f.reply(0, legacySnapshot('81')); await tick();
    f.click('end'); assert.deepEqual(f.pending.map(item => item.input.operation), ['mute', 'end']);
    f.reply(1, idle); await tick(); assert.equal(f.get('end').hidden, true);
  } finally { f.cleanup(); }
});

test('a late action completion cannot overwrite a replaced account lifecycle even with reused tags', async () => {
  const f = await fixture();
  try {
    f.transfer();
    await f.get('sign-out').listeners.get('click')!({});
    await f.get('login-form').listeners.get('submit')!({ preventDefault() {} });
    f.reply(0, snapshot('81', 'connected', 'pending')); await tick();
    assert.match(f.get('transfer-message').textContent, /^One transfer attempt/);
    assert.equal(f.get('transfer').disabled, false);
  } finally { f.cleanup(); }
});
