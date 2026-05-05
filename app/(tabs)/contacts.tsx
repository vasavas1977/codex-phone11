/**
 * Contacts Tab — CloudPhone11
 *
 * Directory with real-time SIP presence:
 * - Live presence dots on avatars (online/busy/away/dnd/ringing/offline)
 * - Presence status chips with labels
 * - Active call info for busy/ringing contacts
 * - Sort by availability toggle
 * - Search by name, extension, or phone
 * - Favorites section
 */

import { useState, useEffect, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  TextInput,
  StyleSheet,
  Platform,
} from "react-native";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { usePresenceStore, getPresenceColor, getPresenceLabel } from "@/lib/presence/store";
import type { PresenceStatus } from "@/lib/presence/types";
import { formatCallDuration } from "@/lib/presence/types";

interface Contact {
  id: string;
  name: string;
  extension?: string;
  phone?: string;
  number?: string; // for sortByAvailability compatibility
  favorite: boolean;
}

const CONTACTS: Contact[] = [
  { id: "1", name: "Alice Johnson", extension: "1001", phone: "+1 (555) 100-1001", number: "1001", favorite: true },
  { id: "2", name: "Bob Chen", extension: "1002", phone: "+1 (555) 100-1002", number: "1002", favorite: true },
  { id: "3", name: "Carol Martinez", extension: "1003", phone: "+1 (555) 100-1003", number: "1003", favorite: false },
  { id: "4", name: "David Kim", extension: "1004", phone: "+1 (555) 100-1004", number: "1004", favorite: false },
  { id: "5", name: "Emma Wilson", extension: "1005", phone: "+1 (555) 100-1005", number: "1005", favorite: false },
  { id: "6", name: "Frank Nguyen", extension: "1006", phone: "+1 (555) 100-1006", number: "1006", favorite: false },
  { id: "7", name: "Grace Park", extension: "1007", phone: "+1 (555) 100-1007", number: "1007", favorite: false },
  { id: "8", name: "Henry Liu", extension: "1008", phone: "+1 (555) 100-1008", number: "1008", favorite: false },
];

/** Presence dot overlay on avatar */
function PresenceDot({ status }: { status: PresenceStatus }) {
  const color = getPresenceColor(status);
  const isHollow = status === "offline" || status === "unknown";

  return (
    <View
      style={[
        styles.presenceDot,
        {
          backgroundColor: isHollow ? "transparent" : color,
          borderColor: isHollow ? "#9CA3AF" : color,
          borderWidth: isHollow ? 1.5 : 2,
        },
      ]}
    />
  );
}

/** Active call row for busy contacts */
function ActiveCallRow({ extension, colors }: { extension: string; colors: ReturnType<typeof useColors> }) {
  const { getActiveCall } = usePresenceStore();
  const call = getActiveCall(extension);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!call) return;
    const t = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [call]);

  if (!call) return null;

  return (
    <View style={[styles.activeCallRow, { backgroundColor: colors.error + "08" }]}>
      <IconSymbol
        name={call.direction === "inbound" ? "phone.arrow.down.left" : "phone.arrow.up.right"}
        size={10}
        color={colors.error}
      />
      <Text style={[styles.activeCallText, { color: colors.error }]} numberOfLines={1}>
        {call.direction === "inbound" ? "From" : "To"}{" "}
        <Text style={styles.activeCallName}>{call.remotePartyName}</Text>
        {call.isInternal ? " (int)" : ""}
      </Text>
      <Text style={[styles.activeCallDuration, { color: colors.error }]}>
        {formatCallDuration(call.startedAt)}
      </Text>
    </View>
  );
}

