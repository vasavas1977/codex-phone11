import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { getAuthSnapshot, type User } from "@/lib/_core/auth";
import { useChatStore } from "@/lib/chat/store";
import type { WorkspaceProfileStatus, WorkspaceProfileUpdate } from "./contracts";

type ProfileScope = { owner: User; tenantId: number };
type SaveState = ProfileScope & { pending: boolean; error: unknown | null };

/** The owner is a local lifecycle guard only; the server still derives self from auth. */
export function useWorkspaceProfile(owner: User | null | undefined, tenantId: number | undefined) {
  const enabled = !!owner && Number.isSafeInteger(tenantId) && (tenantId ?? 0) > 0;
  const input = { tenantId: enabled ? tenantId! : 0 };
  const profile = trpc.profile.self.useQuery(input, {
    enabled,
    refetchInterval: 60_000,
    staleTime: 15_000,
  });
  const update = trpc.profile.update.useMutation();
  const mounted = useRef(false);
  const scope = useRef<ProfileScope | null>(null);
  if (!enabled) scope.current = null;
  else if (!scope.current || scope.current.owner !== owner || scope.current.tenantId !== tenantId) {
    scope.current = { owner: owner!, tenantId: tenantId! };
  }
  const [saveState, setSaveState] = useState<SaveState | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; scope.current = null; };
  }, []);
  const isCurrent = (action: ProfileScope) => {
    const auth = getAuthSnapshot();
    const chat = useChatStore.getState();
    return mounted.current && scope.current?.owner === action.owner && scope.current.tenantId === action.tenantId
      && auth.user === action.owner && !auth.loading && chat.userId === action.owner.id && chat.workspace?.id === action.tenantId;
  };
  const currentSave = !!saveState && enabled && saveState.owner === owner && saveState.tenantId === tenantId;
  const ownedProfile = enabled && profile.data?.userId === owner!.id
    ? profile.data as WorkspaceProfileStatus : undefined;

  return {
    profile: ownedProfile,
    profileAvailable: !!ownedProfile && profile.isSuccess,
    loading: enabled && profile.isLoading,
    saving: currentSave && saveState.pending,
    error: currentSave ? saveState.error : null,
    async save(patch: WorkspaceProfileUpdate) {
      const action = scope.current;
      if (!action || !isCurrent(action)) throw new Error("Select an active workspace first.");
      setSaveState({ ...action, pending: true, error: null });
      try {
        const result = await update.mutateAsync({ ...patch, tenantId: action.tenantId });
        if (!isCurrent(action)) return result as WorkspaceProfileStatus;
        await profile.refetch();
        if (isCurrent(action)) setSaveState({ ...action, pending: false, error: null });
        return result as WorkspaceProfileStatus;
      } catch (error) {
        if (isCurrent(action)) setSaveState({ ...action, pending: false, error });
        throw error;
      }
    },
  };
}
