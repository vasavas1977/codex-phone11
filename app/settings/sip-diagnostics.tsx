import { useEffect, useRef, useState } from "react";
import { Platform, Share, StyleSheet, Text, TouchableOpacity, ScrollView, View } from "react-native";
import Constants from "expo-constants";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { type RegistrationState, type SipAccount, useSipAccountStore } from "@/lib/sip/account-store";
import {
  formatDiagnosticContext,
  formatDiagnosticEvent,
  recordPersistentSipDiagnosticEvent,
  type SipDiagnosticEvent,
  useSipDiagnosticsStore,
} from "@/lib/sip/diagnostics-store";
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

function buildInfoLines(): string[] {
  const expoConfig = Constants.expoConfig as any;
  const buildInfo = expoConfig?.extra?.buildInfo ?? {};

  return [
    `appVersion=${expoConfig?.version ?? "unknown"}`,
    `easBuildId=${buildInfo.easBuildId ?? "unknown"}`,
    `easBuildProfile=${buildInfo.easBuildProfile ?? "unknown"}`,
    `gitCommitHash=${buildInfo.gitCommitHash ?? "unknown"}`,
    `builtAt=${buildInfo.builtAt ?? "unknown"}`,
  ];
}

function buildDiagnosticReport(
  events: SipDiagnosticEvent[],
  account: SipAccount | null,
  registrationState: RegistrationState,
  registrationError: string | null
): string {
  const accountLines = account
    ? [
        `enabled=${account.enabled}`,
        `username=${account.username}`,
        `domain=${account.domain}`,
        `proxy=${account.proxy || account.domain}`,
        `port=${account.port}`,
        `transport=${account.transport}`,
        `srtp=${account.srtp}`,
        `stun=${account.stun || "none"}`,
      ]
    : ["No SIP account loaded"];

  return [
    "Phone11 SIP Diagnostics",
    `createdAt=${new Date().toISOString()}`,
    `platform=${Platform.OS}`,
    `platformVersion=${String(Platform.Version ?? "unknown")}`,
    `registrationState=${registrationState}`,
    `registrationError=${registrationError || "none"}`,
    "",
    "Build",
    ...buildInfoLines(),
    "",
    "Account",
    ...accountLines,
    "",
    "Events",
    ...(events.length ? events.map(formatDiagnosticEvent) : ["No diagnostic events recorded"]),
  ].join("\n");
}

