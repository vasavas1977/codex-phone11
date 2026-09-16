/** Serialize route setup and reject late work after pause, blur, sign-out, or a call. */
export function safePause(player: { pause(): void }) {
  try {
    player.pause();
    return true;
  } catch {
    // expo-audio releases the native shared object before React focus cleanup.
    return false;
  }
}

export function safeReplace(player: { replace(source: null): void }) {
  try {
    player.replace(null);
  } catch {
    // Clearing a released player is best effort during lifecycle cleanup.
  }
}

export function createPlaybackController<Route>(options: {
  player: {
    play(): void;
    pause(): void;
    seekTo(seconds: number): Promise<void>;
    volume: number;
    muted: boolean;
  };
  allowed(): boolean;
  configure(route: Route): Promise<boolean | void>;
  failed(): void;
}) {
  let alive = true;
  let generation = 0;
  let pending = false;
  let tail = Promise.resolve();
  const allowed = () => alive && options.allowed();
  return {
    play(route: Route, restart: boolean) {
      const request = ++generation;
      pending = true;
      tail = tail
        .then(async () => {
          if (!allowed() || request !== generation) return;
          try {
            const configured = await options.configure(route);
            if (configured === false || !allowed() || request !== generation)
              return;
            if (restart) await options.player.seekTo(0);
            if (!allowed() || request !== generation) return;
            options.player.volume = 1;
            options.player.muted = false;
            options.player.play();
          } catch {
            if (allowed() && request === generation) options.failed();
          }
        })
        .finally(() => {
          if (request === generation) pending = false;
        });
      return tail;
    },
    isPending() {
      return pending;
    },
    pause() {
      generation++;
      pending = false;
      if (!safePause(options.player) && alive) options.failed();
    },
    dispose() {
      alive = false;
      generation++;
      pending = false;
      safePause(options.player);
    },
  };
}
