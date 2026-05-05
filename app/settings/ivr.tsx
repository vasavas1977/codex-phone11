import { useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";

interface IVRNode {
  id: string;
  type: "greeting" | "menu" | "extension" | "voicemail" | "queue" | "hangup";
  label: string;
  value?: string;
  children?: string[];
}

const DEFAULT_FLOW: IVRNode[] = [
  { id: "start", type: "greeting", label: "Welcome Greeting", value: "Welcome to CloudPhone11. Please listen to the following options.", children: ["menu1"] },
  { id: "menu1", type: "menu", label: "Main Menu", value: "Press 1 for Sales, Press 2 for Support, Press 0 for Operator", children: ["ext-sales", "ext-support", "ext-operator"] },
  { id: "ext-sales", type: "extension", label: "Sales (Ext. 1001)", value: "1001", children: [] },
  { id: "ext-support", type: "extension", label: "Support Queue", value: "queue-support", children: [] },
  { id: "ext-operator", type: "extension", label: "Operator (Ext. 0)", value: "0", children: [] },
];

const NODE_COLORS: Record<IVRNode["type"], string> = {
  greeting: "#0057FF",
  menu: "#8B5CF6",
  extension: "#00C896",
  voicemail: "#FF9500",
  queue: "#06B6D4",
  hangup: "#FF3B30",
};

const NODE_ICONS: Record<IVRNode["type"], string> = {
  greeting: "waveform",
  menu: "rectangle.grid.3x2.fill",
  extension: "phone.fill",
  voicemail: "voicemail",
  queue: "person.2.fill",
  hangup: "phone.down.fill",
};

export default function IVRBuilderScreen() {
  const colors = useColors();
  const [flow, setFlow] = useState<IVRNode[]>(DEFAULT_FLOW);
  const [selected, setSelected] = useState<string | null>(null);

  const NODE_TYPES: IVRNode["type"][] = ["greeting", "menu", "extension", "voicemail", "queue", "hangup"];

  const addNode = (type: IVRNode["type"]) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const newNode: IVRNode = {
      id: `node-${Date.now()}`,
      type,
      label: `New ${type.charAt(0).toUpperCase() + type.slice(1)}`,
      value: "",
      children: [],
    };
    setFlow((prev) => [...prev, newNode]);
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
          <Text style={[styles.title, { color: colors.foreground }]}>IVR Builder</Text>
          <TouchableOpacity
            style={[styles.saveBtn, { backgroundColor: colors.primary }]}
            onPress={() => {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }}
          >
            <Text style={styles.saveBtnText}>Save</Text>
          </TouchableOpacity>
        </View>

        {/* Info Banner */}
        <View style={[styles.infoBanner, { backgroundColor: colors.primary + "15", borderColor: colors.primary + "30" }]}>
          <IconSymbol name="info.circle" size={16} color={colors.primary} />
          <Text style={[styles.infoText, { color: colors.primary }]}>
            Visual IVR flow — exports FreeSWITCH/Asterisk dial plan config
          </Text>
        </View>

        {/* Flow Nodes */}
        <View style={styles.flowSection}>
          <Text style={[styles.sectionTitle, { color: colors.muted }]}>CALL FLOW</Text>
          {flow.map((node, index) => (
            <View key={node.id} style={styles.nodeWrapper}>
              {index > 0 && (
                <View style={[styles.connector, { backgroundColor: colors.border }]} />
              )}
              <TouchableOpacity
                style={[
                  styles.node,
                  { backgroundColor: colors.surface, borderColor: selected === node.id ? NODE_COLORS[node.type] : colors.border },
                  selected === node.id && { borderWidth: 2 }
                ]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setSelected(selected === node.id ? null : node.id);
                }}
                activeOpacity={0.8}
              >
                <View style={[styles.nodeIcon, { backgroundColor: NODE_COLORS[node.type] + "20" }]}>
                  <IconSymbol name={NODE_ICONS[node.type] as any} size={20} color={NODE_COLORS[node.type]} />
                </View>
                <View style={styles.nodeInfo}>
                  <View style={[styles.nodeTypeBadge, { backgroundColor: NODE_COLORS[node.type] + "20" }]}>
                    <Text style={[styles.nodeTypeText, { color: NODE_COLORS[node.type] }]}>
                      {node.type.toUpperCase()}
                    </Text>
                  </View>
                  <Text style={[styles.nodeLabel, { color: colors.foreground }]}>{node.label}</Text>
                  {node.value ? (
                    <Text style={[styles.nodeValue, { color: colors.muted }]} numberOfLines={2}>{node.value}</Text>
                  ) : null}
                </View>
                <IconSymbol name="chevron.right" size={16} color={colors.muted} />
              </TouchableOpacity>
            </View>
          ))}
        </View>

        {/* Add Node */}
        <View style={styles.addSection}>
          <Text style={[styles.sectionTitle, { color: colors.muted }]}>ADD NODE</Text>
          <View style={styles.nodeTypeGrid}>
            {NODE_TYPES.map((type) => (
              <TouchableOpacity
                key={type}
                style={[styles.addNodeBtn, { backgroundColor: NODE_COLORS[type] + "15", borderColor: NODE_COLORS[type] + "40" }]}
                onPress={() => addNode(type)}
              >
                <IconSymbol name={NODE_ICONS[type] as any} size={20} color={NODE_COLORS[type]} />
                <Text style={[styles.addNodeLabel, { color: NODE_COLORS[type] }]}>
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Export Info */}
        <View style={[styles.exportCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.exportHeader}>
            <IconSymbol name="doc.text.fill" size={18} color={colors.primary} />
            <Text style={[styles.exportTitle, { color: colors.foreground }]}>Export Dial Plan</Text>
          </View>
          <Text style={[styles.exportDesc, { color: colors.muted }]}>
            This IVR flow will be exported as a FreeSWITCH XML dial plan or Asterisk extensions.conf. Compatible with Kamailio SIP proxy routing.
          </Text>
          <TouchableOpacity
            style={[styles.exportBtn, { backgroundColor: colors.primary + "15", borderColor: colors.primary }]}
            onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)}
          >
            <IconSymbol name="externaldrive.fill" size={16} color={colors.primary} />
            <Text style={[styles.exportBtnText, { color: colors.primary }]}>Export Config</Text>
          </TouchableOpacity>
        </View>
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
  backBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  backText: { fontSize: 16, fontWeight: "500" },
  title: { fontSize: 17, fontWeight: "700" },
  saveBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  saveBtnText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  infoBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    margin: 16,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  infoText: { flex: 1, fontSize: 13, fontWeight: "500" },
  flowSection: { paddingHorizontal: 16, paddingBottom: 8 },
  sectionTitle: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8, marginBottom: 12, marginTop: 8 },
  nodeWrapper: { alignItems: "center" },
  connector: { width: 2, height: 20, marginVertical: 2 },
  node: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
  },
  nodeIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  nodeInfo: { flex: 1 },
  nodeTypeBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    marginBottom: 4,
  },
  nodeTypeText: { fontSize: 9, fontWeight: "800", letterSpacing: 1 },
  nodeLabel: { fontSize: 14, fontWeight: "600" },
  nodeValue: { fontSize: 12, marginTop: 2 },
  addSection: { paddingHorizontal: 16, paddingTop: 8 },
  nodeTypeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  addNodeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
  },
  addNodeLabel: { fontSize: 13, fontWeight: "600" },
  exportCard: {
    margin: 16,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
  },
  exportHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  exportTitle: { fontSize: 15, fontWeight: "600" },
  exportDesc: { fontSize: 13, lineHeight: 18 },
  exportBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  exportBtnText: { fontSize: 14, fontWeight: "600" },
});
