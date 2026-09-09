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
import { getAuthSnapshot } from "../_core/auth";
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

function sipCredentialFingerprint(value?: string | null): string {
  const input = String(value ?? "");
  if (!input) return "none";

  const bytes: number[] = [];
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
      const next = input.charCodeAt(i + 1);
      const scalar = 0x10000 + (((code & 0x3ff) << 10) | (next & 0x3ff));
      bytes.push(
        0xf0 | (scalar >> 18),
        0x80 | ((scalar >> 12) & 0x3f),
        0x80 | ((scalar >> 6) & 0x3f),
        0x80 | (scalar & 0x3f)
      );
      i += 1;
    } else {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }

  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  const words = bytes.slice();
  const bitLength = bytes.length * 8;
  words.push(0x80);
  while ((words.length % 64) !== 56) words.push(0);
  for (let i = 7; i >= 0; i -= 1) words.push((bitLength / Math.pow(2, i * 8)) & 0xff);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  const w = new Array<number>(64);

  for (let offset = 0; offset < words.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      const j = offset + i * 4;
      w[i] = ((words[j] << 24) | (words[j + 1] << 16) | (words[j + 2] << 8) | words[j + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
      const s1 = (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i += 1) {
      const s1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (h + s1 + ch + k[i] + w[i]) >>> 0;
      const s0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((item) => item.toString(16).padStart(8, "0"))
    .join("")
    .slice(0, 16);
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
  private nativeOwnerId: number | null = null;
  private lifecycle: Promise<void> = Promise.resolve();
  private iosAudioSessionActive = false;
  private audioSessionGeneration = 0;
  private audioEndpoint: any = null;
  private audioLifecycle: Promise<void> = Promise.resolve();

  private serializeLifecycle(operation: () => Promise<void>): Promise<void> {
    const task = this.lifecycle.then(operation, operation);
    this.lifecycle = task.catch(() => undefined);
    return task;
  }

  /**
   * Initialize PJSIP endpoint and register SIP account.
   * Call this once on app start after loading account config.
   */
  initialize(): Promise<void> {
    return this.serializeLifecycle(() => this.initializeEndpoint());
  }

  private async initializeEndpoint(): Promise<void> {
    const configured = useSipAccountStore.getState().account;
    if (!configured?.ownerUserId || configured.ownerUserId !== getAuthSnapshot().user?.id) {
      useSipAccountStore.getState().setRegistrationState("unregistered", "Sign in and sync your Phone11 extension");
      return;
    }
    if (this.endpoint && (!this.initialized || this.nativeOwnerId !== configured.ownerUserId)) {
      await this.destroyEndpoint();
    }
    if (this.initialized) {
      const { account, registrationState, registrationError } = useSipAccountStore.getState();
      this._diag("warning", "engine", "SIP engine initialize skipped because endpoint is already active", {
        context: {
          username: account?.username ?? "none",
          domain: account?.domain ?? "none",
          registrationState,
          registrationError: registrationError ?? "none",
        },
      });
      return;
    }

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

      const sipPwPresent = Boolean(account.password);
      const sipPwLen = account.password?.length ?? 0;
      const sipPwFp = sipCredentialFingerprint(account.password);

      setRegistrationState("registering");
      this._diag("info", "registration", "Starting SIP registration", {
        destination: registrationServer,
        detail: `${account.transport}/${account.port}`,
        context: {
          username: account.username,
          domain: account.domain,
          authRealm: account.domain,
          proxy: account.proxy || registrationServer,
          srtp: account.srtp,
          stun: account.stun || "none",
          sipPwPresent,
          sipPwLen,
          sipPwFp,
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
          connectOnWifi: true,
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
          authRealm: account.domain,
          proxy: outboundProxy,
          transport: account.transport,
          srtp: account.srtp,
          stun: account.stun || "none",
          sipPwPresent,
          sipPwLen,
          sipPwFp,
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
          authRealm: account.domain,
          proxy: outboundProxy,
          transport: account.transport,
          srtp: account.srtp,
          stun: account.stun || "none",
          sipPwPresent,
          sipPwLen,
          sipPwFp,
        },
      });
      if (account.ownerUserId !== getAuthSnapshot().user?.id || useSipAccountStore.getState().account !== account) {
        await this.destroyEndpoint();
        return;
      }
      this.nativeOwnerId = account.ownerUserId ?? null;
      this.pjsipAccount = await this.endpoint.createAccount({
        name: account.displayName || account.username,
        username: account.username,
        domain: account.domain,
        password: account.password,
        proxy: outboundProxy,
        transport: account.transport,
        regOnAdd: true,
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
          authRealm: account.domain,
          proxy: outboundProxy,
          transport: account.transport,
          sipPwPresent,
          sipPwLen,
          sipPwFp,
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
          authRealm: account.domain,
          proxy: outboundProxy,
          transport: account.transport,
          sipPwPresent,
          sipPwLen,
          sipPwFp,
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

      if (account.ownerUserId !== getAuthSnapshot().user?.id || useSipAccountStore.getState().account !== account) {
        await this.destroyEndpoint();
        return;
      }
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
    await this.lifecycle;
    const owner = getAuthSnapshot().user?.id;
    if (!owner || owner !== this.nativeOwnerId || useSipAccountStore.getState().account?.ownerUserId !== owner) return null;
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
  destroy(): Promise<void> {
    return this.serializeLifecycle(() => this.destroyEndpoint());
  }

  private async destroyEndpoint(): Promise<void> {
    if (Platform.OS === "ios") await this.handleNativeAudioSession(false, "endpoint_cleanup");
    if (this.endpoint) {
      const endpoint = this.endpoint;
      const account = this.pjsipAccount;
      try {
        const calls = useSipCallStore.getState();
        const pending = new Map(Object.values(calls.activeCalls).map(call => [call.id, call]));
        if (calls.incomingCall) pending.set(calls.incomingCall.id, calls.incomingCall);
        for (const call of pending.values()) {
          if (call.status !== "disconnected" && call._nativeCall) {
            await endpoint.hangupCall(call._nativeCall);
            calls.terminateCall(call.id);
          }
        }
        // Legacy PJSIP has deleteAccount(), not stop(). Remove its registration explicitly.
        if (account) {
          if (typeof endpoint.deleteAccount !== "function") throw new Error("Native account deletion unavailable");
          await endpoint.deleteAccount(account);
          this.pjsipAccount = null;
        }
        if (typeof endpoint.stop === "function") await endpoint.stop();
      } catch (e) {
        this._diag("error", "engine", "Native SIP cleanup failed; close the app before changing accounts");
        this.initialized = false;
        useSipAccountStore.getState().setRegistrationState("failed", "Close Phone11 before changing accounts");
        throw new Error("Phone11 could not stop the previous phone session. Close the app and retry.");
      }
      endpoint.removeAllListeners?.();
      this.endpoint = null;
      this.pjsipAccount = null;
      this.nativeOwnerId = null;
      this.initialized = false;
      useSipAccountStore.getState().setRegistrationState("unregistered");
    }
  }

  restart(): Promise<void> {
    return this.serializeLifecycle(async () => {
      await this.destroyEndpoint();
      await this.initializeEndpoint();
    });
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
    } else if (Number.isFinite(numericStatus) && (numericStatus === 401 || numericStatus === 407)) {
      const numericLastError = Number(lastError);
      const numericExpires = Number(expires);
      const pendingChallenge =
        (!Number.isFinite(numericLastError) || numericLastError === 0) &&
        (!Number.isFinite(numericExpires) || numericExpires > 0);
      state = pendingChallenge ? "registering" : "failed";
    } else if (Number.isFinite(numericStatus) && numericStatus >= 400) {
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

  handleNativeAudioSession(active: boolean, source = "callkit"): Promise<void> {
    if (Platform.OS !== "ios") return Promise.resolve();
    if (active !== this.iosAudioSessionActive) this.audioSessionGeneration += 1;
    this.iosAudioSessionActive = active;
    this._diag("info", "media", active ? "Native audio session activated" : "Native audio session deactivated", { context: { source } });
    if (active) return this._activateAudioSession("system", "callkit_activated");
    this.audioEndpoint = null;
    const endpoint = this.endpoint;
    const operation = this.audioLifecycle.then(async () => {
      if (!endpoint || endpoint !== this.endpoint) return;
      try {
        await endpoint.deactivateAudioSession?.();
        this.audioEndpoint = null;
      } catch (error) {
        this._diag("warning", "media", "PJSIP audio session deactivation failed", { detail: formatSipError(error) });
      }
    });
    this.audioLifecycle = operation.catch(() => undefined);
    return operation;
  }

  private _activateAudioSession(callId: string, reason: string): Promise<void> {
    const endpoint = this.endpoint;
    const generation = this.audioSessionGeneration;
    const operation = this.audioLifecycle.then(async () => {
      if (!endpoint || endpoint !== this.endpoint) return;
      if (Platform.OS === "ios") {
        if (generation !== this.audioSessionGeneration) return;
        if (!this.iosAudioSessionActive) {
          this._diag("info", "media", "PJSIP audio waiting for CallKit activation", { callId, context: { reason } });
          return;
        }
        if (this.audioEndpoint === endpoint) return;
      }
      await this.activateAudioDevice(callId, reason, endpoint, generation);
    });
    this.audioLifecycle = operation.catch(() => undefined);
    return operation;
  }

  private async activateAudioDevice(callId: string, reason: string, endpoint: any, generation: number): Promise<void> {
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

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        endpoint.activateAudioSession(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("activateAudioSession timed out")), 1500);
        }),
      ]);
      if (endpoint === this.endpoint && generation === this.audioSessionGeneration) this.audioEndpoint = endpoint;
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
    } finally {
      if (timer) clearTimeout(timer);
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
