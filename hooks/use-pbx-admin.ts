/**
 * PBX Admin Hooks
 *
 * React hooks for all PBX admin operations using tRPC.
 * Provides type-safe access to tenant, extensions, phone numbers,
 * call records, fraud controls, and dashboard stats.
 */
import { trpc } from "@/lib/trpc";
import { useEffect, useSyncExternalStore } from "react";
import { useAuth } from "@/hooks/use-auth";
import * as Auth from "@/lib/_core/auth";

type AdminWorkspaceSelection = {
  userId: number | null;
  tenantId: number | null;
};
let adminWorkspaceSelection: AdminWorkspaceSelection = {
  userId: null,
  tenantId: null,
};
const adminWorkspaceListeners = new Set<() => void>();

function subscribeAdminWorkspace(listener: () => void) {
  adminWorkspaceListeners.add(listener);
  return () => adminWorkspaceListeners.delete(listener);
}

function getAdminWorkspaceSelection() {
  return adminWorkspaceSelection;
}

function setAdminWorkspaceSelection(
  userId: number | null,
  tenantId: number | null,
) {
  if (
    adminWorkspaceSelection.userId === userId &&
    adminWorkspaceSelection.tenantId === tenantId
  )
    return;
  adminWorkspaceSelection = { userId, tenantId };
  adminWorkspaceListeners.forEach((listener) => listener());
}

// Reset even if the administrator leaves these pages before signing out.
Auth.addAuthChangeListener(() => {
  const userId = Auth.getAuthSnapshot().user?.id ?? null;
  if (adminWorkspaceSelection.userId !== userId)
    setAdminWorkspaceSelection(userId, null);
});

/** A session-only admin choice. Never infer a multi-workspace write target. */
export function usePbxAdminWorkspace() {
  const { user } = useAuth({ autoFetch: false });
  const userId = typeof user?.id === "number" ? user.id : null;
  const selection = useSyncExternalStore(
    subscribeAdminWorkspace,
    getAdminWorkspaceSelection,
    getAdminWorkspaceSelection,
  );
  const membershipsQuery = trpc.pbx.tenant.memberships.useQuery(undefined, {
    enabled: userId !== null,
    staleTime: 0,
    refetchOnMount: "always",
  });
  // This query has no server input, so a cached response may belong to the
  // prior login until refetch completes. Discard it before resolving a target.
  const memberships = (membershipsQuery.data ?? []).filter(
    (membership) => membership.userId === userId,
  );
  const manageableMemberships = memberships.filter(
    (membership) => membership.role === "owner" || membership.role === "admin",
  );
  const storedTenantId =
    selection.userId === userId ? selection.tenantId : null;
  const selectedTenantId =
    manageableMemberships.length === 1
      ? manageableMemberships[0].tenantId
      : manageableMemberships.some(
            (membership) => membership.tenantId === storedTenantId,
          )
        ? storedTenantId
        : null;

  useEffect(() => {
    // A different signed-in account must never inherit the previous account's
    // workspace choice, even if React Query still has old response data.
    if (selection.userId !== userId) setAdminWorkspaceSelection(userId, null);
  }, [selection.userId, userId]);

  const chooseTenant = (tenantId: number) => {
    if (
      userId === null ||
      !manageableMemberships.some(
        (membership) => membership.tenantId === tenantId,
      )
    )
      return;
    setAdminWorkspaceSelection(userId, tenantId);
  };

  return {
    membershipsQuery,
    manageableMemberships,
    selectedTenantId,
    chooseTenant,
    // Legacy PBX procedures without tenantId are safe only when the account
    // has exactly one active membership, regardless of its role elsewhere.
    canUseImplicitTenant:
      membershipsQuery.isSuccess && memberships.length === 1,
    needsSelection:
      membershipsQuery.isSuccess &&
      manageableMemberships.length > 1 &&
      selectedTenantId === null,
    hasMultipleMemberships:
      membershipsQuery.isSuccess && memberships.length > 1,
  };
}

export type PbxManagementCapabilities = {
  phoneNumbers: boolean;
  sites: boolean;
  ringGroups: boolean;
  queues: boolean;
  ivr: boolean;
  businessHours: boolean;
};

/**
 * The server derives these flags from the live database schema. Keep the
 * client result immediately stale so opening or refreshing a management page
 * never turns an old schema observation into an enabled action.
 */
