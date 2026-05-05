import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Linking } from "react-native";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";

interface StackItem {
  name: string;
  role: string;
  description: string;
  url: string;
  color: string;
  icon: string;
}

const STACK: StackItem[] = [
  {
    name: "FreeSWITCH",
    role: "PBX / Media Server",
    description: "Open-source telephony platform. Handles call routing, IVR, conferencing, voicemail, and PSTN gateway. Production-grade — powers millions of calls daily.",
    url: "https://freeswitch.org",
    color: "#0057FF",
    icon: "server.rack",
  },
  {
    name: "Kamailio",
    role: "SIP Proxy / Router",
    description: "High-performance SIP server. Handles SIP registration, load balancing, failover, and routing between clients and FreeSWITCH. Scales to millions of users.",
    url: "https://www.kamailio.org",
    color: "#8B5CF6",
    icon: "antenna.radiowaves.left.and.right",
  },
  {
    name: "liblinphone",
    role: "SIP Client SDK",
    description: "Open-source SIP/RTP library by Belledonne Communications. Powers the CloudPhone11 mobile client. Supports HD voice, video, messaging, SRTP, ZRTP, and push notifications.",
    url: "https://www.linphone.org",
    color: "#00C896",
    icon: "phone.fill",
  },
  {
    name: "Flexisip",
    role: "Push Gateway",
    description: "SIP push notification server. Ensures reliable incoming call delivery on iOS (APNs) and Android (FCM) even when the app is in background or killed.",
    url: "https://www.linphone.org/flexisip-sip-server",
    color: "#FF9500",
    icon: "bell.fill",
  },
  {
    name: "WebRTC",
    role: "Real-Time Media",
    description: "Google's open-source real-time communication framework. Provides SRTP/DTLS media encryption, ICE/STUN/TURN NAT traversal, and adaptive bitrate for HD audio/video.",
    url: "https://webrtc.org",
    color: "#06B6D4",
    icon: "waveform",
  },
  {
    name: "Asterisk",
    role: "Alternative PBX",
    description: "The world's most widely deployed open-source PBX. Alternative to FreeSWITCH — supports AGI, AMI, ARI APIs, and extensive module ecosystem.",
    url: "https://www.asterisk.org",
    color: "#F59E0B",
    icon: "externaldrive.fill",
  },
];

const PSTN_PROVIDERS = [
  { name: "Telnyx", description: "Carrier-grade SIP trunking, DID numbers, SMS, global coverage", color: "#0057FF" },
  { name: "Bandwidth", description: "Direct carrier network, US/Canada PSTN, E911 certified", color: "#8B5CF6" },
  { name: "Vonage APIs", description: "Global SIP trunking, programmable voice, number management", color: "#00C896" },
  { name: "Lingo Telecom", description: "Wholesale SIP trunking for operators, T38 fax support", color: "#FF9500" },
];

