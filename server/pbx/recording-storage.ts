/**
 * Recording & Voicemail Storage Module
 * 
 * Handles:
 * 1. Call recording file storage (local + optional S3)
 * 2. Voicemail message storage
 * 3. Audio file serving via API
 * 4. Storage cleanup and retention policies
 * 
 * Storage strategy:
 * - Local: /opt/phone11ai/recordings/{tenant_id}/{YYYY-MM}/{uuid}.wav
 * - S3 (optional): s3://phone11-recordings/{tenant_id}/{YYYY-MM}/{uuid}.wav
 */
import { Router, Request, Response } from "express";
import { query } from "./db";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

const RECORDINGS_BASE = process.env.RECORDINGS_PATH || "/opt/phone11ai/recordings";
const VOICEMAIL_BASE = process.env.VOICEMAIL_PATH || "/opt/phone11ai/voicemail";
const MAX_RECORDING_SIZE = 100 * 1024 * 1024; // 100MB max per recording

// Ensure base directories exist
[RECORDINGS_BASE, VOICEMAIL_BASE].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

/**
 * Get the storage path for a recording
 */
function getRecordingPath(tenantId: number, callUuid: string, format: string = "wav"): string {
  const now = new Date();
  const monthDir = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const dir = path.join(RECORDINGS_BASE, String(tenantId), monthDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, `${callUuid}.${format}`);
}

/**
 * Get the storage path for a voicemail
 */
function getVoicemailPath(tenantId: number, extension: string, format: string = "wav"): string {
  const dir = path.join(VOICEMAIL_BASE, String(tenantId), extension);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const id = crypto.randomUUID();
  return path.join(dir, `${id}.${format}`);
}

/**
 * Store a recording file from FreeSWITCH
 * FreeSWITCH sends the recording as a multipart/form-data POST
 */
async function storeRecording(
  tenantId: number,
  callUuid: string,
  fileBuffer: Buffer,
  format: string = "wav"
): Promise<{ filePath: string; fileSize: number; durationMs?: number }> {
  const filePath = getRecordingPath(tenantId, callUuid, format);
  fs.writeFileSync(filePath, fileBuffer);
  
  return {
    filePath,
    fileSize: fileBuffer.length,
  };
}

/**
 * Store a voicemail message
 */
async function storeVoicemail(
  tenantId: number,
  extension: string,
  callerNumber: string,
  fileBuffer: Buffer,
  durationSeconds: number,
  format: string = "wav"
): Promise<{ id: number; filePath: string }> {
  const filePath = getVoicemailPath(tenantId, extension, format);
  fs.writeFileSync(filePath, fileBuffer);

  const result = await query(
    `INSERT INTO voicemail_messages 
      (tenant_id, extension_number, caller_number, file_path, file_size_bytes, 
       duration_seconds, format, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'new')
     RETURNING id`,
    [tenantId, extension, callerNumber, filePath, fileBuffer.length, durationSeconds, format]
  );

  return { id: result.rows[0].id, filePath };
}

/**
 * Express routes for recording/voicemail file serving
 */
const storageRouter = Router();

const FS_SHARED_SECRET = process.env.FS_SHARED_SECRET || "phone11-fs-secret-change-me";

function verifyFsAuth(req: Request, res: Response, next: Function) {
  const secret = req.headers["x-fs-secret"] || req.body?.secret || req.query?.secret;
  if (secret !== FS_SHARED_SECRET) {
    return res.status(403).send("Forbidden");
  }
  next();
}

/**
 * POST /api/recordings/upload
 * FreeSWITCH uploads recording files here after call ends
 * Body: multipart/form-data with fields: call_uuid, tenant_id, file
 */
