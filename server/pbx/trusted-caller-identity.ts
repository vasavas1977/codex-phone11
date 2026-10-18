/**
 * Detached source candidate only. Nothing in this module qualifies or mounts a
 * production ingress. Its caller must first commission Kamailio's post-digest
 * $au/$ar capture, client-header removal and exclusive authenticated Kam -> FS
 * transport/profile. An HTTP service secret authenticates FS, not a subscriber.
 */
import { isIP } from "node:net";
import { timingSafeEqual } from "node:crypto";
import { parseProtectedOutboundForm, PROTECTED_OUTBOUND_CONTEXT } from "./protected-outbound-routing";

const positiveId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= 2147483647;
const name = (v: unknown): v is string => typeof v === "string" && /^[a-z_][a-z0-9_]{0,62}$/.test(v) && !v.startsWith("pg_");
const oid = (v: unknown): v is string => typeof v === "string" && /^[1-9][0-9]{0,9}$/.test(v) && Number(v) <= 4294967295;
// Match the checked-in subscriber schema's bounded ASCII tuple exactly. No
// trimming, case folding, numeric coercion or From/domain fallback is permitted.
const identity = (v: unknown): v is string => typeof v === "string" && /^[\x21-\x7e]{1,64}$/.test(v) && !v.includes(",");

export interface IdentityReadPin {
  readonly tenantId: number;
  readonly database: string;
  readonly login: string;
  readonly roleOid: string;
  readonly schema: string;
  readonly schemaOid: string;
}
/**
 * A separately commissioned, read-only executor. It must bound connection/query
 * time, verify TLS and role permissions, and resolve only after resource release
 * succeeds. Never supply the fraud-policy LOGIN or the shared privileged pool.
 * There is deliberately no default executor, connection factory or env fallback.
 */
export type DetachedIdentityReadExecutor = (sql: string, parameters: readonly unknown[]) => Promise<{ rows: unknown }>;

