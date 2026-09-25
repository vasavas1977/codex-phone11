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
  useAuth: () => ({ user: { id: 3001, name: "Current Person" } }),
}));
vi.mock("../hooks/use-directory", () => ({
  useDirectory: () => ({
    owner: 3001,
    workspace: { id: mocks.workspaceId },
    people: mocks.people,
    reload: vi.fn(),
  }),
  useDirectoryFocusRefresh: vi.fn(),
}));
vi.mock("../lib/profile/use-workspace-profile", () => ({
  useWorkspaceProfile: () => ({ photoDescriptor: null }),
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
  NativeVideoStage: () => null,
}));
vi.mock("../components/ui/icon-symbol", () => ({
  IconSymbol: ({ name }: { name: string }) =>
    createElement("span", { "data-icon": name }),
}));

beforeEach(() => {
  mocks.stateIndex = 0;
  mocks.openParticipants = false;
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
