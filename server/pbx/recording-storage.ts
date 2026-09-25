import { createHash, randomUUID } from "node:crypto";
import { ingestStoredRecording } from "../cloud-recordings/ingestion";
/** Authenticated recording storage. Unsupported voicemail storage fails closed. */
import { Router, raw, type Request, type Response } from "express";
import { query, withTransaction } from "./db";
import * as fs from "node:fs";
import * as path from "node:path";
import { sdk } from "../_core/sdk";
import { requireIntegrationSecret } from "./integration-auth";
import { findOwnedRecording, findOwnedVoicemail } from "./media-access";

const RECORDINGS_BASE = process.env.RECORDINGS_PATH || "/opt/phone11ai/recordings";
const VOICEMAIL_BASE = process.env.VOICEMAIL_PATH || "/opt/phone11ai/voicemail";
const MAX_RECORDING_SIZE = 100 * 1024 * 1024;
const MAX_VOICEMAIL_SIZE = 25 * 1024 * 1024;
const validUuid = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const validTenant = (value: number) => Number.isSafeInteger(value) && value > 0;
const validVoicemailId = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const validExtension = (value: unknown): value is string =>
  typeof value === "string" && /^[1-9][0-9]{0,15}$/.test(value);
const safeText = (value: unknown, maximum: number): string | null => {
  if (typeof value !== "string" || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value))
    return null;
  return value;
};

const ACTIVE_VOICEMAIL_MAILBOX = `SELECT e.id, e.user_id, e.voicemail_owner_epoch FROM extensions e
  JOIN tenants t ON t.id = e.tenant_id AND t.status = 'active'
  JOIN user_extensions ue ON ue.extension_id = e.id AND ue.user_id = e.user_id
  JOIN tenant_memberships tm ON tm.user_id = ue.user_id
    AND tm.tenant_id = e.tenant_id AND tm.status = 'active'
  WHERE e.tenant_id = $1 AND e.extension_number = $2
    AND e.type = 'user' AND e.status = 'active' AND e.deleted_at IS NULL
    AND e.voicemail_enabled = true`;