export function usePbxCapabilities(enabled: boolean = true) {
  return trpc.pbx.capabilities.useQuery(undefined, {
    enabled,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
}

/** Schema availability bound to a live selected workspace administrator. */
export function usePbxAdminCapabilities(enabled: boolean = true) {
  const workspace = usePbxAdminWorkspace();
  return trpc.pbx.capabilities.useQuery(
    { tenantId: workspace.selectedTenantId ?? 0 },
    {
      enabled: enabled && workspace.selectedTenantId !== null,
      staleTime: 0,
      gcTime: 0,
      refetchOnMount: "always",
      refetchOnWindowFocus: true,
    },
  );
}

// ============================================================================
// Dashboard
// ============================================================================
export function usePbxDashboardStats(enabled: boolean = true) {
  return trpc.pbx.dashboard.stats.useQuery(undefined, {
    enabled,
    staleTime: 30_000, // 30s cache
    refetchInterval: 60_000, // Auto-refresh every 60s
  });
}

export function usePbxRecentCalls(limit: number = 10, enabled: boolean = true) {
  return trpc.pbx.dashboard.recentCalls.useQuery(
    { limit },
    {
      enabled,
      staleTime: 15_000,
      refetchInterval: 30_000,
    },
  );
}

export type PbxAnalyticsPeriod = "today" | "week" | "month";

/**
 * Recorded-call reporting for the current tenant administrator.
 *
 * This is deliberately refreshed by the caller instead of polling, because CDR
 * ingestion is asynchronous and the result is not a live PBX-status signal.
 */
export function usePbxCallAnalytics(period: PbxAnalyticsPeriod) {
  return trpc.pbx.dashboard.analytics.useQuery(
    { period },
    { staleTime: 15_000 },
  );
}

// ============================================================================
// Tenant
// ============================================================================
export function useTenant(enabled: boolean = true) {
  const workspace = usePbxAdminWorkspace();
  return trpc.pbx.tenant.get.useQuery(
    { tenantId: workspace.selectedTenantId ?? 0 },
    {
      enabled: enabled && workspace.selectedTenantId !== null,
      staleTime: 300_000, // 5 min cache
    },
  );
}

export function useTenantMemberships(enabled: boolean = true) {
  return trpc.pbx.tenant.memberships.useQuery(undefined, {
    enabled,
    staleTime: 300_000,
  });
}

/** Active, same-workspace people with safe display identity only. */
export function useTenantPeople(enabled: boolean = true) {
  const workspace = usePbxAdminWorkspace();
  return trpc.pbx.tenant.people.useQuery(
    { tenantId: workspace.selectedTenantId ?? 0 },
    {
      enabled: enabled && workspace.selectedTenantId !== null,
      staleTime: 30_000,
    },
  );
}

/** Existing workspace members, including inactive memberships, for admins. */
export function useTenantMembers(enabled: boolean = true) {
  const workspace = usePbxAdminWorkspace();
  return trpc.pbx.tenant.members.useQuery(
    { tenantId: workspace.selectedTenantId ?? 0 },
    {
      enabled: enabled && workspace.selectedTenantId !== null,
      staleTime: 30_000,
    },
  );
}

export function useUpdateTenantMember() {
  const utils = trpc.useUtils();
  return trpc.pbx.tenant.updateMember.useMutation({
    onSuccess: () => {
      void utils.pbx.tenant.members.invalidate();
      void utils.pbx.tenant.people.invalidate();
      void utils.pbx.tenant.get.invalidate();
      void utils.pbx.tenant.memberships.invalidate();
      void utils.pbx.extensions.list.invalidate();
    },
  });
}

export function useUpdateTenantSettings() {
  const utils = trpc.useUtils();
  return trpc.pbx.tenant.updateSettings.useMutation({
    onSuccess: () => {
      utils.pbx.tenant.get.invalidate();
    },
  });
}

// ============================================================================
// Member self-service (the server derives both user and tenant from auth)
// ============================================================================
export function usePbxSelfService(enabled: boolean = true) {
  return trpc.pbx.selfService.overview.useQuery(undefined, {
    enabled,
    staleTime: 30_000,
  });
}

export function useOwnCallUsage(
  period: "week" | "month",
  enabled: boolean = true,
) {
  return trpc.pbx.selfService.usage.useQuery(
    { period },
    { enabled, staleTime: 15_000 },
  );
}

export function useOwnVoicemails() {
  return trpc.pbx.voicemail.list.useQuery(undefined, { staleTime: 15_000 });
}

export function useMarkOwnVoicemailRead() {
  const utils = trpc.useUtils();
  return trpc.pbx.voicemail.markRead.useMutation({
    onSuccess: () => void utils.pbx.voicemail.list.invalidate(),
  });
}

export function useDeleteOwnVoicemail() {
  const utils = trpc.useUtils();
  return trpc.pbx.voicemail.delete.useMutation({
    onSuccess: () => void utils.pbx.voicemail.list.invalidate(),
  });
}

// ============================================================================
// Extensions
// ============================================================================
export function useExtensions(
  page: number = 1,
  pageSize: number = 25,
  enabled: boolean = true,
) {
  const workspace = usePbxAdminWorkspace();
  return trpc.pbx.extensions.list.useQuery(
    {
      page,
      pageSize,
      sortBy: "extension_number",
      sortOrder: "asc",
      tenantId: workspace.selectedTenantId ?? 0,
    },
    {
      enabled: enabled && workspace.selectedTenantId !== null,
      staleTime: 30_000,
    },
  );
}

export function useExtension(id: number) {
  const workspace = usePbxAdminWorkspace();
  return trpc.pbx.extensions.get.useQuery(
    { id, tenantId: workspace.selectedTenantId ?? 0 },
    {
      enabled: id > 0 && workspace.selectedTenantId !== null,
      staleTime: 30_000,
    },
  );
}

export function useCreateExtension() {
  const utils = trpc.useUtils();
  return trpc.pbx.extensions.create.useMutation({
    onSuccess: () => {
      utils.pbx.extensions.list.invalidate();
      utils.pbx.dashboard.stats.invalidate();
    },
  });
}

export function useUpdateExtension() {
  const utils = trpc.useUtils();
  return trpc.pbx.extensions.update.useMutation({
    onSuccess: () => {
      utils.pbx.extensions.list.invalidate();
      utils.pbx.tenant.people.invalidate();
    },
  });
}

export function useDeleteExtension() {
  const utils = trpc.useUtils();
  return trpc.pbx.extensions.delete.useMutation({
    onSuccess: () => {
      utils.pbx.extensions.list.invalidate();
      utils.pbx.dashboard.stats.invalidate();
    },
  });
}

export function useResetExtensionPassword() {
  return trpc.pbx.extensions.resetPassword.useMutation();
}

// ============================================================================
// Phone Numbers
// ============================================================================
export function usePhoneNumbers(
  page: number = 1,
  pageSize: number = 25,
  enabled: boolean = true,
) {
  const workspace = usePbxAdminWorkspace();
  return trpc.pbx.phoneNumbers.list.useQuery(
    { page, pageSize, tenantId: workspace.selectedTenantId ?? 0 },
    {
      enabled: enabled && workspace.selectedTenantId !== null,
      staleTime: 30_000,
    },
  );
}

export function useCreatePhoneNumber() {
  const utils = trpc.useUtils();
  return trpc.pbx.phoneNumbers.create.useMutation({
    onSuccess: () => {
      utils.pbx.phoneNumbers.list.invalidate();
      utils.pbx.dashboard.stats.invalidate();
    },
  });
}

// Re-export the type for convenience
export type {};

export function useAssignPhoneNumberRoute() {
  const utils = trpc.useUtils();
  return trpc.pbx.phoneNumbers.assignRoute.useMutation({
    onSuccess: () => {
      void utils.pbx.phoneNumbers.list.invalidate().catch(() => undefined);
    },
  });
}

// ============================================================================
// Sites
// ============================================================================
export function useSites(enabled: boolean = true) {
  return trpc.pbx.sites.list.useQuery(undefined, {
    enabled,
    staleTime: 300_000,
  });
}

export function useCreateSite() {
  const utils = trpc.useUtils();
  return trpc.pbx.sites.create.useMutation({
    onSuccess: () => {
      utils.pbx.sites.list.invalidate();
    },
  });
}

// ============================================================================
// Emergency Addresses
// ============================================================================
export function useEmergencyAddresses() {
  return trpc.pbx.emergencyAddresses.list.useQuery(undefined, {
    staleTime: 300_000,
  });
}

export function useCreateEmergencyAddress() {
  const utils = trpc.useUtils();
  return trpc.pbx.emergencyAddresses.create.useMutation({
    onSuccess: () => {
      utils.pbx.emergencyAddresses.list.invalidate();
    },
  });
}

// ============================================================================
// Fraud Controls
// ============================================================================
export function useFraudControls() {
  return trpc.pbx.fraudControls.get.useQuery(undefined, {
    staleTime: 300_000,
  });
}

export function useUpdateFraudControls() {
  const utils = trpc.useUtils();
  return trpc.pbx.fraudControls.update.useMutation({
    onSuccess: () => {
      utils.pbx.fraudControls.get.invalidate();
    },
  });
}

// ============================================================================
// Call Records
// ============================================================================
export function useCallRecords(params?: {
  page?: number;
  pageSize?: number;
  direction?: "inbound" | "outbound" | "internal";
  fromDate?: string;
  toDate?: string;
}) {
  return trpc.pbx.callRecords.list.useQuery(params, {
    staleTime: 15_000,
  });
}

export function useCallRecord(id: number) {
  return trpc.pbx.callRecords.get.useQuery(
    { id },
    {
      enabled: id > 0,
    },
  );
}

// ============================================================================
// Audio Files
// ============================================================================
export function useAudioFiles(category?: string) {
  return trpc.pbx.audioFiles.list.useQuery(
    category ? { category } : undefined,
    { staleTime: 60_000 },
  );
}

export function useCreateAudioFile() {
  const utils = trpc.useUtils();
  return trpc.pbx.audioFiles.create.useMutation({
    onSuccess: () => {
      utils.pbx.audioFiles.list.invalidate();
    },
  });
}

// ============================================================================
// Audit Logs
// ============================================================================
export function useAuditLogs(params?: {
  page?: number;
  pageSize?: number;
  resourceType?: string;
  action?: string;
}) {
  return trpc.pbx.auditLogs.list.useQuery(params, {
    staleTime: 30_000,
  });
}

// ============================================================================
// IVR Menus (Milestone 7)
// ============================================================================
export function useIvrMenus(tenantId: number, enabled: boolean = true) {
  return trpc.ivr.ivr.list.useQuery(
    { tenant_id: tenantId },
    {
      enabled: tenantId > 0 && enabled,
      staleTime: 30_000,
    },
  );
}

export function useIvrMenu(id: number, enabled: boolean = true) {
  return trpc.ivr.ivr.get.useQuery(
    { id },
    {
      enabled: id > 0 && enabled,
      staleTime: 30_000,
    },
  );
}

export function useCreateIvrMenu() {
  const utils = trpc.useUtils();
  return trpc.ivr.ivr.create.useMutation({
    onSuccess: () => {
      utils.ivr.ivr.list.invalidate();
    },
  });
}

export function useUpdateIvrMenu() {
  const utils = trpc.useUtils();
  return trpc.ivr.ivr.update.useMutation({
    onSuccess: () => {
      utils.ivr.ivr.list.invalidate();
      utils.ivr.ivr.get.invalidate();
    },
  });
}

export function useDeleteIvrMenu() {
  const utils = trpc.useUtils();
  return trpc.ivr.ivr.delete.useMutation({
    onSuccess: () => {
      utils.ivr.ivr.list.invalidate();
    },
  });
}

export function useSetIvrActions() {
  const utils = trpc.useUtils();
  return trpc.ivr.ivr.setActions.useMutation({
    onSuccess: () => {
      utils.ivr.ivr.get.invalidate();
    },
  });
}

// ============================================================================
// Ring Groups (Milestone 7)
// ============================================================================
export function useRingGroups(tenantId: number, enabled: boolean = true) {
  return trpc.ivr.ringGroups.list.useQuery(
    { tenant_id: tenantId },
    {
      enabled: tenantId > 0 && enabled,
      staleTime: 30_000,
    },
  );
}

export function useRingGroup(id: number, enabled: boolean = true) {
  return trpc.ivr.ringGroups.get.useQuery(
    { id },
    {
      enabled: id > 0 && enabled,
      staleTime: 30_000,
    },
  );
}

export function useCreateRingGroup() {
  const utils = trpc.useUtils();
  return trpc.ivr.ringGroups.create.useMutation({
    onSuccess: () => {
      utils.ivr.ringGroups.list.invalidate();
    },
  });
}

export function useUpdateRingGroup() {
  const utils = trpc.useUtils();
  return trpc.ivr.ringGroups.update.useMutation({
    onSuccess: () => {
      utils.ivr.ringGroups.list.invalidate();
      utils.ivr.ringGroups.get.invalidate();
    },
  });
}

export function useDeleteRingGroup() {
  const utils = trpc.useUtils();
  return trpc.ivr.ringGroups.delete.useMutation({
    onSuccess: () => {
      utils.ivr.ringGroups.list.invalidate();
    },
  });
}

export function useSetRingGroupMembers() {
  const utils = trpc.useUtils();
  return trpc.ivr.ringGroups.setMembers.useMutation({
    onSuccess: () => {
      utils.ivr.ringGroups.get.invalidate();
    },
  });
}

// ============================================================================
// Call Queues (Milestone 7)
// ============================================================================
export function useCallQueues(tenantId: number, enabled: boolean = true) {
  return trpc.ivr.queues.list.useQuery(
    { tenant_id: tenantId },
    {
      enabled: tenantId > 0 && enabled,
      staleTime: 30_000,
    },
  );
}

export function useCallQueue(id: number, enabled: boolean = true) {
  return trpc.ivr.queues.get.useQuery(
    { id },
    {
      enabled: id > 0 && enabled,
      staleTime: 30_000,
    },
  );
}

export function useCreateCallQueue() {
  const utils = trpc.useUtils();
  return trpc.ivr.queues.create.useMutation({
    onSuccess: () => {
      utils.ivr.queues.list.invalidate();
    },
  });
}

export function useUpdateCallQueue() {
  const utils = trpc.useUtils();
  return trpc.ivr.queues.update.useMutation({
    onSuccess: () => {
      utils.ivr.queues.list.invalidate();
      utils.ivr.queues.get.invalidate();
    },
  });
}

export function useDeleteCallQueue() {
  const utils = trpc.useUtils();
  return trpc.ivr.queues.delete.useMutation({
    onSuccess: () => {
      utils.ivr.queues.list.invalidate();
    },
  });
}

export function useSetQueueAgents() {
  const utils = trpc.useUtils();
  return trpc.ivr.queues.setAgents.useMutation({
    onSuccess: () => {
      utils.ivr.queues.get.invalidate();
    },
  });
}

export function useQueueAgentLogin() {
  const utils = trpc.useUtils();
  return trpc.ivr.queues.agentLogin.useMutation({
    onSuccess: () => {
      utils.ivr.queues.get.invalidate();
      utils.ivr.queues.list.invalidate();
    },
  });
}

export function useQueueAgentLogout() {
  const utils = trpc.useUtils();
  return trpc.ivr.queues.agentLogout.useMutation({
    onSuccess: () => {
      utils.ivr.queues.get.invalidate();
      utils.ivr.queues.list.invalidate();
    },
  });
}

export function useQueueStats(
  queueId: number,
  hours: number = 24,
  enabled: boolean = true,
) {
  return trpc.ivr.queues.stats.useQuery(
    { queue_id: queueId, hours },
    {
      enabled: queueId > 0 && enabled,
      staleTime: 30_000,
      refetchInterval: 60_000,
    },
  );
}

// ============================================================================
// Time Conditions (Milestone 7)
// ============================================================================
export function useTimeConditions(tenantId: number, enabled: boolean = true) {
  return trpc.ivr.timeConditions.list.useQuery(
    { tenant_id: tenantId },
    {
      enabled: tenantId > 0 && enabled,
      staleTime: 60_000,
    },
  );
}

export function useTimeCondition(id: number, enabled: boolean = true) {
  return trpc.ivr.timeConditions.get.useQuery(
    { id },
    {
      enabled: id > 0 && enabled,
      staleTime: 60_000,
    },
  );
}

export function useCreateTimeCondition() {
  const utils = trpc.useUtils();
  return trpc.ivr.timeConditions.create.useMutation({
    onSuccess: () => {
      utils.ivr.timeConditions.list.invalidate();
    },
  });
}

export function useUpdateTimeCondition() {
  const utils = trpc.useUtils();
  return trpc.ivr.timeConditions.update.useMutation({
    onSuccess: () => {
      utils.ivr.timeConditions.get.invalidate();
      utils.ivr.timeConditions.list.invalidate();
    },
  });
}

export function useSetTimeConditionRules() {
  const utils = trpc.useUtils();
  return trpc.ivr.timeConditions.setRules.useMutation({
    onSuccess: () => {
      utils.ivr.timeConditions.get.invalidate();
    },
  });
}

export function useDeleteTimeCondition() {
  const utils = trpc.useUtils();
  return trpc.ivr.timeConditions.delete.useMutation({
    onSuccess: () => {
      utils.ivr.timeConditions.list.invalidate();
    },
  });
}
