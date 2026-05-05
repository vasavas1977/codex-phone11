/**
 * Call Transfer Screen — CloudPhone11
 *
 * Full transfer UI with:
 * - Mode toggle: Blind / Attended
 * - Target selection: Favorites, Recents, Manual entry
 * - Attended flow: Consulting → Complete / Cancel
 * - Status feedback with haptics
 * - Contact presence indicators (online/busy/away/dnd/ringing/offline)
 * - Presence-aware sorting (available contacts first)
 */

import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Platform,
  FlatList,
  Modal,
  KeyboardAvoidingView,
  Alert,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useTransferStore } from "@/lib/transfer/store";
import { usePresenceStore, getPresenceColor, getPresenceLabel } from "@/lib/presence/store";
import type { TransferMode, TransferTarget, TransferFavorite } from "@/lib/transfer/types";
import type { PresenceStatus, ActiveCallInfo } from "@/lib/presence/types";
import { formatCallDuration } from "@/lib/presence/types";

type TabKey = "favorites" | "recents" | "keypad";

/** Presence dot component */
function PresenceDot({ status, size = 10 }: { status: PresenceStatus; size?: number }) {
  const color = getPresenceColor(status);
  const isRinging = status === "ringing";

  return (
    <View
      style={[
        styles.presenceDot,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          borderWidth: status === "offline" || status === "unknown" ? 1.5 : 0,
          borderColor: status === "offline" || status === "unknown" ? "#9CA3AF" : "transparent",
        },
        isRinging && styles.presenceDotRinging,
      ]}
    />
  );
}

/** Presence badge with dot + label */
function PresenceBadge({ status }: { status: PresenceStatus }) {
  const color = getPresenceColor(status);
  const label = getPresenceLabel(status);

  return (
    <View style={[styles.presenceBadge, { backgroundColor: color + "15" }]}>
      <PresenceDot status={status} size={8} />
      <Text style={[styles.presenceBadgeText, { color }]}>{label}</Text>
    </View>
  );
}

