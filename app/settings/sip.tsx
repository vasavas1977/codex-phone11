import { useEffect, useState, type ReactNode } from "react";
import { Alert, Switch, View, Text, TouchableOpacity, ScrollView, TextInput, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { DEFAULT_ACCOUNT, useSipAccountStore, type RegistrationState } from "@/lib/sip/account-store";
import { sipEngine } from "@/lib/sip/engine";

type Transport = "UDP" | "TCP" | "TLS";

function registrationLabel(state: RegistrationState): string {
  switch (state) {
    case "registered":
      return "SIP Registered";
    case "registering":
      return "Registering";
    case "failed":
      return "Registration Failed";
    case "network_error":
      return "Network Error";
    default:
      return "Not Registered";
  }
}

export default function SIPAccountScreen() {
  const colors = useColors();
  const account = useSipAccountStore((s) => s.account);
  const loadAccount = useSipAccountStore((s) => s.loadAccount);
  const setAccount = useSipAccountStore((s) => s.setAccount);
  const registrationState = useSipAccountStore((s) => s.registrationState);
  const registrationError = useSipAccountStore((s) => s.registrationError);
  const [server, setServer] = useState("");
  const [port, setPort] = useState("5061");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [domain, setDomain] = useState("");
  const [transport, setTransport] = useState<Transport>("TLS");
  const [enabled, setEnabled] = useState(true);
  const [srtp, setSrtp] = useState(true);
  const [stun, setStun] = useState(DEFAULT_ACCOUNT.stun ?? "");
  const [showPassword, setShowPassword] = useState(false);

  const TRANSPORTS: Transport[] = ["UDP", "TCP", "TLS"];

  useEffect(() => {
    loadAccount().catch(console.error);
  }, [loadAccount]);

  useEffect(() => {
    if (!account) return;
    setServer(account.proxy || account.domain);
    setPort(String(account.port || (account.transport === "TLS" ? 5061 : 5060)));
    setUsername(account.username);
    setPassword(account.password);
    setDomain(account.domain);
    setTransport(account.transport);
    setEnabled(account.enabled);
    setSrtp(account.srtp);
    setStun(account.stun ?? "");
  }, [account]);

  const statusColor =
    registrationState === "registered"
      ? colors.success
      : registrationState === "registering"
      ? colors.warning
      : registrationState === "failed" || registrationState === "network_error"
      ? colors.error
      : colors.muted;

  const handleSave = async () => {
    const cleanUsername = username.trim();
    const cleanPassword = password.trim();
    const cleanDomain = domain.trim();
    const cleanServer = server.trim();
    const cleanPort = Number.parseInt(port, 10);

    if (!cleanUsername || !cleanPassword || !cleanDomain) {
      Alert.alert("Missing SIP details", "Enter username, password, and SIP domain before saving.");
      return;
    }

    if (!Number.isFinite(cleanPort) || cleanPort <= 0) {
      Alert.alert("Invalid port", "Enter a valid SIP port.");
      return;
    }

    await setAccount({
      id: account?.id ?? DEFAULT_ACCOUNT.id,
      displayName: account?.displayName || cleanUsername,
      username: cleanUsername,
      password: cleanPassword,
      domain: cleanDomain,
      proxy: cleanServer || undefined,
      port: cleanPort,
      transport,
      srtp,
      stun: stun.trim() || undefined,
      enabled,
    });

    await sipEngine.restart();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  };

  const InputField = ({
    label, value, onChangeText, placeholder, secureTextEntry, keyboardType, rightElement
  }: {
    label: string; value: string; onChangeText: (v: string) => void;
    placeholder?: string; secureTextEntry?: boolean; keyboardType?: any; rightElement?: ReactNode;
  }) => (
    <View style={styles.inputGroup}>
      <Text style={[styles.inputLabel, { color: colors.muted }]}>{label}</Text>
      <View style={[styles.inputWrapper, { backgroundColor: colors.background, borderColor: colors.border }]}> 
        <TextInput
          style={[styles.input, { color: colors.foreground }]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          secureTextEntry={secureTextEntry && !showPassword}
          keyboardType={keyboardType}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {rightElement}
      </View>
    </View>
  );

  return (
    <ScreenContainer>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}> 
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <IconSymbol name="chevron.left" size={20} color={colors.primary} />
            <Text style={[styles.backText, { color: colors.primary }]}>Settings</Text>
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.foreground }]}>SIP Account</Text>
          <TouchableOpacity
            style={[styles.saveBtn, { backgroundColor: colors.primary }]}
            onPress={handleSave}
          >
            <Text style={styles.saveBtnText}>Save</Text>
          </TouchableOpacity>
        </View>

        {/* Status Banner */}
        <View style={[styles.statusBanner, { backgroundColor: statusColor + "15", borderColor: statusColor + "40" }]}> 
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.statusText, { color: statusColor }]}> 
            {registrationLabel(registrationState)}
            {registrationError ? ` - ${registrationError}` : server ? ` - ${server}` : ""}
          </Text>
        </View>

        {/* Server Section */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}> 
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Server Configuration</Text>

          <InputField
            label="SIP Server / Proxy"
            value={server}
            onChangeText={setServer}
            placeholder="sip.yourserver.com"
            keyboardType="url"
          />
          <InputField
            label="SIP Domain"
            value={domain}
            onChangeText={setDomain}
            placeholder="yourserver.com"
            keyboardType="url"
          />
          <InputField
            label="Port"
            value={port}
            onChangeText={setPort}
            placeholder="5060"
            keyboardType="numeric"
          />

          {/* Transport */}
          <View style={styles.inputGroup}>
            <Text style={[styles.inputLabel, { color: colors.muted }]}>Transport Protocol</Text>
            <View style={styles.transportRow}>
              {TRANSPORTS.map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[
                    styles.transportBtn,
                    { borderColor: transport === t ? colors.primary : colors.border },
                    transport === t && { backgroundColor: colors.primary + "15" }
                  ]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setTransport(t);
                    setPort(t === "TLS" ? "5061" : "5060");
                  }}
                >
                  <Text style={[styles.transportText, { color: transport === t ? colors.primary : colors.muted }]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        {/* Credentials */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}> 
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Credentials</Text>

          <InputField
            label="Username / Extension"
            value={username}
            onChangeText={setUsername}
            placeholder="1001"
            keyboardType="default"
          />
          <InputField
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="SIP password"
            secureTextEntry
            rightElement={
              <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={{ padding: 8 }}>
                <IconSymbol name={showPassword ? "eye.slash" : "eye"} size={16} color={colors.muted} />
              </TouchableOpacity>
            }
          />
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}> 
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Calling</Text>
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={[styles.switchTitle, { color: colors.foreground }]}>Enable SIP account</Text>
              <Text style={[styles.switchSub, { color: colors.muted }]}>Register this device for inbound and outbound calls.</Text>
            </View>
            <Switch value={enabled} onValueChange={setEnabled} trackColor={{ true: colors.primary }} />
          </View>
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={[styles.switchTitle, { color: colors.foreground }]}>Secure media</Text>
              <Text style={[styles.switchSub, { color: colors.muted }]}>Use SRTP where supported by the SIP platform.</Text>
            </View>
            <Switch value={srtp} onValueChange={setSrtp} trackColor={{ true: colors.primary }} />
          </View>
          <InputField
            label="STUN Server"
            value={stun}
            onChangeText={setStun}
            placeholder="stun.l.google.com:19302"
            keyboardType="url"
          />
        </View>

        {/* Open Source Stack Info */}
        <View style={[styles.infoCard, { backgroundColor: colors.primary + "08", borderColor: colors.primary + "20" }]}> 
          <View style={styles.infoHeader}>
            <IconSymbol name="info.circle" size={16} color={colors.primary} />
            <Text style={[styles.infoTitle, { color: colors.primary }]}>Open Source Backend Stack</Text>
          </View>
          <Text style={[styles.infoBody, { color: colors.muted }]}> 
            Phone11 uses PJSIP in the native app for cloud phone calling, with Kamailio, RTPEngine, FreeSWITCH, and your SBCs on the network side.
          </Text>
          <TouchableOpacity
            style={[styles.docsBtn, { borderColor: colors.primary + "40" }]}
            onPress={() => router.push("/settings/about")}
          >
            <IconSymbol name="doc.text.fill" size={14} color={colors.primary} />
            <Text style={[styles.docsBtnText, { color: colors.primary }]}>View Architecture Docs</Text>
          </TouchableOpacity>
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
  saveBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  saveBtnText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  statusBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    margin: 16,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 13, fontWeight: "600", flex: 1 },
  card: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
  },
  cardTitle: { fontSize: 15, fontWeight: "700", marginBottom: 4 },
  inputGroup: { gap: 6 },
  inputLabel: { fontSize: 12, fontWeight: "600", letterSpacing: 0.3 },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
  },
  input: { flex: 1, fontSize: 15, paddingVertical: 12 },
  transportRow: { flexDirection: "row", gap: 8 },
  transportBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center",
  },
  transportText: { fontSize: 14, fontWeight: "700" },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    paddingVertical: 4,
  },
  switchText: { flex: 1, gap: 3 },
  switchTitle: { fontSize: 14, fontWeight: "700" },
  switchSub: { fontSize: 12, lineHeight: 17 },
  infoCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
  },
  infoHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  infoTitle: { fontSize: 14, fontWeight: "700" },
  infoBody: { fontSize: 13, lineHeight: 19 },
  docsBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  docsBtnText: { fontSize: 13, fontWeight: "600" },
});
