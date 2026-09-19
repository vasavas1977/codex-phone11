import { describe, expect, it } from "vitest";
import { normalizeCallAnalytics } from "../lib/pbx/call-analytics";

describe("call analytics display data", () => {
  it("normalizes PostgreSQL aggregate strings into the screen's real CDR fields", () => {
    expect(
      normalizeCallAnalytics({
        summary: {
          total_calls: "12",
          answered: "9",
          missed: "2",
          avg_duration: "63.8",
        },
        hourlyDistribution: [
          { hour: "9", calls: "4", answered: "3" },
          { hour: 14, calls: 2, answered: 2 },
        ],
        topCallers: [{ caller_number: "+6620303001", call_count: "4", total_seconds: "244" }],
        topDestinations: [{ callee_number: "3001", call_count: 3, total_seconds: 120 }],
      }),
    ).toEqual({
      summary: { totalCalls: 12, answered: 9, missed: 2, averageDurationSeconds: 63 },
      hourlyDistribution: [
        { hour: 9, calls: 4, answered: 3 },
        { hour: 14, calls: 2, answered: 2 },
      ],
      topCallers: [{ number: "+6620303001", calls: 4, totalSeconds: 244 }],
      topDestinations: [{ number: "3001", calls: 3, totalSeconds: 120 }],
    });
  });

  it("contains malformed partial CDR response values instead of rendering invalid metrics", () => {
    expect(
      normalizeCallAnalytics({
        summary: { total_calls: "not a number", answered: -1, missed: null, avg_duration: Infinity },
        hourlyDistribution: [
          { hour: -1, calls: 8, answered: 8 },
          { hour: "9", calls: "2", answered: "1" },
          { hour: 9, calls: 3, answered: 2 },
          { hour: 24, calls: 1, answered: 1 },
        ],
        topCallers: [{ caller_number: "", call_count: 1 }, null],
        topDestinations: [{ callee_number: "4001", call_count: "bad", total_seconds: -3 }],
      }),
    ).toEqual({
      summary: { totalCalls: 0, answered: 0, missed: 0, averageDurationSeconds: 0 },
      hourlyDistribution: [{ hour: 9, calls: 5, answered: 3 }],
      topCallers: [],
      topDestinations: [{ number: "4001", calls: 0, totalSeconds: 0 }],
    });
  });
});
