import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";

/**
 * Intentionally provider-inert until the shared Super Number calendar adapter
 * is authenticated and available. Do not add local calendar persistence here.
 */
export default function CalendarTodayScreen() {
  const colors = useColors();
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/settings");
  };

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 18 }}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Back to settings"
          onPress={goBack}
          style={{ alignSelf: "flex-start", minHeight: 44, justifyContent: "center" }}
        >
          <Text style={{ color: colors.primary, fontSize: 16, fontWeight: "600" }}>‹ Settings</Text>
        </TouchableOpacity>

        <View style={{ gap: 6 }}>
          <Text accessibilityRole="header" style={{ color: colors.foreground, fontSize: 28, fontWeight: "700" }}>
            Today
          </Text>
          <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 22 }}>
            Calendar sync from Super Number is not available in Phone11 yet.
          </Text>
        </View>

        <View accessibilityLabel="Calendar sync unavailable" style={{ paddingVertical: 28, gap: 8 }}>
          <Text style={{ color: colors.foreground, fontSize: 17, fontWeight: "600" }}>
            Calendar sync unavailable
          </Text>
          <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 20 }}>
            Your shared calendar is not connected in Phone11 yet. Scheduled calls, callbacks and meetings cannot be loaded until calendar sync is available.
          </Text>
        </View>

        <View
          style={{
            padding: 16,
            borderRadius: 14,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
            gap: 6,
          }}
        >
          <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "600" }}>
            Kept private by default
          </Text>
          <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 20 }}>
            Personal notes and recording follow-ups stay with the call unless you explicitly share them.
          </Text>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
