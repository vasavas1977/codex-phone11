import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MeetingMediaLifecycle } from '../src/meeting-media-lifecycle';

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
