import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { createRequire } from "node:module";
const { renderToStaticMarkup } = createRequire(import.meta.url)(
  "react-dom/server",
) as { renderToStaticMarkup(node: ReactNode): string };
const mocks = vi.hoisted(() => ({
  user: { id: 1 } as { id: number } | null,
  authUser: { id: 1 } as { id: number } | null,
  phone: {} as any,
  calls: { activeCalls: {}, incomingCall: null } as any,
  makeCall: vi.fn(
    async (_number: string, _video?: boolean): Promise<string | null> =>
      "real-call-1",
  ),
  push: vi.fn(),
  alert: vi.fn(),
}));
vi.mock("react-native", () => ({ Alert: { alert: mocks.alert } }));
vi.mock("expo-router", () => ({ router: { push: mocks.push } }));
vi.mock("../hooks/use-auth", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("../lib/_core/auth", () => ({
  getAuthSnapshot: () => ({ user: mocks.authUser }),
}));
vi.mock("../lib/sip/sip-provider", () => ({
  useSip: () => ({ makeCall: mocks.makeCall }),
}));
vi.mock("../lib/sip/account-store", () => ({
  useSipAccountStore: { getState: () => mocks.phone },
}));
vi.mock("../lib/sip/call-store", () => ({
  useSipCallStore: { getState: () => mocks.calls },
}));
import { usePhoneCall } from "../hooks/use-phone-call";
function renderHook() {
  let hook: ReturnType<typeof usePhoneCall> | undefined;
  function Component() {
    hook = usePhoneCall();
    return null;
  }
  renderToStaticMarkup(createElement(Component));
  return hook!;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: 1 };
  mocks.authUser = { id: 1 };
  mocks.phone = {
    account: {
      ownerUserId: 1,
      tenantId: 7,
      id: "primary",
      enabled: true,
      username: "3001",
      domain: "sip.example.test",
    },
    registrationState: "registered",
  };
  mocks.calls = { activeCalls: {}, incomingCall: null };
  mocks.makeCall.mockResolvedValue("real-call-1");
});
describe("real phone call entry", () => {
  it("opens controls only after the engine returns its actual call ID", async () => {
    const request = deferred<string | null>();
    mocks.makeCall.mockReturnValueOnce(request.promise);
    const call = renderHook().placeCall(" 3002 ");
    expect(mocks.makeCall).toHaveBeenCalledWith("3002", false);
    expect(mocks.push).not.toHaveBeenCalled();
    request.resolve("native-55");
    await call;
    expect(mocks.push).toHaveBeenCalledWith({
      pathname: "/call/active",
      params: { callId: "native-55", number: "3002", type: "voice" },
    });
  });
  it("does not create a fake session after rejection or a null result", async () => {
    const hook = renderHook();
    mocks.makeCall.mockRejectedValueOnce(new Error("Transport failed"));
    await hook.placeCall("3002");
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledWith(
      "Call could not start",
      expect.any(String),
    );
    mocks.makeCall.mockResolvedValueOnce(null);
    await hook.placeCall("3002");
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.makeCall).toHaveBeenCalledTimes(2);
  });
  it("suppresses duplicate taps while the same call is starting and permits retry after failure", async () => {
    const request = deferred<string | null>();
    mocks.makeCall.mockReturnValueOnce(request.promise);
    const hook = renderHook();
    const first = hook.placeCall("3002");
    await hook.placeCall("3003");
    expect(mocks.makeCall).toHaveBeenCalledTimes(1);
    request.reject(new Error("Failed"));
    await first;
    await hook.placeCall("3003");
    expect(mocks.makeCall).toHaveBeenCalledTimes(2);
  });
  it("requires the authenticated owner's enabled phone account", async () => {
    const hook = renderHook();
    mocks.phone.account.ownerUserId = 99;
    await hook.placeCall("3002");
    expect(mocks.makeCall).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledWith(
      "Set up your work phone",
      expect.any(String),
      expect.any(Array),
    );
    mocks.phone.account.ownerUserId = 1;
    mocks.phone.account.enabled = false;
    await hook.placeCall("3002");
    expect(mocks.makeCall).not.toHaveBeenCalled();
  });
  it("redirects a stale signed-in handler to sign-in without calling", async () => {
    const hook = renderHook();
    mocks.authUser = null;
    await hook.placeCall("3002");
    expect(mocks.makeCall).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledWith("/auth/sign-in");
  });
  it("returns to an existing active or incoming session instead of placing a second call", async () => {
    const hook = renderHook();
    mocks.calls.activeCalls = {
      existing: { id: "existing", status: "active" },
    };
    await hook.placeCall("3002");
    expect(mocks.makeCall).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenLastCalledWith({
      pathname: "/call/active",
      params: { callId: "existing" },
    });
    mocks.calls = {
      activeCalls: {},
      incomingCall: { id: "incoming-22", status: "incoming" },
    };
    await hook.placeCall("3002");
    expect(mocks.push).toHaveBeenLastCalledWith({
      pathname: "/call/incoming",
      params: { callId: "incoming-22" },
    });
  });
  it("shows actionable offline state without trying a call or navigating", async () => {
    mocks.phone.registrationState = "network_error";
    await renderHook().placeCall("3002");
    expect(mocks.makeCall).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledWith(
      "Phone is connecting",
      expect.stringContaining("Reconnect"),
    );
  });
  it("ignores a successful call result after a user switch", async () => {
    const request = deferred<string | null>();
    mocks.makeCall.mockReturnValueOnce(request.promise);
    const call = renderHook().placeCall("3002");
    mocks.authUser = { id: 2 };
    request.resolve("old-user-call");
    await call;
    expect(mocks.push).not.toHaveBeenCalled();
  });
  it("ignores a call result after a same-user account or tenant switch", async () => {
    const request = deferred<string | null>();
    mocks.makeCall.mockReturnValueOnce(request.promise);
    const call = renderHook().placeCall("3002");
    mocks.phone.account = {
      ...mocks.phone.account,
      tenantId: 8,
      username: "9001",
    };
    request.resolve("old-tenant-call");
    await call;
    expect(mocks.push).not.toHaveBeenCalled();
  });
  it("does not show a stale call failure after sign-out", async () => {
    const request = deferred<string | null>();
    mocks.makeCall.mockReturnValueOnce(request.promise);
    const call = renderHook().placeCall("3002");
    mocks.authUser = null;
    request.reject(new Error("Old request failed"));
    await call;
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.alert).not.toHaveBeenCalled();
  });
});
