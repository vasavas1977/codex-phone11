/**
 * Tenant extension administration.
 *
 * Lists the active workspace's extensions and lets tenant administrators assign
 * them to active workspace people through the authoritative PBX update path.
 */

import { useMemo, useRef, useState } from "react";
import { AdminWorkspaceBoundary } from "@/components/admin/admin-workspace-boundary";
import { useAdminActionScope } from "@/components/admin/use-admin-action-scope";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import { ProfileCardProvider } from "@/components/profile/profile-card-provider";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { useDirectory } from "@/hooks/use-directory";
import { lastRegistrationLabel } from "@/lib/pbx/registration-history";
import {
  useCreateExtension,
  useExtensions,
  useTenant,
  useTenantPeople,
  useUpdateExtension,
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

type TenantPerson = {
  id: number;
  name?: string | null;
  email?: string | null;
  assigned_extension_numbers?: string[] | null;
  photoUrl?: string | null;
  photoVersion?: string | null;
};

function extensionNumber(row: ExtensionRow) {
  return row.extension_number || String(row.id);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Please try again.";
}

export default function AdminExtensions() {
  return (
    <AdminWorkspaceBoundary>
      <AdminExtensionsContent />
    </AdminWorkspaceBoundary>
  );
}

function AdminExtensionsContent() {
  const colors = useColors();
  const { user } = useAuth({ autoFetch: false });
  const tenantQuery = useTenant();
  const tenantId = tenantQuery.data?.id;
  const canManage = ["owner", "admin"].includes(
    String(tenantQuery.data?.userRole || ""),
  );
  const [page, setPage] = useState(1);
  const extensionsQuery = useExtensions(
    page,
    100,
    tenantQuery.isSuccess && canManage,
  );
  const createExtension = useCreateExtension(false);
  const updateExtension = useUpdateExtension(false);
  const peopleQuery = useTenantPeople(tenantQuery.isSuccess && canManage);
  const directory = useDirectory(tenantId, tenantQuery.isSuccess && canManage);
  const actions = useAdminActionScope(tenantId ?? 0, tenantQuery.isSuccess && canManage);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ExtensionFilter>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [extension, setExtension] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [editingAssignment, setEditingAssignment] = useState<ExtensionRow | null>(null);
  const [selectedPersonId, setSelectedPersonId] = useState<number | null>(null);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const [pageWidth, setPageWidth] = useState(0);
  const createLifetime = useRef(0);
  const assignmentLifetime = useRef(0);
  const createRevision = createLifetime.current;
  const assignmentRevision = assignmentLifetime.current;
  const desktop = pageWidth >= 820;

  const rows = useMemo(
    () => (extensionsQuery.data?.data || []) as ExtensionRow[],
    [extensionsQuery.data?.data],
  );
  const pagination = extensionsQuery.data?.pagination;
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
  const people = useMemo(
    () => (peopleQuery.data || []) as TenantPerson[],
    [peopleQuery.data],
  );
  const inventoryReady = extensionsQuery.isSuccess && !extensionsQuery.isFetching && !extensionsQuery.isError;
  const peopleReady = peopleQuery.isSuccess && !peopleQuery.isFetching && !peopleQuery.isError;
  const liveEditor = useRef({ rows, people, inventoryReady, peopleReady, editingAssignment, selectedPersonId, extension, displayName, showCreate });
  liveEditor.current = { rows, people, inventoryReady, peopleReady, editingAssignment, selectedPersonId, extension, displayName, showCreate };
  const directoryPhotos = useMemo(() => {
    if (
      !user?.id ||
      !tenantId ||
      directory.owner !== user.id ||
      directory.requestedTenant !== tenantId ||
      directory.workspace?.id !== tenantId
    ) return new Map<number, string>();
    // The Team directory supplies only active members with active extensions.
    // Resolve by exact user ID; ProfileAvatar verifies tenant and ID in the photo URL.
    return new Map(
      directory.people
        .filter((person) => Boolean(person.extension?.trim() && person.photoUrl))
        .map((person) => [person.id, person.photoUrl!] as const),
    );
  }, [directory.owner, directory.people, directory.requestedTenant, directory.workspace?.id, tenantId, user?.id]);

  const resetCreate = () => {
    createLifetime.current++;
    setExtension("");
    setDisplayName("");
    setShowCreate(false);
  };

  const handleCreate = async () => {
    if (
      !actions.current() || !liveEditor.current.showCreate ||
      createLifetime.current !== createRevision ||
      liveEditor.current.extension !== extension || liveEditor.current.displayName !== displayName
    ) return;
    if (!tenantId) {
      Alert.alert("Choose a workspace", "Select a workspace before creating an extension.");
      return;
    }
    const number = extension.trim();
    if (!/^\d{2,10}$/.test(number)) {
      Alert.alert(
        "Check the extension",
        "Use 2 to 10 digits for the extension number.",
      );
      return;
    }

    const action = actions.reserve();
    if (!action) return;
    try {
      await createExtension.mutateAsync({
        tenantId,
        extensionNumber: number,
        displayName: displayName.trim() || `Extension ${number}`,
        type: "user",
        transport: "UDP",
      });
      if (action.current() && createLifetime.current === createRevision) {
        resetCreate();
        void actions.utils.pbx.extensions.list.invalidate({
          page, pageSize: 100, sortBy: "extension_number", sortOrder: "asc", tenantId,
        }, { exact: true }).catch(() => undefined);
        if (action.current() && actions.canRefreshImplicitStats())
          void actions.utils.pbx.dashboard.stats.invalidate(undefined, { exact: true }).catch(() => undefined);
        if (!action.current()) return;
        Alert.alert(
          "Extension created",
          `Extension ${number} is ready to assign to an active workspace person.`,
        );
      }
    } catch (error) {
      if (action.current() && createLifetime.current === createRevision)
        Alert.alert("Extension not created", errorMessage(error));
    } finally {
      action.finish();
    }
  };

  const closeAssignmentEditor = () => {
    assignmentLifetime.current++;
    setEditingAssignment(null);
    setSelectedPersonId(null);
    setAssignmentError(null);
  };

  const openAssignmentEditor = (row: ExtensionRow) => {
    if (!actions.current() || actions.busy() || !liveEditor.current.inventoryReady ||
      !liveEditor.current.rows.some((item) => item === row)) return;
    assignmentLifetime.current++;
    setEditingAssignment(row);
    setSelectedPersonId(row.user_id ?? null);
    setAssignmentError(null);
  };

  const saveAssignment = async () => {
    if (!actions.current() || !editingAssignment ||
      assignmentLifetime.current !== assignmentRevision ||
      liveEditor.current.editingAssignment !== editingAssignment ||
      liveEditor.current.selectedPersonId !== selectedPersonId) return;
    // Read the cache at action time: a query update can precede React's rerender.
    const currentRows = actions.utils.pbx.extensions.list.getData({
      page, pageSize: 100, sortBy: "extension_number", sortOrder: "asc", tenantId: tenantId ?? 0,
    })?.data;
    const currentRow = currentRows?.find((row) => row.id === editingAssignment.id);
    if (!liveEditor.current.inventoryReady || !currentRow ||
      JSON.stringify(currentRow) !== JSON.stringify(editingAssignment)) {
      setAssignmentError("This extension changed or is refreshing. Close the editor and reopen it from the current list.");
      return;
    }
    const currentPeople = actions.utils.pbx.tenant.people.getData({ tenantId: tenantId ?? 0 });
    if (!liveEditor.current.peopleReady || !currentPeople || (selectedPersonId !== null &&
      !currentPeople.some((person) => person.id === selectedPersonId))) {
      setAssignmentError("Refresh active workspace people and choose an available person before saving.");
      return;
    }
    if (!tenantId) {
      setAssignmentError("Select a workspace before assigning an extension.");
      return;
    }
    const action = actions.reserve();
    if (!action) return;
    try {
      await updateExtension.mutateAsync({
        tenantId,
        id: editingAssignment.id,
        userId: selectedPersonId,
      });
      // Close before refetching so a slow best-effort refresh cannot reopen it.
      if (action.current() && assignmentLifetime.current === assignmentRevision) {
        closeAssignmentEditor();
        void actions.utils.pbx.extensions.list.invalidate({
          page, pageSize: 100, sortBy: "extension_number", sortOrder: "asc", tenantId,
        }, { exact: true }).catch(() => undefined);
        if (action.current())
          void actions.utils.pbx.tenant.people.invalidate({ tenantId }, { exact: true }).catch(() => undefined);
      }
    } catch (error) {
      // Keep the chosen person visible so an administrator can retry or change it.
      if (action.current() && assignmentLifetime.current === assignmentRevision)
        setAssignmentError(errorMessage(error));
    } finally {
      action.finish();
    }
  };

  const renderExtension = ({ item }: { item: ExtensionRow }) => {
    const assigned = Boolean(item.user_id);
    const registration = lastRegistrationLabel(item.last_registered_at);
    const personName = item.user_name || item.display_name || "Unassigned extension";
    const assignmentAction = (
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`${assigned ? "Change" : "Assign"} person for extension ${extensionNumber(item)}`}
        disabled={!inventoryReady || updateExtension.isPending || createExtension.isPending}
        onPress={() => openAssignmentEditor(item)}
        style={[styles.assignmentButton, { borderColor: colors.primary }]}
      >
        <Text style={[styles.assignmentButtonText, { color: colors.primary }]}>
          {assigned ? "Change" : "Assign"}
        </Text>
      </TouchableOpacity>
    );

    if (desktop) {
      return (
        <View style={[styles.tableRow, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          <View style={[styles.extensionColumn, styles.desktopCell]}>
            <Text style={[styles.number, { color: colors.foreground }]}>{extensionNumber(item)}</Text>
            <Text style={[styles.name, { color: colors.muted }]}>{item.display_name || "User extension"}</Text>
          </View>
          <View style={[styles.personColumn, styles.desktopCell]}>
            {assigned && item.user_id ? (
              <ProfileAvatar name={personName} photoUrl={directoryPhotos.get(item.user_id) || null} tenantId={tenantId} userId={item.user_id} size={34} />
            ) : null}
            <View style={styles.cardBody}>
              <Text numberOfLines={1} style={[styles.personName, { color: colors.foreground }]}>
                {assigned ? personName : "Unassigned"}
              </Text>
              {item.user_email ? <Text numberOfLines={1} style={[styles.meta, { color: colors.muted }]}>{item.user_email}</Text> : null}
            </View>
          </View>
          <View style={[styles.registrationColumn, styles.desktopCell]}>
            <Text style={[styles.cellText, { color: colors.foreground }]}>{registration}</Text>
          </View>
          <View style={[styles.assignmentColumn, styles.desktopCell]}>
            <View style={[styles.badge, { backgroundColor: assigned ? "#00C89620" : "#FF950020" }]}>
              <Text style={[styles.badgeText, { color: assigned ? "#00875A" : "#B45309" }]}>{assigned ? "Assigned" : "Open"}</Text>
            </View>
          </View>
          <View style={[styles.actionColumn, styles.desktopCell]}>{assignmentAction}</View>
        </View>
      );
    }

    return (
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={[styles.icon, { backgroundColor: colors.primary + "15" }]}>
          <IconSymbol name="phone.fill" size={18} color={colors.primary} />
        </View>
        <View style={styles.cardBody}>
          <Text style={[styles.number, { color: colors.foreground }]}>{extensionNumber(item)}</Text>
          <Text style={[styles.name, { color: colors.muted }]}>{personName}</Text>
          <Text style={[styles.meta, { color: colors.muted }]}>
            {assigned ? item.user_email || "Assigned to a workspace member" : "No person assigned"} · Last registration: {registration}
          </Text>
        </View>
        <View style={[styles.badge, { backgroundColor: assigned ? "#00C89620" : "#FF950020" }]}>
          <Text style={[styles.badgeText, { color: assigned ? "#00A876" : "#D97706" }]}>
            {assigned ? "ASSIGNED" : "OPEN"}
          </Text>
        </View>
        {assignmentAction}
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
    <View style={[styles.inventory, { borderTopColor: colors.border }]}>
      <Text style={[styles.resultCount, { color: colors.muted }]}>
        Showing {filtered.length} of {rows.length} extensions on this page · {pagination?.total ?? rows.length} total
      </Text>
      {pagination && (pagination.totalPages > 1 || pagination.hasPrev) ? (
        <View style={[styles.pagination, { borderBottomColor: colors.border }]}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Previous extensions page"
            disabled={!pagination.hasPrev || extensionsQuery.isFetching}
            onPress={() => setPage(Math.max(1, page - 1))}
          >
            <Text style={[styles.retry, { color: !pagination.hasPrev || extensionsQuery.isFetching ? colors.muted : colors.primary }]}>Previous</Text>
          </TouchableOpacity>
          <Text style={[styles.cellText, { color: colors.foreground }]}>Page {pagination.page} of {pagination.totalPages}</Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Next extensions page"
            disabled={!pagination.hasNext || extensionsQuery.isFetching}
            onPress={() => setPage(page + 1)}
          >
            <Text style={[styles.retry, { color: !pagination.hasNext || extensionsQuery.isFetching ? colors.muted : colors.primary }]}>Next</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <FlatList
        style={styles.inventoryList}
        data={filtered}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderExtension}
        contentContainerStyle={[styles.list, desktop && styles.desktopList]}
        refreshing={extensionsQuery.isRefetching}
        onRefresh={extensionsQuery.refetch}
        ListHeaderComponent={desktop ? (
          <View style={[styles.tableHeader, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
            <Text style={[styles.extensionColumn, styles.tableHeading, { color: colors.muted }]}>Extension</Text>
            <Text style={[styles.personColumn, styles.tableHeading, { color: colors.muted }]}>Person</Text>
            <Text style={[styles.registrationColumn, styles.tableHeading, { color: colors.muted }]}>Last registration</Text>
            <Text style={[styles.assignmentColumn, styles.tableHeading, { color: colors.muted }]}>Assignment</Text>
            <Text style={[styles.actionColumn, styles.tableHeading, { color: colors.muted }]}>Actions</Text>
          </View>
        ) : null}
        ListEmptyComponent={
          <View style={styles.state}>
            <Text style={[styles.stateTitle, { color: colors.foreground }]}>
              {rows.length === 0 ? "No extensions yet" : "No matching extensions"}
            </Text>
            <Text style={[styles.stateText, { color: colors.muted }]}>
              {rows.length === 0 ? "Create the first extension for this workspace." : "Change the search or filter, or browse another page."}
            </Text>
          </View>
        }
      />
    </View>
  );

  return (
    <ScreenContainer onLayout={(event) => setPageWidth(event.nativeEvent.layout.width)}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        {Platform.OS !== "web" ? (
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to admin portal" onPress={() => router.back()} style={styles.headerButton}>
            <IconSymbol name="chevron.left" size={22} color={colors.primary} />
          </TouchableOpacity>
        ) : null}
        <View style={styles.heading}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
            Extensions
          </Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>
            {tenantQuery.data?.name || "Current workspace"}
          </Text>
        </View>
        {canManage && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Create extension"
            disabled={createExtension.isPending || updateExtension.isPending}
            onPress={() => {
              if (!actions.current() || actions.busy()) return;
              createLifetime.current++;
              setShowCreate(true);
            }}
            style={[styles.addButton, { backgroundColor: colors.primary }]}
          >
            <IconSymbol name="plus" size={18} color="#fff" />
          </TouchableOpacity>
        )}
      </View>

      {canManage && (
        <View style={[styles.controls, desktop && styles.desktopControls]}>
          <View
            style={[
              styles.search,
              desktop && styles.desktopSearch,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <IconSymbol name="magnifyingglass" size={18} color={colors.muted} />
            <TextInput
              accessibilityLabel="Search extensions"
              style={[styles.searchInput, { color: colors.foreground }]}
              placeholder="Search this page for extension or person"
              placeholderTextColor={colors.muted}
              value={search}
              onChangeText={setSearch}
            />
          </View>
          <View style={styles.filters}>
            {(["all", "assigned", "open"] as const).map((value) => (
              <TouchableOpacity
                key={value}
                accessibilityRole="button"
                accessibilityState={{ selected: filter === value }}
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
        </View>
      )}

      {listState}

      <Modal
        visible={showCreate}
        animationType="slide"
        transparent
        onRequestClose={resetCreate}
      >
        <View style={[styles.modalOverlay, desktop && styles.modalOverlayDesktop]}>
          <View
            style={[
              styles.modal,
              desktop && styles.modalDesktop,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>
                New extension
              </Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close extension creation" onPress={resetCreate}>
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
              accessibilityLabel="Extension number"
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
              accessibilityLabel="Extension display name"
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
              You can assign the new extension to an active workspace person
              after creating it.
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Confirm create extension"
              style={[
                styles.createButton,
                {
                  backgroundColor: colors.primary,
                  opacity: createExtension.isPending ? 0.65 : 1,
                },
              ]}
              onPress={handleCreate}
              disabled={createExtension.isPending || updateExtension.isPending}
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

      <Modal
        visible={Boolean(editingAssignment)}
        animationType="slide"
        transparent
        onRequestClose={closeAssignmentEditor}
      >
        <ProfileCardProvider key={editingAssignment ? "visible" : "hidden"} selectionOnly><View style={[styles.modalOverlay, desktop && styles.modalOverlayDesktop]}>
          <View
            style={[
              styles.modal,
              desktop && styles.modalDesktop,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.modalHeader}>
              <View>
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>
                  Assign person
                </Text>
                <Text style={[styles.modalSubtitle, { color: colors.muted }]}>
                  Extension {editingAssignment ? extensionNumber(editingAssignment) : ""}
                </Text>
              </View>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close assignment editor" onPress={closeAssignmentEditor}>
                <IconSymbol name="xmark.circle.fill" size={24} color={colors.muted} />
              </TouchableOpacity>
            </View>

            {editingAssignment?.user_id && !people.some((person) => person.id === editingAssignment.user_id) && (
              <Text style={[styles.warning, { color: "#B45309" }]}>
                The current assignment is not an active workspace person. Choose an active person or unassign it.
              </Text>
            )}

            {peopleQuery.isLoading ? (
              <View style={styles.peopleState}>
                <ActivityIndicator color={colors.primary} />
                <Text style={[styles.stateText, { color: colors.muted }]}>Loading people…</Text>
              </View>
            ) : peopleQuery.isError ? (
              <View style={styles.peopleState}>
                <Text style={[styles.stateText, { color: colors.muted }]}>Couldn’t load active workspace people.</Text>
                <TouchableOpacity accessibilityRole="button" onPress={() => void peopleQuery.refetch()}>
                  <Text style={[styles.retry, { color: colors.primary }]}>Try again</Text>
                </TouchableOpacity>
              </View>
            ) : people.length === 0 ? (
              <Text style={[styles.stateText, { color: colors.muted }]}>There are no active workspace people to assign.</Text>
            ) : (
              <ScrollView style={styles.peopleList} contentContainerStyle={styles.peopleListContent}>
                {people.map((person) => {
                  const selected = person.id === selectedPersonId;
                  const existingAssignments = person.assigned_extension_numbers || [];
                  const photoUrl = person.photoUrl || directoryPhotos.get(person.id) || null;
                  return (
                    <TouchableOpacity
                      key={person.id}
                      accessibilityRole="radio"
                      aria-checked={selected}
                      accessibilityLabel={`Assign ${person.name || person.email || `member ${person.id}`}${existingAssignments.length ? `. Currently assigned to ${existingAssignments.join(", ")}` : ""}`}
                      onPress={() => {
                        setSelectedPersonId(person.id);
                        setAssignmentError(null);
                      }}
                      style={[
                        styles.personRow,
                        {
                          backgroundColor: selected ? colors.primary + "12" : colors.background,
                          borderColor: selected ? colors.primary : colors.border,
                        },
                      ]}
                    >
                      <ProfileAvatar
                        name={person.name?.trim() || person.email?.trim() || `Member ${person.id}`}
                        photoUrl={photoUrl}
                        photoVersion={person.photoVersion}
                        tenantId={tenantId}
                        userId={person.id}
                        size={36}
                      />
                      <View style={styles.personCopy}>
                        <Text style={[styles.personName, { color: colors.foreground }]}>
                          {person.name || person.email || `Member ${person.id}`}
                        </Text>
                        {person.email && <Text style={[styles.personMeta, { color: colors.muted }]}>{person.email}</Text>}
                        {existingAssignments.length > 0 && (
                          <Text style={[styles.personMeta, { color: colors.muted }]}>
                            Currently assigned: {existingAssignments.join(", ")}
                          </Text>
                        )}
                      </View>
                      <IconSymbol name={selected ? "checkmark.circle.fill" : "circle"} size={20} color={selected ? colors.primary : colors.muted} />
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}

            {assignmentError && <Text accessibilityRole="alert" style={[styles.assignmentError, { color: "#DC2626" }]}>{assignmentError}</Text>}
            <View style={styles.assignmentActions}>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => {
                  setSelectedPersonId(null);
                  setAssignmentError(null);
                }}
                style={[styles.secondaryButton, { borderColor: colors.border }]}
              >
                <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>Unassign</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={selectedPersonId === null ? "Save unassigned extension" : "Save person assignment"}
                disabled={updateExtension.isPending || createExtension.isPending || !inventoryReady || !peopleReady || (selectedPersonId !== null && !people.some((person) => person.id === selectedPersonId))}
                onPress={() => void saveAssignment()}
                style={[styles.saveAssignmentButton, { backgroundColor: colors.primary, opacity: updateExtension.isPending ? 0.65 : 1 }]}
              >
                {updateExtension.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.createText}>{selectedPersonId === null ? "Save unassigned" : "Save assignment"}</Text>}
              </TouchableOpacity>
            </View>
            <Text style={[styles.note, { color: colors.muted }]}>Assignment updates workspace source state only. It does not confirm a handset or SIP registration.</Text>
          </View>
        </View></ProfileCardProvider>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  pagination: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
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
  title: { fontSize: 24, fontWeight: "700" },
  subtitle: { fontSize: 13, marginTop: 3 },
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
    marginTop: 4,
    paddingHorizontal: 14,
    height: 40,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 15 },
  controls: { paddingVertical: 12, gap: 10 },
  desktopControls: { flexDirection: "row", alignItems: "center", paddingHorizontal: 24, paddingVertical: 12 },
  desktopSearch: { flex: 1, maxWidth: 420, marginHorizontal: 0, marginTop: 0 },
  filters: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 0,
    gap: 8,
    flexWrap: "wrap",
  },
  filter: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 18,
    borderWidth: 0.5,
  },
  filterText: { fontSize: 12, fontWeight: "600" },
  resultCount: { paddingHorizontal: 24, paddingBottom: 8, fontSize: 12 },
  inventory: { flex: 1, minHeight: 0, borderTopWidth: StyleSheet.hairlineWidth },
  inventoryList: { flex: 1 },
  list: { paddingHorizontal: 16, paddingBottom: 24, gap: 8 },
  desktopList: { paddingHorizontal: 24, gap: 0 },
  tableHeader: { flexDirection: "row", alignItems: "center", minHeight: 42, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  tableHeading: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.25 },
  tableRow: { flexDirection: "row", alignItems: "center", minHeight: 72, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  desktopCell: { flexDirection: "row", alignItems: "center", gap: 10 },
  extensionColumn: { flex: 1.25, minWidth: 100 },
  personColumn: { flex: 3.5, minWidth: 0 },
  registrationColumn: { flex: 1.5, minWidth: 122 },
  assignmentColumn: { flex: 1.3, minWidth: 110 },
  actionColumn: { flex: 1, minWidth: 85, justifyContent: "flex-end" },
  cellText: { fontSize: 13, fontWeight: "500" },
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
  assignmentButton: {
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: 8,
    borderWidth: 1,
    borderRadius: 8,
  },
  assignmentButtonText: { fontSize: 12, fontWeight: "700" },
  state: { padding: 28, alignItems: "center", gap: 8 },
  stateTitle: { fontSize: 16, fontWeight: "700", textAlign: "center" },
  stateText: { fontSize: 13, lineHeight: 19, textAlign: "center" },
  retry: { fontSize: 14, fontWeight: "600", marginTop: 4 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalOverlayDesktop: { justifyContent: "center", alignItems: "center", padding: 24 },
  modal: {
    padding: 20,
    paddingBottom: 36,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 0.5,
    gap: 10,
  },
  modalDesktop: { width: "100%", maxWidth: 560, maxHeight: "90%", alignSelf: "center", borderRadius: 16, paddingBottom: 24 },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  modalTitle: { fontSize: 20, fontWeight: "700" },
  modalSubtitle: { fontSize: 13, marginTop: 2 },
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
  warning: {
    fontSize: 12,
    lineHeight: 18,
    padding: 10,
    borderRadius: 8,
    backgroundColor: "#FEF3C7",
  },
  peopleState: { minHeight: 100, alignItems: "center", justifyContent: "center", gap: 8 },
  peopleList: { maxHeight: 300 },
  peopleListContent: { gap: 8 },
  personRow: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderWidth: 1,
    borderRadius: 10,
    gap: 10,
  },
  personCopy: { flex: 1, minWidth: 0 },
  personName: { fontSize: 14, fontWeight: "600" },
  personMeta: { fontSize: 12, marginTop: 2 },
  assignmentError: { fontSize: 13, lineHeight: 18 },
  assignmentActions: { flexDirection: "row", gap: 8, marginTop: 4 },
  secondaryButton: {
    minHeight: 46,
    paddingHorizontal: 14,
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 12,
  },
  secondaryButtonText: { fontSize: 14, fontWeight: "700" },
  saveAssignmentButton: {
    minHeight: 46,
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 12,
  },
});
