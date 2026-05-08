import { useEffect, useRef } from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useSipAccountStore } from "@/lib/sip/account-store";
import { type SipDiagnosticEvent, useSipDiagnosticsStore } from "@/lib/sip/diagnostics-store";
import { sipEngine } from "@/lib/sip/engine";

function levelColor(event: SipDiagnosticEvent, colors: ReturnType<typeof useColors>): string {
  if (event.level === "error") return colors.error;
  if (event.level === "warning") return colors.warning;
  return colors.primary;
}

function eventTime(event: SipDiagnosticEvent): string {
  return event.timestamp.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function SipDiagnosticsScreen() {
  const colors = useColors();
  const didRequestInit = useRef(false);
  const events = useSipDiagnosticsStore((s) => s.events);
  const addEvent = useSipDiagnosticsStore((s) => s.addEvent);
  const clearEvents = useSipDiagnosticsStore((s) => s.clearEvents);
  const loadAccount = useSipAccountStore((s) => s.loadAccount);

  useEffect(() => {
    if (didRequestInit.current) return;
    didRequestInit.current = true;

    loadAccount()
      .then(() => {
        const { account } = useSipAccountStore.getState();
        if (account?.enabled) {
          sipEngine.initialize().catch((error) => {
            addEvent({
              level: "error",
              category: "engine",
              message: "SIP diagnostics could not start registration",
              detail: error instanceof Error ? error.message : String(error),
            });
          });
          return;
        }

        addEvent({
          level: "warning",
          category: "registration",
          message: "No admin-provisioned phone account loaded",
          detail: "Open Phone Provisioning, sign in, then sync from admin management.",
        });
      })
      .catch((error) => {
        addEvent({
          level: "error",
          category: "engine",
          message: "SIP diagnostics could not load phone account",
          detail: error instanceof Error ? error.message : String(error),
        });
      });
  }, [addEvent, loadAccount]);

  return (
    <ScreenContainer>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}> 
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <IconSymbol name="chevron.left" size={20} color={colors.primary} />
            <Text style={[styles.backText, { color: colors.primary }]}>Settings</Text>
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.foreground }]}>SIP Diagnostics</Text>
          <TouchableOpacity
            style={[styles.clearBtn, { borderColor: colors.border }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              clearEvents();
            }}
          >
            <Text style={[styles.clearText, { color: colors.muted }]}>Clear</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.summaryCard, { backgroundColor: colors.surface, borderColor: colors.border }]}> 
          <IconSymbol name="checklist" size={20} color={colors.primary} />
          <View style={styles.summaryText}>
            <Text style={[styles.summaryTitle, { color: colors.foreground }]}> 
              First-device call trail
            </Text>
            <Text style={[styles.summaryBody, { color: colors.muted }]}> 
              Latest registration, call, media, and engine events. Use this together with Kamailio and RTPEngine logs during pilot tests.
            </Text>
          </View>
        </View>

        <View style={styles.events}>
          {events.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.border }]}> 
              <IconSymbol name="info.circle" size={24} color={colors.muted} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Checking phone registration</Text>
              <Text style={[styles.emptyText, { color: colors.muted }]}> 
                Diagnostics will show whether the app found an admin-provisioned account and started SIP registration.
              </Text>
            </View>
          ) : (
            events.map((event) => {
              const color = levelColor(event, colors);
              return (
                <View
                  key={event.id}
                  style={[styles.eventCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                  <View style={styles.eventHeader}>
                    <View style={[styles.levelDot, { backgroundColor: color }]} />
                    <Text style={[styles.eventCategory, { color }]}>{event.category.toUpperCase()}</Text>
                    <Text style={[styles.eventTime, { color: colors.muted }]}>{eventTime(event)}</Text>
                  </View>
                  <Text style={[styles.eventMessage, { color: colors.foreground }]}>{event.message}</Text>
                  {event.callId ? (
                    <Text style={[styles.eventMeta, { color: colors.muted }]}>callId: {event.callId}</Text>
                  ) : null}
                  {event.destination ? (
                    <Text style={[styles.eventMeta, { color: colors.muted }]}>target: {event.destination}</Text>
                  ) : null}
                  {event.detail ? (
                    <Text style={[styles.eventDetail, { color: colors.muted }]}>{event.detail}</Text>
                  ) : null}
                </View>
              );
            })
          )}
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
  backBtn: { flexDirection: "row", alignItems: "center", gap: 4, width: 86 },
  backText: { fontSize: 16, fontWeight: "500" },
  title: { fontSize: 17, fontWeight: "700" },
  clearBtn: {
    width: 86,
    alignItems: "flex-end",
    paddingVertical: 6,
  },
  clearText: { fontSize: 14, fontWeight: "600" },
  summaryCard: {
    margin: 16,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
  },
  summaryText: { flex: 1, gap: 4 },
  summaryTitle: { fontSize: 15, fontWeight: "700" },
  summaryBody: { fontSize: 13, lineHeight: 19 },
  events: {
    gap: 10,
    paddingHorizontal: 16,
  },
  emptyCard: {
    alignItems: "center",
    gap: 8,
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
  },
  emptyTitle: { fontSize: 15, fontWeight: "700" },
  emptyText: { fontSize: 13, textAlign: "center", lineHeight: 18 },
  eventCard: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 6,
  },
  eventHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  levelDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  eventCategory: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  eventTime: {
    marginLeft: "auto",
    fontSize: 12,
  },
  eventMessage: {
    fontSize: 15,
    fontWeight: "700",
  },
  eventMeta: {
    fontSize: 12,
  },
  eventDetail: {
    fontSize: 12,
    lineHeight: 17,
  },
});
