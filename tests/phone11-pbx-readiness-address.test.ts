import { describe, expect, it, vi } from "vitest";
vi.mock("../server/pbx/db", () => ({ getPool: vi.fn(), query: vi.fn() }));
// eslint-disable-next-line import/first
import { readinessServerAddress } from "../server/pbx/database-readiness";

describe("commissioned PBX server address remains a bare IPv4 identity", () => {
  it("accepts the exact IPv4 literal without changing it", () => {
    expect(readinessServerAddress({ PHONE11_PBX_READINESS_EXPECTED_SERVER_ADDRESS: "127.0.0.1" })).toBe("127.0.0.1");
  });
  it.each(["127.0.0.1/32", "127.0.0.0/8", "::1", "127.0.0.1:5432", " 127.0.0.1"])("refuses non-bare IPv4 input %s", address => {
    expect(readinessServerAddress({ PHONE11_PBX_READINESS_EXPECTED_SERVER_ADDRESS: address })).toBeUndefined();
  });
});
