/**
 * PBX Admin Hooks
 * 
 * React hooks for all PBX admin operations using tRPC.
 * Provides type-safe access to tenant, extensions, phone numbers,
 * call records, fraud controls, and dashboard stats.
 */
import { trpc } from "@/lib/trpc";

// ============================================================================
// Dashboard
// ============================================================================
export function usePbxDashboardStats() {
  return trpc.pbx.dashboard.stats.useQuery(undefined, {
    staleTime: 30_000, // 30s cache
    refetchInterval: 60_000, // Auto-refresh every 60s
  });
}

export function usePbxRecentCalls(limit: number = 10) {
  return trpc.pbx.dashboard.recentCalls.useQuery({ limit }, {
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

// ============================================================================
// Tenant
// ============================================================================
export function useTenant() {
  return trpc.pbx.tenant.get.useQuery(undefined, {
    staleTime: 300_000, // 5 min cache
  });
}

export function useTenantMemberships() {
  return trpc.pbx.tenant.memberships.useQuery(undefined, {
    staleTime: 300_000,
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
// Extensions
// ============================================================================
export function useExtensions(page: number = 1, pageSize: number = 25) {
  return trpc.pbx.extensions.list.useQuery(
    { page, pageSize, sortBy: "extension_number", sortOrder: "asc" },
    { staleTime: 30_000 }
  );
}

export function useExtension(id: number) {
  return trpc.pbx.extensions.get.useQuery({ id }, {
    enabled: id > 0,
    staleTime: 30_000,
  });
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
export function usePhoneNumbers(page: number = 1, pageSize: number = 25) {
  return trpc.pbx.phoneNumbers.list.useQuery(
    { page, pageSize },
    { staleTime: 30_000 }
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
export type { };

export function useAssignPhoneNumberRoute() {
  const utils = trpc.useUtils();
  return trpc.pbx.phoneNumbers.assignRoute.useMutation({
    onSuccess: () => {
      utils.pbx.phoneNumbers.list.invalidate();
    },
  });
}

// ============================================================================
// Sites
// ============================================================================
export function useSites() {
  return trpc.pbx.sites.list.useQuery(undefined, {
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
  return trpc.pbx.callRecords.get.useQuery({ id }, {
    enabled: id > 0,
  });
}

// ============================================================================
// Audio Files
// ============================================================================
export function useAudioFiles(category?: string) {
  return trpc.pbx.audioFiles.list.useQuery(
    category ? { category } : undefined,
    { staleTime: 60_000 }
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
export function useIvrMenus(tenantId: number) {
  return trpc.ivr.ivr.list.useQuery({ tenant_id: tenantId }, {
    enabled: tenantId > 0,
    staleTime: 30_000,
  });
}

export function useIvrMenu(id: number) {
  return trpc.ivr.ivr.get.useQuery({ id }, {
    enabled: id > 0,
    staleTime: 30_000,
  });
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
export function useRingGroups(tenantId: number) {
  return trpc.ivr.ringGroups.list.useQuery({ tenant_id: tenantId }, {
    enabled: tenantId > 0,
    staleTime: 30_000,
  });
}

export function useRingGroup(id: number) {
  return trpc.ivr.ringGroups.get.useQuery({ id }, {
    enabled: id > 0,
    staleTime: 30_000,
  });
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
export function useCallQueues(tenantId: number) {
  return trpc.ivr.queues.list.useQuery({ tenant_id: tenantId }, {
    enabled: tenantId > 0,
    staleTime: 30_000,
  });
}

export function useCallQueue(id: number) {
  return trpc.ivr.queues.get.useQuery({ id }, {
    enabled: id > 0,
    staleTime: 30_000,
  });
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

export function useQueueStats(queueId: number, hours: number = 24) {
  return trpc.ivr.queues.stats.useQuery({ queue_id: queueId, hours }, {
    enabled: queueId > 0,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

// ============================================================================
// Time Conditions (Milestone 7)
// ============================================================================
export function useTimeConditions(tenantId: number) {
  return trpc.ivr.timeConditions.list.useQuery({ tenant_id: tenantId }, {
    enabled: tenantId > 0,
    staleTime: 60_000,
  });
}

export function useTimeCondition(id: number) {
  return trpc.ivr.timeConditions.get.useQuery({ id }, {
    enabled: id > 0,
    staleTime: 60_000,
  });
}

export function useCreateTimeCondition() {
  const utils = trpc.useUtils();
  return trpc.ivr.timeConditions.create.useMutation({
    onSuccess: () => {
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
