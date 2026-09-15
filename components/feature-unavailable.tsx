import { Text, Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";

export function FeatureUnavailable({ title, description }: { title: string; description: string }) {
  const colors = useColors();
  return <ScreenContainer><View style={styles.container}>
    <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>{title}</Text>
    <Text style={[styles.description, { color: colors.muted }]}>{description}</Text>
    <Pressable accessibilityRole="button" onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)")} style={[styles.button, { backgroundColor: colors.primary }]}>
      <Text style={styles.label}>Back</Text>
    </Pressable>
  </View></ScreenContainer>;
}
const styles = StyleSheet.create({ container: { flex: 1, justifyContent: "center", padding: 28, gap: 20 }, title: { fontSize: 24, fontWeight: "700" }, description: { fontSize: 16, lineHeight: 25 }, button: { minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" }, label: { color: "white", fontWeight: "700", fontSize: 16 } });
