import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { router } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useDirectory } from "@/hooks/use-directory";
import { ContactDetails } from "@/components/contact-details";
import { DeviceContactsList } from "@/components/device-contacts-list";
import { filterDirectory } from "@/lib/phone/directory";

export default function ContactsScreen() {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const [selectedId, setSelectedId] = useState<number>();
  const [source, setSource] = useState<"device" | "team">("device");
  const [query, setQuery] = useState("");
  const [tenantId, setTenantId] = useState<number>();
  // Local address-book access is separate from the tenant directory. Do not
  // request or retain team data until the user explicitly opens Team.
  const directory = useDirectory(tenantId, source === "team");
  const people = useMemo(
    () => filterDirectory(directory.people, query),
    [directory.people, query],
  );
  return (
    <ScreenContainer
      style={{ width: "100%", maxWidth: 1200, alignSelf: "center" }}
    >
      <View style={styles.header}>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: colors.foreground }]}
        >
          Contacts
        </Text>
        {source === "team" && directory.workspace && (
          <Text style={{ color: colors.muted }}>
            {directory.workspace.name}
          </Text>
        )}
      </View>
      <View style={styles.workspaceRow}>
        {(["device", "team"] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected: source === value }}
            onPress={() => {
              setSelectedId(undefined);
              setSource(value);
            }}
            style={[
              styles.workspace,
              {
                backgroundColor:
                  source === value ? colors.primary : colors.surface,
              },
            ]}
          >
            <Text
              style={{
                color: source === value ? "white" : colors.muted,
                fontSize: 15,
                fontWeight: "600",
              }}
            >
              {value === "device" ? "Phone contacts" : "Team"}
            </Text>
          </Pressable>
        ))}
      </View>
      {source === "device" ? (
        <DeviceContactsList />
      ) : (
        <>
          {directory.workspaces.length > 1 && (
            <View style={styles.workspaceRow}>
              {directory.workspaces.map((workspace) => (
                <Pressable
                  key={workspace.id}
                  accessibilityRole="button"
                  accessibilityState={{
                    selected: directory.workspace?.id === workspace.id,
                  }}
                  onPress={() => {
                    setSelectedId(undefined);
                    setQuery("");
                    setTenantId(workspace.id);
                  }}
                  style={[
                    styles.workspace,
                    {
                      backgroundColor:
                        directory.workspace?.id === workspace.id
                          ? colors.primary + "20"
                          : colors.surface,
                    },
                  ]}
                >
                  <Text style={{ color: colors.foreground }}>
                    {workspace.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          {directory.signedIn && (
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search name or extension"
              accessibilityLabel="Search contacts by name or extension"
              placeholderTextColor={colors.muted}
              autoCorrect={false}
              style={[
                styles.search,
                {
                  color: colors.foreground,
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
              ]}
            />
          )}
          <View style={{ flex: 1, flexDirection: "row" }}>
            <FlatList
              style={{ flex: 1 }}
              data={people}
              keyExtractor={(item) => String(item.id)}
              refreshing={directory.loading}
              onRefresh={() => void directory.reload()}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open contact ${item.name}`}
                  onPress={() => {
                    if (!directory.workspace) return;
                    if (wide) {
                      setSelectedId(item.id);
                      return;
                    }
                    router.push({
                      pathname: "/contacts/[id]",
                      params: { id: item.id, tenantId: directory.workspace.id },
                    });
                  }}
                  style={[
                    styles.row,
                    {
                      borderBottomColor: colors.border,
                      backgroundColor:
                        wide && selectedId === item.id
                          ? colors.surface
                          : undefined,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.avatar,
                      { backgroundColor: colors.primary + "18" },
                    ]}
                  >
                    <Text style={[styles.initial, { color: colors.primary }]}>
                      {Array.from(item.name)[0]}
                    </Text>
                  </View>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={[styles.name, { color: colors.foreground }]}>
                      {item.name}
                    </Text>
                    <Text style={{ color: colors.muted, fontSize: 14 }}>
                      {item.extension
                        ? `Ext. ${item.extension}`
                        : "Team member"}
                    </Text>
                  </View>
                  <IconSymbol
                    name="chevron.right"
                    size={18}
                    color={colors.muted}
                  />
                </Pressable>
              )}
              ListEmptyComponent={
                <View style={styles.empty}>
                  {directory.loading ? (
                    <ActivityIndicator
                      color={colors.primary}
                      accessibilityLabel="Loading contacts"
                    />
                  ) : (
                    <>
                      <IconSymbol
                        name="person.2.fill"
                        size={36}
                        color={colors.muted}
                      />
                      <Text
                        style={[
                          styles.emptyTitle,
                          { color: colors.foreground },
                        ]}
                      >
                        {!directory.signedIn
                          ? "Your team directory"
                          : directory.error
                            ? "Contacts unavailable"
                            : query.trim()
                              ? "No matching contacts"
                              : "No team contacts yet"}
                      </Text>
                      <Text
                        style={[styles.description, { color: colors.muted }]}
                      >
                        {!directory.signedIn
                          ? "Sign in to find people in your workspace."
                          : directory.error ||
                            (query.trim()
                              ? "Try another name or extension."
                              : "Other members of your workspace will appear here.")}
                      </Text>
                      {(!directory.signedIn || directory.error) && (
                        <Pressable
                          accessibilityRole="button"
                          style={[
                            styles.button,
                            { backgroundColor: colors.primary },
                          ]}
                          onPress={() =>
                            directory.signedIn
                              ? void directory.reload()
                              : router.push("/auth/sign-in")
                          }
                        >
                          <Text style={styles.buttonText}>
                            {directory.signedIn ? "Try again" : "Sign in"}
                          </Text>
                        </Pressable>
                      )}
                    </>
                  )}
                </View>
              }
            />
            {wide && (
              <View
                style={{
                  flex: 1.2,
                  borderLeftWidth: 0.5,
                  borderLeftColor: colors.border,
                }}
              >
                {directory.workspace &&
                directory.people.some((person) => person.id === selectedId) ? (
                  <ContactDetails
                    key={`${directory.owner}:${directory.workspace.id}:${selectedId}`}
                    id={String(selectedId)}
                    tenantId={String(directory.workspace.id)}
                    embedded
                  />
                ) : (
                  <View style={styles.empty}>
                    <IconSymbol
                      name="person.fill"
                      size={36}
                      color={colors.muted}
                    />
                    <Text style={[styles.description, { color: colors.muted }]}>
                      Select a contact to call or message.
                    </Text>
                  </View>
                )}
              </View>
            )}
          </View>
        </>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14, gap: 5 },
  title: { fontSize: 28, fontWeight: "700" },
  workspaceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  workspace: {
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 24,
  },
  search: {
    marginHorizontal: 20,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 48,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 0.5,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  initial: { fontSize: 21, fontWeight: "600" },
  name: { fontSize: 17, fontWeight: "600" },
  empty: {
    paddingHorizontal: 28,
    paddingVertical: 60,
    alignItems: "center",
    gap: 14,
  },
  emptyTitle: { fontSize: 20, fontWeight: "600", textAlign: "center" },
  description: { fontSize: 16, lineHeight: 24, textAlign: "center" },
  button: {
    minHeight: 48,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
  },
  buttonText: { color: "white", fontSize: 16, fontWeight: "600" },
});
