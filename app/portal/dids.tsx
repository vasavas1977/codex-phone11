import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { PortalShell, PortalState } from "@/components/portal/portal-shell";
import { portalSignInRoute } from "@/constants/oauth";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/use-colors";
import { usePbxCapabilities, usePbxSelfService } from "@/hooks/use-pbx-admin";

type PhoneNumber = {
  id: number;
  number_e164?: string | null;
  number_display?: string | null;
  status?: string | null;
};
type Extension = {
  id: number;
  extension_number?: string | null;
  display_name?: string | null;
  phone_numbers_available?: boolean;
  phone_numbers?: PhoneNumber[] | null;
};

export default function PortalDidsScreen() {
  const colors = useColors();
  const { user } = useAuth({ autoFetch: false });
  const capabilitiesQuery = usePbxCapabilities(Boolean(user));
  const overviewQuery = usePbxSelfService(Boolean(user));
  const extensions = (overviewQuery.data || []) as Extension[];
  const phoneNumbersAvailable =
    capabilitiesQuery.data?.phoneNumbers === true &&
    extensions.every((extension) => extension.phone_numbers_available !== false);
  const numbers = extensions.flatMap(
    (extension) =>
      (extension.phone_numbers || []).map((number) => ({
        ...number,
        extension,
      })),
  );

  return (
    <PortalShell title="My numbers" active="numbers">
      {!user ? (
        <PortalState
          title="Sign in to view your numbers"
          detail="Assigned Phone11 numbers are available after you sign in."
          actionLabel="Sign in"
          onAction={() => router.replace(portalSignInRoute("/portal/dids"))}
        />
      ) : overviewQuery.isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
          <Text style={{ color: colors.muted }}>
            Loading your assigned numbers…
          </Text>
        </View>
      ) : overviewQuery.isError ? (
        <PortalState
          title="Your numbers could not be loaded"
          detail="Phone11 could not read the numbers assigned to your extensions."
          actionLabel="Try again"
          onAction={() => void overviewQuery.refetch()}
        />
      ) : capabilitiesQuery.isLoading ? (
        <PortalState
          title="Checking number availability"
          detail="Phone11 is confirming whether direct-number inventory is available for this workspace."
        />
      ) : !phoneNumbersAvailable ? (
        <PortalState
          title="Phone numbers are unavailable"
          detail="Direct-number inventory is not available for this workspace yet, so Phone11 cannot show assigned numbers."
        />
      ) : numbers.length === 0 ? (
        <PortalState
          title="No phone numbers assigned"
          detail="Your extensions do not currently have a direct number assigned in this workspace."
        />
      ) : (
        <>
          <Text style={[styles.intro, { color: colors.muted }]}>
            These are the direct numbers assigned to your Phone11 extensions.
            Acquiring, releasing, renaming, and changing routes require a
            workspace administrator.
          </Text>
          {numbers.map(({ extension, ...number }) => (
            <View
              key={number.id}
              style={[
                styles.card,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <View
                style={[
                  styles.icon,
                  { backgroundColor: colors.primary + "15" },
                ]}
              >
                <IconSymbol name="number" size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={[styles.number, { color: colors.foreground }]}>
                  {number.number_display ||
                    number.number_e164 ||
                    "Phone number unavailable"}
                </Text>
                <Text style={[styles.detail, { color: colors.muted }]}>
                  Assigned to{" "}
                  {extension.display_name?.trim() ||
                    `extension ${extension.extension_number || extension.id}`}
                </Text>
                <Text style={[styles.status, { color: colors.muted }]}>
                  Inventory status: {number.status || "unavailable"}
                </Text>
              </View>
            </View>
          ))}
        </>
      )}
    </PortalShell>
  );
}

const styles = StyleSheet.create({
  loading: {
    minHeight: 180,
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
  },
  intro: { fontSize: 13, lineHeight: 20, marginBottom: 4 },
  card: {
    flexDirection: "row",
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  icon: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
  },
  number: { fontSize: 16, fontWeight: "700" },
  detail: { fontSize: 13, lineHeight: 18 },
  status: { fontSize: 12 },
});
