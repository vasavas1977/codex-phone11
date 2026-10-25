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
import { createKamailioRoutingRouter } from "./kamailio-routing";
import { requireIntegrationSecret } from "./integration-auth";
import { cacheGetOrSet, invalidateCache } from "./redis";

const router = Router();

const verifyKamAuth = requireIntegrationSecret("KAM_SHARED_SECRET", "x-kam-secret");

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
         WHERE sa.sip_username = $1 AND sa.sip_domain = $2 AND sa.deleted_at IS NULL
           AND e.tenant_id = sa.tenant_id AND e.deleted_at IS NULL`,
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
    const { username, domain, contact } = req.body;

    if (username && domain) {
      await query(
        `UPDATE sip_accounts SET
          last_registered_at = NOW(),
          last_registered_contact = $1
         WHERE sip_username = $2 AND sip_domain = $3 AND deleted_at IS NULL`,
        [contact || "", username, domain]
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

router.use(createKamailioRoutingRouter({ query, getSecret: () => process.env.KAM_SHARED_SECRET }));

export { router as kamailioRouter };
