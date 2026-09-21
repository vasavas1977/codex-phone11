import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { Router, raw, type NextFunction, type Request, type Response } from "express";
import { inflate } from "node:zlib";
import { promisify } from "node:util";
import { TRPCError } from "@trpc/server";
import type { PoolClient } from "pg";
import { sdk } from "../_core/sdk";
import { readAuthConfig } from "../_core/phone11-auth";
import { withTransaction } from "../pbx/db";
import { authorizeWorkspace } from "../chat/service";

export const MAX_PROFILE_PHOTO_BYTES = 2 * 1024 * 1024;
const MAX_PROFILE_PHOTO_EDGE = 2048;
const MAX_PROFILE_PHOTO_PIXELS = 4_194_304;
const PROFILE_ORPHAN_GRACE_MS = 60 * 60_000;
const PROFILE_RECONCILE_SCAN_LIMIT = 200;
const MAX_IMAGE_DECODER_WORKERS = 2;
const MAX_QUEUED_IMAGE_DECODES = 8;
const IMAGE_DECODE_TIMEOUT_MS = 10_000;
const inflateAsync = promisify(inflate);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const extensionForMime: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const require = createRequire(import.meta.url);
const decoderAssets = {
  "image/jpeg": {
    decoderUrl: pathToFileURL(require.resolve("@jsquash/jpeg/decode.js")).href,
    wasmPath: path.join(path.dirname(require.resolve("@jsquash/jpeg/decode.js")), "codec/dec/mozjpeg_dec.wasm"),
  },
  "image/webp": {
    decoderUrl: pathToFileURL(require.resolve("@jsquash/webp/decode.js")).href,
    wasmPath: path.join(path.dirname(require.resolve("@jsquash/webp/decode.js")), "codec/dec/webp_dec.wasm"),
  },
} as const;

const decoderWorkerSource = `
  const { parentPort, workerData } = require("node:worker_threads");
  const fs = require("node:fs");
  void (async () => {
    try {
      const codec = await import(workerData.decoderUrl);
      const wasm = await WebAssembly.compile(await fs.promises.readFile(workerData.wasmPath));
      await codec.init(wasm);
      try {
        const decoded = await codec.default(workerData.bytes);
        parentPort.postMessage({ ok: true, width: decoded.width, height: decoded.height,
          dataLength: decoded.data && decoded.data.byteLength });
      } catch {
        parentPort.postMessage({ ok: false, infrastructure: false });
      }
    } catch {
      parentPort.postMessage({ ok: false, infrastructure: true });
    }
  })();
`;

let activeDecoderWorkers = 0;
const decoderWaiters: Array<{ resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout }> = [];

async function acquireDecoderSlot(): Promise<void> {
  if (activeDecoderWorkers < MAX_IMAGE_DECODER_WORKERS) {
    activeDecoderWorkers += 1;
    return;
  }
  if (decoderWaiters.length >= MAX_QUEUED_IMAGE_DECODES) throw new Error("Profile photo decoder is busy");
  await new Promise<void>((resolve, reject) => {
    const waiter: { resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout } = {
      resolve,
      reject,
      timer: setTimeout(() => {
        const index = decoderWaiters.indexOf(waiter);
        if (index >= 0) decoderWaiters.splice(index, 1);
        reject(new Error("Profile photo decoder queue timed out"));
      }, IMAGE_DECODE_TIMEOUT_MS) as unknown as NodeJS.Timeout,
    };
    waiter.timer.unref();
    decoderWaiters.push(waiter);
  });
}

function releaseDecoderSlot(): void {
  const next = decoderWaiters.shift();
  if (next) {
    clearTimeout(next.timer);
    next.resolve();
    return;
  }
  activeDecoderWorkers -= 1;
}

