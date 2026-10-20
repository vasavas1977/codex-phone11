import { act, createElement, useEffect } from "react";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NativeVideoStage as WebStage } from "../components/meetings/native-video-stage.web";
import type { MeetingVideoLayout } from "../lib/meetings/video-layout";
const { NativeVideoStage: NativeStage } = await vi.importActual<
  typeof import("../components/meetings/native-video-stage")
>("../components/meetings/native-video-stage");

const hostProps = vi.hoisted(() => new Map<string, any>());
vi.mock("react-native", () => ({
  View: (props: any) => {
    if (props.testID) hostProps.set(props.testID, props);
    return createElement(
      "div",
      {
        "data-testid": props.testID,
        "data-style": JSON.stringify(props.style),
        "aria-hidden":
          props["aria-hidden"] ?? props.accessibilityElementsHidden,
        inert: props.inert,
        "data-important-for-accessibility": props.importantForAccessibility,
      },
      props.children,
    );
  },
  Text: ({ children }: any) => createElement("span", null, children),
  Pressable: ({ children, onPress, accessibilityLabel, disabled }: any) =>
    createElement(
      "button",
      { onClick: onPress, "aria-label": accessibilityLabel, disabled },
      children,
    ),
  StyleSheet: { create: (value: unknown) => value },
}));
vi.mock("@livekit/react-native", () => ({
  VideoView: ({ videoTrack, mirror, objectFit }: any) => {
    useEffect(() => {
      videoTrack.attach();
      return () => videoTrack.detach();
    }, [videoTrack]);
    return createElement("video", {
      "data-fit": objectFit,
      "data-mirror": String(Boolean(mirror)),
    });
  },
}));

// Real retained React/ReactDOM own lifetimes; host, SDK tracks and events remain inert.
class HostNode {
  parentNode: HostNode | null = null;
  childNodes: HostNode[] = [];
  ownerDocument!: HostDocument;
  value = "";
  constructor(readonly nodeType: number) {}
  get firstChild(): HostNode | null {
    return this.childNodes[0] ?? null;
  }
  get lastChild(): HostNode | null {
    return this.childNodes.at(-1) ?? null;
  }
  get nextSibling(): HostNode | null {
    const siblings = this.parentNode?.childNodes ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  appendChild(node: HostNode) {
    node.parentNode?.removeChild(node);
    this.childNodes.push(node);
    node.parentNode = this;
    return node;
  }
  insertBefore(node: HostNode, before: HostNode) {
    node.parentNode?.removeChild(node);
    this.childNodes.splice(this.childNodes.indexOf(before), 0, node);
    node.parentNode = this;
    return node;
  }
  removeChild(node: HostNode) {
    this.childNodes.splice(this.childNodes.indexOf(node), 1);
    node.parentNode = null;
    return node;
  }
  get textContent(): string {
    return (
      this.value + this.childNodes.map((node) => node.textContent).join("")
    );
  }
  set textContent(value: string) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    this.value = value;
  }
  get nodeValue() {
    return this.value;
  }
  set nodeValue(value: string) {
    this.value = value;
  }
  addEventListener() {}
  removeEventListener() {}
}
class HostElement extends HostNode {
  readonly attributes = new Map<string, string>();
  readonly namespaceURI = "http://www.w3.org/1999/xhtml";
  readonly style = { setProperty() {}, removeProperty() {} };
  readonly nodeName: string;
  readonly tagName: string;
  constructor(readonly localName: string) {
    super(1);
    this.nodeName = this.tagName = localName.toUpperCase();
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, String(value));
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
}
class HostDocument extends HostNode {
  readonly documentElement: HostElement;
  readonly body: HostElement;
  readonly activeElement = null;
  defaultView!: object;
  constructor() {
    super(9);
    this.ownerDocument = this;
    this.documentElement = this.createElement("html");
    this.body = this.createElement("body");
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.body);
  }
  createElement(name: string) {
    const node = new HostElement(name);
    node.ownerDocument = this;
    return node;
  }
  createElementNS(_namespace: string, name: string) {
    return this.createElement(name);
  }
  createTextNode(value: string) {
    const node = new HostNode(3);
    node.ownerDocument = this;
    node.value = value;
    return node;
  }
}

