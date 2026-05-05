/**
 * Tenant Isolation Middleware
 * 
 * Per Opus review: tenant isolation is critical.
 * 
 * Flow:
 * 1. User authenticates via existing auth system
 * 2. Middleware resolves user's tenant memberships
 * 3. Active tenant is determined from:
 *    a. X-Tenant-Id header (for multi-tenant users)
 *    b. Default tenant membership
 *    c. First tenant membership
 * 4. All subsequent queries are scoped to the active tenant
 */
import { TRPCError } from "@trpc/server";
import { query } from "./db";
import { cacheGetOrSet } from "./redis";

export interface TenantMembership {
  id: number;
  userId: number;
  tenantId: number;
  tenantName: string;
  tenantSlug: string;
  tenantStatus: string;
  role: string;
  isDefault: boolean;
}

export interface TenantContext {
  tenantId: number;
  tenantName: string;
  tenantSlug: string;
  role: string;  // owner, admin, manager, user
  memberships: TenantMembership[];
}

/**
 * Resolve tenant memberships for a user.
 * Cached in Redis for 5 minutes.
 */
export async function resolveTenantMemberships(userId: number): Promise<TenantMembership[]> {
  return cacheGetOrSet(
    `tenant:memberships:${userId}`,
    300, // 5 min cache
    async () => {
      const result = await query(
        `SELECT tm.id, tm.user_id, tm.tenant_id, tm.role, tm.is_default,
                t.name as tenant_name, t.slug as tenant_slug, t.status as tenant_status
         FROM tenant_memberships tm
         JOIN tenants t ON tm.tenant_id = t.id
         WHERE tm.user_id = $1 AND tm.status = 'active' AND t.status = 'active'
         ORDER BY tm.is_default DESC, tm.created_at ASC`,
        [userId]
      );
      return result.rows.map((r: any) => ({
        id: r.id,
        userId: r.user_id,
        tenantId: r.tenant_id,
        tenantName: r.tenant_name,
        tenantSlug: r.tenant_slug,
        tenantStatus: r.tenant_status,
        role: r.role,
        isDefault: r.is_default,
      }));
    }
  );
}

/**
 * Resolve the active tenant context for a request.
 * 
 * Priority:
 * 1. X-Tenant-Id header (explicit selection)
 * 2. Default membership
 * 3. First membership
 */
export async function resolveTenantContext(
  userId: number,
  requestedTenantId?: number
): Promise<TenantContext> {
  const memberships = await resolveTenantMemberships(userId);

  if (memberships.length === 0) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "User has no active tenant memberships",
    });
  }

  let activeMembership: TenantMembership;

  if (requestedTenantId) {
    const found = memberships.find((m) => m.tenantId === requestedTenantId);
    if (!found) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "User does not have access to the requested tenant",
      });
    }
    activeMembership = found;
  } else {
    // Use default or first
    activeMembership = memberships.find((m) => m.isDefault) || memberships[0];
  }

  return {
    tenantId: activeMembership.tenantId,
    tenantName: activeMembership.tenantName,
    tenantSlug: activeMembership.tenantSlug,
    role: activeMembership.role,
    memberships,
  };
}

/**
 * Check if a user has a specific role or higher in the active tenant.
 * Role hierarchy: owner > admin > manager > user
 */
export function hasRole(userRole: string, requiredRole: string): boolean {
  const hierarchy = ["user", "manager", "admin", "owner"];
  const userLevel = hierarchy.indexOf(userRole);
  const requiredLevel = hierarchy.indexOf(requiredRole);
  return userLevel >= requiredLevel;
}

/**
 * Validate that a resource belongs to the active tenant.
 * Use this before any update/delete operation.
 */
export async function validateTenantOwnership(
  tableName: string,
  resourceId: number,
  tenantId: number
): Promise<boolean> {
  // Whitelist allowed table names to prevent SQL injection
  const allowedTables = [
    "extensions", "sip_accounts", "phone_numbers", "audio_files",
    "sites", "emergency_addresses", "tenant_settings", "fraud_controls",
    "recording_policies", "call_records", "call_legs",
  ];
  if (!allowedTables.includes(tableName)) {
    throw new Error(`Invalid table name: ${tableName}`);
  }

  const result = await query(
    `SELECT id FROM ${tableName} WHERE id = $1 AND tenant_id = $2`,
    [resourceId, tenantId]
  );
  return result.rows.length > 0;
}
