/**
 * SIP Diagnostics Store — Phone11
 * Keeps a short in-memory event trail for first-device call testing.
 */

import { create } from "zustand";

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
  addEvent: (event: Omit<SipDiagnosticEvent, "id" | "timestamp">) => void;
  clearEvents: () => void;
}

const MAX_EVENTS = 100;

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

  addEvent: (event) => {
    set((state) => ({
      events: [
        {
          ...event,
          id: eventId(),
          timestamp: new Date(),
        },
        ...state.events,
      ].slice(0, MAX_EVENTS),
    }));
  },

  clearEvents: () => set({ events: [] }),
}));
