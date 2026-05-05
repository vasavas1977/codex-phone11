/**
 * Server Configuration Screen — CloudPhone11
 * Allows the operator to enter connection details for:
 *   - Kamailio SIP Proxy
 *   - BillRun BSS
 *   - DID Provider
 *   - FreeSWITCH PBX
 */

import { useState, useEffect, useCallback } from "react";
import {
  Text,
  View,
  TextInput,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "cloudphone11_server_config";

interface ServerConfig {
  // Kamailio SIP
  sipDomain: string;
  sipPort: string;
  sipTransport: "UDP" | "TCP" | "TLS";
  // BillRun
  billrunUrl: string;
  billrunApiKey: string;
  billrunAccountId: string;
  // DID Provider
  didProviderType: "didww" | "didx" | "custom";
  didApiKey: string;
  didApiUrl: string;
  // FreeSWITCH
  freeswitchHost: string;
  freeswitchEslPort: string;
  freeswitchEslPassword: string;
  // Dinstar SBC
  dinstarIp: string;
  dinstarPort: string;
}

const DEFAULT_CONFIG: ServerConfig = {
  sipDomain: "",
  sipPort: "5060",
  sipTransport: "UDP",
  billrunUrl: "",
  billrunApiKey: "",
  billrunAccountId: "",
  didProviderType: "didww",
  didApiKey: "",
  didApiUrl: "",
  freeswitchHost: "",
  freeswitchEslPort: "8021",
  freeswitchEslPassword: "ClueCon",
  dinstarIp: "",
  dinstarPort: "5060",
};

export default function ServerConfigScreen() {
  const colors = useColors();
  const router = useRouter();
  const [config, setConfig] = useState<ServerConfig>(DEFAULT_CONFIG);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw) setConfig({ ...DEFAULT_CONFIG, ...JSON.parse(raw) });
    });
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(config));
      Alert.alert("Saved", "Server configuration saved successfully.");
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setSaving(false);
    }
  }, [config]);

  const testConnection = useCallback(async (service: string) => {
    setTesting(service);
    try {
      let url = "";
      if (service === "billrun") url = `${config.billrunUrl}/health`;
      else if (service === "freeswitch") url = `http://${config.freeswitchHost}:${config.freeswitchEslPort}`;
      else if (service === "did") {
        if (config.didProviderType === "didww") url = "https://api.didww.com/v3";
        else if (config.didProviderType === "didx") url = "https://www.didx.net/api/public/v1";
        else url = config.didApiUrl;
      }

      if (url) {
        const res = await fetch(url, {
          method: "GET",
          headers: { "X-API-Key": service === "billrun" ? config.billrunApiKey : config.didApiKey },
        });
        Alert.alert(
          res.ok ? "Connected" : "Connection Issue",
          res.ok
            ? `${service} is reachable (HTTP ${res.status})`
            : `${service} returned HTTP ${res.status}`
        );
      } else {
        Alert.alert("Missing URL", `Please enter the ${service} server URL first.`);
      }
    } catch (e: any) {
      Alert.alert("Connection Failed", `Cannot reach ${service}: ${e.message}`);
    } finally {
      setTesting(null);
    }
  }, [config]);

  const update = (key: keyof ServerConfig, value: string) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const transportOptions: Array<"UDP" | "TCP" | "TLS"> = ["UDP", "TCP", "TLS"];
  const didOptions: Array<"didww" | "didx" | "custom"> = ["didww", "didx", "custom"];

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderBottomWidth: 0.5,
          borderBottomColor: colors.border,
        }}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          style={{ padding: 4, marginRight: 12, opacity: 0.8 }}
        >
          <IconSymbol name="chevron.left.forwardslash.chevron.right" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground, flex: 1 }}>
          Server Configuration
        </Text>
        <TouchableOpacity
          onPress={save}
          disabled={saving}
          style={{
            backgroundColor: colors.primary,
            paddingHorizontal: 16,
            paddingVertical: 8,
            borderRadius: 8,
          }}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={{ color: "#fff", fontWeight: "600", fontSize: 14 }}>Save</Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
        {/* ─── Kamailio SIP Proxy ─────────────────────────────────────────── */}
        <SectionHeader title="Kamailio SIP Proxy" subtitle="SIP registration and call routing" colors={colors} />
        <InputField label="SIP Domain / IP" value={config.sipDomain} placeholder="sip.yourcompany.com" onChangeText={(v) => update("sipDomain", v)} colors={colors} />
        <InputField label="SIP Port" value={config.sipPort} placeholder="5060" keyboardType="numeric" onChangeText={(v) => update("sipPort", v)} colors={colors} />
        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted, marginTop: 12, marginBottom: 6 }}>Transport</Text>
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
          {transportOptions.map((t) => (
            <TouchableOpacity
              key={t}
              onPress={() => update("sipTransport", t)}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: 8,
                backgroundColor: config.sipTransport === t ? colors.primary : colors.surface,
                alignItems: "center",
                borderWidth: 1,
                borderColor: config.sipTransport === t ? colors.primary : colors.border,
              }}
            >
              <Text style={{ color: config.sipTransport === t ? "#fff" : colors.foreground, fontWeight: "600", fontSize: 14 }}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ─── Dinstar SBC ────────────────────────────────────────────────── */}
        <SectionHeader title="Dinstar SBC" subtitle="PSTN breakout gateway" colors={colors} />
        <InputField label="Dinstar IP" value={config.dinstarIp} placeholder="192.168.1.100" onChangeText={(v) => update("dinstarIp", v)} colors={colors} />
        <InputField label="Dinstar Port" value={config.dinstarPort} placeholder="5060" keyboardType="numeric" onChangeText={(v) => update("dinstarPort", v)} colors={colors} />

        {/* ─── BillRun BSS ────────────────────────────────────────────────── */}
        <SectionHeader title="BillRun BSS" subtitle="Billing, rating, and invoicing" colors={colors} />
        <InputField label="BillRun URL" value={config.billrunUrl} placeholder="https://billing.yourcompany.com" onChangeText={(v) => update("billrunUrl", v)} colors={colors} />
        <InputField label="API Key" value={config.billrunApiKey} placeholder="Your BillRun API key" secureTextEntry onChangeText={(v) => update("billrunApiKey", v)} colors={colors} />
        <InputField label="Account ID" value={config.billrunAccountId} placeholder="Numeric account ID" keyboardType="numeric" onChangeText={(v) => update("billrunAccountId", v)} colors={colors} />
        <TestButton label="Test BillRun" loading={testing === "billrun"} onPress={() => testConnection("billrun")} colors={colors} />

        {/* ─── FreeSWITCH PBX ─────────────────────────────────────────────── */}
        <SectionHeader title="FreeSWITCH PBX" subtitle="IVR, voicemail, conferencing" colors={colors} />
        <InputField label="FreeSWITCH Host" value={config.freeswitchHost} placeholder="127.0.0.1" onChangeText={(v) => update("freeswitchHost", v)} colors={colors} />
        <InputField label="ESL Port" value={config.freeswitchEslPort} placeholder="8021" keyboardType="numeric" onChangeText={(v) => update("freeswitchEslPort", v)} colors={colors} />
        <InputField label="ESL Password" value={config.freeswitchEslPassword} placeholder="ClueCon" secureTextEntry onChangeText={(v) => update("freeswitchEslPassword", v)} colors={colors} />
        <TestButton label="Test FreeSWITCH" loading={testing === "freeswitch"} onPress={() => testConnection("freeswitch")} colors={colors} />

        {/* ─── DID Provider ───────────────────────────────────────────────── */}
        <SectionHeader title="DID Provider" subtitle="Phone number provisioning" colors={colors} />
        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted, marginBottom: 6 }}>Provider</Text>
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
          {didOptions.map((d) => (
            <TouchableOpacity
              key={d}
              onPress={() => update("didProviderType", d)}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: 8,
                backgroundColor: config.didProviderType === d ? colors.primary : colors.surface,
                alignItems: "center",
                borderWidth: 1,
                borderColor: config.didProviderType === d ? colors.primary : colors.border,
              }}
            >
              <Text style={{ color: config.didProviderType === d ? "#fff" : colors.foreground, fontWeight: "600", fontSize: 13 }}>
                {d === "didww" ? "DIDww" : d === "didx" ? "DIDx" : "Custom"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <InputField label="DID API Key" value={config.didApiKey} placeholder="Your DID provider API key" secureTextEntry onChangeText={(v) => update("didApiKey", v)} colors={colors} />
        {config.didProviderType === "custom" && (
          <InputField label="Custom API URL" value={config.didApiUrl} placeholder="https://api.yournumbers.com" onChangeText={(v) => update("didApiUrl", v)} colors={colors} />
        )}
        <TestButton label="Test DID Provider" loading={testing === "did"} onPress={() => testConnection("did")} colors={colors} />
      </ScrollView>
    </ScreenContainer>
  );
}

