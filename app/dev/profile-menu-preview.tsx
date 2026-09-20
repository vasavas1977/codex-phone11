import { Redirect } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { AccountHub } from "@/components/profile/account-hub";

/** Browser-only layout preview. It never reads or writes a real account. */
export default function ProfileMenuPreview() {
  if (!__DEV__) return <Redirect href="/(tabs)/settings" />;
  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]}>
      <AccountHub
        identity={{ name: "Preview account", email: "preview@phone11.invalid" }}
        phone={{ extension: "3001" }}
        onBack={() => {}}
        onOpenSettings={() => {}}
        workspaceProfile={{ userId: 1, manualAvailability: null, manualAvailabilityExpiresAt: null, statusText: "Reviewing the release candidate", statusExpiresAt: null, workLocation: "office" }}
        profileAvailable
        profileSaving={false}
        profileError={null}
        onUpdateWorkspaceProfile={async () => undefined}
        isPreview
      />
    </ScreenContainer>
  );
}
