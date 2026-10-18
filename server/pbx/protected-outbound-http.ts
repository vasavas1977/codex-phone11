/**
 * Detached raw HTTP owner only. This creates no listener, production mount,
 * environment binding or identity qualification. Startup authority is external.
 * Already-started policy transactions are not cancellable through the current
 * core API; retain their slot until settlement and let the DB adapter release.
 */
import { IncomingMessage, ServerResponse } from "node:http";
import { performance } from "node:perf_hooks";
import { isIP } from "node:net";
import { createCanonicalAssignmentResolver, readDetachedProtectedCallerRequest,
  type DetachedCallerIngressBinding, type DetachedIdentityReadExecutor, type IdentityReadPin } from "./trusted-caller-identity";
import { evaluateProtectedOutbound, protectedOutboundDenyXml, type ProtectedBinding } from "./protected-outbound-routing";

export const PROTECTED_HTTP_RESPONSE_MS = 1200;
export const PROTECTED_HTTP_MAX_WORK = 4;

type RoutingBinding = Extract<ProtectedBinding, { mode: "KAM_DIGEST_ASSERTED_ONLY" }>;
export interface ReviewedProtectedHttpStartup {
  readonly ingress: DetachedCallerIngressBinding;
  readonly routing: RoutingBinding;
  readonly identity: IdentityReadPin;
  readonly executeIdentityRead: DetachedIdentityReadExecutor;
}
export interface ProtectedHttpDrainResult { readonly settled: boolean; readonly pending: number }
export interface DetachedProtectedHttpOwner {
  readonly handler: (request: IncomingMessage, response: ServerResponse) => void;
  /** Stops admission and closes owned HTTP work. A false result retains pending slots. */
  readonly drain: () => Promise<ProtectedHttpDrainResult>;
}

const unavailable = () => new Error("Protected HTTP startup binding unavailable");
const positiveId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const addresses = (value: unknown): value is readonly string[] => Array.isArray(value) && value.length > 0 && value.length <= 8 &&
  value.every(ip => typeof ip === "string" && isIP(ip) !== 0) && new Set(value).size === value.length;
const profileName = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value);

function snapshot(startup: ReviewedProtectedHttpStartup | null) {
  if (startup === null) return null;
  const ingress = startup?.ingress, routing = startup?.routing, identity = startup?.identity;
  if (!ingress || !routing || !identity || !addresses(ingress.fsHttpPeerIps) || !addresses(ingress.kamSipPeerIps) ||
      typeof ingress.fsHeaderSecret !== "string" || !/^[\x21-\x7e]{32,256}$/.test(ingress.fsHeaderSecret) ||
      !profileName(ingress.sofiaProfile) || routing.status !== "QUALIFIED" || routing.mode !== "KAM_DIGEST_ASSERTED_ONLY" ||
      !positiveId(routing.tenantId) || !addresses(routing.proxyIps) || !profileName(routing.sofiaProfile) || !profileName(routing.gateway) ||
      typeof routing.callerIdNumber !== "string" || !/^\+?[1-9]\d{2,14}$/.test(routing.callerIdNumber) ||
      identity.tenantId !== routing.tenantId || ingress.sofiaProfile !== routing.sofiaProfile ||
      ingress.kamSipPeerIps.length !== routing.proxyIps.length || !ingress.kamSipPeerIps.every(ip => routing.proxyIps.includes(ip)) ||
      typeof startup.executeIdentityRead !== "function") throw unavailable();
  // The actual resolver validates/snapshots all database/login/role/schema pins.
  const resolve = createCanonicalAssignmentResolver({ ...identity }, startup.executeIdentityRead);
  return {
    ingress: Object.freeze({ ...ingress, fsHttpPeerIps: Object.freeze([...ingress.fsHttpPeerIps]), kamSipPeerIps: Object.freeze([...ingress.kamSipPeerIps]) }),
    routing: Object.freeze({ ...routing, proxyIps: Object.freeze([...routing.proxyIps]) }), resolve,
  };
}

interface Work {
  request: IncomingMessage;
  response: ServerResponse;
  cancelled: boolean;
  responded: boolean;
  deadline: number;
  timer?: ReturnType<typeof setTimeout>;
  cancelHttp: () => void;
}

/**
 * Supply null for an UNBOUND deny-only owner. A non-null argument must originate
 * in separately reviewed startup code; this function never upgrades request
 * markers, service authentication or configuration availability into authority.
 */
