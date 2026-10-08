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
  Platform,
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
  label: string;
  route: string;
  group: "People" | "Phone system" | "Workspace";
  facility?: keyof PbxManagementCapabilities;
  requiresImplicitTenant?: boolean;
}

export default function AdminDashboard() {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const wide = width >= 1000;
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
      label: "People",
      route: "/admin/users",
      group: "People",
    },
    {
      icon: "video.fill",
      label: "Meetings",
      route: "/admin/meetings",
      group: "Workspace",
    },
    {
      icon: "phone.fill",
      label: "Extensions",
      route: "/admin/extensions",
      group: "People",
    },
    {
      icon: "voicemail",
      label: "Voicemail",
      route: "/admin/voicemail",
      group: "Phone system",
    },
    {
      icon: "number",
      label: "Phone numbers",
      route: "/admin/dids",
      group: "Phone system",
      facility: "phoneNumbers",
    },
    {
      icon: "rectangle.grid.3x2.fill",
      label: "IVR menus",
      route: "/admin/ivr",
      group: "Phone system",
      facility: "ivr",
    },
    {
      icon: "person.3.fill",
      label: "Ring Groups",
      route: "/admin/ring-groups",
      group: "Phone system",
      facility: "ringGroups",
      requiresImplicitTenant: true,
    },
    {
      icon: "person.line.dotted.person.fill",
      label: "Queues",
      route: "/admin/queues",
      group: "Phone system",
      facility: "queues",
      requiresImplicitTenant: true,
    },
    {
      icon: "calendar.badge.clock",
      label: "Business Hours",
      route: "/admin/schedules",
      group: "Phone system",
      facility: "businessHours",
      requiresImplicitTenant: true,
    },
    {
      icon: "gearshape.fill",
      label: "Workspace settings",
      route: "/admin/workspace-settings",
      group: "Workspace",
    },
    {
      icon: "person.fill",
      label: "Workspace status",
      route: "/admin/profile-status",
      group: "Workspace",
    },
    {
      icon: "chart.bar.fill",
      label: "Call analytics",
      route: "/admin/analytics",
      group: "Workspace",
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
        ? [statsQuery.refetch(), recentCallsQuery.refetch()]
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

  if (workspace.membershipsQuery.isLoading || workspace.admissionChecking) {
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

  if (workspace.updateRequired) {
    return (
      <AdminAccessState
        title="Workspace API update required"
        detail="This server cannot safely select between your workspaces. Administration will be available after the workspace API is updated."
        actionLabel="Try again"
        onAction={() => void workspace.membershipsQuery.refetch()}
      />
    );
  }
  if (workspace.admissionError) {
    return (
      <AdminAccessState
        title="Workspace administration is unavailable"
        detail="Phone11 could not confirm the current workspace identity and administrator role."
        actionLabel="Try again"
        onAction={() => void workspace.membershipsQuery.refetch()}
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
    <ScreenContainer
      style={
        Platform.OS === "web" ? { backgroundColor: colors.surface } : undefined
      }
    >
      <ScrollView
        contentContainerStyle={{
          width: "100%",
          maxWidth: 1120,
          alignSelf: "center",
          paddingHorizontal: wide ? 32 : 16,
          paddingTop: wide ? 32 : 12,
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
        <View style={styles.header}>
          {Platform.OS !== "web" || !wide ? (
            <TouchableOpacity
              onPress={() => router.back()}
              style={styles.backBtn}
              accessibilityRole="button"
              accessibilityLabel="Back to settings"
            >
              <IconSymbol
                name="chevron.left"
                size={22}
                color={colors.primary}
              />
            </TouchableOpacity>
          ) : null}
          <View style={{ flex: 1 }}>
            <Text
              accessibilityRole="header"
              style={[styles.title, { color: colors.foreground }]}
            >
              Overview
            </Text>
            <Text style={[styles.subtitle, { color: colors.muted }]}>
              {tenant?.name || "Phone11"} · Workspace administration
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

        <Text style={[styles.sectionTitle, { color: colors.muted }]}>
          TODAY AT A GLANCE
        </Text>
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
                sub: `${stats?.activeExtensions || 0} active`,
              },
              {
                label: "Phone Numbers",
                value:
                  capabilitiesQuery.data?.phoneNumbers === true &&
                  stats?.phoneNumbersAvailable === true
                    ? String(stats.phoneNumbers || 0)
                    : "—",
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
                sub: `${stats?.missedCallsToday || 0} missed`,
              },
              {
                label: "Avg Duration",
                value: formatDuration(stats?.avgCallDuration || 0),
                sub: "today",
              },
            ].map((stat, i) => (
              <View
                key={i}
                style={[
                  styles.statCard,
                  wide && { flexBasis: "22%" },
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text style={[styles.statLabel, { color: colors.muted }]}>
                  {stat.label}
                </Text>
                <Text style={[styles.statValue, { color: colors.foreground }]}>
                  {stat.value}
                </Text>
                <Text style={[styles.statSub, { color: colors.muted }]}>
                  {stat.sub}
                </Text>
              </View>
            ))}
          </View>
        )}

        <Text style={[styles.sectionTitle, { color: colors.muted }]}>
          MANAGE YOUR WORKSPACE
        </Text>
        <View
          style={[styles.actionSections, wide && styles.actionSectionsWide]}
        >
          {(["People", "Phone system", "Workspace"] as const).map((group) => (
            <View
              key={group}
              style={[
                styles.actionSection,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Text
                style={[
                  styles.actionSectionTitle,
                  { color: colors.foreground },
                ]}
              >
                {group}
              </Text>
              {quickActions
                .filter((action) => action.group === group)
                .map((action) => {
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
                      key={action.route}
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
                        { borderTopColor: colors.border },
                        !available && styles.actionCardDisabled,
                      ]}
                      onPress={() => router.push(action.route as any)}
                      activeOpacity={available ? 0.7 : 1}
                    >
                      <IconSymbol
                        name={action.icon as any}
                        size={17}
                        color={available ? colors.primary : colors.muted}
                      />
                      <Text
                        style={[
                          styles.actionLabel,
                          { color: colors.foreground },
                        ]}
                      >
                        {action.label}
                      </Text>
                      {action.facility && !available ? (
                        <Text
                          style={[
                            styles.actionAvailability,
                            { color: colors.muted },
                          ]}
                        >
                          {action.requiresImplicitTenant &&
                          workspace.hasMultipleMemberships
                            ? "Multiple workspaces"
                            : checking
                              ? "Checking availability"
                              : "Not available"}
                        </Text>
                      ) : null}
                      <IconSymbol
                        name="chevron.right"
                        size={13}
                        color={colors.muted}
                      />
                    </TouchableOpacity>
                  );
                })}
            </View>
          ))}
        </View>

        {/* Recent Calls */}
        <Text style={[styles.sectionTitle, { color: colors.muted }]}>
          RECENT CALL ACTIVITY
        </Text>
        <View
          style={[
            styles.section,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          {wide &&
          !workspace.hasMultipleMemberships &&
          recentCallsQuery.data &&
          recentCallsQuery.data.length > 0 ? (
            <View
              style={[
                styles.callTableHeader,
                { borderBottomColor: colors.border },
              ]}
            >
              <View style={styles.callIcon} />
              <Text style={[styles.callTableMain, { color: colors.muted }]}>
                CALL
              </Text>
              <Text style={[styles.callTableCell, { color: colors.muted }]}>
                DIRECTION
              </Text>
              <Text style={[styles.callTableCell, { color: colors.muted }]}>
                RESULT
              </Text>
              <Text style={[styles.callTableCell, { color: colors.muted }]}>
                DURATION
              </Text>
              <Text style={[styles.callTableCell, { color: colors.muted }]}>
                WHEN
              </Text>
            </View>
          ) : null}
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
                <View style={styles.callTableMain}>
                  <Text
                    style={[styles.callNumber, { color: colors.foreground }]}
                  >
                    {call.caller_number} → {call.callee_number}
                  </Text>
                  {!wide ? (
                    <Text style={[styles.callMeta, { color: colors.muted }]}>
                      {call.direction} · {call.disposition} ·{" "}
                      {formatDuration(call.total_duration_seconds || 0)}
                    </Text>
                  ) : null}
                </View>
                {wide ? (
                  <>
                    <Text
                      style={[styles.callTableCell, { color: colors.muted }]}
                    >
                      {call.direction}
                    </Text>
                    <Text
                      style={[
                        styles.callTableCell,
                        { color: dispositionColor(call.disposition) },
                      ]}
                    >
                      {call.disposition}
                    </Text>
                    <Text
                      style={[styles.callTableCell, { color: colors.muted }]}
                    >
                      {formatDuration(call.total_duration_seconds || 0)}
                    </Text>
                  </>
                ) : null}
                <Text
                  style={[
                    wide ? styles.callTableCell : styles.callTime,
                    { color: colors.muted },
                  ]}
                >
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
    paddingVertical: 8,
    gap: 12,
  },
  backBtn: {
    padding: 4,
    minWidth: 36,
    minHeight: 40,
    justifyContent: "center",
  },
  title: { fontSize: 27, fontWeight: "700" },
  subtitle: { fontSize: 14, marginTop: 4 },
  loadingContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    gap: 8,
  },
  loadingText: { fontSize: 13 },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  statCard: {
    flexGrow: 1,
    flexBasis: "45%",
    borderRadius: 10,
    padding: 18,
    borderWidth: 1,
  },
  statValue: { fontSize: 28, fontWeight: "700", marginTop: 10 },
  statLabel: { fontSize: 12, fontWeight: "600" },
  statSub: { fontSize: 12, marginTop: 3 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    marginTop: 30,
    marginBottom: 12,
  },
  actionSections: {
    gap: 12,
  },
  actionSectionsWide: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  actionSection: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderRadius: 10,
    overflow: "hidden",
  },
  actionSectionTitle: {
    fontSize: 15,
    fontWeight: "700",
    paddingHorizontal: 16,
    paddingVertical: 15,
  },
  actionCard: {
    minHeight: 50,
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  actionCardDisabled: { opacity: 0.58 },
  actionLabel: { fontSize: 13, fontWeight: "600", flex: 1 },
  actionAvailability: {
    fontSize: 10,
    fontWeight: "600",
    maxWidth: 94,
    textAlign: "right",
  },
  section: {
    borderRadius: 10,
    borderWidth: 1,
    overflow: "hidden",
  },
  callTableHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  callTableMain: { flex: 2, minWidth: 0 },
  callTableCell: { flex: 1, minWidth: 0, fontSize: 12 },
  callRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingVertical: 14,
    gap: 12,
  },
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
