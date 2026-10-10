import { Text, ScrollView, View, TouchableOpacity } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { LiveRecordingPanel } from "@/components/cloud-recordings/live-recording-panel";
import { useColors } from "@/hooks/use-colors";
export default function CloudRecordingDetailScreen() {
  const params = useLocalSearchParams<{ callUuid: string; tab?: string }>();
  const callUuid = typeof params.callUuid === "string" ? params.callUuid : "";
  const colors = useColors();
  const router = useRouter();
  return (
    <ScreenContainer>
      <ScrollView>
        <View
          style={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 24 }}
        >
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Back to call history"
            style={{ minHeight: 48, justifyContent: "center" }}
            onPress={() =>
              router.canGoBack()
                ? router.back()
                : router.replace("/(tabs)/recents")
            }
          >
            <Text style={{ color: colors.primary, fontSize: 15 }}>‹ Back</Text>
          </TouchableOpacity>
          <Text
            style={{
              fontSize: 26,
              fontWeight: "600",
              color: colors.foreground,
            }}
          >
            Call summary
          </Text>
        </View>
        <LiveRecordingPanel
          key={`${callUuid}:${params.tab}`}
          callUuid={callUuid}
          initialTab={
            params.tab === "transcription" ? "transcription" : "summary"
          }
          full
        />
      </ScrollView>
    </ScreenContainer>
  );
}
