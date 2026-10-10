import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: 17, openId: "owner-17", name: "Owner", email: null, loginMethod: "test", lastSignedIn: new Date(0) } as any,
  listeners: [] as Array<() => void>,
  query: vi.fn(),
  mutate: vi.fn(),
}));
vi.mock("../lib/_core/auth", () => ({
  getAuthSnapshot: () => ({ user: state.user, loading: false }),
  addAuthChangeListener: (listener: () => void) => { state.listeners.push(listener); return () => {}; },
}));
vi.mock("../lib/trpc", () => ({
  trpc: { pbx: { tenant: { memberships: { useQuery: vi.fn() } } } },
  createTRPCClient: () => ({ phone: {
    getConfig: { query: state.query },
    ensurePilotConfig: { mutate: state.mutate },
  } }),
}));

import { fetchSelectedPhoneConfig, fetchSelectedPilotConfig, mayAutoProvisionSipAccount } from "../lib/sip/selected-provisioning";
import { resolveSipTenant, selectSipTenant, selectedSipTenant } from "../lib/sip/tenant-selection";

const tenant = (userId: number, tenantId: number) => ({ userId, tenantId, tenantName: `Workspace ${tenantId}` });
const config = (tenantId: number) => ({ configured: true, tenantId,
  organization: { id: tenantId, name: `Workspace ${tenantId}`, plan: "business" },
  sip: { username: "3001", password: "test-secret", domain: "sip.test" } });

describe("selected Phone11 SIP provisioning", () => {
  beforeEach(() => {
    state.user = { id: 17, openId: "owner-17", name: "Owner", email: null, loginMethod: "test", lastSignedIn: new Date(0) };
    state.query.mockReset(); state.mutate.mockReset();
    selectSipTenant(17, null);
  });

  it("keeps one workspace implicit but requires an explicit choice for multiple", () => {
    expect(resolveSipTenant(17, [tenant(17, 7)], null)).toBe(7);
    expect(resolveSipTenant(17, [tenant(17, 7), tenant(17, 8)], null)).toBeNull();
    expect(resolveSipTenant(17, [tenant(17, 7), tenant(17, 8)], 8)).toBe(8);
  });

  it("rejects another owner and a stale or revoked workspace choice", () => {
    expect(resolveSipTenant(17, [tenant(18, 7)], 7)).toBeNull();
    expect(resolveSipTenant(17, [tenant(17, 8)], 7)).toBeNull();
    expect(resolveSipTenant(17, [tenant(17, 8), tenant(17, 9)], 7)).toBeNull();
    selectSipTenant(17, 7);
    state.user = { ...state.user, id: 18 };
    state.listeners.forEach(listener => listener());
    expect(selectedSipTenant(18)).toBeNull();
    expect(selectedSipTenant(17)).toBeNull();
  });

  it("requests the selected tenant and validates the echoed SIP scope", async () => {
    selectSipTenant(17, 7);
    state.query.mockResolvedValue(config(7));
    await expect(fetchSelectedPhoneConfig(state.user, 7)).resolves.toMatchObject({ tenantId: 7 });
    expect(state.query).toHaveBeenCalledWith({ tenantId: 7 });
    state.query.mockResolvedValue(config(8));
    await expect(fetchSelectedPhoneConfig(state.user, 7)).rejects.toThrow("different workspace");
  });

  it("discards a result after sign-in or workspace selection changes in flight", async () => {
    selectSipTenant(17, 7);
    let resolve!: (value: ReturnType<typeof config>) => void;
    state.query.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const owner = state.user;
    const pending = fetchSelectedPhoneConfig(owner, 7);
    selectSipTenant(17, 8);
    resolve(config(7));
    await expect(pending).rejects.toThrow("workspace changed");

    selectSipTenant(17, 7);
    state.query.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const changedOwner = fetchSelectedPhoneConfig(owner, 7);
    state.user = { ...owner };
    resolve(config(7));
    await expect(changedOwner).rejects.toThrow("sign-in changed");
  });

  it("sends the same selected tenant to the legacy read-only pilot endpoint", async () => {
    selectSipTenant(17, 7);
    state.mutate.mockResolvedValue(config(7));
    await expect(fetchSelectedPilotConfig(state.user, 7)).resolves.toMatchObject({ tenantId: 7 });
    expect(state.mutate).toHaveBeenCalledWith({ tenantId: 7 });
  });

  it("never automatically replaces another owner or tenant's saved SIP identity", () => {
    const stored = { ownerUserId: 17, tenantId: 7 } as any;
    expect(mayAutoProvisionSipAccount(null, 17, 8)).toBe(true);
    expect(mayAutoProvisionSipAccount(stored, 17, 7)).toBe(true);
    expect(mayAutoProvisionSipAccount(stored, 17, 8)).toBe(false);
    expect(mayAutoProvisionSipAccount(stored, 18, 7)).toBe(false);
  });
});
