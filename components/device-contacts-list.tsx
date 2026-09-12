import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useColors } from "@/hooks/use-colors";
import { useDeviceContacts } from "@/hooks/use-device-contacts";
import { usePhoneCall } from "@/hooks/use-phone-call";
import { filterDeviceContacts } from "@/lib/phone/device-contacts";

export function DeviceContactsList() {
  const colors = useColors();
  const contacts = useDeviceContacts();
  const { placeCall, calling } = usePhoneCall();
  const [query, setQuery] = useState("");
  const [settingsError, setSettingsError] = useState(false);
  const people = useMemo(
    () => filterDeviceContacts(contacts.people, query),
    [contacts.people, query],
  );
  const allowed =
    contacts.permission === "granted" || contacts.permission === "limited";
  const settings = async () => {
    try {
      setSettingsError(false);
      await Linking.openSettings();
    } catch {
      setSettingsError(true);
    }
  };
  return (
    <View style={{ flex: 1 }}>
      <Text style={[styles.note, { color: colors.muted }]}>
        Phone contacts stay on this device. Changes refresh when you return to
        Phone11 or pull down.
      </Text>
      {contacts.permission === "limited" && (
        <Pressable
          accessibilityRole="button"
          onPress={() => void settings()}
          style={styles.action}
        >
          <Text style={{ color: colors.primary }}>
            Selected contacts only · Manage access
          </Text>
        </Pressable>
      )}
      {settingsError && (
        <Text style={[styles.note, { color: colors.muted }]}>
          Open your phone’s Settings, then Phone11, to change Contacts access.
        </Text>
      )}
      {allowed && (
        <TextInput
          accessibilityLabel="Search phone contacts"
          placeholder="Search name or phone number"
          placeholderTextColor={colors.muted}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          style={[
            styles.search,
            { color: colors.foreground, backgroundColor: colors.surface },
          ]}
        />
      )}
      <FlatList
        data={people}
        keyExtractor={(item) => item.id}
        refreshing={contacts.loading}
        onRefresh={() => void contacts.refresh()}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <View style={[styles.row, { borderBottomColor: colors.border }]}>
            <Text style={[styles.name, { color: colors.foreground }]}>
              {item.name}
            </Text>
            {item.phones.map((phone) => (
              <Pressable
                key={phone.key}
                accessibilityRole="button"
                accessibilityLabel={`Call ${item.name}, ${phone.label}, ${phone.number}`}
                disabled={calling}
                onPress={() => void placeCall(phone.key)}
                style={styles.phone}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.muted }}>{phone.label}</Text>
                  <Text style={{ color: colors.primary, fontSize: 17 }}>
                    {phone.number}
                  </Text>
                </View>
                <Text style={{ color: colors.primary }}>Call</Text>
              </Pressable>
            ))}
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            {contacts.loading ? (
              <ActivityIndicator
                color={colors.primary}
                accessibilityLabel="Refreshing phone contacts"
              />
            ) : (
              <>
                <Text style={[styles.name, { color: colors.foreground }]}>
                  {contacts.error
                    ? "Contacts unavailable"
                    : allowed
                      ? query
                        ? "No matching contacts"
                        : "No phone numbers found"
                      : "Your phone contacts"}
                </Text>
                <Text
                  style={{
                    color: colors.muted,
                    textAlign: "center",
                    lineHeight: 23,
                  }}
                >
                  {contacts.error ||
                    (contacts.permission === "unsupported"
                      ? "Device contacts are available in the iPhone and Android apps."
                      : contacts.permission === "denied"
                        ? "Allow Contacts access in Settings to see your phone contacts here."
                        : allowed
                          ? "Only contacts with a valid phone number appear here."
                          : "Choose which contacts Phone11 can read. Your contacts are not uploaded to your workspace.")}
                </Text>
                {contacts.permission !== "unsupported" && (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      contacts.permission === "denied"
                        ? void settings()
                        : void contacts.refresh(!allowed)
                    }
                    style={[styles.action, { backgroundColor: colors.surface }]}
                  >
                    <Text style={{ color: colors.primary }}>
                      {contacts.permission === "denied"
                        ? "Open Settings"
                        : allowed
                          ? "Refresh contacts"
                          : "Allow Contacts access"}
                    </Text>
                  </Pressable>
                )}
              </>
            )}
          </View>
        }
      />
    </View>
  );
}
const styles = StyleSheet.create({
  note: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    fontSize: 14,
    lineHeight: 21,
  },
  search: {
    marginHorizontal: 20,
    marginBottom: 12,
    padding: 14,
    borderRadius: 12,
    minHeight: 48,
  },
  row: { paddingHorizontal: 20, paddingTop: 16, borderBottomWidth: 0.5 },
  name: { fontSize: 18, fontWeight: "600" },
  phone: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 58,
    paddingVertical: 8,
    gap: 10,
  },
  action: {
    minHeight: 48,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 12,
  },
  empty: { padding: 28, gap: 18, alignItems: "center" },
});
