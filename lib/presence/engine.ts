/**
 * CloudPhone11 Presence Engine (Enhanced)
 *
 * Implements SIP SIMPLE (RFC 3856/3863) presence subscribe/notify
 * with BLF (Busy Lamp Field) support (RFC 4235).
 * In production, connects to Kamailio's presence module.
 * Currently provides a simulation layer with realistic state transitions.
 */

import type {
  PresenceStatus,
  PresenceEvent,
  BLFDialogState,
  ActiveCallInfo,
} from "./types";
import { dialogStateToPresence, getPresencePriority } from "./types";

export type { PresenceStatus };

export interface PresenceInfo {
  uri: string;              // SIP URI e.g. sip:user@domain.com
  extension?: string;       // PBX extension number
  displayName?: string;     // Display name
  status: PresenceStatus;
  statusText?: string;      // Custom status message
  lastSeen?: number;        // Unix timestamp
  onCall?: boolean;         // Currently in a call
  dialogState?: BLFDialogState; // BLF dialog state
  statusDuration?: number;  // How long in current status (ms)
  activeCall?: ActiveCallInfo;  // Who they are talking to (when busy/ringing)
}

export interface PresenceSubscription {
  uri: string;
  active: boolean;
  expiresAt: number;
}

type PresenceListener = (uri: string, info: PresenceInfo) => void;
type PresenceEventListener = (event: PresenceEvent) => void;

class PresenceEngine {
  private subscriptions: Map<string, PresenceSubscription> = new Map();
  private presenceCache: Map<string, PresenceInfo> = new Map();
  private listeners: Set<PresenceListener> = new Set();
  private eventListeners: Set<PresenceEventListener> = new Set();
  private myStatus: PresenceStatus = "online";
  private myStatusText: string = "";
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private simulationTimers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private sipDomain: string = "";

  /**
   * Initialize the presence engine with SIP domain.
   * In production: connects to Kamailio presence module via SIP SUBSCRIBE.
   */
  async initialize(sipDomain: string): Promise<void> {
    this.sipDomain = sipDomain;
  }

  /**
   * Set my own presence status.
   * In production: sends SIP PUBLISH to Kamailio presence server.
   */
  async setMyPresence(status: PresenceStatus, statusText?: string): Promise<void> {
    this.myStatus = status;
    this.myStatusText = statusText || "";

    const myUri = `sip:me@${this.sipDomain}`;
    const info: PresenceInfo = {
      uri: myUri,
      status,
      statusText,
      lastSeen: Date.now(),
      onCall: false,
    };
    this.presenceCache.set(myUri, info);
    this.notifyListeners(myUri, info);
  }

  getMyPresence(): { status: PresenceStatus; statusText: string } {
    return { status: this.myStatus, statusText: this.myStatusText };
  }

  /**
   * Subscribe to a contact's presence.
   * In production: sends SIP SUBSCRIBE to Kamailio for the given URI.
   */
  async subscribe(uri: string, displayName?: string): Promise<void> {
    if (this.subscriptions.has(uri)) return;

    this.subscriptions.set(uri, {
      uri,
      active: true,
      expiresAt: Date.now() + 3600000,
    });

    // Initialize with unknown, then simulate
    const info: PresenceInfo = {
      uri,
      extension: this.extractExtension(uri),
      displayName,
      status: "unknown",
      lastSeen: Date.now(),
      onCall: false,
    };
    this.presenceCache.set(uri, info);

    // Start realistic simulation for this contact
    this.simulatePresenceWithTransitions(uri);
  }

  /**
   * Subscribe by extension number (convenience).
   */
  async subscribeExtension(extension: string, displayName?: string): Promise<void> {
    const uri = `sip:${extension}@${this.sipDomain || "pbx.local"}`;
    await this.subscribe(uri, displayName);
    // Also index by extension for quick lookup
    const info = this.presenceCache.get(uri);
    if (info) {
      info.extension = extension;
      this.presenceCache.set(`ext:${extension}`, info);
    }
  }

  async unsubscribe(uri: string): Promise<void> {
    this.subscriptions.delete(uri);
    // Clear simulation timer
    const timer = this.simulationTimers.get(uri);
    if (timer) {
      clearInterval(timer);
      this.simulationTimers.delete(uri);
    }
    this.presenceCache.delete(uri);
  }

  async subscribeAll(uris: string[]): Promise<void> {
    await Promise.all(uris.map((uri) => this.subscribe(uri)));
  }

  /** Subscribe to multiple extensions with display names */
  async subscribeExtensions(
    extensions: { extension: string; displayName?: string }[]
  ): Promise<void> {
    await Promise.all(
      extensions.map((e) => this.subscribeExtension(e.extension, e.displayName))
    );
  }

  getPresence(uri: string): PresenceInfo | undefined {
    return this.presenceCache.get(uri) || this.presenceCache.get(`ext:${uri}`);
  }

