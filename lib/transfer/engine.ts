/**
 * Call Transfer Engine — CloudPhone11
 *
 * Handles blind and attended call transfer flows.
 * - Blind: SIP REFER via PJSIP (call.xfer)
 * - Attended: Hold current → dial consult → complete transfer (call.xferReplaces)
 *
 * On web/demo mode, simulates transfer with delays.
 */

import { Platform } from "react-native";
import type {
  TransferMode,
  TransferTarget,
  TransferOperation,
  TransferFavorite,
  TransferHistoryEntry,
} from "./types";

/** Generate a unique transfer ID */
function generateId(): string {
  return `xfer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

class TransferEngine {
  private history: TransferHistoryEntry[] = [];
  private favorites: TransferFavorite[] = [
    { name: "Reception", number: "1000", transferCount: 12, lastUsed: Date.now() - 3600000 },
    { name: "Sales Queue", number: "2000", transferCount: 8, lastUsed: Date.now() - 7200000 },
    { name: "Support Queue", number: "3000", transferCount: 15, lastUsed: Date.now() - 1800000 },
    { name: "Voicemail", number: "*97", transferCount: 5, lastUsed: Date.now() - 86400000 },
  ];

  /**
   * Execute a blind transfer (SIP REFER).
   * The current call is immediately transferred to the target.
   */
  async blindTransfer(callId: string, target: TransferTarget): Promise<TransferOperation> {
    const op: TransferOperation = {
      id: generateId(),
      callId,
      mode: "blind",
      target,
      status: "transferring",
      initiatedAt: Date.now(),
    };

    try {
      if (Platform.OS !== "web") {
        // Native: use SIP engine's transferCall
        const { sipEngine } = require("@/lib/sip/engine");
        await sipEngine.transferCall(callId, target.number);
      } else {
        // Web demo: simulate delay
        await new Promise((r) => setTimeout(r, 1500));
      }

      op.status = "completed";
      op.completedAt = Date.now();
      this._recordHistory(op);
      this._updateFavorite(target);
      return op;
    } catch (error: any) {
      op.status = "failed";
      op.error = error?.message || "Blind transfer failed";
      this._recordHistory(op);
      return op;
    }
  }

  /**
   * Start an attended transfer.
   * Step 1: Hold the current call and dial the consultation target.
   * Returns the operation with consultCallId.
   */
  async startAttendedTransfer(callId: string, target: TransferTarget): Promise<TransferOperation> {
    const op: TransferOperation = {
      id: generateId(),
      callId,
      mode: "attended",
      target,
      status: "consulting",
      initiatedAt: Date.now(),
      consultConnected: false,
    };

    try {
      if (Platform.OS !== "web") {
        const { sipEngine } = require("@/lib/sip/engine");
        // Hold the current call
        await sipEngine.setHold(callId, true);
        // Dial the consultation call
        const consultId = await sipEngine.makeCall(target.number);
        op.consultCallId = consultId || undefined;
      } else {
        // Web demo: simulate
        await new Promise((r) => setTimeout(r, 1000));
        op.consultCallId = `consult_${Date.now()}`;
      }

      return op;
    } catch (error: any) {
      op.status = "failed";
      op.error = error?.message || "Failed to start consultation call";
      this._recordHistory(op);
      return op;
    }
  }

  /**
   * Complete an attended transfer.
   * Step 2: After consulting, bridge the original caller with the consult target.
   */
  async completeAttendedTransfer(op: TransferOperation): Promise<TransferOperation> {
    try {
      if (Platform.OS !== "web" && op.consultCallId) {
        // Native: use xferReplaces to bridge calls
        const { useSipCallStore } = require("@/lib/sip/call-store");
        const originalCall = useSipCallStore.getState().getCall(op.callId);
        const consultCall = useSipCallStore.getState().getCall(op.consultCallId);
        if (originalCall && consultCall) {
          await originalCall.xferReplaces(consultCall);
        }
      } else {
        // Web demo: simulate
        await new Promise((r) => setTimeout(r, 1200));
      }

      op.status = "completed";
      op.completedAt = Date.now();
      this._recordHistory(op);
      this._updateFavorite(op.target);
      return op;
    } catch (error: any) {
      op.status = "failed";
      op.error = error?.message || "Attended transfer failed";
      this._recordHistory(op);
      return op;
    }
  }

  /**
   * Cancel an attended transfer.
   * Hang up the consultation call and resume the original call.
   */
  async cancelAttendedTransfer(op: TransferOperation): Promise<void> {
    try {
      if (Platform.OS !== "web") {
        const { sipEngine } = require("@/lib/sip/engine");
        if (op.consultCallId) {
          await sipEngine.hangupCall(op.consultCallId);
        }
        // Resume original call
        await sipEngine.setHold(op.callId, false);
      }
    } catch (error) {
      console.error("[TransferEngine] Cancel attended transfer failed:", error);
    }
  }

  /** Get transfer favorites sorted by usage */
  getFavorites(): TransferFavorite[] {
    return [...this.favorites].sort((a, b) => b.transferCount - a.transferCount);
  }

  /** Get transfer history */
  getHistory(): TransferHistoryEntry[] {
    return [...this.history].sort((a, b) => b.timestamp - a.timestamp);
  }

  /** Get recent transfer targets (from history, deduplicated) */
  getRecentTargets(limit = 10): TransferTarget[] {
    const seen = new Set<string>();
    const targets: TransferTarget[] = [];
    for (const entry of this.getHistory()) {
      if (!seen.has(entry.target.number)) {
        seen.add(entry.target.number);
        targets.push({ ...entry.target, source: "recent" });
        if (targets.length >= limit) break;
      }
    }
    return targets;
  }

  private _recordHistory(op: TransferOperation): void {
    if (op.status === "completed" || op.status === "failed") {
      this.history.push({
        id: op.id,
        callId: op.callId,
        mode: op.mode,
        target: op.target,
        status: op.status,
        timestamp: op.completedAt || Date.now(),
        duration: op.completedAt ? op.completedAt - op.initiatedAt : undefined,
        error: op.error,
      });
    }
  }

  private _updateFavorite(target: TransferTarget): void {
    const existing = this.favorites.find((f) => f.number === target.number);
    if (existing) {
      existing.transferCount++;
      existing.lastUsed = Date.now();
    } else {
      this.favorites.push({
        name: target.name,
        number: target.number,
        avatar: target.avatar,
        transferCount: 1,
        lastUsed: Date.now(),
      });
    }
  }
}

export const transferEngine = new TransferEngine();
