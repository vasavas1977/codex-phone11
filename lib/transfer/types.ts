/**
 * Shared models for the legacy call-transfer flow.
 *
 * These types describe the transfer UI/store contract. They do not enable or
 * assert provider support for transfer; the current Phone11 route remains
 * explicitly unavailable until native and provider acceptance is complete.
 */

/** Transfer strategy. */
export type TransferMode = "blind" | "attended";

/** Source of a selectable transfer destination. */
export type TransferTargetSource = "favorites" | "recent" | "manual";

/** Lifecycle state for an active transfer operation. */
export type TransferStatus =
  | "idle"
  | "consulting"
  | "transferring"
  | "completed"
  | "failed";

/** A destination that can receive a transferred call. */
export interface TransferTarget {
  name: string;
  number: string;
  avatar?: string;
  source: TransferTargetSource;
}

/** An in-progress or completed transfer operation. */
export interface TransferOperation {
  id: string;
  callId: string;
  mode: TransferMode;
  target: TransferTarget;
  status: TransferStatus;
  initiatedAt: number;
  completedAt?: number;
  consultCallId?: string;
  consultConnected?: boolean;
  error?: string;
}

/** A frequently used transfer destination. */
export interface TransferFavorite {
  name: string;
  number: string;
  avatar?: string;
  transferCount: number;
  lastUsed: number;
}

/** A completed or failed transfer retained in local history. */
export interface TransferHistoryEntry {
  id: string;
  callId: string;
  mode: TransferMode;
  target: TransferTarget;
  status: "completed" | "failed";
  timestamp: number;
  duration?: number;
  error?: string;
}
