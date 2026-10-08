import { createRequire } from "node:module";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantMembership } from "../server/pbx/tenant-middleware";

const { renderToStaticMarkup } = createRequire(import.meta.url)(
  "react-dom/server",
) as {
  renderToStaticMarkup(node: ReactNode): string;
};
const m = vi.hoisted(() => ({
  user: { id: 9 } as { id: number } | null,
  loading: false,
  authListeners: [] as (() => void)[],
  memberships: {} as any,
  admission: {} as any,
  options: {} as any,
  workspace: {} as any,
  capabilities: vi.fn(),
  tenant: vi.fn(),
  cancel: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("../hooks/use-auth", () => ({
  useAuth: () => ({ user: m.user, loading: m.loading }),
}));
vi.mock("../lib/_core/auth", () => ({
  addAuthChangeListener: (fn: () => void) => {
    m.authListeners.push(fn);
  },
  getAuthSnapshot: () => ({ user: m.user }),
}));
vi.mock("../lib/trpc", () => ({
  trpc: {
    pbx: { tenant: { memberships: { useQuery: () => m.memberships } } },
    useUtils: () => ({
      pbx: {
        capabilities: { fetch: m.capabilities },
        tenant: { get: { fetch: m.tenant } },
      },
    }),
  },
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: unknown) => {
    m.options = options;
    return m.admission;
  },
  useQueryClient: () => ({ cancelQueries: m.cancel, removeQueries: m.remove }),
}));

// eslint-disable-next-line import/first
import {
  AdminWorkspaceProvider,
  usePbxAdminWorkspace,
  useTenant,
  verifyAdminWorkspaceAdmission,
} from "../hooks/use-pbx-admin";

const member = (tenantId = 7, role = "admin"): TenantMembership => ({
  userId: 9,
  tenantId,
  tenantName: `Company ${tenantId}`,
  tenantStatus: "active",
  tenantSlug: null,
  isDefault: null,
  role,
});
const capabilities = {
  phoneNumbers: false,
  sites: false,
  ringGroups: false,
  queues: false,
  ivr: false,
  businessHours: false,
};
const tenant = (rows: TenantMembership[], id = 7, role = "admin") => ({
  id,
  name: `Company ${id}`,
  userRole: role,
  memberships: rows,
  settingsAvailable: false,
  supportedSettings: [],
});
function Child() {
  m.workspace = usePbxAdminWorkspace();
  const query = useTenant();
  return createElement(
    "div",
    null,
    query.data ? String(query.data.name) : "NO_COMPANY_DATA",
  );
}
const render = () =>
  renderToStaticMarkup(
    createElement(AdminWorkspaceProvider, null, createElement(Child)),
  );
const verify = (rows: TenantMembership[], selected = 7) =>
  verifyAdminWorkspaceAdmission({
    userId: 9,
    tenantId: selected,
    memberships: rows,
    readCapabilities: m.capabilities,
    readTenant: m.tenant,
  });

beforeEach(() => {
  vi.clearAllMocks();
  m.user = null;
  m.authListeners.forEach((fn) => fn());
  m.user = { id: 9 };
  m.loading = false;
  m.memberships = {
    data: [member()],
    isSuccess: true,
    isFetching: false,
    isError: false,
    dataUpdatedAt: 1,
  };
  m.admission = {
    isPending: true,
    isSuccess: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  };
  m.capabilities.mockResolvedValue(capabilities);
  m.tenant.mockResolvedValue(tenant([member()]));
  m.cancel.mockResolvedValue(undefined);
});

describe("admin workspace API admission", () => {
  it("denies a legacy API that ignores inputs before requesting or showing a company for multiple memberships", async () => {
    const rows = [member(), member(12)];
    m.memberships.data = rows;
    render();
    m.workspace.chooseTenant(12);
    render();
    await expect(
      m.options.queryFn({ signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: "UPDATE_REQUIRED" });
    expect(m.tenant).not.toHaveBeenCalled();
    m.admission = {
      isError: true,
      error: await verify(rows, 12).catch((e) => e),
    };
    expect(render()).toContain("NO_COMPANY_DATA");
    expect(m.workspace.updateRequired).toBe(true);
    expect(m.workspace.selectedTenantId).toBeNull();
  });

  it("admits a legacy single-active administrator only after matching tenant and membership identity", async () => {
    expect(render()).toContain("NO_COMPANY_DATA");
    const data = await m.options.queryFn({
      signal: new AbortController().signal,
    });
    expect(m.capabilities).toHaveBeenCalledWith(
      { tenantId: 7 },
      { staleTime: 0 },
    );
    expect(m.tenant).toHaveBeenCalledWith({ tenantId: 7 }, { staleTime: 0 });
    m.admission = { data, isSuccess: true, isFetching: false };
    expect(render()).toContain("Company 7");
    expect(m.workspace.canUseImplicitTenant).toBe(true);
  });

  it("keeps explicit new APIs fully functional for selected multi-workspace reads", async () => {
    const rows = [member(), member(12, "owner")];
    m.memberships.data = rows;
    m.capabilities.mockResolvedValue({
      ...capabilities,
      explicitTenantReads: true,
    });
    m.tenant.mockResolvedValue(tenant(rows, 12, "owner"));
    render();
    m.workspace.chooseTenant(12);
    render();
    const data = await m.options.queryFn({
      signal: new AbortController().signal,
    });
    m.admission = { data, isSuccess: true, isFetching: false };
    expect(render()).toContain("Company 12");
    expect(m.workspace.selectedTenantId).toBe(12);
    expect(m.workspace.canUseImplicitTenant).toBe(false);
    expect(m.tenant).toHaveBeenCalledWith({ tenantId: 12 }, { staleTime: 0 });
  });

  it("rejects a wrong-company reply even with a true explicit-read capability", async () => {
    m.capabilities.mockResolvedValue({
      ...capabilities,
      explicitTenantReads: true,
    });
    await expect(verify([member(), member(12)], 12)).rejects.toMatchObject({
      code: "ACCESS_UNAVAILABLE",
    });
  });

  it("rejects changed roles, membership sets, tenant states and mixed-owner responses", async () => {
    for (const reply of [
      tenant([member()], 7, "user"),
      tenant([member()], 7, "owner"),
      tenant([member(), member(12)]),
      tenant([{ ...member(), tenantStatus: "suspended" }]),
      tenant([{ ...member(), userId: 10 }]),
    ]) {
      m.tenant.mockResolvedValue(reply);
      await expect(verify([member()])).rejects.toMatchObject({
        code: "ACCESS_UNAVAILABLE",
      });
    }
  });

  it("does not infer an explicit-read bit from truthy strings or other schema booleans", async () => {
    for (const value of [undefined, false, "true", 1]) {
      m.capabilities.mockResolvedValue({
        ...capabilities,
        phoneNumbers: true,
        explicitTenantReads: value,
      });
      await expect(verify([member(), member(12)], 12)).rejects.toMatchObject({
        code: "UPDATE_REQUIRED",
      });
    }
    expect(m.tenant).not.toHaveBeenCalled();
  });

  it("withholds old admission on a selected-workspace change and ignores a late previous reply", async () => {
    const rows = [member(), member(12)];
    m.memberships.data = rows;
    m.capabilities.mockResolvedValue({
      ...capabilities,
      explicitTenantReads: true,
    });
    m.tenant.mockResolvedValue(tenant(rows));
    render();
    m.workspace.chooseTenant(7);
    render();
    const previousKey = m.options.queryKey;
    const oldData = await m.options.queryFn({
      signal: new AbortController().signal,
    });
    m.admission = { data: oldData, isSuccess: true, isFetching: false };
    expect(render()).toContain("Company 7");
    m.workspace.chooseTenant(12);
    expect(render()).toContain("NO_COMPANY_DATA");
    expect(m.options.queryKey).not.toEqual(previousKey);
    expect(m.workspace.selectedTenantId).toBeNull();
  });

  it("closes admission while memberships or admission refresh and after either read fails", async () => {
    render();
    const data = await m.options.queryFn({
      signal: new AbortController().signal,
    });
    m.admission = { data, isSuccess: true, isFetching: false };
    expect(render()).toContain("Company 7");
    m.memberships.isFetching = true;
    expect(render()).toContain("NO_COMPANY_DATA");
    expect(m.options.enabled).toBe(false);
    m.memberships.isFetching = false;
    m.admission.isFetching = true;
    expect(render()).toContain("NO_COMPANY_DATA");
    m.admission = {
      data,
      isSuccess: false,
      isError: true,
      error: new Error("unavailable"),
    };
    expect(render()).toContain("NO_COMPANY_DATA");
    expect(m.workspace.admissionError).toBe(true);
    m.capabilities.mockRejectedValueOnce(new Error("unavailable"));
    await expect(verify([member()])).rejects.toThrow("unavailable");
  });

  it("requires a new admission after a newer membership response even if its rows are unchanged", async () => {
    render();
    const data = await m.options.queryFn({
      signal: new AbortController().signal,
    });
    m.admission = { data, isSuccess: true, isFetching: false };
    expect(render()).toContain("Company 7");
    m.memberships.dataUpdatedAt = 2;
    expect(render()).toContain("NO_COMPANY_DATA");
    expect(m.workspace.selectedTenantId).toBeNull();
  });

  it("clears implicit admin caches before admission, retaining memberships and unrelated queries", async () => {
    render();
    await m.options.queryFn({ signal: new AbortController().signal });
    const { predicate } = m.remove.mock.calls[0][0];
    expect(m.cancel.mock.invocationCallOrder[0]).toBeLessThan(
      m.capabilities.mock.invocationCallOrder[0],
    );
    expect(predicate({ queryKey: [["pbx", "dashboard", "stats"]] })).toBe(true);
    expect(predicate({ queryKey: [["pbx", "tenant", "memberships"]] })).toBe(
      false,
    );
    expect(predicate({ queryKey: [["chat", "list"]] })).toBe(false);
  });

  it("stops a cancelled admission after capabilities without starting its tenant read", async () => {
    render();
    const controller = new AbortController();
    m.capabilities.mockImplementationOnce(async () => {
      controller.abort();
      return capabilities;
    });
    await expect(
      m.options.queryFn({ signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(m.tenant).not.toHaveBeenCalled();
  });

  it("rejects an account change while fresh reads are in flight", async () => {
    render();
    m.tenant.mockImplementationOnce(async () => {
      m.user = { id: 10 };
      return tenant([member()]);
    });
    await expect(
      m.options.queryFn({ signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: "ACCESS_UNAVAILABLE" });
    expect(render()).toContain("NO_COMPANY_DATA");
  });
});
