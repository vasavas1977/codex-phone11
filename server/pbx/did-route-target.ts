export type DidInternalRouteType =
  | "ivr"
  | "ringgroup"
  | "queue"
  | "timecondition"
  | "ringall";

export type DidInternalRouteTarget = {
  type: DidInternalRouteType;
  tenantId: number;
  targetId: number;
};

const DID_INTERNAL_TARGET =
  /^phone11pbx-(ivr|ringgroup|queue|timecondition|ringall)-([1-9]\d{0,9})-(\d{1,10})$/;
const MAX_INTERNAL_ID = 9_999_999_999;

export function encodeDidInternalTarget(
  target: DidInternalRouteTarget,
): string {
  if (
    !Number.isSafeInteger(target.tenantId) ||
    target.tenantId <= 0 ||
    target.tenantId > MAX_INTERNAL_ID
  )
    throw new Error("Invalid DID tenant");
  if (
    !Number.isSafeInteger(target.targetId) ||
    target.targetId < 0 ||
    target.targetId > MAX_INTERNAL_ID
  )
    throw new Error("Invalid DID target");
  if (
    target.type === "ringall" ? target.targetId !== 0 : target.targetId === 0
  ) {
    throw new Error("Invalid DID target type");
  }
  return `phone11pbx-${target.type}-${target.tenantId}-${target.targetId}`;
}

export function decodeDidInternalTarget(
  value: unknown,
): DidInternalRouteTarget | null {
  if (typeof value !== "string") return null;
  const match = value.match(DID_INTERNAL_TARGET);
  if (!match) return null;

  const tenantId = Number(match[2]);
  const targetId = Number(match[3]);
  const type = match[1] as DidInternalRouteType;
  if (!Number.isSafeInteger(tenantId) || !Number.isSafeInteger(targetId))
    return null;
  if (type === "ringall" ? targetId !== 0 : targetId === 0) return null;
  return { type, tenantId, targetId };
}
