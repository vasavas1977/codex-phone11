/**
 * Call Transfer Store — CloudPhone11
 *
 * Zustand store for managing call transfer state,
 * including blind/attended transfer flows, favorites,
 * and transfer history.
 */

import { create } from "zustand";
import type {
  TransferMode,
  TransferTarget,
  TransferOperation,
  TransferFavorite,
  TransferHistoryEntry,
  TransferStatus,
} from "./types";
import { transferEngine } from "./engine";

interface TransferState {
  /** Current active transfer operation (null if none) */
  activeTransfer: TransferOperation | null;
  /** Transfer favorites */
  favorites: TransferFavorite[];
  /** Transfer history */
  history: TransferHistoryEntry[];
  /** Recent targets */
  recentTargets: TransferTarget[];
  /** Whether the transfer sheet is visible */
  isSheetVisible: boolean;
  /** The call ID being transferred */
  activeCallId: string | null;

  // Actions
  openTransferSheet: (callId: string) => void;
  closeTransferSheet: () => void;
  executeBlindTransfer: (target: TransferTarget) => Promise<void>;
  startAttendedTransfer: (target: TransferTarget) => Promise<void>;
  completeAttendedTransfer: () => Promise<void>;
  cancelAttendedTransfer: () => Promise<void>;
  refreshFavorites: () => void;
  refreshHistory: () => void;
}

export const useTransferStore = create<TransferState>((set, get) => ({
  activeTransfer: null,
  favorites: [],
  history: [],
  recentTargets: [],
  isSheetVisible: false,
  activeCallId: null,

  openTransferSheet: (callId) => {
    set({ isSheetVisible: true, activeCallId: callId, activeTransfer: null });
    // Refresh data
    get().refreshFavorites();
    get().refreshHistory();
  },

  closeTransferSheet: () => {
    set({ isSheetVisible: false, activeCallId: null, activeTransfer: null });
  },

  executeBlindTransfer: async (target) => {
    const callId = get().activeCallId;
    if (!callId) return;

    set({
      activeTransfer: {
        id: `pending_${Date.now()}`,
        callId,
        mode: "blind",
        target,
        status: "transferring",
        initiatedAt: Date.now(),
      },
    });

    try {
      const result = await transferEngine.blindTransfer(callId, target);
      set({ activeTransfer: result });

      if (result.status === "completed") {
        // Auto-close after success
        setTimeout(() => {
          set({ isSheetVisible: false, activeCallId: null, activeTransfer: null });
        }, 1500);
      }
    } catch (error: any) {
      set((state) => ({
        activeTransfer: state.activeTransfer
          ? { ...state.activeTransfer, status: "failed" as TransferStatus, error: error?.message }
          : null,
      }));
    }

    get().refreshHistory();
  },

  startAttendedTransfer: async (target) => {
    const callId = get().activeCallId;
    if (!callId) return;

    set({
      activeTransfer: {
        id: `pending_${Date.now()}`,
        callId,
        mode: "attended",
        target,
        status: "consulting",
        initiatedAt: Date.now(),
        consultConnected: false,
      },
    });

    try {
      const result = await transferEngine.startAttendedTransfer(callId, target);
      set({ activeTransfer: { ...result, consultConnected: true } });
    } catch (error: any) {
      set((state) => ({
        activeTransfer: state.activeTransfer
          ? { ...state.activeTransfer, status: "failed" as TransferStatus, error: error?.message }
          : null,
      }));
    }
  },

  completeAttendedTransfer: async () => {
    const op = get().activeTransfer;
    if (!op || op.mode !== "attended") return;

    set({
      activeTransfer: { ...op, status: "transferring" },
    });

    try {
      const result = await transferEngine.completeAttendedTransfer(op);
      set({ activeTransfer: result });

      if (result.status === "completed") {
        setTimeout(() => {
          set({ isSheetVisible: false, activeCallId: null, activeTransfer: null });
        }, 1500);
      }
    } catch (error: any) {
      set((state) => ({
        activeTransfer: state.activeTransfer
          ? { ...state.activeTransfer, status: "failed" as TransferStatus, error: error?.message }
          : null,
      }));
    }

    get().refreshHistory();
  },

  cancelAttendedTransfer: async () => {
    const op = get().activeTransfer;
    if (!op || op.mode !== "attended") return;

    await transferEngine.cancelAttendedTransfer(op);
    set({ activeTransfer: null });
  },

  refreshFavorites: () => {
    set({ favorites: transferEngine.getFavorites() });
  },

  refreshHistory: () => {
    set({
      history: transferEngine.getHistory(),
      recentTargets: transferEngine.getRecentTargets(),
    });
  },
}));
