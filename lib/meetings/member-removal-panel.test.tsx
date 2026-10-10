import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MeetingMemberRemovalPanel } from "./member-removal-panel";
const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as { renderToStaticMarkup(node: ReactNode): string };
const ui = vi.hoisted(() => ({
  index: 0, state: [] as unknown[], memo: [] as { deps: unknown[]; value: unknown }[],
  effects: [] as { deps: unknown[]; cleanup?: () => void }[], buttons: [] as Record<string, any>[],
  owner: { id: 7, name: "Host" }, currentOwner: null as unknown, currentMeeting: null as unknown,
  platform: "web", snapshot: vi.fn(), request: vi.fn(), poll: vi.fn(), utilities: null as any,
}));
const same = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => { const index = ui.index++; if (!(index in ui.state)) ui.state[index] = initial;
    return [ui.state[index], (value: unknown) => { ui.state[index] = value; }]; },
  useMemo: (make: () => unknown, deps: unknown[]) => { const index = ui.index++;
    if (!ui.memo[index] || !same(ui.memo[index].deps, deps)) ui.memo[index] = { deps, value: make() };
    return ui.memo[index].value; },
  useEffect: (make: () => void | (() => void), deps: unknown[]) => { const index = ui.index++;
    if (!ui.effects[index] || !same(ui.effects[index].deps, deps)) { ui.effects[index]?.cleanup?.();
      ui.effects[index] = { deps, cleanup: make() || undefined }; } },
  useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
}));
vi.mock("react-native", () => ({
  Platform: { get OS() { return ui.platform; } }, StyleSheet: { create: (value: unknown) => value },
  View: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  ScrollView: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  Text: ({ children }: { children: ReactNode }) => createElement("span", null, children),
  ActivityIndicator: () => createElement("span", null, "Loading"),
  Modal: ({ children, visible }: { children: ReactNode; visible: boolean }) => visible ? createElement("div", null, children) : null,
  Pressable: (props: Record<string, any>) => { ui.buttons.push(props); return createElement("button", { disabled: props.disabled }, props.children); },
}));
vi.mock("@/lib/_core/auth", () => ({ getAuthSnapshot: () => ({ user: ui.currentOwner }) }));
vi.mock("./native-session-registry", () => ({ getActiveNativeMeeting: () => ui.currentMeeting }));
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => ui.utilities,
  meetings: { removeMember: { useMutation: () => ({ mutateAsync: ui.request }) } } } }));
vi.mock("@/components/profile/profile-avatar", () => ({ ProfileAvatar: ({ name }: { name: string }) => createElement("span", null, name) }));
const meetingId = "12345678-1234-4234-8234-123456789012";
const scope = () => ({ available: true, meetingId, tenantId: 41,
  members: [{ userId: 8, name: "Member Eight", expectedParticipantId: "member_8", expectedRoomRevision: "22345678-1234-4234-8234-123456789012", expectedMemberRevision: "32345678-1234-4234-8234-123456789012", state: "admitted" }] });
