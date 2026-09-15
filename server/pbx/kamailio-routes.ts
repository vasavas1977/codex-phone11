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
import { encodeDidInternalTarget, type DidInternalRouteType } from "./did-route-target";
import { requireIntegrationSecret } from "./integration-auth";
import { cacheGetOrSet, invalidateCache } from "./redis";

const router = Router();

const verifyKamAuth = requireIntegrationSecret("KAM_SHARED_SECRET", "x-kam-secret");

type DidFeatureRouteType = "ivr" | "ring_group" | "queue" | "time_condition";

const didFeatureRoutes: Record<DidFeatureRouteType, {
  table: "ivr_menus" | "ring_groups" | "call_queues" | "time_conditions";
  internalType: Exclude<DidInternalRouteType, "ringall">;
  requiresActive: boolean;
}> = {
  ivr: { table: "ivr_menus", internalType: "ivr", requiresActive: true },
  ring_group: { table: "ring_groups", internalType: "ringgroup", requiresActive: true },
  queue: { table: "call_queues", internalType: "queue", requiresActive: true },
  time_condition: { table: "time_conditions", internalType: "timecondition", requiresActive: false },
};

function isDidFeatureRouteType(value: unknown): value is DidFeatureRouteType {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(didFeatureRoutes, value);
}

async function resolveDidFeatureTarget(routeType: DidFeatureRouteType, routeId: unknown, tenantId: number) {
  if (!Number.isSafeInteger(routeId) || (routeId as number) <= 0) return null;
  const route = didFeatureRoutes[routeType];
  // The table comes only from the fixed map; the target and tenant stay bound.
  const activeClause = route.requiresActive ? " AND is_active = true" : "";
  const result = await query(
    `SELECT id FROM ${route.table} WHERE id = $1 AND tenant_id = $2${activeClause} LIMIT 1`,
    [routeId, tenantId]
  );
  if (result.rows.length !== 1) return null;
  return encodeDidInternalTarget({ type: route.internalType, tenantId, targetId: routeId as number });
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
       WHERE pn.number_e164 = $1 AND pn.status = 'active' AND pn.deleted_at IS NULL AND t.status = 'active'`,
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
           WHERE e.id = $1 AND e.tenant_id = $2 AND sa.tenant_id = e.tenant_id AND e.status = 'active' AND e.deleted_at IS NULL AND sa.status = 'active'`,
          [did.assigned_route_id, did.tenant_id]
        );
        
        if (extResult.rows.length > 0) {
          return res.json({
            action: "bridge",
            target: `sip:${extResult.rows[0].sip_username}@${extResult.rows[0].sip_domain}`,
            tenantId: did.tenant_id,
          });
        }

        // A removed, disabled, or cross-tenant target must not spill into a
        // tenant-wide ring.
        return res.json({ action: "reject", code: 404 });
      }

      if (isDidFeatureRouteType(did.assigned_route_type)) {
        const target = await resolveDidFeatureTarget(
          did.assigned_route_type,
          did.assigned_route_id,
          did.tenant_id
        );
        if (!target) return res.json({ action: "reject", code: 404 });
        return res.json({ action: "freeswitch", target, tenantId: did.tenant_id });
      }

      if (did.assigned_route_type || did.assigned_route_id) {
        return res.json({ action: "reject", code: 404 });
      }

      // Default: ring all extensions in tenant
      return res.json({
        action: "ring_all",
        target: encodeDidInternalTarget({ type: "ringall", tenantId: did.tenant_id, targetId: 0 }),
        tenantId: did.tenant_id,
      });
    }

    // Internal extension numbers are meaningful only inside the caller's verified SIP tenant.
    if (typeof from_user !== "string" || typeof domain !== "string") return res.json({ action: "reject", code: 403 });
    const caller = await query(
      `SELECT sa.tenant_id FROM sip_accounts sa JOIN extensions e ON e.id = sa.extension_id AND e.tenant_id = sa.tenant_id
       JOIN tenants t ON t.id = e.tenant_id WHERE sa.sip_username = $1 AND sa.sip_domain = $2
       AND sa.status = 'active' AND sa.deleted_at IS NULL AND e.status = 'active' AND e.deleted_at IS NULL AND t.status = 'active'`,
      [from_user, domain]);
    if (caller.rows.length !== 1) return res.json({ action: "reject", code: 403 });
    const extResult = await query(
      `SELECT sa.sip_username, sa.sip_domain, e.tenant_id
       FROM extensions e
       JOIN sip_accounts sa ON e.id = sa.extension_id AND sa.deleted_at IS NULL
       WHERE e.extension_number = $1 AND e.tenant_id = $2 AND sa.tenant_id = e.tenant_id AND sa.status = 'active' AND e.status = 'active' AND e.deleted_at IS NULL`,
      [ruri_user, caller.rows[0].tenant_id]
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