storageRouter.post("/upload", verifyFsAuth, async (req: Request, res: Response) => {
  try {
    const { call_uuid, tenant_id, duration_seconds, caller_number, callee_number, direction } = req.body;

    if (!call_uuid || !tenant_id) {
      return res.status(400).json({ error: "Missing call_uuid or tenant_id" });
    }

    // For raw body uploads (FreeSWITCH sends raw audio)
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", async () => {
      const fileBuffer = Buffer.concat(chunks);
      
      if (fileBuffer.length === 0) {
        return res.status(400).json({ error: "Empty file" });
      }

      if (fileBuffer.length > MAX_RECORDING_SIZE) {
        return res.status(413).json({ error: "File too large" });
      }

      const stored = await storeRecording(parseInt(tenant_id), call_uuid, fileBuffer);

      // Update call record with recording path
      await query(
        `UPDATE call_records SET recording_url = $1, recording_duration_seconds = $2
         WHERE call_uuid = $3`,
        [stored.filePath, duration_seconds || null, call_uuid]
      );

      res.json({ ok: true, path: stored.filePath, size: stored.fileSize });
    });
  } catch (error: any) {
    console.error("[Recording Upload] Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/recordings/voicemail
 * FreeSWITCH sends voicemail recordings here
 */
storageRouter.post("/voicemail", verifyFsAuth, async (req: Request, res: Response) => {
  try {
    const { extension, tenant_id, caller_number, duration, duration_seconds, file_path } = req.body;
    const tenantId = parseInt(tenant_id || "1");
    const durationSec = parseInt(duration || duration_seconds || "0");

    if (!extension) {
      return res.status(400).json({ error: "Missing extension" });
    }

    // If file_path is provided (FreeSWITCH stores the file locally), reference it
    // Otherwise store an empty placeholder
    let filePath = file_path || null;
    let fileSize = 0;

    if (filePath) {
      try {
        const stat = fs.statSync(filePath);
        fileSize = stat.size;
      } catch {
        // File may not exist yet or be on a different host
        fileSize = 0;
      }
    }

    // Insert voicemail record into database
    const result = await query(
      `INSERT INTO voicemail_messages 
        (tenant_id, extension_number, caller_number, duration_seconds, file_path, file_size_bytes, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'new')
       RETURNING id, created_at`,
      [tenantId, extension, caller_number || "unknown", durationSec, filePath, fileSize]
    );

    const record = result.rows[0];
    console.log(`[Voicemail] Stored: id=${record.id}, ext=${extension}, caller=${caller_number}, duration=${durationSec}s`);
    res.json({ ok: true, id: record.id, created_at: record.created_at });
  } catch (error: any) {
    console.error("[Voicemail Upload] Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/recordings/play/:callUuid
 * Stream a recording file (requires auth token)
 */
storageRouter.get("/play/:callUuid", async (req: Request, res: Response) => {
  try {
    const { callUuid } = req.params;
    // TODO: Add proper auth check via JWT token
    
    const result = await query(
      `SELECT recording_url FROM call_records WHERE call_uuid = $1`,
      [callUuid]
    );

    if (!result.rows[0]?.recording_url) {
      return res.status(404).json({ error: "Recording not found" });
    }

    const filePath = result.rows[0].recording_url;
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Recording file missing" });
    }

    const stat = fs.statSync(filePath);
    res.writeHead(200, {
      "Content-Type": "audio/wav",
      "Content-Length": stat.size,
      "Content-Disposition": `inline; filename="${callUuid}.wav"`,
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (error: any) {
    console.error("[Recording Play] Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/recordings/voicemail/:id
 * Stream a voicemail file
 */
storageRouter.get("/voicemail/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const result = await query(
      `SELECT file_path FROM voicemail_messages WHERE id = $1`,
      [id]
    );

    if (!result.rows[0]?.file_path) {
      return res.status(404).json({ error: "Voicemail not found" });
    }

    const filePath = result.rows[0].file_path;
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Voicemail file missing" });
    }

    // Mark as read
    await query(`UPDATE voicemail_messages SET status = 'read', read_at = NOW() WHERE id = $1 AND status = 'new'`, [id]);

    const stat = fs.statSync(filePath);
    res.writeHead(200, {
      "Content-Type": "audio/wav",
      "Content-Length": stat.size,
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (error: any) {
    console.error("[Voicemail Play] Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

export { storageRouter, storeRecording, storeVoicemail };
