import { ipcRenderer } from 'electron';
import { Room, RoomEvent, Track } from 'livekit-client';
import { MEETING_CHANNELS, type PublicMeetingState } from './meeting-channels';
import { MeetingMediaLifecycle } from './meeting-media-lifecycle';
import type { DesktopMeetingGrant } from '../../src/authenticated-provider';

// This isolated preload is the only Chromium world that receives a media grant.
// The static page has no script and no bridge exposing the token or Room.
let room: Room | null = null;
let revision: string | null = null;
let busy = false;
let canPublish = false;
const mediaLifecycle = new MeetingMediaLifecycle();
let leaving: Promise<void> | null = null;
const el = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const status = (message: string) => { el('status').textContent = message; };
const error = (message: string) => { el('prejoin-error').textContent = message; };

function updateRoomUi(): void {
  if (!room) return;
  const local = room.localParticipant;
  el('participant-count').textContent = `${room.remoteParticipants.size + 1} participant${room.remoteParticipants.size ? 's' : ''}`;
  const mic = el<HTMLButtonElement>('mic');
  const camera = el<HTMLButtonElement>('camera');
  el<HTMLButtonElement>('enable-audio').hidden = room.canPlaybackAudio;
  mic.disabled = !canPublish || busy;
  camera.disabled = !canPublish || busy;
  mic.textContent = local.isMicrophoneEnabled ? 'Mute' : 'Unmute';
  camera.textContent = local.isCameraEnabled ? 'Stop video' : 'Start video';
  el('media-note').textContent = canPublish
    ? `Microphone ${local.isMicrophoneEnabled ? 'on' : 'off'} · Camera ${local.isCameraEnabled ? 'on' : 'off'}`
    : 'Listening only';
  const self = document.getElementById('self-preview');
  if (!local.isCameraEnabled) self?.remove();
  else if (!self) {
    const track = local.getTrackPublication(Track.Source.Camera)?.track;
    if (track) {
      const video = track.attach();
      video.id = 'self-preview';
      el('empty-stage').hidden = true;
      el('stage').appendChild(video);
    }
  }
  el('empty-stage').hidden = !!el('stage').querySelector('video');
}

function attachRemote(track: { kind: Track.Kind; attach: () => HTMLElement }): void {
  const element = track.attach();
  if (track.kind === Track.Kind.Audio) el('remote-audio').appendChild(element);
  else if (track.kind === Track.Kind.Video) {
    el('empty-stage').hidden = true;
    el('stage').appendChild(element);
  }
}

function leave(): Promise<void> {
  if (leaving) return leaving;
  const active = room;
  room = null;
  canPublish = false;
  leaving = (async () => {
    // In-flight getUserMedia/publish must settle before disconnect and the main-process ack.
    await mediaLifecycle.cancelAndDrain();
    if (active) {
      try { await active.disconnect(true); } catch { /* Window teardown remains authoritative. */ }
    }
    busy = false;
    el('remote-audio').replaceChildren();
    el('stage').querySelectorAll('video').forEach(node => node.remove());
    el('empty-stage').hidden = false;
    el('room').hidden = true;
    el('prejoin').hidden = false;
  })();
  return leaving;
}

