/**
 * Phone11 Cloud PBX — WebSocket Server
 * 
 * Provides real-time events to admin portal and softphone clients:
 * - Call state changes (ringing, answered, hangup)
 * - Extension presence (online/offline/busy/dnd)
 * - System alerts (fraud detection, emergency calls)
 * - CDR notifications (new call record)
 */

import { Server as HttpServer } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { getRedis } from "./redis";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WsClient {
  ws: WebSocket;
  tenantId: number;
  userId?: string;
  extension?: string;
  role: "admin" | "user" | "system";
  subscribedChannels: Set<string>;
  lastPing: number;
}

export type WsEventType =
  | "call.ringing"
  | "call.answered"
  | "call.hangup"
  | "call.transfer"
  | "call.hold"
  | "call.unhold"
  | "presence.update"
  | "extension.registered"
  | "extension.unregistered"
  | "cdr.new"
  | "voicemail.new"
  | "alert.fraud"
  | "alert.emergency"
  | "system.info";

export interface WsEvent {
  type: WsEventType;
  tenantId: number;
  timestamp: number;
  data: Record<string, any>;
}

// ─── WebSocket Manager ───────────────────────────────────────────────────────

class WebSocketManager {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, WsClient> = new Map();
  private pingInterval: NodeJS.Timer | null = null;
  private presenceState: Map<string, { status: string; since: number }> = new Map();

  /**
   * Initialize WebSocket server attached to the HTTP server
   */
  init(server: HttpServer): void {
    this.wss = new WebSocketServer({ 
      server, 
      path: "/ws",
      maxPayload: 64 * 1024, // 64KB max message
    });

    this.wss.on("connection", (ws, req) => {
      const clientId = this.generateClientId();
      const url = new URL(req.url || "/", `http://${req.headers.host}`);
      const token = url.searchParams.get("token");
      const tenantId = parseInt(url.searchParams.get("tenant_id") || "1");
      const role = (url.searchParams.get("role") || "user") as "admin" | "user" | "system";
      const extension = url.searchParams.get("extension") || undefined;

      // TODO: Validate JWT token for production
      // For now, accept connections with tenant_id

      const client: WsClient = {
        ws,
        tenantId,
        extension,
        role,
        subscribedChannels: new Set(["all"]),
        lastPing: Date.now(),
      };

      this.clients.set(clientId, client);

      // Mark extension as online
      if (extension) {
        this.updatePresence(tenantId, extension, "online");
      }

      console.log(`[WS] Client connected: ${clientId} (tenant=${tenantId}, ext=${extension}, role=${role})`);

      // Send welcome message with current presence state
      this.sendToClient(clientId, {
        type: "system.info",
        tenantId,
        timestamp: Date.now(),
        data: {
          message: "Connected to Phone11 PBX WebSocket",
          clientId,
          presence: this.getPresenceForTenant(tenantId),
        },
      });

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleClientMessage(clientId, msg);
        } catch (e) {
          ws.send(JSON.stringify({ error: "Invalid JSON" }));
        }
      });

      ws.on("pong", () => {
        client.lastPing = Date.now();
      });

      ws.on("close", () => {
        if (extension) {
          this.updatePresence(tenantId, extension, "offline");
        }
        this.clients.delete(clientId);
        console.log(`[WS] Client disconnected: ${clientId}`);
      });

