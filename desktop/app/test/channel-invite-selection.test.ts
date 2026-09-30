import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  channelInviteMessage,
  channelInviteSelectionIsValid,
  MAX_CHANNEL_INVITEES,
} from '../src/channel-invite-selection';

test('channel invite copy makes a host-only start explicit', () => {
  assert.equal(channelInviteMessage(0, 12), 'No members selected. Only you will be admitted.');
  assert.equal(channelInviteMessage(1, 12), '1 of 12 members selected. Deselect anyone you do not want to invite.');
  assert.equal(channelInviteMessage(12, 12), '12 of 12 members selected. Deselect anyone you do not want to invite.');
});

test('channel invite selection enforces the server limit without hiding roster choices', () => {
  assert.equal(MAX_CHANNEL_INVITEES, 50);
  assert.equal(channelInviteSelectionIsValid(0), true);
  assert.equal(channelInviteSelectionIsValid(50), true);
  assert.equal(channelInviteSelectionIsValid(51), false);
  assert.equal(channelInviteSelectionIsValid(-1), false);
  assert.equal(channelInviteMessage(50, 60), '50 of 60 members selected. Deselect anyone you do not want to invite.');
  assert.equal(channelInviteMessage(51, 60), '51 selected. Select up to 50 members to start.');
});
