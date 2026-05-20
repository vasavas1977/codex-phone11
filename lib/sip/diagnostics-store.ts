/**
 * SIP Diagnostics Store — Phone11
 * Keeps a short in-memory event trail for first-device call testing.
 */

import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type SipDiagnosticLevel = "info" | "warning" | "error";
export type SipDiagnosticCategory = "engine" | "registration" | "call" | "media" | "native";
export type SipDiagnosticContext = Record<string, string | number | boolean | null | undefined>;

export interface SipDiagnosticEvent {
  id: string;
  timestamp: Date;
  level: SipDiagnosticLevel;
  category: SipDiagnosticCategory;
  message: string;
  callId?: string;
  destination?: string;
  detail?: string;
  context?: SipDiagnosticContext;
}

interface SipDiagnosticsState {
  events: SipDiagnosticEvent[];
  hydrated: boolean;
  addEvent: (event: Omit<SipDiagnosticEvent, "id" | "timestamp">) => void;
  clearEvents: () => void;
  hydrateEvents: () => Promise<void>;
}

const MAX_EVENTS = 100;
const STORAGE_KEY = "phone11_sip_diagnostic_events";

function eventId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function isSensitiveKey(key: string): boolean {
  return /password|secret|token|credential|authorization|auth/i.test(key);
}

function cleanValue(value: string | number | boolean | null | undefined): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  const text = String(value);
  return text.length > 260 ? `${text.slice(0, 260)}...` : text;
}

function createDiagnosticEvent(event: Omit<SipDiagnosticEvent, "id" | "timestamp">): SipDiagnosticEvent {
  return {
    ...event,
    id: eventId(),
    timestamp: new Date(),
  };
}

function normalizeDiagnosticEvents(rawEvents: any): SipDiagnosticEvent[] {
  if (!Array.isArray(rawEvents)) return [];

  return rawEvents
    .map((event) => ({
      ...event,
      timestamp: event?.timestamp ? new Date(event.timestamp) : new Date(),
    }))
    .filter((event) => event?.id && event?.level && event?.category && event?.message)
    .slice(0, MAX_EVENTS);
}

function mergeDiagnosticEvents(current: SipDiagnosticEvent[], existing: SipDiagnosticEvent[]): SipDiagnosticEvent[] {
  const seen = new Set<string>();
  return [...current, ...existing]
    .filter((event) => {
      if (seen.has(event.id)) return false;
      seen.add(event.id);
      return true;
    })
    .slice(0, MAX_EVENTS);
}

async function persistDiagnosticEvents(events: SipDiagnosticEvent[], mergeExisting = false): Promise<void> {
  try {
    let eventsToPersist = events;

    if (mergeExisting) {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const existingEvents = normalizeDiagnosticEvents(raw ? JSON.parse(raw) : []);
      eventsToPersist = mergeDiagnosticEvents(events, existingEvents);
    }

    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(eventsToPersist));
  } catch (error) {
    console.warn("[SIP Diagnostics] Could not persist diagnostic events:", error);
  }
}

export function formatDiagnosticContext(context?: SipDiagnosticContext): string {
  if (!context) return "";

  return Object.entries(context)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${isSensitiveKey(key) ? "[redacted]" : cleanValue(value)}`)
    .join(" | ");
}

export function formatDiagnosticEvent(event: SipDiagnosticEvent): string {
  const timestamp = event.timestamp instanceof Date
    ? event.timestamp
    : new Date(event.timestamp);
  const lines = [
    `[${timestamp.toISOString()}] ${event.level.toUpperCase()}/${event.category.toUpperCase()}: ${event.message}`,
  ];

  if (event.callId) lines.push(`callId: ${event.callId}`);
  if (event.destination) lines.push(`destination: ${event.destination}`);
  if (event.detail) lines.push(`detail: ${event.detail}`);

  const context = formatDiagnosticContext(event.context);
  if (context) lines.push(`context: ${context}`);

  return lines.join("\n");
}

export function formatSipError(error: any): string {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;

  const parts = [
    error.name,
    error.code ? `code=${error.code}` : null,
    error.status ? `status=${error.status}` : null,
    error.reason,
    error.message,
    error.stack
      ? `stack=${String(error.stack).split("\n").slice(0, 6).join(" <- ")}`
      : null,
  ].filter(Boolean);

  return parts.join(" | ") || "Unknown error";
}

export const useSipDiagnosticsStore = create<SipDiagnosticsState>((set, get) => ({
  events: [],
  hydrated: false,

  addEvent: (event) => {
    const entry = createDiagnosticEvent(event);
    let nextEvents: SipDiagnosticEvent[] = [];

    set((state) => ({
      events: (nextEvents = [entry, ...state.events].slice(0, MAX_EVENTS)),
    }));

    persistDiagnosticEvents(nextEvents, !get().hydrated).catch(() => {});
  },

  clearEvents: () => {
    set({ events: [] });
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  },

  hydrateEvents: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const events = normalizeDiagnosticEvents(raw ? JSON.parse(raw) : []);
      set({ events, hydrated: true });
    } catch (error) {
      console.warn("[SIP Diagnostics] Could not load diagnostic events:", error);
      set({ hydrated: true });
    }
  },
}));

export async function recordPersistentSipDiagnosticEvent(
  event: Omit<SipDiagnosticEvent, "id" | "timestamp">
): Promise<void> {
  const entry = createDiagnosticEvent(event);
  let nextEvents: SipDiagnosticEvent[] = [];
  const shouldMergeExisting = !useSipDiagnosticsStore.getState().hydrated;

  useSipDiagnosticsStore.setState((state) => {
    nextEvents = [entry, ...state.events].slice(0, MAX_EVENTS);
    return { events: nextEvents };
  });

  await persistDiagnosticEvents(nextEvents, shouldMergeExisting);
}
