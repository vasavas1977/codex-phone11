import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MeetingVideoSlot, type AttachableVideo } from '../src/meeting-video-slot';

function fakeTrack() {
  let attaches = 0, detaches = 0, removes = 0;
  const element = { remove() { removes++; } } as HTMLVideoElement;
  const track: AttachableVideo = {
    attach() { attaches++; return element; },
    detach(received) { assert.equal(received, element); detaches++; },
  };
  return { track, stats: () => ({ attaches, detaches, removes }) };
}

test('camera changes never detach a separate shared screen', () => {
  const camera = new MeetingVideoSlot(), screen = new MeetingVideoSlot();
  const cameraTrack = fakeTrack(), screenTrack = fakeTrack();
  camera.update(cameraTrack.track, () => {});
  screen.update(screenTrack.track, () => {});
  camera.update(undefined, () => {});
  screen.update(screenTrack.track, () => {});
  assert.deepEqual(cameraTrack.stats(), { attaches: 1, detaches: 1, removes: 1 });
  assert.deepEqual(screenTrack.stats(), { attaches: 1, detaches: 0, removes: 0 });
  screen.clear();
  screen.clear();
  assert.deepEqual(screenTrack.stats(), { attaches: 1, detaches: 1, removes: 1 });
});

test('replaced video detaches old SDK reference before mounting the next', () => {
  const slot = new MeetingVideoSlot(), first = fakeTrack(), replacement = fakeTrack();
  slot.update(first.track, () => {});
  slot.update(replacement.track, () => {
    assert.deepEqual(first.stats(), { attaches: 1, detaches: 1, removes: 1 });
  });
  slot.clear();
  assert.deepEqual(replacement.stats(), { attaches: 1, detaches: 1, removes: 1 });
});