export default function TransferScreen() {
  const { callId } = useLocalSearchParams<{ callId: string }>();
  const router = useRouter();
  const colors = useColors();

  const {
    activeTransfer,
    favorites,
    recentTargets,
    openTransferSheet,
    closeTransferSheet,
    executeBlindTransfer,
    startAttendedTransfer,
    completeAttendedTransfer,
    cancelAttendedTransfer,
  } = useTransferStore();

  const {
    subscribeExtensions,
    getExtensionStatus,
    getActiveCall,
    sortByAvailability,
    lastUpdated,
  } = usePresenceStore();

  const [mode, setMode] = useState<TransferMode>("blind");
  const [activeTab, setActiveTab] = useState<TabKey>("favorites");
  const [manualNumber, setManualNumber] = useState("");
  const [manualName, setManualName] = useState("");
  const [sortByPresence, setSortByPresence] = useState(true);

  // Quick-message state
  const [msgModalVisible, setMsgModalVisible] = useState(false);
  const [msgTarget, setMsgTarget] = useState<{ name: string; number: string } | null>(null);
  const [msgText, setMsgText] = useState("");
  const [msgSent, setMsgSent] = useState(false);
  const msgInputRef = useRef<TextInput>(null);

  const QUICK_MESSAGES = [
    "I'm on a call, will call you back shortly.",
    "Please hold, transferring you now.",
    "Can you take this call? I'll transfer.",
    "Are you available for a quick call?",
    "Call me when you're free.",
    "Urgent — please pick up.",
  ];

  const handleOpenQuickMsg = (name: string, number: string) => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMsgTarget({ name, number });
    setMsgText("");
    setMsgSent(false);
    setMsgModalVisible(true);
    setTimeout(() => msgInputRef.current?.focus(), 300);
  };

  const handleSendQuickMsg = () => {
    if (!msgText.trim() || !msgTarget) return;
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setMsgSent(true);
    // Auto-close after brief confirmation
    setTimeout(() => {
      setMsgModalVisible(false);
      setMsgTarget(null);
      setMsgText("");
      setMsgSent(false);
    }, 1500);
  };

  // Initialize transfer sheet and subscribe to presence for all targets
  useEffect(() => {
    if (callId) openTransferSheet(callId);
    return () => closeTransferSheet();
  }, [callId]);

  // Subscribe to presence for all favorites and recent targets
  useEffect(() => {
    const extensions: { extension: string; displayName?: string }[] = [];
    for (const fav of favorites) {
      extensions.push({ extension: fav.number, displayName: fav.name });
    }
    for (const rec of recentTargets) {
      extensions.push({ extension: rec.number, displayName: rec.name });
    }
    if (extensions.length > 0) {
      subscribeExtensions(extensions);
    }
  }, [favorites, recentTargets]);

  // Sort favorites by presence if enabled
  const sortedFavorites = useMemo(() => {
    if (!sortByPresence) return favorites;
    return sortByAvailability(favorites);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [favorites, sortByPresence, lastUpdated]);

  // Sort recents by presence if enabled
  const sortedRecents = useMemo(() => {
    if (!sortByPresence) return recentTargets;
    return sortByAvailability(recentTargets);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentTargets, sortByPresence, lastUpdated]);

  const isTransferring = activeTransfer?.status === "transferring";
  const isConsulting = activeTransfer?.status === "consulting";
  const isCompleted = activeTransfer?.status === "completed";
  const isFailed = activeTransfer?.status === "failed";

  const handleSelectTarget = async (target: TransferTarget) => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (mode === "blind") {
      await executeBlindTransfer(target);
    } else {
      await startAttendedTransfer(target);
    }
  };

  const handleManualTransfer = () => {
    const num = manualNumber.trim();
    if (!num) return;
    const target: TransferTarget = {
      name: manualName.trim() || num,
      number: num,
      source: "manual",
    };
    handleSelectTarget(target);
  };

  const handleCompleteAttended = async () => {
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await completeAttendedTransfer();
  };

  const handleCancelAttended = async () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await cancelAttendedTransfer();
  };

  const handleClose = () => {
    closeTransferSheet();
    router.back();
  };

  // Auto-close on transfer complete
  useEffect(() => {
    if (isCompleted) {
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const timer = setTimeout(() => router.back(), 1800);
      return () => clearTimeout(timer);
    }
  }, [isCompleted]);

  // ═══ Active call info sub-component ═══
  const ActiveCallRow = ({ call }: { call: ActiveCallInfo }) => {
    const [, setTick] = useState(0);
    // Update duration every second
    useEffect(() => {
      const t = setInterval(() => setTick((v) => v + 1), 1000);
      return () => clearInterval(t);
    }, []);

    return (
      <View style={[styles.activeCallRow, { backgroundColor: colors.error + "08" }]}>
        <View style={styles.activeCallIcon}>
          <IconSymbol
            name={call.direction === "inbound" ? "phone.arrow.down.left" : "phone.arrow.up.right"}
            size={11}
            color={colors.error}
          />
        </View>
        <Text style={[styles.activeCallText, { color: colors.error }]} numberOfLines={1}>
          {call.direction === "inbound" ? "From" : "To"}{" "}
          <Text style={styles.activeCallName}>{call.remotePartyName}</Text>
          {call.isInternal ? " (internal)" : ""}
        </Text>
        <Text style={[styles.activeCallDuration, { color: colors.error }]}>
          {formatCallDuration(call.startedAt)}
        </Text>
      </View>
    );
  };

  // ═══ Render helpers ═══

  const renderFavoriteItem = ({ item }: { item: TransferFavorite }) => {
    const status = getExtensionStatus(item.number);
    const presColor = getPresenceColor(status);
    const activeCall = getActiveCall(item.number);

    return (
      <TouchableOpacity
        style={[styles.targetRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => handleSelectTarget({ name: item.name, number: item.number, source: "favorites" })}
        activeOpacity={0.6}
      >
        {/* Avatar with presence dot overlay */}
        <View style={styles.avatarContainer}>
          <View style={[styles.targetAvatar, { backgroundColor: colors.primary + "20" }]}>
            <Text style={[styles.targetAvatarText, { color: colors.primary }]}>
              {item.name.charAt(0)}
            </Text>
          </View>
          <View style={[styles.presenceDotOverlay, { borderColor: colors.surface }]}>
            <PresenceDot status={status} size={12} />
          </View>
        </View>

        <View style={styles.targetInfo}>
          <Text style={[styles.targetName, { color: colors.foreground }]}>{item.name}</Text>
          <View style={styles.targetSubRow}>
            <Text style={[styles.targetNumber, { color: colors.muted }]}>{item.number}</Text>
            <View style={[styles.presenceChip, { backgroundColor: presColor + "12" }]}>
              <View style={[styles.presenceChipDot, { backgroundColor: presColor }]} />
              <Text style={[styles.presenceChipText, { color: presColor }]}>
                {getPresenceLabel(status)}
              </Text>
            </View>
          </View>
          {/* Show who they're talking to when busy/ringing */}
          {activeCall && (status === "busy" || status === "ringing") && (
            <ActiveCallRow call={activeCall} />
          )}
        </View>

        <View style={styles.targetMeta}>
          {(status === "busy" || status === "ringing") && (
            <TouchableOpacity
              style={[styles.quickMsgBtn, { backgroundColor: colors.primary + "15" }]}
              onPress={(e) => {
                e.stopPropagation();
                handleOpenQuickMsg(item.name, item.number);
              }}
              activeOpacity={0.6}
            >
              <IconSymbol name="message.fill" size={13} color={colors.primary} />
            </TouchableOpacity>
          )}
          <Text style={[styles.targetCount, { color: colors.muted }]}>{item.transferCount}x</Text>
          <IconSymbol name="chevron.right" size={14} color={colors.muted} />
        </View>
      </TouchableOpacity>
    );
  };

  const renderRecentItem = ({ item }: { item: TransferTarget }) => {
    const status = getExtensionStatus(item.number);
    const presColor = getPresenceColor(status);
    const activeCall = getActiveCall(item.number);

    return (
      <TouchableOpacity
        style={[styles.targetRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => handleSelectTarget(item)}
        activeOpacity={0.6}
      >
        <View style={styles.avatarContainer}>
          <View style={[styles.targetAvatar, { backgroundColor: "#8B5CF620" }]}>
            <Text style={[styles.targetAvatarText, { color: "#8B5CF6" }]}>
              {item.name.charAt(0)}
            </Text>
          </View>
          <View style={[styles.presenceDotOverlay, { borderColor: colors.surface }]}>
            <PresenceDot status={status} size={12} />
          </View>
        </View>

        <View style={styles.targetInfo}>
          <Text style={[styles.targetName, { color: colors.foreground }]}>{item.name}</Text>
          <View style={styles.targetSubRow}>
            <Text style={[styles.targetNumber, { color: colors.muted }]}>{item.number}</Text>
            <View style={[styles.presenceChip, { backgroundColor: presColor + "12" }]}>
              <View style={[styles.presenceChipDot, { backgroundColor: presColor }]} />
              <Text style={[styles.presenceChipText, { color: presColor }]}>
                {getPresenceLabel(status)}
              </Text>
            </View>
          </View>
          {/* Show who they're talking to when busy/ringing */}
          {activeCall && (status === "busy" || status === "ringing") && (
            <ActiveCallRow call={activeCall} />
          )}
        </View>

        <View style={styles.targetMeta}>
          {(status === "busy" || status === "ringing") && (
            <TouchableOpacity
              style={[styles.quickMsgBtn, { backgroundColor: colors.primary + "15" }]}
              onPress={(e) => {
                e.stopPropagation();
                handleOpenQuickMsg(item.name, item.number);
              }}
              activeOpacity={0.6}
            >
              <IconSymbol name="message.fill" size={13} color={colors.primary} />
            </TouchableOpacity>
          )}
          <IconSymbol name="chevron.right" size={14} color={colors.muted} />
        </View>
      </TouchableOpacity>
    );
  };

  // ═══ Status overlay during transfer ═══
  if (isTransferring || isCompleted || isFailed) {
    return (
      <ScreenContainer edges={["top", "bottom", "left", "right"]}>
        <View style={styles.statusContainer}>
          {isTransferring && (
            <>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={[styles.statusTitle, { color: colors.foreground }]}>Transferring...</Text>
              <Text style={[styles.statusSubtitle, { color: colors.muted }]}>
                {mode === "blind" ? "Blind" : "Attended"} transfer to {activeTransfer?.target.name}
              </Text>
            </>
          )}
          {isCompleted && (
            <>
              <View style={[styles.statusIcon, { backgroundColor: colors.success + "20" }]}>
                <IconSymbol name="checkmark.circle.fill" size={48} color={colors.success} />
              </View>
              <Text style={[styles.statusTitle, { color: colors.foreground }]}>Transfer Complete</Text>
              <Text style={[styles.statusSubtitle, { color: colors.muted }]}>
                Call transferred to {activeTransfer?.target.name}
              </Text>
            </>
          )}
          {isFailed && (
            <>
              <View style={[styles.statusIcon, { backgroundColor: colors.error + "20" }]}>
                <IconSymbol name="xmark.circle.fill" size={48} color={colors.error} />
              </View>
              <Text style={[styles.statusTitle, { color: colors.foreground }]}>Transfer Failed</Text>
              <Text style={[styles.statusSubtitle, { color: colors.muted }]}>
                {activeTransfer?.error || "An error occurred"}
              </Text>
              <TouchableOpacity
                onPress={handleClose}
                style={[styles.retryBtn, { backgroundColor: colors.primary }]}
              >
                <Text style={styles.retryBtnText}>Go Back</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScreenContainer>
    );
  }

  // ═══ Attended consulting overlay ═══
  if (isConsulting && activeTransfer) {
    const consultStatus = getExtensionStatus(activeTransfer.target.number);

    return (
      <ScreenContainer edges={["top", "bottom", "left", "right"]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={handleCancelAttended} style={styles.headerBtn}>
            <Text style={[styles.headerBtnText, { color: colors.error }]}>Cancel</Text>
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Consulting</Text>
          <View style={styles.headerBtn} />
        </View>

        <View style={styles.consultContainer}>
          <View style={styles.avatarContainer}>
            <View style={[styles.consultAvatar, { backgroundColor: colors.primary + "20" }]}>
              <Text style={[styles.consultAvatarText, { color: colors.primary }]}>
                {activeTransfer.target.name.charAt(0)}
              </Text>
            </View>
            <View style={[styles.presenceDotOverlayLg, { borderColor: colors.background }]}>
              <PresenceDot status={consultStatus} size={16} />
            </View>
          </View>
          <Text style={[styles.consultName, { color: colors.foreground }]}>
            {activeTransfer.target.name}
          </Text>
          <Text style={[styles.consultNumber, { color: colors.muted }]}>
            {activeTransfer.target.number}
          </Text>

          <PresenceBadge status={consultStatus} />

          {activeTransfer.consultConnected ? (
            <View style={[styles.consultBadge, { backgroundColor: colors.success + "15" }]}>
              <View style={[styles.consultDot, { backgroundColor: colors.success }]} />
              <Text style={[styles.consultBadgeText, { color: colors.success }]}>Connected</Text>
            </View>
          ) : (
            <View style={[styles.consultBadge, { backgroundColor: colors.warning + "15" }]}>
              <ActivityIndicator size="small" color={colors.warning} />
              <Text style={[styles.consultBadgeText, { color: colors.warning }]}>Ringing...</Text>
            </View>
          )}

          <Text style={[styles.consultHint, { color: colors.muted }]}>
            Speak with {activeTransfer.target.name} before completing the transfer.
            The original caller is on hold.
          </Text>

          <View style={styles.consultActions}>
            <TouchableOpacity
              onPress={handleCancelAttended}
              style={[styles.consultBtn, { backgroundColor: colors.error + "15", borderColor: colors.error }]}
            >
              <IconSymbol name="xmark.circle.fill" size={20} color={colors.error} />
              <Text style={[styles.consultBtnText, { color: colors.error }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleCompleteAttended}
              style={[styles.consultBtn, { backgroundColor: colors.success + "15", borderColor: colors.success }]}
            >
              <IconSymbol name="checkmark.circle.fill" size={20} color={colors.success} />
              <Text style={[styles.consultBtnText, { color: colors.success }]}>Complete</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScreenContainer>
    );
  }

  // ═══ Main transfer target selection ═══
  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={handleClose} style={styles.headerBtn}>
          <Text style={[styles.headerBtnText, { color: colors.primary }]}>Cancel</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Transfer Call</Text>
        <TouchableOpacity
          onPress={() => { setSortByPresence(!sortByPresence); if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
          style={styles.headerBtn}
        >
          <Text style={[styles.sortBtnText, { color: sortByPresence ? colors.primary : colors.muted }]}>
            {sortByPresence ? "By Status" : "Default"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Mode Toggle */}
      <View style={[styles.modeToggle, { backgroundColor: colors.surface }]}>
        <TouchableOpacity
          onPress={() => { setMode("blind"); if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
          style={[styles.modeBtn, mode === "blind" && { backgroundColor: colors.primary }]}
        >
          <IconSymbol name="arrow.triangle.2.circlepath" size={16} color={mode === "blind" ? "#fff" : colors.muted} />
          <Text style={[styles.modeBtnText, { color: mode === "blind" ? "#fff" : colors.muted }]}>Blind</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => { setMode("attended"); if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
          style={[styles.modeBtn, mode === "attended" && { backgroundColor: colors.primary }]}
        >
          <IconSymbol name="person.2.fill" size={16} color={mode === "attended" ? "#fff" : colors.muted} />
          <Text style={[styles.modeBtnText, { color: mode === "attended" ? "#fff" : colors.muted }]}>Attended</Text>
        </TouchableOpacity>
      </View>

      {/* Mode description */}
      <Text style={[styles.modeDesc, { color: colors.muted }]}>
        {mode === "blind"
          ? "Immediately transfer the call without speaking to the recipient first."
          : "Call the recipient first, then complete the transfer after consulting."}
      </Text>

      {/* Presence Legend */}
      <View style={styles.presenceLegend}>
        {(["online", "busy", "ringing", "away", "dnd", "offline"] as PresenceStatus[]).map((s) => (
          <View key={s} style={styles.legendItem}>
            <PresenceDot status={s} size={8} />
            <Text style={[styles.legendText, { color: colors.muted }]}>{getPresenceLabel(s)}</Text>
          </View>
        ))}
      </View>

      {/* Tab Bar */}
      <View style={[styles.tabBar, { borderBottomColor: colors.border }]}>
        {(["favorites", "recents", "keypad"] as TabKey[]).map((tab) => (
          <TouchableOpacity
            key={tab}
            onPress={() => setActiveTab(tab)}
            style={[styles.tab, activeTab === tab && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
          >
            <Text style={[styles.tabText, { color: activeTab === tab ? colors.primary : colors.muted }]}>
              {tab === "favorites" ? "Favorites" : tab === "recents" ? "Recents" : "Keypad"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Tab Content */}
      {activeTab === "favorites" && (
        <FlatList
          data={sortedFavorites}
          keyExtractor={(item) => item.number}
          renderItem={renderFavoriteItem}
          contentContainerStyle={styles.listContent}
          extraData={lastUpdated}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <IconSymbol name="star.fill" size={32} color={colors.muted} />
              <Text style={[styles.emptyText, { color: colors.muted }]}>No favorites yet</Text>
            </View>
          }
        />
      )}

      {activeTab === "recents" && (
        <FlatList
          data={sortedRecents}
          keyExtractor={(item) => item.number}
          renderItem={renderRecentItem}
          contentContainerStyle={styles.listContent}
          extraData={lastUpdated}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <IconSymbol name="clock.fill" size={32} color={colors.muted} />
              <Text style={[styles.emptyText, { color: colors.muted }]}>No recent transfers</Text>
            </View>
          }
        />
      )}

      {activeTab === "keypad" && (
        <ScrollView contentContainerStyle={styles.keypadContent}>
          <Text style={[styles.keypadLabel, { color: colors.muted }]}>Number or Extension</Text>
          <TextInput
            value={manualNumber}
            onChangeText={setManualNumber}
            placeholder="Enter number..."
            placeholderTextColor={colors.muted}
            keyboardType="phone-pad"
            style={[styles.keypadInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }]}
            autoFocus
          />
          <Text style={[styles.keypadLabel, { color: colors.muted }]}>Name (optional)</Text>
          <TextInput
            value={manualName}
            onChangeText={setManualName}
            placeholder="Contact name..."
            placeholderTextColor={colors.muted}
            style={[styles.keypadInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }]}
            returnKeyType="done"
            onSubmitEditing={handleManualTransfer}
          />
          <TouchableOpacity
            onPress={handleManualTransfer}
            style={[styles.transferBtn, { backgroundColor: manualNumber.trim() ? colors.primary : colors.border }]}
            disabled={!manualNumber.trim()}
          >
            <IconSymbol name="arrow.triangle.2.circlepath" size={18} color={manualNumber.trim() ? "#fff" : colors.muted} />
            <Text style={[styles.transferBtnText, { color: manualNumber.trim() ? "#fff" : colors.muted }]}>
              {mode === "blind" ? "Blind Transfer" : "Start Consultation"}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* Quick Message Modal */}
      <Modal
        visible={msgModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setMsgModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.msgModalOverlay}
        >
          <View style={[styles.msgModalSheet, { backgroundColor: colors.background }]}>
            {/* Modal header */}
            <View style={[styles.msgModalHeader, { borderBottomColor: colors.border }]}>
              <TouchableOpacity onPress={() => setMsgModalVisible(false)}>
                <Text style={[styles.msgModalCancel, { color: colors.primary }]}>Cancel</Text>
              </TouchableOpacity>
              <Text style={[styles.msgModalTitle, { color: colors.foreground }]}>
                Message {msgTarget?.name}
              </Text>
              <TouchableOpacity
                onPress={handleSendQuickMsg}
                disabled={!msgText.trim() || msgSent}
              >
                <Text style={[
                  styles.msgModalSend,
                  { color: msgText.trim() && !msgSent ? colors.primary : colors.muted },
                ]}>
                  {msgSent ? "Sent" : "Send"}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Sent confirmation */}
            {msgSent ? (
              <View style={styles.msgSentContainer}>
                <View style={[styles.msgSentIcon, { backgroundColor: colors.success + "15" }]}>
                  <IconSymbol name="checkmark.circle.fill" size={40} color={colors.success} />
                </View>
                <Text style={[styles.msgSentTitle, { color: colors.foreground }]}>Message Sent</Text>
                <Text style={[styles.msgSentSub, { color: colors.muted }]}>
                  Sent to {msgTarget?.name} ({msgTarget?.number})
                </Text>
              </View>
            ) : (
              <>
                {/* Quick presets */}
                <Text style={[styles.msgPresetsLabel, { color: colors.muted }]}>QUICK MESSAGES</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.msgPresetsRow}
                >
                  {QUICK_MESSAGES.map((msg, i) => (
                    <TouchableOpacity
                      key={i}
                      style={[
                        styles.msgPresetChip,
                        {
                          backgroundColor: msgText === msg ? colors.primary + "20" : colors.surface,
                          borderColor: msgText === msg ? colors.primary : colors.border,
                        },
                      ]}
                      onPress={() => {
                        if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setMsgText(msg);
                      }}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[
                          styles.msgPresetText,
                          { color: msgText === msg ? colors.primary : colors.foreground },
                        ]}
                        numberOfLines={1}
                      >
                        {msg}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                {/* Custom input */}
                <View style={[styles.msgInputContainer, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                  <TextInput
                    ref={msgInputRef}
                    style={[styles.msgInput, { color: colors.foreground }]}
                    placeholder="Type a message..."
                    placeholderTextColor={colors.muted}
                    value={msgText}
                    onChangeText={setMsgText}
                    multiline
                    maxLength={200}
                    returnKeyType="send"
                    onSubmitEditing={handleSendQuickMsg}
                  />
                  <Text style={[styles.msgCharCount, { color: colors.muted }]}>
                    {msgText.length}/200
                  </Text>
                </View>

                {/* Send button */}
                <TouchableOpacity
                  onPress={handleSendQuickMsg}
                  disabled={!msgText.trim()}
                  style={[
                    styles.msgSendBtn,
                    { backgroundColor: msgText.trim() ? colors.primary : colors.border },
                  ]}
                  activeOpacity={0.8}
                >
                  <IconSymbol name="paperplane.fill" size={16} color={msgText.trim() ? "#fff" : colors.muted} />
                  <Text style={[styles.msgSendBtnText, { color: msgText.trim() ? "#fff" : colors.muted }]}>
                    Send Message
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  headerBtn: { padding: 4, minWidth: 60 },
  headerBtnText: { fontSize: 16, fontWeight: "500" },
  headerTitle: { fontSize: 17, fontWeight: "600" },
  sortBtnText: { fontSize: 13, fontWeight: "600", textAlign: "right" },

  // Mode Toggle
  modeToggle: {
    flexDirection: "row",
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 12,
    padding: 4,
    gap: 4,
  },
  modeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  modeBtnText: { fontSize: 14, fontWeight: "600" },
  modeDesc: {
    fontSize: 12,
    textAlign: "center",
    paddingHorizontal: 24,
    paddingVertical: 8,
    lineHeight: 18,
  },

  // Presence Legend
  presenceLegend: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  legendText: { fontSize: 10, fontWeight: "500" },

  // Tabs
  tabBar: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    paddingHorizontal: 16,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabText: { fontSize: 14, fontWeight: "600" },

  // Target List
  listContent: { padding: 16, gap: 8 },
  targetRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 12,
    borderWidth: 0.5,
    gap: 12,
  },
  avatarContainer: { position: "relative" },
  targetAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  targetAvatarText: { fontSize: 18, fontWeight: "700" },
  presenceDotOverlay: {
    position: "absolute",
    bottom: -1,
    right: -1,
    borderWidth: 2,
    borderRadius: 8,
    padding: 0,
  },
  presenceDotOverlayLg: {
    position: "absolute",
    bottom: -2,
    right: -2,
    borderWidth: 2.5,
    borderRadius: 12,
    padding: 0,
  },
  targetInfo: { flex: 1, gap: 3 },
  targetName: { fontSize: 15, fontWeight: "600" },
  targetSubRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  targetNumber: { fontSize: 13 },
  presenceChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  presenceChipDot: { width: 6, height: 6, borderRadius: 3 },
  presenceChipText: { fontSize: 10, fontWeight: "600" },
  targetMeta: { flexDirection: "row", alignItems: "center", gap: 6 },
  targetCount: { fontSize: 12, fontWeight: "500" },

  // Presence dot
  presenceDot: {},
  presenceDotRinging: {
    // Ringing pulse effect placeholder — in production use Animated
  },
  presenceBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
    marginTop: 4,
  },
  presenceBadgeText: { fontSize: 13, fontWeight: "600" },

  // Active call info row (shown for busy/ringing contacts)
  activeCallRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  activeCallIcon: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  activeCallText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 15,
  },
  activeCallName: {
    fontWeight: "700",
  },
  activeCallDuration: {
    fontSize: 10,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },

  // Empty
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
    gap: 12,
  },
  emptyText: { fontSize: 14 },

  // Keypad
  keypadContent: { padding: 16, gap: 8 },
  keypadLabel: { fontSize: 12, fontWeight: "600", marginTop: 8 },
  keypadInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 17,
  },
  transferBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 16,
  },
  transferBtnText: { fontSize: 16, fontWeight: "600" },

  // Status overlay
  statusContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    padding: 24,
  },
  statusIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  statusTitle: { fontSize: 22, fontWeight: "700" },
  statusSubtitle: { fontSize: 15, textAlign: "center" },
  retryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 8,
  },
  retryBtnText: { color: "#fff", fontWeight: "600", fontSize: 15 },

  // Consulting
  consultContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  consultAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  consultAvatarText: { fontSize: 34, fontWeight: "700" },
  consultName: { fontSize: 24, fontWeight: "700" },
  consultNumber: { fontSize: 15 },
  consultBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    marginTop: 4,
  },
  consultDot: { width: 8, height: 8, borderRadius: 4 },
  consultBadgeText: { fontSize: 14, fontWeight: "600" },
  consultHint: {
    fontSize: 13,
    textAlign: "center",
    lineHeight: 20,
    marginTop: 16,
    paddingHorizontal: 16,
  },
  consultActions: {
    flexDirection: "row",
    gap: 16,
    marginTop: 32,
  },
  consultBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  consultBtnText: { fontSize: 15, fontWeight: "600" },

  // Quick message button on busy rows
  quickMsgBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },

  // Quick message modal
  msgModalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  msgModalSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 34,
    maxHeight: "70%",
  },
  msgModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
  },
  msgModalCancel: { fontSize: 16, fontWeight: "500" },
  msgModalTitle: { fontSize: 16, fontWeight: "600" },
  msgModalSend: { fontSize: 16, fontWeight: "600" },

  // Sent confirmation
  msgSentContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
    gap: 10,
  },
  msgSentIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  msgSentTitle: { fontSize: 20, fontWeight: "700" },
  msgSentSub: { fontSize: 14 },

  // Presets
  msgPresetsLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  msgPresetsRow: {
    paddingHorizontal: 16,
    gap: 8,
    paddingBottom: 12,
  },
  msgPresetChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  msgPresetText: { fontSize: 13, fontWeight: "500" },

  // Custom input
  msgInputContainer: {
    marginHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    minHeight: 80,
  },
  msgInput: {
    fontSize: 15,
    lineHeight: 21,
    flex: 1,
    textAlignVertical: "top",
  },
  msgCharCount: {
    fontSize: 11,
    textAlign: "right",
    marginTop: 4,
  },

  // Send button
  msgSendBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 12,
  },
  msgSendBtnText: { fontSize: 15, fontWeight: "600" },
});
