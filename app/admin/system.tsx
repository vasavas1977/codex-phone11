/**
 * System Management — Admin Portal
 * Server health, SIP trunk status, codec stats, and system configuration.
 */

import { useState, useCallback } from "react";
import {
  ScrollView, Text, View, TouchableOpacity, StyleSheet, RefreshControl, Alert,
} from "react-native";
import { router } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";

interface ServerNode {
  name: string;
  role: string;
  ip: string;
  status: "running" | "warning" | "stopped";
  cpu: number;
  memory: number;
  uptime: string;
  version: string;
}

interface SIPTrunk {
  name: string;
  provider: string;
  ip: string;
  channels: { used: number; total: number };
  status: "active" | "degraded" | "down";
  asr: string;
}

interface CodecStat {
  name: string;
  usage: number;
  quality: string;
  bandwidth: string;
}

export default function AdminSystem() {
  const colors = useColors();
  const [refreshing, setRefreshing] = useState(false);

  const servers: ServerNode[] = [
    { name: "kamailio-01", role: "SIP Proxy", ip: "10.0.1.10", status: "running", cpu: 23, memory: 41, uptime: "47d 12h", version: "5.8.1" },
    { name: "freeswitch-01", role: "Media / PBX", ip: "10.0.1.20", status: "running", cpu: 38, memory: 56, uptime: "47d 12h", version: "1.10.12" },
    { name: "freeswitch-02", role: "Media / PBX", ip: "10.0.1.21", status: "running", cpu: 31, memory: 48, uptime: "32d 8h", version: "1.10.12" },
    { name: "billrun-01", role: "BSS / Billing", ip: "10.0.2.10", status: "running", cpu: 15, memory: 62, uptime: "47d 12h", version: "5.14" },
    { name: "dinstar-sbc", role: "SBC", ip: "10.0.3.10", status: "running", cpu: 12, memory: 28, uptime: "89d 4h", version: "SBC8000 v3.2" },
    { name: "audiocodes-gw", role: "PSTN Gateway", ip: "10.0.3.20", status: "running", cpu: 8, memory: 22, uptime: "120d 16h", version: "Mediant 4000 v7.4" },
  ];

  const trunks: SIPTrunk[] = [
    { name: "Trunk-US-East", provider: "Tier-1 Carrier", ip: "203.0.113.10", channels: { used: 48, total: 200 }, status: "active", asr: "72%" },
    { name: "Trunk-US-West", provider: "Tier-1 Carrier", ip: "203.0.113.20", channels: { used: 32, total: 200 }, status: "active", asr: "69%" },
    { name: "Trunk-EU", provider: "European Carrier", ip: "198.51.100.10", channels: { used: 18, total: 100 }, status: "active", asr: "71%" },
    { name: "Trunk-APAC", provider: "Asia Pacific Carrier", ip: "198.51.100.20", channels: { used: 12, total: 100 }, status: "active", asr: "65%" },
    { name: "Zoom-Exchange", provider: "AudioCodes / Zoom", ip: "10.0.3.20", channels: { used: 48, total: 500 }, status: "active", asr: "74%" },
  ];

  const codecs: CodecStat[] = [
    { name: "Opus", usage: 45, quality: "Excellent", bandwidth: "6-510 kbps" },
    { name: "G.722", usage: 28, quality: "HD", bandwidth: "64 kbps" },
    { name: "G.711 (PCMU)", usage: 15, quality: "Good", bandwidth: "64 kbps" },
    { name: "G.711 (PCMA)", usage: 8, quality: "Good", bandwidth: "64 kbps" },
    { name: "G.729", usage: 4, quality: "Fair", bandwidth: "8 kbps" },
  ];

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await new Promise((r) => setTimeout(r, 1000));
    setRefreshing(false);
  }, []);

  const statusColor = (s: string) =>
    s === "running" || s === "active" ? "#00C896" : s === "warning" || s === "degraded" ? "#FF9500" : "#FF3B30";

  const cpuColor = (pct: number) =>
    pct < 50 ? "#00C896" : pct < 80 ? "#FF9500" : "#FF3B30";

  return (
    <ScreenContainer>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <IconSymbol name="chevron.left" size={22} color={colors.primary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.foreground }]}>System Health</Text>
            <Text style={[styles.subtitle, { color: colors.muted }]}>All systems operational</Text>
          </View>
          <View style={[styles.overallBadge, { backgroundColor: "#00C89620" }]}>
            <View style={[styles.overallDot, { backgroundColor: "#00C896" }]} />
            <Text style={[styles.overallText, { color: "#00C896" }]}>HEALTHY</Text>
          </View>
        </View>

        {/* Server Nodes */}
        <Text style={[styles.sectionTitle, { color: colors.muted }]}>SERVER NODES</Text>
        {servers.map((srv, i) => (
          <View key={i} style={[styles.serverCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.serverHeader}>
              <View style={[styles.statusDot, { backgroundColor: statusColor(srv.status) }]} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.serverName, { color: colors.foreground }]}>{srv.name}</Text>
                <Text style={[styles.serverRole, { color: colors.muted }]}>{srv.role} · {srv.ip} · v{srv.version}</Text>
              </View>
              <Text style={[styles.serverUptime, { color: colors.muted }]}>{srv.uptime}</Text>
            </View>
            <View style={styles.serverMetrics}>
              <View style={styles.metricRow}>
                <Text style={[styles.metricLabel, { color: colors.muted }]}>CPU</Text>
                <View style={styles.metricBarBg}>
                  <View style={[styles.metricBar, { width: `${srv.cpu}%`, backgroundColor: cpuColor(srv.cpu) }]} />
                </View>
                <Text style={[styles.metricPct, { color: cpuColor(srv.cpu) }]}>{srv.cpu}%</Text>
              </View>
              <View style={styles.metricRow}>
                <Text style={[styles.metricLabel, { color: colors.muted }]}>MEM</Text>
                <View style={styles.metricBarBg}>
                  <View style={[styles.metricBar, { width: `${srv.memory}%`, backgroundColor: cpuColor(srv.memory) }]} />
                </View>
                <Text style={[styles.metricPct, { color: cpuColor(srv.memory) }]}>{srv.memory}%</Text>
              </View>
            </View>
          </View>
        ))}

        {/* SIP Trunks */}
        <Text style={[styles.sectionTitle, { color: colors.muted }]}>SIP TRUNKS</Text>
        <View style={[styles.tableContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {trunks.map((trunk, i) => (
            <View key={i} style={[styles.trunkRow, i < trunks.length - 1 && { borderBottomWidth: 0.5, borderBottomColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <View style={styles.trunkNameRow}>
                  <View style={[styles.statusDot, { backgroundColor: statusColor(trunk.status) }]} />
                  <Text style={[styles.trunkName, { color: colors.foreground }]}>{trunk.name}</Text>
                </View>
                <Text style={[styles.trunkProvider, { color: colors.muted }]}>{trunk.provider} · {trunk.ip}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={[styles.trunkChannels, { color: colors.foreground }]}>
                  {trunk.channels.used}/{trunk.channels.total} ch
                </Text>
                <Text style={[styles.trunkAsr, { color: colors.muted }]}>ASR: {trunk.asr}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Codec Usage */}
        <Text style={[styles.sectionTitle, { color: colors.muted }]}>CODEC USAGE</Text>
        <View style={[styles.tableContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {codecs.map((codec, i) => (
            <View key={i} style={[styles.codecRow, i < codecs.length - 1 && { borderBottomWidth: 0.5, borderBottomColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.codecName, { color: colors.foreground }]}>{codec.name}</Text>
                <Text style={[styles.codecDetail, { color: colors.muted }]}>{codec.quality} · {codec.bandwidth}</Text>
              </View>
              <View style={styles.codecBarContainer}>
                <View style={styles.codecBarBg}>
                  <View style={[styles.codecBar, { width: `${codec.usage}%`, backgroundColor: colors.primary }]} />
                </View>
                <Text style={[styles.codecPct, { color: colors.foreground }]}>{codec.usage}%</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Quick Actions */}
        <Text style={[styles.sectionTitle, { color: colors.muted }]}>ACTIONS</Text>
        <View style={styles.actionsRow}>
          {[
            { label: "Restart Kamailio", color: "#FF9500", action: () => Alert.alert("Restart", "Restart Kamailio SIP Proxy?", [{ text: "Cancel" }, { text: "Restart", style: "destructive" }]) },
            { label: "Restart FreeSWITCH", color: "#FF9500", action: () => Alert.alert("Restart", "Restart FreeSWITCH PBX?", [{ text: "Cancel" }, { text: "Restart", style: "destructive" }]) },
            { label: "Export CDR", color: colors.primary, action: () => Alert.alert("Export", "CDR export started. You will receive an email when ready.") },
          ].map((a, i) => (
            <TouchableOpacity key={i} style={[styles.actionBtn, { borderColor: a.color + "40" }]} onPress={a.action}>
              <Text style={[styles.actionBtnText, { color: a.color }]}>{a.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5, gap: 12 },
  backBtn: { padding: 4 },
  title: { fontSize: 20, fontWeight: "700" },
  subtitle: { fontSize: 12, marginTop: 2 },
  overallBadge: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, gap: 6 },
  overallDot: { width: 8, height: 8, borderRadius: 4 },
  overallText: { fontSize: 11, fontWeight: "700" },
  sectionTitle: { fontSize: 12, fontWeight: "600", letterSpacing: 0.5, paddingHorizontal: 20, marginTop: 20, marginBottom: 8 },
  serverCard: { marginHorizontal: 16, marginBottom: 8, borderRadius: 14, borderWidth: 0.5, padding: 14 },
  serverHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  serverName: { fontSize: 14, fontWeight: "700", fontFamily: "monospace" },
  serverRole: { fontSize: 11, marginTop: 1 },
  serverUptime: { fontSize: 11 },
  serverMetrics: { marginTop: 10, gap: 6 },
  metricRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  metricLabel: { width: 30, fontSize: 10, fontWeight: "600" },
  metricBarBg: { flex: 1, height: 8, borderRadius: 4, backgroundColor: "rgba(128,128,128,0.15)" },
  metricBar: { height: 8, borderRadius: 4 },
  metricPct: { width: 32, fontSize: 11, fontWeight: "600", textAlign: "right" },
  tableContainer: { marginHorizontal: 16, borderRadius: 14, borderWidth: 0.5, overflow: "hidden" },
  trunkRow: { flexDirection: "row", alignItems: "center", padding: 14 },
  trunkNameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  trunkName: { fontSize: 14, fontWeight: "600" },
  trunkProvider: { fontSize: 11, marginTop: 2, marginLeft: 14 },
  trunkChannels: { fontSize: 13, fontWeight: "600" },
  trunkAsr: { fontSize: 11, marginTop: 1 },
  codecRow: { flexDirection: "row", alignItems: "center", padding: 14 },
  codecName: { fontSize: 14, fontWeight: "600" },
  codecDetail: { fontSize: 11, marginTop: 1 },
  codecBarContainer: { flexDirection: "row", alignItems: "center", width: 120, gap: 6 },
  codecBarBg: { flex: 1, height: 8, borderRadius: 4, backgroundColor: "rgba(128,128,128,0.15)" },
  codecBar: { height: 8, borderRadius: 4 },
  codecPct: { width: 30, fontSize: 12, fontWeight: "600", textAlign: "right" },
  actionsRow: { flexDirection: "row", paddingHorizontal: 16, gap: 8 },
  actionBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center", borderWidth: 1 },
  actionBtnText: { fontSize: 12, fontWeight: "600" },
});
