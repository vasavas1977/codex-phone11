import { act, createElement } from "react";
import { createRequire } from "node:module";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NativeVideoStage } from "../components/meetings/native-video-stage.web";
import { MeetingRoomState } from "../components/meetings/meeting-room-state";
import type { MeetingVideoLayout } from "../lib/meetings/video-layout";

vi.mock("react-native", () => ({
  View: ({ children, style, testID }: any) =>
    createElement(
      "div",
      { "data-style": JSON.stringify(style), "data-testid": testID },
      children,
    ),
  Text: ({ children }: any) => createElement("span", null, children),
  Pressable: ({
    children,
    onPress,
    accessibilityLabel,
    accessibilityState,
    disabled,
  }: any) =>
    createElement(
      "button",
      {
        onClick: onPress,
        "aria-label": accessibilityLabel,
        "aria-pressed": accessibilityState?.selected,
        disabled,
      },
      children,
    ),
  Platform: { OS: "web" },
  ScrollView: ({ children }: any) => createElement("div", null, children),
  Modal: ({ visible, children }: any) =>
    visible ? createElement("aside", null, children) : null,
  ActivityIndicator: () => null,
  StyleSheet: { create: (value: unknown) => value, absoluteFillObject: {} },
}));

const owner = vi.hoisted(() => ({ id: 3001, name: "You" }));
vi.mock("../hooks/use-colors", () => ({
  useColors: () => ({
    foreground: "white",
    primary: "blue",
    muted: "gray",
    success: "green",
    error: "red",
  }),
}));
vi.mock("../hooks/use-auth", () => ({ useAuth: () => ({ user: owner }) }));
vi.mock("../lib/_core/auth", () => ({
  getAuthSnapshot: () => ({ user: owner }),
}));
vi.mock("../hooks/use-directory", () => ({
  useDirectory: () => ({
    owner: 3001,
    workspace: { id: 7 },
    people: [],
    reload: vi.fn(),
  }),
  useDirectoryFocusRefresh: vi.fn(),
}));
vi.mock("../lib/profile/use-workspace-profile", () => ({
  useWorkspaceProfile: () => ({ photoDescriptor: null }),
}));
vi.mock("../components/profile/profile-avatar", () => ({
  ProfileAvatar: () => null,
  useProfilePhotoCacheScope: vi.fn(),
}));
vi.mock("../components/ui/icon-symbol", () => ({ IconSymbol: () => null }));
vi.mock("../components/meetings/meeting-room-chat", () => ({
  MeetingRoomChat: () => null,
}));
vi.mock("../components/meetings/native-video-stage", async () =>
  vi.importActual("../components/meetings/native-video-stage.web"),
);

// A deliberately inert host for the retained React DOM renderer. Real React
// owns mounting, effects, state, cleanup and refs. No browser, media or network
// implementation is installed; track attach/detach below are only spies.
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
function audioPrompt() {
  return walk(container).find(
    (node) => node.getAttribute("aria-label") === "Enable meeting audio",
  );
}
async function clickPrompt() {
  const button = audioPrompt();
  expect(button).toBeDefined();
  const key = Object.keys(button!).find((key) =>
    key.startsWith("__reactProps$"),
  )!;
  const props = (button as unknown as Record<string, { onClick(): void }>)[key];
  await act(async () => {
    props.onClick();
  });
}
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function room(playback = false) {
  const listeners = new Set<() => void>();
  const remoteVideo = { source: "camera", attach: vi.fn(), detach: vi.fn() };
  const remoteAudio = { attach: vi.fn(), detach: vi.fn() };
  const current = {
    canPlaybackAudio: playback,
    startAudio: vi.fn(async () => {}),
    on: vi.fn((_event: string, listener: () => void) => {
      listeners.add(listener);
    }),
    off: vi.fn((_event: string, listener: () => void) => {
      listeners.delete(listener);
    }),
    localParticipant: { identity: "local", videoTrackPublications: new Map() },
    remoteParticipants: new Map([
      [
        "remote",
        {
          identity: "remote",
          name: "Teammate",
          isSpeaking: false,
          videoTrackPublications: new Map([
            ["camera", { videoTrack: remoteVideo }],
          ]),
          audioTrackPublications: new Map([
            ["microphone", { audioTrack: remoteAudio }],
          ]),
        },
      ],
    ]),
  };
  return {
    current,
    remoteVideo,
    remoteAudio,
    listeners,
    emit() {
      for (const listener of [...listeners]) listener();
    },
  };
}
type Fixture = ReturnType<typeof room>;
async function render(
  fixture?: Fixture,
  layout: MeetingVideoLayout = "speaker",
) {
  await act(async () => {
    root!.render(
      createElement(NativeVideoStage, {
        room: fixture?.current as any,
        reconnecting: false,
        receiveOnly: false,
        layout,
      }),
    );
  });
}

