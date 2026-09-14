import { describe, expect, it, vi } from "vitest";
import {
  ANDROID_STAGING_SEED,
  applyAndroidStagingSeed,
  canonicalAuthoritySchemaSql,
  inspectAndroidStagingSeed,
  readAndroidStagingSeedConfig,
} from "../server/_core/phone11-android-staging-seed";

const exact = (changes: Record<string, unknown> = {}) => ({
  project: ANDROID_STAGING_SEED.project,
  instance: ANDROID_STAGING_SEED.instance,
  database: ANDROID_STAGING_SEED.database,
  extension: ANDROID_STAGING_SEED.extension,
  domain: ANDROID_STAGING_SEED.domain,
  email: "Pilot7101@Example.Test",
  ...changes,
});

describe("isolated Android staging canonical seed", () => {
  it("defaults to plan and accepts only the exact isolated authority", () => {
    expect(readAndroidStagingSeedConfig(exact())).toEqual({
      apply: false,
      email: "pilot7101@example.test",
    });
    for (const changes of [
      { project: "phone11-production" },
      { database: "phone11" },
      { instance: "other:region:db" },
      { extension: "1001" },
      { domain: "sip.phone11.ai" },
      { email: "invalid" },
    ])
      expect(() => readAndroidStagingSeedConfig(exact(changes))).toThrow();
    expect(() => readAndroidStagingSeedConfig(exact({ apply: true }))).toThrow(
      "--confirm-empty-database",
    );
  });

  it("defines only the minimal canonical authority and no session, push or wake rows", () => {
    for (const table of [
      "organizations",
      "tenants",
      "users",
      "extensions",
      "user_extensions",
      "sip_accounts",
      "subscriber",
      "did_numbers",
    ])
      expect(canonicalAuthoritySchemaSql).toContain(`CREATE TABLE ${table}`);
    expect(canonicalAuthoritySchemaSql).not.toMatch(
      /phone11_auth_session|phone11_push_devices|phone11_wake_bindings/,
    );
    expect(canonicalAuthoritySchemaSql).toContain(
      "subscriber_username_lower_domain_unique",
    );
  });

  it("plans only after proving the connected public schema is empty", async () => {
    const release = vi.fn();
    const query = vi.fn(async (sql: string) =>
      sql.startsWith("SELECT current_database")
        ? { rows: [{ database: "phone11_wake_stage" }] }
        : { rows: [] },
    );
    const result = await inspectAndroidStagingSeed({
      connect: async () => ({ query, release }),
    } as any);
    expect(result).toMatchObject({
      readyToApply: true,
      syntheticSipUri: "sip:7101@sip.stage.phone11.test",
      createsSession: false,
    });
    expect(
      query.mock.calls.some(([sql]) => String(sql).startsWith("CREATE")),
    ).toBe(false);
    expect(release).toHaveBeenCalledOnce();
  });

  it("refuses any existing public table before applying DDL", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith("SELECT current_database"))
        return { rows: [{ database: "phone11_wake_stage" }] };
      if (sql.includes("information_schema.tables"))
        return { rows: [{ table_name: "users" }] };
      return { rows: [] };
    });
    await expect(
      applyAndroidStagingSeed(
        { connect: async () => ({ query, release: vi.fn() }) } as any,
        readAndroidStagingSeedConfig(
          exact({ apply: true, confirmEmptyDatabase: true }),
        ),
      ),
    ).rejects.toThrow("empty public schema");
    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes("INSERT INTO users"),
      ),
    ).toBe(false);
  });

  it("uses generated, parameterized SIP credentials and commits one exact authority chain", async () => {
    const calls: unknown[][] = [];
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      calls.push([sql, values]);
      if (sql.startsWith("SELECT current_database"))
        return { rows: [{ database: "phone11_wake_stage" }] };
      if (sql.includes("information_schema.tables")) return { rows: [] };
      if (sql.includes("SELECT count(*)::integer AS count"))
        return { rows: [{ count: 1 }] };
      return { rows: [] };
    });
    const result = await applyAndroidStagingSeed(
      { connect: async () => ({ query, release: vi.fn() }) } as any,
      readAndroidStagingSeedConfig(
        exact({ apply: true, confirmEmptyDatabase: true }),
      ),
    );
    expect(result).toEqual({
      seeded: true,
      userId: 1,
      tenantId: 1,
      extensionId: 7101,
      sipUri: "sip:7101@sip.stage.phone11.test",
    });
    expect(query).toHaveBeenCalledWith("COMMIT");
    const subscriber = calls.find(([sql]) =>
      String(sql).includes("INSERT INTO subscriber"),
    );
    expect(subscriber?.[1]).toEqual(
      expect.arrayContaining([
        "7101",
        "sip.stage.phone11.test",
        "pilot7101@example.test",
      ]),
    );
    expect(String((subscriber?.[1] as unknown[])[2])).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );
    expect(
      calls.some(([sql]) =>
        /INSERT INTO phone11_(auth_session|push_devices|wake_bindings)/.test(
          String(sql),
        ),
      ),
    ).toBe(false);
  });
});
