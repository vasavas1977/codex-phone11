import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

/** Integration credentials are server-configured and accepted only in headers. */
export function integrationSecretStatus(name: string, supplied: unknown): "ok" | "unavailable" | "forbidden" {
  return configuredIntegrationSecretStatus(process.env[name], supplied);
}

function configuredIntegrationSecretStatus(configured: unknown, supplied: unknown): "ok" | "unavailable" | "forbidden" {
  if (typeof configured !== "string" || configured.length < 24 || /change[-_ ]?me|example|placeholder/i.test(configured)) return "unavailable";
  if (typeof supplied !== "string" || supplied.length > 4096) return "forbidden";
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(configured), digest(supplied)) ? "ok" : "forbidden";
}

export function requireIntegrationSecret(name: string, header: string): RequestHandler {
  return requireConfiguredIntegrationSecret(() => process.env[name], header);
}

/** The caller owns the private configuration and its lifecycle. No ambient fallback. */
export function requireConfiguredIntegrationSecret(configured: () => unknown, header: string): RequestHandler {
  return (req, res, next) => {
    const status = configuredIntegrationSecretStatus(configured(), req.headers[header]);
    if (status === "unavailable") { res.status(503).json({ error: "Integration is not configured" }); return; }
    if (status !== "ok") { res.status(403).json({ error: "Forbidden" }); return; }
    next();
  };
}
