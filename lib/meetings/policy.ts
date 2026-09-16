import { z } from 'zod';

/** Policy evaluation is not authentication. Server callers must load the scope,
 * membership and policy records from trusted storage before minting room grants.
 * Never accept `scope` or policy layers as authority from a mobile/web request. */
export const meetingPolicySettings = [
  'guestAccess', 'waitingRoom', 'publishAudio', 'publishVideo',
  'publishScreen', 'interpreterAllowed', 'recordingAllowed',
] as const;
export type MeetingPolicySetting = typeof meetingPolicySettings[number];
export type PolicySource = { level: 'tenant' | 'group' | 'user' | 'meeting'; id: string };
export type PolicyDecision = {
  value: boolean;
  source: PolicySource;
  locked: boolean;
  lockReason?: string;
};
export type EffectiveMeetingPolicy = {
  tenantId: string;
  userId: string;
  meetingId?: string;
  settings: Record<MeetingPolicySetting, PolicyDecision>;
};
export class MeetingPolicyError extends Error {
  constructor(
    public readonly code: 'INVALID_POLICY' | 'POLICY_SCOPE' | 'POLICY_CONFLICT' | 'POLICY_LOCKED',
    message: string,
    public readonly setting?: MeetingPolicySetting,
  ) { super(message); this.name = 'MeetingPolicyError'; }
}
const id = z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
const rule = z.object({ value: z.boolean(), locked: z.boolean().optional() }).strict();
const shape = {
  guestAccess: rule, waitingRoom: rule, publishAudio: rule, publishVideo: rule,
  publishScreen: rule, interpreterAllowed: rule, recordingAllowed: rule,
};
const defaults = z.object(shape).strict();
const patch = defaults.partial();
const participantPatch = z.object({
  guestAccess: z.boolean().optional(), waitingRoom: z.boolean().optional(),
  publishAudio: z.boolean().optional(), publishVideo: z.boolean().optional(),
  publishScreen: z.boolean().optional(), interpreterAllowed: z.boolean().optional(),
  recordingAllowed: z.boolean().optional(),
}).strict();
const schema = z.object({
  scope: z.object({ tenantId: id, userId: id, groupIds: z.array(id).max(100), meetingId: id.optional() }).strict(),
  tenant: z.object({ tenantId: id, settings: defaults }).strict(),
  /** Explicit priority order: later unlocked group values replace earlier values.
   * Missing group records are rejected, so omission cannot bypass a group lock. */
  groups: z.array(z.object({ tenantId: id, groupId: id, settings: patch }).strict()).max(100),
  user: z.object({ tenantId: id, userId: id, settings: participantPatch }).strict().optional(),
  meeting: z.object({ tenantId: id, meetingId: id, settings: participantPatch }).strict().optional(),
}).strict();
export type MeetingPolicyInput = z.infer<typeof schema>;

/** Resolve all policy layers or throw; never return partially permissive output.
 * Locks fix both on and off. In particular, waitingRoom=true is a restriction,
 * while publishAudio=true is a permission: generic boolean AND is incorrect.
 * Contradictory group locks are always errors, independent of ordering.
 * A conflicting unlocked group default cannot weaken another group's lock.
 * User/meeting attempts to change locked values are errors, not silent success. */
export function resolveMeetingPolicy(input: unknown): EffectiveMeetingPolicy {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new MeetingPolicyError('INVALID_POLICY', 'Meeting policy input is invalid');
  const { scope, tenant, groups, user, meeting } = parsed.data;
  const mismatch = () => { throw new MeetingPolicyError('POLICY_SCOPE', 'Meeting policy scope does not match trusted membership'); };
  if (tenant.tenantId !== scope.tenantId || new Set(scope.groupIds).size !== scope.groupIds.length) mismatch();
  if (groups.length !== scope.groupIds.length || new Set(groups.map(g => g.groupId)).size !== groups.length) mismatch();
  for (const g of groups) if (g.tenantId !== scope.tenantId || !scope.groupIds.includes(g.groupId)) mismatch();
  if (user && (user.tenantId !== scope.tenantId || user.userId !== scope.userId)) mismatch();
  if (meeting && (meeting.tenantId !== scope.tenantId || meeting.meetingId !== scope.meetingId)) mismatch();
  // Meeting scope requires a loaded meeting policy, even when its patch is empty.
  if (scope.meetingId && !meeting) mismatch();

  const settings = {} as Record<MeetingPolicySetting, PolicyDecision>;
  for (const key of meetingPolicySettings) {
    const initial = tenant.settings[key];
    let decision: PolicyDecision = {
      value: initial.value, source: { level: 'tenant', id: tenant.tenantId }, locked: initial.locked ?? false,
    };
    const locks = groups.filter(g => g.settings[key]?.locked === true);
    if (locks.some(g => g.settings[key]!.value !== locks[0].settings[key]!.value)) {
      throw new MeetingPolicyError('POLICY_CONFLICT', 'Group policies contain conflicting locks', key);
    }
    if (decision.locked) {
      // Tenant lock always wins over child group defaults. A contradictory group
      // lock is a configuration error requiring an administrator to resolve it.
      if (locks.some(g => g.settings[key]!.value !== decision.value)) {
        throw new MeetingPolicyError('POLICY_CONFLICT', 'Group lock conflicts with tenant lock', key);
      }
    } else if (locks.length) {
      // Select a stable source for equivalent group locks, independent of order.
      const owner = [...locks].sort((a, b) => a.groupId < b.groupId ? -1 : a.groupId > b.groupId ? 1 : 0)[0];
      decision = { value: owner.settings[key]!.value, source: { level: 'group', id: owner.groupId }, locked: true };
    } else {
      for (const group of groups) {
        const candidate = group.settings[key];
        if (candidate) decision = { value: candidate.value, source: { level: 'group', id: group.groupId }, locked: false };
      }
    }
    const children: Array<{ source: PolicySource; value: boolean | undefined }> = [
      { source: { level: 'user', id: scope.userId }, value: user?.settings[key] },
      { source: { level: 'meeting', id: scope.meetingId ?? '' }, value: meeting?.settings[key] },
    ];
    for (const child of children) {
      if (child.value === undefined) continue;
      if (decision.locked) {
        if (child.value !== decision.value) throw new MeetingPolicyError('POLICY_LOCKED', 'Meeting policy is locked by an ancestor', key);
      } else decision = { value: child.value, source: child.source, locked: false };
    }
    if (decision.locked) decision.lockReason = `Locked by ${decision.source.level} ${decision.source.id}`;
    settings[key] = decision;
  }
  return { tenantId: scope.tenantId, userId: scope.userId, ...(scope.meetingId ? { meetingId: scope.meetingId } : {}), settings };
}
