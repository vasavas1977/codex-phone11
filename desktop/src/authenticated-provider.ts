/** Privileged, memory-only Phone11 auth and SIP provisioning for the desktop main process. */
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { DesktopSession } from "./call-boundary";
import type { SipAccountSecret } from "./helper-supervisor";

type Fetch = typeof fetch;
type RecordValue = Record<string, unknown>;
const isRecord = (value: unknown): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const positiveId = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const clean = (value: unknown, limit: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= limit &&
  !/[\r\n\0]/.test(value) && value.trim() === value;
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
  constructor(readonly code: "credentials_rejected" | "auth_unavailable" | "phone_access_unavailable" = "auth_unavailable") {
    super(`Desktop authentication failed: ${code}`);
    this.name = "DesktopAuthenticationError";
  }
}

export class AuthenticatedDesktopProvider {
  private readonly origin: string;
  private readonly request: Fetch;
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
  }

  currentSession(): DesktopSession | null { return this.session; }
  /** Public display number from the current authenticated phone grant. */
  currentExtensionNumber(): string | null { return this.session ? this.extensionNumber : null; }

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
      if (signed.status === 401 || signed.status === 403)
        throw new DesktopAuthenticationError("credentials_rejected");
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
        error.code === "credentials_rejected" ? error.code : phase);
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
      method: "POST", headers: { authorization: `Bearer ${token}` }, signal: controller.signal,
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
      const response = await this.request(`${this.origin}${path}`, {
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

  private async query(path: string, token: string, epoch: number): Promise<unknown> {
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    const response = await this.send(`/api/trpc/${path}?input=${encodeURIComponent('{"json":null}')}`, { headers }, epoch);
    const payload = await this.json(response);
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