type DecodedImage = { width: number; height: number; dataLength: number };
async function decodeImageOffThread(mime: "image/jpeg" | "image/webp", bytes: Buffer): Promise<DecodedImage | null> {
  await acquireDecoderSlot();
  try {
    const payload = Uint8Array.from(bytes).buffer;
    return await new Promise<DecodedImage | null>((resolve, reject) => {
      const worker = new Worker(decoderWorkerSource, {
        eval: true,
        workerData: { ...decoderAssets[mime], bytes: payload },
        transferList: [payload],
        resourceLimits: {
          maxOldGenerationSizeMb: 64,
          maxYoungGenerationSizeMb: 16,
          codeRangeSizeMb: 16,
          stackSizeMb: 4,
        },
      });
      let settled = false;
      const finish = (error: Error | null, result?: DecodedImage | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void worker.terminate().then(
          () => { if (error) reject(error); else resolve(result ?? null); },
          terminateError => reject(error ?? terminateError),
        );
      };
      const timer = setTimeout(() => finish(new Error("Profile photo decoder timed out")), IMAGE_DECODE_TIMEOUT_MS) as unknown as NodeJS.Timeout;
      timer.unref();
      worker.once("message", (message: { ok?: boolean; infrastructure?: boolean; width?: unknown; height?: unknown; dataLength?: unknown }) => {
        if (!message.ok) {
          finish(message.infrastructure ? new Error("Profile photo decoder is unavailable") : null, null);
          return;
        }
        if (!Number.isSafeInteger(message.width) || !Number.isSafeInteger(message.height) || !Number.isSafeInteger(message.dataLength)) {
          finish(new Error("Profile photo decoder returned invalid metadata"));
          return;
        }
        finish(null, { width: Number(message.width), height: Number(message.height), dataLength: Number(message.dataLength) });
      });
      worker.once("error", error => finish(error));
      worker.once("exit", code => finish(new Error(`Profile photo decoder exited before returning a result (code ${code})`)));
    });
  } finally {
    releaseDecoderSlot();
  }
}

type Transaction = <T>(fn: (db: PoolClient) => Promise<T>) => Promise<T>;
type Db = Pick<PoolClient, "query">;
type PhotoRow = {
  tenant_id: number;
  user_id: number;
  version: string;
  storage_key: string;
  mime_type: string;
  size_bytes: number;
  content_sha256: string;
};
type DeletionRow = Pick<PhotoRow, "tenant_id" | "user_id" | "storage_key">;
export type ProfilePhotoDescriptor = {
  userId: number;
  photoVersion: string;
  photoUrl: string;
  mimeType: string;
};

function firstHeader(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function normalizedMime(value: string | null): string | null {
  const mime = value?.split(";", 1)[0]?.trim().toLowerCase() || "";
  return allowedMimeTypes.has(mime) ? mime : null;
}
function declaredBodyTooLarge(req: Request): boolean {
  const declared = firstHeader(req.headers["content-length"]);
  return declared !== null && /^[0-9]+$/.test(declared) && Number(declared) > MAX_PROFILE_PHOTO_BYTES;
}
function cookieMutationOriginAllowed(req: Request): boolean {
  if (firstHeader(req.headers.authorization)) return true;
  if (!firstHeader(req.headers.cookie)) return true;
  try {
    const origin = firstHeader(req.headers.origin);
    return origin !== null && readAuthConfig().trustedOrigins.includes(origin);
  } catch { return false; }
}
function descriptor(row: Pick<PhotoRow, "tenant_id" | "user_id" | "version" | "mime_type">): ProfilePhotoDescriptor {
  return {
    userId: Number(row.user_id),
    photoVersion: row.version,
    photoUrl: `/api/profile/photo/${Number(row.tenant_id)}/${Number(row.user_id)}?v=${encodeURIComponent(row.version)}`,
    mimeType: row.mime_type,
  };
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
async function pngDimensions(bytes: Buffer): Promise<{ width: number; height: number } | null> {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 57 || !bytes.subarray(0, 8).equals(signature)) return null;
  let offset = 8, width = 0, height = 0, bytesPerPixel = 0, sawHeader = false, sawEnd = false;
  const compressed: Buffer[] = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (length > MAX_PROFILE_PHOTO_BYTES || end > bytes.length) return null;
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    const crcBody = bytes.subarray(offset + 4, offset + 8 + length);
    if (crc32(crcBody) !== bytes.readUInt32BE(offset + 8 + length)) return null;
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (!sawHeader) {
      if (type !== "IHDR" || length !== 13) return null;
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      const bitDepth = data[8], colorType = data[9];
      if (bitDepth !== 8 || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) return null;
      bytesPerPixel = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0;
      if (!bytesPerPixel) return null;
      sawHeader = true;
    } else if (type === "IDAT") compressed.push(data);
    else if (type === "IEND") { if (length !== 0 || end !== bytes.length) return null; sawEnd = true; break; }
    offset = end;
  }
  if (!sawHeader || !sawEnd || !compressed.length || width < 1 || height < 1
    || width > MAX_PROFILE_PHOTO_EDGE || height > MAX_PROFILE_PHOTO_EDGE || width * height > MAX_PROFILE_PHOTO_PIXELS) return null;
  try {
    const rows = await inflateAsync(Buffer.concat(compressed), { maxOutputLength: height * (1 + width * bytesPerPixel) + 1 });
    if (rows.length !== height * (1 + width * bytesPerPixel)) return null;
    for (let row = 0; row < height; row += 1) if (rows[row * (1 + width * bytesPerPixel)] > 4) return null;
  } catch { return null; }
  return { width, height };
}

function jpegDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) return null;
  let offset = 2;
  while (offset + 3 < bytes.length - 2) {
    if (bytes[offset] !== 0xff) return null;
    while (offset < bytes.length - 2 && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0x00 || marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 8) return null;
      return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  return null;
}

function webpDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 30 || bytes.subarray(0, 4).toString("ascii") !== "RIFF" || bytes.subarray(8, 12).toString("ascii") !== "WEBP" || bytes.readUInt32LE(4) + 8 !== bytes.length) return null;
  const type = bytes.subarray(12, 16).toString("ascii");
  const chunkSize = bytes.readUInt32LE(16);
  if (20 + chunkSize + (chunkSize % 2) > bytes.length) return null;
  if (type === "VP8X" && chunkSize === 10) {
    const canvas = { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
    let offset = 20 + chunkSize;
    while (offset + 8 <= bytes.length) {
      const nestedType = bytes.subarray(offset, offset + 4).toString("ascii");
      const nestedSize = bytes.readUInt32LE(offset + 4);
      const nestedEnd = offset + 8 + nestedSize + (nestedSize % 2);
      if (nestedEnd > bytes.length) return null;
      if (nestedType === "VP8 " || nestedType === "VP8L") {
        const nested = Buffer.concat([
          Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), bytes.subarray(offset, nestedEnd),
        ]);
        nested.writeUInt32LE(nested.length - 8, 4);
        const payload = webpDimensions(nested);
        return payload && payload.width <= canvas.width && payload.height <= canvas.height ? canvas : null;
      }
      offset = nestedEnd;
    }
    return null;
  }
  if (type === "VP8L" && chunkSize >= 5 && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
  }
  if (type === "VP8 " && chunkSize >= 10 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return {
    width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff,
  };
  return null;
}

export async function validProfilePhotoBytes(mime: string, bytes: Buffer): Promise<boolean> {
  const dimensions = mime === "image/png" ? await pngDimensions(bytes)
    : mime === "image/jpeg" ? jpegDimensions(bytes)
      : mime === "image/webp" ? webpDimensions(bytes) : null;
  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0
    || dimensions.width > MAX_PROFILE_PHOTO_EDGE || dimensions.height > MAX_PROFILE_PHOTO_EDGE
    || dimensions.width * dimensions.height > MAX_PROFILE_PHOTO_PIXELS) return false;
  if (mime === "image/png") return true;
  const decoded = await decodeImageOffThread(mime as "image/jpeg" | "image/webp", bytes);
  return Boolean(decoded && decoded.width === dimensions.width && decoded.height === dimensions.height
    && decoded.dataLength === dimensions.width * dimensions.height * 4);
}