beforeEach(() => {
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
  if (root)
    await act(async () => {
      root!.unmount();
    });
  root = undefined;
  vi.unstubAllGlobals();
});

it("keeps the new room's blocked prompt after an old room's delayed success", async () => {
  const old = room();
  const next = room();
  const attempt = deferred();
  old.current.startAudio.mockImplementationOnce(() => attempt.promise);
  await render(old);
  await clickPrompt();
  await render(next);
  await act(async () => {
    old.current.canPlaybackAudio = true;
    attempt.resolve();
  });
  expect(audioPrompt()).toBeDefined();
  expect(next.current.startAudio).not.toHaveBeenCalled();
});

it("does not add a prompt to the playing room after an old room's delayed failure", async () => {
  const old = room();
  const next = room(true);
  const attempt = deferred();
  old.current.startAudio.mockImplementationOnce(() => attempt.promise);
  await render(old);
  await clickPrompt();
  await render(next);
  await act(async () => {
    attempt.reject(new Error("synthetic old-room denial"));
  });
  expect(audioPrompt()).toBeUndefined();
});

it("uses actual current playback state when startAudio resolves without playback", async () => {
  const active = room();
  await render(active);
  await clickPrompt();
  expect(audioPrompt()).toBeDefined();
});

it("uses actual current playback state when a rejected attempt is followed by playback", async () => {
  const active = room();
  const attempt = deferred();
  active.current.startAudio.mockImplementationOnce(() => attempt.promise);
  await render(active);
  await clickPrompt();
  await act(async () => {
    active.current.canPlaybackAudio = true;
    active.emit();
    attempt.reject(new Error("synthetic denial"));
  });
  expect(audioPrompt()).toBeUndefined();
});

it("retires queued old playback events after room replacement", async () => {
  const old = room();
  const next = room();
  await render(old);
  const queued = [...old.listeners][0];
  await render(next);
  await act(async () => {
    old.current.canPlaybackAudio = true;
    queued();
  });
  expect(audioPrompt()).toBeDefined();
  expect(old.listeners.size).toBe(0);
});

it("reacts to actual playback events and permits a current-room retry", async () => {
  const active = room();
  active.current.startAudio.mockRejectedValueOnce(
    new Error("synthetic denial"),
  );
  await render(active);
  await clickPrompt();
  expect(audioPrompt()).toBeDefined();
  active.current.startAudio.mockImplementationOnce(async () => {
    active.current.canPlaybackAudio = true;
  });
  await clickPrompt();
  expect(audioPrompt()).toBeUndefined();
  await act(async () => {
    active.current.canPlaybackAudio = false;
    active.emit();
  });
  expect(audioPrompt()).toBeDefined();
  expect(active.current.startAudio).toHaveBeenCalledTimes(2);
});

it("clears the prompt when the room is removed", async () => {
  const active = room();
  await render(active);
  await render();
  expect(audioPrompt()).toBeUndefined();
  expect(active.listeners.size).toBe(0);
});

it.each(["resolve", "reject"] as const)(
  "retires pending %s and queued events on unmount without retaining media",
  async (outcome) => {
    const active = room();
    const attempt = deferred();
    active.current.startAudio.mockImplementationOnce(() => attempt.promise);
    await render(active);
    await clickPrompt();
    const queued = [...active.listeners][0];
    await act(async () => {
      root!.unmount();
    });
    root = undefined;
    await act(async () => {
      queued();
      if (outcome === "resolve") attempt.resolve();
      else attempt.reject(new Error("synthetic denial"));
    });
    expect(active.listeners.size).toBe(0);
    expect(container.childNodes).toHaveLength(0);
    expect(active.remoteVideo.detach).toHaveBeenCalledTimes(1);
    expect(active.remoteAudio.detach).toHaveBeenCalledTimes(1);
  },
);

it("does not attach duplicate media on playback state changes or retries", async () => {
  const active = room();
  await render(active);
  await clickPrompt();
  await act(async () => {
    active.current.canPlaybackAudio = true;
    active.emit();
  });
  await act(async () => {
    active.current.canPlaybackAudio = false;
    active.emit();
  });
  await clickPrompt();
  await render(active);
  expect(active.remoteVideo.attach).toHaveBeenCalledTimes(1);
  expect(active.remoteAudio.attach).toHaveBeenCalledTimes(1);
  expect(active.remoteVideo.detach).not.toHaveBeenCalled();
  expect(active.remoteAudio.detach).not.toHaveBeenCalled();
});

