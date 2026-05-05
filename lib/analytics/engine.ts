/**
 * Call Analytics Aggregation Engine
 *
 * Computes aggregated analytics from recording data including
 * call volume, sentiment trends, topic frequency, and action item summaries.
 * Uses mock data for demo; in production would query the server database.
 */

import type {
  AnalyticsDashboard,
  AnalyticsTimeRange,
  MetricSummary,
  TimeSeriesPoint,
  TopicFrequency,
  SentimentDistribution,
  DirectionDistribution,
  HourlyDistribution,
  ActionItemSummary,
  SpeakerAggregate,
} from "./types";

const DAYS_MAP: Record<AnalyticsTimeRange, number> = {
  today: 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
  all: 365,
};

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function generateCallVolume(timeRange: AnalyticsTimeRange): TimeSeriesPoint[] {
  const days = DAYS_MAP[timeRange];
  if (days <= 1) {
    // Hourly for today
    return Array.from({ length: 24 }, (_, i) => ({
      label: `${i.toString().padStart(2, "0")}:00`,
      value: Math.round(randomBetween(0, i >= 9 && i <= 17 ? 12 : 3)),
    }));
  }
  if (days <= 7) {
    const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    return dayNames.map((d) => ({
      label: d,
      value: Math.round(randomBetween(8, 32)),
    }));
  }
  if (days <= 30) {
    return Array.from({ length: 4 }, (_, i) => ({
      label: `Week ${i + 1}`,
      value: Math.round(randomBetween(45, 120)),
    }));
  }
  // 90d or all: monthly
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const count = days <= 90 ? 3 : 12;
  const now = new Date();
  return Array.from({ length: count }, (_, i) => {
    const monthIdx = (now.getMonth() - count + 1 + i + 12) % 12;
    return {
      label: months[monthIdx],
      value: Math.round(randomBetween(120, 450)),
    };
  });
}

function generateSentimentTrend(timeRange: AnalyticsTimeRange): TimeSeriesPoint[] {
  const volume = generateCallVolume(timeRange);
  return volume.map((p) => ({
    label: p.label,
    value: Math.round(randomBetween(-0.3, 0.7) * 100) / 100,
    secondary: Math.round(randomBetween(0.1, 0.9) * 100) / 100,
  }));
}

function generateAvgDuration(timeRange: AnalyticsTimeRange): TimeSeriesPoint[] {
  const volume = generateCallVolume(timeRange);
  return volume.map((p) => ({
    label: p.label,
    value: Math.round(randomBetween(120, 480)),
  }));
}

function generateMetrics(timeRange: AnalyticsTimeRange): MetricSummary[] {
  const days = DAYS_MAP[timeRange];
  const baseCalls = Math.round(days * randomBetween(8, 20));
  const avgDur = Math.round(randomBetween(180, 420));
  const recPct = Math.round(randomBetween(60, 95));
  const sentScore = Math.round(randomBetween(0.2, 0.7) * 100) / 100;

  return [
    {
      label: "Total Calls",
      value: baseCalls,
      displayValue: baseCalls.toLocaleString(),
      change: randomBetween(-0.15, 0.25),
      increaseIsGood: true,
      icon: "phone.fill",
      color: "#0A7EA4",
    },
    {
      label: "Avg Duration",
      value: avgDur,
      displayValue: `${Math.floor(avgDur / 60)}m ${avgDur % 60}s`,
      change: randomBetween(-0.1, 0.15),
      increaseIsGood: false,
      icon: "clock.fill",
      color: "#8B5CF6",
    },
    {
      label: "Recorded",
      value: recPct,
      displayValue: `${recPct}%`,
      change: randomBetween(0, 0.1),
      increaseIsGood: true,
      icon: "record.circle.fill",
      color: "#EF4444",
    },
    {
      label: "Sentiment",
      value: sentScore,
      displayValue: sentScore > 0 ? `+${sentScore.toFixed(2)}` : sentScore.toFixed(2),
      change: randomBetween(-0.05, 0.15),
      increaseIsGood: true,
      icon: "waveform",
      color: "#22C55E",
    },
    {
      label: "AI Analyzed",
      value: Math.round(baseCalls * randomBetween(0.7, 0.95)),
      displayValue: `${Math.round(randomBetween(70, 95))}%`,
      change: randomBetween(0.05, 0.2),
      increaseIsGood: true,
      icon: "sparkles",
      color: "#F59E0B",
    },
    {
      label: "Action Items",
      value: Math.round(baseCalls * randomBetween(0.3, 0.6)),
      displayValue: Math.round(baseCalls * randomBetween(0.3, 0.6)).toString(),
      change: randomBetween(-0.1, 0.2),
      increaseIsGood: false,
      icon: "checklist",
      color: "#06B6D4",
    },
  ];
}

