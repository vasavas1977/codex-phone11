/**
 * Tenant phone-number inventory.
 *
 * Displays live numbers and their current PBX destinations. Number acquisition
 * and route changes stay unavailable until carrier-backed provisioning is
 * connected to this screen.
 */

import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
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
import { usePhoneNumbers, useTenant } from "@/hooks/use-pbx-admin";

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

function numberLabel(row: PhoneNumberRow) {
  return row.number_display || row.number_e164 || String(row.id);
}

function routeLabel(row: PhoneNumberRow) {
  if (!row.assigned_route_type || !row.assigned_route_id) {
    return "No call destination";
  }
  const labels: Record<string, string> = {
    extension: "Extension",
    ring_group: "Ring group",
    queue: "Queue",
    ivr: "IVR menu",
    time_condition: "Business hours",
  };
  return `${labels[row.assigned_route_type] || "Destination"} #${row.assigned_route_id}`;
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
  const canManage = ["owner", "admin"].includes(
    String(tenantQuery.data?.userRole || ""),
  );
  const numbersQuery = usePhoneNumbers(
    1,
    100,
    tenantQuery.isSuccess && canManage,
  );
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<NumberFilter>("all");

  const rows = useMemo(
    () => (numbersQuery.data?.data || []) as PhoneNumberRow[],
    [numbersQuery.data?.data],
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
        routeLabel(row).toLowerCase().includes(needle);
      return matchesFilter && matchesSearch;
    });
  }, [filter, rows, search]);

  const renderNumber = ({ item }: { item: PhoneNumberRow }) => {
    const assigned = Boolean(
      item.assigned_route_type && item.assigned_route_id,
    );
    return (
      <View
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
            {routeLabel(item)}
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
        Ask a workspace owner or administrator to view phone numbers.
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
        {canManage && (
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

      {canManage && (
        <>
          <View
            style={[
              styles.notice,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.noticeTitle, { color: colors.foreground }]}>
              Destinations are read-only
            </Text>
            <Text style={[styles.noticeText, { color: colors.muted }]}>
              Adding numbers and changing call destinations will be available
              after carrier provisioning is connected.
            </Text>
          </View>
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
  notice: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 0.5,
  },
  noticeTitle: { fontSize: 13, fontWeight: "700" },
  noticeText: { fontSize: 12, lineHeight: 18, marginTop: 3 },
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
  cardEnd: { alignItems: "flex-end" },
  number: { fontSize: 16, fontWeight: "700" },
  e164: { fontSize: 12, marginTop: 2 },
  meta: { fontSize: 11, marginTop: 4 },
  route: { fontSize: 12, fontWeight: "600", marginTop: 7 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  badgeText: { fontSize: 10, fontWeight: "700" },
  state: { padding: 28, alignItems: "center", gap: 8 },
  stateTitle: { fontSize: 16, fontWeight: "700", textAlign: "center" },
  stateText: { fontSize: 13, lineHeight: 19, textAlign: "center" },
  retry: { fontSize: 14, fontWeight: "600", marginTop: 4 },
});
