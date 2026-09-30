import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../server/pbx/db", () => ({ query: db.query }));
vi.mock("../server/pbx/redis", () => ({
  cacheGetOrSet: vi.fn((_key, _ttl, callback) => callback()),
  invalidateCache: vi.fn(),
  rateLimitCheck: vi.fn(async () => true),
}));
import { freeswitchRouter } from "../server/pbx/freeswitch-routes";

const secret = "test-freeswitch-secret-0123456789abcdef";
const extension = {
  tenant_id: 12,
  type: "user",
  user_id: 17,
  extension_number: "3001",
  sip_username: "3001",
  sip_domain: "phone11.cloud",
  voicemail_enabled: true,
  cfna_timeout_seconds: 30,
};
let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/fs", freeswitchRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.on("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  vi.unstubAllEnvs();
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("FS_SHARED_SECRET", secret);
  vi.stubEnv("PHONE11_VOICEMAIL_HOOK_READY", "false");
  db.query.mockResolvedValueOnce({ rows: [{ tenant_id: 12 }] })
    .mockResolvedValueOnce({ rows: [extension] });
});

async function dialplan(): Promise<string> {
  const response = await fetch(`${base}/fs/dialplan`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-fs-secret": secret },
    body: JSON.stringify({
      "Caller-Destination-Number": "3001",
      "variable_sip_from_user": "3002",
      "variable_domain_name": "phone11.cloud",
    }),
  });
  expect(response.status).toBe(200);
  return response.text();
}

describe("FreeSWITCH personal voicemail handoff", () => {
  it("keeps the legacy route exactly while the opt-in flag is off", async () => {
    const xml = await dialplan();
    expect(xml).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<document type="freeswitch/xml">
  <section name="dialplan">
    <context name="default">
      <extension name="ext_3001">
        <condition>
          <action application="set" data="call_direction=internal"/>
          <action application="set" data="hangup_after_bridge=true"/>
          <action application="set" data="call_timeout=30"/>
          <action application="bridge" data="user/3001@phone11.cloud"/>
          <action application="voicemail" data="default phone11.cloud 3001"/>
        </condition>
      </extension>
    </context>
  </section>
</document>`);
  });

  it("emits the admission-first Lua hook only for the active tenant's personal mailbox", async () => {
    vi.stubEnv("PHONE11_VOICEMAIL_HOOK_READY", "true");
    const xml = await dialplan();
    expect(xml).toContain('application="set" data="continue_on_fail=true"');
    expect(xml).toContain('application="lua" data="/etc/freeswitch/scripts/phone11_voicemail_deposit.lua 12 3001 3001 phone11.cloud"');
    expect(xml).not.toContain('application="voicemail"');
    expect(db.query.mock.calls[0][1]).toEqual(["3002", "phone11.cloud"]);
    expect(db.query.mock.calls[1][1]).toEqual(["3001", 12]);
  });

  it("does not emit an inbox hook for a shared mailbox", async () => {
    vi.stubEnv("PHONE11_VOICEMAIL_HOOK_READY", "true");
    db.query.mockReset().mockResolvedValueOnce({ rows: [{ tenant_id: 12 }] })
      .mockResolvedValueOnce({ rows: [{ ...extension, type: "shared" }] });
    const xml = await dialplan();
    expect(xml).not.toContain("phone11_voicemail_deposit.lua");
    expect(xml).not.toContain('application="voicemail"');
  });

  it("does not route another tenant's destination", async () => {
    vi.stubEnv("PHONE11_VOICEMAIL_HOOK_READY", "true");
    db.query.mockReset().mockResolvedValueOnce({ rows: [{ tenant_id: 12 }] })
      .mockResolvedValueOnce({ rows: [] });
    const xml = await dialplan();
    expect(xml).not.toContain('application="bridge"');
    expect(xml).not.toContain("phone11_voicemail_deposit.lua");
  });
});
