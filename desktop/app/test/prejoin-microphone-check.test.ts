import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PrejoinMicrophoneCheck } from '../src/prejoin-microphone-check';

function fixture() {
  const events: string[] = [];
  let frameCallback: FrameRequestCallback | null = null;
  const stream = {
    getTracks: () => [{ stop: () => events.push('track-stop') }],
  } as unknown as MediaStream;
  const context = {
    resume: async () => { events.push('resume'); },
    createAnalyser: () => ({
      fftSize: 0,
      getByteTimeDomainData(data: Uint8Array) { data.fill(160); events.push('sample'); },
    }),
    createMediaStreamSource: () => ({
      connect: () => { events.push('connect'); },
      disconnect: () => { events.push('disconnect'); },
    }),
    close: async () => { events.push('close'); },
  } as unknown as AudioContext;
  const check = new PrejoinMicrophoneCheck();
  const requestFrame = (callback: FrameRequestCallback) => { frameCallback = callback; return 17; };
  const cancelFrame = (handle: number) => { events.push(`cancel:${handle}`); };
  return { check, context, events, stream, requestFrame, cancelFrame, get frameCallback() { return frameCallback; } };
}

test('microphone level check reads locally and stops the capture track and audio context', async () => {
  const value = fixture();
  const levels: number[] = [];
  assert.equal(await value.check.start(async () => value.stream, () => value.context,
    value.requestFrame, value.cancelFrame, level => levels.push(level)), true);
  assert.ok(levels[0] > 0);
  assert.ok(value.frameCallback);
  value.check.stop(value.cancelFrame);
  await Promise.resolve();
  assert.ok(value.events.includes('track-stop'));
  assert.ok(value.events.includes('disconnect'));
  assert.ok(value.events.includes('close'));
  assert.ok(value.events.includes('cancel:17'));
});

test('canceling a pending microphone permission request stops its late stream without opening audio', async () => {
  const value = fixture();
  let resolveCapture!: (stream: MediaStream) => void;
  let contextsCreated = 0;
  const capture = new Promise<MediaStream>(resolve => { resolveCapture = resolve; });
  const pending = value.check.start(() => capture, () => { contextsCreated++; return value.context; },
    value.requestFrame, value.cancelFrame, () => assert.fail('canceled check must not update meter'));
  value.check.stop(value.cancelFrame);
  resolveCapture(value.stream);
  assert.equal(await pending, false);
  assert.equal(contextsCreated, 0);
  assert.deepEqual(value.events, ['track-stop']);
});
