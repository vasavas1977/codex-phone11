import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { createChatTransport } from "@/lib/chat/transport";
import { useColors } from "@/hooks/use-colors";
import { getAuthSnapshot } from "@/lib/_core/auth";
const api = createChatTransport();
export type ChatAssistantMode =
  | "summary"
  | "translation"
  | "compose"
  | "refine";
export function ChatAssistantSheet({
  mode,
  tenantId,
  roomId,
  messageId,
  draft,
  onClose,
  onDraft,
}: {
  mode: ChatAssistantMode;
  tenantId: number;
  roomId: string;
  messageId?: string;
  draft: string;
  onClose: () => void;
  onDraft: (text: string) => void;
}) {
  const c = useColors(),
    [instruction, setInstruction] = useState(""),
    [language, setLanguage] = useState("English"),
    [result, setResult] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const generation = useRef(0),
    owner = useRef(getAuthSnapshot().user),
    request = useRef(false);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const run = async () => {
    if (request.current || getAuthSnapshot().user !== owner.current) return;
    request.current = true;
    const token = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const response =
        mode === "summary"
          ? await api.summarizeThread(tenantId, roomId, messageId!)
          : mode === "translation"
            ? await api.translateMessage(tenantId, roomId, messageId!, language)
            : mode === "refine"
              ? await api.refineDraft(
                  tenantId,
                  roomId,
                  draft,
                  instruction ||
                    "Make this clearer and concise, preserving its language and meaning.",
                )
              : await api.composeDraft(tenantId, roomId, instruction);
      if (
        token === generation.current &&
        getAuthSnapshot().user === owner.current
      )
        setResult(response.text);
    } catch {
      if (token === generation.current)
        setError(
          "AI is unavailable right now. Your conversation and draft are unchanged. Try again.",
        );
    } finally {
      if (token === generation.current) {
        setBusy(false);
        request.current = false;
      }
    }
  };
  const title =
    mode === "summary"
      ? "Thread summary"
      : mode === "translation"
        ? "Translate message"
        : mode === "refine"
          ? "Improve draft"
          : "Write a draft";
  const canInsert =
    (mode === "compose" || mode === "refine") && result.length <= 4000;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{
          flex: 1,
          justifyContent: "flex-end",
          backgroundColor: "#0008",
        }}
      >
        <View
          accessibilityViewIsModal
          style={{
            maxHeight: "85%",
            backgroundColor: c.background,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            padding: 20,
            gap: 14,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text
              style={{
                color: c.foreground,
                fontSize: 20,
                fontWeight: "700",
                flex: 1,
              }}
            >
              {title}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close AI"
              onPress={onClose}
              style={{ minHeight: 44, minWidth: 44, justifyContent: "center" }}
            >
              <Text style={{ color: c.primary }}>Close</Text>
            </Pressable>
          </View>
          <Text style={{ color: c.muted, fontSize: 12 }}>
            AI-generated · Review before using
          </Text>
          {mode === "translation" && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {["English", "Thai", "Chinese", "Japanese", "Korean"].map((l) => (
                <Pressable
                  key={l}
                  accessibilityRole="button"
                  accessibilityState={{ selected: language === l }}
                  onPress={() => {
                    setLanguage(l);
                    setResult("");
                  }}
                  disabled={busy}
                  style={{
                    padding: 12,
                    minHeight: 44,
                    borderRadius: 20,
                    backgroundColor: language === l ? c.primary : c.surface,
                  }}
                >
                  <Text
                    style={{ color: language === l ? "white" : c.foreground }}
                  >
                    {l}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          {(mode === "compose" || mode === "refine") && (
            <TextInput
              accessibilityLabel="Writing instructions"
              placeholder={
                mode === "compose"
                  ? "What would you like to say?"
                  : "Make shorter, more polite, or clearer…"
              }
              placeholderTextColor={c.muted}
              value={instruction}
              onChangeText={setInstruction}
              maxLength={1000}
              multiline
              style={{
                color: c.foreground,
                backgroundColor: c.surface,
                padding: 14,
                borderRadius: 12,
                minHeight: 80,
                maxHeight: 140,
                fontSize: 16,
              }}
            />
          )}
          <ScrollView style={{ maxHeight: 320 }}>
            {result && (
              <Text
                selectable
                style={{ color: c.foreground, fontSize: 17, lineHeight: 25 }}
              >
                {result}
              </Text>
            )}
            {error && (
              <Text accessibilityRole="alert" style={{ color: c.error }}>
                {error}
              </Text>
            )}
          </ScrollView>
          {busy ? (
            <ActivityIndicator color={c.primary} />
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Generate AI result"
              disabled={mode === "compose" && !instruction.trim()}
              onPress={() => void run()}
              style={{
                padding: 14,
                borderRadius: 14,
                backgroundColor: c.primary,
                alignItems: "center",
              }}
            >
              <Text style={{ color: "white" }}>
                {result
                  ? "Try again"
                  : mode === "translation"
                    ? "Translate"
                    : "Generate"}
              </Text>
            </Pressable>
          )}
          {result && (
            <View style={{ flexDirection: "row", gap: 20 }}>
              <Pressable
                accessibilityRole="button"
                onPress={() => void Clipboard.setStringAsync(result)}
                style={{ padding: 12, minHeight: 44 }}
              >
                <Text style={{ color: c.primary }}>Copy</Text>
              </Pressable>
              {canInsert && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Use draft"
                  onPress={() => {
                    if (getAuthSnapshot().user === owner.current) {
                      onDraft(result);
                      onClose();
                    }
                  }}
                  style={{ padding: 12, minHeight: 44 }}
                >
                  <Text style={{ color: c.primary }}>Use draft</Text>
                </Pressable>
              )}
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
