import { router } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { AccountHub } from "@/components/profile/account-hub";
import { useAuth } from "@/hooks/use-auth";
import { useWorkspaceProfile } from "@/lib/profile/use-workspace-profile";
import { useSipAccountStore } from "@/lib/sip/account-store";

export default function ProfileScreen() {
  const { user } = useAuth({ autoFetch: false });
  const savedAccount = useSipAccountStore((state) => state.account);
  const account = savedAccount?.ownerUserId === user?.id ? savedAccount : null;
  const workspaceProfile = useWorkspaceProfile(account?.tenantId);

  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]}>
      <AccountHub
        identity={user ? { name: user.name, email: user.email } : null}
        phone={account ? { extension: account.username } : null}
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
