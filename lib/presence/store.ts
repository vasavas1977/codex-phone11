/**
 * CloudPhone11 Presence Store (Enhanced)
 *
 * Zustand store for reactive presence state management.
 * Syncs with the presence engine and provides hooks for UI components.
 * Now supports extension-based subscriptions, presence-aware sorting,
 * and richer status types (ringing, dnd).
 */

import { create } from "zustand";
import { presenceEngine, type PresenceStatus, type PresenceInfo } from "./engine";
import { getPresenceColor as getColor, getPresenceLabel as getLabel, getPresencePriority } from "./types";
import type { ActiveCallInfo } from "./types";

interface PresenceState {
  myStatus: PresenceStatus;
  myStatusText: string;
  contacts: Record<string, PresenceInfo>;
  initialized: boolean;
  lastUpdated: number;

  // Actions
  initialize: (sipDomain?: string) => Promise<void>;
  setMyPresence: (status: PresenceStatus, statusText?: string) => Promise<void>;
  subscribeContact: (uri: string, displayName?: string) => Promise<void>;
  subscribeContacts: (uris: string[]) => Promise<void>;
  subscribeExtension: (extension: string, displayName?: string) => Promise<void>;
  subscribeExtensions: (extensions: { extension: string; displayName?: string }[]) => Promise<void>;
  getContactPresence: (uri: string) => PresenceInfo | undefined;
  getExtensionPresence: (extension: string) => PresenceInfo | undefined;
  getExtensionStatus: (extension: string) => PresenceStatus;
  getActiveCall: (extension: string) => ActiveCallInfo | undefined;
  sortByAvailability: <T extends { number?: string }>(items: T[]) => T[];
  destroy: () => Promise<void>;
}

export const usePresenceStore = create<PresenceState>((set, get) => ({
  myStatus: "online",
  myStatusText: "",
  contacts: {},
  initialized: false,
  lastUpdated: 0,

  initialize: async (sipDomain = "pbx.local") => {
    if (get().initialized) return;

    await presenceEngine.initialize(sipDomain);

    // Listen for presence updates from the engine
    presenceEngine.addListener((uri, info) => {
      set((state) => ({
        contacts: {
          ...state.contacts,
          [uri]: info,
          ...(info.extension ? { [`ext:${info.extension}`]: info } : {}),
        },
        lastUpdated: Date.now(),
      }));
    });

    set({ initialized: true });
  },

  setMyPresence: async (status, statusText) => {
    await presenceEngine.setMyPresence(status, statusText);
    set({ myStatus: status, myStatusText: statusText || "" });
  },

  subscribeContact: async (uri, displayName) => {
    const state = get();
    if (!state.initialized) await state.initialize();
    await presenceEngine.subscribe(uri, displayName);
  },

  subscribeContacts: async (uris) => {
    const state = get();
    if (!state.initialized) await state.initialize();
    await presenceEngine.subscribeAll(uris);
  },

  subscribeExtension: async (extension, displayName) => {
    const state = get();
    if (!state.initialized) await state.initialize();
    await presenceEngine.subscribeExtension(extension, displayName);
  },

  subscribeExtensions: async (extensions) => {
    const state = get();
    if (!state.initialized) await state.initialize();
    await presenceEngine.subscribeExtensions(extensions);
  },

  getContactPresence: (uri) => {
    return get().contacts[uri];
  },

  getExtensionPresence: (extension) => {
    return get().contacts[`ext:${extension}`];
  },

  getExtensionStatus: (extension) => {
    return get().contacts[`ext:${extension}`]?.status ?? "unknown";
  },

  getActiveCall: (extension) => {
    return get().contacts[`ext:${extension}`]?.activeCall;
  },

  sortByAvailability: <T extends { number?: string }>(items: T[]): T[] => {
    const state = get();
    return [...items].sort((a, b) => {
      const extA = a.number || "";
      const extB = b.number || "";
      const statusA = state.contacts[`ext:${extA}`]?.status ?? "unknown";
      const statusB = state.contacts[`ext:${extB}`]?.status ?? "unknown";
      return getPresencePriority(statusA) - getPresencePriority(statusB);
    });
  },

  destroy: async () => {
    await presenceEngine.destroy();
    set({ contacts: {}, initialized: false, myStatus: "offline", myStatusText: "", lastUpdated: 0 });
  },
}));

/** Get presence status color */
export function getPresenceColor(status: PresenceStatus): string {
  return getColor(status);
}

/** Get presence status label */
export function getPresenceLabel(status: PresenceStatus): string {
  return getLabel(status);
}
