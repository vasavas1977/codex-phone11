import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../server/pbx/db", () => ({ query: db.query }));
vi.mock("../server/pbx/redis", () => ({ cacheGetOrSet: vi.fn() }));
import { evaluateTimeCondition } from "../server/pbx/dialplan-generators";

const open = { matched: true, action: "transfer", target: "3001" };
const closed = { matched: false, action: "voicemail", target: "3001" };
const hours = { day_of_week: [1, 2, 3, 4, 5], start_time: "09:00:00", end_time: "18:00:00", is_holiday: false };

function fixture(timezone: string, rules: Record<string, unknown>[]) {
  db.query.mockResolvedValueOnce({ rows: [{ timezone, match_action: "transfer", match_target: "3001", nomatch_action: "voicemail", nomatch_target: "3001" }] });
  db.query.mockResolvedValueOnce({ rows: rules });
}

beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("workspace schedule evaluation", () => {
  it("uses the workspace holiday date across the UTC date boundary", async () => {
    vi.setSystemTime(new Date("2026-09-30T17:30:00Z")); // Bangkok October 1, 00:30
    fixture("Asia/Bangkok", [{ is_holiday: true, start_date: "2026-10-01", end_date: "2026-10-01" }, { is_holiday: false }]);
    expect(await evaluateTimeCondition(5, 1)).toEqual(closed);
    expect(db.query.mock.calls[0][1]).toEqual([5, 1]);
    expect(db.query.mock.calls[1][0]).toContain("to_char(start_date, 'YYYY-MM-DD') AS start_date");
  });

  it("does not apply tomorrow's holiday to the workspace's current day", async () => {
    vi.setSystemTime(new Date("2026-10-01T02:30:00Z")); // Los Angeles September 30, 19:30
    fixture("America/Los_Angeles", [{ is_holiday: true, start_date: "2026-10-01", end_date: "2026-10-01" }, { is_holiday: false }]);
    expect(await evaluateTimeCondition(5, 1)).toEqual(open);
  });

  it("evaluates multiple daily intervals and closes during the lunch gap", async () => {
    for (const [instant, expected] of [["2026-10-01T04:00:00Z", open], ["2026-10-01T05:30:00Z", closed], ["2026-10-01T07:00:00Z", open]] as const) {
      vi.setSystemTime(new Date(instant));
      fixture("Asia/Bangkok", [{ ...hours, end_time: "12:00:00" }, { ...hours, start_time: "13:00:00" }]);
      expect(await evaluateTimeCondition(5, 1)).toEqual(expected);
    }
  });

  it("honors regular rule date limits including both boundary dates", async () => {
    for (const [date, expected] of [["2026-09-30", closed], ["2026-10-01", open], ["2026-10-02", open], ["2026-10-03", closed]] as const) {
      vi.setSystemTime(new Date(`${date}T04:00:00Z`));
      fixture("Asia/Bangkok", [{ ...hours, day_of_week: [], start_date: "2026-10-01", end_date: "2026-10-02" }]);
      expect(await evaluateTimeCondition(5, 1)).toEqual(expected);
    }
  });

  it("uses local weekday rather than the UTC weekday", async () => {
    vi.setSystemTime(new Date("2026-10-04T18:00:00Z")); // Monday 01:00 Bangkok
    fixture("Asia/Bangkok", [{ is_holiday: false, day_of_week: [1], start_time: "00:00:00", end_time: "02:00:00" }]);
    expect(await evaluateTimeCondition(5, 1)).toEqual(open);
  });

  it("uses daylight saving time in the configured IANA zone", async () => {
    for (const instant of ["2026-01-15T17:30:00Z", "2026-07-15T16:30:00Z"]) {
      vi.setSystemTime(new Date(instant));
      fixture("America/Los_Angeles", [{ ...hours, end_time: "10:00:00" }]);
      expect(await evaluateTimeCondition(5, 1)).toEqual(open);
    }
  });

  it("rejects an invalid persisted timezone rather than routing as open", async () => {
    fixture("Not/AZone", [{ is_holiday: false }]);
    await expect(evaluateTimeCondition(5, 1)).rejects.toThrow(RangeError);
  });

  it("returns closed without fetching rules for a different tenant's schedule", async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    expect(await evaluateTimeCondition(5, 9)).toEqual({ matched: false, action: "hangup", target: "" });
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});
