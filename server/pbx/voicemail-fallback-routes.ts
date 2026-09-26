import { Router, json, type ErrorRequestHandler, type Request, type RequestHandler, type Response } from "express";
import { requireIntegrationSecret } from "./integration-auth";
import {
  resolveLocalVoicemailFallbackAuthority,
  type LocalVoicemailFallbackAuthority,
  type LocalVoicemailFallbackInput,
  type LocalVoicemailFallbackIdentity,
} from "./voicemail-fallback-authority";
import {
  createVoicemailFallbackReferenceStore,
  FALLBACK_REFERENCE_PATTERN,
  type VoicemailFallbackReferenceSnapshot,
  type VoicemailFallbackReferenceStore,
} from "./voicemail-fallback-reference-store";

const BODY_LIMIT = 2048;
const callIdPattern = /^[A-Za-z0-9._~+@:-]{1,160}$/;
const fromTagPattern = /^[A-Za-z0-9._~+-]{1,96}$/;

type Resolve = (input: LocalVoicemailFallbackInput) => Promise<LocalVoicemailFallbackAuthority>;
type MintBody = LocalVoicemailFallbackInput & { callId: string; fromTag: string };

function exactObject(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const found = Object.keys(value);
  return found.length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

function validMintBody(value: unknown): value is MintBody {
  if (!exactObject(value, ["authenticatedCallerUsername", "authenticatedCallerRealm", "canonicalTargetUsername", "canonicalTargetDomain", "terminalCause", "callId", "fromTag"])) return false;
  return typeof value.callId === "string" && callIdPattern.test(value.callId) &&
    typeof value.fromTag === "string" && fromTagPattern.test(value.fromTag) &&
    typeof value.authenticatedCallerUsername === "string" &&
    typeof value.authenticatedCallerRealm === "string" &&
    typeof value.canonicalTargetUsername === "string" &&
    typeof value.canonicalTargetDomain === "string" &&
    (value.terminalCause === "no-answer" || value.terminalCause === "timeout");
}

function validRedeemBody(value: unknown): value is { reference: string; callId: string; fromTag: string } {
  return exactObject(value, ["reference", "callId", "fromTag"]) &&
    typeof value.reference === "string" && FALLBACK_REFERENCE_PATTERN.test(value.reference) &&
    typeof value.callId === "string" && callIdPattern.test(value.callId) &&
    typeof value.fromTag === "string" && fromTagPattern.test(value.fromTag);
}

function sameIdentity(a: LocalVoicemailFallbackIdentity, b: LocalVoicemailFallbackIdentity): boolean {
  return a.tenantId === b.tenantId &&
    a.caller.extensionId === b.caller.extensionId && a.caller.userId === b.caller.userId &&
    a.caller.sipUsername === b.caller.sipUsername && a.caller.sipDomain === b.caller.sipDomain &&
    a.target.extensionId === b.target.extensionId && a.target.ownerUserId === b.target.ownerUserId &&
    a.target.ownerEpoch === b.target.ownerEpoch && a.target.extensionNumber === b.target.extensionNumber &&
    a.target.sipUsername === b.target.sipUsername && a.target.sipDomain === b.target.sipDomain;
}

function validSnapshot(value: unknown): value is VoicemailFallbackReferenceSnapshot {
  if (!exactObject(value, ["input", "identity", "callId", "fromTag"])) return false;
  const input = value.input;
  const identity = value.identity;
  return typeof value.callId === "string" && callIdPattern.test(value.callId) &&
    typeof value.fromTag === "string" && fromTagPattern.test(value.fromTag) &&
    exactObject(input, ["authenticatedCallerUsername", "authenticatedCallerRealm", "canonicalTargetUsername", "canonicalTargetDomain", "terminalCause"]) &&
    typeof input.authenticatedCallerUsername === "string" && typeof input.authenticatedCallerRealm === "string" &&
    typeof input.canonicalTargetUsername === "string" && typeof input.canonicalTargetDomain === "string" &&
    (input.terminalCause === "no-answer" || input.terminalCause === "timeout") &&
    exactObject(identity, ["tenantId", "caller", "target"]) &&
    Number.isSafeInteger(identity.tenantId) &&
    exactObject(identity.caller, ["extensionId", "userId", "sipUsername", "sipDomain"]) &&
    exactObject(identity.target, ["extensionId", "ownerUserId", "ownerEpoch", "extensionNumber", "sipUsername", "sipDomain"]);
}

/** A single, unambiguous integration header is required even if a proxy or
 * Node would otherwise join duplicate header fields. No header value is logged. */
function strictSecret(name: string, header: string): RequestHandler {
  const verify = requireIntegrationSecret(name, header);
  return (req, res, next) => {
    const occurrences = req.rawHeaders.filter((item, index) => index % 2 === 0 && item.toLowerCase() === header).length;
    const supplied = req.headers[header];
    if (occurrences !== 1 || typeof supplied !== "string" || supplied.includes(",") || /[\r\n\0]/.test(supplied)) {
      res.status(403).json({ error: "Forbidden" }); return;
    }
    verify(req, res, next);
  };
}

const featureEnabled: RequestHandler = (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (process.env.PHONE11_VOICEMAIL_LOCAL_FALLBACK_ENABLED !== "true") {
    res.status(404).json({ error: "Not found" }); return;
  }
  next();
};

const bodyPreflight: RequestHandler = (req, res, next) => {
  // Mount this router before the application's general JSON parser. Reject an
  // already parsed body, which would bypass this route's own byte limit.
  if (req.body !== undefined || req.headers["content-encoding"] ||
      typeof req.headers["content-length"] === "string" &&
        (!/^[0-9]{1,7}$/.test(req.headers["content-length"]) || Number(req.headers["content-length"]) > BODY_LIMIT) ||
      !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers["content-type"] ?? "")) {
    res.status(400).json({ error: "Invalid request" }); return;
  }
  next();
};

