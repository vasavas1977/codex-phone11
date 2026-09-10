import { describe, it, expect, vi } from "vitest";
import { VoipTokenCoordinator, type PushBinding } from "../lib/push/token-coordinator";

const binding = (ownerUserId = 1, token = "token-a"): PushBinding => ({ ownerUserId, token,
  deviceId: "device-a", platform: "ios", sipUri: "sip:3001@sip.phone11.ai", bundleId: "ai.phone11", sandbox: false });
function harness(initial: PushBinding[] = []) {
  let owner: number | null = 1, entries = initial;
  const calls: string[] = [];
  const deps = {
    currentOwner: () => owner,
    read: vi.fn(async () => [...entries]),
    write: vi.fn(async (next: PushBinding[]) => { calls.push("persist"); entries = [...next]; }),
    register: vi.fn(async (_: PushBinding, _signal: AbortSignal) => { calls.push("register"); }),
    unregister: vi.fn(async (_: PushBinding, _signal: AbortSignal) => { calls.push("unregister"); }),
    stopNative: vi.fn(async () => { calls.push("stop"); }),
  };
  return { deps, calls, coordinator: new VoipTokenCoordinator(deps), entries: () => entries, owner: (next: number | null) => { owner = next; } };
}

describe("authenticated VoIP token lifecycle", () => {
  it("records revocation evidence before binding and never stores credentials", async () => {
    const h = harness(); await h.coordinator.bind(binding());
    expect(h.calls).toEqual(["persist", "register"]);
    expect(Object.keys(h.entries()[0]).sort()).toEqual(Object.keys(binding()).sort());
  });
  it("denies signed-out and cross-owner binding before storage/network", async () => {
    const h = harness(); h.owner(null); await h.coordinator.bind(binding());
    h.owner(2); await h.coordinator.bind(binding()); expect(h.calls).toEqual([]);
  });
  it("does not register when durable cleanup evidence cannot be saved", async () => {
    const h = harness(); h.deps.write.mockRejectedValue(new Error("locked"));
    await expect(h.coordinator.bind(binding())).rejects.toThrow("locked");
    expect(h.deps.register).not.toHaveBeenCalled();
  });
  it("retains evidence if the server response is lost", async () => {
    const h = harness(); h.deps.register.mockRejectedValue(new Error("offline"));
    await expect(h.coordinator.bind(binding())).rejects.toThrow(); expect(h.entries()).toEqual([binding()]);
  });
  it("revokes the previous token before rotation and reuses only the same owner", async () => {
    const oldOther = binding(2, "other"); const h = harness([binding(), oldOther]);
    await h.coordinator.bind(binding(1, "new"));
    expect(h.deps.unregister).toHaveBeenCalledTimes(1);
    expect(h.deps.unregister).toHaveBeenCalledWith(binding(), expect.any(AbortSignal));
    expect(h.entries()).toEqual([oldOther, binding(1, "new")]);
  });
  it("stops native before unregister and clears only current owner's entries", async () => {
    const h = harness([binding(), binding(2, "other")]); await h.coordinator.beforeLogout();
    expect(h.calls).toEqual(["stop", "unregister", "persist"]);
    expect(h.entries()).toEqual([binding(2, "other")]);
  });
  it("retains failed cleanup for the same owner; permits authoritative server logout", async () => {
    const h = harness([binding()]); h.deps.unregister.mockRejectedValue(new Error("offline"));
    await h.coordinator.beforeLogout(); expect(h.entries()).toEqual([binding()]);
    h.owner(2); await h.coordinator.beforeLogout(); expect(h.deps.unregister).toHaveBeenCalledTimes(1);
    h.owner(1); h.deps.unregister.mockResolvedValue(); await h.coordinator.beforeLogout(); expect(h.entries()).toEqual([]);
  });
  it("cancels queued registration as soon as logout starts", async () => {
    const h = harness(); const bind = h.coordinator.bind(binding());
    const logout = h.coordinator.beforeLogout(); await Promise.all([bind, logout]);
    expect(h.deps.register).not.toHaveBeenCalled();
  });
  it("does not erase pending cleanup when identity changes during unregister", async () => {
    const h = harness([binding()]); h.deps.unregister.mockImplementation(async () => { h.owner(2); });
    await h.coordinator.beforeLogout(); expect(h.entries()).toEqual([binding()]);
  });
  it("does not register if identity changes while reading storage", async () => {
    const h = harness(); h.deps.read.mockImplementation(async () => { h.owner(2); return []; });
    await h.coordinator.bind(binding()); expect(h.deps.register).not.toHaveBeenCalled();
  });
  it.each(["stopNative", "read", "unregister"] as const)("bounds stuck %s and prevents late cleanup or rebind", async method => {
    vi.useFakeTimers();
    try {
      const h = harness([binding()]);
      let release: (value?: unknown) => void = () => {};
      h.deps[method].mockImplementation(() => new Promise(resolve => { release = resolve; }) as never);
      const logout = h.coordinator.beforeLogout();
      await vi.advanceTimersByTimeAsync(1000);
      await logout;
      expect(h.deps.register).not.toHaveBeenCalled();
      // The same owner signs in again before a timed-out old operation completes.
      h.owner(null); h.owner(1);
      release(method === "read" ? [binding()] : undefined);
      await vi.advanceTimersByTimeAsync(0);
      expect(h.deps.write).not.toHaveBeenCalled();
      expect(h.deps.register).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it("aborts an in-flight registration before authoritative logout can proceed", async () => {
    const h = harness(); let signal: AbortSignal | undefined;
    h.deps.register.mockImplementation(async (_, currentSignal) => { signal = currentSignal; });
    await h.coordinator.bind(binding()); await h.coordinator.beforeLogout();
    expect(signal?.aborted).toBe(true);
  });
});
