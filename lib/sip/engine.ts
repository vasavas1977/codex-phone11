/**
 * SIP Engine — Phone11
 *
 * Wraps react-native-pjsip to provide:
 *  - SIP account registration against Kamailio proxy
 *  - Outbound call initiation (voice + video)
 *  - Inbound call handling
 *  - Call controls: mute, hold, speaker, transfer, DTMF
 *
 * Architecture:
 *   Phone11 App
 *       ↕ PJSIP (SIP/TLS + SRTP)
 *   Kamailio SIP Proxy (your server)
 *       ↕ SIP
 *   Dinstar SBC (your hardware)
 *       ↕ SIP Trunk
 *   AudioCodes → Zoom Provider Exchange → PSTN
 */

import { Platform } from "react-native";
import { useSipAccountStore, type RegistrationState } from "./account-store";
import { useSipCallStore } from "./call-store";
import { formatSipError, useSipDiagnosticsStore } from "./diagnostics-store";

// react-native-pjsip types
let Endpoint: any = null;
let Call: any = null;

// Lazy-load PJSIP only on native platforms (not web)
function getPjsip() {
  if (Platform.OS === "web") return null;
  if (!Endpoint) {
    try {
      const pjsip = require("react-native-pjsip");
      Endpoint = pjsip.Endpoint;
      Call = pjsip.Call;
    } catch (e) {
      console.warn("[SIP Engine] react-native-pjsip not available:", e);
    }
  }
  return Endpoint ? { Endpoint, Call } : null;
}

class SipEngine {
  private endpoint: any = null;
  private pjsipAccount: any = null;
  private initialized = false;

  /**
   * Initialize PJSIP endpoint and register SIP account.
   * Call this once on app start after loading account config.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const pjsip = getPjsip();
    if (!pjsip) {
      console.log("[SIP Engine] Running on web — SIP disabled");
      this._diag("warning", "engine", "PJSIP unavailable on this platform");
      return;
    }

    const { account, setRegistrationState } = useSipAccountStore.getState();
    if (!account || !account.enabled) {
      console.log("[SIP Engine] No SIP account configured");
      this._diag("warning", "registration", "No enabled SIP account configured");
      return;
    }

    try {
      setRegistrationState("registering");
      this._diag("info", "registration", "Starting SIP registration", {
        destination: account.domain,
        detail: `${account.transport}/${account.port}`,
      });

      // Create PJSIP endpoint
      this.endpoint = new pjsip.Endpoint();

      // Configure endpoint
      await this.endpoint.start({
        service: {
          ua: `Phone11/1.0 (${Platform.OS})`,
        },
        network: {
          useWifi: true,
          use3G: true,
          use4G: true,
          use6G: true,
          useOtherNetworks: true,
          connectOnWifi: false,
        },
        logger: {
          enabled: __DEV__,
          level: 3,
        },
      });

      // Register SIP account
      this.pjsipAccount = await this.endpoint.createAccount({
        name: account.displayName || account.username,
        username: account.username,
        domain: account.domain,
        password: account.password,
        proxy: account.proxy || null,
        transport: account.transport.toLowerCase(),
        regServer: account.domain,
        regTimeout: 300,
        contactParams: null,
        contactUriParams: null,
        isDefault: true,
        mediaSecureEnabled: account.srtp,
        mediaSecureMandate: false,
        mediaStunEnabled: !!account.stun,
        mediaStunServer: account.stun || null,
      });

      // Listen for registration state changes
      this.endpoint.on("registration_changed", (data: any) => {
        const state = this._mapRegState(data.state);
        const detail = data.lastError?.reason;
        setRegistrationState(state, detail);
        this._diag(
          state === "failed" ? "error" : "info",
          "registration",
          `SIP registration ${state}`,
          { destination: account.domain, detail }
        );
      });

      // Listen for incoming calls
      this.endpoint.on("call_received", (call: any) => {
        const callId = call.getId().toString();
        this._diag("info", "call", "Incoming SIP call received", {
          callId,
          detail: this._safeCallDetail(call),
        });
        useSipCallStore.getState().setIncomingCall(call);
      });

      // Listen for call state changes
      this.endpoint.on("call_changed", (call: any) => {
        const callId = call.getId().toString();
        const detail = this._safeCallDetail(call);
        this._diag("info", "call", "SIP call state changed", { callId, detail });
        useSipCallStore.getState().updateCallState(call);
      });

      // Listen for call terminated
      this.endpoint.on("call_terminated", (call: any) => {
        const callId = call.getId().toString();
        this._diag("info", "call", "SIP call terminated", {
          callId,
          detail: this._safeCallDetail(call),
        });
        useSipCallStore.getState().terminateCall(callId);
      });

      this.initialized = true;
      console.log("[SIP Engine] Initialized, account:", this.pjsipAccount?.getId?.() ?? account.username);
      this._diag("info", "engine", "SIP engine initialized", { destination: account.domain });
    } catch (error: any) {
      console.error("[SIP Engine] Initialization failed:", error);
      const detail = formatSipError(error);
      this._diag("error", "engine", "SIP engine initialization failed", { detail });
      useSipAccountStore.getState().setRegistrationState("failed", detail);
    }
  }

  /**
   * Make an outbound voice call.
   * @param destination SIP URI or phone number, e.g. "+66812345678" or "sip:1001@domain.com"
   */
  async makeCall(destination: string, video = false): Promise<string | null> {
    const pjsip = getPjsip();
    if (!pjsip || !this.endpoint || !this.pjsipAccount) {
      console.warn("[SIP Engine] Cannot make call — not initialized");
      this._diag("error", "call", "Cannot make call because SIP is not initialized", { destination });
      return null;
    }

    const { account } = useSipAccountStore.getState();
    if (!account) return null;

    // Normalize destination to SIP URI
    const uri = destination.startsWith("sip:")
      ? destination
      : `sip:${destination}@${account.domain}`;

    try {
      this._diag("info", "call", "Starting outbound SIP call", { destination: uri });
      const call = await this.endpoint.makeCall(this.pjsipAccount, uri, {
        mediaVideo: video,
        mediaAudio: true,
      });

      const callId = call.getId().toString();
      useSipCallStore.getState().addOutgoingCall(call, destination);
      this._diag("info", "call", "Outbound SIP call created", { callId, destination: uri });
      return callId;
    } catch (error: any) {
      console.error("[SIP Engine] makeCall failed:", error);
      this._diag("error", "call", "Outbound SIP call failed", {
        destination: uri,
        detail: formatSipError(error),
      });
      return null;
    }
  }

