/**
 * Notification Center Screen
 *
 * Displays all push notifications grouped by time (Today, Yesterday, Older),
 * with mark-read, dismiss, clear-all, and deep-link navigation on tap.
 */

import React, { useEffect, useMemo, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Alert,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useNotificationStore } from "@/lib/notifications/store";
import { NOTIFICATION_CONFIG } from "@/lib/notifications/types";
import type { AppNotification, NotificationType } from "@/lib/notifications/types";

function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getDateGroup(timestamp: number): string {
  const now = new Date();
  const date = new Date(timestamp);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);

  if (date >= today) return "Today";
  if (date >= yesterday) return "Yesterday";
  return "Older";
}

interface GroupedNotifications {
  title: string;
  data: AppNotification[];
}

export default function NotificationCenterScreen() {
  const router = useRouter();
  const colors = useColors();

  const {
    notifications,
    unreadCount,
    isLoading,
    initialize,
    markAsRead,
    markAllAsRead,
    dismissNotification,
    clearAll,
  } = useNotificationStore();

  useEffect(() => {
    initialize();
  }, []);

  const groupedNotifications = useMemo((): GroupedNotifications[] => {
    const groups: Record<string, AppNotification[]> = {};
    for (const notif of notifications) {
      const group = getDateGroup(notif.timestamp);
      if (!groups[group]) groups[group] = [];
      groups[group].push(notif);
    }

    const order = ["Today", "Yesterday", "Older"];
    return order
      .filter((title) => groups[title]?.length > 0)
      .map((title) => ({
        title,
        data: groups[title].sort((a, b) => b.timestamp - a.timestamp),
      }));
  }, [notifications]);

  const flatData = useMemo(() => {
    const items: (AppNotification | { type: "header"; title: string; id: string })[] = [];
    for (const group of groupedNotifications) {
      items.push({ type: "header", title: group.title, id: `header-${group.title}` });
      items.push(...group.data);
    }
    return items;
  }, [groupedNotifications]);

  const handleNotificationPress = useCallback((notification: AppNotification) => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    markAsRead(notification.id);
    if (notification.route) {
      router.push(notification.route as any);
    }
  }, [markAsRead, router]);

  const handleDismiss = useCallback((notificationId: string) => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    dismissNotification(notificationId);
  }, [dismissNotification]);

  const handleClearAll = () => {
    Alert.alert(
      "Clear All Notifications",
      "This will remove all notifications. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear All",
          style: "destructive",
          onPress: () => {
            clearAll();
            if (Platform.OS !== "web") {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }
          },
        },
      ]
    );
  };

  const renderItem = ({ item }: { item: any }) => {
    if (item.type === "header") {
      return (
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.muted }]}>{item.title}</Text>
        </View>
      );
    }

    const notification = item as AppNotification;
    const config = NOTIFICATION_CONFIG[notification.type];
    const isUnread = notification.status === "unread";

    return (
      <TouchableOpacity
        style={[
          styles.notificationRow,
          { borderBottomColor: colors.border },
          isUnread && { backgroundColor: colors.primary + "08" },
        ]}
        onPress={() => handleNotificationPress(notification)}
        activeOpacity={0.7}
      >
        {/* Icon */}
        <View style={[styles.notifIcon, { backgroundColor: config.color + "15" }]}>
          <IconSymbol name={config.icon as any} size={18} color={config.color} />
        </View>

        {/* Content */}
        <View style={styles.notifContent}>
          <View style={styles.notifTitleRow}>
            <Text
              style={[
                styles.notifTitle,
                { color: colors.foreground },
                isUnread && styles.notifTitleBold,
              ]}
              numberOfLines={1}
            >
              {notification.title}
            </Text>
            <Text style={[styles.notifTime, { color: colors.muted }]}>
              {timeAgo(notification.timestamp)}
            </Text>
          </View>
          <Text
            style={[
              styles.notifBody,
              { color: isUnread ? colors.foreground : colors.muted },
            ]}
            numberOfLines={2}
          >
            {notification.body}
          </Text>
          {/* Type badge */}
          <View style={[styles.typeBadge, { backgroundColor: config.color + "12" }]}>
            <Text style={[styles.typeBadgeText, { color: config.color }]}>{config.label}</Text>
          </View>
        </View>

        {/* Unread dot + dismiss */}
        <View style={styles.notifActions}>
          {isUnread && <View style={[styles.unreadDot, { backgroundColor: colors.primary }]} />}
          <TouchableOpacity
            onPress={() => handleDismiss(notification.id)}
            style={styles.dismissBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <IconSymbol name="xmark" size={12} color={colors.muted} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
          <Text style={[styles.headerBtnText, { color: colors.primary }]}>Back</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Notifications</Text>
          {unreadCount > 0 && (
            <View style={[styles.headerBadge, { backgroundColor: colors.primary }]}>
              <Text style={styles.headerBadgeText}>{unreadCount}</Text>
            </View>
          )}
        </View>
        <View style={styles.headerRight}>
          {unreadCount > 0 && (
            <TouchableOpacity onPress={markAllAsRead} style={styles.headerBtn}>
              <Text style={[styles.markReadText, { color: colors.primary }]}>Read All</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Notification List */}
      {notifications.length === 0 ? (
        <View style={styles.emptyContainer}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.surface }]}>
            <IconSymbol name="bell.fill" size={40} color={colors.muted} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No Notifications</Text>
          <Text style={[styles.emptySubtitle, { color: colors.muted }]}>
            You're all caught up! Missed calls and voicemails will appear here.
          </Text>
        </View>
      ) : (
        <>
          <FlatList
            data={flatData}
            keyExtractor={(item: any) => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />
          {/* Clear All Footer */}
          <View style={[styles.footer, { borderTopColor: colors.border }]}>
            <TouchableOpacity onPress={handleClearAll} style={styles.clearAllBtn}>
              <IconSymbol name="trash.fill" size={16} color={colors.error} />
              <Text style={[styles.clearAllText, { color: colors.error }]}>Clear All Notifications</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
  },
  headerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    padding: 4,
  },
  headerBtnText: { fontSize: 16 },
  headerCenter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerTitle: { fontSize: 17, fontWeight: "600" },
  headerBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  headerBadgeText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  headerRight: { minWidth: 70, alignItems: "flex-end" },
  markReadText: { fontSize: 14, fontWeight: "600" },

  // List
  listContent: { paddingBottom: 16 },
  sectionHeader: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 6,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },

  // Notification Row
  notificationRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    gap: 12,
  },
  notifIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  notifContent: { flex: 1, gap: 3 },
  notifTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  notifTitle: { fontSize: 15, fontWeight: "400", flex: 1, marginRight: 8 },
  notifTitleBold: { fontWeight: "600" },
  notifTime: { fontSize: 12 },
  notifBody: { fontSize: 13, lineHeight: 19 },
  typeBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    marginTop: 4,
  },
  typeBadgeText: { fontSize: 10, fontWeight: "700" },

  // Actions
  notifActions: {
    alignItems: "center",
    gap: 8,
    paddingTop: 4,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dismissBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },

  // Empty state
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
    gap: 12,
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  emptyTitle: { fontSize: 18, fontWeight: "700" },
  emptySubtitle: { fontSize: 14, textAlign: "center", lineHeight: 20 },

  // Footer
  footer: {
    borderTopWidth: 0.5,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  clearAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 10,
  },
  clearAllText: { fontSize: 15, fontWeight: "600" },
});
