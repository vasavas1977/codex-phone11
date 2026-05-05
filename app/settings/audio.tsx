import { useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, Switch, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";

interface Codec {
  id: string;
  name: string;
  bitrate: string;
  quality: string;
  enabled: boolean;
}

export default function AudioSettingsScreen() {
  const colors = useColors();
  const [codecs, setCodecs] = useState<Codec[]>([
    { id: "opus", name: "Opus", bitrate: "6–510 kbps", quality: "Excellent", enabled: true },
    { id: "g722", name: "G.722", bitrate: "64 kbps", quality: "HD Voice", enabled: true },
    { id: "g711u", name: "G.711u (PCMU)", bitrate: "64 kbps", quality: "Standard", enabled: true },
    { id: "g711a", name: "G.711a (PCMA)", bitrate: "64 kbps", quality: "Standard", enabled: true },
    { id: "g729", name: "G.729", bitrate: "8 kbps", quality: "Low bandwidth", enabled: false },
    { id: "ilbc", name: "iLBC", bitrate: "13.3–15.2 kbps", quality: "Resilient", enabled: false },
  ]);
  const [echoCancellation, setEchoCancellation] = useState(true);
  const [noiseSuppression, setNoiseSuppression] = useState(true);
  const [agc, setAgc] = useState(true);
  const [comfortNoise, setComfortNoise] = useState(false);
  const [dtmfMode, setDtmfMode] = useState<"RFC2833" | "SIP INFO" | "Inband">("RFC2833");

  const toggleCodec = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCodecs((prev) => prev.map((c) => c.id === id ? { ...c, enabled: !c.enabled } : c));
  };

  const QUALITY_COLORS: Record<string, string> = {
    "Excellent": "#00C896",
    "HD Voice": "#0057FF",
    "Standard": "#FF9500",
    "Low bandwidth": "#6B7280",
    "Resilient": "#8B5CF6",
  };

  return (
    <ScreenContainer>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <IconSymbol name="chevron.left" size={20} color={colors.primary} />
            <Text style={[styles.backText, { color: colors.primary }]}>Settings</Text>
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.foreground }]}>Audio Settings</Text>
          <View style={{ width: 80 }} />
        </View>

        {/* Codec Priority */}
        <Text style={[styles.sectionHeader, { color: colors.muted }]}>CODEC PRIORITY</Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.cardDesc, { color: colors.muted }]}>
            Codecs are negotiated in priority order. Drag to reorder (tap to enable/disable).
          </Text>
          {codecs.map((codec, index) => (
            <View key={codec.id} style={[styles.codecRow, { borderBottomColor: colors.border }]}>
              <Text style={[styles.codecOrder, { color: colors.muted }]}>{index + 1}</Text>
              <View style={styles.codecInfo}>
                <Text style={[styles.codecName, { color: codec.enabled ? colors.foreground : colors.muted }]}>
                  {codec.name}
                </Text>
                <View style={styles.codecMeta}>
                  <Text style={[styles.codecBitrate, { color: colors.muted }]}>{codec.bitrate}</Text>
                  <View style={[styles.qualityBadge, { backgroundColor: (QUALITY_COLORS[codec.quality] || "#6B7280") + "20" }]}>
                    <Text style={[styles.qualityText, { color: QUALITY_COLORS[codec.quality] || "#6B7280" }]}>
                      {codec.quality}
                    </Text>
                  </View>
                </View>
              </View>
              <Switch
                value={codec.enabled}
                onValueChange={() => toggleCodec(codec.id)}
                trackColor={{ true: colors.primary }}
              />
            </View>
          ))}
        </View>

        {/* Processing */}
        <Text style={[styles.sectionHeader, { color: colors.muted }]}>AUDIO PROCESSING</Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {[
            { label: "Echo Cancellation (AEC)", sub: "Removes echo from speaker feedback", value: echoCancellation, set: setEchoCancellation },
            { label: "Noise Suppression (NS)", sub: "AI background noise reduction", value: noiseSuppression, set: setNoiseSuppression },
            { label: "Auto Gain Control (AGC)", sub: "Normalizes microphone volume", value: agc, set: setAgc },
            { label: "Comfort Noise (CN)", sub: "Adds background noise during silence", value: comfortNoise, set: setComfortNoise },
          ].map(({ label, sub, value, set }) => (
            <View key={label} style={[styles.toggleRow, { borderBottomColor: colors.border }]}>
              <View style={styles.toggleInfo}>
                <Text style={[styles.toggleLabel, { color: colors.foreground }]}>{label}</Text>
                <Text style={[styles.toggleSub, { color: colors.muted }]}>{sub}</Text>
              </View>
              <Switch
                value={value}
                onValueChange={(v) => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  set(v);
                }}
                trackColor={{ true: colors.primary }}
              />
            </View>
          ))}
        </View>

        {/* DTMF */}
        <Text style={[styles.sectionHeader, { color: colors.muted }]}>DTMF MODE</Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {(["RFC2833", "SIP INFO", "Inband"] as const).map((mode) => (
            <TouchableOpacity
              key={mode}
              style={[styles.dtmfRow, { borderBottomColor: colors.border }]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setDtmfMode(mode);
              }}
            >
              <View>
                <Text style={[styles.dtmfLabel, { color: colors.foreground }]}>{mode}</Text>
                <Text style={[styles.dtmfSub, { color: colors.muted }]}>
                  {mode === "RFC2833" ? "Recommended — out-of-band" : mode === "SIP INFO" ? "SIP signaling channel" : "In audio stream (legacy)"}
                </Text>
              </View>
              {dtmfMode === mode && (
                <IconSymbol name="checkmark.circle.fill" size={22} color={colors.primary} />
              )}
            </TouchableOpacity>
          ))}
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
  },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 4, width: 80 },
  backText: { fontSize: 16, fontWeight: "500" },
  title: { fontSize: 17, fontWeight: "700" },
  sectionHeader: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
  },
  card: {
    marginHorizontal: 16,
    marginBottom: 4,
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    padding: 16,
    gap: 0,
  },
  cardDesc: { fontSize: 13, lineHeight: 18, marginBottom: 12 },
  codecRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    gap: 12,
  },
  codecOrder: { fontSize: 13, fontWeight: "700", width: 20, textAlign: "center" },
  codecInfo: { flex: 1 },
  codecName: { fontSize: 15, fontWeight: "600" },
  codecMeta: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
  codecBitrate: { fontSize: 12 },
  qualityBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  qualityText: { fontSize: 11, fontWeight: "600" },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    gap: 12,
  },
  toggleInfo: { flex: 1 },
  toggleLabel: { fontSize: 15, fontWeight: "500" },
  toggleSub: { fontSize: 12, marginTop: 2 },
  dtmfRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomWidth: 0.5,
  },
  dtmfLabel: { fontSize: 15, fontWeight: "600" },
  dtmfSub: { fontSize: 12, marginTop: 2 },
});