type MountedRoot = { render(element: React.ReactNode): void; unmount(): void };
const { createRoot } = createRequire(import.meta.url)("react-dom/client") as {
  createRoot(element: unknown): MountedRoot;
};
let root: MountedRoot | undefined;
let container: HostElement;

function walk(node: HostNode): HostElement[] {
  return [
    ...(node instanceof HostElement ? [node] : []),
    ...node.childNodes.flatMap(walk),
  ];
}

function makeTrack(source = "camera") {
  return { source, attach: vi.fn(), detach: vi.fn() };
}
function room() {
  const tracks = Array.from({ length: 9 }, () => makeTrack());
  const audio = makeTrack("microphone"),
    local = makeTrack(),
    remoteScreen = makeTrack("screen_share"),
    localScreen = makeTrack("screen_share");
  const participants: any[] = tracks.map((track, index) => ({
    identity: `remote-${index}`,
    name: `Member ${index}`,
    isSpeaking: false,
    videoTrackPublications: new Map([["camera", { videoTrack: track }]]),
    audioTrackPublications:
      index === 0
        ? new Map([["microphone", { audioTrack: audio }]])
        : new Map(),
  }));
  participants[0].videoTrackPublications.set("screen", {
    videoTrack: remoteScreen,
  });
  participants.push({
    identity: "off",
    name: "Camera off member",
    videoTrackPublications: new Map(),
    audioTrackPublications: new Map(),
  });
  const current: any = {
    canPlaybackAudio: true,
    startAudio: vi.fn(async () => {}),
    on: vi.fn(),
    off: vi.fn(),
    localParticipant: {
      identity: "self",
      videoTrackPublications: new Map([
        ["camera", { videoTrack: local }],
        ["screen", { videoTrack: localScreen }],
      ]),
    },
    remoteParticipants: new Map(participants.map((p) => [p.identity, p])),
  };
  return {
    current,
    cameras: [...tracks, local],
    audio,
    shares: [remoteScreen, localScreen],
  };
}
type Fixture = ReturnType<typeof room>;
function button(label: string) {
  return walk(container).find((n) => n.getAttribute("aria-label") === label)!;
}
function reactProps(node: HostElement) {
  expect(node, "Expected current accessible navigation control").toBeDefined();
  const key = Object.keys(node).find((key) => key.startsWith("__reactProps$"))!;
  return (node as unknown as Record<string, any>)[key];
}
async function click(label: string) {
  await act(async () => reactProps(button(label)).onClick());
}
function pageCount() {
  return /Gallery page (\d+) of (\d+)/
    .exec(container.textContent)
    ?.slice(1)
    .map(Number);
}
function cameraTiles() {
  return walk(container).filter((n) =>
    ["remote-video", "local-camera-preview", "camera-off-participant"].includes(
      n.getAttribute("data-testid") ?? "",
    ),
  );
}
function visibleCameras() {
  return cameraTiles().filter((n) => n.getAttribute("aria-hidden") !== "true");
}
function expectMediaMounted(fixture: Fixture, platform: string) {
  for (const track of [
    ...fixture.cameras,
    ...fixture.shares,
    ...(platform === "web" ? [fixture.audio] : []),
  ]) {
    expect(track.attach.mock.calls.length).toBe(1);
    expect(track.detach.mock.calls.length).toBe(0);
  }
}
beforeEach(() => {
  hostProps.clear();
  const document = new HostDocument();
  const window = {
    document,
    HTMLElement: HostElement,
    HTMLIFrameElement: class {},
    addEventListener() {},
    removeEventListener() {},
  };
  document.defaultView = window;
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  vi.unstubAllGlobals();
});

