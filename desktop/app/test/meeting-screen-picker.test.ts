import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MeetingScreenPicker, type ScreenChoices } from '../src/meeting-screen-picker';
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const tick = () => new Promise<void>(done => setImmediate(done));
function fixture() {
  const source = { id: 'screen:private-native-id', name: 'Desktop', privateData: 'main-only' };
  let current = true, sequence = 0, sources = () => Promise.resolve([source]);
  const shown: (ScreenChoices | null)[] = [], granted: (typeof source | undefined)[] = [];
  const picker = new MeetingScreenPicker(() => sources(), () => `opaque-${++sequence}`, value => shown.push(value));
  return { source, shown, granted, picker, request: () => picker.request(() => current, value => granted.push(value)),
    setCurrent: (value: boolean) => { current = value; }, setSources: (value: typeof sources) => { sources = value; } };
}
test('enumeration never auto-selects and exposes opaque choices instead of source objects', async () => {
  const f = fixture(); f.request(); await tick(); assert.equal(f.granted.length, 0);
  const view = f.shown.at(-1)!; assert.equal(view.choices[0].name, 'Desktop');
  assert.ok(!JSON.stringify(view).includes('private')); await f.picker.choose(view.request, view.choices[0].handle);
  assert.equal(f.granted[0], f.source); assert.equal(f.shown.at(-1), null);
  await f.picker.choose(view.request, view.choices[0].handle); assert.equal(f.granted.length, 1);
});
test('cancellation denies once and late enumeration never opens the picker', async () => {
  const f = fixture(), result = deferred<(typeof f.source)[]>(); f.setSources(() => result.promise);
  f.request(); await tick(); f.picker.cancel(); result.resolve([f.source]); await tick();
  assert.deepEqual(f.granted, [undefined]); assert.deepEqual(f.shown, [null]);
});
test('current authority is checked after enumeration and after the choice lookup', async () => {
  const f = fixture(), result = deferred<(typeof f.source)[]>(); f.request(); await tick();
  const view = f.shown.at(-1)!; f.setSources(() => result.promise);
  const choice = f.picker.choose(view.request, view.choices[0].handle); f.setCurrent(false);
  result.resolve([f.source]); await choice; assert.deepEqual(f.granted, [undefined]);
  const second = fixture(); const enumeration = deferred<(typeof second.source)[]>(); second.setSources(() => enumeration.promise);
  second.request(); second.setCurrent(false); enumeration.resolve([second.source]); await tick(); assert.deepEqual(second.granted, [undefined]);
});
test('removed or renamed sources cannot be selected from an old inventory', async () => {
  for (const names of [[], ['Changed title']]) {
    const f = fixture(); f.request(); await tick(); const view = f.shown.at(-1)!;
    f.setSources(() => Promise.resolve(names.map(name => ({ ...f.source, name }))));
    await f.picker.choose(view.request, view.choices[0].handle); assert.deepEqual(f.granted, [undefined]);
  }
});
test('unknown choice refuses, stale request cannot affect a newer request, and overlaps refuse', async () => {
  const f = fixture(); f.request(); await tick(); const first = f.shown.at(-1)!;
  f.request(); assert.deepEqual(f.granted, [undefined]); await f.picker.choose('stale', first.choices[0].handle);
  assert.equal(f.shown.at(-1), first); await f.picker.choose(first.request, 'invented');
  assert.equal(f.granted.length, 2); f.request(); await tick(); const next = f.shown.at(-1)!;
  await f.picker.choose(first.request, first.choices[0].handle); assert.equal(f.shown.at(-1), next);
  await f.picker.choose(next.request, null); assert.equal(f.granted.length, 3);
});
test('errors, empty and oversized inventories fail closed without auto-selection', async () => {
  for (const mode of ['throw', 'reject', 'empty', 'oversize']) {
    const f = fixture(); f.setSources(() => {
      if (mode === 'throw') throw new Error('secret');
      if (mode === 'reject') return Promise.reject(new Error('secret'));
      return Promise.resolve(mode === 'empty' ? [] : Array.from({ length: 129 }, () => f.source));
    }); f.request(); await tick(); assert.deepEqual(f.granted, [undefined]); assert.equal(f.shown.at(-1), null);
  }
});
test('cancelling while a choice is resolving prevents grant and duplicate callback', async () => {
  const f = fixture(); f.request(); await tick(); const view = f.shown.at(-1)!;
  const sources = deferred<(typeof f.source)[]>(); f.setSources(() => sources.promise);
  const chosen = f.picker.choose(view.request, view.choices[0].handle);
  const duplicate = f.picker.choose(view.request, view.choices[0].handle);
  f.picker.cancel(); sources.resolve([f.source]); await Promise.all([chosen, duplicate]); assert.deepEqual(f.granted, [undefined]);
});
test('destroyed chooser or requesting frame cannot orphan a pending display callback', async () => {
  let replies = 0;
  const picker = new MeetingScreenPicker(() => Promise.resolve([{ id: 'source', name: 'Desktop' }]), () => 'handle',
    () => { throw new Error('destroyed-window'); });
  picker.request(() => true, () => { replies++; throw new Error('destroyed-frame'); });
  await tick(); assert.equal(replies, 1); assert.doesNotThrow(() => picker.cancel());
  assert.doesNotThrow(() => picker.request(() => false, () => { throw new Error('destroyed-frame'); }));
});
