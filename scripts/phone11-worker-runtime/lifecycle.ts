/** Worker-only ownership of the maintained six-service lifecycle. No starters on import. */
import {
  createPhone11BackgroundLifecycle,
  type Phone11BackgroundServices,
} from "../../server/_core/runtime-role";

export function createWorkerLifecycle(
  services: Phone11BackgroundServices,
  closeResources: () => Promise<void>,
  timeoutMs = 30_000,
) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error("WORKER_DRAIN_BUDGET_REFUSED");
  const background = createPhone11BackgroundLifecycle(
    { role: "default", startsBackgroundServices: true, bindsPortExactly: false }, services,
  );
  let phase: "prepared" | "running" | "closing" | "closed" | "unconfirmed" = "prepared";
  const unconfirmed = (): boolean => phase === "unconfirmed";
  let closePromise: Promise<void> | undefined;
  const close = (): Promise<void> => {
    if (closePromise) return closePromise;
    phase = "closing";
    const drained = (async () => {
      await background.stop();
      // A failed/stuck stopper must retain pools while owned work can still use
      // them. This deliberately does not use HTTP shutdown's finally close.
      if (unconfirmed()) throw new Error("WORKER_DRAIN_UNCONFIRMED");
      await closeResources();
    })();
    closePromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { phase = "unconfirmed"; reject(new Error("WORKER_DRAIN_UNCONFIRMED")); }, timeoutMs);
      drained.then(() => {
        clearTimeout(timer);
        if (phase === "unconfirmed") return;
        phase = "closed"; resolve();
      }, () => { clearTimeout(timer); phase = "unconfirmed"; reject(new Error("WORKER_DRAIN_UNCONFIRMED")); });
    });
    return closePromise;
  };
  return Object.freeze({
    /** Operator-only after actual old actor fence/absence; not proof of it. */
    async start() {
      if (phase !== "prepared") throw new Error("WORKER_START_REFUSED");
      phase = "running";
      try { background.start(); }
      catch {
        try { await close(); }
        catch { throw new Error("WORKER_START_CLEANUP_UNCONFIRMED"); }
        throw new Error("WORKER_START_REFUSED");
      }
    },
    close,
    status: () => phase,
  });
}
