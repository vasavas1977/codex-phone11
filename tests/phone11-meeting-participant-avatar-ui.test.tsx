import { beforeEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { createRequire } from "node:module";
import { MeetingRoomState } from "../components/meetings/meeting-room-state";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const stateIndex = mocks.stateIndex++;
      if (stateIndex === 3 && mocks.openParticipants) {
        return ["participants", () => {}];
      }
      return actual.useState(initial as never);
    },
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) =>
      getSnapshot(),
  };
});

const { renderToStaticMarkup } = createRequire(import.meta.url)(
  "react-dom/server",
) as {
  renderToStaticMarkup(node: React.ReactNode): string;
};
const mocks = vi.hoisted(() => ({
  workspaceId: 7,
  stateIndex: 0,
  openParticipants: false,
  stageTargets: [] as {
    identity: string;
    local: boolean;
    name: string;
    size: number;
  }[],
  directoryOwner: 3001,
  ownPhoto: null as null | {
    userId: number;
    photoUrl: string;
    photoVersion: string;
  },
  authOwner: { id: 3001, name: "Current Person" },
  people: [
    {
      id: 1020,
      name: "Teammate",
      extension: "1020",
      photoUrl:
        "/api/profile/photo/7/1020?v=11111111-1111-4111-8111-111111111111",
    },
  ],
}));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  StyleSheet: { create: (value: unknown) => value },
  View: ({ children }: any) => createElement("div", null, children),
  Text: ({ children }: any) => createElement("span", null, children),
  ScrollView: ({ children }: any) => createElement("div", null, children),
  Pressable: ({ children, accessibilityLabel, onPress, disabled }: any) =>
    createElement(
      "button",
      { "aria-label": accessibilityLabel, onClick: onPress, disabled },
      children,
    ),
  Modal: ({ visible, children }: any) =>
    createElement("aside", { "aria-hidden": !visible }, children),
  ActivityIndicator: () => null,
}));
vi.mock("../hooks/use-colors", () => ({
  useColors: () => ({
    primary: "#00f",
    muted: "#888",
    success: "#0f0",
    foreground: "#fff",
  }),
}));
vi.mock("../hooks/use-auth", () => ({
  useAuth: () => ({ user: mocks.authOwner }),
}));
vi.mock("../lib/_core/auth", () => ({
  getAuthSnapshot: () => ({ user: mocks.authOwner }),
}));
vi.mock("../hooks/use-directory", () => ({
  useDirectory: () => ({
    owner: mocks.directoryOwner,
    workspace: { id: mocks.workspaceId },
    people: mocks.people,
    reload: vi.fn(),
  }),
  useDirectoryFocusRefresh: vi.fn(),
}));
vi.mock("../lib/profile/use-workspace-profile", () => ({
  useWorkspaceProfile: () => ({ photoDescriptor: mocks.ownPhoto }),
}));
vi.mock("../components/profile/profile-avatar", () => ({
  ProfileAvatar: ({
    name,
    photoUrl,
    tenantId,
    userId,
    accessibilityLabel,
  }: any) =>
    createElement("span", {
      "data-name": name,
      "data-photo": photoUrl ?? "",
      "data-tenant": tenantId,
      "data-user": userId,
      "aria-label": accessibilityLabel,
    }),
  useProfilePhotoCacheScope: vi.fn(),
}));
vi.mock("../components/meetings/native-video-stage", () => ({
  NativeVideoStage: ({ renderAvatar }: any) =>
    createElement(
      "div",
      { "data-stage": "camera-off" },
      ...mocks.stageTargets.map((target) => renderAvatar?.(target)),
    ),
}));
vi.mock("../components/ui/icon-symbol", () => ({
  IconSymbol: ({ name }: { name: string }) =>
    createElement("span", { "data-icon": name }),
}));

beforeEach(() => {
  mocks.stateIndex = 0;
  mocks.openParticipants = false;
  mocks.stageTargets = [];
  mocks.directoryOwner = 3001;
  mocks.workspaceId = 7;
  mocks.ownPhoto = null;
});

function room(
  localIdentity = "p11-t7-u3001",
  remoteIdentity = "p11-t7-u1020",
  captions: {
    id: string;
    text: string;
    participantIdentity?: string;
  }[] = [],
  remoteName = "Teammate",
) {
  mocks.stateIndex = 0;
  const participants = [
    {
      identity: localIdentity,
      name: "You",
      local: true,
      speaking: false,
      microphone: true,
      camera: false,
      attributes: {},
    },
    {
      identity: remoteIdentity,
      name: remoteName,
      local: false,
      speaking: false,
      microphone: false,
      camera: false,
      attributes: {},
    },
  ];
  return renderToStaticMarkup(
    createElement(MeetingRoomState, {
      session: {
        subscribe: () => () => {},
        getSnapshot: () => ({ status: "connected", participants, error: null }),
      } as any,
      captions,
      nativeRoom: {} as any,
      onBack: () => {},
    }),
  );
}

