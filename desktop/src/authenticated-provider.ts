/** Privileged, memory-only Phone11 auth and SIP provisioning for the desktop main process. */
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { DesktopSession } from "./call-boundary";
import type { SipAccountSecret } from "./helper-supervisor";
import { postNativeCredential } from "./native-credential-request";
import { DesktopCallHistoryError, type DesktopCallHistoryErrorCode } from "./call-history-error";
export { DesktopCallHistoryError } from "./call-history-error";
export type { DesktopCallHistoryErrorCode } from "./call-history-error";

type Fetch = typeof fetch;
type RecordValue = Record<string, unknown>;
const isRecord = (value: unknown): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const positiveId = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const clean = (value: unknown, limit: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= limit &&
  !/[\r\n\0]/.test(value) && value.trim() === value;
const safeDisplay = (value: unknown, limit: number): string | null => {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 && text.length <= limit &&
    !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(text) ? text : null;
};
const safePhoneNumber = (value: unknown): string | null => {
  if (typeof value !== "string" || value.length > 64 || !/^[+0-9*#(). -]*$/.test(value)) return null;
  const text = value.trim();
  return text || null;
};
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
export type DesktopMeetingChannel = Readonly<{ id: string; name: string }>;
export type DesktopMeetingDirectChat = Readonly<{ id: string; name: string; peerId: number; extension: string }>;
export type DesktopMeetingDirectCursor = Readonly<{ peerId: number; id: string }>;
export type DesktopMeetingDirectDetails = Readonly<{ conversationId: string; peerId: number; canStart: boolean }>;
export type DesktopMeetingMember = Readonly<{ id: number; name: string }>;
export type DesktopMeetingChannelDetails = Readonly<{ channelId: string;
  members: readonly DesktopMeetingMember[]; canStart: boolean }>;
/** Public inbox metadata only. Recording media stays behind its own access boundary. */
export type DesktopVoicemail = Readonly<{ id: number; callerName: string | null;
  callerNumber: string | null; durationSeconds: number; status: "new" | "read";
  createdAt: string }>;
export type DesktopCallHistory = Readonly<{ id: number; direction: "inbound" | "outbound" | "internal" | "emergency";
  callerNumber: string | null; calleeNumber: string | null; durationSeconds: number;
  callbackNumber: string | null; disposition: string | null; startedAt: string }>;
export type DesktopCallHistoryCursor = Readonly<{ startedAt: string; id: number }>;
export type DesktopCallHistoryPage = Readonly<{ items: readonly DesktopCallHistory[];
  nextCursor: DesktopCallHistoryCursor | null }>;
export type DesktopDirectoryEntry = Readonly<{ id: number; name: string; number: string }>;
export type DesktopDirectoryPage = Readonly<{ tenantId: number; items: readonly DesktopDirectoryEntry[];
  nextOffset: number | null }>;
export type DesktopTenantChoice = Readonly<{ tenantId: number; name: string }>;
export type DesktopTenantSelection = Readonly<{ selectionRevision: string;
  tenants: readonly DesktopTenantChoice[] }>;
export type DesktopVoicemailAudio = Readonly<{ id: number; mimeType: "audio/wav"; bytes: Uint8Array }>;
const MAX_VOICEMAIL_BYTES = 20 * 1024 * 1024;
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
  private pendingSelection: DesktopTenantSelection | null = null;
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

  /** Public extension labels from the currently selected, authorized tenant. */
  async listDirectory(expectedRevision: string, search: string, offset: number): Promise<DesktopDirectoryPage> {
    const { token, epoch } = this.sessionAuthority(expectedRevision);
    const tenantId = this.session!.tenantId;
    if (typeof search !== "string" || search.length > 64 ||
        /[\u0000-\u001f\u007f-\u009f]/u.test(search) ||
        !Number.isSafeInteger(offset) || offset < 0 || offset > 1000)
      throw new Error("PHONE11_DIRECTORY_INVALID_REQUEST");
    let value: unknown;
    try {
      const response = await this.send(
        `/api/trpc/pbx.directory.list?input=${encodeURIComponent(JSON.stringify({ json: {
          tenantId, search: search.trim(), limit: 25, offset,
        } }))}`,
        { headers: { authorization: `Bearer ${token}` } }, epoch,
      );
      if (!response.ok) throw new Error(response.status === 401 ? "PHONE11_DIRECTORY_UNAUTHORIZED"
        : response.status === 403 ? "PHONE11_DIRECTORY_FORBIDDEN"
        : response.status === 404 ? "PHONE11_DIRECTORY_UNAVAILABLE"
        : "PHONE11_DIRECTORY_REQUEST_FAILED");
      value = this.unwrapTrpc(await this.json(response));
    } catch (error) {
      try { this.assertSessionAuthority(expectedRevision, epoch); }
      catch { throw new Error("PHONE11_DIRECTORY_SESSION_CHANGED"); }
      if (error instanceof Error && error.message.startsWith("PHONE11_DIRECTORY_")) throw error;
      throw new Error("PHONE11_DIRECTORY_REQUEST_FAILED");
    }
    this.assertSessionAuthority(expectedRevision, epoch);
    if (!isRecord(value) || !positiveId(value.tenantId) || !Array.isArray(value.items) ||
        value.items.length > 25 ||
        !(value.nextOffset === null || (Number.isSafeInteger(value.nextOffset) &&
          typeof value.nextOffset === "number" && value.nextOffset > offset && value.nextOffset <= 1025)))
      throw new Error("PHONE11_DIRECTORY_INVALID_RESPONSE");
    if (value.tenantId !== tenantId) throw new Error("PHONE11_DIRECTORY_TENANT_MISMATCH");
    const items = value.items.map((item): DesktopDirectoryEntry => {
      if (!isRecord(item) || !positiveId(item.id) || !clean(item.number, 32) ||
          !/^[0-9]{1,32}$/.test(item.number) || !safeDisplay(item.name, 160))
        throw new Error("PHONE11_DIRECTORY_INVALID_RESPONSE");
      return { id: item.id, name: item.name as string, number: item.number };
    });
    // The server may report one more page after the last permitted offset.
    const nextOffset = value.nextOffset as number | null;
    return { tenantId, items, nextOffset: nextOffset !== null && nextOffset <= 1000 ? nextOffset : null };
  }

  /** The server lists only the signed-in user's selected-tenant voicemail. */
  async listVoicemail(expectedRevision: string): Promise<readonly DesktopVoicemail[]> {
    const { token, epoch } = this.sessionAuthority(expectedRevision);
    const tenantId = this.session!.tenantId;
    const value = await this.query("pbx.voicemail.list", token, epoch, { tenantId });
    this.assertSessionAuthority(expectedRevision, epoch);
    if (!Array.isArray(value) || value.length > 100) throw new DesktopAuthenticationError();
    return value.map((item): DesktopVoicemail => {
      if (!isRecord(item) || item.tenant_id !== this.session!.tenantId || !positiveId(item.id) ||
          !(item.status === "new" || item.status === "read") ||
          typeof item.duration_seconds !== "number" || !Number.isSafeInteger(item.duration_seconds) ||
          item.duration_seconds < 0 || item.duration_seconds > 86400 ||
          typeof item.created_at !== "string" || item.created_at.length > 64 ||
          !Number.isFinite(Date.parse(item.created_at)))
        throw new DesktopAuthenticationError();
      return { id: item.id, callerName: safeDisplay(item.caller_name, 160),
        callerNumber: safeDisplay(item.caller_number, 64), durationSeconds: item.duration_seconds,
        status: item.status, createdAt: item.created_at };
    });
  }

  /** One bounded CDR page for the authenticated member and selected tenant. */
  async listCallHistoryPage(expectedRevision: string, cursor?: DesktopCallHistoryCursor): Promise<DesktopCallHistoryPage> {
    const validTime = (value: unknown): value is string =>
      typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value) &&
      Number.isFinite(Date.parse(value));
    if (cursor && (!positiveId(cursor.id) || !validTime(cursor.startedAt)))
      throw new DesktopCallHistoryError("invalid_response");
    const { token, epoch } = this.sessionAuthority(expectedRevision);
    const tenantId = this.session!.tenantId;
    let value: unknown;
    try {
      const response = await this.send(
        `/api/trpc/pbx.selfService.callHistory?input=${encodeURIComponent(JSON.stringify({ json: { tenantId, limit: 50, ...(cursor ? { cursor } : {}) } }))}`,
        { headers: { authorization: `Bearer ${token}` } }, epoch,
      );
      if (!response.ok) {
        const code: DesktopCallHistoryErrorCode = response.status === 401 ? "unauthorized"
          : response.status === 403 ? "forbidden"
          : response.status === 404 ? "endpoint_unavailable"
          : response.status >= 500 ? "server_error" : "invalid_response";
        throw new DesktopCallHistoryError(code, response.status);
      }
      value = this.unwrapTrpc(await this.json(response));
    } catch (error) {
      if (error instanceof DesktopCallHistoryError) throw error;
      try { this.assertSessionAuthority(expectedRevision, epoch); }
      catch { throw new DesktopCallHistoryError("session_changed"); }
      throw new DesktopCallHistoryError(error instanceof DesktopAuthenticationError ? "invalid_response" : "request_failed");
    }
    try {
      this.assertSessionAuthority(expectedRevision, epoch);
      if (!isRecord(value) || !Array.isArray(value.items) || value.items.length > 50)
        throw new DesktopCallHistoryError("invalid_response");
      if (!positiveId(value.tenantId)) throw new DesktopCallHistoryError("invalid_response");
      if (value.tenantId !== tenantId) throw new DesktopCallHistoryError("tenant_mismatch", 200);
      const rawItems = value.items as unknown[];
      const seen = new Set<number>();
      const calls = rawItems.map((item): DesktopCallHistory => {
        if (!isRecord(item) || (item.tenant_id !== undefined && item.tenant_id !== tenantId) ||
            !positiveId(item.id) || seen.has(item.id) ||
            !["inbound", "outbound", "internal", "emergency"].includes(item.direction as string) ||
            typeof item.total_duration_seconds !== "number" || !Number.isSafeInteger(item.total_duration_seconds) ||
            item.total_duration_seconds < 0 || item.total_duration_seconds > 86400 ||
            !(item.disposition === null || (typeof item.disposition === "string" && item.disposition.length <= 40 &&
              /^[A-Za-z_-]*$/.test(item.disposition))) ||
            !validTime(item.started_at) ||
            !(item.callback_number === null ||
              (typeof item.callback_number === "string" && item.callback_number.length <= 64 &&
                /^[+0-9*#(). -]*$/.test(item.callback_number))))
          throw new DesktopCallHistoryError("invalid_response");
        seen.add(item.id);
        const date = new Date(item.started_at as string);
        return { id: item.id, direction: item.direction as DesktopCallHistory["direction"],
          callerNumber: safePhoneNumber(item.caller_number), calleeNumber: safePhoneNumber(item.callee_number),
          callbackNumber: safePhoneNumber(item.callback_number), durationSeconds: item.total_duration_seconds,
          disposition: item.disposition,
          startedAt: date.toISOString() };
      });
      for (let index = 0; index < rawItems.length; index++) {
        const item = rawItems[index] as RecordValue;
        const priorTime = index === 0 ? cursor?.startedAt : (rawItems[index - 1] as RecordValue).started_at as string;
        const priorId = index === 0 ? cursor?.id : (rawItems[index - 1] as RecordValue).id as number;
        if (priorTime !== undefined && !((item.started_at as string) < priorTime ||
          (item.started_at === priorTime && (item.id as number) < priorId!)))
          throw new DesktopCallHistoryError("invalid_response");
      }
      let nextCursor: DesktopCallHistoryCursor | null = null;
      if (value.nextCursor !== null) {
        const next = value.nextCursor;
        const last = rawItems.at(-1);
        if (!isRecord(next) || calls.length !== 50 || !isRecord(last) ||
            !positiveId(next.id) || next.id !== last.id ||
            !validTime(next.startedAt) || next.startedAt !== last.started_at)
          throw new DesktopCallHistoryError("invalid_response");
        nextCursor = { startedAt: next.startedAt, id: next.id };
      }
      return { items: calls, nextCursor };
    } catch (error) {
      if (error instanceof DesktopCallHistoryError) throw error;
      try { this.assertSessionAuthority(expectedRevision, epoch); }
      catch { throw new DesktopCallHistoryError("session_changed"); }
      throw new DesktopCallHistoryError("invalid_response");
    }
  }

  /** Compatibility for consumers that display only the first page. */
  async listCallHistory(expectedRevision: string): Promise<readonly DesktopCallHistory[]> {
    return (await this.listCallHistoryPage(expectedRevision)).items;
  }

  /** Mark a message read under the server's owner and selected-tenant checks. */
  async markVoicemailRead(expectedRevision: string, id: number): Promise<void> {
    if (!positiveId(id)) throw new DesktopAuthenticationError();
    const { token, epoch } = this.sessionAuthority(expectedRevision);
    const tenantId = this.session!.tenantId;
    const inbox = await this.listVoicemail(expectedRevision);
    this.assertSessionAuthority(expectedRevision, epoch);
    if (!inbox.some(message => message.id === id)) throw new DesktopAuthenticationError();
    this.assertSessionAuthority(expectedRevision, epoch);
    const response = await this.send("/api/trpc/pbx.voicemail.markRead", {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ json: { tenantId, id } }),
    }, epoch);
    const result = this.unwrapTrpc(await this.json(response));
    this.assertSessionAuthority(expectedRevision, epoch);
    if (!isRecord(result) || result.success !== true) throw new DesktopAuthenticationError();
  }

  /**
   * Revalidate the message against a fresh selected-tenant inbox before using
   * its fixed private media route. Audio never leaves this privileged boundary
   * as a URL or bearer credential.
   */
  async voicemailAudio(expectedRevision: string, id: number): Promise<DesktopVoicemailAudio> {
    if (!positiveId(id)) throw new DesktopAuthenticationError();
    const { token, epoch } = this.sessionAuthority(expectedRevision);
    const inbox = await this.listVoicemail(expectedRevision);
    this.assertSessionAuthority(expectedRevision, epoch);
    if (!inbox.some(message => message.id === id)) throw new DesktopAuthenticationError();

    const controller = new AbortController();
    this.controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 30000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await this.request(`${this.origin}/api/recordings/voicemail/${id}`, {
        method: "GET", headers: { authorization: `Bearer ${token}` }, signal: controller.signal,
        cache: "no-store", credentials: "omit", redirect: "error",
      });
      if (controller.signal.aborted) throw new DesktopAuthenticationError();
      this.assertSessionAuthority(expectedRevision, epoch);
      if (response.status !== 200) throw new DesktopAuthenticationError();
      if (!response.body) throw new DesktopAuthenticationError();
      reader = response.body.getReader();
      controller.signal.addEventListener("abort", () => {
        void reader?.cancel().catch(() => undefined);
      }, { once: true });
      const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
      if (contentType !== "audio/wav" && contentType !== "audio/x-wav")
        throw new DesktopAuthenticationError();
      const declared = response.headers.get("content-length");
      if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_VOICEMAIL_BYTES))
        throw new DesktopAuthenticationError();
      const declaredLength = declared === null ? null : Number(declared);
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (controller.signal.aborted) throw new DesktopAuthenticationError();
        this.assertSessionAuthority(expectedRevision, epoch);
        if (done) break;
        total += value.byteLength;
        if (total > MAX_VOICEMAIL_BYTES) throw new DesktopAuthenticationError();
        chunks.push(value);
      }
      if (controller.signal.aborted || total < 12 ||
          (declaredLength !== null && total !== declaredLength))
        throw new DesktopAuthenticationError();
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      if (String.fromCharCode(...bytes.subarray(0, 4)) !== "RIFF" ||
          String.fromCharCode(...bytes.subarray(8, 12)) !== "WAVE")
        throw new DesktopAuthenticationError();
      if (controller.signal.aborted) throw new DesktopAuthenticationError();
      this.assertSessionAuthority(expectedRevision, epoch);
      return { id, mimeType: "audio/wav", bytes };
    } catch {
      try { await reader?.cancel(); } catch { /* Ignore stream cleanup failures. */ }
      throw new DesktopAuthenticationError();
    } finally {
      try { reader?.releaseLock(); } catch { /* Reader may already be cancelled. */ }
      clearTimeout(timeout);
      this.controllers.delete(controller);
    }
  }

  /** Admitted rooms only. No media credential crosses this privileged boundary. */
  async availableMeetings(expectedRevision: string): Promise<readonly DesktopMeetingListing[]> {
    const { token, epoch } = this.sessionAuthority(expectedRevision);
    const tenantId = this.session!.tenantId;
    const value = await this.query("meetings.availableForTenant", token, epoch, { tenantId });
    this.assertSessionAuthority(expectedRevision, epoch);
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

  /** Current channels and member names come from the signed-in tenant's chat service. */
  async meetingChannels(expectedRevision: string): Promise<readonly DesktopMeetingChannel[]> {
    const { token, epoch } = this.sessionAuthority(expectedRevision);
    const tenantId = this.session!.tenantId;
    const value = await this.query("chat.list", token, epoch, { tenantId });
    this.assertSessionAuthority(expectedRevision, epoch);
    if (!isRecord(value) || !isRecord(value.workspace) || value.workspace.id !== tenantId ||
        !Array.isArray(value.channels) || value.channels.length > 200)
      throw new DesktopAuthenticationError();
    const channels = new Map<string, DesktopMeetingChannel>();
    for (const item of value.channels) {
      if (!isRecord(item) || !meetingId(item.id) ||
          !["channel", "group", "direct"].includes(item.kind as string) ||
          !safeMeetingTitle(item.name)) throw new DesktopAuthenticationError();
      if (item.kind !== "direct") channels.set(item.id, { id: item.id, name: item.name as string });
    }
    return [...channels.values()];
  }

  /** Protected selected-tenant search includes older eligible direct chats. */
  async meetingDirectChats(expectedRevision: string, search = "",
    after?: DesktopMeetingDirectCursor): Promise<readonly DesktopMeetingDirectChat[]> {
    if (typeof search !== "string") throw new DesktopAuthenticationError();
    const query = search.trim();
    if ((query.length > 0 && query.length < 2) || query.length > 100 ||
        /[\u0000-\u001f\u007f-\u009f]/u.test(query)) throw new DesktopAuthenticationError();
    if (after !== undefined && (!isRecord(after) || !positiveId(after.peerId) || !meetingId(after.id)))
      throw new DesktopAuthenticationError();
    const { token, epoch } = this.sessionAuthority(expectedRevision);
    const tenantId = this.session!.tenantId;
    const actor = Number(this.session!.userId);
    const value = await this.query("chat.directMeetingChats", token, epoch,
      { tenantId, ...(query ? { search: query } : {}),
        ...(after ? { after: { peerId: after.peerId, id: after.id } } : {}) });
    this.assertSessionAuthority(expectedRevision, epoch);
    if (!positiveId(actor) || !Array.isArray(value) || value.length > 50)
      throw new DesktopAuthenticationError();
    const chats = new Map<string, DesktopMeetingDirectChat>();
    let previous = after;
    for (const item of value) {
      const name = isRecord(item) ? safeDisplay(item.name, 160) : null;
      if (!isRecord(item) || !meetingId(item.id) || !positiveId(item.peerId) ||
          item.peerId === actor || !name || typeof item.extension !== "string" ||
          !/^[0-9]{1,32}$/.test(item.extension) || chats.has(item.id))
        throw new DesktopAuthenticationError();
      if (previous && (item.peerId < previous.peerId ||
          (item.peerId === previous.peerId && item.id.toLowerCase() <= previous.id.toLowerCase())))
        throw new DesktopAuthenticationError();
      chats.set(item.id, { id: item.id, name, peerId: item.peerId, extension: item.extension });
      previous = { peerId: item.peerId, id: item.id };
    }
    return [...chats.values()];
  }

  async meetingDirectDetails(expectedRevision: string, conversationId: string,
    peerId: number): Promise<DesktopMeetingDirectDetails> {
    if (!meetingId(conversationId) || !positiveId(peerId) || peerId === Number(this.session?.userId))
      throw new DesktopAuthenticationError();
    const { token, epoch } = this.sessionAuthority(expectedRevision);
    const tenantId = this.session!.tenantId;
    const capability = await this.query("meetings.directCapabilities", token, epoch, { tenantId, conversationId });
    this.assertSessionAuthority(expectedRevision, epoch);
    if (!isRecord(capability) || typeof capability.available !== "boolean" ||
        typeof capability.canStart !== "boolean" || capability.maxSelectedMembers !== 1)
      throw new DesktopAuthenticationError();
    return { conversationId, peerId,
      canStart: capability.available && capability.canStart };
  }

  async startDirectMeeting(expectedRevision: string, conversationId: string,
    peerId: number, requestId: string): Promise<string> {
    if (!meetingId(conversationId) || !positiveId(peerId) || !meetingId(requestId))
      throw new DesktopAuthenticationError();
    const { token, epoch } = this.sessionAuthority(expectedRevision);
    const tenantId = this.session!.tenantId;
    const details = await this.meetingDirectDetails(expectedRevision, conversationId, peerId);
    this.assertSessionAuthority(expectedRevision, epoch);
    if (!details.canStart || details.peerId !== peerId) throw new DesktopAuthenticationError();
    const response = await this.send("/api/trpc/meetings.startDirectMeeting", {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ json: { tenantId, conversationId, requestId } }),
    }, epoch);
    const value = this.unwrapTrpc(await this.json(response));
    this.assertSessionAuthority(expectedRevision, epoch);
    if (!isRecord(value) || !meetingId(value.meetingId) || value.conversationId !== conversationId ||
        value.invitedMemberId !== peerId) throw new DesktopAuthenticationError();
    return value.meetingId;
  }

  async meetingChannelDetails(expectedRevision: string, channelId: string): Promise<DesktopMeetingChannelDetails> {
    if (!meetingId(channelId)) throw new DesktopAuthenticationError();
    const { token, epoch } = this.sessionAuthority(expectedRevision);
    const tenantId = this.session!.tenantId;
    const [details, capabilities] = await Promise.all([
      this.query("chat.details", token, epoch, { tenantId, id: channelId }),
      this.query("meetings.channelCapabilities", token, epoch, { tenantId, channelId }),
    ]);
    this.assertSessionAuthority(expectedRevision, epoch);
    if (!isRecord(details) || !Array.isArray(details.members) || details.members.length > 100 ||
        !isRecord(capabilities) || typeof capabilities.canStart !== "boolean" ||
        typeof capabilities.available !== "boolean" || capabilities.maxSelectedMembers !== 50)
      throw new DesktopAuthenticationError();
    const actor = Number(this.session!.userId);
    const seen = new Set<number>();
    const members = details.members.map((item): DesktopMeetingMember => {
      if (!isRecord(item) || !positiveId(item.id) || !safeDisplay(item.name, 160) || seen.has(item.id))
        throw new DesktopAuthenticationError();
      seen.add(item.id);
      return { id: item.id, name: item.name as string };
    }).filter(item => item.id !== actor);
    if (!seen.has(actor)) throw new DesktopAuthenticationError();
    return { channelId, members, canStart: capabilities.available && capabilities.canStart };
  }

  /** The request UUID is generated by the privileged process and never reused across selections. */
  async startChannelMeeting(expectedRevision: string, channelId: string,
    selectedMemberIds: readonly number[], requestId: string): Promise<string> {
    if (!meetingId(channelId) || !meetingId(requestId) || !Array.isArray(selectedMemberIds) ||
        selectedMemberIds.length > 50 || selectedMemberIds.some(id => !positiveId(id)) ||
        new Set(selectedMemberIds).size !== selectedMemberIds.length)
      throw new DesktopAuthenticationError();
    const { token, epoch } = this.sessionAuthority(expectedRevision);
    const tenantId = this.session!.tenantId;
    const details = await this.meetingChannelDetails(expectedRevision, channelId);
    this.assertSessionAuthority(expectedRevision, epoch);
    if (!details.canStart || selectedMemberIds.some(id => !details.members.some(member => member.id === id)))
      throw new DesktopAuthenticationError();
    const response = await this.send("/api/trpc/meetings.startChannelMeeting", {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ json: { tenantId, channelId, selectedMemberIds, requestId } }),
    }, epoch);
    const value = this.unwrapTrpc(await this.json(response));
    this.assertSessionAuthority(expectedRevision, epoch);
    if (!isRecord(value) || !meetingId(value.meetingId) || value.channelId !== channelId ||
        !Array.isArray(value.invitedMemberIds) || value.invitedMemberIds.length !== selectedMemberIds.length ||
        !selectedMemberIds.every(id => (value.invitedMemberIds as unknown[]).includes(id)))
      throw new DesktopAuthenticationError();
    return value.meetingId;
  }

  /** A short-lived server admission. Never expose this result to the calling renderer. */
  async joinMeeting(expectedRevision: string, selectedMeetingId: string): Promise<DesktopMeetingGrant> {
    if (!meetingId(selectedMeetingId)) throw new DesktopAuthenticationError();
    const { token, epoch } = this.sessionAuthority(expectedRevision);
    const tenantId = this.session!.tenantId;
    const response = await this.send("/api/trpc/meetings.join", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ json: { meetingId: selectedMeetingId, tenantId } }),
    }, epoch);
    const raw = await this.json(response);
    this.assertSessionAuthority(expectedRevision, epoch);
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

  private sessionAuthority(expectedRevision: string): { token: string; epoch: number } {
    if (!this.session || this.session.revision !== expectedRevision || !this.token)
      throw new DesktopAuthenticationError();
    return { token: this.token, epoch: this.epoch };
  }

  private assertSessionAuthority(expectedRevision: string, epoch: number): void {
    this.assertEpoch(epoch);
    if (!this.session || this.session.revision !== expectedRevision || !this.token)
      throw new DesktopAuthenticationError();
  }

  /** Sign-in never persists the bearer, password, or derived SIP secret. */
  async signIn(email: string, password: string): Promise<DesktopSession | DesktopTenantSelection> {
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
      const tenants = await this.tenantChoices(token, epoch);
      this.token = token;
      if (tenants.length > 1) {
        const selection = Object.freeze({ selectionRevision: randomUUID(), tenants });
        this.pendingSelection = selection;
        return selection;
      }
      const bound = await this.lookup(token, epoch, tenants[0].tenantId);
      this.assertEpoch(epoch);
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

  /** A multi-workspace account must choose from the server's active memberships. */
  async selectTenant(selectionRevision: string, tenantId: number): Promise<DesktopSession> {
    const pending = this.pendingSelection;
    const token = this.token;
    const epoch = this.epoch;
    if (!pending || !token || this.session || pending.selectionRevision !== selectionRevision ||
        !positiveId(tenantId) || !pending.tenants.some(choice => choice.tenantId === tenantId))
      throw new DesktopAuthenticationError("phone_access_unavailable");
    try {
      const fresh = await this.tenantChoices(token, epoch);
      if (!fresh.some(choice => choice.tenantId === tenantId)) throw new DesktopAuthenticationError();
      const bound = await this.lookup(token, epoch, tenantId);
      this.assertEpoch(epoch);
      if (this.pendingSelection !== pending) throw new DesktopAuthenticationError();
      this.pendingSelection = null;
      this.session = bound.session;
      this.extensionNumber = bound.secret.extension;
      this.fingerprint = bound.fingerprint;
      return bound.session;
    } catch {
      if (this.epoch === epoch) this.clear();
      throw new DesktopAuthenticationError("phone_access_unavailable");
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
      const bound = await this.lookup(token, epoch, current.tenantId);
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
    this.pendingSelection = null;
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

  private async tenantChoices(token: string, epoch: number): Promise<readonly DesktopTenantChoice[]> {
    const value = await this.query("pbx.memberships", token, epoch);
    if (!Array.isArray(value) || value.length < 1 || value.length > 100)
      throw new DesktopAuthenticationError();
    const seen = new Set<number>();
    return value.map((item): DesktopTenantChoice => {
      if (!isRecord(item) || !positiveId(item.tenantId) || item.tenantStatus !== "active" ||
          !safeDisplay(item.tenantName, 160) || seen.has(item.tenantId))
        throw new DesktopAuthenticationError();
      seen.add(item.tenantId);
      return Object.freeze({ tenantId: item.tenantId, name: item.tenantName as string });
    });
  }

  private async lookup(token: string, epoch: number, selectedTenantId: number): Promise<{
    session: DesktopSession; secret: SipAccountSecret; fingerprint: string;
  }> {
    const me = await this.json(await this.send("/api/auth/me", {
      headers: { authorization: `Bearer ${token}` },
    }, epoch));
    if (!isRecord(me) || !isRecord(me.user) || !positiveId(me.user.id)) throw new DesktopAuthenticationError();
    const userId = String(me.user.id);
    const config = await this.query("phone.getConfig", token, epoch, { tenantId: selectedTenantId });
    if (!isRecord(config) || config.configured !== true || config.tenantId !== selectedTenantId ||
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
