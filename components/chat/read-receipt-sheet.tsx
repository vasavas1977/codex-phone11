import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { formatChatTime, type ChatPerson, type ChatReadReceipt } from "@/lib/chat/types";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import { ProfileCardProvider } from "@/components/profile/profile-card-provider";

export function ReadReceiptSheet({ visible, loading, rows, people = [], tenantId, error, onClose }: {
  visible: boolean;
  loading: boolean;
  rows: ChatReadReceipt[];
  /** Current authenticated workspace roster; never resolve by display name. */
  people?: readonly ChatPerson[];
  tenantId?: number;
  error: string | null;
  onClose: () => void;
}) {
  const colors = useColors();
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><ProfileCardProvider key={visible ? "visible" : "hidden"} selectionOnly>
    <Pressable style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.35)" }} accessibilityRole="button" accessibilityLabel="Close read receipts" onPress={onClose}>
      <Pressable style={{ width: "100%", maxWidth: 620, maxHeight: "70%", alignSelf: "center", borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, backgroundColor: colors.background }} accessibilityViewIsModal onPress={() => undefined}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 }}>
          <Text style={{ color: colors.foreground, fontSize: 17, fontWeight: "700" }}>Read by</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close read receipts" onPress={onClose} style={{ minWidth: 44, minHeight: 44, alignItems: "flex-end", justifyContent: "center" }}>
            <Text style={{ color: colors.primary }}>Close</Text>
          </Pressable>
        </View>
        {loading ? <ActivityIndicator color={colors.primary} /> : error ? (
          <Text accessibilityLiveRegion="polite" style={{ color: colors.error, paddingVertical: 18 }}>{error}</Text>
        ) : rows.length ? (
          <ScrollView contentContainerStyle={{ paddingBottom: 12 }}>
            {rows.map(receipt => <View key={receipt.userId} style={{ minHeight: 54, flexDirection: "row", alignItems: "center", gap: 12 }}>
              <ProfileAvatar name={receipt.name} photoUrl={receipt.photoUrl ?? people.find(person => person.id === receipt.userId)?.photoUrl} tenantId={tenantId} userId={receipt.userId} size={34} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.foreground, fontWeight: "600" }}>{receipt.name}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>Read {formatChatTime(receipt.readAt)}</Text>
              </View>
            </View>)}
          </ScrollView>
        ) : <Text style={{ color: colors.muted, paddingVertical: 18 }}>No read receipts yet</Text>}
      </Pressable>
    </Pressable>
  </ProfileCardProvider></Modal>;
}
