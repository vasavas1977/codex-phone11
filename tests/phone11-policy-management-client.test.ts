import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ fetch: vi.fn(), token: "generated-token" }));
vi.mock("@trpc/react-query", async () => {
  const { createTRPCProxyClient } = await import("@trpc/client");
  return { createTRPCReact: () => ({ createClient: createTRPCProxyClient }) };
});
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("../constants/oauth", () => ({ getApiBaseUrl: () => "https://api.example.test" }));
vi.mock("../lib/_core/auth", () => ({ getSessionToken: async () => m.token }));
vi.mock("../lib/_core/api", () => ({ fetchTrpcJsonWithTimeout: m.fetch }));
import { createTRPCClient } from "../lib/trpc";

beforeEach(() => {
  m.fetch.mockReset().mockImplementation(async (url: string) => {
    const target = new URL(url);
    const paths = target.pathname.split("/").at(-1)!.split(",");
    const data = paths.map(() => ({ result: { data: { json: { success: true } } } }));
    return new Response(JSON.stringify(target.searchParams.has("batch") ? data : data[0]), { headers: { "Content-Type": "application/json" } });
  });
});
it("isolates the exact three policy procedures while preserving unrelated batching and credentials", async () => {
  const client = createTRPCClient();
  await Promise.all([
    client.pbx.capabilities.query({ tenantId: 7 }),
    client.pbx.fraudControls.get.query({ tenantId: 7 }),
    client.pbx.fraudControls.update.mutate({ tenantId: 7, internationalEnabled: false }),
    client.phone.getConfig.query(),
    client.chat.list.query(),
  ]);
  const calls = m.fetch.mock.calls.map(([url, options]) => ({ url: new URL(String(url)), options }));
  expect(calls).toHaveLength(4);
  for (const path of ["pbx.capabilities", "pbx.fraudControls.get", "pbx.fraudControls.update"]) {
    const request = calls.find(call => call.url.pathname === `/api/trpc/${path}`)!;
    expect(request).toBeDefined(); expect(request.url.searchParams.has("batch")).toBe(false);
    expect(request.options.credentials).toBe("include");
    expect(new Headers(request.options.headers).get("authorization")).toBe("Bearer generated-token");
    expect(request.options.method).toBe(path.endsWith("update") ? "POST" : "GET");
  }
  const batch = calls.find(call => call.url.searchParams.get("batch") === "1")!;
  expect(batch.url.pathname).toBe("/api/trpc/phone.getConfig,chat.list");
});
