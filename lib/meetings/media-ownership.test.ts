import { describe, expect, it } from "vitest";
import { MediaOwnershipCoordinator } from "./media-ownership";

describe("voice-note media ownership", () => {
  it("blocks a voice note while SIP owns media and stops it before SIP activates", async () => {
    const media = new MediaOwnershipCoordinator();
    let stopped = false;
    let unblock!: () => void;
    const gate = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const voice = media.requestVoiceNote("voice:1", {
      stopForSip: async () => {
        stopped = true;
        await gate;
      },
    });
    await voice.ready;
    const sip = media.requestSip("sip:1");
    expect(stopped).toBe(false);
    expect(media.isCurrent(voice.lease)).toBe(false);
    expect(() =>
      media.requestVoiceNote("voice:2", { stopForSip: async () => {} }),
    ).toThrow("busy");
    unblock();
    await sip.ready;
    expect(stopped).toBe(true);
    expect(media.isCurrent(sip.lease)).toBe(true);
    expect(media.getSnapshot().resumeRequired).toBe(false);
  });

  it("fails the SIP handoff when the recorder cannot stop and leaves no resumable voice note", async () => {
    const media = new MediaOwnershipCoordinator();
    await media.requestVoiceNote("voice:1", {
      stopForSip: async () => {
        throw new Error("stop failed");
      },
    }).ready;
    const sip = media.requestSip("sip:1");
    await expect(sip.ready).rejects.toMatchObject({ code: "pause-failed" });
    expect(media.getSnapshot()).toMatchObject({
      owner: null,
      resumeRequired: false,
    });
    const retry = media.requestSip("sip:retry");
    await expect(retry.ready).rejects.toMatchObject({ code: "pause-failed" });
    expect(() =>
      media.requestMeeting("meeting:retry", { pauseForSip: async () => {} }),
    ).toThrow("pause-failed");
  });

  it("keeps the voice-stop barrier when a pending SIP request is cancelled", async () => {
    const media = new MediaOwnershipCoordinator();
    let unblock!: () => void;
    const gate = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const voice = media.requestVoiceNote("voice:1", { stopForSip: () => gate });
    await voice.ready;
    const first = media.requestSip("sip:one");
    void first.ready.catch(() => {});
    media.release(first.lease);
    const second = media.requestSip("sip:two");
    let active = false;
    void second.ready.then(() => {
      active = true;
    });
    await Promise.resolve();
    expect(active).toBe(false);
    unblock();
    await second.ready;
    expect(media.isCurrent(second.lease)).toBe(true);
  });
  it("keeps prior-account recorder shutdown ahead of a new account call", async () => {
    const media = new MediaOwnershipCoordinator();
    let done!: () => void;
    const stopped = new Promise<void>((resolve) => (done = resolve));
    await media.requestVoiceNote("old-account", { stopForSip: () => stopped })
      .ready;
    media.clearForAuth();
    const sip = media.requestSip("new-account");
    let active = false;
    void sip.ready.then(() => (active = true));
    await Promise.resolve();
    expect(active).toBe(false);
    done();
    await sip.ready;
    expect(media.isCurrent(sip.lease)).toBe(true);
  });
});
