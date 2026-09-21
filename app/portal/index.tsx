import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";
import { PortalShell, PortalState } from "@/components/portal/portal-shell";
import { SIGN_IN_ROUTE } from "@/constants/oauth";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { usePbxSelfService } from "@/hooks/use-pbx-admin";

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
  status?: string | null;
  is_primary?: boolean;
  phone_numbers?: PhoneNumber[] | null;
};

const labelForExtension = (extension: Extension) =>
  extension.display_name?.trim() ||
  extension.extension_number ||
  `Extension ${extension.id}`;

export default function PortalDashboard() {
  const colors = useColors();
  const { user } = useAuth({ autoFetch: false });
  const overviewQuery = usePbxSelfService(Boolean(user));
  const extensions = (overviewQuery.data || []) as Extension[];
  const assignedNumbers = extensions.reduce(
    (count, extension) => count + (extension.phone_numbers?.length || 0),
    0,
  );

  return (
    <PortalShell title="My phone" active="home">
      {!user ? (
        <PortalState
          title="Sign in to view your phone"
          detail="Your assigned extensions and call activity are available after you sign in."
          actionLabel="Sign in"
          onAction={() => router.replace(SIGN_IN_ROUTE)}
        />
      ) : overviewQuery.isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
          <Text style={{ color: colors.muted }}>
            Loading your Phone11 details…
          </Text>
        </View>
      ) : overviewQuery.isError ? (
        <PortalState
          title="Your phone details could not be loaded"
          detail="Phone11 could not read the extensions assigned to your current workspace."
          actionLabel="Try again"
          onAction={() => void overviewQuery.refetch()}
        />
      ) : extensions.length === 0 ? (
        <PortalState
          title="No phone extension assigned"
          detail="Your account is signed in, but it does not currently have an active Phone11 extension in this workspace."
        />
      ) : (
        <>
          <View
            style={[
              styles.summary,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.summaryTitle, { color: colors.foreground }]}>
                Your Phone11 account
              </Text>
              <Text style={[styles.summaryDetail, { color: colors.muted }]}>
                Extensions and assigned phone numbers from your current
                workspace.
              </Text>
            </View>
            <View
              style={[styles.count, { backgroundColor: colors.primary + "15" }]}
            >
              <Text style={[styles.countValue, { color: colors.primary }]}>
                {extensions.length}
              </Text>
              <Text style={[styles.countLabel, { color: colors.muted }]}>
                extensions
              </Text>
            </View>
          </View>

          <Text style={[styles.sectionTitle, { color: colors.muted }]}>
            ASSIGNED EXTENSIONS
          </Text>
          {extensions.map((extension) => (
            <View
              key={extension.id}
              style={[
                styles.extension,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <View
                style={[
                  styles.extensionIcon,
                  { backgroundColor: colors.primary + "15" },
                ]}
              >
                <IconSymbol
                  name="phone.fill"
                  size={20}
                  color={colors.primary}
                />
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <View style={styles.extensionHeading}>
                  <Text
                    style={[styles.extensionName, { color: colors.foreground }]}
                  >
                    {labelForExtension(extension)}
                  </Text>
                  {extension.is_primary && (
                    <Text style={[styles.primary, { color: colors.primary }]}>
                      PRIMARY
                    </Text>
                  )}
                </View>
                <Text style={[styles.extensionNumber, { color: colors.muted }]}>
                  Extension {extension.extension_number || "unavailable"} ·{" "}
                  {extension.status || "status unavailable"}
                </Text>
                {(extension.phone_numbers || []).map((number) => (
                  <Text
                    key={number.id}
                    style={[styles.phoneNumber, { color: colors.foreground }]}
                  >
                    {number.number_display ||
                      number.number_e164 ||
                      "Phone number unavailable"}
                  </Text>
                ))}
              </View>
            </View>
          ))}

          <Text style={[styles.sectionTitle, { color: colors.muted }]}>
            SELF-SERVICE
          </Text>
          <PortalAction
            icon="number"
            title="My numbers"
            detail={`${assignedNumbers} assigned phone number${assignedNumbers === 1 ? "" : "s"}`}
            onPress={() => router.push("/portal/dids")}
          />
          <PortalAction
            icon="chart.bar.fill"
            title="Call activity"
            detail="Your call records from the last 7 or 30 days"
            onPress={() => router.push("/portal/usage")}
          />
          <PortalAction
            icon="recordingtape"
            title="Voicemail"
            detail="Messages assigned to your extensions"
            onPress={() => router.push("/voicemail")}
          />
          <PortalAction
            icon="person.fill"
            title="My profile"
            detail="Manage the profile linked to this Phone11 account"
            onPress={() => router.push("/profile")}
          />
          <Text style={[styles.note, { color: colors.muted }]}>
            Call activity can appear after call processing. Billing, payment
            methods, and support tickets are not managed in Phone11.
          </Text>
        </>
      )}
    </PortalShell>
  );
}

function PortalAction({
  icon,
  title,
  detail,
  onPress,
}: {
  icon: string;
  title: string;
  detail: string;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={[
        styles.action,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <View
        style={[styles.actionIcon, { backgroundColor: colors.primary + "15" }]}
      >
        <IconSymbol name={icon as any} size={19} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.actionTitle, { color: colors.foreground }]}>
          {title}
        </Text>
        <Text style={[styles.actionDetail, { color: colors.muted }]}>
          {detail}
        </Text>
      </View>
      <IconSymbol name="chevron.right" size={16} color={colors.muted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  loading: {
    minHeight: 180,
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
  },
  summary: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
    gap: 12,
  },
  summaryTitle: { fontSize: 18, fontWeight: "700" },
  summaryDetail: { fontSize: 13, lineHeight: 19, marginTop: 4 },
  count: {
    minWidth: 68,
    paddingVertical: 8,
    paddingHorizontal: 7,
    alignItems: "center",
    borderRadius: 12,
  },
  countValue: { fontSize: 22, fontWeight: "800" },
  countLabel: { fontSize: 10, fontWeight: "600" },
  sectionTitle: {
    fontSize: 12,
    letterSpacing: 0.5,
    fontWeight: "700",
    marginTop: 14,
  },
  extension: {
    flexDirection: "row",
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  extensionIcon: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
  },
  extensionHeading: { flexDirection: "row", alignItems: "center", gap: 8 },
  extensionName: { fontSize: 15, fontWeight: "700", flexShrink: 1 },
  primary: { fontSize: 10, letterSpacing: 0.4, fontWeight: "800" },
  extensionNumber: { fontSize: 12 },
  phoneNumber: { fontSize: 13, fontWeight: "600", marginTop: 3 },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    padding: 13,
  },
  actionIcon: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 11,
  },
  actionTitle: { fontSize: 15, fontWeight: "700" },
  actionDetail: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  note: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    marginTop: 8,
    paddingHorizontal: 8,
  },
});
