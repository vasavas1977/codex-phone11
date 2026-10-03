import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";
import { NativeVideoStage } from "../components/meetings/native-video-stage.web";

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
