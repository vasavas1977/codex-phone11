import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ service: { list: vi.fn(), directory: vi.fn(), create: vi.fn(), history: vi.fn(), search: vi.fn(), send: vi.fn(), read: vi.fn() } }));
vi.mock("../server/chat/service", () => ({ createChatService: () => m.service }));
vi.mock("../server/_core/phone11-auth", () => ({ readAuthConfig: () => ({ trustedOrigins: ["https://phone11.example.test"] }) }));
import { chatRouter } from "../server/chat/router";
import { phone11Cors } from "../server/_core/auth-routes";
const room = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function caller(header: string | string[] | undefined, userId = 2) {
  return chatRouter.createCaller({ user: { id: userId } as any, req: { headers: { "x-phone11-chat-owner": header } } as any, res: {} as any });
}
beforeEach(() => vi.clearAllMocks());
it.each(["list", "directory", "create", "history", "search", "send", "read"] as const)("blocks %s before service access if browser cookies identify a replacement actor", async operation => {
  const api = caller("1");
  const calls = {
    list: () => api.list({ tenantId: 10 }), directory: () => api.directory({ tenantId: 10 }),
    create: () => api.create({ tenantId: 10, kind: "group", name: "Private group", memberIds: [3] }),
    history: () => api.history({ tenantId: 10, id: room }), search: () => api.search({ tenantId: 10, id: room, text: "private" }),
    send: () => api.send({ tenantId: 10, id: room, clientId: room, content: "old actor's message" }),
    read: () => api.read({ tenantId: 10, id: room, through: 1 }),
  };
  await expect(calls[operation]()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  for (const method of Object.values(m.service)) expect(method).not.toHaveBeenCalled();
});
it.each(["", "02", ["2", "1"]])("rejects malformed or ambiguous owner assertion %j", async header => {
  await expect(caller(header).list()).rejects.toMatchObject({ code: "UNAUTHORIZED" }); expect(m.service.list).not.toHaveBeenCalled();
});
it("uses the authenticated user when the expected owner matches", async () => {
  await caller("2").list({ tenantId: 10 }); expect(m.service.list).toHaveBeenCalledWith(2, 10);
});
it("keeps pre-header installed clients compatible without treating omission as actor binding", async () => {
  await caller(undefined).list({ tenantId: 10 }); expect(m.service.list).toHaveBeenCalledWith(2, 10);
});
it("permits the actor assertion in trusted-origin preflight without weakening origin checks", () => {
  const response = { vary: vi.fn(), setHeader: vi.fn(), sendStatus: vi.fn(), status: vi.fn(), json: vi.fn() };
  response.status.mockReturnValue(response);
  const next = vi.fn();
  phone11Cors({ headers: { origin: "https://phone11.example.test" }, method: "OPTIONS" } as any, response as any, next);
  expect(response.setHeader).toHaveBeenCalledWith("Access-Control-Allow-Headers", expect.stringContaining("X-Phone11-Chat-Owner"));
  expect(response.sendStatus).toHaveBeenCalledWith(204); expect(next).not.toHaveBeenCalled();
  response.setHeader.mockClear();
  phone11Cors({ headers: { origin: "https://untrusted.example.test" }, method: "OPTIONS" } as any, response as any, next);
  expect(response.status).toHaveBeenCalledWith(403); expect(response.setHeader).not.toHaveBeenCalled();
});
