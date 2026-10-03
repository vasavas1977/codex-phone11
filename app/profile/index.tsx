import { useEffect, useRef, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { AccountHub } from "@/components/profile/account-hub";
import { useAuth } from "@/hooks/use-auth";
import { useChatStore } from "@/lib/chat/store";
import { useWorkspaceProfile } from "@/lib/profile/use-workspace-profile";
import { useSipAccountStore } from "@/lib/sip/account-store";
import { useProfilePhotoCacheScope } from "@/components/profile/profile-avatar";
import { isSupportedMime } from "@/lib/profile/photo-client";
import type { ProfilePhotoUpload } from "@/lib/profile/photo-client";
import { getAuthSnapshot } from "@/lib/_core/auth";

type PhotoSource = "camera" | "library";

function assetMime(asset: {
  mimeType?: string | null;
  fileName?: string | null;
  uri: string;
}): string | null {
  const declared = asset.mimeType?.split(";", 1)[0]?.trim().toLowerCase();
  if (declared && isSupportedMime(declared)) return declared;
  const path = (asset.fileName || asset.uri).toLowerCase();
  if (/\.jpe?g(?:$|[?#])/.test(path)) return "image/jpeg";
  if (/\.png(?:$|[?#])/.test(path)) return "image/png";
  if (/\.webp(?:$|[?#])/.test(path)) return "image/webp";
  return null;
}

export default function ProfileScreen() {
  const { user } = useAuth({ autoFetch: false });
  const params = useLocalSearchParams<{ view?: string; ownerId?: string; tenantId?: string }>();
  const auth = getAuthSnapshot();
  const owner = user && auth.user === user && !auth.loading ? user : null;
  const chat = useChatStore();
  const savedAccount = useSipAccountStore((state) => state.account);
  const workspace = owner && chat.userId === owner.id ? chat.workspace : null;
  const account = owner && workspace && savedAccount?.ownerUserId === owner.id &&
    savedAccount.tenantId === workspace.id && savedAccount.username.trim() ? savedAccount : null;
  const workspaceProfile = useWorkspaceProfile(owner, workspace?.id);
  // Remount the details/photo UI on session replacement, including the same
  // numeric owner. A URL entry preference cannot survive a scope replacement.
  const scope = useRef({ owner, tenantId: workspace?.id, epoch: 0 });
  if (scope.current.owner !== owner || scope.current.tenantId !== workspace?.id)
    scope.current = { owner, tenantId: workspace?.id, epoch: scope.current.epoch + 1 };
  const action = scope.current;
  useEffect(() => () => {
    scope.current = { owner: null, tenantId: undefined, epoch: scope.current.epoch + 1 };
  }, []);
  const entryScope = useRef<{ action: typeof action; view: "details" | "photo" } | null>(null);
  const requestedView = params.view === "details" || params.view === "photo" ? params.view : undefined;
  const validEntry = !!owner && !!workspace && requestedView &&
    params.ownerId === String(owner.id) && params.tenantId === String(workspace.id);
  if (validEntry && !entryScope.current) entryScope.current = { action, view: requestedView };
  const entryView = validEntry && entryScope.current?.action === action && entryScope.current.view === requestedView
    ? requestedView : undefined;
  const isCurrent = () => {
    const currentAuth = getAuthSnapshot();
    const state = useChatStore.getState();
    return scope.current === action && !!action.owner && currentAuth.user === action.owner &&
      !currentAuth.loading && state.userId === action.owner.id && state.workspace?.id === action.tenantId;
  };
  const [pickerError, setPickerError] = useState<{ action: typeof action; message: string } | null>(null);
  useEffect(() => { setPickerError(null); }, [action]);
  useProfilePhotoCacheScope(workspace?.id);
  const { loadChannels, userId: chatOwnerId, workspace: chatWorkspace } = chat;
  const hydratedOwner = useRef<typeof owner>(null);
  useEffect(() => {
    if (!owner) {
      hydratedOwner.current = null;
      return;
    }
    if (chatOwnerId !== owner.id || chatWorkspace || hydratedOwner.current === owner) return;
    // Settings → My profile can open before Team Chat has loaded the user's
    // selected workspace. Resolve it once per owner; Retry remains explicit.
    hydratedOwner.current = owner;
    void loadChannels().catch(() => { /* The profile sheet exposes a retry action. */ });
  }, [loadChannels, chatOwnerId, chatWorkspace, owner]);
  const changePhoto = async (source: PhotoSource): Promise<boolean> => {
    if (!workspaceProfile.photoAvailable || !isCurrent()) return false;
    setPickerError(null);
    let upload: ProfilePhotoUpload;
    try {
      const picker = await import("expo-image-picker");
      if (!isCurrent()) return false;
      if (source === "camera" && !(await picker.requestCameraPermissionsAsync()).granted)
        throw new Error("Allow camera access to take a profile photo.");
      if (source === "library" && !(await picker.requestMediaLibraryPermissionsAsync()).granted)
        throw new Error("Allow photo library access to choose a profile photo.");
      if (!isCurrent()) return false;
      const result = source === "camera"
        ? await picker.launchCameraAsync({
            mediaTypes: ["images"], cameraType: picker.CameraType.front,
            allowsEditing: true, aspect: [1, 1], quality: 0.85,
          })
        : await picker.launchImageLibraryAsync({
            mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.85,
            // iOS supplies a compatible representation, including a JPEG when
            // a picked HEIC needs conversion for the server's safe formats.
            preferredAssetRepresentationMode: picker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
          });
      if (!isCurrent() || result.canceled) return false;
      const asset = result.assets[0];
      const mimeType = assetMime(asset);
      if (!mimeType) throw new Error("Choose a JPEG, PNG, or WebP photo.");
      upload = { uri: asset.uri, mimeType, sizeBytes: asset.fileSize,
        width: asset.width, height: asset.height, file: asset.file };
    } catch (error) {
      if (isCurrent()) setPickerError({ action,
        message: error instanceof Error ? error.message : "Could not open photos. Try again." });
      return false;
    }
    await workspaceProfile.uploadPhoto(upload);
    return isCurrent();
  };
  const retryPhotoSetup = async () => {
    if (!owner || getAuthSnapshot().user !== owner) return;
    const state = useChatStore.getState();
    if (state.userId !== owner.id || !state.workspace) {
      await state.loadChannels();
      return;
    }
    if (isCurrent()) await workspaceProfile.refetchPhotoSettings();
  };
  const workspaceLoading = !!owner && chatOwnerId === owner.id && !workspace && chat.loading;
  const workspaceLoadError = !!owner && chatOwnerId === owner.id && !workspace && !!chat.error;
  const retryWorkspaceProfile = async () => {
    const currentAuth = getAuthSnapshot();
    const state = useChatStore.getState();
    if (scope.current !== action || !owner || currentAuth.user !== owner || currentAuth.loading || state.userId !== owner.id) return;
    if (!state.workspace) {
      await state.loadChannels();
      return;
    }
    if (isCurrent()) await workspaceProfile.refetchProfile();
  };

  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]}>
      <AccountHub
        key={`${owner?.id ?? "signed-out"}:${workspace?.id ?? "no-workspace"}:${action.epoch}:${entryView ?? "hub"}`}
        entryView={entryView}
        identity={owner ? { name: owner.name, email: owner.email } : null}
        phone={account ? { extension: account.username } : null}
        workspaceName={workspace?.name}
        onBack={() => router.back()}
        onOpenSettings={() => router.push("/(tabs)/settings")}
        workspaceProfile={workspaceProfile.profile}
        profileAvailable={workspaceProfile.profileAvailable}
        profileLoading={workspaceLoading || workspaceProfile.loading}
        profileLoadError={(!workspaceLoading && workspaceLoadError) || workspaceProfile.loadError}
        profileUnavailable={workspaceProfile.profileUnavailable}
        onRetryWorkspaceProfile={retryWorkspaceProfile}
        profileSaving={workspaceProfile.saving}
        profileError={workspaceProfile.error ? "Could not save profile settings. Try again." : null}
        onUpdateWorkspaceProfile={workspaceProfile.save}
        workspaceId={workspace?.id}
        profilePhotoAvailable={workspaceProfile.photoAvailable}
        profilePhotoDescriptor={workspaceProfile.photoDescriptor}
        profilePhotoChecking={workspace
          ? workspaceProfile.photoCapabilityLoading
          : !!user && chat.userId === user.id && chat.loading}
        profilePhotoCheckError={workspaceProfile.photoCapabilityError || (!workspace && !!chat.error)}
        profilePhotoSaving={workspaceProfile.photoSaving}
        profilePhotoError={
          (pickerError?.action === action ? pickerError.message : null)
          ?? (workspaceProfile.photoError instanceof Error
            ? workspaceProfile.photoError.message
            : workspaceProfile.photoError
              ? "Could not update profile photo. Try again."
              : null)
        }
        onChangeProfilePhoto={changePhoto}
        onRemoveProfilePhoto={workspaceProfile.removePhoto}
        onRetryProfilePhoto={retryPhotoSetup}
      />
    </ScreenContainer>
  );
}
