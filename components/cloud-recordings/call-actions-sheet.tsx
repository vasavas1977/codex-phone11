import type { ComponentProps, ReactNode } from "react";
import { useRef, useState } from "react";
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Contacts from "expo-contacts";
import { SafeAreaView } from "react-native-safe-area-context";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { getAuthSnapshot } from "@/lib/_core/auth";
import type { CallBlockReason } from "@/lib/phone/call-blocks";

export interface CallActionCall {
  id: string;
  ownerUserId: number;
  name: string;
  number: string;
  direction: "incoming" | "outgoing" | "missed";
  duration: string;
  occurredAtLabel?: string;
  deviceContactId?: string;
  recordingStatus?: string;
  summaryStatus?: string;
}

type IconName = ComponentProps<typeof IconSymbol>["name"];

export interface ExtraCallAction {
  id: string;
  label: string;
  description?: string;
  accessibilityLabel?: string;
  icon: IconName;
  onPress(): void | Promise<void>;
}

export interface CallActionsSheetProps {
  visible: boolean;
  call: CallActionCall;
  starred: boolean;
  calling?: boolean;
  chatLabel?: string;
  avatar?: ReactNode;
  onCall(): void | Promise<void>;
  onChat?(): void | Promise<void>;
  onToggleStar(): void | Promise<void>;
  blockReason?: CallBlockReason;
  onSetBlock?(reason: CallBlockReason | null): void | Promise<void>;
  onDeleteHistory(): void | Promise<void>;
  onClose(): void;
  extraActions?: readonly ExtraCallAction[];
}

function contactDraft(call: CallActionCall): Contacts.Contact {
  const unnamed = !call.name.trim() || call.name.trim() === call.number.trim();
  return {
    contactType: Contacts.ContactTypes.Person,
    name: unnamed ? "" : call.name.trim(),
    firstName: unnamed ? "" : call.name.trim(),
    phoneNumbers: [{ number: call.number, label: "Phone11" }],
  };
}

function directionLabel(direction: CallActionCall["direction"]) {
  return direction === "incoming"
    ? "Incoming call"
    : direction === "outgoing"
      ? "Outgoing call"
      : "Missed call";
}

export function callShareText(call: CallActionCall) {
  return [
    `${directionLabel(call.direction)} with ${call.name}`,
    call.number,
    call.occurredAtLabel,
    call.duration,
  ]
    .filter(Boolean)
    .join("\n");
}

function statusLabel(value?: string) {
  if (!value) return "Not available";
  return value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");
}

export function callDetailsText(call: CallActionCall) {
  return [
    `Number: ${call.number}`,
    `Direction: ${directionLabel(call.direction)}`,
    `Date: ${call.occurredAtLabel || "Not available"}`,
    `Duration: ${call.duration}`,
    `Recording: ${statusLabel(call.recordingStatus)}`,
    `AI summary: ${statusLabel(call.summaryStatus)}`,
  ].join("\n");
}

function ActionRow({
  icon,
  label,
  accessibilityLabel,
  description,
  destructive,
  disabled,
  onPress,
}: {
  icon: IconName;
  label: string;
  accessibilityLabel?: string;
  description?: string;
  destructive?: boolean;
  disabled?: boolean;
  onPress(): void;
}) {
  const colors = useColors();
  const foreground = destructive ? colors.error : colors.foreground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { opacity: disabled ? 0.45 : pressed ? 0.65 : 1 },
      ]}
    >
      <View style={[styles.icon, { backgroundColor: colors.surface }]}>
        <IconSymbol name={icon} size={23} color={foreground} />
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color: foreground }]}>{label}</Text>
        {description ? (
          <Text style={[styles.rowDescription, { color: colors.muted }]}>
            {description}
          </Text>
        ) : null}
      </View>
      <IconSymbol name="chevron.right" size={19} color={colors.muted} />
    </Pressable>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.muted }]}>{title}</Text>
      {children}
    </View>
  );
}

