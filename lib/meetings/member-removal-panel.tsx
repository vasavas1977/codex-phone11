import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { User } from "@/lib/_core/auth";
import { getAuthSnapshot } from "@/lib/_core/auth";
import { trpc } from "@/lib/trpc";
import { getActiveNativeMeeting, type ActiveNativeMeeting } from "./native-session-registry";
import { MeetingMemberRemoval, type RemovalMember } from "./member-removal";
import { ProfileAvatar } from "@/components/profile/profile-avatar";

/** Shared browser/iOS/Android UI. Admitted access is distinct from the live media roster. */
export function MeetingMemberRemovalPanel({ meeting, owner, isCurrent,
  renderMemberAvatar }: { meeting: ActiveNativeMeeting; owner: User; isCurrent?: () => boolean;
    renderMemberAvatar?: (target: RemovalMember, tenantId: number) => ReactNode }) {
  const utilities = trpc.useUtils();
  const request = trpc.meetings.removeMember.useMutation();
  const sendRequest = request.mutateAsync;
  const session = useSyncExternalStore(meeting.session.subscribe, meeting.session.getSnapshot, meeting.session.getSnapshot);
  const controller = useMemo(() => {
    const room = meeting.room;
    const connectedAtCreation = session.status === "connected";
    return new MeetingMemberRemoval(meeting.meetingId ?? "", owner.id,
      () => connectedAtCreation && getAuthSnapshot().user === owner && getActiveNativeMeeting(owner.id) === meeting &&
        meeting.room === room && meeting.session.getSnapshot().status === "connected" && !meeting.wasInterruptedBySip &&
        (isCurrent?.() ?? true),
      // Direct authenticated queries must not inherit another same-ID session's
      // cached or in-flight React Query authority snapshot.
      { snapshot: meetingId => utilities.client.meetings.hostControls.query({ meetingId }),
        request: input => sendRequest(input),
        poll: input => utilities.client.meetings.removalStatus.query(input) });
  }, [meeting, owner, session.status, utilities, sendRequest, isCurrent]);
  const view = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<RemovalMember | null>(null);
  useEffect(() => {
    // Connection loss retires this controller permanently, including a loss and
    // recovery published before React renders either intermediate snapshot.
    const checkConnection = () => {
      if (meeting.session.getSnapshot().status !== "connected" || meeting.wasInterruptedBySip) controller.dispose();
    };
    const unsubscribe = meeting.session.subscribe(checkConnection);
    checkConnection(); void controller.refresh();
    return () => { unsubscribe(); controller.dispose(); };
  }, [controller, meeting]);
  useEffect(() => {
    if (confirmation && !view.members.includes(confirmation)) setConfirmation(null);
  }, [view.members, confirmation]);
  if (!view.available && !view.error) return null;
  const busy = view.loading || view.busyUserId !== null;
  return <View style={styles.controls}>
    <Pressable accessibilityRole="button" accessibilityLabel="Manage admitted meeting members"
      onPress={() => setOpen(true)}><Text style={styles.link}>Manage meeting access</Text></Pressable>
    <Modal transparent visible={open} onRequestClose={() => { setConfirmation(null); setOpen(false); }}>
      <View style={styles.backdrop}><View style={styles.sheet}>
        <Text style={styles.heading}>Admitted meeting members</Text>
        <Text style={styles.copy}>These members have meeting access. The participants list separately shows live connections.</Text>
        {view.error ? <Text accessibilityRole="alert" style={styles.copy}>{view.error}</Text> : null}
        {view.loading ? <ActivityIndicator /> : null}
        {view.available && view.members.length === 0 ? <Text style={styles.copy}>No other admitted members are available.</Text> : null}
        <ScrollView style={styles.memberList}>
        {view.members.map(member => <View key={`${member.userId}:${member.expectedParticipantId}`} style={styles.member}>
          {renderMemberAvatar && view.tenantId ? renderMemberAvatar(member, view.tenantId) :
            <ProfileAvatar name={member.name ?? "Meeting member"} size={40} interactive={false} />}
          <Text style={styles.name}>{member.name ?? "Meeting member"}</Text>
          <Text style={styles.copy}>{member.state === "admitted" ? "Meeting access admitted" :
            member.state === "pending" ? "Access revoked · removal pending; departure is not confirmed" :
            member.state === "completed" ? "Access revoked · service acknowledged removal" :
            "Access revoked · removal could not be confirmed. Contact your workspace administrator."}</Text>
          {member.state === "admitted" ? <Pressable accessibilityRole="button"
            accessibilityLabel={`Remove meeting access for ${member.name ?? "member"}`} disabled={busy}
            onPress={() => setConfirmation(member)}><Text style={styles.link}>Remove meeting access</Text></Pressable> : null}
          {member.state === "pending" ? <View style={styles.actions}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Check removal status for ${member.name ?? "member"}`}
              disabled={busy} onPress={() => void controller.act(member, "poll")}><Text style={styles.link}>Check status</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Retry removal request for ${member.name ?? "member"}`}
              disabled={busy} onPress={() => void controller.act(member, "request")}><Text style={styles.link}>Retry request</Text></Pressable>
          </View> : null}
        </View>)}
        {confirmation ? <View style={styles.member}>
          <Text style={styles.copy}>Permanently block this membership from rejoining and request removal? A pending request does not confirm the member has left.</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Confirm permanent meeting removal" disabled={busy}
            onPress={() => { const member = confirmation; setConfirmation(null); void controller.act(member, "request"); }}>
            <Text style={styles.link}>Confirm removal</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel meeting removal" onPress={() => setConfirmation(null)}><Text style={styles.link}>Cancel</Text></Pressable>
        </View> : null}
        </ScrollView>
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" accessibilityLabel="Refresh meeting access controls" disabled={busy}
            onPress={() => { setConfirmation(null); void controller.refresh(); }}><Text style={styles.link}>Refresh access</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Close meeting access controls"
            onPress={() => { setConfirmation(null); setOpen(false); }}><Text style={styles.link}>Done</Text></Pressable>
        </View>
      </View></View>
    </Modal>
  </View>;
}
const styles = StyleSheet.create({
  controls: { padding: 12 }, link: { color: "#69AFFF", fontSize: 15, paddingVertical: 10 },
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "#00000099" },
  sheet: { backgroundColor: "#191D26", padding: 24, gap: 12 },
  heading: { color: "#FFFFFF", fontSize: 20, fontWeight: "700" },
  name: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
  copy: { color: "#B4BAC6", fontSize: 14, lineHeight: 20 },
  member: { borderTopWidth: 1, borderTopColor: "#FFFFFF2B", paddingVertical: 12 },
  memberList: { maxHeight: 400 },
  actions: { flexDirection: "row", gap: 24 },
});
