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

import { NativeModules, Platform } from "react-native";
import { useSipAccountStore, type RegistrationState } from "./account-store";
import { useSipCallStore } from "./call-store";
import {
  formatSipError,
  recordPersistentSipDiagnosticEvent,
  type SipDiagnosticCategory,
  type SipDiagnosticContext,
  type SipDiagnosticLevel,
  useSipDiagnosticsStore,
} from "./diagnostics-store";

// react-native-pjsip types
let Endpoint: any = null;
let Call: any = null;

function hostWithPort(host: string, port?: number | null): string {
  if (!port || host.includes(":")) return host;
  return `${host}:${port}`;
}

function sipServerUri(host: string, port: number | null | undefined, transport: string): string {
  const normalizedTransport = transport.toUpperCase();
  const server = hostWithPort(host, port);
  return `sip:${server};transport=${normalizedTransport}`;
}

function sipProxyUri(host: string, port: number | null | undefined, transport: string): string {
  const normalizedTransport = transport.toUpperCase();
  const base = host.startsWith("sip:") ? host : `sip:${hostWithPort(host, port)}`;
  const separator = base.includes(";") ? ";" : ";";
  const withTransport = /;transport=/i.test(base)
    ? base
    : `${base}${separator}transport=${normalizedTransport}`;
  return /;lr(?:;|$)/i.test(withTransport) ? withTransport : `${withTransport};lr`;
}

function safeKeys(value: any): string {
  try {
    const keys = Object.keys(value ?? {}).slice(0, 30);
    return keys.length ? keys.join(",") : "none";
  } catch {
    return "unreadable";
  }
}

function describeNativeValue(value: any): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  const type = typeof value;
  const constructorName = value?.constructor?.name;
  return constructorName ? `${type}:${constructorName}` : type;
}

