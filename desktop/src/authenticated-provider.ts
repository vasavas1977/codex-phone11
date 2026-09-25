/** Privileged, memory-only Phone11 auth and SIP provisioning for the desktop main process. */
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { DesktopSession } from "./call-boundary";
import type { SipAccountSecret } from "./helper-supervisor";
import { postNativeCredential } from "./native-credential-request";

type Fetch = typeof fetch;
type RecordValue = Record<string, unknown>;
const isRecord = (value: unknown): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const positiveId = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const clean = (value: unknown, limit: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= limit &&
  !/[\r\n\0]/.test(value) && value.trim() === value;
const meetingId = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const safeMeetingUrl = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "wss:" && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
};
export type DesktopMeetingGrant = Readonly<{ url: string; token: string;
  grantProfile: "interactive" | "listener"; expiresAt: number }>;
export type DesktopMeetingListing = Readonly<{ meetingId: string; title?: string }>;
const safeMeetingTitle = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value === value.normalize("NFC").trim() &&
  Array.from(value).length <= 100 && Buffer.byteLength(value, "utf8") <= 400 &&
  !/[\u0000-\u001f\u007f-\u009f\ud800-\udfff\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(value);
const same = (a: DesktopSession, b: DesktopSession): boolean =>
  a.revision === b.revision && a.userId === b.userId && a.tenantId === b.tenantId &&
  a.extensionId === b.extensionId && a.accountId === b.accountId;
const sameGrant = (a: DesktopSession, b: DesktopSession): boolean =>
  a.userId === b.userId && a.tenantId === b.tenantId &&
  a.extensionId === b.extensionId && a.accountId === b.accountId;

export type AuthenticatedProviderOptions = Readonly<{
  origin: string;
  fetch?: Fetch;
  /** Explicit test-only concession; production must use HTTPS. */
  allowHttpLoopbackForTests?: boolean;
}>;

/** Never attach an upstream error as cause: it may contain a token or SIP secret. */
export class DesktopAuthenticationError extends Error {
  constructor(readonly code: "credentials_rejected" | "origin_rejected" | "email_unverified" |
    "auth_blocked" | "auth_unavailable" | "phone_access_unavailable" = "auth_unavailable") {
    super(`Desktop authentication failed: ${code}`);
    this.name = "DesktopAuthenticationError";
  }
}

export class AuthenticatedDesktopProvider {
  private readonly origin: string;
  private readonly request: Fetch;
  private readonly injectedRequest: boolean;
  private readonly allowHttpLoopbackForTests: boolean;
  private epoch = 0;
  private token: string | null = null;
  private session: DesktopSession | null = null;
  private extensionNumber: string | null = null;
  private fingerprint: string | null = null;
  private readonly fingerprintKey = randomBytes(32);
  private controllers = new Set<AbortController>();

  constructor(options: AuthenticatedProviderOptions) {
    let url: URL;
    try { url = new URL(options.origin); }
    catch { throw new DesktopAuthenticationError(); }
    const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    if ((url.protocol !== "https:" && !(options.allowHttpLoopbackForTests && url.protocol === "http:" && loopback)) ||
        url.username || url.password || url.pathname !== "/" || url.search || url.hash)
      throw new DesktopAuthenticationError();
    this.origin = url.origin;
    this.request = options.fetch ?? fetch;
    this.injectedRequest = options.fetch !== undefined;
    this.allowHttpLoopbackForTests = options.allowHttpLoopbackForTests === true;
  }

  currentSession(): DesktopSession | null { return this.session; }
  /** Public display number from the current authenticated phone grant. */
  currentExtensionNumber(): string | null { return this.session ? this.extensionNumber : null; }

  /** Admitted rooms only. No media credential crosses this privileged boundary. */
  async availableMeetings(expectedRevision: string): Promise<readonly DesktopMeetingListing[]> {
    const { token, epoch } = this.meetingAuthority(expectedRevision);
    const tenantId = this.session!.tenantId;
    const value = await this.query("meetings.availableForTenant", token, epoch, { tenantId });
    this.assertMeetingAuthority(expectedRevision, epoch);
    if (!Array.isArray(value) || value.length > 100 ||
        !value.every(item => isRecord(item) && meetingId(item.meetingId) && item.tenantId === tenantId))
      throw new DesktopAuthenticationError();
    const meetings = new Map<string, DesktopMeetingListing>();
    for (const item of value) {
      const id = item.meetingId as string;
      if (!meetings.has(id)) meetings.set(id, {
        meetingId: id,
        ...(safeMeetingTitle(item.title) ? { title: item.title } : {}),
      });
    }
    return [...meetings.values()];
  }

  /** A short-lived server admission. Never expose this result to the calling renderer. */
  async joinMeeting(expectedRevision: string, selectedMeetingId: string): Promise<DesktopMeetingGrant> {
    if (!meetingId(selectedMeetingId)) throw new DesktopAuthenticationError();
    const { token, epoch } = this.meetingAuthority(expectedRevision);
    const tenantId = this.session!.tenantId;
    const response = await this.send("/api/trpc/meetings.join", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ json: { meetingId: selectedMeetingId, tenantId } }),
    }, epoch);
    const raw = await this.json(response);
    this.assertMeetingAuthority(expectedRevision, epoch);
    const value = this.unwrapTrpc(raw);
    if (!isRecord(value) || !safeMeetingUrl(value.url) || !clean(value.token, 16384) ||
        !["interactive", "listener"].includes(value.grant_profile as string) ||
        !Number.isSafeInteger(value.expires_at) || typeof value.expires_at !== "number" ||
        value.expires_at <= Math.floor(Date.now() / 1000) ||
        value.expires_at > Math.floor(Date.now() / 1000) + 330)
      throw new DesktopAuthenticationError();
    return { url: value.url, token: value.token,
      grantProfile: value.grant_profile as DesktopMeetingGrant["grantProfile"],
      expiresAt: value.expires_at };
  }

  private meetingAuthority(expectedRevision: string): { token: string; epoch: number } {
    if (!this.session || this.session.revision !== expectedRevision || !this.token)
      throw new DesktopAuthenticationError();
    return { token: this.token, epoch: this.epoch };
  }

  private assertMeetingAuthority(expectedRevision: string, epoch: number): void {
    this.assertEpoch(epoch);
    if (!this.session || this.session.revision !== expectedRevision || !this.token)
      throw new DesktopAuthenticationError();
  }

  /** Sign-in never persists the bearer, password, or derived SIP secret. */
  async signIn(email: string, password: string): Promise<DesktopSession> {
    this.clear();
    const epoch = this.epoch;
    if (!clean(email, 320) || typeof password !== "string" || !password || password.length > 4096)
      throw new DesktopAuthenticationError();
    let phase: "auth_unavailable" | "phone_access_unavailable" = "auth_unavailable";
    try {
      const signed = await this.send("/api/auth/sign-in/email", {
        method: "POST", headers: { "content-type": "application/json", "X-Phone11-Client": "native" },
        body: JSON.stringify({ email, password, rememberMe: false }),
      }, epoch);
      if (signed.status === 401)
        throw new DesktopAuthenticationError("credentials_rejected");
      if (signed.status === 403) {
        let remoteCode: unknown;
        let remoteError: unknown;
        try {
          const body = await signed.text();
          if (body.length <= 4096) {
            const parsed = JSON.parse(body) as unknown;
            if (isRecord(parsed)) { remoteCode = parsed.code; remoteError = parsed.error; }
          }
        } catch { /* Never surface an upstream body or parse error. */ }
        if (["INVALID_ORIGIN", "MISSING_OR_NULL_ORIGIN", "CROSS_SITE_NAVIGATION_LOGIN_BLOCKED"].includes(remoteCode as string) ||
            remoteError === "Origin not allowed") throw new DesktopAuthenticationError("origin_rejected");
        if (remoteCode === "EMAIL_NOT_VERIFIED") throw new DesktopAuthenticationError("email_unverified");
        throw new DesktopAuthenticationError("auth_blocked");
      }
      const token = signed.headers.get("set-auth-token");
      if (!signed.ok || !clean(token, 4096)) throw new DesktopAuthenticationError();
      const signInBody = await this.json(signed);
      if (!isRecord(signInBody) || signInBody.success !== true) throw new DesktopAuthenticationError();
      phase = "phone_access_unavailable";
      const bound = await this.lookup(token, epoch);
      this.assertEpoch(epoch);
      this.token = token;
      this.session = bound.session;
      this.extensionNumber = bound.secret.extension;
      this.fingerprint = bound.fingerprint;
      return bound.session;
    } catch (error) {
      if (this.epoch === epoch) this.clear();
      throw new DesktopAuthenticationError(error instanceof DesktopAuthenticationError &&
        ["credentials_rejected", "origin_rejected", "email_unverified", "auth_blocked"].includes(error.code)
        ? error.code : phase);
    }
  }

  /** For DesktopHelperSupervisor.provision; rechecks the current grant every time. */
  async provision(expected: DesktopSession): Promise<SipAccountSecret> {
    const epoch = this.epoch;
    const token = this.token;
    const current = this.session;
    const fingerprint = this.fingerprint;
    if (!token || !current || !fingerprint || !same(expected, current)) throw new DesktopAuthenticationError();
    try {
      const bound = await this.lookup(token, epoch);
      this.assertEpoch(epoch);
      if (this.session !== current || !sameGrant(bound.session, current) || bound.fingerprint !== fingerprint)
        throw new DesktopAuthenticationError();
      return bound.secret;
    } catch {
      if (this.epoch === epoch) this.clear();
      throw new DesktopAuthenticationError();
    }
  }

  /** Invalidates local authority synchronously, then asks the server to revoke it. */
  async signOut(): Promise<void> {
    const token = this.token;
    this.clear();
    if (!token) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try { await this.request(`${this.origin}/api/auth/sign-out`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, Origin: this.origin }, signal: controller.signal,
      cache: "no-store", credentials: "omit", redirect: "error",
    }); } catch { /* Local authority was already removed. */ }
    finally { clearTimeout(timeout); }
  }

  private clear(): void {
    this.epoch++;
    this.token = null;
    this.session = null;
    this.extensionNumber = null;
    this.fingerprint = null;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
  }

  private assertEpoch(epoch: number): void {
    if (epoch !== this.epoch) throw new DesktopAuthenticationError();
  }

  private async send(path: string, init: RequestInit, epoch: number): Promise<Response> {
    this.assertEpoch(epoch);
    const controller = new AbortController();
    this.controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = path === "/api/auth/sign-in/email" && !this.injectedRequest
        ? await postNativeCredential(`${this.origin}${path}`, String(init.body), controller.signal,
          this.allowHttpLoopbackForTests)
        : await this.request(`${this.origin}${path}`, {
          ...init, signal: controller.signal, cache: "no-store", credentials: "omit", redirect: "error",
        });
      this.assertEpoch(epoch);
      return response;
    } finally {
      clearTimeout(timeout);
      this.controllers.delete(controller);
    }
  }

  private async json(response: Response): Promise<unknown> {
    if (!response.ok) throw new DesktopAuthenticationError();
    const body = await response.text();
    if (body.length > 65536) throw new DesktopAuthenticationError();
    try { return JSON.parse(body) as unknown; }
    catch { throw new DesktopAuthenticationError(); }
  }

  private async query(path: string, token: string, epoch: number, input: unknown = null): Promise<unknown> {
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    const response = await this.send(`/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`, { headers }, epoch);
    const payload = await this.json(response);
    return this.unwrapTrpc(payload);
  }

  private unwrapTrpc(payload: unknown): unknown {
    if (!isRecord(payload) || !isRecord(payload.result) || !isRecord(payload.result.data) ||
        !("json" in payload.result.data)) throw new DesktopAuthenticationError();
    return payload.result.data.json;
  }

  private async lookup(token: string, epoch: number): Promise<{
    session: DesktopSession; secret: SipAccountSecret; fingerprint: string;
  }> {
    const me = await this.json(await this.send("/api/auth/me", {
      headers: { authorization: `Bearer ${token}` },
    }, epoch));
    if (!isRecord(me) || !isRecord(me.user) || !positiveId(me.user.id)) throw new DesktopAuthenticationError();
    const userId = String(me.user.id);
    const config = await this.query("phone.getConfig", token, epoch);
    if (!isRecord(config) || config.configured !== true || !positiveId(config.tenantId) ||
        !isRecord(config.extension) || !positiveId(config.extension.id) ||
        typeof config.extension.number !== "string" || !/^[0-9]{1,32}$/.test(config.extension.number) ||
        !isRecord(config.sip) || !clean(config.sip.username, 256) ||
        !clean(config.sip.password, 4096) || !clean(config.sip.domain, 512) ||
        !["TLS", "TCP", "UDP"].includes(config.sip.transport as string))
      throw new DesktopAuthenticationError();
    const tenantId = config.tenantId;
    const number = config.extension.number;
    const extensionId = config.extension.id;
    const accountId = createHash("sha256")
      .update(JSON.stringify([tenantId, extensionId, config.sip.username])).digest("hex");
    const session = Object.freeze({ revision: randomUUID(), userId, tenantId, extensionId, accountId });
    const secret = Object.freeze({ accountId, server: config.sip.domain,
      extension: number, authId: config.sip.username, password: config.sip.password,
      transport: config.sip.transport as "TLS" | "TCP" | "UDP" });
    const fingerprint = createHmac("sha256", this.fingerprintKey)
      .update(JSON.stringify([userId, tenantId, extensionId, number, config.sip.username,
        config.sip.password, config.sip.domain, config.sip.transport])).digest("hex");
    return { session, secret, fingerprint };
  }
}
