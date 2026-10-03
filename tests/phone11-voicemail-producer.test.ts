import { afterEach, describe, expect, it, vi } from "vitest";
import { access, chmod, link, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { admitVoicemail as admitWithUuid, completeVoicemail, inspectStaleVoicemailPending,
  retireReviewedVoicemailPending, voicemailEvidenceAtCapacity,
  type AdmissionInput, type ProducerConfig } from "../scripts/phone11-voicemail-producer";

const channelUuid = "11111111-1111-4111-8111-111111111111";
const messageUuid = "22222222-2222-4222-8222-222222222222";
const admitVoicemail = (config: ProducerConfig, input: AdmissionInput, send: typeof fetch) =>
  admitWithUuid(config, input, send, () => messageUuid);
const roots: string[] = [];

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "phone11-vm-producer-"));
  roots.push(root);
  const sourceRoot = path.join(root, "source");
  const outboxRoot = path.join(root, "outbox");
  await mkdir(path.join(sourceRoot, "default", "phone11.cloud", "3001"), { recursive: true, mode: 0o700 });
  await chmod(sourceRoot, 0o700);
  const wav = path.join(sourceRoot, "default", "phone11.cloud", "3001", "recording.wav");
  await writeFile(wav, Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.from("audio")]));
  const config: ProducerConfig = { sourceRoot, outboxRoot, uploadUrl: "https://phone11.example/api/recordings/voicemail",
    integrationSecret: "s".repeat(32), mailboxRoots: { "12:3001": path.join(sourceRoot, "default", "phone11.cloud", "3001") } };
  return { config, wav };
}

afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe("FreeSWITCH voicemail producer", () => {
  it("does not create an outbox during read-only inspection", async () => {
    const { config } = await fixture();
    await expect(inspectStaleVoicemailPending(config)).rejects.toThrow();
    await expect(access(config.outboxRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("persists admission before completion and publishes one private relay manifest", async () => {
    const { config, wav } = await fixture();
    const send = vi.fn(async (url: string, init: RequestInit) => {
      expect(new URL(url).pathname).toBe("/api/recordings/voicemail/admission/idempotent");
      expect(new URL(url).searchParams.get("tenant_id")).toBe("12");
      expect(new URL(url).searchParams.get("extension")).toBe("3001");
      expect(new URL(url).searchParams.get("message_uuid")).toBe(messageUuid);
      expect(init.headers).toEqual({ "x-fs-secret": config.integrationSecret });
      return new Response(JSON.stringify({ message_uuid: messageUuid }), { status: 201 });
    });
    const input = { channelUuid, tenantId: 12, extension: "3001" };
    expect(await admitVoicemail(config, input, send as typeof fetch)).toBe(messageUuid);
    expect(await admitVoicemail(config, input, send as typeof fetch)).toBe(messageUuid);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await readdir(config.outboxRoot)).filter(name => name.endsWith(".json"))).toEqual([]);
    const pendingPath = path.join(config.outboxRoot, "pending", `${channelUuid}.json`);
    expect(JSON.parse(await readFile(pendingPath, "utf8"))).toEqual({ ...input, messageUuid, admitted: true });
    const pendingMode = await import("node:fs/promises").then(fs => fs.stat(pendingPath));
    expect(pendingMode.mode & 0o077).toBe(0);

    expect(await completeVoicemail(config, { channelUuid, voicemailFilePath: wav, callerNumber: "+6620303001", durationSeconds: 12 })).toBe(messageUuid);
    expect(await readdir(path.join(config.outboxRoot, "pending"))).toEqual([]);
    const manifestPath = path.join(config.outboxRoot, `${messageUuid}.json`);
    expect(JSON.parse(await readFile(manifestPath, "utf8"))).toEqual({
      message_uuid: messageUuid, tenant_id: 12, extension: "3001",
      relative_wav_path: path.join("default", "phone11.cloud", "3001", "recording.wav"),
      caller_number: "+6620303001", caller_name: "", duration_seconds: 12,
    });
    const manifestMode = await import("node:fs/promises").then(fs => fs.stat(manifestPath));
    expect(manifestMode.mode & 0o077).toBe(0);
  });

  it("retries a lost or malformed admission response with its durable UUID and no recording", async () => {
    const { config, wav } = await fixture();
    const input = { channelUuid, tenantId: 12, extension: "3001" };
    const uuidFactory = vi.fn(() => messageUuid);
    const seen: string[] = [];
    const lost = vi.fn(async (url: string) => {
      seen.push(new URL(url).searchParams.get("message_uuid")!);
      throw new Error("response lost after commit");
    });
    await expect(admitWithUuid(config, input, lost as typeof fetch, uuidFactory)).rejects.toThrow("response lost");
    const pending = path.join(config.outboxRoot, "pending", `${channelUuid}.json`);
    const intent = JSON.parse(await readFile(pending, "utf8"));
    expect(intent).toEqual({ ...input, requestMessageUuid: messageUuid, admitted: false });
    // The old producer requires messageUuid in pending evidence, so rollback
    // cannot treat an unacknowledged intent as permission to record.
    expect(typeof intent.messageUuid).not.toBe("string");
    await expect(completeVoicemail(config, { channelUuid, voicemailFilePath: wav })).rejects.toThrow("not been acknowledged");
    const malformed = vi.fn(async (url: string) => {
      seen.push(new URL(url).searchParams.get("message_uuid")!);
      return new Response(JSON.stringify({ message_uuid: channelUuid }), { status: 201 });
    });
    await expect(admitWithUuid(config, input, malformed as typeof fetch, uuidFactory)).rejects.toThrow("Invalid voicemail admission response");
    expect(JSON.parse(await readFile(pending, "utf8"))).toMatchObject({ requestMessageUuid: messageUuid, admitted: false });
    const retry = vi.fn(async (url: string) => {
      seen.push(new URL(url).searchParams.get("message_uuid")!);
      return new Response(JSON.stringify({ message_uuid: messageUuid }), { status: 201 });
    });
    expect(await admitWithUuid(config, input, retry as typeof fetch, uuidFactory)).toBe(messageUuid);
    expect(seen).toEqual([messageUuid, messageUuid, messageUuid]);
    expect(uuidFactory).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await readFile(pending, "utf8"))).toMatchObject({ messageUuid, admitted: true });
  });

  it("recovers an exact producer temp hardlink left after durable intent publication", async () => {
    const { config } = await fixture();
    const pendingDir = path.join(config.outboxRoot, "pending");
    await mkdir(pendingDir, { recursive: true, mode: 0o700 });
    const pending = path.join(pendingDir, `${channelUuid}.json`);
    const temporary = path.join(pendingDir, `.${messageUuid}.tmp`);
    const input = { channelUuid, tenantId: 12, extension: "3001" };
    await writeFile(temporary, JSON.stringify({ ...input, admitted: false, requestMessageUuid: messageUuid }), { mode: 0o600 });
    await link(temporary, pending); // crash after link and directory sync, before temp unlink
    const old = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000);
    await utimes(pending, old, old);
    expect((await stat(pending)).nlink).toBe(2);
    expect((await inspectStaleVoicemailPending(config)).stale).toEqual([
      { ...input, messageUuid, admitted: false },
    ]);
    await stat(temporary); // inspect is read-only
    const send = vi.fn(async (url: string) => {
      expect(new URL(url).pathname).toBe("/api/recordings/voicemail/admission/idempotent");
      expect(new URL(url).searchParams.get("message_uuid")).toBe(messageUuid);
      return new Response(JSON.stringify({ message_uuid: messageUuid }), { status: 201 });
    });
    expect(await admitWithUuid(config, input, send as typeof fetch, () => channelUuid)).toBe(messageUuid);
    expect(send).toHaveBeenCalledOnce();
    await expect(access(temporary)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await stat(pending)).nlink).toBe(1);
    expect(JSON.parse(await readFile(pending, "utf8"))).toEqual({ ...input, messageUuid, admitted: true });
  });

  it("rejects unrelated temp links, symlinks, and third links before admission", async () => {
    for (const kind of ["different inode", "symlink", "third link"]) {
      const { config } = await fixture();
      const pendingDir = path.join(config.outboxRoot, "pending");
      await mkdir(pendingDir, { recursive: true, mode: 0o700 });
      const pending = path.join(pendingDir, `${channelUuid}.json`);
      const temporary = path.join(pendingDir, `.${messageUuid}.tmp`);
      const input = { channelUuid, tenantId: 12, extension: "3001" };
      const contents = JSON.stringify({ ...input, admitted: false, requestMessageUuid: messageUuid });
      await writeFile(pending, contents, { mode: 0o600 });
      if (kind === "different inode") {
        await writeFile(temporary, contents, { mode: 0o600 });
        await link(pending, path.join(pendingDir, "unrelated-link"));
      } else if (kind === "symlink") {
        await symlink(pending, temporary);
        await link(pending, path.join(pendingDir, "unrelated-link"));
      } else {
        await link(pending, temporary);
        await link(pending, path.join(pendingDir, "third-link"));
      }
      const send = vi.fn();
      await expect(admitWithUuid(config, input, send as typeof fetch, () => messageUuid)).rejects.toThrow();
      expect(send).not.toHaveBeenCalled();
      expect((await stat(pending)).isFile()).toBe(true);
    }
  });

  it("never falls back to an old backend's UUID-free admission path", async () => {
    const { config, wav } = await fixture();
    const input = { channelUuid, tenantId: 12, extension: "3001" };
    const old = vi.fn(async (url: string, init: RequestInit) => {
      expect(init.method).toBe("POST");
      if (new URL(url).pathname === "/api/recordings/voicemail/admission")
        throw new Error("legacy admission must not be called");
      expect(new URL(url).pathname).toBe("/api/recordings/voicemail/admission/idempotent");
      return new Response("", { status: 404 });
    });
    // The committed insert may be unknown to the caller when rollback occurs.
    const unknownCommit = vi.fn(async (url: string) => {
      expect(new URL(url).pathname).toBe("/api/recordings/voicemail/admission/idempotent");
      expect(new URL(url).searchParams.get("message_uuid")).toBe(messageUuid);
      throw new Error("response lost after commit");
    });
    await expect(admitWithUuid(config, input, unknownCommit as typeof fetch, () => messageUuid))
      .rejects.toThrow("response lost after commit");
    await expect(admitWithUuid(config, input, old as typeof fetch, () => channelUuid))
      .rejects.toThrow("admission denied: 404");
    await expect(admitWithUuid(config, input, old as typeof fetch, () => channelUuid))
      .rejects.toThrow("admission denied: 404");
    expect(old).toHaveBeenCalledTimes(2);
    expect(unknownCommit).toHaveBeenCalledOnce();
    const pending = path.join(config.outboxRoot, "pending", `${channelUuid}.json`);
    expect(JSON.parse(await readFile(pending, "utf8"))).toEqual({ ...input, requestMessageUuid: messageUuid, admitted: false });
    await expect(completeVoicemail(config, { channelUuid, voicemailFilePath: wav })).rejects.toThrow("not been acknowledged");
  });

  it("keeps the same intent when acknowledgement persistence fails", async () => {
    const { config, wav } = await fixture();
    const input = { channelUuid, tenantId: 12, extension: "3001" };
    const pendingDir = path.join(config.outboxRoot, "pending");
    const pending = path.join(pendingDir, `${channelUuid}.json`);
    const send = vi.fn(async (url: string) => {
      expect(new URL(url).searchParams.get("message_uuid")).toBe(messageUuid);
      await chmod(pendingDir, 0o500);
      return new Response(JSON.stringify({ message_uuid: messageUuid }), { status: 201 });
    });
    try {
      await expect(admitVoicemail(config, input, send as typeof fetch)).rejects.toThrow();
    } finally { await chmod(pendingDir, 0o700); }
    expect(JSON.parse(await readFile(pending, "utf8"))).toEqual({ ...input, requestMessageUuid: messageUuid, admitted: false });
    await expect(completeVoicemail(config, { channelUuid, voicemailFilePath: wav })).rejects.toThrow("not been acknowledged");
    const retry = vi.fn(async () => new Response(JSON.stringify({ message_uuid: messageUuid }), { status: 201 }));
    expect(await admitVoicemail(config, input, retry as typeof fetch)).toBe(messageUuid);
    expect(JSON.parse(await readFile(pending, "utf8"))).toMatchObject({ messageUuid, admitted: true });
  });

  it("accepts an old acknowledged pending file but rejects a malformed admission flag", async () => {
    const { config, wav } = await fixture();
    const pendingDir = path.join(config.outboxRoot, "pending");
    await mkdir(pendingDir, { recursive: true, mode: 0o700 });
    const pending = path.join(pendingDir, `${channelUuid}.json`);
    const old = { channelUuid, tenantId: 12, extension: "3001", messageUuid };
    await writeFile(pending, JSON.stringify({ ...old, admitted: "yes" }), { mode: 0o600 });
    await expect(admitVoicemail(config, old, vi.fn() as typeof fetch)).rejects.toThrow("identity mismatch");
    await expect(completeVoicemail(config, { channelUuid, voicemailFilePath: wav })).rejects.toThrow("identity mismatch");
    await writeFile(pending, JSON.stringify(old), { mode: 0o600 });
    const send = vi.fn();
    expect(await admitVoicemail(config, old, send as typeof fetch)).toBe(messageUuid);
    expect(send).not.toHaveBeenCalled();
    expect(await completeVoicemail(config, { channelUuid, voicemailFilePath: wav })).toBe(messageUuid);
  });

  it("fails closed if admission fails, no completed path exists, or source escapes the volume", async () => {
    const { config, wav } = await fixture();
    const input = { channelUuid, tenantId: 12, extension: "3001" };
    await expect(admitVoicemail(config, input, vi.fn(async () => new Response("", { status: 503 })) as typeof fetch)).rejects.toThrow("admission denied");
    expect(JSON.parse(await readFile(path.join(config.outboxRoot, "pending", `${channelUuid}.json`), "utf8")))
      .toEqual({ ...input, requestMessageUuid: messageUuid, admitted: false });
    await expect(completeVoicemail(config, { channelUuid, voicemailFilePath: wav })).rejects.toThrow("not been acknowledged");

    await admitVoicemail(config, input, vi.fn(async () => new Response(JSON.stringify({ message_uuid: messageUuid }), { status: 201 })) as typeof fetch);
    await expect(completeVoicemail(config, { channelUuid, voicemailFilePath: path.join(config.sourceRoot, "missing.wav") })).rejects.toThrow();
    const outside = path.join(path.dirname(config.sourceRoot), "outside.wav");
    await writeFile(outside, Buffer.from("RIFF0000WAVEaudio"));
    await expect(completeVoicemail(config, { channelUuid, voicemailFilePath: outside })).rejects.toThrow("outside");
    const symlinked = path.join(config.sourceRoot, "linked.wav");
    await symlink(outside, symlinked);
    await expect(completeVoicemail(config, { channelUuid, voicemailFilePath: symlinked })).rejects.toThrow();
    expect(await readdir(config.outboxRoot)).toEqual(["pending"]);
    expect(await readdir(path.join(config.outboxRoot, "pending"))).toEqual([`${channelUuid}.json`]);
  });

  it("refuses a public outbox or conflicting channel identity", async () => {
    const { config } = await fixture();
    await mkdir(config.outboxRoot, { mode: 0o755 });
    await chmod(config.outboxRoot, 0o755);
    await expect(admitVoicemail(config, { channelUuid, tenantId: 12, extension: "3001" }, vi.fn() as typeof fetch)).rejects.toThrow("private");
    await chmod(config.outboxRoot, 0o700);
    await admitVoicemail(config, { channelUuid, tenantId: 12, extension: "3001" }, vi.fn(async () => new Response(JSON.stringify({ message_uuid: messageUuid }), { status: 201 })) as typeof fetch);
    config.mailboxRoots["13:3001"] = path.join(config.sourceRoot, "default", "other-tenant", "3001");
    await expect(admitVoicemail(config, { channelUuid, tenantId: 13, extension: "3001" }, vi.fn() as typeof fetch)).rejects.toThrow("Conflicting");
  });

  it("rejects a completed WAV from a different mailbox despite sharing the source volume", async () => {
    const { config } = await fixture();
    const otherMailbox = path.join(config.sourceRoot, "default", "phone11.cloud", "3002");
    await mkdir(otherMailbox, { recursive: true, mode: 0o700 });
    const otherWav = path.join(otherMailbox, "recording.wav");
    await writeFile(otherWav, Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.from("other mailbox")]));
    await admitVoicemail(config, { channelUuid, tenantId: 12, extension: "3001" },
      vi.fn(async () => new Response(JSON.stringify({ message_uuid: messageUuid }), { status: 201 })) as typeof fetch);
    await expect(completeVoicemail(config, { channelUuid, voicemailFilePath: otherWav })).rejects.toThrow("outside the admitted mailbox");
    expect((await readdir(config.outboxRoot)).filter(name => name.endsWith(".json"))).toEqual([]);
  });

  it("rejects non-string JSON fields before admission or manifest publication", async () => {
    const { config, wav } = await fixture();
    const send = vi.fn(async () => new Response(JSON.stringify({ message_uuid: messageUuid }), { status: 201 }));
    await expect(admitVoicemail(config, { channelUuid, tenantId: 12, extension: 3001 } as any, send as typeof fetch))
      .rejects.toThrow("Invalid voicemail admission identity");
    expect(send).not.toHaveBeenCalled();
    await admitVoicemail(config, { channelUuid, tenantId: 12, extension: "3001" }, send as typeof fetch);
    await expect(completeVoicemail(config, { channelUuid, voicemailFilePath: wav, callerNumber: 1234 } as any))
      .rejects.toThrow("Invalid voicemail completion metadata");
    expect((await readdir(config.outboxRoot)).filter(name => name.endsWith(".json"))).toEqual([]);
  });

  it("keeps an interrupted deposit pending until an explicit aged review", async () => {
    const { config, wav } = await fixture();
    const sendAdmission = vi.fn(async () => new Response(JSON.stringify({ message_uuid: messageUuid }), { status: 201 }));
    await admitVoicemail(config, { channelUuid, tenantId: 12, extension: "3001" }, sendAdmission as typeof fetch);
    const pending = path.join(config.outboxRoot, "pending", `${channelUuid}.json`);
    expect((await inspectStaleVoicemailPending(config)).total).toBe(0);
    await expect(retireReviewedVoicemailPending(config,
      { channelUuid, reviewedNoFinalWav: true }, vi.fn() as typeof fetch)).rejects.toThrow("too recent");
    expect((await stat(wav)).isFile()).toBe(true);
    expect((await stat(pending)).isFile()).toBe(true);

    const old = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000);
    await utimes(pending, old, old);
    expect((await inspectStaleVoicemailPending(config)).stale).toEqual([
      { channelUuid, messageUuid, tenantId: 12, extension: "3001", admitted: true },
    ]);
    await expect(retireReviewedVoicemailPending(config,
      { channelUuid, reviewedNoFinalWav: false } as any, vi.fn() as typeof fetch))
      .rejects.toThrow("operator-reviewed");

    const unavailable = vi.fn(async () => new Response("", { status: 503 }));
    await expect(retireReviewedVoicemailPending(config,
      { channelUuid, reviewedNoFinalWav: true }, unavailable as typeof fetch))
      .rejects.toThrow("denied: 503");
    expect((await stat(pending)).isFile()).toBe(true);

    const retire = vi.fn(async (url: string, init: RequestInit) => {
      expect(new URL(url).pathname).toBe("/api/recordings/voicemail/admission/expire");
      expect(new URL(url).searchParams.get("message_uuid")).toBe(messageUuid);
      expect(init.headers).toEqual({ "x-fs-secret": config.integrationSecret });
      return new Response("{}", { status: 200 });
    });
    await retireReviewedVoicemailPending(config, { channelUuid, reviewedNoFinalWav: true }, retire as typeof fetch);
    expect(await readdir(path.join(config.outboxRoot, "pending"))).toEqual([]);
    expect(await readdir(path.join(config.outboxRoot, "retired-pending"))).toEqual([`${channelUuid}.json`]);
    expect((await stat(wav)).isFile()).toBe(true);
  });

  it("finishes an exact two-link retirement left by a crash without exposing recording", async () => {
    const { config, wav } = await fixture();
    const pendingDir = path.join(config.outboxRoot, "pending");
    const retiredDir = path.join(config.outboxRoot, "retired-pending");
    await mkdir(pendingDir, { recursive: true, mode: 0o700 });
    await mkdir(retiredDir, { mode: 0o700 });
    const pending = path.join(pendingDir, `${channelUuid}.json`);
    const retained = path.join(retiredDir, `${channelUuid}.json`);
    await writeFile(pending, JSON.stringify({ channelUuid, tenantId: 12, extension: "3001", messageUuid }), { mode: 0o600 });
    const old = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000);
    await utimes(pending, old, old);
    await link(pending, retained); // crash after link and archive sync, before source unlink
    expect((await stat(pending)).nlink).toBe(2);
    await expect(completeVoicemail(config, { channelUuid, voicemailFilePath: wav }))
      .rejects.toThrow("private regular file");
    const retire = vi.fn(async () => new Response("{}", { status: 200 }));
    await retireReviewedVoicemailPending(config, { channelUuid, reviewedNoFinalWav: true }, retire as typeof fetch);
    expect(retire).toHaveBeenCalledOnce();
    await expect(access(pending)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await stat(retained)).nlink).toBe(1);
    expect((await stat(retained)).mode & 0o777).toBe(0o600);
    expect((await stat(wav)).isFile()).toBe(true);
  });

  it("refuses conflicting or symlinked retirement targets before backend expiry", async () => {
    for (const target of ["same bytes, different inode", "different bytes", "symlink"]) {
      const { config } = await fixture();
      const pendingDir = path.join(config.outboxRoot, "pending");
      const retiredDir = path.join(config.outboxRoot, "retired-pending");
      await mkdir(pendingDir, { recursive: true, mode: 0o700 });
      await mkdir(retiredDir, { mode: 0o700 });
      const pending = path.join(pendingDir, `${channelUuid}.json`);
      const retained = path.join(retiredDir, `${channelUuid}.json`);
      const contents = JSON.stringify({ channelUuid, tenantId: 12, extension: "3001", messageUuid });
      await writeFile(pending, contents, { mode: 0o600 });
      const old = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000);
      await utimes(pending, old, old);
      if (target === "symlink") await symlink(pending, retained);
      else await writeFile(retained, target === "different bytes" ? "{}" : contents, { mode: 0o600 });
      const send = vi.fn();
      await expect(retireReviewedVoicemailPending(config, { channelUuid, reviewedNoFinalWav: true }, send as typeof fetch))
        .rejects.toThrow("Conflicting voicemail retirement evidence");
      expect(send).not.toHaveBeenCalled();
      expect((await stat(pending)).isFile()).toBe(true);
    }
  });

  it("publishes durable completion after a prolonged relay outage without age-only rejection", async () => {
    const { config, wav } = await fixture();
    await admitVoicemail(config, { channelUuid, tenantId: 12, extension: "3001" },
      vi.fn(async () => new Response(JSON.stringify({ message_uuid: messageUuid }), { status: 201 })) as typeof fetch);
    const pending = path.join(config.outboxRoot, "pending", `${channelUuid}.json`);
    const old = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000);
    await utimes(pending, old, old);
    expect(await completeVoicemail(config, { channelUuid, voicemailFilePath: wav })).toBe(messageUuid);
    expect((await readdir(config.outboxRoot)).includes(`${messageUuid}.json`)).toBe(true);
    expect(await readdir(path.join(config.outboxRoot, "pending"))).toEqual([]);
  });

  it("does not retire a pending admission with a completed relay manifest", async () => {
    const { config, wav } = await fixture();
    await admitVoicemail(config, { channelUuid, tenantId: 12, extension: "3001" },
      vi.fn(async () => new Response(JSON.stringify({ message_uuid: messageUuid }), { status: 201 })) as typeof fetch);
    const pending = path.join(config.outboxRoot, "pending", `${channelUuid}.json`);
    const bytes = await readFile(pending);
    await completeVoicemail(config, { channelUuid, voicemailFilePath: wav });
    await writeFile(pending, bytes, { mode: 0o600 });
    const old = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000);
    await utimes(pending, old, old);
    const send = vi.fn();
    await expect(retireReviewedVoicemailPending(config,
      { channelUuid, reviewedNoFinalWav: true }, send as typeof fetch))
      .rejects.toThrow("delivery review");
    expect(send).not.toHaveBeenCalled();
  });

  // Writes 1,000 real pending files before exercising hard-cap admission behavior.
  it("fails closed before admission when pending evidence reaches the hard cap", async () => {
    const { config } = await fixture();
    const pendingDir = path.join(config.outboxRoot, "pending");
    await mkdir(pendingDir, { recursive: true, mode: 0o700 });
    for (let i = 0; i < 1_000; i++) {
      const name = `${i.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000.json`;
      await writeFile(path.join(pendingDir, name), "{}", { mode: 0o600 });
    }
    const send = vi.fn();
    await expect(admitVoicemail(config, { channelUuid, tenantId: 12, extension: "3001" }, send as typeof fetch))
      .rejects.toThrow("capacity reached");
    expect(send).not.toHaveBeenCalled();
  }, 30_000);

  it("fails closed when reviewed evidence fills the total retention cap", () => {
    expect(voicemailEvidenceAtCapacity(999, 4_999)).toBe(false);
    expect(voicemailEvidenceAtCapacity(999, 5_000)).toBe(true);
    expect(voicemailEvidenceAtCapacity(1_000, 0)).toBe(true);
    expect(() => voicemailEvidenceAtCapacity(-1, 0)).toThrow("Invalid voicemail evidence count");
  });

});
