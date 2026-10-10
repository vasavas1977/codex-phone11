import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { admitVoicemail, completeVoicemail, retireReviewedVoicemailPending,
  type ProducerConfig } from "../scripts/phone11-voicemail-producer";

const fault = vi.hoisted(() => ({
  fail: undefined as ((file: string) => boolean | Promise<boolean>) | undefined,
  handles: 0,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: async (...args: Parameters<typeof actual.open>) => {
    const handle = await actual.open(...args);
    const sync = handle.sync.bind(handle), close = handle.close.bind(handle);
    fault.handles++;
    handle.sync = async () => {
      if (await fault.fail?.(String(args[0]))) throw Object.assign(new Error("fixture directory sync failure"), { code: "EIO" });
      await sync();
    };
    handle.close = async () => { try { await close(); } finally { fault.handles--; } };
    return handle;
  } };
});

const channelUuid = "11111111-1111-4111-8111-111111111111";
const messageUuid = "22222222-2222-4222-8222-222222222222";
const input = { channelUuid, tenantId: 12, extension: "3001" };
const audio = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.from("private deposit")]);
let root: string, config: ProducerConfig, wav: string;
const admission = () => vi.fn(async () => new Response(JSON.stringify({ message_uuid: messageUuid }), { status: 201 }));
const admit = (send: typeof fetch) => admitVoicemail(config, input, send, () => messageUuid);
const pending = () => path.join(config.outboxRoot, "pending", `${channelUuid}.json`);
const retired = () => path.join(config.outboxRoot, "retired-pending", `${channelUuid}.json`);

beforeEach(async () => {
  fault.fail = undefined; fault.handles = 0;
  root = await mkdtemp(path.join(tmpdir(), "phone11-producer-durability-"));
  const mailbox = path.join(root, "source", "12", "3001");
  await mkdir(mailbox, { recursive: true, mode: 0o700 });
  config = { sourceRoot: path.join(root, "source"), outboxRoot: path.join(root, "outbox"),
    uploadUrl: "https://phone11.example/api/recordings/voicemail", integrationSecret: "s".repeat(32),
    mailboxRoots: { "12:3001": mailbox } };
  await mkdir(config.outboxRoot, { mode: 0o700 });
  wav = path.join(mailbox, "recording.wav");
  await writeFile(wav, audio, { mode: 0o600 });
});
afterEach(async () => {
  fault.fail = undefined;
  expect(fault.handles).toBe(0);
  await rm(root, { recursive: true, force: true });
});

describe("durable producer directory admission and retirement", () => {
  it.each(["child", "parent", "child-during-parent"])("rejects directory replacement during %s synchronization before admission", async boundary => {
    const send = admission();
    let replaced = false;
    fault.fail = async file => {
      const child = path.dirname(pending());
      if (!replaced && ((boundary === "child" && file === child) ||
          (boundary !== "child" && file === config.outboxRoot && await stat(child).then(() => true, () => false)))) {
        replaced = true;
        const target = boundary === "parent" ? config.outboxRoot : child;
        await rename(target, `${target}.retained`);
        await mkdir(target, { mode: 0o700 });
      }
      return false;
    };
    await expect(admit(send as typeof fetch)).rejects.toThrow("Voicemail producer directory changed");
    expect(replaced).toBe(true);
    expect(send).not.toHaveBeenCalled();
    expect(await readFile(wav)).toEqual(audio);
  });

  it("does not create an unsynchronized missing ancestor chain", async () => {
    config.outboxRoot = path.join(root, "missing", "outbox");
    const send = admission();
    await expect(admit(send as typeof fetch)).rejects.toMatchObject({ code: "ENOENT" });
    expect(send).not.toHaveBeenCalled();
    await expect(stat(path.join(root, "missing"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not create an outbox through a symlink parent", async () => {
    await symlink(root, path.join(root, "alias"));
    config.outboxRoot = path.join(root, "alias", "other-outbox");
    const send = admission();
    await expect(admit(send as typeof fetch)).rejects.toThrow("Producer outbox parent must be a directory");
    expect(send).not.toHaveBeenCalled();
    await expect(stat(path.join(root, "other-outbox"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not contact admission when the new pending directory cannot be persisted in its outbox", async () => {
    const send = admission();
    fault.fail = async file => file === config.outboxRoot && await stat(path.dirname(pending())).then(() => true, () => false);
    await expect(admit(send as typeof fetch)).rejects.toThrow("fixture directory sync failure");
    expect(send).not.toHaveBeenCalled();
    expect(await readFile(wav)).toEqual(audio);
  });

  it("re-establishes an existing uncertain pending directory before admitting on retry", async () => {
    await mkdir(path.dirname(pending()), { mode: 0o700 });
    await writeFile(pending(), JSON.stringify({ ...input, admitted: false, requestMessageUuid: messageUuid }), { mode: 0o600 });
    const original = await readFile(pending());
    const send = admission();
    fault.fail = async file => file === config.outboxRoot && await stat(path.dirname(pending())).then(() => true, () => false);
    await expect(admit(send as typeof fetch)).rejects.toThrow("fixture directory sync failure");
    expect(send).not.toHaveBeenCalled();
    expect(await readFile(pending())).toEqual(original);
    fault.fail = undefined;
    expect(await admit(send as typeof fetch)).toBe(messageUuid);
    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await readFile(pending(), "utf8"))).toEqual({ ...input, messageUuid, admitted: true });
  });

  it.each([false, true])("does not expire or move evidence when the retirement archive directory entry is uncertain (existing=%s)", async existing => {
    await admit(admission() as typeof fetch);
    const original = await readFile(pending());
    const originalInode = (await stat(pending())).ino;
    const old = new Date(Date.now() - 9 * 86400_000);
    await utimes(pending(), old, old);
    if (existing) await mkdir(path.dirname(retired()), { mode: 0o700 });
    const expire = vi.fn(async () => new Response("{}", { status: 200 }));
    fault.fail = async file => file === config.outboxRoot && await stat(path.dirname(retired())).then(() => true, () => false);
    await expect(retireReviewedVoicemailPending(config, { channelUuid, reviewedNoFinalWav: true }, expire as typeof fetch))
      .rejects.toThrow("fixture directory sync failure");
    expect(expire).not.toHaveBeenCalled();
    expect(await readFile(pending())).toEqual(original);
    expect((await stat(pending())).ino).toBe(originalInode);
    expect(await readFile(wav)).toEqual(audio);
    fault.fail = undefined;
    await retireReviewedVoicemailPending(config, { channelUuid, reviewedNoFinalWav: true }, expire as typeof fetch);
    expect(expire).toHaveBeenCalledTimes(1);
    expect(await readFile(retired())).toEqual(original);
    expect((await stat(retired())).ino).toBe(originalInode);
    expect(await readdir(path.dirname(pending()))).toEqual([]);
  });

  it("keeps ordinary current admission, completion and replay identities intact", async () => {
    const send = admission();
    expect(await admit(send as typeof fetch)).toBe(messageUuid);
    expect(await admit(send as typeof fetch)).toBe(messageUuid);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await completeVoicemail(config, { channelUuid, voicemailFilePath: wav })).toBe(messageUuid);
    expect(JSON.parse(await readFile(path.join(config.outboxRoot, `${messageUuid}.json`), "utf8")))
      .toMatchObject({ message_uuid: messageUuid, tenant_id: 12, extension: "3001", relative_wav_path: path.join("12", "3001", "recording.wav") });
    expect(await readFile(wav)).toEqual(audio);
  });
});
