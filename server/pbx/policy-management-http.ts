/** Dedicated public management surface; never mounts the full application. */
import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { z } from "zod";
import { phone11Cors } from "../_core/auth-routes";
import { readAuthConfig } from "../_core/phone11-auth";
import { createContext } from "../_core/context";
import { protectedProcedure, router } from "../_core/trpc";
import { pbxRouter } from "./pbx-router";

export const POLICY_MANAGEMENT_METHODS = {
  "pbx.capabilities": "GET",
  "pbx.fraudControls.get": "GET",
  "pbx.fraudControls.update": "POST",
} as const;

export const policyManagementRouter = router({
  pbx: router({
    capabilities: protectedProcedure
      .input(z.object({ tenantId: z.number().int().positive() }).strict().optional())
      .query(async ({ ctx, input }) => {
        // Reuse the actual selected-admin resolver; do not advertise contracts
        // whose tenant/directory procedures still run on the legacy API.
        const result = await pbxRouter.createCaller(ctx).capabilities(input);
        const { explicitTenantReads: _tenant, explicitDidRouteDirectories: _directories, ...capabilities } = result;
        return capabilities;
      }),
    fraudControls: pbxRouter._def.record.fraudControls,
  }),
});

/** Canonical singleton paths only, checked before auth/session or DB work. */
export function policyManagementGuard(
  trustedOrigins: () => readonly string[] = () => readAuthConfig().trustedOrigins,
): RequestHandler {
  const parse = express.json({ limit: "16kb", strict: true, inflate: false });
  return (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    const question = req.originalUrl.indexOf("?");
    const path = question < 0 ? req.originalUrl : req.originalUrl.slice(0, question);
    const query = question < 0 ? "" : req.originalUrl.slice(question + 1);
    const procedure = path.startsWith("/api/trpc/") ? path.slice("/api/trpc/".length) : "";
    if (req.originalUrl.length > 8192) { res.status(414).json({ error: "Request is too large" }); return; }
    if (!Object.prototype.hasOwnProperty.call(POLICY_MANAGEMENT_METHODS, procedure) ||
      path.includes("%") || req.originalUrl.includes("#") || req.headers["x-http-method-override"]) {
      res.status(404).json({ error: "Management route unavailable" }); return;
    }
    const expected = POLICY_MANAGEMENT_METHODS[procedure as keyof typeof POLICY_MANAGEMENT_METHODS];
    const parameters = new URLSearchParams(query);
    if ([...parameters.keys()].some(key => key !== "input") || parameters.getAll("input").length > 1 ||
      (expected === "POST" && query !== "")) {
      res.status(400).json({ error: "Use a singleton management request" }); return;
    }
    if (req.method === "OPTIONS") {
      if (req.headers["access-control-request-method"] !== expected) {
        res.status(405).json({ error: "Unsupported management method" }); return;
      }
      return next(); // The established CORS middleware handles trusted preflight.
    }
    if (req.method !== expected) { res.status(405).json({ error: "Unsupported management method" }); return; }
    if (expected !== "POST") {
      if (req.headers["transfer-encoding"] || Number(req.headers["content-length"] || 0) !== 0) {
        res.status(400).json({ error: "Read requests cannot contain a body" }); return;
      }
      return next();
    }
    // Same browser-cookie CSRF boundary as the established invitation guard.
    // Supplied bearer credentials never obtain cookie fallback in createContext.
    const origin = req.headers.origin;
    let origins: readonly string[] = [];
    try { origins = trustedOrigins(); } catch { /* Refuse until auth is configured. */ }
    if ((origin && !origins.includes(origin)) ||
      (!origin && req.headers.cookie && !/^Bearer \S+$/i.test(req.headers.authorization || "")) ||
      (!origin && req.headers["sec-fetch-site"] === "cross-site")) {
      res.status(403).json({ error: "Origin not allowed" }); return;
    }
    if (!req.is("application/json") || req.headers["content-encoding"]) {
      res.status(415).json({ error: "Management requests require uncompressed JSON" }); return;
    }
    parse(req, res, error => {
      if (error) {
        res.status(error.type === "entity.too.large" ? 413 : 400).json({ error: "Invalid management request" });
        return;
      }
      next();
    });
  };
}

export function createPolicyManagementApp(build = "unbound") {
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(build)) throw new Error("POLICY_MANAGEMENT_BUILD_REFUSED");
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => { res.setHeader("X-Phone11-Policy-Candidate", build); next(); });
  // No auth-write, media, SIP, CDR, provider or background-worker routes.
  app.use(policyManagementGuard());
  app.use(phone11Cors);
  app.use("/api/trpc", createExpressMiddleware({ router: policyManagementRouter, createContext }));
  const finiteError: ErrorRequestHandler = (_error, _req, res, _next) => {
    if (!res.headersSent) res.status(500).json({ error: "Management request unavailable" });
    else res.destroy();
  };
  app.use(finiteError);
  return app;
}
