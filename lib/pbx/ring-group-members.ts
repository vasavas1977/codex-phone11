export type RingGroupMemberDraft = {
  extensionId: number;
  priority: number;
  delaySeconds: number;
  isActive: boolean;
};

export function normalizeRingGroupMember(value: any): RingGroupMemberDraft {
  return {
    extensionId: Number(value.extensionId ?? value.extension_id),
    priority: Number(value.priority),
    delaySeconds: Number(value.delaySeconds ?? value.delay_seconds),
    isActive: value.isActive ?? value.is_active ?? true,
  };
}

export function validateRingGroupMembers(
  members: readonly RingGroupMemberDraft[],
): string | null {
  const seen = new Set<number>();
  for (const member of members) {
    if (!Number.isSafeInteger(member.extensionId) || member.extensionId < 1) {
      return "Choose a valid workspace extension for every member.";
    }
    if (seen.has(member.extensionId)) {
      return "An extension can appear only once in a ring group.";
    }
    seen.add(member.extensionId);
    if (!Number.isSafeInteger(member.priority) || member.priority < 1 || member.priority > 10000) {
      return "Priority must be a whole number from 1 to 10,000.";
    }
    if (!Number.isSafeInteger(member.delaySeconds) || member.delaySeconds < 0 || member.delaySeconds > 120) {
      return "Delay must be a whole number from 0 to 120 seconds.";
    }
  }
  return null;
}
