import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VoicemailPlayer, type VoicemailPlayerState } from '../src/voicemail-player';

type Download = { sessionRevision: string; id: number; mimeType: 'audio/wav'; bytes: Uint8Array };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function download(revision: string, id: number): Download {
  return { sessionRevision: revision, id, mimeType: 'audio/wav', bytes: new Uint8Array([82, 73, 70, 70]) };
}

class FakeAudio {
  src = '';
  controls = true;
  paused = true;
  playErrorName: string | null = null;
  overrideCurrentSrc: string | null = null;
  pauses = 0;
  loads = 0;
  private listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  get currentSrc(): string { return this.overrideCurrentSrc ?? this.src; }
  listenerCount(name: string): number { return this.listeners.get(name)?.size ?? 0; }
  addEventListener(name: string, listener: EventListenerOrEventListenerObject): void {
    const listeners = this.listeners.get(name) ?? new Set();
    listeners.add(listener);
    this.listeners.set(name, listeners);
  }
  removeEventListener(name: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.get(name)?.delete(listener);
  }
  emit(name: string): void {
    const event = new Event(name);
    for (const listener of this.listeners.get(name) ?? []) {
      if (typeof listener === 'function') listener(event);
      else listener.handleEvent(event);
    }
  }
  pause(): void { this.paused = true; this.pauses++; }
  load(): void { this.loads++; }
  removeAttribute(name: string): void { if (name === 'src') this.src = ''; }
  async play(): Promise<void> {
    if (this.playErrorName) {
      const error = new Error('media playback failed');
      error.name = this.playErrorName;
      throw error;
    }
    this.paused = false;
  }
}

async function withUrls(work: (created: string[], revoked: string[]) => Promise<void>): Promise<void> {
  const create = URL.createObjectURL;
  const revoke = URL.revokeObjectURL;
  const created: string[] = [];
  const revoked: string[] = [];
  URL.createObjectURL = (_blob: Blob) => {
    const url = `blob:test/${created.length + 1}`;
    created.push(url);
    return url;
  };
  URL.revokeObjectURL = (url: string) => { revoked.push(url); };
  try { await work(created, revoked); }
  finally {
    URL.createObjectURL = create;
    URL.revokeObjectURL = revoke;
  }
}

test('switching source pauses and revokes the old blob; stop and dispose release the last one', async () => {
  await withUrls(async (created, revoked) => {
    const audio = new FakeAudio();
    const states: VoicemailPlayerState[] = [];
    const player = new VoicemailPlayer({
      audio: audio as unknown as HTMLAudioElement,
      fetchAudio: async (revision, id) => download(revision, id),
      markRead: async () => undefined,
      onState: state => states.push(state),
    });
    await player.play('r1', 1);
    assert.equal(audio.src, 'blob:test/1');
    await player.play('r1', 2);
    assert.equal(audio.src, 'blob:test/2');
    assert.deepEqual(revoked, ['blob:test/1']);
    assert.equal(player.state.id, 2);
    player.stop();
    assert.deepEqual(revoked, created);
    assert.equal(audio.src, '');
    assert.equal(player.state.id, null);
    assert.equal(audio.controls, true);
    player.dispose();
    await player.play('r1', 3);
    assert.deepEqual(revoked, created);
    assert.ok(audio.pauses >= 3);
    assert.ok(states.length >= 4);
  });
});

test('stopping a pending download prevents late blob publication and state updates', async () => {
  await withUrls(async created => {
    const audio = new FakeAudio();
    const pending = deferred<Download>();
    const player = new VoicemailPlayer({
      audio: audio as unknown as HTMLAudioElement,
      fetchAudio: () => pending.promise,
      markRead: async () => undefined,
      onState: () => undefined,
    });
    const playing = player.play('r1', 1);
    assert.equal(player.state.loading, true);
    player.stop();
    pending.resolve(download('r1', 1));
    await playing;
    assert.deepEqual(created, []);
    assert.deepEqual(player.state, { id: null, loading: false, error: null });
  });
});

test('wrong revision, mime and oversized audio are rejected before a blob is created', async () => {
  await withUrls(async created => {
    const audio = new FakeAudio();
    let response: Download = download('wrong', 7);
    const player = new VoicemailPlayer({
      audio: audio as unknown as HTMLAudioElement,
      fetchAudio: async () => response,
      markRead: async () => undefined,
      onState: () => undefined,
    });
    await player.play('r1', 7);
    assert.match(player.state.error ?? '', /Could not load/);
    response = { ...download('r1', 7), mimeType: 'audio/mp3' as 'audio/wav' };
    await player.play('r1', 7);
    assert.match(player.state.error ?? '', /Could not load/);
    response = { ...download('r1', 7), bytes: new Uint8Array(20 * 1024 * 1024 + 1) };
    await player.play('r1', 7);
    assert.match(player.state.error ?? '', /Could not load/);
    response = { ...download('r1', 7), url: 'https://untrusted.example' } as Download;
    await player.play('r1', 7);
    assert.match(player.state.error ?? '', /Could not load/);
    assert.deepEqual(created, []);
  });
});

test('autoplay rejection leaves local controls available and does not mark read', async () => {
  await withUrls(async (created, revoked) => {
    const audio = new FakeAudio();
    audio.playErrorName = 'NotAllowedError';
    let reads = 0;
    const player = new VoicemailPlayer({
      audio: audio as unknown as HTMLAudioElement,
      fetchAudio: async () => download('r1', 9),
      markRead: async () => { reads++; },
      onState: () => undefined,
    });
    await player.play('r1', 9);
    assert.equal(player.state.error, 'Press play to listen.');
    assert.equal(player.state.loading, false);
    assert.equal(audio.controls, true);
    audio.emit('playing');
    await Promise.resolve();
    assert.equal(reads, 0);
    assert.equal(player.state.error, 'Press play to listen.');
    audio.playErrorName = null;
    await audio.play();
    assert.equal(player.state.error, 'Press play to listen.');
    audio.emit('playing');
    assert.equal(player.state.error, null);
    await Promise.resolve();
    assert.equal(reads, 1);
    player.stop();
    assert.deepEqual(revoked, created);
  });
});

