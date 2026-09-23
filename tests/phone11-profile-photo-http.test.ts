import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import * as fs from "node:fs";
import { chmod, mkdir, mkdtemp, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock("../server/_core/sdk", () => ({ sdk: { authenticateRequest: mocks.authenticate } }));
vi.mock("../server/_core/phone11-auth", () => ({ readAuthConfig: () => ({ trustedOrigins: ["https://app.phone11.test"] }) }));
import { createProfilePhotoRouter, drainProfilePhotoDeletions, MAX_PROFILE_PHOTO_BYTES,
  reconcileProfilePhotoOrphans, validProfilePhotoBytes } from "../server/profile/photo";
import { runMediaRetentionCycle } from "../server/chat/media";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64");
const jpeg = Buffer.from("/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYyLjI4LjEwMQD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABMAAEBAAAAAAAAAAAAAAAAAAAABgEBAQAAAAAAAAAAAAAAAAAABgcQAQAAAAAAAAAAAAAAAAAAAAARAQAAAAAAAAAAAAAAAAAAAAD/wAARCAACAAIDASIAAhEAAxEA/9oADAMBAAIRAxEAPwCLAE1/f//Z", "base64");
const progressiveJpeg = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wgARCAAQABADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAABQb/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGPeZeP/8QAFhAAAwAAAAAAAAAAAAAAAAAAAAME/9oACAEBAAEFAkzCZhMwmY//xAAVEQEBAAAAAAAAAAAAAAAAAAAFAP/aAAgBAwEBPwExO//EABURAQEAAAAAAAAAAAAAAAAAAAIA/9oACAECAQE/AQ7/xAAUEAEAAAAAAAAAAAAAAAAAAAAg/9oACAEBAAY/Ah//xAAWEAADAAAAAAAAAAAAAAAAAAAAITH/2gAIAQEAAT8hmiaJomj/2gAMAwEAAgADAAAAEFP/xAAWEQADAAAAAAAAAAAAAAAAAAAAITH/2gAIAQMBAT8Qgz//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAVEAEBAAAAAAAAAAAAAAAAAAAA8f/aAAgBAQABPxCCgoKC/9k=", "base64");
const webp = Buffer.from("UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoQABAAAgA0JaACdLoB+AADsAD+8MQL/yC5YXXI1/8gP+QH/ID/+PIAAAA=", "base64");
function extendedWebp() {
  const vp8x = Buffer.alloc(18); vp8x.write("VP8X", 0); vp8x.writeUInt32LE(10, 4);
  vp8x.writeUIntLE(15, 12, 3); vp8x.writeUIntLE(15, 15, 3);
  const body = Buffer.concat([Buffer.from("WEBP"), vp8x, webp.subarray(12)]);
  const result = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), body]);
  result.writeUInt32LE(result.length - 8, 4); return result;
}
type Photo = { tenant_id: number; user_id: number; version: string; storage_key: string; mime_type: string; size_bytes: number; content_sha256: string };
const memberships = new Set(["1:10", "2:10", "3:20"]);
let photo: Photo | null = null;
const deletions = new Map<string, { tenant_id: number; user_id: number; storage_key: string; attempts: number }>();
let schemaAvailable = true;

