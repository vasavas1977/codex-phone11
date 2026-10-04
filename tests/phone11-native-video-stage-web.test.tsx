import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";
import { NativeVideoStage } from "../components/meetings/native-video-stage.web";

const hooks = vi.hoisted(() => ({ capture: false, element: {} as object, effects: [] as (() => void | (() => void))[] }));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual,
    useRef: (value: unknown) => actual.useRef(hooks.capture ? hooks.element : value),
    useEffect: (effect: () => void | (() => void), deps: readonly unknown[]) => {
      if (hooks.capture) hooks.effects.push(effect);
      actual.useEffect(effect, deps);
    },
  };
});

const { renderToStaticMarkup } = createRequire(import.meta.url)(
  "react-dom/server",
) as { renderToStaticMarkup(node: ReactNode): string };

vi.mock("react-native", () => ({
  Pressable: ({ children }: any) => createElement("button", null, children),
  StyleSheet: {
    create: (styles: unknown) => styles,
    absoluteFillObject: {},
  },
  Text: ({ children }: any) => createElement("span", null, children),
  View: ({ children }: any) => createElement("div", null, children),
}));

function renderRemote(identity: string, name?: string) {
  const room = {
    localParticipant: { identity: "self" },
    remoteParticipants: new Map([
      [
        identity,
        {
          identity,
          name,
          videoTrackPublications: new Map([
            ["camera", { videoTrack: { id: "remote-camera" } }],
          ]),
        },
      ],
    ]),
  } as any;
  return renderToStaticMarkup(
    createElement(NativeVideoStage, {
      room,
      reconnecting: false,
      receiveOnly: false,
    }),
  );
}

it("keeps video attached and uses a generic label for an opaque provider identity", () => {
  const identity = "6fa4634ade063138::phone11-plain-video-abc123";
  const html = renderRemote(identity, identity);

  expect(html).toContain("<video");
  expect(html).toContain("Participant 1");
  expect(html).not.toContain(identity);
});

it("shows a human remote name on its video tile", () => {
  const html = renderRemote("provider-opaque-id", "Nadia");

  expect(html).toContain("<video");
  expect(html).toContain("Nadia");
  expect(html).not.toContain("provider-opaque-id");
});

it("renders camera and screen together with full-frame screen fitting and tracks their attachment cleanup", () => {
  const track = (source: string) => ({ source, attach: vi.fn(), detach: vi.fn() });
  const camera = track("camera"), screen = track("screen_share"), localScreen = track("screen_share");
  const remotePublications = new Map([
    ["camera", { videoTrack: camera, trackSid: "camera-sid" }],
    ["screen", { videoTrack: screen, trackSid: "screen-sid" }],
  ]);
  const room = {
    localParticipant: { identity: "self", videoTrackPublications: new Map([["screen", { videoTrack: localScreen }]]) },
    remoteParticipants: new Map([["remote", { identity: "remote", name: "Nadia", videoTrackPublications: remotePublications }]]),
    canPlaybackAudio: true, on: vi.fn(), off: vi.fn(),
  } as any;
  const render = () => renderToStaticMarkup(createElement(NativeVideoStage, { room, reconnecting: false, receiveOnly: false }));
  hooks.capture = true;
  hooks.effects = [];
  try {
    const html = render();
    expect(html.match(/<video/g)).toHaveLength(3);
    expect(html.match(/object-fit:contain/g)).toHaveLength(2);
    expect(html).toContain("object-fit:cover");
    expect(html).not.toContain("scaleX");
    expect(html).toContain("Nadia is sharing");
    expect(html).toContain("You are sharing");
    const cleanup = hooks.effects.map(effect => effect());
    for (const video of [camera, screen, localScreen]) expect(video.attach).toHaveBeenCalledWith(hooks.element);
    cleanup.forEach(dispose => dispose?.());
    for (const video of [camera, screen, localScreen]) expect(video.detach).toHaveBeenCalledWith(hooks.element);
    expect(room.off).toHaveBeenCalledWith("audioPlaybackChanged", expect.any(Function));
    remotePublications.delete("camera");
    expect(render().match(/<video/g)).toHaveLength(2);
    remotePublications.delete("screen");
    room.localParticipant.videoTrackPublications.clear();
    expect(render()).not.toContain("<video");
    expect(render()).toContain("Waiting for video");
  } finally { hooks.capture = false; hooks.effects = []; }
});

it("ignores unavailable subscriptions even when their stale track remains present", () => {
  const room = {
    localParticipant: { identity: "self" },
    remoteParticipants: new Map([["remote", {
      identity: "remote", videoTrackPublications: new Map([
        ["missing", { source: "camera" }],
        ["unsubscribed", { source: "screen_share", isSubscribed: false, videoTrack: {} }],
        ["muted", { source: "screen_share", isMuted: true, videoTrack: {} }],
      ]),
    }]]),
  } as any;
  const html = renderToStaticMarkup(createElement(NativeVideoStage, { room, reconnecting: false, receiveOnly: true }));
  expect(html).not.toContain("<video");
  expect(html).toContain("listen-only membership");
});
