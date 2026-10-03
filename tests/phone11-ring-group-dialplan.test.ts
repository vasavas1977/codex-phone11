import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ query: vi.fn() }));
const cache = vi.hoisted(() => ({ cacheGetOrSet: vi.fn((_key, _ttl, callback) => callback()) }));

vi.mock("../server/pbx/db", () => ({ query: db.query }));
vi.mock("../server/pbx/redis", () => ({ cacheGetOrSet: cache.cacheGetOrSet }));

import { generateRingGroupDialplan } from "../server/pbx/dialplan-generators";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ring-group dialplans", () => {
  it("uses a tenant-qualified cache key and callable same-tenant SIP member targets", async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [{ id: 4, name: "Support", strategy: "simultaneous", ring_timeout: 25, fallback_action: "hangup" }],
      })
      .mockResolvedValueOnce({
        rows: [
          { extension_number: "3001", sip_username: "3001", sip_domain: "acme.phone11.test" },
          { extension_number: "3002", sip_username: "3002", sip_domain: "acme.phone11.test" },
        ],
      });

    const xml = await generateRingGroupDialplan(4, 7);

    expect(cache.cacheGetOrSet).toHaveBeenCalledWith(
      "dialplan:ringgroup:7:4",
      300,
      expect.any(Function),
    );
    expect(db.query.mock.calls[1][0]).toContain("e.tenant_id = $2");
    expect(db.query.mock.calls[1][0]).toContain("e.type = 'user'");
    expect(db.query.mock.calls[1][0]).toContain("sa.status = 'active'");
    expect(db.query.mock.calls[1][1]).toEqual([4, 7]);
    expect(xml).toContain("user/3001@acme.phone11.test,user/3002@acme.phone11.test");
    expect(xml).not.toContain("user/3001,user/3002");
  });

  it("uses ordered SIP targets for sequential ringing", async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [{ id: 4, name: "Support", strategy: "sequential", ring_timeout: 25, fallback_action: "hangup" }],
      })
      .mockResolvedValueOnce({
        rows: [
          { extension_number: "3001", sip_username: "3001", sip_domain: "acme.phone11.test" },
          { extension_number: "3002", sip_username: "3002", sip_domain: "acme.phone11.test" },
        ],
      });

    const xml = await generateRingGroupDialplan(4, 7);

    expect(xml).toContain("user/3001@acme.phone11.test|user/3002@acme.phone11.test");
  });

  it("fails closed for a legacy strategy the runtime cannot implement", async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 4, name: "Support", strategy: "random", ring_timeout: 25 }],
    });

    const xml = await generateRingGroupDialplan(4, 7);

    expect(xml).toContain('extension name="not-found"');
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it("fails closed instead of routing to an unvalidated legacy fallback", async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [{ id: 4, name: "Support", strategy: "simultaneous", ring_timeout: 25, fallback_action: "voicemail", fallback_target: "3999" }],
      })
      .mockResolvedValueOnce({
        rows: [{ extension_number: "3001", sip_username: "3001", sip_domain: "acme.phone11.test" }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const xml = await generateRingGroupDialplan(4, 7);

    expect(db.query.mock.calls[2][0]).toContain("e.voicemail_enabled = true");
    expect(xml).toContain('application="hangup"');
    expect(xml).not.toContain('application="voicemail"');
  });
});
