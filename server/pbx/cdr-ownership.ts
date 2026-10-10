export type TrustedCdrRoute = {
  tenantId: number;
  extensionId: number;
  userId?: number;
  direction?: string;
};

export type CdrOwnership = {
  callerUserId: number | null;
  calleeUserId: number | null;
};

/**
 * Convert a server-persisted, call-time route owner into immutable CDR
 * participation. Caller-provided CDR fields and current extension assignment
 * are deliberately not accepted as ownership evidence.
 */
export function ownershipFromTrustedRoute(route: TrustedCdrRoute | null): CdrOwnership {
  if (!route || !Number.isSafeInteger(route.userId) || route.userId! <= 0) {
    return { callerUserId: null, calleeUserId: null };
  }
  if (route.direction === "outbound") {
    return { callerUserId: route.userId!, calleeUserId: null };
  }
  if (route.direction === "inbound") {
    return { callerUserId: null, calleeUserId: route.userId! };
  }
  return { callerUserId: null, calleeUserId: null };
}

export function hasExactCdrOwnership(row: {caller_user_id?: unknown;callee_user_id?: unknown},ownership:CdrOwnership): boolean {
  const caller=row.caller_user_id==null?null:Number(row.caller_user_id);
  const callee=row.callee_user_id==null?null:Number(row.callee_user_id);
  return caller===ownership.callerUserId&&callee===ownership.calleeUserId;
}
