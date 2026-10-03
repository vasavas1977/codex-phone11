import { useEffect, useMemo, useRef, useState } from "react";
import {
  Platform,
  StyleSheet,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { ProfileAvatar } from "@/components/profile/profile-avatar";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";

export type AdminPeopleMember = {
  id: number;
  name?: string | null;
  email?: string | null;
  role: "owner" | "admin" | "user";
  status: "active" | "inactive";
  assigned_extension_numbers?: string[] | null;
  photoUrl?: string | null;
  photoVersion?: string | null;
};

type Props = {
  members: AdminPeopleMember[];
  tenantId?: number;
  directoryPhotos: ReadonlyMap<number, string>;
  canManage: boolean;
  canManageAdministrators: boolean;
  onEdit: (member: AdminPeopleMember) => void;
};

function memberName(member: AdminPeopleMember) {
  return member.name?.trim() || member.email?.trim() || `Member ${member.id}`;
}

function roleLabel(role: AdminPeopleMember["role"]) {
  return role === "owner" ? "Owner" : role === "admin" ? "Admin" : "Member";
}

/** Responsive, presentation-only member inventory shared by the authenticated page and dev preview. */
export function AdminPeopleTable({
  members,
  tenantId,
  directoryPhotos,
  canManage,
  canManageAdministrators,
  onEdit,
}: Props) {
  const colors = useColors();
  const [width, setWidth] = useState(0);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<
    "all" | AdminPeopleMember["role"]
  >("all");
  const [statusFilter, setStatusFilter] = useState<
    "all" | AdminPeopleMember["status"]
  >("all");
  const [openFilter, setOpenFilter] = useState<"role" | "status" | null>(null);
  const filterRoot = useRef<View>(null);
  useEffect(() => {
    if (!openFilter || Platform.OS !== "web" || typeof document === "undefined")
      return;
    const dismiss = () => setOpenFilter(null);
    const onPointerDown = (event: PointerEvent) => {
      const rootNode = filterRoot.current as unknown as Node | null;
      if (
        rootNode &&
        typeof Node !== "undefined" &&
        event.target instanceof Node &&
        rootNode.contains(event.target)
      )
        return;
      dismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openFilter]);
  const desktop = width >= 820;
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return members.filter((member) => {
      if (roleFilter !== "all" && member.role !== roleFilter) return false;
      if (statusFilter !== "all" && member.status !== statusFilter)
        return false;
      if (!needle) return true;
      return [
        memberName(member),
        member.email,
        member.role,
        member.status,
        ...(member.assigned_extension_numbers || []),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [members, roleFilter, search, statusFilter]);

  const filters = (
    <View ref={filterRoot} style={styles.filterGroup}>
      <View style={styles.filterPicker}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Filter by role"
          accessibilityState={{ expanded: openFilter === "role" }}
          onPress={() => setOpenFilter(openFilter === "role" ? null : "role")}
          style={[
            styles.filterButton,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.filterText, { color: colors.foreground }]}>
            Role: {roleFilter === "all" ? "All" : roleLabel(roleFilter)}
          </Text>
          <IconSymbol name="chevron.down" size={12} color={colors.muted} />
        </TouchableOpacity>
        {openFilter === "role" ? (
          <View
            style={[
              styles.filterMenu,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            {(["all", "owner", "admin", "user"] as const).map((role) => (
              <TouchableOpacity
                key={role}
                accessibilityRole="button"
                accessibilityState={{ selected: roleFilter === role }}
                onPress={() => {
                  setRoleFilter(role);
                  setOpenFilter(null);
                }}
                style={[
                  styles.filterOption,
                  {
                    backgroundColor:
                      roleFilter === role
                        ? `${colors.primary}12`
                        : "transparent",
                  },
                ]}
              >
                <Text
                  style={[
                    styles.filterText,
                    {
                      color:
                        roleFilter === role
                          ? colors.primary
                          : colors.foreground,
                    },
                  ]}
                >
                  {role === "all" ? "All roles" : roleLabel(role)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
      </View>
      <View style={styles.filterPicker}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Filter by status"
          accessibilityState={{ expanded: openFilter === "status" }}
          onPress={() =>
            setOpenFilter(openFilter === "status" ? null : "status")
          }
          style={[
            styles.filterButton,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.filterText, { color: colors.foreground }]}>
            Status:{" "}
            {statusFilter === "all"
              ? "All"
              : statusFilter === "active"
                ? "Active"
                : "Inactive"}
          </Text>
          <IconSymbol name="chevron.down" size={12} color={colors.muted} />
        </TouchableOpacity>
        {openFilter === "status" ? (
          <View
            style={[
              styles.filterMenu,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            {(["all", "active", "inactive"] as const).map((status) => (
              <TouchableOpacity
                key={status}
                accessibilityRole="button"
                accessibilityState={{ selected: statusFilter === status }}
                onPress={() => {
                  setStatusFilter(status);
                  setOpenFilter(null);
                }}
                style={[
                  styles.filterOption,
                  {
                    backgroundColor:
                      statusFilter === status
                        ? `${colors.primary}12`
                        : "transparent",
                  },
                ]}
              >
                <Text
                  style={[
                    styles.filterText,
                    {
                      color:
                        statusFilter === status
                          ? colors.primary
                          : colors.foreground,
                    },
                  ]}
                >
                  {status === "all"
                    ? "All status"
                    : status === "active"
                      ? "Active"
                      : "Inactive"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );

  const renderAction = (member: AdminPeopleMember) => {
    const editable =
      member.role !== "owner" &&
      (canManageAdministrators || (canManage && member.role === "user"));
    return editable ? (
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`Manage ${memberName(member)}`}
        onPress={() => onEdit(member)}
        style={[styles.manageButton, { borderColor: colors.primary }]}
      >
        <Text style={[styles.manageText, { color: colors.primary }]}>
          Manage
        </Text>
      </TouchableOpacity>
    ) : (
      <Text style={[styles.fixedLabel, { color: colors.muted }]}>
        {member.role === "owner" ? "Fixed" : "Owner only"}
      </Text>
    );
  };

  const person = (member: AdminPeopleMember) => (
    <View style={styles.personCell}>
      <ProfileAvatar
        name={memberName(member)}
        photoUrl={
          member.status === "active"
            ? member.photoUrl || directoryPhotos.get(member.id)
            : null
        }
        photoVersion={member.status === "active" ? member.photoVersion : null}
        tenantId={tenantId}
        userId={member.id}
        size={desktop ? 36 : 40}
      />
      <View style={styles.personCopy}>
        <Text
          numberOfLines={1}
          style={[styles.memberName, { color: colors.foreground }]}
        >
          {memberName(member)}
        </Text>
        {member.email ? (
          <Text
            numberOfLines={1}
            style={[styles.memberEmail, { color: colors.muted }]}
          >
            {member.email}
          </Text>
        ) : null}
        {!desktop ? (
          <Text
            numberOfLines={2}
            style={[styles.memberMeta, { color: colors.muted }]}
          >
            {(member.assigned_extension_numbers || []).length
              ? `Extensions: ${member.assigned_extension_numbers!.join(", ")}`
              : "No extension assigned"}
          </Text>
        ) : null}
      </View>
    </View>
  );

  const badge = (label: string, color: string, background: string) => (
    <View
      style={[
        styles.badge,
        { borderColor: `${color}35`, backgroundColor: background },
      ]}
    >
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      <View style={[styles.controls, { borderColor: colors.border }]}>
        <View
          style={[
            styles.search,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <IconSymbol name="magnifyingglass" size={17} color={colors.muted} />
          <TextInput
            accessibilityLabel="Search people"
            value={search}
            onChangeText={setSearch}
            placeholder="Name, email or extension"
            placeholderTextColor={colors.muted}
            style={[styles.searchInput, { color: colors.foreground }]}
          />
        </View>
        {filters}
      </View>
      <Text style={[styles.resultCount, { color: colors.muted }]}>
        Showing {filtered.length} of {members.length}{" "}
        {members.length === 1 ? "person" : "people"}
      </Text>
      {filtered.length === 0 ? (
        <View style={[styles.empty, { borderColor: colors.border }]}>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            {members.length
              ? "No matching people"
              : "No people in this workspace"}
          </Text>
          <Text style={[styles.emptyText, { color: colors.muted }]}>
            {members.length
              ? "Adjust the search or clear a role or status filter."
              : "An owner must add verified people through the approved identity process."}
          </Text>
        </View>
      ) : desktop ? (
        <View
          style={[
            styles.table,
            { borderColor: colors.border, backgroundColor: colors.surface },
          ]}
        >
          <View
            style={[
              styles.tableHeader,
              {
                backgroundColor: colors.background,
                borderBottomColor: colors.border,
              },
            ]}
          >
            <Text
              style={[
                styles.headerCell,
                styles.personColumn,
                { color: colors.muted },
              ]}
            >
              Person
            </Text>
            <Text
              style={[
                styles.headerCell,
                styles.extensionColumn,
                { color: colors.muted },
              ]}
            >
              Extension
            </Text>
            <Text
              style={[
                styles.headerCell,
                styles.roleColumn,
                { color: colors.muted },
              ]}
            >
              Role
            </Text>
            <Text
              style={[
                styles.headerCell,
                styles.statusColumn,
                { color: colors.muted },
              ]}
            >
              Status
            </Text>
            <Text
              style={[
                styles.headerCell,
                styles.actionColumn,
                { color: colors.muted },
              ]}
            >
              Actions
            </Text>
          </View>
          {filtered.map((member, index) => (
            <View
              key={member.id}
              style={[
                styles.tableRow,
                {
                  borderBottomColor: colors.border,
                  backgroundColor:
                    index % 2 ? colors.background : colors.surface,
                },
              ]}
            >
              <View style={styles.personColumn}>{person(member)}</View>
              <View style={[styles.extensionColumn, styles.cell]}>
                {(member.assigned_extension_numbers || []).length ? (
                  member.assigned_extension_numbers!.map((ext) => (
                    <Text
                      key={ext}
                      style={[styles.cellText, { color: colors.foreground }]}
                    >
                      {ext}
                    </Text>
                  ))
                ) : (
                  <Text style={[styles.cellSecondary, { color: colors.muted }]}>
                    —
                  </Text>
                )}
              </View>
              <View style={[styles.roleColumn, styles.cell]}>
                {badge(
                  roleLabel(member.role),
                  member.role === "owner"
                    ? "#7C3AED"
                    : member.role === "admin"
                      ? colors.primary
                      : colors.muted,
                  member.role === "owner"
                    ? "#8B5CF618"
                    : member.role === "admin"
                      ? `${colors.primary}14`
                      : colors.background,
                )}
              </View>
              <View style={[styles.statusColumn, styles.cell]}>
                {badge(
                  member.status === "active" ? "Active" : "Inactive",
                  member.status === "active" ? "#00875A" : colors.muted,
                  member.status === "active"
                    ? "#00A87818"
                    : `${colors.muted}18`,
                )}
              </View>
              <View style={[styles.actionColumn, styles.cell]}>
                {renderAction(member)}
              </View>
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.mobileList}>
          {filtered.map((member) => (
            <View
              key={member.id}
              style={[
                styles.mobileCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              {person(member)}
              <View style={styles.mobileDetails}>
                <View style={styles.badges}>
                  {badge(
                    roleLabel(member.role),
                    member.role === "owner"
                      ? "#7C3AED"
                      : member.role === "admin"
                        ? colors.primary
                        : colors.muted,
                    member.role === "owner"
                      ? "#8B5CF618"
                      : member.role === "admin"
                        ? `${colors.primary}14`
                        : colors.background,
                  )}
                  {badge(
                    member.status === "active" ? "Active" : "Inactive",
                    member.status === "active" ? "#00875A" : colors.muted,
                    member.status === "active"
                      ? "#00A87818"
                      : `${colors.muted}18`,
                  )}
                </View>
                {renderAction(member)}
              </View>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, width: "100%", minHeight: 0 },
  content: { flexGrow: 1, width: "100%", paddingBottom: 24 },
  controls: {
    zIndex: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexWrap: "wrap",
  },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 40,
    width: 290,
    maxWidth: "100%",
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
  },
  filterGroup: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  filterPicker: { position: "relative" },
  filterButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 11,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  filterMenu: {
    position: "absolute",
    top: 44,
    left: 0,
    minWidth: 150,
    padding: 4,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    zIndex: 5,
    elevation: 5,
    boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
  },
  filterOption: {
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: 10,
    borderRadius: 5,
  },
  filterText: { fontSize: 12, fontWeight: "600" },
  resultCount: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    fontSize: 12,
  },
  table: {
    marginHorizontal: 16,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
  },
  tableHeader: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 40,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 68,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerCell: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.25,
    textTransform: "uppercase",
  },
  personColumn: { flex: 4, minWidth: 0 },
  extensionColumn: { flex: 1.5, minWidth: 76 },
  roleColumn: { flex: 1.25, minWidth: 82 },
  statusColumn: { flex: 1.25, minWidth: 86 },
  actionColumn: { flex: 1, minWidth: 82, alignItems: "flex-end" },
  cell: { flexDirection: "row", alignItems: "center", gap: 4 },
  cellText: { fontSize: 14, fontWeight: "500" },
  cellSecondary: { fontSize: 14 },
  personCell: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
  },
  personCopy: { flex: 1, minWidth: 0 },
  memberName: { fontSize: 14, fontWeight: "600" },
  memberEmail: { marginTop: 2, fontSize: 12 },
  memberMeta: { marginTop: 4, fontSize: 12 },
  badge: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  badgeText: { fontSize: 11, fontWeight: "700" },
  manageButton: {
    minHeight: 34,
    justifyContent: "center",
    paddingHorizontal: 11,
    borderRadius: 7,
    borderWidth: 1,
  },
  manageText: { fontSize: 12, fontWeight: "700" },
  fixedLabel: { fontSize: 12 },
  mobileList: { paddingHorizontal: 16, paddingBottom: 32, gap: 10 },
  mobileCard: {
    padding: 14,
    gap: 12,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
  },
  mobileDetails: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  badges: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  empty: {
    alignItems: "center",
    margin: 16,
    padding: 28,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  emptyTitle: { fontSize: 16, fontWeight: "700", textAlign: "center" },
  emptyText: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
});