  /** Get presence by extension number */
  getPresenceByExtension(extension: string): PresenceInfo | undefined {
    return this.presenceCache.get(`ext:${extension}`);
  }

  /** Get status for an extension (convenience) */
  getStatusByExtension(extension: string): PresenceStatus {
    return this.getPresenceByExtension(extension)?.status ?? "unknown";
  }

  getAllPresence(): Map<string, PresenceInfo> {
    return new Map(this.presenceCache);
  }

  /** Get all presence as array, excluding ext: aliases */
  getAllPresenceArray(): PresenceInfo[] {
    const result: PresenceInfo[] = [];
    this.presenceCache.forEach((info, key) => {
      if (!key.startsWith("ext:")) result.push(info);
    });
    return result;
  }

  /** Sort contacts by presence availability (available first) */
  sortByAvailability<T extends { number?: string; extension?: string }>(
    contacts: T[]
  ): T[] {
    return [...contacts].sort((a, b) => {
      const extA = a.number || a.extension || "";
      const extB = b.number || b.extension || "";
      const statusA = this.getStatusByExtension(extA);
      const statusB = this.getStatusByExtension(extB);
      return getPresencePriority(statusA) - getPresencePriority(statusB);
    });
  }

  addListener(callback: PresenceListener): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /** Add a typed presence event listener */
  addEventListener(callback: PresenceEventListener): () => void {
    this.eventListeners.add(callback);
    return () => this.eventListeners.delete(callback);
  }

  /** Handle incoming BLF NOTIFY (called from SIP stack) */
  handleBLFNotify(extension: string, dialogState: BLFDialogState): void {
    const uri = `sip:${extension}@${this.sipDomain || "pbx.local"}`;
    const newStatus = dialogStateToPresence(dialogState);
    const info = this.presenceCache.get(uri);
    if (info) {
      const previousStatus = info.status;
      info.status = newStatus;
      info.dialogState = dialogState;
      info.onCall = newStatus === "busy";
      info.lastSeen = Date.now();
      info.statusDuration = 0;
      this.notifyListeners(uri, info);
      // Update ext: alias
      if (info.extension) {
        this.presenceCache.set(`ext:${info.extension}`, info);
      }
      this.emitEvent(extension, previousStatus, newStatus, "blf");
    }
  }

  async destroy(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.simulationTimers.forEach((timer) => clearInterval(timer));
    this.simulationTimers.clear();
    this.subscriptions.clear();
    this.presenceCache.clear();
    this.listeners.clear();
    this.eventListeners.clear();
  }

  // ═══ Private ═══

  /** Generate mock active call info for busy/ringing contacts */
  private generateMockActiveCall(
    index: number,
    parties: { name: string; number: string; internal: boolean }[],
    status: PresenceStatus
  ): ActiveCallInfo {
    const party = parties[Math.abs(index) % parties.length];
    const direction = index % 2 === 0 ? "inbound" as const : "outbound" as const;
    // Busy calls started 30s-10min ago; ringing calls started 2-15s ago
    const elapsed = status === "ringing"
      ? (2 + Math.random() * 13) * 1000
      : (30 + Math.random() * 570) * 1000;
    return {
      remotePartyName: party.name,
      remotePartyNumber: party.number,
      direction,
      startedAt: Date.now() - elapsed,
      isInternal: party.internal,
    };
  }

  private extractExtension(uri: string): string | undefined {
    const match = uri.match(/sip:(\d+)@/);
    return match?.[1];
  }

  private notifyListeners(uri: string, info: PresenceInfo): void {
    this.listeners.forEach((cb) => {
      try { cb(uri, info); } catch (e) { /* ignore */ }
    });
  }

  private emitEvent(
    extension: string,
    previousStatus: PresenceStatus,
    newStatus: PresenceStatus,
    source: PresenceEvent["source"]
  ): void {
    if (previousStatus === newStatus) return;
    const event: PresenceEvent = {
      extension,
      previousStatus,
      newStatus,
      timestamp: Date.now(),
      source,
    };
    this.eventListeners.forEach((cb) => {
      try { cb(event); } catch (e) { /* ignore */ }
    });
  }

