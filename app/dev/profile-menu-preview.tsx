import { useState } from "react";
import { Redirect } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { AccountHub } from "@/components/profile/account-hub";
import type { StatusExpiryPreset, WorkspaceProfileStatus, WorkspaceProfileUpdate } from "@/lib/profile/contracts";

function previewStatusExpiry(expiry: StatusExpiryPreset): Date | null {
  if (expiry === "always") return null;
  const now = new Date();
  if (expiry === "1h") return new Date(now.getTime() + 60 * 60_000);
  if (expiry === "4h") return new Date(now.getTime() + 4 * 60 * 60_000);
  if (expiry === "week") return new Date(now.getTime() + 7 * 24 * 60 * 60_000);
  const endOfToday = new Date(now);
  endOfToday.setHours(24, 0, 0, 0);
  return endOfToday;
}

/** Browser-only state reducer. It never reads or writes a real account. */
export function applyPreviewWorkspaceProfile(current: WorkspaceProfileStatus, update: WorkspaceProfileUpdate): WorkspaceProfileStatus {
  const next = { ...current };
  if (update.availability) {
    next.manualAvailability = update.availability.value;
    next.manualAvailabilityExpiresAt = update.availability.value === "dnd"
      ? new Date(Date.now() + Number(update.availability.expiresInMinutes) * 60_000)
      : update.availability.value === "busy"
        ? new Date(Date.now() + 24 * 60 * 60_000)
        : null;
  }
  if (update.status) {
    next.statusText = update.status.text?.trim() || null;
    if (!next.statusText) next.statusExpiresAt = null;
    else if (update.status.expiry !== undefined) next.statusExpiresAt = previewStatusExpiry(update.status.expiry);
  }
  if (update.workLocation !== undefined) next.workLocation = update.workLocation;
  return next;
}

/** Browser-only layout preview. Its changes stay in local component state. */
export default function ProfileMenuPreview() {
  const [profile, setProfile] = useState<WorkspaceProfileStatus>({
    userId: 1,
    manualAvailability: null,
    manualAvailabilityExpiresAt: null,
    statusText: "Reviewing the release candidate",
    statusExpiresAt: null,
    workLocation: "office",
  });
  if (!__DEV__) return <Redirect href="/(tabs)/settings" />;
  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]}>
      <AccountHub
        identity={{ name: "Preview account", email: "preview@phone11.invalid" }}
        phone={{ extension: "3001" }}
        onBack={() => {}}
        onOpenSettings={() => {}}
        workspaceProfile={profile}
        profileAvailable
        profileSaving={false}
        profileError={null}
        onUpdateWorkspaceProfile={async (update) => { setProfile((current) => applyPreviewWorkspaceProfile(current, update)); }}
        workspaceName="Phone11"
        isPreview
      />
    </ScreenContainer>
  );
}
