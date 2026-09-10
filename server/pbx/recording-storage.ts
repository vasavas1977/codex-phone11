/** Authenticated recording storage. Unsupported voicemail storage fails closed. */
import { Router, raw, type Request, type Response } from "express";
import { query } from "./db";
import * as fs from "node:fs";
import * as path from "node:path";
import { sdk } from "../_core/sdk";
import { requireIntegrationSecret } from "./integration-auth";
import { findOwnedRecording } from "./media-access";

const RECORDINGS_BASE = process.env.RECORDINGS_PATH || "/opt/phone11ai/recordings";
const MAX_RECORDING_SIZE = 100 * 1024 * 1024;
const validUuid = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const validTenant = (value: number) => Number.isSafeInteger(value) && value > 0;

export async function storeRecording(tenantId: number, callUuid: string, fileBuffer: Buffer, format = "wav") {
  if (!validTenant(tenantId) || !validUuid(callUuid) || format !== "wav" || !fileBuffer.length || fileBuffer.length > MAX_RECORDING_SIZE) {
    throw new Error("Invalid recording upload");
  }
  const now = new Date();
  const dir = path.join(RECORDINGS_BASE, String(tenantId), `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`);
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
  const base = await fs.promises.realpath(RECORDINGS_BASE);
  const realDir = await fs.promises.realpath(dir);
  if (!realDir.startsWith(path.join(base, String(tenantId)) + path.sep)) throw new Error("Invalid recording directory");
  const filePath = path.join(realDir, `${callUuid}.wav`);
  // Exclusive creation prevents overwriting a recording or following an existing symlink.
  await fs.promises.writeFile(filePath, fileBuffer, { flag: "wx", mode: 0o600 });
  return { filePath, fileSize: fileBuffer.length };
}

export async function storeVoicemail(..._args: unknown[]): Promise<{ id: number; filePath: string }> {
  throw new Error("Voicemail storage is not available on this server");
}

async function authenticate(req: Request, res: Response): Promise<number | null> {
  try {
    const user = await sdk.authenticateRequest(req);
    if (user && Number.isSafeInteger(user.id) && user.id > 0) return user.id;
  } catch { /* All failed session verification is denied before database or file access. */ }
  res.status(401).json({ error: "Sign in to access call media" });
  return null;
}

export const storageRouter = Router();
const verifyFsAuth = requireIntegrationSecret("FS_SHARED_SECRET", "x-fs-secret");

/** Raw WAV body; call_uuid and tenant_id are query fields, never authorization. */
storageRouter.post("/upload", verifyFsAuth, raw({ type: ["audio/wav", "audio/x-wav", "application/octet-stream"], limit: MAX_RECORDING_SIZE }), async (req, res) => {
  const callUuid = req.query.call_uuid;
  const tenantId = typeof req.query.tenant_id === "string" ? Number(req.query.tenant_id) : NaN;
  if (!validUuid(callUuid) || !validTenant(tenantId) || !Buffer.isBuffer(req.body) || !req.body.length) {
    res.status(400).json({ error: "Provide a WAV body and valid call_uuid and tenant_id" }); return;
  }
  try {
    const call = await query("SELECT id FROM call_records WHERE call_uuid = $1 AND tenant_id = $2", [callUuid, tenantId]);
    if (!call.rows.length) { res.status(404).json({ error: "Call not found" }); return; }
    const stored = await storeRecording(tenantId, callUuid, req.body);
    await query("UPDATE call_records SET recording_url = $1 WHERE call_uuid = $2 AND tenant_id = $3", [stored.filePath, callUuid, tenantId]);
    res.json({ ok: true, size: stored.fileSize });
  } catch {
    res.status(503).json({ error: "Recording storage is unavailable" });
  }
});

storageRouter.post("/voicemail", verifyFsAuth, (_req, res) => {
  res.status(503).json({ error: "Voicemail storage is not available on this server" });
});

storageRouter.get("/play/:callUuid", async (req, res) => {
  const userId = await authenticate(req, res);
  if (!userId) return;
  const callUuid = req.params.callUuid;
  if (!validUuid(callUuid)) { res.status(404).json({ error: "Recording not found" }); return; }
  try {
    const record = await findOwnedRecording(userId, callUuid);
    if (!record?.recording_url || !validTenant(Number(record.tenant_id))) {
      res.status(404).json({ error: "Recording not found" }); return;
    }
    // Authorization precedes every filesystem access. Resolve symlinks before containment checks.
    const base = await fs.promises.realpath(RECORDINGS_BASE);
    const filePath = await fs.promises.realpath(record.recording_url);
    if (!filePath.startsWith(path.join(base, String(record.tenant_id)) + path.sep)) {
      res.status(404).json({ error: "Recording not found" }); return;
    }
    res.set({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Type": "audio/wav" });
    res.sendFile(filePath, error => { if (error && !res.headersSent) res.status(404).json({ error: "Recording not found" }); });
  } catch {
    if (!res.headersSent) res.status(503).json({ error: "Recording is unavailable" });
  }
});

storageRouter.get("/voicemail/:id", async (req, res) => {
  if (!await authenticate(req, res)) return;
  res.status(503).json({ error: "Voicemail storage is not available on this server" });
});
