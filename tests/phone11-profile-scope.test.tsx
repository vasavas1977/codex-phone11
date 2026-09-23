import { beforeEach, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { createRequire } from "node:module";

const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as { renderToStaticMarkup(node: ReactNode): string };
const m = vi.hoisted(() => ({
  owner: null as any,
  chat: null as any,
  sip: null as any,
  query: null as any,
  mutation: null as any,
  queryInputs: [] as any[],
  queryOptions: [] as any[],
  photoQuery: null as any,
  loadChannels: vi.fn(),
  hub: null as any,
  frame: { values: [] as any[], index: 0 },
}));
vi.mock("react", async () => {
  const actual: any = await vi.importActual("react");
  return { ...actual,
    useState: (initial: any) => { const frame = m.frame, index = frame.index++; if (index >= frame.values.length) frame.values[index] = initial; return [frame.values[index], (value: any) => { frame.values[index] = typeof value === "function" ? value(frame.values[index]) : value; }]; },
    useRef: (initial: any) => { const frame = m.frame, index = frame.index++; if (index >= frame.values.length) frame.values[index] = { current: initial }; return frame.values[index]; },
    useEffect: (effect: () => void | (() => void)) => { effect(); },
  };
});
vi.mock("../lib/trpc", () => ({ trpc: { profile: {
  photoCapability: { useQuery: (_input: any, _options: any) => m.photoQuery },
  self: { useQuery: (input: any, options: any) => { m.queryInputs.push(input); m.queryOptions.push(options); return m.query; } },
  update: { useMutation: () => m.mutation },
} } }));
vi.mock("../lib/_core/auth", () => ({ getAuthSnapshot: () => ({ user: m.owner, loading: false }) }));
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("../lib/chat/store", () => ({ useChatStore: Object.assign(() => m.chat, { getState: () => m.chat }) }));
vi.mock("../hooks/use-auth", () => ({ useAuth: () => ({ user: m.owner }) }));
vi.mock("../lib/sip/account-store", () => ({ useSipAccountStore: (select: any) => select({ account: m.sip }) }));
vi.mock("../components/profile/account-hub", () => ({ AccountHub: (props: any) => { m.hub = props; return createElement("div", null, props.workspaceName); } }));
vi.mock("../components/profile/profile-avatar", () => ({ useProfilePhotoCacheScope: vi.fn() }));
vi.mock("../components/screen-container", () => ({ ScreenContainer: ({ children }: any) => createElement("div", null, children) }));
vi.mock("expo-router", () => ({ router: { back: vi.fn(), push: vi.fn() } }));

import ProfileScreen from "../app/profile/index";
import { useWorkspaceProfile } from "../lib/profile/use-workspace-profile";

const owner = (id: number) => ({ id, openId: `owner-${id}`, name: `Owner ${id}`, email: `${id}@example.com`, loginMethod: "email", lastSignedIn: new Date(0) });
const deferred = () => { let resolve!: (value: any) => void, reject!: (error: unknown) => void; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const useRenderedWorkspaceProfile = (user = m.owner, tenantId = m.chat?.workspace?.id) => { m.frame.index = 0; return useWorkspaceProfile(user, tenantId); };

beforeEach(() => {
  vi.clearAllMocks();
  m.owner = owner(1); m.chat = { userId: 1, workspace: { id: 20, name: "Selected work" }, loading: false, error: null, loadChannels: m.loadChannels };
  m.sip = { ownerUserId: 1, tenantId: 10, username: "3001" };
  m.queryInputs = []; m.queryOptions = []; m.hub = null; m.frame = { values: [], index: 0 };
  m.loadChannels.mockResolvedValue(undefined);
  m.photoQuery = { data: { available: false }, isLoading: false, error: null, refetch: vi.fn().mockResolvedValue({ data: { available: false } }) };
  m.query = { data: { userId: 1 }, isSuccess: true, isLoading: false, error: null, refetch: vi.fn().mockResolvedValue({ data: { userId: 1 } }) };
  m.mutation = { mutateAsync: vi.fn().mockResolvedValue({ userId: 1 }) };
});

it("uses the authenticated selected Team Chat workspace instead of the SIP tenant", () => {
  const route = ProfileScreen() as ReactElement<{ children: ReactElement }>;
  expect(route.props.children.key).toBe("1:20");
  m.frame.index = 0;
  renderToStaticMarkup(createElement(ProfileScreen));
  expect(m.queryInputs.at(-1)).toEqual({ tenantId: 20 });
  expect(m.hub).toMatchObject({ workspaceName: "Selected work", phone: { extension: "3001" } });
  m.chat = { userId: 2, workspace: { id: 30, name: "Another owner" }, loading: false, error: null, loadChannels: m.loadChannels }; m.frame = { values: [], index: 0 };
  renderToStaticMarkup(createElement(ProfileScreen));
  expect(m.queryInputs.at(-1)).toEqual({ tenantId: 0 });
  expect(m.queryOptions.at(-1).enabled).toBe(false);
  expect(m.hub.workspaceName).toBeUndefined();
  expect(m.hub.profileAvailable).toBe(false);
});

it("hydrates the selected Team Chat workspace when My Profile opens first, with explicit retry", async () => {
  m.chat = { userId: 1, workspace: null, loading: false, error: null, loadChannels: m.loadChannels };
  renderToStaticMarkup(createElement(ProfileScreen));
  expect(m.loadChannels).toHaveBeenCalledOnce();
  expect(m.queryOptions.at(-1).enabled).toBe(false);
  expect(m.hub).toMatchObject({ profilePhotoChecking: false, profilePhotoCheckError: false });
  await m.hub.onRetryProfilePhoto();
  expect(m.loadChannels).toHaveBeenCalledTimes(2);
});

it("suppresses stale save, refetch, error, and rendered data after owner and workspace changes", async () => {
  const oldSave = deferred(); m.mutation.mutateAsync.mockReturnValueOnce(oldSave.promise);
  const first = useRenderedWorkspaceProfile(); expect(first.profileAvailable).toBe(true);
  const request = first.save({ workLocation: "remote" });
  m.owner = owner(2); m.chat = { userId: 2, workspace: { id: 30, name: "New work" } };
  m.query = { ...m.query, data: { userId: 1 }, refetch: vi.fn() };
  const switched = useRenderedWorkspaceProfile(m.owner, 30);
  expect(switched.profile).toBeUndefined(); expect(switched.profileAvailable).toBe(false); expect(switched.saving).toBe(false); expect(switched.error).toBeNull();
  oldSave.resolve({ userId: 1 }); await request;
  expect(m.query.refetch).not.toHaveBeenCalled();

  const rejected = deferred(); m.owner = owner(1); m.chat = { userId: 1, workspace: { id: 20, name: "Old work" } }; m.mutation.mutateAsync.mockReturnValueOnce(rejected.promise);
  const old = useRenderedWorkspaceProfile(m.owner, 20); const failing = old.save({ workLocation: "office" });
  m.owner = owner(2); m.chat = { userId: 2, workspace: { id: 30, name: "New work" } }; useRenderedWorkspaceProfile(m.owner, 30);
  rejected.reject(new Error("old private failure")); await expect(failing).rejects.toThrow("old private failure");
  const current = useRenderedWorkspaceProfile(m.owner, 30); expect(current.error).toBeNull(); expect(current.saving).toBe(false);
});

it("keeps a same-scope save current across its pending rerender", async () => {
  const save = deferred(); m.mutation.mutateAsync.mockReturnValueOnce(save.promise);
  const first = useRenderedWorkspaceProfile(); const request = first.save({ workLocation: "remote" });
  expect(useRenderedWorkspaceProfile().saving).toBe(true);
  save.resolve({ userId: 1 }); await request;
  expect(m.query.refetch).toHaveBeenCalledOnce();
  expect(useRenderedWorkspaceProfile().saving).toBe(false);
});
