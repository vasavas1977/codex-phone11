import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

/** Integration credentials are server-configured and accepted only in headers. */
export function integrationSecretStatus(name: string, supplied: unknown): "ok" | "unavailable" | "forbidden" {
  const configured = process.env[name];
  if (!configured || configured.length < 24 || /change[-_ ]?me|example|placeholder/i.test(configured)) return "unavailable";
  if (typeof supplied !== "string" || supplied.length > 4096) return "forbidden";
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(configured), digest(supplied)) ? "ok" : "forbidden";
}

export function requireIntegrationSecret(name: string, header: string): RequestHandler {
  return (req, res, next) => {
    const status = integrationSecretStatus(name, req.headers[header]);
    if (status === "unavailable") { res.status(503).json({ error: "Integration is not configured" }); return; }
    if (status !== "ok") { res.status(403).json({ error: "Forbidden" }); return; }
    next();
  };
}
