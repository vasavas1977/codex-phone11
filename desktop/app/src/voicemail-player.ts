export type VoicemailPlayerState = {
  id: number | null;
  loading: boolean;
  error: string | null;
};

type AudioDownload = {
  sessionRevision: string;
  id: number;
  mimeType: 'audio/wav';
  bytes: Uint8Array;
};

type VoicemailPlayerOptions = {
  audio: HTMLAudioElement;
  fetchAudio: (revision: string, id: number) => Promise<AudioDownload>;
  markRead: (revision: string, id: number) => Promise<unknown>;
  onState: (state: VoicemailPlayerState) => void;
};

const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const LOAD_ERROR = 'Could not load voicemail. Try again.';
const PLAYBACK_ERROR = 'This voicemail could not be played. Try again.';
const AUTOPLAY_GUIDANCE = 'Press play to listen.';

/** Owns one local voicemail blob; callers stop it on account or route changes. */
export class VoicemailPlayer {
  private readonly audio: HTMLAudioElement;
  private readonly fetchAudio: VoicemailPlayerOptions['fetchAudio'];
  private readonly markRead: VoicemailPlayerOptions['markRead'];
  private readonly onState: VoicemailPlayerOptions['onState'];
  private currentState: VoicemailPlayerState = { id: null, loading: false, error: null };
  private epoch = 0;
  private disposed = false;
  private sourceUrl: string | null = null;
  private sourceRevision: string | null = null;
  private readMarked = false;

  constructor({ audio, fetchAudio, markRead, onState }: VoicemailPlayerOptions) {
    this.audio = audio;
    this.fetchAudio = fetchAudio;
    this.markRead = markRead;
    this.onState = onState;
    this.audio.addEventListener('playing', this.onPlaying);
    this.audio.addEventListener('error', this.onError);
  }

  get state(): VoicemailPlayerState {
    return { ...this.currentState };
  }

  async play(revision: string, id: number): Promise<void> {
    if (this.disposed) return;
    this.stop();
    const epoch = this.epoch;
    if (!revision || !Number.isSafeInteger(id) || id <= 0) {
      this.publish({ id: null, loading: false, error: LOAD_ERROR });
      return;
    }
    this.publish({ id, loading: true, error: null });

    let response: AudioDownload;
    try {
      response = await this.fetchAudio(revision, id);
    } catch {
      if (this.current(epoch)) this.publish({ id, loading: false, error: LOAD_ERROR });
      return;
    }
    if (!this.current(epoch)) return;
    if (!response || Object.keys(response).sort().join(',') !== 'bytes,id,mimeType,sessionRevision' ||
        response.sessionRevision !== revision || response.id !== id ||
        response.mimeType !== 'audio/wav' || !(response.bytes instanceof Uint8Array) ||
        response.bytes.byteLength === 0 || response.bytes.byteLength > MAX_AUDIO_BYTES) {
      this.publish({ id, loading: false, error: LOAD_ERROR });
      return;
    }

    try {
      // Copy before creating the Blob so a reused IPC buffer cannot change its bytes.
      const bytes = Uint8Array.from(response.bytes);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
      if (!this.current(epoch)) {
        URL.revokeObjectURL(url);
        return;
      }
      this.sourceUrl = url;
      this.sourceRevision = revision;
      this.readMarked = false;
      this.audio.src = url;
      this.audio.load();
      await this.audio.play();
      if (this.current(epoch)) this.publish({ id, loading: false, error: this.currentState.error });
    } catch (error) {
      if (this.current(epoch)) {
        const permissionDenied = error instanceof Error && error.name === 'NotAllowedError';
        this.publish({ id, loading: false,
          error: this.currentState.error === PLAYBACK_ERROR ? PLAYBACK_ERROR :
            permissionDenied ? AUTOPLAY_GUIDANCE : PLAYBACK_ERROR });
      }
    }
  }

  stop(): void {
    this.epoch += 1;
    this.releaseSource();
    this.publish({ id: null, loading: false, error: null });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.audio.removeEventListener('playing', this.onPlaying);
    this.audio.removeEventListener('error', this.onError);
  }

  private current(epoch: number): boolean {
    return !this.disposed && this.epoch === epoch;
  }

  private publish(state: VoicemailPlayerState): void {
    this.currentState = state;
    this.onState({ ...state });
  }

  private releaseSource(): void {
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    if (this.sourceUrl) URL.revokeObjectURL(this.sourceUrl);
    this.sourceUrl = null;
    this.sourceRevision = null;
    this.readMarked = false;
  }

  private readonly onPlaying = (): void => {
    const id = this.currentState.id;
    const revision = this.sourceRevision;
    const url = this.sourceUrl;
    if (this.disposed || this.readMarked || id === null || revision === null || url === null ||
        this.audio.paused || this.audio.currentSrc !== url) return;
    this.readMarked = true;
    const epoch = this.epoch;
    if (this.currentState.error === AUTOPLAY_GUIDANCE) {
      this.publish({ id, loading: false, error: null });
    }
    void Promise.resolve().then(() => {
      // Publishing feedback can synchronously stop or replace this media session.
      if (this.current(epoch) && this.currentState.id === id &&
          this.sourceUrl === url && this.sourceRevision === revision) return this.markRead(revision, id);
    }).catch(() => {
      if (this.current(epoch) && this.currentState.id === id && this.sourceUrl === url) {
        this.publish({ id, loading: false,
          error: this.currentState.error === PLAYBACK_ERROR ? PLAYBACK_ERROR :
            'Playback started, but could not mark this voicemail as read.' });
      }
    });
  };

  private readonly onError = (): void => {
    const id = this.currentState.id;
    if (this.disposed || id === null || this.sourceUrl === null ||
        this.audio.currentSrc !== this.sourceUrl) return;
    this.publish({ id, loading: false, error: PLAYBACK_ERROR });
  };
}
