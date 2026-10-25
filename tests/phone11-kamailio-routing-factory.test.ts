import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import { it } from "vitest";
import { createKamailioRoutingRouter } from "../server/pbx/kamailio-routing";
import { integrationSecretStatus } from "../server/pbx/integration-auth";

type RequestOptions = {
  path?: string;
  method?: string;
  authorized?: boolean;
  secret?: string;
};
type Context = {
  calls: { sql: string; params?: any[] }[];
  responses: any[];
  request: (
    body: unknown,
    options?: RequestOptions,
  ) => Promise<{ status: number; body: any }>;
  setSecret: (value: unknown) => void;
};
const secret = "synthetic-routing-secret-0123456789";
const names = [
  "denies absent/wrong headers and unavailable explicit configuration before SQL",
  "excludes auth/register and non-routing paths and GET/HEAD without SQL",
  "rejects missing destination without SQL",
  "bridges a scoped extension using only the three DID result fields",
  "routes active IVR",
  "rejects unavailable IVR",
  "routes active ring group",
  "rejects unavailable ring group",
  "routes active queue",
  "rejects unavailable queue",
  "routes time condition",
  "rejects unavailable time condition",
  "rejects ambiguous DID tenants",
  "preserves unassigned DID ring-all",
  "rejects removed extension",
  "rejects unsupported assignment",
  "rejects malformed feature ID",
  "requires internal caller identity",
  "rejects missing caller",
  "rejects ambiguous caller",
  "scopes internal target to verified caller tenant",
  "rejects missing internal target",
  "preserves query-error rejection",
  "uses explicit secret despite unrelated ambient configuration",
];
let index = 0;
function check(callback: (context: Context) => Promise<void>) {
  it(names[index++], () => withRouter(callback));
}
async function withRouter(callback: (context: Context) => Promise<void>) {
  const calls: Context["calls"] = [];
  const responses: any[] = [];
  let configured: unknown = secret;
  const router = createKamailioRoutingRouter({
    getSecret: () => configured,
    query: async (sql, params) => {
      calls.push({ sql, params });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      assert.ok(next, "unexpected query");
      return { rows: next };
    },
  });
  const app = express();
  app.use(express.json());
  app.use("/api/kamailio", router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  async function request(body: unknown, options: RequestOptions = {}) {
    const response = await fetch(
      base + (options.path ?? "/api/kamailio/route"),
      {
        method: options.method ?? "POST",
        headers: {
          "content-type": "application/json",
          ...(options.authorized === false
            ? {}
            : { "x-kam-secret": options.secret ?? secret }),
        },
        ...(options.method === "GET" || options.method === "HEAD"
          ? {}
          : { body: JSON.stringify(body) }),
      },
    );
    const text = await response.text();
    return {
      status: response.status,
      body:
        response.headers.get("content-type")?.includes("application/json") &&
        text
          ? JSON.parse(text)
          : null,
    };
  }
  try {
    await callback({
      calls,
      responses,
      request,
      setSecret: (value: unknown) => {
        configured = value;
      },
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
check(async ({ calls, request, setSecret }) => {
  for (const options of [
    { authorized: false },
    { secret: "incorrect-synthetic-secret" },
  ])
    assert.equal(
      (await request({ ruri_user: "6620000000" }, options)).status,
      403,
    );
  for (const value of [
    undefined,
    "short",
    "placeholder-not-a-real-secret-0000000",
    {},
    123,
  ]) {
    setSecret(value);
    assert.equal((await request({ ruri_user: "6620000000" })).status, 503);
  }
  assert.equal(calls.length, 0);
});
check(async ({ calls, request }) => {
  for (const p of [
    "/api/kamailio/auth",
    "/api/kamailio/register",
    "/api/kamailio/route/extra",
    "/health",
  ])
    assert.equal((await request({}, { path: p })).status, 404);
  assert.equal((await request(null, { method: "GET" })).status, 404);
  assert.equal((await request(null, { method: "HEAD" })).status, 404);
  assert.equal(calls.length, 0);
});
check(async ({ calls, request }) => {
  assert.deepEqual((await request({})).body, { action: "reject", code: 404 });
  assert.equal(calls.length, 0);
});
const did = (overrides: Record<string, unknown>) => ({
  tenant_id: 7,
  assigned_route_type: null,
  assigned_route_id: null,
  ...overrides,
});
check(async ({ calls, responses, request }) => {
  responses.push(
    [did({ assigned_route_type: "extension", assigned_route_id: 42 })],
    [{ sip_username: "3001", sip_domain: "sip.example.test" }],
  );
  assert.deepEqual((await request({ ruri_user: "6620000000" })).body, {
    action: "bridge",
    target: "sip:3001@sip.example.test",
    tenantId: 7,
  });
  assert.deepEqual(calls[1].params, [42, 7]);
  assert.match(
    calls[0].sql,
    /SELECT pn\.tenant_id, pn\.assigned_route_type, pn\.assigned_route_id/,
  );
  assert.doesNotMatch(calls[0].sql, /pn\.\*|tenant_slug/);
  assert.match(calls[0].sql, /LIMIT 2/);
  assert.match(
    calls[1].sql,
    /e\.tenant_id = \$2 AND sa\.tenant_id = e\.tenant_id/,
  );
  assert.match(
    calls[1].sql,
    /e\.status = 'active' AND e\.deleted_at IS NULL AND sa\.status = 'active'/,
  );
});
for (const [type, table, internal] of [
  ["ivr", "ivr_menus", "ivr"],
  ["ring_group", "ring_groups", "ringgroup"],
  ["queue", "call_queues", "queue"],
  ["time_condition", "time_conditions", "timecondition"],
]) {
  check(async ({ calls, responses, request }) => {
    responses.push(
      [did({ assigned_route_type: type, assigned_route_id: 23 })],
      [{ id: 23 }],
    );
    assert.deepEqual((await request({ ruri_user: "6620000000" })).body, {
      action: "freeswitch",
      target: `phone11pbx-${internal}-7-23`,
      tenantId: 7,
    });
    assert.match(
      calls[1].sql,
      new RegExp(`FROM ${table} WHERE id = \\$1 AND tenant_id = \\$2`),
    );
    assert.equal(
      calls[1].sql.includes("is_active = true"),
      type !== "time_condition",
    );
    assert.deepEqual(calls[1].params, [23, 7]);
  });
  check(async ({ responses, request }) => {
    responses.push(
      [did({ assigned_route_type: type, assigned_route_id: 23 })],
      [],
    );
    assert.deepEqual((await request({ ruri_user: "6620000000" })).body, {
      action: "reject",
      code: 404,
    });
  });
}
check(async ({ calls, responses, request }) => {
  responses.push([did({}), did({ tenant_id: 8 })]);
  assert.deepEqual((await request({ ruri_user: "6620000000" })).body, {
    action: "reject",
    code: 404,
  });
  assert.equal(calls.length, 1);
});
check(async ({ responses, request }) => {
  responses.push([did({})]);
  assert.deepEqual((await request({ ruri_user: "6620000000" })).body, {
    action: "ring_all",
    target: "phone11pbx-ringall-7-0",
    tenantId: 7,
  });
});
for (const assignment of [
  { assigned_route_type: "extension", assigned_route_id: 42 },
  { assigned_route_type: "unsupported", assigned_route_id: 23 },
  { assigned_route_type: "ivr", assigned_route_id: "23" },
]) {
  check(async ({ responses, request }) => {
    responses.push([did(assignment)], []);
    assert.deepEqual((await request({ ruri_user: "6620000000" })).body, {
      action: "reject",
      code: 404,
    });
  });
}
check(async ({ calls, responses, request }) => {
  responses.push([]);
  assert.deepEqual((await request({ ruri_user: "3001" })).body, {
    action: "reject",
    code: 403,
  });
  assert.equal(calls.length, 1);
});
for (const callerRows of [[], [{ tenant_id: 7 }, { tenant_id: 8 }]])
  check(async ({ responses, request }) => {
    responses.push([], callerRows);
    assert.deepEqual(
      (
        await request({
          ruri_user: "3001",
          from_user: "3002",
          domain: "sip.example.test",
        })
      ).body,
      { action: "reject", code: 403 },
    );
  });
check(async ({ calls, responses, request }) => {
  responses.push(
    [],
    [{ tenant_id: 7 }],
    [{ sip_username: "3001", sip_domain: "sip.example.test", tenant_id: 7 }],
  );
  assert.deepEqual(
    (
      await request({
        ruri_user: "3001",
        from_user: "3002",
        domain: "sip.example.test",
      })
    ).body,
    { action: "bridge", target: "sip:3001@sip.example.test", tenantId: 7 },
  );
  assert.deepEqual(calls[1].params, ["3002", "sip.example.test"]);
  assert.deepEqual(calls[2].params, ["3001", 7]);
  assert.match(calls[1].sql, /e\.tenant_id = sa\.tenant_id/);
  assert.match(calls[1].sql, /t\.status = 'active'/);
});
check(async ({ responses, request }) => {
  responses.push([], [{ tenant_id: 7 }], []);
  assert.deepEqual(
    (
      await request({
        ruri_user: "3001",
        from_user: "3002",
        domain: "sip.example.test",
      })
    ).body,
    { action: "reject", code: 404 },
  );
});
check(async ({ responses, request }) => {
  responses.push(new Error("synthetic-query-refusal"));
  const log = console.error;
  console.error = () => {};
  try {
    assert.deepEqual((await request({ ruri_user: "6620000000" })).body, {
      action: "reject",
      code: 500,
    });
  } finally {
    console.error = log;
  }
});
check(async ({ responses, request }) => {
  const saved = process.env.KAM_SHARED_SECRET;
  process.env.KAM_SHARED_SECRET = "ambient-must-not-control-factory";
  try {
    responses.push([did({})]);
    assert.equal(
      (await request({ ruri_user: "6620000000" })).body.action,
      "ring_all",
    );
  } finally {
    if (saved === undefined) delete process.env.KAM_SHARED_SECRET;
    else process.env.KAM_SHARED_SECRET = saved;
  }
});

it("preserves legacy named-secret status and restores test environment", () => {
  const previous = process.env.KAM_SHARED_SECRET;
  try {
    process.env.KAM_SHARED_SECRET = secret;
    assert.equal(integrationSecretStatus("KAM_SHARED_SECRET", secret), "ok");
    assert.equal(
      integrationSecretStatus("KAM_SHARED_SECRET", "wrong"),
      "forbidden",
    );
    delete process.env.KAM_SHARED_SECRET;
    assert.equal(
      integrationSecretStatus("KAM_SHARED_SECRET", secret),
      "unavailable",
    );
  } finally {
    if (previous === undefined) delete process.env.KAM_SHARED_SECRET;
    else process.env.KAM_SHARED_SECRET = previous;
  }
});
