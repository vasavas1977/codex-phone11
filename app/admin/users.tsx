/**
 * Workspace people administration.
 *
 * Existing membership management and capability-gated invitations.
 */
import { useMemo, useState } from "react";
import { AdminWorkspaceBoundary } from "@/components/admin/admin-workspace-boundary";
import { AdminInvitations } from "@/components/admin/admin-invitations";
import * as Auth from "@/lib/_core/auth";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import {
  AdminPeopleMember,
  AdminPeopleTable,
} from "@/components/admin/admin-people-table";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { useDirectory } from "@/hooks/use-directory";
import {
  useTenant,
  useTenantMembers,
  useUpdateTenantMember,
  usePbxAdminWorkspace,
} from "@/hooks/use-pbx-admin";

type MembershipStatus = "active" | "inactive";

type TenantMember = AdminPeopleMember;

function displayName(member: TenantMember) {
  return member.name?.trim() || member.email?.trim() || `Member ${member.id}`;
}

function readableError(error: unknown) {
  return error instanceof Error ? error.message : "Please try again.";
}

export default function AdminUsers() {
  return (
    <AdminWorkspaceBoundary>
      <AdminUsersContent />
    </AdminWorkspaceBoundary>
  );
}

function AdminUsersContent() {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const wideWeb = Platform.OS === "web" && width >= 1000;
  const { user } = useAuth({ autoFetch: false });
  const workspace = usePbxAdminWorkspace();
  const tenantQuery = useTenant();
  const tenantId = tenantQuery.data?.id;
  const actorRole = String(tenantQuery.data?.userRole || "");
  const canManage = ["owner", "admin"].includes(actorRole);
  const canManageAdministrators = actorRole === "owner";
  const membersQuery = useTenantMembers(tenantQuery.isSuccess && canManage);
  const directory = useDirectory(tenantId, tenantQuery.isSuccess && canManage);
  const updateMember = useUpdateTenantMember();

  const [editing, setEditing] = useState<TenantMember | null>(null);
  const [selectedRole, setSelectedRole] = useState<"admin" | "user">("user");
  const [roleChanged, setRoleChanged] = useState(false);
  const [selectedStatus, setSelectedStatus] =
    useState<MembershipStatus>("active");
  const [saveError, setSaveError] = useState<string | null>(null);

  const members = useMemo(
    () => (membersQuery.data || []) as TenantMember[],
    [membersQuery.data],
  );
  const directoryPhotos = useMemo(() => {
    if (
      !user?.id ||
      !tenantId ||
      directory.owner !== user.id ||
      directory.requestedTenant !== tenantId ||
      directory.workspace?.id !== tenantId
    )
      return new Map<number, string>();
    // The Team directory contains only active members with active extensions.
    // Index strictly by user ID; ProfileAvatar checks tenant and user IDs in the descriptor path.
    return new Map(
      directory.people
        .filter((person) =>
          Boolean(person.extension?.trim() && person.photoUrl),
        )
        .map((person) => [person.id, person.photoUrl!] as const),
    );
  }, [
    directory.owner,
    directory.people,
    directory.requestedTenant,
    directory.workspace?.id,
    tenantId,
    user?.id,
  ]);
  const closeEditor = () => {
    setEditing(null);
    setSaveError(null);
  };

  const openEditor = (member: TenantMember) => {
    setEditing(member);
    setSelectedRole(member.role === "admin" ? "admin" : "user");
    setRoleChanged(false);
    setSelectedStatus(member.status);
    setSaveError(null);
  };

  const save = async () => {
    if (!editing) return;
    const changes: {
      tenantId: number;
      userId: number;
      role?: "admin" | "user";
      status?: MembershipStatus;
    } = { tenantId: tenantId ?? 0, userId: editing.id };
    if (!tenantId) {
      setSaveError("Select a workspace before changing a member.");
      return;
    }
    if (
      canManageAdministrators &&
      editing.role !== "owner" &&
      roleChanged &&
      selectedRole !== editing.role
    ) {
      changes.role = selectedRole;
    }
    if (
      (editing.role === "user" || canManageAdministrators) &&
      selectedStatus !== editing.status
    ) {
      changes.status = selectedStatus;
    }
    if (changes.role === undefined && changes.status === undefined) {
      closeEditor();
      return;
    }
    try {
      await updateMember.mutateAsync(changes);
      closeEditor();
      void membersQuery.refetch().catch(() => undefined);
    } catch (error) {
      setSaveError(readableError(error));
    }
  };

  const requestSave = () => {
    if (!editing) return;
    if (editing.status === "active" && selectedStatus === "inactive") {
      Alert.alert(
        "Deactivate membership?",
        `${displayName(editing)} will no longer appear as an active workspace member. Their extension assignment and SIP credentials are not changed here.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Deactivate",
            style: "destructive",
            onPress: () => void save(),
          },
        ],
      );
      return;
    }
    void save();
  };

  const body = tenantQuery.isLoading ? (
    <View style={styles.state}>
      <ActivityIndicator color={colors.primary} />
      <Text style={[styles.stateText, { color: colors.muted }]}>
        Loading workspace…
      </Text>
    </View>
  ) : !canManage ? (
    <View style={styles.state}>
      <Text style={[styles.stateTitle, { color: colors.foreground }]}>
        Administrator access required
      </Text>
      <Text style={[styles.stateText, { color: colors.muted }]}>
        Ask a workspace owner or administrator to manage people.
      </Text>
    </View>
  ) : membersQuery.isLoading ? (
    <View style={styles.state}>
      <ActivityIndicator color={colors.primary} />
      <Text style={[styles.stateText, { color: colors.muted }]}>
        Loading people…
      </Text>
    </View>
  ) : membersQuery.isError ? (
    <View style={styles.state}>
      <Text
        accessibilityRole="alert"
        style={[styles.stateTitle, { color: colors.foreground }]}
      >
        Couldn’t load people
      </Text>
      <Text style={[styles.stateText, { color: colors.muted }]}>
        {readableError(membersQuery.error)}
      </Text>
      <TouchableOpacity
        accessibilityRole="button"
        onPress={() => void membersQuery.refetch()}
      >
        <Text style={[styles.retry, { color: colors.primary }]}>Try again</Text>
      </TouchableOpacity>
    </View>
  ) : (
    <AdminPeopleTable
      members={members}
      tenantId={tenantId}
      directoryPhotos={directoryPhotos}
      canManage={canManage}
      canManageAdministrators={canManageAdministrators}
      onEdit={openEditor}
    />
  );

  const roleCanChange = Boolean(
    editing && editing.role !== "owner" && canManageAdministrators,
  );
  const statusCanChange =
    Boolean(editing && editing.role === "user") || canManageAdministrators;

  return (
    <ScreenContainer
      style={
        Platform.OS === "web"
          ? {
              backgroundColor: colors.surface,
              paddingHorizontal: wideWeb ? 24 : 0,
              paddingTop: wideWeb ? 20 : 0,
            }
          : undefined
      }
    >
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        {Platform.OS !== "web" ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Back to admin portal"
            onPress={() => router.back()}
            style={styles.backButton}
          >
            <IconSymbol name="chevron.left" size={22} color={colors.primary} />
          </TouchableOpacity>
        ) : null}
        <View style={styles.headerCopy}>
          <Text
            accessibilityRole="header"
            style={[
              styles.title,
              { color: colors.foreground, fontSize: wideWeb ? 28 : 22 },
            ]}
          >
            People
          </Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>
            {tenantQuery.data?.name || "Current workspace"}
          </Text>
        </View>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Manage extensions"
          onPress={() => router.push("/admin/extensions")}
          style={styles.extensionsButton}
        >
          <IconSymbol name="phone.fill" size={17} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {canManage ? (
        <AdminInvitations
          tenantId={tenantId ?? null}
          actorRole={actorRole}
          userId={typeof user?.id === "number" ? user.id : null}
          workspaceValid={Boolean(tenantId && workspace.selectedTenantId === tenantId &&
            workspace.membershipsQuery.isSuccess && !workspace.membershipsQuery.isFetching &&
            Auth.getAuthSnapshot().user?.id === user?.id)}
        />
      ) : null}

      {body}

      <Modal
        visible={Boolean(editing)}
        animationType="slide"
        transparent
        onRequestClose={closeEditor}
      >
        <View
          style={[
            styles.overlay,
            wideWeb
              ? { justifyContent: "center", alignItems: "center" }
              : undefined,
          ]}
        >
          <View
            style={[
              styles.modal,
              wideWeb ? { width: 540, borderRadius: 16 } : undefined,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.modalHeader}>
              <View style={styles.modalCopy}>
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>
                  {editing ? displayName(editing) : "Member"}
                </Text>
                {editing?.email ? (
                  <Text style={[styles.modalSubtitle, { color: colors.muted }]}>
                    {editing.email}
                  </Text>
                ) : null}
              </View>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Close member editor"
                onPress={closeEditor}
              >
                <IconSymbol
                  name="xmark.circle.fill"
                  size={24}
                  color={colors.muted}
                />
              </TouchableOpacity>
            </View>

            <Text style={[styles.label, { color: colors.muted }]}>
              Workspace role
            </Text>
            <View style={styles.options}>
              {(["user", "admin"] as const).map((role) => {
                const selected = selectedRole === role;
                const disabled = !roleCanChange;
                return (
                  <TouchableOpacity
                    key={role}
                    accessibilityRole="radio"
                    accessibilityState={{ selected, disabled }}
                    disabled={disabled}
                    onPress={() => {
                      setSelectedRole(role);
                      setRoleChanged(true);
                    }}
                    style={[
                      styles.option,
                      {
                        borderColor: selected ? colors.primary : colors.border,
                        backgroundColor: selected
                          ? colors.primary + "14"
                          : colors.background,
                        opacity: disabled ? 0.55 : 1,
                      },
                    ]}
                  >
                    <Text
                      style={[styles.optionTitle, { color: colors.foreground }]}
                    >
                      {role === "admin" ? "Administrator" : "Member"}
                    </Text>
                    <Text style={[styles.optionText, { color: colors.muted }]}>
                      {role === "admin"
                        ? "Can manage workspace settings and people."
                        : "Uses Phone11 services assigned to them."}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {!roleCanChange ? (
              <Text style={[styles.help, { color: colors.muted }]}>
                Only a workspace owner can change administrator roles.
              </Text>
            ) : null}

            <Text style={[styles.label, { color: colors.muted }]}>
              Membership status
            </Text>
            <View style={styles.options}>
              {(["active", "inactive"] as const).map((status) => {
                const selected = selectedStatus === status;
                const disabled = !statusCanChange;
                return (
                  <TouchableOpacity
                    key={status}
                    accessibilityRole="radio"
                    accessibilityState={{ selected, disabled }}
                    disabled={disabled}
                    onPress={() => setSelectedStatus(status)}
                    style={[
                      styles.option,
                      {
                        borderColor: selected ? colors.primary : colors.border,
                        backgroundColor: selected
                          ? colors.primary + "14"
                          : colors.background,
                        opacity: disabled ? 0.55 : 1,
                      },
                    ]}
                  >
                    <Text
                      style={[styles.optionTitle, { color: colors.foreground }]}
                    >
                      {status === "active" ? "Active" : "Inactive"}
                    </Text>
                    <Text style={[styles.optionText, { color: colors.muted }]}>
                      {status === "active"
                        ? "Included in the workspace membership directory."
                        : "Hidden from active workspace member lists."}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={[styles.help, { color: colors.muted }]}>
              Membership changes do not suspend SIP credentials or remove
              extension assignments. Manage extensions separately.
            </Text>
            {saveError ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {saveError}
              </Text>
            ) : null}
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Save membership changes"
              disabled={
                updateMember.isPending ||
                !editing ||
                (!roleCanChange && !statusCanChange)
              }
              onPress={requestSave}
              style={[
                styles.saveButton,
                {
                  backgroundColor: colors.primary,
                  opacity:
                    updateMember.isPending ||
                    (!roleCanChange && !statusCanChange)
                      ? 0.6
                      : 1,
                },
              ]}
            >
              {updateMember.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveText}>Save changes</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 24,
    paddingVertical: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: { padding: 4 },
  headerCopy: { flex: 1 },
  title: { fontSize: 22, fontWeight: "700" },
  subtitle: { marginTop: 2, fontSize: 13 },
  extensionsButton: {
    minHeight: 44,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  notice: {
    flexDirection: "row",
    gap: 10,
    margin: 16,
    padding: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  noticeCopy: { flex: 1 },
  noticeTitle: { fontSize: 14, fontWeight: "700" },
  noticeText: { marginTop: 3, fontSize: 13, lineHeight: 18 },
  state: { alignItems: "center", gap: 8, padding: 28 },
  stateTitle: { fontSize: 16, fontWeight: "700", textAlign: "center" },
  stateText: { fontSize: 14, lineHeight: 20, textAlign: "center" },
  retry: { marginTop: 4, fontWeight: "700" },
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.48)",
  },
  modal: {
    maxHeight: "90%",
    padding: 20,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
  },
  modalHeader: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
    marginBottom: 20,
  },
  modalCopy: { flex: 1 },
  modalTitle: { fontSize: 20, fontWeight: "700" },
  modalSubtitle: { marginTop: 3, fontSize: 13 },
  label: {
    marginTop: 12,
    marginBottom: 8,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  options: { gap: 8 },
  option: { padding: 12, borderRadius: 12, borderWidth: 1 },
  optionTitle: { fontSize: 15, fontWeight: "700" },
  optionText: { marginTop: 3, fontSize: 12, lineHeight: 17 },
  help: { marginTop: 9, fontSize: 12, lineHeight: 17 },
  error: { marginTop: 12, color: "#DC2626", fontSize: 13 },
  saveButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
    marginTop: 18,
    borderRadius: 12,
  },
  saveText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
