import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DesktopMeetingScreenShare, screenPublishingPermitted, type ScreenTrack } from '../src/meeting-screen-share';
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture() {
  const events: string[] = [];
  const media = Object.assign(new EventTarget(), { readyState: 'live' as 'live' | 'ended' });
  let stopThrows = false, unpublishThrows = false, allowed = true, current = true;
  const track: ScreenTrack = { kind: 'video', mediaStreamTrack: media,
    stop() { events.push('stop'); if (stopThrows) throw new Error('secret-url'); media.readyState = 'ended'; } };
  const publications = new Set<ScreenTrack>();
  let capture = () => Promise.resolve([track]);
  let publish = async (value: ScreenTrack) => { events.push('publish'); publications.add(value); };
  const owner = new DesktopMeetingScreenShare({ allowed: () => allowed,
    capture: () => { events.push('capture'); return capture(); }, publish: value => publish(value),
    unpublish: async value => { events.push('unpublish'); if (unpublishThrows) throw new Error('secret-url'); publications.delete(value); },
    publications: () => [...publications], isPublished: value => publications.has(value), cancelCapture: () => events.push('cancel') },
  () => current, () => {});
  return { owner, events, media, track, publications, setAllowed: (value: boolean) => { allowed = value; },
    setCurrent: (value: boolean) => { current = value; }, setCapture: (value: typeof capture) => { capture = value; },
    setPublish: (value: typeof publish) => { publish = value; }, setStopThrows: (value: boolean) => { stopThrows = value; },
    setUnpublishThrows: (value: boolean) => { unpublishThrows = value; } };
}
test('interactive connected SDK screen entitlement is required, including an explicit source list', () => {
  const input = { interactive: true, connected: true, secure: true, captureApi: true,
    permissions: { canPublish: true, canPublishSources: [] as number[] }, source: 3 };
  assert.equal(screenPublishingPermitted(input), true);
  assert.equal(screenPublishingPermitted({ ...input, permissions: { canPublish: true, canPublishSources: [3] } }), true);
  for (const change of [{ interactive: false }, { connected: false }, { secure: false }, { captureApi: false },
    { permissions: undefined }, { permissions: { canPublish: false, canPublishSources: [3] } },
    { permissions: { canPublish: true, canPublishSources: [1] } }, { permissions: { canPublish: true } }])
    assert.equal(screenPublishingPermitted({ ...input, ...change }), false);
});
test('Share invokes capture before returning and never starts until clicked', async () => {
  const f = fixture(); assert.equal(f.events.length, 0);
  const sharing = f.owner.start(); assert.deepEqual(f.events, ['capture']);
  assert.equal(f.owner.getSnapshot().status, 'choosing'); await sharing;
  assert.equal(f.owner.getSnapshot().status, 'sharing');
  const stopping = f.owner.stop(); assert.ok(f.events.includes('stop')); await stopping;
  assert.equal(f.owner.getSnapshot().status, 'idle'); assert.equal(f.publications.size, 0);
});
test('listener, revoked SDK entitlement, and retired owner never capture', async () => {
  const f = fixture(); f.setAllowed(false); await assert.rejects(f.owner.start());
  f.setAllowed(true); f.setCurrent(false); await assert.rejects(f.owner.start());
  f.setCurrent(true); await f.owner.retire(); await assert.rejects(f.owner.start());
  assert.equal(f.events.includes('capture'), false);
});
test('Stop drains a late chooser result and prevents publication', async () => {
  const f = fixture(), capture = deferred<ScreenTrack[]>(); f.setCapture(() => capture.promise);
  const starting = f.owner.start(); let drained = false;
  const stopped = f.owner.stop().then(() => { drained = true; });
  await Promise.resolve(); assert.equal(drained, false); capture.resolve([f.track]);
  await Promise.all([starting, stopped]); assert.equal(f.events.includes('publish'), false);
  assert.equal(f.media.readyState, 'ended'); assert.equal(f.owner.getSnapshot().status, 'idle');
});
test('auth or room lifetime loss rejects late capture without publication', async () => {
  const f = fixture(), capture = deferred<ScreenTrack[]>(); f.setCapture(() => capture.promise);
  const starting = f.owner.start(); f.setCurrent(false); capture.resolve([f.track]); await starting;
  assert.equal(f.events.includes('publish'), false); assert.equal(f.media.readyState, 'ended');
  assert.equal(f.owner.getSnapshot().available, false);
});
test('late publication after Stop is unpublished before the owner drains', async () => {
  const f = fixture(), publishing = deferred<void>();
  f.setPublish(async track => { f.events.push('publish'); await publishing.promise; f.publications.add(track); });
  const starting = f.owner.start(); await Promise.resolve(); await Promise.resolve();
  const stopped = f.owner.stop(); assert.equal(f.media.readyState, 'ended');
  publishing.resolve(); await Promise.all([starting, stopped]); assert.equal(f.publications.size, 0);
});
test('unexpected audio or multiple capture tracks are stopped and never published', async () => {
  const f = fixture(); const audio = { ...f.track, kind: 'audio' };
  f.setCapture(() => Promise.resolve([f.track, audio])); await assert.rejects(f.owner.start());
  assert.equal(f.events.includes('publish'), false); assert.equal(f.media.readyState, 'ended');
});
test('capture errors are sanitized and permit a fresh user retry', async () => {
  const f = fixture(); f.setCapture(() => Promise.reject(new Error('wss://secret')));
  await assert.rejects(f.owner.start()); assert.equal(f.owner.getSnapshot().status, 'idle');
  assert.ok(!f.owner.getSnapshot().error?.includes('secret')); f.setCapture(() => Promise.resolve([f.track]));
  await f.owner.start(); await f.owner.stop();
});
test('failed unpublish remains owned with visible retry and blocks a second capture', async () => {
  const f = fixture(); await f.owner.start(); f.setUnpublishThrows(true);
  await assert.rejects(f.owner.stop()); assert.equal(f.owner.getSnapshot().status, 'stopping');
  assert.match(f.owner.getSnapshot().error!, /Tap Stop sharing to retry/); assert.equal(f.publications.size, 1);
  await assert.rejects(f.owner.start()); assert.equal(f.events.filter(event => event === 'capture').length, 1);
  f.setUnpublishThrows(false); await f.owner.stop(); assert.equal(f.publications.size, 0);
});
test('throwing track stop remains reachable until an explicit retry succeeds', async () => {
  const f = fixture(); await f.owner.start(); f.setStopThrows(true); await assert.rejects(f.owner.stop());
  assert.equal(f.owner.getSnapshot().status, 'stopping'); f.setStopThrows(false); await f.owner.stop();
  assert.equal(f.media.readyState, 'ended'); assert.equal(f.owner.getSnapshot().status, 'idle');
});
test('permission revocation stops synchronously and reconnection does not restart capture', async () => {
  const f = fixture(); await f.owner.start(); f.setAllowed(false); f.owner.refresh();
  assert.equal(f.media.readyState, 'ended'); await f.owner.stop(); f.setAllowed(true); f.owner.refresh();
  assert.equal(f.owner.getSnapshot().status, 'idle'); assert.equal(f.events.filter(event => event === 'capture').length, 1);
});
test('OS track end and stale SDK republication are retired without a new capture', async () => {
  const f = fixture(); await f.owner.start(); f.media.dispatchEvent(new Event('ended')); await f.owner.stop();
  f.publications.add(f.track); f.owner.refresh(); await f.owner.stop();
  assert.equal(f.publications.size, 0); assert.equal(f.events.filter(event => event === 'capture').length, 1);
});
