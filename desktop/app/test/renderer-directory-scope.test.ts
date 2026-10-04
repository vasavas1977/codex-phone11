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
type ElementStub = {
  hidden: boolean; disabled: boolean; textContent: string; value: string; dataset: Record<string, string>;
  children: ElementStub[]; className: string; attributes: Record<string, string>; focused: boolean;
  listeners: Map<string, (event: any) => unknown>;
  addEventListener(type: string, fn: (event: any) => unknown): void;
  setAttribute(name: string, value: string): void; removeAttribute(name: string): void;
  append(...children: ElementStub[]): void; replaceChildren(): void; focus(): void; pause(): void; load(): void;
};
function element(): ElementStub {
  return { hidden: false, disabled: false, textContent: '', value: '', dataset: {} as Record<string, string>,
    children: [] as ReturnType<typeof element>[], className: '', attributes: {} as Record<string, string>,
    listeners: new Map<string, (event: any) => unknown>(), focused: false,
    addEventListener(type: string, fn: (event: any) => unknown) { this.listeners.set(type, fn); },
    setAttribute(name: string, value: string) { this.attributes[name] = value; },
    removeAttribute(name: string) { delete this.attributes[name]; },
    append(...children: ReturnType<typeof element>[]) { this.children.push(...children); },
    replaceChildren() { this.children = []; }, focus() { this.focused = true; }, pause() {}, load() {} };
}
const idle = { version: 1, registered: true, call: null, dialState: 'idle', callActionState: 'idle', holdMessage: null };
async function fixture() {
  const elements = new Map(ids.map(id => [id, element()]));
  let state = { signedIn: true, sessionRevision: 'session-a', generation: 'generation-a', tenantId: 1,
    extensionNumber: '1020', calling: { ...idle } };
  const pending: { revision: string; tenantId: number; search: string; offset: number;
    resolve: (value: unknown) => void; reject: (error: Error) => void }[] = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  let update!: (value: unknown) => void;
  let actionGate: Promise<void> | null = null;
  let finishAction!: () => void;
  const actions: unknown[] = [];
  runInNewContext(bundle, {
    console, document: { getElementById: (id: string) => elements.get(id) ?? null, createElement: element },
    window: { phone11: {
      state: async () => state, signIn: async () => state,
      signOut: async () => ({ ...state, signedIn: false, sessionRevision: null, generation: null, calling: idle }),
      onUpdate: (fn: (value: unknown) => void) => { update = fn; },
      action: async (input: unknown) => { actions.push(input); if (actionGate) await actionGate;
        return { sessionRevision: state.sessionRevision, generation: state.generation, snapshot: state.calling }; },
      historyList: async (revision: string) => ({ sessionRevision: revision, items: [], nextCursor: null }),
      directoryList: (revision: string, search: string, offset: number) => new Promise((resolve, reject) => {
        pending.push({ revision, tenantId: state.tenantId, search, offset, resolve, reject });
      }),
    } },
    setTimeout: (fn: () => void) => { const id = nextTimer++; timers.set(id, fn); return id; },
    clearTimeout: (id: number) => { timers.delete(id); },
  });
  await tick();
  const get = (id: string) => { const value = elements.get(id); assert.ok(value, id); return value; };
  const event = (id: string, type = 'click') => get(id).listeners.get(type)!({ preventDefault() {} });
  const rows = () => get('directory-list').children;
  const clickRow = (row: ReturnType<typeof element>) => row.listeners.get('click')!({});
  const reply = async (index: number, number: string, nextOffset: number | null = null) => {
    const request = pending[index];
    request.resolve({ sessionRevision: request.revision, tenantId: request.tenantId,
      items: [{ id: index + 1, name: `Contact ${number}`, number }], nextOffset });
    await tick();
  };
  const signIn = async (revision: string, tenantId: number) => {
    await event('sign-out');
    state = { ...state, sessionRevision: revision, tenantId };
    await event('login-form', 'submit'); await tick();
  };
  const search = async (value: string) => {
    get('directory-search').value = value; event('directory-search', 'input');
    for (const [id, callback] of [...timers]) { timers.delete(id); callback(); }
    await tick();
  };
  const emit = (calling: unknown) => update({ sessionRevision: state.sessionRevision, generation: state.generation, snapshot: calling });
  event('directory-tab'); await tick();
  return { get, event, rows, clickRow, reply, signIn, search, emit, pending, actions,
    deferAction: () => { actionGate = new Promise(resolve => { finishAction = resolve; }); },
    finishAction: () => finishAction() };
}