// ─── Reusable Components ────────────────────────────────────────────────────

function SectionHeader({ title, subtitle, colors }: { title: string; subtitle: string; colors: any }) {
  return (
    <View style={{ marginTop: 20, marginBottom: 12 }}>
      <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>{title}</Text>
      <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{subtitle}</Text>
    </View>
  );
}

function InputField({
  label,
  value,
  placeholder,
  onChangeText,
  colors,
  secureTextEntry,
  keyboardType,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChangeText: (v: string) => void;
  colors: any;
  secureTextEntry?: boolean;
  keyboardType?: "default" | "numeric";
}) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted, marginBottom: 4 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted + "80"}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType ?? "default"}
        autoCapitalize="none"
        autoCorrect={false}
        style={{
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 10,
          paddingHorizontal: 14,
          paddingVertical: 12,
          fontSize: 15,
          color: colors.foreground,
        }}
      />
    </View>
  );
}

function TestButton({
  label,
  loading,
  onPress,
  colors,
}: {
  label: string;
  loading: boolean;
  onPress: () => void;
  colors: any;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={loading}
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 10,
        paddingVertical: 10,
        marginBottom: 8,
      }}
    >
      {loading ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : (
        <Text style={{ color: colors.primary, fontWeight: "600", fontSize: 14 }}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}