const query = vi.fn(async (sql: string, values: any[] = []) => {
  if (sql.includes("SELECT t.id, t.name FROM user_extensions")) {
    const userId = Number(values[0]), tenantId = Number(values[1]);
    return { rows: memberships.has(`${userId}:${tenantId}`) ? [{ id: tenantId, name: `Tenant ${tenantId}` }] : [] };
  }
  if (sql.includes("SELECT pg_advisory_xact_lock")) return { rows: [{}] };
  if (sql.includes("SELECT storage_key FROM phone11_workspace_profile_photos") && sql.includes("FOR UPDATE")) {
    return { rows: photo && photo.tenant_id === values[0] && photo.user_id === values[1] ? [{ storage_key: photo.storage_key }] : [] };
  }
  if (sql.includes("INSERT INTO phone11_workspace_profile_photos")) {
    photo = { tenant_id: values[0], user_id: values[1], version: values[2], storage_key: values[3],
      mime_type: values[4], size_bytes: values[5], content_sha256: values[6] };
    return { rows: [photo] };
  }
  if (sql.includes("to_regclass('public.phone11_workspace_profile_photos')")) {
    return { rows: [{ photos: schemaAvailable ? "phone11_workspace_profile_photos" : null,
      deletions: schemaAvailable ? "phone11_profile_photo_deletions" : null }] };
  }
  if (sql.includes("INSERT INTO phone11_profile_photo_deletions")) {
    if (!deletions.has(values[0])) deletions.set(values[0], { storage_key: values[0], tenant_id: values[1], user_id: values[2], attempts: 0 });
    return { rows: [{ storage_key: values[0] }] };
  }
  if (sql.includes("FROM phone11_profile_photo_deletions") && sql.includes("ORDER BY") && !sql.includes("WHERE storage_key")) {
    return { rows: [...deletions.values()].slice(0, Number(values[0])) };
  }
  if (sql.includes("FROM phone11_profile_photo_deletions WHERE storage_key") && sql.includes("FOR UPDATE")) {
    return { rows: deletions.has(values[0]) ? [deletions.get(values[0])] : [] };
  }
  if (sql.includes("SELECT 1 FROM phone11_workspace_profile_photos") && sql.includes("storage_key=$3")) {
    return { rows: photo && photo.tenant_id === values[0] && photo.user_id === values[1] && photo.storage_key === values[2] ? [{ exists: 1 }] : [] };
  }
  if (sql.includes("DELETE FROM phone11_profile_photo_deletions")) {
    deletions.delete(values[0]); return { rows: [] };
  }
  if (sql.includes("UPDATE phone11_profile_photo_deletions SET attempts")) {
    const row = deletions.get(values[0]); if (row) row.attempts += 1; return { rows: [] };
  }
  if (sql.includes("FROM tenant_memberships tm") && sql.includes("JOIN user_extensions")) {
    return { rows: memberships.has(`${values[1]}:${values[0]}`) ? [{ exists: 1 }] : [] };
  }
  if (sql.includes("FROM phone11_workspace_profile_photos WHERE tenant_id")) {
    return { rows: photo && photo.tenant_id === values[0] && photo.user_id === values[1] && photo.version === values[2] ? [photo] : [] };
  }
  if (sql.includes("DELETE FROM phone11_workspace_profile_photos")) {
    const removed = photo && photo.tenant_id === values[0] && photo.user_id === values[1] ? photo : null;
    if (removed) photo = null;
    return { rows: removed ? [{ storage_key: removed.storage_key }] : [] };
  }
  throw new Error(`Unexpected SQL: ${sql}`);
});
const transaction = async <T>(fn: (db: any) => Promise<T>) => fn({ query });

let server: Server, base: string, directory: string;
function headers(userId = 1, extra: Record<string, string> = {}) {
  return { Authorization: "Bearer test", "X-Test-User": String(userId), "X-Phone11-Profile-Tenant": "10",
    "Content-Type": "image/png", ...extra };
}
async function upload(userId = 1, body = png, extra: Record<string, string> = {}) {
  return fetch(`${base}/profile/photo`, { method: "POST", headers: headers(userId, extra), body });
}