for (const replacement of [
  { revision: 'session-b', tenantId: 1, label: 'account' },
  { revision: 'session-a', tenantId: 2, label: 'workspace' },
  { revision: 'session-a', tenantId: 1, label: 'new login with reused tags' },
]) test(`retained directory row cannot fill the dialpad after ${replacement.label} replacement`, async () => {
  const f = await fixture();
  await f.reply(0, '3001');
  const oldRow = f.rows()[0];
  await f.signIn(replacement.revision, replacement.tenantId);
  assert.equal(f.rows().length, 0, 'sign-out removes hidden contact data');
  f.event('directory-tab'); await f.reply(1, '4001');
  f.get('destination').value = 'untouched'; f.clickRow(oldRow);
  assert.equal(f.get('destination').value, 'untouched');
  f.clickRow(f.rows()[0]); assert.equal(f.get('destination').value, '4001');
  assert.equal(f.actions.length, 0, 'current contact selection fills the dialpad without calling');
});

test('old search row stays retired when its search is revisited', async () => {
  const f = await fixture();
  await f.reply(0, '3001'); const firstRow = f.rows()[0];
  await f.search('Som'); await f.reply(1, '4001'); const searchRow = f.rows()[0];
  await f.search(''); await f.reply(2, '5001');
  f.get('destination').value = 'untouched'; f.clickRow(firstRow); f.clickRow(searchRow);
  assert.equal(f.get('destination').value, 'untouched');
  f.clickRow(f.rows()[0]); assert.equal(f.get('destination').value, '5001');
});

test('refresh retires prior row callbacks through failure and recovery in the same scope', async () => {
  const f = await fixture();
  await f.reply(0, '3001'); const oldRow = f.rows()[0];
  f.event('directory-refresh'); f.get('destination').value = 'untouched'; f.clickRow(oldRow);
  assert.equal(f.get('destination').value, 'untouched', 'pending refresh cannot reuse a removed row');
  f.pending[1].reject(new Error('private failed request')); await tick();
  f.clickRow(oldRow); assert.equal(f.get('destination').value, 'untouched');
  f.event('directory-refresh'); await f.reply(2, '4001');
  f.clickRow(oldRow); assert.equal(f.get('destination').value, 'untouched');
  f.clickRow(f.rows()[0]); assert.equal(f.get('destination').value, '4001');
});

test('pagination preserves current selectable rows while rejecting removed pre-page callbacks', async () => {
  const f = await fixture();
  await f.reply(0, '3001', 50); const beforePage = f.rows()[0];
  f.event('directory-more'); await f.reply(1, '4001');
  assert.equal(f.pending[1].offset, 50); assert.equal(f.rows().length, 2);
  f.get('destination').value = 'untouched'; f.clickRow(beforePage);
  assert.equal(f.get('destination').value, 'untouched');
  f.clickRow(f.rows()[0]); assert.equal(f.get('destination').value, '3001');
  f.clickRow(f.rows()[1]); assert.equal(f.get('destination').value, '4001');
});

test('late old-owner responses and errors cannot replace the new directory or enable its retained row', async () => {
  const f = await fixture();
  await f.reply(0, '3001'); const oldRow = f.rows()[0];
  f.event('directory-refresh'); await f.signIn('session-b', 2);
  f.event('directory-tab'); await f.reply(2, '4001');
  await f.reply(1, 'obsolete');
  assert.equal(f.rows()[0].children[1].textContent, 'Extension 4001');
  f.get('destination').value = 'untouched'; f.clickRow(oldRow);
  assert.equal(f.get('destination').value, 'untouched');
  f.event('directory-refresh'); await f.signIn('session-c', 3);
  f.event('directory-tab'); await f.reply(4, '5001');
  f.pending[3].reject(new Error('private obsolete owner error')); await tick();
  assert.equal(f.get('directory-state').textContent, '');
  assert.equal(f.rows()[0].children[1].textContent, 'Extension 5001');
});

test('current directory rows preserve registration and call lifecycle guards', async () => {
  const f = await fixture(); await f.reply(0, '3001');
  for (const calling of [
    { ...idle, registered: false }, { ...idle, dialState: 'requesting' },
    { ...idle, callActionState: 'requesting' },
    { ...idle, call: { id: '81', state: 'connected', muted: false } },
  ]) {
    f.emit(calling); f.get('destination').value = 'untouched'; f.clickRow(f.rows()[0]);
    assert.equal(f.get('destination').value, 'untouched');
  }
  f.emit(idle); f.clickRow(f.rows()[0]);
  assert.equal(f.get('destination').value, '3001'); assert.equal(f.get('destination').focused, true);
  assert.equal(f.actions.length, 0);
});

test('a current directory row cannot edit the destination while an action reply is pending', async () => {
  const f = await fixture(); await f.reply(0, '3001');
  f.deferAction(); f.get('destination').value = '5555'; f.event('dial-form', 'submit');
  f.clickRow(f.rows()[0]); assert.equal(f.get('destination').value, '5555');
  assert.equal(f.actions.length, 1);
  f.finishAction(); await tick();
  f.clickRow(f.rows()[0]); assert.equal(f.get('destination').value, '3001');
  assert.equal(f.actions.length, 1, 'selection does not initiate another call');
});