const pending = () => ({ operationId: "22345678-1234-4234-8234-123456789012", expectedRoomRevision: "22345678-1234-4234-8234-123456789012", expectedMemberRevision: "22345678-1234-4234-8234-123456789012", state: "pending", providerAcknowledged: false });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
function fixture() {
  const connection = { status: "connected", participants: [{ identity: "provider_opaque_identity", name: "Member Eight" }] };
  const room = {};
  const listeners = new Set<() => void>();
  const publish = (status: string) => { connection.status = status; listeners.forEach(listener => listener()); };
  const meeting = { ownerId: 7, meetingId, room, wasInterruptedBySip: false, receiveOnly: false,
    leave: vi.fn(), session: { subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, getSnapshot: () => connection } };
  ui.currentMeeting = meeting; const props = { meeting, owner: ui.owner } as never;
  const render = () => { ui.index = 0; ui.buttons = []; return renderToStaticMarkup(createElement(MeetingMemberRemovalPanel, props)); };
  const button = (label: string) => { const found = ui.buttons.find(row => row.accessibilityLabel === label); if (!found) throw new Error("Missing UI control: " + label); return found; };
  const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
  const confirm = async () => {
    render(); await flush(); render(); button("Manage admitted meeting members").onPress(); render();
    button("Remove meeting access for Member Eight").onPress(); render(); return button("Confirm permanent meeting removal").onPress as () => void;
  };
  return { meeting, connection, publish, render, button, flush, confirm };
}
beforeEach(() => {
  ui.effects.forEach(effect => effect?.cleanup?.()); ui.index = 0; ui.state = []; ui.memo = []; ui.effects = []; ui.buttons = [];
  ui.owner = { id: 7, name: "Host" }; ui.currentOwner = ui.owner; ui.platform = "web";
  ui.snapshot.mockReset().mockResolvedValue(scope()); ui.request.mockReset().mockResolvedValue(pending());
  ui.poll.mockReset().mockResolvedValue({ ...pending(), state: "completed", providerAcknowledged: true });
  ui.utilities = { client: { meetings: { hostControls: { query: ui.snapshot }, removalStatus: { query: ui.poll } } },
    meetings: { hostControls: { fetch: vi.fn(() => { throw new Error("Do not reuse cached authority"); }) } } };
});
describe("actual shared meeting removal callbacks", () => {
  it.each(["web", "ios", "android"])("requires confirmation, retains live media roster and distinguishes pending on %s", async platform => {
    ui.platform = platform; const f = fixture(); const confirm = await f.confirm();
    expect(ui.request).not.toHaveBeenCalled(); confirm(); await f.flush();
    expect(ui.request).toHaveBeenCalledWith({ tenantId: 41, meetingId, targetUserId: 8, expectedParticipantId: "member_8", expectedRoomRevision: "22345678-1234-4234-8234-123456789012", expectedMemberRevision: "32345678-1234-4234-8234-123456789012" });
    expect(f.render()).toContain("removal pending; departure is not confirmed");
    expect(f.connection.participants).toHaveLength(1); expect(f.meeting.leave).not.toHaveBeenCalled();
    f.button("Check removal status for Member Eight").onPress(); await f.flush();
    expect(f.render()).toContain("service acknowledged removal"); expect(f.connection.participants).toHaveLength(1);
  });
  it.each(["same-ID replacement", "another account", "another room", "SIP interruption", "reconnecting", "connection cycle without render", "unmount"])("refuses a retained confirm after %s", async reason => {
    const f = fixture(); const confirm = await f.confirm();
    if (reason === "same-ID replacement") ui.currentOwner = { ...ui.owner };
    if (reason === "another account") ui.currentOwner = { id: 9, name: "Another" };
    if (reason === "another room") ui.currentMeeting = { ...f.meeting };
    if (reason === "SIP interruption") f.meeting.wasInterruptedBySip = true;
    if (reason === "reconnecting") f.connection.status = "reconnecting";
    if (reason === "connection cycle without render") { f.publish("reconnecting"); f.publish("connected"); }
    if (reason === "unmount") ui.effects.forEach(effect => effect?.cleanup?.());
    confirm(); await f.flush(); expect(ui.request).not.toHaveBeenCalled();
  });
  it.each(["snapshot", "request"])("retires an asynchronous %s completion across a connection cycle without rendering", async phase => {
    const f = fixture();
    if (phase === "snapshot") {
      const wait = deferred<ReturnType<typeof scope>>(); ui.snapshot.mockReturnValueOnce(wait.promise);
      f.render(); f.publish("reconnecting"); f.publish("connected"); wait.resolve(scope()); await f.flush();
    } else {
      const confirm = await f.confirm(); const wait = deferred<ReturnType<typeof pending>>();
      ui.request.mockReturnValueOnce(wait.promise); confirm(); f.publish("reconnecting"); f.publish("connected");
      wait.resolve({ ...pending(), state: "completed", providerAcknowledged: true }); await f.flush();
    }
    expect(f.render()).toBe(""); expect(ui.poll).not.toHaveBeenCalled();
  });
  it("ordinary profile refresh preserves the initiating owner and valid confirm", async () => {
    const f = fixture(); const confirm = await f.confirm(); ui.owner.name = "Updated profile";
    confirm(); await f.flush(); expect(ui.request).toHaveBeenCalledTimes(1);
  });
  it("provider/authorization rejection clears the old admitted row and refresh retains durable pending", async () => {
    const f = fixture(); const confirm = await f.confirm(); ui.request.mockRejectedValueOnce(new Error("private provider detail"));
    confirm(); await f.flush(); const failed = f.render();
    expect(failed).toContain("do not assume the member has left"); expect(failed).not.toContain("Meeting access admitted");
    expect(failed).not.toContain("private provider detail");
    ui.snapshot.mockResolvedValueOnce({ ...scope(), members: [{ ...scope().members[0], state: "pending" }] });
    f.button("Refresh meeting access controls").onPress(); await f.flush();
    expect(f.render()).toContain("removal pending; departure is not confirmed");
    confirm(); await f.flush(); expect(ui.request).toHaveBeenCalledTimes(1);
  });
  it("default-off/nonhost snapshot exposes neither names nor a removal control", async () => {
    ui.snapshot.mockResolvedValueOnce({ available: false, meetingId, members: [] }); const f = fixture();
    f.render(); await f.flush(); expect(f.render()).toBe(""); expect(ui.request).not.toHaveBeenCalled();
  });
  it("does not publish a pending request completion after unmount", async () => {
    const f = fixture(); const confirm = await f.confirm(); const wait = deferred<ReturnType<typeof pending>>();
    ui.request.mockReturnValueOnce(wait.promise); confirm(); ui.effects.forEach(effect => effect?.cleanup?.());
    wait.resolve({ ...pending(), state: "completed", providerAcknowledged: true }); await f.flush();
    expect(f.render()).not.toContain("service acknowledged removal");
  });
  it("same-ID replacement performs a fresh direct snapshot instead of inheriting an old pending load", async () => {
    const f = fixture(); const old = deferred<ReturnType<typeof scope>>(); ui.snapshot.mockReturnValueOnce(old.promise);
    f.render(); ui.owner = { id: 7, name: "Fresh session" }; ui.currentOwner = ui.owner;
    ui.snapshot.mockResolvedValueOnce({ available: false, meetingId, tenantId: undefined, members: [] });
    ui.index = 0; ui.buttons = [];
    renderToStaticMarkup(createElement(MeetingMemberRemovalPanel, { meeting: f.meeting, owner: ui.owner } as never));
    await f.flush(); old.resolve(scope()); await f.flush();
    ui.index = 0; ui.buttons = [];
    expect(renderToStaticMarkup(createElement(MeetingMemberRemovalPanel, { meeting: f.meeting, owner: ui.owner } as never))).toBe("");
    expect(ui.snapshot).toHaveBeenCalledTimes(2); expect(ui.utilities.meetings.hostControls.fetch).not.toHaveBeenCalled();
  });
});
