import { useEffect, useMemo, useState } from "react";
import { Image } from "expo-image";
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
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useDeviceContacts } from "@/hooks/use-device-contacts";
import { usePhoneCall } from "@/hooks/use-phone-call";
import { filterDeviceContacts } from "@/lib/phone/device-contacts";

export function DeviceContactAvatar({ name, imageUri, size = 44 }: { name: string; imageUri?: string; size?: number }) {
  const colors = useColors();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [imageUri]);
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: colors.primary + "18", overflow: "hidden" }]}>
      {imageUri && !failed ? (
        <Image
          source={{ uri: imageUri }}
          cachePolicy="none"
          recyclingKey={imageUri}
          contentFit="cover"
          onError={() => setFailed(true)}
          style={{ width: size, height: size, borderRadius: size / 2 }}
        />
      ) : (
        <Text style={[styles.initial, { color: colors.primary }]}>
          {Array.from(name)[0]}
        </Text>
      )}
    </View>
  );
}

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
        Contacts stay on your device.
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
            <DeviceContactAvatar name={item.name} imageUri={item.imageUri} />
            <View style={styles.details}>
              <Text
                style={[styles.name, { color: colors.foreground }]}
                numberOfLines={2}
              >
                {item.name}
              </Text>
              {item.phones.map((phone) => (
                <Pressable
                  key={phone.key}
                  accessibilityRole="button"
                  accessibilityLabel={`Call ${item.name}, ${phone.label}, ${phone.number}`}
                  accessibilityState={{ disabled: calling }}
                  disabled={calling}
                  onPress={() => void placeCall(phone.key)}
                  style={styles.phone}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.label, { color: colors.muted }]}>
                      {phone.label}
                    </Text>
                    <Text style={[styles.number, { color: colors.muted }]}>
                      {phone.number}
                    </Text>
                  </View>
                  <IconSymbol
                    name="phone.fill"
                    size={20}
                    color={calling ? colors.muted : colors.primary}
                  />
                </Pressable>
              ))}
            </View>
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
    fontSize: 12,
    lineHeight: 18,
  },
  search: {
    marginHorizontal: 20,
    marginBottom: 12,
    padding: 14,
    fontSize: 16,
    borderRadius: 12,
    minHeight: 48,
  },
  row: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  initial: { fontSize: 19, fontWeight: "600" },
  details: { flex: 1, minWidth: 0 },
  name: { fontSize: 17, fontWeight: "600" },
  label: { fontSize: 12, lineHeight: 17 },
  number: { fontSize: 14, lineHeight: 20 },
  phone: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
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