describe("workspace profile photo HTTP routes", () => {
  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "phone11-profile-photo-"));
    await chmod(directory, 0o700);
    vi.stubEnv("PHONE11_CHAT_MEDIA_PATH", directory);
    const app = express(); app.use("/profile", createProfilePhotoRouter(transaction as any));
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.on("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  beforeEach(() => {
    photo = null;
    deletions.clear(); schemaAvailable = true;
    vi.stubEnv("PHONE11_PROFILE_PHOTO_COMMISSIONED", "1");
    vi.clearAllMocks();
    mocks.authenticate.mockImplementation(async req => {
      if (req.headers["x-test-auth"] === "none") throw new Error("unauthenticated");
      return { id: Number(req.headers["x-test-user"] || 1) };
    });
  });
  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it.each([undefined, "", "0", "true", " 1 "])(
    "blocks all public photo operations with commissioning value %s",
    async value => {
      const created = await upload();
      expect(created.status).toBe(201);
      const saved = photo;
      const descriptor = await created.json() as { photoVersion: string };
      if (value === undefined) delete process.env.PHONE11_PROFILE_PHOTO_COMMISSIONED;
      else process.env.PHONE11_PROFILE_PHOTO_COMMISSIONED = value;
      query.mockClear();
      expect((await upload()).status).toBe(503);
      expect((await fetch(`${base}/profile/photo/10/1?v=${descriptor.photoVersion}`, { headers: headers() })).status).toBe(503);
      expect((await fetch(`${base}/profile/photo/10`, { method: "DELETE", headers: headers() })).status).toBe(503);
      expect((await upload(1, png, { "X-Test-Auth": "none" })).status).toBe(401);
      expect(query).not.toHaveBeenCalled();
      expect(photo).toEqual(saved);
    },
  );

  it("authenticates and authorizes before accepting the raw upload body", async () => {
    const unauthenticated = await upload(1, Buffer.alloc(MAX_PROFILE_PHOTO_BYTES + 1), { "X-Test-Auth": "none" });
    expect(unauthenticated.status).toBe(401);
    const foreignTenant = await upload(1, png, { "X-Phone11-Profile-Tenant": "20" });
    expect(foreignTenant.status).toBe(403);
    expect(photo).toBeNull();
  });

  it("rejects unsupported types, malformed image bytes, and oversized bodies", async () => {
    expect((await upload(1, png, { "Content-Type": "image/gif" })).status).toBe(415);
    expect((await upload(1, Buffer.from("not a png"))).status).toBe(400);
    expect((await upload(1, Buffer.alloc(MAX_PROFILE_PHOTO_BYTES + 1))).status).toBe(413);
    await expect(validProfilePhotoBytes("image/png", Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(40)]))).resolves.toBe(false);
    expect(photo).toBeNull();
  });

  it("parses real JPEG and WebP payloads and rejects truncated or header-only variants", async () => {
    await expect(validProfilePhotoBytes("image/jpeg", jpeg)).resolves.toBe(true);
    await expect(validProfilePhotoBytes("image/jpeg", progressiveJpeg)).resolves.toBe(true);
    await expect(validProfilePhotoBytes("image/jpeg", jpeg.subarray(0, -2))).resolves.toBe(false);
    await expect(validProfilePhotoBytes("image/webp", webp)).resolves.toBe(true);
    await expect(validProfilePhotoBytes("image/webp", extendedWebp())).resolves.toBe(true);
    const headerOnly = Buffer.alloc(30);
    headerOnly.write("RIFF", 0); headerOnly.writeUInt32LE(22, 4); headerOnly.write("WEBPVP8X", 8); headerOnly.writeUInt32LE(10, 16);
    await expect(validProfilePhotoBytes("image/webp", headerOnly)).resolves.toBe(false);
    const malformedVp8 = Buffer.alloc(30);
    malformedVp8.write("RIFF", 0); malformedVp8.writeUInt32LE(22, 4); malformedVp8.write("WEBPVP8 ", 8);
    malformedVp8.writeUInt32LE(10, 16); malformedVp8[23] = 0x9d; malformedVp8[24] = 0x01; malformedVp8[25] = 0x2a;
    malformedVp8.writeUInt16LE(1, 26); malformedVp8.writeUInt16LE(1, 28);
    await expect(validProfilePhotoBytes("image/webp", malformedVp8)).resolves.toBe(false);
  });

  it("bounds concurrent image decoders and releases capacity after workers exit", async () => {
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => validProfilePhotoBytes("image/jpeg", jpeg)));
    const accepted = results.filter((result): result is PromiseFulfilledResult<boolean> => result.status === "fulfilled");
    const refused = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(accepted).toHaveLength(10);
    expect(accepted.every(result => result.value)).toBe(true);
    expect(refused).toHaveLength(2);
    expect(refused.every(result => String(result.reason).includes("decoder is busy"))).toBe(true);
    await expect(validProfilePhotoBytes("image/jpeg", jpeg)).resolves.toBe(true);
  });

  it("persists, serves only to same-workspace members, and removes only the owner photo", async () => {
    const created = await upload();
    expect(created.status).toBe(201);
    const descriptor = await created.json() as { userId: number; photoVersion: string; photoUrl: string; mimeType: string };
    expect(descriptor).toMatchObject({ userId: 1, mimeType: "image/png" });
    expect(descriptor.photoUrl).toBe(`/api/profile/photo/10/1?v=${descriptor.photoVersion}`);

    const sameWorkspace = await fetch(`${base}/profile/photo/10/1?v=${descriptor.photoVersion}`, { headers: headers(2) });
    expect(sameWorkspace.status).toBe(200);
    expect(sameWorkspace.headers.get("cache-control")).toBe("private, no-store");
    expect(Buffer.from(await sameWorkspace.arrayBuffer())).toEqual(png);
    expect((await fetch(`${base}/profile/photo/10/1?v=${descriptor.photoVersion}`, { headers: headers(3) })).status).toBe(404);
    expect((await fetch(`${base}/profile/photo/20/1?v=${descriptor.photoVersion}`, { headers: headers(3) })).status).toBe(404);
    expect((await fetch(`${base}/profile/photo/10/1?v=11111111-1111-4111-8111-111111111111`, { headers: headers(2) })).status).toBe(404);

    expect((await fetch(`${base}/profile/photo/10`, { method: "DELETE", headers: headers(2) })).status).toBe(200);
    expect(photo).not.toBeNull();
    const removed = await fetch(`${base}/profile/photo/10`, { method: "DELETE", headers: headers(1) });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ userId: 1, photoVersion: null, photoUrl: null });
    expect(photo).toBeNull();
    expect((await fetch(`${base}/profile/photo/10/1?v=${descriptor.photoVersion}`, { headers: headers(2) })).status).toBe(404);
  });

  it("retains failed physical deletions durably and retries them", async () => {
    const first = await upload(); expect(first.status).toBe(201);
    const oldKey = photo!.storage_key;
    const unlink = vi.spyOn(fs.promises, "unlink").mockRejectedValueOnce(Object.assign(new Error("busy"), { code: "EBUSY" }));
    const second = await upload(); expect(second.status).toBe(201);
    expect(deletions.get(oldKey)?.attempts).toBe(1);
    unlink.mockRestore();
    expect(await drainProfilePhotoDeletions(10, transaction as any)).toBe(1);
    expect(deletions.has(oldKey)).toBe(false);
  });

  it("takes the owner advisory lock before locking a queued deletion", async () => {
    const storageKey = "10/profile/1/22222222-2222-4222-8222-222222222222.png";
    deletions.set(storageKey, { tenant_id: 10, user_id: 1, storage_key: storageKey, attempts: 0 });
    query.mockClear();
    expect(await drainProfilePhotoDeletions(10, transaction as any)).toBe(1);
    const statements = query.mock.calls.map(call => String(call[0]));
    const advisory = statements.findIndex(sql => sql.includes("pg_advisory_xact_lock"));
    const queueLock = statements.findIndex(sql => sql.includes("phone11_profile_photo_deletions WHERE storage_key") && sql.includes("FOR UPDATE"));
    expect(advisory).toBeGreaterThanOrEqual(0);
    expect(queueLock).toBeGreaterThan(advisory);
  });

  it("reconciles a crash orphan but never queues the currently referenced photo", async () => {
    const owner = path.join(directory, "10", "profile", "1"); await mkdir(owner, { recursive: true });
    const orphanName = "33333333-3333-4333-8333-333333333333.png";
    const orphanPath = path.join(owner, orphanName); await writeFile(orphanPath, png); await utimes(orphanPath, new Date(0), new Date(0));
    expect(await reconcileProfilePhotoOrphans({ scanLimit: 1, transaction: transaction as any })).toBe(0);
    expect(await reconcileProfilePhotoOrphans({ transaction: transaction as any })).toBe(1);
    expect(await drainProfilePhotoDeletions(10, transaction as any)).toBe(1);
    await expect(stat(orphanPath)).rejects.toMatchObject({ code: "ENOENT" });

    const currentName = "44444444-4444-4444-8444-444444444444.png";
    const currentPath = path.join(owner, currentName); await writeFile(currentPath, png); await utimes(currentPath, new Date(0), new Date(0));
    photo = { tenant_id: 10, user_id: 1, version: currentName.slice(0, 36), storage_key: `10/profile/1/${currentName}`,
      mime_type: "image/png", size_bytes: png.length, content_sha256: "a".repeat(64) };
    expect(await reconcileProfilePhotoOrphans({ transaction: transaction as any })).toBe(0);
    expect(deletions.size).toBe(0);
    await expect(stat(currentPath)).resolves.toMatchObject({ size: png.length });

    deletions.set(photo.storage_key, { tenant_id: 10, user_id: 1, storage_key: photo.storage_key, attempts: 0 });
    expect(await drainProfilePhotoDeletions(10, transaction as any)).toBe(1);
    await expect(stat(currentPath)).resolves.toMatchObject({ size: png.length });
    expect(deletions.size).toBe(0);

    const symlinkName = "55555555-5555-4555-8555-555555555555.png";
    await symlink(currentPath, path.join(owner, symlinkName));
    expect(await reconcileProfilePhotoOrphans({ transaction: transaction as any })).toBe(0);
  });

  it("treats missing cleanup schema as an unavailable no-op", async () => {
    schemaAvailable = false;
    expect(await drainProfilePhotoDeletions(10, transaction as any)).toBe(0);
    expect(await reconcileProfilePhotoOrphans({ transaction: transaction as any })).toBe(0);
  });

  it("eventually scans every owner across more than 200 tenant directories", async () => {
    const scanDirectory = await mkdtemp(path.join(tmpdir(), "phone11-profile-fair-scan-"));
    await chmod(scanDirectory, 0o700);
    vi.stubEnv("PHONE11_CHAT_MEDIA_PATH", scanDirectory);
    const expected = 205;
    try {
      for (let index = 0; index < expected; index += 1) {
        const tenantId = 1_000 + index;
        const owner = path.join(scanDirectory, String(tenantId), "profile", "1");
        await mkdir(owner, { recursive: true });
        const name = `${String(index + 1).padStart(8, "0")}-1111-4111-8111-111111111111.png`;
        const orphan = path.join(owner, name);
        await writeFile(orphan, png); await utimes(orphan, new Date(0), new Date(0));
      }
      for (let tick = 0; tick < 200 && deletions.size < expected; tick += 1) {
        await reconcileProfilePhotoOrphans({ scanLimit: 5, transaction: transaction as any });
      }
      expect(deletions.size).toBe(expected);
    } finally {
      vi.stubEnv("PHONE11_CHAT_MEDIA_PATH", directory);
      await rm(scanDirectory, { recursive: true, force: true });
    }
  });

  it("continues to later owners after a persistent directory read failure", async () => {
    const scanDirectory = await mkdtemp(path.join(tmpdir(), "phone11-profile-error-scan-"));
    await chmod(scanDirectory, 0o700);
    vi.stubEnv("PHONE11_CHAT_MEDIA_PATH", scanDirectory);
    const resolvedScanDirectory = await fs.promises.realpath(scanDirectory);
    const profileDirectory = path.join(resolvedScanDirectory, "1000", "profile");
    const badOwner = path.join(profileDirectory, "1");
    const goodOwner = path.join(profileDirectory, "2");
    await mkdir(badOwner, { recursive: true });
    await mkdir(goodOwner, { recursive: true });
    const goodName = "66666666-6666-4666-8666-666666666666.png";
    const goodPath = path.join(goodOwner, goodName);
    await writeFile(goodPath, png); await utimes(goodPath, new Date(0), new Date(0));
    const originalOpendir = fs.promises.opendir.bind(fs.promises);
    const opendir = vi.spyOn(fs.promises, "opendir").mockImplementation((async (directoryPath: fs.PathLike, options?: any) => {
      const resolved = path.resolve(String(directoryPath));
      if (resolved === badOwner) throw Object.assign(new Error("unreadable"), { code: "EACCES" });
      if (resolved === profileDirectory) {
        const actualEntries = await fs.promises.readdir(profileDirectory, { withFileTypes: true });
        const ordered = [actualEntries.find(entry => entry.name === "1")!, actualEntries.find(entry => entry.name === "2")!];
        let index = 0;
        return { read: async () => ordered[index++] ?? null, close: async () => undefined } as unknown as fs.Dir;
      }
      return originalOpendir(directoryPath, options);
    }) as typeof fs.promises.opendir);
    try {
      expect(await reconcileProfilePhotoOrphans({ transaction: transaction as any })).toBe(1);
      expect(deletions.has(`1000/profile/2/${goodName}`)).toBe(true);
      expect(opendir.mock.calls.some(call => path.resolve(String(call[0])) === badOwner)).toBe(true);
    } finally {
      opendir.mockRestore();
      vi.stubEnv("PHONE11_CHAT_MEDIA_PATH", directory);
      await rm(scanDirectory, { recursive: true, force: true });
    }
  });

  it("runs profile maintenance when chat retention fails", async () => {
    const maintainProfile = vi.fn(async () => 1);
    const purgeChat = vi.fn(async () => { throw new Error("chat retention failed"); });
    await expect(runMediaRetentionCycle({ purgeChat, maintainProfile })).rejects.toThrow("chat retention failed");
    expect(purgeChat).toHaveBeenCalledOnce();
    expect(maintainProfile).toHaveBeenCalledOnce();
  });
});
