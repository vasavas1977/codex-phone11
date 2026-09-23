/**
 * Workspace people administration.
 *
 * This screen manages existing tenant memberships only. It deliberately does
 * not create users or send invitations because Phone11 has no verified
 * invitation-delivery path yet.
 */
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { useDirectory } from "@/hooks/use-directory";
import {
  useTenant,
  useTenantMembers,
  useUpdateTenantMember,
} from "@/hooks/use-pbx-admin";

type MembershipRole = "owner" | "admin" | "user";
type MembershipStatus = "active" | "inactive";

type TenantMember = {
  id: number;
  name?: string | null;
  email?: string | null;
  role: MembershipRole;
  status: MembershipStatus;
  assigned_extension_numbers?: string[] | null;
  photoUrl?: string | null;
  photoVersion?: string | null;
};

function displayName(member: TenantMember) {
  return member.name?.trim() || member.email?.trim() || `Member ${member.id}`;
}

function readableError(error: unknown) {
  return error instanceof Error ? error.message : "Please try again.";
}

function roleLabel(role: MembershipRole) {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Admin";
  return "Member";
}

export default function AdminUsers() {
  const colors = useColors();
  const { user } = useAuth({ autoFetch: false });
  const tenantQuery = useTenant();
  const tenantId = tenantQuery.data?.id;
  const actorRole = String(tenantQuery.data?.userRole || "");
  const canManage = ["owner", "admin"].includes(actorRole);
  const canManageAdministrators = actorRole === "owner";
  const membersQuery = useTenantMembers(tenantQuery.isSuccess && canManage);
  const directory = useDirectory(tenantId, tenantQuery.isSuccess && canManage);
  const updateMember = useUpdateTenantMember();

  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<TenantMember | null>(null);
  const [selectedRole, setSelectedRole] = useState<"admin" | "user">("user");
  const [roleChanged, setRoleChanged] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<MembershipStatus>("active");
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
    ) return new Map<number, string>();
    // The Team directory contains only active members with active extensions.
    // Index strictly by user ID; ProfileAvatar checks tenant and user IDs in the descriptor path.
    return new Map(
      directory.people
        .filter((person) => Boolean(person.extension?.trim() && person.photoUrl))
        .map((person) => [person.id, person.photoUrl!] as const),
    );
  }, [directory.owner, directory.people, directory.requestedTenant, directory.workspace?.id, tenantId, user?.id]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return members;
    return members.filter((member) =>
      [
        displayName(member),
        member.email,
        member.role,
        member.status,
        ...(member.assigned_extension_numbers || []),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [members, search]);

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
      userId: number;
      role?: "admin" | "user";
      status?: MembershipStatus;
    } = { userId: editing.id };
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

  const renderMember = ({ item }: { item: TenantMember }) => {
    const extensions = item.assigned_extension_numbers || [];
    const fallbackPhotoUrl = item.status === "active" ? directoryPhotos.get(item.id) : undefined;
    const editable =
      item.role !== "owner" &&
      (canManageAdministrators || item.role === "user");
    return (
      <View
        style={[
          styles.card,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <ProfileAvatar
          name={displayName(item)}
          photoUrl={item.status === "active" ? item.photoUrl || fallbackPhotoUrl : null}
          photoVersion={item.status === "active" ? item.photoVersion : null}
          tenantId={tenantId}
          userId={item.id}
          size={40}
        />
        <View style={styles.memberCopy}>
          <Text
            numberOfLines={1}
            style={[styles.memberName, { color: colors.foreground }]}
          >
            {displayName(item)}
          </Text>
          {item.email ? (
            <Text
              numberOfLines={1}
              style={[styles.memberEmail, { color: colors.muted }]}
            >
              {item.email}
            </Text>
          ) : null}
          <Text
            numberOfLines={1}
            style={[styles.memberMeta, { color: colors.muted }]}
          >
            {extensions.length
              ? `Extensions: ${extensions.join(", ")}`
              : "No extension assigned"}
          </Text>
          <View style={styles.badges}>
            <View
              style={[
                styles.badge,
                {
                  backgroundColor:
                    item.role === "owner"
                      ? "#8B5CF620"
                      : item.role === "admin"
                        ? "#0057FF18"
                        : colors.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.badgeText,
                  {
                    color:
                      item.role === "owner"
                        ? "#7C3AED"
                        : item.role === "admin"
                          ? colors.primary
                          : colors.muted,
                  },
                ]}
              >
                {roleLabel(item.role)}
              </Text>
            </View>
            <View
              style={[
                styles.badge,
                {
                  backgroundColor:
                    item.status === "active" ? "#00A8781A" : "#64748B22",
                },
              ]}
            >
              <Text
                style={[
                  styles.badgeText,
                  {
                    color: item.status === "active" ? "#00875A" : colors.muted,
                  },
                ]}
              >
                {item.status === "active" ? "Active" : "Inactive"}
              </Text>
            </View>
          </View>
        </View>
        {editable ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`Manage ${displayName(item)}`}
            onPress={() => openEditor(item)}
            style={[styles.manageButton, { borderColor: colors.primary }]}
          >
            <Text style={[styles.manageText, { color: colors.primary }]}>
              Manage
            </Text>
          </TouchableOpacity>
        ) : (
          <Text style={[styles.fixedLabel, { color: colors.muted }]}>
            {item.role === "owner" ? "Fixed" : "Owner only"}
          </Text>
        )}
      </View>
    );
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
    <FlatList
      data={filtered}
      keyExtractor={(item) => String(item.id)}
      renderItem={renderMember}
      refreshing={membersQuery.isRefetching}
      onRefresh={() => void membersQuery.refetch()}
      contentContainerStyle={styles.list}
      ListEmptyComponent={
        <View style={styles.state}>
          <Text style={[styles.stateTitle, { color: colors.foreground }]}>
            {members.length ? "No matching people" : "No people in this workspace"}
          </Text>
          <Text style={[styles.stateText, { color: colors.muted }]}>
            {members.length
              ? "Change the search to see more people."
              : "An owner must add verified people through the approved identity process."}
          </Text>
        </View>
      }
    />
  );

  const roleCanChange = Boolean(
    editing && editing.role !== "owner" && canManageAdministrators,
  );
  const statusCanChange =
    Boolean(editing && editing.role === "user") || canManageAdministrators;

  return (
    <ScreenContainer>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Back to admin portal"
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: colors.foreground }]}>People</Text>
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
        <>
          <View
            style={[
              styles.notice,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <IconSymbol name="person.badge.plus" size={18} color={colors.muted} />
            <View style={styles.noticeCopy}>
              <Text style={[styles.noticeTitle, { color: colors.foreground }]}>
                Invitations are not available yet
              </Text>
              <Text style={[styles.noticeText, { color: colors.muted }]}>
                Phone11 does not have a verified invitation delivery service, so
                this page only manages people already in this workspace.
              </Text>
            </View>
          </View>
          <View
            style={[
              styles.search,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <IconSymbol name="magnifyingglass" size={18} color={colors.muted} />
            <TextInput
              accessibilityLabel="Search people"
              value={search}
              onChangeText={setSearch}
              placeholder="Search people, role, or extension"
              placeholderTextColor={colors.muted}
              style={[styles.searchInput, { color: colors.foreground }]}
            />
          </View>
        </>
      ) : null}

      {body}

      <Modal
        visible={Boolean(editing)}
        animationType="slide"
        transparent
        onRequestClose={closeEditor}
      >
        <View style={styles.overlay}>
          <View
            style={[
              styles.modal,
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
                <IconSymbol name="xmark.circle.fill" size={24} color={colors.muted} />
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
                    <Text style={[styles.optionTitle, { color: colors.foreground }]}>
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
                    <Text style={[styles.optionTitle, { color: colors.foreground }]}>
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
                    updateMember.isPending || (!roleCanChange && !statusCanChange)
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
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  backButton: { padding: 4 },
  headerCopy: { flex: 1 },
  title: { fontSize: 22, fontWeight: "700" },
  subtitle: { marginTop: 2, fontSize: 13 },
  extensionsButton: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" },
  notice: { flexDirection: "row", gap: 10, margin: 16, padding: 14, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  noticeCopy: { flex: 1 },
  noticeTitle: { fontSize: 14, fontWeight: "700" },
  noticeText: { marginTop: 3, fontSize: 13, lineHeight: 18 },
  search: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 14, minHeight: 46, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  searchInput: { flex: 1, fontSize: 15 },
  list: { padding: 16, gap: 10, paddingBottom: 36 },
  card: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 14, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  memberCopy: { flex: 1, minWidth: 0 },
  memberName: { fontSize: 16, fontWeight: "700" },
  memberEmail: { marginTop: 2, fontSize: 13 },
  memberMeta: { marginTop: 4, fontSize: 12 },
  badges: { flexDirection: "row", gap: 6, marginTop: 8 },
  badge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7 },
  badgeText: { fontSize: 11, fontWeight: "700" },
  manageButton: { minHeight: 36, justifyContent: "center", paddingHorizontal: 10, borderRadius: 9, borderWidth: 1 },
  manageText: { fontSize: 13, fontWeight: "700" },
  fixedLabel: { paddingTop: 8, fontSize: 12 },
  state: { alignItems: "center", gap: 8, padding: 28 },
  stateTitle: { fontSize: 16, fontWeight: "700", textAlign: "center" },
  stateText: { fontSize: 14, lineHeight: 20, textAlign: "center" },
  retry: { marginTop: 4, fontWeight: "700" },
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.48)" },
  modal: { maxHeight: "90%", padding: 20, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: StyleSheet.hairlineWidth },
  modalHeader: { flexDirection: "row", gap: 12, alignItems: "flex-start", marginBottom: 20 },
  modalCopy: { flex: 1 },
  modalTitle: { fontSize: 20, fontWeight: "700" },
  modalSubtitle: { marginTop: 3, fontSize: 13 },
  label: { marginTop: 12, marginBottom: 8, fontSize: 12, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" },
  options: { gap: 8 },
  option: { padding: 12, borderRadius: 12, borderWidth: 1 },
  optionTitle: { fontSize: 15, fontWeight: "700" },
  optionText: { marginTop: 3, fontSize: 12, lineHeight: 17 },
  help: { marginTop: 9, fontSize: 12, lineHeight: 17 },
  error: { marginTop: 12, color: "#DC2626", fontSize: 13 },
  saveButton: { alignItems: "center", justifyContent: "center", minHeight: 48, marginTop: 18, borderRadius: 12 },
  saveText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
