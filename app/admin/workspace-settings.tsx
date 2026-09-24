import { useEffect, useRef, useState } from "react";
import { AdminWorkspaceBoundary } from "@/components/admin/admin-workspace-boundary";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { portalSignInRoute } from "@/constants/oauth";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/use-colors";
import { usePbxAdminWorkspace } from "@/hooks/use-pbx-admin";
import {
  BUSINESS_HOURS_TIMEZONE_CAPABILITY,
  canManageWorkspaceTimezone,
  normalizeIanaTimezone,
} from "@/lib/pbx/workspace-timezone";
import { trpc } from "@/lib/trpc";

function readableError(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The timezone was not saved. Please try again.";
}

function WorkspaceSettingsState({
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
        <Text
          accessibilityRole="header"
          style={[styles.stateTitle, { color: colors.foreground }]}
        >
          {title}
        </Text>
        <Text
          accessibilityRole="alert"
          style={[styles.stateDescription, { color: colors.muted }]}
        >
          {description}
        </Text>
        {actionLabel && onAction ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={actionLabel}
            onPress={onAction}
            style={[styles.stateAction, { borderColor: colors.primary }]}
          >
            <Text style={{ color: colors.primary, fontWeight: "600" }}>
              {actionLabel}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </ScreenContainer>
  );
}

export default function WorkspaceSettingsScreen() {
  return (
    <AdminWorkspaceBoundary>
      <WorkspaceSettingsScreenContent />
    </AdminWorkspaceBoundary>
  );
}

function WorkspaceSettingsScreenContent() {
  const colors = useColors();
  const { user } = useAuth({ autoFetch: false });
  const workspace = usePbxAdminWorkspace();
  // Schema-backed settings availability is a write gate, so do not reuse a
  // cached observation when this page opens.
  const tenantQuery = trpc.pbx.tenant.get.useQuery({
    tenantId: workspace.selectedTenantId ?? 0,
  }, {
    enabled: Boolean(user) && workspace.selectedTenantId !== null,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const updateSettings = trpc.pbx.tenant.updateSettings.useMutation();
  const utils = trpc.useUtils();
  const tenant = tenantQuery.data;
  const savedTimezone =
    typeof tenant?.business_hours_timezone === "string" &&
    tenant.business_hours_timezone.trim()
      ? tenant.business_hours_timezone.trim()
      : null;
  const [draft, setDraft] = useState("");
  const [isEdited, setIsEdited] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const loadedWorkspaceId = useRef<number | null>(null);

  // Reset the editor when its active workspace changes. A server readback may
  // refresh an untouched draft, but never replaces an administrator's edit.
  useEffect(() => {
    const tenantId = typeof tenant?.id === "number" ? tenant.id : null;
    if (tenantId === null) return;
    if (loadedWorkspaceId.current !== tenantId) {
      loadedWorkspaceId.current = tenantId;
      setDraft(savedTimezone || "");
      setIsEdited(false);
      setSaveError(null);
      setSavedMessage(null);
      return;
    }
    if (!isEdited) setDraft(savedTimezone || "");
  }, [isEdited, savedTimezone, tenant?.id]);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/admin");
  };

  if (!user) {
    return (
      <WorkspaceSettingsState
        title="Sign in to manage workspace settings"
        description="Workspace timezone settings are available after you sign in with an owner or administrator account."
        actionLabel="Sign in"
        onAction={() => router.replace(portalSignInRoute("/admin"))}
      />
    );
  }

  if (tenantQuery.isLoading || tenantQuery.isFetching) {
    return (
      <WorkspaceSettingsState
        checking
        title="Checking workspace settings"
        description="Phone11 is confirming whether this workspace supports timezone settings."
      />
    );
  }

  if (tenantQuery.isError || !tenant) {
    return (
      <WorkspaceSettingsState
        title="Workspace settings are unavailable"
        description="Phone11 could not confirm the active workspace settings. No timezone changes are available."
        actionLabel="Try again"
        onAction={() => void tenantQuery.refetch()}
      />
    );
  }

  const roleCanManage = ["owner", "admin"].includes(
    String(tenant.userRole || ""),
  );
  const settingsAvailable = tenant.settingsAvailable === true;
  const timezoneSupported =
    tenant.supportedSettings?.includes(BUSINESS_HOURS_TIMEZONE_CAPABILITY) ===
    true;
  const canManage = canManageWorkspaceTimezone(tenant);

  if (!roleCanManage) {
    return (
      <WorkspaceSettingsState
        title="Administrator access required"
        description="Only workspace owners and administrators can change the workspace timezone."
        actionLabel="Back to workspace administration"
        onAction={goBack}
      />
    );
  }

  if (!settingsAvailable || !timezoneSupported || !canManage) {
    return (
      <WorkspaceSettingsState
        title="Workspace timezone is unavailable"
        description="This server has not confirmed support for the workspace timezone. Phone11 will not load or change it."
        actionLabel="Back to workspace administration"
        onAction={goBack}
      />
    );
  }

  const saveTimezone = async () => {
    if (
      updateSettings.isPending ||
      workspace.selectedTenantId === null ||
      tenant.id !== workspace.selectedTenantId
    ) return;
    const timezone = normalizeIanaTimezone(draft);
    if (!timezone) {
      setSavedMessage(null);
      setSaveError("Enter a supported IANA time zone, such as Asia/Bangkok.");
      return;
    }

    setSaveError(null);
    setSavedMessage(null);
    try {
      await updateSettings.mutateAsync({
        tenantId: workspace.selectedTenantId,
        businessHoursTimezone: timezone,
      });
      setDraft(timezone);
      setIsEdited(false);
      setSavedMessage("Workspace timezone saved.");
      await utils.pbx.tenant.get.invalidate();
    } catch (error) {
      setSaveError(readableError(error));
    }
  };

  const saveDisabled =
    updateSettings.isPending || (!isEdited && draft === (savedTimezone || ""));

  return (
    <ScreenContainer>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to workspace administration"
            onPress={goBack}
            style={styles.backButton}
          >
            <IconSymbol name="chevron.left" size={22} color={colors.primary} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text
              accessibilityRole="header"
              style={[styles.title, { color: colors.foreground }]}
            >
              Workspace settings
            </Text>
            <Text style={[styles.subtitle, { color: colors.muted }]}>
              {tenant.name || "Active workspace"}
            </Text>
          </View>
        </View>

        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View
            style={[styles.icon, { backgroundColor: colors.primary + "16" }]}
          >
            <IconSymbol name="globe" size={20} color={colors.primary} />
          </View>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>
            Workspace timezone
          </Text>
          <Text style={[styles.description, { color: colors.muted }]}>
            This stores the workspace’s administrative timezone. It does not
            change call routing, business hours, or PBX schedules.
          </Text>

          <View
            style={[
              styles.current,
              {
                borderColor: colors.border,
                backgroundColor: colors.background,
              },
            ]}
          >
            <Text style={[styles.currentLabel, { color: colors.muted }]}>
              Current setting
            </Text>
            <Text style={[styles.currentValue, { color: colors.foreground }]}>
              {savedTimezone || "Unset — no workspace timezone has been saved."}
            </Text>
          </View>

          <Text style={[styles.inputLabel, { color: colors.foreground }]}>
            IANA timezone
          </Text>
          <TextInput
            accessibilityLabel="Workspace timezone"
            accessibilityHint="Enter an IANA timezone such as Asia/Bangkok"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!updateSettings.isPending}
            onChangeText={(value) => {
              setDraft(value);
              setIsEdited(true);
              setSaveError(null);
              setSavedMessage(null);
            }}
            placeholder="Asia/Bangkok"
            placeholderTextColor={colors.muted}
            style={[
              styles.input,
              {
                color: colors.foreground,
                borderColor: colors.border,
                backgroundColor: colors.background,
              },
            ]}
            value={draft}
          />
          <Text style={[styles.help, { color: colors.muted }]}>
            Use a supported IANA timezone, for example Asia/Bangkok or
            Europe/London.
          </Text>

          {saveError ? (
            <Text
              accessibilityRole="alert"
              style={[styles.feedback, { color: colors.error }]}
            >
              {saveError}
            </Text>
          ) : null}
          {savedMessage ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[styles.feedback, { color: colors.success }]}
            >
              {savedMessage}
            </Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save workspace timezone"
            accessibilityState={{
              disabled: saveDisabled,
              busy: updateSettings.isPending,
            }}
            disabled={saveDisabled}
            onPress={saveTimezone}
            style={[
              styles.saveButton,
              { backgroundColor: colors.primary },
              saveDisabled && styles.saveButtonDisabled,
            ]}
          >
            <Text style={styles.saveButtonText}>
              {updateSettings.isPending ? "Saving…" : "Save timezone"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { alignSelf: "center", maxWidth: 640, padding: 20, width: "100%" },
  header: {
    alignItems: "center",
    borderBottomWidth: 0.5,
    flexDirection: "row",
    gap: 12,
    marginBottom: 20,
    paddingBottom: 16,
  },
  backButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: 4 },
  title: { fontSize: 24, fontWeight: "700" },
  subtitle: { fontSize: 14, marginTop: 3 },
  card: { borderRadius: 16, borderWidth: 1, padding: 20 },
  icon: {
    alignItems: "center",
    borderRadius: 20,
    height: 40,
    justifyContent: "center",
    marginBottom: 14,
    width: 40,
  },
  cardTitle: { fontSize: 20, fontWeight: "700" },
  description: { fontSize: 14, lineHeight: 21, marginTop: 8 },
  current: { borderRadius: 12, borderWidth: 1, marginTop: 20, padding: 14 },
  currentLabel: { fontSize: 12, fontWeight: "600", textTransform: "uppercase" },
  currentValue: { fontSize: 15, lineHeight: 21, marginTop: 5 },
  inputLabel: { fontSize: 15, fontWeight: "600", marginTop: 20 },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    fontSize: 16,
    marginTop: 8,
    minHeight: 48,
    paddingHorizontal: 13,
  },
  help: { fontSize: 13, lineHeight: 19, marginTop: 8 },
  feedback: { fontSize: 14, lineHeight: 20, marginTop: 12 },
  saveButton: {
    alignItems: "center",
    borderRadius: 10,
    justifyContent: "center",
    marginTop: 20,
    minHeight: 48,
    paddingHorizontal: 18,
  },
  saveButtonDisabled: { opacity: 0.45 },
  saveButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  state: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: 32,
  },
  stateTitle: { fontSize: 22, fontWeight: "700", textAlign: "center" },
  stateDescription: {
    fontSize: 15,
    lineHeight: 22,
    marginTop: 12,
    maxWidth: 420,
    textAlign: "center",
  },
  stateAction: {
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 22,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
});
