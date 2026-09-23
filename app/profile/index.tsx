import { useEffect, useRef, useState } from "react";
import { router } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { AccountHub } from "@/components/profile/account-hub";
import { useAuth } from "@/hooks/use-auth";
import { useChatStore } from "@/lib/chat/store";
import { useWorkspaceProfile } from "@/lib/profile/use-workspace-profile";
import { useSipAccountStore } from "@/lib/sip/account-store";
import { useProfilePhotoCacheScope } from "@/components/profile/profile-avatar";
import { isSupportedMime } from "@/lib/profile/photo-client";
import type { ProfilePhotoUpload } from "@/lib/profile/photo-client";

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
  const chat = useChatStore();
  const savedAccount = useSipAccountStore((state) => state.account);
  const account = savedAccount?.ownerUserId === user?.id ? savedAccount : null;
  const workspace = user && chat.userId === user.id ? chat.workspace : null;
  const workspaceProfile = useWorkspaceProfile(user, workspace?.id);
  const [pickerError, setPickerError] = useState<{ ownerId: number; tenantId: number; message: string } | null>(null);
  useEffect(() => { setPickerError(null); }, [user?.id, workspace?.id]);
  useProfilePhotoCacheScope(workspace?.id);
  const hydratedOwner = useRef<number | null>(null);
  useEffect(() => {
    if (!user) {
      hydratedOwner.current = null;
      return;
    }
    if (chat.userId !== user.id || chat.workspace || hydratedOwner.current === user.id) return;
    // Settings → My profile can open before Team Chat has loaded the user's
    // selected workspace. Resolve it once per owner; Retry remains explicit.
    hydratedOwner.current = user.id;
    void chat.loadChannels().catch(() => { /* The profile sheet exposes a retry action. */ });
  }, [chat.loadChannels, chat.userId, chat.workspace, user?.id]);
  const changePhoto = async (source: PhotoSource): Promise<boolean> => {
    if (!workspaceProfile.photoAvailable) return false;
    setPickerError(null);
    let upload: ProfilePhotoUpload;
    try {
      const picker = await import("expo-image-picker");
      if (source === "camera" && !(await picker.requestCameraPermissionsAsync()).granted)
        throw new Error("Allow camera access to take a profile photo.");
      if (source === "library" && !(await picker.requestMediaLibraryPermissionsAsync()).granted)
        throw new Error("Allow photo library access to choose a profile photo.");
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
      if (result.canceled) return false;
      const asset = result.assets[0];
      const mimeType = assetMime(asset);
      if (!mimeType) throw new Error("Choose a JPEG, PNG, or WebP photo.");
      upload = { uri: asset.uri, mimeType, sizeBytes: asset.fileSize,
        width: asset.width, height: asset.height, file: asset.file };
    } catch (error) {
      if (user && workspace) setPickerError({ ownerId: user.id, tenantId: workspace.id,
        message: error instanceof Error ? error.message : "Could not open photos. Try again." });
      return false;
    }
    await workspaceProfile.uploadPhoto(upload);
    return true;
  };
  const retryPhotoSetup = async () => {
    if (!user) return;
    const state = useChatStore.getState();
    if (state.userId !== user.id || !state.workspace) {
      await state.loadChannels();
      return;
    }
    await workspaceProfile.refetchPhotoSettings();
  };

  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]}>
      <AccountHub
        key={user && workspace ? `${user.id}:${workspace.id}` : `${user?.id ?? "signed-out"}:no-workspace`}
        identity={user ? { name: user.name, email: user.email } : null}
        phone={account ? { extension: account.username } : null}
        workspaceName={workspace?.name}
        onBack={() => router.back()}
        onOpenSettings={() => router.push("/(tabs)/settings")}
        workspaceProfile={workspaceProfile.profile}
        profileAvailable={workspaceProfile.profileAvailable}
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
          (pickerError && pickerError.ownerId === user?.id && pickerError.tenantId === workspace?.id ? pickerError.message : null)
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
