import type { ChatNotificationEnableResult, NotificationIdentity } from "./coordinator";

/** Recover transient setup failures only while the same account/workspace is active.
 * Rechecks existing permission; retries never open the OS permission dialog. */
export function createEnrollmentRecovery(deps: {
  identity(): NotificationIdentity;
  refresh(explicit: boolean): Promise<ChatNotificationEnableResult>;
}) {
  let revision = 0, stopped = false, attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  const same = (origin: NotificationIdentity, at: number) => {
    const now = deps.identity();
    return !stopped && at === revision && now.active && now.enabled && !!now.owner && !!now.tenantId &&
      now.owner === origin.owner && now.tenantId === origin.tenantId;
  };
  const recovery = {
    invalidate() { revision++; clear(); attempt = 0; },
    stop() { stopped = true; recovery.invalidate(); },
    async refresh(explicit = false): Promise<ChatNotificationEnableResult> {
      if (explicit) recovery.invalidate();
      const origin = deps.identity(), at = revision;
      if (!same(origin, at)) return { status: "unavailable" };
      const result = await deps.refresh(explicit);
      if (!same(origin, at)) return result;
      if (result.status === "unavailable" && result.retryable) {
        if (timer === undefined) {
          const delay = [5000, 15000, 30000, 60000][Math.min(attempt++, 3)];
          timer = setTimeout(() => {
            timer = undefined;
            if (same(origin, at)) void recovery.refresh(false).catch(() => {});
          }, delay);
        }
      } else { clear(); attempt = 0; }
      return result;
    },
  };
  return recovery;
}
