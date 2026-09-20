import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useColors } from "@/hooks/use-colors";
import type { ChatPerson } from "@/lib/chat/types";
import { filterMentionPeople } from "@/lib/chat/mentions";

export function MentionPicker({ people, query, loading = false, onPick }: { people: ChatPerson[]; query: string; loading?: boolean; onPick: (person: ChatPerson) => void }) {
  const colors = useColors();
  const matches = filterMentionPeople(people, query);
  return <View accessibilityLabel="Mention people" style={{ maxHeight: 320, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface, overflow: "hidden" }}>
    <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "600", paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6 }}>
      {query ? `Members matching “${query}”` : "Mention a member"}
    </Text>
    <ScrollView keyboardShouldPersistTaps="always">{loading && <ActivityIndicator accessibilityLabel="Loading conversation members" style={{ padding: 14 }} />}{!loading && matches.map(person => <Pressable key={person.id} accessibilityRole="button" accessibilityLabel={`Mention ${person.name}`} onPress={() => onPick(person)}
      style={{ paddingHorizontal: 14, paddingVertical: 10, minHeight: 44, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <Text style={{ color: colors.foreground, fontWeight: "600" }}>{person.name}</Text>
      {person.extension && <Text style={{ color: colors.muted, fontSize: 12 }}>{person.extension}</Text>}
    </Pressable>)}{!loading && !matches.length && <Text style={{ color: colors.muted, padding: 14 }}>No matching member</Text>}</ScrollView>
  </View>;
}