const bodyError: ErrorRequestHandler = (_error, _req, res, _next) => {
  res.status(400).json({ error: "Invalid request" });
};

/** Mounted before the general body parser; default-off until commissioned. The authenticated
 * proxy must supply caller identity, canonical target, terminal cause and
 * SIP call binding from its own transaction, never from a caller's headers.
 * The FS consumer must pass expectedOwnerEpoch into the deposit admission
 * transaction and require the current owner epoch/assignment to still match. */
export function createVoicemailFallbackRouter(options: {
  store?: VoicemailFallbackReferenceStore;
  resolve?: Resolve;
} = {}) {
  const router = Router();
  const store = options.store ?? createVoicemailFallbackReferenceStore();
  const resolve = options.resolve ?? resolveLocalVoicemailFallbackAuthority;

  router.post("/mint", featureEnabled, strictSecret("KAM_SHARED_SECRET", "x-kam-secret"),
    bodyPreflight, json({ limit: BODY_LIMIT, strict: true }), async (req: Request, res: Response) => {
      if (!validMintBody(req.body)) { res.status(400).json({ error: "Invalid request" }); return; }
      const input: LocalVoicemailFallbackInput = {
        authenticatedCallerUsername: req.body.authenticatedCallerUsername,
        authenticatedCallerRealm: req.body.authenticatedCallerRealm,
        canonicalTargetUsername: req.body.canonicalTargetUsername,
        canonicalTargetDomain: req.body.canonicalTargetDomain,
        terminalCause: req.body.terminalCause,
      };
      try {
        const decision = await resolve(input);
        if (!decision.allowed) { res.status(404).json({ error: "Not found" }); return; }
        const reference = await store.issue({ input, identity: decision.identity, callId: req.body.callId, fromTag: req.body.fromTag });
        res.status(201).json({ reference });
      } catch {
        res.status(503).json({ error: "Fallback unavailable" });
      }
    }, bodyError);

  router.post("/redeem", featureEnabled, strictSecret("FS_SHARED_SECRET", "x-fs-secret"),
    bodyPreflight, json({ limit: BODY_LIMIT, strict: true }), async (req: Request, res: Response) => {
      if (!validRedeemBody(req.body)) { res.status(400).json({ error: "Invalid request" }); return; }
      try {
        const snapshot = await store.consume(req.body.reference);
        // Consuming precedes every comparison: a wrong call binding burns the
        // reference instead of giving an attacker a reusable oracle.
        if (!validSnapshot(snapshot) || snapshot.callId !== req.body.callId || snapshot.fromTag !== req.body.fromTag) {
          res.status(404).json({ error: "Not found" }); return;
        }
        const current = await resolve(snapshot.input);
        if (!current.allowed || !sameIdentity(snapshot.identity, current.identity)) {
          res.status(404).json({ error: "Not found" }); return;
        }
        res.json({ identity: current.identity, expectedOwnerEpoch: current.identity.target.ownerEpoch });
      } catch {
        res.status(503).json({ error: "Fallback unavailable" });
      }
    }, bodyError);
  return router;
}
