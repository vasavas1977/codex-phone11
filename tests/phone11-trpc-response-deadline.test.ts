import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  API_TIMEOUT_MS,
  fetchTrpcJsonWithTimeout,
  fetchWithTimeout,
} from "../lib/_core/api";
import { createTRPCClient } from "../lib/trpc";

const m = vi.hoisted(() => {
  vi.stubEnv("EXPO_PUBLIC_API_BASE_URL", "https://phone11.test");
  return {
    platform: { OS: "web" },
    token: vi.fn(async () => null as string | null),
  };
});
vi.mock("react-native", () => ({ Platform: m.platform }));
vi.mock("../lib/_core/auth", () => ({ getSessionToken: m.token }));

let fetchMock: ReturnType<typeof vi.fn>;
const encoded = (value: unknown) =>
  JSON.stringify([{ result: { data: { json: value } } }]);
const request = (signal?: AbortSignal) =>
  createTRPCClient().pbx.tenant.memberships.query(undefined, { signal });
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
function streamResponse() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel,
  });
  return {
    response: new Response(body, {
      headers: { "content-type": "application/json" },
    }),
    body,
    controller,
    cancel,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("EXPO_PUBLIC_API_BASE_URL", "https://phone11.test");
  m.platform.OS = "web";
  m.token.mockReset();
  m.token.mockResolvedValue(null);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("nonstreaming tRPC response deadline", () => {
  it("bounds the actual httpBatchLink consumer after headers and cancels/releases its stalled body", async () => {
    const s = streamResponse();
    fetchMock.mockResolvedValue(s.response);
    const result = request();
    const failure = expect(result).rejects.toThrow("too long");
    await flush();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(s.body.locked).toBe(true);
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS);
    await failure;
    expect(s.cancel).toHaveBeenCalledOnce();
    expect(s.body.locked).toBe(false);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses one deadline across delayed headers and delayed body rather than restarting it", async () => {
    const s = streamResponse();
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => setTimeout(() => resolve(s.response), 9_000)),
    );
    const result = request();
    const failure = expect(result).rejects.toThrow("too long");
    await vi.advanceTimersByTimeAsync(9_001);
    expect(s.body.locked).toBe(true);
    await vi.advanceTimersByTimeAsync(6_001);
    await failure;
    expect(s.cancel).toHaveBeenCalledOnce();
    expect(s.body.locked).toBe(false);
  });

  it("decodes delayed split UTF8 batch JSON without changing serialization or cookie options", async () => {
    const s = streamResponse();
    fetchMock.mockResolvedValue(s.response);
    const rows = [{ userId: 9, tenantId: 7, tenantName: "ไทย", role: "admin" }];
    const result = request();
    await vi.advanceTimersByTimeAsync(1);
    const bytes = new TextEncoder().encode("\ufeff" + encoded(rows));
    for (let i = 0; i < bytes.length; i += 2)
      s.controller.enqueue(bytes.slice(i, i + 2));
    await vi.advanceTimersByTimeAsync(300);
    s.controller.close();
    await expect(result).resolves.toEqual(rows);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(
      /^https:\/\/phone11\.test\/api\/trpc\/pbx\.tenant\.memberships/,
    );
    expect(fetchMock.mock.calls[0][1].credentials).toBe("include");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(s.body.locked).toBe(false);
    expect(s.cancel).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves native bearer headers and omits browser credentials", async () => {
    m.platform.OS = "ios";
    m.token.mockResolvedValue("synthetic-native-token");
    fetchMock.mockResolvedValue(new Response(encoded([])));
    const result = request();
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual([]);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer synthetic-native-token",
    );
    expect(fetchMock.mock.calls[0][1].credentials).toBe("omit");
  });

  it("preserves tRPC structured errors and response status/headers metadata", async () => {
    const payload = [
      {
        error: {
          json: {
            message: "Sign in required",
            code: -32001,
            data: { code: "UNAUTHORIZED", httpStatus: 401 },
          },
        },
      },
    ];
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 401,
        headers: { "x-fixture": "owned" },
      }),
    );
    const result = request();
    const caught = result.catch((e) => e);
    await vi.advanceTimersByTimeAsync(1);
    const e = await caught;
    {
      expect(e.message).toBe("Sign in required");
      expect(e.data.code).toBe("UNAUTHORIZED");
      expect(e.meta.response.status).toBe(401);
      expect(e.meta.response.headers.get("x-fixture")).toBe("owned");
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retains JSON parse errors at the consumer and a single-use json method", async () => {
    fetchMock.mockResolvedValueOnce(new Response("not json"));
    const bad = await fetchTrpcJsonWithTimeout("/owned");
    await expect(bad.json()).rejects.toBeInstanceOf(SyntaxError);
    fetchMock.mockResolvedValueOnce(
      new Response('{"owned":true}', { status: 202, statusText: "Accepted" }),
    );
    const good = await fetchTrpcJsonWithTimeout("/owned");
    expect(good.bodyUsed).toBe(false);
    expect(good.status).toBe(202);
    expect(good.statusText).toBe("Accepted");
    await expect(good.json()).resolves.toEqual({ owned: true });
    expect(good.bodyUsed).toBe(true);
    await expect(good.json()).rejects.toBeInstanceOf(TypeError);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("matches native replacement decoding for malformed UTF8 and retains non-JSON HTTP errors", async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x22, 0xc3, 0x28, 0x22]);
    const expected = await new Response(bytes).json();
    fetchMock.mockResolvedValueOnce(new Response(bytes));
    const decoded = await fetchTrpcJsonWithTimeout("/owned");
    await expect(decoded.json()).resolves.toBe(expected);

    fetchMock.mockResolvedValueOnce(
      new Response("upstream unavailable", { status: 502 }),
    );
    const failed = await fetchTrpcJsonWithTimeout("/owned");
    expect(failed.status).toBe(502);
    expect(failed.ok).toBe(false);
    expect(failed.bodyUsed).toBe(false);
    await expect(failed.json()).rejects.toBeInstanceOf(SyntaxError);
    expect(failed.bodyUsed).toBe(true);
    await expect(failed.json()).rejects.toBeInstanceOf(TypeError);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects an already-aborted caller before fetch and removes its listener", async () => {
    const c = new AbortController();
    c.abort();
    const remove = vi.spyOn(c.signal, "removeEventListener");
    await expect(
      fetchTrpcJsonWithTimeout("/owned", { signal: c.signal }),
    ).rejects.toThrow("too long");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("settles caller abort before headers even when fetch ignores cancellation, then cancels a late response", async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    );
    const c = new AbortController(),
      remove = vi.spyOn(c.signal, "removeEventListener");
    const result = fetchTrpcJsonWithTimeout("/owned", { signal: c.signal });
    const failure = expect(result).rejects.toThrow("too long");
    await flush();
    c.abort();
    await failure;
    expect(vi.getTimerCount()).toBe(0);
    const s = streamResponse();
    resolve(s.response);
    await flush();
    expect(s.cancel).toHaveBeenCalledOnce();
    expect(s.body.locked).toBe(false);
    expect(remove).toHaveBeenCalled();
  });

  it("settles caller abort during body, cancels/releases the reader and cannot later succeed", async () => {
    const s = streamResponse();
    fetchMock.mockResolvedValue(s.response);
    const c = new AbortController();
    const result = fetchTrpcJsonWithTimeout("/owned", { signal: c.signal });
    const failure = expect(result).rejects.toThrow("too long");
    await flush();
    expect(s.body.locked).toBe(true);
    c.abort();
    await failure;
    await flush();
    expect(s.cancel).toHaveBeenCalledOnce();
    expect(s.body.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not await or leak a rejecting cancellation promise", async () => {
    let rejectCancel!: (e: Error) => void;
    const body = new ReadableStream({
      cancel: () =>
        new Promise((_, reject) => {
          rejectCancel = reject;
        }),
    });
    fetchMock.mockResolvedValue(new Response(body));
    const result = fetchTrpcJsonWithTimeout("/owned");
    const failure = expect(result).rejects.toThrow("too long");
    await flush();
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS);
    await failure;
    expect(body.locked).toBe(false);
    rejectCancel(new Error("owned cancel failed"));
    await flush();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds a Blob-backed/no-reader native json consumer without requiring a stream polyfill", async () => {
    let resolve!: (v: unknown) => void;
    fetchMock.mockResolvedValue({
      body: undefined,
      json: () =>
        new Promise((r) => {
          resolve = r;
        }),
    });
    const result = fetchTrpcJsonWithTimeout("/owned");
    const failure = expect(result).rejects.toThrow("too long");
    await flush();
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS);
    await failure;
    resolve({ late: true });
    await flush();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("allows a fresh explicit request after timeout and leaves generic streaming fetch headers-only", async () => {
    const stalled = streamResponse();
    fetchMock.mockResolvedValueOnce(stalled.response);
    const old = fetchTrpcJsonWithTimeout("/owned");
    const failure = expect(old).rejects.toThrow("too long");
    await flush();
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS);
    await failure;
    fetchMock.mockResolvedValueOnce(new Response('{"fresh":true}'));
    await expect(
      (await fetchTrpcJsonWithTimeout("/owned")).json(),
    ).resolves.toEqual({ fresh: true });
    const streaming = streamResponse();
    fetchMock.mockResolvedValueOnce(streaming.response);
    expect(await fetchWithTimeout("/streaming")).toBe(streaming.response);
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS * 2);
    expect(streaming.cancel).not.toHaveBeenCalled();
    expect(streaming.body.locked).toBe(false);
    await streaming.body.cancel();
    expect(vi.getTimerCount()).toBe(0);
  });
});
