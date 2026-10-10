import { useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { AdminShell } from "@/components/admin/admin-shell";
import {
  AdminPeopleTable,
  type AdminPeopleMember,
} from "@/components/admin/admin-people-table";
import { useColors } from "@/hooks/use-colors";

const members: AdminPeopleMember[] = [
  {
    id: 1,
    name: "Alex Morgan",
    email: "alex@preview.invalid",
    role: "owner",
    status: "active",
    assigned_extension_numbers: ["3001"],
  },
  {
    id: 2,
    name: "Narin S.",
    email: "narin@preview.invalid",
    role: "admin",
    status: "active",
    assigned_extension_numbers: ["1020"],
  },
  {
    id: 3,
    name: "Maya Chen",
    email: "maya@preview.invalid",
    role: "user",
    status: "active",
    assigned_extension_numbers: ["1021"],
  },
  {
    id: 4,
    name: "Daniel Park",
    email: "daniel@preview.invalid",
    role: "user",
    status: "active",
    assigned_extension_numbers: ["1022"],
  },
  {
    id: 5,
    name: "ลลิตา สุขใจ",
    email: "lalita@preview.invalid",
    role: "user",
    status: "active",
    assigned_extension_numbers: ["1023"],
  },
  {
    id: 6,
    name: "Sam Taylor",
    email: "sam@preview.invalid",
    role: "user",
    status: "inactive",
    assigned_extension_numbers: [],
  },
];

export default function AdminPreview() {
  if (!__DEV__ || Platform.OS !== "web") return null;
  return <PreviewContent />;
}
function PreviewContent() {
  const colors = useColors();
  const [workspace, setWorkspace] = useState(1);
  const [editing, setEditing] = useState<AdminPeopleMember | null>(null);
  return (
    <AdminShell
      pathname="/admin/users"
      workspaceName={workspace === 1 ? "Phone11 demo" : "Branch demo"}
      workspaces={[
        { id: 1, name: "Phone11 demo" },
        { id: 2, name: "Branch demo" },
      ]}
      selectedTenantId={workspace}
      canManage
      canUseImplicitTenant
      capabilities={{
        phoneNumbers: true,
        sites: true,
        ringGroups: true,
        queues: true,
        ivr: true,
        businessHours: true,
      }}
      onChooseWorkspace={setWorkspace}
      onNavigate={(path) => router.push(path as any)}
    >
      <ScrollView
        style={{ backgroundColor: colors.surface }}
        contentContainerStyle={styles.content}
      >
        <Text style={[styles.eyebrow, { color: colors.muted }]}>
          Workspace / People
        </Text>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: colors.foreground }]}
        >
          People
        </Text>
        <Text style={[styles.description, { color: colors.muted }]}>
          Manage the people and extensions in your workspace.
        </Text>
        <View
          style={[
            styles.notice,
            {
              backgroundColor: `${colors.primary}08`,
              borderColor: `${colors.primary}25`,
            },
          ]}
        >
          <Text style={{ fontSize: 13, color: colors.muted }}>
            Design preview · Sample members only. Search and filters use the
            production table component.
          </Text>
        </View>
        <AdminPeopleTable
          key={workspace}
          members={workspace === 1 ? members : members.slice(2, 4)}
          tenantId={workspace}
          directoryPhotos={new Map()}
          canManage
          canManageAdministrators
          onEdit={setEditing}
        />
      </ScrollView>
      <Modal
        visible={editing !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setEditing(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modal, { backgroundColor: colors.surface }]}>
            <Text style={[styles.title, { color: colors.foreground }]}>
              {editing?.name}
            </Text>
            <Text style={[styles.description, { color: colors.muted }]}>
              Sample member. In the signed-in admin page, this action opens the
              existing role and status editor.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setEditing(null)}
              style={styles.close}
            >
              <Text style={{ color: colors.primary }}>Close preview</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </AdminShell>
  );
}
const styles = StyleSheet.create({
  content: { padding: 32, gap: 8 },
  eyebrow: { fontSize: 12, marginBottom: 14 },
  title: { fontSize: 27, fontWeight: "600", letterSpacing: -0.5 },
  description: { fontSize: 14, lineHeight: 22, marginBottom: 18 },
  notice: { padding: 14, borderWidth: 1, borderRadius: 7, marginBottom: 18 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "#00000055",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  modal: { maxWidth: 430, padding: 28, borderRadius: 12 },
  close: { minHeight: 44, alignItems: "flex-end", justifyContent: "center" },
});