function trimDiagnosticValue(value: any, maxLength = 180): string {
  const text = String(value ?? "");
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function stringifyMedia(media: any): string {
  if (!Array.isArray(media) || media.length === 0) return "none";

  return media
    .slice(0, 3)
    .map((item, index) => {
      const audioStream = item?.audioStream ?? {};
      return [
        `#${index}`,
        item?.type ? `type=${item.type}` : null,
        item?.status ? `status=${item.status}` : null,
        item?.dir ? `dir=${item.dir}` : null,
        audioStream?.confSlot !== undefined ? `confSlot=${audioStream.confSlot}` : null,
      ]
        .filter(Boolean)
        .join("/");
    })
    .join(", ");
}

function nativeSipModuleKeys(): string {
  try {
    const keys = Object.keys(NativeModules)
      .filter((key) => /pjsip|sip/i.test(key))
      .sort()
      .slice(0, 30);
    return keys.length ? keys.join(",") : "none";
  } catch {
    return "unreadable";
  }
}

function pjsipNativeBridgeContext(): SipDiagnosticContext {
  const bridge = NativeModules.PjSipModule;
  return {
    nativeSipModules: nativeSipModuleKeys(),
    pjsipBridgeType: describeNativeValue(bridge),
    pjsipBridgeKeys: safeKeys(bridge),
    pjsipBridgeStartType: typeof bridge?.start,
  };
}

function addNativeDiagnostic(
  level: SipDiagnosticLevel,
  message: string,
  extra: { detail?: string; context?: SipDiagnosticContext } = {}
): void {
  useSipDiagnosticsStore.getState().addEvent({
    level,
    category: "native",
    message,
    ...extra,
  });
}

// Lazy-load PJSIP only on native platforms (not web)
function getPjsip() {
  if (Platform.OS === "web") return null;
  if (!Endpoint) {
    try {
      const pjsip = require("react-native-pjsip");
      const endpointExport = pjsip.Endpoint ?? pjsip.default?.Endpoint ?? null;
      const callExport = pjsip.Call ?? pjsip.default?.Call ?? null;
      const context = {
        platform: Platform.OS,
        moduleType: describeNativeValue(pjsip),
        moduleKeys: safeKeys(pjsip),
        defaultKeys: safeKeys(pjsip.default),
        endpointExportType: describeNativeValue(endpointExport),
        callExportType: describeNativeValue(callExport),
        nativeSipModules: nativeSipModuleKeys(),
      };

      Endpoint = endpointExport;
      Call = callExport;

      addNativeDiagnostic(
        Endpoint ? "info" : "error",
        Endpoint ? "Loaded react-native-pjsip module" : "react-native-pjsip Endpoint export missing",
        { context }
      );
    } catch (e) {
      console.warn("[SIP Engine] react-native-pjsip not available:", e);
      addNativeDiagnostic("error", "react-native-pjsip require failed", {
        detail: formatSipError(e),
        context: {
          platform: Platform.OS,
          nativeSipModules: nativeSipModuleKeys(),
        },
      });
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
      const registrationServer = sipServerUri(account.domain, account.port, account.transport);
      const outboundProxy = account.proxy
        ? sipProxyUri(account.proxy, account.port, account.transport)
        : sipProxyUri(account.domain, account.port, account.transport);

      setRegistrationState("registering");
      this._diag("info", "registration", "Starting SIP registration", {
        destination: registrationServer,
        detail: `${account.transport}/${account.port}`,
        context: {
          username: account.username,
          domain: account.domain,
          proxy: account.proxy || registrationServer,
          srtp: account.srtp,
          stun: account.stun || "none",
          hasPassword: Boolean(account.password),
          passwordLength: account.password?.length ?? 0,
        },
      });

      // Create PJSIP endpoint
      this._diag("info", "native", "Creating PJSIP endpoint", {
        context: {
          platform: Platform.OS,
          endpointExportType: describeNativeValue(pjsip.Endpoint),
          ...pjsipNativeBridgeContext(),
        },
      });
      await recordPersistentSipDiagnosticEvent({
        level: "info",
        category: "native",
        message: "Native PJSIP endpoint constructor attempt",
        context: {
          stage: "endpoint.constructor",
          platform: Platform.OS,
          endpointExportType: describeNativeValue(pjsip.Endpoint),
          ...pjsipNativeBridgeContext(),
        },
      });

      if (!NativeModules.PjSipModule || typeof NativeModules.PjSipModule.start !== "function") {
        const detail =
          "react-native-pjsip native bridge NativeModules.PjSipModule is missing; rebuild iOS with the legacy React Native bridge enabled and confirm the PjSipModule pod is linked.";
        this._diag("error", "native", "PJSIP native bridge missing", {
          detail,
          context: pjsipNativeBridgeContext(),
        });
        setRegistrationState("failed", detail);
        return;
      }

      const endpoint = new pjsip.Endpoint();
      const endpointContext = {
        endpointInstanceType: describeNativeValue(endpoint),
        endpointKeys: safeKeys(endpoint),
        startType: typeof endpoint?.start,
        createAccountType: typeof endpoint?.createAccount,
        onType: typeof endpoint?.on,
      };

      if (!endpoint || typeof endpoint.start !== "function") {
        const detail = `react-native-pjsip Endpoint constructor returned ${describeNativeValue(endpoint)}; startType=${typeof endpoint?.start}`;
        this._diag("error", "native", "PJSIP endpoint is not usable", {
          detail,
          context: endpointContext,
        });
        setRegistrationState("failed", detail);
        return;
      }

      this.endpoint = endpoint;
      this._diag("info", "native", "PJSIP endpoint created", { context: endpointContext });

      // Configure endpoint
      this._diag("info", "native", "Starting PJSIP endpoint", {
        context: {
          platform: Platform.OS,
          userAgent: `Phone11/1.0 (${Platform.OS})`,
        },
      });
      await recordPersistentSipDiagnosticEvent({
        level: "info",
        category: "native",
        message: "Native PJSIP endpoint start attempt",
        context: {
          stage: "endpoint.start",
          platform: Platform.OS,
          userAgent: `Phone11/1.0 (${Platform.OS})`,
          ...pjsipNativeBridgeContext(),
        },
      });
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
      this._diag("info", "native", "PJSIP endpoint started");
      await recordPersistentSipDiagnosticEvent({
        level: "info",
        category: "native",
        message: "Native PJSIP endpoint start completed",
        context: {
          stage: "endpoint.start.completed",
          platform: Platform.OS,
        },
      });

      this.endpoint.on("registration_changed", (nativeAccount: any) => {
        const snapshot = this._registrationSnapshot(nativeAccount, "event");
        setRegistrationState(snapshot.state, snapshot.detail);
        this._diag(
          snapshot.level,
          "registration",
          `SIP registration ${snapshot.state}`,
          {
            destination: registrationServer,
            detail: snapshot.detail,
            context: snapshot.context,
          }
        );
      });

      // Register SIP account
      this._diag("info", "registration", "Creating SIP account in PJSIP", {
        destination: registrationServer,
        context: {
          username: account.username,
          domain: account.domain,
          proxy: outboundProxy,
          transport: account.transport,
          srtp: account.srtp,
          stun: account.stun || "none",
          hasPassword: Boolean(account.password),
          passwordLength: account.password?.length ?? 0,
        },
      });
      await recordPersistentSipDiagnosticEvent({
        level: "info",
        category: "registration",
        message: "Native PJSIP SIP account create attempt",
        destination: registrationServer,
        context: {
          stage: "endpoint.createAccount",
          username: account.username,
          domain: account.domain,
          proxy: outboundProxy,
          transport: account.transport,
          srtp: account.srtp,
          stun: account.stun || "none",
          hasPassword: Boolean(account.password),
          passwordLength: account.password?.length ?? 0,
        },
      });
      this.pjsipAccount = await this.endpoint.createAccount({
        name: account.displayName || account.username,
        username: account.username,
        domain: account.domain,
        password: account.password,
        proxy: outboundProxy,
        transport: account.transport,
        regOnAdd: true,
        regServer: null,
        regTimeout: 300,
        contactParams: null,
        contactUriParams: null,
        isDefault: true,
        mediaSecureEnabled: account.srtp,
        mediaSecureMandate: false,
        mediaStunEnabled: !!account.stun,
        mediaStunServer: account.stun || null,
      });
      this._diag("info", "registration", "SIP account created in PJSIP", {
        destination: registrationServer,
        context: {
          pjsipAccountType: describeNativeValue(this.pjsipAccount),
          pjsipAccountKeys: safeKeys(this.pjsipAccount),
        },
      });

      const initialSnapshot = this._registrationSnapshot(this.pjsipAccount, "createAccount");
      this._diag("info", "registration", "SIP account initial registration snapshot", {
        destination: registrationServer,
        detail: initialSnapshot.detail,
        context: initialSnapshot.context,
      });

      this._diag("info", "registration", "Native PJSIP auto-registration armed", {
        destination: registrationServer,
        context: {
          stage: "endpoint.createAccount.regOnAdd",
          username: account.username,
          domain: account.domain,
          proxy: outboundProxy,
          transport: account.transport,
          hasPassword: Boolean(account.password),
          passwordLength: account.password?.length ?? 0,
        },
      });
      await recordPersistentSipDiagnosticEvent({
        level: "info",
        category: "registration",
        message: "Native PJSIP auto-registration armed",
        destination: registrationServer,
        context: {
          stage: "endpoint.createAccount.regOnAdd",
          username: account.username,
          domain: account.domain,
          proxy: outboundProxy,
          transport: account.transport,
          hasPassword: Boolean(account.password),
          passwordLength: account.password?.length ?? 0,
        },
      });

      // Listen for incoming calls
      this.endpoint.on("call_received", (call: any) => {
        const callId = this._safeCallId(call);
        this._diag("info", "call", "Incoming SIP call received", {
          callId,
          detail: this._safeCallDetail(call),
        });
        try {
          useSipCallStore.getState().setIncomingCall(call);
        } catch (error) {
          this._diag("error", "call", "Incoming SIP call store update failed", {
            callId,
            detail: formatSipError(error),
          });
        }
      });

      // Listen for call state changes
      this.endpoint.on("call_changed", (call: any) => {
        const callId = this._safeCallId(call);

        try {
          const detail = this._safeCallDetail(call);
          const context = this._safeCallContext(call);
          this._diag("info", "call", "SIP call state changed", { callId, detail, context });
          void recordPersistentSipDiagnosticEvent({
            level: "info",
            category: "call",
            message: "SIP call state event received",
            callId,
            detail,
            context: {
              ...context,
              stage: "call_changed.received",
            },
          });

          if (
            context.state === "PJSIP_INV_STATE_CONFIRMED" ||
            String(context.media).includes("PJSUA_CALL_MEDIA_ACTIVE")
          ) {
            void this._activateAudioSession(callId, "call_changed");
          }

          try {
            useSipCallStore.getState().updateCallState(call);
            this._diag("info", "call", "SIP call store updated", {
              callId,
              context: {
                stage: "call_changed.store_updated",
                state: context.state,
                media: context.media,
              },
            });
          } catch (error) {
            this._diag("error", "call", "SIP call store update failed", {
              callId,
              detail: formatSipError(error),
              context: {
                stage: "call_changed.store_update_failed",
                state: context.state,
                media: context.media,
              },
            });
          }
        } catch (error) {
          this._diag("error", "call", "SIP call state event handling failed", {
            callId,
            detail: formatSipError(error),
            context: {
              stage: "call_changed.handler_failed",
            },
          });
        }
      });

      // Listen for call terminated
      this.endpoint.on("call_terminated", (call: any) => {
        const callId = this._safeCallId(call);
        this._diag("info", "call", "SIP call terminated", {
          callId,
          detail: this._safeCallDetail(call),
        });
        try {
          useSipCallStore.getState().terminateCall(callId);
        } catch (error) {
          this._diag("error", "call", "SIP call termination store update failed", {
            callId,
            detail: formatSipError(error),
          });
        }
      });

      this.initialized = true;
      console.log("[SIP Engine] Initialized, account:", this.pjsipAccount?.getId?.() ?? account.username);
      this._diag("info", "engine", "SIP engine initialized", { destination: registrationServer });
      await recordPersistentSipDiagnosticEvent({
        level: "info",
        category: "engine",
        message: "SIP engine initialized",
        destination: registrationServer,
        context: {
          stage: "engine.initialized",
          username: account.username,
          domain: account.domain,
        },
      });
    } catch (error: any) {
      console.error("[SIP Engine] Initialization failed:", error);
      const detail = formatSipError(error);
      this._diag("error", "engine", "SIP engine initialization failed", { detail });
      await recordPersistentSipDiagnosticEvent({
        level: "error",
        category: "engine",
        message: "SIP engine initialization failed",
        detail,
      });
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
        audioCount: 1,
        videoCount: video ? 1 : 0,
      });

      const callId = call.getId().toString();
      useSipCallStore.getState().addOutgoingCall(call, destination);
      this._diag("info", "call", "Outbound SIP call created", {
        callId,
        destination: uri,
        detail: this._safeCallDetail(call),
        context: this._safeCallContext(call),
      });
      void this._activateAudioSession(callId, "outbound_call_created");
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
      await this.endpoint.answerCall(call, {
        audioCount: 1,
        videoCount: video ? 1 : 0,
      });
      void this._activateAudioSession(callId, "answer_call");
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
      await this.endpoint.hangupCall(call);
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
      if (muted) await this.endpoint.muteCall(call);
      else await this.endpoint.unMuteCall(call);
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
      if (held) await this.endpoint.holdCall(call);
      else await this.endpoint.unholdCall(call);
      this._diag("info", "call", held ? "Held SIP call" : "Resumed SIP call", { callId });
    } catch (e) {
      console.error("[SIP Engine] setHold failed:", e);
      this._diag("error", "call", "Hold control failed", { callId, detail: formatSipError(e) });
    }
  }

  /** Toggle speaker route on active call */
  async setSpeaker(callId: string, speaker: boolean): Promise<void> {
    const call = useSipCallStore.getState().getCall(callId);
    if (!call) return;
    try {
      if (speaker) await this.endpoint.useSpeaker(call);
      else await this.endpoint.useEarpiece(call);
      this._diag("info", "media", speaker ? "Set SIP call audio route to speaker" : "Set SIP call audio route to earpiece", {
        callId,
      });
    } catch (e) {
      console.error("[SIP Engine] setSpeaker failed:", e);
      this._diag("error", "media", "Speaker control failed", { callId, detail: formatSipError(e) });
    }
  }

  /** Send DTMF tone */
  async sendDtmf(callId: string, digit: string): Promise<void> {
    const call = useSipCallStore.getState().getCall(callId);
    if (!call) return;
    try {
      await this.endpoint.dtmfCall(call, digit);
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
      await this.endpoint.xferCall(this.pjsipAccount, call, uri);
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
        if (typeof this.endpoint.stop === "function") {
          await this.endpoint.stop();
        } else {
          this._diag("warning", "engine", "PJSIP endpoint stop is not supported by this native module", {
            context: {
              endpointType: describeNativeValue(this.endpoint),
              endpointKeys: safeKeys(this.endpoint),
            },
          });
        }
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

  private _registrationSnapshot(
    nativeAccount: any,
    source: string
  ): {
    state: RegistrationState;
    level: SipDiagnosticLevel;
    detail?: string;
    context: SipDiagnosticContext;
  } {
    const registration = nativeAccount?.getRegistration?.();
    const rawRegistration = nativeAccount?._data?.registration ?? {};
    const activeRaw = registration?.isActive?.() ?? rawRegistration.active;
    const active = activeRaw === true || activeRaw === "true" || activeRaw === 1 || activeRaw === "1";
    const status = registration?.getStatus?.() ?? rawRegistration.status ?? nativeAccount?.lastStatus ?? nativeAccount?.lastError?.status;
    const statusText = registration?.getStatusText?.() ?? nativeAccount?.lastStatusText;
    const reason = registration?.getReason?.() ?? nativeAccount?.lastError?.reason;
    const rawState = nativeAccount?.state;
    const numericStatus = Number(status);
    const statusLabel = String(status ?? "").trim().toUpperCase();
    const statusTextLabel = String(statusText ?? "").trim().toUpperCase();
    const okStatus = numericStatus === 200 || statusLabel === "OK" || statusTextLabel === "OK";
    const expires = rawRegistration.expires;
    const hasRegistration = rawRegistration.hasRegistration;
    const lastError = rawRegistration.lastError;

    let state: RegistrationState;
    if (rawState) {
      state = this._mapRegState(String(rawState));
    } else if (active || okStatus) {
      state = "registered";
    } else if (Number.isFinite(numericStatus) && numericStatus >= 500) {
      state = "network_error";
    } else if (
      Number.isFinite(numericStatus) &&
      numericStatus >= 400 &&
      numericStatus !== 401 &&
      numericStatus !== 407
    ) {
      state = "failed";
    } else {
      state = "registering";
    }

    const detailParts = [
      status ? `status=${status}` : null,
      statusText ? `statusText=${statusText}` : null,
      reason ? `reason=${reason}` : null,
      expires !== undefined ? `expires=${expires}` : null,
    ].filter(Boolean);

    return {
      state,
      level: state === "failed" || state === "network_error" ? "error" : "info",
      detail: detailParts.length ? detailParts.join(" | ") : undefined,
      context: {
        source,
        accountId: nativeAccount?.getId?.() ?? nativeAccount?._data?.id ?? "unknown",
        uri: nativeAccount?.getURI?.() ?? nativeAccount?._data?.uri ?? "unknown",
        active,
        activeRaw: activeRaw === undefined ? "unknown" : String(activeRaw),
        status: status ?? "none",
        statusText: statusText ?? "none",
        reason: reason ?? "none",
        expires: expires ?? "unknown",
        hasRegistration: hasRegistration ?? "unknown",
        lastError: lastError ?? "unknown",
        rawState: rawState ?? "none",
      },
    };
  }

  private _safeCallDetail(call: any): string {
    try {
      const info = call.getInfo?.() ?? {};
      const state = call.getState?.() ?? info.state;
      const stateText = call.getStateText?.() ?? info.stateText;
      const lastStatusCode = call.getLastStatusCode?.() ?? info.lastStatusCode;
      const lastReason = call.getLastReason?.() ?? info.lastReason;
      const remoteUri = call.getRemoteUri?.() ?? info.remoteUri;
      const connectDuration = call.getConnectDuration?.() ?? info.connectDuration;
      const audioCount = call.getAudioCount?.() ?? info.audioCount;
      const remoteAudioCount = call.getRemoteAudioCount?.() ?? info.remoteAudioCount;
      const media = call.getMedia?.() ?? info.media;
      const parts = [
        state ? `state=${state}` : null,
        stateText ? `stateText=${stateText}` : null,
        lastStatusCode ? `sip=${lastStatusCode}` : null,
        lastReason ? `reason=${lastReason}` : null,
        remoteUri ? `remote=${trimDiagnosticValue(remoteUri)}` : null,
        connectDuration !== undefined ? `connectDuration=${connectDuration}` : null,
        audioCount !== undefined ? `audioCount=${audioCount}` : null,
        remoteAudioCount !== undefined ? `remoteAudioCount=${remoteAudioCount}` : null,
        media ? `media=${stringifyMedia(media)}` : null,
      ].filter(Boolean);

      return parts.join(" | ");
    } catch (error) {
      return `call detail unavailable: ${formatSipError(error)}`;
    }
  }

  private _safeCallContext(call: any): SipDiagnosticContext {
    try {
      const info = call.getInfo?.() ?? {};
      const media = call.getMedia?.() ?? info.media;
      const provisionalMedia = call.getProvisionalMedia?.() ?? info.provisionalMedia;

      return {
        state: call.getState?.() ?? info.state ?? "unknown",
        stateText: call.getStateText?.() ?? info.stateText ?? "unknown",
        lastStatusCode: call.getLastStatusCode?.() ?? info.lastStatusCode ?? "unknown",
        lastReason: call.getLastReason?.() ?? info.lastReason ?? "unknown",
        remoteUri: trimDiagnosticValue(call.getRemoteUri?.() ?? info.remoteUri ?? "unknown"),
        remoteContact: trimDiagnosticValue(call.getRemoteContact?.() ?? info.remoteContact ?? "unknown"),
        connectDuration: call.getConnectDuration?.() ?? info.connectDuration ?? "unknown",
        totalDuration: call.getTotalDuration?.() ?? info.totalDuration ?? "unknown",
        audioCount: call.getAudioCount?.() ?? info.audioCount ?? "unknown",
        remoteAudioCount: call.getRemoteAudioCount?.() ?? info.remoteAudioCount ?? "unknown",
        videoCount: call.getVideoCount?.() ?? info.videoCount ?? "unknown",
        remoteVideoCount: call.getRemoteVideoCount?.() ?? info.remoteVideoCount ?? "unknown",
        media: stringifyMedia(media),
        provisionalMedia: stringifyMedia(provisionalMedia),
      };
    } catch (error) {
      return {
        state: "unknown",
        detailError: formatSipError(error),
      };
    }
  }

  private _safeCallId(call: any): string {
    try {
      const id = call?.getId?.() ?? call?._id ?? call?.id;
      return id === undefined || id === null ? "unknown" : String(id);
    } catch {
      return "unknown";
    }
  }

  private async _activateAudioSession(callId: string, reason: string): Promise<void> {
    if (!this.endpoint || typeof this.endpoint.activateAudioSession !== "function") {
      this._diag("warning", "media", "PJSIP audio session activation is not available", {
        callId,
        context: {
          reason,
          endpointKeys: safeKeys(this.endpoint),
        },
      });
      return;
    }

    try {
      await Promise.race([
        this.endpoint.activateAudioSession(),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("activateAudioSession timed out")), 1500);
        }),
      ]);
      this._diag("info", "media", "PJSIP audio session activated", {
        callId,
        context: { reason },
      });
    } catch (error) {
      this._diag("warning", "media", "PJSIP audio session activation did not confirm", {
        callId,
        detail: formatSipError(error),
        context: { reason },
      });
    }
  }

  private _diag(
    level: "info" | "warning" | "error",
    category: SipDiagnosticCategory,
    message: string,
    extra: { callId?: string; destination?: string; detail?: string; context?: SipDiagnosticContext } = {}
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