export function createCanonicalAssignmentResolver(pin: IdentityReadPin, execute: DetachedIdentityReadExecutor) {
  if (!pin || !positiveId(pin.tenantId) || !name(pin.database) || !name(pin.login) || !name(pin.schema) ||
      !oid(pin.roleOid) || !oid(pin.schemaOid) || typeof execute !== "function") throw new Error("Identity resolver binding unavailable");
  const bound = Object.freeze({ ...pin });
  const table = (value: string) => `"${bound.schema}"."${value}"`;
  // Do not prefilter tenant/status: a foreign or disabled duplicate must remain
  // visible and cause denial. LIMIT 2 preserves the only cardinality we need.
  const sql = `SELECT sa.id AS account_id, sa.tenant_id, sa.extension_id,
    sa.sip_username, sa.sip_domain, sa.status AS account_status, sa.deleted_at AS account_deleted_at,
    sa.user_id AS account_user_id, e.tenant_id AS extension_tenant_id,
    e.sip_username AS extension_sip_username, e.sip_domain AS extension_sip_domain,
    e.user_id AS extension_user_id, e.status AS extension_status, e.deleted_at AS extension_deleted_at,
    t.status AS tenant_status, sub.username AS subscriber_username, sub.domain AS subscriber_domain,
    ue.user_id AS assignment_user_id, tm.user_id AS member_user_id, tm.tenant_id AS member_tenant_id,
    tm.status AS member_status, u.id AS user_id,
    (SELECT count(*) = 1 FROM ${table("extensions")} identity_e
      WHERE COALESCE(NULLIF(identity_e.sip_username, ''), identity_e.extension_number) = $1
        AND COALESCE(NULLIF(identity_e.sip_domain, ''), $2) = $2) AS single_effective_extension_identity,
    (SELECT count(*) = 1 FROM ${table("sip_accounts")} other_sa WHERE other_sa.extension_id = e.id) AS single_extension_account,
    (SELECT count(*) = 1 FROM ${table("user_extensions")} other_ue WHERE other_ue.extension_id = e.id) AS single_extension_assignee,
    (pg_catalog.current_database() = $3 AND current_user = $4 AND session_user = $4
      AND (SELECT r.oid FROM pg_catalog.pg_roles r WHERE r.rolname = current_user) = $5::oid
      AND pg_catalog.to_regnamespace($6)::oid = $7::oid) AS executor_matches
    FROM ${table("sip_accounts")} sa
    LEFT JOIN ${table("extensions")} e ON e.id = sa.extension_id
    LEFT JOIN ${table("tenants")} t ON t.id = sa.tenant_id
    LEFT JOIN ${table("subscriber")} sub ON sub.username = sa.sip_username AND sub.domain = sa.sip_domain
    LEFT JOIN ${table("user_extensions")} ue ON ue.extension_id = e.id
    LEFT JOIN ${table("tenant_memberships")} tm ON tm.user_id = sa.user_id AND tm.tenant_id = sa.tenant_id
    LEFT JOIN ${table("users")} u ON u.id = sa.user_id
    WHERE sa.sip_username = $1 AND sa.sip_domain = $2 LIMIT 2`;
  return async (user: string, realm: string): Promise<Record<string, unknown>[]> => {
    if (!identity(user) || !identity(realm)) return [];
    try {
      const result = await execute(sql, [user, realm, bound.database, bound.login, bound.roleOid, bound.schema, bound.schemaOid]);
      if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) return [];
      const row = result.rows[0];
      if (!row || typeof row !== "object" || row.executor_matches !== true ||
          !positiveId(row.account_id) || !positiveId(row.extension_id) || !positiveId(row.account_user_id) ||
          row.tenant_id !== bound.tenantId || row.extension_tenant_id !== bound.tenantId || row.member_tenant_id !== bound.tenantId ||
          row.extension_user_id !== row.account_user_id || row.assignment_user_id !== row.account_user_id || row.member_user_id !== row.account_user_id || row.user_id !== row.account_user_id ||
          row.sip_username !== user || row.sip_domain !== realm || row.extension_sip_username !== user || row.extension_sip_domain !== realm ||
          row.subscriber_username !== user || row.subscriber_domain !== realm ||
          row.account_status !== "active" || row.account_deleted_at !== null || row.extension_status !== "active" ||
          row.extension_deleted_at !== null || row.tenant_status !== "active" || row.member_status !== "active" ||
          row.single_effective_extension_identity !== true || row.single_extension_account !== true || row.single_extension_assignee !== true) return [];
      // Project only the core's explicit assignment contract; no DB metadata or
      // account credential can escape, even if an executor returns extra fields.
      return [{ tenant_id: row.tenant_id, extension_tenant_id: row.extension_tenant_id, extension_id: row.extension_id,
        sip_username: row.sip_username, sip_domain: row.sip_domain, account_status: row.account_status,
        account_deleted_at: row.account_deleted_at, extension_status: row.extension_status,
        extension_deleted_at: row.extension_deleted_at, tenant_status: row.tenant_status }];
    } catch { return []; }
  };
}

export const DETACHED_PROTECTED_INGRESS_PATH = "/api/freeswitch/protected-dialplan";
export interface DetachedCallerIngressBinding {
  readonly fsHttpPeerIps: readonly string[];
  readonly fsHeaderSecret: string;
  readonly kamSipPeerIps: readonly string[];
  readonly sofiaProfile: string;
}
export interface RawProtectedCallerRequest {
  readonly method: unknown;
  readonly url: unknown;
  readonly remoteAddress: unknown;
  readonly rawHeaders: unknown;
  /** The original IncomingMessage, before any Express body parser. */
  readonly body: AsyncIterable<unknown>;
}
function addresses(values: unknown): values is string[] {
  return Array.isArray(values) && values.length > 0 && values.length <= 8 &&
    values.every(v => typeof v === "string" && isIP(v) !== 0) && new Set(values).size === values.length;
}

