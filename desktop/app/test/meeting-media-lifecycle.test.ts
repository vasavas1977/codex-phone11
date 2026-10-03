import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MeetingMediaLifecycle, PrejoinCameraPreview } from '../src/meeting-media-lifecycle';

test('teardown waits for pending microphone publication and prevents later camera publication', async () => {
  const lifecycle = new MeetingMediaLifecycle();
  let releaseMicrophone!: () => void;
  let startedMicrophone!: () => void;
  const microphoneStarted = new Promise<void>(resolve => { startedMicrophone = resolve; });
  const microphone = new Promise<void>(resolve => { releaseMicrophone = resolve; });
  const events: string[] = [];
  const joining = lifecycle.run(async current => {
    events.push('connect');
    if (!current()) return;
    events.push('microphone-start');
    startedMicrophone();
    await microphone;
    events.push('microphone-finished');
    if (!current()) return;
    events.push('camera-start');
  });
  await microphoneStarted;
  let drained = false;
  const closing = lifecycle.cancelAndDrain().then(() => { drained = true; events.push('drained'); });
  await Promise.resolve();
  assert.equal(drained, false);
  releaseMicrophone();
  await Promise.all([joining, closing]);
  assert.deepEqual(events, ['connect', 'microphone-start', 'microphone-finished', 'drained']);
  await assert.rejects(lifecycle.run(async () => events.push('late-operation')));
  assert.equal(events.includes('late-operation'), false);
});

test('canceling a pending camera prompt drains and stops a late stream before admission can continue', async () => {
  const lifecycle = new MeetingMediaLifecycle();
  const preview = new PrejoinCameraPreview();
  let resolveCamera!: (stream: MediaStream) => void;
  let started!: () => void;
  const cameraStarted = new Promise<void>(resolve => { started = resolve; });
  const camera = new Promise<MediaStream>(resolve => { resolveCamera = resolve; });
  let stops = 0;
  const stream = { getTracks: () => [{ stop: () => { stops++; } }] } as unknown as MediaStream;
  const events: string[] = [];
  const acquiring = lifecycle.run(async current => {
    const result = await preview.start(() => { started(); return camera; });
    if (current() && result) events.push('preview-visible');
  });
  await cameraStarted;
  const joining = lifecycle.run(async current => {
    await preview.stopAndDrain();
    if (current()) events.push('admission-requested');
  });
  const closing = lifecycle.cancelAndDrain();
  resolveCamera(stream);
  await Promise.all([acquiring, joining, closing]);
  assert.equal(stops, 1);
  assert.deepEqual(events, []);
});

test('active camera preview stops when switched off and a second preview can start', async () => {
  const preview = new PrejoinCameraPreview();
  let firstStops = 0;
  let secondStops = 0;
  const first = { getTracks: () => [{ stop: () => { firstStops++; } }] } as unknown as MediaStream;
  const second = { getTracks: () => [{ stop: () => { secondStops++; } }] } as unknown as MediaStream;
  assert.equal(await preview.start(async () => first), first);
  preview.stop();
  assert.equal(firstStops, 1);
  assert.equal(await preview.start(async () => second), second);
  await preview.stopAndDrain();
  assert.equal(secondStops, 1);
});

test('joining waits until a pending preview has released its camera track', async () => {
  const preview = new PrejoinCameraPreview();
  let resolveCamera!: (stream: MediaStream) => void;
  const camera = new Promise<MediaStream>(resolve => { resolveCamera = resolve; });
  const events: string[] = [];
  const stream = { getTracks: () => [{ stop: () => { events.push('camera-stopped'); } }] } as unknown as MediaStream;
  const pending = preview.start(() => camera);
  const joining = preview.stopAndDrain().then(() => { events.push('admission-requested'); });
  await Promise.resolve();
  assert.deepEqual(events, []);
  resolveCamera(stream);
  assert.equal(await pending, null);
  await joining;
  assert.deepEqual(events, ['camera-stopped', 'admission-requested']);
});
