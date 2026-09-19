import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useState } from "react";
import { useColors } from "@/hooks/use-colors";
import type { ChatPerson } from "@/lib/chat/types";

export function MentionPicker({ people, onPick }: { people: ChatPerson[]; onPick: (person: ChatPerson) => void }) {
  const colors = useColors();
  const [query, setQuery] = useState("");
  const matches = people.filter(person => `${person.name} ${person.extension || ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <View accessibilityLabel="Mention people" style={{ maxHeight: 320, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface, overflow: "hidden" }}>
    <TextInput accessibilityLabel="Find conversation member" value={query} onChangeText={setQuery} placeholder="Find a member" placeholderTextColor={colors.muted}
      style={{ color: colors.foreground, minHeight: 44, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: colors.border }} />
    <ScrollView keyboardShouldPersistTaps="handled">{matches.map(person => <Pressable key={person.id} accessibilityRole="button" accessibilityLabel={`Mention ${person.name}`} onPress={() => onPick(person)}
      style={{ paddingHorizontal: 14, paddingVertical: 10, minHeight: 44, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <Text style={{ color: colors.foreground, fontWeight: "600" }}>{person.name}</Text>
      {person.extension && <Text style={{ color: colors.muted, fontSize: 12 }}>{person.extension}</Text>}
    </Pressable>)}{!matches.length && <Text style={{ color: colors.muted, padding: 14 }}>No matching member</Text>}</ScrollView>
  </View>;
}