async function join(): Promise<void> {
  if (busy || room || !revision) return;
  const select = el<HTMLSelectElement>('meeting-select');
  const meetingId = select.value;
  if (!meetingId) return;
  busy = true;
  el<HTMLButtonElement>('join').disabled = true;
  error('');
  status('Joining…');
  await mediaLifecycle.run(async current => {
  let next: Room | null = null;
  try {
    if (!current()) return;
    const grant = await ipcRenderer.invoke(MEETING_CHANNELS.join, { meetingId, revision }) as DesktopMeetingGrant;
    if (!current()) return;
    if (!grant || typeof grant.url !== 'string' || typeof grant.token !== 'string' ||
        grant.expiresAt <= Math.floor(Date.now() / 1000)) throw new Error('Invalid admission');
    next = new Room({ adaptiveStream: true, dynacast: true });
    room = next;
    next.on(RoomEvent.TrackSubscribed, track => { if (room === next && current()) attachRemote(track); });
    next.on(RoomEvent.TrackUnsubscribed, track => { track.detach().forEach(element => element.remove()); });
    next.on(RoomEvent.ParticipantConnected, updateRoomUi);
    next.on(RoomEvent.ParticipantDisconnected, updateRoomUi);
    next.on(RoomEvent.Disconnected, () => {
      if (room === next) {
        status('Meeting disconnected');
        void leave().then(() => ipcRenderer.invoke(MEETING_CHANNELS.finished)).catch(() => undefined);
      }
    });
    await next.connect(grant.url, grant.token, { autoSubscribe: true });
    if (!current() || room !== next) return;
    canPublish = grant.grantProfile === 'interactive';
    // The Join click supplies the user gesture needed for Chromium audio playback.
    try { await next.startAudio(); }
    catch { if (current()) status('Connected. Tap Enable audio to hear participants.'); }
    if (!current() || room !== next) return;
    if (canPublish) {
      const wantsMic = el<HTMLInputElement>('start-mic').checked;
      const wantsCamera = el<HTMLInputElement>('start-camera').checked;
      try { if (wantsMic) await next.localParticipant.setMicrophoneEnabled(true); }
      catch { if (current()) status('Joined, but microphone access is unavailable.'); }
      if (!current() || room !== next) return;
      try { if (wantsCamera) await next.localParticipant.setCameraEnabled(true); }
      catch { if (current()) status('Joined, but camera access is unavailable.'); }
      if (!current() || room !== next) return;
    }
    el('prejoin').hidden = true;
    el('room').hidden = false;
    el('title').textContent = 'In meeting';
    if (el('status').textContent === 'Joining…') status('Connected');
    updateRoomUi();
  } catch {
    if (!current()) return;
    room = null;
    canPublish = false;
    if (next) {
      try { await next.disconnect(true); }
      catch {
        // A room whose media cleanup failed cannot be safely kept open for retry.
        void ipcRenderer.invoke(MEETING_CHANNELS.finished).catch(() => undefined);
        return;
      }
    }
    if (!current()) return;
    try { await ipcRenderer.invoke(MEETING_CHANNELS.joinFailed); } catch { /* The window may be closing. */ }
    if (!current()) return;
    error('Could not join this meeting. Check your connection and try again.');
    status('Could not join');
  } finally {
    busy = false;
    if (current()) {
      el<HTMLButtonElement>('join').disabled = false;
      updateRoomUi();
    }
  }
  }).catch(() => undefined);
}

async function toggle(kind: 'mic' | 'camera'): Promise<void> {
  const active = room;
  if (!active || !canPublish || busy) return;
  busy = true;
  updateRoomUi();
  await mediaLifecycle.run(async current => {
  try {
    if (kind === 'mic') await active.localParticipant.setMicrophoneEnabled(!active.localParticipant.isMicrophoneEnabled);
    else await active.localParticipant.setCameraEnabled(!active.localParticipant.isCameraEnabled);
    if (current() && room === active) status('Connected');
  } catch { if (current()) status(kind === 'mic' ? 'Microphone could not be changed' : 'Camera could not be changed'); }
  finally { busy = false; if (current()) updateRoomUi(); }
  }).catch(() => undefined);
}

async function load(): Promise<void> {
  el<HTMLButtonElement>('join').addEventListener('click', () => { void join(); });
  el<HTMLButtonElement>('mic').addEventListener('click', () => { void toggle('mic'); });
  el<HTMLButtonElement>('camera').addEventListener('click', () => { void toggle('camera'); });
  el<HTMLButtonElement>('leave').addEventListener('click', () => {
    void (async () => { await leave(); await ipcRenderer.invoke(MEETING_CHANNELS.finished); })();
  });
  el<HTMLButtonElement>('enable-audio').addEventListener('click', () => {
    const active = room;
    if (!active) return;
    void mediaLifecycle.run(async current => {
      try { await active.startAudio(); if (current() && room === active) { status('Connected'); updateRoomUi(); } }
      catch { if (current()) status('Audio output is unavailable. Check your system sound settings.'); }
    }).catch(() => undefined);
  });
  ipcRenderer.on(MEETING_CHANNELS.leaveNow, () => {
    void leave().finally(() => ipcRenderer.send(MEETING_CHANNELS.left));
  });
  try {
    const state = await ipcRenderer.invoke(MEETING_CHANNELS.state) as PublicMeetingState;
    revision = state.revision;
    const select = el<HTMLSelectElement>('meeting-select');
    select.replaceChildren();
    for (const id of state.meetingIds) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = id;
      select.appendChild(option);
    }
    if (!state.meetingIds.length) {
      const option = document.createElement('option');
      option.textContent = 'No admitted meetings';
      select.appendChild(option);
    }
    select.disabled = !state.meetingIds.length;
    el<HTMLButtonElement>('join').disabled = !state.meetingIds.length;
    status(state.meetingIds.length ? 'Ready to join' : 'No admitted meetings for this account');
  } catch {
    error('Meeting access could not be checked. Close this window and try again.');
    status('Meeting access unavailable');
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { void load(); });
else void load();