export default function ContactsScreen() {
  const colors = useColors();
  const [search, setSearch] = useState("");
  const [sortByPresence, setSortByPresence] = useState(false);

  const {
    subscribeExtensions,
    getExtensionStatus,
    sortByAvailability,
    lastUpdated,
  } = usePresenceStore();

  // Subscribe to presence for all contacts on mount
  useEffect(() => {
    const extensions = CONTACTS
      .filter((c) => c.extension)
      .map((c) => ({ extension: c.extension!, displayName: c.name }));
    if (extensions.length > 0) {
      subscribeExtensions(extensions);
    }
  }, []);

  // Filter by search
  const filtered = useMemo(() => {
    if (!search.trim()) return CONTACTS;
    const q = search.toLowerCase();
    return CONTACTS.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.extension?.includes(q) ||
        c.phone?.includes(q)
    );
  }, [search]);

  // Sort and split into favorites / others
  const { favorites, others } = useMemo(() => {
    const sorted = sortByPresence ? sortByAvailability(filtered) : filtered;
    return {
      favorites: sorted.filter((c) => c.favorite),
      others: sorted.filter((c) => !c.favorite),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sortByPresence, lastUpdated]);

  const renderContact = ({ item }: { item: Contact }) => {
    const status = item.extension ? getExtensionStatus(item.extension) : "unknown" as PresenceStatus;
    const presColor = getPresenceColor(status);
    const presLabel = getPresenceLabel(status);
    const isBusyOrRinging = status === "busy" || status === "ringing";

    return (
      <TouchableOpacity
        style={[styles.row, { borderBottomColor: colors.border }]}
        onPress={() => {
          if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          router.push({ pathname: "/contacts/[id]", params: { id: item.id } });
        }}
        activeOpacity={0.7}
      >
        {/* Avatar with live presence dot */}
        <View style={styles.avatarContainer}>
          <View style={[styles.avatar, { backgroundColor: colors.primary + "20" }]}>
            <Text style={[styles.avatarText, { color: colors.primary }]}>{item.name.charAt(0)}</Text>
          </View>
          <View style={[styles.presenceDotBorder, { borderColor: colors.background }]}>
            <PresenceDot status={status} />
          </View>
        </View>

        {/* Info */}
        <View style={styles.info}>
          <View style={styles.nameRow}>
            <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
              {item.name}
            </Text>
            <View style={[styles.presenceBadge, { backgroundColor: presColor + "15" }]}>
              <View style={[styles.presenceBadgeDot, { backgroundColor: presColor }]} />
              <Text style={[styles.presenceBadgeText, { color: presColor }]}>{presLabel}</Text>
            </View>
          </View>
          <Text style={[styles.sub, { color: colors.muted }]}>
            {item.extension ? `Ext. ${item.extension}` : item.phone}
          </Text>
          {/* Active call info for busy/ringing */}
          {isBusyOrRinging && item.extension && (
            <ActiveCallRow extension={item.extension} colors={colors} />
          )}
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => {
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push({ pathname: "/call/active", params: { number: item.extension || item.phone || "", type: "voice" } });
            }}
          >
            <IconSymbol name="phone.fill" size={18} color={colors.success} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => {
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push({ pathname: "/messages/[id]", params: { id: item.id, name: item.name } });
            }}
          >
            <IconSymbol name="message.fill" size={18} color={colors.primary} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <ScreenContainer>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Contacts</Text>
        <View style={styles.headerRight}>
          {/* Sort toggle */}
          <TouchableOpacity
            style={[
              styles.sortBtn,
              { backgroundColor: sortByPresence ? colors.primary + "15" : colors.surface },
            ]}
            onPress={() => {
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setSortByPresence((v) => !v);
            }}
          >
            <IconSymbol
              name="arrow.up.arrow.down"
              size={14}
              color={sortByPresence ? colors.primary : colors.muted}
            />
            <Text
              style={[
                styles.sortBtnText,
                { color: sortByPresence ? colors.primary : colors.muted },
              ]}
            >
              {sortByPresence ? "By Status" : "Sort"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.addBtn, { backgroundColor: colors.primary }]}
            onPress={() => {
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }}
          >
            <IconSymbol name="plus" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Search */}
      <View style={[styles.searchContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <IconSymbol name="magnifyingglass" size={16} color={colors.muted} />
        <TextInput
          style={[styles.searchInput, { color: colors.foreground }]}
          placeholder="Search contacts..."
          placeholderTextColor={colors.muted}
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch("")}>
            <IconSymbol name="xmark.circle.fill" size={16} color={colors.muted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Presence legend */}
      <View style={styles.legendRow}>
        {(["online", "busy", "away", "dnd", "offline"] as PresenceStatus[]).map((s) => (
          <View key={s} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: getPresenceColor(s) }]} />
            <Text style={[styles.legendText, { color: colors.muted }]}>{getPresenceLabel(s)}</Text>
          </View>
        ))}
      </View>

      <FlatList
        data={[]}
        renderItem={null}
        keyExtractor={() => "list"}
        extraData={lastUpdated}
        ListHeaderComponent={
          <View>
            {favorites.length > 0 && (
              <>
                <Text style={[styles.sectionHeader, { color: colors.muted, backgroundColor: colors.background }]}>
                  FAVORITES
                </Text>
                {favorites.map((item) => (
                  <View key={item.id}>{renderContact({ item })}</View>
                ))}
              </>
            )}
            {others.length > 0 && (
              <>
                <Text style={[styles.sectionHeader, { color: colors.muted, backgroundColor: colors.background }]}>
                  ALL CONTACTS
                </Text>
                {others.map((item) => (
                  <View key={item.id}>{renderContact({ item })}</View>
                ))}
              </>
            )}
          </View>
        }
        showsVerticalScrollIndicator={false}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  sortBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
  },
  sortBtnText: {
    fontSize: 12,
    fontWeight: "600",
  },
  addBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    margin: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
  },
  legendRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 14,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  legendDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  legendText: {
    fontSize: 10,
    fontWeight: "500",
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    gap: 12,
  },
  avatarContainer: {
    position: "relative",
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 18,
    fontWeight: "700",
  },
  presenceDotBorder: {
    position: "absolute",
    bottom: 0,
    right: 0,
    borderWidth: 2,
    borderRadius: 8,
  },
  presenceDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  presenceBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    gap: 4,
  },
  presenceBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  presenceBadgeText: {
    fontSize: 10,
    fontWeight: "600",
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: 15,
    fontWeight: "600",
    flexShrink: 1,
  },
  sub: {
    fontSize: 13,
    marginTop: 2,
  },
  actions: {
    flexDirection: "row",
    gap: 4,
  },
  actionBtn: {
    padding: 8,
  },
  // Active call row
  activeCallRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  activeCallText: {
    flex: 1,
    fontSize: 10,
    lineHeight: 14,
  },
  activeCallName: {
    fontWeight: "700",
  },
  activeCallDuration: {
    fontSize: 9,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
});
