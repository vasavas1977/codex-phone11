/**
 * Kamailio REST Callback Routes
 * 
 * Express routes mounted at /api/kamailio/*
 * Called by Kamailio via http_client module for:
 * 1. Auth verification (when not using DB auth directly)
 * 2. Location/routing decisions
 * 3. CDR events
 * 4. Registration events
 */
import { Router, Request, Response } from "express";
import { query } from "./db";
import { cacheGetOrSet, invalidateCache } from "./redis";

const router = Router();

const KAM_SHARED_SECRET = process.env.KAM_SHARED_SECRET || "phone11-kam-secret-change-me";

function verifyKamAuth(req: Request, res: Response, next: Function) {
  const secret = req.headers["x-kam-secret"] || req.query.secret;
  if (secret !== KAM_SHARED_SECRET) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

/**
 * POST /api/kamailio/auth
 * Verify SIP credentials for REGISTER/INVITE
 */
router.post("/auth", verifyKamAuth, async (req: Request, res: Response) => {
  try {
    const { username, domain, method } = req.body;

    if (!username || !domain) {
      return res.json({ authorized: false, reason: "missing_credentials" });
    }

    const cacheKey = `kam:auth:${domain}:${username}`;
    const result = await cacheGetOrSet(cacheKey, 30, async () => {
      const dbResult = await query(
        `SELECT sa.id, sa.ha1, sa.status, sa.tenant_id, e.status as ext_status,
                t.status as tenant_status
         FROM sip_accounts sa
         JOIN extensions e ON sa.extension_id = e.id
         JOIN tenants t ON sa.tenant_id = t.id
         WHERE sa.sip_username = $1 AND sa.sip_domain = $2 AND sa.deleted_at IS NULL`,
        [username, domain]
      );

      if (dbResult.rows.length === 0) {
        return { authorized: false, reason: "not_found" };
      }

      const account = dbResult.rows[0];
      if (account.status !== "active") return { authorized: false, reason: "account_disabled" };
      if (account.ext_status !== "active") return { authorized: false, reason: "extension_disabled" };
      if (account.tenant_status !== "active") return { authorized: false, reason: "tenant_disabled" };

      return {
        authorized: true,
        ha1: account.ha1,
        tenantId: account.tenant_id,
      };
    });

    res.json(result);
  } catch (error: any) {
    console.error("[Kamailio Auth] Error:", error.message);
    res.json({ authorized: false, reason: "internal_error" });
  }
});

/**
 * POST /api/kamailio/register
 * Called when a SIP REGISTER succeeds
 */
router.post("/register", verifyKamAuth, async (req: Request, res: Response) => {
  try {
    const { username, domain, contact, expires, user_agent } = req.body;

    if (username && domain) {
      await query(
        `UPDATE sip_accounts SET 
          last_registered_at = NOW(), 
          last_registered_contact = $1,
          user_agent = $2
         WHERE sip_username = $3 AND sip_domain = $4 AND deleted_at IS NULL`,
        [contact || "", user_agent || "", username, domain]
      );

      // Invalidate cache
      await invalidateCache(`kam:auth:${domain}:${username}`);
    }

    res.json({ ok: true });
  } catch (error: any) {
    console.error("[Kamailio Register] Error:", error.message);
    res.json({ ok: false });
  }
});

/**
 * POST /api/kamailio/route
 * Called for routing decisions (DID inbound, extension lookup)
 */
router.post("/route", verifyKamAuth, async (req: Request, res: Response) => {
  try {
    const { ruri_user, from_user, domain } = req.body;

    if (!ruri_user) {
      return res.json({ action: "reject", code: 404 });
    }

    // Check if it's a DID number
    const didResult = await query(
      `SELECT pn.*, t.slug as tenant_slug
       FROM phone_numbers pn
       JOIN tenants t ON pn.tenant_id = t.id
       WHERE pn.number_e164 = $1 AND pn.status = 'active' AND pn.deleted_at IS NULL`,
      [ruri_user]
    );

    if (didResult.rows.length > 0) {
      const did = didResult.rows[0];
      
      if (did.assigned_route_type === "extension" && did.assigned_route_id) {
        // Route to extension
        const extResult = await query(
          `SELECT sa.sip_username, sa.sip_domain
           FROM extensions e
           JOIN sip_accounts sa ON e.id = sa.extension_id AND sa.deleted_at IS NULL
           WHERE e.id = $1 AND e.status = 'active'`,
          [did.assigned_route_id]
        );
        
        if (extResult.rows.length > 0) {
          return res.json({
            action: "bridge",
            target: `sip:${extResult.rows[0].sip_username}@${extResult.rows[0].sip_domain}`,
            tenantId: did.tenant_id,
          });
        }
      }

      // Default: ring all extensions in tenant
      return res.json({
        action: "ring_all",
        tenantId: did.tenant_id,
      });
    }

    // Check if it's an internal extension
    const extResult = await query(
      `SELECT sa.sip_username, sa.sip_domain, e.tenant_id
       FROM extensions e
       JOIN sip_accounts sa ON e.id = sa.extension_id AND sa.deleted_at IS NULL
       WHERE e.extension_number = $1 AND e.status = 'active' AND e.deleted_at IS NULL`,
      [ruri_user]
    );

    if (extResult.rows.length > 0) {
      return res.json({
        action: "bridge",
        target: `sip:${extResult.rows[0].sip_username}@${extResult.rows[0].sip_domain}`,
        tenantId: extResult.rows[0].tenant_id,
      });
    }

    // Not found
    res.json({ action: "reject", code: 404 });
  } catch (error: any) {
    console.error("[Kamailio Route] Error:", error.message);
    res.json({ action: "reject", code: 500 });
  }
});

export { router as kamailioRouter };
