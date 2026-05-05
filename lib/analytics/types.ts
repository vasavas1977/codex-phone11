/**
 * Call Analytics Types
 *
 * Data models for aggregated call analytics including
 * call volume metrics, sentiment trends, topic frequency,
 * and action item summaries across all recordings.
 */

/** Time range for analytics queries */
export type AnalyticsTimeRange = "today" | "7d" | "30d" | "90d" | "all";

/** A single data point in a time series */
export interface TimeSeriesPoint {
  /** Label for the x-axis (e.g., "Mon", "Jan 15", "Week 3") */
  label: string;
  /** Numeric value */
  value: number;
  /** Optional secondary value (e.g., for dual-axis charts) */
  secondary?: number;
}

/** Summary metric card data */
export interface MetricSummary {
  label: string;
  value: number;
  /** Formatted display string (e.g., "1,234", "45m", "87%") */
  displayValue: string;
  /** Change from previous period (-1 to 1 as percentage) */
  change: number;
  /** Whether increase is positive (true) or negative (false) */
  increaseIsGood: boolean;
  icon: string;
  color: string;
}

/** Topic frequency entry */
export interface TopicFrequency {
  topic: string;
  count: number;
  percentage: number;
  avgSentiment: number;
}

/** Sentiment distribution */
export interface SentimentDistribution {
  positive: number;
  neutral: number;
  negative: number;
  mixed: number;
}

/** Per-speaker aggregated stats */
export interface SpeakerAggregate {
  name: string;
  totalCalls: number;
  totalDuration: number;
  avgTalkPercentage: number;
  avgSentiment: number;
}

/** Action item summary */
export interface ActionItemSummary {
  total: number;
  completed: number;
  pending: number;
  highUrgency: number;
  mediumUrgency: number;
  lowUrgency: number;
}

/** Call direction distribution */
export interface DirectionDistribution {
  inbound: number;
  outbound: number;
  conference: number;
}

/** Hourly call distribution (0-23) */
export interface HourlyDistribution {
  hour: number;
  count: number;
}

/** Full analytics dashboard data */
export interface AnalyticsDashboard {
  /** Selected time range */
  timeRange: AnalyticsTimeRange;
  /** When this data was computed */
  computedAt: number;

  /** Summary metrics */
  metrics: MetricSummary[];

  /** Call volume time series */
  callVolume: TimeSeriesPoint[];
  /** Average call duration time series */
  avgDuration: TimeSeriesPoint[];
  /** Sentiment trend time series */
  sentimentTrend: TimeSeriesPoint[];

  /** Top topics by frequency */
  topTopics: TopicFrequency[];
  /** Sentiment distribution */
  sentimentDistribution: SentimentDistribution;
  /** Direction distribution */
  directionDistribution: DirectionDistribution;
  /** Hourly call distribution */
  hourlyDistribution: HourlyDistribution[];

  /** Action items summary */
  actionItemSummary: ActionItemSummary;
  /** Top speakers by call count */
  topSpeakers: SpeakerAggregate[];
}
