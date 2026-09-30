import assert from 'node:assert/strict';
import { test } from 'node:test';
import { channelInviteMessage } from '../src/channel-invite-selection';

test('channel invite copy makes a host-only start explicit', () => {
  assert.equal(channelInviteMessage(0, 12), 'No members selected. Only you will be admitted.');
  assert.equal(channelInviteMessage(1, 12), '1 of 12 members selected. Deselect anyone you do not want to invite.');
  assert.equal(channelInviteMessage(12, 12), '12 of 12 members selected. Deselect anyone you do not want to invite.');
});
