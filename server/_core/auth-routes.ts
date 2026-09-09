import { randomUUID } from "node:crypto";
import type { Express, Request, Response, RequestHandler } from "express";
import { toNodeHandler } from "better-auth/node";
import { getPhone11Auth, readAuthConfig, resolvePhone11User, revokePhone11Session, type Phone11Auth } from "./phone11-auth";
import type { Pool } from "pg";
import { getPool } from "../pbx/db";
import { HttpError } from "../../shared/_core/errors";
import { isPhone11AuthReady } from "./phone11-auth-readiness";

const authPaths = new Map([
  ["/api/auth/sign-in/email", "POST"], ["/api/auth/sign-out", "POST"],
]);

export const phone11Cors: RequestHandler = (req, res, next) => {
  const origin = req.headers.origin;
  let allowed: string[] = [];
  try { allowed = readAuthConfig().trustedOrigins; } catch { /* Fail closed until configured. */ }
  res.vary("Origin");
  if (origin) {
    if (!allowed.includes(origin)) {
      res.status(403).json({ error: "Origin not allowed" });
      return;
    }
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  }
  if (req.method === "OPTIONS") { res.sendStatus(204); return; }
  next();
};

export function registerAuthRoutes(
  app: Express,
  dependencies: { getAuth?: () => Phone11Auth; getDatabase?: () => Pool } = {},
) {
  const getAuth = dependencies.getAuth || getPhone11Auth;
  const getDatabase = dependencies.getDatabase || getPool;
  const isReady = () => isPhone11AuthReady(getAuth(), getDatabase());

  app.get("/api/mobile/config", async (_req, res) => {
    let ready = false;
    try {
      ready = await isReady();
    } catch { /* Never publish secret/config values. */ }
    res.setHeader("Cache-Control", "no-store");
    res.json({ authProvider: "phone11", emailPasswordEnabled: ready, registrationEnabled: false });
  });
  app.get("/api/ready/auth", async (_req, res) => {
    let ready = false;
    try { ready = await isReady(); } catch { /* Readiness is distinct from process liveness. */ }
    res.setHeader("Cache-Control", "no-store");
    res.status(ready ? 200 : 503).json({ ready, authProvider: "phone11" });
  });

  app.use("/api/auth", (req, res, next) => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    res.setHeader("X-Request-Id", requestId);
    res.setHeader("Cache-Control", "no-store");
    // Ignore caller-supplied IP headers. Express trusts only explicitly configured proxy CIDRs.
    req.headers["x-phone11-client-ip"] = req.ip || req.socket.remoteAddress || "127.0.0.1";
    if (req.headers.authorization) delete req.headers.cookie;
    res.on("finish", () => {
      console.info(JSON.stringify({
        event: "phone11.auth.request", requestId, method: req.method,
        route: authPaths.has(req.originalUrl.split("?")[0]) ? req.originalUrl.split("?")[0] : "session",
        status: res.statusCode, durationMs: Date.now() - startedAt,
      }));
    });
    next();
  });

  app.get("/api/auth/me", async (req: Request, res: Response) => {
    try {
      const user = await resolvePhone11User(req.headers, getAuth(), getDatabase());
      res.json({ user: {
        id: user.id, openId: user.openId, name: user.name, email: user.email,
        loginMethod: "phone11", lastSignedIn: user.lastSignedIn.toISOString(),
      } });
    } catch (error) {
      if (error instanceof HttpError && error.statusCode === 403) {
        res.status(401).json({ error: "Not authenticated", user: null });
      } else {
        res.status(503).json({ error: "Phone11 sign-in is temporarily unavailable" });
      }
    }
  });

  // Retire token-in-URL exchanges and session injection, including older app builds.
  app.all(["/api/oauth/*", "/api/auth/session", "/api/auth/logout"], (_req, res) => {
    res.status(410).json({ error: "Install the Phone11 sign-in update" });
  });

  // Must precede express.json(): Better Auth owns parsing, CSRF checks and session cookies.
  app.all("/api/auth/*", async (req, res) => {
    if (authPaths.get(req.path) !== req.method) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    try {
      await toNodeHandler(async (request) => {
        const response = req.path === "/api/auth/sign-out"
          ? await revokePhone11Session(req.headers, getAuth(), getDatabase())
          : await getAuth().handler(request);
        const nativeSignIn = req.path === "/api/auth/sign-in/email" &&
          req.headers["x-phone11-client"] === "native" &&
          !req.headers.origin && !req.headers.referer && !req.headers["sec-fetch-site"] &&
          !req.headers["sec-fetch-mode"] && !req.headers["sec-fetch-dest"];
        if (!nativeSignIn) {
          response.headers.delete("set-auth-token");
          response.headers.delete("access-control-expose-headers");
        }
        if (response.ok && req.path === "/api/auth/sign-in/email") {
          // The client obtains its canonical profile from /me. No raw session token in JSON.
          response.headers.delete("content-length");
          return new globalThis.Response(JSON.stringify({ success: true }), {
            status: response.status, headers: response.headers,
          });
        }
        return response;
      })(req, res);
    } catch (error) {
      res.status(error instanceof HttpError && error.statusCode === 403 ? 403 : 503)
        .json({ error: "Phone11 sign-in is temporarily unavailable" });
    }
  });
}
