import { useRef, useState } from "react";
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  requireNativeComponent,
  type ViewProps,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FeatureUnavailable } from "@/components/feature-unavailable";
import { useVideoCapability } from "@/hooks/use-video-capability";
import { usePhoneCall } from "@/hooks/use-phone-call";
import { useSip } from "@/lib/sip/sip-provider";
import { siprixEngine } from "@/lib/sip/siprix-engine";
import { useSipCallStore } from "@/lib/sip/call-store";
import { resolveCurrentCall } from "@/lib/sip/current-call";

let NativeVideo: ReturnType<
  typeof requireNativeComponent<ViewProps & { callId: string; local: boolean }>
> | null = null;
function VideoSurface({ callId, local }: { callId: string; local: boolean }) {
  NativeVideo ??= requireNativeComponent<
    ViewProps & { callId: string; local: boolean }
  >("Phone11VideoView");
  return (
    <NativeVideo
      callId={callId}
      local={local}
      style={StyleSheet.absoluteFill}
    />
  );
}
export default function VideoCallScreen() {
  const params = useLocalSearchParams<{ callId?: string; number?: string }>();
  const available = useVideoCapability();
  const insets = useSafeAreaInsets();
  const call = useSipCallStore((state) =>
    resolveCurrentCall(state, params.callId),
  );
  const [number, setNumber] = useState(params.number ?? "");
  const { placeCall, calling } = usePhoneCall();
  const { setMute, setSpeaker, hangupCall } = useSip();
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await action();
    } catch {
      Alert.alert(
        "Could not update video call",
        "Check camera permission in Settings and your connection, then try again.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  if (!available)
    return (
      <FeatureUnavailable
        title="Video calling is unavailable"
        description="Video requires a compatible Phone11 build and a video-capable SIP destination. Voice calling remains available."
      />
    );
  const connected = call?.status === "active" && !call.isHeld;
  const control = (
    label: string,
    action: () => Promise<void>,
    enabled = !!connected,
    danger = false,
  ) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: busy || !enabled }}
      disabled={busy || !enabled}
      onPress={() => run(action)}
      style={[
        styles.button,
        danger && styles.end,
        (busy || !enabled) && styles.disabled,
      ]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: Math.max(insets.top, 12),
          paddingBottom: Math.max(insets.bottom, 12),
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        onPress={() => router.replace("/(tabs)/recents")}
        style={styles.back}
      >
        <Text style={styles.body}>
          ‹ Recents{call ? " · Call continues" : ""}
        </Text>
      </Pressable>
      <Text accessibilityRole="header" style={styles.title}>
        {call?.remoteName ?? call?.remoteNumber ?? "Video call"}
      </Text>
      {call ? (
        <>
          <Text style={styles.status}>
            {call.isHeld
              ? "On hold"
              : connected
                ? call.isVideo
                  ? "Video call"
                  : "Connected with audio only"
                : "Calling…"}
          </Text>
          <View style={styles.stage}>
            {connected && call.isVideo ? (
              <VideoSurface
                key={`remote-${call.id}`}
                callId={call.id}
                local={false}
              />
            ) : (
              <Text style={styles.body}>
                {connected
                  ? "The other person connected without video."
                  : "Waiting for the call to connect"}
              </Text>
            )}
            {connected && call.isVideo && (
              <View style={styles.local}>
                {call.cameraMuted ? (
                  <Text style={styles.body}>Camera off</Text>
                ) : (
                  <VideoSurface
                    key={`local-${call.id}`}
                    callId={call.id}
                    local
                  />
                )}
              </View>
            )}
          </View>
          <View style={styles.controls}>
            {control(call.isMuted ? "Unmute" : "Mute", () =>
              setMute(call.id, !call.isMuted),
            )}
            {control(call.isSpeaker ? "Earpiece" : "Speaker", () =>
              setSpeaker(call.id, !call.isSpeaker),
            )}
            {call.isVideo &&
              control(call.cameraMuted ? "Camera on" : "Camera off", () =>
                siprixEngine.setCameraMuted(call.id, !call.cameraMuted),
              )}
            {call.isVideo &&
              control(
                "Switch camera",
                () => siprixEngine.switchCamera(call.id),
                !!connected && !call.cameraMuted,
              )}
            {control("End call", () => hangupCall(call.id), true, true)}
          </View>
        </>
      ) : params.callId ? (
        <View style={styles.empty}>
          <Text style={styles.body}>Call ended</Text>
        </View>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.body}>
            Call an extension or SIP number that supports video.
          </Text>
          <TextInput
            accessibilityLabel="Video call number or extension"
            value={number}
            onChangeText={setNumber}
            keyboardType="phone-pad"
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Number or extension"
            placeholderTextColor="#AAB2C0"
            style={styles.input}
          />
          <Pressable
            accessibilityRole="button"
            disabled={calling || !number.trim()}
            onPress={() => placeCall(number, true)}
            style={[
              styles.button,
              (calling || !number.trim()) && styles.disabled,
            ]}
          >
            <Text style={styles.buttonText}>
              {calling ? "Starting…" : "Start video call"}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0D0F14", paddingHorizontal: 18, gap: 12 },
  back: { paddingVertical: 12 },
  title: {
    color: "white",
    fontSize: 26,
    fontWeight: "600",
    textAlign: "center",
  },
  status: { color: "#AFBDCF", textAlign: "center" },
  stage: {
    flex: 1,
    minHeight: 220,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "#19202A",
    justifyContent: "center",
    alignItems: "center",
  },
  local: {
    position: "absolute",
    right: 12,
    bottom: 12,
    width: 108,
    height: 150,
    backgroundColor: "#283344",
    borderRadius: 12,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },
  controls: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 12,
  },
  button: {
    minHeight: 50,
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderRadius: 16,
    backgroundColor: "#293D58",
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { color: "white", fontSize: 16, fontWeight: "600" },
  end: { backgroundColor: "#C92F41" },
  disabled: { opacity: 0.4 },
  body: { color: "#E1E7EF", fontSize: 16, lineHeight: 24, textAlign: "center" },
  empty: { flex: 1, justifyContent: "center", gap: 22 },
  input: {
    borderWidth: 1,
    borderColor: "#63748A",
    padding: 16,
    borderRadius: 14,
    fontSize: 20,
    color: "white",
  },
});
