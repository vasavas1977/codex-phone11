/** Serialize route changes and reject late work after blur, sign-out, or a call. */
export function createPlaybackController<Route = boolean>(options: {
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
  let tail = Promise.resolve();
  const allowed = () => alive && options.allowed();
  return {
    play(route: Route, restart: boolean) {
      const request = ++generation;
      tail = tail.then(async () => {
        if (!allowed() || request !== generation) return;
        try {
          const configured = await options.configure(route);
          if (configured === false) return;
          if (!allowed() || request !== generation) return;
          if (restart) await options.player.seekTo(0);
          if (!allowed() || request !== generation) return;
          options.player.volume = 1;
          options.player.muted = false;
          options.player.play();
        } catch {
          if (allowed() && request === generation) options.failed();
        }
      });
      return tail;
    },
    pause() {
      generation++;
      options.player.pause();
    },
    dispose() {
      alive = false;
      generation++;
      options.player.pause();
    },
  };
}
