/* eslint-disable import/first */
import { createRequire } from "node:module";
import { createElement, type ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as {
  renderToStaticMarkup(node: ReactNode): string;
};
const m = vi.hoisted(() => ({ auth: {} as any, workspace: {} as any, options: {} as any,
  fetch: vi.fn(), direct: vi.fn(), createClient: vi.fn(), mutation: vi.fn() }));
vi.mock("react", async () => ({
  ...await vi.importActual<typeof import("react")>("react"), useContext: () => m.workspace,
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: any) => { m.options = options; return {}; }, useQueryClient: vi.fn(),
}));
vi.mock("../hooks/use-auth", () => ({ useAuth: () => m.auth }));
vi.mock("../lib/_core/auth", () => ({
  getAuthSnapshot: () => m.auth, addAuthChangeListener: () => () => undefined,
}));
vi.mock("../lib/trpc", () => ({ createTRPCClient: m.createClient, trpc: {
  useUtils: () => ({ pbx: { fraudControls: { get: { fetch: m.fetch } } } }),
  pbx: { fraudControls: { update: { useMutation: m.mutation } } },
} }));
import { useFraudControls, useUpdateFraudControls } from "../hooks/use-pbx-admin";
function render() {
  function Probe() { useFraudControls(); useUpdateFraudControls(); return null; }
  renderToStaticMarkup(createElement(Probe));
  return m.options;
}
function read() { return m.options.queryFn({ signal: new AbortController().signal }); }
beforeEach(() => {
  vi.clearAllMocks();
  m.createClient.mockImplementation(() => ({ pbx: { fraudControls: { get: { query: m.direct } } } }));
  m.auth = { user: { id: 7 }, loading: false };
  m.workspace = { isAdmitted: true, selectedTenantId: 18, admissionScope: "7:18:1",
    capabilitiesQuery: { data: { explicitFraudControls: true } } };
  m.direct.mockResolvedValue({ tenant_id: 18, international_enabled: false, premium_rate_enabled: true });
});
it("keys policy data by account, explicit workspace and fresh admission, and always reads explicit tenant", async () => {
  const options = render();
  expect(options).toMatchObject({ queryKey: ["phone11-admin-fraud-controls", 7, expect.any(Number), 18, "7:18:1"],
    enabled: true, staleTime: 0, gcTime: 0, refetchOnMount: "always", refetchOnWindowFocus: true, retry: false });
  expect(await read()).toEqual({ ownerId: 7, authIdentity: options.queryKey[2], tenantId: 18, admissionScope: "7:18:1", configured: true,
    internationalEnabled: false, premiumRateEnabled: true });
  expect(m.direct).toHaveBeenCalledWith({ tenantId: 18 }, { signal: expect.any(AbortSignal) });
  expect(m.createClient).toHaveBeenCalledOnce();
  expect(m.fetch).not.toHaveBeenCalled();
  expect(m.mutation).toHaveBeenCalledWith();
});
it.each([undefined, false, "true", 1])("does not query old/malformed explicit fraud capability %s", async bit => {
  m.workspace.capabilitiesQuery.data.explicitFraudControls = bit;
  expect(render().enabled).toBe(false); await expect(read()).rejects.toThrow();
  expect(m.direct).not.toHaveBeenCalled();
});
it.each(["loading", "signed-out", "not-admitted", "no-tenant", "no-scope"])("fails closed for %s", async mode => {
  if (mode === "loading") m.auth.loading = true;
  if (mode === "signed-out") m.auth.user = null;
  if (mode === "not-admitted") m.workspace.isAdmitted = false;
  if (mode === "no-tenant") m.workspace.selectedTenantId = null;
  if (mode === "no-scope") m.workspace.admissionScope = null;
  expect(render().enabled).toBe(false); await expect(read()).rejects.toThrow();
  expect(m.direct).not.toHaveBeenCalled();
});
it("represents null policy as unconfigured false flags without writing defaults", async () => {
  m.direct.mockResolvedValue(null); render();
  expect(await read()).toMatchObject({ configured: false, internationalEnabled: false, premiumRateEnabled: false });
});
it.each([undefined, {}, { tenant_id: 19, international_enabled: true, premium_rate_enabled: true },
  { tenant_id: 18, international_enabled: "true", premium_rate_enabled: false },
  { tenant_id: 18, international_enabled: false, premium_rate_enabled: null }])("rejects malformed or wrong-tenant read %j", async row => {
  m.direct.mockResolvedValue(row); render(); await expect(read()).rejects.toThrow("could not confirm");
});
it.each([7, 8])("rejects a replaced authentication identity %s while the scoped read is in flight", async id => {
  m.direct.mockImplementationOnce(async () => {
    m.auth.user = { id };
    return { tenant_id: 18, international_enabled: false, premium_rate_enabled: false };
  });
  render(); await expect(read()).rejects.toThrow("account changed");
});
it("uses an opaque stable key per auth object and replaces it for same-ID reauthentication", async () => {
  const firstKey = [...render().queryKey];
  expect(render().queryKey).toEqual(firstKey);
  m.auth.user = { id: 7 }; const next = render();
  expect(next.queryKey[1]).toBe(firstKey[1]);
  expect(next.queryKey[2]).not.toBe(firstKey[2]);
  expect(await read()).toMatchObject({ authIdentity: next.queryKey[2] });
});
it("does not return a cancelled read even if a target response arrives", async () => {
  render(); const controller = new AbortController(); controller.abort();
  await expect(m.options.queryFn({ signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
});

function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>(done => { resolve = done; });
  return { promise, resolve };
}
it("starts a new direct request instead of retagging an old same-ID session's in-flight request", async () => {
  const old = deferred(), fresh = deferred();
  m.direct.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const first = render(); const retiredRead = first.queryFn({ signal: new AbortController().signal });
  const retiredResult = expect(retiredRead).rejects.toThrow("account changed");
  m.auth.user = { id: 7 }; const second = render();
  const activeRead = second.queryFn({ signal: new AbortController().signal });
  expect(m.createClient).toHaveBeenCalledTimes(2); expect(m.direct).toHaveBeenCalledTimes(2);
  expect(m.fetch).not.toHaveBeenCalled();
  fresh.resolve({ tenant_id: 18, international_enabled: true, premium_rate_enabled: false });
  expect(await activeRead).toMatchObject({ authIdentity: second.queryKey[2], internationalEnabled: true });
  old.resolve({ tenant_id: 18, international_enabled: false, premium_rate_enabled: false });
  await retiredResult;
});
it("uses a new signal and direct request for readback instead of a pre-commit focus request", async () => {
  const old = deferred(), fresh = deferred();
  m.direct.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const options = render(); const beforeCommit = new AbortController();
  const focusRead = options.queryFn({ signal: beforeCommit.signal });
  const cancelledResult = expect(focusRead).rejects.toMatchObject({ name: "AbortError" });
  beforeCommit.abort();
  const afterCommit = new AbortController();
  const readback = options.queryFn({ signal: afterCommit.signal });
  expect(m.direct.mock.calls.map(call => call[1].signal)).toEqual([beforeCommit.signal, afterCommit.signal]);
  expect(m.createClient).toHaveBeenCalledTimes(2); expect(m.fetch).not.toHaveBeenCalled();
  fresh.resolve({ tenant_id: 18, international_enabled: true, premium_rate_enabled: true });
  expect(await readback).toMatchObject({ internationalEnabled: true, premiumRateEnabled: true });
  old.resolve({ tenant_id: 18, international_enabled: false, premium_rate_enabled: false });
  await cancelledResult;
});
