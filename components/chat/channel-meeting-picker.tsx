import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import type { ChatPerson } from "@/lib/chat/types";

export type ChannelMeetingPickerProps = {
  visible: boolean;
  tenantId: number;
  channelId: string;
  channelName: string;
  hostId: number;
  members: ChatPerson[];
  /** Loading the authorized roster never means a meeting is being created. */
  loading?: boolean;
  busy?: boolean;
  error?: string | null;
  /** Only the channel-creation capability may enable Start; join capability is insufficient. */
  startAvailable: boolean;
  maxSelectedMembers?: number;
  unavailableReason?: string;
  onCancel: () => void;
  onStart: (memberIds: number[]) => void;
};

export function channelInvitees(members: ChatPerson[], hostId: number): ChatPerson[] {
  const seen = new Set<number>();
  return members.filter(person => {
    if (!Number.isSafeInteger(person.id) || person.id <= 0 || person.id === hostId || seen.has(person.id)) return false;
    seen.add(person.id);
    return true;
  });
}

export function ChannelMeetingPicker(props: ChannelMeetingPickerProps) {
  if (!props.visible) return null;
  // Reopening, changing account/channel, or changing the authoritative roster
  // starts a new selection. A removed member can never survive in local state.
  const roster = [...new Set(props.members.map(person => person.id))].sort((a, b) => a - b).join(",");
  return <Picker key={`${props.tenantId}:${props.channelId}:${props.hostId}:${roster}`} {...props} />;
}

function Picker(props: ChannelMeetingPickerProps) {
  const colors = useColors();
  const invitees = channelInvitees(props.members, props.hostId);
  const [selected, setSelected] = useState(() => new Set(invitees.map(person => person.id)));
  const [query, setQuery] = useState("");
  const selectedIds = invitees.filter(person => selected.has(person.id)).map(person => person.id);
  const canStart = props.startAvailable && !props.loading && !props.busy && selectedIds.length > 0 && selectedIds.length <= (props.maxSelectedMembers ?? 50) && props.members.some(person => person.id === props.hostId);
  const matches = invitees.filter(person => `${person.name} ${person.extension ?? ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const toggle = (id: number) => setSelected(previous => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  return <Modal visible transparent animationType="slide" onRequestClose={props.busy ? undefined : props.onCancel}>
    <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "#00000055" }}>
      <View accessibilityViewIsModal style={{ maxHeight: "85%", backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 34 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <Text accessibilityRole="header" style={{ color: colors.foreground, fontSize: 22, fontWeight: "700" }}>Start a meeting</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel meeting selection" disabled={props.busy} onPress={props.onCancel} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 8 }}>
            <Text style={{ color: colors.primary }}>Cancel</Text>
          </Pressable>
        </View>
        <Text numberOfLines={2} style={{ color: colors.muted, marginBottom: 12 }}>{props.channelName}</Text>
        <TextInput accessibilityLabel="Search meeting participants" placeholder="Search members" placeholderTextColor={colors.muted} value={query} onChangeText={setQuery} editable={!props.busy && !props.loading} style={{ color: colors.foreground, backgroundColor: colors.surface, borderRadius: 12, padding: 12, minHeight: 44 }} />
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginVertical: 8 }}>
          <Text style={{ color: colors.muted }}>{selectedIds.length} selected · You are the host</Text>
          <Pressable accessibilityRole="button" disabled={props.busy || props.loading} onPress={() => setSelected(selectedIds.length === invitees.length ? new Set() : new Set(invitees.map(person => person.id)))} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 8 }}>
            <Text style={{ color: colors.primary }}>{selectedIds.length === invitees.length ? "Deselect all" : "Select all"}</Text>
          </Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" style={{ flexGrow: 0 }}>
          {props.loading && <Text accessibilityLiveRegion="polite" style={{ paddingVertical: 20, color: colors.muted }}>Loading channel members…</Text>}
          {!props.loading && matches.map(person => <Pressable key={person.id} accessibilityRole="checkbox" accessibilityLabel={person.name} accessibilityState={{ checked: selected.has(person.id), disabled: !!props.busy }} disabled={props.busy} onPress={() => toggle(person.id)} style={{ minHeight: 60, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <ProfileAvatar name={person.name} photoUrl={person.photoUrl} tenantId={props.tenantId} userId={person.id} size={36} rounded />
            <Text numberOfLines={1} style={{ flex: 1, color: colors.foreground, fontSize: 16 }}>{person.name}</Text>
            <Text style={{ color: selected.has(person.id) ? colors.primary : colors.muted, fontSize: 22 }}>{selected.has(person.id) ? "☑" : "☐"}</Text>
          </Pressable>)}
          {!props.loading && !matches.length && <Text style={{ paddingVertical: 20, color: colors.muted }}>No matching members</Text>}
        </ScrollView>
        {!props.startAvailable && <Text accessibilityRole="alert" style={{ color: colors.muted, marginTop: 12 }}>{props.unavailableReason ?? "Starting a channel meeting is not available yet. No invitations have been sent."}</Text>}
        {selectedIds.length > (props.maxSelectedMembers ?? 50) && <Text accessibilityRole="alert" style={{ color: colors.error }}>Select up to {props.maxSelectedMembers ?? 50} members.</Text>}
        {!!props.error && <Text accessibilityRole="alert" style={{ color: colors.error, marginTop: 12 }}>{props.error}</Text>}
        <Pressable accessibilityRole="button" accessibilityLabel="Start meeting" accessibilityState={{ disabled: !canStart, busy: !!props.busy }} disabled={!canStart} onPress={() => { if (canStart) props.onStart(selectedIds); }} style={{ marginTop: 16, minHeight: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: canStart ? colors.primary : colors.surface }}>
          <Text style={{ color: canStart ? "#ffffff" : colors.muted, fontSize: 17, fontWeight: "600" }}>{props.busy ? "Starting…" : "Start meeting"}</Text>
        </Pressable>
      </View>
    </View>
  </Modal>;
}