export default function SipDiagnosticsScreen() {
  const colors = useColors();
  const didRequestInit = useRef(false);
  const [registrationTestBusy, setRegistrationTestBusy] = useState(false);
  const events = useSipDiagnosticsStore((s) => s.events);
  const addEvent = useSipDiagnosticsStore((s) => s.addEvent);
  const clearEvents = useSipDiagnosticsStore((s) => s.clearEvents);
  const hydrateEvents = useSipDiagnosticsStore((s) => s.hydrateEvents);
  const account = useSipAccountStore((s) => s.account);
  const registrationState = useSipAccountStore((s) => s.registrationState);
  const registrationError = useSipAccountStore((s) => s.registrationError);
  const loadAccount = useSipAccountStore((s) => s.loadAccount);

  useEffect(() => {
    if (didRequestInit.current) return;
    didRequestInit.current = true;

    hydrateEvents()
      .then(loadAccount)
      .then(() => {
        const { account: loadedAccount } = useSipAccountStore.getState();
        if (loadedAccount?.enabled) {
          addEvent({
            level: "info",
            category: "registration",
            message: "SIP diagnostics opened without starting native registration",
            detail:
              "This screen no longer starts PJSIP automatically. Use Start SIP Registration Test when you want an explicit native SIP attempt.",
            context: {
              username: loadedAccount.username,
              domain: loadedAccount.domain,
              proxy: loadedAccount.proxy || loadedAccount.domain,
              port: loadedAccount.port,
              transport: loadedAccount.transport,
              srtp: loadedAccount.srtp,
            },
          });
          return;
        }

        addEvent({
          level: "warning",
          category: "registration",
          message: "No admin-provisioned phone account loaded",
          detail: "Open Phone Provisioning, sign in, then tap Sync or Create Pilot Extension.",
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
  }, [addEvent, hydrateEvents, loadAccount]);

  async function startRegistrationTest(): Promise<void> {
    if (registrationTestBusy) return;

    try {
      setRegistrationTestBusy(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await loadAccount();
      const { account: loadedAccount } = useSipAccountStore.getState();

      if (!loadedAccount?.enabled) {
        addEvent({
          level: "warning",
          category: "registration",
          message: "Registration test blocked because no SIP account is loaded",
          detail: "Open Phone Provisioning, sign in, then sync the extension from admin management.",
        });
        return;
      }

      await recordPersistentSipDiagnosticEvent({
        level: "info",
        category: "registration",
        message: "Manual SIP registration test requested",
        detail: "If the app restarts after this line, the native PJSIP startup path crashed before JavaScript could catch it.",
        context: {
          username: loadedAccount.username,
          domain: loadedAccount.domain,
          proxy: loadedAccount.proxy || loadedAccount.domain,
          port: loadedAccount.port,
          transport: loadedAccount.transport,
          srtp: loadedAccount.srtp,
        },
      });

      await sipEngine.initialize();
    } catch (error) {
      addEvent({
        level: "error",
        category: "engine",
        message: "Manual SIP registration test failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setRegistrationTestBusy(false);
    }
  }

  async function shareLogs(): Promise<void> {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await Share.share({
        title: "Phone11 SIP Diagnostics",
        message: buildDiagnosticReport(events, account, registrationState, registrationError),
      });
    } catch (error) {
      addEvent({
        level: "error",
        category: "engine",
        message: "Could not open diagnostic share sheet",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

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
              Latest native module, registration, call, media, and engine events. Share this report after each failed test so we can diagnose from logs.
            </Text>
          </View>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.provisionButton, { backgroundColor: colors.primary }]}
            onPress={() => router.push("/settings/sip")}
          >
            <IconSymbol name="server.rack" size={18} color="#fff" />
            <Text style={styles.provisionButtonText}>Open Phone Provisioning</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.shareButton,
              {
                backgroundColor: colors.surface,
                borderColor: colors.primary,
                opacity: registrationTestBusy ? 0.55 : 1,
              },
            ]}
            onPress={startRegistrationTest}
            disabled={registrationTestBusy}
          >
            <IconSymbol name="antenna.radiowaves.left.and.right" size={18} color={colors.primary} />
            <Text style={[styles.shareButtonText, { color: colors.foreground }]}>
              {registrationTestBusy ? "Starting Registration..." : "Start SIP Registration Test"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.shareButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={shareLogs}
          >
            <IconSymbol name="square.and.arrow.up" size={18} color={colors.primary} />
            <Text style={[styles.shareButtonText, { color: colors.foreground }]}>Share Diagnostic Logs</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.events}>
          {events.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.border }]}> 
              <IconSymbol name="info.circle" size={24} color={colors.muted} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Checking phone registration</Text>
              <Text style={[styles.emptyText, { color: colors.muted }]}> 
                Diagnostics will show the saved admin account and any explicit SIP registration test events.
              </Text>
            </View>
          ) : (
            events.map((event) => {
              const color = levelColor(event, colors);
              const context = formatDiagnosticContext(event.context);
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
                  {context ? (
                    <Text style={[styles.eventDetail, { color: colors.muted }]}>{context}</Text>
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
  actions: {
    gap: 10,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  provisionButton: {
    borderRadius: 14,
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  provisionButtonText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  shareButton: {
    borderRadius: 14,
    borderWidth: 1,
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  shareButtonText: { fontSize: 14, fontWeight: "700" },
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
