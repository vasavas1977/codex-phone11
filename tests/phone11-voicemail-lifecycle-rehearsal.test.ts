import { afterEach, describe, expect, it, vi } from "vitest";
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { admitVoicemail, completeVoicemail, type ProducerConfig } from "../scripts/phone11-voicemail-producer";
import { relayOnce } from "../scripts/phone11-voicemail-relay";

const channelUuid = "11111111-1111-4111-8111-111111111111";
const messageUuid = "22222222-2222-4222-8222-222222222222";
const audio = Buffer.from("RIFF\x04\x00\x00\x00WAVEfixture audio");
const fixtures: string[] = [];

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "phone11-vm-lifecycle-"));
  fixtures.push(root);
  const sourceRoot = path.join(root, "source");
  const outboxRoot = path.join(root, "outbox");
  const mailbox = path.join(sourceRoot, "default", "phone11.cloud", "3001");
  const otherMailbox = path.join(sourceRoot, "default", "phone11.cloud", "3002");
  await mkdir(mailbox, { recursive: true, mode: 0o700 });
  await mkdir(otherMailbox, { recursive: true, mode: 0o700 });
  await chmod(sourceRoot, 0o700);
  const wav = path.join(mailbox, "completed.wav");
  const otherWav = path.join(otherMailbox, "completed.wav");
  await writeFile(wav, audio);
  await writeFile(otherWav, audio);
  const config: ProducerConfig = {
    sourceRoot, outboxRoot, uploadUrl: "https://phone11.example/api/recordings/voicemail",
    integrationSecret: "fixture-secret-0123456789-0123456789",
    mailboxRoots: { "12:3001": mailbox },
  };
  const pending = path.join(outboxRoot, "pending", `${channelUuid}.json`);
  const manifest = path.join(outboxRoot, `${messageUuid}.json`);
  const admit = vi.fn(async (url: string, init: RequestInit) => {
    const endpoint = new URL(url);
    expect(endpoint.pathname).toBe("/api/recordings/voicemail/admission");
    expect(endpoint.searchParams.get("tenant_id")).toBe("12");
    expect(endpoint.searchParams.get("extension")).toBe("3001");
    expect(init.headers).toEqual({ "x-fs-secret": config.integrationSecret });
    return new Response(JSON.stringify({ message_uuid: messageUuid }), { status: 201 });
  });
  return { config, wav, otherWav, pending, manifest, admit };
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe("isolated voicemail lifecycle rehearsal", () => {
  it("finalizes before ingest and replays an uncertain response without a second delivery", async () => {
    const { config, wav, pending, manifest, admit } = await fixture();
    expect(await admitVoicemail(config, { channelUuid, tenantId: 12, extension: "3001" }, admit as typeof fetch)).toBe(messageUuid);
    expect(await relayOnce(config, vi.fn() as typeof fetch)).toEqual({ delivered: 0, quarantined: 0, retry: 0 });
    expect(JSON.parse(await readFile(pending, "utf8"))).toEqual({ channelUuid, tenantId: 12, extension: "3001", messageUuid });

    await completeVoicemail(config, { channelUuid, voicemailFilePath: wav, durationSeconds: 7 });
    await expect(stat(pending)).rejects.toMatchObject({ code: "ENOENT" });
    expect(JSON.parse(await readFile(manifest, "utf8"))).toMatchObject({
      message_uuid: messageUuid, tenant_id: 12, extension: "3001",
      relative_wav_path: path.join("default", "phone11.cloud", "3001", "completed.wav"),
    });

    const accepted = new Map<string, Buffer>();
    let attempts = 0;
    const upload = vi.fn(async (url: string, init: RequestInit) => {
      attempts++;
      const endpoint = new URL(url);
      expect(endpoint.pathname).toBe("/api/recordings/voicemail");
      expect(endpoint.searchParams.get("tenant_id")).toBe("12");
      expect(endpoint.searchParams.get("extension")).toBe("3001");
      expect(endpoint.searchParams.get("message_uuid")).toBe(messageUuid);
      expect(init.headers).toEqual({ "content-type": "audio/wav", "x-fs-secret": config.integrationSecret });
      const bytes = Buffer.from(init.body as Uint8Array);
      expect(bytes).toEqual(audio);
      if (!accepted.has(messageUuid)) accepted.set(messageUuid, bytes);
      if (attempts === 1) throw new Error("response lost after backend commit");
      return new Response("", { status: 200 });
    });
    expect(await relayOnce(config, upload as typeof fetch)).toEqual({ delivered: 0, quarantined: 0, retry: 1 });
    expect(await readdir(config.outboxRoot)).toContain(`${messageUuid}.json`);
    expect(await relayOnce(config, upload as typeof fetch)).toEqual({ delivered: 1, quarantined: 0, retry: 0 });
    expect(upload).toHaveBeenCalledTimes(2);
    expect(accepted.size).toBe(1);
    await expect(stat(manifest)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(wav)).toEqual(audio);
    console.log("voicemail_lifecycle_rehearsal " + JSON.stringify({ admission: messageUuid, preFinalizeUploads: 0, replayAttempts: attempts, uniqueAccepted: accepted.size, manifestRemaining: false, wavPreserved: true }));
  });

  it("blocks another mailbox before manifest publication and retains backend owner rejection", async () => {
    const { config, wav, otherWav, pending, manifest, admit } = await fixture();
    await admitVoicemail(config, { channelUuid, tenantId: 12, extension: "3001" }, admit as typeof fetch);
    await expect(completeVoicemail(config, { channelUuid, voicemailFilePath: otherWav }))
      .rejects.toThrow("outside the admitted mailbox");
    await stat(pending);
    await expect(stat(manifest)).rejects.toMatchObject({ code: "ENOENT" });
    const upload = vi.fn();
    expect(await relayOnce(config, upload as typeof fetch)).toEqual({ delivered: 0, quarantined: 0, retry: 0 });
    expect(upload).not.toHaveBeenCalled();

    await completeVoicemail(config, { channelUuid, voicemailFilePath: wav });
    const rejected = vi.fn(async () => new Response("", { status: 409 }));
    expect(await relayOnce(config, rejected as typeof fetch)).toEqual({ delivered: 0, quarantined: 1, retry: 0 });
    expect(rejected).toHaveBeenCalledOnce();
    await stat(path.join(config.outboxRoot, "quarantine", `${messageUuid}.json`));
    await expect(stat(manifest)).rejects.toMatchObject({ code: "ENOENT" });
    console.log("voicemail_failure_rehearsal " + JSON.stringify({ crossMailboxManifest: false, crossMailboxUploads: 0, ownerRejected: 409, quarantined: true }));
  });
});