function mediaBase(): string {
  const configured = process.env.PHONE11_CHAT_MEDIA_PATH;
  if (!configured || !path.isAbsolute(configured)) throw new Error("Profile photo storage is not configured");
  return configured;
}
async function resolvedBase(): Promise<string> {
  const base = mediaBase();
  const stat = await fs.promises.lstat(base);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error("Profile photo storage is unsafe");
  return fs.promises.realpath(base);
}
function ownerPrefix(base: string, tenantId: number, userId: number): string {
  return path.join(base, String(tenantId), "profile", String(userId)) + path.sep;
}
async function ownerDirectory(base: string, tenantId: number, userId: number): Promise<string> {
  const tenant = path.join(base, String(tenantId));
  const profile = path.join(tenant, "profile");
  const owner = path.join(profile, String(userId));
  for (const directory of [tenant, profile, owner]) {
    await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.promises.chmod(directory, 0o700);
    const stat = await fs.promises.lstat(directory);
    const resolved = await fs.promises.realpath(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || resolved !== directory) throw new Error("Profile photo directory is unsafe");
  }
  return owner;
}
async function storeBytes(tenantId: number, userId: number, version: string, mime: string, bytes: Buffer) {
  const base = await resolvedBase();
  const directory = await ownerDirectory(base, tenantId, userId);
  const storageKey = `${tenantId}/profile/${userId}/${version}.${extensionForMime[mime]}`;
  const filePath = path.join(base, storageKey);
  if (!filePath.startsWith(ownerPrefix(base, tenantId, userId)) || path.dirname(filePath) !== directory) throw new Error("Invalid profile photo path");
  await fs.promises.writeFile(filePath, bytes, { flag: "wx", mode: 0o600 });
  return storageKey;
}
async function removeStored(tenantId: number, userId: number, storageKey: string): Promise<void> {
  const base = await resolvedBase();
  const filePath = path.resolve(base, storageKey);
  if (!filePath.startsWith(ownerPrefix(base, tenantId, userId))) throw new Error("Invalid profile photo path");
  try { await fs.promises.unlink(filePath); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
async function readStored(row: PhotoRow): Promise<Buffer> {
  const base = await resolvedBase();
  const filePath = path.resolve(base, row.storage_key);
  if (!filePath.startsWith(ownerPrefix(base, row.tenant_id, row.user_id))) throw new Error("Invalid profile photo path");
  const handle = await fs.promises.open(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== Number(row.size_bytes) || stat.size > MAX_PROFILE_PHOTO_BYTES) throw new Error("Profile photo is unavailable");
    const bytes = await handle.readFile();
    // Upload validation established the image structure. Reads verify immutable
    // bytes without repeating CPU-heavy image decompression on the shared API.
    if (createHash("sha256").update(bytes).digest("hex") !== row.content_sha256) throw new Error("Profile photo is unavailable");
    return bytes;
  } finally { await handle.close(); }
}

async function requireTargetMember(db: Db, tenantId: number, userId: number): Promise<void> {
  const result = await db.query(`SELECT 1 FROM tenant_memberships tm
    JOIN tenants t ON t.id=tm.tenant_id AND t.status='active'
    JOIN user_extensions ue ON ue.user_id=tm.user_id
    JOIN extensions e ON e.id=ue.extension_id AND e.tenant_id=tm.tenant_id AND e.status='active' AND e.deleted_at IS NULL
    WHERE tm.tenant_id=$1 AND tm.user_id=$2 AND tm.status='active' LIMIT 1`, [tenantId, userId]);
  if (!result.rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Profile photo is unavailable" });
}

export async function profilePhotosAvailable(db: Db): Promise<boolean> {
  const row = (await db.query(`SELECT
    to_regclass('public.phone11_workspace_profile_photos') AS photos,
    to_regclass('public.phone11_profile_photo_deletions') AS deletions`)).rows[0];
  const present = (value: unknown, name: string) => value === name || value === `public.${name}`;
  return present(row?.photos, "phone11_workspace_profile_photos") && present(row?.deletions, "phone11_profile_photo_deletions");
}
export async function profilePhotoStorageReady(): Promise<boolean> {
  try { await resolvedBase(); return true; } catch { return false; }
}
export async function profilePhotoDescriptors(db: Db, tenantId: number, userIds: readonly number[]): Promise<Map<number, ProfilePhotoDescriptor>> {
  const ids = [...new Set(userIds)].filter(id => Number.isSafeInteger(id) && id > 0);
  const result = new Map<number, ProfilePhotoDescriptor>();
  if (!ids.length || !(await profilePhotosAvailable(db))) return result;
  const rows = await db.query<PhotoRow>(`SELECT tenant_id,user_id,version,mime_type FROM phone11_workspace_profile_photos
    WHERE tenant_id=$1 AND user_id=ANY($2::integer[])`, [tenantId, ids]);
  for (const row of rows.rows) result.set(Number(row.user_id), descriptor(row));
  return result;
}

async function enqueueDeletion(db: Db, row: DeletionRow): Promise<void> {
  await db.query(`INSERT INTO phone11_profile_photo_deletions
    (storage_key,tenant_id,user_id,queued_at) VALUES($1,$2,$3,clock_timestamp())
    ON CONFLICT(storage_key) DO NOTHING`, [row.storage_key, row.tenant_id, row.user_id]);
}

/**
 * Delete queued bytes while holding the same owner advisory lock as upload and
 * remove. A malformed or stale queue row that names the current photo is
 * acknowledged without touching its bytes.
 */
export async function drainProfilePhotoDeletions(
  limit = 100,
  transaction: Transaction = withTransaction,
): Promise<number> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500 || !process.env.PHONE11_CHAT_MEDIA_PATH) return 0;
  let candidates: DeletionRow[];
  try {
    candidates = await transaction(async db => {
      if (!(await profilePhotosAvailable(db))) return [];
      return (await db.query<DeletionRow>(`SELECT tenant_id,user_id,storage_key
        FROM phone11_profile_photo_deletions
        ORDER BY last_error_at NULLS FIRST,last_error_at,queued_at LIMIT $1`, [limit])).rows;
    });
  } catch (error) {
    if ((error as { code?: unknown })?.code === "42P01") return 0;
    throw error;
  }
  let completed = 0;
  for (const candidate of candidates) {
    try {
      const didComplete = await transaction(async db => {
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [`phone11-profile-photo:${candidate.tenant_id}:${candidate.user_id}`]);
        const queued = (await db.query<DeletionRow>(`SELECT tenant_id,user_id,storage_key
          FROM phone11_profile_photo_deletions WHERE storage_key=$1 FOR UPDATE SKIP LOCKED`,
          [candidate.storage_key])).rows[0];
        if (!queued) return false;
        if (queued.tenant_id !== candidate.tenant_id || queued.user_id !== candidate.user_id) {
          throw new Error("Profile photo deletion owner changed");
        }
        const current = await db.query(`SELECT 1 FROM phone11_workspace_profile_photos
          WHERE tenant_id=$1 AND user_id=$2 AND storage_key=$3 LIMIT 1`,
          [queued.tenant_id, queued.user_id, queued.storage_key]);
        if (!current.rows[0]) await removeStored(queued.tenant_id, queued.user_id, queued.storage_key);
        await db.query("DELETE FROM phone11_profile_photo_deletions WHERE storage_key=$1", [queued.storage_key]);
        return true;
      });
      if (didComplete) completed += 1;
    } catch {
      // The durable row remains for the next bounded lifecycle tick.
      await transaction(async db => {
        if (!(await profilePhotosAvailable(db))) return;
        await db.query(`UPDATE phone11_profile_photo_deletions SET attempts=attempts+1,last_error_at=clock_timestamp()
          WHERE storage_key=$1`, [candidate.storage_key]);
      }).catch(() => undefined);
    }
  }
  return completed;
}

