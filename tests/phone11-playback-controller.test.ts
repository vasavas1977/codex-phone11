import { beforeEach, expect, it, vi } from "vitest";
import { createPlaybackController } from "../lib/cloud-recordings/playback-controller";

function setup() {
  let allowed = true;
  const player = {
    play: vi.fn(),
    pause: vi.fn(),
    seekTo: vi.fn(async (_seconds: number) => {}),
    volume: 0.2,
    muted: true,
  };
  const configure = vi.fn(async (_route: "earpiece" | "speaker") => true);
  const failed = vi.fn();
  return {
    player,
    configure,
    failed,
    deny: () => {
      allowed = false;
    },
    controller: createPlaybackController<"earpiece" | "speaker">({
      player,
      configure,
      failed,
      allowed: () => allowed,
    }),
  };
}

beforeEach(() => vi.clearAllMocks());

it("restores audible volume and replays a completed recording from zero", async () => {
  const playback = setup();
  await playback.controller.play("speaker", true);
  expect(playback.configure).toHaveBeenCalledWith("speaker");
  expect(playback.player.seekTo).toHaveBeenCalledWith(0);
  expect(playback.player.volume).toBe(1);
  expect(playback.player.muted).toBe(false);
  expect(playback.player.play).toHaveBeenCalledOnce();
});

it.each(["call", "blur", "pause"] as const)(
  "a %s during asynchronous route setup cannot restart audio",
  async (reason) => {
    const playback = setup();
    let finish!: () => void;
    playback.configure.mockImplementation(
      () =>
        new Promise<true>((resolve) => {
          finish = () => resolve(true);
        }),
    );
    const done = playback.controller.play("earpiece", false);
    await Promise.resolve();
    expect(playback.controller.isPending()).toBe(true);
    if (reason === "call") playback.deny();
    else if (reason === "blur") playback.controller.dispose();
    else playback.controller.pause();
    finish();
    await done;
    expect(playback.player.play).not.toHaveBeenCalled();
    expect(playback.controller.isPending()).toBe(false);
  },
);

it("does not play when the platform route adapter refuses the change", async () => {
  const playback = setup();
  playback.configure.mockResolvedValue(false);
  await playback.controller.play("speaker", false);
  expect(playback.player.play).not.toHaveBeenCalled();
  expect(playback.failed).not.toHaveBeenCalled();
});