  /**
   * Simulate realistic presence transitions for a contact.
   * Uses weighted random state machine for natural-feeling status changes.
   */
  private simulatePresenceWithTransitions(uri: string): void {
    const info = this.presenceCache.get(uri);
    if (!info) return;

    // Assign deterministic initial status based on URI
    const hash = uri.split("").reduce((a, b) => a + b.charCodeAt(0), 0);
    const initialStatuses: PresenceStatus[] = [
      "online", "online", "online", "busy", "away", "dnd", "offline",
    ];
    const initialStatus = initialStatuses[hash % initialStatuses.length];
    const statusTexts: Record<PresenceStatus, string[]> = {
      online:  ["Available", "Ready", ""],
      busy:    ["On a call", "In a meeting", "Do not interrupt"],
      away:    ["Be right back", "Stepped out", "Lunch break"],
      dnd:     ["Focus time", "In a meeting", "Recording"],
      ringing: ["Incoming call", ""],
      offline: ["", "Out of office"],
      unknown: [""],
    };

    // Mock remote parties for busy/ringing contacts
    const mockRemoteParties = [
      { name: "Alice Johnson", number: "+1 (555) 234-5678", internal: false },
      { name: "Bob Williams", number: "ext. 102", internal: true },
      { name: "Carol Davis", number: "+44 20 7946 0958", internal: false },
      { name: "David Chen", number: "ext. 105", internal: true },
      { name: "Emily Brown", number: "+1 (555) 876-5432", internal: false },
      { name: "Frank Miller", number: "ext. 110", internal: true },
      { name: "Grace Lee", number: "+61 2 9876 5432", internal: false },
      { name: "Henry Wilson", number: "ext. 115", internal: true },
      { name: "Iris Taylor", number: "+1 (555) 345-6789", internal: false },
      { name: "Jack Anderson", number: "ext. 120", internal: true },
    ];

    info.status = initialStatus;
    info.statusText = statusTexts[initialStatus][hash % statusTexts[initialStatus].length];
    info.onCall = initialStatus === "busy" || initialStatus === "ringing";
    info.lastSeen = Date.now();
    // Generate active call info for busy/ringing contacts
    if (initialStatus === "busy" || initialStatus === "ringing") {
      info.activeCall = this.generateMockActiveCall(hash, mockRemoteParties, initialStatus);
    } else {
      info.activeCall = undefined;
    }
    this.notifyListeners(uri, info);
    if (info.extension) {
      this.presenceCache.set(`ext:${info.extension}`, info);
    }

    // Simulate periodic transitions (15-45s interval)
    const interval = 15000 + Math.random() * 30000;
    const timer = setInterval(() => {
      if (!this.subscriptions.has(uri)) {
        clearInterval(timer);
        return;
      }

      const currentInfo = this.presenceCache.get(uri);
      if (!currentInfo) return;

      const transitions: Record<PresenceStatus, { next: PresenceStatus; weight: number }[]> = {
        online:  [{ next: "online", weight: 55 }, { next: "busy", weight: 20 }, { next: "away", weight: 12 }, { next: "ringing", weight: 8 }, { next: "dnd", weight: 3 }, { next: "offline", weight: 2 }],
        busy:    [{ next: "busy", weight: 50 }, { next: "online", weight: 35 }, { next: "away", weight: 10 }, { next: "dnd", weight: 5 }],
        away:    [{ next: "away", weight: 40 }, { next: "online", weight: 40 }, { next: "offline", weight: 12 }, { next: "dnd", weight: 8 }],
        dnd:     [{ next: "dnd", weight: 60 }, { next: "online", weight: 30 }, { next: "busy", weight: 10 }],
        ringing: [{ next: "busy", weight: 50 }, { next: "online", weight: 40 }, { next: "ringing", weight: 10 }],
        offline: [{ next: "offline", weight: 70 }, { next: "online", weight: 25 }, { next: "away", weight: 5 }],
        unknown: [{ next: "online", weight: 40 }, { next: "offline", weight: 30 }, { next: "busy", weight: 15 }, { next: "away", weight: 15 }],
      };

      const options = transitions[currentInfo.status] || transitions.unknown;
      const totalWeight = options.reduce((sum, o) => sum + o.weight, 0);
      let rand = Math.random() * totalWeight;
      let nextStatus: PresenceStatus = currentInfo.status;
      for (const opt of options) {
        rand -= opt.weight;
        if (rand <= 0) {
          nextStatus = opt.next;
          break;
        }
      }

      if (nextStatus !== currentInfo.status) {
        const prevStatus = currentInfo.status;
        currentInfo.status = nextStatus;
        currentInfo.statusText =
          statusTexts[nextStatus][Math.floor(Math.random() * statusTexts[nextStatus].length)];
        currentInfo.onCall = nextStatus === "busy" || nextStatus === "ringing";
        currentInfo.lastSeen = Date.now();
        currentInfo.statusDuration = 0;
        // Generate or clear active call info based on new status
        if (nextStatus === "busy" || nextStatus === "ringing") {
          const rndIdx = Math.floor(Math.random() * mockRemoteParties.length);
          currentInfo.activeCall = this.generateMockActiveCall(rndIdx, mockRemoteParties, nextStatus);
        } else {
          currentInfo.activeCall = undefined;
        }
        this.notifyListeners(uri, currentInfo);
        if (currentInfo.extension) {
          this.presenceCache.set(`ext:${currentInfo.extension}`, currentInfo);
        }
        this.emitEvent(currentInfo.extension || uri, prevStatus, nextStatus, "subscribe");
      }
    }, interval);

    this.simulationTimers.set(uri, timer);
  }
}

export const presenceEngine = new PresenceEngine();
