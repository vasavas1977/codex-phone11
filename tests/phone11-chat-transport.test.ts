import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ user: { id: 1 } as { id: number } | null, loading: false, os: "ios", token: vi.fn(), fetch: vi.fn() }));
vi.mock("react-native", () => ({ Platform: { get OS() { return m.os; } } }));
vi.mock("../lib/_core/auth", () => ({ getAuthSnapshot: () => ({ user: m.user, loading: m.loading }), getSessionToken: m.token }));
vi.mock("../lib/_core/api", () => ({ fetchWithTimeout: m.fetch }));
vi.mock("../constants/oauth", () => ({ getApiBaseUrl: () => "https://phone11.example.test" }));
import { createChatTransport } from "../lib/chat/transport";
const row = { id: "row", clientId: "client", channelId: "room", senderId: 1, content: "hello", status: "sent" };
const response = () => new Response(JSON.stringify([{ result: { data: { json: row } } }]), { headers: { "content-type": "application/json" } });
beforeEach(() => { vi.resetAllMocks(); m.user = { id: 1 }; m.loading = false; m.os = "ios"; m.token.mockResolvedValue("synthetic-owner-token"); m.fetch.mockImplementation(async () => response()); });
it("dispatches the actual tRPC message with the captured native bearer and no cookies", async () => {
  expect(await createChatTransport().send(10, "room", "client", "hello")).toEqual(row);
  const [url, init] = m.fetch.mock.calls[0];
  expect(String(url)).toContain("chat.send"); expect(init.credentials).toBe("omit");
  expect(new Headers(init.headers).get("authorization")).toBe("Bearer synthetic-owner-token");
  expect(new Headers(init.headers).get("x-phone11-chat-owner")).toBe("1");
  expect(JSON.parse(init.body)["0"].json).toEqual({ tenantId: 10, id: "room", clientId: "client", content: "hello" });
});
it.each([2, 1])("blocks credential resolution after owner/session replacement (%s)", async id => {
  let finish!: (token: string) => void; m.token.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const request = createChatTransport().send(10, "room", "client", "private draft"); const rejected = expect(request).rejects.toThrow("session changed");
  m.user = { id }; finish("replacement-token"); await rejected; expect(m.fetch).not.toHaveBeenCalled();
});
it("blocks an already queued tRPC batch if its owner changes before dispatch", async () => {
  const request = createChatTransport().send(10, "room", "client", "private draft"); const rejected = expect(request).rejects.toThrow("session changed");
  await Promise.resolve(); m.user = { id: 2 }; await rejected;
  expect(m.fetch).not.toHaveBeenCalled(); expect(m.token).toHaveBeenCalledTimes(1);
});
it("rejects late response content after account switching", async () => {
  let finish!: (result: Response) => void; m.fetch.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const request = createChatTransport().send(10, "room", "client", "private draft"); const rejected = expect(request).rejects.toThrow("session changed");
  await vi.waitFor(() => expect(m.fetch).toHaveBeenCalledTimes(1)); m.user = { id: 2 }; finish(response()); await rejected;
});
it("does not send a native message with missing credentials", async () => {
  m.token.mockResolvedValue(null); await expect(createChatTransport().send(10, "room", "client", "private draft")).rejects.toThrow("Sign in again");
  expect(m.fetch).not.toHaveBeenCalled();
});
it("preserves browser HttpOnly cookie transport without reading a native bearer", async () => {
  m.os = "web"; await createChatTransport().send(10, "room", "client", "hello");
  expect(m.token).not.toHaveBeenCalled(); expect(m.fetch.mock.calls[0][1].credentials).toBe("include");
  expect(new Headers(m.fetch.mock.calls[0][1].headers).has("authorization")).toBe(false);
  expect(new Headers(m.fetch.mock.calls[0][1].headers).get("x-phone11-chat-owner")).toBe("1");
});