type OrphanCandidate = DeletionRow;
type OrphanScanItem = OrphanCandidate | null;
let orphanScanBase: string | null = null;
let orphanScanIterator: AsyncGenerator<OrphanScanItem> | null = null;
let orphanScanTail: Promise<void> = Promise.resolve();

async function safeProfileDirectory(directory: string): Promise<boolean> {
  try {
    const stat = await fs.promises.lstat(directory);
    return stat.isDirectory() && !stat.isSymbolicLink() && await fs.promises.realpath(directory) === directory;
  } catch { return false; }
}

async function* profileDirectoryEntries(directory: string): AsyncGenerator<fs.Dirent> {
  let handle: fs.Dir;
  try { handle = await fs.promises.opendir(directory); }
  catch { return; }
  try {
    while (true) {
      let entry: fs.Dirent | null;
      try { entry = await handle.read(); }
      catch { return; }
      if (!entry) return;
      yield entry;
    }
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function* profileOrphanScan(base: string): AsyncGenerator<OrphanScanItem> {
  if (!(await safeProfileDirectory(base))) return;
  for await (const tenantEntry of profileDirectoryEntries(base)) {
    yield null;
    if (!tenantEntry.isDirectory() || tenantEntry.isSymbolicLink() || !/^[1-9]\d*$/.test(tenantEntry.name)) continue;
    const tenantId = Number(tenantEntry.name);
    const profile = path.join(base, tenantEntry.name, "profile");
    if (!(await safeProfileDirectory(profile))) continue;
    for await (const userEntry of profileDirectoryEntries(profile)) {
      yield null;
      if (!userEntry.isDirectory() || userEntry.isSymbolicLink() || !/^[1-9]\d*$/.test(userEntry.name)) continue;
      const userId = Number(userEntry.name);
      const owner = path.join(profile, userEntry.name);
      if (!(await safeProfileDirectory(owner))) continue;
      for await (const file of profileDirectoryEntries(owner)) {
        if (!file.isFile() || file.isSymbolicLink()
          || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp)$/i.test(file.name)) {
          yield null;
          continue;
        }
        const filePath = path.join(owner, file.name);
        let stat: fs.Stats;
        try { stat = await fs.promises.lstat(filePath); }
        catch { yield null; continue; }
        if (!stat.isFile() || stat.isSymbolicLink() || Date.now() - stat.mtimeMs < PROFILE_ORPHAN_GRACE_MS) {
          yield null;
          continue;
        }
        yield { tenant_id: tenantId, user_id: userId,
          storage_key: `${tenantId}/profile/${userId}/${file.name}` };
      }
    }
  }
}

async function collectProfileOrphanCandidatesUnserialized(scanLimit: number): Promise<OrphanCandidate[]> {
  const base = await resolvedBase();
  if (orphanScanBase !== base || !orphanScanIterator) {
    if (orphanScanIterator) await orphanScanIterator.return(undefined).catch(() => undefined);
    orphanScanBase = base;
    orphanScanIterator = profileOrphanScan(base);
  }
  const candidates: OrphanCandidate[] = [];
  try {
    for (let scanned = 0; scanned < scanLimit; scanned += 1) {
      const item = await orphanScanIterator.next();
      if (item.done) {
        orphanScanIterator = null;
        orphanScanBase = null;
        break;
      }
      if (item.value) candidates.push(item.value);
    }
    return candidates;
  } catch (error) {
    await orphanScanIterator?.return(undefined).catch(() => undefined);
    orphanScanIterator = null;
    orphanScanBase = null;
    throw error;
  }
}

async function collectProfileOrphanCandidates(scanLimit: number): Promise<OrphanCandidate[]> {
  const previous = orphanScanTail;
  let release!: () => void;
  orphanScanTail = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try { return await collectProfileOrphanCandidatesUnserialized(scanLimit); }
  finally { release(); }
}

export async function reconcileProfilePhotoOrphans(
  options: { scanLimit?: number; transaction?: Transaction } = {},
): Promise<number> {
  const scanLimit = options.scanLimit ?? PROFILE_RECONCILE_SCAN_LIMIT;
  const transaction = options.transaction ?? withTransaction;
  if (!Number.isSafeInteger(scanLimit) || scanLimit < 1 || scanLimit > 1000 || !process.env.PHONE11_CHAT_MEDIA_PATH) return 0;
  let candidates: OrphanCandidate[];
  try { candidates = await collectProfileOrphanCandidates(scanLimit); }
  catch { return 0; }
  let queued = 0;
  for (const candidate of candidates) {
    try {
      const inserted = await transaction(async db => {
        if (!(await profilePhotosAvailable(db))) return false;
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [`phone11-profile-photo:${candidate.tenant_id}:${candidate.user_id}`]);
        const current = await db.query(`SELECT 1 FROM phone11_workspace_profile_photos
          WHERE tenant_id=$1 AND user_id=$2 AND storage_key=$3 LIMIT 1`,
          [candidate.tenant_id, candidate.user_id, candidate.storage_key]);
        if (current.rows[0]) return false;
        const result = await db.query(`INSERT INTO phone11_profile_photo_deletions
          (storage_key,tenant_id,user_id,queued_at) VALUES($1,$2,$3,clock_timestamp())
          ON CONFLICT(storage_key) DO NOTHING RETURNING storage_key`,
          [candidate.storage_key, candidate.tenant_id, candidate.user_id]);
        return Boolean(result.rows[0]);
      });
      if (inserted) queued += 1;
    } catch (error) { if ((error as { code?: unknown })?.code !== "42P01") throw error; }
  }
  return queued;
}

