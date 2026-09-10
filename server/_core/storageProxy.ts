import type { Express } from "express";

/** Legacy unscoped storage signing is not part of the owned Phone11 media service. */
export function registerStorageProxy(app: Express) {
  app.get("/manus-storage/*", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.status(503).json({ error: "Legacy storage is unavailable. Use authenticated Phone11 media." });
  });
}
