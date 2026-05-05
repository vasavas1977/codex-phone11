/**
 * Phone11 Cloud PBX — FreeSWITCH Event Listener
 * 
 * Connects to FreeSWITCH Event Socket (ESL) to receive real-time call events
 * and broadcasts them via WebSocket to connected clients.
 * 
 * Events monitored:
 * - CHANNEL_CREATE (new call)
 * - CHANNEL_ANSWER (call answered)
 * - CHANNEL_HANGUP (call ended)
 * - CHANNEL_BRIDGE (call connected)
 * - DTMF (digit pressed)
 * - CUSTOM sofia::register (extension registered)
 * - CUSTOM sofia::unregister (extension unregistered)
 */

import net from "net";
import { wsManager } from "./websocket";

interface FsEvent {
  "Event-Name"?: string;
  "Unique-ID"?: string;
  "Caller-Caller-ID-Number"?: string;
  "Caller-Destination-Number"?: string;
  "Call-Direction"?: string;
  "Channel-Call-UUID"?: string;
  "Hangup-Cause"?: string;
  "variable_tenant_id"?: string;
  "variable_duration"?: string;
  "Event-Subclass"?: string;
  "from-user"?: string;
  "contact"?: string;
  [key: string]: string | undefined;
}

class FreeSwitchEventListener {
  private socket: net.Socket | null = null;
  private connected = false;
  private reconnectTimer: NodeJS.Timer | null = null;
  private buffer = "";
  private host: string;
  private port: number;
  private password: string;

  constructor() {
    this.host = process.env.FS_ESL_HOST || "127.0.0.1";
    this.port = parseInt(process.env.FS_ESL_PORT || "8021");
    this.password = process.env.FS_ESL_PASSWORD || "ClueCon";
  }

  /**
   * Start the event listener — connect to FreeSWITCH ESL
   */
  start(): void {
    this.connect();
  }

  private connect(): void {
    if (this.socket) {
      this.socket.destroy();
    }

    this.socket = new net.Socket();
    this.buffer = "";

    this.socket.connect(this.port, this.host, () => {
      console.log(`[ESL] Connected to FreeSWITCH at ${this.host}:${this.port}`);
    });

    this.socket.on("data", (data) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    this.socket.on("close", () => {
      this.connected = false;
      console.log("[ESL] Connection closed, reconnecting in 5s...");
      this.scheduleReconnect();
    });

    this.socket.on("error", (err) => {
      console.error("[ESL] Connection error:", err.message);
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 5000);
  }

  private processBuffer(): void {
    // ESL protocol: headers separated by \n, blank line separates header from body
    while (true) {
      const doubleNewline = this.buffer.indexOf("\n\n");
      if (doubleNewline === -1) break;

      const headerBlock = this.buffer.substring(0, doubleNewline);
      const headers = this.parseHeaders(headerBlock);

      const contentLength = parseInt(headers["Content-Length"] || "0");

      if (contentLength > 0) {
        const bodyStart = doubleNewline + 2;
        if (this.buffer.length < bodyStart + contentLength) {
          break; // Wait for more data
        }
        const body = this.buffer.substring(bodyStart, bodyStart + contentLength);
        this.buffer = this.buffer.substring(bodyStart + contentLength);
        this.handleMessage(headers, body);
      } else {
        this.buffer = this.buffer.substring(doubleNewline + 2);
        this.handleMessage(headers, "");
      }
    }
  }

  private parseHeaders(block: string): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const line of block.split("\n")) {
      const colonIdx = line.indexOf(": ");
      if (colonIdx > 0) {
        headers[line.substring(0, colonIdx)] = decodeURIComponent(line.substring(colonIdx + 2));
      }
    }
    return headers;
  }

  private handleMessage(headers: Record<string, string>, body: string): void {
    const contentType = headers["Content-Type"] || "";

    if (contentType === "auth/request") {
      // Authenticate
      this.send(`auth ${this.password}\n\n`);
      return;
    }

    if (contentType === "command/reply") {
      const reply = headers["Reply-Text"] || "";
      if (reply.startsWith("+OK")) {
        if (!this.connected) {
          this.connected = true;
          // Subscribe to relevant events
          this.send("event plain CHANNEL_CREATE CHANNEL_ANSWER CHANNEL_HANGUP CHANNEL_BRIDGE CUSTOM sofia::register sofia::unregister\n\n");
          console.log("[ESL] Authenticated and subscribed to events");
        }
      } else if (reply.startsWith("-ERR")) {
        console.error("[ESL] Auth failed:", reply);
      }
      return;
    }

    if (contentType === "text/event-plain") {
      const event = this.parseHeaders(body);
      this.handleEvent(event);
    }
  }

  private handleEvent(event: FsEvent): void {
    const eventName = event["Event-Name"];
    const tenantId = parseInt(event["variable_tenant_id"] || "1");
    const uuid = event["Unique-ID"] || event["Channel-Call-UUID"] || "";
    const caller = event["Caller-Caller-ID-Number"] || "";
    const destination = event["Caller-Destination-Number"] || "";
    const direction = event["Call-Direction"] || "internal";

    switch (eventName) {
      case "CHANNEL_CREATE":
        wsManager.emitCallEvent(tenantId, "call.ringing", {
          callUuid: uuid,
          from: caller,
          to: destination,
          direction,
        });
        break;

      case "CHANNEL_ANSWER":
        wsManager.emitCallEvent(tenantId, "call.answered", {
          callUuid: uuid,
          from: caller,
          to: destination,
          direction,
        });
        break;

      case "CHANNEL_BRIDGE":
        // Call connected between two parties
        wsManager.emitCallEvent(tenantId, "call.answered", {
          callUuid: uuid,
          from: caller,
          to: destination,
          direction,
        });
        break;

      case "CHANNEL_HANGUP":
        wsManager.emitCallEvent(tenantId, "call.hangup", {
          callUuid: uuid,
          from: caller,
          to: destination,
          direction,
          hangupCause: event["Hangup-Cause"],
          duration: parseInt(event["variable_duration"] || "0"),
        });
        break;

      case "CUSTOM":
        this.handleCustomEvent(event, tenantId);
        break;
    }
  }

  private handleCustomEvent(event: FsEvent, tenantId: number): void {
    const subclass = event["Event-Subclass"];

    if (subclass === "sofia::register") {
      const extension = event["from-user"] || "";
      const contact = event["contact"] || "";
      console.log(`[ESL] Extension registered: ${extension}`);
      wsManager.updatePresence(tenantId, extension, "online");
      wsManager.broadcast({
        type: "extension.registered",
        tenantId,
        timestamp: Date.now(),
        data: { extension, contact },
      });
    } else if (subclass === "sofia::unregister") {
      const extension = event["from-user"] || "";
      console.log(`[ESL] Extension unregistered: ${extension}`);
      wsManager.updatePresence(tenantId, extension, "offline");
      wsManager.broadcast({
        type: "extension.unregistered",
        tenantId,
        timestamp: Date.now(),
        data: { extension },
      });
    }
  }

  private send(data: string): void {
    if (this.socket && !this.socket.destroyed) {
      this.socket.write(data);
    }
  }

  /**
   * Stop the event listener
   */
  stop(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer as any);
    }
    if (this.socket) {
      this.socket.destroy();
    }
    this.connected = false;
  }
}

export const fsEventListener = new FreeSwitchEventListener();
