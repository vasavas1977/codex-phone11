import { trpc } from "@/lib/trpc";
import type { WorkspaceProfileStatus, WorkspaceProfileUpdate } from "./contracts";

/** The server authenticates the owner; this hook never accepts a target user. */
export function useWorkspaceProfile(tenantId: number | undefined) {
  const enabled = Number.isSafeInteger(tenantId) && (tenantId ?? 0) > 0;
  const input = { tenantId: enabled ? tenantId! : 0 };
  const profile = trpc.profile.self.useQuery(input, {
    enabled,
    refetchInterval: 60_000,
    staleTime: 15_000,
  });
  const update = trpc.profile.update.useMutation();

  return {
    profile: profile.data as WorkspaceProfileStatus | undefined,
    profileAvailable: enabled && profile.isSuccess,
    loading: enabled && profile.isLoading,
    saving: update.isPending,
    error: profile.error || update.error,
    async save(patch: WorkspaceProfileUpdate) {
      if (!enabled) throw new Error("Select an active workspace first.");
      const result = await update.mutateAsync({ ...patch, tenantId: tenantId! });
      await profile.refetch();
      return result as WorkspaceProfileStatus;
    },
  };
}
