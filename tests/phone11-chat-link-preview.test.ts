import { describe, expect, it, vi } from "vitest";
import { createLinkPreview, isPublicAddress, LinkPreviewError } from "../server/chat/link-preview";

const publicAddress = { address: "93.184.216.34", family: 4 as const };

describe("Team Chat link preview boundary", () => {
  it("rejects literal and DNS-resolved private destinations before a request", async () => {
    const request = vi.fn();
    const preview = createLinkPreview({ resolve: async () => [{ address: "127.0.0.1", family: 4 }], request });
    await expect(preview({ tenantId: 10, userId: 1, url: "https://private.example/path" })).rejects.toMatchObject({ code: "unsafe_url" } satisfies Partial<LinkPreviewError>);
    await expect(preview({ tenantId: 10, userId: 1, url: "http://2130706433/" })).rejects.toMatchObject({ code: "unsafe_url" } satisfies Partial<LinkPreviewError>);
    expect(request).not.toHaveBeenCalled();
  });

  it("fails closed for expanded IPv6 local, mapped, NAT64, and 6to4 addresses", () => {
    expect(isPublicAddress("0:0:0:0:0:0:0:1")).toBe(false);
    expect(isPublicAddress("0:0:0:0:0:ffff:7f00:1")).toBe(false);
    expect(isPublicAddress("64:ff9b:0:0:0:0:0:1")).toBe(false);
    expect(isPublicAddress("2002:0a00:0001:0:0:0:0:1")).toBe(false);
    expect(isPublicAddress("2606:4700:4700:0:0:0:0:1111")).toBe(true);
  });

  it("pins each hop and rejects a redirect whose fresh DNS answer is private", async () => {
    const request = vi.fn(async (_url: URL, _address: { address: string; family: 4 | 6 }) => ({ status: 302, headers: { location: "https://internal.example/secret" }, body: "" }));
    const preview = createLinkPreview({
      resolve: async hostname => hostname === "internal.example" ? [{ address: "10.0.0.7", family: 4 }] : [publicAddress],
      request,
    });
    await expect(preview({ tenantId: 10, userId: 1, url: "https://public.example/a" })).rejects.toMatchObject({ code: "unsafe_url" } satisfies Partial<LinkPreviewError>);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1]).toEqual(publicAddress);
  });

  it("limits the body and returns sanitized metadata without loading images", async () => {
    const request = vi.fn(async () => ({ status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body:
      '<html><head><title>  Project &amp; status  </title><meta name="description" content="Safe <b>summary</b>"></head></html>' }));
    const preview = createLinkPreview({ resolve: async () => [publicAddress], request });
    await expect(preview({ tenantId: 10, userId: 1, url: "https://public.example/a" })).resolves.toEqual({ title: "Project & status", description: "Safe summary", domain: "public.example" });
    const oversized = createLinkPreview({ resolve: async () => [publicAddress], request: async () => ({ status: 200, headers: { "content-type": "text/html" }, body: "x".repeat(64 * 1024 + 1) }) });
    await expect(oversized({ tenantId: 10, userId: 1, url: "https://public.example/a" })).rejects.toMatchObject({ code: "unavailable" } satisfies Partial<LinkPreviewError>);
  });
});
