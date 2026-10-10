import type { RequestHandler } from "express";

export const PBX_READINESS_PROCEDURE = "pbx.databaseReadiness";

/** Runs before createContext: rejected probes cannot refresh an auth session. */
export function createPbxReadinessHttpGuard(): RequestHandler {
  return (req, res, next) => {
    let path: string;
    try { path = decodeURIComponent(req.path).replace(/^\//, ""); } catch {
      res.status(400).json({ error: "Invalid RPC path" });
      return;
    }
    if (!path.includes(PBX_READINESS_PROCEDURE)) return next();
    res.setHeader("Cache-Control", "no-store");
    if (path !== PBX_READINESS_PROCEDURE || req.method !== "GET" ||
        req.headers["x-phone11-read-only-probe"] !== "1" || req.query.batch !== undefined) {
      res.status(400).json({ error: "Use an unbatched read-only diagnostic GET" });
      return;
    }
    next();
  };
}
