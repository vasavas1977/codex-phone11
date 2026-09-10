import type { RegistrationState, SipAccount } from "./account-store";

export interface RegistrationSnapshot {
  userId?: number;
  authLoading: boolean;
  account: SipAccount | null;
  registrationState: RegistrationState;
  hasLiveCall: boolean;
}

interface Dependencies {
  snapshot: () => RegistrationSnapshot;
  loadAccount: () => Promise<void>;
  initialize: () => Promise<void>;
  restart: () => Promise<void>;
  onError: () => void;
}

/** Foreground registration recovery. Native push wake-up remains a separate capability. */
export function createRegistrationLifecycle(deps: Dependencies, initiallyActive: boolean) {
  let active = initiallyActive;
  let stopped = false;
  let running = false;
  let currentTask: Promise<void> | undefined;
  let loadedUserId: number | undefined;
  let attempts = 0;
  let retryAt = 0;
  let refreshOnResume = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cancelTimer = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  const eligible = (state: RegistrationSnapshot) => !state.authLoading && !!state.userId &&
    state.account?.enabled && state.account.ownerUserId === state.userId;

  const wake = () => {
    cancelTimer();
    if (stopped || !active || running) return;
    const state = deps.snapshot();
    if (state.authLoading || !state.userId) {
      loadedUserId = undefined;
      attempts = 0;
      retryAt = 0;
      refreshOnResume = false;
      return;
    }
    if (loadedUserId !== state.userId) {
      attempts = 0;
      retryAt = 0;
      running = true;
      const owner = state.userId;
      currentTask = deps.loadAccount().then(() => { loadedUserId = owner; }, () => {
        // Storage can be unavailable while iOS is locking. Retry on the next foreground.
        loadedUserId = owner;
        deps.onError();
      }).finally(() => { running = false; wake(); });
      return;
    }
    if (!eligible(state) || state.hasLiveCall) return;
    if (state.registrationState === "registered" && !refreshOnResume) {
      attempts = 0;
      retryAt = 0;
      return;
    }
    if (Date.now() < retryAt) {
      timer = setTimeout(wake, retryAt - Date.now());
      return;
    }
    running = true;
    const recover = refreshOnResume || attempts > 0 || ["failed", "network_error"].includes(state.registrationState);
    refreshOnResume = false;
    attempts += 1;
    retryAt = Date.now() + Math.min(60_000, 5_000 * 2 ** Math.min(attempts - 1, 4));
    // The SDK serializes lifecycle commands and checks auth again before native work.
    currentTask = (recover ? deps.restart() : deps.initialize()).catch(deps.onError).finally(() => {
      running = false;
      if (deps.snapshot().registrationState === "registering") {
        retryAt = Math.max(retryAt, Date.now() + 30_000);
      }
      wake();
    });
  };

  return {
    start: wake,
    changed: wake,
    setActive(next: boolean) {
      if (active === next) return;
      active = next;
      if (next) {
        // Retry secure hydration after unlocking, even for the same signed-in owner.
        loadedUserId = undefined;
        retryAt = 0;
        refreshOnResume = true;
      }
      wake();
    },
    async reconnect(): Promise<void> {
      const state = deps.snapshot();
      if (stopped || !active) throw new Error("Open Phone11 to reconnect your phone.");
      if (!eligible(state)) throw new Error("Sign in with an assigned phone account to connect.");
      if (state.hasLiveCall) throw new Error("End your current call before reconnecting.");
      if (!running) {
        retryAt = 0;
        refreshOnResume = true;
        wake();
      }
      // Repeated taps share the operation already in progress.
      await currentTask;
      const after = deps.snapshot();
      if (!eligible(after)) throw new Error("Your phone account changed. Sign in again to connect.");
      if (["failed", "network_error"].includes(after.registrationState)) {
        throw new Error("Your phone could not connect. Phone11 will keep trying while open.");
      }
    },
    stop() { stopped = true; cancelTimer(); },
  };
}