export async function maintainProfilePhotoStorage(): Promise<number> {
  const queued = await reconcileProfilePhotoOrphans();
  const deleted = await drainProfilePhotoDeletions();
  return queued + deleted;
}

async function queueFailedStorageCleanup(tenantId: number, userId: number, storageKey: string, transaction: Transaction) {
  try {
    await transaction(async db => {
      if (!(await profilePhotosAvailable(db))) return;
      await enqueueDeletion(db, { tenant_id: tenantId, user_id: userId, storage_key: storageKey });
    });
  } catch { /* Reconciliation discovers a sufficiently old orphan later. */ }
}

async function authenticate(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!Number.isSafeInteger(user?.id) || user.id <= 0) throw new Error("invalid user");
    res.locals.phone11ProfileUserId = user.id;
    next();
  } catch { res.status(401).json({ error: "Sign in to access profile photos" }); }
}

export function createProfilePhotoRouter(transaction: Transaction = withTransaction) {
  const router = Router();
  router.post("/photo", authenticate, (req, res, next) => {
    if (declaredBodyTooLarge(req)) { res.status(413).json({ error: "Profile photos are limited to 2 MiB." }); return; }
    if (!cookieMutationOriginAllowed(req)) { res.status(403).json({ error: "Origin not allowed" }); return; }
    const tenantId = Number(firstHeader(req.headers["x-phone11-profile-tenant"]));
    const userId = Number(res.locals.phone11ProfileUserId);
    if (!Number.isSafeInteger(tenantId) || tenantId <= 0) { res.status(400).json({ error: "Choose an active workspace." }); return; }
    void transaction(async db => { await authorizeWorkspace(db, userId, tenantId); })
      .then(() => raw({ type: () => true, limit: MAX_PROFILE_PHOTO_BYTES })(req, res, next))
      .catch(() => res.status(403).json({ error: "This workspace is unavailable for your account." }));
  }, async (req, res) => {
    const tenantId = Number(firstHeader(req.headers["x-phone11-profile-tenant"]));
    const userId = Number(res.locals.phone11ProfileUserId);
    const mime = normalizedMime(firstHeader(req.headers["content-type"]));
    if (!mime) { res.status(415).json({ error: "Use a JPEG, PNG, or WebP image." }); return; }
    if (!Buffer.isBuffer(req.body) || !req.body.length || req.body.length > MAX_PROFILE_PHOTO_BYTES) {
      res.status(400).json({ error: "Choose a valid image up to 2048 by 2048 pixels." }); return;
    }
    let valid: boolean;
    try { valid = await validProfilePhotoBytes(mime, req.body); }
    catch { res.status(503).json({ error: "Profile photo validation is temporarily unavailable." }); return; }
    if (!valid) { res.status(400).json({ error: "Choose a valid image up to 2048 by 2048 pixels." }); return; }
    const bytes = req.body as Buffer;
    const version = randomUUID();
    let storageKey: string | null = null;
    try {
      const digest = createHash("sha256").update(bytes).digest("hex");
      const old = await transaction(async db => {
        await authorizeWorkspace(db, userId, tenantId);
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`phone11-profile-photo:${tenantId}:${userId}`]);
        // Keep file creation under the owner lock. Reconciliation takes the
        // same lock before deciding that an unreferenced file is an orphan.
        storageKey = await storeBytes(tenantId, userId, version, mime, bytes);
        const previous = await db.query<{ storage_key: string }>(`SELECT storage_key FROM phone11_workspace_profile_photos
          WHERE tenant_id=$1 AND user_id=$2 FOR UPDATE`, [tenantId, userId]);
        const written = await db.query<PhotoRow>(`INSERT INTO phone11_workspace_profile_photos
          (tenant_id,user_id,version,storage_key,mime_type,size_bytes,content_sha256,updated_at)
          SELECT $1,$2,$3,$4,$5,$6,$7,clock_timestamp()
          FROM tenant_memberships tm JOIN tenants t ON t.id=tm.tenant_id AND t.status='active'
          WHERE tm.tenant_id=$1 AND tm.user_id=$2 AND tm.status='active'
          ON CONFLICT(tenant_id,user_id) DO UPDATE SET version=EXCLUDED.version,storage_key=EXCLUDED.storage_key,
            mime_type=EXCLUDED.mime_type,size_bytes=EXCLUDED.size_bytes,content_sha256=EXCLUDED.content_sha256,updated_at=clock_timestamp()
          WHERE EXISTS(SELECT 1 FROM tenant_memberships current
            JOIN tenants active_tenant ON active_tenant.id=current.tenant_id AND active_tenant.status='active'
            WHERE current.tenant_id=$1 AND current.user_id=$2 AND current.status='active')
          RETURNING tenant_id,user_id,version,storage_key,mime_type,size_bytes,content_sha256`,
          [tenantId, userId, version, storageKey, mime, bytes.length, digest]);
        if (!written.rows[0]) throw new TRPCError({ code: "FORBIDDEN", message: "Workspace access changed" });
        if (previous.rows[0]?.storage_key && previous.rows[0].storage_key !== storageKey) {
          await enqueueDeletion(db, { tenant_id: tenantId, user_id: userId, storage_key: previous.rows[0].storage_key });
        }
        return { row: written.rows[0], oldStorageKey: previous.rows[0]?.storage_key ?? null };
      });
      if (old.oldStorageKey) await drainProfilePhotoDeletions(20, transaction).catch(() => undefined);
      res.status(201).json(descriptor(old.row));
    } catch (error) {
      if (storageKey) {
        try { await removeStored(tenantId, userId, storageKey); }
        catch { await queueFailedStorageCleanup(tenantId, userId, storageKey, transaction); }
      }
      if (error instanceof TRPCError && error.code === "FORBIDDEN") { res.status(403).json({ error: "This workspace is unavailable for your account." }); return; }
      res.status(503).json({ error: "Profile photo storage is temporarily unavailable." });
    }
  });

  router.get("/photo/:tenantId/:userId", authenticate, async (req, res) => {
    const tenantId = Number(req.params.tenantId), targetUserId = Number(req.params.userId);
    const viewerUserId = Number(res.locals.phone11ProfileUserId);
    const version = typeof req.query.v === "string" && UUID.test(req.query.v) ? req.query.v : null;
    if (!Number.isSafeInteger(tenantId) || tenantId <= 0 || !Number.isSafeInteger(targetUserId) || targetUserId <= 0 || !version) {
      res.status(404).json({ error: "Profile photo is unavailable" }); return;
    }
    try {
      const row = await transaction(async db => {
        await authorizeWorkspace(db, viewerUserId, tenantId);
        await requireTargetMember(db, tenantId, targetUserId);
        if (!(await profilePhotosAvailable(db))) return null;
        return (await db.query<PhotoRow>(`SELECT tenant_id,user_id,version,storage_key,mime_type,size_bytes,content_sha256
          FROM phone11_workspace_profile_photos WHERE tenant_id=$1 AND user_id=$2 AND version=$3`,
          [tenantId, targetUserId, version])).rows[0] ?? null;
      });
      if (!row) { res.status(404).json({ error: "Profile photo is unavailable" }); return; }
      const bytes = await readStored(row);
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Type", row.mime_type);
      res.setHeader("Content-Length", String(bytes.length));
      res.end(bytes);
    } catch (error) {
      if (error instanceof TRPCError && (error.code === "FORBIDDEN" || error.code === "NOT_FOUND")) { res.status(404).json({ error: "Profile photo is unavailable" }); return; }
      res.status(503).json({ error: "Profile photo is temporarily unavailable" });
    }
  });

  router.delete("/photo/:tenantId", authenticate, async (req, res) => {
    if (!cookieMutationOriginAllowed(req)) { res.status(403).json({ error: "Origin not allowed" }); return; }
    const tenantId = Number(req.params.tenantId), userId = Number(res.locals.phone11ProfileUserId);
    if (!Number.isSafeInteger(tenantId) || tenantId <= 0) { res.status(400).json({ error: "Choose an active workspace." }); return; }
    try {
      const oldStorageKey = await transaction(async db => {
        await authorizeWorkspace(db, userId, tenantId);
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`phone11-profile-photo:${tenantId}:${userId}`]);
        if (!(await profilePhotosAvailable(db))) return null;
        const removed = (await db.query<{ storage_key: string }>(`DELETE FROM phone11_workspace_profile_photos photo
          USING tenant_memberships tm, tenants t
          WHERE photo.tenant_id=$1 AND photo.user_id=$2 AND tm.tenant_id=photo.tenant_id AND tm.user_id=photo.user_id
            AND tm.status='active' AND t.id=tm.tenant_id AND t.status='active' RETURNING photo.storage_key`, [tenantId, userId])).rows[0]?.storage_key ?? null;
        if (removed) await enqueueDeletion(db, { tenant_id: tenantId, user_id: userId, storage_key: removed });
        return removed;
      });
      if (oldStorageKey) await drainProfilePhotoDeletions(20, transaction).catch(() => undefined);
      res.json({ userId, photoVersion: null, photoUrl: null });
    } catch (error) {
      if (error instanceof TRPCError && error.code === "FORBIDDEN") { res.status(403).json({ error: "This workspace is unavailable for your account." }); return; }
      res.status(503).json({ error: "Profile photo storage is temporarily unavailable." });
    }
  });

  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if ((error as { type?: string }).type === "entity.too.large") { res.status(413).json({ error: "Profile photos are limited to 2 MiB." }); return; }
    res.status(400).json({ error: "Invalid profile photo request" });
  });
  return router;
}

export const profilePhotoRouter = createProfilePhotoRouter();
