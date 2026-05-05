/**
 * PBX Module — barrel export
 * 
 * Core infrastructure for Phone11 Cloud PBX.
 */
export { getPool, query, withTransaction } from "./db";
export { getRedis, cacheGetOrSet, rateLimitCheck, idempotencyCheck, idempotencySet, invalidateCache } from "./redis";
export { normalizeToE164, isValidE164, getCountryCode, THAI_EMERGENCY_NUMBERS } from "./e164";
export { createSipCredentials, regenerateSipCredentials, decryptSecret, generateSipPassword, computeHA1, computeHA1B } from "./sip-secrets";
export { writeAuditLog, queryAuditLogs } from "./audit";
export type { AuditEntry } from "./audit";
export { resolveTenantMemberships, resolveTenantContext, hasRole, validateTenantOwnership } from "./tenant-middleware";
export type { TenantContext, TenantMembership } from "./tenant-middleware";
export { buildPaginationSQL, buildPaginatedResponse } from "./pagination";
export type { PaginationInput, PaginatedResult } from "./pagination";
