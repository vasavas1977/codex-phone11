import { afterEach, describe, expect, it, vi } from "vitest";
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { admitVoicemail, completeVoicemail, type ProducerConfig } from "../scripts/phone11-voicemail-producer";

const channelUuid = "11111111-1111-4111-8111-111111111111";
const messageUuid = "22222222-2222-4222-8222-222222222222";
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
  it("persists admission before completion and publishes one private relay manifest", async () => {
    const { config, wav } = await fixture();
    const send = vi.fn(async (url: string, init: RequestInit) => {
      expect(new URL(url).pathname).toBe("/api/recordings/voicemail/admission");
      expect(new URL(url).searchParams.get("tenant_id")).toBe("12");
      expect(new URL(url).searchParams.get("extension")).toBe("3001");
      expect(init.headers).toEqual({ "x-fs-secret": config.integrationSecret });
      return new Response(JSON.stringify({ message_uuid: messageUuid }), { status: 201 });
    });
    const input = { channelUuid, tenantId: 12, extension: "3001" };
    expect(await admitVoicemail(config, input, send as typeof fetch)).toBe(messageUuid);
    expect(await admitVoicemail(config, input, send as typeof fetch)).toBe(messageUuid);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await readdir(config.outboxRoot)).filter(name => name.endsWith(".json"))).toEqual([]);
    const pendingPath = path.join(config.outboxRoot, "pending", `${channelUuid}.json`);
    expect(JSON.parse(await readFile(pendingPath, "utf8"))).toEqual({ ...input, messageUuid });
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

  it("fails closed if admission fails, no completed path exists, or source escapes the volume", async () => {
    const { config, wav } = await fixture();
    const input = { channelUuid, tenantId: 12, extension: "3001" };
    await expect(admitVoicemail(config, input, vi.fn(async () => new Response("", { status: 503 })) as typeof fetch)).rejects.toThrow("admission denied");
    expect(await readdir(path.join(config.outboxRoot, "pending"))).toEqual([]);
    await expect(completeVoicemail(config, { channelUuid, voicemailFilePath: wav })).rejects.toThrow();

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
});
