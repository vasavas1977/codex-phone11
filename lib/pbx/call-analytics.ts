export type CallAnalyticsPeriod = "today" | "week" | "month";

export type CallAnalyticsSummary = {
  totalCalls: number;
  answered: number;
  missed: number;
  averageDurationSeconds: number;
};

export type HourlyCallDistribution = {
  hour: number;
  calls: number;
  answered: number;
};

export type CallAnalyticsRankedNumber = {
  number: string;
  calls: number;
  totalSeconds: number;
};

export type NormalizedCallAnalytics = {
  summary: CallAnalyticsSummary;
  hourlyDistribution: HourlyCallDistribution[];
  topCallers: CallAnalyticsRankedNumber[];
  topDestinations: CallAnalyticsRankedNumber[];
};

type UnknownRecord = Record<string, unknown>;

const DEFAULT_ANALYTICS: NormalizedCallAnalytics = {
  summary: {
    totalCalls: 0,
    answered: 0,
    missed: 0,
    averageDurationSeconds: 0,
  },
  hourlyDistribution: [],
  topCallers: [],
  topDestinations: [],
};

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function nonnegativeNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function nonnegativeInteger(value: unknown): number {
  return Math.floor(nonnegativeNumber(value));
}

function rankedNumbers(value: unknown, key: "caller_number" | "callee_number") {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    const row = asRecord(item);
    const number = row?.[key];
    if (!row || typeof number !== "string" || !number.trim()) return [];

    return [{
      number: number.trim(),
      calls: nonnegativeInteger(row.call_count),
      totalSeconds: nonnegativeInteger(row.total_seconds),
    }];
  });
}

function hourlyDistribution(value: unknown): HourlyCallDistribution[] {
  if (!Array.isArray(value)) return [];

  const rows = new Map<number, HourlyCallDistribution>();
  for (const item of value) {
    const row = asRecord(item);
    const hour = Number(row?.hour);
    if (!row || !Number.isInteger(hour) || hour < 0 || hour > 23) continue;

    const existing = rows.get(hour) ?? { hour, calls: 0, answered: 0 };
    existing.calls += nonnegativeInteger(row.calls);
    existing.answered += nonnegativeInteger(row.answered);
    rows.set(hour, existing);
  }

  return [...rows.values()].sort((a, b) => a.hour - b.hour);
}

/**
 * PostgreSQL aggregate values are commonly returned as strings. Keep malformed
 * or unexpected API values contained in the admin display rather than letting
 * a partially ingested CDR response break the screen.
 */
export function normalizeCallAnalytics(value: unknown): NormalizedCallAnalytics {
  const analytics = asRecord(value);
  if (!analytics) return DEFAULT_ANALYTICS;
  const summary = asRecord(analytics.summary);

  return {
    summary: {
      totalCalls: nonnegativeInteger(summary?.total_calls),
      answered: nonnegativeInteger(summary?.answered),
      missed: nonnegativeInteger(summary?.missed),
      averageDurationSeconds: nonnegativeInteger(summary?.avg_duration),
    },
    hourlyDistribution: hourlyDistribution(analytics.hourlyDistribution),
    topCallers: rankedNumbers(analytics.topCallers, "caller_number"),
    topDestinations: rankedNumbers(analytics.topDestinations, "callee_number"),
  };
}
