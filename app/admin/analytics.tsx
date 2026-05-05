/**
 * Call Analytics Dashboard — AI-Powered Insights
 *
 * Aggregated call analytics with sentiment trends, topic frequency,
 * call volume charts, speaker stats, action item summaries, and
 * hourly/direction distributions. Replaces the old CDR-only dashboard.
 */

import { useEffect, useState } from "react";
import {
  ScrollView,
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { router } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useAnalyticsStore } from "@/lib/analytics/store";
import type { AnalyticsTimeRange } from "@/lib/analytics/types";

const TIME_RANGES: { key: AnalyticsTimeRange; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 Days" },
  { key: "30d", label: "30 Days" },
  { key: "90d", label: "90 Days" },
  { key: "all", label: "All" },
];

const SENTIMENT_COLORS = {
  positive: "#22C55E",
  neutral: "#6B7280",
  negative: "#EF4444",
  mixed: "#F59E0B",
};

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function AnalyticsDashboard() {
  const colors = useColors();
  const { dashboard, timeRange, isLoading, setTimeRange, fetchDashboard, refresh } =
    useAnalyticsStore();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchDashboard();
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  return (
    <ScreenContainer>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
        }
      >
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <IconSymbol name="chevron.left" size={22} color={colors.primary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.foreground }]}>Call Analytics</Text>
            <Text style={[styles.subtitle, { color: colors.muted }]}>
              AI-Powered Insights · Recording Analysis
            </Text>
          </View>
          <TouchableOpacity onPress={handleRefresh} style={styles.refreshBtn}>
            <IconSymbol name="arrow.clockwise" size={18} color={colors.primary} />
          </TouchableOpacity>
        </View>

        {/* Time Range Selector */}
        <View style={styles.timeSelector}>
          {TIME_RANGES.map((t) => (
            <TouchableOpacity
              key={t.key}
              style={[styles.timeChip, timeRange === t.key && { backgroundColor: colors.primary }]}
              onPress={() => setTimeRange(t.key)}
            >
              <Text style={[styles.timeText, { color: timeRange === t.key ? "#fff" : colors.muted }]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Loading State */}
        {isLoading && !dashboard && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.muted }]}>Computing analytics...</Text>
          </View>
        )}

        {dashboard && (
          <>
            {/* ═══════════════════════════════════════ */}
            {/* METRICS GRID                           */}
            {/* ═══════════════════════════════════════ */}
            <View style={styles.metricsGrid}>
              {dashboard.metrics.map((m, i) => {
                const changeColor = (m.change > 0 && m.increaseIsGood) || (m.change < 0 && !m.increaseIsGood)
                  ? "#22C55E"
                  : m.change === 0
                  ? colors.muted
                  : "#EF4444";
                const changeText = m.change > 0 ? `+${Math.round(m.change * 100)}%` : `${Math.round(m.change * 100)}%`;
                return (
                  <View key={i} style={[styles.metricCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <View style={[styles.metricDot, { backgroundColor: m.color }]} />
                    <Text style={[styles.metricValue, { color: colors.foreground }]}>{m.displayValue}</Text>
                    <Text style={[styles.metricLabel, { color: colors.muted }]}>{m.label}</Text>
                    <Text style={[styles.metricChange, { color: changeColor }]}>{changeText}</Text>
                  </View>
                );
              })}
            </View>

            {/* ═══════════════════════════════════════ */}
            {/* CALL VOLUME CHART                      */}
            {/* ═══════════════════════════════════════ */}
            <Text style={[styles.sectionTitle, { color: colors.muted }]}>CALL VOLUME</Text>
            <View style={[styles.chartContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {(() => {
                const maxVal = Math.max(...dashboard.callVolume.map((p) => p.value), 1);
                return dashboard.callVolume.map((p, i) => (
                  <View key={i} style={styles.chartRow}>
                    <Text style={[styles.chartLabel, { color: colors.muted }]}>{p.label}</Text>
                    <View style={styles.chartBarBg}>
                      <View
                        style={[
                          styles.chartBar,
                          {
                            width: `${(p.value / maxVal) * 100}%`,
                            backgroundColor: colors.primary,
                          },
                        ]}
                      />
                    </View>
                    <Text style={[styles.chartValue, { color: colors.foreground }]}>{p.value}</Text>
                  </View>
                ));
              })()}
            </View>

            {/* ═══════════════════════════════════════ */}
            {/* SENTIMENT TREND                        */}
            {/* ═══════════════════════════════════════ */}
            <Text style={[styles.sectionTitle, { color: colors.muted }]}>SENTIMENT TREND</Text>
            <View style={[styles.chartContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {dashboard.sentimentTrend.map((p, i) => {
                const barWidth = Math.abs(p.value) * 100;
                const isPositive = p.value >= 0;
                return (
                  <View key={i} style={styles.chartRow}>
                    <Text style={[styles.chartLabel, { color: colors.muted }]}>{p.label}</Text>
                    <View style={styles.chartBarBg}>
                      <View
                        style={[
                          styles.chartBar,
                          {
                            width: `${Math.min(barWidth, 100)}%`,
                            backgroundColor: isPositive ? "#22C55E" : "#EF4444",
                          },
                        ]}
                      />
                    </View>
                    <Text style={[styles.chartValue, { color: isPositive ? "#22C55E" : "#EF4444" }]}>
                      {p.value > 0 ? "+" : ""}{p.value.toFixed(2)}
                    </Text>
                  </View>
                );
              })}
            </View>

            {/* ═══════════════════════════════════════ */}
            {/* SENTIMENT DISTRIBUTION                 */}
            {/* ═══════════════════════════════════════ */}
            <Text style={[styles.sectionTitle, { color: colors.muted }]}>SENTIMENT DISTRIBUTION</Text>
            <View style={[styles.distContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {/* Stacked bar */}
              <View style={styles.stackedBar}>
                {(["positive", "neutral", "negative", "mixed"] as const).map((key) => {
                  const val = dashboard.sentimentDistribution[key];
                  return (
                    <View
                      key={key}
                      style={[
                        styles.stackedSegment,
                        {
                          width: `${val}%`,
                          backgroundColor: SENTIMENT_COLORS[key],
                        },
                      ]}
                    />
                  );
                })}
              </View>
              <View style={styles.distLegend}>
                {(["positive", "neutral", "negative", "mixed"] as const).map((key) => (
                  <View key={key} style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: SENTIMENT_COLORS[key] }]} />
                    <Text style={[styles.legendText, { color: colors.foreground }]}>
                      {key.charAt(0).toUpperCase() + key.slice(1)}
                    </Text>
                    <Text style={[styles.legendPct, { color: colors.muted }]}>
                      {dashboard.sentimentDistribution[key]}%
                    </Text>
                  </View>
                ))}
              </View>
            </View>

            {/* ═══════════════════════════════════════ */}
            {/* TOP TOPICS                             */}
            {/* ═══════════════════════════════════════ */}
            <Text style={[styles.sectionTitle, { color: colors.muted }]}>TOP TOPICS</Text>
            <View style={[styles.topicsContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {dashboard.topTopics.map((topic, i) => (
                <View
                  key={i}
                  style={[
                    styles.topicRow,
                    i < dashboard.topTopics.length - 1 && { borderBottomWidth: 0.5, borderBottomColor: colors.border },
                  ]}
                >
                  <View style={styles.topicInfo}>
                    <Text style={[styles.topicRank, { color: colors.muted }]}>#{i + 1}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.topicName, { color: colors.foreground }]}>{topic.topic}</Text>
                      <View style={styles.topicMeta}>
                        <Text style={[styles.topicCount, { color: colors.muted }]}>{topic.count} calls</Text>
                        <View style={[styles.topicSentimentDot, {
                          backgroundColor: topic.avgSentiment > 0.1 ? "#22C55E" : topic.avgSentiment < -0.1 ? "#EF4444" : "#6B7280",
                        }]} />
                        <Text style={[styles.topicSentiment, {
                          color: topic.avgSentiment > 0.1 ? "#22C55E" : topic.avgSentiment < -0.1 ? "#EF4444" : "#6B7280",
                        }]}>
                          {topic.avgSentiment > 0 ? "+" : ""}{topic.avgSentiment.toFixed(1)}
                        </Text>
                      </View>
                    </View>
                  </View>
                  <View style={styles.topicBarContainer}>
                    <View style={[styles.topicBarBg, { backgroundColor: colors.border }]}>
                      <View style={[styles.topicBarFill, { width: `${topic.percentage}%`, backgroundColor: colors.primary }]} />
                    </View>
                    <Text style={[styles.topicPct, { color: colors.muted }]}>{topic.percentage}%</Text>
                  </View>
                </View>
              ))}
            </View>

            {/* ═══════════════════════════════════════ */}
            {/* ACTION ITEMS SUMMARY                   */}
            {/* ═══════════════════════════════════════ */}
            <Text style={[styles.sectionTitle, { color: colors.muted }]}>ACTION ITEMS</Text>
            <View style={[styles.actionSummary, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.actionRow}>
                <View style={styles.actionStat}>
                  <Text style={[styles.actionStatValue, { color: colors.foreground }]}>
                    {dashboard.actionItemSummary.total}
                  </Text>
                  <Text style={[styles.actionStatLabel, { color: colors.muted }]}>Total</Text>
                </View>
                <View style={styles.actionStat}>
                  <Text style={[styles.actionStatValue, { color: "#22C55E" }]}>
                    {dashboard.actionItemSummary.completed}
                  </Text>
                  <Text style={[styles.actionStatLabel, { color: colors.muted }]}>Done</Text>
                </View>
                <View style={styles.actionStat}>
                  <Text style={[styles.actionStatValue, { color: "#F59E0B" }]}>
                    {dashboard.actionItemSummary.pending}
                  </Text>
                  <Text style={[styles.actionStatLabel, { color: colors.muted }]}>Pending</Text>
                </View>
              </View>
              {/* Completion bar */}
              <View style={styles.completionBar}>
                <View style={[styles.completionBarBg, { backgroundColor: colors.border }]}>
                  <View
                    style={[
                      styles.completionBarFill,
                      {
                        width: `${dashboard.actionItemSummary.total > 0
                          ? Math.round((dashboard.actionItemSummary.completed / dashboard.actionItemSummary.total) * 100)
                          : 0}%`,
                        backgroundColor: "#22C55E",
                      },
                    ]}
                  />
                </View>
                <Text style={[styles.completionPct, { color: colors.muted }]}>
                  {dashboard.actionItemSummary.total > 0
                    ? Math.round((dashboard.actionItemSummary.completed / dashboard.actionItemSummary.total) * 100)
                    : 0}% complete
                </Text>
              </View>
              {/* Urgency breakdown */}
              <View style={styles.urgencyRow}>
                <View style={[styles.urgencyChip, { backgroundColor: "#EF444415" }]}>
                  <Text style={[styles.urgencyChipText, { color: "#EF4444" }]}>
                    {dashboard.actionItemSummary.highUrgency} High
                  </Text>
                </View>
                <View style={[styles.urgencyChip, { backgroundColor: "#F59E0B15" }]}>
                  <Text style={[styles.urgencyChipText, { color: "#F59E0B" }]}>
                    {dashboard.actionItemSummary.mediumUrgency} Med
                  </Text>
                </View>
                <View style={[styles.urgencyChip, { backgroundColor: "#22C55E15" }]}>
                  <Text style={[styles.urgencyChipText, { color: "#22C55E" }]}>
                    {dashboard.actionItemSummary.lowUrgency} Low
                  </Text>
                </View>
              </View>
            </View>

            {/* ═══════════════════════════════════════ */}
            {/* TOP SPEAKERS                           */}
            {/* ═══════════════════════════════════════ */}
            <Text style={[styles.sectionTitle, { color: colors.muted }]}>TOP SPEAKERS</Text>
            <View style={[styles.speakersContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {dashboard.topSpeakers.map((sp, i) => (
                <View
                  key={i}
                  style={[
                    styles.speakerRow,
                    i < dashboard.topSpeakers.length - 1 && { borderBottomWidth: 0.5, borderBottomColor: colors.border },
                  ]}
                >
                  <View style={[styles.speakerAvatar, { backgroundColor: colors.primary + "20" }]}>
                    <Text style={[styles.speakerAvatarText, { color: colors.primary }]}>
                      {sp.name.charAt(0)}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.speakerName, { color: colors.foreground }]}>{sp.name}</Text>
                    <View style={styles.speakerMeta}>
                      <Text style={[styles.speakerMetaText, { color: colors.muted }]}>
                        {sp.totalCalls} calls
                      </Text>
                      <Text style={[styles.speakerMetaText, { color: colors.muted }]}>
                        {formatDuration(sp.totalDuration)}
                      </Text>
                      <Text style={[styles.speakerMetaText, {
                        color: sp.avgSentiment > 0.1 ? "#22C55E" : sp.avgSentiment < -0.1 ? "#EF4444" : colors.muted,
                      }]}>
                        {sp.avgSentiment > 0 ? "+" : ""}{sp.avgSentiment.toFixed(2)}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.speakerTalkPct}>
                    <Text style={[styles.speakerTalkPctValue, { color: colors.foreground }]}>
                      {sp.avgTalkPercentage}%
                    </Text>
                    <Text style={[styles.speakerTalkPctLabel, { color: colors.muted }]}>talk</Text>
                  </View>
                </View>
              ))}
            </View>

            {/* ═══════════════════════════════════════ */}
            {/* DIRECTION DISTRIBUTION                 */}
            {/* ═══════════════════════════════════════ */}
            <Text style={[styles.sectionTitle, { color: colors.muted }]}>CALL DIRECTION</Text>
            <View style={[styles.distContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.stackedBar}>
                <View style={[styles.stackedSegment, { width: `${dashboard.directionDistribution.inbound}%`, backgroundColor: "#0A7EA4" }]} />
                <View style={[styles.stackedSegment, { width: `${dashboard.directionDistribution.outbound}%`, backgroundColor: "#8B5CF6" }]} />
                <View style={[styles.stackedSegment, { width: `${dashboard.directionDistribution.conference}%`, backgroundColor: "#F59E0B" }]} />
              </View>
              <View style={styles.distLegend}>
                {[
                  { label: "Inbound", value: dashboard.directionDistribution.inbound, color: "#0A7EA4" },
                  { label: "Outbound", value: dashboard.directionDistribution.outbound, color: "#8B5CF6" },
                  { label: "Conference", value: dashboard.directionDistribution.conference, color: "#F59E0B" },
                ].map((d, i) => (
                  <View key={i} style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: d.color }]} />
                    <Text style={[styles.legendText, { color: colors.foreground }]}>{d.label}</Text>
                    <Text style={[styles.legendPct, { color: colors.muted }]}>{d.value}%</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* ═══════════════════════════════════════ */}
            {/* HOURLY DISTRIBUTION                    */}
            {/* ═══════════════════════════════════════ */}
            <Text style={[styles.sectionTitle, { color: colors.muted }]}>HOURLY DISTRIBUTION</Text>
            <View style={[styles.chartContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {(() => {
                const maxH = Math.max(...dashboard.hourlyDistribution.map((h) => h.count), 1);
                // Show only business-relevant hours (6AM-10PM)
                const filtered = dashboard.hourlyDistribution.filter((h) => h.hour >= 6 && h.hour <= 22);
                return filtered.map((h, i) => {
                  const isPeak = h.count >= maxH * 0.7;
                  return (
                    <View key={i} style={styles.chartRow}>
                      <Text style={[styles.chartLabel, { color: colors.muted }]}>
                        {h.hour.toString().padStart(2, "0")}:00
                      </Text>
                      <View style={styles.chartBarBg}>
                        <View
                          style={[
                            styles.chartBar,
                            {
                              width: `${(h.count / maxH) * 100}%`,
                              backgroundColor: isPeak ? colors.primary : colors.primary + "50",
                            },
                          ]}
                        />
                      </View>
                      <Text style={[styles.chartValue, { color: isPeak ? colors.foreground : colors.muted }]}>
                        {h.count}
                      </Text>
                    </View>
                  );
                });
              })()}
            </View>
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    gap: 12,
  },
  backBtn: { padding: 4 },
  title: { fontSize: 20, fontWeight: "700" },
  subtitle: { fontSize: 12, marginTop: 2 },
  refreshBtn: { padding: 8 },
  timeSelector: { flexDirection: "row", paddingHorizontal: 16, marginTop: 12, gap: 6 },
  timeChip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: "rgba(128,128,128,0.1)",
  },
  timeText: { fontSize: 12, fontWeight: "600" },
  loadingContainer: { alignItems: "center", justifyContent: "center", paddingVertical: 60, gap: 12 },
  loadingText: { fontSize: 14 },

  // Metrics Grid
  metricsGrid: { flexDirection: "row", flexWrap: "wrap", padding: 12, gap: 8 },
  metricCard: {
    width: "48%",
    flexGrow: 1,
    flexBasis: "46%",
    borderRadius: 14,
    padding: 14,
    borderWidth: 0.5,
  },
  metricDot: { width: 6, height: 6, borderRadius: 3, marginBottom: 8 },
  metricValue: { fontSize: 22, fontWeight: "700" },
  metricLabel: { fontSize: 12, fontWeight: "600", marginTop: 2 },
  metricChange: { fontSize: 12, fontWeight: "600", marginTop: 4 },

  // Section Title
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.5,
    paddingHorizontal: 20,
    marginTop: 20,
    marginBottom: 8,
  },

  // Chart Container (bar charts)
  chartContainer: { marginHorizontal: 16, borderRadius: 14, borderWidth: 0.5, padding: 12 },
  chartRow: { flexDirection: "row", alignItems: "center", marginVertical: 3, gap: 8 },
  chartLabel: { width: 40, fontSize: 10, textAlign: "right" },
  chartBarBg: {
    flex: 1,
    height: 14,
    borderRadius: 4,
    backgroundColor: "rgba(128,128,128,0.1)",
  },
  chartBar: { height: 14, borderRadius: 4 },
  chartValue: { width: 40, fontSize: 11, fontWeight: "600", textAlign: "right" },

  // Distribution (stacked bar + legend)
  distContainer: { marginHorizontal: 16, borderRadius: 14, borderWidth: 0.5, padding: 14, gap: 12 },
  stackedBar: {
    flexDirection: "row",
    height: 16,
    borderRadius: 8,
    overflow: "hidden",
  },
  stackedSegment: { height: 16 },
  distLegend: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 12 },
  legendPct: { fontSize: 12, fontWeight: "600" },

  // Topics
  topicsContainer: { marginHorizontal: 16, borderRadius: 14, borderWidth: 0.5, overflow: "hidden" },
  topicRow: { padding: 14, gap: 8 },
  topicInfo: { flexDirection: "row", alignItems: "center", gap: 10 },
  topicRank: { fontSize: 12, fontWeight: "700", width: 24 },
  topicName: { fontSize: 14, fontWeight: "600" },
  topicMeta: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
  topicCount: { fontSize: 12 },
  topicSentimentDot: { width: 6, height: 6, borderRadius: 3 },
  topicSentiment: { fontSize: 12, fontWeight: "600" },
  topicBarContainer: { flexDirection: "row", alignItems: "center", gap: 8 },
  topicBarBg: { flex: 1, height: 6, borderRadius: 3, overflow: "hidden" },
  topicBarFill: { height: 6, borderRadius: 3 },
  topicPct: { fontSize: 12, fontWeight: "600", width: 32, textAlign: "right" },

  // Action Items Summary
  actionSummary: { marginHorizontal: 16, borderRadius: 14, borderWidth: 0.5, padding: 16, gap: 12 },
  actionRow: { flexDirection: "row", justifyContent: "space-around" },
  actionStat: { alignItems: "center", gap: 2 },
  actionStatValue: { fontSize: 24, fontWeight: "700" },
  actionStatLabel: { fontSize: 12 },
  completionBar: { gap: 4 },
  completionBarBg: { height: 8, borderRadius: 4, overflow: "hidden" },
  completionBarFill: { height: 8, borderRadius: 4 },
  completionPct: { fontSize: 11, textAlign: "center" },
  urgencyRow: { flexDirection: "row", justifyContent: "center", gap: 8 },
  urgencyChip: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  urgencyChipText: { fontSize: 12, fontWeight: "600" },

  // Speakers
  speakersContainer: { marginHorizontal: 16, borderRadius: 14, borderWidth: 0.5, overflow: "hidden" },
  speakerRow: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  speakerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  speakerAvatarText: { fontSize: 16, fontWeight: "700" },
  speakerName: { fontSize: 14, fontWeight: "600" },
  speakerMeta: { flexDirection: "row", gap: 10, marginTop: 2 },
  speakerMetaText: { fontSize: 12 },
  speakerTalkPct: { alignItems: "center" },
  speakerTalkPctValue: { fontSize: 16, fontWeight: "700" },
  speakerTalkPctLabel: { fontSize: 10 },
});
