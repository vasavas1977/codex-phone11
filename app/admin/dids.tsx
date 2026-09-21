/**
 * Tenant phone-number inventory.
 *
 * Displays carrier-provisioned numbers and their current PBX destinations.
 * Number acquisition remains unavailable from this screen.
 */

import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  ScrollView,
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
  useAssignPhoneNumberRoute,
  useCallQueues,
  useExtensions,
  useIvrMenus,
  type PbxManagementCapabilities,
  usePbxCapabilities,
  usePhoneNumbers,
  useRingGroups,
  useTenant,
  useTimeConditions,
} from "@/hooks/use-pbx-admin";

type NumberFilter = "all" | "assigned" | "unassigned";

type PhoneNumberRow = {
  id: number;
  number_e164?: string | null;
  number_display?: string | null;
  country?: string | null;
  number_type?: string | null;
  provider?: string | null;
  status?: string | null;
  assigned_route_type?: string | null;
  assigned_route_id?: number | null;
};

type RouteType =
  | "extension"
  | "ring_group"
  | "queue"
  | "ivr"
  | "time_condition";

type DestinationRow = {
  id?: number | string | null;
  name?: string | null;
  extension?: string | null;
  extension_number?: string | null;
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  type?: string | null;
  user_id?: number | string | null;
  sip_status?: string | null;
  sip_username?: string | null;
  sip_domain?: string | null;
  status?: string | null;
  is_active?: boolean | null;
  strategy?: string | null;
  deleted_at?: string | null;
  timezone?: string | null;
};

type DestinationOption = {
  id: number;
  label: string;
  isActive: boolean;
};

const ROUTE_TYPES: Array<{ value: RouteType; label: string }> = [
  { value: "extension", label: "Extension" },
  { value: "ring_group", label: "Ring group" },
  { value: "queue", label: "Queue" },
  { value: "ivr", label: "IVR menu" },
  { value: "time_condition", label: "Business hours" },
];

const ROUTE_CAPABILITY: Record<
  RouteType,
  keyof PbxManagementCapabilities | null
> = {
  extension: null,
  ring_group: "ringGroups",
  queue: "queues",
  ivr: "ivr",
  time_condition: "businessHours",
};

function routeTypeLabel(routeType?: string | null) {
  return ROUTE_TYPES.find((item) => item.value === routeType)?.label;
}

function destinationOption(
  routeType: RouteType,
  row: DestinationRow,
): DestinationOption | null {
  const id = Number(row.id);
  if (!Number.isSafeInteger(id) || id < 1) return null;

  if (routeType === "extension") {
    const dialCode = String(row.extension_number || "").trim();
    if (!dialCode) return null;
    const name = String(
      row.display_name ||
        [row.first_name, row.last_name].filter(Boolean).join(" ") ||
        "Extension",
    ).trim();
    return {
      id,
      label: `${name} · ${dialCode}`,
      isActive:
        row.status === "active" &&
        !row.deleted_at &&
        row.type === "user" &&
        Boolean(row.user_id) &&
        row.sip_status === "active" &&
        Boolean(row.sip_username) &&
        Boolean(row.sip_domain),
    };
  }

  const name = String(
    row.name || routeTypeLabel(routeType) || "Destination",
  ).trim();
  const dialCode = String(row.extension || "").trim();
  return {
    id,
    label:
      routeType === "time_condition"
        ? `${name}${row.timezone ? ` · ${row.timezone}` : ""}`
        : `${name}${dialCode ? ` · ${dialCode}` : ""}`,
    isActive:
      row.is_active !== false &&
      (routeType !== "ring_group" ||
        ["simultaneous", "sequential"].includes(String(row.strategy))) &&
      (routeType !== "queue" || row.strategy === "ring_all"),
  };
}

function numberLabel(row: PhoneNumberRow) {
  return row.number_display || row.number_e164 || String(row.id);
}

function routeLabel(
  row: PhoneNumberRow,
  destinations: Record<RouteType, DestinationOption[]>,
) {
  if (!row.assigned_route_type || !row.assigned_route_id) {
    return "Unassigned";
  }
  const routeType = row.assigned_route_type as RouteType;
  const option = destinations[routeType]?.find(
    (item) => item.id === Number(row.assigned_route_id),
  );
  const label = routeTypeLabel(routeType);
  return option && label
    ? `${label} · ${option.label}`
    : "Unavailable destination";
}

function typeLabel(value?: string | null) {
  if (!value) return "Number";
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Please try again.";
}

