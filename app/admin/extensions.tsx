/**
 * Tenant extension administration.
 *
 * Lists the active workspace's extensions and creates unassigned extensions.
 * People assignment stays read-only until the live People directory is wired.
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
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import {
  useCreateExtension,
  useExtensions,
  useTenant,
} from "@/hooks/use-pbx-admin";

type ExtensionFilter = "all" | "assigned" | "open";

type ExtensionRow = {
  id: number;
  extension_number?: string | null;
  display_name?: string | null;
  user_id?: number | null;
  user_name?: string | null;
  user_email?: string | null;
  sip_status?: string | null;
  last_registered_at?: string | null;
};

function extensionNumber(row: ExtensionRow) {
  return row.extension_number || String(row.id);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Please try again.";
}

export default function AdminExtensions() {
  const colors = useColors();
  const tenantQuery = useTenant();
  const canManage = ["owner", "admin"].includes(
    String(tenantQuery.data?.userRole || ""),
  );
  const extensionsQuery = useExtensions(
    1,
    100,
    tenantQuery.isSuccess && canManage,
  );
  const createExtension = useCreateExtension();

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ExtensionFilter>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [extension, setExtension] = useState("");
  const [displayName, setDisplayName] = useState("");

  const rows = useMemo(
    () => (extensionsQuery.data?.data || []) as ExtensionRow[],
    [extensionsQuery.data?.data],
  );
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      const assigned = Boolean(row.user_id);
      const matchesFilter =
        filter === "all" ||
        (filter === "assigned" && assigned) ||
        (filter === "open" && !assigned);
      const matchesSearch =
        !needle ||
        extensionNumber(row).toLowerCase().includes(needle) ||
        String(row.display_name || "")
          .toLowerCase()
          .includes(needle) ||
        String(row.user_name || "")
          .toLowerCase()
          .includes(needle) ||
        String(row.user_email || "")
          .toLowerCase()
          .includes(needle);
      return matchesFilter && matchesSearch;
    });
  }, [filter, rows, search]);

  const resetCreate = () => {
    setExtension("");
    setDisplayName("");
    setShowCreate(false);
  };

  const handleCreate = async () => {
    const number = extension.trim();
    if (!/^\d{2,10}$/.test(number)) {
      Alert.alert(
        "Check the extension",
        "Use 2 to 10 digits for the extension number.",
      );
      return;
    }

    try {
      await createExtension.mutateAsync({
        extensionNumber: number,
        displayName: displayName.trim() || `Extension ${number}`,
        type: "user",
        transport: "UDP",
      });
      resetCreate();
      Alert.alert(
        "Extension created",
        `Extension ${number} is ready to assign from the live People directory when that connection is available.`,
      );
    } catch (error) {
      Alert.alert("Extension not created", errorMessage(error));
    }
  };

  const renderExtension = ({ item }: { item: ExtensionRow }) => {
    const assigned = Boolean(item.user_id);
    const registration =
      item.sip_status === "active" && item.last_registered_at
        ? "Registered"
        : "Not registered";

    return (
      <View
        style={[
          styles.card,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <View style={[styles.icon, { backgroundColor: colors.primary + "15" }]}>
          <IconSymbol name="phone.fill" size={18} color={colors.primary} />
        </View>
        <View style={styles.cardBody}>
          <Text style={[styles.number, { color: colors.foreground }]}>
            {extensionNumber(item)}
          </Text>
          <Text style={[styles.name, { color: colors.muted }]}>
            {item.user_name || item.display_name || "Unassigned extension"}
          </Text>
          <Text style={[styles.meta, { color: colors.muted }]}>
            {assigned
              ? item.user_email || "Assigned to a workspace member"
              : "No person assigned"}{" "}
            · {registration}
          </Text>
        </View>
        <View
          style={[
            styles.badge,
            { backgroundColor: assigned ? "#00C89620" : "#FF950020" },
          ]}
        >
          <Text
            style={[
              styles.badgeText,
              { color: assigned ? "#00A876" : "#D97706" },
            ]}
          >
            {assigned ? "ASSIGNED" : "OPEN"}
          </Text>
        </View>
      </View>
    );
  };

  const listState = tenantQuery.isLoading ? (
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
        Ask a workspace owner or administrator to manage extensions.
      </Text>
    </View>
  ) : extensionsQuery.isError ? (
    <View style={styles.state}>
      <Text style={[styles.stateTitle, { color: colors.foreground }]}>
        Couldn’t load extensions
      </Text>
      <Text style={[styles.stateText, { color: colors.muted }]}>
        {errorMessage(extensionsQuery.error)}
      </Text>
      <TouchableOpacity onPress={() => extensionsQuery.refetch()}>
        <Text style={[styles.retry, { color: colors.primary }]}>Try again</Text>
      </TouchableOpacity>
    </View>
  ) : extensionsQuery.isLoading ? (
    <View style={styles.state}>
      <ActivityIndicator color={colors.primary} />
      <Text style={[styles.stateText, { color: colors.muted }]}>
        Loading extensions…
      </Text>
    </View>
  ) : (
    <FlatList
      data={filtered}
      keyExtractor={(item) => String(item.id)}
      renderItem={renderExtension}
      contentContainerStyle={styles.list}
      refreshing={extensionsQuery.isRefetching}
      onRefresh={extensionsQuery.refetch}
      ListEmptyComponent={
        <View style={styles.state}>
          <Text style={[styles.stateTitle, { color: colors.foreground }]}>
            {rows.length === 0 ? "No extensions yet" : "No matching extensions"}
          </Text>
          <Text style={[styles.stateText, { color: colors.muted }]}>
            {rows.length === 0
              ? "Create the first extension for this workspace."
              : "Change the search or filter."}
          </Text>
        </View>
      }
    />
  );

  return (
    <ScreenContainer>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.headerButton}
        >
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </TouchableOpacity>
        <View style={styles.heading}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            People & extensions
          </Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>
            {tenantQuery.data?.name || "Current workspace"}
          </Text>
        </View>
        {canManage && (
          <TouchableOpacity
            onPress={() => setShowCreate(true)}
            style={[styles.addButton, { backgroundColor: colors.primary }]}
          >
            <IconSymbol name="plus" size={18} color="#fff" />
          </TouchableOpacity>
        )}
      </View>

      {canManage && (
        <>
          <View
            style={[
              styles.search,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <IconSymbol name="magnifyingglass" size={18} color={colors.muted} />
            <TextInput
              style={[styles.searchInput, { color: colors.foreground }]}
              placeholder="Search extension or person"
              placeholderTextColor={colors.muted}
              value={search}
              onChangeText={setSearch}
            />
          </View>
          <View style={styles.filters}>
            {(["all", "assigned", "open"] as const).map((value) => (
              <TouchableOpacity
                key={value}
                onPress={() => setFilter(value)}
                style={[
                  styles.filter,
                  {
                    backgroundColor:
                      filter === value ? colors.primary : colors.surface,
                    borderColor:
                      filter === value ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.filterText,
                    { color: filter === value ? "#fff" : colors.muted },
                  ]}
                >
                  {value === "all"
                    ? `All ${rows.length}`
                    : value === "assigned"
                      ? `Assigned ${rows.filter((row) => row.user_id).length}`
                      : `Open ${rows.filter((row) => !row.user_id).length}`}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      {listState}

      <Modal
        visible={showCreate}
        animationType="slide"
        transparent
        onRequestClose={resetCreate}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modal,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>
                New extension
              </Text>
              <TouchableOpacity onPress={resetCreate}>
                <IconSymbol
                  name="xmark.circle.fill"
                  size={24}
                  color={colors.muted}
                />
              </TouchableOpacity>
            </View>
            <Text style={[styles.label, { color: colors.muted }]}>
              Extension number
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  color: colors.foreground,
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                },
              ]}
              value={extension}
              onChangeText={setExtension}
              keyboardType="number-pad"
              maxLength={10}
              placeholder="1020"
              placeholderTextColor={colors.muted}
            />
            <Text style={[styles.label, { color: colors.muted }]}>
              Display name
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  color: colors.foreground,
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                },
              ]}
              value={displayName}
              onChangeText={setDisplayName}
              maxLength={100}
              placeholder="Support desk"
              placeholderTextColor={colors.muted}
            />
            <Text style={[styles.note, { color: colors.muted }]}>
              The new extension will remain unassigned until the live People
              directory is connected.
            </Text>
            <TouchableOpacity
              style={[
                styles.createButton,
                {
                  backgroundColor: colors.primary,
                  opacity: createExtension.isPending ? 0.65 : 1,
                },
              ]}
              onPress={handleCreate}
              disabled={createExtension.isPending}
            >
              {createExtension.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.createText}>Create extension</Text>
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
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    gap: 12,
  },
  headerButton: { padding: 4 },
  heading: { flex: 1 },
  title: { fontSize: 20, fontWeight: "700" },
  subtitle: { fontSize: 12, marginTop: 2 },
  addButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  search: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 0.5,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 15 },
  filters: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  filter: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 18,
    borderWidth: 0.5,
  },
  filterText: { fontSize: 12, fontWeight: "600" },
  list: { paddingHorizontal: 16, paddingBottom: 24, gap: 8 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 14,
    borderWidth: 0.5,
    gap: 12,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  cardBody: { flex: 1, minWidth: 0 },
  number: { fontSize: 16, fontWeight: "700" },
  name: { fontSize: 13, marginTop: 2 },
  meta: { fontSize: 11, marginTop: 3 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  badgeText: { fontSize: 10, fontWeight: "700" },
  state: { padding: 28, alignItems: "center", gap: 8 },
  stateTitle: { fontSize: 16, fontWeight: "700", textAlign: "center" },
  stateText: { fontSize: 13, lineHeight: 19, textAlign: "center" },
  retry: { fontSize: 14, fontWeight: "600", marginTop: 4 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modal: {
    padding: 20,
    paddingBottom: 36,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 0.5,
    gap: 10,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  modalTitle: { fontSize: 20, fontWeight: "700" },
  label: { fontSize: 12, fontWeight: "600", marginTop: 4 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
  },
  note: { fontSize: 12, lineHeight: 18, marginTop: 2 },
  createButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 46,
    borderRadius: 12,
    marginTop: 8,
  },
  createText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
