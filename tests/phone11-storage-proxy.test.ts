import { afterAll, beforeAll, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { registerStorageProxy } from "../server/_core/storageProxy";
let server: Server;
let base: string;
beforeAll(async () => {
  const app = express(); registerStorageProxy(app);
  server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.on("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
it("rejects arbitrary legacy keys without calling a storage provider or redirecting", async () => {
  const originalFetch = globalThis.fetch;
  const outbound = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No provider requests permitted"));
  try {
    const response = await originalFetch(`${base}/manus-storage/another-tenant/private-recording.wav`);
    expect(response.status).toBe(503);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(outbound).not.toHaveBeenCalled();
  } finally { outbound.mockRestore(); }
});
