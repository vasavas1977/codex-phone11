import { json, type RequestHandler } from "express";
import { readAuthConfig } from "./phone11-auth";

/** Install before the general JSON parser; applies to invitation RPCs in batches too. */
export function createInvitationHttpGuard(
  trustedOrigins: () => readonly string[] = () => readAuthConfig().trustedOrigins,
): RequestHandler {
  const parse = json({ limit: "8kb", strict: true });
  return (req, res, next) => {
    let path: string;
    try { path = decodeURIComponent(req.path); } catch {
      res.status(400).json({ error: "Invalid RPC path" });
      return;
    }
    const procedures = path.replace(/^\//, "").split(",");
    if (!procedures.some((name) => name.startsWith("invitations."))) return next();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (req.originalUrl.length > 8192) {
      res.status(414).json({ error: "Invitation request is too large" });
      return;
    }
    if (req.method !== "POST") {
      if (req.method === "GET" && procedures.every((name) =>
        name === "invitations.availability" || name === "invitations.list")) return next();
      res.status(405).json({ error: "Use POST for this invitation request" });
      return;
    }
    // Browser cookies need an explicit trusted origin. Native bearer requests
    // are separately authenticated; supplied bearer tokens never fall back to cookies.
    const origin = req.headers.origin;
    let origins: readonly string[] = [];
    try { origins = trustedOrigins(); } catch { /* Fail closed on invalid auth config. */ }
    if ((origin && !origins.includes(origin)) ||
      (!origin && req.headers.cookie && !/^Bearer \S+$/i.test(req.headers.authorization || "")) ||
      (!origin && req.headers["sec-fetch-site"] === "cross-site")) {
      res.status(403).json({ error: "Origin not allowed" });
      return;
    }
    if (!req.is("application/json")) {
      res.status(415).json({ error: "Invitation requests require JSON" });
      return;
    }
    parse(req, res, (error) => {
      if (error) {
        // Never echo malformed JSON, which can contain a token or password.
        res.status(error.type === "entity.too.large" ? 413 : 400)
          .json({ error: "Invalid invitation request" });
        return;
      }
      next();
    });
  };
}
