import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { getAuthSnapshot, type User } from "@/lib/_core/auth";
import { useChatStore } from "@/lib/chat/store";
import type { WorkspaceProfileStatus, WorkspaceProfileUpdate } from "./contracts";
import {
  removeWorkspaceProfilePhoto,
  uploadWorkspaceProfilePhoto,
} from "./photo-client";
import type { ProfilePhotoUpload } from "./photo-client";
import type { ProfilePhotoDescriptor } from "./photo-client";
import {
  confirmPhotoDescriptor,
  getConfirmedPhotoDescriptor,
  loadLocalPhotoDescriptor,
  saveLocalPhotoDescriptor,
  subscribeConfirmedPhotoDescriptor,
} from "./local-photo-descriptor";

type ProfileScope = { owner: User; tenantId: number };
type SaveState = ProfileScope & { pending: boolean; error: unknown | null };
type PhotoSaveState = { scope: ProfileScope; requestId: number; pending: boolean; error: unknown | null };
type ScopedPhoto = { scope: ProfileScope; descriptor: ProfilePhotoDescriptor; savedAt: number };

/** The owner is a local lifecycle guard only; the server still derives self from auth. */
export function useWorkspaceProfile(owner: User | null | undefined, tenantId: number | undefined) {
  const enabled = !!owner && Number.isSafeInteger(tenantId) && (tenantId ?? 0) > 0;
  const input = { tenantId: enabled ? tenantId! : 0 };
  // Older servers reject this additive query. Treat that as no photo capability.
  const photoCapability = trpc.profile.photoCapability.useQuery(input, {
    enabled,
    retry: false,
    staleTime: 15_000,
  });
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
  const [photoSaveState, setPhotoSaveState] = useState<PhotoSaveState | null>(null);
  const [localPhoto, setLocalPhoto] = useState<ScopedPhoto | null>(null);
  const localPhotoGeneration = useRef(0);
  const photoRequestId = useRef(0);
  const activeScope = scope.current;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; scope.current = null; };
  }, []);
  useEffect(() => {
    let active = true;
    const generation = ++localPhotoGeneration.current;
    const action = activeScope;
    if (action) {
      const { owner: scopedOwner, tenantId: scopedTenantId } = action;
      const receive = (ownerId: number, changedTenantId: number, stored: { descriptor: ProfilePhotoDescriptor; savedAt: number }) => {
        if (active && scope.current === action && scopedOwner.id === ownerId && scopedTenantId === changedTenantId) {
          localPhotoGeneration.current += 1;
          setLocalPhoto({ scope: action, ...stored });
        }
      };
      const unsubscribe = subscribeConfirmedPhotoDescriptor(receive);
      const confirmed = getConfirmedPhotoDescriptor(scopedOwner.id, scopedTenantId);
      if (confirmed) receive(scopedOwner.id, scopedTenantId, confirmed);
      void loadLocalPhotoDescriptor(scopedOwner.id, scopedTenantId).then((stored) => {
        if (active && generation === localPhotoGeneration.current && stored)
          setLocalPhoto({ scope: action, ...stored });
      });
      return () => { active = false; unsubscribe(); };
    }
    return () => { active = false; };
  }, [activeScope]);
  const isCurrent = (action: ProfileScope) => {
    const auth = getAuthSnapshot();
    const chat = useChatStore.getState();
    return mounted.current && scope.current === action
      && auth.user === action.owner && !auth.loading && chat.userId === action.owner.id && chat.workspace?.id === action.tenantId;
  };
  const currentSave = !!saveState && enabled && saveState.owner === owner && saveState.tenantId === tenantId;
  const currentPhotoSave = !!photoSaveState && enabled && photoSaveState.scope === scope.current;
  const ownedProfile = enabled && profile.data?.userId === owner!.id
    ? profile.data as WorkspaceProfileStatus : undefined;
  const scopedLocalPhoto = enabled && localPhoto?.scope === scope.current
    ? localPhoto : null;
  const statusPhoto: ProfilePhotoDescriptor | null = ownedProfile && ownedProfile.photoUrl !== undefined
    ? { userId: ownedProfile.userId, photoUrl: ownedProfile.photoUrl ?? null, photoVersion: ownedProfile.photoVersion ?? null }
    : null;
  // A locally confirmed upload/remove outranks a profile.self value cached before it.
  // A later successful server profile fetch can supersede this device's pointer.
  const photoDescriptor: ProfilePhotoDescriptor | null = scopedLocalPhoto &&
    (statusPhoto === null || scopedLocalPhoto.savedAt >= (profile.dataUpdatedAt ?? 0))
    ? scopedLocalPhoto.descriptor : statusPhoto;
  const settlePhoto = (requestId: number, error: unknown | null) => {
    setPhotoSaveState((current) => current?.requestId === requestId
      ? { ...current, pending: false, error }
      : current);
  };

  return {
    profile: ownedProfile,
    profileAvailable: !!ownedProfile && profile.isSuccess,
    photoDescriptor,
    loading: enabled && profile.isLoading,
    loadError: !!profile.error,
    photoCapabilityError: !!photoCapability.error,
    photoCapabilityLoading: enabled && photoCapability.isLoading,
    saving: currentSave && saveState.pending,
    error: currentSave ? saveState.error : null,
    photoAvailable: enabled && photoCapability.data?.available === true,
    async refetchPhotoSettings() {
      if (!enabled || !owner || !tenantId) return;
      await photoCapability.refetch();
    },
    photoSaving: currentPhotoSave && photoSaveState.pending,
    photoError: currentPhotoSave ? photoSaveState.error : null,
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
    async uploadPhoto(input: ProfilePhotoUpload) {
      const action = scope.current;
      if (!action || !isCurrent(action)) throw new Error("Select an active workspace first.");
      const requestId = ++photoRequestId.current;
      setPhotoSaveState({ scope: action, requestId, pending: true, error: null });
      try {
        const result = await uploadWorkspaceProfilePhoto(action.tenantId, input);
        if (!isCurrent(action)) { settlePhoto(requestId, null); return result; }
        const savedAt = Date.now();
        confirmPhotoDescriptor(action.owner.id, action.tenantId, result, savedAt);
        try { await saveLocalPhotoDescriptor(action.owner.id, action.tenantId, result, savedAt); }
        catch { /* The server accepted the photo; keep this session's descriptor. */ }
        settlePhoto(requestId, null);
        return result;
      } catch (error) {
        settlePhoto(requestId, error);
        throw error;
      }
    },
    async removePhoto() {
      const action = scope.current;
      if (!action || !isCurrent(action)) throw new Error("Select an active workspace first.");
      const requestId = ++photoRequestId.current;
      setPhotoSaveState({ scope: action, requestId, pending: true, error: null });
      try {
        const result = await removeWorkspaceProfilePhoto(action.tenantId);
        if (!isCurrent(action)) { settlePhoto(requestId, null); return result; }
        const savedAt = Date.now();
        confirmPhotoDescriptor(action.owner.id, action.tenantId, result, savedAt);
        try { await saveLocalPhotoDescriptor(action.owner.id, action.tenantId, result, savedAt); }
        catch { /* The server removed the photo; keep this session's result. */ }
        settlePhoto(requestId, null);
        return result;
      } catch (error) {
        settlePhoto(requestId, error);
        throw error;
      }
    },
  };
}
