import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
import { beforeEach, expect, it, vi } from "vitest";
const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as { renderToStaticMarkup(node: ReactNode): string };
const m = vi.hoisted(() => ({ buttons: [] as any[], inputs: [] as any[] }));
vi.mock("react-native", () => ({
  Modal: ({ children }: any) => createElement("div", {}, children),
  View: ({ children }: any) => createElement("div", {}, children),
  ScrollView: ({ children }: any) => createElement("div", {}, children),
  Text: ({ children }: any) => createElement("span", {}, children),
  TextInput: (props: any) => { m.inputs.push(props); return createElement("input", { disabled: props.editable === false }); },
  Pressable: (props: any) => { m.buttons.push(props); return createElement("button", { disabled: props.disabled, "aria-label": props.accessibilityLabel }, props.children); },
}));
vi.mock("../hooks/use-colors", () => ({ useColors: () => ({ primary: "#0055ff", foreground: "#111", muted: "#666", background: "#fff", surface: "#eee", border: "#ddd", error: "#c00" }) }));
vi.mock("../components/profile/profile-avatar", () => ({ ProfileAvatar: () => null }));
import { ChannelMeetingPicker, channelInvitees, type ChannelMeetingPickerProps } from "../components/chat/channel-meeting-picker";
const base = (): ChannelMeetingPickerProps => ({ visible: true, tenantId: 1, channelId: "channel-a", channelName: "Project", hostId: 1, members: [{ id: 1, name: "Host", extension: null }, { id: 2, name: "Member", extension: "1020" }], startAvailable: true, onCancel: vi.fn(), onStart: vi.fn() });
beforeEach(() => { m.buttons = []; m.inputs = []; });
const start = () => m.buttons.find(button => button.accessibilityLabel === "Start meeting");

it("deduplicates current members and excludes the host and invalid identities", () => {
  const p = base();
  expect(channelInvitees([...p.members, p.members[1], { id: 0, name: "Invalid", extension: null }], 1).map(person => person.id)).toEqual([2]);
});
it("selects all current invitees but never starts a room from rendering the picker", () => {
  const p = base();
  const html = renderToStaticMarkup(createElement(ChannelMeetingPicker, p));
  expect(html).toContain("1 selected");
  expect(html).toContain("Deselect all");
  expect(p.onStart).not.toHaveBeenCalled();
  const member = m.buttons.find(button => button.accessibilityRole === "checkbox");
  expect(member.accessibilityState.checked).toBe(true);
  expect(member.disabled).toBeFalsy();
  expect(member.onPress).toBeTypeOf("function");
  start().onPress();
  expect(p.onStart).toHaveBeenCalledWith([2]);
});
it.each(["unavailable", "busy", "no invitees", "host removed"])("cannot start when %s", condition => {
  const p = base();
  if (condition === "unavailable") p.startAvailable = false;
  if (condition === "busy") p.busy = true;
  if (condition === "no invitees") p.members = p.members.slice(0, 1);
  if (condition === "host removed") p.members = p.members.slice(1);
  renderToStaticMarkup(createElement(ChannelMeetingPicker, p));
  expect(start().disabled).toBe(true);
  start().onPress();
  expect(p.onStart).not.toHaveBeenCalled();
});
it("has a cancel escape and honestly explains unavailable creation", () => {
  const p = { ...base(), startAvailable: false };
  const html = renderToStaticMarkup(createElement(ChannelMeetingPicker, p));
  expect(html).toContain("No invitations have been sent");
  m.buttons.find(button => button.accessibilityLabel === "Cancel meeting selection").onPress();
  expect(p.onCancel).toHaveBeenCalledOnce();
  expect(p.onStart).not.toHaveBeenCalled();
});
it("keeps cancellation available while the authorized channel roster loads", () => {
  const p = { ...base(), loading: true, startAvailable: false };
  const html = renderToStaticMarkup(createElement(ChannelMeetingPicker, p));
  expect(html).toContain("Loading channel members");
  expect(html).not.toContain("selected");
  expect(html).not.toContain("Deselect all");
  expect(m.inputs[0].editable).toBe(false);
  expect(start().disabled).toBe(true);
  m.buttons.find(button => button.accessibilityLabel === "Cancel meeting selection").onPress();
  expect(p.onCancel).toHaveBeenCalledOnce();
  expect(p.onStart).not.toHaveBeenCalled();
});
it("shows a roster failure without stale members, selection controls, or a start path", () => {
  const p = { ...base(), rosterError: "Could not load authorized members." };
  const html = renderToStaticMarkup(createElement(ChannelMeetingPicker, p));
  expect(html).toContain("Could not load authorized members");
  expect(html).not.toContain("No matching members");
  expect(html).not.toContain("Member");
  expect(html).not.toContain("selected");
  expect(html).not.toContain("Deselect all");
  expect(m.inputs[0].editable).toBe(false);
  expect(start().disabled).toBe(true);
});
it("unmounts hidden selection and changes the reset key for account, channel or roster changes", () => {
  const p = base();
  expect(ChannelMeetingPicker({ ...p, visible: false })).toBeNull();
  const key = ChannelMeetingPicker(p)!.key;
  expect(ChannelMeetingPicker({ ...p, hostId: 2 })!.key).not.toBe(key);
  expect(ChannelMeetingPicker({ ...p, tenantId: 2 })!.key).not.toBe(key);
  expect(ChannelMeetingPicker({ ...p, channelId: "channel-b" })!.key).not.toBe(key);
  expect(ChannelMeetingPicker({ ...p, members: p.members.slice(0, 1) })!.key).not.toBe(key);
});
it("requires reducing an oversized default selection before start", () => {
  const p = base();
  p.maxSelectedMembers = 1;
  p.members.push({ id: 3, name: "Third", extension: null });
  const html = renderToStaticMarkup(createElement(ChannelMeetingPicker, p));
  expect(html).toContain("Select up to 1 members");
  expect(start().disabled).toBe(true);
  start().onPress();
  expect(p.onStart).not.toHaveBeenCalled();
});
