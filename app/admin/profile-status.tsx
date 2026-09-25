import { useState } from "react";
import { AdminWorkspaceBoundary } from "@/components/admin/admin-workspace-boundary";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { portalSignInRoute } from "@/constants/oauth";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/use-colors";
import { usePbxAdminWorkspace } from "@/hooks/use-pbx-admin";
import { trpc } from "@/lib/trpc";

function message(error: unknown) {
  return error instanceof Error ? error.message : "The workspace profile setting was not saved.";
}

function isPreconditionFailure(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const data = (error as { data?: unknown }).data;
  return Boolean(data && typeof data === "object" && (data as { code?: unknown }).code === "PRECONDITION_FAILED");
}

function ProfileStatusState({
  title,
  description,
  checking = false,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  checking?: boolean;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const colors = useColors();
  return (
    <ScreenContainer>
      <View style={styles.state}>
        {checking ? <ActivityIndicator color={colors.primary} /> : null}
        <Text accessibilityRole="header" style={[styles.stateTitle, { color: colors.foreground }]}>
          {title}
        </Text>
        <Text accessibilityRole="alert" style={[styles.stateDescription, { color: colors.muted }]}>
          {description}
        </Text>
        {actionLabel && onAction ? (
          <Pressable accessibilityRole="button" accessibilityLabel={actionLabel} onPress={onAction}
            style={[styles.stateAction, { borderColor: colors.primary }]}>
            <Text style={{ color: colors.primary, fontWeight: "600" }}>{actionLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </ScreenContainer>
  );
}

export default function ProfileStatusAdminScreen() {
  return (
    <AdminWorkspaceBoundary>
      <ProfileStatusAdminScreenContent />
    </AdminWorkspaceBoundary>
  );
}

function ProfileStatusAdminScreenContent() {
  const colors = useColors();
  const { user } = useAuth({ autoFetch: false });
  const workspace = usePbxAdminWorkspace();
  const tenantId = workspace.selectedTenantId;
  const tenantQuery = trpc.pbx.tenant.get.useQuery({ tenantId: tenantId ?? 0 }, {
    enabled: Boolean(user) && tenantId !== null,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const tenant = tenantQuery.data;
  const canManage = ["owner", "admin"].includes(String(tenant?.userRole ?? ""));
  const settingsQuery = trpc.profile.adminSettings.useQuery({ tenantId: tenantId ?? 0 }, {
    enabled: Boolean(user) && canManage && tenantId !== null && tenant?.id === tenantId,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const setEnabled = trpc.profile.setAdminEnabled.useMutation();
  const utils = trpc.useUtils();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/admin");
  };

  if (!user) {
    return <ProfileStatusState title="Sign in to manage workspace profile status"
      description="Only a workspace owner or administrator can enable profile status."
      actionLabel="Sign in" onAction={() => router.replace(portalSignInRoute("/admin"))} />;
  }
  if (workspace.membershipsQuery.isLoading || tenantQuery.isLoading || tenantQuery.isFetching) {
    return <ProfileStatusState checking title="Checking workspace access"
      description="Phone11 is confirming your role in the selected workspace." />;
  }
  if (tenantQuery.isError || !tenant) {
    return <ProfileStatusState title="Workspace settings are unavailable"
      description="Phone11 could not confirm the selected workspace and your current role. No setting can be changed."
      actionLabel="Try again" onAction={() => void tenantQuery.refetch()} />;
  }
  if (!canManage) {
    return <ProfileStatusState title="Administrator access required"
      description="Only active workspace owners and administrators can enable or disable profile status."
      actionLabel="Back to workspace administration" onAction={goBack} />;
  }
  if (settingsQuery.isLoading || settingsQuery.isFetching) {
    return <ProfileStatusState checking title="Checking profile status settings"
      description="Phone11 is confirming that the profile status schema is available for this workspace." />;
  }
  if (settingsQuery.isError || !settingsQuery.data) {
    const missing = isPreconditionFailure(settingsQuery.error);
    return <ProfileStatusState title={missing ? "Profile status is not commissioned" : "Profile status settings are unavailable"}
      description={missing
        ? "Apply the reviewed workspace profile migration before an administrator can enable this feature. Existing profile rows remain hidden until this workspace is enabled."
        : "Phone11 could not verify this workspace setting. No change was made."}
      actionLabel={missing ? "Back to workspace administration" : "Try again"}
      onAction={missing ? goBack : () => void settingsQuery.refetch()} />;
  }

  const saveEnabled = async (enabled: boolean) => {
    if (setEnabled.isPending || tenantId === null || tenant.id !== tenantId) return;
    setSaveError(null);
    setSavedMessage(null);
    try {
      await setEnabled.mutateAsync({ tenantId, enabled });
      setSavedMessage(enabled ? "Workspace profile status enabled." : "Workspace profile status disabled.");
      await utils.profile.adminSettings.invalidate({ tenantId });
    } catch (error) {
      setSaveError(message(error));
    }
  };

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back to workspace administration"
            onPress={goBack} style={styles.backButton}>
            <IconSymbol name="chevron.left" size={22} color={colors.primary} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>Workspace profile status</Text>
            <Text style={[styles.subtitle, { color: colors.muted }]}>{tenant.name || "Active workspace"}</Text>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.icon, { backgroundColor: colors.primary + "16" }]}>
            <IconSymbol name="person.crop.circle.badge.checkmark" size={20} color={colors.primary} />
          </View>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Enable workspace status</Text>
          <Text style={[styles.description, { color: colors.muted }]}>
            Members can manage their own availability, status text, and work location. Do not disturb suppresses ordinary Team Chat alerts while it is active; it does not change call or meeting routing.
          </Text>

          <View style={[styles.setting, { borderColor: colors.border, backgroundColor: colors.background }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.settingTitle, { color: colors.foreground }]}>Profile status and Do not disturb</Text>
              <Text style={[styles.settingDescription, { color: colors.muted }]}>
                {settingsQuery.data.enabled ? "Enabled for this workspace." : "Disabled. Saved profile rows stay private until you enable this setting."}
              </Text>
            </View>
            <Switch accessibilityLabel="Enable workspace profile status"
              accessibilityState={{ disabled: setEnabled.isPending, checked: settingsQuery.data.enabled }}
              disabled={setEnabled.isPending} value={settingsQuery.data.enabled} onValueChange={(value) => void saveEnabled(value)}
              trackColor={{ false: colors.border, true: colors.primary }} />
          </View>

          {saveError ? <Text accessibilityRole="alert" style={[styles.feedback, { color: colors.error }]}>{saveError}</Text> : null}
          {savedMessage ? <Text accessibilityLiveRegion="polite" style={[styles.feedback, { color: colors.success }]}>{savedMessage}</Text> : null}
          {setEnabled.isPending ? <ActivityIndicator style={{ marginTop: 14 }} color={colors.primary} /> : null}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { alignSelf: "center", maxWidth: 680, padding: 20, width: "100%" },
  header: { alignItems: "center", borderBottomWidth: 0.5, flexDirection: "row", gap: 12, marginBottom: 20, paddingBottom: 16 },
  backButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: 4 },
  title: { fontSize: 24, fontWeight: "700" },
  subtitle: { fontSize: 14, marginTop: 3 },
  card: { borderRadius: 16, borderWidth: 1, padding: 20 },
  icon: { alignItems: "center", borderRadius: 20, height: 40, justifyContent: "center", marginBottom: 14, width: 40 },
  cardTitle: { fontSize: 20, fontWeight: "700" },
  description: { fontSize: 14, lineHeight: 21, marginTop: 8 },
  setting: { alignItems: "center", borderRadius: 12, borderWidth: 1, flexDirection: "row", gap: 16, marginTop: 20, padding: 14 },
  settingTitle: { fontSize: 15, fontWeight: "600" },
  settingDescription: { fontSize: 13, lineHeight: 19, marginTop: 5 },
  feedback: { fontSize: 14, lineHeight: 20, marginTop: 12 },
  state: { alignItems: "center", flex: 1, justifyContent: "center", padding: 32 },
  stateTitle: { fontSize: 22, fontWeight: "700", textAlign: "center" },
  stateDescription: { fontSize: 15, lineHeight: 22, marginTop: 12, maxWidth: 420, textAlign: "center" },
  stateAction: { borderRadius: 10, borderWidth: 1, marginTop: 22, minHeight: 44, justifyContent: "center", paddingHorizontal: 16 },
});