export async function storeRecording(tenantId: number, callUuid: string, fileBuffer: Buffer, format = "wav", idempotent = false) {
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
  try { await fs.promises.writeFile(filePath, fileBuffer, { flag: "wx", mode: 0o600 }); }
  catch(error) {
    if(!idempotent || (error as NodeJS.ErrnoException).code!=="EEXIST")throw error;
    const handle=await fs.promises.open(filePath,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    try {const st=await handle.stat();if(!st.isFile()||st.size!==fileBuffer.length)throw new Error("Recording identity mismatch");
      const bytes=await handle.readFile();if(!createHash('sha256').update(bytes).digest().equals(createHash('sha256').update(fileBuffer).digest()))throw new Error("Recording identity mismatch");
    }finally{await handle.close();}
  }
  return { filePath, fileSize: fileBuffer.length };
}

/** Store a completed voicemail under a tenant-only directory. Metadata remains in PostgreSQL. */
export async function storeVoicemail(
  tenantId: number,
  messageUuid: string,
  fileBuffer: Buffer,
  idempotent = false,
): Promise<{ filePath: string; fileSize: number; created: boolean }> {
  if (
    !validTenant(tenantId) ||
    !validUuid(messageUuid) ||
    !fileBuffer.length ||
    fileBuffer.length > MAX_VOICEMAIL_SIZE
  ) {
    throw new Error("Invalid voicemail upload");
  }
  const now = new Date();
  const dir = path.join(
    VOICEMAIL_BASE,
    String(tenantId),
    `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`,
  );
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
  const base = await fs.promises.realpath(VOICEMAIL_BASE);
  const realDir = await fs.promises.realpath(dir);
  if (!realDir.startsWith(path.join(base, String(tenantId)) + path.sep))
    throw new Error("Invalid voicemail directory");
  const filePath = path.join(realDir, `${messageUuid}.wav`);
  try {
    await fs.promises.writeFile(filePath, fileBuffer, { flag: "wx", mode: 0o600 });
    return { filePath, fileSize: fileBuffer.length, created: true };
  } catch (error) {
    if (!idempotent || (error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const handle = await fs.promises.open(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size !== fileBuffer.length)
        throw new Error("Voicemail identity mismatch");
      const bytes = await handle.readFile();
      if (!createHash("sha256").update(bytes).digest().equals(createHash("sha256").update(fileBuffer).digest()))
        throw new Error("Voicemail identity mismatch");
    } finally {
      await handle.close();
    }
    return { filePath, fileSize: fileBuffer.length, created: false };
  }
}

/**
 * Verify an already-persisted voicemail before treating a delivery as an
 * idempotent retry. The database path is untrusted input until it has been
 * resolved under this tenant's voicemail directory and matched byte-for-byte.
 */
async function verifyStoredVoicemail(
  tenantId: number,
  storagePath: unknown,
  fileBuffer: Buffer,
): Promise<{ filePath: string; fileSize: number }> {
  if (!validTenant(tenantId) || typeof storagePath !== "string" || !fileBuffer.length || fileBuffer.length > MAX_VOICEMAIL_SIZE) {
    throw new Error("Invalid voicemail identity");
  }
  const base = await fs.promises.realpath(VOICEMAIL_BASE);
  const filePath = await fs.promises.realpath(storagePath);
  const tenantDirectory = path.join(base, String(tenantId)) + path.sep;
  if (!filePath.startsWith(tenantDirectory)) throw new Error("Invalid voicemail path");

  const handle = await fs.promises.open(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== fileBuffer.length || stat.size > MAX_VOICEMAIL_SIZE)
      throw new Error("Voicemail identity mismatch");
    const bytes = await handle.readFile();
    if (!createHash("sha256").update(bytes).digest().equals(createHash("sha256").update(fileBuffer).digest()))
      throw new Error("Voicemail identity mismatch");
    return { filePath, fileSize: stat.size };
  } finally {
    await handle.close();
  }
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
    let stored: {filePath:string;fileSize:number};
    const captureToken = typeof req.query.capture_token === "string" ? req.query.capture_token : "";
    if(process.env.PHONE11_CLOUD_RECORDING_CAPTURE_ENABLED === "true") {
      if(!/^[a-f0-9-]{36}$/i.test(captureToken)){res.status(409).json({error:"Capture authorization required"});return;}
      const authorized=await query(`SELECT r.storage_key,r.recording_status FROM phone11_cloud_recordings r
       JOIN phone11_recording_policies p ON p.tenant_id=r.tenant_id WHERE r.call_uuid=$1 AND r.tenant_id=$2
       AND r.capture_token=$3 AND r.recording_status IN ('recording','ready') AND r.expires_at>clock_timestamp() AND p.mode<>'off'`,[callUuid,tenantId,captureToken]);
      if(authorized.rows.length!==1){res.status(409).json({error:"Capture authorization unavailable"});return;}
    }
    const existing=await query("SELECT recording_url FROM call_records WHERE call_uuid=$1 AND tenant_id=$2",[callUuid,tenantId]);
    if(captureToken && existing.rows[0]?.recording_url) {
      const base=await fs.promises.realpath(RECORDINGS_BASE);
      const filePath=await fs.promises.realpath(existing.rows[0].recording_url);
      if(!filePath.startsWith(path.join(base,String(tenantId))+path.sep))throw new Error("Invalid recording path");
      const stat=await fs.promises.stat(filePath);if(!stat.isFile()||stat.size!==req.body.length||stat.size>MAX_RECORDING_SIZE)throw new Error("Recording identity mismatch");
      const bytes=await fs.promises.readFile(filePath);
      if(createHash('sha256').update(bytes).digest('hex')!==createHash('sha256').update(req.body).digest('hex'))throw new Error("Recording identity mismatch");
      stored={filePath,fileSize:bytes.length};
    } else { stored = await storeRecording(tenantId, callUuid, req.body, "wav", Boolean(captureToken)); }
    await query("UPDATE call_records SET recording_url = $1 WHERE call_uuid = $2 AND tenant_id = $3", [stored.filePath, callUuid, tenantId]);
    // AI metadata is a separate gated pipeline. An unavailable job database must
    // never turn a successfully stored recording into an unsafe overwrite retry.
    let analysisQueued = false;
    try { analysisQueued = await ingestStoredRecording(callUuid, stored.filePath, typeof req.query.capture_token === "string" ? req.query.capture_token : ""); } catch { /* Reconciliation can retry metadata separately. */ }
    res.json({ ok: true, size: stored.fileSize, analysisQueued, ...(captureToken ? {storageKey:stored.filePath} : {}) });
  } catch {
    res.status(503).json({ error: "Recording storage is unavailable" });
  }
});

