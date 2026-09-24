/**
 * Tenant-admin call reporting. This displays persisted CDR aggregates; it is
 * not a statement about PBX health, real-time activity, or CDR completeness.
 */
import { useCallback, useMemo, useState } from "react";
import { AdminWorkspaceBoundary } from "@/components/admin/admin-workspace-boundary";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { router } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import {
  type PbxAnalyticsPeriod,
  usePbxCallAnalytics,
} from "@/hooks/use-pbx-admin";
import { useColors } from "@/hooks/use-colors";
import { normalizeCallAnalytics } from "@/lib/pbx/call-analytics";

const PERIODS: { value: PbxAnalyticsPeriod; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "7 days" },
  { value: "month", label: "30 days" },
];

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function formatHour(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function NumberRanking({
  title,
  entries,
  colors,
}: {
  title: string;
  entries: { number: string; calls: number; totalSeconds: number }[];
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[styles.ranking, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.cardTitle, { color: colors.foreground }]}>{title}</Text>
      {entries.length === 0 ? (
        <Text style={[styles.emptyText, { color: colors.muted }]}>No recorded calls in this period.</Text>
      ) : (
        entries.map((entry, index) => (
          <View
            key={`${entry.number}-${index}`}
            style={[styles.rankingRow, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}
            accessible
            accessibilityLabel={`${title}, ${entry.number}, ${entry.calls} calls, ${formatDuration(entry.totalSeconds)} total duration`}
          >
            <Text style={[styles.rank, { color: colors.muted }]}>{index + 1}</Text>
            <Text numberOfLines={1} style={[styles.number, { color: colors.foreground }]}>{entry.number}</Text>
            <View style={styles.rankingMetric}>
              <Text style={[styles.rankingValue, { color: colors.foreground }]}>{entry.calls}</Text>
              <Text style={[styles.rankingLabel, { color: colors.muted }]}>calls · {formatDuration(entry.totalSeconds)}</Text>
            </View>
          </View>
        ))
      )}
    </View>
  );
}

export default function CallAnalyticsScreen() {
  return (
    <AdminWorkspaceBoundary requiresImplicitTenant>
      <CallAnalyticsScreenContent />
    </AdminWorkspaceBoundary>
  );
}

function CallAnalyticsScreenContent() {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const [period, setPeriod] = useState<PbxAnalyticsPeriod>("today");
  const [refreshing, setRefreshing] = useState(false);
  const analyticsQuery = usePbxCallAnalytics(period);
  const analytics = useMemo(
    () => normalizeCallAnalytics(analyticsQuery.data),
    [analyticsQuery.data],
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await analyticsQuery.refetch();
    } finally {
      setRefreshing(false);
    }
  }, [analyticsQuery]);

  const summaryCards = [
    { label: "Total calls", value: analytics.summary.totalCalls, color: "#0057FF" },
    { label: "Answered", value: analytics.summary.answered, color: "#00A878" },
    { label: "Missed", value: analytics.summary.missed, color: "#E5484D" },
    { label: "Average duration", value: formatDuration(analytics.summary.averageDurationSeconds), color: "#F59E0B" },
  ];

  return (
    <ScreenContainer>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingHorizontal: wide ? 24 : 16 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity
            accessibilityLabel="Back to admin portal"
            accessibilityRole="button"
            onPress={() => router.back()}
            style={styles.backButton}
          >
            <IconSymbol name="chevron.left" size={22} color={colors.primary} />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text style={[styles.title, { color: colors.foreground }]}>Call analytics</Text>
            <Text style={[styles.subtitle, { color: colors.muted }]}>Recorded call data for the selected period</Text>
          </View>
        </View>

        <View accessibilityRole="tablist" style={styles.periods}>
          {PERIODS.map((option) => {
            const selected = option.value === period;
            return (
              <TouchableOpacity
                key={option.value}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={`${option.label} call analytics`}
                onPress={() => setPeriod(option.value)}
                style={[
                  styles.periodButton,
                  { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primary : colors.surface },
                ]}
              >
                <Text style={[styles.periodLabel, { color: selected ? "#FFFFFF" : colors.foreground }]}>{option.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {analyticsQuery.isLoading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.stateText, { color: colors.muted }]}>Loading call analytics…</Text>
          </View>
        ) : analyticsQuery.isError ? (
          <View style={[styles.stateCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text accessibilityRole="alert" style={[styles.stateText, { color: colors.muted }]}>Call analytics could not be loaded.</Text>
            <TouchableOpacity accessibilityRole="button" onPress={() => void analyticsQuery.refetch()} style={styles.retryButton}>
              <Text style={{ color: colors.primary }}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.summaryGrid}>
              {summaryCards.map((card) => (
                <View key={card.label} style={[styles.summaryCard, wide && styles.summaryCardWide, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Text style={[styles.summaryValue, { color: card.color }]}>{card.value}</Text>
                  <Text style={[styles.summaryLabel, { color: colors.muted }]}>{card.label}</Text>
                </View>
              ))}
            </View>

            {analytics.summary.totalCalls === 0 ? (
              <View style={[styles.stateCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.stateText, { color: colors.muted }]}>No recorded calls for this period.</Text>
              </View>
            ) : (
              <>
                <View style={[styles.distribution, { backgroundColor: colors.surface, borderColor: colors.border }]} accessible accessibilityLabel="Hourly call distribution">
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>Hourly distribution</Text>
                  <View style={[styles.hourHeader, { borderBottomColor: colors.border }]} accessible={false}>
                    <Text style={[styles.hourHeading, { color: colors.muted }]}>HOUR</Text>
                    <Text style={[styles.hourHeading, styles.callsColumn, { color: colors.muted }]}>CALLS</Text>
                    <Text style={[styles.hourHeading, styles.callsColumn, { color: colors.muted }]}>ANSWERED</Text>
                  </View>
                  {analytics.hourlyDistribution.length === 0 ? (
                    <Text style={[styles.emptyText, { color: colors.muted }]}>No hourly distribution is available for these records.</Text>
                  ) : (
                    analytics.hourlyDistribution.map((row) => (
                      <View
                        key={row.hour}
                        style={[styles.hourRow, { borderBottomColor: colors.border }]}
                        accessible
                        accessibilityLabel={`${formatHour(row.hour)}, ${row.calls} calls, ${row.answered} answered`}
                      >
                        <Text style={[styles.hourValue, { color: colors.foreground }]}>{formatHour(row.hour)}</Text>
                        <Text style={[styles.hourValue, styles.callsColumn, { color: colors.foreground }]}>{row.calls}</Text>
                        <Text style={[styles.hourValue, styles.callsColumn, { color: colors.foreground }]}>{row.answered}</Text>
                      </View>
                    ))
                  )}
                </View>

                <View style={[styles.rankings, wide && styles.rankingsWide]}>
                  <NumberRanking title="Top callers" entries={analytics.topCallers} colors={colors} />
                  <NumberRanking title="Top destinations" entries={analytics.topDestinations} colors={colors} />
                </View>
              </>
            )}
          </>
        )}

        <Text style={[styles.note, { color: colors.muted }]}>This report is based on available call detail records and may update after call processing.</Text>
        <View style={{ height: 32 }} />
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { width: "100%", maxWidth: 1200, alignSelf: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  backButton: { minHeight: 44, minWidth: 44, justifyContent: "center", alignItems: "center" },
  headerCopy: { flex: 1 },
  title: { fontSize: 22, fontWeight: "700" },
  subtitle: { fontSize: 13, marginTop: 2 },
  periods: { flexDirection: "row", gap: 8, paddingVertical: 16 },
  periodButton: { minHeight: 44, paddingHorizontal: 16, justifyContent: "center", borderWidth: 1, borderRadius: 10 },
  periodLabel: { fontSize: 14, fontWeight: "600" },
  loadingState: { minHeight: 180, alignItems: "center", justifyContent: "center", gap: 10 },
  stateCard: { padding: 20, borderRadius: 12, borderWidth: 1, alignItems: "center", gap: 8 },
  stateText: { fontSize: 14, textAlign: "center" },
  retryButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12 },
  summaryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  summaryCard: { width: "48%", flexGrow: 1, padding: 16, borderRadius: 12, borderWidth: 1 },
  summaryCardWide: { width: "23%", flexBasis: "23%" },
  summaryValue: { fontSize: 24, fontWeight: "700" },
  summaryLabel: { fontSize: 13, marginTop: 5 },
  distribution: { padding: 16, borderRadius: 12, borderWidth: 1 },
  cardTitle: { fontSize: 16, fontWeight: "700", marginBottom: 12 },
  hourHeader: { flexDirection: "row", paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  hourHeading: { flex: 1, fontSize: 11, fontWeight: "700", letterSpacing: 0.4 },
  hourRow: { flexDirection: "row", minHeight: 44, alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth },
  hourValue: { flex: 1, fontSize: 14 },
  callsColumn: { textAlign: "right" },
  rankings: { gap: 12, marginTop: 16 },
  rankingsWide: { flexDirection: "row" },
  ranking: { flex: 1, padding: 16, borderRadius: 12, borderWidth: 1 },
  rankingRow: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 10 },
  rank: { width: 18, fontSize: 13, fontWeight: "600" },
  number: { flex: 1, fontSize: 14 },
  rankingMetric: { alignItems: "flex-end" },
  rankingValue: { fontSize: 15, fontWeight: "700" },
  rankingLabel: { fontSize: 11, marginTop: 2 },
  emptyText: { fontSize: 13, paddingVertical: 8 },
  note: { fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 16, paddingHorizontal: 8 },
});
