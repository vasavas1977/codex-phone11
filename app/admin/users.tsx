/**
 * Workspace people administration.
 *
 * Existing membership management and capability-gated invitations.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdminWorkspaceBoundary } from "@/components/admin/admin-workspace-boundary";
import { AdminInvitations } from "@/components/admin/admin-invitations";
import * as Auth from "@/lib/_core/auth";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  ScrollView,
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

type MemberEditScope = {
  actor: Auth.User;
  tenantId: number;
  memberId: number;
  memberRole: string;
  memberStatus: MembershipStatus;
  actorRole: string;
  revision: number;
};
type MemberChanges = {
  tenantId: number;
  userId: number;
  role?: "admin" | "user";
  status?: MembershipStatus;
};
type MemberDraft = Readonly<{
  revision: number;
  role: "admin" | "user";
  roleChanged: boolean;
  status: MembershipStatus;
}>;
type MemberConfirmation = {
  scope: MemberEditScope;
  draft: MemberDraft;
  changes: MemberChanges;
};

const deactivationConsequences =
  "Deactivation removes this person's workspace access, revokes SIP access for their assigned active extensions, suspends those extensions and SIP accounts, and removes their permission to use assigned extensions. Reactivating membership does not restore extension or SIP access; manage extensions separately.";

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
  const EditorContainer = Platform.OS === "web" ? ScrollView : View;
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
  const [confirmation, setConfirmation] = useState<MemberConfirmation | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const editorRevision = useRef(0);
  const draftRevision = useRef(0);
  // Retire old callbacks synchronously, including between React renders.
  const currentDraft = useRef<MemberDraft | null>(null);
  const editScope = useRef<MemberEditScope | null>(null);
  const pendingConfirmation = useRef<MemberConfirmation | null>(null);
  const busy = useRef<MemberConfirmation | null>(null);
  const mounted = useRef(true);
  const current = useRef({
    user,
    tenantId,
    workspace,
    canManage,
    actorRole,
    members: [] as TenantMember[],
  });

  const members = useMemo(
    () => (membersQuery.data || []) as TenantMember[],
    [membersQuery.data],
  );
  current.current = {
    user,
    tenantId,
    workspace,
    canManage,
    actorRole,
    members,
  };
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
  const closeEditor = useCallback(() => {
    editorRevision.current += 1;
    editScope.current = null;
    currentDraft.current = null;
    pendingConfirmation.current = null;
    setEditing(null);
    setConfirmation(null);
    setSaveError(null);
  }, []);

  useEffect(() => {
    closeEditor();
    busy.current = null;
    setSaving(false);
  }, [
    user,
    tenantId,
    workspace.selectedTenantId,
    canManage,
    actorRole,
    closeEditor,
  ]);

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = Auth.addAuthChangeListener(() => {
      if (
        editScope.current &&
        Auth.getAuthSnapshot().user !== editScope.current.actor
      ) {
        closeEditor();
        busy.current = null;
        setSaving(false);
      }
    });
    return () => {
      mounted.current = false;
      editorRevision.current += 1;
      editScope.current = null;
      currentDraft.current = null;
      unsubscribe();
    };
  }, [closeEditor]);

  const scopeIsCurrent = (scope: MemberEditScope, beforeSubmit = true) => {
    const live = current.current;
    const member = live.members.find((row) => row.id === scope.memberId);
    return (
      mounted.current &&
      editScope.current === scope &&
      scope.revision === editorRevision.current &&
      Auth.getAuthSnapshot().user === scope.actor &&
      live.user === scope.actor &&
      live.canManage &&
      live.actorRole === scope.actorRole &&
      live.tenantId === scope.tenantId &&
      live.workspace.selectedTenantId === scope.tenantId &&
      live.workspace.membershipsQuery.isSuccess &&
      (!beforeSubmit ||
        (!live.workspace.membershipsQuery.isFetching &&
          member?.role === scope.memberRole &&
          member?.status === scope.memberStatus))
    );
  };

  const openEditor = (member: TenantMember) => {
    if (
      busy.current ||
      !user ||
      !tenantId ||
      !canManage ||
      workspace.selectedTenantId !== tenantId ||
      Auth.getAuthSnapshot().user !== user
    )
      return;
    editorRevision.current += 1;
    editScope.current = {
      actor: user,
      tenantId,
      memberId: member.id,
      memberRole: member.role,
      memberStatus: member.status,
      actorRole,
      revision: editorRevision.current,
    };
    setEditing(member);
    currentDraft.current = {
      revision: ++draftRevision.current,
      role: member.role === "admin" ? "admin" : "user",
      roleChanged: false,
      status: member.status,
    };
    pendingConfirmation.current = null;
    setConfirmation(null);
    setSelectedRole(member.role === "admin" ? "admin" : "user");
    setRoleChanged(false);
    setSelectedStatus(member.status);
    setSaveError(null);
  };

  const draftIsCurrent = (draft: MemberDraft) => {
    const live = currentDraft.current;
    return (
      live?.revision === draft.revision &&
      live.role === draft.role &&
      live.roleChanged === draft.roleChanged &&
      live.status === draft.status
    );
  };

  const save = async (request: MemberConfirmation) => {
    if (
      busy.current ||
      !scopeIsCurrent(request.scope) ||
      !draftIsCurrent(request.draft) ||
      (request.changes.status === "inactive" &&
        pendingConfirmation.current !== request)
    )
      return;
    busy.current = request;
    setSaving(true);
    setSaveError(null);
    try {
      await updateMember.mutateAsync(request.changes);
      // The mutation hook invalidates membership queries on success. That
      // refresh may already show this change; only editor/session replacement
      // should prevent its completion from closing this same editor.
      if (!scopeIsCurrent(request.scope, false)) return;
      closeEditor();
      void membersQuery.refetch().catch(() => undefined);
    } catch (error) {
      if (scopeIsCurrent(request.scope, false))
        setSaveError(readableError(error));
    } finally {
      if (busy.current === request) {
        busy.current = null;
        if (mounted.current) setSaving(false);
      }
    }
  };

  const renderedScope = editScope.current;
  const renderedDraft = currentDraft.current;
  const requestSave = () => {
    const scope = renderedScope;
    const draft = renderedDraft;
    if (
      !editing ||
      !scope ||
      !draft ||
      busy.current ||
      !scopeIsCurrent(scope) ||
      !draftIsCurrent(draft) ||
      draft.role !== selectedRole ||
      draft.roleChanged !== roleChanged ||
      draft.status !== selectedStatus
    )
      return;
    const changes: MemberChanges = {
      tenantId: scope.tenantId,
      userId: scope.memberId,
    };
    if (
      canManageAdministrators &&
      editing.role !== "owner" &&
      draft.roleChanged &&
      draft.role !== editing.role
    ) {
      changes.role = draft.role;
    }
    if (
      (editing.role === "user" || canManageAdministrators) &&
      draft.status !== editing.status
    ) {
      changes.status = draft.status;
    }
    if (changes.role === undefined && changes.status === undefined) {
      closeEditor();
      return;
    }
    const request = { scope, draft, changes };
    if (editing.status === "active" && draft.status === "inactive") {
      pendingConfirmation.current = request;
      if (Platform.OS === "web") {
        setSaveError(null);
        setConfirmation(request);
        return;
      }
      Alert.alert(
        "Deactivate membership?",
        `${displayName(editing)}: ${deactivationConsequences}`,
        [
          {
            text: "Cancel",
            style: "cancel",
            onPress: () => {
              if (pendingConfirmation.current === request)
                pendingConfirmation.current = null;
            },
          },
          {
            text: "Deactivate",
            style: "destructive",
            onPress: () => void save(request),
          },
        ],
      );
      return;
    }
    void save(request);
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
          workspaceValid={Boolean(
            tenantId &&
            workspace.selectedTenantId === tenantId &&
            workspace.membershipsQuery.isSuccess &&
            !workspace.membershipsQuery.isFetching &&
            Auth.getAuthSnapshot().user?.id === user?.id,
          )}
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
          <EditorContainer
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
                const disabled =
                  !roleCanChange || saving || confirmation !== null;
                return (
                  <TouchableOpacity
                    key={role}
                    accessibilityRole="radio"
                    accessibilityState={{ selected, disabled }}
                    disabled={disabled}
                    onPress={() => {
                      if (
                        !renderedScope ||
                        !renderedDraft ||
                        busy.current ||
                        pendingConfirmation.current ||
                        !scopeIsCurrent(renderedScope) ||
                        !draftIsCurrent(renderedDraft)
                      )
                        return;
                      if (
                        renderedDraft.role === role &&
                        renderedDraft.roleChanged
                      )
                        return;
                      currentDraft.current = {
                        ...renderedDraft,
                        revision: ++draftRevision.current,
                        role,
                        roleChanged: true,
                      };
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
                const disabled =
                  !statusCanChange || saving || confirmation !== null;
                return (
                  <TouchableOpacity
                    key={status}
                    accessibilityRole="radio"
                    accessibilityState={{ selected, disabled }}
                    disabled={disabled}
                    onPress={() => {
                      if (
                        !renderedScope ||
                        !renderedDraft ||
                        busy.current ||
                        pendingConfirmation.current ||
                        !scopeIsCurrent(renderedScope) ||
                        !draftIsCurrent(renderedDraft)
                      )
                        return;
                      if (renderedDraft.status === status) return;
                      currentDraft.current = {
                        ...renderedDraft,
                        revision: ++draftRevision.current,
                        status,
                      };
                      setSelectedStatus(status);
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
                      {status === "active" ? "Active" : "Inactive"}
                    </Text>
                    <Text style={[styles.optionText, { color: colors.muted }]}>
                      {status === "active"
                        ? "Included in the workspace membership directory."
                        : "Workspace access removed; assigned active extensions and SIP access suspended."}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {!confirmation ? (
              <Text style={[styles.help, { color: colors.muted }]}>
                {deactivationConsequences}
              </Text>
            ) : null}
            {confirmation ? (
              <View
                accessibilityRole="alert"
                accessibilityLiveRegion="assertive"
              >
                <Text style={[styles.label, { color: colors.foreground }]}>
                  Deactivate membership?
                </Text>
                <Text style={[styles.help, { color: colors.muted }]}>
                  Confirm deactivation for{" "}
                  {editing ? displayName(editing) : "this member"}.{" "}
                  {deactivationConsequences}
                </Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Cancel member deactivation"
                  disabled={saving}
                  style={[
                    styles.saveButton,
                    { borderWidth: 1, borderColor: colors.border },
                  ]}
                  onPress={() => {
                    if (
                      busy.current ||
                      pendingConfirmation.current !== confirmation
                    )
                      return;
                    pendingConfirmation.current = null;
                    if (draftIsCurrent(confirmation.draft)) {
                      currentDraft.current = {
                        ...confirmation.draft,
                        revision: ++draftRevision.current,
                      };
                    }
                    setConfirmation(null);
                    setSaveError(null);
                  }}
                >
                  <Text style={[styles.retry, { color: colors.primary }]}>
                    Cancel
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Confirm member deactivation"
                  disabled={
                    saving ||
                    !scopeIsCurrent(confirmation.scope) ||
                    !draftIsCurrent(confirmation.draft)
                  }
                  onPress={() => void save(confirmation)}
                  style={[styles.saveButton, { backgroundColor: colors.error }]}
                >
                  {saving ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.saveText}>Deactivate member</Text>
                  )}
                </TouchableOpacity>
              </View>
            ) : null}
            {saveError ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {saveError}
              </Text>
            ) : null}
            {!confirmation ? (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Save membership changes"
                disabled={
                  saving ||
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
                      saving ||
                      updateMember.isPending ||
                      (!roleCanChange && !statusCanChange)
                        ? 0.6
                        : 1,
                  },
                ]}
              >
                {saving || updateMember.isPending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.saveText}>Save changes</Text>
                )}
              </TouchableOpacity>
            ) : null}
          </EditorContainer>
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
