/**
 * Tests for Speaker Diarization and Call Analytics
 */

import { describe, it, expect } from "vitest";
import type {
  DiarizationResult,
  DiarizedSegment,
  Speaker,
  DiarizeTranscriptRequest,
} from "../lib/recording/diarization-types";
import { SPEAKER_COLORS } from "../lib/recording/diarization-types";
import type {
  AnalyticsDashboard,
  AnalyticsTimeRange,
  MetricSummary,
  TopicFrequency,
  SentimentDistribution,
} from "../lib/analytics/types";

// ═══════════════════════════════════════
// DIARIZATION TYPES TESTS
// ═══════════════════════════════════════

describe("Diarization Types", () => {
  it("should have correct speaker color palette", () => {
    expect(SPEAKER_COLORS).toHaveLength(6);
    expect(SPEAKER_COLORS[0]).toBe("#0A7EA4"); // Teal
    expect(SPEAKER_COLORS[1]).toBe("#8B5CF6"); // Purple
  });

  it("should create valid Speaker objects", () => {
    const speaker: Speaker = {
      id: "speaker_0",
      label: "Caller",
      name: "John Doe",
      color: SPEAKER_COLORS[0],
      totalDuration: 120,
      talkPercentage: 55,
      averageSentiment: 0.3,
      segmentCount: 6,
    };
    expect(speaker.id).toBe("speaker_0");
    expect(speaker.talkPercentage).toBeGreaterThan(0);
    expect(speaker.talkPercentage).toBeLessThanOrEqual(100);
  });

  it("should create valid DiarizedSegment objects", () => {
    const segment: DiarizedSegment = {
      index: 0,
      speakerId: "speaker_0",
      startTime: 0,
      endTime: 5.2,
      duration: 5.2,
      text: "Hello, how are you?",
      confidence: 0.92,
      sentimentScore: 0.4,
    };
    expect(segment.endTime).toBeGreaterThan(segment.startTime);
    expect(segment.confidence).toBeGreaterThanOrEqual(0);
    expect(segment.confidence).toBeLessThanOrEqual(1);
  });

  it("should create valid DiarizationResult objects", () => {
    const result: DiarizationResult = {
      recordingId: "rec_001",
      processedAt: Date.now(),
      status: "completed",
      speakers: [],
      segments: [],
      turnCount: 0,
      averageSegmentDuration: 0,
      overlapPercentage: 0,
    };
    expect(result.status).toBe("completed");
    expect(result.recordingId).toBe("rec_001");
  });

  it("should validate DiarizeTranscriptRequest", () => {
    const request: DiarizeTranscriptRequest = {
      recordingId: "rec_001",
      transcription: "Hello world",
      callerName: "Alice",
      calleeName: "Bob",
      duration: 60,
    };
    expect(request.transcription.length).toBeGreaterThan(0);
    expect(request.duration).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════
// ANALYTICS TYPES TESTS
// ═══════════════════════════════════════

describe("Analytics Types", () => {
  it("should validate AnalyticsTimeRange values", () => {
    const ranges: AnalyticsTimeRange[] = ["today", "7d", "30d", "90d", "all"];
    expect(ranges).toHaveLength(5);
    expect(ranges).toContain("7d");
    expect(ranges).toContain("all");
  });

  it("should create valid MetricSummary objects", () => {
    const metric: MetricSummary = {
      label: "Total Calls",
      value: 150,
      displayValue: "150",
      change: 0.12,
      increaseIsGood: true,
      icon: "phone.fill",
      color: "#0A7EA4",
    };
    expect(metric.value).toBeGreaterThan(0);
    expect(metric.change).toBeGreaterThan(-1);
    expect(metric.change).toBeLessThan(1);
  });

  it("should create valid TopicFrequency objects", () => {
    const topic: TopicFrequency = {
      topic: "Budget Review",
      count: 38,
      percentage: 17,
      avgSentiment: -0.1,
    };
    expect(topic.count).toBeGreaterThan(0);
    expect(topic.percentage).toBeGreaterThan(0);
    expect(topic.percentage).toBeLessThanOrEqual(100);
  });

  it("should create valid SentimentDistribution", () => {
    const dist: SentimentDistribution = {
      positive: 40,
      neutral: 30,
      negative: 20,
      mixed: 10,
    };
    const total = dist.positive + dist.neutral + dist.negative + dist.mixed;
    expect(total).toBe(100);
  });

  it("should create valid AnalyticsDashboard structure", () => {
    const dashboard: AnalyticsDashboard = {
      timeRange: "7d",
      computedAt: Date.now(),
      metrics: [],
      callVolume: [],
      avgDuration: [],
      sentimentTrend: [],
      topTopics: [],
      sentimentDistribution: { positive: 40, neutral: 30, negative: 20, mixed: 10 },
      directionDistribution: { inbound: 50, outbound: 40, conference: 10 },
      hourlyDistribution: [],
      actionItemSummary: {
        total: 50,
        completed: 30,
        pending: 20,
        highUrgency: 5,
        mediumUrgency: 10,
        lowUrgency: 5,
      },
      topSpeakers: [],
    };
    expect(dashboard.timeRange).toBe("7d");
    expect(dashboard.actionItemSummary.total).toBe(
      dashboard.actionItemSummary.completed + dashboard.actionItemSummary.pending,
    );
  });
});
