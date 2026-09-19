import { playbackURL } from "./presentation";
interface Player {
  pause(): void;
  replace(
    source: null | { uri: string; headers: Record<string, string> },
  ): void;
}
/** No token in URLs or storage; revoke the source immediately on auth changes. */
export function beginPlaybackSession(options: {
  player: Player;
  base: string;
  callUuid: string;
  path: string;
  /** An allowlisted alternative route, used for a private voicemail item. */
  sourceURL?(base: string, path: string): string | null;
  canPlay?(): boolean;
  identity(): object | null;
  token(): Promise<string | null>;
  subscribe(listener: () => void): () => void;
  ready(value: boolean): void;
  failed(): void;
}) {
  let active = true;
  const identity = options.identity();
  const clear = () => {
    active = false;
    options.ready(false);
    try {
      options.player.pause();
    } catch {}
    try {
      options.player.replace(null);
    } catch {}
  };
  const unsubscribe = options.subscribe(clear);
  const done = (async () => {
    try {
      const token = await options.token();
      if (
        !active ||
        !identity ||
        options.identity() !== identity ||
        options.canPlay?.() === false
      )
        return;
      const uri = options.sourceURL
        ? options.sourceURL(options.base, options.path)
        : playbackURL(options.base, options.callUuid, options.path);
      if (!token || !uri) {
        options.failed();
        return;
      }
      options.player.replace({
        uri,
        headers: { Authorization: `Bearer ${token}` },
      });
      options.ready(true);
    } catch {
      if (active) options.failed();
    }
  })();
  return {
    done,
    dispose() {
      unsubscribe();
      clear();
    },
  };
}
