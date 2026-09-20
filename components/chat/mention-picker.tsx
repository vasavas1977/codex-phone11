import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useColors } from "@/hooks/use-colors";
import type { ChatPerson } from "@/lib/chat/types";
import { filterMentionPeople } from "@/lib/chat/mentions";
import { PresenceIndicator } from "@/components/chat/presence-indicator";
import { allMentionMatches } from "@/lib/chat/all-mentions";

function initials(name: string) {
  return name.trim().split(/\s+/u).slice(0, 2).map(part => part[0]).join("").toUpperCase();
}

export function MentionPicker({ people, query, tenantId, canMentionAll = false, loading = false, onPick, onPickAll }: { people: ChatPerson[]; query: string; tenantId?: number; canMentionAll?: boolean; loading?: boolean; onPick: (person: ChatPerson) => void; onPickAll?: () => void }) {
  const colors = useColors();
  const matches = filterMentionPeople(people, query);
  return <View accessibilityLabel="Mention people" style={{ maxHeight: 280, borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: colors.surface, overflow: "hidden" }}>
    <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "600", paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6 }}>
      {query ? `Members matching “${query}”` : "Mention a member"}
    </Text>
    <ScrollView keyboardShouldPersistTaps="always">{loading && <ActivityIndicator accessibilityLabel="Loading conversation members" style={{ padding: 14 }} />}
    {!loading && canMentionAll && allMentionMatches(query) && <Pressable accessibilityRole="button" accessibilityLabel="Mention everyone" onPress={onPickAll}
      style={{ paddingHorizontal: 12, paddingVertical: 7, minHeight: 52, borderBottomWidth: 1, borderBottomColor: colors.border, justifyContent: "center" }}>
      <Text style={{ color: colors.primary, fontSize: 15, fontWeight: "700" }}>@all</Text>
      <Text style={{ color: colors.muted, fontSize: 12 }}>Notify all current members</Text>
    </Pressable>}
    {!loading && matches.map(person => <Pressable key={person.id} accessibilityRole="button" accessibilityLabel={`Mention ${person.name}`} onPress={() => onPick(person)}
      style={{ paddingHorizontal: 12, paddingVertical: 7, minHeight: 52, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: "row", alignItems: "center", gap: 10 }}>
      <View style={{ width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary + "18" }}>
        <Text style={{ color: colors.primary, fontSize: 13, fontWeight: "700" }}>{initials(person.name)}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 15, lineHeight: 19, fontWeight: "600" }}>{person.name}</Text>
        <View style={{ minHeight: 16, flexDirection: "row", alignItems: "center", gap: 7 }}>
          {person.extension && <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 16 }}>Ext. {person.extension}</Text>}
          {tenantId && <PresenceIndicator tenantId={tenantId} userId={person.id} compact />}
        </View>
      </View>
    </Pressable>)}{!loading && !matches.length && !(canMentionAll && allMentionMatches(query)) && <Text style={{ color: colors.muted, padding: 14 }}>No matching member</Text>}</ScrollView>
  </View>;
}
