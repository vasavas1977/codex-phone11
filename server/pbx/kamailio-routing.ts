/** Routing-only maintained contract; importing this module starts no resources. */
import { Router, type Request, type Response } from "express";
import { encodeDidInternalTarget, type DidInternalRouteType } from "./did-route-target";
import { requireConfiguredIntegrationSecret } from "./integration-auth";

export interface KamailioRoutingDependencies {
  /** Bind the already-owned pool; the factory neither creates nor closes it. */
  query: (text: string, params?: any[]) => Promise<{ rows: any[] }>;
  /** Explicit private configuration reader, evaluated for each request. */
  getSecret: () => unknown;
}

export function createKamailioRoutingRouter({ query, getSecret }: KamailioRoutingDependencies) {
  const router = Router();
  const verifyKamAuth = requireConfiguredIntegrationSecret(getSecret, "x-kam-secret");

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
        `SELECT pn.tenant_id, pn.assigned_route_type, pn.assigned_route_id
         FROM phone_numbers pn
         JOIN tenants t ON pn.tenant_id = t.id
         WHERE pn.number_e164 = $1 AND pn.status = 'active' AND pn.deleted_at IS NULL AND t.status = 'active'
         LIMIT 2`,
        [ruri_user]
      );

      if (didResult.rows.length > 0) {
        // An inbound DID must identify exactly one active tenant. Do not let a
        // corrupt or incomplete uniqueness constraint choose the first tenant.
        if (didResult.rows.length !== 1) {
          return res.json({ action: "reject", code: 404 });
        }
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
  return router;
}
