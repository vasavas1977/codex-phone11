import { lookup as dnsLookup } from "node:dns/promises";
import * as http from "node:http";
import * as https from "node:https";
import { isIP } from "node:net";

const MAX_BODY_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 2;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 20;
const MAX_RATE_KEYS = 10_000;

export type LinkPreview = { title: string | null; description: string | null; domain: string };
export type ResolvedAddress = { address: string; family: 4 | 6 };
export type LinkPreviewResponse = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
};

export class LinkPreviewError extends Error {
  constructor(public readonly code: "invalid_url" | "unsafe_url" | "rate_limited" | "unavailable") {
    super(code);
  }
}

type Dependencies = {
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>;
  request?: (url: URL, address: ResolvedAddress) => Promise<LinkPreviewResponse>;
  now?: () => number;
};

function hostForChecks(url: URL) { return url.hostname.replace(/^\[|\]$/g, "").toLowerCase(); }

function isPublicIpv4(address: string) {
  const bytes = address.split(".").map(Number);
  if (bytes.length !== 4 || bytes.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) return false;
  const [a, b, c] = bytes;
  // Reject unspecified, loopback, link-local, RFC1918, shared, documentation,
  // benchmarking, multicast, and future-reserved ranges. This deliberately
  // treats ranges without globally-routable semantics as unsafe for previews.
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168)) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function isPublicIpv6(address: string) {
  // Parse the textual form rather than matching a compressed spelling. Node's
  // DNS result may legally expand ::1 or ::ffff:127.0.0.1, and those forms
  // must never become fetch targets merely because their shorthand differs.
  if (address.includes(".")) return false; // Reject every IPv4-embedded form.
  const split = address.toLowerCase().split("::");
  if (split.length > 2) return false;
  const left = split[0] ? split[0].split(":") : [];
  const right = split.length === 2 && split[1] ? split[1].split(":") : [];
  if ((split.length === 1 && left.length !== 8) || (split.length === 2 && left.length + right.length > 7)) return false;
  const groups = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  if (groups.length !== 8 || groups.some(group => !/^[0-9a-f]{1,4}$/.test(group))) return false;
  const values = groups.map(group => Number.parseInt(group, 16));
  // Permit only globally-routable 2000::/3 space. This excludes unspecified,
  // loopback (including expanded), IPv4-compatible/mapped/translated, ULA,
  // link-local, multicast, and NAT64 prefix ranges by construction.
  if (values[0] < 0x2000 || values[0] > 0x3fff) return false;
  // Exclude assigned transition, benchmarking, anycast and documentation
  // space within 2001::/16, plus the 6to4 relay/embedded-IPv4 prefix.
  if (values[0] === 0x2001 && (values[1] <= 0x00ff || values[1] === 0x0db8)) return false;
  if (values[0] === 0x2002) return false;
  return true;
}

export function isPublicAddress(address: string) {
  const family = isIP(address);
  return family === 4 ? isPublicIpv4(address) : family === 6 ? isPublicIpv6(address) : false;
}

