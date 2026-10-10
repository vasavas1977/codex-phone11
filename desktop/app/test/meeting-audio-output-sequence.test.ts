import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MeetingAudioOutputSequence } from '../src/meeting-audio-output-sequence';

test('headset changes wait for an in-flight speaker switch before enumerating again', () => {
  const sequence = new MeetingAudioOutputSequence();
  const enumeration = sequence.beginRefresh();
  assert.notEqual(enumeration, null);
  const switchRevision = sequence.beginSwitch();
  assert.notEqual(switchRevision, null);
  assert.equal(sequence.isCurrent(enumeration!), false);

  // Two devicechange events and a second user selection cannot race the first switch.
  assert.equal(sequence.beginRefresh(), null);
  assert.equal(sequence.beginRefresh(), null);
  assert.equal(sequence.beginSwitch(), null);
  assert.equal(sequence.finishSwitch(), true);

  const finalEnumeration = sequence.beginRefresh();
  assert.notEqual(finalEnumeration, null);
  assert.equal(sequence.isCurrent(finalEnumeration!), true);
  assert.equal(sequence.finishSwitch(), false);
});

test('meeting teardown invalidates device enumeration and drops pending refresh', () => {
  const sequence = new MeetingAudioOutputSequence();
  const switchRevision = sequence.beginSwitch();
  assert.notEqual(switchRevision, null);
  assert.equal(sequence.beginRefresh(), null);
  sequence.reset();
  assert.equal(sequence.isCurrent(switchRevision!), false);
  assert.equal(sequence.finishSwitch(), false);
});
