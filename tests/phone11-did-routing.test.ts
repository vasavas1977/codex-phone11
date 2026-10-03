import express from "express";
import type { Server } from "node:http";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const db = vi.hoisted(() => ({ query: vi.fn() }));
const generators = vi.hoisted(() => ({
  ivr: vi.fn(async () => "<ivr/>"),
  ringGroup: vi.fn(async () => "<ring-group/>"),
  queue: vi.fn(async () => "<queue/>"),
  timeCondition: vi.fn(async () => ({
    matched: true,
    action: "hangup",
    target: "",
  })),
}));

vi.mock("../server/pbx/db", () => ({ query: db.query }));
vi.mock("../server/pbx/redis", () => ({
  cacheGetOrSet: vi.fn((_key, _ttl, callback) => callback()),
  invalidateCache: vi.fn(),
  rateLimitCheck: vi.fn(async () => true),
}));
vi.mock("../server/pbx/dialplan-generators", () => ({
  generateIvrDialplan: generators.ivr,
  generateRingGroupDialplan: generators.ringGroup,
  generateQueueDialplan: generators.queue,
  evaluateTimeCondition: generators.timeCondition,
}));
vi.mock("../server/pbx/cdr-processor", () => ({ processCdr: vi.fn() }));

import { kamailioRouter } from "../server/pbx/kamailio-routes";
import { freeswitchRouter } from "../server/pbx/freeswitch-routes";

let server: Server;
let base: string;
const secret = "test-integration-secret-0123456789";

function post(body: unknown) {
  return fetch(`${base}/route`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-kam-secret": secret },
    body: JSON.stringify(body),
  });
}

function postFs(destination: string) {
  return fetch(`${base}/fs/dialplan`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-fs-secret": secret },
    body: JSON.stringify({ "Caller-Destination-Number": destination }),
  });
}

function did(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    tenant_id: 7,
    assigned_route_type: null,
    assigned_route_id: null,
    ...overrides,
  };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(kamailioRouter);
  app.use("/fs", freeswitchRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("KAM_SHARED_SECRET", secret);
  vi.stubEnv("FS_SHARED_SECRET", secret);
});

describe("inbound DID routing", () => {
  it("preserves tenant-scoped extension bridging", async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [
          did({ assigned_route_type: "extension", assigned_route_id: 42 }),
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ sip_username: "3001", sip_domain: "sip.example.test" }],
      });

    const response = await post({ ruri_user: "+6620303001" });

    expect(await response.json()).toEqual({
      action: "bridge",
      target: "sip:3001@sip.example.test",
      tenantId: 7,
    });
    expect(db.query.mock.calls[1][1]).toEqual([42, 7]);
  });

  it.each([
    ["ivr", "ivr_menus", "ivr"],
    ["ring_group", "ring_groups", "ringgroup"],
    ["queue", "call_queues", "queue"],
    ["time_condition", "time_conditions", "timecondition"],
  ])(
    "dispatches a %s DID to its tenant-scoped FreeSWITCH target",
    async (routeType, table, internalType) => {
      db.query
        .mockResolvedValueOnce({
          rows: [
            did({ assigned_route_type: routeType, assigned_route_id: 23 }),
          ],
        })
        .mockResolvedValueOnce({ rows: [{ id: 23 }] });

      const response = await post({ ruri_user: "+6620303001" });

      expect(await response.json()).toEqual({
        action: "freeswitch",
        target: `phone11pbx-${internalType}-7-23`,
        tenantId: 7,
      });
      expect(db.query.mock.calls[1][0]).toContain(`FROM ${table}`);
      expect(db.query.mock.calls[1][0]).toContain("tenant_id = $2");
      expect(db.query.mock.calls[1][1]).toEqual([23, 7]);
    },
  );

  it.each(["ivr", "ring_group", "queue"])(
    "requires an active %s target",
    async (routeType) => {
      db.query
        .mockResolvedValueOnce({
          rows: [
            did({ assigned_route_type: routeType, assigned_route_id: 23 }),
          ],
        })
        .mockResolvedValueOnce({ rows: [] });

      const response = await post({ ruri_user: "+6620303001" });

      expect(await response.json()).toEqual({ action: "reject", code: 404 });
      expect(db.query.mock.calls[1][0]).toContain("is_active = true");
    },
  );

  it("rejects a missing or cross-tenant configured target instead of ringing the tenant", async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [did({ assigned_route_type: "ivr", assigned_route_id: 99 })],
      })
      .mockResolvedValueOnce({ rows: [] });

    const response = await post({ ruri_user: "+6620303001" });

    expect(await response.json()).toEqual({ action: "reject", code: 404 });
    expect(db.query.mock.calls[1][1]).toEqual([99, 7]);
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  it("rejects unknown or malformed configured routes", async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        did({ assigned_route_type: "external_unknown", assigned_route_id: 23 }),
      ],
    });

    const response = await post({ ruri_user: "+6620303001" });

    expect(await response.json()).toEqual({ action: "reject", code: 404 });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it("keeps ring-all as the explicit fallback for an unassigned active DID", async () => {
    db.query.mockResolvedValueOnce({ rows: [did()] });

    const response = await post({ ruri_user: "+6620303001" });

    expect(await response.json()).toEqual({
      action: "ring_all",
      target: "phone11pbx-ringall-7-0",
      tenantId: 7,
    });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a corrupt inbound DID lookup returns more than one tenant", async () => {
    db.query.mockResolvedValueOnce({
      rows: [did({ tenant_id: 7 }), did({ id: 12, tenant_id: 8 })],
    });

    const response = await post({ ruri_user: "+6620303001" });

    expect(await response.json()).toEqual({ action: "reject", code: 404 });
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][0]).toContain("LIMIT 2");
  });

  it("fails closed when a configured extension is inactive, missing, or cross-tenant", async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [
          did({ assigned_route_type: "extension", assigned_route_id: 42 }),
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const response = await post({ ruri_user: "+6620303001" });

    expect(await response.json()).toEqual({ action: "reject", code: 404 });
  });

  it.each([
    ["ivr", generators.ivr],
    ["ringgroup", generators.ringGroup],
    ["queue", generators.queue],
    ["timecondition", generators.timeCondition],
  ])(
    "restores the validated tenant when FreeSWITCH receives an internal %s target",
    async (type, generator) => {
      const response = await postFs(`phone11pbx-${type}-7-23`);

      expect(response.status).toBe(200);
      expect(generator).toHaveBeenCalledWith(23, 7);
    },
  );

  it("rings only active endpoints in the encoded tenant for an unassigned DID", async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        { sip_username: "3001", sip_domain: "sip.example.test" },
        { sip_username: "3002", sip_domain: "sip.example.test" },
      ],
    });

    const response = await postFs("phone11pbx-ringall-7-0");
    const xml = await response.text();

    expect(xml).toContain('data="tenant_id=7"');
    expect(xml).toContain(
      "user/3001@sip.example.test,user/3002@sip.example.test",
    );
    expect(db.query.mock.calls[0][1]).toEqual([7]);
  });

  it.each([
    "phone11pbx-ivr-7-0",
    "phone11pbx-ringall-7-23",
    "phone11pbx-ivr-0-23",
    "phone11pbx-shell-7-23",
    "phone11pbx-ivr-7-23-extra",
  ])("does not accept forged internal target %s", async (destination) => {
    const response = await postFs(destination);

    expect(await response.text()).toContain(
      '<section name="dialplan">\n  </section>',
    );
    expect(db.query).not.toHaveBeenCalled();
    expect(generators.ivr).not.toHaveBeenCalled();
  });
});
