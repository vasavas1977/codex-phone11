import { expect, it, vi } from "vitest";
import { createElement } from "react";
import { createRequire } from "node:module";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot() };
});

const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as {
  renderToStaticMarkup(node: React.ReactNode): string;
};
const mocks = vi.hoisted(() => ({
  workspaceId: 7,
  people: [{ id: 1020, name: "Teammate", extension: "1020", photoUrl: "/api/profile/photo/7/1020?v=11111111-1111-4111-8111-111111111111" }],
}));
vi.mock("react-native", () => ({
  StyleSheet: { create: (value: unknown) => value },
  View: ({ children }: any) => createElement("div", null, children),
  Text: ({ children }: any) => createElement("span", null, children),
  ScrollView: ({ children }: any) => createElement("div", null, children),
  Pressable: ({ children }: any) => createElement("button", null, children),
  ActivityIndicator: () => null,
}));
vi.mock("../hooks/use-colors", () => ({ useColors: () => ({ primary: "#00f", muted: "#888", success: "#0f0", foreground: "#fff" }) }));
vi.mock("../hooks/use-auth", () => ({ useAuth: () => ({ user: { id: 3001 } }) }));
vi.mock("../hooks/use-directory", () => ({
  useDirectory: () => ({ owner: 3001, workspace: { id: mocks.workspaceId }, people: mocks.people, reload: vi.fn() }),
  useDirectoryFocusRefresh: vi.fn(),
}));
vi.mock("../lib/profile/use-workspace-profile", () => ({ useWorkspaceProfile: () => ({ photoDescriptor: null }) }));
vi.mock("../components/profile/profile-avatar", () => ({
  ProfileAvatar: ({ name, photoUrl, tenantId, userId }: any) =>
    createElement("span", { "data-name": name, "data-photo": photoUrl ?? "", "data-tenant": tenantId, "data-user": userId }),
  useProfilePhotoCacheScope: vi.fn(),
}));
vi.mock("../components/meetings/native-video-stage", () => ({ NativeVideoStage: () => null }));

import { MeetingRoomState } from "../components/meetings/meeting-room-state";

function room(localIdentity = "p11-t7-u3001", remoteIdentity = "p11-t7-u1020") {
  const participants = [
    { identity: localIdentity, name: "You", local: true, speaking: false, microphone: true, camera: false, attributes: {} },
    { identity: remoteIdentity, name: "Teammate", local: false, speaking: false, microphone: false, camera: false, attributes: {} },
  ];
  return renderToStaticMarkup(createElement(MeetingRoomState, {
    session: { subscribe: () => () => {}, getSnapshot: () => ({ status: "connected", participants, error: null }) } as any,
    onBack: () => {},
  }));
}

it("renders a participant's authorized workspace photo beside their name", () => {
  expect(room()).toContain('data-photo="/api/profile/photo/7/1020?v=11111111-1111-4111-8111-111111111111"');
});

it("falls back when a participant identity is from another tenant", () => {
  expect(room("p11-t7-u3001", "p11-t8-u1020")).not.toContain('data-photo="/api/profile/photo/7/1020');
});