export default function AboutScreen() {
  const colors = useColors();

  return (
    <ScreenContainer>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <IconSymbol name="chevron.left" size={20} color={colors.primary} />
            <Text style={[styles.backText, { color: colors.primary }]}>Settings</Text>
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.foreground }]}>Architecture</Text>
          <View style={{ width: 80 }} />
        </View>

        {/* App Info */}
        <View style={[styles.appCard, { backgroundColor: colors.primary }]}>
          <Text style={styles.appName}>CloudPhone11</Text>
          <Text style={styles.appTagline}>Your number. Everywhere.</Text>
          <Text style={styles.appVersion}>Version 1.0.0 · Open Source · MIT License</Text>
        </View>

        {/* Architecture Overview */}
        <View style={[styles.overviewCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.overviewTitle, { color: colors.foreground }]}>System Architecture</Text>
          <Text style={[styles.overviewText, { color: colors.muted }]}>
            CloudPhone11 is built on a 100% open-source telecom stack. The mobile app uses the liblinphone SIP SDK to register with a Kamailio SIP proxy, which routes calls through FreeSWITCH for PSTN bridging, IVR, voicemail, and conferencing. Push notifications are delivered via Flexisip push gateway.
          </Text>
          <View style={[styles.archDiagram, { backgroundColor: colors.background, borderColor: colors.border }]}>
            {[
              "📱 CloudPhone11 App (liblinphone SDK)",
              "  ↕ SIP/TLS + SRTP",
              "🔀 Kamailio SIP Proxy (Registration, Routing)",
              "  ↕ SIP",
              "☎️ FreeSWITCH PBX (IVR, Voicemail, Conference)",
              "  ↕ SIP Trunk",
              "🌐 PSTN / Telecom Operator",
            ].map((line, i) => (
              <Text key={i} style={[styles.archLine, { color: line.startsWith("  ") ? colors.muted : colors.foreground }]}>
                {line}
              </Text>
            ))}
          </View>
        </View>

        {/* Open Source Stack */}
        <Text style={[styles.sectionHeader, { color: colors.muted }]}>OPEN SOURCE STACK</Text>
        {STACK.map((item) => (
          <TouchableOpacity
            key={item.name}
            style={[styles.stackCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              Linking.openURL(item.url);
            }}
            activeOpacity={0.8}
          >
            <View style={[styles.stackIcon, { backgroundColor: item.color + "20" }]}>
              <IconSymbol name={item.icon as any} size={20} color={item.color} />
            </View>
            <View style={styles.stackInfo}>
              <View style={styles.stackTitleRow}>
                <Text style={[styles.stackName, { color: colors.foreground }]}>{item.name}</Text>
                <View style={[styles.roleBadge, { backgroundColor: item.color + "20" }]}>
                  <Text style={[styles.roleText, { color: item.color }]}>{item.role}</Text>
                </View>
              </View>
              <Text style={[styles.stackDesc, { color: colors.muted }]}>{item.description}</Text>
              <Text style={[styles.stackUrl, { color: item.color }]}>{item.url.replace("https://", "")}</Text>
            </View>
          </TouchableOpacity>
        ))}

        {/* PSTN Providers */}
        <Text style={[styles.sectionHeader, { color: colors.muted }]}>PSTN SIP TRUNK PROVIDERS</Text>
        <View style={[styles.pstnCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.pstnDesc, { color: colors.muted }]}>
            Connect to any SIP trunk provider for PSTN calling. No Twilio required — use your own carrier agreement for operator-grade pricing and control.
          </Text>
          {PSTN_PROVIDERS.map((p) => (
            <View key={p.name} style={[styles.pstnRow, { borderBottomColor: colors.border }]}>
              <View style={[styles.pstnDot, { backgroundColor: p.color }]} />
              <View style={styles.pstnInfo}>
                <Text style={[styles.pstnName, { color: colors.foreground }]}>{p.name}</Text>
                <Text style={[styles.pstnDetail, { color: colors.muted }]}>{p.description}</Text>
              </View>
            </View>
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
  appCard: {
    margin: 16,
    padding: 20,
    borderRadius: 20,
    alignItems: "center",
    gap: 4,
  },
  appName: { fontSize: 24, fontWeight: "800", color: "#fff" },
  appTagline: { fontSize: 14, color: "#ffffff90", fontStyle: "italic" },
  appVersion: { fontSize: 12, color: "#ffffff70", marginTop: 4 },
  overviewCard: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
  },
  overviewTitle: { fontSize: 16, fontWeight: "700" },
  overviewText: { fontSize: 13, lineHeight: 20 },
  archDiagram: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
  },
  archLine: { fontSize: 13, fontFamily: "monospace" },
  sectionHeader: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
  },
  stackCard: {
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  stackIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  stackInfo: { flex: 1, gap: 4 },
  stackTitleRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  stackName: { fontSize: 16, fontWeight: "700" },
  roleBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  roleText: { fontSize: 11, fontWeight: "700" },
  stackDesc: { fontSize: 13, lineHeight: 18 },
  stackUrl: { fontSize: 12, fontWeight: "500" },
  pstnCard: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    gap: 0,
  },
  pstnDesc: { fontSize: 13, lineHeight: 18, marginBottom: 12 },
  pstnRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    gap: 12,
  },
  pstnDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  pstnInfo: { flex: 1 },
  pstnName: { fontSize: 14, fontWeight: "700" },
  pstnDetail: { fontSize: 12, marginTop: 2, lineHeight: 16 },
});
