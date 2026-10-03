import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";

const { renderToStaticMarkup } = createRequire(import.meta.url)(
  "react-dom/server",
) as { renderToStaticMarkup(node: ReactNode): string };

vi.mock("react-native", () => ({
  View: ({ children }: any) => createElement("div", null, children),
  Text: ({ children }: any) => createElement("span", null, children),
  StyleSheet: {
    create: (styles: unknown) => styles,
    absoluteFillObject: {},
  },
}));

vi.mock("@livekit/react-native", () => ({
  VideoView: ({ videoTrack, mirror }: any) =>
    createElement("video", {
      "data-track": videoTrack?.id,
      "data-mirror": String(Boolean(mirror)),
    }),
}));

import { NativeVideoStage } from "../components/meetings/native-video-stage";

function room({ localVideo = true, remoteVideo = true, remoteAudio = true }: { localVideo?: boolean; remoteVideo?: boolean; remoteAudio?: boolean } = {}) {
  return {
    localParticipant: {
      identity: "local",
      videoTrackPublications: new Map(localVideo ? [["camera", { videoTrack: { id: "local-camera" } }]] : []),
      audioTrackPublications: new Map(),
    },
    remoteParticipants: new Map([["remote", {
      identity: "remote",
      name: "Nadia",
      videoTrackPublications: new Map(remoteVideo ? [["camera", { videoTrack: { id: "remote-camera" } }]] : []),
      audioTrackPublications: new Map(remoteAudio ? [["mic", { audioTrack: { id: "remote-mic" } }]] : []),
    }]]),
  } as any;
}

it("renders the existing LiveKit local and remote tracks without accepting room credentials", () => {
  const html = renderToStaticMarkup(
    createElement(NativeVideoStage, {
      room: room(),
      reconnecting: false,
      receiveOnly: false,
    }),
  );

  expect(html).toContain('data-track="remote-camera"');
  expect(html).toContain('data-track="local-camera"');
  expect(html).toContain('data-mirror="true"');
  expect(html).toContain("Nadia");
  expect(html).toContain("Receiving audio from 1 participant");
  expect(html).not.toContain("wss://");
  expect(html).not.toContain("token");
});

it("renders receive-only and reconnecting states without attempting a local capture", () => {
  const html = renderToStaticMarkup(
    createElement(NativeVideoStage, {
      room: room({ localVideo: false, remoteVideo: false, remoteAudio: false }),
      reconnecting: true,
      receiveOnly: true,
    }),
  );

  expect(html).toContain("Reconnecting video…");
  expect(html).toContain("listen-only membership");
  expect(html).toContain("Reconnecting…");
  expect(html).not.toContain("data-track=");
});
