import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";
import { NativeVideoStage } from "../components/meetings/native-video-stage";

const { renderToStaticMarkup } = createRequire(import.meta.url)(
  "react-dom/server",
) as { renderToStaticMarkup(node: ReactNode): string };

vi.mock("react-native", () => ({
  View: ({ children, style, testID }: any) =>
    createElement(
      "div",
      { "data-style": JSON.stringify(style), "data-testid": testID },
      children,
    ),
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

function room({
  localVideo = true,
  remoteVideo = true,
  remoteAudio = true,
}: {
  localVideo?: boolean;
  remoteVideo?: boolean;
  remoteAudio?: boolean;
} = {}) {
  return {
    localParticipant: {
      identity: "local",
      videoTrackPublications: new Map(
        localVideo ? [["camera", { videoTrack: { id: "local-camera" } }]] : [],
      ),
      audioTrackPublications: new Map(),
    },
    remoteParticipants: new Map([
      [
        "remote",
        {
          identity: "remote",
          name: "Nadia",
          videoTrackPublications: new Map(
            remoteVideo
              ? [["camera", { videoTrack: { id: "remote-camera" } }]]
              : [],
          ),
          audioTrackPublications: new Map(
            remoteAudio ? [["mic", { audioTrack: { id: "remote-mic" } }]] : [],
          ),
        },
      ],
    ]),
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
  active.localParticipant.videoTrackPublications.set("screen", {
    source: "screen_share",
    trackSid: "local-screen-sid",
    videoTrack: { id: "local-screen" },
  });
  active.remoteParticipants.get("remote").videoTrackPublications.set("screen", {
    source: "screen_share",
    trackSid: "remote-screen-sid",
    videoTrack: { id: "remote-screen" },
  });
  const html = renderToStaticMarkup(
    createElement(NativeVideoStage, {
      room: active,
      reconnecting: false,
      receiveOnly: false,
    }),
  );
  expect(html).toContain(
    'data-track="local-camera" data-mirror="true" data-fit="cover"',
  );
  expect(html).toContain(
    'data-track="remote-camera" data-mirror="false" data-fit="cover"',
  );
  expect(html).toContain(
    'data-track="local-screen" data-mirror="false" data-fit="contain"',
  );
  expect(html).toContain(
    'data-track="remote-screen" data-mirror="false" data-fit="contain"',
  );
  expect(html).toContain("You are sharing");
  expect(html).toContain("Nadia is sharing");
});

it("renders a share without a camera, clears removed tracks, and hides opaque identities", () => {
  const active = room({
    localVideo: false,
    remoteVideo: false,
    remoteAudio: false,
  });
  const participant = active.remoteParticipants.get("remote");
  participant.identity = "6fa4634ade063138::phone11-plain-video-abc123";
  participant.name = participant.identity;
  participant.videoTrackPublications.set("screen", {
    source: "screen_share",
    videoTrack: { id: "remote-screen" },
  });
  const render = () =>
    renderToStaticMarkup(
      createElement(NativeVideoStage, {
        room: active,
        reconnecting: false,
        receiveOnly: true,
      }),
    );
  expect(render()).toContain("Participant 1 is sharing");
  expect(render()).not.toContain(participant.identity);
  expect(render()).not.toContain("Waiting for video");
  participant.videoTrackPublications.delete("screen");
  expect(render()).not.toContain("remote-screen");
  expect(render()).toContain("Camera off");
  expect(render()).not.toContain("Waiting for video");
});

it("renders receive-only and reconnecting states without attempting a local capture", () => {
  const html = renderToStaticMarkup(
    createElement(NativeVideoStage, {
      room: room({ localVideo: false, remoteVideo: false, remoteAudio: false }),
      reconnecting: true,
      receiveOnly: true,
    }),
  );

  expect(html).toContain("Listen-only membership");
  expect(html).toContain("Camera off");
  expect(html).toContain("Reconnecting…");
  expect(html).not.toContain("data-track=");
});

it("renders the active remote speaker first and keeps all actual tracks in Gallery", () => {
  const active = room();
  active.remoteParticipants.set("second", {
    identity: "second",
    name: "Sam",
    isSpeaking: true,
    videoTrackPublications: new Map([
      ["camera", { videoTrack: { id: "second-camera" } }],
    ]),
  });
  const speaker = renderToStaticMarkup(
    createElement(NativeVideoStage, {
      room: active,
      reconnecting: false,
      receiveOnly: false,
      layout: "speaker",
    }),
  );
  expect(speaker.indexOf('data-track="second-camera"')).toBeLessThan(
    speaker.indexOf('data-track="remote-camera"'),
  );
  expect(speaker).toContain("&quot;minHeight&quot;:300");
  const gallery = renderToStaticMarkup(
    createElement(NativeVideoStage, {
      room: active,
      reconnecting: false,
      receiveOnly: false,
      layout: "gallery",
    }),
  );
  expect(gallery.indexOf('data-track="remote-camera"')).toBeLessThan(
    gallery.indexOf('data-track="second-camera"'),
  );
  for (const track of ["local-camera", "remote-camera", "second-camera"])
    expect(gallery).toContain(`data-track="${track}"`);
  expect(gallery).not.toContain("&quot;minHeight&quot;:300");
});

it("shows a camera-off speaker instead of making a different camera the speaker", () => {
  const active = room();
  active.remoteParticipants.set("off", {
    identity: "off",
    name: "Mina",
    isSpeaking: true,
    videoTrackPublications: new Map(),
  });
  const html = renderToStaticMarkup(
    createElement(NativeVideoStage, {
      room: active,
      reconnecting: false,
      receiveOnly: false,
      layout: "speaker",
    }),
  );
  expect(html.indexOf("Mina")).toBeLessThan(
    html.indexOf('data-track="remote-camera"'),
  );
  expect(html).toContain("Camera off");
});

it("counts people receiving audio without counting one person's screen audio twice", () => {
  const active = room();
  active.remoteParticipants
    .get("remote")
    .audioTrackPublications.set("screen-audio", {
      audioTrack: { id: "screen-audio" },
    });
  const html = renderToStaticMarkup(
    createElement(NativeVideoStage, {
      room: active,
      reconnecting: false,
      receiveOnly: false,
    }),
  );
  expect(html).toContain("Receiving audio from 1 participant");
  expect(html).not.toContain("Receiving audio from 2 participants");
});

it(
  "renders supplied authenticated avatars only for camera-off tiles",
  () => {
    const active = room({ localVideo: true, remoteVideo: false });
    const renderAvatar = vi.fn(({ name }: { name: string }) =>
      createElement("span", { "data-avatar": name }),
    );
    const html = renderToStaticMarkup(
      createElement(NativeVideoStage, {
        room: active,
        reconnecting: false,
        receiveOnly: false,
        renderAvatar,
      }),
    );
    expect(html).toContain('data-avatar="Nadia"');
    expect(renderAvatar).toHaveBeenCalledTimes(1);
    expect(renderAvatar).toHaveBeenCalledWith({
      identity: "remote",
      local: false,
      name: "Nadia",
      size: 72,
    });
    const gallery = renderToStaticMarkup(
      createElement(NativeVideoStage, {
        room: active,
        reconnecting: false,
        receiveOnly: false,
        layout: "gallery",
        renderAvatar,
      }),
    );
    expect(gallery).toContain('data-avatar="Nadia"');
    active.remoteParticipants
      .get("remote")
      .videoTrackPublications.set("camera", {
        videoTrack: { id: "remote-camera" },
      });
    renderAvatar.mockClear();
    renderToStaticMarkup(
      createElement(NativeVideoStage, {
        room: active,
        reconnecting: false,
        receiveOnly: false,
        renderAvatar,
      }),
    );
    expect(renderAvatar).not.toHaveBeenCalled();
  },
);
