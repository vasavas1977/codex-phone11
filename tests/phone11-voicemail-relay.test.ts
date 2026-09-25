import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { relayOnce, type RelayConfig } from "../scripts/phone11-voicemail-relay";

const uuid = "10000000-0000-4000-8000-000000000001";
const audio = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.from("private audio")]);
let directory: string;
let config: RelayConfig;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "phone11-vm-relay-"));
  config = {
    sourceRoot: path.join(directory, "source"),
    outboxRoot: path.join(directory, "outbox"),
    uploadUrl: "https://api.phone11.ai/api/recordings/voicemail",
    integrationSecret: "test-voicemail-relay-secret-0123456789",
  };
  await mkdir(path.join(config.sourceRoot, "domain", "3001"), { recursive: true });
  await mkdir(config.outboxRoot);
  await writeFile(path.join(config.sourceRoot, "domain", "3001", `${uuid}.wav`), audio);
  await writeFile(path.join(config.outboxRoot, `${uuid}.json`), JSON.stringify({
    message_uuid: uuid,
    tenant_id: 12,
    extension: "3001",
    relative_wav_path: `domain/3001/${uuid}.wav`,
    caller_number: "+6620303001",
    duration_seconds: 19,
  }), { mode: 0o600 });
});

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe("private voicemail relay outbox", () => {
  it("uploads the admitted UUID over HTTPS and removes only an acknowledged manifest", async () => {
    const send = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.protocol).toBe("https:");
      expect(url.pathname).toBe("/api/recordings/voicemail");
      expect(url.searchParams.get("message_uuid")).toBe(uuid);
      expect(url.searchParams.get("tenant_id")).toBe("12");
      expect(init?.headers).toMatchObject({ "x-fs-secret": config.integrationSecret });
      expect(Buffer.from(init?.body as Uint8Array)).toEqual(audio);
      return { status: 201 } as Response;
    });
    expect(await relayOnce(config, send as typeof fetch)).toEqual({ delivered: 1, quarantined: 0, retry: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    await expect(stat(path.join(config.outboxRoot, `${uuid}.json`))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(path.join(config.sourceRoot, "domain", "3001", `${uuid}.wav`))).toEqual(audio);
  });

  it("retains uncertain uploads for idempotent retry and quarantines a stale admission", async () => {
    expect(await relayOnce(config, vi.fn(async () => ({ status: 503 } as Response)) as typeof fetch))
      .toEqual({ delivered: 0, quarantined: 0, retry: 1 });
    await stat(path.join(config.outboxRoot, `${uuid}.json`));
    expect(await relayOnce(config, vi.fn(async () => ({ status: 409 } as Response)) as typeof fetch))
      .toEqual({ delivered: 0, quarantined: 1, retry: 0 });
    await stat(path.join(config.outboxRoot, "quarantine", `${uuid}.json`));
  });

  it("never overwrites the first quarantined manifest on a later completion retry", async () => {
    const manifest = path.join(config.outboxRoot, `${uuid}.json`);
    const rejected = vi.fn(async () => ({ status: 409 } as Response)) as typeof fetch;
    expect(await relayOnce(config, rejected)).toEqual({ delivered: 0, quarantined: 1, retry: 0 });
    const preserved = await readFile(path.join(config.outboxRoot, "quarantine", `${uuid}.json`));
    await writeFile(manifest, JSON.stringify({ ...JSON.parse(preserved.toString()), caller_name: "second callback" }), { mode: 0o600 });
    expect(await relayOnce(config, rejected)).toEqual({ delivered: 0, quarantined: 0, retry: 1 });
    expect(await readFile(path.join(config.outboxRoot, "quarantine", `${uuid}.json`))).toEqual(preserved);
    await stat(manifest);
  });

  it("rejects a path outside the private FreeSWITCH volume without sending audio", async () => {
    await writeFile(path.join(config.outboxRoot, `${uuid}.json`), JSON.stringify({
      message_uuid: uuid, tenant_id: 12, extension: "3001", relative_wav_path: "../other.wav",
    }), { mode: 0o600 });
    const send = vi.fn();
    expect(await relayOnce(config, send as typeof fetch)).toEqual({ delivered: 0, quarantined: 0, retry: 1 });
    expect(send).not.toHaveBeenCalled();
    await stat(path.join(config.outboxRoot, `${uuid}.json`));
  });

  it("refuses a non-HTTPS endpoint before processing the outbox", async () => {
    config.uploadUrl = "http://api.phone11.ai/api/recordings/voicemail";
    await expect(relayOnce(config, vi.fn() as typeof fetch)).rejects.toThrow("exact HTTPS endpoint");
    await stat(path.join(config.outboxRoot, `${uuid}.json`));
  });
});
