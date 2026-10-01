import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "pg";

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../server/pbx/db", () => ({ query: db.query }));
vi.mock("../server/pbx/redis", () => ({ cacheGetOrSet: vi.fn() }));
import { evaluateTimeCondition } from "../server/pbx/dialplan-generators";

const databaseUrl = process.env.PHONE11_PBX_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("schedule calendar dates on PostgreSQL", () => {
  let client: Client;
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
        || url.pathname !== '/phone11_pbx_test') throw new Error("Use only the isolated loopback PBX test database");
    client = new Client({ connectionString: databaseUrl, ssl: false });
    await client.connect();
    await client.query(`CREATE TEMP TABLE time_conditions (id int, tenant_id int, timezone text,
      match_action text, match_target text, nomatch_action text, nomatch_target text);
      CREATE TEMP TABLE time_condition_rules (id int, time_condition_id int, day_of_week int[],
      start_time time, end_time time, start_date date, end_date date, is_holiday boolean, sort_order int);
      INSERT INTO time_conditions VALUES (5,1,'Asia/Bangkok','transfer','3001','voicemail','3001')`);
    db.query.mockImplementation((sql, parameters) => client.query(sql, parameters));
  });
  afterEach(() => { vi.useRealTimers(); });
  afterAll(async () => { if (client) await client.end(); });

  for (const dateStyle of ['ISO, MDY', 'SQL, MDY', 'German, DMY']) {
    it(`matches holidays and dated hours with DateStyle ${dateStyle}`, async () => {
      await client.query("SELECT set_config('DateStyle', $1, false)", [dateStyle]);
      await client.query("TRUNCATE time_condition_rules");
      await client.query(`INSERT INTO time_condition_rules VALUES
        (1,5,NULL,NULL,NULL,'2026-10-01','2026-10-01',true,0),
        (2,5,NULL,NULL,NULL,NULL,NULL,false,1)`);
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date("2026-09-30T17:30:00Z"));
      expect(await evaluateTimeCondition(5, 1)).toEqual({ matched: false, action: "voicemail", target: "3001" });
      await client.query("TRUNCATE time_condition_rules");
      await client.query(`INSERT INTO time_condition_rules VALUES
        (3,5,NULL,NULL,NULL,'2026-10-01','2026-10-01',false,0)`);
      expect(await evaluateTimeCondition(5, 1)).toEqual({ matched: true, action: "transfer", target: "3001" });
      vi.setSystemTime(new Date("2026-10-01T17:30:00Z"));
      expect(await evaluateTimeCondition(5, 1)).toEqual({ matched: false, action: "voicemail", target: "3001" });
    });
  }
});
