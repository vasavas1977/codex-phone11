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

// One queue owns every storage read/write/remove. UI/call handlers update memory
// immediately; only explicit persistent-record/hydration callers await this queue.
let persistenceQueue: Promise<void> = Promise.resolve();
let clearGeneration = 0;

function enqueueDiagnosticOperation(operation: () => Promise<void>): Promise<void> {
  const task = persistenceQueue.then(operation).catch(() => {
    // Storage errors can contain platform details; do not copy them into diagnostics.
    console.warn("[SIP Diagnostics] Could not update stored diagnostic events");
  });
  persistenceQueue = task;
  return task;
}

async function hydrateDiagnosticGeneration(generation: number): Promise<boolean> {
  if (generation !== clearGeneration) return false;
  if (useSipDiagnosticsStore.getState().hydrated) return true;
  let existing: SipDiagnosticEvent[] = [];
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    existing = normalizeDiagnosticEvents(raw ? JSON.parse(raw) : []);
  } catch {
    console.warn("[SIP Diagnostics] Could not load stored diagnostic events");
    // Preserve unknown disk history on read failure; a later operation can retry.
    return false;
  }
  // A clear invalidates an already-running read as well as queued old writes.
  if (generation !== clearGeneration) return false;
  useSipDiagnosticsStore.setState(state => ({
    events: mergeDiagnosticEvents(state.events, existing),
    hydrated: true,
  }));
  return true;
}

function persistCurrentDiagnosticEvents(): Promise<void> {
  const generation = clearGeneration;
  return enqueueDiagnosticOperation(async () => {
    if (!await hydrateDiagnosticGeneration(generation) || generation !== clearGeneration) return;
    // Take the latest memory snapshot only after older storage work completes.
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(useSipDiagnosticsStore.getState().events));
  });
}

function appendDiagnosticEvent(event: Omit<SipDiagnosticEvent, "id" | "timestamp">): Promise<void> {
  const entry = createDiagnosticEvent(event);
  useSipDiagnosticsStore.setState(state => ({ events: [entry, ...state.events].slice(0, MAX_EVENTS) }));
  return persistCurrentDiagnosticEvents();
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

export const useSipDiagnosticsStore = create<SipDiagnosticsState>((set) => ({
  events: [],
  hydrated: false,

  addEvent: (event) => {
    void appendDiagnosticEvent(event);
  },

  clearEvents: () => {
    clearGeneration++;
    // Clearing is also initialization: a later hydration must not reload old data.
    set({ events: [], hydrated: true });
    void enqueueDiagnosticOperation(() => AsyncStorage.removeItem(STORAGE_KEY));
  },

  hydrateEvents: () => {
    const generation = clearGeneration;
    return enqueueDiagnosticOperation(async () => { await hydrateDiagnosticGeneration(generation); });
  },
}));

export async function recordPersistentSipDiagnosticEvent(
  event: Omit<SipDiagnosticEvent, "id" | "timestamp">
): Promise<void> {
  await appendDiagnosticEvent(event);
}