  /** Answer an incoming call */
  async answerCall(callId: string, video = false): Promise<void> {
    const call = useSipCallStore.getState().getCall(callId);
    if (!call) return;
    try {
      await call.answer({ mediaVideo: video, mediaAudio: true });
      this._diag("info", "call", "Answered SIP call", { callId });
    } catch (e) {
      console.error("[SIP Engine] answerCall failed:", e);
      this._diag("error", "call", "Answer SIP call failed", { callId, detail: formatSipError(e) });
    }
  }

  /** Hang up / decline a call */
  async hangupCall(callId: string): Promise<void> {
    const call = useSipCallStore.getState().getCall(callId);
    if (!call) return;
    try {
      await call.hangup();
      this._diag("info", "call", "Hung up SIP call", { callId });
    } catch (e) {
      console.error("[SIP Engine] hangupCall failed:", e);
      this._diag("error", "call", "Hangup SIP call failed", { callId, detail: formatSipError(e) });
    }
  }

  /** Toggle mute on active call */
  async setMute(callId: string, muted: boolean): Promise<void> {
    const call = useSipCallStore.getState().getCall(callId);
    if (!call) return;
    try {
      if (muted) await call.mute();
      else await call.unmute();
      this._diag("info", "media", muted ? "Muted SIP call" : "Unmuted SIP call", { callId });
    } catch (e) {
      console.error("[SIP Engine] setMute failed:", e);
      this._diag("error", "media", "Mute control failed", { callId, detail: formatSipError(e) });
    }
  }

  /** Toggle hold on active call */
  async setHold(callId: string, held: boolean): Promise<void> {
    const call = useSipCallStore.getState().getCall(callId);
    if (!call) return;
    try {
      if (held) await call.hold();
      else await call.unhold();
      this._diag("info", "call", held ? "Held SIP call" : "Resumed SIP call", { callId });
    } catch (e) {
      console.error("[SIP Engine] setHold failed:", e);
      this._diag("error", "call", "Hold control failed", { callId, detail: formatSipError(e) });
    }
  }

  /** Send DTMF tone */
  async sendDtmf(callId: string, digit: string): Promise<void> {
    const call = useSipCallStore.getState().getCall(callId);
    if (!call) return;
    try {
      await call.dtmf(digit);
      this._diag("info", "media", "Sent SIP DTMF", { callId, detail: digit });
    } catch (e) {
      console.error("[SIP Engine] sendDtmf failed:", e);
      this._diag("error", "media", "DTMF failed", { callId, detail: formatSipError(e) });
    }
  }

  /** Blind transfer call to another extension */
  async transferCall(callId: string, destination: string): Promise<void> {
    const call = useSipCallStore.getState().getCall(callId);
    const { account } = useSipAccountStore.getState();
    if (!call || !account) return;

    const uri = destination.startsWith("sip:")
      ? destination
      : `sip:${destination}@${account.domain}`;

    try {
      await call.xfer(uri);
      this._diag("info", "call", "Transferred SIP call", { callId, destination: uri });
    } catch (e) {
      console.error("[SIP Engine] transferCall failed:", e);
      this._diag("error", "call", "Transfer SIP call failed", { callId, destination: uri, detail: formatSipError(e) });
    }
  }

  /** Unregister and destroy endpoint */
  async destroy(): Promise<void> {
    if (this.endpoint) {
      try {
        await this.endpoint.stop();
      } catch (e) {
        console.error("[SIP Engine] destroy failed:", e);
        this._diag("error", "engine", "SIP engine destroy failed", { detail: formatSipError(e) });
      }
      this.endpoint = null;
      this.pjsipAccount = null;
      this.initialized = false;
    }
  }

  async restart(): Promise<void> {
    await this.destroy();
    await this.initialize();
  }

  private _mapRegState(pjsipState: string): RegistrationState {
    switch (pjsipState) {
      case "none": return "unregistered";
      case "registering": return "registering";
      case "registered": return "registered";
      case "unregistering": return "unregistered";
      default: return "failed";
    }
  }

  private _safeCallDetail(call: any): string {
    const info = call.getInfo?.() ?? {};
    const parts = [
      info.state ? `state=${info.state}` : null,
      info.lastStatusCode ? `sip=${info.lastStatusCode}` : null,
      info.lastReason ? `reason=${info.lastReason}` : null,
      info.remoteUri ? `remote=${info.remoteUri}` : null,
    ].filter(Boolean);

    return parts.join(" | ");
  }

  private _diag(
    level: "info" | "warning" | "error",
    category: "engine" | "registration" | "call" | "media",
    message: string,
    extra: { callId?: string; destination?: string; detail?: string } = {}
  ): void {
    useSipDiagnosticsStore.getState().addEvent({
      level,
      category,
      message,
      ...extra,
    });
  }
}

// Singleton SIP engine instance
export const sipEngine = new SipEngine();
