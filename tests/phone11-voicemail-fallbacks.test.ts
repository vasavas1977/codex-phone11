import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateQueueDialplan, generateRingGroupDialplan } from "../server/pbx/dialplan-generators";

const db = vi.hoisted(() => ({ query: vi.fn() }));
const cache = vi.hoisted(() => ({ cacheGetOrSet: vi.fn((_key, _ttl, callback) => callback()) }));
vi.mock("../server/pbx/db", () => ({ query: db.query }));
vi.mock("../server/pbx/redis", () => ({ cacheGetOrSet: cache.cacheGetOrSet }));

const mailbox = {
  tenant_id: 12, extension_number: "3001", sip_username: "3001", sip_domain: "tenant.phone11.cloud",
  voicemail_enabled: true, type: "user", user_id: 17,
};
beforeEach(() => { vi.clearAllMocks(); db.query.mockReset(); cache.cacheGetOrSet.mockReset().mockImplementation((_key, _ttl, callback) => callback()); vi.stubEnv("PHONE11_VOICEMAIL_HOOK_READY", "false"); });
afterEach(() => vi.unstubAllEnvs());

function group(target = "3001", rows: object[] = [mailbox]) {
  db.query.mockResolvedValueOnce({ rows: [{ name: "Sales", strategy: "simultaneous", fallback_action: "voicemail", fallback_target: target }] })
    .mockResolvedValueOnce({ rows: [mailbox] }).mockResolvedValueOnce({ rows });
}
function queue(target: string | undefined = "3001", rows: object[] = [mailbox]) {
  db.query.mockResolvedValueOnce({ rows: [{ name: "Support", wrap_up_time: 10, max_wait_time: 300,
    overflow_action: "voicemail", overflow_target: target }] })
    .mockResolvedValueOnce({ rows: [mailbox] }).mockResolvedValueOnce({ rows });
}

describe("voicemail fallback coverage", () => {
  it("retains guarded legacy ring-group voicemail with the hook off", async () => {
    group();
    expect(await generateRingGroupDialplan(4, 12)).toContain('phone11_legacy_voicemail.lua 3001 ${domain_name}"');
    expect(cache.cacheGetOrSet).toHaveBeenCalledWith("dialplan:ringgroup:12:4", 300, expect.any(Function));
  });
  it("retains legacy queue default mailbox with the hook off", async () => {
    queue("");
    expect(await generateQueueDialplan(4, 12)).toContain('phone11_legacy_voicemail.lua 1000 ${domain_name}"');
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(cache.cacheGetOrSet).toHaveBeenCalledWith("dialplan:queue:12:4", 120, expect.any(Function));
  });
  it("routes a protected group fallback through admission, bypassing legacy cached XML", async () => {
    vi.stubEnv("PHONE11_VOICEMAIL_HOOK_READY", "true");
    cache.cacheGetOrSet.mockResolvedValueOnce('<action application="voicemail"/>');
    group();
    const xml = await generateRingGroupDialplan(4, 12);
    expect(xml).toContain('phone11_voicemail_deposit.lua 12 3001 3001 tenant.phone11.cloud"');
    expect(xml).not.toContain('application="voicemail"');
    expect(cache.cacheGetOrSet).not.toHaveBeenCalled();
    expect(db.query.mock.calls[2][1]).toEqual([12, "3001"]);
    cache.cacheGetOrSet.mockReset().mockImplementation((_key, _ttl, callback) => callback());
  });
  it("uses a protected direct hook for queue overflow without a failed bridge", async () => {
    vi.stubEnv("PHONE11_VOICEMAIL_HOOK_READY", "true");
    queue();
    const xml = await generateQueueDialplan(4, 12);
    expect(xml).toContain('phone11_voicemail_deposit.lua 12 3001 3001 tenant.phone11.cloud direct"');
    expect(xml).not.toContain('application="voicemail"');
    expect(cache.cacheGetOrSet).not.toHaveBeenCalled();
  });
  it.each(["group", "queue"])("regenerates prior unguarded %s Redis XML even with the hook off", async route => {
    cache.cacheGetOrSet.mockResolvedValueOnce('<action application="voicemail" data="default phone11.cloud 3001"/>');
    if (route === "group") group(); else queue();
    const xml = await (route === "group" ? generateRingGroupDialplan(4, 12) : generateQueueDialplan(4, 12));
    expect(xml).toContain("phone11_legacy_voicemail.lua 3001 ${domain_name}");
    expect(xml).not.toContain('application="voicemail"');
  });
  it.each(["group", "queue"])("refuses %s deposits after mailbox reassignment", async route => {
    vi.stubEnv("PHONE11_VOICEMAIL_HOOK_READY", "true");
    if (route === "group") group("3001", []); else queue("3001", []);
    const xml = await (route === "group" ? generateRingGroupDialplan(4, 12) : generateQueueDialplan(4, 12));
    expect(xml).toContain('application="hangup" data="NORMAL_TEMPORARY_FAILURE"');
    expect(xml).not.toContain('application="voicemail"');
    expect(xml).not.toContain("phone11_voicemail_deposit.lua");
  });
  it.each(["group", "queue"])("refuses %s deposits with an invalid target", async route => {
    vi.stubEnv("PHONE11_VOICEMAIL_HOOK_READY", "true");
    if (route === "group") group("3001 extra"); else queue("");
    const xml = await (route === "group" ? generateRingGroupDialplan(4, 12) : generateQueueDialplan(4, 12));
    expect(xml).toContain('application="hangup"');
    expect(xml).not.toContain('application="voicemail"');
    expect(db.query).toHaveBeenCalledTimes(2);
  });
});
