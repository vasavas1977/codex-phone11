import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ query: vi.fn() }));
const cache = vi.hoisted(() => ({ cacheGetOrSet: vi.fn() }));

vi.mock("../server/pbx/db", () => ({ query: db.query }));
vi.mock("../server/pbx/redis", () => ({
  cacheGetOrSet: cache.cacheGetOrSet,
}));

import { generateQueueDialplan } from "../server/pbx/dialplan-generators";

beforeEach(() => {
  vi.clearAllMocks();
  cache.cacheGetOrSet.mockImplementation(async (_key, _ttl, callback) => callback());
});

describe("queue dialplan tenancy and callable members", () => {
  it("uses tenant-qualified FIFO identity and active callable SIP members", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ name: "Support", wrap_up_time: 10, max_wait_time: 300, announce_position: false }] })
      .mockResolvedValueOnce({ rows: [{ extension_number: "3001", sip_username: "u3001", sip_domain: "acme.phone11.cloud" }] });

    const xml = await generateQueueDialplan(4, 7);

    expect(cache.cacheGetOrSet).toHaveBeenCalledWith("dialplan:queue:7:4", 120, expect.any(Function));
    expect(db.query.mock.calls[1][0]).toContain("e.tenant_id = $2");
    expect(db.query.mock.calls[1][0]).toContain("sa.status = 'active'");
    expect(db.query.mock.calls[1][0]).toContain("e.type = 'user'");
    expect(db.query.mock.calls[1][1]).toEqual([4, 7]);
    expect(xml).toContain("queue_7_4");
    expect(xml).toContain("queue_overflow_7_4");
    expect(xml).toContain("user/u3001@acme.phone11.cloud");
  });
});
