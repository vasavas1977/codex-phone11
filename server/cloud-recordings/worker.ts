import { randomUUID } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { clearInterval, setInterval } from "node:timers";
import { analyzeRecordingAudio, RecordingAnalysisError, type RecordingAnalysis } from "./gemini";
import type { RecordingFailure } from "./failure";
import { createCloudRecordingRepository, type RecordingJob } from "./repository";

const maxBytes = 100 * 1024 * 1024;
export async function readPrivateRecording(job: RecordingJob, root = process.env.RECORDINGS_PATH || "/opt/phone11ai/recordings") {
  if (!Number.isSafeInteger(job.tenantId) || job.tenantId <= 0) throw new Error("Invalid recording tenant");
  const base = await fs.realpath(root);
  const tenant = path.join(base, String(job.tenantId));
  const resolved = await fs.realpath(job.storageKey);
  if (!resolved.startsWith(tenant + path.sep) || !resolved.endsWith(".wav")) throw new Error("Invalid recording path");
  const file = await fs.open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 44 || stat.size > maxBytes) throw new Error("Invalid recording file");
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const next = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!next.bytesRead) throw new Error("Recording changed during read");
      offset += next.bytesRead;
    }
    const after = await file.stat();
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Error("Recording changed during read");
    return bytes;
  } finally { await file.close(); }
}
interface Repository {
  claimJob(workerId: string): Promise<RecordingJob | null>;
  validateJob(job: RecordingJob): Promise<boolean>;
  finishJob(job: RecordingJob, result: RecordingAnalysis | null, failure?: RecordingFailure): Promise<boolean>;
}
/** Each tick claims at most one leased job. Failures never affect live call processing. */
export async function processRecordingJob(deps: {
  repository: Repository;
  workerId: string;
  read?: (job: RecordingJob) => Promise<Buffer>;
  analyze?: (input: { bytes: Buffer; mimeType: "audio/wav" }) => Promise<RecordingAnalysis>;
}) {
  const job = await deps.repository.claimJob(deps.workerId);
  if (!job) return "idle" as const;
  let bytes: Buffer | undefined;
  let phase: "read" | "validate" | "analyze" | "persist" = "read";
  try {
    bytes = await (deps.read ?? readPrivateRecording)(job);
    phase = "validate";
    if (!await deps.repository.validateJob(job)) return "revoked" as const;
    phase = "analyze";
    const result = await (deps.analyze ?? analyzeRecordingAudio)({ bytes, mimeType: "audio/wav" });
    phase = "persist";
    return await deps.repository.finishJob(job, result) ? "completed" as const : "revoked" as const;
  } catch (error) {
    const failure: RecordingFailure = error instanceof RecordingAnalysisError
      ? { code: error.code, stage: error.stage }
      : { code: phase === "read" ? "recording_read_failed" : "analysis_failed", stage: phase };
    // Persist only allowlisted codes; never provider bodies, transcripts, URLs or credentials.
    await deps.repository.finishJob(job, null, failure);
    return "failed" as const;
  } finally { bytes?.fill(0); }
}
export function startRecordingAnalysisWorker(options: {
  repository?: Repository;
  workerId?: string;
  processJob?: typeof processRecordingJob;
  intervalMs?: number;
} = {}) {
  if (process.env.PHONE11_RECORDING_AI_ENABLED !== "true") return async () => {};
  if (!process.env.GEMINI_API_KEY || !process.env.PHONE11_RECORDING_GEMINI_MODEL) {
    console.warn("[RecordingAnalysis] Worker disabled: provider configuration missing");
    return async () => {};
  }
  const repository = options.repository ?? createCloudRecordingRepository();
  const workerId = options.workerId ?? `recording-${randomUUID()}`;
  const processJob = options.processJob ?? processRecordingJob;
  let stopped = false, activeTick: Promise<void> | undefined, stopPromise: Promise<void> | undefined;
  const tick = () => {
    if (activeTick || stopped) return;
    const current = (async () => {
      try { await processJob({ repository, workerId }); }
      catch { console.warn("[RecordingAnalysis] Worker tick unavailable"); }
    })();
    activeTick = current;
    void current.finally(() => { if (activeTick === current) activeTick = undefined; });
  };
  const timer = setInterval(tick, options.intervalMs ?? 5000) as unknown as NodeJS.Timeout;
  timer.unref();
  tick();
  return () => {
    if (stopPromise) return stopPromise;
    stopped = true;
    clearInterval(timer);
    stopPromise = activeTick ?? Promise.resolve();
    return stopPromise;
  };
}

interface PurgeJob { callUuid: string; tenantId: number; storageKey: string | null; purgeToken: string }
interface PurgeRepository {
  claimPurge(): Promise<PurgeJob | null>;
  completePurge(callUuid: string, token: string): Promise<boolean>;
}
export async function removeExpiredRecording(job: PurgeJob, root = process.env.RECORDINGS_PATH || "/opt/phone11ai/recordings") {
  if (!job.storageKey) return;
  if (!Number.isSafeInteger(job.tenantId) || job.tenantId <= 0) throw new Error("Invalid recording tenant");
  const base = await fs.realpath(root);
  const parent = await fs.realpath(path.dirname(job.storageKey));
  if (!parent.startsWith(path.join(base, String(job.tenantId)) + path.sep) && parent !== path.join(base, String(job.tenantId))) {
    throw new Error("Invalid recording path");
  }
  const target = path.join(parent, path.basename(job.storageKey));
  if (!target.endsWith(".wav")) throw new Error("Invalid recording file");
  // Unlink the owned directory entry, never follow a final symlink for deletion.
  try { await fs.unlink(target); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
export async function processRecordingPurge(deps: {
  repository: PurgeRepository;
  remove?: (job: PurgeJob) => Promise<void>;
}) {
  const job = await deps.repository.claimPurge();
  if (!job) return "idle" as const;
  await (deps.remove ?? removeExpiredRecording)(job);
  return await deps.repository.completePurge(job.callUuid, job.purgeToken) ? "completed" as const : "stale" as const;
}
export function startRecordingRetentionWorker(options: {
  repository?: PurgeRepository;
  processPurge?: typeof processRecordingPurge;
  intervalMs?: number;
} = {}) {
  if (process.env.PHONE11_RECORDING_RETENTION_ENABLED !== "true") return async () => {};
  const repository = options.repository ?? createCloudRecordingRepository();
  const processPurge = options.processPurge ?? processRecordingPurge;
  let stopped = false, activeTick: Promise<void> | undefined, stopPromise: Promise<void> | undefined;
  const tick = () => {
    if (activeTick || stopped) return;
    const current = (async () => {
      try { for (let count = 0; count < 20 && !stopped; count++) if (await processPurge({ repository }) === "idle") break; }
      catch { console.warn("[RecordingRetention] Cleanup unavailable; lease will retry"); }
    })();
    activeTick = current;
    void current.finally(() => { if (activeTick === current) activeTick = undefined; });
  };
  const timer = setInterval(tick, options.intervalMs ?? 60_000) as unknown as NodeJS.Timeout; timer.unref(); tick();
  return () => {
    if (stopPromise) return stopPromise;
    stopped = true;
    clearInterval(timer);
    stopPromise = activeTick ?? Promise.resolve();
    return stopPromise;
  };
}
