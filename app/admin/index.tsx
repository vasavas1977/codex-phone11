/**
 * Admin Dashboard — Phone11 Cloud PBX Portal
 *
 * Live overview using real PBX API data:
 *  - Extension and call metrics
 *  - Quick links to source-backed management sections
 *  - Recent call activity
 */

import { useState, useCallback } from "react";
import {
  ScrollView,
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { router } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { portalSignInRoute } from "@/constants/oauth";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/use-colors";
import {
  type PbxManagementCapabilities,
  usePbxAdminCapabilities,
  usePbxDashboardStats,
  usePbxRecentCalls,
  usePbxAdminWorkspace,
  useTenant,
} from "@/hooks/use-pbx-admin";

interface QuickAction {
  icon: string;
  iconColor: string;
  label: string;
  route: string;
  facility?: keyof PbxManagementCapabilities;
  requiresImplicitTenant?: boolean;
}

export default function AdminDashboard() {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const [refreshing, setRefreshing] = useState(false);

  const { user } = useAuth({ autoFetch: false });
  const workspace = usePbxAdminWorkspace();
  const tenantQuery = useTenant(Boolean(user));
  const canManage = ["owner", "admin"].includes(
    String(tenantQuery.data?.userRole || ""),
  );
  const capabilitiesQuery = usePbxAdminCapabilities(
    tenantQuery.isSuccess && canManage,
  );
  // Admin-only queries wait until the signed-in workspace role is known.
  const statsQuery = usePbxDashboardStats(
    tenantQuery.isSuccess && canManage && workspace.canUseImplicitTenant,
  );
  const recentCallsQuery = usePbxRecentCalls(
    5,
    tenantQuery.isSuccess && canManage && workspace.canUseImplicitTenant,
  );

  const stats = statsQuery.data;
  const tenant = tenantQuery.data;

  const quickActions: QuickAction[] = [
    {
      icon: "person.2.fill",
      iconColor: "#0057FF",
      label: "People",
      route: "/admin/users",
    },
    {
      icon: "video.fill",
      iconColor: "#2563EB",
      label: "Meetings",
      route: "/admin/meetings",
    },
    {
      icon: "phone.fill",
      iconColor: "#0369A1",
      label: "Extensions",
      route: "/admin/extensions",
    },
    {
      icon: "voicemail",
      iconColor: "#0D9488",
      label: "Voicemail",
      route: "/admin/voicemail",
    },
    {
      icon: "number",
      iconColor: "#8B5CF6",
      label: "Phone numbers",
      route: "/admin/dids",
      facility: "phoneNumbers",
    },
    {
      icon: "rectangle.grid.3x2.fill",
      iconColor: "#FF9500",
      label: "IVR menus",
      route: "/admin/ivr",
      facility: "ivr",
      requiresImplicitTenant: true,
    },
    {
      icon: "person.3.fill",
      iconColor: "#10B981",
      label: "Ring Groups",
      route: "/admin/ring-groups",
      facility: "ringGroups",
      requiresImplicitTenant: true,
    },
    {
      icon: "person.line.dotted.person.fill",
      iconColor: "#F59E0B",
      label: "Queues",
      route: "/admin/queues",
      facility: "queues",
      requiresImplicitTenant: true,
    },
    {
      icon: "calendar.badge.clock",
      iconColor: "#F97316",
      label: "Business Hours",
      route: "/admin/schedules",
      facility: "businessHours",
      requiresImplicitTenant: true,
    },
    {
      icon: "gearshape.fill",
      iconColor: "#6366F1",
      label: "Workspace settings",
      route: "/admin/workspace-settings",
    },
    {
      icon: "person.fill",
      iconColor: "#64748B",
      label: "Workspace status",
      route: "/admin/profile-status",
    },
    {
      icon: "chart.bar.fill",
      iconColor: "#14B8A6",
      label: "Call analytics",
      route: "/admin/analytics",
      requiresImplicitTenant: true,
    },
  ];

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      workspace.membershipsQuery.refetch(),
      tenantQuery.refetch(),
      capabilitiesQuery.refetch(),
      ...(workspace.canUseImplicitTenant
        ? [
            statsQuery.refetch(),
            recentCallsQuery.refetch(),
          ]
        : []),
    ]);
    setRefreshing(false);
  }, [capabilitiesQuery, statsQuery, recentCallsQuery, tenantQuery, workspace]);

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const formatTime = (dateStr: string) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return d.toLocaleDateString();
  };

  const dispositionColor = (d: string) => {
    switch (d) {
      case "answered":
        return "#00C896";
      case "missed":
        return "#FF3B30";
      case "busy":
        return "#FF9500";
      default:
        return "#9BA1A6";
    }
  };

  if (!user) {
    return (
      <AdminAccessState
        title="Sign in to use workspace administration"
        detail="Workspace administration is available after you sign in with an owner or administrator account."
        actionLabel="Sign in"
        onAction={() => router.replace(portalSignInRoute("/admin"))}
      />
    );
  }

  if (workspace.membershipsQuery.isLoading) {
    return (
      <AdminAccessState
        title="Checking workspace access"
        detail="Phone11 is confirming your workspace membership."
        loading
      />
    );
  }

  if (workspace.membershipsQuery.isError) {
    return (
      <AdminAccessState
        title="Workspace administration is unavailable"
        detail="Phone11 could not confirm your workspace membership."
        actionLabel="Try again"
        onAction={() => void workspace.membershipsQuery.refetch()}
      />
    );
  }

  if (workspace.manageableMemberships.length === 0) {
    return (
      <AdminAccessState
        title="Workspace administration"
        detail="Only workspace owners and administrators can open this area."
      />
    );
  }

  if (workspace.selectedTenantId === null) {
    return (
      <ScreenContainer>
        <View style={styles.workspaceChoicePage}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            Choose a workspace
          </Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>
            Select the workspace you want to manage.
          </Text>
          <AdminWorkspacePicker workspace={workspace} colors={colors} />
        </View>
      </ScreenContainer>
    );
  }

  if (tenantQuery.isLoading) {
    return (
      <AdminAccessState
        title="Checking workspace access"
        detail="Phone11 is confirming whether this account can manage the workspace."
        loading
      />
    );
  }

  if (tenantQuery.isError || !tenantQuery.data) {
    return (
      <AdminAccessState
        title="Workspace administration is unavailable"
        detail="Phone11 could not confirm your workspace access."
        actionLabel="Try again"
        onAction={() => void tenantQuery.refetch()}
      />
    );
  }

  if (!canManage) {
    return (
      <AdminAccessState
        title="Workspace administration"
        detail="Only workspace owners and administrators can open this area."
        actionLabel="Back to settings"
        onAction={() =>
          router.canGoBack()
            ? router.back()
            : router.replace("/(tabs)/settings")
        }
      />
    );
  }

  return (
    <ScreenContainer>
      <ScrollView
        contentContainerStyle={{
          width: "100%",
          maxWidth: 1200,
          alignSelf: "center",
          paddingHorizontal: wide ? 24 : 0,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Back to settings"
          >
            <IconSymbol name="chevron.left" size={22} color={colors.primary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.foreground }]}>
              Admin Portal
            </Text>
            <Text style={[styles.subtitle, { color: colors.muted }]}>
              {tenant?.name || "Phone11"} — Cloud PBX Dashboard
            </Text>
          </View>
        </View>

        {workspace.manageableMemberships.length > 1 ? (
          <AdminWorkspacePicker workspace={workspace} colors={colors} />
        ) : null}

        {workspace.hasMultipleMemberships ? (
          <Text style={[styles.workspaceNotice, { color: colors.muted }]}>
            People, Extensions, Phone numbers, and Workspace settings use your
            selected workspace. Phone-number route editing and other PBX
            sections remain unavailable until every related server control can
            target that workspace safely.
          </Text>
        ) : null}

        {/* Stats Grid */}
        {workspace.hasMultipleMemberships ? (
          <View style={styles.emptyState}>
            <Text style={{ color: colors.muted }}>
              Call and extension totals are unavailable for accounts with
              multiple workspaces.
            </Text>
          </View>
        ) : statsQuery.isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.muted }]}>
              Loading stats...
            </Text>
          </View>
        ) : statsQuery.isError || !stats ? (
          <View style={styles.emptyState}>
            <Text accessibilityRole="alert" style={{ color: colors.muted }}>
              Overview could not be loaded.
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => void statsQuery.refetch()}
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <Text style={{ color: colors.primary }}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.statsGrid}>
            {[
              {
                label: "Extensions",
                value: String(stats?.totalExtensions || 0),
                icon: "phone.fill",
                iconColor: "#0057FF",
                sub: `${stats?.activeExtensions || 0} active`,
              },
              {
                label: "Phone Numbers",
                value:
                  capabilitiesQuery.data?.phoneNumbers === true &&
                  stats?.phoneNumbersAvailable === true
                    ? String(stats.phoneNumbers || 0)
                    : "—",
                icon: "number",
                iconColor: "#8B5CF6",
                sub:
                  capabilitiesQuery.data?.phoneNumbers === true &&
                  stats?.phoneNumbersAvailable === true
                    ? "DID numbers"
                    : capabilitiesQuery.isLoading
                      ? "Checking availability"
                      : "Not available",
              },
              {
                label: "Calls Today",
                value: String(stats?.callsToday || 0),
                icon: "phone.arrow.up.right.fill",
                iconColor: "#00C896",
                sub: `${stats?.missedCallsToday || 0} missed`,
              },
              {
                label: "Avg Duration",
                value: formatDuration(stats?.avgCallDuration || 0),
                icon: "clock.fill",
                iconColor: "#FF9500",
                sub: "today",
              },
            ].map((stat, i) => (
              <View
                key={i}
                style={[
                  styles.statCard,
                  wide && { flexBasis: "22%", width: "23%" },
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <View
                  style={[
                    styles.statIcon,
                    { backgroundColor: stat.iconColor + "15" },
                  ]}
                >
                  <IconSymbol
                    name={stat.icon as any}
                    size={18}
                    color={stat.iconColor}
                  />
                </View>
                <Text style={[styles.statValue, { color: colors.foreground }]}>
                  {stat.value}
                </Text>
                <Text style={[styles.statLabel, { color: colors.muted }]}>
                  {stat.label}
                </Text>
                <Text style={[styles.statSub, { color: stat.iconColor }]}>
                  {stat.sub}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Quick Actions */}
        <Text style={[styles.sectionTitle, { color: colors.muted }]}>
          MANAGEMENT
        </Text>
        <View style={styles.actionsGrid}>
          {quickActions.map((action, i) => {
            const available =
              !(
                action.requiresImplicitTenant &&
                workspace.hasMultipleMemberships
              ) &&
              (!action.facility ||
                capabilitiesQuery.data?.[action.facility] === true);
            const checking =
              Boolean(action.facility) && capabilitiesQuery.isLoading;
            return (
              <TouchableOpacity
                key={i}
                accessibilityRole="button"
                accessibilityState={{ disabled: !available }}
                accessibilityLabel={
                  available
                    ? action.label
                    : `${action.label}: ${action.requiresImplicitTenant && workspace.hasMultipleMemberships ? "not available for multiple workspaces" : checking ? "checking availability" : "not available"}`
                }
                disabled={!available}
                style={[
                  styles.actionCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                  !available && styles.actionCardDisabled,
                ]}
                onPress={() => router.push(action.route as any)}
                activeOpacity={available ? 0.7 : 1}
              >
                <View
                  style={[
                    styles.actionIcon,
                    { backgroundColor: action.iconColor + "15" },
                  ]}
                >
                  <IconSymbol
                    name={action.icon as any}
                    size={22}
                    color={action.iconColor}
                  />
                </View>
                <Text
                  style={[styles.actionLabel, { color: colors.foreground }]}
                >
                  {action.label}
                </Text>
                {action.facility && !available ? (
                  <Text
                    style={[styles.actionAvailability, { color: colors.muted }]}
                  >
                    {action.requiresImplicitTenant &&
                    workspace.hasMultipleMemberships
                      ? "Multiple workspaces"
                      : checking
                        ? "Checking availability"
                        : "Not available"}
                  </Text>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Recent Calls */}
        <Text style={[styles.sectionTitle, { color: colors.muted }]}>
          RECENT CALLS
        </Text>
        <View
          style={[
            styles.section,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          {workspace.hasMultipleMemberships ? (
            <View style={styles.emptyState}>
              <Text style={{ color: colors.muted }}>
                Recent calls are unavailable for accounts with multiple
                workspaces.
              </Text>
            </View>
          ) : recentCallsQuery.isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : recentCallsQuery.isError ? (
            <View style={styles.emptyState}>
              <Text accessibilityRole="alert" style={{ color: colors.muted }}>
                Recent calls could not be loaded.
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => void recentCallsQuery.refetch()}
                style={{ minHeight: 44, justifyContent: "center" }}
              >
                <Text style={{ color: colors.primary }}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : recentCallsQuery.data && recentCallsQuery.data.length > 0 ? (
            recentCallsQuery.data.map((call: any, i: number) => (
              <View
                key={call.id || i}
                style={[
                  styles.callRow,
                  i < (recentCallsQuery.data?.length || 0) - 1 && {
                    borderBottomWidth: 0.5,
                    borderBottomColor: colors.border,
                  },
                ]}
              >
                <View
                  style={[
                    styles.callIcon,
                    {
                      backgroundColor:
                        dispositionColor(call.disposition) + "15",
                    },
                  ]}
                >
                  <IconSymbol
                    name={
                      call.direction === "inbound"
                        ? ("phone.arrow.down.left.fill" as any)
                        : ("phone.arrow.up.right.fill" as any)
                    }
                    size={14}
                    color={dispositionColor(call.disposition)}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.callNumber, { color: colors.foreground }]}
                  >
                    {call.caller_number} → {call.callee_number}
                  </Text>
                  <Text style={[styles.callMeta, { color: colors.muted }]}>
                    {call.direction} · {call.disposition} ·{" "}
                    {formatDuration(call.total_duration_seconds || 0)}
                  </Text>
                </View>
                <Text style={[styles.callTime, { color: colors.muted }]}>
                  {formatTime(call.started_at)}
                </Text>
              </View>
            ))
          ) : (
            <View style={styles.emptyState}>
              <Text style={[styles.emptyText, { color: colors.muted }]}>
                No calls yet today
              </Text>
            </View>
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </ScreenContainer>
  );
}

function AdminWorkspacePicker({
  workspace,
  colors,
}: {
  workspace: ReturnType<typeof usePbxAdminWorkspace>;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.workspacePicker}>
      {workspace.manageableMemberships.map((membership) => {
        const selected = workspace.selectedTenantId === membership.tenantId;
        return (
          <TouchableOpacity
            key={membership.tenantId}
            accessibilityRole="button"
            accessibilityLabel={`Manage ${membership.tenantName}`}
            accessibilityState={{ selected }}
            onPress={() => workspace.chooseTenant(membership.tenantId)}
            style={[
              styles.workspaceOption,
              {
                borderColor: selected ? colors.primary : colors.border,
                backgroundColor: colors.surface,
              },
            ]}
          >
            <Text
              style={{
                color: colors.foreground,
                fontWeight: selected ? "700" : "500",
              }}
            >
              {membership.tenantName}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>
              {membership.role === "owner" ? "Owner" : "Administrator"}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  workspaceChoicePage: {
    flex: 1,
    justifyContent: "center",
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    padding: 24,
  },
  workspacePicker: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 16,
  },
  workspaceOption: {
    minHeight: 54,
    minWidth: 140,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    justifyContent: "center",
    gap: 2,
  },
  workspaceNotice: {
    paddingHorizontal: 18,
    paddingTop: 12,
    fontSize: 12,
    lineHeight: 18,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    gap: 12,
  },
  backBtn: { padding: 4 },
  title: { fontSize: 22, fontWeight: "700" },
  subtitle: { fontSize: 13, marginTop: 2 },
  loadingContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    gap: 8,
  },
  loadingText: { fontSize: 13 },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", padding: 12, gap: 8 },
  statCard: {
    width: "48%",
    flexGrow: 1,
    flexBasis: "46%",
    borderRadius: 14,
    padding: 14,
    borderWidth: 0.5,
  },
  statIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  statValue: { fontSize: 24, fontWeight: "700" },
  statLabel: { fontSize: 12, marginTop: 2 },
  statSub: { fontSize: 11, fontWeight: "600", marginTop: 4 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.5,
    paddingHorizontal: 20,
    marginTop: 20,
    marginBottom: 8,
  },
  actionsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 12,
    gap: 8,
  },
  actionCard: {
    width: "30%",
    flexGrow: 1,
    flexBasis: "29%",
    borderRadius: 14,
    padding: 16,
    alignItems: "center",
    borderWidth: 0.5,
    gap: 8,
  },
  actionCardDisabled: { opacity: 0.58 },
  actionIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  actionLabel: { fontSize: 13, fontWeight: "600" },
  actionAvailability: { fontSize: 10, fontWeight: "600", textAlign: "center" },
  section: {
    marginHorizontal: 16,
    borderRadius: 14,
    borderWidth: 0.5,
    overflow: "hidden",
  },
  callRow: { flexDirection: "row", alignItems: "center", padding: 14, gap: 10 },
  callIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  callNumber: { fontSize: 13, fontWeight: "600" },
  callMeta: { fontSize: 11, marginTop: 2 },
  callTime: { fontSize: 11 },
  emptyState: { padding: 20, alignItems: "center" },
  emptyText: { fontSize: 13 },
  statePage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
    gap: 12,
  },
  permissionText: { maxWidth: 480, textAlign: "center", lineHeight: 20 },
  permissionButton: {
    minHeight: 44,
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 18,
  },
});

function AdminAccessState({
  title,
  detail,
  actionLabel,
  onAction,
  loading = false,
}: {
  title: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
  loading?: boolean;
}) {
  const colors = useColors();
  return (
    <ScreenContainer>
      <View style={styles.statePage}>
        {loading && <ActivityIndicator color={colors.primary} />}
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: colors.foreground }]}
        >
          {title}
        </Text>
        <Text
          accessibilityRole="alert"
          style={[styles.permissionText, { color: colors.muted }]}
        >
          {detail}
        </Text>
        {actionLabel && onAction && (
          <TouchableOpacity
            accessibilityRole="button"
            onPress={onAction}
            style={[styles.permissionButton, { borderColor: colors.primary }]}
          >
            <Text style={{ color: colors.primary, fontWeight: "600" }}>
              {actionLabel}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </ScreenContainer>
  );
}
