export type TypingPublication = {
  tenantId: number; conversationId: string; threadRootId: string | null; userId: number;
  sessionId: string; generation: string; sequence: number; active: boolean;
};
type Lease = TypingPublication & { expiresAt: number; retainUntil: number };

const LEASE_MS = 10_000;
const TOMBSTONE_MS = 30_000;
const MAX_ENTRIES = 10_000;
const MAX_SCOPE_ENTRIES = 100;
const MAX_USER_SESSIONS = 8;

const scopeKey = (value: Pick<TypingPublication, "tenantId" | "conversationId" | "threadRootId">) =>
  `${value.tenantId}:${value.conversationId}:${value.threadRootId || "root"}`;
const leaseKey = (value: TypingPublication) => `${scopeKey(value)}:${value.userId}:${value.sessionId}`;

/** Process-local by design. A multi-replica deployment needs a shared ephemeral adapter. */
export class ChatTypingRegistry {
  private readonly leases = new Map<string, Lease>();
  private prune(now: number) {
    for (const [key, lease] of this.leases) if (lease.retainUntil <= now) this.leases.delete(key);
  }
  publish(value: TypingPublication, now = Date.now()): { accepted: boolean; expiresAt: number } {
    this.prune(now);
    const key = leaseKey(value), existing = this.leases.get(key), scope = scopeKey(value);
    if (existing && value.sequence <= existing.sequence) return { accepted: false, expiresAt: existing.expiresAt };
    if (!existing) {
      let scopeCount = 0, userSessions = 0;
      for (const lease of this.leases.values()) if (scopeKey(lease) === scope) {
        scopeCount++;
        if (lease.userId === value.userId) userSessions++;
      }
      if (this.leases.size >= MAX_ENTRIES || scopeCount >= MAX_SCOPE_ENTRIES || userSessions >= MAX_USER_SESSIONS)
        return { accepted: false, expiresAt: now };
    }
    const expiresAt = value.active ? now + LEASE_MS : now;
    this.leases.set(key, { ...value, expiresAt, retainUntil: value.active ? expiresAt + TOMBSTONE_MS : now + TOMBSTONE_MS });
    return { accepted: true, expiresAt };
  }
  activeUsers(scope: Pick<TypingPublication, "tenantId" | "conversationId" | "threadRootId">, now = Date.now()): number[] {
    this.prune(now);
    const expected = scopeKey(scope), users = new Set<number>();
    for (const lease of this.leases.values())
      if (scopeKey(lease) === expected && lease.active && lease.expiresAt > now) users.add(lease.userId);
    return [...users];
  }
  size() { return this.leases.size; }
}

export const chatTypingRegistry = new ChatTypingRegistry();