export function createProtectedOutboundHttpOwner(startup: ReviewedProtectedHttpStartup | null): DetachedProtectedHttpOwner {
  const selected = snapshot(startup), deny = protectedOutboundDenyXml();
  const work = new Set<Work>();
  const settledListeners = new Set<() => void>();
  let accepting = true;
  let draining: Promise<ProtectedHttpDrainResult> | undefined;

  function closeOwned(request: IncomingMessage, response: ServerResponse) {
    // A deadline/abort cannot wait indefinitely for body EOF or write backpressure.
    // Delivery over a failed connection is not claimed: terminal denial OR close.
    setImmediate(() => {
      request.destroy();
      if (!response.writableFinished) response.destroy();
    });
  }
  function terminal(request: IncomingMessage, response: ServerResponse, body = deny, item?: Work) {
    if (item?.responded || response.destroyed || response.writableEnded) return;
    if (item && performance.now() >= item.deadline) { body = deny; item.cancelled = true; }
    if (item) { item.responded = true; clearTimeout(item.timer); }
    try {
      response.writeHead(200, { "Content-Type": "application/xml; charset=utf-8", "Content-Length": Buffer.byteLength(body),
        "Cache-Control": "no-store", Connection: "close" });
      response.end(body);
    } catch { response.destroy(); }
    closeOwned(request, response);
  }

  const handler = (request: IncomingMessage, response: ServerResponse) => {
    if (!(request instanceof IncomingMessage) || !(response instanceof ServerResponse)) throw unavailable();
    if (!accepting || selected === null || work.size >= PROTECTED_HTTP_MAX_WORK) {
      terminal(request, response); return;
    }
    const item: Work = { request, response, cancelled: false, responded: false, deadline: performance.now() + PROTECTED_HTTP_RESPONSE_MS,
      cancelHttp: () => {} };
    const abort = () => { item.cancelled = true; clearTimeout(item.timer); closeOwned(request, response); };
    const responseClose = () => { if (!response.writableFinished) abort(); };
    item.cancelHttp = () => { item.cancelled = true; terminal(request, response, deny, item); closeOwned(request, response); };
    request.once("aborted", abort);
    request.once("error", abort);
    response.once("error", abort);
    response.once("close", responseClose);
    item.timer = setTimeout(item.cancelHttp, PROTECTED_HTTP_RESPONSE_MS);
    work.add(item);
    const run = async () => {
      const raw = await readDetachedProtectedCallerRequest({ method: request.method, url: request.url,
        remoteAddress: request.socket.remoteAddress, rawHeaders: request.rawHeaders, body: request }, selected.ingress);
      if (item.cancelled || response.destroyed) return;
      if (performance.now() >= item.deadline) { item.cancelHttp(); return; }
      if (raw === null) { terminal(request, response, deny, item); return; }
      // No new identity lookup after abort. A late identity result cannot begin a
      // policy transaction. Already-started policy work has no AbortSignal API.
      const xml = await evaluateProtectedOutbound(raw, selected.routing, { resolveCanonicalAssignments: async (user, realm) => {
        if (item.cancelled || response.destroyed || performance.now() >= item.deadline) return [];
        const rows = await selected.resolve(user, realm);
        return item.cancelled || response.destroyed || performance.now() >= item.deadline ? [] : rows;
      } });
      if (!item.cancelled && !response.destroyed && !response.writableEnded) terminal(request, response, xml, item);
    };
    // Attach rejection handling immediately; retain the slot through actual
    // settlement even if its HTTP response has timed out or the client aborted.
    void run().catch(() => {
      if (!item.cancelled) terminal(request, response, deny, item);
    }).finally(() => {
      clearTimeout(item.timer);
      request.removeListener("aborted", abort);
      request.removeListener("error", abort);
      response.removeListener("error", abort);
      response.removeListener("close", responseClose);
      work.delete(item);
      if (work.size === 0) for (const listener of [...settledListeners]) listener();
    });
  };

  const drain = (): Promise<ProtectedHttpDrainResult> => {
    accepting = false;
    for (const item of work) item.cancelHttp();
    if (work.size === 0) return Promise.resolve(Object.freeze({ settled: true, pending: 0 }));
    if (draining) return draining;
    draining = new Promise<ProtectedHttpDrainResult>(resolve => {
      let timer: ReturnType<typeof setTimeout>;
      const finish = () => {
        clearTimeout(timer); settledListeners.delete(finish);
        resolve(Object.freeze({ settled: work.size === 0, pending: work.size }));
      };
      settledListeners.add(finish);
      timer = setTimeout(finish, PROTECTED_HTTP_RESPONSE_MS);
    }).finally(() => { draining = undefined; });
    return draining;
  };
  return Object.freeze({ handler, drain });
}
