import { Fragment, type ReactNode } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { portalSignInRoute } from "@/constants/oauth";
import { isAdminSessionUnauthorized } from "@/lib/admin/session-recovery";
import { useAdminAuthState } from "./use-admin-auth-state";
import { useColors } from "@/hooks/use-colors";
import { usePbxAdminWorkspace } from "@/hooks/use-pbx-admin";

/** Keeps implicit-tenant API calls unmounted for accounts with more than one workspace. */
export function AdminWorkspaceBoundary({
  children,
  requiresImplicitTenant = false,
}: {
  children: ReactNode;
  requiresImplicitTenant?: boolean;
}) {
  const colors = useColors();
  const {
    user,
    checking: authChecking,
    unavailable: authUnavailable,
    retry: retryAuth,
  } = useAdminAuthState();
  const workspace = usePbxAdminWorkspace();
  const sessionExpired =
    (workspace.membershipsQuery.isError &&
      isAdminSessionUnauthorized(workspace.membershipsQuery.error)) ||
    (workspace.admissionError &&
      isAdminSessionUnauthorized(workspace.tenantQuery?.error));
  const requiresSignIn = !authChecking && !authUnavailable && (!user || sessionExpired);

  let title = "";
  let detail = "";
  let loading = false;
  if (authChecking) {
    title = "Checking your session";
    detail = "Phone11 is confirming your signed-in account.";
    loading = true;
  } else if (authUnavailable) {
    title = "Session verification unavailable";
    detail = "Phone11 could not verify your session. Try again.";
  } else if (!user) {
    title = "Sign in to manage Phone11";
    detail = "Open the admin portal after signing in.";
  } else if (sessionExpired) {
    title = "Sign in again to manage Phone11";
    detail = "Your session has expired. Sign in again to confirm your workspace access.";
  } else if (
    workspace.membershipsQuery.isLoading ||
    workspace.admissionChecking
  ) {
    title = "Checking workspace access";
    detail = "Phone11 is confirming your workspace membership.";
    loading = true;
  } else if (workspace.membershipsQuery.isError) {
    title = "Workspace access unavailable";
    detail = "Phone11 could not confirm your workspace membership. Try again.";
  } else if (workspace.manageableMemberships.length === 0) {
    title = "Administrator access required";
    detail = "Only a workspace owner or administrator can manage Phone11.";
  } else if (workspace.updateRequired) {
    title = "Workspace API update required";
    detail =
      "This server cannot safely select between your workspaces. Administration will be available after the workspace API is updated.";
  } else if (workspace.admissionError) {
    title = "Workspace access unavailable";
    detail =
      "Phone11 could not confirm the current workspace identity and administrator role. Try again.";
  } else if (workspace.selectedTenantId === null) {
    title = "Choose a workspace";
    detail = "Select the workspace you want to manage in the admin portal.";
  } else if (requiresImplicitTenant && !workspace.canUseImplicitTenant) {
    title = "This setting needs workspace support";
    detail =
      "This PBX section cannot safely target a selected workspace yet. Phone11 will enable it when its server accepts an explicit workspace for these settings.";
  } else {
    // Remount forms and editors on a workspace change so an unsaved row from
    // the previous workspace can never be submitted to the new one.
    return <Fragment key={workspace.selectedTenantId}>{children}</Fragment>;
  }

  return (
    <ScreenContainer>
      <View style={styles.state}>
        {loading ? <ActivityIndicator color={colors.primary} /> : null}
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: colors.foreground }]}
        >
          {title}
        </Text>
        <Text
          accessibilityRole="alert"
          style={[styles.detail, { color: colors.muted }]}
        >
          {detail}
        </Text>
        {requiresSignIn ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Sign in"
            onPress={() => router.replace(portalSignInRoute("/admin"))}
            style={[styles.button, { borderColor: colors.primary }]}
          >
            <Text style={{ color: colors.primary }}>Sign in</Text>
          </TouchableOpacity>
        ) : !authChecking &&
        (authUnavailable ||
          (user &&
            (workspace.membershipsQuery.isError ||
              workspace.admissionError ||
              workspace.updateRequired))) ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Try again"
            onPress={() =>
              void (authUnavailable
                ? retryAuth()
                : workspace.membershipsQuery.refetch())
            }
            style={[styles.button, { borderColor: colors.primary }]}
          >
            <Text style={{ color: colors.primary }}>Try again</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Back to admin portal"
          onPress={() => router.replace("/admin")}
          style={[styles.button, { borderColor: colors.primary }]}
        >
          <Text style={{ color: colors.primary }}>Back to admin portal</Text>
        </TouchableOpacity>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  state: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  title: { fontSize: 21, fontWeight: "700", textAlign: "center" },
  detail: {
    fontSize: 14,
    lineHeight: 21,
    marginTop: 10,
    maxWidth: 400,
    textAlign: "center",
  },
  button: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 11,
    marginTop: 20,
  },
});
