import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
import { beforeEach, expect, it, vi } from "vitest";
const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as { renderToStaticMarkup(node: ReactNode): string };
const m = vi.hoisted(() => ({ buttons: [] as any[], inputs: [] as any[], keyboardAvoiders: [] as any[], rosterScrollViews: [] as any[], platformOS: "ios" }));
vi.mock("react-native", () => ({
  Modal: ({ children }: any) => createElement("div", {}, children),
  View: ({ children }: any) => createElement("div", {}, children),
  KeyboardAvoidingView: (props: any) => { m.keyboardAvoiders.push(props); return createElement("div", {}, props.children); },
  Platform: { get OS() { return m.platformOS; } },
  ScrollView: (props: any) => { m.rosterScrollViews.push(props); return createElement("div", {}, props.children); },
  Text: ({ children }: any) => createElement("span", {}, children),
  TextInput: (props: any) => { m.inputs.push(props); return createElement("input", { disabled: props.editable === false }); },
  Pressable: (props: any) => { m.buttons.push(props); return createElement("button", { disabled: props.disabled, "aria-label": props.accessibilityLabel }, props.children); },
}));
vi.mock("../hooks/use-colors", () => ({ useColors: () => ({ primary: "#0055ff", foreground: "#111", muted: "#666", background: "#fff", surface: "#eee", border: "#ddd", error: "#c00" }) }));
vi.mock("../components/profile/profile-avatar", () => ({ ProfileAvatar: (props: any) => createElement("i", {
  "data-avatar-user": props.userId,
  "data-avatar-tenant": props.tenantId,
  "data-avatar-photo": props.photoUrl ?? "",
}, props.name) }));
import { ChannelMeetingPicker, channelInvitees, type ChannelMeetingPickerProps } from "../components/chat/channel-meeting-picker";
const base = (): ChannelMeetingPickerProps => ({ visible: true, tenantId: 1, channelId: "channel-a", channelName: "Project", hostId: 1, members: [{ id: 1, name: "Host", extension: null }, { id: 2, name: "Member", extension: "1020" }], startAvailable: true, onCancel: vi.fn(), onStart: vi.fn() });
beforeEach(() => { m.buttons = []; m.inputs = []; m.keyboardAvoiders = []; m.rosterScrollViews = []; m.platformOS = "ios"; });
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
it("binds each invitee avatar to the authorized tenant, member id, and photo descriptor", () => {
  const p = base();
  p.members[1].photoUrl = "/api/profile/photo/1/2?v=8e1a30ce-3d1e-4d82-a011-24d21e326cf9";
  p.members.push({ id: 3, name: "Second member", extension: null, photoUrl: null });

  const html = renderToStaticMarkup(createElement(ChannelMeetingPicker, p));

  expect(html).toContain('data-avatar-user="2" data-avatar-tenant="1" data-avatar-photo="/api/profile/photo/1/2?v=8e1a30ce-3d1e-4d82-a011-24d21e326cf9"');
  expect(html).toContain('data-avatar-user="3" data-avatar-tenant="1" data-avatar-photo=""');
  // The host is not an invitee and must not be rendered as a selectable row.
  expect(html).not.toContain('data-avatar-user="1"');
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
  const contentKey = (props: ChannelMeetingPickerProps) => ChannelMeetingPicker(props)!.props.children.key;
  const key = contentKey(p);
  expect(contentKey({ ...p, hostId: 2 })).not.toBe(key);
  expect(contentKey({ ...p, tenantId: 2 })).not.toBe(key);
  expect(contentKey({ ...p, channelId: "channel-b" })).not.toBe(key);
  expect(contentKey({ ...p, members: p.members.slice(0, 1) })).not.toBe(key);
  expect(contentKey({ ...p, startAvailable: false, maxSelectedMembers: 1 })).toBe(key);
});
it("keeps the native modal stable while an async roster remounts selected content", () => {
  const loading = { ...base(), members: [], loading: true };
  const loaded = { ...loading, members: base().members, loading: false };
  const first = ChannelMeetingPicker(loading)!;
  const second = ChannelMeetingPicker(loaded)!;

  expect(first.type).toBe(second.type);
  expect(first.key).toBe(second.key);
  expect(first.props.children.key).not.toBe(second.props.children.key);

  const html = renderToStaticMarkup(second);
  expect(html).toContain("1 selected");
  expect(m.buttons.find(button => button.accessibilityRole === "checkbox").accessibilityState.checked).toBe(true);
});
it("uses iOS keyboard padding and a shrinkable roster without adding a second offset", () => {
  const p = base();
  renderToStaticMarkup(createElement(ChannelMeetingPicker, p));

  expect(m.keyboardAvoiders).toHaveLength(1);
  expect(m.keyboardAvoiders[0]).toMatchObject({ behavior: "padding", style: { flex: 1 } });
  expect(m.keyboardAvoiders[0]).not.toHaveProperty("keyboardVerticalOffset");
  expect(m.rosterScrollViews[0]).toMatchObject({
    keyboardShouldPersistTaps: "handled",
    style: { flexShrink: 1, minHeight: 0 },
  });

  const android = { ...p };
  m.platformOS = "android";
  renderToStaticMarkup(createElement(ChannelMeetingPicker, android));
  expect(m.keyboardAvoiders[1].behavior).toBeUndefined();

  m.platformOS = "web";
  renderToStaticMarkup(createElement(ChannelMeetingPicker, p));
  expect(m.keyboardAvoiders[2].behavior).toBeUndefined();
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