export function CallActionsSheet({
  visible,
  call,
  starred,
  calling = false,
  chatLabel = "Chat",
  avatar,
  onCall,
  onChat,
  onToggleStar,
  blockReason,
  onSetBlock,
  onDeleteHistory,
  onClose,
  extraActions = [],
}: CallActionsSheetProps) {
  const colors = useColors();
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef<string | null>(null);
  const run = async (
    id: string,
    action: () => void | Promise<void>,
    failure: string,
  ) => {
    if (busyRef.current) return;
    if (getAuthSnapshot().user?.id !== call.ownerUserId) {
      onClose();
      Alert.alert(
        "Account changed",
        "Open Recents again before using this call action.",
      );
      return;
    }
    busyRef.current = id;
    setBusy(id);
    onClose();
    try {
      await action();
    } catch {
      Alert.alert(failure, "Please try again.");
    } finally {
      busyRef.current = null;
      setBusy(null);
    }
  };
  const remove = () => {
    onClose();
    Alert.alert(
      "Remove from Recents?",
      "Hide this call from Recents on this device? Its cloud recording is preserved. You can restore it from Hidden calls.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () =>
            void run(
              "remove",
              onDeleteHistory,
              "Call could not be removed",
            ),
        },
      ],
    );
  };
  const changeBlock = () => {
    if (!onSetBlock) return;
    onClose();
    if (blockReason) {
      Alert.alert(
        "Unblock this number?",
        "Remove this number from the blocklist saved on this device?",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Unblock",
            onPress: () =>
              void run(
                "unblock",
                () => onSetBlock(null),
                "Number could not be unblocked",
              ),
          },
        ],
      );
      return;
    }
    Alert.alert(
      "Block or report spam",
      "Choose how to save this number in Phone11's blocklist on this device.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Block number",
          onPress: () =>
            void run(
              "block",
              () => onSetBlock("other"),
              "Number could not be blocked",
            ),
        },
        {
          text: "Report spam & block",
          style: "destructive",
          onPress: () =>
            void run(
              "spam",
              () => onSetBlock("spam"),
              "Spam report could not be saved",
            ),
        },
      ],
    );
  };
  const nativeContacts = Platform.OS !== "web";
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View
        style={styles.overlay}
        accessibilityViewIsModal
        accessibilityLabel={`Actions for ${call.name}`}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close call actions"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <SafeAreaView
          edges={["bottom"]}
          style={[styles.sheet, { backgroundColor: colors.background }]}
        >
          <View style={styles.handle} />
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            {avatar ?? <View style={[styles.avatar, { backgroundColor: colors.primary + "20" }]}>
              <Text style={[styles.avatarText, { color: colors.primary }]}>
                {Array.from(call.name || call.number)[0]?.toUpperCase()}
              </Text>
            </View>}
            <View style={styles.headerText}>
              <Text numberOfLines={1} style={[styles.name, { color: colors.foreground }]}>
                {call.name}
              </Text>
              <Text numberOfLines={1} style={[styles.number, { color: colors.muted }]}>
                {call.number}
              </Text>
              <Text style={[styles.metadata, { color: colors.muted }]}>
                {directionLabel(call.direction)} · {call.duration}
              </Text>
            </View>
          </View>
          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator
            contentContainerStyle={styles.content}
          >
            <Section title="Connect">
              <ActionRow
                icon="phone.fill"
                label={calling ? "Calling…" : `Call ${call.number}`}
                disabled={calling || busy !== null}
                onPress={() =>
                  void run("call", onCall, "Call could not start")
                }
              />
              {onChat ? (
                <ActionRow
                  icon="message.fill"
                  label={chatLabel}
                  description="Open the existing teammate conversation"
                  disabled={busy !== null}
                  onPress={() =>
                    void run("chat", onChat, "Chat could not be opened")
                  }
                />
              ) : null}
            </Section>
            {nativeContacts ? (
              <Section title="Contact">
                {call.deviceContactId ? (
                  <ActionRow
                    icon="person.fill"
                    label="View contact"
                    disabled={busy !== null}
                    onPress={() =>
                      void run(
                        "view-contact",
                        () =>
                          Contacts.presentFormAsync(
                            call.deviceContactId,
                            undefined,
                            { allowsActions: true, allowsEditing: true },
                          ),
                        "Contact could not be opened",
                      )
                    }
                  />
                ) : (
                  <>
                    <ActionRow
                      icon="person.fill.badge.plus"
                      label="Create new contact"
                      disabled={busy !== null}
                      onPress={() =>
                        void run(
                          "create-contact",
                          () =>
                            Contacts.presentFormAsync(
                              null,
                              contactDraft(call),
                              {
                                isNew: true,
                                allowsActions: true,
                                allowsEditing: true,
                              },
                            ),
                          "Contact could not be created",
                        )
                      }
                    />
                    <ActionRow
                      icon="person.fill.badge.plus"
                      label="Add to existing contact"
                      description="Choose a person in the native contact editor"
                      disabled={busy !== null}
                      onPress={() =>
                        void run(
                          "add-contact",
                          () =>
                            Contacts.presentFormAsync(null, contactDraft(call), {
                              isNew: false,
                              allowsActions: true,
                              allowsEditing: true,
                            }),
                          "Contact could not be updated",
                        )
                      }
                    />
                  </>
                )}
              </Section>
            ) : null}
            <Section title="Organize">
              <ActionRow
                icon="info.circle"
                label="Call details"
                description="Duration, direction, recording and AI status"
                disabled={busy !== null}
                onPress={() => {
                  onClose();
                  Alert.alert("Call details", callDetailsText(call));
                }}
              />
              <ActionRow
                icon="doc.on.clipboard"
                label="Copy number"
                disabled={busy !== null}
                onPress={() =>
                  void run(
                    "copy",
                    () => Clipboard.setStringAsync(call.number).then(() => undefined),
                    "Number could not be copied",
                  )
                }
              />
              <ActionRow
                icon="square.and.arrow.up"
                label="Share call details"
                description="Choose where to share in the system sheet"
                disabled={busy !== null}
                onPress={() =>
                  void run(
                    "share",
                    () =>
                      Share.share({
                        title: "Phone11 call details",
                        message: callShareText(call),
                      }).then(() => undefined),
                    "Call details could not be shared",
                  )
                }
              />
              <ActionRow
                icon={starred ? "star.fill" : "star"}
                label={
                  call.deviceContactId
                    ? starred
                      ? "Unstar contact"
                      : "Star contact"
                    : starred
                      ? "Unstar number"
                      : "Star number"
                }
                disabled={busy !== null}
                onPress={() =>
                  void run(
                    "star",
                    onToggleStar,
                    "Star could not be changed",
                  )
                }
              />
              {onSetBlock ? (
                <ActionRow
                  icon="hand.raised.fill"
                  label={
                    blockReason ? "Unblock number" : "Block or report spam"
                  }
                  description={
                    blockReason === "spam"
                      ? "Reported as spam in this device blocklist"
                      : blockReason
                        ? "Saved in this device blocklist"
                        : "Saved locally on this device"
                  }
                  destructive={!blockReason}
                  disabled={busy !== null}
                  onPress={changeBlock}
                />
              ) : null}
            </Section>
            {extraActions.length ? (
              <Section title="Call content">
                {extraActions.map((action) => (
                  <ActionRow
                    key={action.id}
                    icon={action.icon}
                    label={action.label}
                    accessibilityLabel={action.accessibilityLabel}
                    description={action.description}
                    disabled={busy !== null}
                    onPress={() =>
                      void run(
                        action.id,
                        action.onPress,
                        `${action.label} failed`,
                      )
                    }
                  />
                ))}
              </Section>
            ) : null}
            <Section title="History">
              <ActionRow
                icon="trash.fill"
                label="Remove from Recents"
                description="The cloud recording will be preserved"
                destructive
                disabled={busy !== null}
                onPress={remove}
              />
            </Section>
          </ScrollView>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel call actions"
            onPress={onClose}
            style={[styles.cancel, { borderTopColor: colors.border }]}
          >
            <Text style={[styles.cancelText, { color: colors.primary }]}>Cancel</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.48)",
  },
  sheet: {
    maxHeight: "88%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: "hidden",
  },
  handle: {
    width: 38,
    height: 5,
    borderRadius: 3,
    alignSelf: "center",
    marginTop: 9,
    marginBottom: 5,
    backgroundColor: "#9AA2AC",
  },
  header: {
    minHeight: 92,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
  },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 23, fontWeight: "700" },
  headerText: { flex: 1, gap: 2 },
  name: { fontSize: 19, fontWeight: "700" },
  number: { fontSize: 14 },
  metadata: { fontSize: 12, marginTop: 2 },
  content: { paddingVertical: 8 },
  section: { paddingTop: 8 },
  sectionTitle: {
    paddingHorizontal: 20,
    paddingTop: 7,
    paddingBottom: 5,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  row: {
    minHeight: 62,
    paddingHorizontal: 20,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
  },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 16, fontWeight: "500" },
  rowDescription: { fontSize: 12, lineHeight: 17 },
  cancel: {
    minHeight: 58,
    borderTopWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: { fontSize: 17, fontWeight: "600" },
});