function validateUrl(input: string) {
  let url: URL;
  try { url = new URL(input); } catch { throw new LinkPreviewError("invalid_url"); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new LinkPreviewError("unsafe_url");
  if (url.username || url.password || !url.hostname) throw new LinkPreviewError("unsafe_url");
  if (url.port && !((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443"))) {
    throw new LinkPreviewError("unsafe_url");
  }
  // URL normalizes decimal/hex/octal IPv4 spellings, so this rejects both raw
  // literal IPs and the ambiguous numeric host forms which normalize into one.
  if (isIP(hostForChecks(url))) throw new LinkPreviewError("unsafe_url");
  return url;
}

async function resolvePublic(url: URL, resolve: NonNullable<Dependencies["resolve"]>) {
  let addresses: ResolvedAddress[];
  try { addresses = await withTimeout(resolve(hostForChecks(url)), REQUEST_TIMEOUT_MS); } catch { throw new LinkPreviewError("unavailable"); }
  if (!addresses.length || addresses.some(address => !isPublicAddress(address.address))) throw new LinkPreviewError("unsafe_url");
  return addresses[0];
}

function withTimeout<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new LinkPreviewError("unavailable")), timeoutMs);
    void task.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

function headerValue(headers: LinkPreviewResponse["headers"], name: string) {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function decodeEntities(value: string) {
  return value.replace(/&(amp|quot|apos|lt|gt);/gi, (_match, entity) => ({ amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" }[String(entity).toLowerCase()]!));
}
function text(value: string, max: number) {
  const normalized = decodeEntities(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
  return normalized ? normalized.slice(0, max) : null;
}
function attribute(tag: string, attributeName: string) {
  const match = new RegExp(`\\b${attributeName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}
function metadata(html: string, domain: string): LinkPreview {
  const titleTag = /<title\b[^>]*>([\s\S]{0,4096}?)<\/title\s*>/i.exec(html)?.[1] ?? "";
  let title = text(titleTag, 240);
  let description: string | null = null;
  // A `>` may appear inside a quoted description, so do not stop the tag
  // scanner there. This remains metadata-only parsing, not a document parser.
  for (const tag of html.match(/<meta\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi) || []) {
    const key = (attribute(tag, "property") || attribute(tag, "name") || "").toLowerCase();
    const content = attribute(tag, "content");
    if (!content) continue;
    if (!title && (key === "og:title" || key === "twitter:title")) title = text(content, 240);
    if (!description && (key === "description" || key === "og:description" || key === "twitter:description")) description = text(content, 500);
  }
  return { title, description, domain };
}

async function nodeRequest(url: URL, address: ResolvedAddress): Promise<LinkPreviewResponse> {
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    let settled = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true; if (deadline) clearTimeout(deadline); reject(error);
    };
    const resolveOnce = (value: LinkPreviewResponse) => {
      if (settled) return;
      settled = true; if (deadline) clearTimeout(deadline); resolve(value);
    };
    const request = client.request({
      protocol: url.protocol,
      hostname: hostForChecks(url),
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: "GET",
      agent: false,
      headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "Phone11-LinkPreview/1.0" },
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
      servername: url.protocol === "https:" ? hostForChecks(url) : undefined,
    }, response => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          request.destroy(new LinkPreviewError("unavailable"));
          rejectOnce(new LinkPreviewError("unavailable"));
          return;
        }
        chunks.push(chunk);
      });
      response.once("error", () => rejectOnce(new LinkPreviewError("unavailable")));
      response.once("end", () => resolveOnce({ status: response.statusCode || 0, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.once("error", error => rejectOnce(error instanceof LinkPreviewError ? error : new LinkPreviewError("unavailable")));
    // Socket inactivity is insufficient against a response that drips bytes.
    // Keep a separate absolute deadline for the full request and body read.
    deadline = setTimeout(() => {
      request.destroy(new LinkPreviewError("unavailable"));
      rejectOnce(new LinkPreviewError("unavailable"));
    }, REQUEST_TIMEOUT_MS);
    request.end();
  });
}

export function createLinkPreview(dependencies: Dependencies = {}) {
  const resolve = dependencies.resolve || (async (hostname: string) => (await dnsLookup(hostname, { all: true, verbatim: true })).map(address => ({ ...address, family: address.family as 4 | 6 })));
  const request = dependencies.request || nodeRequest;
  const now = dependencies.now || Date.now;
  const calls = new Map<string, number[]>();

  return async ({ tenantId, userId, url: input }: { tenantId: number; userId: number; url: string }): Promise<LinkPreview> => {
    const rateKey = `${tenantId}:${userId}`;
    const cutoff = now() - RATE_WINDOW_MS;
    if (!calls.has(rateKey) && calls.size >= MAX_RATE_KEYS) {
      for (const [key, timestamps] of calls) if (!timestamps.some(at => at > cutoff)) calls.delete(key);
      // Under a sustained unique-user flood, retain a bounded recent window.
      while (calls.size >= MAX_RATE_KEYS) calls.delete(calls.keys().next().value!);
    }
    const recent = (calls.get(rateKey) || []).filter(at => at > cutoff);
    if (recent.length >= RATE_LIMIT) throw new LinkPreviewError("rate_limited");
    recent.push(now()); calls.set(rateKey, recent);

    let url = validateUrl(input);
    for (let redirects = 0; ; redirects += 1) {
      const address = await resolvePublic(url, resolve);
      let response: LinkPreviewResponse;
      try { response = await request(url, address); } catch (error) {
        if (error instanceof LinkPreviewError) throw error;
        throw new LinkPreviewError("unavailable");
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirects >= MAX_REDIRECTS) throw new LinkPreviewError("unavailable");
        const location = headerValue(response.headers, "location");
        if (!location) throw new LinkPreviewError("unavailable");
        try { url = validateUrl(new URL(location, url).toString()); } catch (error) {
          if (error instanceof LinkPreviewError) throw error;
          throw new LinkPreviewError("unsafe_url");
        }
        continue;
      }
      if (response.status < 200 || response.status >= 300 || Buffer.byteLength(response.body, "utf8") > MAX_BODY_BYTES) throw new LinkPreviewError("unavailable");
      const contentType = headerValue(response.headers, "content-type") || "";
      if (!/^(text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(contentType)) throw new LinkPreviewError("unavailable");
      return metadata(response.body, hostForChecks(url));
    }
  };
}

export const previewChatLink = createLinkPreview();