function generateTopTopics(): TopicFrequency[] {
  const topics = [
    { topic: "Project Timeline", count: 42, avgSentiment: 0.3 },
    { topic: "Budget Review", count: 38, avgSentiment: -0.1 },
    { topic: "Technical Issues", count: 35, avgSentiment: -0.3 },
    { topic: "Client Onboarding", count: 28, avgSentiment: 0.5 },
    { topic: "Feature Requests", count: 24, avgSentiment: 0.2 },
    { topic: "Support Escalation", count: 19, avgSentiment: -0.4 },
    { topic: "Sales Pipeline", count: 17, avgSentiment: 0.4 },
    { topic: "Team Coordination", count: 15, avgSentiment: 0.1 },
  ];
  const total = topics.reduce((s, t) => s + t.count, 0);
  return topics.map((t) => ({
    ...t,
    percentage: Math.round((t.count / total) * 100),
  }));
}

function generateSentimentDistribution(): SentimentDistribution {
  const positive = Math.round(randomBetween(30, 50));
  const neutral = Math.round(randomBetween(20, 35));
  const negative = Math.round(randomBetween(10, 25));
  const mixed = 100 - positive - neutral - negative;
  return { positive, neutral, negative, mixed: Math.max(0, mixed) };
}

function generateDirectionDistribution(): DirectionDistribution {
  const inbound = Math.round(randomBetween(35, 55));
  const outbound = Math.round(randomBetween(30, 45));
  const conference = 100 - inbound - outbound;
  return { inbound, outbound, conference: Math.max(0, conference) };
}

function generateHourlyDistribution(): HourlyDistribution[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    count: Math.round(
      hour >= 9 && hour <= 17
        ? randomBetween(8, 25)
        : hour >= 7 && hour <= 20
        ? randomBetween(2, 10)
        : randomBetween(0, 3),
    ),
  }));
}

function generateActionItemSummary(): ActionItemSummary {
  const total = Math.round(randomBetween(40, 120));
  const completed = Math.round(total * randomBetween(0.4, 0.7));
  const pending = total - completed;
  const highUrgency = Math.round(pending * randomBetween(0.15, 0.3));
  const mediumUrgency = Math.round(pending * randomBetween(0.3, 0.5));
  const lowUrgency = pending - highUrgency - mediumUrgency;
  return { total, completed, pending, highUrgency, mediumUrgency, lowUrgency: Math.max(0, lowUrgency) };
}

function generateTopSpeakers(): SpeakerAggregate[] {
  const names = [
    "Sarah Johnson",
    "David Kim",
    "Acme Corp Support",
    "Mike Chen",
    "Emily Rodriguez",
    "Vendor Support",
  ];
  return names.map((name) => ({
    name,
    totalCalls: Math.round(randomBetween(5, 35)),
    totalDuration: Math.round(randomBetween(1800, 14400)),
    avgTalkPercentage: Math.round(randomBetween(35, 65)),
    avgSentiment: Math.round(randomBetween(-0.3, 0.6) * 100) / 100,
  })).sort((a, b) => b.totalCalls - a.totalCalls);
}

class AnalyticsEngine {
  /**
   * Compute the full analytics dashboard for a given time range.
   * In production, this would aggregate from the database.
   */
  async computeDashboard(timeRange: AnalyticsTimeRange): Promise<AnalyticsDashboard> {
    // Simulate computation delay
    await new Promise((resolve) => setTimeout(resolve, 400 + Math.random() * 300));

    return {
      timeRange,
      computedAt: Date.now(),
      metrics: generateMetrics(timeRange),
      callVolume: generateCallVolume(timeRange),
      avgDuration: generateAvgDuration(timeRange),
      sentimentTrend: generateSentimentTrend(timeRange),
      topTopics: generateTopTopics(),
      sentimentDistribution: generateSentimentDistribution(),
      directionDistribution: generateDirectionDistribution(),
      hourlyDistribution: generateHourlyDistribution(),
      actionItemSummary: generateActionItemSummary(),
      topSpeakers: generateTopSpeakers(),
    };
  }
}

export const analyticsEngine = new AnalyticsEngine();
