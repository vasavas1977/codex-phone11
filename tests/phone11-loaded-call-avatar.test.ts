import { expect, it } from "vitest";
import { resolveLoadedCallAvatar } from "../lib/phone/loaded-call-avatar";
import type { SipAccount } from "../lib/sip/account-store";

const account = { enabled: true, ownerUserId: 1, tenantId: 8 } as SipAccount;
const person = { id: 2, name: "Teammate", extension: "1020", photoUrl: "/api/profile/photo/8/2?v=8e1a30ce-3d1e-4d82-a011-24d21e326cf9" };
const chat = { userId: 1, workspace: { id: 8, name: "Team" }, people: [person] };

it("shows a uniquely matched teammate from a loaded directory in the phone tenant", () => {
  expect(resolveLoadedCallAvatar("1020", [], 1, account, chat)).toEqual({ kind: "team", person, tenantId: 8 });
});

it("never shows a teammate photo from another account or workspace", () => {
  expect(resolveLoadedCallAvatar("1020", [], 9, account, chat)).toBeUndefined();
  expect(resolveLoadedCallAvatar("1020", [], 1, account, { ...chat, userId: 9 })).toBeUndefined();
  expect(resolveLoadedCallAvatar("1020", [], 1, account, { ...chat, workspace: { id: 9, name: "Other" } })).toBeUndefined();
  expect(resolveLoadedCallAvatar("1020", [], 1, { ...account, enabled: false }, chat)).toBeUndefined();
});

it("does not guess from an ambiguous extension or a display name", () => {
  expect(resolveLoadedCallAvatar("1020", [], 1, account, { ...chat, people: [person, { ...person, id: 3 }] })).toBeUndefined();
  expect(resolveLoadedCallAvatar("Teammate", [], 1, account, chat)).toBeUndefined();
});

it("uses an already loaded, unique local contact photo even without a team directory", () => {
  const device = { id: "local", name: "Teammate", imageUri: "file:///tmp/contact.png", phones: [{ number: "+66812345678", label: "mobile", key: "+66812345678" }] };
  expect(resolveLoadedCallAvatar("0812345678", [device], 1, null, { userId: null, workspace: null, people: [] })).toEqual({ kind: "device", imageUri: device.imageUri });
  expect(resolveLoadedCallAvatar("0812345678", [device, { ...device, id: "another" }], 1, null, chat)).toBeUndefined();
});
