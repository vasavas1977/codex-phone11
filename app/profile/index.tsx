import { router } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { AccountHub } from "@/components/profile/account-hub";
import { useAuth } from "@/hooks/use-auth";
import { useChatStore } from "@/lib/chat/store";
import { useWorkspaceProfile } from "@/lib/profile/use-workspace-profile";
import { useSipAccountStore } from "@/lib/sip/account-store";

export default function ProfileScreen() {
  const { user } = useAuth({ autoFetch: false });
  const chat = useChatStore();
  const savedAccount = useSipAccountStore((state) => state.account);
  const account = savedAccount?.ownerUserId === user?.id ? savedAccount : null;
  const workspace = user && chat.userId === user.id ? chat.workspace : null;
  const workspaceProfile = useWorkspaceProfile(user, workspace?.id);

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
      />
    </ScreenContainer>
  );
}
