import { SaxesParser } from "saxes";
import type { RequestHandler } from "express";
import { integrationSecretStatus } from "./integration-auth";
import { trustedRecordingRoute } from "../cloud-recordings/correlation";
import { query } from "./db";

export class CdrInputError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

/** mod_xml_cdr supports HTTP Basic credentials, not custom HTTP headers. */
export const requireCdrAuth: RequestHandler = (req, res, next) => {
  let supplied: unknown = req.headers["x-fs-secret"];
  if (supplied === undefined) {
    const authorization = req.headers.authorization;
    if (typeof authorization === "string" && authorization.length <= 8192) {
      const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(authorization);
      if (match) {
        const decoded = Buffer.from(match[1], "base64").toString("utf8");
        const prefix = "phone11-cdr:";
        if (decoded.startsWith(prefix)) supplied = decoded.slice(prefix.length);
      }
    }
  }
  const status = integrationSecretStatus("FS_SHARED_SECRET", supplied);
  if (status !== "ok") {
    res.status(status === "unavailable" ? 503 : 403).json({ error: status === "unavailable" ? "Integration is not configured" : "Forbidden" });
    return;
  }
  next();
};

const MAX_XML_BYTES = 512 * 1024;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** Read only the channel's own variables; bridge/parent callflow data is never ownership evidence. */
export function parseCdrBody(body: unknown): { variables: Record<string, string> } {
  const input = object(body) && Object.hasOwn(body, "cdr") ? body.cdr : body;
  let raw: Record<string, unknown>;
  if (typeof input === "string") {
    if (Buffer.byteLength(input) > MAX_XML_BYTES) throw new CdrInputError(413, "CDR is too large");
    raw = Object.create(null);
    const stack: string[] = [];
    let variablesSeen = false;
    let variableCount = 0;
    let text = "";
    const parser = new SaxesParser();
    const invalid = () => { throw new CdrInputError(400, "Invalid XML CDR"); };
    parser.on("error", invalid);
    parser.on("doctype", invalid);
    parser.on("opentag", tag => {
      stack.push(tag.name);
      if (stack.length > 32 || (stack.length === 1 && tag.name !== "cdr")) invalid();
      if (stack.length === 2 && tag.name === "variables") {
        if (variablesSeen) invalid();
        variablesSeen = true;
      }
      if (stack[1] === "variables") {
        if (stack.length > 3 || Object.keys(tag.attributes).length) invalid();
        if (stack.length === 3) {
          if (++variableCount > 2048 || Object.hasOwn(raw, tag.name)) invalid();
          text = "";
        }
      }
    });
    const append = (value: string) => { if (stack.length === 3 && stack[1] === "variables") { text += value; if (text.length > 65536) invalid(); } };
    parser.on("text", append);
    parser.on("cdata", append);
    parser.on("closetag", () => {
      if (stack.length === 3 && stack[1] === "variables") {
        // Native switch_ivr_set_xml_chan_vars always URL-encodes values.
        // Decode exactly once after the separate application/x-www-form-urlencoded layer.
        try { raw[stack[2]] = decodeURIComponent(text); } catch { invalid(); }
      }
      stack.pop();
    });
    parser.write(input).close();
    if (!variablesSeen) invalid();
  } else if (object(input) && object(input.variables)) {
    raw = { ...input.variables };
    raw.uuid ??= input.uuid ?? input.call_uuid;
  } else throw new CdrInputError(400, "A channel CDR is required");

  const variables: Record<string, string> = Object.create(null);
  if (Object.keys(raw).length > 2048) throw new CdrInputError(400, "Too many CDR variables");
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "string" && typeof value !== "number") throw new CdrInputError(400, "Invalid CDR variable");
    if (String(value).length > 65536) throw new CdrInputError(413, "CDR variable is too large");
    variables[key] = String(value);
  }
  if (!uuidPattern.test(variables.uuid ?? "")) throw new CdrInputError(400, "A channel UUID is required");
  if ((variables.sip_call_id?.length ?? 0) > 512) throw new CdrInputError(400, "Invalid SIP Call-ID");
  return { variables };
}

export async function resolveCdrTenant(cdr: { variables: Record<string, string> }): Promise<void> {
  const route = await trustedRecordingRoute(cdr.variables.uuid, cdr.variables.sip_call_id);
  const explicit = cdr.variables.tenant_id;
  const tenantId = explicit === undefined || explicit === "" ? route?.tenantId : Number(explicit);
  if (!Number.isSafeInteger(tenantId) || !tenantId || tenantId <= 0) throw new CdrInputError(400, "An explicit or trusted channel tenant is required");
  if (route && route.tenantId !== tenantId) throw new CdrInputError(403, "Trusted call tenant mismatch");
  const tenant = await query("SELECT id FROM tenants WHERE id = $1 AND status = 'active'", [tenantId]);
  if (!tenant.rows.length) throw new CdrInputError(403, "Unknown tenant");
  cdr.variables.tenant_id = String(tenantId);
}