it("renders a participant's authorized workspace photo beside their name", () => {
  mocks.openParticipants = true;
  expect(room()).toContain(
    'data-photo="/api/profile/photo/7/1020?v=11111111-1111-4111-8111-111111111111"',
  );
  mocks.openParticipants = false;
});

it("falls back when a participant identity is from another tenant", () => {
  mocks.openParticipants = true;
  expect(room("p11-t7-u3001", "p11-t8-u1020")).not.toContain(
    'data-photo="/api/profile/photo/7/1020',
  );
  mocks.openParticipants = false;
});

it("uses the signed-in profile name for self and hides an opaque remote identity", () => {
  mocks.openParticipants = true;
  const opaqueIdentity = "6fa4634ade063138::phone11-plain-video-abc123";
  const html = room("p11-t7-u3001", opaqueIdentity, [], opaqueIdentity);

  expect(html).toContain("Current Person (You)");
  expect(html).toContain("Participant 1");
  expect(html).not.toContain(opaqueIdentity);
  expect(html).not.toContain("p11-t7-u3001");
  expect(html).toContain('aria-label="Participant 1 profile photo"');
  mocks.openParticipants = false;
});

it("keeps a trusted remote display name in the participant row and accessibility label", () => {
  mocks.openParticipants = true;
  const html = room("p11-t7-u3001", "provider-opaque-id", [], "Nok S.");

  expect(html).toContain("Nok S.");
  expect(html).toContain('aria-label="Nok S. profile photo"');
  expect(html).not.toContain("provider-opaque-id");
  mocks.openParticipants = false;
});

it("keeps the primary meeting controls visible with truthful device states", () => {
  const html = room();
  expect(html).toContain('aria-label="Mute microphone"');
  expect(html).toContain('aria-label="Turn camera on"');
  expect(html).toContain('aria-label="Participants"');
  expect(html).toContain('aria-label="More meeting options"');
  expect(html).toContain('aria-label="Leave meeting"');
  expect(html).toContain("Mic on · Video off");
  expect(html).not.toContain("Live captions");
  expect(html).toContain('data-icon="mic.fill"');
  expect(html).toContain('data-icon="person.3.fill"');
});

it("shows a compact caption only when supplied by the meeting service", () => {
  const html = room("p11-t7-u3001", "p11-t7-u1020", [
    {
      id: "caption-1",
      text: "The meeting starts now.",
      participantIdentity: "p11-t7-u1020",
    },
  ]);
  expect(html).toContain("The meeting starts now.");
  expect(html).toContain("Teammate");
  expect(html).not.toContain("Captions will appear here");
});

const stagePhoto = (html: string) =>
  html.match(/<div data-stage="camera-off">(.*?)<\/div>/)?.[1] ?? "";
it("shows a camera-off teammate's photo only through the current admitted roster and workspace", () => {
  mocks.stageTargets = [
    { identity: "p11-t7-u1020", local: false, name: "Teammate", size: 72 },
  ];
  expect(stagePhoto(room())).toContain('data-photo="/api/profile/photo/7/1020');
  expect(stagePhoto(room())).toContain('data-tenant="7" data-user="1020"');
});
it("uses the current owner's workspace photo for their camera-off tile", () => {
  mocks.stageTargets = [
    { identity: "p11-t7-u3001", local: true, name: "You", size: 40 },
  ];
  mocks.ownPhoto = {
    userId: 3001,
    photoUrl:
      "/api/profile/photo/7/3001?v=11111111-1111-4111-8111-111111111111",
    photoVersion: "11111111-1111-4111-8111-111111111111",
  };
  expect(stagePhoto(room())).toContain('data-photo="/api/profile/photo/7/3001');
  mocks.ownPhoto.userId = 1020;
  expect(stagePhoto(room())).not.toContain('data-photo="/api/profile/photo');
});
it.each(["directory-owner", "workspace", "foreign-identity"] as const)(
  "omits a camera-off photo with a retired or unmatched %s",
  (mismatch) => {
    if (mismatch === "directory-owner") mocks.directoryOwner = 1020;
    if (mismatch === "workspace") mocks.workspaceId = 8;
    const identity =
      mismatch === "foreign-identity" ? "p11-t8-u1020" : "p11-t7-u1020";
    mocks.stageTargets = [
      { identity, local: false, name: "Teammate", size: 72 },
    ];
    expect(stagePhoto(room("p11-t7-u3001", identity))).not.toContain(
      'data-photo="/api/profile/photo',
    );
  },
);
it("ignores a stale stage identity or a falsely local roster target", () => {
  mocks.stageTargets = [
    { identity: "p11-t7-u1996", local: false, name: "Stale person", size: 72 },
    { identity: "p11-t7-u1020", local: true, name: "False self", size: 40 },
  ];
  expect(stagePhoto(room())).toBe("");
});