test('playing from an old source cannot clear current autoplay guidance or mark a different revision read', async () => {
  await withUrls(async () => {
    const audio = new FakeAudio();
    audio.playErrorName = 'NotAllowedError';
    const reads: [string, number][] = [];
    const player = new VoicemailPlayer({
      audio: audio as unknown as HTMLAudioElement,
      fetchAudio: async (revision, id) => download(revision, id),
      markRead: async (revision, id) => { reads.push([revision, id]); },
      onState: () => undefined,
    });
    await player.play('old-account', 1);
    const oldSource = audio.src;
    await player.play('current-account', 2);
    audio.paused = false;
    audio.overrideCurrentSrc = oldSource;
    audio.emit('playing');
    await Promise.resolve();
    assert.equal(player.state.error, 'Press play to listen.');
    assert.deepEqual(reads, []);
    audio.overrideCurrentSrc = null;
    audio.emit('playing');
    await Promise.resolve();
    assert.equal(player.state.error, null);
    assert.deepEqual(reads, [['current-account', 2]]);
  });
});

test('teardown during the cleared-guidance state callback prevents queued mark-read work', async () => {
  await withUrls(async () => {
    const audio = new FakeAudio();
    audio.playErrorName = 'NotAllowedError';
    let reads = 0;
    const player = new VoicemailPlayer({
      audio: audio as unknown as HTMLAudioElement,
      fetchAudio: async (revision, id) => download(revision, id),
      markRead: async () => { reads++; },
      onState: state => {
        if (state.id === 1 && !state.loading && state.error === null) player.stop();
      },
    });
    await player.play('r1', 1);
    audio.playErrorName = null;
    await audio.play();
    audio.emit('playing');
    await Promise.resolve();
    assert.equal(reads, 0);
    assert.deepEqual(player.state, { id: null, loading: false, error: null });
  });
});

test('decode rejection and current-source media error show playback retry instead of autoplay guidance', async () => {
  await withUrls(async () => {
    const audio = new FakeAudio();
    audio.playErrorName = 'NotSupportedError';
    const player = new VoicemailPlayer({
      audio: audio as unknown as HTMLAudioElement,
      fetchAudio: async (revision, id) => download(revision, id),
      markRead: async () => undefined,
      onState: () => undefined,
    });
    await player.play('r1', 1);
    assert.equal(player.state.error, 'This voicemail could not be played. Try again.');
    audio.playErrorName = null;
    await player.play('r1', 2);
    assert.equal(player.state.error, null);
    audio.emit('error');
    assert.equal(player.state.error, 'This voicemail could not be played. Try again.');
    assert.equal(player.state.loading, false);
    audio.emit('playing');
    assert.equal(player.state.error, 'This voicemail could not be played. Try again.');
  });
});

test('stale media error is ignored and dispose removes the media listeners', async () => {
  await withUrls(async () => {
    const audio = new FakeAudio();
    const player = new VoicemailPlayer({
      audio: audio as unknown as HTMLAudioElement,
      fetchAudio: async (revision, id) => download(revision, id),
      markRead: async () => undefined,
      onState: () => undefined,
    });
    await player.play('r1', 1);
    const oldSource = audio.src;
    await player.play('r1', 2);
    audio.overrideCurrentSrc = oldSource;
    audio.emit('error');
    assert.equal(player.state.error, null);
    audio.overrideCurrentSrc = null;
    player.dispose();
    assert.equal(audio.listenerCount('error'), 0);
    assert.equal(audio.listenerCount('playing'), 0);
    audio.emit('error');
    assert.equal(player.state.id, null);
  });
});

test('mark read only once on actual playing; late failure cannot overwrite another item', async () => {
  await withUrls(async () => {
    const audio = new FakeAudio();
    const pending = deferred<unknown>();
    const calls: Array<[string, number]> = [];
    const player = new VoicemailPlayer({
      audio: audio as unknown as HTMLAudioElement,
      fetchAudio: async (revision, id) => download(revision, id),
      markRead: (revision, id) => { calls.push([revision, id]); return id === 1 ? pending.promise : Promise.resolve(); },
      onState: () => undefined,
    });
    await player.play('r1', 1);
    assert.deepEqual(calls, []);
    audio.emit('playing');
    audio.emit('playing');
    await Promise.resolve();
    assert.deepEqual(calls, [['r1', 1]]);
    await player.play('r2', 2);
    pending.reject(new Error('offline'));
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(player.state, { id: 2, loading: false, error: null });
    audio.emit('playing');
    await Promise.resolve();
    assert.deepEqual(calls, [['r1', 1], ['r2', 2]]);
  });
});

test('current mark-read failure reports a friendly error without stopping playback', async () => {
  await withUrls(async () => {
    const audio = new FakeAudio();
    const player = new VoicemailPlayer({
      audio: audio as unknown as HTMLAudioElement,
      fetchAudio: async () => download('r1', 1),
      markRead: async () => { throw new Error('backend detail'); },
      onState: () => undefined,
    });
    await player.play('r1', 1);
    audio.emit('playing');
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.match(player.state.error ?? '', /could not mark this voicemail as read/i);
    assert.equal(audio.paused, false);
    assert.equal(audio.src, 'blob:test/1');
  });
});
