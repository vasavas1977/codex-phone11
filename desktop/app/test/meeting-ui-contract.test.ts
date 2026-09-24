import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

const source = resolve(process.cwd(), 'src');
const html = readFileSync(resolve(source, 'meeting.html'), 'utf8');
const css = readFileSync(resolve(source, 'meeting.css'), 'utf8');
const preload = readFileSync(resolve(source, 'meeting-preload.ts'), 'utf8');

test('active desktop meeting has accessible gallery, speaker, and participant controls', () => {
  assert.match(html, /id="layout-gallery"[^>]*aria-pressed="true"/);
  assert.match(html, /id="layout-speaker"[^>]*aria-pressed="false"/);
  assert.match(html, /id="participant-roster" aria-label="Participants"/);
  assert.match(html, /id="participant-list" aria-live="polite"/);
  assert.match(html, /id="speaker-main"/);
  assert.match(html, /id="speaker-strip"/);
  assert.match(css, /#gallery-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit/s);
  assert.match(css, /#speaker-view\s*\{[^}]*grid-template-columns:/s);
  assert.match(css, /#prejoin\[hidden\], #room\[hidden\], #gallery-grid\[hidden\], #speaker-view\[hidden\], #empty-stage\[hidden\]\s*\{\s*display:\s*none/s);
  assert.match(css, /\.tile-media\.has-video \.tile-placeholder\s*\{\s*display:\s*none/s);
});

test('participant roster and video tiles refresh for media and membership changes', () => {
  for (const event of [
    'TrackSubscribed', 'TrackUnsubscribed', 'TrackPublished', 'TrackUnpublished',
    'TrackMuted', 'TrackUnmuted', 'ParticipantConnected', 'ParticipantDisconnected',
    'ActiveSpeakersChanged', 'ParticipantNameChanged',
  ]) assert.ok(preload.includes(`RoomEvent.${event}`), `missing ${event} handler`);
  assert.match(preload, /participant\.isMicrophoneEnabled/);
  assert.match(preload, /participant\.isCameraEnabled/);
  assert.match(preload, /item\.name\.textContent\s*=/);
  assert.match(preload, /item\.rosterName\.textContent\s*=/);
  assert.match(preload, /aria-pressed/);
  assert.match(preload, /clearParticipantUi\(\)/);
  assert.doesNotMatch(preload, /\.innerHTML\s*=|insertAdjacentHTML\s*\(/);
});
