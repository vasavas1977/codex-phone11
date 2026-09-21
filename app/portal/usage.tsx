import { useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";
import { PortalShell, PortalState } from "@/components/portal/portal-shell";
import { SIGN_IN_ROUTE } from "@/constants/oauth";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/use-colors";
import { useOwnCallUsage } from "@/hooks/use-pbx-admin";

type Period = "week" | "month";
type Call = {
  id: number;
  direction?: string | null;
  disposition?: string | null;
  caller_number?: string | null;
  callee_number?: string | null;
  total_duration_seconds?: number | null;
  started_at?: string | null;
};
type Usage = {
  totalCalls: number;
  answeredCalls: number;
  missedCalls: number;
  totalDurationSeconds: number;
  calls: Call[];
};

const formatDuration = (seconds: number) =>
  `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.max(0, seconds) % 60).padStart(2, "0")}`;

export default function UsageScreen() {
  const colors = useColors();
  const { user } = useAuth({ autoFetch: false });
  const [period, setPeriod] = useState<Period>("month");
  const usageQuery = useOwnCallUsage(period, Boolean(user));
  const usage = usageQuery.data as Usage | undefined;

  return (
    <PortalShell title="Call activity" active="activity">
      {!user ? (
        <PortalState
          title="Sign in to view call activity"
          detail="Your call activity is available after you sign in."
          actionLabel="Sign in"
          onAction={() => router.replace(SIGN_IN_ROUTE)}
        />
      ) : (
        <>
          <View
            accessibilityRole="tablist"
            style={[
              styles.periods,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            {(["week", "month"] as const).map((option) => (
              <TouchableOpacity
                key={option}
                accessibilityRole="tab"
                accessibilityState={{ selected: period === option }}
                onPress={() => setPeriod(option)}
                style={[
                  styles.period,
                  period === option && { backgroundColor: colors.primary },
                ]}
              >
                <Text
                  style={{
                    color: period === option ? "#fff" : colors.muted,
                    fontWeight: "700",
                  }}
                >
                  {option === "week" ? "Last 7 days" : "Last 30 days"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {usageQuery.isLoading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.primary} />
              <Text style={{ color: colors.muted }}>
                Loading call activity…
              </Text>
            </View>
          ) : usageQuery.isError || !usage ? (
            <PortalState
              title="Call activity could not be loaded"
              detail="Phone11 could not read call records for your assigned extensions."
              actionLabel="Try again"
              onAction={() => void usageQuery.refetch()}
            />
          ) : (
            <>
              <View style={styles.cards}>
                <Metric
                  label="Calls"
                  value={usage.totalCalls}
                  color={colors.foreground}
                />
                <Metric
                  label="Answered"
                  value={usage.answeredCalls}
                  color={colors.success}
                />
                <Metric
                  label="Missed"
                  value={usage.missedCalls}
                  color={colors.error}
                />
                <Metric
                  label="Call time"
                  value={formatDuration(usage.totalDurationSeconds)}
                  color={colors.primary}
                />
              </View>
              <Text style={[styles.section, { color: colors.muted }]}>
                RECENT CALLS
              </Text>
              {usage.calls.length === 0 ? (
                <PortalState
                  title="No recorded calls"
                  detail={`No calls were recorded for your assigned extensions in the last ${period === "week" ? "7" : "30"} days.`}
                />
              ) : (
                usage.calls.map((call) => (
                  <View
                    key={call.id}
                    style={[
                      styles.call,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.callIcon,
                        {
                          backgroundColor:
                            (call.disposition === "missed"
                              ? colors.error
                              : colors.primary) + "15",
                        },
                      ]}
                    >
                      <IconSymbol
                        name={
                          call.direction === "inbound"
                            ? ("phone.arrow.down.left.fill" as any)
                            : ("phone.arrow.up.right.fill" as any)
                        }
                        size={16}
                        color={
                          call.disposition === "missed"
                            ? colors.error
                            : colors.primary
                        }
                      />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text
                        style={[styles.caller, { color: colors.foreground }]}
                      >
                        {call.caller_number || "Caller ID unavailable"} →{" "}
                        {call.callee_number || "number unavailable"}
                      </Text>
                      <Text style={[styles.meta, { color: colors.muted }]}>
                        {call.direction || "call"} ·{" "}
                        {call.disposition || "status unavailable"} ·{" "}
                        {formatDuration(
                          Number(call.total_duration_seconds) || 0,
                        )}
                      </Text>
                    </View>
                    <Text style={[styles.time, { color: colors.muted }]}>
                      {call.started_at
                        ? new Date(call.started_at).toLocaleDateString()
                        : ""}
                    </Text>
                  </View>
                ))
              )}
              <Text style={[styles.note, { color: colors.muted }]}>
                This view is based on available call detail records and may
                update after call processing.
              </Text>
            </>
          )}
        </>
      )}
    </PortalShell>
  );
}

function Metric({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color: string;
}) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.metric,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <Text style={[styles.metricValue, { color }]}>{value}</Text>
      <Text style={[styles.metricLabel, { color: colors.muted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  periods: {
    flexDirection: "row",
    padding: 3,
    borderWidth: 1,
    borderRadius: 12,
    gap: 3,
  },
  period: {
    flex: 1,
    minHeight: 44,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  loading: {
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  cards: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metric: {
    flexGrow: 1,
    flexBasis: "45%",
    borderWidth: 1,
    borderRadius: 14,
    padding: 15,
  },
  metricValue: { fontSize: 25, fontWeight: "800" },
  metricLabel: { marginTop: 3, fontSize: 12, fontWeight: "600" },
  section: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
    marginTop: 14,
  },
  call: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderWidth: 1,
    borderRadius: 14,
  },
  callIcon: {
    width: 34,
    height: 34,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  caller: { fontSize: 13, fontWeight: "700" },
  meta: { fontSize: 11 },
  time: { fontSize: 11 },
  note: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    marginTop: 8,
    paddingHorizontal: 8,
  },
});
