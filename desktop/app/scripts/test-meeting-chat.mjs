import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'src/meeting-preload.ts');
const require = createRequire(import.meta.url);
const temporary = await mkdtemp(resolve(tmpdir(), 'phone11-chat-qa-'));
const ipcImport = "import { ipcRenderer } from 'electron';";
const sdkImport = "import { Participant, Room, RoomEvent, Track, supportsAudioOutputSelection } from 'livekit-client';";
const fixture = `
import { ipcRenderer as realIpc } from 'electron';
import { ConnectionState, DataPacket_Kind, Participant, RoomEvent, Track } from 'livekit-client';
import { ROOM_CHAT_TOPIC, encodeRoomChatMessage } from '../../../lib/meetings/room-chat-message';
let qaRoom;
let qaPhotoScope;
const ipcRenderer = {
  on: (...args) => realIpc.on(...args), send: (...args) => realIpc.send(...args),
  invoke: async (...args) => { const result = await realIpc.invoke(...args);
    if (args[0] === 'phone11:meeting-join') qaPhotoScope = result.photoScope;
    return result; }
};
const supportsAudioOutputSelection = () => false;
class Room {
  handlers = new Map(); state = ConnectionState.Disconnected; canPlaybackAudio = true;
  localParticipant = { identity: 'p11-t9-u7', sid: 'qa-local-sid', isLocal: true, name: 'Local',
    permissions: { canPublishData: true, canSubscribe: true }, trackPublications: new Map(),
    audioTrackPublications: new Map(), videoTrackPublications: new Map(), isSpeaking: false,
    isMicrophoneEnabled: false, isCameraEnabled: false, getTrackPublication: () => undefined,
    publishData: async (payload, options) => { realIpc.send('phone11:chat-qa-published', { text: new TextDecoder().decode(payload), options }); }
  };
  peer = { identity: 'p11-t9-u8', sid: 'qa-remote-sid', name: 'SDK sender', isLocal: false,
    trackPublications: new Map(), audioTrackPublications: new Map(), videoTrackPublications: new Map(),
    getTrackPublication: () => undefined };
  remoteParticipants = new Map([[this.peer.identity, this.peer]]);
  constructor() { qaRoom = this; }
  on(event, callback) { const list = this.handlers.get(event) ?? []; list.push(callback); this.handlers.set(event, list); return this; }
  off(event, callback) { this.handlers.set(event, (this.handlers.get(event) ?? []).filter(item => item !== callback)); return this; }
  emit(event, ...args) { for (const callback of [...(this.handlers.get(event) ?? [])]) callback(...args); }
  async connect() { this.state = ConnectionState.Connected; }
  async startAudio() {}
  async disconnect() { this.state = ConnectionState.Disconnected; this.emit(RoomEvent.Disconnected); }
}
realIpc.on('phone11:chat-qa-command', (_event, command) => {
  if (command === 'probe-photo') void Promise.all([
    { revision: 'synthetic-chat-test', roomRevision: 'stale-room', localIdentity: 'p11-t9-u7', identity: 'p11-t9-u8' },
    { revision: 'synthetic-chat-test', roomRevision: qaPhotoScope.roomRevision, localIdentity: 'p11-t9-u7', identity: 'p11-t9-u8', url: 'https://evil.example/photo' },
    { revision: 'old-session', roomRevision: qaPhotoScope.roomRevision, localIdentity: 'p11-t9-u7', identity: 'p11-t9-u8' },
  ].map(input => realIpc.invoke('phone11:meeting-profile-photo', input)))
    .then(results => realIpc.send('phone11:chat-qa-probes', results));
  if (command === 'late-photo') {
    const peer = { ...qaRoom.peer, identity: 'p11-t9-u10', name: 'Late sender' };
    qaRoom.remoteParticipants.set(peer.identity, peer);
    qaRoom.emit(RoomEvent.DataReceived, encodeRoomChatMessage('52345678-1234-4234-8234-123456789012', 'Late image'), peer, DataPacket_Kind.RELIABLE, ROOM_CHAT_TOPIC);
  }
  if (command === 'receive') qaRoom.emit(RoomEvent.DataReceived,
    encodeRoomChatMessage('22345678-1234-4234-8234-123456789012', '<img src=x onerror=alert(1)> สวัสดี'),
    qaRoom.peer, DataPacket_Kind.RELIABLE, ROOM_CHAT_TOPIC);
  if (command === 'unknown-photo' || command === 'broken-photo') {
    const peer = { ...qaRoom.peer, identity: command === 'unknown-photo' ? 'provider-opaque-identity' : 'p11-t9-u9', name: 'Fallback sender' };
    qaRoom.remoteParticipants.set(peer.identity, peer);
    qaRoom.emit(RoomEvent.DataReceived, encodeRoomChatMessage(command === 'unknown-photo'
      ? '32345678-1234-4234-8234-123456789012' : '42345678-1234-4234-8234-123456789012', 'Fallback message'),
      peer, DataPacket_Kind.RELIABLE, ROOM_CHAT_TOPIC);
  }
  if (command === 'revoke') {
    qaRoom.localParticipant.permissions.canPublishData = false;
    qaRoom.emit(RoomEvent.ParticipantPermissionsChanged, undefined, qaRoom.localParticipant);
  }
  if (command === 'leave') realIpc.emit('phone11:meeting-leave-now');
});
`;

try {
  await copyFile(resolve(root, 'src/meeting.html'), resolve(temporary, 'meeting.html'));
  await copyFile(resolve(root, 'src/meeting.css'), resolve(temporary, 'meeting.css'));
  await build({ entryPoints: [resolve(root, 'src/meeting-window.ts')], outfile: resolve(temporary, 'meeting-window.cjs'),
    bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
  await build({ entryPoints: [source], outfile: resolve(temporary, 'meeting-preload.cjs'), bundle: true,
    platform: 'browser', target: 'chrome128', format: 'cjs', external: ['electron'],
    plugins: [{ name: 'network-free-chat-fixture', setup(plugin) {
      plugin.onLoad({ filter: /meeting-preload\.ts$/ }, async () => {
        const original = await readFile(source, 'utf8');
        if (original.split(ipcImport).length !== 2 || original.split(sdkImport).length !== 2)
          throw new Error('Meeting preload imports changed; update chat fixture deliberately');
        return { contents: original.replace(ipcImport, fixture).replace(sdkImport, ''), loader: 'ts', resolveDir: dirname(source) };
      });
    } }],
  });
  const child = spawn(require('electron'), [resolve(root, 'test/fixtures/meeting-chat-browser.cjs')], {
    cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined,
      PHONE11_CHAT_QA_HTML: resolve(temporary, 'meeting.html'),
      PHONE11_CHAT_QA_WINDOW: resolve(temporary, 'meeting-window.cjs'),
      PHONE11_CHAT_QA_PRELOAD: resolve(temporary, 'meeting-preload.cjs'),
      PHONE11_CHAT_QA_USER_DATA: resolve(temporary, 'user-data') }, stdio: 'inherit',
  });
  const code = await new Promise((done, fail) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); fail(new Error('Chat browser test timed out')); }, 20_000);
    child.once('error', error => { clearTimeout(timer); fail(error); });
    child.once('exit', code => { clearTimeout(timer); done(code); });
  });
  if (code !== 0) throw new Error(`Chat browser test exited with ${code}`);
} finally { await rm(temporary, { recursive: true, force: true }); }
