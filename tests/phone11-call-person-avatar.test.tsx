import { beforeEach, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as { renderToStaticMarkup(node: ReactNode): string };

const state = vi.hoisted(() => ({
  owner: { id: 1 },
  account: { enabled: true, ownerUserId: 1, tenantId: 8 },
  chat: { userId: 1, workspace: { id: 8, name: "Team" }, people: [{ id: 2, name: "Teammate", extension: "1020", photoUrl: "/api/profile/photo/8/2?v=8e1a30ce-3d1e-4d82-a011-24d21e326cf9" }] },
}));
vi.mock("../lib/_core/auth", () => ({ getAuthSnapshot: () => ({ user: state.owner }) }));
vi.mock("../lib/sip/account-store", () => ({ useSipAccountStore: (select: any) => select({ account: state.account }) }));
vi.mock("../lib/chat/store", () => ({ useChatStore: (select: any) => select(state.chat) }));
vi.mock("../components/profile/profile-avatar", () => ({
  ProfileAvatar: (props: any) => createElement("i", { "data-photo": props.photoUrl ?? "", "data-tenant": props.tenantId ?? "", "data-user": props.userId ?? "" }),
}));
vi.mock("../components/device-contacts-list", () => ({
  DeviceContactAvatar: (props: any) => createElement("i", { "data-device-photo": props.imageUri }),
}));

import { CallPersonAvatar } from "../components/phone/call-person-avatar";

beforeEach(() => {
  state.owner.id = 1;
  state.account.ownerUserId = 1;
  state.chat.userId = 1;
  state.chat.workspace.id = 8;
});

it("renders a tenant-bound teammate photo from the already-loaded directory", () => {
  expect(renderToStaticMarkup(<CallPersonAvatar number="1020" name="Teammate" size={48} />))
    .toContain('data-photo="/api/profile/photo/8/2?v=8e1a30ce-3d1e-4d82-a011-24d21e326cf9" data-tenant="8" data-user="2"');
});

it("falls back when the signed-in caller and cached directory differ", () => {
  state.owner.id = 9;
  expect(renderToStaticMarkup(<CallPersonAvatar number="1020" name="Teammate" size={48} />))
    .toContain('data-photo="" data-tenant="" data-user=""');
});

it("shows a unique local photo without loading Team Chat", () => {
  const contacts = [{ id: "local", name: "Person", imageUri: "file:///tmp/contact.png", phones: [{ number: "+66812345678", key: "+66812345678", label: "mobile" }] }];
  expect(renderToStaticMarkup(<CallPersonAvatar number="0812345678" name="Person" size={48} deviceContacts={contacts} />))
    .toContain('data-device-photo="file:///tmp/contact.png"');
});