      ws.on("error", (err) => {
        console.error(`[WS] Client error ${clientId}:`, err.message);
        this.clients.delete(clientId);
      });
    });

    // Ping clients every 30s to detect dead connections
    this.pingInterval = setInterval(() => {
      const now = Date.now();
      for (const [id, client] of this.clients) {
        if (now - client.lastPing > 60000) {
          // No pong in 60s — terminate
          client.ws.terminate();
          this.clients.delete(id);
          console.log(`[WS] Client timed out: ${id}`);
        } else {
          client.ws.ping();
        }
      }
    }, 30000);

    console.log("[WS] WebSocket server initialized on /ws");
  }

  /**
   * Handle incoming messages from clients
   */
  private handleClientMessage(clientId: string, msg: any): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    switch (msg.type) {
      case "subscribe":
        // Subscribe to specific channels (e.g., "calls", "presence", "alerts")
        if (Array.isArray(msg.channels)) {
          msg.channels.forEach((ch: string) => client.subscribedChannels.add(ch));
        }
        break;

      case "unsubscribe":
        if (Array.isArray(msg.channels)) {
          msg.channels.forEach((ch: string) => client.subscribedChannels.delete(ch));
        }
        break;

      case "presence.set":
        // Client sets their own presence status
        if (client.extension && msg.status) {
          this.updatePresence(client.tenantId, client.extension, msg.status);
        }
        break;

      case "ping":
        client.ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
        break;

      default:
        break;
    }
  }

  /**
   * Broadcast an event to all clients in a tenant
   */
  broadcast(event: WsEvent): void {
    const channel = event.type.split(".")[0]; // "call", "presence", "alert", etc.

    for (const [, client] of this.clients) {
      if (client.tenantId !== event.tenantId) continue;
      if (!client.subscribedChannels.has("all") && !client.subscribedChannels.has(channel)) continue;

      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify(event));
      }
    }

    // Also publish to Redis for multi-instance support
    this.publishToRedis(event);
  }

  /**
   * Send event to a specific client
   */
  private sendToClient(clientId: string, event: WsEvent): void {
    const client = this.clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(event));
    }
  }

  /**
   * Send event to a specific extension in a tenant
   */
  sendToExtension(tenantId: number, extension: string, event: WsEvent): void {
    for (const [, client] of this.clients) {
      if (client.tenantId !== tenantId) continue;
      if (client.extension !== extension) continue;
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify(event));
      }
    }
  }

  /**
   * Update extension presence and broadcast
   */
  updatePresence(tenantId: number, extension: string, status: string): void {
    const key = `${tenantId}:${extension}`;
    this.presenceState.set(key, { status, since: Date.now() });

    this.broadcast({
      type: "presence.update",
      tenantId,
      timestamp: Date.now(),
      data: { extension, status },
    });
  }

  /**
   * Get all presence states for a tenant
   */
  getPresenceForTenant(tenantId: number): Record<string, { status: string; since: number }> {
    const result: Record<string, { status: string; since: number }> = {};
    for (const [key, value] of this.presenceState) {
      if (key.startsWith(`${tenantId}:`)) {
        const ext = key.split(":")[1];
        result[ext] = value;
      }
    }
    return result;
  }

  /**
   * Get connected client count for a tenant
   */
  getClientCount(tenantId?: number): number {
    if (!tenantId) return this.clients.size;
    let count = 0;
    for (const [, client] of this.clients) {
      if (client.tenantId === tenantId) count++;
    }
    return count;
  }

  /**
   * Get active calls (extensions with "busy" status)
   */
  getActiveCalls(tenantId: number): string[] {
    const calls: string[] = [];
    for (const [key, value] of this.presenceState) {
      if (key.startsWith(`${tenantId}:`) && value.status === "busy") {
        calls.push(key.split(":")[1]);
      }
    }
    return calls;
  }

  /**
   * Publish event to Redis pub/sub for multi-instance support
   */
  private async publishToRedis(event: WsEvent): Promise<void> {
    try {
      const redis = getRedis();
      if (redis) {
        await redis.publish("pbx:events", JSON.stringify(event));
      }
    } catch (e) {
      // Redis publish is best-effort
    }
  }

  /**
   * Emit call state event (called from CDR processor and FreeSWITCH hooks)
   */
  emitCallEvent(
    tenantId: number,
    type: "call.ringing" | "call.answered" | "call.hangup" | "call.transfer" | "call.hold" | "call.unhold",
    data: {
      callUuid: string;
      from: string;
      to: string;
      direction?: string;
      duration?: number;
      hangupCause?: string;
    }
  ): void {
    // Update presence based on call state
    if (type === "call.ringing" || type === "call.answered") {
      if (data.from) this.updatePresence(tenantId, data.from, "busy");
      if (data.to) this.updatePresence(tenantId, data.to, "busy");
    } else if (type === "call.hangup") {
      if (data.from) this.updatePresence(tenantId, data.from, "online");
      if (data.to) this.updatePresence(tenantId, data.to, "online");
    }

    this.broadcast({
      type,
      tenantId,
      timestamp: Date.now(),
      data,
    });
  }

  /**
   * Emit CDR notification
   */
  emitCdrEvent(tenantId: number, callRecordId: number, summary: any): void {
    this.broadcast({
      type: "cdr.new",
      tenantId,
      timestamp: Date.now(),
      data: { callRecordId, ...summary },
    });
  }

  /**
   * Emit voicemail notification
   */
  emitVoicemailEvent(tenantId: number, extension: string, data: any): void {
    this.broadcast({
      type: "voicemail.new",
      tenantId,
      timestamp: Date.now(),
      data: { extension, ...data },
    });

    // Also send directly to the extension
    this.sendToExtension(tenantId, extension, {
      type: "voicemail.new",
      tenantId,
      timestamp: Date.now(),
      data,
    });
  }

  /**
   * Emit fraud alert
   */
  emitFraudAlert(tenantId: number, data: any): void {
    this.broadcast({
      type: "alert.fraud",
      tenantId,
      timestamp: Date.now(),
      data,
    });
  }

  /**
   * Emit emergency call alert
   */
  emitEmergencyAlert(tenantId: number, data: any): void {
    this.broadcast({
      type: "alert.emergency",
      tenantId,
      timestamp: Date.now(),
      data,
    });
  }

  /**
   * Cleanup on server shutdown
   */
  shutdown(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval as any);
    }
    for (const [, client] of this.clients) {
      client.ws.close(1001, "Server shutting down");
    }
    this.clients.clear();
    if (this.wss) {
      this.wss.close();
    }
  }

  private generateClientId(): string {
    return `ws_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

// Singleton instance
export const wsManager = new WebSocketManager();
