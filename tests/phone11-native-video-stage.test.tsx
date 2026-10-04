import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";
import { NativeVideoStage } from "../components/meetings/native-video-stage";

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
  VideoView: ({ videoTrack, mirror, objectFit }: any) =>
    createElement("video", {
      "data-track": videoTrack?.id,
      "data-mirror": String(Boolean(mirror)),
      "data-fit": objectFit,
    }),
}));

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

it("renders simultaneous cameras and screens with uncropped nonmirrored shares", () => {
  const active = room();
  active.localParticipant.videoTrackPublications.set("screen", { source: "screen_share", trackSid: "local-screen-sid", videoTrack: { id: "local-screen" } });
  active.remoteParticipants.get("remote").videoTrackPublications.set("screen", { source: "screen_share", trackSid: "remote-screen-sid", videoTrack: { id: "remote-screen" } });
  const html = renderToStaticMarkup(createElement(NativeVideoStage, { room: active, reconnecting: false, receiveOnly: false }));
  expect(html).toContain('data-track="local-camera" data-mirror="true" data-fit="cover"');
  expect(html).toContain('data-track="remote-camera" data-mirror="false" data-fit="cover"');
  expect(html).toContain('data-track="local-screen" data-mirror="false" data-fit="contain"');
  expect(html).toContain('data-track="remote-screen" data-mirror="false" data-fit="contain"');
  expect(html).toContain("You are sharing");
  expect(html).toContain("Nadia is sharing");
});

it("renders a share without a camera, clears removed tracks, and hides opaque identities", () => {
  const active = room({ localVideo: false, remoteVideo: false, remoteAudio: false });
  const participant = active.remoteParticipants.get("remote");
  participant.identity = "6fa4634ade063138::phone11-plain-video-abc123";
  participant.name = participant.identity;
  participant.videoTrackPublications.set("screen", { source: "screen_share", videoTrack: { id: "remote-screen" } });
  const render = () => renderToStaticMarkup(createElement(NativeVideoStage, { room: active, reconnecting: false, receiveOnly: true }));
  expect(render()).toContain("Participant 1 is sharing");
  expect(render()).not.toContain(participant.identity);
  expect(render()).not.toContain("Waiting for video");
  participant.videoTrackPublications.delete("screen");
  expect(render()).not.toContain("remote-screen");
  expect(render()).toContain("Waiting for video");
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