/** Obtain and persist mailbox ownership before FreeSWITCH begins recording. */
storageRouter.post("/voicemail/admission", verifyFsAuth, async (req, res) => {
  const tenantId = typeof req.query.tenant_id === "string" ? Number(req.query.tenant_id) : NaN;
  const extension = req.query.extension;
  if (!validTenant(tenantId) || !validExtension(extension)) {
    res.status(400).json({ error: "Provide a valid tenant and personal mailbox" });
    return;
  }
  try {
    const messageUuid = await withTransaction(async client => {
      // The row lock serializes this admission with an admin reassignment.
      const mailbox = await client.query(`${ACTIVE_VOICEMAIL_MAILBOX} FOR SHARE OF e`, [tenantId, extension]);
      if (mailbox.rows.length !== 1) return null;
      const id = randomUUID();
      await client.query(
        `INSERT INTO voicemail_deposit_admissions
         (message_uuid, tenant_id, extension_id, owner_user_id, owner_epoch)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, tenantId, mailbox.rows[0].id, mailbox.rows[0].user_id, mailbox.rows[0].voicemail_owner_epoch],
      );
      return id;
    });
    if (!messageUuid) {
      res.status(404).json({ error: "Voicemail mailbox not found" });
      return;
    }
    res.status(201).json({ message_uuid: messageUuid });
  } catch {
    res.status(503).json({ error: "Voicemail admission is unavailable" });
  }
});

storageRouter.post("/voicemail", verifyFsAuth, raw({ type: ["audio/wav", "audio/x-wav", "application/octet-stream"], limit: MAX_VOICEMAIL_SIZE }), async (req, res) => {
  const messageUuid = req.query.message_uuid;
  const tenantId = typeof req.query.tenant_id === "string" ? Number(req.query.tenant_id) : NaN;
  const extension = req.query.extension;
  const callerNumber = safeText(req.query.caller_number ?? "", 64);
  const callerName = safeText(req.query.caller_name ?? "", 160);
  const duration = typeof req.query.duration_seconds === "string" ? Number(req.query.duration_seconds) : 0;
  if (
    !validUuid(messageUuid) ||
    !validTenant(tenantId) ||
    !validExtension(extension) ||
    callerNumber === null ||
    callerName === null ||
    !Number.isSafeInteger(duration) ||
    duration < 0 ||
    duration > 86_400 ||
    !Buffer.isBuffer(req.body) ||
    !req.body.length
  ) {
    res.status(400).json({ error: "Provide a WAV body and valid voicemail metadata" });
    return;
  }

  let stored: { filePath: string; fileSize: number; created: boolean } | undefined;
  let createdFilePath: string | undefined;
  try {
    // The integration credential establishes the caller, but mailbox ownership
    // and tenant membership are still verified from local PBX data.
    const mailbox = await query(ACTIVE_VOICEMAIL_MAILBOX, [tenantId, extension]);
    if (mailbox.rows.length !== 1) {
      res.status(404).json({ error: "Voicemail mailbox not found" });
      return;
    }
    const admission = await query(
      `SELECT extension_id, owner_user_id, owner_epoch FROM voicemail_deposit_admissions
       WHERE tenant_id = $1 AND message_uuid = $2`,
      [tenantId, messageUuid],
    );
    const admitted = admission.rows[0];
    if (!admitted || Number(admitted.extension_id) !== Number(mailbox.rows[0].id) ||
        Number(admitted.owner_user_id) !== Number(mailbox.rows[0].user_id) ||
        admitted.owner_epoch !== mailbox.rows[0].voicemail_owner_epoch) {
      res.status(409).json({ error: "Voicemail admission is missing or stale" });
      return;
    }
    const existing = await query(
      `SELECT id, extension_id, owner_user_id, owner_epoch, storage_path, storage_size_bytes
       FROM voicemail_messages WHERE tenant_id = $1 AND message_uuid = $2`,
      [tenantId, messageUuid],
    );
    if (existing.rows.length) {
      const row = existing.rows[0];
      const verified = await verifyStoredVoicemail(tenantId, row.storage_path, req.body);
      if (Number(row.extension_id) !== Number(mailbox.rows[0].id) ||
          Number(row.owner_user_id) !== Number(mailbox.rows[0].user_id) ||
          row.owner_epoch !== mailbox.rows[0].voicemail_owner_epoch ||
          Number(row.storage_size_bytes) !== verified.fileSize)
        throw new Error("Voicemail identity mismatch");
      res.json({ ok: true, id: row.id, size: verified.fileSize, duplicate: true });
      return;
    }
    stored = await storeVoicemail(tenantId, messageUuid, req.body, true);
    if (stored.created) createdFilePath = stored.filePath;
    const inserted = await query(
      `INSERT INTO voicemail_messages
       (tenant_id, extension_id, owner_user_id, owner_epoch, message_uuid, caller_number, caller_name, duration_seconds, storage_path, storage_size_bytes)
       VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, ''), $8, $9, $10)
       ON CONFLICT (tenant_id, message_uuid) DO NOTHING
       RETURNING id, owner_user_id, owner_epoch, storage_path, storage_size_bytes`,
      [tenantId, mailbox.rows[0].id, mailbox.rows[0].user_id, mailbox.rows[0].voicemail_owner_epoch, messageUuid, callerNumber, callerName, duration, stored.filePath, stored.fileSize],
    );
    const row = inserted.rows[0];
    if (!row) {
      const duplicate = await query(
        `SELECT id, extension_id, owner_user_id, owner_epoch, storage_path, storage_size_bytes FROM voicemail_messages
         WHERE tenant_id = $1 AND message_uuid = $2`,
        [tenantId, messageUuid],
      );
      const existingRow = duplicate.rows[0];
      if (!existingRow) throw new Error("Voicemail identity mismatch");
      const verified = await verifyStoredVoicemail(tenantId, existingRow.storage_path, req.body);
      if (Number(existingRow.extension_id) !== Number(mailbox.rows[0].id) ||
          Number(existingRow.owner_user_id) !== Number(mailbox.rows[0].user_id) ||
          existingRow.owner_epoch !== mailbox.rows[0].voicemail_owner_epoch ||
          Number(existingRow.storage_size_bytes) !== verified.fileSize)
        throw new Error("Voicemail identity mismatch");
      // Another delivery won the database race. Keep its verified object and
      // remove only the new object this request created.
      if (createdFilePath && createdFilePath !== verified.filePath) {
        await fs.promises.unlink(createdFilePath).catch(() => {});
        createdFilePath = undefined;
      }
      res.json({ ok: true, id: existingRow.id, size: verified.fileSize, duplicate: true });
      return;
    }
    res.status(201).json({ ok: true, id: row.id, size: stored.fileSize, duplicate: false });
  } catch {
    // Leave an unindexed object for reconciliation. Another concurrent upload
    // may have committed the same UUID and path after this request wrote it;
    // deleting here could remove a live voicemail.
    res.status(503).json({ error: "Voicemail storage is unavailable" });
  }
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
  const userId = await authenticate(req, res);
  if (!userId) return;
  const id = Number(req.params.id);
  if (!validVoicemailId(id) || !/^\d+$/.test(req.params.id)) {
    res.status(404).json({ error: "Voicemail not found" });
    return;
  }
  try {
    const voicemail = await findOwnedVoicemail(userId, id);
    if (!voicemail || !validTenant(Number(voicemail.tenant_id))) {
      res.status(404).json({ error: "Voicemail not found" });
      return;
    }
    const base = await fs.promises.realpath(VOICEMAIL_BASE);
    const filePath = await fs.promises.realpath(voicemail.storage_path);
    if (!filePath.startsWith(path.join(base, String(voicemail.tenant_id)) + path.sep)) {
      res.status(404).json({ error: "Voicemail not found" });
      return;
    }
    res.set({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Type": "audio/wav" });
    res.sendFile(filePath, error => {
      if (error && !res.headersSent) res.status(404).json({ error: "Voicemail not found" });
    });
  } catch {
    if (!res.headersSent) res.status(503).json({ error: "Voicemail is unavailable" });
  }
});