/**
 * Detached strict byte boundary, NOT subscriber provenance qualification. Binding
 * arguments come only from reviewed startup configuration, never req.body or a
 * request marker. Forwarded IP headers are ignored. No socket/listener is opened.
 * A future exact endpoint must mount this before global parsers; rejected bytes
 * terminate with protected denial and must never be handed to a legacy router.
 */
export async function readDetachedProtectedCallerRequest(request: RawProtectedCallerRequest, binding: DetachedCallerIngressBinding): Promise<string | null> {
  try {
    if (!binding || !addresses(binding.fsHttpPeerIps) || !addresses(binding.kamSipPeerIps) ||
        typeof binding.fsHeaderSecret !== "string" || !/^[\x21-\x7e]{32,256}$/.test(binding.fsHeaderSecret) ||
        typeof binding.sofiaProfile !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(binding.sofiaProfile)) return null;
    // Copy before the first await so mutable startup objects cannot change the
    // peer/profile binding during streaming or subsequent policy execution.
    const selected = { fsHttpPeerIps: [...binding.fsHttpPeerIps], kamSipPeerIps: [...binding.kamSipPeerIps],
      fsHeaderSecret: binding.fsHeaderSecret, sofiaProfile: binding.sofiaProfile };
    if (request.method !== "POST" || request.url !== DETACHED_PROTECTED_INGRESS_PATH ||
        typeof request.remoteAddress !== "string" || !selected.fsHttpPeerIps.includes(request.remoteAddress) ||
        !Array.isArray(request.rawHeaders) || request.rawHeaders.length === 0 || request.rawHeaders.length > 64 || request.rawHeaders.length % 2) return null;
    const headers = new Map<string, string>();
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      const key = request.rawHeaders[index], value = request.rawHeaders[index + 1];
      if (typeof key !== "string" || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) ||
          typeof value !== "string" || value.length > 1024 || !/^[\x20-\x7e]*$/.test(value)) return null;
      const lower = key.toLowerCase();
      if (headers.has(lower)) return null;
      headers.set(lower, value);
    }
    const secret = headers.get("x-fs-secret"), contentLength = headers.get("content-length");
    if (!secret || secret.length !== selected.fsHeaderSecret.length ||
        !timingSafeEqual(Buffer.from(secret, "ascii"), Buffer.from(selected.fsHeaderSecret, "ascii")) ||
        !/^application\/x-www-form-urlencoded(?:; ?charset=utf-8)?$/i.test(headers.get("content-type") ?? "") ||
        headers.has("content-encoding") || headers.has("transfer-encoding") ||
        !contentLength || !/^[1-9][0-9]{0,3}$/.test(contentLength) || Number(contentLength) > 8192) return null;
    const expected = Number(contentLength), chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of request.body) {
      // IncomingMessage produces Buffer until another parser/setEncoding has
      // touched it. Refuse reconstructed strings and Uint8Array coercions.
      if (!Buffer.isBuffer(chunk) || chunk.length === 0) return null;
      length += chunk.length;
      if (length > expected) return null;
      chunks.push(Buffer.from(chunk));
    }
    if (length !== expected) return null;
    const bytes = Buffer.concat(chunks, length);
    if (bytes.some(byte => byte < 0x20 || byte > 0x7e)) return null;
    const raw = bytes.toString("ascii"), fields = parseProtectedOutboundForm(raw);
    if (!fields || fields.section !== "dialplan" || fields["Caller-Context"] !== PROTECTED_OUTBOUND_CONTEXT ||
        !identity(fields.variable_phone11_authenticated_user) || !identity(fields.variable_phone11_authenticated_realm) ||
        !selected.kamSipPeerIps.includes(fields.variable_sip_received_ip) ||
        fields.variable_sofia_profile_name !== selected.sofiaProfile || fields.variable_call_direction !== "outbound") return null;
    return raw;
  } catch { return null; }
}
