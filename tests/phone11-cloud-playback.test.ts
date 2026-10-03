import { expect, it, vi } from "vitest";
import { beginPlaybackSession } from "../lib/cloud-recordings/playback-session";
function fixture() {
  let identity: object | null = { id: 1 };
  let listener = () => {};
  const player = { pause: vi.fn(), replace: vi.fn() };
  const ready = vi.fn();
  const failed = vi.fn();
  const options = {
    player,
    base: "https://api.phone11.ai",
    callUuid: "11111111-1111-4111-8111-111111111111",
    path: "/api/recordings/play/11111111-1111-4111-8111-111111111111",
    identity: () => identity,
    token: async () => "private-token",
    subscribe: (next: () => void) => {
      listener = next;
      return vi.fn();
    },
    ready,
    failed,
  };
  return {
    options,
    player,
    ready,
    failed,
    change() {
      identity = { id: 2 };
      listener();
    },
  };
}
it("authenticates stream through headers and removes source immediately on account change", async () => {
  const f = fixture();
  const s = beginPlaybackSession(f.options);
  await s.done;
  expect(f.player.replace).toHaveBeenCalledWith({
    uri: `${f.options.base}${f.options.path}`,
    headers: { Authorization: "Bearer private-token" },
  });
  f.change();
  expect(f.player.pause).toHaveBeenCalled();
  expect(f.player.replace).toHaveBeenLastCalledWith(null);
  expect(f.ready).toHaveBeenLastCalledWith(false);
});
it("drops a token response arriving after logout or account change", async () => {
  const f = fixture();
  let resolve!: (v: string) => void;
  f.options.token = () =>
    new Promise((r) => {
      resolve = r;
    });
  const s = beginPlaybackSession(f.options);
  f.change();
  resolve("old-token");
  await s.done;
  expect(f.player.replace).toHaveBeenCalledTimes(1);
  expect(f.player.replace).toHaveBeenLastCalledWith(null);
  expect(f.ready).not.toHaveBeenCalledWith(true);
});
it("unmount removes playback and rejects late async result", async () => {
  const f = fixture();
  let resolve!: (v: string) => void;
  f.options.token = () =>
    new Promise((r) => {
      resolve = r;
    });
  const s = beginPlaybackSession(f.options);
  s.dispose();
  resolve("old-token");
  await s.done;
  expect(f.player.replace).toHaveBeenCalledTimes(1);
  expect(f.ready).not.toHaveBeenCalledWith(true);
});
it("refuses foreign source and never exposes bearer to it", async () => {
  const f = fixture();
  f.options.path = "https://other.example/file";
  await beginPlaybackSession(f.options).done;
  expect(f.failed).toHaveBeenCalled();
  expect(f.player.replace).not.toHaveBeenCalled();
});

it("does not attach a stream when a Phone11 call begins during token loading", async () => {
  const f = fixture();
  await beginPlaybackSession({ ...f.options, canPlay: () => false }).done;
  expect(f.player.replace).not.toHaveBeenCalled();
  expect(f.ready).not.toHaveBeenCalledWith(true);
});
