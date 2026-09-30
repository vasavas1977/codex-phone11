import { TRPCError } from "@trpc/server";

const WINDOW_MS = 10 * 60_000;
const MAX_KEYS = 20_000;
const windows = new Map<string, { until: number; count: number }>();
let activeAccepts = 0;

/** Bounded process-local defense in addition to unguessable 256-bit tokens. */
export function limitInvitationOperation(kind: "inspect" | "accept" | "create" | "resend", clientKey: string): void {
  const now = Date.now();
  const key = `${kind}:${clientKey.slice(0, 256)}`;
  let entry = windows.get(key);
  if (!entry || entry.until <= now) {
    if (windows.size >= MAX_KEYS) {
      for (const [oldKey, old] of windows) if (old.until <= now) windows.delete(oldKey);
      if (windows.size >= MAX_KEYS) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Invitation service is busy" });
    }
    entry = { until: now + WINDOW_MS, count: 0 };
    windows.set(key, entry);
  }
  const maximum = kind === "accept" ? 15 : kind === "inspect" ? 30 : 30;
  if (++entry.count > maximum) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many invitation requests" });
}

export async function boundedInvitationAcceptance<T>(operation: () => Promise<T>): Promise<T> {
  if (activeAccepts >= 8) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Invitation service is busy" });
  activeAccepts++;
  try { return await operation(); } finally { activeAccepts--; }
}
