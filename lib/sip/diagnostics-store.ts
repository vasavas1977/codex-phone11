/**
 * SIP Diagnostics Store — Phone11
 * Keeps a short in-memory event trail for first-device call testing.
 */

import { create } from "zustand";

export type SipDiagnosticLevel = "info" | "warning" | "error";
export type SipDiagnosticCategory = "engine" | "registration" | "call" | "media";

export interface SipDiagnosticEvent {
  id: string;
  timestamp: Date;
  level: SipDiagnosticLevel;
  category: SipDiagnosticCategory;
  message: string;
  callId?: string;
  destination?: string;
  detail?: string;
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

export function formatSipError(error: any): string {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;

  const parts = [
    error.name,
    error.code ? `code=${error.code}` : null,
    error.status ? `status=${error.status}` : null,
    error.reason,
    error.message,
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