it("allows only one current audio attempt until it settles, then permits retry", async () => {
  const active = room();
  const attempt = deferred();
  active.current.startAudio.mockImplementationOnce(() => attempt.promise);
  await render(active);
  await clickPrompt();
  await clickPrompt();
  expect(active.current.startAudio).toHaveBeenCalledTimes(1);
  await act(async () => {
    attempt.reject(new Error("synthetic denial"));
  });
  await clickPrompt();
  expect(active.current.startAudio).toHaveBeenCalledTimes(2);
  expect(audioPrompt()).toBeDefined();
});

it("does not revive an old attempt when the same room object is installed again", async () => {
  const active = room();
  const between = room(true);
  const attempt = deferred();
  active.current.startAudio.mockImplementationOnce(() => attempt.promise);
  await render(active);
  await clickPrompt();
  await render(between);
  await render(active);
  await act(async () => {
    active.current.canPlaybackAudio = true;
    attempt.resolve();
  });
  // Only the current lifetime's event can announce changed playback state.
  expect(audioPrompt()).toBeDefined();
  await act(async () => {
    active.emit();
  });
  expect(audioPrompt()).toBeUndefined();
});

it("switches Speaker/Gallery and active speakers without reattaching media", async () => {
  const active = room(true);
  const secondVideo = { source: "camera", attach: vi.fn(), detach: vi.fn() };
  const first = active.current.remoteParticipants.get("remote")!;
  active.current.remoteParticipants.set("second", {
    ...first,
    identity: "second",
    name: "Sam",
    isSpeaking: true,
    audioTrackPublications: new Map(),
    videoTrackPublications: new Map([["camera", { videoTrack: secondVideo }]]),
  });
  await render(active, "speaker");
  const videoTiles = () =>
    walk(container).filter(
      (node) => node.getAttribute("data-testid") === "remote-video",
    );
  expect(videoTiles()[0].textContent).toBe("Sam");
  expect(videoTiles()[0].getAttribute("data-style")).toContain(
    '"minHeight":300',
  );
  await render(active, "gallery");
  expect(videoTiles()[0].textContent).toBe("Teammate");
  expect(videoTiles()[0].getAttribute("data-style")).not.toContain(
    '"minHeight":300',
  );
  first.isSpeaking = true;
  active.current.remoteParticipants.get("second")!.isSpeaking = false;
  await render(active, "speaker");
  expect(videoTiles()[0].textContent).toBe("Teammate");
  for (const track of [active.remoteVideo, secondVideo, active.remoteAudio]) {
    expect(track.attach).toHaveBeenCalledTimes(1);
    expect(track.detach).not.toHaveBeenCalled();
  }
  expect(active.current.startAudio).not.toHaveBeenCalled();
});

it("changes view through the actual picker and retires its choice after room replacement and leave", async () => {
  const first = room(true),
    next = room(true);
  const snapshot = { status: "connected", participants: [], error: null };
  const session = { subscribe: () => () => {}, getSnapshot: () => snapshot };
  const renderRoom = async (fixture?: Fixture) => {
    await act(async () =>
      root!.render(
        createElement(MeetingRoomState, {
          session: session as any,
          nativeRoom: fixture?.current as any,
          onBack: vi.fn(),
        }),
      ),
    );
  };
  const choice = (label: string) =>
    walk(container).find((node) => node.getAttribute("aria-label") === label)!;
  const click = async (label: string) => {
    const node = choice(label),
      key = Object.keys(node).find((key) => key.startsWith("__reactProps$"))!;
    await act(async () =>
      (node as unknown as Record<string, { onClick(): void }>)[key].onClick(),
    );
  };
  await renderRoom(first);
  expect(choice("Speaker view").getAttribute("aria-pressed")).toBe("true");
  await click("Gallery view");
  expect(choice("Gallery view").getAttribute("aria-pressed")).toBe("true");
  expect(first.remoteVideo.attach).toHaveBeenCalledTimes(1);
  expect(first.remoteAudio.attach).toHaveBeenCalledTimes(1);
  await renderRoom(next);
  expect(choice("Speaker view").getAttribute("aria-pressed")).toBe("true");
  await renderRoom(first);
  expect(choice("Speaker view").getAttribute("aria-pressed")).toBe("true");
  await click("Gallery view");
  await renderRoom();
  expect(
    walk(container).some(
      (node) => node.getAttribute("aria-label") === "Gallery view",
    ),
  ).toBe(false);
  await renderRoom(first);
  expect(choice("Speaker view").getAttribute("aria-pressed")).toBe("true");
  expect(first.current.startAudio).not.toHaveBeenCalled();
  expect(next.current.startAudio).not.toHaveBeenCalled();
});
