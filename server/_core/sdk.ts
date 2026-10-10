import type { Request } from "express";
import { isPhone11ReadOnlyProbe, resolvePhone11User } from "./phone11-auth";

// Keep the existing request-context boundary; Manus tokens are no longer accepted.
export const sdk = {
  authenticateRequest(req: Request) {
    return resolvePhone11User(req.headers, undefined, undefined, isPhone11ReadOnlyProbe(req));
  },
};