export default function AdminDIDs() {
  const colors = useColors();
  const tenantQuery = useTenant();
  const tenantId = Number(tenantQuery.data?.id || 0);
  const canManage = ["owner", "admin"].includes(
    String(tenantQuery.data?.userRole || ""),
  );
  const capabilitiesQuery = usePbxCapabilities(
    tenantQuery.isSuccess && canManage,
  );
  const schemaPhoneNumbersAvailable =
    capabilitiesQuery.data?.phoneNumbers === true;
  const routeTenantId = canManage ? tenantId : 0;
  const numbersQuery = usePhoneNumbers(
    1,
    100,
    tenantQuery.isSuccess && canManage && schemaPhoneNumbersAvailable,
  );
  const phoneNumbersAvailable =
    schemaPhoneNumbersAvailable && numbersQuery.data?.available !== false;
  const routeDestinationsEnabled = phoneNumbersAvailable && routeTenantId > 0;
  const routeMutation = useAssignPhoneNumberRoute();
  const extensionsQuery = useExtensions(1, 100, routeDestinationsEnabled);
  const ringGroupsQuery = useRingGroups(
    routeTenantId,
    routeDestinationsEnabled && capabilitiesQuery.data?.ringGroups === true,
  );
  const queuesQuery = useCallQueues(
    routeTenantId,
    routeDestinationsEnabled && capabilitiesQuery.data?.queues === true,
  );
  const ivrMenusQuery = useIvrMenus(
    routeTenantId,
    routeDestinationsEnabled && capabilitiesQuery.data?.ivr === true,
  );
  const timeConditionsQuery = useTimeConditions(
    routeTenantId,
    routeDestinationsEnabled && capabilitiesQuery.data?.businessHours === true,
  );
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<NumberFilter>("all");
  const [editingNumber, setEditingNumber] = useState<PhoneNumberRow | null>(
    null,
  );
  const [selectedRouteType, setSelectedRouteType] = useState<RouteType | null>(
    null,
  );
  const [selectedRouteId, setSelectedRouteId] = useState<number | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);

  const rows = useMemo(
    () => (numbersQuery.data?.data || []) as PhoneNumberRow[],
    [numbersQuery.data?.data],
  );
  const allDestinations = useMemo<Record<RouteType, DestinationOption[]>>(
    () => ({
      extension: ((extensionsQuery.data?.data || []) as DestinationRow[])
        .map((row) => destinationOption("extension", row))
        .filter((row): row is DestinationOption => row !== null),
      ring_group: ((ringGroupsQuery.data || []) as DestinationRow[])
        .map((row) => destinationOption("ring_group", row))
        .filter((row): row is DestinationOption => row !== null),
      queue: ((queuesQuery.data || []) as DestinationRow[])
        .map((row) => destinationOption("queue", row))
        .filter((row): row is DestinationOption => row !== null),
      ivr: ((ivrMenusQuery.data || []) as DestinationRow[])
        .map((row) => destinationOption("ivr", row))
        .filter((row): row is DestinationOption => row !== null),
      time_condition: ((timeConditionsQuery.data || []) as DestinationRow[])
        .map((row) => destinationOption("time_condition", row))
        .filter((row): row is DestinationOption => row !== null),
    }),
    [
      extensionsQuery.data?.data,
      ivrMenusQuery.data,
      queuesQuery.data,
      ringGroupsQuery.data,
      timeConditionsQuery.data,
    ],
  );
  const destinationOptions = useMemo<Record<RouteType, DestinationOption[]>>(
    () => ({
      extension: allDestinations.extension.filter((item) => item.isActive),
      ring_group: allDestinations.ring_group.filter((item) => item.isActive),
      queue: allDestinations.queue.filter((item) => item.isActive),
      ivr: allDestinations.ivr.filter((item) => item.isActive),
      time_condition: allDestinations.time_condition.filter(
        (item) => item.isActive,
      ),
    }),
    [allDestinations],
  );
  const availableRouteTypes = useMemo(
    () =>
      ROUTE_TYPES.filter((route) => {
        const facility = ROUTE_CAPABILITY[route.value];
        return !facility || capabilitiesQuery.data?.[facility] === true;
      }),
    [capabilitiesQuery.data],
  );
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      const assigned = Boolean(
        row.assigned_route_type && row.assigned_route_id,
      );
      const matchesFilter =
        filter === "all" ||
        (filter === "assigned" && assigned) ||
        (filter === "unassigned" && !assigned);
      const matchesSearch =
        !needle ||
        String(row.number_e164 || "")
          .toLowerCase()
          .includes(needle) ||
        String(row.number_display || "")
          .toLowerCase()
          .includes(needle) ||
        String(row.provider || "")
          .toLowerCase()
          .includes(needle) ||
        routeLabel(row, allDestinations).toLowerCase().includes(needle);
      return matchesFilter && matchesSearch;
    });
  }, [allDestinations, filter, rows, search]);

  const openRouteEditor = (number: PhoneNumberRow) => {
    const routeType = routeTypeLabel(number.assigned_route_type)
      ? (number.assigned_route_type as RouteType)
      : null;
    setEditingNumber(number);
    setSelectedRouteType(routeType);
    setSelectedRouteId(
      routeType ? Number(number.assigned_route_id) || null : null,
    );
    setRouteError(null);
  };

  const closeRouteEditor = (force = false) => {
    if (routeMutation.isPending && !force) return;
    setEditingNumber(null);
    setSelectedRouteType(null);
    setSelectedRouteId(null);
    setRouteError(null);
  };

  const chooseRouteType = (routeType: RouteType | null) => {
    setSelectedRouteType(routeType);
    setSelectedRouteId(null);
    setRouteError(null);
  };

  const saveRoute = async () => {
    if (!editingNumber) return;
    if (
      selectedRouteType &&
      !destinationOptions[selectedRouteType].some(
        (item) => item.id === selectedRouteId,
      )
    ) {
      setRouteError("Choose an active destination in this workspace.");
      return;
    }
    try {
      await routeMutation.mutateAsync({
        id: editingNumber.id,
        assignedRouteType: selectedRouteType,
        assignedRouteId: selectedRouteType ? selectedRouteId : null,
      });
      closeRouteEditor(true);
      void numbersQuery.refetch().catch(() => undefined);
    } catch (error) {
      setRouteError(
        errorMessage(error) ||
          "Destination could not be saved. Your selection is still here; try again.",
      );
    }
  };

  const renderNumber = ({ item }: { item: PhoneNumberRow }) => {
    const assigned = Boolean(
      item.assigned_route_type && item.assigned_route_id,
    );
    return (
      <TouchableOpacity
        accessibilityLabel={`Change destination for ${numberLabel(item)}`}
        disabled={routeMutation.isPending}
        onPress={() => openRouteEditor(item)}
        style={[
          styles.card,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <View style={[styles.icon, { backgroundColor: colors.primary + "15" }]}>
          <IconSymbol name="number" size={18} color={colors.primary} />
        </View>
        <View style={styles.cardBody}>
          <Text style={[styles.number, { color: colors.foreground }]}>
            {numberLabel(item)}
          </Text>
          {item.number_e164 && item.number_e164 !== numberLabel(item) && (
            <Text style={[styles.e164, { color: colors.muted }]}>
              {item.number_e164}
            </Text>
          )}
          <Text style={[styles.meta, { color: colors.muted }]}>
            {[item.country, typeLabel(item.number_type), item.provider]
              .filter(Boolean)
              .join(" · ")}
          </Text>
          <Text
            style={[
              styles.route,
              { color: assigned ? colors.primary : colors.muted },
            ]}
          >
            {routeLabel(item, allDestinations)}
          </Text>
        </View>
        <View style={styles.cardEnd}>
          <View
            style={[
              styles.badge,
              {
                backgroundColor:
                  item.status === "active" ? "#00C89620" : colors.background,
              },
            ]}
          >
            <Text
              style={[
                styles.badgeText,
                {
                  color: item.status === "active" ? "#00A876" : colors.muted,
                },
              ]}
            >
              {String(item.status || "unknown").toUpperCase()}
            </Text>
          </View>
          <Text style={[styles.edit, { color: colors.primary }]}>Edit</Text>
        </View>
      </TouchableOpacity>
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
        Ask a workspace owner or administrator to view phone numbers.
      </Text>
    </View>
  ) : capabilitiesQuery.isLoading ? (
    <View style={styles.state}>
      <ActivityIndicator color={colors.primary} />
      <Text style={[styles.stateText, { color: colors.muted }]}>
        Checking phone-number availability…
      </Text>
    </View>
  ) : !phoneNumbersAvailable ? (
    <View style={styles.state}>
      <Text style={[styles.stateTitle, { color: colors.foreground }]}>
        Phone number management is unavailable
      </Text>
      <Text style={[styles.stateText, { color: colors.muted }]}>
        This feature is not available for your workspace yet. Phone-number inventory and routing actions are unavailable.
      </Text>
    </View>
  ) : numbersQuery.isError ? (
    <View style={styles.state}>
      <Text style={[styles.stateTitle, { color: colors.foreground }]}>
        Couldn’t load phone numbers
      </Text>
      <Text style={[styles.stateText, { color: colors.muted }]}>
        {errorMessage(numbersQuery.error)}
      </Text>
      <TouchableOpacity onPress={() => numbersQuery.refetch()}>
        <Text style={[styles.retry, { color: colors.primary }]}>Try again</Text>
      </TouchableOpacity>
    </View>
  ) : numbersQuery.isLoading ? (
    <View style={styles.state}>
      <ActivityIndicator color={colors.primary} />
      <Text style={[styles.stateText, { color: colors.muted }]}>
        Loading phone numbers…
      </Text>
    </View>
  ) : (
    <FlatList
      data={filtered}
      keyExtractor={(item) => String(item.id)}
      renderItem={renderNumber}
      contentContainerStyle={styles.list}
      refreshing={numbersQuery.isRefetching}
      onRefresh={numbersQuery.refetch}
      ListEmptyComponent={
        <View style={styles.state}>
          <Text style={[styles.stateTitle, { color: colors.foreground }]}>
            {rows.length === 0 ? "No phone numbers yet" : "No matching numbers"}
          </Text>
          <Text style={[styles.stateText, { color: colors.muted }]}>
            {rows.length === 0
              ? "Carrier-provisioned numbers for this workspace will appear here."
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
            Phone numbers
          </Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>
            {tenantQuery.data?.name || "Current workspace"}
          </Text>
        </View>
        {canManage && phoneNumbersAvailable && (
          <TouchableOpacity
            onPress={() => numbersQuery.refetch()}
            style={styles.headerButton}
          >
            {numbersQuery.isFetching ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <IconSymbol
                name="arrow.clockwise"
                size={18}
                color={colors.primary}
              />
            )}
          </TouchableOpacity>
        )}
      </View>

      {canManage && phoneNumbersAvailable && (
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
              placeholder="Search number or destination"
              placeholderTextColor={colors.muted}
              value={search}
              onChangeText={setSearch}
            />
          </View>
          <View style={styles.filters}>
            {(["all", "assigned", "unassigned"] as const).map((value) => (
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
                      ? `Assigned ${rows.filter((row) => row.assigned_route_id).length}`
                      : `Unassigned ${rows.filter((row) => !row.assigned_route_id).length}`}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      {listState}

      <Modal
        animationType="slide"
        transparent
        visible={editingNumber !== null}
        onRequestClose={() => closeRouteEditor()}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modal,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.modalHeader}>
              <View style={styles.modalHeading}>
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>
                  Call destination
                </Text>
                <Text style={[styles.modalSubtitle, { color: colors.muted }]}>
                  {editingNumber ? numberLabel(editingNumber) : ""}
                </Text>
              </View>
              <TouchableOpacity
                accessibilityLabel="Close destination editor"
                disabled={routeMutation.isPending}
                onPress={() => closeRouteEditor()}
                style={styles.closeButton}
              >
                <IconSymbol name="xmark" size={18} color={colors.muted} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalContent}>
              <Text style={[styles.fieldLabel, { color: colors.muted }]}>
                Send calls to
              </Text>
              <View style={styles.routeChoices}>
                <TouchableOpacity
                  accessibilityRole="radio"
                  accessibilityState={{ selected: selectedRouteType === null }}
                  disabled={routeMutation.isPending}
                  onPress={() => chooseRouteType(null)}
                  style={[
                    styles.routeChoice,
                    {
                      backgroundColor:
                        selectedRouteType === null
                          ? colors.primary + "15"
                          : colors.background,
                      borderColor:
                        selectedRouteType === null
                          ? colors.primary
                          : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.routeChoiceText,
                      {
                        color:
                          selectedRouteType === null
                            ? colors.primary
                            : colors.foreground,
                      },
                    ]}
                  >
                    Unassigned
                  </Text>
                </TouchableOpacity>
                {availableRouteTypes.map((route) => (
                  <TouchableOpacity
                    key={route.value}
                    accessibilityRole="radio"
                    accessibilityState={{
                      selected: selectedRouteType === route.value,
                    }}
                    disabled={routeMutation.isPending}
                    onPress={() => chooseRouteType(route.value)}
                    style={[
                      styles.routeChoice,
                      {
                        backgroundColor:
                          selectedRouteType === route.value
                            ? colors.primary + "15"
                            : colors.background,
                        borderColor:
                          selectedRouteType === route.value
                            ? colors.primary
                            : colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.routeChoiceText,
                        {
                          color:
                            selectedRouteType === route.value
                              ? colors.primary
                              : colors.foreground,
                        },
                      ]}
                    >
                      {route.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {selectedRouteType ? (
                <>
                  <Text style={[styles.fieldLabel, { color: colors.muted }]}>
                    Choose {routeTypeLabel(selectedRouteType)?.toLowerCase()}
                  </Text>
                  {destinationOptions[selectedRouteType].length === 0 ? (
                    <Text
                      style={[
                        styles.emptyDestinations,
                        { color: colors.muted },
                      ]}
                    >
                      No active destinations are available in this workspace.
                    </Text>
                  ) : (
                    <View style={styles.destinationChoices}>
                      {destinationOptions[selectedRouteType].map(
                        (destination) => (
                          <TouchableOpacity
                            key={destination.id}
                            accessibilityRole="radio"
                            accessibilityState={{
                              selected: selectedRouteId === destination.id,
                            }}
                            accessibilityLabel={`Use ${destination.label}`}
                            disabled={routeMutation.isPending}
                            onPress={() => {
                              setSelectedRouteId(destination.id);
                              setRouteError(null);
                            }}
                            style={[
                              styles.destinationChoice,
                              {
                                backgroundColor:
                                  selectedRouteId === destination.id
                                    ? colors.primary + "15"
                                    : colors.background,
                                borderColor:
                                  selectedRouteId === destination.id
                                    ? colors.primary
                                    : colors.border,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.destinationChoiceText,
                                {
                                  color:
                                    selectedRouteId === destination.id
                                      ? colors.primary
                                      : colors.foreground,
                                },
                              ]}
                            >
                              {destination.label}
                            </Text>
                          </TouchableOpacity>
                        ),
                      )}
                    </View>
                  )}
                </>
              ) : (
                <Text
                  style={[styles.emptyDestinations, { color: colors.muted }]}
                >
                  Calls to this number will not have a PBX destination.
                </Text>
              )}
              {routeError ? (
                <Text
                  accessibilityRole="alert"
                  style={[styles.routeError, { color: colors.error }]}
                >
                  {routeError}
                </Text>
              ) : null}
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                disabled={routeMutation.isPending}
                onPress={() => closeRouteEditor()}
                style={[styles.cancelButton, { borderColor: colors.border }]}
              >
                <Text style={[styles.cancelText, { color: colors.muted }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={routeMutation.isPending}
                onPress={saveRoute}
                style={[
                  styles.saveButton,
                  {
                    backgroundColor: colors.primary,
                    opacity: routeMutation.isPending ? 0.65 : 1,
                  },
                ]}
              >
                <Text style={styles.saveText}>
                  {routeMutation.isPending ? "Saving…" : "Save destination"}
                </Text>
              </TouchableOpacity>
            </View>
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
  headerButton: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  heading: { flex: 1 },
  title: { fontSize: 20, fontWeight: "700" },
  subtitle: { fontSize: 12, marginTop: 2 },
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
    alignItems: "flex-start",
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
  cardEnd: { alignItems: "flex-end", gap: 8 },
  number: { fontSize: 16, fontWeight: "700" },
  e164: { fontSize: 12, marginTop: 2 },
  meta: { fontSize: 11, marginTop: 4 },
  route: { fontSize: 12, fontWeight: "600", marginTop: 7 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  badgeText: { fontSize: 10, fontWeight: "700" },
  edit: { fontSize: 12, fontWeight: "700" },
  state: { padding: 28, alignItems: "center", gap: 8 },
  stateTitle: { fontSize: 16, fontWeight: "700", textAlign: "center" },
  stateText: { fontSize: 13, lineHeight: 19, textAlign: "center" },
  retry: { fontSize: 14, fontWeight: "600", marginTop: 4 },
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "#00000066",
  },
  modal: {
    maxHeight: "82%",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 0.5,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
  },
  modalHeading: { flex: 1 },
  modalTitle: { fontSize: 18, fontWeight: "700" },
  modalSubtitle: { fontSize: 13, marginTop: 3 },
  closeButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  modalContent: { paddingHorizontal: 20, paddingBottom: 8 },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "700",
    marginTop: 12,
    marginBottom: 8,
  },
  routeChoices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  routeChoice: {
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  routeChoiceText: { fontSize: 12, fontWeight: "600" },
  destinationChoices: { gap: 8 },
  destinationChoice: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  destinationChoiceText: { fontSize: 14, fontWeight: "600" },
  emptyDestinations: { fontSize: 13, lineHeight: 19, marginTop: 4 },
  routeError: { fontSize: 13, lineHeight: 19, marginTop: 14 },
  modalFooter: { flexDirection: "row", padding: 16, gap: 12 },
  cancelButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  cancelText: { fontSize: 15, fontWeight: "600" },
  saveButton: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  saveText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
