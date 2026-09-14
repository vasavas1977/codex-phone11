import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { RecordingAnalysisError } from "../server/cloud-recordings/gemini";
import { recordingFailureCode } from "../server/cloud-recordings/failure";
import { processRecordingJob, readPrivateRecording, processRecordingPurge, removeExpiredRecording } from "../server/cloud-recordings/worker";
const job = { callUuid: "call-test", tenantId: 1, storageKey: "/private/1/call.wav", leaseToken: "lease-test" };
const result = { transcript: "Hello", summary: { summary: "Greeting", actionItems: [], language: "en" } };
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true }); });
function fixture() {
  const bytes = Buffer.alloc(44, 1);
  const repository = { claimJob: vi.fn(async () => job), validateJob: vi.fn(async () => true), finishJob: vi.fn(async () => true) };
  const read = vi.fn(async () => bytes), analyze = vi.fn(async () => result);
  return { repository, workerId: "worker-test", read, analyze, bytes };
}
describe("durable recording worker", () => {
  it("acknowledges retention only after file deletion succeeds", async () => {
    const purge = { ...job, purgeToken: "purge-test" };
    const repository = { claimPurge: vi.fn(async () => purge), completePurge: vi.fn(async () => true) };
    const remove = vi.fn(async (): Promise<void> => { throw new Error("Disk unavailable"); });
    await expect(processRecordingPurge({ repository, remove })).rejects.toThrow("Disk unavailable");
    expect(repository.completePurge).not.toHaveBeenCalled();
    remove.mockResolvedValue(undefined);
    expect(await processRecordingPurge({ repository, remove })).toBe("completed");
    expect(repository.completePurge).toHaveBeenCalledWith(job.callUuid, "purge-test");
  });
  it("retention deletes only the tenant-owned entry and tolerates an already deleted file", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "p11-purge-")); dirs.push(root);
    await fs.mkdir(path.join(root, "1")); await fs.mkdir(path.join(root, "2"));
    const own = path.join(root, "1", "call.wav"), other = path.join(root, "2", "call.wav");
    await fs.writeFile(own, Buffer.alloc(44)); await fs.writeFile(other, Buffer.alloc(44));
    const purge = { ...job, storageKey: own, purgeToken: "purge-test" };
    await expect(removeExpiredRecording({ ...purge, storageKey: other }, root)).rejects.toThrow("Invalid recording path");
    await removeExpiredRecording(purge, root); await removeExpiredRecording(purge, root);
    expect((await fs.stat(other)).size).toBe(44);
  });
  it("publishes under the claimed lease and clears temporary audio", async () => {
    const f = fixture(); expect(await processRecordingJob(f)).toBe("completed");
    expect(f.repository.finishJob).toHaveBeenCalledWith(job, result);
    expect(f.bytes.every(byte => byte === 0)).toBe(true);
  });
  it("does not upload when policy or ownership was revoked after reading", async () => {
    const f = fixture(); f.repository.validateJob.mockResolvedValue(false);
    expect(await processRecordingJob(f)).toBe("revoked");
    expect(f.analyze).not.toHaveBeenCalled(); expect(f.repository.finishJob).not.toHaveBeenCalled();
    expect(f.bytes.every(byte => byte === 0)).toBe(true);
  });
  it("leaves publication denied if lease is invalidated while Gemini runs", async () => {
    const f = fixture(); f.repository.finishJob.mockResolvedValue(false);
    expect(await processRecordingJob(f)).toBe("revoked");
  });
  it("records a retryable failure without fake summary or leaked audio", async () => {
    const f = fixture(); f.analyze.mockRejectedValue(new Error("private provider details"));
    expect(await processRecordingJob(f)).toBe("failed");
    expect(f.repository.finishJob).toHaveBeenCalledWith(job, null, { code: "analysis_failed", stage: "analyze" });
    expect(f.bytes.every(byte => byte === 0)).toBe(true);
  });
  it("preserves a provider failure category without retaining provider content", async () => {
    const f = fixture(); f.analyze.mockRejectedValue(new RecordingAnalysisError("provider_rate_limited", "generate"));
    expect(await processRecordingJob(f)).toBe("failed");
    expect(f.repository.finishJob).toHaveBeenCalledWith(job, null, { code: "provider_rate_limited", stage: "generate" });
    expect(f.bytes.every(byte => byte === 0)).toBe(true);
  });
  it("distinguishes a local media read failure from an AI request failure", async () => {
    const f = fixture(); f.read.mockRejectedValue(new Error("private filesystem path"));
    expect(await processRecordingJob(f)).toBe("failed");
    expect(f.analyze).not.toHaveBeenCalled();
    expect(f.repository.finishJob).toHaveBeenCalledWith(job, null, { code: "recording_read_failed", stage: "read" });
  });
  it("does not mislabel a job validation outage as unreadable audio", async () => {
    const f = fixture(); f.repository.validateJob.mockRejectedValue(new Error("private database details"));
    expect(await processRecordingJob(f)).toBe("failed");
    expect(f.repository.finishJob).toHaveBeenCalledWith(job, null, { code: "analysis_failed", stage: "validate" });
    expect(f.analyze).not.toHaveBeenCalled();
  });
  it("rejects arbitrary exception text at the persistence boundary", () => {
    expect(recordingFailureCode({ code: "provider_rate_limited", stage: "generate" })).toBe("provider_rate_limited:generate");
    expect(recordingFailureCode({ code: "secret provider response", stage: "generate" } as never)).toBe("analysis_failed");
    expect(recordingFailureCode({ code: "invalid_result", stage: "secret audio URL" } as never)).toBe("analysis_failed");
    expect(recordingFailureCode()).toBe("analysis_failed");
  });
  it("does not touch media when no job is due", async () => {
    const f = fixture(); f.repository.claimJob.mockResolvedValue(null as never);
    expect(await processRecordingJob(f)).toBe("idle"); expect(f.read).not.toHaveBeenCalled();
  });
  it("reads only a bounded file under the exact tenant directory", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "p11-worker-")); dirs.push(root);
    await fs.mkdir(path.join(root, "1")); await fs.mkdir(path.join(root, "2"));
    const own = path.join(root, "1", "call.wav"), other = path.join(root, "2", "call.wav");
    await fs.writeFile(own, Buffer.alloc(44)); await fs.writeFile(other, Buffer.alloc(44));
    expect((await readPrivateRecording({ ...job, storageKey: own }, root)).length).toBe(44);
    await expect(readPrivateRecording({ ...job, storageKey: other }, root)).rejects.toThrow("Invalid recording path");
    const link = path.join(root, "1", "link.wav"); await fs.symlink(other, link);
    await expect(readPrivateRecording({ ...job, storageKey: link }, root)).rejects.toThrow("Invalid recording path");
    await fs.writeFile(own, "small");
    await expect(readPrivateRecording({ ...job, storageKey: own }, root)).rejects.toThrow("Invalid recording file");
  });
});
