import type { ReactNode } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { router } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";

type PortalSection =
  | "home"
  | "profile"
  | "numbers"
  | "activity"
  | "voicemail"
  | "billing"
  | "forwarding"
  | "support";

const portalNavigation: Array<{
  id: PortalSection;
  label: string;
  route: string;
}> = [
  { id: "home", label: "My phone", route: "/portal" },
  { id: "profile", label: "My profile", route: "/profile" },
  { id: "numbers", label: "My numbers", route: "/portal/dids" },
  { id: "activity", label: "Call activity", route: "/portal/usage" },
  { id: "voicemail", label: "Voicemail", route: "/voicemail" },
];

export function PortalShell({
  title,
  active,
  children,
}: {
  title: string;
  active?: PortalSection;
  children: ReactNode;
}) {
  const colors = useColors();
  const { width } = useWindowDimensions();
  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Back to settings"
          onPress={() =>
            router.canGoBack()
              ? router.back()
              : router.replace("/(tabs)/settings")
          }
          style={styles.back}
        >
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: colors.foreground }]}
        >
          {title}
        </Text>
        <View style={styles.back} />
      </View>
      <View
        style={[
          styles.navigation,
          { borderBottomColor: colors.border, backgroundColor: colors.surface },
        ]}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.navigationContent}
          accessibilityRole="tablist"
        >
          {portalNavigation.map((item) => {
            const selected = item.id === active;
            return (
              <TouchableOpacity
                key={item.id}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={item.label}
                disabled={selected}
                onPress={() => router.push(item.route as any)}
                style={[
                  styles.navigationItem,
                  selected && { borderBottomColor: colors.primary },
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.navigationLabel,
                    { color: selected ? colors.primary : colors.muted },
                  ]}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
      <ScrollView
        contentContainerStyle={[styles.content, width >= 900 && styles.wide]}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </ScreenContainer>
  );
}

export function PortalState({
  title,
  detail,
  actionLabel,
  onAction,
}: {
  title: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.state,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <IconSymbol name="info.circle.fill" size={28} color={colors.primary} />
      <Text style={[styles.stateTitle, { color: colors.foreground }]}>
        {title}
      </Text>
      <Text style={[styles.stateDetail, { color: colors.muted }]}>
        {detail}
      </Text>
      {actionLabel && onAction && (
        <TouchableOpacity
          accessibilityRole="button"
          onPress={onAction}
          style={[styles.action, { borderColor: colors.primary }]}
        >
          <Text style={{ color: colors.primary, fontWeight: "700" }}>
            {actionLabel}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: {
    width: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 18, fontWeight: "700" },
  content: { width: "100%", padding: 16, paddingBottom: 40, gap: 12 },
  wide: { maxWidth: 920, alignSelf: "center", paddingHorizontal: 28 },
  navigation: { borderBottomWidth: StyleSheet.hairlineWidth },
  navigationContent: { paddingHorizontal: 8 },
  navigationItem: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
    paddingHorizontal: 12,
  },
  navigationLabel: { fontSize: 12, fontWeight: "600" },
  state: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    gap: 10,
    marginTop: 20,
  },
  stateTitle: { fontSize: 17, fontWeight: "700", textAlign: "center" },
  stateDetail: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    maxWidth: 560,
  },
  action: {
    minHeight: 44,
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 18,
    marginTop: 4,
  },
});