for (const [platform, Stage] of [
  ["web", WebStage],
  ["native", NativeStage],
] as const) {
  describe(`${platform} actual mounted gallery paging`, () => {
    async function render(
      fixture?: Fixture,
      layout: MeetingVideoLayout = "gallery",
    ) {
      await act(async () =>
        root!.render(
          createElement(Stage, {
            room: fixture?.current,
            reconnecting: false,
            receiveOnly: false,
            layout,
            renderAvatar: (target) =>
              createElement(
                "span",
                { "data-avatar": target.identity },
                "Avatar",
              ),
          }),
        ),
      );
    }
    async function width(value: number) {
      const props = hostProps.get(`${platform}-video-stage`);
      expect(
        props.onLayout,
        "Gallery capacity must follow measured stage width",
      ).toBeTypeOf("function");
      await act(async () =>
        props.onLayout({ nativeEvent: { layout: { width: value } } }),
      );
    }
    it("navigates bounded pages with stable mounted cameras, shares, audio and camera-off avatar", async () => {
      const active = room();
      await render(active);
      await width(360);
      expect(pageCount()).toEqual([1, 3]);
      expect(visibleCameras()).toHaveLength(4);
      const previous = reactProps(button("Previous Gallery page"));
      expect(previous.disabled).toBe(true);
      const all = cameraTiles();
      expect(all).toHaveLength(11);
      await click("Next Gallery page");
      expect(pageCount()).toEqual([2, 3]);
      expect(visibleCameras()).toHaveLength(4);
      expect(cameraTiles()).toEqual(all);
      expectMediaMounted(active, platform);
      await click("Next Gallery page");
      expect(pageCount()).toEqual([3, 3]);
      expect(visibleCameras()).toHaveLength(3);
      expect(reactProps(button("Next Gallery page")).disabled).toBe(true);
      expect(
        walk(container).filter(
          (n) => n.getAttribute("data-testid") === "shared-screen",
        ),
      ).toHaveLength(2);
      expect(
        walk(container).find((n) => n.getAttribute("data-avatar") === "off"),
      ).toBeDefined();
      for (const share of walk(container).filter(
        (n) => n.getAttribute("data-testid") === "shared-screen",
      )) {
        expect(share.getAttribute("aria-hidden")).not.toBe("true");
        expect(share.getAttribute("data-style")).not.toContain('"opacity":0');
        const video = walk(share).find((n) => n.localName === "video")!;
        if (platform === "web") {
          expect(reactProps(video).style.objectFit).toBe("contain");
          expect(reactProps(video).style.transform).toBeUndefined();
        } else {
          expect(video.getAttribute("data-fit")).toBe("contain");
          expect(video.getAttribute("data-mirror")).toBe("false");
        }
      }
      if (platform === "native")
        for (const hidden of cameraTiles().filter(
          (n) => n.getAttribute("aria-hidden") === "true",
        ))
          expect(hidden.getAttribute("data-important-for-accessibility")).toBe(
            "no-hide-descendants",
          );
      if (platform === "web")
        for (const hidden of cameraTiles().filter(
          (n) => n.getAttribute("aria-hidden") === "true",
        ))
          expect(hidden.getAttribute("inert")).not.toBeNull();
      for (const hidden of cameraTiles().filter(
        (n) => n.getAttribute("aria-hidden") === "true",
      )) {
        expect(hidden.getAttribute("data-style")).toContain('"opacity":0');
        expect(hidden.getAttribute("data-style")).toContain('"height":180');
        expect(hidden.getAttribute("data-style")).not.toContain(
          '"display":"none"',
        );
      }
      await click("Previous Gallery page");
      expectMediaMounted(active, platform);
      expect(active.current.startAudio).not.toHaveBeenCalled();
    });
    it("clamps shrink and resize, keeps current page on joins, and never resurrects an old out-of-range page", async () => {
      const active = room();
      await render(active);
      await width(360);
      await click("Next Gallery page");
      await click("Next Gallery page");
      await width(800);
      expect(pageCount()).toEqual([2, 2]);
      expect(visibleCameras()).toHaveLength(3);
      expectMediaMounted(active, platform);
      await width(360);
      expect(pageCount()).toEqual([2, 3]);
      const departed = [...active.current.remoteParticipants.keys()].slice(2);
      for (const key of departed) active.current.remoteParticipants.delete(key);
      await render(active);
      expect(pageCount()).toEqual([1, 1]);
      for (let index = 20; index < 27; index++)
        active.current.remoteParticipants.set(`new-${index}`, {
          identity: `new-${index}`,
          name: "New",
          videoTrackPublications: new Map(),
          audioTrackPublications: new Map(),
        });
      await render(active);
      expect(pageCount()).toEqual([1, 3]);
      await click("Next Gallery page");
      active.current.remoteParticipants.set("new-27", {
        identity: "new-27",
        name: "New",
        videoTrackPublications: new Map(),
        audioTrackPublications: new Map(),
      });
      await render(active);
      expect(pageCount()).toEqual([2, 3]);
    });
    it("resets on room/layout replacement, leave and A/B/A reuse while retiring queued navigation", async () => {
      const first = room(),
        next = room();
      await render(first);
      await click("Next Gallery page");
      const retiredClick = reactProps(button("Next Gallery page")).onClick;
      await render(next);
      expect(pageCount()).toEqual([1, 3]);
      await act(async () => retiredClick());
      expect(pageCount()).toEqual([1, 3]);
      await render(first);
      expect(pageCount()).toEqual([1, 3]);
      await act(async () => retiredClick());
      expect(pageCount()).toEqual([1, 3]);
      await click("Next Gallery page");
      await render(first, "speaker");
      expect(pageCount()).toBeUndefined();
      expect(visibleCameras()).toHaveLength(11);
      await render(first);
      expect(pageCount()).toEqual([1, 3]);
      await click("Next Gallery page");
      await render();
      expect(pageCount()).toBeUndefined();
      await render(first);
      expect(pageCount()).toEqual([1, 3]);
    });
    if (platform === "native")
      it("observes only completed single-finger horizontal swipes and does not capture vertical scrolling", async () => {
        const active = room();
        await render(active);
        const gesture = async (
          dx: number,
          dy: number,
          touches = 1,
          cancel = false,
        ) => {
          const props = hostProps.get("gallery-media-grid");
          expect(
            props,
            "Mobile gallery must expose noncapturing touch observers",
          ).toBeDefined();
          await act(async () => {
            props.onTouchStart({
              nativeEvent: {
                pageX: 150,
                pageY: 100,
                touches: Array(touches).fill({}),
              },
            });
            if (cancel) props.onTouchCancel();
            props.onTouchEnd({
              nativeEvent: {
                pageX: 150 + dx,
                pageY: 100 + dy,
                touches: [],
                changedTouches: [{}],
              },
            });
          });
        };
        await gesture(-63, 0);
        await gesture(-100, 120);
        await gesture(-100, 0, 2);
        await gesture(-100, 0, 1, true);
        expect(pageCount()).toEqual([1, 3]);
        await gesture(-80, 10);
        expect(pageCount()).toEqual([2, 3]);
        await gesture(80, 0);
        expect(pageCount()).toEqual([1, 3]);
        expectMediaMounted(active, platform);
        const props = hostProps.get("gallery-media-grid");
        await act(async () => {
          props.onTouchStart({
            nativeEvent: { pageX: 150, pageY: 100, touches: [{}] },
          });
          props.onTouchMove({
            nativeEvent: { pageX: 150, pageY: 140, touches: [{}] },
          });
          props.onTouchEnd({
            nativeEvent: {
              pageX: 50,
              pageY: 100,
              touches: [],
              changedTouches: [{}],
            },
          });
        });
        expect(pageCount()).toEqual([1, 3]);
        expect(props.onStartShouldSetResponder).toBeUndefined();
        expect(props.onMoveShouldSetResponder).toBeUndefined();
      });
  });
}
